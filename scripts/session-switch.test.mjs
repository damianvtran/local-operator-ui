import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The switch's ORDERING and its send gate, pinned rather than timed.
 *
 * `scripts/session-switch-latency.mjs` measures how long each phase of a switch
 * takes; this file pins the properties that produced the number:
 *
 * - the click commits the target in its own frame, and issues NO request of its
 *   own. The `sessions.get` guard read it used to spend was a second facade
 *   acquire on the backend, racing the stream for the same bridge locks, and it
 *   held the composer shut for 2-20 s behind a busy owner (the desktop load
 *   diagnosis, D-F3). The stream is the validation now;
 * - a send addressed to the target is refused until the stream proves the
 *   session exists (`confirmSessionLive`, on its first snapshot), and a 404 on
 *   the stream tombstones it instead (`confirmSessionMissing`);
 * - a proof for one target cannot vouch for, or tombstone, another;
 * - a send that meets a BUSY owner (`runtime_busy`) is resent, bounded, with the
 *   same request - and nothing else is.
 */

const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/** Every request the store made, and the scripted answers. */
const calls = [];
/** Set by each test: the answer for one `sessions.message`. */
let answer = async () => ({});

globalThis.__switchRequest = async (request) => {
	calls.push(request);
	if (request.op !== "sessions.message") return {};
	return answer(request);
};

const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/shared/store/canonical-sessions-store";
export { hasPendingSend, retainsPendingSend } from "@shared/hooks/use-canonical-session";
export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";`,
		resolveDir: process.cwd(),
	},
	/*
	 * The renderer's aliases are tsconfig paths, not node resolutions. The send
	 * store now imports the composer's own store at runtime (the one return path
	 * for a failed payload), so a fixture that bundles it has to resolve this.
	 */
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "switch-transport-fixture",
			setup(builder) {
				// Only the network is faked. The error classes are re-exported from
				// the real module, because the store's copy rules read `message` off
				// the shipped `DesktopControlError` shape and a stub that always
				// returned a bare string would let a raw exception through here and
				// still pass.
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__switchRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				// The optimistic echo registry is a mounted-transcript concern; the
				// store only calls three functions on it, and none of them is on the
				// switch path. Stubbed so this file tests the store without mounting
				// React or opening an EventSource.
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					/*
					 * A REAL little registry, not a recorder (agent review round 2, R2-2):
					 * the refusal case below reads what the send wrote - entry retained,
					 * entry SETTLED - and a no-op stub cannot tell "kept to paint the row"
					 * from "still going out", which is the distinction the fix turns on.
					 * Same shape `composer-send-failure` carries, including the settled
					 * skip, so the two fixtures stand for one rule.
					 */
					contents: `const registry = new Map();
globalThis.__pendingSendRegistry = registry;
export const echoPendingUser = () => {};
export const retractPendingUser = () => {};
export const retractLocalEcho = () => "retracted";
export const peekLocalEcho = () => "unseen";
export const paintPendingSend = (identity, send) => {
	let entries = registry.get(identity);
	if (!entries) { entries = new Map(); registry.set(identity, entries); }
	entries.set(send.id, { identity, id: send.id, text: send.text, images: send.images, settled: send.settled });
};
export const movePendingSendIdentity = (from, to) => {
	if (from === to) return;
	const entries = registry.get(from);
	if (!entries) return;
	registry.delete(from);
	const destination = registry.get(to) ?? new Map();
	for (const [id, entry] of entries) { entry.identity = to; destination.set(id, entry); }
	registry.set(to, destination);
};
export const replacePendingSendText = (identity, id, text) => {
	const entry = registry.get(identity)?.get(id);
	if (entry) entry.text = text;
};
export const discardPendingSends = (identity) => registry.delete(identity);
export const pendingSendForView = (identity) => {
	const entries = registry.get(identity);
	if (!entries) return null;
	const first = [...entries.values()].find((entry) => entry.settled !== true);
	return first ?? null;
};
export const settlePendingSend = (identity, id) => {
	const entry = registry.get(identity)?.get(id);
	if (entry) entry.settled = true;
};
export const hasPendingSend = (identity, id) => Boolean(registry.get(identity)?.has(id));
export const retainsPendingSend = (identity) => Boolean(registry.get(identity)?.size);
export const discardPendingEchoes = () => {};`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});

