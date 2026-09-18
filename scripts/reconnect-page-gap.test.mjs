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
	if (request.op === "sessions.history") {
		// Addressable faults, by read INDEX: a case that is about a refused read
		// has to say WHICH one, because the pre-switch-back snapshot reconciles
		// too and a count-based fault would land on the wrong read.
		const index = globalThis.__gapHistoryReads++;
		if (globalThis.__gapHistoryFaults.includes(index))
			throw new Error("history unavailable");
		return globalThis.__gapTail(request);
	}
	if (request.op === "sessions.message")
		return {
			status: "admitted",
			command_id: request.requestId,
			duplicate: false,
		};
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
			export { __resetPaintCache } from "./src/renderer/src/shared/store/paint-cache";
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
const {
	useCanonicalSessionStream,
	admitChatDraft,
	useCanonicalSessionsStore,
	__resetPaintCache,
} = hook;

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
 * `through_id=<cursor>`, so `entries` always ends at the cursor row - the
 * semantics of `local_operator.session.transcript.read_transcript_page`, whose
 * `through_id` branch stops AT that entry. A cursor refreshed at the steer
 * drain therefore bounds the page at the steer row while later rows are already
 * durable.
 */
const snapshotFrame = (
	seq,
	{ cursor, entries, liveEvents = [], streaming = true },
) => ({
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
 * The page semantics are the real reader's
 * (`local_operator.session.transcript.read_transcript_page`: a `through_id`
 * page ends AT that entry and its newest entry IS that id, `before_id` is
 * exclusive, and an unbounded read is the tail). Modelling them here rather
 * than hand-writing two pages is what makes the read COUNT an honest
 * measurement of the cost. The reader is named rather than the check that used
 * it: an earlier version of these two comments cited "this file's companion
 * probe", which is this file - a self-reference that read like a second
 * artifact and was not one.
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
	for (let i = 0; i < 4; i++)
		await new Promise((resolve) => setImmediate(resolve));
};

const ids = (transcript) => transcript.records.map((record) => record.id);

function reset({ transcript, historyFaults = [] }) {
	/*
	 * The paint cache is process-global by design — it is this WINDOW's memory of
	 * what it has shown, keyed by session — and every case in this file reuses
	 * `SESSION_A`. Left alone, one case's paint seeds the next one's first frame
	 * and the rows a claim is made about are another case's fixture. The cache
	 * ships its own reset for exactly this reason; the harness just has to own
	 * the state its own cases share.
	 */
	__resetPaintCache();
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	globalThis.__gapHistoryReads = 0;
	globalThis.__gapHistoryFaults = historyFaults;
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
	entry.payload.role === "tool"
		? `tool:${entry.payload.tool_call_id}`
		: entry.id;

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
function longConversation({ awayRows, total: declared }) {
	const rows = [];
	const total = declared ?? 150 + awayRows;
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

async function driveSwitchBack({
	plan,
	withSteer,
	tailReadsExpected,
	historyFaults = [],
}) {
	const { rows, cursor, missing } = plan;
	const transcript = makeTranscript(rows);
	// The snapshot's page is the backend's `through_id=<cursor>` read, bounded by
	// the cached cursor the steer drain refreshed.
	const page = transcript.page(cursor, SNAPSHOT_PAGE).entries;
	const pageRecords = page.map(recordIdOf);
	reset({ transcript, historyFaults });

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

/*
 * A read that can never connect must not be walked. When the batch painted
 * nothing (no entry ids from a snapshot page, no live seed), NO fetched page
 * can satisfy the connection test, so the walk's remaining turns are dead work
 * — and on the owner side each one is a full sequential pass of the transcript
 * file. Two paths reach that state, and both are asserted here on a transcript
 * long enough for a walk to run to its bound (600 rows > 5 x 100).
 */
const LONG = 600;

async function driveEmptyPainted({ frame }) {
	const plan = longConversation({ awayRows: 0, total: LONG });
	reset({ transcript: makeTranscript(plan.rows) });
	const runtime = makeRuntime();
	const sessionId = SESSION_A;
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(sessionId, Boolean(sessionId));
		return handle;
	};
	runtime.rerender();
	deliver(openFrame(1, true));
	deliver(frame);
	await pump();
	return {
		reads: requests.filter((request) => request.op === "sessions.history")
			.length,
		painted: ids(handle.transcript),
		plan,
	};
}

const attentionFrame = (seq) => ({
	session_id: SESSION_A,
	epoch: "bridge-epoch",
	seq,
	type: "attention",
	payload: {
		conversation_id: `session/${SESSION_A}`,
		completion_token: "token-1",
		anchor_id: "anchor-not-painted",
		kind: "complete",
		unseen: true,
		revision: [1, 1],
	},
});

test("an unpainted attention anchor reads one page, not a walk to the bound", async () => {
	const { reads, painted, plan } = await driveEmptyPainted({
		frame: attentionFrame(2),
	});
	assert.equal(
		reads,
		1,
		"with nothing painted the walk cannot connect, so one page is the whole read",
	);
	assert.deepEqual(
		painted,
		plan.rows.slice(-SNAPSHOT_PAGE).map(recordIdOf),
		"and that page is the durable tail, painted oldest-first",
	);
});

test("a cold snapshot's empty page reads one page, not a walk to the bound", async () => {
	const { reads, painted, plan } = await driveEmptyPainted({
		frame: snapshotFrame(2, { cursor: null, entries: [], liveEvents: [] }),
	});
	assert.equal(reads, 1, "an empty snapshot page paints nothing to connect to");
	assert.deepEqual(
		painted,
		plan.rows.slice(-SNAPSHOT_PAGE).map(recordIdOf),
		"the single page is still read: it is the rows a cold open has to show",
	);
});

/*
 * The tail read is the only thing on this side that closes the reported gap,
 * so a single refusal at the re-subscribe moment must not stand down.
 */
test("a refused tail read is retried once, and the absent rows still land", async () => {
	const plan = conversation({ withSteer: false, awayRows: 2 });
	const painted = await driveSwitchBack({
		plan,
		withSteer: false,
		// Read 0 is the first snapshot's (it reconciles too); read 1 is the
		// switch back's, which is the one this case is about.
		historyFaults: [1],
		tailReadsExpected: 2,
	});
	for (const recordId of plan.missing)
		assert.ok(
			painted.includes(recordId),
			`${recordId} lands even though its first read was refused`,
		);
});

/*
 * UX round 1, U2 — the walked defect, at the level the composer's claim is
 * decided. The walk: the backend goes down while a conversation is selected, the
 * pane shows "Could not load this conversation's history — reconnect to try
 * again." with a **Reconnect**, and pressing it makes the failure AND its action
 * vanish into "What can I help you with today?" — an unknown history painted as
 * an empty conversation.
 *
 * The composer is allowed to say a conversation is empty only when it KNOWS, and
 * `hydrated` is that knowledge. It was being granted by a snapshot whose history
 * page carried no entries: the page was applied (or rather, merged as nothing)
 * and `cursor_missing: false` was read as "the durable tail is complete". That is
 * the shape the walked session had — a minimal directory whose journal is empty
 * — and it is exactly the case the one authoritative read exists to settle.
 */
test("a snapshot's EMPTY page does not stand in for a history nobody read", async () => {
	const empty = makeTranscript([]);
	reset({ transcript: empty, historyFaults: [...Array(50).keys()] });

	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION_A, true);
		return handle;
	};
	runtime.rerender();

	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor: "r0",
			entries: [],
			liveEvents: [],
			streaming: false,
		}),
	);
	await pump();

	assert.equal(
		handle.transcript.records.length,
		0,
		"nothing is painted to claim",
	);
	assert.equal(
		handle.hydrated,
		false,
		"an empty snapshot page is not proof the conversation is empty",
	);
	assert.equal(
		handle.status,
		"live",
		"the stream itself is up; it is the read that is owed",
	);
	// The retry is scheduled rather than run: this harness owns the clock, and
	// what it asserts is the state the reader is left in while the read is owed.

	// THE CONTROL, so a fix cannot pass by never hydrating at all: a read that
	// SUCCEEDS and answers with an empty tail is authoritative, and it is what
	// lets the greeting stand.
	reset({ transcript: empty });
	const second = makeRuntime();
	let recovered;
	second.render = () => {
		recovered = useCanonicalSessionStream(SESSION_A, true);
		return recovered;
	};
	second.rerender();
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor: "r0",
			entries: [],
			liveEvents: [],
			streaming: false,
		}),
	);
	await pump();
	assert.equal(
		recovered.hydrated,
		true,
		"a read that resolved is proof, applied-or-empty alike",
	);
});

