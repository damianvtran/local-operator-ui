import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Rows written while the user is on another conversation do not load when they
 * switch back, whenever the re-subscribe snapshot's history page stops short of
 * the durable tail.
 *
 * WHY THIS FILE EXISTS. The reported repro is: a turn is in flight in
 * conversation A, the user steers it, switches to B, and switches back; every
 * row written after the steering message is absent, and only rows that arrive
 * after the return paint. The steering is not the cause - it is what REFRESHES
 * the backend's cached `history_cursor`, so the snapshot's page (which is read
 * `through_id=<that cursor>`) ends at the steer row while the rows after it are
 * already durable. A page like that is non-empty and reports
 * `cursor_missing: false`, which is exactly the shape the client treats as
 * complete (`use-canonical-session.ts`, the flush loop's `needsReconcile`).
 *
 * So this file drives the REAL hook through the real frame sequence:
 * `open` -> `snapshot` (short page + live seed) -> the store's steer admission
 * -> switch away -> switch back -> `open` -> `snapshot` (short page again).
 * Assertions are on transcript CONTENT (ids, order, no duplicates), never on a
 * helper's return value. React's scheduler, the transport and the clock are the
 * only substitutions; the reducer, the hook's flush loop and the store are the
 * shipped modules.
 *
 * The second case drops the steer entirely: a plain background turn produces
 * the same gap, which is what proves the steer incidental.
 */

// `zustand/middleware` reaches for localStorage at import time.
const store = new Map();
globalThis.localStorage = {
	getItem: (key) => store.get(key) ?? null,
	setItem: (key, value) => store.set(key, value),
	removeItem: (key) => store.delete(key),
};

/* ----------------------------------------------------------------- the clock */

/*
 * Animation frames and the hidden-window fallback timer are the hook's two
 * flush triggers. Both are taken over so a flush happens when the test says so
 * and never on a wall clock: `pump()` drains what `deliver()` scheduled.
 */
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
	// The hook only ever CLEARS this fallback; scheduling it for real would let
	// a wall-clock flush race the assertions.
	setTimeout: () => {
		fallbackSeq += 1;
		return fallbackSeq;
	},
	clearTimeout: () => {},
};

/* ------------------------------------------------------------- the transport */

const subscriptions = [];
const requests = [];

globalThis.__gapSubscribe = (args, onEvent) => {
	const entry = { args, onEvent, disposed: false };
	subscriptions.push(entry);
	return () => {
		entry.disposed = true;
	};
};
globalThis.__gapRequest = async (request) => {
	requests.push(request);
	if (request.op === "sessions.history") return globalThis.__gapTail(request);
	if (request.op === "sessions.message")
		return { status: "admitted", command_id: request.requestId, duplicate: false };
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
			export { admitChatDraft, useCanonicalSessionsStore, draftIdentityFor } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
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
			name: "reconnect-page-gap-fixture",
			setup(builder) {
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "gap-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "gap-fixture" }, () => ({
					contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__gapRequest(request);
						export const subscribeDesktopStream = (args, onEvent) => globalThis.__gapSubscribe(args, onEvent);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "gap-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "gap-react" }, () => ({
					contents: reactStandIn,
					loader: "js",
				}));
			},
		},
	],
});
const hook = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { useCanonicalSessionStream, admitChatDraft, useCanonicalSessionsStore } = hook;

const SESSION_A = "aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbbbbbb";

/* ------------------------------------------- the React stand-in (one cell per call) */

/*
 * The same cell-based stand-in the composer cases in `echo-delivery.test.mjs`
 * use: one cell per hook call, a setter that re-renders, dep-gated effects, and
 * the value each closure sees. It models what the claims rest on. It does NOT
 * model React's scheduler, batching or commit timing - which is why nothing
 * here asserts on a FRAME, only on transcript state after a stated sequence.
 */
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
					const next =
						typeof value === "function" ? value(cell.state) : value;
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

const row = (id, ts, payload) => ({ id, ts, type: "message", payload });

/** A durable user row, as the backend's `exclude_defaults` encoder writes one. */
const userRow = (id, ts, text) =>
	row(id, ts, {
		kind: "message",
		role: "user",
		content: [{ text }],
	});