const {
	useCanonicalSessionsStore: store,
	admitChatDraft,
	draftIdentityFor,
	paneDraftKey,
	hasPendingSend,
	retainsPendingSend,
	SESSION_UNVALIDATED_CODE,
	DesktopControlError,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const OUTGOING = "111111111111";
const DRAFT = "draft:agent:reviewer";
const TARGET = "222222222222";
const OTHER = "333333333333";

/**
 * Is this rejection the read window's own refusal?
 *
 * Asserted through a helper rather than written inline, because the comparison
 * alone is not specific on the revision these cases are meant to fail on:
 * `SESSION_UNVALIDATED_CODE` does not exist on the store at `df7f3fdb9`, so
 * `error.code === SESSION_UNVALIDATED_CODE` there is `undefined === undefined` -
 * satisfied by ANY rejection that carries no code, in the two cases that are
 * this gate's only guard (reviewer N5). The `typeof` assertion makes the claim
 * falsifiable on both revisions: the pre-change store fails on the constant it
 * does not export, not on a coincidence about an absent field.
 */
function refusedByReadWindow(error) {
	assert.equal(typeof SESSION_UNVALIDATED_CODE, "string");
	return Boolean(error) && error.code === SESSION_UNVALIDATED_CODE;
}

function reset({ draft = null } = {}) {
	/*
	 * The registry is MODULE state and outlives a store reset: without this,
	 * a case reads entries the previous one left behind (`echo-delivery`'s own
	 * `reset` clears it the same way).
	 */
	globalThis.__pendingSendRegistry?.clear?.();
	calls.length = 0;
	answer = async () => ({});
	store.setState({
		sessions: [],
		activeSessionId: draft ? null : OUTGOING,
		activeDraftKey: draft,
		drafts: draft
			? {
					[draft]: {
						key: draft,
						createRequestId: "create",
						admissionRequestId: "admit",
					},
				}
			: {},
		validatingSessionId: null,
		forgotten: {},
		error: null,
	});
}

/**
 * A read that stays open until `release` is called.
 *
 * `release(value)` resolves with it; `release(Promise.reject(...))` is how a
 * deferred FAILURE is injected - built here rather than at the call site so an
 * eager rejection cannot settle a read the test intends to still be in flight.
 */
function deferred() {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test("the switch commits in the click's own frame and spends no request on it", async () => {
	reset();

	const pending = store.getState().openSession(TARGET);

	// The click's own frame. The outgoing session is already gone from the view,
	// and the window is open: nothing has proven the target exists yet.
	assert.equal(store.getState().activeSessionId, TARGET);
	assert.equal(store.getState().activeDraftKey, null);
	assert.equal(store.getState().validatingSessionId, TARGET);
	assert.equal(store.getState().error, null);

	/*
	 * THE WHOLE CHANGE: no `sessions.get`. The panel's own stream is the only
	 * request a switch makes, and it is the panel's, not the store's. FAILS on
	 * `fad59ee31`, where this list is `["sessions.get"]`.
	 */
	assert.deepEqual(calls, []);
	assert.equal(await pending, true);
	assert.deepEqual(calls, []);
	assert.equal(store.getState().activeSessionId, TARGET);
});

test("a switch out of a staged draft leaves it, and still spends no request", async () => {
	reset({ draft: DRAFT });

	assert.equal(await store.getState().openSession(TARGET), true);
	assert.equal(store.getState().activeDraftKey, null);
	assert.equal(store.getState().activeSessionId, TARGET);
	assert.equal(store.getState().validatingSessionId, TARGET);
	// The draft row is not deleted by leaving it - it is still in the rail.
	assert.equal(store.getState().drafts[DRAFT].key, DRAFT);
	assert.deepEqual(calls, []);
});

test("a later switch replaces the window, and an earlier target's proof cannot close it", async () => {
	reset();
	await store.getState().openSession(TARGET);
	await store.getState().openSession(OTHER);
	assert.equal(store.getState().activeSessionId, OTHER);
	assert.equal(store.getState().validatingSessionId, OTHER);

	// The abandoned target's stream lands late - neither proof may vouch for, or
	// tombstone, the session the user is actually on.
	store.getState().confirmSessionLive(TARGET);
	assert.equal(store.getState().validatingSessionId, OTHER);
	store.getState().confirmSessionMissing(TARGET);
	assert.equal(store.getState().validatingSessionId, OTHER);
	assert.equal(store.getState().forgotten[TARGET], undefined);
	assert.equal(store.getState().activeSessionId, OTHER);
});

/*
 * THE WINDOW'S SEND GATE, DRIVEN AS A SEND.
 *
 * `validatingSessionId` is the stretch of unconfirmed session between the click
 * and the stream's first snapshot, and the rule that depends on it - a message
 * may not be ADMITTED against a target nothing has confirmed - is pinned here
 * against the store that owns it. The refusal is driven through the real
 * admission path and named by its own code, and the message is asserted to
 * have created no latch, because "refused before admission" is the reason the
 * composer puts the text BACK rather than holding a claim
 * (`isRefusedBeforeAdmission`).
 */
const SEND = {
	text: "Review this",
	attachments: [],
	images: [],
	mode: "prompt",
	cwd: "/tmp",
};
/** The key `admitChatDraft` is addressed by, from the shipped rule. */
const SEND_KEY = draftIdentityFor(null, TARGET);

test("a send inside the window is refused, and the stream's snapshot opens it", async () => {
	reset();
	await store.getState().openSession(TARGET);
	assert.equal(store.getState().validatingSessionId, TARGET);

	await assert.rejects(admitChatDraft(SEND_KEY, SEND, TARGET), (error) =>
		refusedByReadWindow(error),
	);
	assert.deepEqual(calls, []);
	// No claim was latched, so the composer's text is the only copy of the
	// message: nothing was echoed into a transcript and nothing is being held.
	assert.equal(store.getState().drafts[SEND_KEY], undefined);

	// A stale frame cannot vouch for a window it does not belong to.
	store.getState().confirmSessionLive(OTHER);
	await assert.rejects(admitChatDraft(SEND_KEY, SEND, TARGET), (error) =>
		refusedByReadWindow(error),
	);

	// The session's own stream is the proof, and it is the frame that paints the
	// messages: the composer sends from the same commit.
	store.getState().confirmSessionLive(TARGET);
	assert.equal(store.getState().validatingSessionId, null);
	assert.equal(await admitChatDraft(SEND_KEY, SEND, TARGET), TARGET);
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.message"],
	);
});

test("a 404 on the stream tombstones the target and closes the window, view left on it", async () => {
	reset();
	await store.getState().openSession(TARGET);

	/*
	 * The arm the guard read's not-found used to take, now reached from the
	 * stream: the view stays where the user aimed, so the pane reaches the one
	 * missing-session notice (and survives a reload, `forgotten` is persisted)
	 * rather than rolling back to a conversation they left.
	 */
	store.getState().confirmSessionMissing(TARGET);
	assert.equal(store.getState().validatingSessionId, null);
	assert.equal(store.getState().activeSessionId, TARGET);
	assert.notEqual(store.getState().forgotten[TARGET], undefined);

	// Only a window still waiting may be told: a 404 with no window open is the
	// stream's own `missing` state to render, and rewrites no catalogue.
	reset();
	store.getState().confirmSessionMissing(TARGET);
	assert.equal(store.getState().forgotten[TARGET], undefined);
});

/*
 * RE-SELECTING THE ROW THE VIEW IS ALREADY ON, which is a click the sidebar
 * accepts: the current row is not disabled and carries no second action. The
 * window's stream bound is edge-triggered in `chat-page`, so a window opened for
 * a session whose stream already reported itself would have nothing left to
 * close it - hence the store does not open one for a switch that moves nothing.
 */
test("re-selecting the row the view is already on does not reopen the window", async () => {
	reset();
	await store.getState().openSession(TARGET);
	store.getState().confirmSessionLive(TARGET);
	assert.equal(store.getState().validatingSessionId, null);

	assert.equal(await store.getState().openSession(TARGET), true);
	assert.equal(store.getState().validatingSessionId, null);
	assert.equal(await admitChatDraft(SEND_KEY, SEND, TARGET), TARGET);
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.message"],
	);
});

/*
 * THE BUSY OWNER (backend workstream A's `runtime_busy`): the daemon refuses a
 * control call in ~3 s when the session's owner is alive and not answering, and
 * says a resend with the SAME request id is safe. The store absorbs a few of
 * those itself; it must reuse the request byte for byte (the receipt is keyed on
 * a hash of the whole body), respect `retry_after_ms`, stop after its bound, and
 * leave every other failure alone.
 */
const busy = (retryAfterMs = 1) =>
	new DesktopControlError(
		503,
		"Session owner is unavailable. Reconnect and reconcile before retrying.",
		undefined,
		"runtime_busy",
		retryAfterMs,
	);

test("a send that meets a busy owner is resent with the same request, and lands", async () => {
	reset();
	let attempts = 0;
	answer = async () => {
		attempts += 1;
		if (attempts < 3) throw busy();
		return {};
	};
	assert.equal(await admitChatDraft(SEND_KEY, SEND, TARGET), TARGET);
	const sent = calls.filter((request) => request.op === "sessions.message");
	assert.equal(sent.length, 3);
	for (const request of sent) assert.deepEqual(request, sent[0]);
	assert.equal(typeof sent[0].requestId, "string");
	// The draft finished: nothing is held, no error is left on the composer.
	assert.equal(store.getState().drafts[SEND_KEY], undefined);
});

