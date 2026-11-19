import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The context reading across a reconnect, driven through the REAL hook.
 *
 * WHY THIS FILE EXISTS. The strip paints ONE number, but a session has two
 * legitimate sources for it: the live owner's state, and the durable journal a
 * COLD facade reads (the newest receipt persisted in `transcript.jsonl`) or an
 * ATTACHING facade still serves while its sync is in flight. The second is
 * honest and is what a first open should paint; it is not, however, a statement
 * about the current turn. Messages reach the journal at the owner's own
 * boundaries, so during a turn the journal can hold the length the conversation
 * had at an EARLIER MESSAGE while the live reading has moved on.
 *
 * A reconnect that lands in that window used to replace the painted reading
 * with the journal's, so a long conversation's context number stepped
 * BACKWARDS and then forward again on the next owner frame - the operator's
 * flicker. `subordinateOccupancy` is the rule that stops it: a cold/attaching
 * snapshot may not lower a painted measured reading, may not blank it, and may
 * still raise it (another viewer's turns already durable) - while a snapshot
 * from an ATTACHED owner and every `frontend.update` keep their own authority,
 * because a compaction legitimately SHRINKS the number.
 *
 * HOW. The same harness `scripts/frontend-replace.test.mjs` uses: the shipped
 * hook, store and reducer, a cell-based React stand-in, a stubbed transport and
 * a drained frame queue. Assertions are on the handle the hook returns after a
 * stated frame sequence, never on a helper's return value, so a snapshot that
 * arrives and is then quietly undone by a later branch still fails here.
 */

// `zustand/middleware` reaches for localStorage at import time.
const DESKTOP_API_FILTER = /local-operator\/desktop-api$/;
const ANY_FILE_FILTER = /.*/;
const REACT_FILTER = /^react$/;

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
				builder.onResolve({ filter: DESKTOP_API_FILTER }, () => ({
					path: "transport",
					namespace: "replace-fixture",
				}));
				builder.onLoad(
					{ filter: ANY_FILE_FILTER, namespace: "replace-fixture" },
					() => ({
						contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__replaceRequest(request);
						export const subscribeDesktopStream = (args, onEvent) => globalThis.__replaceSubscribe(args, onEvent);`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
				builder.onResolve({ filter: REACT_FILTER }, () => ({
					path: "react",
					namespace: "replace-react",
				}));
				builder.onLoad(
					{ filter: ANY_FILE_FILTER, namespace: "replace-react" },
					() => ({
						contents: reactStandIn,
						loader: "js",
					}),
				);
			},
		},
	],
});
const { useCanonicalSessionStream, useCanonicalSessionsStore } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "aaaaaaaaaaaa";
const _OTHER_SESSION = "bbbbbbbbbbbb";

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
	contextTokens = 100000,
	window = 1_000_000,
	estimate = false,
	lastUsage = null,
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
	context_tokens: contextTokens,
	context_window: window,
	context_is_estimate: estimate,
	context_breakdown: null,
	last_usage: lastUsage,
});

const openFrame = (seq) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "open",
	payload: { subscription_id: `sub-${seq}`, gap: false, watch_ttl_seconds: 45 },
});

const snapshotFrame = (
	seq,
	cwd,
	contextTokens = 100000,
	ownerSequence = 1,
) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch: OWNER_EPOCH,
			sequence: ownerSequence,
			live_cursor: ROW_LATER,
			snapshot: frontendState({ cwd, sequence: ownerSequence, contextTokens }),
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
const _replaceFrame = (
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
const _unchangedDeltaFrame = (seq, cwd) => ({
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
const _nextOwnerDeltaFrame = (seq, cwd) => ({
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

/**
 * A snapshot from a facade that is still serving the DURABLE journal.
 *
 * `cold` is a session with no owner to ask; `attaching` is the window in which
 * one exists but its sync has not landed (`utils/desktop_sessions.py`). Both
 * carry the newest receipt persisted in the transcript, which during a turn is
 * the length the conversation had at an earlier message.
 */
const coldSnapshotFrame = (
	seq,
	contextTokens,
	{
		cold = true,
		attaching = false,
		epoch = "cold-3",
		ownerSequence = 0,
		lastUsage = null,
	} = {},
) => ({
	session_id: SESSION,
	epoch: "bridge-2",
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch,
			sequence: ownerSequence,
			live_cursor: ROW_LATER,
			snapshot: frontendState({
				cwd: "/old",
				sequence: ownerSequence,
				contextTokens,
				epoch,
				lastUsage,
			}),
		},
		history: { entries: DURABLE_ROWS, has_more: false, cursor_missing: false },
		cold,
		attaching,
	},
});

/** The owner's own delta: same epoch, the next sequence. */
const updateFrame = (seq, ownerSequence, contextTokens, lastUsage = null) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.update",
	payload: {
		epoch: OWNER_EPOCH,
		sequence: ownerSequence,
		changes: {
			context_tokens: contextTokens,
			...(lastUsage ? { last_usage: lastUsage } : {}),
		},
		job_trajectory_appends: {},
		job_trajectory_replacements: [],
	},
});

/**
 * An accepted move's own repaint (`frontend.replace`). It can be published from
 * the cold/attaching window, and its occupancy is the durable reading.
 */
const replaceFrame = (
	seq,
	{
		cwd = "/new",
		epoch = BRIDGE_EPOCH,
		ownerSequence = 1,
		cold = true,
		contextTokens = 100000,
	} = {},
) => ({
	session_id: SESSION,
	epoch,
	seq,
	type: "frontend.replace",
	payload: {
		frontend: {
			state_version: 1,
			epoch: OWNER_EPOCH,
			sequence: ownerSequence,
			live_cursor: ROW_LATER,
			snapshot: frontendState({ cwd, sequence: ownerSequence, contextTokens }),
		},
		cold,
	},
});

/** A receipt gap: the painted frontend is dropped and held for the replacement. */
const gapFrame = () => ({ session_id: SESSION, type: "gap" });

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

const _ids = (transcript) => transcript.records.map((record) => record.id);

/**
 * Mount the shipped hook on a session, deliver `frames` in order, and hand back
 * the handle the hook returned.
 *
 * A fresh mount per case, because the acceptance rule is about ONE
 * subscription's cursor: reusing a handle would carry a cursor across cases and
 * make every "duplicate" assertion pass for the wrong reason.
 */
async function run(cwdAtSnapshot, frames, { prepaint = true } = {}) {
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
	if (prepaint) deliver(snapshotFrame(seq++, cwdAtSnapshot));
	await pump();
	for (const frame of frames) deliver(frame);
	await pump();
	return handle;
}

test("a reconnect's cold snapshot does not walk the reading back", async () => {
	const handle = await run("/old", [
		updateFrame(3, 6, 150000),
		gapFrame(),
		coldSnapshotFrame(4, 100000),
	]);
	assert.equal(
		handle.frontend?.context_tokens,
		150000,
		"the journal's older receipt must not repaint the live reading",
	);
	// The number is real but not current, so the strip's copy must qualify it.
	assert.equal(handle.contextCarried, true);
});

test("the same holds while the facade is still attaching", async () => {
	const handle = await run("/old", [
		updateFrame(3, 6, 150000),
		gapFrame(),
		coldSnapshotFrame(4, 100000, { cold: true, attaching: true }),
	]);
	assert.equal(handle.frontend?.context_tokens, 150000);
});

test("the carried reading keeps its own receipt, and null when it has none", async () => {
	const receipt = {
		input_tokens: 150000,
		output_tokens: 10,
		context_tokens: 150000,
	};
	const handle = await run("/old", [
		updateFrame(3, 6, 150000, receipt),
		gapFrame(),
		coldSnapshotFrame(4, 100000),
	]);
	assert.equal(handle.frontend?.context_tokens, 150000);
	assert.deepEqual(
		handle.frontend?.last_usage,
		receipt,
		"a carried numerator is stated with the receipt it was measured with",
	);

	// The other half of the name: with no painted receipt, the carried reading
	// pairs with NULL rather than adopting the cold snapshot's receipt, which
	// would state one reading two ways.
	const bare = await run("/old", [
		updateFrame(3, 6, 150000),
		gapFrame(),
		coldSnapshotFrame(4, 100000, {
			lastUsage: {
				input_tokens: 100000,
				output_tokens: 5,
				context_tokens: 100000,
			},
		}),
	]);
	assert.equal(bare.frontend?.context_tokens, 150000);
	assert.equal(bare.frontend?.last_usage, null);
});

test("a journal reading that is genuinely newer still raises it", async () => {
	// Another viewer worked this conversation while this pane was away, so the
	// journal is AHEAD. Subordinate is not "ignore": the higher reading wins.
	const handle = await run("/old", [
		updateFrame(3, 6, 100000),
		gapFrame(),
		coldSnapshotFrame(4, 120000),
	]);
	assert.equal(handle.frontend?.context_tokens, 120000);
});

test("a cold snapshot with no reading keeps the painted one rather than blanking", async () => {
	const handle = await run("/old", [
		updateFrame(3, 6, 150000),
		gapFrame(),
		coldSnapshotFrame(4, null),
	]);
	assert.equal(
		handle.frontend?.context_tokens,
		150000,
		"unknown is not a reason to erase the last measured value",
	);
});

test("a snapshot from an ATTACHED owner may lower it: a compaction shrinks", async () => {
	const handle = await run("/old", [
		updateFrame(3, 6, 150000),
		gapFrame(),
		snapshotFrame(4, "/old", 100000, 7),
	]);
	assert.equal(
		handle.frontend?.context_tokens,
		100000,
		"the owner's own snapshot is authoritative, shrink included",
	);
});

test("a cold frontend.replace does not walk the reading back either", async () => {
	const handle = await run("/old", [
		updateFrame(3, 6, 150000),
		replaceFrame(4, { contextTokens: 100000 }),
	]);
	assert.equal(
		handle.frontend?.context_tokens,
		150000,
		"a replacement published from the cold window carries the durable reading",
	);
	assert.equal(handle.frontend?.cwd, "/new", "and it still applies the move");
});

test("an owner delta may lower it for the same reason", async () => {
	const handle = await run("/old", [
		updateFrame(3, 6, 150000),
		updateFrame(4, 7, 90000),
	]);
	assert.equal(handle.frontend?.context_tokens, 90000);
	assert.equal(
		handle.contextCarried,
		false,
		"the owner's delta ends the qualification",
	);
});

test("the first snapshot still paints the journal reading a cold open has", async () => {
	const handle = await run(
		"/old",
		[coldSnapshotFrame(3, 100000, { epoch: undefined })],
		{ prepaint: false },
	);
	assert.equal(
		handle.frontend?.context_tokens,
		100000,
		"nothing was painted before it, so there is nothing to hold",
	);
	assert.equal(
		handle.contextCarried,
		false,
		"a first-open reading is not carried",
	);
});
