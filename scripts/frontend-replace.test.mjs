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
			export { useCanonicalSessionStream } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { acceptFrontendReplace } from "./src/shared/desktop-session-contract";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
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
	useCanonicalSessionsStore,
	acceptFrontendReplace,
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
const sourceSnapshot = (seq, domain, entries = DURABLE_ROWS) => {
	const frame = snapshotFrame(seq, `/source-${domain}`);
	frame.session_id = SOURCE_SESSION;
	frame.payload.frontend.snapshot.session_id = SOURCE_SESSION;
	frame.payload.history = sourcePage(domain, entries);
	return frame;
};
async function sourceMount() {
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	globalThis.__replaceHistory = async () => sourcePage("source-A");
	globalThis.__replaceSnapshot = async () => sourceSnapshot(9, "source-B");
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(
			SOURCE_SESSION,
			true,
			true,
			SOURCE_SESSION,
			{ journalOrder: true },
		);
		return handle;
	};
	runtime.rerender();
	deliver({ ...openFrame(1), session_id: SOURCE_SESSION });
	deliver(sourceSnapshot(2, "source-A"));
	await pump();
	return { get: () => handle };
}
const sourceReady = (seq, domain) => ({
	session_id: SOURCE_SESSION,
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