/** A durable assistant row: prose, so it paints. */
const assistantRow = (id, ts, text) =>
	row(id, ts, {
		kind: "message",
		role: "assistant",
		content: [{ text }],
		stop_reason: "stop",
	});

/** A durable tool row: keyed by call id, not by entry id. */
const toolRow = (id, ts, callId, toolName, output) =>
	row(id, ts, {
		kind: "message",
		role: "tool",
		tool_call_id: callId,
		tool_name: toolName,
		content: [{ text: output }],
		provider_payload: { duration_s: 0.1 },
	});

const openFrame = (seq, gap) => ({
	session_id: SESSION_A,
	epoch: "bridge-epoch",
	seq,
	type: "open",
	payload: { subscription_id: `sub-${seq}`, gap, watch_ttl_seconds: 45 },
});

/**
 * A re-subscribe snapshot.
 *
 * `cursor` is the backend's CACHED `history_cursor` and the page is read
 * `through_id=<cursor>`, so `entries` always ends at the cursor row
 * (proved against the real reader: scripts/reconnect-page-gap.test.mjs's
 * companion probe). A cursor refreshed at the steer drain therefore bounds the
 * page at the steer row while later rows are already durable.
 */
const snapshotFrame = (seq, { cursor, entries, liveEvents = [], streaming = true }) => ({
	session_id: SESSION_A,
	epoch: "bridge-epoch",
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch: "owner-epoch",
			sequence: seq,
			live_cursor: cursor,
			snapshot: {
				epoch: "owner-epoch",
				sequence: seq,
				cwd: "/tmp/probe",
				conversation_title: "Conversation A",
				conversation_title_user_set: true,
				conversation_title_forked: false,
				goal: "",
				active_agent: "",
				active_team: "",
				selected_model: null,
				effective_model: null,
				streaming,
				generation: 4,
				pending_gate: null,
				history_cursor: cursor,
				live_events: liveEvents,
				queued_steering: [],
				jobs: [],
				todos: [],
				wakes: [],
				mcp_servers: [],
				model_catalogue: [],
				context_tokens: null,
				context_is_estimate: null,
				context_window: null,
				context_breakdown: null,
				cumulative_parent_cost: null,
				subagent_cost: null,
				cost_knowledge: "unknown",
				last_usage: null,
				attention: null,
			},
		},
		history: { entries, has_more: true, cursor_missing: false },
		cold: false,
	},
});

/**
 * A transcript that answers the way the backend's reader does.
 *
 * The page semantics are the real ones, verified against the real reader
 * (`local_operator.session.transcript.read_transcript_page`) in
 * `scripts/reconnect-page-gap.test.mjs`'s companion probe: a `through_id` page
 * ends AT that entry and its newest entry IS that id, and an unbounded read is
 * the tail. Modelling them here rather than hand-writing two pages is what
 * makes the read COUNT an honest measurement of the cost.
 */
function makeTranscript(rows) {
	const indexOf = (id) => rows.findIndex((entry) => entry.id === id);
	return {
		rows,
		/** `through_id` page: ends at that entry, `has_more` when older rows exist. */
		page(throughId, limit) {
			const end = indexOf(throughId);
			if (end < 0)
				return { entries: [], has_more: false, cursor_missing: true };
			const start = Math.max(0, end - limit + 1);
			return {
				entries: rows.slice(start, end + 1),
				has_more: start > 0,
				cursor_missing: false,
			};
		},
		/** `before_id` page: the rows immediately older than that entry. */
		pageBefore(beforeId, limit) {
			const end = indexOf(beforeId);
			if (end < 0) return this.tail(limit);
			const start = Math.max(0, end - limit);
			return {
				entries: rows.slice(start, end),
				has_more: start > 0,
				cursor_missing: false,
			};
		},
		/** The unbounded tail: what `GET .../history` without a cursor returns. */
		tail(limit) {
			const start = Math.max(0, rows.length - limit);
			return {
				entries: rows.slice(start),
				has_more: start > 0,
				cursor_missing: false,
			};
		},
	};
}

