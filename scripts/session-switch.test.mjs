import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The switch's ORDERING, pinned rather than timed.
 *
 * `scripts/session-switch-latency.mjs` measures how long each phase of a switch
 * takes; this file pins the property that produced the number - that a switch
 * commits the target BEFORE the guard read answers, instead of after it. That
 * is a fact about order, not about duration, and a clock would only add flake
 * to a stronger assertion (the same division `submit-latency.test.mjs` draws
 * between its transport measurements and its structural claims).
 *
 * It FAILS on the pre-change store, and that is the point: with the read
 * awaited first, `activeSessionId` still names the outgoing session at the
 * moment of the click, which is exactly the serialisation the latency harness
 * measured as the whole of `click → committed`.
 *
 * What is also pinned here, because "commit optimistically" is only half a
 * design and the other half is what happens when the read says no:
 *
 * - the read is still ISSUED, for the latest intent only;
 * - a failed read puts the view back - session and draft - and says why;
 * - an older read cannot roll back a newer switch (the generation guard);
 * - an older read cannot claim success either, which is what keeps the URL
 *   from being rewritten to a session the user has already left.
 */

const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/** Every request the store made, and the scripted answers. */
const calls = [];
/** Set by each test: the answer for one `sessions.get`. */
let answer = async () => ({});