test("the busy resend is bounded, and hands the refusal to the composer with the text kept", async () => {
	reset();
	answer = async () => {
		throw busy();
	};
	await assert.rejects(
		admitChatDraft(SEND_KEY, SEND, TARGET),
		(error) => error.code === "runtime_busy",
	);
	// One send and three resends, then the existing retryable path takes over.
	assert.equal(
		calls.filter((request) => request.op === "sessions.message").length,
		4,
	);
	const draft = store.getState().drafts[SEND_KEY];
	assert.equal(draft.pending, false);
	assert.equal(draft.errorCode, "runtime_busy");
	/*
	 * NOTHING IS LATCHED FOR A REFUSAL LIKE THIS, AND THE PAYLOAD IS STILL THE
	 * ROW'S - and the difference between those two facts is the change. A busy
	 * owner says in its own code that it did not take the message, so the latch is
	 * off: the pane shows no send in flight, and the app makes no claim about a
	 * fate. The TEXT stays on the row as the retry rule's comparison basis
	 * (`payloadMatchesClaim`), because that is what makes an unchanged re-send an
	 * idempotent replay under the id the owner already answered, rather than a
	 * second message from an owner that had in fact queued the first. The copy the
	 * user acts on is in the composer (the store's one return path; its side of
	 * that is pinned in `composer-send-failure.test.mjs`).
	 */
	assert.equal(draft.submittedText, "Review this");
	assert.equal(draft.admissionAttempted, false);
});

test("the busy resend waits the backend's retry_after_ms, capped", async () => {
	reset();
	const waits = [];
	const original = globalThis.setTimeout;
	globalThis.setTimeout = (fn, ms, ...args) => {
		waits.push(ms);
		return original(fn, 0, ...args);
	};
	try {
		let attempts = 0;
		answer = async () => {
			attempts += 1;
			if (attempts === 1) throw busy(2_000);
			if (attempts === 2) throw busy(60_000);
			return {};
		};
		assert.equal(await admitChatDraft(SEND_KEY, SEND, TARGET), TARGET);
	} finally {
		globalThis.setTimeout = original;
	}
	assert.deepEqual(waits, [2_000, 5_000]);
});

test("no other failure is resent", async () => {
	for (const error of [
		new DesktopControlError(503, "down", undefined, "runtime_unreachable"),
		new DesktopControlError(null, "no response"),
		new DesktopControlError(409, "conflict", undefined, "receipt_conflict"),
	]) {
		reset();
		answer = async () => {
			throw error;
		};
		await assert.rejects(admitChatDraft(SEND_KEY, SEND, TARGET));
		assert.equal(
			calls.filter((request) => request.op === "sessions.message").length,
			1,
			`${error.code ?? error.status} was resent`,
		);
	}
});

/*
 * The pane's claim, keyed on the READER and on the pane's own statement - never
 * on the transport's mood.
 *
 * The pre-merge resolution check (Finding 1) found the pane and the band asking
 * different questions: the hold was `status === "connecting"`, while the band
 * this PR re-keyed asks the reader's own question. On this path the two disagree
 * in both directions, and the two named cases below ARE those directions - the
 * first FAILS on the pre-fix expression (it held a conversation a completed read
 * had already proven EMPTY while the band offered the greeting and its own
 * `grow` beside it), and the second FAILS on it too (a `live` pane whose page is
 * still owed, which the old expression collapsed, leaving no loading claim
 * anywhere on screen).
 *
 * Asking the reader's own field was then wrong in the OPPOSITE direction: a pane
 * whose own statement is already on screen - the failure notice, or the
 * "Reconnecting" line - has nobody having read it either, so it painted the
 * placeholder beside the statement. The table below is the answer to having
 * repaired this class twice, in two opposite directions: it walks EVERY
 * combination of the rule's inputs, so the next change moves a row rather than
 * adding a case. A case records the last bug; a row is a fact about the rule.
 *
 * The THIRD repair is why the third axis below is `awaitingHydration` rather
 * than `hydrated`: "has a page been applied" is false forever for a pane with no
 * session, so a fresh New chat - a staged draft that opens no stream at all -
 * held the placeholder over the screen the band had already restored, two
 * contradictory claims on one screen. The axis is the COMPOSED fact
 * (`CanonicalSessionHandle.awaitingHydration`), which is why a session-less
 * draft and a settled-empty conversation share one row here: neither owes a
 * page, so neither may claim to be loading, and the composition that decides
 * which is which is not this rule's business to guess at.
 *
 * The rules live in `transcript-pane.ts` rather than inside the component for
 * the same reason `scroll-paging.ts` does: a decision about state can be pinned
 * by a node test, and the component keeps the rendering. This file drives the
 * SHIPPED functions - `canonicalTranscriptSpeaks`, `transcriptPaneHoldsPlaceholder`
 * and `transcriptPaneCollapses` - rather than restating the arithmetic, because
 * a test that copies a rule goes on passing after the rule is reverted (review
 * round 2, R7).
 */
const paneBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-pane";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	canonicalTranscriptSpeaks: speaks,
	transcriptPaneCollapses: collapses,
	transcriptPaneHoldsPlaceholder: holdsPlaceholder,
} = await import(
	`data:text/javascript;base64,${Buffer.from(paneBundle.outputFiles[0].text).toString("base64")}`
);

test("a conversation the read has already proven empty is NOT held, even while `connecting`", () => {
	// `Retry` re-arms the stream as `connecting` without undoing a completed read
	// (`use-canonical-session.ts:1307-1312`), so the transport is saying
	// "connecting" about a conversation the reader has already answered.
	assert.equal(
		holdsPlaceholder({
			status: "connecting",
			failure: null,
			awaitingHydration: false,
			recordCount: 0,
		}),
		false,
	);
});

test("a conversation whose page is still owed IS held, at `connecting` and at `live`", () => {
	// Two routes into the same reader-state: this switch's own hydrating window,
	// and a cold session whose `cursor_missing` snapshot goes `live` without ever
	// hydrating (`:1019`, `:1038`). The placeholder is the loading claim in both.
	for (const status of ["connecting", "live"]) {
		assert.equal(
			holdsPlaceholder({
				status,
				failure: null,
				awaitingHydration: true,
				recordCount: 0,
			}),
			true,
		);
	}
});

test("records beat the hold: a pane with a page owed and rows to paint shows no placeholder", () => {
	// Optimistic echo and live events paint rows before the history read lands,
	// and a placeholder over them would contradict the pane's own content.
	assert.equal(
		holdsPlaceholder({
			status: "live",
			failure: null,
			awaitingHydration: true,
			recordCount: 2,
		}),
		false,
	);
	assert.equal(
		holdsPlaceholder({
			status: "connecting",
			failure: null,
			awaitingHydration: false,
			recordCount: 3,
		}),
		false,
	);
});

