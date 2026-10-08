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
 *
 * A THIRD SHAPE SITS AT THE FOOT OF THIS FILE (#876): the reopen whose cached
 * block sits hours BEHIND a journal-tail page. The seam there is behind the
 * page rather than in front of it, the page itself is correct, and the cases
 * assert the reads the closure costs beside the rows it must produce — see
 * their own block comment.
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
globalThis.__gapTimers = [];
globalThis.__gapTimerCallbacks = [];
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
	setTimeout: (_callback, delay) => {
		fallbackSeq += 1;
		// Kept so a case can ask whether a retry was SCHEDULED (never fired).
		globalThis.__gapTimers.push(delay);
		globalThis.__gapTimerCallbacks.push(_callback);
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
			export { EMPTY_TRANSCRIPT, appendPendingUser, applyEvent, applyHistoryPage, sealDisjointBlock } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export { paintPendingSend } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { __resetPaintCache } from "./src/renderer/src/shared/store/paint-cache";
			export { __resetPendingSends, __resetLabelGapBookkeeping } from "./src/renderer/src/shared/hooks/use-canonical-session";
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
	__resetPendingSends,
	__resetLabelGapBookkeeping,
	EMPTY_TRANSCRIPT,
	appendPendingUser,
	applyEvent,
	applyHistoryPage,
	sealDisjointBlock,
	paintPendingSend,
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
	{
		cursor,
		entries,
		liveEvents = [],
		streaming = true,
		coldReason,
		hasMore = true,
	},
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
		history: { entries, has_more: hasMore, cursor_missing: false },
		cold: false,
		/*
		 * Absent unless a case names it: an older backend sends no token, and the
		 * cases above are about exactly that owner (a page cut at the cursor).
		 */
		...(coldReason === undefined ? {} : { cold_reason: coldReason }),
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
	/*
	 * The SEND registry is module state for the same reason, and one case in
	 * this file stages a steer through `admitChatDraft`. Left alone, that row is
	 * retained (the owner never paints its id in these fixtures) and the next
	 * case's mount drains it into a transcript whose assertions are about THIS
	 * file's rows. The registry ships its own reset for the same reason the
	 * cache does.
	 */
	__resetPendingSends();
	/*
	 * The label read's attempt budget is the session-keyed `labelGaps` map (a
	 * module-level Map holding `attempts: Map<callId, n>`), so a case that settles
	 * a call id another case already asked for would spend no read at all. It
	 * ships its own reset, for the same reason the two above do.
	 */
	__resetLabelGapBookkeeping();
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	globalThis.__gapTimers = [];
	globalThis.__gapTimerCallbacks = [];
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

async function mount(sessionIdOf = () => SESSION_A) {
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(sessionIdOf(), true);
		return handle;
	};
	runtime.rerender();
	return {
		/*
		 * The handle ITSELF, for a case about a published field rather than about
		 * rows. The three accessors beside it exist because most of this file
		 * asserts on transcript CONTENT; a case about the state the composer reads
		 * is about the object the panel hands it, so it takes the object.
		 */
		handle: () => handle,
		row: (id) => handle.transcript.records.find((record) => record.id === id),
		ids: () => ids(handle.transcript),
		status: () => handle.status,
		/*
		 * What the composer's readings row is handed, by the SAME expression
		 * `chat-page.tsx` uses: the live snapshot when there is one, and the held
		 * copy otherwise. Asserting on this rather than on `heldFrontend` alone is
		 * the point of the cases at the foot of this file - the claim is about what
		 * reaches the reader, and a hold that nothing reads would satisfy the field
		 * while the strip still rendered nothing.
		 */
		readings: () => handle.frontend ?? handle.heldFrontend,
		/*
		 * The panel's own render, for the session-change case: the id is an
		 * ARGUMENT to the hook, so the only way to change it is to render again the
		 * way the keyed panel does. `mount` takes it as a getter for exactly this
		 * case; every other case keeps the default and never re-renders.
		 */
		rerender: () => runtime.rerender(),
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
	assert.equal(
		panel.row(id).truncated,
		"interrupted",
		"it says its continuity broke",
	);
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
	assert.equal(panel.row(id).truncated, "interrupted");

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

/*
 * B-F9: THE DUPLICATE PAGE. A backend that stamps `cold_reason` on its snapshot
 * (local-operator 93542f91 and later, which descends from the b25ee8b4 fix that
 * reads the page from the journal's tail) serves a page that IS the tail by
 * contract, so the `/history` read every open used to follow it with was the
 * same 100 rows a second time, serially, before first paint. The first case is
 * the saving; the second is its edge - an EMPTY page still reads, whatever the
 * token says, because empty is the contract's "reconcile through /history".
 */
test("a journal-tail snapshot is painted from its own page, with no /history read", async () => {
	const rows = [
		userRow("r1", 100, "Start the turn."),
		assistantRow("r2", 101, "Working on it."),
		assistantRow("r3", 102, "One more paragraph."),
	];
	reset({ transcript: makeTranscript(rows) });
	const panel = await mount();

	// A cold open with NOTHING painted yet, the case that always read before:
	// the cursor even agrees with the newest row, the shape the cut-at-cursor
	// guard refuses on an older backend.
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor: "r3",
			entries: rows,
			liveEvents: [],
			coldReason: "no-runtime",
		}),
	);
	await pump();
	assert.deepEqual(panel.ids(), rows.map(recordIdOf));
	assert.equal(historyReads(), 0, "the snapshot's own page is the tail");
});

/*
 * THE LIVE OWNER, which is the case the duplicate is actually paid in (agent
 * review round 1, F2). A live owner's snapshot carries `cold_reason: null`: the
 * backend merges `_cold_fields()` into every snapshot and that field is only a
 * string when the facade is cold. A cold facade's page is EMPTY today, so the
 * live owner is the one frame shape with a non-empty tail page - and a predicate
 * that tested `typeof cold_reason === "string"` refused exactly it. The key's
 * PRESENCE is the version probe; `null` must skip the read the same as a token.
 */
test("a live owner's snapshot (cold_reason: null) is painted from its own page, with no /history read", async () => {
	const rows = [
		userRow("r1", 100, "Start the turn."),
		assistantRow("r2", 101, "Working on it."),
		assistantRow("r3", 102, "One more paragraph."),
	];
	reset({ transcript: makeTranscript(rows) });
	const panel = await mount();
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor: "r3",
			entries: rows,
			liveEvents: [],
			coldReason: null,
		}),
	);
	await pump();
	assert.deepEqual(panel.ids(), rows.map(recordIdOf));
	assert.equal(
		historyReads(),
		0,
		"a null cold_reason still proves a journal-tail backend",
	);
});

test("an empty journal-tail snapshot still reads its one page", async () => {
	const rows = [
		userRow("r1", 100, "Start the turn."),
		assistantRow("r2", 101, "Working on it."),
	];
	reset({ transcript: makeTranscript(rows) });
	const panel = await mount();
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor: null,
			entries: [],
			liveEvents: [],
			coldReason: "no-runtime",
		}),
	);
	await pump();
	assert.equal(historyReads(), 1, "empty means reconcile through /history");
	assert.deepEqual(panel.ids(), rows.map(recordIdOf));
});

/*
 * #876: THE REOPEN WHOSE CACHED BLOCK SITS BEHIND THE JOURNAL-TAIL PAGE.
 *
 * The reported session: this window had shown the conversation (its paint
 * cache held the rows up to record N), the reader spent hours elsewhere while
 * the conversation advanced (N+1.. became durable), and the return arrived as
 * a journal-tail snapshot — `cold_reason` present, the page read from the
 * journal's tail, its newest row past the published cursor. The page is
 * correct and the cache is correct, and the hours between them were neither:
 * the gate deferred the reconcile ("the page IS the journal tail") without
 * asking whether the page CONNECTS to what the pane holds, and the read that
 * would have closed the seam never happened.
 *
 * The driver below runs that sequence through the shipped hook: open, paint,
 * leave (the unmount is what writes the paint), advance, return. The cases
 * assert on the transcript — every held row and every row written while away,
 * in journal order, no duplicates — and on the reads the closure costs, so
 * the companion case refuses a fix that reads for a page that already
 * connects.
 */
const REOPEN_TOTAL = 400;
const REOPEN_PAGE = SNAPSHOT_PAGE;

/** Rows N+1..M in the same journal shape `longConversation` builds. */
function grow(transcript, from, to) {
	for (let i = from; i <= to; i++) {
		transcript.rows.push(
			i % 3 === 1
				? userRow(`r${i}`, 100 + i, `User row ${i}`)
				: i % 3 === 2
					? assistantRow(`r${i}`, 100 + i, `Assistant row ${i}`)
					: toolRow(`r${i}`, 100 + i, `call-${i}`, "read", `output ${i}`),
		);
	}
}

/*
 * The driver's knobs, each one a way the RETURN can differ from the plain
 * journal-tail reopen:
 *
 *  - `total`: the journal's length when the window first looked at it;
 *  - `historyFaults`: `/history` read indexes that reject (the visit-1 snapshot
 *    reads nothing, so an index is a read of the RETURN's walk);
 *  - `echoId`: a send admitted after the remount, before the snapshot, whose
 *    owner row is the newest journal row (the send landed while away);
 *  - `returnPage` / `visitPage`: the snapshot the return (or the first visit)
 *    delivers, when it is not the plain journal-tail page (an older backend's
 *    cut-at-cursor page, a seed with an unlabelled call), given the journal as
 *    it stands at that moment. It returns `{ cursor, entries, coldReason?,
 *    liveEvents? }`.
 *  - `replay`: `{ kind, split, id? }` - the reconnect replay of the journal's
 *    NEWEST row (`kind` assistant | user | tool), delivered as live events
 *    between the open frame and the snapshot; `split` puts it in a flush of its
 *    own BEFORE the snapshot (the shape #876's R4-2 measured), otherwise both
 *    ride one flush. `id` names a row the pane ALREADY holds instead (a replayed
 *    event on a held row), which leaves the journal as it was.
 */