/** One live assistant row, as the seed and the relay carry it. */
const liveAssistant = (id, text) => ({
	type: "message_update",
	message: { id, role: "assistant", content: [{ type: "text", text }] },
	delta: " (live delta)",
});

function deliver(frame) {
	const active = subscriptions.filter((entry) => !entry.disposed).at(-1);
	assert.ok(active, "no live subscription to deliver to");
	active.onEvent({ kind: "data", data: JSON.stringify(frame) });
}

/** Drain every scheduled flush, then let the async reconcile settle. */
async function pump() {
	for (let pass = 0; pass < 20 && rafQueue.length > 0; pass++) {
		const callbacks = rafQueue;
		rafQueue = [];
		for (const callback of callbacks) callback();
		await settle();
	}
	await settle();
}

const settle = async () => {
	for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
};

const ids = (transcript) => transcript.records.map((record) => record.id);

function reset({ transcript }) {
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	globalThis.__gapTail = (request) =>
		request.beforeId === undefined
			? transcript.tail(request.limit)
			: transcript.pageBefore(request.beforeId, request.limit);
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});
}

/* -------------------------------------------------------------- the timeline */

/*
 * The durable rows, oldest first. `page` is what the re-subscribe snapshot
 * carries (the last `SNAPSHOT_PAGE` rows up to the cursor); `missing` is what
 * was written while the reader was away and is therefore absent from it.
 */
const SNAPSHOT_PAGE = 100;

/**
 * A durable TOOL row keys by call id, not by entry id: the reducer mints
 * `tool:<call_id>` so the live start/end for the same call coalesce onto it.
 * Asserting on entry ids alone would look for a row that never exists.
 */
const recordIdOf = (entry) =>
	entry.payload.role === "tool" ? `tool:${entry.payload.tool_call_id}` : entry.id;

/** The reported shape: a short conversation whose steer row is the page's end. */
function conversation({ withSteer, awayRows = 2 }) {
	const rows = [
		userRow("r1", 100, "Start the turn."),
		assistantRow("r2", 101, "Working on it."),
		toolRow("r3", 102, "call-1", "read", "file contents"),
	];
	if (withSteer) {
		// The steer's own durable row, and the cursor the drain refreshed.
		rows.push(userRow("r4", 103, "stop and check X first"));
	}
	let ts = 104;
	for (let i = 0; i < awayRows; i++) {
		const id = `away-${i}`;
		rows.push(
			i % 2 === 0
				? assistantRow(id, ts, `Row ${i} written while away.`)
				: toolRow(id, ts, `call-away-${i}`, "read", `output ${i}`),
		);
		ts += 1;
	}
	const pageEnd = rows.length - awayRows;
	return {
		rows,
		cursor: rows[pageEnd - 1].id,
		missing: rows.slice(pageEnd).map(recordIdOf),
	};
}

/**
 * An absence wider than one history page: the snapshot's page and the first
 * unbounded read do not overlap, so the guard must walk back before it can
 * prove the two pages connect.
 */
function longConversation({ awayRows }) {
	const rows = [];
	const total = 150 + awayRows;
	for (let i = 1; i <= total; i++) {
		rows.push(
			i % 3 === 1
				? userRow(`r${i}`, 100 + i, `User row ${i}`)
				: i % 3 === 2
					? assistantRow(`r${i}`, 100 + i, `Assistant row ${i}`)
					: toolRow(`r${i}`, 100 + i, `call-${i}`, "read", `output ${i}`),
		);
	}
	const pageEnd = rows.length - awayRows;
	return {
		rows,
		cursor: rows[pageEnd - 1].id,
		missing: rows.slice(pageEnd).map(recordIdOf),
	};
}