test("a session-less draft owes no page, so the pane makes no claim at all", () => {
	/*
	 * The operator's report in its second surface: on a fresh New chat the pane held
	 * `Loading conversation…` and its shimmer rows above the splash the band had
	 * already restored. What was wrong was the INPUT to this rule rather than the
	 * rule: a draft opens no stream, so `hydrated` is false for it forever.
	 *
	 * It lands on the same row a settled-empty conversation lands on, and that is the
	 * fix rather than a loss of resolution: neither owes a page, so neither may claim
	 * to be loading. The rule is deliberately NOT given a "there is no session here"
	 * term of its own - only the session can answer whether a page is owed, so the
	 * handle composes that answer once and both readers take it. The composition
	 * itself is pinned against the shipped hook in `draft-splash.test.mjs`.
	 */
	const view = {
		status: "connecting",
		failure: null,
		awaitingHydration: false,
		recordCount: 0,
	};
	assert.equal(holdsPlaceholder(view), false);
	assert.equal(collapses(view), true);
});

/*
 * THE WHOLE MATRIX.
 *
 * A row-less pane has exactly one claim to make, and which one is a function of
 * five values: the status, whether a failure is published, whether the session
 * is still OWED a page, whether there are any records, and whether this pane has
 * ADMITTED a send the owner has not answered. Every combination is below.
 * `failure` present or absent, a page owed or settled, `records` zero or
 * non-zero (2 is a stand-in; the rule reads only the zero test), `admittedSend`
 * on or off, and `claim` is the single thing the pane is then allowed to show:
 *
 *   rows             the conversation's own rows, and nothing else
 *   rows+notice      rows with the failure notice above them
 *   rows+reconnect   rows with the "Reconnecting" line above them
 *   rows+waitline    rows with the wait line under them (a follow-up send)
 *   notice           the failure notice alone - no placeholder beside it
 *   reconnect        the "Reconnecting" line alone - no placeholder beside it
 *   waitline         the wait line alone: the pane has just admitted a send, the
 *                    placeholder would be a second and weaker claim, and the
 *                    column stays open because the line is rendered into it
 *   placeholder      the pulsing "Loading conversation…" placeholder alone
 *   empty            nothing: the pane collapses, and the band may claim the
 *                    conversation is empty - because the read proved it, or
 *                    because nothing here owes a read at all
 *
 * The rung itself is `deriveWorkingLine`'s (`working-line-model.ts`, asserted in
 * `tool-row.test.mjs`); what this table reads is that the pane's geometry and its
 * placeholder obey the same fact, which is the half that lived in the component
 * and could not be tested (review round 2's R2-2, and QA round 2's Q1 in the
 * opposite direction: an earlier revision of these two functions suppressed the
 * placeholder WITHOUT standing the collapse down, so the wait line was rendered
 * into a zero-height box - the dead air again).
 *
 * The `reachable` column is the store's own invariant, not a rendering fact, and
 * it is asserted rather than trusted: `failure` is published only WITH
 * `unavailable` (`use-canonical-session.ts:766`, `:1201`) and cleared whenever
 * the stream re-arms or a snapshot lands (`:1031`, `:1240`, `:1308`), so a
 * failure at any other status, and `unavailable` with no failure, cannot occur.
 * Those rows are still asserted: the decision is total, and the next edit to the
 * store may reach one.
 *
 * The matrix is asserted COMPLETE as well as correct - all 32 combinations, once
 * each - so dropping a row fails here even when every remaining row agrees.
 *
 * AND A SIXTH AXIS SITS BESIDE IT: `stale`, the cache's own flag. It is not a
 * column of THIS table because it changes nothing for the rows here - every one
 * of them passes no `stale`, which is the "not the cache's" row - and doubling a
 * 64-row table to say one extra thing is how the extra thing gets skimmed. The
 * cached combinations have their own table below, with the same two shipped
 * functions and the completeness check that makes a missing row a failure.
 */
const STATUSES = ["connecting", "live", "reconnecting", "unavailable"];
/** Any non-null notice: the rule reads its presence, not its prose. */
const FAILURE = { statement: "unreadable", action: "reconnect" };
const MATRIX = [
	// status, failure, pageOwed, records, admitted, reachable, claim
	["connecting", null, true, 0, false, true, "placeholder"],
	["connecting", null, true, 2, false, true, "rows"],
	["connecting", null, false, 0, false, true, "empty"],
	["connecting", null, false, 2, false, true, "rows"],
	["connecting", FAILURE, true, 0, false, false, "placeholder"],
	["connecting", FAILURE, true, 2, false, false, "rows"],
	["connecting", FAILURE, false, 0, false, false, "empty"],
	["connecting", FAILURE, false, 2, false, false, "rows"],
	["live", null, true, 0, false, true, "placeholder"],
	["live", null, true, 2, false, true, "rows"],
	["live", null, false, 0, false, true, "empty"],
	["live", null, false, 2, false, true, "rows"],
	["live", FAILURE, true, 0, false, false, "placeholder"],
	["live", FAILURE, true, 2, false, false, "rows"],
	["live", FAILURE, false, 0, false, false, "empty"],
	["live", FAILURE, false, 2, false, false, "rows"],
	["reconnecting", null, true, 0, false, true, "reconnect"],
	["reconnecting", null, true, 2, false, true, "rows+reconnect"],
	["reconnecting", null, false, 0, false, true, "reconnect"],
	["reconnecting", null, false, 2, false, true, "rows+reconnect"],
	["reconnecting", FAILURE, true, 0, false, false, "reconnect"],
	["reconnecting", FAILURE, true, 2, false, false, "rows+reconnect"],
	["reconnecting", FAILURE, false, 0, false, false, "reconnect"],
	["reconnecting", FAILURE, false, 2, false, false, "rows+reconnect"],
	["unavailable", null, true, 0, false, false, "placeholder"],
	["unavailable", null, true, 2, false, false, "rows"],
	["unavailable", null, false, 0, false, false, "empty"],
	["unavailable", null, false, 2, false, false, "rows"],
	["unavailable", FAILURE, true, 0, false, true, "notice"],
	["unavailable", FAILURE, true, 2, false, true, "rows+notice"],
	["unavailable", FAILURE, false, 0, false, true, "notice"],
	["unavailable", FAILURE, false, 2, false, true, "rows+notice"],
	["connecting", null, true, 0, true, true, "waitline"],
	["connecting", null, true, 2, true, true, "rows+waitline"],
	["connecting", null, false, 0, true, true, "waitline"],
	["connecting", null, false, 2, true, true, "rows+waitline"],
	["connecting", FAILURE, true, 0, true, false, "waitline"],
	["connecting", FAILURE, true, 2, true, false, "rows+waitline"],
	["connecting", FAILURE, false, 0, true, false, "waitline"],
	["connecting", FAILURE, false, 2, true, false, "rows+waitline"],
	["live", null, true, 0, true, true, "waitline"],
	["live", null, true, 2, true, true, "rows+waitline"],
	["live", null, false, 0, true, true, "waitline"],
	["live", null, false, 2, true, true, "rows+waitline"],
	["live", FAILURE, true, 0, true, false, "waitline"],
	["live", FAILURE, true, 2, true, false, "rows+waitline"],
	["live", FAILURE, false, 0, true, false, "waitline"],
	["live", FAILURE, false, 2, true, false, "rows+waitline"],
	["reconnecting", null, true, 0, true, true, "reconnect"],
	["reconnecting", null, true, 2, true, true, "rows+reconnect"],
	["reconnecting", null, false, 0, true, true, "reconnect"],
	["reconnecting", null, false, 2, true, true, "rows+reconnect"],
	["reconnecting", FAILURE, true, 0, true, false, "reconnect"],
	["reconnecting", FAILURE, true, 2, true, false, "rows+reconnect"],
	["reconnecting", FAILURE, false, 0, true, false, "reconnect"],
	["reconnecting", FAILURE, false, 2, true, false, "rows+reconnect"],
	["unavailable", null, true, 0, true, false, "waitline"],
	["unavailable", null, true, 2, true, false, "rows+waitline"],
	["unavailable", null, false, 0, true, false, "waitline"],
	["unavailable", null, false, 2, true, false, "rows+waitline"],
	["unavailable", FAILURE, true, 0, true, true, "notice"],
	["unavailable", FAILURE, true, 2, true, true, "rows+notice"],
	["unavailable", FAILURE, false, 0, true, true, "notice"],
	["unavailable", FAILURE, false, 2, true, true, "rows+notice"],
];