async function driveCachedReopen({
	away,
	total = REOPEN_TOTAL,
	historyFaults = [],
	echoId = null,
	returnPage = null,
	visitPage = null,
	replay = null,
}) {
	const base = longConversation({ awayRows: 0, total });
	const transcript = makeTranscript(base.rows);
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

	// Visit 1: a journal-tail page (the modern owner's shape), the published
	// cursor behind it — the open that paints the tail without a second read.
	const firstPage = visitPage
		? visitPage(transcript)
		: {
				cursor: transcript.rows[transcript.rows.length - REOPEN_PAGE - 1].id,
				entries: transcript.tail(REOPEN_PAGE).entries,
				coldReason: null,
			};
	deliver(openFrame(1, true));
	deliver(snapshotFrame(2, { liveEvents: [], ...firstPage }));
	await pump();
	assert.deepEqual(
		ids(handle.transcript),
		firstPage.entries.map(recordIdOf),
		"the first visit paints its page",
	);
	const readsAfterVisit1 = historyReads();

	// Leave: the panel's identity changes, the stream closes, and the unmount's
	// cleanup is what writes this conversation's paint. The journal advances
	// while no stream of this client is open.
	sessionId = SESSION_B;
	runtime.rerender();
	await pump();
	assert.equal(subscriptions[0].disposed, true, "leaving closes the stream");
	grow(transcript, total + 1, total + away);
	let replayFrames = [];
	if (replay) {
		const at = total + away;
		const stamp = 100 + at;
		if (replay.id) {
			// A replayed event on a row the pane already holds: nothing new on the pane.
			replayFrames = assistantFrames(replay.id);
		} else if (replay.kind === "assistant") {
			transcript.rows[transcript.rows.length - 1] = assistantRow(
				"a-live",
				stamp,
				"a-live done",
			);
			replayFrames = assistantFrames("a-live");
		} else if (replay.kind === "user") {
			transcript.rows[transcript.rows.length - 1] = userRow(
				"u-live",
				stamp,
				"u-live text",
			);
			replayFrames = [
				{
					type: "message_start",
					message: {
						id: "u-live",
						role: "user",
						content: [{ type: "text", text: "u-live text" }],
					},
				},
			];
		} else {
			transcript.rows[transcript.rows.length - 1] = toolRow(
				"r-tool-live",
				stamp,
				"c-live",
				"bash",
				"ok",
			);
			replayFrames = [startFrameFor("c-live"), endFrameFor("c-live")];
		}
	}
	if (echoId !== null) {
		// The message the user sends after returning is journaled under the id the
		// app minted for it (the admission request id), as the NEWEST row.
		transcript.rows[transcript.rows.length - 1] = userRow(
			echoId,
			100 + total + away,
			"sent after returning",
		);
	}

	// Return: a fresh subscription, a fresh journal-tail page, and — when the
	// away window is wider than that page — a seam between the page and the
	// cached block that only a read reaching back to the block can close.
	sessionId = SESSION_A;
	runtime.rerender();
	if (echoId !== null) {
		// Painted through the app's own registry, as the composer's press does,
		// and flushed by the stream's open frame so the pane's painted index
		// holds the echo BEFORE the snapshot arrives - a stale cached paint with
		// an unconfirmed send on top of it.
		paintPendingSend(SESSION_A, {
			id: echoId,
			text: "sent after returning",
			images: [],
		});
		deliver(openFrame(8, true));
		await pump();
		assert.ok(
			handle.transcript.records.some(
				(record) => record.id === echoId && record.local,
			),
			"the echo is painted and unconfirmed when the snapshot arrives",
		);
	}
	deliver(openFrame(9, true));
	let seq = 10;
	for (const event of replayFrames) deliver(eventFrame(seq++, event));
	if (replay?.split) await pump();
	const page = returnPage
		? returnPage(transcript)
		: {
				cursor: transcript.rows[transcript.rows.length - REOPEN_PAGE - 1].id,
				entries: transcript.tail(REOPEN_PAGE).entries,
				coldReason: null,
			};
	deliver(snapshotFrame(seq, { liveEvents: [], ...page }));
	await pump();
	return {
		transcript,
		painted: ids(handle.transcript),
		reads: historyReads() - readsAfterVisit1,
		hasMore: handle.transcript.hasMore,
		handle: () => handle,
	};
}

test("a reopen whose cached block sits behind a journal-tail page still loads the rows between", async () => {
	const { transcript, painted, reads } = await driveCachedReopen({ away: 300 });
	assert.deepEqual(
		painted,
		transcript.rows.map(recordIdOf).slice(REOPEN_TOTAL - REOPEN_PAGE),
		"every held row and every row written while away, in journal order",
	);
	assert.equal(
		new Set(painted).size,
		painted.length,
		"and the merge duplicates nothing",
	);
	assert.equal(
		reads,
		4,
		"the walk reads back page by page until it reaches the cached block (three pages + the block's own)",
	);
});

test("a reopen whose journal-tail page already connects to the cached block still costs no read", async () => {
	const { transcript, painted, reads } = await driveCachedReopen({ away: 50 });
	assert.deepEqual(
		painted,
		transcript.rows.map(recordIdOf).slice(REOPEN_TOTAL - REOPEN_PAGE),
		"the page's overlap with the cached block is the whole story",
	);
	assert.equal(reads, 0, "a connecting page is not re-read on the owner");
});

/*
 * #876 R4-2: A ROW ONLY A RECONNECT REPLAY DELIVERED IS NOT A HELD JOURNAL ROW.
 *
 * The pane holds r301..r400 from a cached visit; while away the journal grows
 * and its NEWEST row is delivered by the reconnect REPLAY as live events. When
 * the replay and the snapshot fall in different flushes, the journal-tail page
 * ended on that replayed row, which the pane "held", so the gate deferred with
 * no read and the pane painted r301..r400 then the tail with the rows between
 * missing and no `hasMore`. Identical on the base before this change.
 */
const replayJournal = (r) => r.transcript.rows.map(recordIdOf);

for (const kind of ["assistant", "user", "tool"]) {
	test(`a reopen whose newest row a SPLIT replay delivered still reads back to the cached block (${kind})`, async () => {
		const r = await driveCachedReopen({
			away: 300,
			replay: { kind, split: true },
		});
		const journal = replayJournal(r);
		assertContiguousSuffix(r.painted, journal, `split replay ${kind}`);
		assert.ok(r.reads > 0, "the page did not connect to a held JOURNAL row");
		assert.equal(
			r.painted.length,
			journal.length - (REOPEN_TOTAL - REOPEN_PAGE),
		);
	});
}

test("the named repro: replay in its own flush, then the journal-tail snapshot, 600 away", async () => {
	const r = await driveCachedReopen({
		away: 600,
		replay: { kind: "assistant", split: true },
	});
	assertContiguousSuffix(r.painted, replayJournal(r), "600 away, split replay");
	assert.ok(r.reads > 0);
	assert.equal(
		r.hasMore,
		true,
		"the walk's bound ended short, so more is above",
	);
});

/*
 * The table: away x (replay in the snapshot's flush | in an earlier flush) x
 * newest row. The pane must paint ONE contiguous journal suffix whichever way
 * the replay fell; `away` <= 480 reaches the cached block, beyond it the seal
 * leaves `hasMore`.
 */
let replayCells = 0;
for (const away of [50, 300, 480, 600, 900])
	for (const split of [false, true])
		for (const kind of ["assistant", "user", "tool"]) {
			replayCells += 1;
			test(`replay table: away ${away} x ${split ? "split" : "same-flush"} replay x newest ${kind}`, async () => {
				const r = await driveCachedReopen({ away, replay: { kind, split } });
				const journal = replayJournal(r);
				assertContiguousSuffix(
					r.painted,
					journal,
					`away ${away} ${split ? "split" : "same"} ${kind}`,
				);
				if (away <= 480) {
					assert.equal(
						r.painted.length,
						journal.length - (REOPEN_TOTAL - REOPEN_PAGE),
						"nothing missing back to the cached block",
					);
				} else assert.equal(r.hasMore, true, "sealed: more history above");
				if (away > 100)
					assert.ok(r.reads > 0, "a disjoint page is read through");
			});
		}
test("the replay table runs the cells it says it runs", () => {
	assert.equal(replayCells, 30);
});

/*
 * COST PINS: the exclusion must not turn an ordinary reconnect into reads.
 */
test("a replay of a row the pane ALREADY holds, plus a connecting snapshot, costs no read", async () => {
	// r400 is the pane's newest held row (an assistant at 400 % 3 == 1? use the
	// journal's own id so the replay lands on a held id, not a new one).
	const held = `r${REOPEN_TOTAL - 1}`; // r399: an assistant row (399 % 3 === 0 is a tool; 398 is assistant)
	const r = await driveCachedReopen({
		away: 50,
		replay: { id: "r398", split: true },
	});
	assert.equal(r.reads, 0, `replaying a held row (not ${held}) is not new`);
	assertContiguousSuffix(r.painted, replayJournal(r), "held replay");
});

test("a replay of a held row in the snapshot's own flush costs no read", async () => {
	const r = await driveCachedReopen({
		away: 50,
		replay: { id: "r398", split: false },
	});
	assert.equal(r.reads, 0);
});

