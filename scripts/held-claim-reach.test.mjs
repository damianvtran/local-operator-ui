import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The esbuild plugin's filters, hoisted to the top level: the
 * `useTopLevelRegex` rule charges a literal constructed inside a function, and
 * `scripts/` sits outside `pnpm lint`'s path list, so this tree's own ratchet
 * (`pnpm lint:scripts`, which compares each changed file against its baseline)
 * is the only gate that would say so - the same reason
 * `canonical-chat.test.mjs` hoists its own.
 */
const RE_DESKTOP_API = /local-operator\/desktop-api$/;
const RE_ANY_MODULE = /.*/;
const RE_REACT = /^react$/;

/*
 * THE HELD CLAIM'S REACH (issue #847), driven through the shipped store, the
 * shipped echo registry and the shipped reducer.
 *
 * WHAT WENT WRONG, in one sentence: `resolveHeldFromServer` recorded
 * `undelivered` off a page that counted as COMPLETE, but "complete" is the
 * page's CONTINUITY (`!cursor_missing`) rather than its REACH, and both pane
 * callers passed continuity - so a shallow-but-complete tail page that could
 * not see back to an older claim answered "did not land" for a message that
 * had, and every mount then repainted that verdict as a row at the tail.
 *
 * The fixture fakes the NETWORK and nothing else. The store, the registry
 * (`use-canonical-session`'s module-level echo targets) and the reducer are the
 * shipped modules - the defect lived in how they compose, so substituting any
 * of them would substitute the thing under test. React is answered by the
 * cell-based stand-in `echo-delivery.test.mjs` uses, because the registry is
 * module state and a node bundle must not drag a renderer in behind it.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/*
 * The durable journal the reads answer from, oldest row first - the shape the
 * wire's page carries (`entries: [{id, ts, type, payload}]`, `ts` in epoch
 * SECONDS). `resolveHeldSendsFromServer` reads it through `desktopResult`, so
 * every case that exercises the launch sweep scripts this array and the
 * fixture slices it exactly as `read_transcript_page` does: a tail page, or
 * the page immediately before `before_id`.
 */
globalThis.__journalRows = [];
globalThis.__historyReads = [];
globalThis.__claimRequest = async (request) => {
	if (request.op !== "sessions.history") return {};
	const rows = globalThis.__journalRows;
	globalThis.__historyReads.push({
		sessionId: request.sessionId,
		beforeId: request.beforeId,
		limit: request.limit,
	});
	const limit = request.limit ?? 100;
	const beforeAt = request.beforeId
		? rows.findIndex((row) => row.id === request.beforeId)
		: rows.length;
	// A cursor the journal does not hold reads as an empty page rather than a
	// full one - the reader's own contract, and the direction that cannot
	// invent a row.
	const end = beforeAt <= 0 ? (request.beforeId ? 0 : rows.length) : beforeAt;
	const start = Math.max(0, end - limit);
	return {
		entries: rows.slice(start, end),
		has_more: start > 0,
		cursor_missing: Boolean(request.beforeId),
	};
};