/* ------------------------------------------------- the gap, and the live rows */

/*
 * The three behaviours of a receipt gap that the audit measured, each asserted
 * on the frames the producer actually sends.
 *
 * A "gap" is the backend saying its replay window no longer covers this viewer:
 * it follows an overflowing subscriber queue, ends the response, and the client
 * reconnects into `open{gap: true}` -> replay -> snapshot. What the client does
 * with the rows it had painted is the whole of the first two cases below.
 */

/** One canonical event, on the receipt cursor. */
const eventFrame = (seq, payload) => ({
	session_id: SESSION_A,
	epoch: "bridge-epoch",
	seq,
	type: "event",
	payload,
});

/** The producer's own wire shape: `content: []` and a bare delta. */
const liveFrame = (type, id, extra = {}) => ({
	type,
	message: { id, role: "assistant", content: [] },
	...extra,
});

const historyReads = () =>
	requests.filter((request) => request.op === "sessions.history").length;

async function mount() {
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION_A, true);
		return handle;
	};
	runtime.rerender();
	return {
		row: (id) => handle.transcript.records.find((record) => record.id === id),
		ids: () => ids(handle.transcript),
		status: () => handle.status,
	};
}

test("a receipt gap keeps the answer being written, and a mid-turn join agrees with the end", async () => {
	const plan = conversation({ withSteer: false, awayRows: 0 });
	const transcript = makeTranscript(plan.rows);
	reset({ transcript });
	const panel = await mount();

	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor: plan.cursor,
			entries: transcript.page(plan.cursor, SNAPSHOT_PAGE).entries,
			liveEvents: [],
		}),
	);
	await pump();

	// The answer, streaming: one delta per arrival, the producer's own shape.
	const id = "a-inflight";
	deliver(eventFrame(3, liveFrame("message_start", id)));
	deliver(
		eventFrame(4, liveFrame("message_update", id, { delta: "The answer " })),
	);
	deliver(eventFrame(5, liveFrame("message_update", id, { delta: "so far" })));
	await pump();
	assert.equal(panel.row(id).text, "The answer so far");
	assert.ok(
		!panel.row(id).truncated,
		"a row painted from its own start holds everything that exists so far",
	);

	// The receipt breaks. The row is KEPT — dropping it is what made the answer
	// vanish and come back as its last chunk — and marked, because the frames the
	// gap swallowed may have carried deltas for it.
	deliver({ session_id: SESSION_A, type: "gap" });
	await pump();
	assert.ok(panel.row(id), "a gap must not erase the answer being written");
	assert.equal(panel.row(id).text, "The answer so far", "nor shorten it");
	assert.equal(panel.row(id).truncated, true, "it says its continuity broke");
	assert.equal(
		panel.status(),
		"reconnecting",
		"and the view is told to reconnect",
	);

	// The reconnect: `open{gap}` then the snapshot, whose seed is the owner's
	// projection of the turn in flight — the message's start plus its LATEST
	// delta. That delta cannot be placed after the text this row already holds, so
	// appending it would write a chunk the model never wrote twice.
	deliver(openFrame(9, true));
	deliver(
		snapshotFrame(10, {
			cursor: plan.cursor,
			entries: transcript.page(plan.cursor, SNAPSHOT_PAGE).entries,
			liveEvents: [
				liveFrame("message_start", id),
				liveFrame("message_update", id, { delta: "so far" }),
			],
		}),
	);
	await pump();
	assert.equal(
		panel.row(id).text,
		"The answer so far",
		"the seed's delta is not applied a second time",
	);
	assert.equal(panel.row(id).truncated, true);

	// The authoritative end: the row must agree with the producer's own assembled
	// text once it lands, and stop claiming anything is missing.
	deliver(
		eventFrame(
			11,
			liveFrame("message_end", id, {
				message: {
					id,
					role: "assistant",
					content: [{ type: "text", text: "The answer so far and the rest" }],
				},
			}),
		),
	);
	await pump();
	assert.equal(panel.row(id).text, "The answer so far and the rest");
	assert.equal(panel.row(id).streaming, false);
	assert.ok(
		!panel.row(id).truncated,
		"the authoritative text clears the claim",
	);
});