test("a cold pane (nothing held) with a split replay still defers with no read", async () => {
	// Nothing was painted by a first visit: the page is the whole coverage.
	const base = longConversation({ awayRows: 0, total: 150 });
	const transcript = makeTranscript(base.rows);
	reset({ transcript });
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION_A, true);
		return handle;
	};
	runtime.rerender();
	deliver(openFrame(1, true));
	for (const event of assistantFrames("a-live")) deliver(eventFrame(2, event));
	await pump();
	const reads0 = historyReads();
	deliver(
		snapshotFrame(3, {
			cursor: "r50",
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	assert.equal(historyReads() - reads0, 0, "held.size === 0 defers");
	assert.ok(handle.transcript.records.length >= REOPEN_PAGE);
});

/*
 * THE TOOL CELLS ARE CONTIGUITY PINS, NOT BITES ON THE CONNECTION TEST: a
 * replayed settled tool also starts a label-gap read of its own, which reaches
 * back and closes the seam whatever `heldIds` says (measured on main: 1-2 reads
 * for the tool cells, contiguous). The assistant and user cells are the ones the
 * exclusion is for.
 */

/*
 * A replayed `history_delta` row: the replay can carry the journal's newest row
 * as a delta rather than as message events. It is added through
 * `applyHistoryPage` inside the reducer, which is why the exclusion is computed
 * from the INDEX DIFF of the replay fold and not from the event types.
 */
test("a replayed history_delta row is not a held journal row either", async () => {
	const base = longConversation({ awayRows: 0, total: REOPEN_TOTAL });
	const transcript = makeTranscript(base.rows);
	reset({ transcript });
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
			cursor: transcript.rows.at(-REOPEN_PAGE - 1).id,
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	grow(transcript, REOPEN_TOTAL + 1, REOPEN_TOTAL + 299);
	transcript.rows.push(assistantRow("hd-1", 100 + REOPEN_TOTAL + 300, "delta"));
	const reads0 = historyReads();
	deliver(openFrame(3, true));
	deliver(
		eventFrame(4, {
			type: "history_delta",
			messages: [
				{
					id: "hd-1",
					role: "assistant",
					content: [{ type: "text", text: "delta" }],
				},
			],
		}),
	);
	await pump();
	deliver(
		snapshotFrame(5, {
			cursor: "r399",
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	const journal = transcript.rows.map(recordIdOf);
	assertContiguousSuffix(
		ids(handle.transcript),
		journal,
		"history_delta replay",
	);
	assert.ok(
		historyReads() - reads0 > 0,
		"the page did not connect through the delta row",
	);
});

/*
 * THE OTHER DIRECTION: what must STILL count as held. Each scene below hands the
 * reconnect a page that overlaps the pane ONLY through the row under test, and
 * expects the gate to defer with no read. They bound the exclusion from the
 * other side: tracking too much (a continuous stream's rows), or never
 * forgetting (a clear, a session switch), turns an ordinary reconnect into a
 * walk. Every one of them reads 0 on main as well.
 */
async function openOn(transcript, sessionRef) {
	reset({ transcript });
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(sessionRef.id, Boolean(sessionRef.id));
		return handle;
	};
	runtime.rerender();
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor: transcript.rows.at(-REOPEN_PAGE - 1).id,
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	return { runtime, handle: () => handle };
}
const tailFrame = (seq, transcript, n) =>
	snapshotFrame(seq, {
		cursor: transcript.rows.at(-n - 1).id,
		entries: transcript.tail(n).entries,
		coldReason: null,
	});

test("a page that connects only through rows born on a CONTINUOUS stream costs no read", async () => {
	const transcript = makeTranscript(
		longConversation({ awayRows: 0, total: REOPEN_TOTAL }).rows,
	);
	const { handle } = await openOn(transcript, { id: SESSION_A });
	// 20 rows arrive live after the snapshot: the stream had no gap.
	let seq = 3;
	for (let i = 1; i <= 20; i++) {
		transcript.rows.push(
			assistantRow(`l${i}`, 100 + REOPEN_TOTAL + i, `l${i}`),
		);
		for (const event of assistantFrames(`l${i}`))
			deliver(eventFrame(seq++, event));
	}
	await pump();
	const reads0 = historyReads();
	deliver(openFrame(seq++, true));
	deliver(tailFrame(seq++, transcript, 20)); // l1..l20: held through the stream alone
	await pump();
	assert.equal(historyReads() - reads0, 0, "continuous-born rows are held");
	assert.equal(ids(handle().transcript).length, REOPEN_PAGE + 20);
});

test("a /clear forgets what a replay delivered, so the same id arriving on a continuous stream is held", async () => {
	const transcript = makeTranscript(
		longConversation({ awayRows: 0, total: REOPEN_TOTAL }).rows,
	);
	const { handle } = await openOn(transcript, { id: SESSION_A });
	let seq = 3;
	deliver(openFrame(seq++, true));
	for (const event of assistantFrames("a-live"))
		deliver(eventFrame(seq++, event));
	await pump(); // replay in its own flush: a-live is replay-born
	handle().clearView();
	await pump();
	deliver(tailFrame(seq++, transcript, REOPEN_PAGE)); // does not name a-live
	await pump();
	// a-live now truly arrives on the continuous stream and becomes the journal's tail.
	transcript.rows.push(
		assistantRow("a-live", 100 + REOPEN_TOTAL + 1, "a-live done"),
	);
	for (const event of assistantFrames("a-live"))
		deliver(eventFrame(seq++, event));
	await pump();
	const reads0 = historyReads();
	deliver(openFrame(seq++, true));
	deliver(tailFrame(seq++, transcript, 1)); // [a-live]: overlaps only through it
	await pump();
	assert.equal(
		historyReads() - reads0,
		0,
		"the stale id did not outlive the clear",
	);
});

test("a session switch forgets what a replay delivered, so the cached row counts as held on return", async () => {
	const transcript = makeTranscript(
		longConversation({ awayRows: 0, total: REOPEN_TOTAL }).rows,
	);
	const ref = { id: SESSION_A };
	const { runtime, handle } = await openOn(transcript, ref);
	transcript.rows.push(
		assistantRow("a-live", 100 + REOPEN_TOTAL + 1, "a-live done"),
	);
	let seq = 3;
	deliver(openFrame(seq++, true));
	for (const event of assistantFrames("a-live"))
		deliver(eventFrame(seq++, event));
	await pump(); // replay-born, never named by a page
	ref.id = SESSION_B;
	runtime.rerender();
	await pump();
	ref.id = SESSION_A;
	runtime.rerender();
	await pump();
	assert.ok(
		ids(handle().transcript).includes("a-live"),
		"the paint cache brought the row back with the rest of the block",
	);
	const reads0 = historyReads();
	deliver(openFrame(seq++, true));
	deliver(tailFrame(seq++, transcript, 1));
	await pump();
	assert.equal(
		historyReads() - reads0,
		0,
		"cached rows count as held on a new visit",
	);
});

test("a page that NAMES a replayed row makes it held again: the next reconnect defers", async () => {
	const r = await driveCachedReopen({
		away: 50,
		replay: { kind: "assistant", split: true },
	});
	// a-live is the journal's newest row (r450) and the first page named it. The
	// journal moves 99 rows on; the new tail page is a-live + 99 rows, overlapping
	// the pane through a-live alone.
	grow(r.transcript, REOPEN_TOTAL + 51, REOPEN_TOTAL + 149);
	const reads0 = historyReads();
	deliver(openFrame(40, true));
	deliver(
		snapshotFrame(41, {
			cursor: r.transcript.rows.at(-REOPEN_PAGE - 1).id,
			entries: r.transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	assert.equal(
		historyReads() - reads0,
		0,
		"a page named it, so it is a journal row",
	);
});

/*
 * #876, THE BOUNDED WALK. The walk that closes the seam is bounded
 * (`RECONCILE_WALK_MAX_ROWS` rows, `RECONCILE_WALK_MAX_REQUESTS` requests), so an
 * absence wider than the bound ends it short of the cached block. What the pane
 * paints then is the invariant under test: the durable rows on screen are ONE
 * contiguous journal range ending at the tail. A hole is never painted - the
 * block behind it is sealed off and the cursor points at the fetched chain's
 * edge, so "load earlier" pages back through the hole instead of resuming from
 * before a block it can no longer reach.
 *
 * Measured on the previous head (journal 400, snapshot page 100): away <= 480
 * lost nothing; away=600 lost 100 rows and away=900 lost 400, silently. 1400 is
 * the largest five-hour window measured in real sessions (1386 entries; p90 896).
 */
const AWAY_TABLE = [0, 99, 100, 101, 300, 480, 600, 900, 1400];
/** Rows the walk can fetch before its bound ends it (`RECONCILE_WALK_MAX_ROWS`). */
const WALK_ROWS = 500;

/** One contiguous journal suffix, in order, no duplicates, ending at the tail. */
function assertContiguousSuffix(painted, journal, label) {
	assert.ok(painted.length > 0, `${label}: something is painted`);
	assert.equal(
		new Set(painted).size,
		painted.length,
		`${label}: no duplicates`,
	);
	const first = journal.indexOf(painted[0]);
	assert.ok(first >= 0, `${label}: the first painted row is a journal row`);
	assert.deepEqual(
		painted,
		journal.slice(first),
		`${label}: the painted rows are one journal range ending at the tail (no hole)`,
	);
}

for (const away of AWAY_TABLE) {
	test(`a cached reopen after ${away} rows away paints one contiguous range, never a hole`, async () => {
		const { transcript, painted, hasMore } = await driveCachedReopen({ away });
		const journal = transcript.rows.map(recordIdOf);
		assertContiguousSuffix(painted, journal, `away=${away}`);
		if (away <= 480) {
			// The cached block is the first visit's page (`REOPEN_PAGE` rows).
			assert.deepEqual(
				painted,
				journal.slice(REOPEN_TOTAL - REOPEN_PAGE),
				"the walk reached the cached block: every held row and every row away",
			);
		}
		if (away > WALK_ROWS) {
			assert.equal(
				hasMore,
				true,
				"a walk that ended short of the block leaves 'more history above'",
			);
			assert.ok(
				painted.length < journal.length,
				"and the block behind the hole is not painted",
			);
		}
	});
}

for (const away of [600, 900, 1400]) {
	test(`what a bounded walk sealed is reachable: load earlier after ${away} rows away pages the whole journal back`, async () => {
		const { transcript, handle } = await driveCachedReopen({ away });
		const journal = transcript.rows.map(recordIdOf);
		let pages = 0;
		while (await handle().loadOlder()) {
			await pump();
			assert.ok(++pages < 40, "paging terminates");
			assertContiguousSuffix(
				ids(handle().transcript),
				journal,
				`away=${away} after page ${pages}`,
			);
		}
		await pump();
		assert.ok(pages > 0, "the sealed hole is pageable");
		assert.deepEqual(
			ids(handle().transcript),
			journal,
			"the full journal is present, in order, with nothing lost",
		);
		assert.equal(
			handle().transcript.hasMore,
			false,
			"and history is exhausted",
		);
	});
}

/*
 * `sealDisjointBlock`, pure. The row kinds that must SURVIVE a seal are the ones
 * with no journal copy for paging to re-read.
 */
test("sealDisjointBlock drops a disjoint durable block and keeps every live row", () => {
	const entries = (from, to) => {
		const out = [];
		for (let i = from; i <= to; i++)
			out.push(
				i % 3 === 0
					? toolRow(`r${i}`, 100 + i, `call-${i}`, "read", `output ${i}`)
					: assistantRow(`r${i}`, 100 + i, `Assistant row ${i}`),
			);
		return out;
	};
	// A held block (r10..r19), then a fetched tail (r50..r59) with a hole between.
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: entries(10, 19),
		has_more: true,
		cursor_missing: false,
	});
	state = applyHistoryPage(state, {
		entries: entries(50, 59),
		has_more: true,
		cursor_missing: false,
	});
	// Live rows that sit among the held block: an echo, a streaming answer and
	// a running call. None has a journal copy.
	state = appendPendingUser(
		state,
		"echo-1",
		"typed while away",
		[],
		100_000 + 12_000,
	);
	state = applyEvent(
		state,
		{
			type: "message_start",
			message: { id: "live-assistant", role: "assistant", content: [] },
		},
		100_000 + 13_000,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "call-live",
			tool_name: "read",
			args: {},
		},
		100_000 + 14_000,
	);
	const before = ids(state);
	for (const id of ["echo-1", "live-assistant", "tool:call-live"])
		assert.ok(before.includes(id), `${id} is painted before the seal`);

	const edge = { id: "r50", ts: (100 + 50) * 1000 };
	const sealed = sealDisjointBlock(state, edge);
	const after = ids(sealed);

	for (let i = 10; i <= 19; i++)
		assert.ok(
			!after.includes(i % 3 === 0 ? `tool:call-${i}` : `r${i}`),
			`durable r${i} is dropped`,
		);
	for (const id of ["echo-1", "live-assistant", "tool:call-live"])
		assert.ok(after.includes(id), `${id} survives the seal`);
	for (let i = 50; i <= 59; i++)
		assert.ok(
			after.includes(i % 3 === 0 ? `tool:call-${i}` : `r${i}`),
			`fetched r${i} stays`,
		);
	assert.equal(sealed.oldestId, "r50", "the cursor is the fetched edge");
	assert.equal(sealed.oldestTs, edge.ts);
	assert.equal(sealed.hasMore, true, "and history above it is offered");
	assert.equal(
		sealed.index.size,
		sealed.records.length,
		"the index is rebuilt over the surviving rows",
	);
	for (const [id, position] of sealed.index)
		assert.equal(sealed.records[position].id, id, "and points at its row");
});

test("sealDisjointBlock never drops a row the walk itself fetched, whatever its instant", () => {
	// A skewed journal clock stamps a fetched row BEFORE the chain's oldest entry.
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			assistantRow("r10", 110, "held, older"),
			assistantRow("r11", 111, "fetched, stamped early"),
			assistantRow("r50", 150, "the edge"),
		],
		has_more: true,
		cursor_missing: false,
	});
	const sealed = sealDisjointBlock(
		state,
		{ id: "r50", ts: 150_000 },
		new Set(["r11", "r50"]),
	);
	assert.deepEqual(
		ids(sealed),
		["r11", "r50"],
		"r10 goes, the fetched r11 stays",
	);
	assert.deepEqual(
		ids(sealDisjointBlock(state, { id: "r50", ts: 150_000 })),
		["r50"],
		"and without the guard r11 would go with it",
	);
});