const key = (status, failure, owed, records, admitted) =>
	`${status}|${failure ? "failure" : "none"}|${owed ? "owed" : "settled"}|${records === 0 ? 0 : "rows"}|${admitted ? "admitted" : "quiet"}`;

test("the pane's single claim, over every combination of the rule's inputs", async (t) => {
	const seen = new Set(
		MATRIX.map(([status, failure, owed, records, admitted]) =>
			key(status, failure, owed, records, admitted),
		),
	);
	assert.equal(MATRIX.length, 64, "a combination is missing from the table");
	assert.equal(seen.size, 64, "a combination is listed twice");
	for (const status of STATUSES) {
		for (const failure of [null, FAILURE]) {
			for (const owed of [true, false]) {
				for (const records of [0, 2]) {
					for (const admitted of [false, true]) {
						assert.ok(
							seen.has(key(status, failure, owed, records, admitted)),
							`${key(status, failure, owed, records, admitted)} is not in the table`,
						);
					}
				}
			}
		}
	}

	for (const [
		status,
		failure,
		owed,
		records,
		admitted,
		reachable,
		claim,
	] of MATRIX) {
		const name = `${key(status, failure, owed, records, admitted)} -> ${claim}`;
		await t.test(name, () => {
			const view = {
				status,
				failure,
				awaitingHydration: owed,
				recordCount: records,
				admittedSend: admitted,
			};
			const shows = [];
			if (records > 0) shows.push("rows");
			if (speaks(view))
				shows.push(status === "unavailable" ? "notice" : "reconnect");
			else if (admitted)
				// The rung: the pane's own claim while a send of its own is in
				// flight, and the reason the placeholder stands down and the
				// collapse does not happen.
				shows.push("waitline");
			if (holdsPlaceholder(view)) shows.push("placeholder");
			const painted = shows.length === 0 ? "empty" : shows.join("+");
			assert.equal(painted, claim, `${name}: the pane would paint ${painted}`);
			// The collapse is the absence of every claim, and nothing else: a
			// collapse over a statement would hide it, and the band reads this
			// same absence as licence to claim the conversation is empty.
			assert.equal(
				collapses(view),
				claim === "empty",
				`${name}: the collapse disagrees with the claim`,
			);
			// At most one claim per row-less pane, which is the defect class.
			assert.ok(
				!(holdsPlaceholder(view) && speaks(view)),
				`${name}: a placeholder beside the pane's own statement`,
			);
			const unreachable =
				(failure !== null && status !== "unavailable") ||
				(status === "unavailable" && failure === null);
			assert.equal(
				reachable,
				!unreachable,
				`${name}: the row's reachability disagrees with the store's invariants`,
			);
		});
	}
});

test("the pane paints nothing of a CACHED conversation until its page lands", async (t) => {
	/*
	 * The sixth axis, and the operator's report that made it one: opening a
	 * conversation this window had already seen painted the cached rows in the
	 * click's own frame, the readings strip ~67 ms later and the caption's removal
	 * with it - "things seem to load at different times ... everything should load
	 * in one solid paint instead of incrementally". Rows that are the cache's while
	 * a page is owed are therefore held, not painted:
	 *
	 * - the hold is TRUE for a quiet pane at any status, owed, with cached rows;
	 * - it is FALSE the moment the page lands (no page owed), which is when the
	 *   rows, the readings and the caption-less transcript arrive in ONE commit;
	 * - it is FALSE while the pane has a send of its own admitted (the wait line
	 *   outranks it) or a statement of its own (the notice, the reconnecting
	 *   line) - the same two exclusions every other row of the matrix has;
	 * - and a pane with records never collapses out of the layout, so the band
	 *   cannot take the free height for a greeting while anything is held.
	 *
	 * `stale` with no page owed is a store-unreachable pair (the page's own commit
	 * clears the flag, `use-canonical-session.ts:3128`) and is asserted anyway, for
	 * the same reason the failure rows are: the decision is total. It must paint
	 * the rows - a pane that has an answer and still holds would be a spinner over
	 * content nobody is waiting for.
	 */
	const CACHED = [
		// status, owed, admitted, hold
		["connecting", true, false, true],
		["connecting", true, true, false],
		["connecting", false, false, false],
		["connecting", false, true, false],
		["live", true, false, true],
		["live", true, true, false],
		["live", false, false, false],
		["live", false, true, false],
		["reconnecting", true, false, false],
		["reconnecting", true, true, false],
		["reconnecting", false, false, false],
		["reconnecting", false, true, false],
		["unavailable", true, false, true],
		["unavailable", true, true, false],
		["unavailable", false, false, false],
		["unavailable", false, true, false],
	];
	assert.equal(
		CACHED.length,
		16,
		"a cached combination is missing from the table",
	);
	for (const status of STATUSES)
		for (const owed of [true, false])
			for (const admitted of [false, true])
				assert.ok(
					CACHED.some(
						(row) =>
							row[0] === status && row[1] === owed && row[2] === admitted,
					),
					`${status}|cached|${owed ? "owed" : "settled"}|${admitted ? "admitted" : "quiet"} is not in the table`,
				);

	for (const [status, owed, admitted, hold] of CACHED) {
		await t.test(
			`${status}|cached|${owed ? "owed" : "settled"}|${admitted ? "admitted" : "quiet"} -> ${hold ? "placeholder" : "rows"}`,
			() => {
				const view = {
					status,
					failure: null,
					awaitingHydration: owed,
					recordCount: 2,
					admittedSend: admitted,
					stale: true,
				};
				assert.equal(holdsPlaceholder(view), hold, "the cached hold");
				assert.equal(
					collapses(view),
					false,
					"a pane with cached records never collapses out of the layout",
				);
				// The invariant the matrix above states, on this axis too: the
				// placeholder never accompanies the pane's own STATEMENT. (The stale
				// caption is not a statement for this rule - it is the flag the hold
				// reads - which is why `speaks` is not the term here.)
				if (hold)
					assert.ok(
						status !== "reconnecting" && !view.missing,
						"a placeholder beside the pane's own statement",
					);
			},
		);
	}
});