test("a snapshot whose page already reaches the painted tail costs no history read", async () => {
	/*
	 * The page's newest entry is an ASSISTANT row on purpose: a durable tool row
	 * is keyed by its call id (`tool:<call_id>`), so its entry id is not a record
	 * id and this guard cannot prove it is on screen — such a page reads, which is
	 * conservative and is the shape the next case covers.
	 */
	const rows = [
		userRow("r1", 100, "Start the turn."),
		toolRow("r2", 101, "call-1", "read", "file contents"),
		assistantRow("r3", 102, "Working on it."),
	];
	const transcript = makeTranscript(rows);
	reset({ transcript });
	const panel = await mount();

	// The journal's tail read from the journal, with the owner's published
	// watermark still behind it: `r3` is durable, and it is a row this viewer has
	// painted. The first snapshot reconciles because nothing was painted before it.
	deliver(openFrame(1, true));
	deliver(snapshotFrame(2, { cursor: "r2", entries: rows, liveEvents: [] }));
	await pump();
	assert.deepEqual(panel.ids(), rows.map(recordIdOf));
	assert.equal(historyReads(), 1, "the cold snapshot reads");

	// A reconnect in which nothing durable was missed. The page is the tail again,
	// its newest row is already on screen, and it EXTENDS PAST the published
	// cursor — which is the one thing a page read `through_id=<cursor>` can never
	// do. There is nothing between the two to fetch.
	deliver(openFrame(9, true));
	deliver(snapshotFrame(10, { cursor: "r2", entries: rows, liveEvents: [] }));
	await pump();
	assert.equal(
		historyReads(),
		1,
		"a page that reaches the painted tail is not re-read on the owner",
	);
	assert.deepEqual(panel.ids(), rows.map(recordIdOf));
});