test("sealDisjointBlock is a no-op, by reference, when nothing is disjoint", () => {
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			assistantRow("r1", 101, "one"),
			assistantRow("r2", 102, "two"),
			assistantRow("r3", 103, "three"),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.equal(
		sealDisjointBlock(state, { id: "r1", ts: 101_000 }),
		state,
		"the edge is the oldest row: nothing is older",
	);
	assert.equal(
		sealDisjointBlock(EMPTY_TRANSCRIPT, { id: "r1", ts: 101_000 }),
		EMPTY_TRANSCRIPT,
		"an empty transcript has nothing to seal",
	);
	assert.equal(
		sealDisjointBlock(state, { id: "r9", ts: 0 }),
		state,
		"an edge with no instant orders nothing and seals nothing",
	);
});

/*
 * #876, REVIEW ROUND 1.
 *
 * THE ECHO IS NOT A HELD ROW. A send the user made after returning, while the
 * stale cached paint was on screen, is an unconfirmed echo keyed by the
 * admission request id - which is also the id the owner journals the message
 * under. When that message is already the journal's newest row, the tail page
 * contains the echo's id, and a held set built from every painted key reads
 * that as "the page reaches what the pane held": the gate and the walk stand
 * down over the whole hole, with no read. The rows below are asserted against
 * the same journal-suffix invariant as the table.
 */
for (const away of [300, 600]) {
	test(`a pending send whose owner row is the newest journal row does not make a disjoint page look connected (away ${away})`, async () => {
		const echoId = "req-6f1c2d9e-0000-4000-8000-00000000e876";
		const { transcript, painted, reads, hasMore, handle } =
			await driveCachedReopen({ away, echoId });
		const journal = transcript.rows.map(recordIdOf);
		assert.equal(journal.at(-1), echoId, "the owner journaled the send last");
		assertContiguousSuffix(painted, journal, `echo, away=${away}`);
		assert.ok(
			reads >= 4,
			`the seam is read for (${reads} reads), not deferred`,
		);
		if (away <= 480) {
			assert.deepEqual(
				painted,
				journal.slice(REOPEN_TOTAL - REOPEN_PAGE),
				"the cached block, the rows written while away and the send, all painted",
			);
		} else {
			assert.equal(hasMore, true, "a walk the bound ended leaves more above");
		}
		const mine = handle().transcript.records.filter(
			(record) => record.id === echoId,
		);
		assert.equal(mine.length, 1, "the echo resolves onto the owner row once");
		assert.ok(!mine[0].local, "and the owner's row has replaced the echo");
	});
}

/*
 * THE OLDER-BACKEND ARM KEYS A TOOL RESULT BY ITS ROW KEY. A page whose newest
 * entry is a tool result and which the pane already holds (the row is
 * `tool:<call_id>`, the entry's id is its own) is a page that connects: it must
 * cost no read. The arm used to look the ENTRY id up among the held row keys,
 * which a tool result never matches, so it paid a read every time.
 */
test("an older backend's page ending on a held tool result costs no read", async () => {
	const cutAt = (transcript, id) => {
		const page = transcript.page(id, REOPEN_PAGE);
		// An older backend publishes a cursor AHEAD of the page it cut: the page's
		// newest row is not the cursor, so the cut-at-cursor test does not refuse.
		return { cursor: "r400", entries: page.entries };
	};
	const { transcript, painted, reads } = await driveCachedReopen({
		away: 0,
		visitPage: (transcript) => ({
			cursor: "r400",
			entries: transcript.page("r400", REOPEN_PAGE).entries,
		}),
		returnPage: (transcript) => cutAt(transcript, "r399"),
	});
	const journal = transcript.rows.map(recordIdOf);
	assert.equal(
		journal.at(-2),
		"tool:call-399",
		"the newest page entry is a tool result",
	);
	assert.equal(reads, 0, "the held tool row is recognised, so the page defers");
	// The cached block r301..r400 plus the cut page's older rows (r300..r399).
	assert.deepEqual(
		painted,
		journal.slice(REOPEN_TOTAL - REOPEN_PAGE - 1),
		"and the pane still holds the whole cached block",
	);
});

/*
 * THE WALK'S FAILURE STAND-DOWN. A read that rejects ends the walk (one retry,
 * then a quiet stand-down) with the held block still painted beside the tail:
 * the same hole as a bound, reached by a different exit. Either shape of
 * failure must leave one contiguous range and an affordance to page back, and
 * paging must then recover everything.
 */
for (const [name, historyFaults] of [
	["the walk's first read", [0, 1]],
	["every read after the first page", [1, 2]],
]) {
	test(`a walk that stands down on a failed read (${name}) paints no hole and stays pageable`, async () => {
		const { transcript, painted, hasMore, handle } = await driveCachedReopen({
			away: 300,
			historyFaults,
		});
		const journal = transcript.rows.map(recordIdOf);
		assertContiguousSuffix(painted, journal, name);
		assert.equal(hasMore, true, "more history is offered above the tail");
		assert.ok(
			painted.length < journal.length,
			"the cached block behind the unread hole is not painted",
		);
		let pages = 0;
		while (await handle().loadOlder()) {
			await pump();
			assert.ok(++pages < 40, "paging terminates");
		}
		await pump();
		assert.deepEqual(
			ids(handle().transcript),
			journal,
			"paging recovers the whole journal, contiguous and in order",
		);
	});
}

/*
 * A BATCH THAT ALREADY TOUCHES THE HELD BLOCK IS ONE BLOCK WITH IT. The older
 * backend's page (r351..r450, cut at its cursor) overlaps the cached block
 * (r301..r400), and the journal has since moved to 520 rows. The walk's first
 * read (r421..r520) joins that page without reaching the block, and its next
 * read fails. Nothing is disjoint - cached block, page and tail are one range -
 * so ending the walk there must not drop the block.
 */
test("a walk that ends joined to a page which touches the held block keeps the block", async () => {
	const { transcript, painted } = await driveCachedReopen({
		away: 120,
		historyFaults: [1, 2],
		returnPage: (transcript) => ({
			cursor: "r450",
			entries: transcript.page("r450", REOPEN_PAGE).entries,
		}),
	});
	const journal = transcript.rows.map(recordIdOf);
	assert.deepEqual(
		painted,
		journal.slice(REOPEN_TOTAL - REOPEN_PAGE),
		"cached block + overlapping page + the tail it joined, none dropped",
	);
});

test("a walk that read nothing keeps the held block when the batch's page touches it", async () => {
	const { transcript, painted } = await driveCachedReopen({
		away: 50,
		historyFaults: [0, 1],
		returnPage: (transcript) => ({
			cursor: "r450",
			entries: transcript.page("r450", REOPEN_PAGE).entries,
		}),
	});
	const journal = transcript.rows.map(recordIdOf);
	assert.deepEqual(
		painted,
		journal.slice(REOPEN_TOTAL - REOPEN_PAGE, 450),
		"the batch's page overlaps the block, so the block is part of the range",
	);
});

/*
 * A LABEL FLOOR STOPS LABELLING, NOT THE WALK. The seed names a settled call no
 * page can label, and every page of this journal carries a user row (the turn's
 * opening, a label floor), so the first page reaches a floor. The walk still
 * owes the held block, and must read back to it rather than stand down over the
 * hole.
 */
test("a label walk that reaches its floor keeps reading until it reaches the held block", async () => {
	const { transcript, painted, reads } = await driveCachedReopen({
		away: 300,
		returnPage: (transcript) => ({
			cursor: transcript.rows[transcript.rows.length - REOPEN_PAGE - 1].id,
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
			liveEvents: [
				{
					type: "tool_execution_end",
					tool_call_id: "toolu_SEEDED_NOT_IN_JOURNAL",
					tool_name: "bash",
					result: { content: [{ text: "seeded output" }], details: null },
					duration_s: 0.2,
					is_error: false,
					started_at_epoch: 1_000_000,
				},
			],
		}),
	});
	const journal = transcript.rows.map(recordIdOf);
	assert.deepEqual(
		// The seeded call's own live row rides at the tail; it is not the journal.
		painted.filter((id) => id !== "tool:toolu_SEEDED_NOT_IN_JOURNAL"),
		journal.slice(REOPEN_TOTAL - REOPEN_PAGE),
		"the floor zeroed the label debt, not the connection to the cached block",
	);
	assert.ok(reads >= 2, `the walk read past its first page (${reads} reads)`);
});

/*
 * #876, CI REGRESSION OF REVIEW ROUND 1: A ROW THAT CHANGES STATE IN A FLUSH IS
 * NOT A ROW THE WALK FAILED TO REACH. The pane holds durable rows and a tool
 * that is still RUNNING (a live row, so not in the connection set). The next
 * flush settles it and asks for its label; the walk's page is empty (or the read
 * fails), so there is no fetched chain to seal AT. The seal then falls back to
 * "the oldest durable row not on the pane before this flush" - and the
 * just-settled tool, durable NOW, was on the pane before as a running row. Cut
 * there, it dropped every durable row older than itself: the whole held block.
 * `session-load-sequence.test.mjs` is the same shape from the DOM (93 rows -> 2).
 */