const bundle = await build({
	stdin: {
		contents: `
			export { useCanonicalSessionsStore, resynthesisePendingSend, composerIdentityFor, panelIdentityFor, draftIdentityFor } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { __registerEchoTarget, __resetPendingSends, peekLocalEcho } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { heldSendClaimsBySession, resolveHeldSendsFromServer } from "./src/renderer/src/features/chat/draft-resolution";
			export { EMPTY_TRANSCRIPT, applyEvent } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "held-claim-reach-fixture",
			setup(builder) {
				// ONLY the network is faked.
				builder.onResolve({ filter: RE_DESKTOP_API }, () => ({
					path: "transport",
					namespace: "held-claim-fixture",
				}));
				builder.onLoad(
					{ filter: RE_ANY_MODULE, namespace: "held-claim-fixture" },
					() => ({
						contents: `export { DesktopControlError, UserFacingError, userFacingMessage } from ${JSON.stringify(
							`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
						)}
export const desktopResult = (request) => globalThis.__claimRequest(request);
export const subscribeDesktopStream = () => () => {};`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
				/*
				 * React is only reached because the registry module is imported for
				 * its module-level maps; nothing here renders. The stand-in is the
				 * one `echo-delivery.test.mjs` uses, installed through a global so a
				 * case could replace it.
				 */
				builder.onResolve({ filter: RE_REACT }, () => ({
					path: "react",
					namespace: "held-claim-react",
				}));
				builder.onLoad(
					{ filter: RE_ANY_MODULE, namespace: "held-claim-react" },
					() => ({
						contents: `const R = () => globalThis.__reactRuntime;
export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useLayoutEffect = (...a) => R().useLayoutEffect(...a);
export const useInsertionEffect = () => {};
export const useRef = (...a) => R().useRef(...a);
export const useCallback = (...a) => R().useCallback(...a);
export const useMemo = (...a) => R().useMemo(...a);
export const useSyncExternalStore = (...a) => R().useSyncExternalStore(...a);
export const useDebugValue = () => {};
export const createElement = () => ({});
export const Fragment = Symbol("fragment");
export default { useState, useEffect, useLayoutEffect, useInsertionEffect, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment };`,
						loader: "js",
					}),
				);
			},
		},
	],
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	useCanonicalSessionsStore: store,
	resynthesisePendingSend,
	composerIdentityFor,
	__registerEchoTarget,
	__resetPendingSends,
	peekLocalEcho,
	heldSendClaimsBySession,
	resolveHeldSendsFromServer,
	EMPTY_TRANSCRIPT,
	applyEvent,
} = module;

const SESSION = "333333333333";
const CLAIM_ID = "call-1111";
const TEXT = "the message that landed";
/** The press's own clock, epoch MILLISECONDS - `ChatDraft.submittedAt`'s unit. */
const PRESS_AT = 1_700_000_000_000;
/** The same instant in the wire's unit, epoch SECONDS - `entry.ts`'s unit. */
const PRESS_AT_SECONDS = PRESS_AT / 1000;
const KEY = `send:${SESSION}`;
const IDENTITY = composerIdentityFor(KEY, SESSION);

/** One history row, with only the fields this suite reads. */
const row = (id, ts) => ({ id, ts, type: "message", payload: {} });

/**
 * A TAIL PAGE THAT DOES NOT REACH THE CLAIM: every row it carries was durable
 * AFTER the press, so it cannot speak about whether the message landed. This is
 * the operator's shape - a tail window younger than the held claim.
 */
const shallowTail = () => [
	row("row-newer-a", PRESS_AT_SECONDS + 30),
	row("row-newer-b", PRESS_AT_SECONDS + 45),
];

/** A PAGE THAT GENUINELY REACHES PAST THE CLAIM: its oldest row predates the press. */
const reachingTail = () => [
	row("row-older", PRESS_AT_SECONDS - 600),
	row("row-newer-b", PRESS_AT_SECONDS + 45),
];

/**
 * The draft row as the store holds it while a claim is held: admission
 * attempted, outcome unknown, payload pinned, and the press's own anchor.
 */
function heldDraft(overrides = {}) {
	return {
		key: KEY,
		createRequestId: "create-1",
		admissionRequestId: CLAIM_ID,
		sessionId: SESSION,
		admissionAttempted: true,
		pending: false,
		submittedText: TEXT,
		submittedAttachments: [],
		submittedImages: [],
		submittedMode: "prompt",
		submittedAt: PRESS_AT,
		...overrides,
	};
}

/**
 * The draft row as a WRONG verdict left it behind: `resolveHeldFromServer` clears
 * the claim's payload fields and records the fate instead. This is the shape
 * sitting on an affected machine.
 */
function staleUndeliveredDraft() {
	return heldDraft({
		submittedText: undefined,
		admissionAttempted: undefined,
		submittedAttachments: undefined,
		admissionRequestId: "fresh-2222",
		undelivered: { recordId: CLAIM_ID, text: TEXT, attachments: [] },
	});
}

/** A transcript that registers the way a mounted pane does: never synchronously. */
function mountTranscript(identity) {
	const cell = { current: EMPTY_TRANSCRIPT };
	return new Promise((resolve) => {
		setTimeout(() => {
			const unregister = __registerEchoTarget(identity, (mutate) => {
				cell.current = mutate(cell.current);
			});
			resolve({
				state: () => cell.current,
				rows: () => cell.current.records.map((record) => record.id),
				apply: (mutate) => {
					cell.current = mutate(cell.current);
				},
				unregister,
			});
		}, 0);
	});
}

function reset() {
	__resetPendingSends();
	globalThis.__journalRows = [];
	globalThis.__historyReads = [];
	store.setState({
		sessions: [],
		placementFacts: {},
		activeSessionId: null,
		activeDraftKey: null,
		drafts: {},
		sessionByAgent: {},
		validatingSessionId: null,
		error: null,
	});
}

const draftAt = (key) => store.getState().drafts[key];

/* ------------------------------------------------------- the reproduction */

/*
 * THE OPERATOR'S CASE, and the whole reason this file exists. A claim older
 * than the tail window, then a COMPLETE snapshot that does not list it: the
 * store must not conclude "undelivered", because that page cannot see back to
 * the claim - and no row may be repainted at the tail.
 */
test("a claim older than the tail window is not ruled undelivered by a complete-but-shallow page", async () => {
	reset();
	store.setState({ drafts: { [KEY]: heldDraft() } });

	store.getState().resolveHeldFromServer(SESSION, shallowTail(), true);

	const draft = draftAt(KEY);
	assert.equal(
		draft.undelivered,
		undefined,
		"a page whose oldest row POSTDATES the press cannot answer 'did not land'",
	);
	assert.equal(
		draft.submittedText,
		TEXT,
		"the claim stays held - retry material, the state the design already tolerates",
	);
	assert.equal(
		draft.admissionAttempted,
		true,
		"and its attempt stays recorded",
	);

	// AND NOTHING REACHES THE TRANSCRIPT: the resolved row is what a later mount
	// painted at the tail, and it must not be painted at all.
	const pane = await mountTranscript(IDENTITY);
	assert.equal(
		resynthesisePendingSend(KEY, draftAt(KEY)),
		false,
		"a held claim paints no resolved row",
	);
	assert.equal(
		pane.rows().includes(CLAIM_ID),
		false,
		"and no tail row appears",
	);
	pane.unregister();
});

/* --------------------------------------------------- the converse cases */

/*
 * THE FEATURE IS PRESERVED: a read that NAMES the id is proof of delivery,
 * however shallow the page is - that arm was never the bug and must not be
 * traded away for the fix.
 */
test("a page that names the claim still resolves it as delivered", () => {
	reset();
	store.setState({ drafts: { [KEY]: heldDraft() } });

	store
		.getState()
		.resolveHeldFromServer(
			SESSION,
			[...shallowTail(), row(CLAIM_ID, PRESS_AT_SECONDS + 5)],
			true,
		);

	const draft = draftAt(KEY);
	assert.equal(
		draft.undelivered,
		undefined,
		"a named id is delivered, full stop",
	);
	assert.equal(draft.submittedText, undefined, "and the claim is answered");
	assert.equal(
		draft.admissionAttempted,
		undefined,
		"the attempt latch goes with it",
	);
	assert.notEqual(
		draft.admissionRequestId,
		CLAIM_ID,
		"and the claim's id dies with the claim, so the next message is not a replay",
	);
});

/*
 * AND SO IS THE VERDICT ITSELF: a page that genuinely reaches PAST the claim
 * and does not name it still concludes undelivered - the message keeps its
 * "Not delivered" line and its remedy.
 */
test("a page that reaches past the claim and does not name it still concludes undelivered", async () => {
	reset();
	store.setState({ drafts: { [KEY]: heldDraft() } });

	store.getState().resolveHeldFromServer(SESSION, reachingTail(), true);

	const draft = draftAt(KEY);
	assert.equal(
		draft.undelivered?.recordId,
		CLAIM_ID,
		"a reaching page's silence is a verdict it can stand behind",
	);
	assert.equal(draft.submittedText, undefined, "the claim is answered NO");

	// The fate statement is the message's home, so a later mount repaints it.
	const pane = await mountTranscript(IDENTITY);
	assert.equal(
		resynthesisePendingSend(KEY, draftAt(KEY)),
		true,
		"the resolved row comes back",
	);
	assert.equal(
		pane.rows().includes(CLAIM_ID),
		true,
		"and a genuinely undelivered message still paints its row",
	);
	assert.equal(
		peekLocalEcho(IDENTITY, CLAIM_ID),
		"local",
		"which is our own settled echo, never mistaken for an owner row",
	);
	pane.unregister();
});

test("an incomplete read concludes nothing, however shallow it is", () => {
	reset();
	store.setState({ drafts: { [KEY]: heldDraft() } });

	// `complete: false` is the page's continuity, which is all the sweep ever
	// claimed - silence from it proves nothing in either direction.
	store.getState().resolveHeldFromServer(SESSION, reachingTail(), false);

	const draft = draftAt(KEY);
	assert.equal(
		draft.undelivered,
		undefined,
		"no verdict off an incomplete page",
	);
	assert.equal(draft.submittedText, TEXT, "and the claim stays held");
});

/* ----------------------------------------------- the repaint guard */

/*
 * A MACHINE THAT ALREADY RECORDED THE WRONG VERDICT (the operator has at least
 * one live). Where the loaded transcript ALREADY holds the record, a mount must
 * not paint a second row at the tail, and the stale verdict must clear.
 */
test("a transcript that already holds the record paints no second row, and the stale verdict clears", async () => {
	reset();
	store.setState({ drafts: { [KEY]: staleUndeliveredDraft() } });
	const pane = await mountTranscript(IDENTITY);
	// The durable owner row, exactly as a history page or a `message_start`
	// leaves it: a user record under the claim's id with `local` unset.
	pane.apply((state) =>
		applyEvent(
			state,
			{
				type: "message_start",
				message: {
					role: "user",
					content: [{ type: "text", text: TEXT }],
					tool_calls: [],
					id: CLAIM_ID,
				},
			},
			PRESS_AT + 1000,
		),
	);
	assert.equal(
		peekLocalEcho(IDENTITY, CLAIM_ID),
		"owner",
		"the transcript holds the owner's own row",
	);

	assert.equal(
		resynthesisePendingSend(KEY, draftAt(KEY)),
		false,
		"nothing is painted over a record the transcript already holds",
	);
	assert.equal(
		pane.state().records.filter((record) => record.id === CLAIM_ID).length,
		1,
		"one row, not two",
	);
	assert.equal(
		draftAt(KEY)?.undelivered,
		undefined,
		"and the stale undelivered record is retracted - the message landed",
	);
	pane.unregister();
});

/*
 * THE GUARD'S OWN CONVERSE, because a guard that refuses everything is not a
 * guard: a message that is genuinely NOT in history keeps its fate statement.
 */
test("a message the transcript does not hold still paints its Not delivered row", async () => {
	reset();
	store.setState({ drafts: { [KEY]: staleUndeliveredDraft() } });
	const pane = await mountTranscript(IDENTITY);

	assert.equal(
		resynthesisePendingSend(KEY, draftAt(KEY)),
		true,
		"an unseen message is painted",
	);
	assert.equal(
		pane.rows().includes(CLAIM_ID),
		true,
		"under the claim's own id",
	);
	assert.notEqual(
		draftAt(KEY)?.undelivered,
		undefined,
		"and its verdict stands - nothing here disproved it",
	);
	pane.unregister();
});

/* ------------------------------------------------- the conservative arms */

/*
 * WHERE THE COMPARISON CANNOT BE MADE, NOTHING IS CONCLUDED. A wrong
 * "undelivered" is the bug; a claim that stays held is retry material the
 * design already tolerates, and the manual clear is the other door.
 */
test("a claim with no press anchor is never ruled undelivered", () => {
	reset();
	store.setState({
		drafts: { [KEY]: heldDraft({ submittedAt: undefined }) },
	});

	store.getState().resolveHeldFromServer(SESSION, reachingTail(), true);

	assert.equal(
		draftAt(KEY)?.undelivered,
		undefined,
		"a page cannot be compared against an anchor that was never stamped",
	);
	assert.equal(draftAt(KEY)?.submittedText, TEXT, "so the claim stays held");
});

test("an empty page is never ruled undelivered", () => {
	reset();
	store.setState({ drafts: { [KEY]: heldDraft() } });

	store.getState().resolveHeldFromServer(SESSION, [], true);

	assert.equal(draftAt(KEY)?.undelivered, undefined, "no rows, no reach");
});

test("a conversation owned by a peer is never ruled undelivered from silence", () => {
	reset();
	store.setState({
		drafts: { [KEY]: heldDraft() },
		placementFacts: {
			[SESSION]: { locality: "remote", owner_device: "peer-1", at: 1 },
		},
	});

	store.getState().resolveHeldFromServer(SESSION, reachingTail(), true);

	assert.equal(
		draftAt(KEY)?.undelivered,
		undefined,
		"the press's clock and the owner's are not comparable, so silence proves nothing",
	);
	assert.equal(draftAt(KEY)?.submittedText, TEXT, "and the claim stays held");
});

/* ------------------------------------------------------------ the heal */

/**
 * A journal of `count` durable rows, oldest first, with the claim's row buried
 * `depth` rows back from the tail. `ts` ascends with position.
 */
function journal(count, claimAt) {
	const rows = [];
	for (let index = 0; index < count; index++) {
		rows.push(row(`row-${index}`, PRESS_AT_SECONDS - (count - index)));
	}
	if (claimAt !== undefined)
		rows[claimAt] = row(CLAIM_ID, PRESS_AT_SECONDS - (count - claimAt));
	return rows;
}

/*
 * THE HEAL, for the verdicts already written: nothing retracts an `undelivered`
 * record today except a read that NAMES the id, and the tail page never will
 * for a message older than its window. So the launch sweep walks BACK for a
 * named record, bounded, and a note that names it is delivery proven.
 */
test("the launch sweep walks back for a stale verdict's record and retracts it", async () => {
	reset();
	// The message sits two pages behind the tail: a tail read cannot see it, and
	// a bounded backward walk can.
	globalThis.__journalRows = journal(450, 250);
	store.setState({ drafts: { [KEY]: staleUndeliveredDraft() } });

	const outcome = await resolveHeldSendsFromServer();

	assert.equal(
		draftAt(KEY)?.undelivered,
		undefined,
		"the verdict is retracted",
	);
	assert.ok(
		globalThis.__historyReads.some((read) => read.beforeId !== undefined),
		"off a read that walked back past the tail page",
	);
	assert.ok(
		outcome.visited >= 1,
		"and the sweep counts the session it visited",
	);
});

/*
 * THE SWEEP'S CLAIM SET NEVER SAW THESE ROWS: a resolved draft has no
 * `submittedText` left, so it is not a held claim and no launch has ever
 * visited its session. The verdicts need their own queue, and this pins that
 * they get one - a session whose ONLY interest is a stale verdict is still
 * walked.
 */
test("a session holding nothing but a stale verdict is still visited and healed", async () => {
	reset();
	globalThis.__journalRows = journal(450, 250);
	store.setState({ drafts: { [KEY]: staleUndeliveredDraft() } });

	assert.deepEqual(
		heldSendClaimsBySession(store.getState().drafts).size,
		0,
		"the stale row is not a held claim - the claim sweep alone would never reach it",
	);

	const outcome = await resolveHeldSendsFromServer();

	assert.equal(
		draftAt(KEY)?.undelivered,
		undefined,
		"the verdict is retracted",
	);
	assert.ok(
		outcome.visited >= 1,
		"which means the sweep queued a session it had no claim for",
	);
});

/*
 * THE LIMIT, SAID RATHER THAN LEFT TO BE DISCOVERED: the walk is bounded, and a
 * record deeper than the budget leaves the verdict standing. That is the honest
 * direction - the row the reader sees is still their statement of what
 * happened, and the manual clear is unaffected - but it is a limit, so it is
 * pinned here rather than described in prose.
 */
test("a record deeper than the walk's budget leaves the verdict standing", async () => {
	reset();
	// 900 rows deep with a 100-row page: past the walk's own budget.
	globalThis.__journalRows = journal(900, 10);
	store.setState({ drafts: { [KEY]: staleUndeliveredDraft() } });

	await resolveHeldSendsFromServer();

	assert.equal(
		draftAt(KEY)?.undelivered?.recordId,
		CLAIM_ID,
		"an unread record disproves nothing, so the verdict stays",
	);
});