test("a page that stops at the cursor still reads, and the read still closes the gap", async () => {
	const rows = [
		userRow("r1", 100, "Start the turn."),
		assistantRow("r2", 101, "Working on it."),
		assistantRow("r3", 102, "One more paragraph."),
	];
	const transcript = makeTranscript(rows);
	reset({ transcript });
	const panel = await mount();

	// The cursor-bounded shape: the page ends AT the owner's watermark, which is
	// the shape this read was written for and the one the skip must refuse (the
	// reader cannot tell a stale cursor from a current one when the two agree).
	deliver(openFrame(1, true));
	deliver(snapshotFrame(2, { cursor: "r3", entries: rows, liveEvents: [] }));
	await pump();
	assert.deepEqual(panel.ids(), rows.map(recordIdOf));

	// Rows written while this reader was on another conversation: they are durable
	// now, and nothing delivered to this viewer carried them.
	transcript.rows.push(
		assistantRow("r4", 103, "Row written while away."),
		toolRow("r5", 104, "call-2", "read", "more output"),
	);

	deliver(openFrame(9, true));
	deliver(snapshotFrame(10, { cursor: "r3", entries: rows, liveEvents: [] }));
	await pump();
	assert.equal(historyReads(), 2, "a page ending at the cursor is read");
	assert.deepEqual(
		panel.ids(),
		transcript.rows.map(recordIdOf),
		"and the read is what puts the rows written while away on screen",
	);
});

test("replayed events paint even when the snapshot lands in a later batch", async () => {
	const plan = conversation({ withSteer: false, awayRows: 0 });
	const transcript = makeTranscript(plan.rows);
	reset({ transcript });
	const panel = await mount();

	// The replay of one reconnect, in a batch of its own: the frames of a
	// reconnect are not obliged to arrive inside a single animation frame, and the
	// scratch state they fold into is applied at the end of the batch that carried
	// them rather than thrown away because the snapshot is in the next one.
	const id = "a-replay";
	deliver(eventFrame(1, liveFrame("message_start", id)));
	deliver(
		eventFrame(2, liveFrame("message_update", id, { delta: "replayed " })),
	);
	deliver(eventFrame(3, liveFrame("message_update", id, { delta: "text" })));
	await pump();
	assert.ok(panel.row(id), "the replayed turn is painted in its own batch");
	assert.equal(
		panel.row(id).text,
		"replayed text",
		"in arrival order, with nothing dropped at the batch boundary",
	);

	// The snapshot follows in the next batch and is still the authority: the
	// durable page wins by id, and the seed's delta is not applied twice.
	deliver(openFrame(4, false));
	deliver(
		snapshotFrame(5, {
			cursor: plan.cursor,
			entries: transcript.page(plan.cursor, SNAPSHOT_PAGE).entries,
			liveEvents: [liveFrame("message_update", id, { delta: "text" })],
		}),
	);
	await pump();
	assert.ok(panel.row(id), "the row survives the snapshot that follows it");
	assert.equal(
		panel.row(id).text,
		"replayed text",
		"and is not doubled by the seed",
	);
});