for (const [name, historyFaults, emptyPage] of [
	["the label walk's page is empty", [], true],
	["the label walk's read fails", [0, 1, 2], false],
]) {
	test(`a running tool that settles mid-flush does not become the edge of a seal (${name})`, async () => {
		const callId = "c-live";
		const base = longConversation({ awayRows: 0, total: 130 });
		const transcript = makeTranscript(base.rows);
		reset({ transcript, historyFaults });
		if (emptyPage)
			globalThis.__gapTail = () => ({
				entries: [],
				has_more: false,
				cursor_missing: false,
			});
		const panel = await mount();
		const running = {
			type: "tool_execution_start",
			tool_call_id: callId,
			tool_name: "bash",
			started_at_epoch: 100 + 130 + 1,
		};
		deliver(openFrame(1, true));
		deliver(
			snapshotFrame(2, {
				cursor: "r130",
				entries: transcript.tail(REOPEN_PAGE).entries,
				liveEvents: [running],
				coldReason: null,
			}),
		);
		await pump();
		const held = panel.ids().filter((id) => id !== `tool:${callId}`);
		assert.equal(held.length, REOPEN_PAGE, "the page is painted");
		assert.equal(panel.row(`tool:${callId}`)?.phase, "running");

		deliver(
			eventFrame(3, {
				type: "tool_execution_end",
				tool_call_id: callId,
				tool_name: "bash",
				duration_s: 1,
				result: { content: [{ text: "ok" }], details: null },
				is_error: false,
				started_at_epoch: 100 + 130 + 1,
			}),
		);
		await pump();
		assert.equal(
			panel.row(`tool:${callId}`)?.phase,
			"done",
			"the tool settled",
		);
		assert.ok(
			historyReads() >= 1,
			"the settle asked for its label, so a walk ran",
		);
		const after = panel.ids();
		for (const id of held)
			assert.ok(after.includes(id), `${id} is still painted after the walk`);
		assert.equal(after.length, held.length + 1, "nothing else was dropped");
	});
}

/*
 * #876, REVIEW ROUND 3: THE SEAL'S INVARIANT, OVER THE WHOLE SPACE.
 *
 * Rounds 1 and 2 each fixed one path by which the seal fired WITHOUT PROOF of a
 * disjoint block, and each fix was a point patch: a settled tool became the
 * edge (CI), then a row born live in a flush that carried no page (R3-1), then
 * a pre-flush index a walk's own commits never refreshed (Q3-1). The contract is
 * now that a seal's edge is a row the journal DELIVERED - the walk's oldest
 * fetched entry or the batch's own snapshot page - and that the held block is
 * provably not connected to it. This table states that as an invariant and
 * crosses what the pane holds, what the flush carries and how the label read
 * answers, so a path nobody has thought of is a failing row rather than a
 * fourth review round.
 *
 * Every cell: a pane that painted the journal's last 100 rows of 130 (the held
 * block, r31..r130; r30..r129 for the TOOL-top cell) plus one of four live
 * states; then ONE more flush. The cell count is asserted below.
 *
 *  (i)   a flush with NO snapshot page never makes a durable row disappear;
 *  (ii)  a flush WITH a page disjoint from the held block drops only durable
 *        rows older than that page's oldest row, and then the cursor IS that
 *        row with more history above; when the read reached the block it drops
 *        nothing, and when it did not it drops exactly the held block;
 *  (iii) a page connected to the held block drops nothing and costs no read;
 *  (iv)  every live row, old or born in the flush, is present exactly once;
 *  (v)   `/clear` mid-walk leaves the pane empty.
 */
const HELD_FIRST = 31;
const HELD_LAST = 130;
const PANE_STATES = [
	"bare",
	"running tool",
	"streaming answer",
	"unconfirmed echo",
];
const READ_OUTCOMES = ["ok", "empty page", "failed x3"];
const PAGE_OLDEST = "r331"; // the tail page of a 430-row journal

const heldIdsOf = (transcript, heldLast = HELD_LAST) =>
	transcript.rows.slice(heldLast - REOPEN_PAGE, heldLast).map(recordIdOf);

const liveSeedFor = (state) =>
	state === "running tool"
		? [
				{
					type: "tool_execution_start",
					tool_call_id: "c-run",
					tool_name: "bash",
					started_at_epoch: 100 + HELD_LAST + 1,
				},
			]
		: state === "streaming answer"
			? [liveAssistant("s-live", "streaming so far")]
			: [];
const liveIdFor = (state) =>
	state === "running tool"
		? "tool:c-run"
		: state === "streaming answer"
			? "s-live"
			: state === "unconfirmed echo"
				? "echo-x"
				: null;

const endFrameFor = (callId) => ({
	type: "tool_execution_end",
	tool_call_id: callId,
	tool_name: "bash",
	duration_s: 1,
	result: { content: [{ text: "ok" }], details: null },
	is_error: false,
	started_at_epoch: 100 + HELD_LAST + 1,
});
const startFrameFor = (callId) => ({
	type: "tool_execution_start",
	tool_call_id: callId,
	tool_name: "bash",
	started_at_epoch: 100 + HELD_LAST + 1,
});
const assistantFrames = (id) => [
	{ type: "message_start", message: { id, role: "assistant", content: [] } },
	{
		type: "message_end",
		message: {
			id,
			role: "assistant",
			content: [{ type: "text", text: `${id} done` }],
			stop_reason: "stop",
		},
	},
];

/* What the flush carries. `needs` names the pane state it can only apply to. */
const FLUSHES = {
	"a new fast tool": {
		events: () => [startFrameFor("c-new"), endFrameFor("c-new")],
		born: ["tool:c-new"],
	},
	"a new assistant": {
		events: () => assistantFrames("a-new"),
		born: ["a-new"],
	},
	"the running tool settles": {
		needs: "running tool",
		events: () => [endFrameFor("c-run")],
		born: [],
	},
	"the streaming answer settles": {
		needs: "streaming answer",
		events: () => [
			{
				type: "message_end",
				message: {
					id: "s-live",
					role: "assistant",
					content: [{ type: "text", text: "final" }],
					stop_reason: "stop",
				},
			},
		],
		born: [],
	},
	"settle + a new assistant": {
		needs: "running tool",
		events: () => [endFrameFor("c-run"), ...assistantFrames("a-new")],
		born: ["a-new"],
	},
	"an unpainted attention frame": {
		attention: true,
		events: () => [],
		born: [],
	},
	"an unpainted attention frame + a new assistant": {
		attention: true,
		events: () => assistantFrames("a-new"),
		born: ["a-new"],
	},
	"a snapshot page disjoint from the held block": {
		page: "disjoint",
		events: () => [],
		born: [],
	},
	"a disjoint page + a new fast tool": {
		page: "disjoint",
		events: () => [startFrameFor("c-new"), endFrameFor("c-new")],
		born: ["tool:c-new"],
	},
	"a snapshot page connected to the held block": {
		page: "connected",
		events: () => [],
		born: [],
	},
	/*
	 * The gate does NOT defer on these (an older backend's page whose newest row
	 * the pane never held), so the walk RUNS, and the batch's page touches the held
	 * block through exactly one row - its top. That is the cell where
	 * `batchTouchesHeld`, not the gate, is what must stop the seal. With the top
	 * row a TOOL result (r129), the page's entry id and the held record key
	 * (`tool:call-129`) differ, which is the shape every busy turn ends in
	 * (review round 4, R4-1).
	 */
	"an older backend's page touching the held block only through its top row": {
		page: "older-overlap",
		events: () => [],
		born: [],
	},
	"an older backend's page touching the held block only through its top TOOL row":
		{
			page: "older-overlap",
			heldLast: 129,
			events: () => [],
			born: [],
		},
	"/clear while the walk is out": {
		page: "disjoint",
		clear: true,
		events: () => [],
		born: [],
	},
};

async function driveInvariant({ state, flush, outcome }) {
	const heldLast = flush.heldLast ?? HELD_LAST;
	const base = longConversation({ awayRows: 0, total: heldLast });
	const transcript = makeTranscript(base.rows);
	reset({ transcript, historyFaults: [] });
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION_A, true);
		return handle;
	};
	runtime.rerender();
	const seed = liveSeedFor(state);
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, {
			cursor: `r${heldLast - REOPEN_PAGE}`,
			entries: transcript.tail(REOPEN_PAGE).entries,
			liveEvents: seed,
			coldReason: null,
		}),
	);
	await pump();
	if (state === "unconfirmed echo") {
		paintPendingSend(SESSION_A, { id: "echo-x", text: "typed", images: [] });
		await pump();
	}
	const heldDurable = heldIdsOf(transcript, heldLast);
	const painted0 = ids(handle.transcript);
	for (const id of heldDurable)
		assert.ok(painted0.includes(id), `${id} painted before the flush`);
	const live = liveIdFor(state);
	if (live) assert.ok(painted0.includes(live), `${live} on the pane before`);

	// How the label walk's reads answer from here on.
	const real = globalThis.__gapTail;
	const reads0 = historyReads();
	const parked = [];
	const answer = (request) =>
		outcome === "ok"
			? real(request)
			: outcome === "empty page"
				? { entries: [], has_more: false, cursor_missing: false }
				: (() => {
						throw new Error("history unavailable");
					})();
	globalThis.__gapTail = flush.clear
		? (request) =>
				new Promise((resolve, reject) =>
					parked.push(() => {
						try {
							resolve(answer(request));
						} catch (error) {
							reject(error);
						}
					}),
				)
		: answer;
	if (outcome === "failed x3") globalThis.__gapHistoryFaults = [];

	let journalTop = heldLast;
	if (flush.page) {
		// Disjoint: the journal moved 300 rows on, so the page is r331..r430.
		// Connected: it moved 20 rows on, so the page (r51..r150) overlaps the block.
		// Older-overlap: it moved 100 rows on and the page is cut two rows short of
		// the tail, ending on a row the pane never held.
		const grown =
			flush.page === "disjoint" ? 300 : flush.page === "connected" ? 20 : 100;
		grow(transcript, heldLast + 1, heldLast + grown);
		journalTop = heldLast + grown;
	}
	let seq = 3;
	if (flush.page === "older-overlap") {
		deliver(openFrame(seq++, true));
		deliver(
			snapshotFrame(seq++, {
				// A cursor that is not the page's newest row, and no `cold_reason`: the
				// older backend's shape, which the gate answers by asking whether the
				// newest row is already on screen.
				cursor: `r${journalTop}`,
				entries: transcript.page(`r${heldLast + REOPEN_PAGE - 1}`, REOPEN_PAGE)
					.entries,
				liveEvents: seed,
			}),
		);
	} else if (flush.page) {
		deliver(openFrame(seq++, true));
		deliver(
			snapshotFrame(seq++, {
				cursor: `r${journalTop - REOPEN_PAGE}`,
				entries: transcript.tail(REOPEN_PAGE).entries,
				liveEvents: seed,
				coldReason: null,
			}),
		);
	}
	if (flush.attention) deliver(attentionFrame(seq++));
	for (const event of flush.events()) deliver(eventFrame(seq++, event));
	await pump();
	if (flush.clear) {
		handle.clearView();
		await pump();
		for (let i = 0; i < 12 && parked.length; i++) {
			parked.shift()();
			await pump();
		}
	}
	return {
		heldDurable,
		after: ids(handle.transcript),
		transcript: handle.transcript,
		reads: historyReads() - reads0,
		journal: transcript.rows.map(recordIdOf),
	};
}

/*
 * THE CELL COUNT IS ASSERTED, so the number in the comments and in the commit
 * text cannot drift from what runs (review round 4 found 105 where the reply
 * said 109). Flushes with a `needs` apply to one pane state only.
 */