globalThis.__switchRequest = async (request) => {
	calls.push(request);
	if (request.op !== "sessions.get") return {};
	return answer(request);
};

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";',
		resolveDir: process.cwd(),
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
					contents: `export const echoPendingUser = () => {};
export const retractPendingUser = () => {};
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
	SESSION_UNVALIDATED_CODE,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const OUTGOING = "111111111111";
const DRAFT = "draft:agent:reviewer";
const MATERIALISED = "444444444444";
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
		sessionByAgent: {},
		validatingSessionId: null,
		navigationError: null,
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

test("the switch commits the target before the guard read answers", async () => {
	reset();
	const read = deferred();
	answer = () => read.promise;

	const pending = store.getState().openSession(TARGET);

	// The click's own frame. The outgoing session is already gone from the view:
	// this is the whole change, and it is why the assertion is here and not on a
	// duration.
	assert.equal(store.getState().activeSessionId, TARGET);
	assert.equal(store.getState().activeDraftKey, null);
	assert.equal(store.getState().validatingSessionId, TARGET);
	assert.equal(store.getState().error, null);

	// The read is still issued - the guard was moved behind the commit, not
	// deleted - and it is still the thing that decides the result.
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.get"],
	);
	assert.equal(calls[0].sessionId, TARGET);

	read.release({});
	assert.equal(await pending, true);
	assert.equal(store.getState().activeSessionId, TARGET);
});

test("a failed guard read puts the view back where it was, and says why", async () => {
	reset();
	answer = async () => {
		throw new Error("Unknown session.");
	};

	const ok = await store.getState().openSession(TARGET);

	assert.equal(ok, false);
	assert.equal(store.getState().activeSessionId, OUTGOING);
	assert.equal(store.getState().validatingSessionId, null);
	/*
	 * The failure goes to `navigationError`, NOT to `error`. `error` is the
	 * catalogue's health and `fetchSessions` clears it when it starts - which the
	 * rollback's own refetch does, 4.5-8.1 ms later - so a switch that failed used
	 * to be silent on every frame (UX round 1, U1).
	 */
	assert.equal(store.getState().navigationError, "Unknown session.");
	assert.equal(store.getState().error, null);
});

test("a failed read restores the draft the user was in, not just the session", async () => {
	reset({ draft: "draft:agent:reviewer" });
	answer = async () => {
		throw new Error("Unknown session.");
	};

	const ok = await store.getState().openSession(TARGET);

	assert.equal(ok, false);
	assert.equal(store.getState().activeDraftKey, "draft:agent:reviewer");
	assert.equal(store.getState().activeSessionId, null);
});

/*
 * R1/Q1 - THE ROLLBACK RE-VALIDATES THE DRAFT IT RESTORES.
 *
 * `previous` is captured at the CLICK and the guard read is an arbitrary window,
 * so a send that was in flight on the outgoing draft can land inside it.
 * `finishDraft` then deletes that draft's row and moves `activeSessionId` only
 * while the view is still on that draft - which the commit has just made false -
 * so the row is gone while the snapshot still names it. Writing the snapshot back
 * verbatim put the view on a draft that does not exist: the panel was keyed on
 * the dead key, and a send from it minted a fresh `createRequestId` and opened a
 * SECOND session for a conversation that already had one, with the first now
 * unreachable from the view.
 *
 * This drives the exact interleaving - send in flight, switch, read fails - and
 * FAILS on `a98c2763d`, where `activeDraftKey` came back naming the deleted row.
 */
test("a failed read does not restore a draft whose row is gone", async () => {
	reset({ draft: DRAFT });
	const read = deferred();
	answer = () => read.promise;

	const pending = store.getState().openSession(TARGET);
	/*
	 * The send lands mid-read: the conversation it was admitted under
	 * materialises as a session and `finishDraft` drops the row. The view is on
	 * the target by then, so this deliberately does not move `activeSessionId` -
	 * which is exactly why the rollback cannot read the outcome back out of the
	 * store later.
	 */
	store.getState().finishDraft(DRAFT, MATERIALISED);
	assert.equal(store.getState().drafts[DRAFT], undefined);

	read.release(Promise.reject(new Error("Unknown session.")));
	assert.equal(await pending, false);

	/*
	 * The pointer must not name a row that is gone: every consumer reads
	 * `activeDraftKey` as "a draft is being composed", and a send from it goes
	 * through `admitChatDraft` with no `previous` row - a second session for a
	 * conversation that already has one.
	 */
	assert.equal(store.getState().activeDraftKey, null);
	assert.equal(store.getState().activeSessionId, null);
	assert.equal(store.getState().navigationError, "Unknown session.");
});

/*
 * The other half of the same rule, and the reason the fix is not "stop
 * restoring": a draft that SURVIVED the read is still the view the user came
 * from, and a rollback that dropped it would move them twice for one failure.
 */
test("a failed read still restores a draft whose row survived", async () => {
	reset({ draft: DRAFT });
	const read = deferred();
	answer = () => read.promise;

	const pending = store.getState().openSession(TARGET);
	// The send is still in flight, so the row is where the user left it.
	assert.equal(store.getState().drafts[DRAFT].key, DRAFT);

	read.release(Promise.reject(new Error("Unknown session.")));
	assert.equal(await pending, false);

	assert.equal(store.getState().activeDraftKey, DRAFT);
	assert.equal(store.getState().activeSessionId, null);
});

/*
 * The read window's send gate, which `pendingSessionId` used to carry and which
 * commit-first would otherwise have dropped silently: while `sessions.get` has
 * not answered, the target's existence is unverified, and
 * `validatingSessionId` is what says so. It is closed by the answer - on
 * success and on failure.
 */
test("the read window is published while it lasts and closed by its answer", async () => {
	reset();
	const read = deferred();
	answer = () => read.promise;

	const pending = store.getState().openSession(TARGET);
	assert.equal(store.getState().validatingSessionId, TARGET);

	read.release({});
	assert.equal(await pending, true);
	assert.equal(store.getState().validatingSessionId, null);
});

test("an older read cannot roll back a newer switch", async () => {
	reset();
	const first = deferred();
	const second = deferred();
	const reads = [first.promise, second.promise];
	answer = () => reads.shift();

	const firstSwitch = store.getState().openSession(TARGET);
	// The second click lands while the first read is still in flight.
	const secondSwitch = store.getState().openSession(OTHER);
	assert.equal(store.getState().activeSessionId, OTHER);

	// The first read now fails. It must not drag the view back to the outgoing
	// session: the user has already asked for something else, and this read is
	// not the one they are waiting on.
	first.release({});
	assert.equal(await firstSwitch, false);
	assert.equal(store.getState().activeSessionId, OTHER);

	/*
	 * The second read fails, and IT owns the rollback - to `TARGET`, because
	 * that is where the view was when the second click was made.
	 *
	 * This is the compound case: two consecutive failing reads inside one read's
	 * flight time, which needs a backend that refuses this session twice over.
	 * The rule is still "put back what the user was looking at", and after the
	 * first click that WAS the target - so the assertion is written to say what
	 * the rule is rather than what a single-failure test would assume. The error
	 * below is the part that matters: whatever is on screen, the user is told
	 * the last switch failed.
	 */
	second.release(Promise.reject(new Error("Unknown session.")));
	assert.equal(await secondSwitch, false);
	assert.equal(store.getState().activeSessionId, TARGET);
	assert.equal(store.getState().navigationError, "Unknown session.");
});

test("a superseded read reports false, so the URL is never rewritten back", async () => {
	reset();
	const first = deferred();
	answer = async () => ({});

	const firstSwitch = store.getState().openSession(TARGET);
	const secondSwitch = store.getState().openSession(OTHER);

	first.release({});
	// `select` navigates on `true`; a late `true` here would navigate the user
	// back to the session they have left.
	assert.equal(await firstSwitch, false);
	assert.equal(await secondSwitch, true);
	assert.equal(store.getState().activeSessionId, OTHER);
});

/*
 * THE READ WINDOW'S SEND GATE, DRIVEN AS A SEND.
 *
 * `validatingSessionId` is one round trip of unconfirmed session, and the rule
 * that depends on it - a message may not be ADMITTED against a target nothing
 * has confirmed - used to live only in `ChatPage`'s send callback. Nothing
 * exercised it, so a regression (dropping a term, comparing the wrong id) stayed
 * green through CI, and the refusal itself was silent: the composer kept the
 * text, sent nothing, and said nothing (UX round 2, U8; reviewer N2).
 *
 * Both halves are pinned here against the store that owns them. The refusal is
 * driven through the real admission path and named by its own code, and BOTH
 * bounds that open the window are driven: the read's answer, and a live frame
 * from the session's own stream (`confirmSessionLive`) - the bound that opens
 * the gate on the session's own proof instead of making the user wait out the
 * read's 30 s deadline, which is the only thing left when the read is slow. The
 * message is asserted to have created no echo, because "refused before
 * admission" is the reason the composer puts the text BACK rather than holding
 * a claim (`isRefusedBeforeAdmission`).
 *
 * FAILS on `df7f3fdb9`, where the gate had no store-side existence: the first
 * assertion below gets an admission instead of a refusal.
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

test("a send inside the read window is refused, and the answer opens it", async () => {
	reset();
	const read = deferred();
	answer = () => read.promise;

	const pending = store.getState().openSession(TARGET);
	assert.equal(store.getState().validatingSessionId, TARGET);

	// The send, mid-read. Nothing is addressed to the unconfirmed target, and the
	// refusal carries the code the composer renders and reads back.
	await assert.rejects(admitChatDraft(SEND_KEY, SEND, TARGET), (error) =>
		refusedByReadWindow(error),
	);
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.get"],
	);
	// No claim was latched, so the composer's text is the only copy of the
	// message: nothing was echoed into a transcript and nothing is being held.
	assert.equal(store.getState().drafts[SEND_KEY], undefined);

	// The read's own answer is the first bound.
	read.release({});
	assert.equal(await pending, true);
	assert.equal(store.getState().validatingSessionId, null);
	assert.equal(await admitChatDraft(SEND_KEY, SEND, TARGET), TARGET);
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.get", "sessions.message"],
	);
});

test("a live frame opens the read window before the read answers", async () => {
	reset();
	const read = deferred();
	answer = () => read.promise;

	const pending = store.getState().openSession(TARGET);
	/*
	 * Refused to begin with, so this case names the same failure on the pre-change
	 * store as the one above rather than an absent method: the gate is what is
	 * under test here, and the bound is exercised through it.
	 */
	await assert.rejects(admitChatDraft(SEND_KEY, SEND, TARGET), (error) =>
		refusedByReadWindow(error),
	);
	/*
	 * A stale frame cannot vouch for a window it does not belong to - the guard
	 * that keeps an abandoned target's own snapshot from opening the CURRENT
	 * session's gate.
	 */
	store.getState().confirmSessionLive(OTHER);
	assert.equal(store.getState().validatingSessionId, TARGET);
	await assert.rejects(admitChatDraft(SEND_KEY, SEND, TARGET), (error) =>
		refusedByReadWindow(error),
	);

	// The session's own stream is the earlier proof: it opens the gate while the
	// read is still in flight, which is the state a hung read leaves the panel in
	// (the `Cancel`/Escape affordance that used to cover it is gone).
	store.getState().confirmSessionLive(TARGET);
	assert.equal(store.getState().validatingSessionId, null);
	assert.equal(await admitChatDraft(SEND_KEY, SEND, TARGET), TARGET);
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.get", "sessions.message"],
	);

	// The read lands afterwards and must not roll anything back: it is a read for
	// a switch that already succeeded.
	read.release({});
	assert.equal(await pending, true);
	assert.equal(store.getState().activeSessionId, TARGET);
});

/*
 * RE-SELECTING THE ROW THE VIEW IS ALREADY ON, which is a click the sidebar
 * accepts: the current row is not disabled and carries no second action.
 *
 * The window's live-frame bound is edge-triggered - `chat-page` reports a frame
 * only when the session or its stream status CHANGES - so a second window opened
 * for a session whose stream has already reported itself had one bound left,
 * the read's, and refused sends for its whole latency with a notice the user
 * could do nothing about. Driven here as the store sees it, because the store is
 * where the window is opened and every caller is protected by where the rule
 * lives rather than by one screen remembering it (reviewer N4).
 */
test("re-selecting the row the view is already on does not reopen the read window", async () => {
	reset();
	// An ordinary switch first: the read answers and closes the window it opened.
	assert.equal(await store.getState().openSession(TARGET), true);
	assert.equal(store.getState().validatingSessionId, null);
	calls.length = 0;

	// The re-click. No window, no second read: `true`, because the view, the
	// draft and the URL are already where the click asked to go.
	assert.equal(await store.getState().openSession(TARGET), true);
	assert.equal(store.getState().validatingSessionId, null);
	assert.deepEqual(calls, []);

	// Which is the point: the next send is ADMITTED rather than refused.
	assert.equal(await admitChatDraft(SEND_KEY, SEND, TARGET), TARGET);
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.message"],
	);

	// And a re-click inside an open window does not replace it either: the window
	// that exists keeps its own read and closes on that read's answer.
	const read = deferred();
	answer = () => read.promise;
	const pending = store.getState().openSession(OTHER);
	assert.equal(store.getState().validatingSessionId, OTHER);
	assert.equal(await store.getState().openSession(OTHER), true);
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.message", "sessions.get"],
	);
	read.release({});
	assert.equal(await pending, true);
	assert.equal(store.getState().validatingSessionId, null);
});

/**
 * The same rule does NOT swallow a click that is a real move: a staged draft is
 * a different view of the same session (the sidebar marks the row only when no
 * draft is staged), so clicking that row has to leave the draft.
 */
test("re-selecting the active session still leaves a staged draft", async () => {
	reset({ draft: DRAFT });
	store.setState({ activeSessionId: TARGET });
	calls.length = 0;

	const pending = store.getState().openSession(TARGET);
	assert.equal(store.getState().activeDraftKey, null);
	assert.equal(store.getState().validatingSessionId, TARGET);
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.get"],
	);
	assert.equal(await pending, true);
	assert.equal(store.getState().activeSessionId, TARGET);
	assert.equal(store.getState().validatingSessionId, null);
});

/*
 * `cancelOpen` is gone, and so is the test that pinned what it did to the
 * commit. The switch has no cancellable phase left: the commit IS the navigation
 * and it lands in the click's own frame, so "cancel" could only mean "go back to
 * the session I came from" - which is what clicking that row does. The pending
 * banner, its Escape handler, the sidebar spinner and the store field behind them
 * were all unreachable once nothing set one; `validatingSessionId` carries the
 * one guarantee that had to survive (see the read-window tests above).
 */

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