test("the cached paint's rows and caption are withheld in the component, not only in the rule", () => {
	// Two facts, one file: the rule above decides, and these two gates are what
	// makes the decision paint nothing. Both are single expressions at the sites
	// the comment above each names, so a later edit that drops the hold from one of
	// them fails HERE - the rule tests would stay green while the pane went back to
	// painting its guess under a caption.
	const transcript = readFileSync(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		"utf8",
	);
	assert.match(
		transcript,
		/\{stale && !holdPlaceholder && \(/,
		"the stale caption must stand down while the pane holds",
	);
	assert.match(
		transcript,
		/\{!missing && !holdPlaceholder && \(/,
		"the rows must be suppressed while the pane holds",
	);
	// And the stop stays keyed on the painted rows, which is what the cached case
	// needs on top of the record count.
	assert.match(
		transcript,
		/transcript\.records\.length === 0 \|\| holdPlaceholder \? -1 : 0/,
		"the scroller's stop is keyed on the painted rows",
	);
});

test("a switch re-windows in the same render, and never from an effect again", () => {
	/*
	 * The operator's report named this stagger too: "things seem to load at
	 * different times". As an effect the window reset landed one commit AFTER the
	 * new transcript's first paint - measured on the cached-switch sequence, the
	 * first painted frame held all 106 fetched rows and the next commit trimmed it
	 * (scroller extent 8,315.6 -> 4,864.2 px, all of it above the fold). The reset
	 * is a render-phase adjustment now; both halves are pinned here so the effect
	 * shape cannot come back green - the render-phase one has to exist, and the
	 * `useEffect(..., [sessionId])` reset has to stay gone.
	 */
	const transcript = readFileSync(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		"utf8",
	);
	assert.match(
		transcript,
		/if \(windowSession !== sessionId\) \{[\s\S]{0,160}setWindowSize\(WINDOW\)/,
		"the window reset is decided during render, in the switch's own commit",
	);
	assert.doesNotMatch(
		transcript,
		/useEffect\(\(\) => \{\s*setWindowSize\(WINDOW\);\s*\}, \[sessionId\]\)/,
		"the reset must not move back into an effect on sessionId",
	);
});

test("the loading indicator stays one small quiet mark", () => {
	// The operator's shape for this state (2026-09-26): "a small loading indicator
	// that is non-intrusive". Three pulse bars were the old shape and a regression
	// to a skeleton would pass every behavioural test in this file, so the shape
	// has a cheap structural pin too: no `Skeleton` bars, and exactly ONE
	// indeterminate element (branding.md's "one such element per surface").
	const placeholder = readFileSync(
		"src/renderer/src/features/chat/canonical/transcript-placeholder.tsx",
		"utf8",
	);
	assert.ok(
		!placeholder.includes("<Skeleton"),
		"the placeholder is a mark and a sentence, not a content sketch",
	);
	assert.equal(
		// On the class strings rather than the bare token: the docstring names the
		// keyframes in prose, and a count over the whole file would be counting the
		// argument for the rule instead of the element it governs.
		(placeholder.match(/className="[^"]*animate-pulse-visible/g) ?? []).length,
		1,
		"one indeterminate element per surface",
	);
	assert.match(
		placeholder,
		/aria-label="Loading conversation"/,
		"the live region keeps its name",
	);
});

/*
 * WHERE EVERY CHAT URL IN THE RENDERER IS BUILT, AND WHO COMMITS A SWITCH.
 *
 * The race this branch fixes was never one bug: the sidebar's rows, the command
 * palette and the `/chat` slash rebind each wrote a switch's URL BEHIND the guard
 * read, so fixing one and leaving the others would have left the same defect behind
 * a different finger. All three call one rule now
 * (`features/chat/open-conversation.ts`), and what keeps that true has to be
 * structural, because a behavioural arm can only ask about the entrance it drives.
 *
 * TWO RULES, CHOSEN SO THAT SPELLING CANNOT EVADE THEM.
 *
 *   A. Every file that BUILDS a chat URL by interpolation (`/chat/${…}`) is listed
 *      with its count and a reason. A URL has to be built by naming the id
 *      somewhere, so an entrance cannot hide by assigning the string to a local
 *      first - the reviewer proved the previous version of this test, which matched
 *      `navigate(`/chat/…)` only, passed for exactly that alias spelling.
 *   B. Every file that calls the store's `openSession(` is listed too. A switch has
 *      to COMMIT through the store, so a new entrance that defers a write behind a
 *      read cannot appear without a store call - and a new entrance that reads
 *      without listing itself fails here by name.
 *
 * WHAT NEITHER RULE SEES, said rather than implied: both scan SPELLINGS in this
 * tree. A caller that imported a shared chat-URL helper or a `/chat/` prefix
 * constant from another module would build a URL without naming the path itself,
 * and the helper's own file would be the one listed. There is no static check here
 * that would catch that shape, and the behavioural arms - which drive the shipped
 * page - remain the only check on a new entrance's TIMING. What these two rules
 * buy is that a new entrance cannot arrive silently: it has to build the URL, or
 * commit the switch, in a file whose entry has to be written down with a reason.
 *
 * The entrances themselves are asserted by name too, below (ENTRANCE_FILES): the
 * rule is called by both entrances in `chat-page.tsx` (the sidebar's row and the
 * `/chat` rebind) and by the palette's conversation rows.
 *
 * FIVE ROWS LEFT THIS TABLE WITH ISSUES #844/#849, which is the change being
 * recorded rather than a hole in the scan: `app.tsx`'s create-agent landing, the
 * agent-hub download landing, the agents sidebar's "Chat with agent", the legacy
 * agents page's Chat button and the palette's agent row all used to write
 * `/chat/<agent id>` - a route whose only non-session fallback had no writer, so
 * every one of them landed on the legacy notice. They stage a draft now
 * (`stageDraft({ kind, name })` then `navigate("/chat")`), which builds no chat
 * URL: the same landing the sidebar's "New chat with <name>" rows have always
 * used. Removing a row here is the test working - the scan follows the code, and
 * an interpolated chat URL RETURNING to one of those files fails as an
 * appearance.
 */
const CHAT_URL_BUILDERS = {
	"src/renderer/src/features/chat/components/chat-page.tsx": {
		count: 1,
		why: "the send path re-pointing the URL once a staged draft's session has materialised - guarded by `activeSessionId === id` in the same expression",
	},
	"src/renderer/src/features/chat/open-conversation.ts": {
		count: 2,
		why: "the rule itself: the switch's own URL, and the refusal's restore",
	},
	/*
	 * `onboarding/components/onboarding-modal.tsx` left this table with the
	 * create-agent step it landed on: its `/chat/${createdAgentId}` was the ONLY
	 * interpolated chat URL in the file, and setup no longer creates an agent to
	 * name one. What remains there is a literal `navigate("/chat")` - the same
	 * landing Finish, Skip and Escape share - which builds no URL and so is not
	 * this scan's subject. An interpolated chat URL returning to that file fails
	 * here as an APPEARANCE, which is the point of keeping the entry out rather
	 * than relaxing the count.
	 */
	"src/renderer/src/features/schedules/components/schedules-page.tsx": {
		count: 1,
		why: "the Schedules row's own `Open conversation`, which is also the cancel toast's path back to the conversation the confirm just promised stays",
	},
	"src/renderer/src/features/projects/components/project-links.tsx": {
		count: 1,
		why: "the Projects detail's linked-session row, which opens the conversation a project links to - the Schedules row's own case, one surface over: the session the row names may never have been opened in this window, so the row that names it has to be able to reach it",
	},
};

/** The files that commit a switch, and why each is allowed to. */
const OPEN_SESSION_CALLERS = {
	"src/renderer/src/features/chat/components/chat-page.tsx": {
		count: 1,
		why: "the route-to-store effect's own call - unchained and deliberate, since it is what makes a deep link and Back work",
	},
	"src/renderer/src/features/chat/open-conversation.ts": {
		count: 1,
		why: "the rule's commit",
	},
	"src/renderer/src/features/schedules/components/schedules-page.tsx": {
		count: 1,
		why: "the Schedules row's own `Open conversation`, through the same rule - a wake's conversation is one the user may never have opened, so the row that names it has to be able to reach it",
	},
	"src/renderer/src/features/projects/components/project-links.tsx": {
		count: 1,
		why: "the Projects detail's linked-session row, through the same rule - a project's linked conversation is one the user may never have opened, so the row that names it has to be able to reach it",
	},
};

/**
 * A source-tree scan over the renderer, counting matches per file.
 *
 * `pattern` is scanned with the `g` flag and counted, so the assertion is about
 * how many times each file does it rather than only whether it does: one more
 * interpolated chat URL in a listed file is a new entrance in a file that already
 * had a reason, which is the case a file-set-only check would miss.
 */
const scanRenderer = (pattern) => {
	/* A URL without a trailing slash is a FILE, so `new URL(entry, dir)` would drop the last segment. */
	const root = new URL("../src/renderer/src/", import.meta.url);
	const found = new Map();
	const walk = (dir, prefix) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = `${prefix}${entry.name}`;
			if (entry.isDirectory()) {
				walk(new URL(`${entry.name}/`, dir), `${rel}/`);
				continue;
			}
			if (!/\.tsx?$/.test(entry.name)) continue;
			const text = readFileSync(new URL(entry.name, dir), "utf8");
			const count = (text.match(pattern) ?? []).length;
			if (count > 0) found.set(`src/renderer/src/${rel}`, count);
		}
	};
	walk(root, "");
	return found;
};

const expectListed = (found, listed, what) => {
	assert.deepEqual(
		[...found.keys()].sort(),
		Object.keys(listed).sort(),
		`a file that ${what} appeared or vanished; name it in the table with its reason`,
	);
	for (const [file, { count, why }] of Object.entries(listed)) {
		assert.equal(
			found.get(file),
			count,
			`${file} does it ${found.get(file)} time(s), not ${count} (${why})`,
		);
	}
};

const ENTRANCE_FILES = {
	"chat-page.tsx": "src/renderer/src/features/chat/components/chat-page.tsx",
	/*
	 * THE SIDEBAR'S ENTRANCE MOVED WITH THE SIDEBAR. The rail and the chat list are
	 * one column now, and it is mounted above the routes (`app.tsx`), so the rows
	 * that switch conversations are the sidebar's own and no longer call back
	 * through `chat-page.tsx`. The table follows the call site, which is the point
	 * of it: an entrance that moved is still an entrance this file has to be able
	 * to see.
	 */
	"sidebar-navigation.tsx":
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	"command-palette.tsx":
		"src/renderer/src/features/command-palette/components/command-palette.tsx",
	/*
	 * AIDA'S OPEN IS AN ENTRANCE TOO, and it takes TWO entries because it is two
	 * call sites: the rail's row resolves her id in `use-aida-target.ts` (the hook
	 * the row calls) and the composer's `/aida` resolves it in `slash-dispatch.ts`
	 * (its own branch), and both then call the shared rule. The pair is what makes
	 * the claim true (agent review round 1, MINOR-2 corrected an earlier comment
	 * that read the two as one call site): a `/chat/` URL is still built in one
	 * module, and the file a future deferred write would HIDE in is named here —
	 * which then fails this test rather than passing by construction.
	 */
	"use-aida-target.ts": "src/renderer/src/features/aida/use-aida-target.ts",
	"slash-dispatch.ts":
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
};
const readSource = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every chat URL in the renderer is built in a file that says why", () => {
	expectListed(
		scanRenderer(/\/chat\/\$\{/g),
		CHAT_URL_BUILDERS,
		"builds a chat URL by interpolation",
	);
});

test("every file that commits a switch is named", () => {
	expectListed(
		scanRenderer(/\.openSession\(/g),
		OPEN_SESSION_CALLERS,
		"commits a switch through the store",
	);
});

test("every entrance writes the switch's URL with the commit, through one rule", () => {
	const rule = readSource(
		"src/renderer/src/features/chat/open-conversation.ts",
	);
	/* The rule is where a switch's URL is written, and it writes it before the read answers. */
	assert.match(rule, /navigate\(written\)/);
	assert.ok(
		rule.indexOf("navigate(written)") < rule.indexOf("void pending.then("),
		"the rule must write the URL with the commit, not from the read's answer",
	);
	/*
	 * The rule's only delayed write is the REFUSAL, and it is bounded twice: to this
	 * call's own write still being the route, and to the draft's own route when a draft
	 * is what superseded it. Both are asserted so that moving a deferral into the rule -
	 * the shape this test exists to catch - fails here rather than passing by
	 * construction.
	 */
	assert.match(rule, /if \(ok\) return;/);
	assert.match(rule, /getCurrentPath\(\) !== written/);
	assert.match(rule, /activeDraftKey/);
	assert.match(rule, /\{ replace: true \}/);
	for (const [name, path] of Object.entries(ENTRANCE_FILES)) {
		const text = readSource(path);
		assert.ok(
			text.includes("openConversation("),
			`${name} does not call the shared rule`,
		);
		/*
		 * And no entrance defers its URL write behind the read: the shape the defect
		 * had was `openSession(...).then((ok) => { if (ok) navigate(...) })`, so it is
		 * asserted as the absence of an `openSession` result being navigated on. The
		 * route-to-store effect's own `store.openSession(id);` is not chained and is
		 * deliberately still there - it is what makes a deep link and Back work.
		 */
		assert.doesNotMatch(
			text,
			/openSession\([^)]*\)\s*\.then\(/,
			`${name} chains its URL write on the guard read`,
		);
	}
	/*
	 * One entrance per file: the sidebar's rows, the `/chat` rebind (still
	 * `chat-page.tsx`'s), the palette's, and Aida's two — the rail's row reaching
	 * through `use-aida-target.ts` and the composer's command through
	 * `slash-dispatch.ts`. The pair that used to be counted in `chat-page` was the
	 * sidebar's row plus that rebind, and the sidebar's row left with the sidebar.
	 */
	assert.equal(
		readSource(ENTRANCE_FILES["chat-page.tsx"]).split("openConversation(")
			.length - 1,
		1,
	);
	assert.equal(
		readSource(ENTRANCE_FILES["sidebar-navigation.tsx"]).split(
			"openConversation(",
		).length - 1,
		1,
	);
	assert.equal(
		readSource(ENTRANCE_FILES["command-palette.tsx"]).split("openConversation(")
			.length - 1,
		1,
	);
	assert.equal(
		readSource(ENTRANCE_FILES["use-aida-target.ts"]).split("openConversation(")
			.length - 1,
		1,
		"the rail's row resolves her id through this module alone; a second call here is a second write rule",
	);
	assert.equal(
		readSource(ENTRANCE_FILES["slash-dispatch.ts"]).split("openConversation(")
			.length - 1,
		1,
		"the composer's `/aida` is the other entrance, and it is this file's one call of the rule",
	);
});

test("U5: a pane reached by the session's own route resolves the staged draft's row", () => {
	reset();
	/*
	 * THE SHAPE UX ROUND 2's U5 MET: a refused FIRST send of a New chat. The draft
	 * row keeps its staged key (the create's answer patches only `sessionId`), and
	 * the pane the user returns to - the session's own route, so
	 * `activeDraftKey` is null - derives `send:<sessionId>`. That key names a row
	 * nothing wrote, which is how the failure's sentence and both of its controls
	 * disappeared while the row itself stayed on screen.
	 *
	 * The resolver and the expression it replaces are asserted BOTH ways, so the
	 * case fails on the revision that only ever answered `send:<sessionId>`.
	 */
	const drafts = {
		[DRAFT]: {
			key: DRAFT,
			createRequestId: "create",
			admissionRequestId: "admit",
			sessionId: TARGET,
			submittedText: "Review this",
			error: "Couldn't confirm your message was sent.",
			errorRetry: true,
		},
	};
	assert.equal(paneDraftKey(null, TARGET, drafts), DRAFT);
	/* What the pane used to read: a miss, which is the defect. */
	assert.equal(drafts[draftIdentityFor(null, TARGET)], undefined);
	/* A live send that never staged a draft keeps the derived fallback. */
	assert.equal(paneDraftKey(null, TARGET, {}), draftIdentityFor(null, TARGET));
	/* And a staged pane still answers its own key, unchanged. */
	assert.equal(paneDraftKey(DRAFT, TARGET, drafts), DRAFT);
});

test("U5: a refused send stops claiming in flight the moment its row states it", async () => {
	reset();
	/*
	 * The refusal is a POST-PAINT failure on a live session (the general boundary
	 * rule's arm): the row is written, and the registry entry - the pane's "a send
	 * is still going out" - must be SETTLED with it, because the store's own
	 * vocabulary already says so (`pending: false` in the same write). Until this
	 * round it waited for a server read that may be incomplete or slow, and a
	 * switch-away inside that window came back reading `waiting for the agent Ns`
	 * for a send that was not alive (UX round 2, U5).
	 */
	await store.getState().openSession(TARGET);
	store.getState().confirmSessionLive(TARGET);
	const draftKey = `draft:${crypto.randomUUID()}`;
	store.setState((state) => ({
		drafts: {
			...state.drafts,
			[draftKey]: {
				key: draftKey,
				createRequestId: crypto.randomUUID(),
				admissionRequestId: crypto.randomUUID(),
				/*
				 * The patch the create's answer writes (`updateDraft(key, { sessionId })`):
				 * the row is how a pane reached by the session's own route finds it, and
				 * it is what makes this the staged-draft shape rather than a bare one.
				 */
				sessionId: TARGET,
			},
		},
	}));
	answer = async () => {
		throw new Error("runtime_unreachable");
	};
	await assert.rejects(admitChatDraft(draftKey, SEND, TARGET));

	const drafts = store.getState().drafts;
	assert.notEqual(drafts[draftKey].error, undefined);
	/* The row is found by the route's own pane - the same resolution as above. */
	assert.equal(paneDraftKey(null, TARGET, drafts), draftKey);
	const entries = globalThis.__pendingSendRegistry.get(TARGET);
	const entry = entries ? [...entries.values()][0] : null;
	assert.ok(entry, "the entry is RETAINED - it is the row's home");
	/*
	 * AND THE PANE'S OWN QUESTION STILL ANSWERS YES (membership, not liveness):
	 * `chat-page`'s failure arm asks the registry whether this send painted a row
	 * before it lets the ROW be the one statement of the failure - a liveness
	 * predicate here would answer null for every post-paint failure and put the
	 * composer's alert back over the row (measured on the re-shoot's first run).
	 * The id is the row's own, exactly as the pane reads it off `drafts[key]`.
	 */
	const advertisedId = store.getState().drafts[draftKey]?.admissionRequestId;
	assert.equal(typeof advertisedId, "string");
	assert.equal(
		hasPendingSend(TARGET, advertisedId),
		true,
		"the pane's painted predicate answers on membership after the settle",
	);
	/*
	 * AND THE COMPOSER'S GATE READS THE SAME DISTINCTION (the re-shoot's J4 arm):
	 * `retainsPendingSend` says a ROW exists, so the composer keeps its mouth shut
	 * while `pendingSendForView` - liveness - rightly says the claim is answered.
	 */
	assert.equal(retainsPendingSend(TARGET), true);
	assert.equal(
		entries
			? [...entries.values()].filter((e) => e.settled !== true).length
			: 0,
		0,
	);
	assert.equal(entry.settled, true, "and SETTLED - the send is not alive");
	assert.equal(
		entries
			? [...entries.values()].filter((e) => e.settled !== true).length
			: 0,
		0,
		"no entry still answers `still going out`",
	);
});