const TABLE_PAIRS = PANE_STATES.flatMap((state) =>
	Object.entries(FLUSHES).filter(
		([, flush]) => !flush.needs || flush.needs === state,
	),
).length;
const TABLE_CELLS = TABLE_PAIRS * READ_OUTCOMES.length;
let tableCellsRun = 0;
for (const state of PANE_STATES) {
	for (const [name, flush] of Object.entries(FLUSHES)) {
		if (flush.needs && flush.needs !== state) continue;
		for (const outcome of READ_OUTCOMES) {
			tableCellsRun += 1;
			test(`seal invariant: pane [${state}] x flush [${name}] x label read [${outcome}]`, async () => {
				const r = await driveInvariant({ state, flush, outcome });
				const cell = `[${state}] [${name}] [${outcome}]`;
				const live = liveIdFor(state);
				if (flush.clear) {
					assert.equal(
						r.after.filter((id) => r.heldDurable.includes(id)).length,
						0,
						`${cell}: (v) a cleared pane stays cleared`,
					);
					assert.equal(r.transcript.records.length, 0, `${cell}: and empty`);
					return;
				}
				const kept = r.heldDurable.filter((id) => r.after.includes(id));
				const dropped = r.heldDurable.filter((id) => !r.after.includes(id));
				// (iv) every live row, old or born here, exactly once.
				for (const id of [...(live ? [live] : []), ...flush.born])
					assert.equal(
						r.after.filter((x) => x === id).length,
						1,
						`${cell}: (iv) ${id} present exactly once`,
					);
				assert.equal(
					new Set(r.after).size,
					r.after.length,
					`${cell}: no duplicates`,
				);
				if (flush.page === "disjoint") {
					if (outcome === "ok") {
						assert.deepEqual(
							dropped,
							[],
							`${cell}: (ii) the read reached the block`,
						);
					} else {
						assert.deepEqual(
							dropped,
							r.heldDurable,
							`${cell}: (ii) the read did not reach it, so exactly the held block is sealed`,
						);
						assert.equal(
							r.transcript.oldestId,
							PAGE_OLDEST,
							`${cell}: (ii) the cursor is the page's oldest row`,
						);
						assert.equal(
							r.transcript.hasMore,
							true,
							`${cell}: (ii) and more is above`,
						);
					}
					// Whatever remains of the journal is one suffix ending at its tail.
					const journalRows = r.after.filter((id) => r.journal.includes(id));
					assertContiguousSuffix(journalRows, r.journal, cell);
				} else if (flush.page === "connected") {
					assert.deepEqual(
						dropped,
						[],
						`${cell}: (iii) a connected page drops nothing`,
					);
					assert.equal(r.reads, 0, `${cell}: (iii) and costs no read`);
				} else if (flush.page === "older-overlap") {
					assert.ok(
						r.reads >= 1,
						`${cell}: the gate did not defer, so the walk ran (${r.reads} reads)`,
					);
					assert.deepEqual(
						dropped,
						[],
						`${cell}: (iii) a page that touches the held block drops nothing, whether or not the walk reached further`,
					);
				} else {
					assert.deepEqual(
						dropped,
						[],
						`${cell}: (i) a flush with no page never drops a durable row`,
					);
					assert.equal(kept.length, r.heldDurable.length);
				}
			});
		}
	}
}

test("the invariant table runs the cells it says it runs", () => {
	// 13 flushes: 10 apply to every one of the 4 pane states (40 pairs) and 3
	// apply to one state each (3 pairs) = 43 pairs x 3 read outcomes = 129. What
	// is pinned is that the cells that RUN are the cells the product says, and
	// what the product is: a new flush or state changes this number on purpose.
	assert.equal(tableCellsRun, TABLE_CELLS);
	assert.equal(TABLE_CELLS, 129, "update the comments and commit text with it");
});

/*
 * The specific shapes the reviews found, named so a failure says which one
 * regressed. Each is also a cell of the table above; these state the claim.
 */
test("R3-1: a tool that starts and ends in ONE flush does not seal the pane when the label read fails", async () => {
	const r = await driveInvariant({
		state: "bare",
		flush: FLUSHES["a new fast tool"],
		outcome: "failed x3",
	});
	for (const id of r.heldDurable)
		assert.ok(r.after.includes(id), `${id} survives`);
	assert.equal(r.transcript.records.length, r.heldDurable.length + 1);
});

test("Q3-1: a tool that settles AFTER the reopen walk finished leaves the rows the walk reconnected", async () => {
	const tool = {
		type: "tool_execution_start",
		tool_call_id: "c-late",
		tool_name: "bash",
		started_at_epoch: 9999,
	};
	const { handle, painted } = await driveCachedReopen({
		away: 300,
		returnPage: (t) => ({
			cursor: t.rows[t.rows.length - REOPEN_PAGE - 1].id,
			entries: t.tail(REOPEN_PAGE).entries,
			coldReason: null,
			liveEvents: [tool],
		}),
	});
	const before = ids(handle().transcript);
	assert.ok(
		before.length >= 400,
		`the walk reconnected the block (${painted.length})`,
	);
	globalThis.__gapTail = () => ({
		entries: [],
		has_more: false,
		cursor_missing: false,
	});
	deliver(eventFrame(11, endFrameFor("c-late")));
	await pump();
	const after = ids(handle().transcript);
	assert.deepEqual(
		before.filter((id) => !after.includes(id)),
		[],
		"every previously painted row is still painted",
	);
});

test("Q3-1b: what a walk's own commits painted counts as held when the next snapshot arrives", async () => {
	// After the reopen walk the pane holds r301..r700, but the index the last FLUSH
	// left behind holds only the snapshot page and the cached block. An older
	// backend's page cut at r500 ends on a row only the walk painted: against the
	// live view it connects (no read); against the stale index it looked disjoint,
	// read, and - with the read failing - sealed the cached block away.
	const { transcript, handle } = await driveCachedReopen({ away: 300 });
	const before = ids(handle().transcript);
	const reads0 = historyReads();
	globalThis.__gapHistoryFaults = Array.from(
		{ length: 20 },
		(_, i) => globalThis.__gapHistoryReads + i,
	);
	const cut = transcript.page("r500", REOPEN_PAGE);
	deliver(openFrame(20, true));
	deliver(
		snapshotFrame(21, {
			cursor: "r600",
			entries: cut.entries,
			liveEvents: [],
		}),
	);
	await pump();
	assert.equal(
		historyReads() - reads0,
		0,
		"the page ends on a held row, so no read",
	);
	assert.deepEqual(
		before.filter((id) => !ids(handle().transcript).includes(id)),
		[],
		"nothing was dropped",
	);
});

test("Q3-2b: a walk whose read fails after /clear does not schedule a retry of the history it cleared", async () => {
	// An emptied pane reads, to the walk's failure arm, as a pane that never
	// loaded: it would retry on the stream's backoff and repaint the history.
	const base = longConversation({ awayRows: 0, total: 400 });
	const transcript = makeTranscript(base.rows);
	reset({ transcript });
	const runtime = makeRuntime();
	let sessionId = SESSION_A;
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(sessionId, Boolean(sessionId));
		return handle;
	};
	runtime.rerender();
	const page = () => ({
		liveEvents: [],
		cursor: transcript.rows.at(-101).id,
		entries: transcript.tail(100).entries,
		coldReason: null,
	});
	deliver(openFrame(1, true));
	deliver(snapshotFrame(2, page()));
	await pump();
	sessionId = SESSION_B;
	runtime.rerender();
	await pump();
	grow(transcript, 401, 700);
	sessionId = SESSION_A;
	runtime.rerender();
	const release = [];
	globalThis.__gapTail = () =>
		new Promise((_resolve, reject) =>
			release.push(() => reject(new Error("history unavailable"))),
		);
	deliver(openFrame(9, true));
	deliver(snapshotFrame(10, page()));
	await pump();
	assert.ok(release.length > 0, "the walk has a read out");
	handle.clearView();
	await pump();
	const timersBefore = globalThis.__gapTimers.length;
	for (let i = 0; i < 10 && release.length; i++) {
		release.shift()();
		await pump();
	}
	assert.equal(handle.transcript.records.length, 0, "the pane stays cleared");
	assert.equal(
		globalThis.__gapTimers.length,
		timersBefore,
		"and no retry of the cleared history is scheduled",
	);
});

test("a disjoint snapshot page that is the WHOLE journal seals nothing", async () => {
	// The journal was replaced by a shorter one: the page has no `has_more`, so
	// there is nothing behind it for the held block to be a hole in front of. A
	// seal here would set `hasMore` over a journal that has nothing above.
	const base = longConversation({ awayRows: 0, total: HELD_LAST });
	const transcript = makeTranscript(base.rows);
	reset({ transcript });
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
			cursor: "r30",
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	const held = ids(handle.transcript);
	assert.equal(held.length, REOPEN_PAGE);
	globalThis.__gapTail = () => ({
		entries: [],
		has_more: false,
		cursor_missing: false,
	});
	const fresh = [];
	for (let i = 1; i <= 5; i++)
		fresh.push(assistantRow(`new${i}`, 100 + HELD_LAST + 50 + i, `new ${i}`));
	deliver(openFrame(3, true));
	deliver(
		snapshotFrame(4, {
			cursor: "new5",
			entries: fresh,
			coldReason: null,
			hasMore: false,
		}),
	);
	await pump();
	const after = ids(handle.transcript);
	assert.deepEqual(
		held.filter((id) => !after.includes(id)),
		[],
		"the held block is not sealed away",
	);
});

test("Q3-2c: the backoff retry of a nothing-painted walk is not fired into a view that was cleared meanwhile", async () => {
	// The retry timer is armed on an EMPTY pane; rows can arrive during its
	// backoff gap and a /clear can follow. Firing the retry then would answer the
	// clear with the history it removed.
	const base = longConversation({ awayRows: 0, total: 130 });
	const transcript = makeTranscript(base.rows);
	reset({ transcript, historyFaults: [0] });
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
			cursor: null,
			entries: [],
			liveEvents: [],
			coldReason: "no-runtime",
		}),
	);
	await pump();
	assert.ok(globalThis.__gapTimerCallbacks.length > 0, "a retry is armed");
	for (const frame of assistantFrames("a-gap")) deliver(eventFrame(3, frame));
	await pump();
	assert.ok(handle.transcript.records.length > 0, "a row arrived in the gap");
	handle.clearView();
	await pump();
	const reads = historyReads();
	for (const fire of globalThis.__gapTimerCallbacks.splice(0)) fire();
	await pump();
	assert.equal(historyReads(), reads, "the cleared view is not read for again");
	assert.equal(handle.transcript.records.length, 0, "and stays cleared");
});