async function driveSwitchBack({ plan, withSteer, tailReadsExpected }) {
	const { rows, cursor, missing } = plan;
	const transcript = makeTranscript(rows);
	// The snapshot's page is the backend's `through_id=<cursor>` read, bounded by
	// the cached cursor the steer drain refreshed.
	const page = transcript.page(cursor, SNAPSHOT_PAGE).entries;
	const pageRecords = page.map(recordIdOf);
	reset({ transcript });

	const runtime = makeRuntime();
	let sessionId = SESSION_A;
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(sessionId, Boolean(sessionId));
		return handle;
	};
	runtime.rerender();
	assert.equal(subscriptions.length, 1, "the panel subscribes on mount");

	// The turn in flight in conversation A: the page, then the live tail.
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor,
			entries: page,
			liveEvents: [liveAssistant("live-1", "first live row")],
		}),
	);
	await pump();
	assert.deepEqual(
		ids(handle.transcript).filter((id) => pageRecords.includes(id)),
		[...pageRecords],
		"the in-flight snapshot paints its page",
	);

	if (withSteer) {
		// The steer submission, through the shipped store path: it paints the
		// optimistic echo and lands the receipt.
		const key = hook.draftIdentityFor(null, SESSION_A);
		await admitChatDraft(
			key,
			{
				text: "stop and check X first",
				attachments: [],
				images: [],
				mode: "steer",
				cwd: "/tmp/probe",
			},
			SESSION_A,
		);
		runtime.rerender();
		await pump();
		assert.ok(
			requests.some((request) => request.op === "sessions.message"),
			"the steer is submitted as a message admission",
		);
	}

	// Switch away: the panel's identity changes, so the stream is torn down.
	sessionId = SESSION_B;
	runtime.rerender();
	await pump();
	assert.equal(
		subscriptions[0].disposed,
		true,
		"switching away closes the stream for the conversation left behind",
	);
	assert.equal(
		subscriptions.filter((entry) => !entry.disposed).length,
		1,
		"and the panel opens the one for the conversation now on screen",
	);

	// The rows the turn wrote while the viewer was away (`missing`) are durable
	// on the backend now; nothing is delivered to this client, which has no
	// stream for the conversation.

	// Switch back: a fresh subscription and a fresh snapshot, whose page is
	// bounded by the cached cursor and therefore stops at `page`'s last row.
	const readsBeforeReturn = requests.filter(
		(request) => request.op === "sessions.history",
	).length;
	sessionId = SESSION_A;
	runtime.rerender();
	deliver(openFrame(9, true));
	deliver(
		snapshotFrame(10, {
			cursor,
			entries: page,
			liveEvents: [liveAssistant("live-2", "back on another conversation")],
		}),
	);
	await pump();

	const painted = ids(handle.transcript);
	// One durability-insensitive assertion per case, so a fix cannot pass by
	// dropping rows elsewhere.
	for (const recordId of pageRecords)
		assert.ok(painted.includes(recordId), `${recordId} is painted`);
	assert.ok(painted.includes("live-2"), "the post-return live row is painted");
	assert.deepEqual(
		missing.filter((id) => painted.includes(id)),
		missing,
		`rows written while the user was away must load on the way back (missing: ${missing.join(", ")}; painted: ${painted.join(", ")})`,
	);
	assert.equal(
		new Set(painted).size,
		painted.length,
		"the merge must not duplicate a row",
	);
	assert.equal(
		requests.filter((request) => request.op === "sessions.history").length -
			readsBeforeReturn,
		tailReadsExpected,
		"the tail reads this switch back costs are the accepted cost",
	);
	return painted;
}

test("a steer whose rows land while the user is on another conversation are missing on the way back", async () => {
	await driveSwitchBack({
		plan: conversation({ withSteer: true, awayRows: 2 }),
		withSteer: true,
		tailReadsExpected: 1,
	});
});

test("a plain background turn loses its rows the same way, with no steer involved", async () => {
	await driveSwitchBack({
		plan: conversation({ withSteer: false, awayRows: 2 }),
		withSteer: false,
		tailReadsExpected: 1,
	});
});

test("an absence wider than one history page is closed by walking back, once per page", async () => {
	const painted = await driveSwitchBack({
		plan: longConversation({ awayRows: SNAPSHOT_PAGE }),
		withSteer: false,
		// The first unbounded read returns the absent window only and cannot
		// reach the snapshot's page, so the guard reads the page behind it too.
		tailReadsExpected: 2,
	});
	assert.equal(
		new Set(painted).size,
		painted.length,
		"a walked-back reconcile must not duplicate a row",
	);
});
