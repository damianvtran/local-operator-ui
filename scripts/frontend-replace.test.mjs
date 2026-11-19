import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The `frontend.replace` frame, driven through the REAL hook.
 *
 * WHY THIS FILE EXISTS. A move rewrites the facade's cwd without moving the
 * owner's clock, so the plain delta that used to carry it was dropped by the
 * renderer's own stale-sequence rule and a mounted viewer stayed on the
 * directory the session had already left, directly above a receipt saying it
 * had moved (backend review R4, QA round 1 Q1). The remediation contract § C
 * replaces that delta with an explicit, bridge-cursor-ordered
 * `frontend.replace`, and this file is the proof that the consumer the contract
 * names actually accepts it - and, just as importantly, that it is not a
 * relaxation of the delta rule that let the bug in.
 *
 * HOW. The same harness `scripts/reconnect-page-gap.test.mjs` uses: the shipped
 * hook, the shipped store and the shipped reducer, with a cell-based React
 * stand-in, a stubbed transport and a fake clock. Assertions are on the handle
 * the hook returns after a stated frame sequence, never on a helper's return
 * value, so a replacement that arrives and is then immediately undone by some
 * later branch fails here.
 *
 * The React stand-in does NOT model React's scheduler, batching or commit
 * timing. That is why nothing here asserts on a frame: it asserts what the view
 * holds once the sequence has been delivered and drained.
 */

// `zustand/middleware` reaches for localStorage at import time.
const store = new Map();
globalThis.localStorage = {
	getItem: (key) => store.get(key) ?? null,
	setItem: (key, value) => store.set(key, value),
	removeItem: (key) => store.delete(key),
};

/* ----------------------------------------------------------------- the clock */