/*
 * TWO SNAPSHOT FRAMES IN ONE FLUSH (a reconnect's replay). The seal's edge is the
 * OLDEST page's oldest row, which can only drop fewer rows than the newer page's
 * would; and it cuts at all only when NEITHER page touches the held block.
 * The held block is r31..r130; the journal grows to 430 and the two pages are
 * r231..r330 (older) and r331..r430 (newer), both disjoint from it.
 */
async function driveTwoSnapshots({ olderTouchesHeld, newerTouchesHeld }) {
	const base = longConversation({ awayRows: 0, total: HELD_LAST });
	const transcript = makeTranscript(base.rows);
	reset({ transcript });
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
			cursor: "r30",
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	const held = heldIdsOf(transcript);
	grow(transcript, HELD_LAST + 1, 430);
	globalThis.__gapTail = () => ({
		entries: [],
		has_more: false,
		cursor_missing: false,
	});
	const olderPage = olderTouchesHeld
		? transcript.page("r229", REOPEN_PAGE) // r130..r229: touches the block at r130
		: transcript.page("r330", REOPEN_PAGE); // r231..r330
	const newerPage = newerTouchesHeld
		? transcript.page("r229", REOPEN_PAGE)
		: transcript.page("r430", REOPEN_PAGE); // r331..r430
	deliver(openFrame(3, true));
	deliver(
		snapshotFrame(4, {
			cursor: "r230",
			entries: olderPage.entries,
			coldReason: null,
		}),
	);
	deliver(
		snapshotFrame(5, {
			cursor: "r330",
			entries: newerPage.entries,
			coldReason: null,
		}),
	);
	await pump();
	return { held, transcript: handle.transcript, after: ids(handle.transcript) };
}

test("two snapshots in one flush over a disjoint block: the seal cuts at the OLDER page's oldest row", async () => {
	const r = await driveTwoSnapshots({
		olderTouchesHeld: false,
		newerTouchesHeld: false,
	});
	assert.equal(
		r.transcript.oldestId,
		"r231",
		"the edge is the older page's first row, not the newer page's (r331)",
	);
	assert.equal(r.transcript.hasMore, true);
	assert.deepEqual(
		r.held.filter((id) => r.after.includes(id)),
		[],
		"the held block is sealed",
	);
	assert.ok(
		r.after.includes("tool:call-231") && r.after.includes("tool:call-330"),
		"and the older page, the one that was painted, is kept whole",
	);
});

for (const [name, opts] of [
	[
		"the older page connects",
		{ olderTouchesHeld: true, newerTouchesHeld: false },
	],
	[
		"the newer page connects",
		{ olderTouchesHeld: false, newerTouchesHeld: true },
	],
]) {
	test(`two snapshots in one flush: no seal when ${name}`, async () => {
		const r = await driveTwoSnapshots(opts);
		assert.deepEqual(
			r.held.filter((id) => !r.after.includes(id)),
			[],
			"a page that touches the held block means there is no disjoint block to seal",
		);
	});
}

test("R4-1: a walk's fetched page that overlaps the batch only through a TOOL row has connected, so the walk stops at one read", async () => {
	// The walk's `joined` test compares a fetched entry with the batch's record
	// keys; a tool entry is `r<n>` on the wire and `tool:call-<n>` as a record,
	// so a raw-id comparison reads this overlap as no overlap and pages on.
	const base = longConversation({ awayRows: 0, total: HELD_LAST });
	const transcript = makeTranscript(base.rows);
	reset({ transcript });
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
			cursor: `r${HELD_LAST - REOPEN_PAGE}`,
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	grow(transcript, HELD_LAST + 1, HELD_LAST + 30);
	// r150 is a tool row; the batch's page is that one row, so the only thing
	// the walk's first (tail) page shares with the batch is a tool entry.
	const only = transcript.page("r150", 1).entries;
	assert.equal(only.length, 1);
	const reads0 = historyReads();
	deliver(openFrame(3, true));
	deliver(
		snapshotFrame(4, { cursor: "r149", entries: only, coldReason: null }),
	);
	await pump();
	assert.equal(historyReads() - reads0, 1, "one tail read joined and reached");
});

test("R4-3: /clear while a loadOlder read is in flight is not undone by the page it returns", async () => {
	// `loadOlder`'s staleness test is the SESSION epoch, which `/clear` does not
	// move, so the 100 rows the read returns used to repaint the cleared pane.
	const base = longConversation({ awayRows: 0, total: 400 });
	const transcript = makeTranscript(base.rows);
	reset({ transcript });
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
			cursor: transcript.rows.at(-101).id,
			entries: transcript.tail(REOPEN_PAGE).entries,
			coldReason: null,
		}),
	);
	await pump();
	assert.equal(handle.transcript.hasMore, true);
	const release = [];
	const real = globalThis.__gapTail;
	globalThis.__gapTail = (request) =>
		new Promise((resolve) => release.push(() => resolve(real(request))));
	const pending = handle.loadOlder();
	await pump();
	assert.equal(release.length, 1, "the read is parked");
	handle.clearView();
	await pump();
	release.shift()();
	await pending;
	await pump();
	assert.equal(
		handle.transcript.records.length,
		0,
		"the page does not repaint what /clear removed",
	);
});

test("Q3-2: /clear while the reopen walk is in flight is not undone by the walk", async () => {
	const base = longConversation({ awayRows: 0, total: 400 });
	const transcript = makeTranscript(base.rows);
	reset({ transcript });
	const runtime = makeRuntime();
	let sessionId = SESSION_A;
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(sessionId, Boolean(sessionId));
		return handle;
	};
	runtime.rerender();
	const page = () => ({
		liveEvents: [],
		cursor: transcript.rows.at(-101).id,
		entries: transcript.tail(100).entries,
		coldReason: null,
	});
	deliver(openFrame(1, true));
	deliver(snapshotFrame(2, page()));
	await pump();
	sessionId = SESSION_B;
	runtime.rerender();
	await pump();
	grow(transcript, 401, 700);
	sessionId = SESSION_A;
	runtime.rerender();
	const release = [];
	const real = globalThis.__gapTail;
	globalThis.__gapTail = (request) =>
		request.beforeId === undefined
			? real(request)
			: new Promise((resolve) => release.push(() => resolve(real(request))));
	deliver(openFrame(9, true));
	deliver(snapshotFrame(10, page()));
	await pump();
	assert.ok(release.length > 0, "the walk has a read out");
	handle.clearView();
	await pump();
	for (let i = 0; i < 10 && release.length; i++) {
		release.shift()();
		await pump();
	}
	assert.equal(
		ids(handle.transcript).length,
		0,
		"nothing from the cleared history is painted back",
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

/* ------------------------------------- the readings a reconnect must not blank */

/*
 * The reported defect: while viewing a busy session the pane alternated between
 * a conversation-LOADING state - the send control unusable and NO composer
 * readouts at all - and the loaded state, at the stream's own cadence of ~1.5-4 s.
 *
 * The backend ends the stream that often for a busy session and answers every
 * reconnect with `open {gap: true}` (the bridge rotates its epoch on a cold
 * re-acquire), and this hook handled BOTH a `gap` frame and a gapped `open` by
 * clearing `frontend` - which is exactly what the readings strip renders
 * NOTHING for. So the four readings blanked and returned, once per reconnect.
 *
 * The cases below drive the REAL hook through those frame sequences and assert
 * on the readings expression the pane itself uses, in both directions: held
 * across a transient reconnect (R1), and still dropped by every terminal state
 * (R3) rather than held forever.
 */

/** The transport's own `end`, as main's relay and the dev proxy both emit it. */
function endStream() {
	const active = subscriptions.at(-1);
	assert.ok(active, "no subscription to end");
	active.onEvent({ kind: "end" });
}

/** The plan and the first snapshot every case here starts from. */
async function paneAtFirstSnapshot() {
	const plan = conversation({ withSteer: false, awayRows: 0 });
	const transcript = makeTranscript(plan.rows);
	reset({ transcript });
	const panel = await mount();
	const page = () => transcript.page(plan.cursor, SNAPSHOT_PAGE).entries;
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, { cursor: plan.cursor, entries: page(), liveEvents: [] }),
	);
	await pump();
	assert.ok(
		panel.readings(),
		"the first snapshot is what gives the pane its readings",
	);
	return { plan, page, panel };
}

test("a gap between two snapshots holds the readings instead of blanking the composer", async () => {
	const { plan, page, panel } = await paneAtFirstSnapshot();
	const painted = panel.readings();

	// The reconnect's own open, which is what a busy session answers with: the
	// bridge's epoch rotated, so the receipt cannot be replayed and the frame
	// says so. This is the frame that blanked the strip.
	deliver(openFrame(9, true));
	await pump();
	assert.equal(
		panel.readings(),
		painted,
		"the readings a reconnect must not blank are still the ones it painted",
	);
	assert.equal(
		panel.handle().frontend,
		null,
		"while the AUTHORITATIVE frontend is still dropped, so the replacement stream's frames are replay",
	);
	assert.equal(
		panel.status(),
		"reconnecting",
		"and the pane says the connection is not live, which is what keeps the hold honest",
	);
	assert.equal(
		panel.handle().heldFrontend,
		painted,
		"the hold is the snapshot's own object, not a copy that could drift from it",
	);
	/*
	 * AND THE PAIR THE CLAIM SURFACES READ KEEPS ITS STREAMING READING (operator
	 * incident, 2026-10-07): `(frontend ?? heldFrontend)?.streaming` is what
	 * `chat-page.tsx`'s `turnAlive` feeds the working line and the composer's
	 * hint, so the in-flight claim survives this whole gap - which is what the
	 * operator's flapping link showed it did NOT do. Asserted here, on the hook's
	 * own handle and in the same test as the hold, because `frontend` alone is
	 * deliberately null through a gap and the two facts stand or fall together:
	 * a hold that lost its `streaming` reading would blank the claim just as
	 * surely as one that was never taken.
	 */
	assert.equal(
		(panel.handle().frontend ?? panel.handle().heldFrontend)?.streaming,
		true,
		"the hold keeps a streaming reading for the claim surfaces while the frontend is null",
	);
	/*
	 * AND THE SESSION IS NOT REPORTED MISSING, which is the whole of the
	 * composer's refusal on this path: the pane's `unavailable` is
	 * `sessionGone || view.missing`, and `view.missing` is written by the 404 arm
	 * alone. A gap reaching it would refuse the composer's input for a
	 * conversation that is still there, so this is the assertion that keeps R1's
	 * fix from being about looks only.
	 */
	assert.equal(
		panel.handle().missing,
		false,
		"a reconnect is not a conversation this machine does not have",
	);

	// Live again, then the server's own `gap` FRAME - the other door into the same
	// state, and the one a stream that dies mid-flight leaves behind. Deliberately
	// with no replacement snapshot after it: the hold has to survive the window
	// where nothing has answered yet, which is the whole of the operator's wait.
	deliver(openFrame(10, false));
	deliver(
		snapshotFrame(11, { cursor: plan.cursor, entries: page(), liveEvents: [] }),
	);
	await pump();
	assert.equal(panel.status(), "live", "the reconnect's snapshot lands");
	const relaid = panel.readings();

	deliver({ session_id: SESSION_A, type: "gap" });
	await pump();
	assert.equal(
		panel.readings(),
		relaid,
		"a bare gap frame does not blank the readings either",
	);
	assert.equal(panel.status(), "reconnecting", "and it is what says so");
});

test("a fresh snapshot replaces the held readings wholesale", async () => {
	const { plan, page, panel } = await paneAtFirstSnapshot();
	const painted = panel.readings();
	deliver(openFrame(9, true));
	await pump();
	assert.equal(panel.readings(), painted, "the hold is in place");

	const second = snapshotFrame(10, {
		cursor: plan.cursor,
		entries: page(),
		liveEvents: [],
	});
	/*
	 * The owner's own new values, so "replaced wholesale" is falsifiable: a merge
	 * that kept the held context reading would satisfy a test that only asserted
	 * the hold was still there.
	 */
	second.payload.frontend.snapshot.context_tokens = 4321;
	second.payload.frontend.snapshot.conversation_title =
		"Conversation A, resumed";
	deliver(second);
	await pump();

	const readings = panel.readings();
	assert.equal(
		readings,
		panel.handle().frontend,
		"the held copy IS the painted frontend once a snapshot lands",
	);
	assert.equal(readings.context_tokens, 4321, "with the new snapshot's value");
	assert.equal(
		readings.conversation_title,
		"Conversation A, resumed",
		"and its title",
	);
	assert.deepEqual(
		Object.keys(readings).sort(),
		Object.keys(second.payload.frontend.snapshot).sort(),
		"and the snapshot's own field set, with nothing of the held copy merged in",
	);
});

test("a 404 for the session still clears the held readings", async () => {
	const { panel } = await paneAtFirstSnapshot();
	deliver(openFrame(9, true));
	await pump();
	assert.ok(panel.readings(), "the readings are held across the reconnect");

	const active = subscriptions.at(-1);
	assert.ok(active, "the subscription the failure is reported on");
	active.onEvent({ kind: "error", status: 404, detail: "no such session" });
	await pump();

	assert.equal(panel.handle().missing, true, "the failure is the terminal one");
	assert.equal(panel.status(), "unavailable", "and the pane says so");
	assert.equal(
		panel.readings(),
		null,
		"a conversation this host does not have has no readings to hold, and holding them would describe a session that does not exist",
	);
});

test("a spent retry budget still clears the held readings", async () => {
	const { panel } = await paneAtFirstSnapshot();
	deliver(openFrame(9, true));
	await pump();
	assert.ok(panel.readings(), "the readings are held across the reconnect");

	// The budget is the hook's own (`STREAM_RETRY_DELAYS_MS`), so this walks it
	// rather than restating the count: the claim is about the state the pane ends
	// in, not about how many attempts it takes to get there.
	for (let i = 0; i < 12 && panel.status() !== "unavailable"; i++) {
		endStream();
		await pump();
	}

	assert.equal(
		panel.status(),
		"unavailable",
		"the stream failed its way through the whole retry budget",
	);
	assert.ok(panel.handle().failure, "and the pane has the sentence for it");
	assert.equal(
		panel.readings(),
		null,
		"the readings go with the budget: a reading held past it would be the only thing still claiming a stream",
	);
});

test("a session change drops the held readings", async () => {
	const plan = conversation({ withSteer: false, awayRows: 0 });
	const transcript = makeTranscript(plan.rows);
	reset({ transcript });
	let sessionId = SESSION_A;
	const panel = await mount(() => sessionId);
	const page = () => transcript.page(plan.cursor, SNAPSHOT_PAGE).entries;
	deliver(openFrame(1, true));
	deliver(
		snapshotFrame(2, { cursor: plan.cursor, entries: page(), liveEvents: [] }),
	);
	await pump();
	const painted = panel.readings();
	assert.ok(painted, "the conversation's readings are painted");
	assert.equal(
		panel.handle().heldFrontend,
		painted,
		"and mirrored into the hold",
	);

	// The switch itself: the panel is keyed by identity, so this is a fresh mount
	// with a new argument rather than a mutation of the old view.
	sessionId = SESSION_B;
	panel.rerender();
	await pump();

	assert.equal(
		panel.handle().heldFrontend,
		null,
		"another conversation's model, effort, context and spend must not be held on this one",
	);
	assert.equal(
		panel.handle().frontend,
		null,
		"and the authoritative frontend goes with it, as it always did",
	);
	assert.equal(
		panel.readings(),
		null,
		"so the composer draws nothing until this conversation reports",
	);
});

test("/clear drops the held readings and leaves the live ones alone", async () => {
	const { panel } = await paneAtFirstSnapshot();
	const painted = panel.readings();
	assert.equal(panel.handle().heldFrontend, painted, "the hold is in place");

	panel.handle().clearView();
	await pump();

	assert.equal(
		panel.handle().heldFrontend,
		null,
		"a cleared view deliberately has nothing behind it, so the hold goes with it",
	);
	assert.equal(
		panel.handle().frontend,
		painted,
		"while the live snapshot is untouched - /clear is view-only",
	);
	assert.equal(
		panel.readings(),
		painted,
		"and the composer's readings are unaffected: they come from the live frontend",
	);
});

/* ------------------------------------------- the older-page ask, through the hook */

/*
 * Loader-continuity round 1 (R1-3, R1-6a). The reducer and loader suites
 * (`transcript-cursor-continuity`, `loader-state-machine`) drive the loader over
 * a fake reader; these cases drive the SHIPPED hook, because two of the things
 * they promise live in the hook and nowhere else: the failed row's single writer
 * (`olderFailed`, written from the outcome of ANY caller) and the meaning of
 * "the conversation on screen" for a page still in flight (a per-visit epoch,
 * not the session id).
 */

/** A pane on a 600-row conversation whose snapshot holds only the newest page. */
async function pagedPane({ olderRead }) {
	const plan = longConversation({ awayRows: 0, total: 600 });
	const transcript = makeTranscript(plan.rows);
	reset({ transcript });
	// The older-page reads are the case's to script (fail, hold, answer); the
	// tail reads keep answering as the journal does.
	globalThis.__gapTail = (request) =>
		request.beforeId === undefined
			? transcript.tail(request.limit)
			: olderRead(request, transcript);
	let sessionId = SESSION_A;
	const panel = await mount(() => sessionId);
	const snapshot = (seq) => {
		deliver(openFrame(seq, true));
		deliver(
			snapshotFrame(seq + 1, {
				cursor: plan.cursor,
				entries: transcript.page(plan.cursor, SNAPSHOT_PAGE).entries,
				liveEvents: [],
			}),
		);
	};
	snapshot(1);
	await pump();
	return {
		plan,
		transcript,
		panel,
		snapshot,
		switchTo: async (next) => {
			sessionId = next;
			panel.rerender();
			await pump();
		},
	};
}

const olderReads = () =>
	requests.filter(
		(request) =>
			request.op === "sessions.history" && request.beforeId !== undefined,
	);

test("olderFailed is written from a failed page whoever asked, and only an applied page clears it", async () => {
	let fail = true;
	const { panel } = await pagedPane({
		olderRead: (request, journal) => {
			if (fail) throw new Error("history unavailable");
			return journal.pageBefore(request.beforeId, request.limit);
		},
	});
	assert.equal(
		panel.handle().olderFailed,
		false,
		"a fresh pane has not failed",
	);

	// Not the scroll pump: the align fetch, the jump walk and the mentioned-files
	// scan all call this same function, and the row must still reach the reader.
	const failed = await panel.handle().loadOlderDetailed();
	await pump();
	assert.deepEqual(failed, { kind: "failed", reason: "request" });
	assert.equal(panel.handle().olderFailed, true, "a real failure is painted");

	fail = false;
	const held = panel.handle().transcript.oldestId;
	const applied = await panel.handle().loadOlderDetailed();
	await pump();
	assert.equal(applied.kind, "applied");
	assert.notEqual(panel.handle().transcript.oldestId, held, "the cursor moved");
	assert.equal(
		panel.handle().olderFailed,
		false,
		"an applied page clears the failed row",
	);
});

test("olderFailed is cleared by /clear and by a session switch", async () => {
	const { panel, snapshot, switchTo } = await pagedPane({
		olderRead: () => {
			throw new Error("history unavailable");
		},
	});
	await panel.handle().loadOlderDetailed();
	await pump();
	assert.equal(panel.handle().olderFailed, true);

	panel.handle().clearView();
	await pump();
	assert.equal(
		panel.handle().olderFailed,
		false,
		"/clear discards the rows the failure described",
	);

	// A failure again (a fresh snapshot gives the pane a cursor to ask from),
	// then the reader leaves: the failure belongs to the journal it happened on.
	snapshot(20);
	await pump();
	await panel.handle().loadOlderDetailed();
	await pump();
	assert.equal(panel.handle().olderFailed, true, "the failure is back");
	await switchTo(SESSION_B);
	assert.equal(
		panel.handle().olderFailed,
		false,
		"a failure belongs to the journal it happened on",
	);
});

test("a lost race never sets olderFailed, even when the abandoned request then rejects", async () => {
	let reject;
	const gate = new Promise((_, fail) => {
		reject = fail;
	});
	const { panel, switchTo } = await pagedPane({
		olderRead: async () => {
			await gate;
		},
	});
	const pending = panel.handle().loadOlderDetailed();
	await settle();
	await switchTo(SESSION_B);
	reject(new Error("history unavailable"));
	await pending;
	await pump();
	assert.equal(
		panel.handle().olderFailed,
		false,
		"a request for the conversation the reader left says nothing about this one",
	);
});

test("a page still out for A when the reader goes A -> B -> A is dropped, and cannot seed the returning view's cursor", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const { panel, plan, snapshot, switchTo } = await pagedPane({
		olderRead: async (request, journal) => {
			await gate;
			return journal.pageBefore(request.beforeId, request.limit);
		},
	});
	const before = panel.handle().transcript.oldestId;
	const pending = panel.handle().loadOlderDetailed();
	await settle();
	assert.equal(olderReads().length, 1, "the page is out");

	await switchTo(SESSION_B);
	await switchTo(SESSION_A);
	// The returning view's transcript starts empty (or from the paint cache);
	// the old page then lands on it.
	release();
	const outcome = await pending;
	await pump();
	assert.equal(
		outcome.kind,
		"stale",
		"the page belongs to the previous visit, whatever the session id says",
	);

	// The returning view's own snapshot is what defines its cursor: it must be
	// the newest page's first entry, not the deep page the stale ask carried.
	snapshot(30);
	await pump();
	const oldest = panel.handle().transcript.oldestId;
	assert.equal(
		oldest,
		plan.rows[plan.rows.length - SNAPSHOT_PAGE].id,
		`the cursor comes from the snapshot, not the stale page (was ${before}, now ${oldest})`,
	);
});