let rafQueue = [];
let rafSeq = 0;
let fallbackSeq = 0;
globalThis.requestAnimationFrame = (callback) => {
	rafQueue.push(callback);
	rafSeq += 1;
	return rafSeq;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.window = {
	// The hook only ever CLEARS this fallback; scheduling it for real would let a
	// wall-clock flush race the assertions.
	setTimeout: () => {
		fallbackSeq += 1;
		return fallbackSeq;
	},
	clearTimeout: () => {},
};

/* ------------------------------------------------------------- the transport */

const subscriptions = [];
const requests = [];

globalThis.__replaceSubscribe = (args, onEvent) => {
	const entry = { args, onEvent, disposed: false };
	subscriptions.push(entry);
	return () => {
		entry.disposed = true;
	};
};
globalThis.__replaceRequest = async (request) => {
	requests.push(request);
	if (request.op === "sessions.history") {
		return globalThis.__replaceHistory(request);
	}
	if (request.op === "sessions.get" && globalThis.__replaceSnapshot)
		return globalThis.__replaceSnapshot(request);
	return {};
};

const reactStandIn = `const R = () => globalThis.__reactRuntime;
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
export default { useState, useEffect, useLayoutEffect, useInsertionEffect, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment };`;

const bundle = await build({
	stdin: {
		contents: `
			export { useCanonicalSessionStream, paintPendingSend, RECONCILE_WALK_MAX_REQUESTS } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { acceptFrontendReplace } from "./src/shared/desktop-session-contract";
			export { writePaint, __resetPaintCache } from "./src/renderer/src/shared/store/paint-cache";
			export { EMPTY_TRANSCRIPT, applyHistoryPage } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@shared/i18n": "./src/i18n",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "frontend-replace-fixture",
			setup(builder) {
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "replace-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "replace-fixture" }, () => ({
					contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__replaceRequest(request);
						export const subscribeDesktopStream = (args, onEvent) => globalThis.__replaceSubscribe(args, onEvent);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "replace-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "replace-react" }, () => ({
					contents: reactStandIn,
					loader: "js",
				}));
			},
		},
	],
});
const {
	useCanonicalSessionStream,
	paintPendingSend,
	RECONCILE_WALK_MAX_REQUESTS,
	useCanonicalSessionsStore,
	acceptFrontendReplace,
	writePaint,
	__resetPaintCache,
	EMPTY_TRANSCRIPT,
	applyHistoryPage,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "aaaaaaaaaaaa";
const OTHER_SESSION = "bbbbbbbbbbbb";

/* ------------------------------------------- the React stand-in (one cell per call) */

function makeRuntime() {
	const cells = [];
	let cursor = 0;
	let effects = [];
	const runtime = { render: () => null };
	const rerender = () => {
		cursor = 0;
		effects = [];
		const out = runtime.render();
		const flushed = effects;
		effects = [];
		for (const fn of flushed) fn?.();
		return out;
	};
	runtime.rerender = rerender;
	const slot = () => {
		const index = cursor++;
		if (!cells[index]) cells[index] = {};
		return cells[index];
	};
	const unchanged = (was, next) =>
		was !== undefined &&
		next !== undefined &&
		was.length === next.length &&
		was.every((value, index) => Object.is(value, next[index]));
	globalThis.__reactRuntime = {
		useState: (init) => {
			const cell = slot();
			if (!("state" in cell))
				cell.state = typeof init === "function" ? init() : init;
			return [
				cell.state,
				(value) => {
					const next = typeof value === "function" ? value(cell.state) : value;
					if (Object.is(next, cell.state)) return;
					cell.state = next;
					rerender();
				},
			];
		},
		useRef: (init) => {
			const cell = slot();
			if (!("ref" in cell)) cell.ref = { current: init };
			return cell.ref;
		},
		useCallback: (fn, deps) => {
			const cell = slot();
			if (!cell.fn || !unchanged(cell.deps, deps)) {
				cell.fn = fn;
				cell.deps = deps;
			}
			return cell.fn;
		},
		useMemo: (fn, deps) => {
			const cell = slot();
			if (!("value" in cell) || !unchanged(cell.deps, deps)) {
				cell.value = fn();
				cell.deps = deps;
			}
			return cell.value;
		},
		useEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
		useLayoutEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	};
	return runtime;
}

/* ------------------------------------------------------------------- the wire */

const ROW_EARLY = "row-early";
const ROW_LATER = "row-later";
const DURABLE_ROWS = [
	{
		id: ROW_EARLY,
		ts: 100,
		type: "message",
		payload: {
			kind: "message",
			role: "user",
			content: [{ text: "where am I?" }],
		},
	},
	{
		id: ROW_LATER,
		ts: 101,
		type: "message",
		payload: {
			kind: "message",
			role: "assistant",
			content: [{ text: "in the old directory" }],
			stop_reason: "stop",
		},
	},
];

const OWNER_EPOCH = "owner-epoch";
const BRIDGE_EPOCH = "bridge-epoch";

const frontendState = ({
	sessionId = SESSION,
	cwd,
	sequence,
	epoch = OWNER_EPOCH,
}) => ({
	state_version: 1,
	session_id: sessionId,
	epoch,
	sequence,
	cwd,
	conversation_title: "Conversation A",
	conversation_title_user_set: true,
	conversation_title_forked: false,
	goal: "",
	active_agent: "",
	active_team: "",
	selected_model: null,
	effective_model: null,
	streaming: false,
	generation: 4,
	pending_gate: null,
	history_cursor: ROW_LATER,
	live_events: [],
	queued_steering: [],
	jobs: [],
	todos: [],
	wakes: [],
	mcp_servers: [],
	model_catalogue: [],
});

const openFrame = (seq) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "open",
	payload: { subscription_id: `sub-${seq}`, gap: false, watch_ttl_seconds: 45 },
});

const snapshotFrame = (seq, cwd) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch: OWNER_EPOCH,
			sequence: 1,
			live_cursor: ROW_LATER,
			snapshot: frontendState({ cwd, sequence: 1 }),
		},
		history: { entries: DURABLE_ROWS, has_more: false, cursor_missing: false },
		cold: false,
	},
});

/**
 * The frame under test: the bridge's own cursor, and the facade's bounded
 * projection as `payload.frontend` - the shape `publish_frontend_replace`
 * builds (`utils/desktop_sessions.py`).
 */
const replaceFrame = (
	seq,
	{
		cwd = "/new",
		sessionId = SESSION,
		payloadSessionId = sessionId,
		epoch = BRIDGE_EPOCH,
		sequence = 1,
		cold = true,
	} = {},
) => ({
	session_id: sessionId,
	epoch,
	seq,
	type: "frontend.replace",
	payload: {
		frontend: {
			state_version: 1,
			epoch: OWNER_EPOCH,
			sequence,
			live_cursor: ROW_LATER,
			snapshot: frontendState({
				cwd,
				sequence,
				sessionId: payloadSessionId,
			}),
		},
		cold,
	},
});

/** The delta the frame replaces: the owner's UNCHANGED epoch and sequence. */
const unchangedDeltaFrame = (seq, cwd) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.update",
	payload: {
		epoch: OWNER_EPOCH,
		sequence: 1,
		changes: { cwd },
		job_trajectory_appends: {},
		job_trajectory_replacements: [],
	},
});

/** A genuine next owner delta, at sequence N+1 over the replacement at N. */
const nextOwnerDeltaFrame = (seq, cwd) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.update",
	payload: {
		epoch: OWNER_EPOCH,
		sequence: 2,
		changes: { cwd },
		job_trajectory_appends: {},
		job_trajectory_replacements: [],
	},
});

function deliver(frame) {
	const active = subscriptions.filter((entry) => !entry.disposed).at(-1);
	assert.ok(active, "no live subscription to deliver to");
	active.onEvent({ kind: "data", data: JSON.stringify(frame) });
}

const settle = async () => {
	for (let i = 0; i < 4; i++)
		await new Promise((resolve) => setImmediate(resolve));
};

async function pump() {
	for (let pass = 0; pass < 20 && rafQueue.length > 0; pass++) {
		const callbacks = rafQueue;
		rafQueue = [];
		for (const callback of callbacks) callback();
		await settle();
	}
	await settle();
}

const ids = (transcript) => transcript.records.map((record) => record.id);

/**
 * Mount the shipped hook on a session, deliver `frames` in order, and hand back
 * the handle the hook returned.
 *
 * A fresh mount per case, because the acceptance rule is about ONE
 * subscription's cursor: reusing a handle would carry a cursor across cases and
 * make every "duplicate" assertion pass for the wrong reason.
 */
async function run(cwdAtSnapshot, frames) {
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	globalThis.__replaceHistory = async () => ({
		entries: DURABLE_ROWS,
		has_more: false,
		cursor_missing: false,
	});
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});

	const runtime = makeRuntime();
	let handle = null;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION, true);
		return handle;
	};
	runtime.rerender();
	assert.equal(subscriptions.length, 1, "the panel subscribes on mount");

	let seq = 1;
	deliver(openFrame(seq++));
	deliver(snapshotFrame(seq++, cwdAtSnapshot));
	await pump();
	for (const frame of frames) deliver(frame);
	await pump();
	return handle;
}

/* ------------------------------------------------------------------ the cases */

test("a same-epoch replacement IS applied, and it keeps the transcript", async () => {
	const handle = await run("/old", [replaceFrame(3)]);
	assert.equal(handle.frontend?.cwd, "/new", "the replacement's cwd governs");
	assert.equal(handle.ownerEpoch, OWNER_EPOCH, "the frame's true owner epoch");
	assert.equal(
		handle.cold,
		true,
		"cold comes from the frame, not from the delta path",
	);
	assert.equal(
		handle.receipt?.seq,
		3,
		"the bridge cursor advanced with the frame",
	);
	assert.deepEqual(
		ids(handle.transcript),
		[ROW_EARLY, ROW_LATER],
		"history and transcript rows survive a replacement",
	);
	assert.equal(
		handle.history?.entries?.length,
		DURABLE_ROWS.length,
		"the durable page is not cleared by a replacement",
	);
});

test("the plain delta it replaces is still dropped as stale", async () => {
	// The measured defect this frame exists for, and the reason the frame is not
	// just a relaxation of the rule below: at the SAME owner epoch and sequence
	// an ordinary delta cannot be told from a replayed one, so it must be
	// rejected - and the acceptance rule for it is left untouched here.
	const handle = await run("/old", [unchangedDeltaFrame(3, "/new")]);
	assert.equal(
		handle.frontend?.cwd,
		"/old",
		"a same-sequence frontend.update must NOT repaint the directory",
	);
});

test("a real owner delta at N+1 still applies over a replacement at N", async () => {
	const handle = await run("/old", [
		replaceFrame(3, { sequence: 1 }),
		nextOwnerDeltaFrame(4, "/later"),
	]);
	assert.equal(handle.frontend?.cwd, "/later");
	assert.equal(handle.frontend?.sequence, 2);
});

test("a replacement that is not newer than the cursor cannot roll the paint back", async () => {
	const duplicate = await run("/old", [
		replaceFrame(3, { cwd: "/new" }),
		// Same outer seq: a duplicate, and applying it would repaint /stale.
		replaceFrame(3, { cwd: "/stale" }),
	]);
	assert.equal(duplicate.frontend?.cwd, "/new", "a duplicate is not applied");

	const backwards = await run("/old", [
		replaceFrame(3, { cwd: "/new" }),
		// An out-of-order replay from earlier in the same stream.
		replaceFrame(2, { cwd: "/stale" }),
	]);
	assert.equal(backwards.frontend?.cwd, "/new", "an older seq is not applied");
});

test("a replacement from another epoch or another session is refused", async () => {
	const otherEpoch = await run("/old", [
		replaceFrame(3, { cwd: "/new", epoch: "an-older-bridge" }),
	]);
	assert.equal(
		otherEpoch.frontend?.cwd,
		"/old",
		"an epoch this subscription never served says nothing about its cursor",
	);

	const otherSession = await run("/old", [
		replaceFrame(3, { cwd: "/new", sessionId: OTHER_SESSION }),
	]);
	assert.equal(
		otherSession.frontend?.cwd,
		"/old",
		"the receipt names another session",
	);

	const mismatchedPayload = await run("/old", [
		// The receipt names THIS session while the projection inside it names
		// another: a full projection, so applying it would replace the wrong
		// session's entire paint.
		replaceFrame(3, { cwd: "/new", payloadSessionId: OTHER_SESSION }),
	]);
	assert.equal(
		mismatchedPayload.frontend?.cwd,
		"/old",
		"the payload's own session identity is checked too",
	);
});

test("a replacement before any cursor is refused", () => {
	/*
	 * The first refusal in `acceptFrontendReplace`'s own docstring had no direct
	 * case: it was only reached indirectly, through the pre-snapshot replay where
	 * the bootstrap drops the frame before the predicate runs (agent review round 2,
	 * N-2). A replacement is an instruction to REPLACE a projection, so it is only
	 * meaningful against a cursor the subscription already served - with no cursor
	 * there is nothing it is newer than, and the safe answer is to keep the
	 * snapshot. The predicate is asserted directly because the hook-level route to
	 * this branch does not exist: the first sequenced frame always sets the cursor.
	 */
	const frame = replaceFrame(3, { cwd: "/new" });
	assert.equal(
		acceptFrontendReplace(undefined, SESSION, frame),
		false,
		"no cursor served yet",
	);
	assert.equal(
		acceptFrontendReplace(null, SESSION, frame),
		false,
		"and an explicitly empty one is the same answer",
	);
	assert.equal(
		acceptFrontendReplace({ epoch: frame.epoch, seq: 2 }, SESSION, frame),
		true,
		"the control: with a cursor it is this frame's own seq that decides",
	);
});

test("a replacement in the pre-snapshot replay stays subordinate to the snapshot", async () => {
	// Replay frames are delivered while `snapshotted` is false and are dropped by
	// the bootstrap snapshot. The replacement must not be the one exception.
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	globalThis.__replaceHistory = async () => ({
		entries: DURABLE_ROWS,
		has_more: false,
		cursor_missing: false,
	});
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});
	const runtime = makeRuntime();
	let handle = null;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION, true);
		return handle;
	};
	runtime.rerender();
	deliver(openFrame(1));
	deliver(replaceFrame(2, { cwd: "/replayed" }));
	deliver(snapshotFrame(3, "/authoritative"));
	await pump();
	assert.equal(
		handle.frontend?.cwd,
		"/authoritative",
		"the bootstrap snapshot governs the replay window",
	);
});

// Source revision fences run on the shipped hook, not source-text inference.
// A unique synthetic session keeps these reads off the legacy fixtures' cache.
const SOURCE_SESSION = "cccccccccccc";
const sourcePage = (domain, entries = DURABLE_ROWS) => ({
	entries: entries.map((row, index) => ({ ...row, journal_seq: index })),
	has_more: true,
	cursor_missing: false,
	journal_order_state: "ready",
	journal_generation: domain,
});
const sourceSnapshot = (
	seq,
	domain,
	entries = DURABLE_ROWS,
	sessionId = SOURCE_SESSION,
) => {
	const frame = snapshotFrame(seq, `/source-${domain}`);
	frame.session_id = sessionId;
	frame.payload.frontend.snapshot.session_id = sessionId;
	frame.payload.history = sourcePage(domain, entries);
	return frame;
};
async function sourceMount(sessionId = SOURCE_SESSION) {
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	globalThis.__replaceHistory = async () => sourcePage("source-A");
	globalThis.__replaceSnapshot = async () =>
		sourceSnapshot(9, "source-B", DURABLE_ROWS, sessionId);
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(sessionId, true, true, sessionId, {
			journalOrder: true,
		});
		return handle;
	};
	runtime.rerender();
	deliver({ ...openFrame(1), session_id: sessionId });
	deliver(sourceSnapshot(2, "source-A", DURABLE_ROWS, sessionId));
	await pump();
	return { get: () => handle };
}
const sourceReady = (seq, domain, sessionId = SOURCE_SESSION) => ({
	session_id: sessionId,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "event",
	payload: {
		type: "journal_order_ready",
		journal_generation: domain,
		rows: [{ id: ROW_EARLY, journal_seq: 0 }],
	},
});

test("source hook drops a same-conversation late stream snapshot after a new authoritative domain", async () => {
	const h = await sourceMount();
	assert.equal(h.get().transcript.journalGeneration, "source-A");
	deliver(sourceReady(3, "source-B"));
	await pump();
	assert.equal(h.get().transcript.journalGeneration, "source-B");
	const cursor = h.get().transcript.oldestId;
	globalThis.__replaceHistory = async () => sourcePage("source-B");
	deliver(
		sourceSnapshot(4, "source-A", [
			{ ...DURABLE_ROWS[0], id: "late-old-source" },
		]),
	);
	await pump();
	assert.equal(h.get().transcript.journalGeneration, "source-B");
	assert.equal(h.get().transcript.oldestId, cursor);
	assert.ok(!ids(h.get().transcript).includes("late-old-source"));
});

test("source hook tail request and stable-ID older request cannot commit after domain reset", async () => {
	const h = await sourceMount();
	let tailReply;
	let olderReply;
	globalThis.__replaceHistory = (request) =>
		new Promise((resolve) => {
			if (request.beforeId) olderReply = resolve;
			else tailReply = resolve;
		});
	const tail = h.get().refreshTail(0, h.get().transcript.viewEpoch);
	const older = h.get().loadOlderDetailed();
	assert.ok(tailReply);
	assert.ok(olderReply);
	deliver(sourceReady(3, "source-B"));
	await pump();
	assert.equal(h.get().transcript.journalGeneration, "source-B");
	const cursor = h.get().transcript.oldestId;
	const late = sourcePage("source-A", [
		{ ...DURABLE_ROWS[0], id: "late-old-source" },
	]);
	tailReply(late);
	olderReply(late);
	assert.equal(await tail, false);
	assert.equal((await older).kind, "stale");
	await pump();
	assert.equal(h.get().transcript.oldestId, cursor);
	assert.ok(!ids(h.get().transcript).includes("late-old-source"));
});

test("source hook reconcile walk refuses its old-domain response after authoritative reset", async () => {
	const h = await sourceMount();
	deliver(sourceReady(3, "source-B"));
	await pump();
	let resolveRead;
	globalThis.__replaceHistory = () =>
		new Promise((resolve) => {
			resolveRead = resolve;
		});
	// A new snapshot batch requests the real missed-history walk. Its frame
	// itself is stale; the fresh read is dispatched on B, then C wins while out.
	deliver(sourceSnapshot(4, "source-A"));
	await pump();
	assert.ok(resolveRead, "the actual reconciliation history request is out");
	globalThis.__replaceSnapshot = async () => sourceSnapshot(9, "source-C");
	deliver(sourceReady(5, "source-C"));
	await pump();
	assert.equal(h.get().transcript.journalGeneration, "source-C");
	const cursor = h.get().transcript.oldestId;
	resolveRead(
		sourcePage("source-B", [
			{ ...DURABLE_ROWS[0], id: "late-reconcile-source" },
		]),
	);
	await pump();
	assert.equal(h.get().transcript.journalGeneration, "source-C");
	assert.equal(h.get().transcript.oldestId, cursor);
	assert.ok(!ids(h.get().transcript).includes("late-reconcile-source"));
});

test("source hook settles obsolete ready A dispatched after authoritative B", async () => {
	const h = await sourceMount();
	deliver(sourceReady(3, "source-B"));
	await pump();
	assert.equal(h.get().transcript.journalGeneration, "source-B");
	const before = requests.filter((r) => r.op === "sessions.get").length;
	deliver(sourceReady(4, "source-A"));
	await pump();
	assert.equal(
		requests.filter((r) => r.op === "sessions.get").length,
		before + 1,
	);
	assert.equal(h.get().transcript.journalGeneration, "source-B");
	assert.equal(h.get().transcript.orderNeedsReconcile, false);
	assert.equal(h.get().transcript.orderWantedGeneration, undefined);
	assert.deepEqual(ids(h.get().transcript), [ROW_EARLY, ROW_LATER]);
});

test("source hook preserves a distinct ready wake arriving during repair and reads it once", async () => {
	const h = await sourceMount();
	let resolveRead;
	globalThis.__replaceSnapshot = () =>
		new Promise((resolve) => {
			resolveRead = resolve;
		});
	deliver(sourceReady(3, "source-B"));
	await pump();
	assert.ok(resolveRead);
	deliver(sourceReady(4, "source-C"));
	await pump();
	globalThis.__replaceSnapshot = async () => sourceSnapshot(10, "source-C");
	resolveRead(sourceSnapshot(9, "source-A"));
	await pump();
	assert.equal(h.get().transcript.journalGeneration, "source-C");
	assert.equal(h.get().transcript.orderNeedsReconcile, false);
	assert.equal(h.get().transcript.orderWantedGeneration, undefined);
	assert.deepEqual(ids(h.get().transcript), [ROW_EARLY, ROW_LATER]);
});

const genericReady = (seq, sessionId) => ({
	session_id: sessionId,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "event",
	payload: { type: "journal_order_ready", reconcile: true },
});
const quietSnapshot = (seq, sessionId, sendId, extra = {}) => {
	const frame = sourceSnapshot(seq, "source-A", DURABLE_ROWS, sessionId);
	frame.payload.history = { ...frame.payload.history, ...extra };
	if (sendId) frame.payload.history.journal_ordinals = { [sendId]: 2 };
	return frame;
};

test("source hook preserves generic during-read correction and retries quiet metadata", async () => {
	const sessionId = "dddddddddd01";
	const sendId = "own-generic-hook-send";
	const h = await sourceMount(sessionId);
	let resolveFirst;
	let reads = 0;
	globalThis.__replaceSnapshot = () => {
		reads++;
		if (reads === 1)
			return new Promise((resolve) => {
				resolveFirst = resolve;
			});
		return Promise.resolve(quietSnapshot(30, sessionId, sendId));
	};
	paintPendingSend(sessionId, {
		id: sendId,
		text: "OWN SEND",
		images: [],
		submittedAt: 999999,
	});
	await pump();
	assert.ok(resolveFirst);
	deliver(genericReady(3, sessionId));
	await pump();
	assert.equal(h.get().transcript.orderNeedsReconcile, true);
	resolveFirst(
		quietSnapshot(20, sessionId, null, { journal_missing_ids: [sendId] }),
	);
	await pump();
	const send = h.get().transcript.records.find((r) => r.id === sendId);
	assert.equal(reads, 2);
	assert.equal(send.journalSeq, 2);
	assert.equal(send.provisional, undefined);
	assert.equal(send.text, "OWN SEND");
	assert.equal(h.get().transcript.orderNeedsReconcile, false);
	await pump();
	assert.equal(reads, 2);
});

test("source hook admits idle X then Y when serialized fields match the waiting Y stamp", async () => {
	const sessionId = "dddddddddd02";
	const sendId = "own-stamp-hook-send";
	const h = await sourceMount(sessionId);
	const building = () =>
		quietSnapshot(20, sessionId, null, {
			journal_generation: undefined,
			journal_order_state: "building",
		});
	let resolveFirst;
	let reads = 0;
	globalThis.__replaceSnapshot = () => {
		reads++;
		return reads === 1
			? new Promise((resolve) => {
					resolveFirst = resolve;
				})
			: Promise.resolve(building());
	};
	deliver(sourceReady(3, "wanted-Y", sessionId));
	await pump();
	assert.ok(resolveFirst);
	paintPendingSend(sessionId, {
		id: sendId,
		text: "OWN STAMP SEND",
		images: [],
		submittedAt: 999999,
	});
	await pump();
	resolveFirst(building());
	await pump();
	const beforeReads = reads;
	const priorDemand = h.get().transcript.orderDemand;
	assert.equal(beforeReads, 2);
	assert.equal(h.get().transcript.orderWantedGeneration, "wanted-Y");
	globalThis.__replaceSnapshot = async () => {
		reads++;
		return quietSnapshot(30, sessionId, sendId);
	};
	deliver(sourceReady(4, "wanted-X", sessionId));
	deliver(sourceReady(5, "wanted-Y", sessionId));
	await pump();
	assert.equal(reads, beforeReads + 1);
	assert.notEqual(h.get().transcript.orderDemand, priorDemand);
	assert.equal(h.get().transcript.orderNeedsReconcile, false);
	assert.equal(
		h.get().transcript.records.find((r) => r.id === sendId).journalSeq,
		2,
	);
	await pump();
	assert.equal(reads, beforeReads + 1);
});

test("source hook admits repeated generic idle demand without a generation spelling change", async () => {
	const sessionId = "dddddddddd03";
	const sendId = "own-repeat-generic-send";
	const h = await sourceMount(sessionId);
	let reads = 0;
	globalThis.__replaceSnapshot = async () => {
		reads++;
		return quietSnapshot(20, sessionId, null, {
			journal_generation: undefined,
			journal_order_state: "building",
		});
	};
	paintPendingSend(sessionId, {
		id: sendId,
		text: "OWN SEND",
		images: [],
		submittedAt: 999999,
	});
	await pump();
	deliver(genericReady(3, sessionId));
	await pump();
	const beforeReads = reads;
	const priorDemand = h.get().transcript.orderDemand;
	assert.equal(h.get().transcript.orderNeedsReconcile, true);
	assert.equal(h.get().transcript.orderWantedGeneration, undefined);
	globalThis.__replaceSnapshot = async () => {
		reads++;
		return quietSnapshot(30, sessionId, sendId);
	};
	deliver(genericReady(4, sessionId));
	await pump();
	assert.equal(reads, beforeReads + 1);
	assert.notEqual(h.get().transcript.orderDemand, priorDemand);
	assert.equal(h.get().transcript.orderNeedsReconcile, false);
	assert.equal(
		h.get().transcript.records.find((r) => r.id === sendId).journalSeq,
		2,
	);
});

test("source hook retains a further wake after the flight bound and dispatches it once", async () => {
	const sessionId = "dddddddddd04";
	const sendId = "own-bound-hook-send";
	const h = await sourceMount(sessionId);
	const releases = [];
	let reads = 0;
	globalThis.__replaceSnapshot = () => {
		reads++;
		if (reads <= 2)
			return new Promise((resolve) => {
				releases.push(resolve);
			});
		return Promise.resolve(quietSnapshot(30, sessionId, sendId));
	};
	paintPendingSend(sessionId, {
		id: sendId,
		text: "OWN SEND",
		images: [],
		submittedAt: 999999,
	});
	await pump();
	deliver(genericReady(3, sessionId));
	await pump();
	releases[0](
		quietSnapshot(20, sessionId, null, { journal_missing_ids: [sendId] }),
	);
	await pump();
	assert.equal(reads, 2);
	deliver(genericReady(4, sessionId));
	await pump();
	releases[1](
		quietSnapshot(21, sessionId, null, { journal_missing_ids: [sendId] }),
	);
	await pump();
	assert.equal(reads, 3);
	assert.equal(h.get().transcript.orderNeedsReconcile, false);
	assert.equal(
		h.get().transcript.records.find((r) => r.id === sendId).journalSeq,
		2,
	);
	await pump();
	assert.equal(reads, 3);
});

test("source hook does not turn ordinary tokens into retries of an unchanged missing-ID seal", async () => {
	const sessionId = "dddddddddd05";
	const sendId = "own-missing-hook-send";
	const streamId = "own-source-stream";
	const h = await sourceMount(sessionId);
	let reads = 0;
	globalThis.__replaceSnapshot = async () => {
		reads++;
		return quietSnapshot(20, sessionId, null, {
			journal_missing_ids: [sendId],
			journal_ordinals: { [streamId]: 2 },
		});
	};
	paintPendingSend(sessionId, {
		id: sendId,
		text: "OWN SEND",
		images: [],
		submittedAt: 999999,
	});
	await pump();
	assert.equal(reads, 1);
	// A completed history row correctly refuses later deltas. Exercise an
	// actual streaming row whose source position is already independently known.
	deliver({
		session_id: sessionId,
		epoch: BRIDGE_EPOCH,
		seq: 3,
		type: "event",
		payload: {
			type: "message_start",
			message: { id: streamId, role: "assistant", content: [] },
		},
	});
	await pump();
	const before = h.get().transcript.records.find((r) => r.id === streamId);
	deliver({
		session_id: sessionId,
		epoch: BRIDGE_EPOCH,
		seq: 4,
		type: "event",
		payload: {
			type: "message_update",
			delta: "ordinary token",
			message: {
				id: streamId,
				role: "assistant",
				content: [],
			},
		},
	});
	await pump();
	assert.notEqual(
		h.get().transcript.records.find((r) => r.id === streamId),
		before,
	);
	assert.equal(
		h.get().transcript.records.find((r) => r.id === streamId).text,
		"ordinary token",
	);
	assert.equal(reads, 1);
	assert.equal(
		h.get().transcript.records.find((r) => r.id === sendId).provisional,
		true,
	);
});

/*
 * THE SNAPSHOT ORDER FENCE FENCES THE PAGE, NEVER THE FRAME.
 *
 * A snapshot is tagged with the order revision current at `connect()`. When a
 * generation install moves that revision before the frame is applied - the
 * measured case is the mount-time order repair's `sessions.get` landing first,
 * on switching back to a conversation whose cached paint is from an older
 * journal generation - the frame used to be skipped whole. It is the only frame
 * that publishes `frontend`, and the snapshot deadline was cleared when it
 * arrived, so the pane sat on "Loading conversation..." with nothing retrying.
 *
 * Each case seeds the paint cache the way a previous visit leaves it (rows
 * stamped with `G-old`, plus one stream-born row with no ordinal, which is what
 * makes the mount fire the repair), lets the repair's authoritative read commit
 * `G-new`, and only then delivers the stream's open + snapshot.
 */
const FENCE_SESSION = "dddddddddddd";
const FENCE_STREAM_BORN = "row-stream-born";
const FENCE_STALE_ONLY = "row-stale-only";
const fenceRow = (id, text, journalSeq) => ({
	id,
	ts: 100,
	type: "message",
	payload: { kind: "message", role: "user", content: [{ text }] },
	...(journalSeq === undefined ? {} : { journal_seq: journalSeq }),
});
const fencePage = (entries, generation) => ({
	entries,
	has_more: false,
	cursor_missing: false,
	journal_order_state: "ready",
	...(generation === undefined ? {} : { journal_generation: generation }),
});
const FENCE_SERVER_ROWS = [
	fenceRow(ROW_EARLY, "early", 0),
	fenceRow(ROW_LATER, "later", 1),
	fenceRow(FENCE_STREAM_BORN, "newer row", 2),
];
const fenceSnapshot = (seq, history, cwd = "/fence") => {
	const frame = snapshotFrame(seq, cwd);
	frame.session_id = FENCE_SESSION;
	frame.payload.frontend.snapshot.session_id = FENCE_SESSION;
	frame.payload.history = history;
	return frame;
};
const fenceFrame = (frame) => ({ ...frame, session_id: FENCE_SESSION });
const historyReadCount = () =>
	requests.filter((request) => request.op === "sessions.history").length;

/**
 * Mount on a `G-old` paint, release the repair read so it commits `G-new`, then
 * deliver `frames()` on the connection that was opened BEFORE that commit.
 */
async function fencedMount({ snapshotHistory, frames, history, drafts }) {
	__resetPaintCache();
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	const cached = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		fencePage(
			[
				fenceRow(ROW_EARLY, "cached early", 0),
				fenceRow(ROW_LATER, "cached later", 1),
				// The live stream delivered this one: no journal ordinal yet, so the
				// mount owes an order repair.
				fenceRow(FENCE_STREAM_BORN, "stream-born row"),
			],
			"G-old",
		),
		{ authoritative: true },
	);
	writePaint(FENCE_SESSION, { transcript: cached });
	const serverPage = fencePage(FENCE_SERVER_ROWS, "G-new");
	let releaseRepair;
	const repairGate = new Promise((resolve) => {
		releaseRepair = resolve;
	});
	globalThis.__replaceHistory = async () => serverPage;
	globalThis.__replaceSnapshot = async () => {
		await repairGate;
		return fenceSnapshot(9, serverPage);
	};
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
		placementFacts: {},
	});
	const runtime = makeRuntime();
	let handle;
	// The session the pane shows; `switchTo` moves it the way a sidebar click
	// (another id) or an unmount (`undefined`) does.
	let shown = FENCE_SESSION;
	runtime.render = () => {
		handle = useCanonicalSessionStream(shown, true, true, shown, {
			journalOrder: true,
		});
		return handle;
	};
	runtime.rerender();
	assert.ok(
		requests.some((r) => r.op === "sessions.get" && r.journalOrder === true),
		"the mount fires the order repair's authoritative read",
	);
	releaseRepair();
	await settle();
	assert.equal(
		handle.transcript.journalGeneration,
		"G-new",
		"the repair committed the new generation before the snapshot arrived",
	);
	// Installed only now, so a gated walk cannot hold up the repair itself.
	if (history) globalThis.__replaceHistory = history;
	if (drafts) useCanonicalSessionsStore.setState({ drafts });
	const readsBefore = historyReadCount();
	deliver(fenceFrame(openFrame(1)));
	for (const frame of frames ? frames() : [fenceSnapshot(2, snapshotHistory)])
		deliver(frame);
	await pump();
	return {
		get: () => handle,
		historyReads: () => historyReadCount() - readsBefore,
		switchTo: (sessionId) => {
			shown = sessionId;
			runtime.rerender();
		},
	};
}

test("T1: a same-generation snapshot after the repair commits hydrates the pane without a history read", async () => {
	const h = await fencedMount({
		snapshotHistory: fencePage(FENCE_SERVER_ROWS, "G-new"),
	});
	const view = h.get();
	assert.notEqual(view.frontend, null, "the snapshot published `frontend`");
	assert.equal(view.status, "live");
	assert.equal(view.hydrated, true, "the page applied, so it is the proof");
	assert.deepEqual(ids(view.transcript), [
		ROW_EARLY,
		ROW_LATER,
		FENCE_STREAM_BORN,
	]);
	assert.equal(
		view.transcript.records.find((r) => r.id === ROW_EARLY).text,
		"early",
		"the page's own text replaced the cached paint",
	);
	assert.equal(h.historyReads(), 0, "a usable page owes no /history walk");
});

test("T2: a cross-generation snapshot page is dropped, the frame still applies, and one walk hydrates", async () => {
	const h = await fencedMount({
		snapshotHistory: fencePage(
			[
				fenceRow(ROW_EARLY, "early", 0),
				fenceRow(FENCE_STALE_ONLY, "only in the old journal", 1),
			],
			"G-old",
		),
	});
	const view = h.get();
	assert.notEqual(view.frontend, null, "the frame applied");
	assert.equal(view.frontend.cwd, "/fence");
	assert.equal(view.status, "live", "the pane is not left at connecting");
	assert.equal(view.transcript.journalGeneration, "G-new");
	assert.ok(
		!ids(view.transcript).includes(FENCE_STALE_ONLY),
		"the stale page's rows never reach the pane",
	);
	assert.equal(h.historyReads(), 1, "the dropped page is owed one walk");
	assert.equal(view.hydrated, true, "the walk is the hydration authority");
});

test("a snapshot page with no generation after the revision moved is dropped and walked", async () => {
	const h = await fencedMount({
		snapshotHistory: fencePage([
			fenceRow(ROW_EARLY, "early"),
			fenceRow(FENCE_STALE_ONLY, "unstamped"),
		]),
	});
	const view = h.get();
	assert.notEqual(view.frontend, null);
	assert.equal(view.status, "live");
	assert.ok(!ids(view.transcript).includes(FENCE_STALE_ONLY));
	assert.equal(h.historyReads(), 1);
	assert.equal(view.hydrated, true);
});

test("a fenced snapshot after a reconnect leaves `reconnecting`, replaces the held readings, and keeps the replay", async () => {
	const inflight = "a-inflight";
	const h = await fencedMount({
		frames: () => [
			// The connection's first snapshot carries the new generation and applies.
			fenceSnapshot(2, fencePage(FENCE_SERVER_ROWS, "G-new"), "/before"),
		],
	});
	assert.equal(h.get().status, "live");
	assert.equal(h.get().frontend.cwd, "/before");
	// The receipt breaks on the same connection; the pane holds what it painted.
	deliver(
		fenceFrame({
			...openFrame(3),
			payload: { ...openFrame(3).payload, gap: true },
		}),
	);
	await pump();
	assert.equal(h.get().status, "reconnecting");
	assert.equal(h.get().frontend, null);
	assert.equal(h.get().heldFrontend?.cwd, "/before");
	// The replay window, then a snapshot whose page is from the old journal.
	deliver(
		fenceFrame({
			epoch: BRIDGE_EPOCH,
			seq: 4,
			type: "event",
			payload: {
				type: "message_start",
				message: { id: inflight, role: "assistant", content: [] },
			},
		}),
	);
	deliver(
		fenceFrame({
			epoch: BRIDGE_EPOCH,
			seq: 5,
			type: "event",
			payload: {
				type: "message_update",
				message: { id: inflight, role: "assistant", content: [] },
				delta: "replayed answer",
			},
		}),
	);
	deliver(
		fenceSnapshot(
			6,
			fencePage([fenceRow(FENCE_STALE_ONLY, "old journal", 0)], "G-old"),
			"/after",
		),
	);
	await pump();
	const view = h.get();
	assert.equal(view.status, "live", "a fenced page still ends the reconnect");
	assert.equal(view.frontend?.cwd, "/after", "the frame's readings govern");
	assert.equal(view.heldFrontend?.cwd, "/after", "and replace the held ones");
	assert.ok(!ids(view.transcript).includes(FENCE_STALE_ONLY));
	assert.equal(
		view.transcript.records.find((r) => r.id === inflight)?.text,
		"replayed answer",
		"the replay is kept when the page is dropped",
	);
});

/*
 * The fence's own protections, each pinned on a page whose NEWEST ROW IS
 * ALREADY HELD. That is the shape where `pageIsPaintedTail` stands the walk
 * down by itself, so only `fencedPage` can owe it - and the one where a mutant
 * that drops a protection still looks healthy once the walk has answered. The
 * walk is therefore gated: each protection is read while it is still owed.
 */
const FENCE_HELD_TAIL_PAGE = () =>
	fencePage(
		[
			fenceRow(ROW_EARLY, "early (old journal)", 0),
			fenceRow(ROW_LATER, "later (old journal)", 1),
			fenceRow(FENCE_STREAM_BORN, "newer row (old journal)", 2),
		],
		"G-old",
	);
const gatedHistory = () => {
	const gate = { reads: [] };
	gate.handler = (request) =>
		new Promise((resolve) => {
			gate.reads.push({ request, resolve });
		});
	return gate;
};
const HELD_CLAIM_ID = "req-held-send";
const heldClaimDrafts = () => ({
	[`send:${FENCE_SESSION}`]: {
		key: `send:${FENCE_SESSION}`,
		sessionId: FENCE_SESSION,
		createRequestId: "create-held",
		admissionRequestId: HELD_CLAIM_ID,
		submittedText: "did this land?",
		submittedAt: Date.now(),
		admissionAttempted: true,
	},
});

test("a fenced page whose newest row is held still owes the walk, and proves nothing until it answers", async () => {
	const gate = gatedHistory();
	const h = await fencedMount({
		snapshotHistory: FENCE_HELD_TAIL_PAGE(),
		history: gate.handler,
		drafts: heldClaimDrafts(),
	});
	let view = h.get();
	assert.notEqual(view.frontend, null, "the frame applied");
	assert.equal(view.status, "live");
	assert.equal(
		h.historyReads(),
		1,
		"the dropped page owes the walk even though its newest row is held",
	);
	assert.equal(
		view.hydrated,
		false,
		"a fenced page is not proof of hydration; the walk is",
	);
	assert.equal(view.history, null, "a fenced page is not published");
	const claim =
		useCanonicalSessionsStore.getState().drafts[`send:${FENCE_SESSION}`];
	assert.equal(
		claim?.admissionAttempted,
		true,
		"a fenced page's silence does not adjudicate the held send",
	);
	assert.equal(claim?.undelivered, undefined);
	assert.equal(
		view.transcript.records.find((r) => r.id === ROW_EARLY)?.text,
		"cached early",
		"the old journal's text never reaches the pane",
	);
	gate.reads[0].resolve(fencePage(FENCE_SERVER_ROWS, "G-new"));
	await pump();
	view = h.get();
	assert.equal(view.hydrated, true, "the walk hydrated the pane");
	assert.equal(
		view.transcript.records.find((r) => r.id === ROW_EARLY)?.text,
		"early",
	);
	assert.equal(h.historyReads(), 1);
});

test("a fenced page's rows are not connection proof for the walk", async () => {
	// The walk's pages never name the fenced page's only row. Counted as painted,
	// that row would keep the walk from joining and it would page to its bound.
	const h = await fencedMount({
		snapshotHistory: fencePage(
			[fenceRow(FENCE_STALE_ONLY, "only in the old journal", 0)],
			"G-old",
		),
		history: async () => ({
			...fencePage(FENCE_SERVER_ROWS, "G-new"),
			has_more: true,
		}),
	});
	assert.equal(h.get().hydrated, true);
	assert.ok(!ids(h.get().transcript).includes(FENCE_STALE_ONLY));
	assert.equal(h.historyReads(), 1, "one read joins the rows the pane held");
});

test("a fenced page during a running turn costs the walk one read, not its whole budget", async () => {
	const liveId = "a-live-turn";
	let older = 0;
	const h = await fencedMount({
		frames: () => {
			const frame = fenceSnapshot(2, FENCE_HELD_TAIL_PAGE());
			// A turn in flight: the seed paints an untimed row only while streaming.
			frame.payload.frontend.snapshot.streaming = true;
			frame.payload.frontend.snapshot.live_events = [
				{
					type: "message_update",
					message: {
						id: liveId,
						role: "assistant",
						content: [{ type: "text", text: "still writing" }],
					},
					delta: " (live delta)",
				},
			];
			return [frame];
		},
		// A long conversation: every older page is new rows, so only a page that
		// overlaps what the pane painted can stop the walk.
		history: async (request) => {
			older += 1;
			return request.beforeId
				? {
						...fencePage([fenceRow(`row-older-${older}`, "older", 0)], "G-new"),
						has_more: true,
					}
				: { ...fencePage(FENCE_SERVER_ROWS, "G-new"), has_more: true };
		},
	});
	assert.equal(h.get().hydrated, true);
	assert.ok(
		ids(h.get().transcript).includes(liveId),
		"the live seed still paints",
	);
	assert.equal(
		h.historyReads(),
		1,
		"the in-flight turn has no durable row, so it is not what the walk joins on",
	);
});

test("a walk whose read is overtaken by another generation install re-asks under the new one", async () => {
	const gate = gatedHistory();
	const h = await fencedMount({
		snapshotHistory: FENCE_HELD_TAIL_PAGE(),
		history: gate.handler,
	});
	assert.equal(h.historyReads(), 1, "the fenced page's walk is out");
	assert.equal(h.get().hydrated, false);
	// A further install lands while that read is out: a ready wake for G-newer,
	// whose repair read commits it.
	const newerRows = FENCE_SERVER_ROWS.map((row) => ({
		...row,
		payload: {
			...row.payload,
			content: [{ text: `${row.payload.content[0].text} (newer)` }],
		},
	}));
	globalThis.__replaceSnapshot = async () =>
		fenceSnapshot(9, fencePage(newerRows, "G-newer"));
	deliver(
		fenceFrame({
			epoch: BRIDGE_EPOCH,
			seq: 3,
			type: "event",
			payload: {
				type: "journal_order_ready",
				journal_generation: "G-newer",
				rows: [{ id: ROW_EARLY, journal_seq: 0 }],
			},
		}),
	);
	await pump();
	assert.equal(h.get().transcript.journalGeneration, "G-newer");
	assert.equal(h.get().hydrated, false, "the repair read is not the proof");
	// The overtaken read answers under the domain it was dispatched for.
	gate.reads[0].resolve(
		fencePage(
			[...FENCE_SERVER_ROWS, fenceRow("row-walk-old-gen", "G-new only", 3)],
			"G-new",
		),
	);
	await pump();
	assert.equal(gate.reads.length, 2, "the walk re-asked under G-newer");
	gate.reads[1].resolve(fencePage(newerRows, "G-newer"));
	await pump();
	const view = h.get();
	assert.equal(view.hydrated, true, "the pane ends hydrated");
	assert.equal(view.transcript.journalGeneration, "G-newer");
	assert.ok(
		!ids(view.transcript).includes("row-walk-old-gen"),
		"the overtaken page was never merged",
	);
	assert.equal(
		view.transcript.records.find((r) => r.id === ROW_EARLY)?.text,
		"early (newer)",
	);
});

/*
 * THE RE-ASK'S THREE GUARDS (PR #1130 review round 2, m1). A walk whose read
 * is overtaken by a generation install re-asks under the new revision only
 * while the pane is unhydrated, only inside the walk's own request budget,
 * and only after the generation/clear check has had its say. Each test below
 * is the one a refactor that loses one of those would fail.
 */
const fenceReady = (seq, generation) =>
	fenceFrame({
		epoch: BRIDGE_EPOCH,
		seq,
		type: "event",
		payload: {
			type: "journal_order_ready",
			journal_generation: generation,
			rows: [{ id: ROW_EARLY, journal_seq: 0 }],
		},
	});
/** Lands an install while a walk read is out: the wake, then its repair read. */
async function installGeneration(seq, generation) {
	globalThis.__replaceSnapshot = async () =>
		fenceSnapshot(9, fencePage(FENCE_SERVER_ROWS, generation));
	deliver(fenceReady(seq, generation));
	await pump();
}
const walkReadsFor = (sessionId) =>
	requests.filter(
		(r) =>
			r.op === "sessions.history" &&
			r.sessionId === sessionId &&
			r.sourceRead === undefined,
	).length;

test("an overtaken walk read on an already-hydrated pane is not asked again", async () => {
	// A usable same-generation page hydrates the pane, but its newest row is one
	// the pane never held, so the batch still owes a walk.
	const gate = gatedHistory();
	const h = await fencedMount({
		snapshotHistory: fencePage(
			[...FENCE_SERVER_ROWS, fenceRow("row-unheld-newest", "newest", 3)],
			"G-new",
		),
		history: gate.handler,
	});
	assert.equal(h.get().hydrated, true, "the applied page hydrated the pane");
	assert.equal(gate.reads.length, 1, "the walk is out");
	await installGeneration(3, "G-newer");
	assert.equal(h.get().transcript.journalGeneration, "G-newer");
	gate.reads[0].resolve(fencePage(FENCE_SERVER_ROWS, "G-new"));
	await pump();
	assert.equal(
		gate.reads.length,
		1,
		"a hydrated pane owes nothing more, so the dropped page is not re-asked",
	);
	assert.equal(h.get().hydrated, true);
});

test("generation churn inside one walk is bounded by the walk's request budget", async () => {
	const gate = gatedHistory();
	const h = await fencedMount({
		snapshotHistory: FENCE_HELD_TAIL_PAGE(),
		history: gate.handler,
	});
	assert.equal(gate.reads.length, 1, "the fenced page's walk is out");
	// Ten installs, each landing while the walk's latest read is out; each read
	// then answers under the domain it was dispatched for, and is dropped.
	for (let install = 1; install <= 10; install++) {
		await installGeneration(2 + install, `G-churn-${install}`);
		const open = gate.reads.at(-1);
		if (open.answered) break;
		open.answered = true;
		open.resolve(fencePage(FENCE_SERVER_ROWS, `G-churn-${install - 1}`));
		await pump();
	}
	assert.equal(
		gate.reads.length,
		RECONCILE_WALK_MAX_REQUESTS,
		"each re-ask is charged to the walk's own budget, so churn stops there",
	);
	assert.equal(h.get().historyReadPending, false, "and the walk has ended");
	assert.equal(h.get().status, "live");
});

for (const [mode, nextSession] of [
	["a switch to another conversation", OTHER_SESSION],
	["an unmount", undefined],
]) {
	test(`no stale /history read after ${mode} while an overtaken walk read is out`, async () => {
		const gate = gatedHistory();
		const h = await fencedMount({
			snapshotHistory: FENCE_HELD_TAIL_PAGE(),
			history: gate.handler,
		});
		assert.equal(walkReadsFor(FENCE_SESSION), 1, "the walk is out");
		await installGeneration(3, "G-switched");
		h.switchTo(nextSession);
		await pump();
		const before = walkReadsFor(FENCE_SESSION);
		gate.reads[0].resolve(fencePage(FENCE_SERVER_ROWS, "G-new"));
		await pump();
		assert.equal(
			walkReadsFor(FENCE_SESSION),
			before,
			"the pane this walk was for is gone, so its read is not asked again",
		);
	});
}
