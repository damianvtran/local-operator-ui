import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Opening a conversation with a turn in flight: every tool row must end up
 * showing its COMMAND, and the edit rows their `+N -M`, without the reader
 * scrolling. Two reported symptoms, one open path, both through the shipped
 * hook (frames -> flush -> `applyHistoryPage` + `applyLiveSeed` -> the label
 * read-back):
 *
 *   1. A run of `bash  … {"text": 200, "solo_cpu": 0.08…` rows — the output
 *      stand-in (`outputFallbackLine`) painted where the command belongs,
 *      because the seed's `tool_execution_end` frames carry no arguments and the
 *      read-back that should find them stopped short.
 *   2. An `edit` row with no `+91 -19` whose expansion still held the diff: the
 *      seed's end re-applied over the durable row with `details: null`.
 *
 * THE FIXTURE IS THE REAL SESSION (`scripts/fixtures/seed-label-gap.json`), cut
 * from a copy of `~/.local-operator/sessions/<session>/transcript.jsonl`, the
 * conversation this PR reports, whose id is a placeholder here for the same reason
 * `derivation` in the fixture does not record it —
 * one turn of assistant / tool / `session_spend.v1` repeating. `derivation` in
 * the file states every transform. Two moments are carried:
 *
 *   - `labels`: the join after journal row 407, 134 calls into the turn. The
 *     seed is the turn's newest 100 settled calls, bounded by the backend's OWN
 *     `_bound_live_events_in_place` (run over the journal's results, not
 *     re-implemented), so 68 of its calls are older than the snapshot's
 *     100-entry page. With the old rule (2 entries per call, stop on connect)
 *     the first read of 236 rows left 23 of them labelled only by their output;
 *   - `counts`: the join after row 471, whose page holds the `edit` of
 *     `subagent.py` with durable `details = {added: 91, removed: 19, diff}` and
 *     whose seed end for the same call has `details: null` — the bound strips
 *     any `details` over a quarter of the 560-char share.
 *
 * The backend stub below is the route's own contract (`before_id` exclusive, no
 * cursor is the tail, `has_more`), serving the fixture's journal truncated at
 * the moment, and it counts every `sessions.history` request so the cost of
 * the fix is asserted, not described.
 */

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/seed-label-gap.json", import.meta.url),
		"utf8",
	),
);

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
 *
 * `now` is the one clock the reducer cannot be starved of: the test's arrival
 * instant is `Date.now()` and it is the time a seeded row must NOT be painted
 * at, so it is left alone rather than pinned.
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
/*
 * Timers are CAPTURED rather than dropped, and still never fire on their own: a
 * test that wants one (the first-paint hold's own cap, `labelHoldMaxMs`) fires it
 * by delay with `fireTimers`. Everything else the hook arms — the snapshot
 * deadline, the stream backoff, the hidden-window flush — stays queued, which is
 * what the earlier version of this stub did by discarding them.
 */
let timers = [];
globalThis.window = {
	setTimeout: (fn, delay) => {
		fallbackSeq += 1;
		timers.push({ id: fallbackSeq, fn, delay, cleared: false });
		return fallbackSeq;
	},
	clearTimeout: (id) => {
		const timer = timers.find((entry) => entry.id === id);
		if (timer) timer.cleared = true;
	},
};

/** Run every still-armed timer whose delay is exactly `delay` (fake timers). */
function fireTimers(delay) {
	for (const timer of timers) {
		if (timer.delay !== delay || timer.cleared) continue;
		timer.cleared = true;
		timer.fn();
	}
}

/* ------------------------------------------------------------- the transport */

const subscriptions = [];
const requests = [];

globalThis.__seedSubscribe = (args, onEvent) => {
	const entry = { args, onEvent, disposed: false };
	subscriptions.push(entry);
	return () => {
		entry.disposed = true;
	};
};
globalThis.__seedRequest = async (request) => {
	requests.push(request);
	if (request.op === "sessions.history") {
		/*
		 * The backend's own reader: no cursor is the TAIL, `before_id` is
		 * exclusive. Served from the case's durable rows rather than from the
		 * fixture, because the cases below disagree about what is durable when
		 * the page was read — which is the point of the last one.
		 */
		const rows = globalThis.__seedDurable;
		if (request.beforeId === undefined) {
			const start = Math.max(0, rows.length - request.limit);
			return {
				entries: rows.slice(start),
				has_more: start > 0,
				cursor_missing: false,
			};
		}
		const end = rows.findIndex((entry) => entry.id === request.beforeId);
		const start = Math.max(0, (end < 0 ? rows.length : end) - request.limit);
		return {
			entries: rows.slice(start, end < 0 ? undefined : end),
			has_more: start > 0,
			cursor_missing: false,
		};
	}
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
			/*
			 * The namespace as well as the named export, because this file is run
			 * against BOTH trees: the round-1 additions (the conversation-scoped
			 * bookkeeping, the request cap, the hold's cap) do not exist on
			 * origin/main, where a named import of one would fail the whole bundle
			 * rather than the case that needs it. reconcileLimit and
			 * applyHistoryPage are old enough to name directly.
			 */
			export * as sessionModule from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { __resetPaintCache } from "./src/renderer/src/shared/store/paint-cache";
			export { EMPTY_TRANSCRIPT, applyHistoryPage, reconcileLimit } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export { outputFallbackLine } from "./src/renderer/src/features/chat/components/trace/tool-row-model";
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
			name: "seed-label-gap-fixture",
			setup(builder) {
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "seed-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "seed-fixture" }, () => ({
					contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {};
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__seedRequest(request);
						export const subscribeDesktopStream = (args, onEvent) => globalThis.__seedSubscribe(args, onEvent);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "seed-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "seed-react" }, () => ({
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
	useCanonicalSessionsStore,
	sessionModule,
	__resetPaintCache,
	outputFallbackLine,
	reconcileLimit,
} = hook;

/*
 * The round-1 constants, read through the namespace so a run against a tree
 * without them still builds. The fallbacks are the HEAD values, deliberately: a
 * case that needs a bound `origin/main` does not have should fail on what main
 * DOES, not on a `undefined`.
 */
const __resetLabelGapBookkeeping =
	sessionModule.__resetLabelGapBookkeeping ?? (() => {});
const RECONCILE_WALK_MAX_REQUESTS =
	sessionModule.RECONCILE_WALK_MAX_REQUESTS ?? 6;
const RECONCILE_WALK_MAX_ROWS = sessionModule.RECONCILE_WALK_MAX_ROWS ?? 500;
const LABEL_HOLD_MAX_MS = sessionModule.LABEL_HOLD_MAX_MS ?? 0;

// The fixture's conversation, by placeholder: the real id is the operator's, not
// this public repository's, and nothing here reads the value as an id.
const SESSION = "<session>";

/* ------------------------------------------- the React stand-in (one cell per call) */

/*
 * The same cell-based stand-in `reconnect-page-gap.test.mjs` and the composer
 * cases in `echo-delivery.test.mjs` use: one cell per hook call, a setter that
 * re-renders, dep-gated effects. It does NOT model React's scheduler, batching
 * or commit timing - which is why nothing here asserts on a FRAME, only on
 * transcript state after a stated sequence.
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

const openFrame = (seq, gap) => ({
	session_id: SESSION,
	epoch: "bridge-epoch",
	seq,
	type: "open",
	payload: { subscription_id: `sub-${seq}`, gap, watch_ttl_seconds: 45 },
});

/**
 * A snapshot of a conversation whose turn has ENDED.
 *
 * `streaming` is the wire's own statement about whether a turn is in flight and
 * it is the field the fix reads, so it is a parameter: the real open this
 * fixture comes from carried `false` (`refresh_from_session` republishes it
 * from the live session whenever a viewer attaches), while the mid-turn join
 * the seed is defined for carries `true`.
 */
const snapshotFrame = (seq, { entries, liveEvents, streaming }) => ({
	session_id: SESSION,
	epoch: "bridge-epoch",
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch: "owner-epoch",
			sequence: seq,
			live_cursor: entries.at(-1)?.id ?? "",
			snapshot: {
				epoch: "owner-epoch",
				sequence: seq,
				cwd: "/tmp/probe",
				conversation_title: "Subagent performance",
				conversation_title_user_set: true,
				conversation_title_forked: false,
				goal: "",
				active_agent: "",
				active_team: "",
				selected_model: null,
				effective_model: null,
				streaming,
				generation: 1,
				pending_gate: null,
				history_cursor: entries.at(-1)?.id ?? "",
				live_events: liveEvents,
				live_tool_started_at: {},
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
		history: {
			entries,
			has_more: true,
			cursor_missing: false,
		},
		cold: false,
	},
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

/** The durable rows at a moment, and the call ids its seed names in order. */
function moment(name) {
	const at = fixture.moments[name];
	const durable = fixture.journal.slice(0, at.journal_rows);
	return {
		durable,
		page: durable.slice(-100),
		liveEvents: at.live_events,
	};
}

/** Calls the page cannot label: the seed's settled calls no page row names. */
function unlabelledIn(page, liveEvents) {
	const named = new Set(
		page.flatMap((entry) =>
			(entry.payload.tool_calls ?? []).map((call) => call.id),
		),
	);
	return liveEvents
		.map((event) => event.tool_call_id)
		.filter((callId) => !named.has(callId));
}

async function open({
	page,
	liveEvents,
	durable,
	beforePump,
	/*
	 * The label bookkeeping is per CONVERSATION and survives a mount, because a
	 * session switch unmounts the pane (round 1, QA Q1). A test that opens the
	 * same conversation twice therefore means one of two things and has to say
	 * which: two separate JOINS (the default, bookkeeping cleared) or a switch
	 * AWAY AND BACK (`keepGapBookkeeping: true`, the second mount meeting rows
	 * this window has already painted).
	 */
	keepGapBookkeeping = false,
}) {
	__resetPaintCache();
	if (!keepGapBookkeeping) __resetLabelGapBookkeeping();
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	timers = [];
	globalThis.__seedDurable = durable;
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION, true);
		return handle;
	};
	runtime.rerender();
	deliver(openFrame(1, false));
	deliver(snapshotFrame(2, { entries: page, liveEvents, streaming: true }));
	// The first frame the reader sees, before any read has come back: the
	// flush has painted the snapshot and fired the read, and nothing else.
	const callbacks = rafQueue;
	rafQueue = [];
	for (const callback of callbacks) callback();
	beforePump?.(handle);
	await pump();
	return { handle: () => handle, runtime };
}

const historyReads = () =>
	requests.filter((request) => request.op === "sessions.history");

/** What the object column paints for one tool record, given the view. */
const objectColumn = (record, pending) =>
	record.args
		? "args"
		: outputFallbackLine(record.output, pending.has(record.toolCallId));

test("every seeded call of a long turn is labelled by the read the open fires", async () => {
	const { durable, page, liveEvents } = moment("labels");
	const missing = unlabelledIn(page, liveEvents);
	assert.equal(
		missing.length,
		68,
		"the fixture still carries the reported gap",
	);

	const { handle } = await open({ page, liveEvents, durable });
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	const unlabelled = missing.filter((callId) => {
		const record = tools.find((entry) => entry.toolCallId === callId);
		return !record?.args;
	});
	assert.deepEqual(
		unlabelled,
		[],
		`${unlabelled.length} of ${missing.length} seeded calls still paint their output where the command belongs`,
	);
	/*
	 * The cost, asserted: ONE read, sized to reach the oldest missing call
	 * (`reconcileLimit(68) = 100 + ceil(3.25 * 68) = 321`; the call needs 307).
	 */
	const reads = historyReads();
	assert.equal(reads.length, 1, "one request labels the whole gap");
	assert.equal(reads[0].beforeId, undefined, "and it is the journal's tail");
	assert.equal(reads[0].limit, 321);
});

/**
 * The `labels` journal with two `session_spend.v1`-shaped rows after every
 * assistant row that names a missing call: the same bursts of state rows a real
 * session writes, dense enough that no per-call ratio sizes the first read right.
 */
function padded(durable, missing) {
	const out = [];
	for (const entry of durable) {
		out.push(entry);
		const named = (entry.payload.tool_calls ?? []).some((call) =>
			missing.has(call.id),
		);
		if (!named) continue;
		for (let i = 0; i < 2; i++)
			out.push({
				id: `${entry.id.slice(0, 28)}pad${i}`,
				ts: entry.ts,
				type: "custom",
				payload: { custom_type: "session_spend.v1", details: {} },
			});
	}
	return out;
}

test("a first read that falls short keeps walking back until every call is labelled", async () => {
	/*
	 * The walk rule on its own. The old walk stopped as soon as a page CONNECTED
	 * to the painted rows, which a tail read does long before it reaches the
	 * oldest missing call; the new one keeps paging with `before_id` until that
	 * call's assistant row is in hand.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const missing = new Set(unlabelledIn(page, liveEvents));
	const { handle } = await open({
		page,
		liveEvents,
		durable: padded(durable, missing),
	});
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	const unlabelled = [...missing].filter(
		(callId) => !tools.find((entry) => entry.toolCallId === callId)?.args,
	);
	assert.deepEqual(
		unlabelled,
		[],
		`${unlabelled.length} calls left unlabelled`,
	);
	const reads = historyReads();
	assert.ok(reads.length >= 2, "the first read fell short, so the walk paged");
	for (const read of reads.slice(1))
		assert.ok(
			read.beforeId,
			"and every further page walks BACK, never re-reads the tail",
		);
	const total = reads.reduce((sum, read) => sum + read.limit, 0);
	assert.ok(total <= 500, `bounded by RECONCILE_WALK_MAX_ROWS (read ${total})`);
});

test("the first frame holds the stand-in back until the label read settles", async () => {
	const { durable, page, liveEvents } = moment("labels");
	const missing = unlabelledIn(page, liveEvents);
	let firstFrame = null;
	const { handle } = await open({
		page,
		liveEvents,
		durable,
		beforePump: (view) => {
			firstFrame = {
				pending: view.labelPending ?? new Set(),
				tools: view.transcript.records.filter(
					(record) => record.kind === "tool",
				),
			};
		},
	});
	assert.ok(firstFrame, "the first frame was observed");
	for (const callId of missing)
		assert.ok(
			firstFrame.pending.has(callId),
			`${callId} is held on the first frame`,
		);
	// No seeded row paints result text in the command column on the first frame.
	const standIns = firstFrame.tools.filter((record) =>
		objectColumn(record, firstFrame.pending)?.startsWith("… "),
	);
	assert.deepEqual(
		standIns.map((record) => record.toolCallId),
		[],
		"no output stand-in on the first frame",
	);
	assert.equal(handle().labelPending.size, 0, "the hold ends with the read");
});

test("a read that cannot find a call's arguments gives the stand-in back", async () => {
	/*
	 * The hold lasts one read, never longer. Serve a journal that no longer holds
	 * the missing calls' assistant rows, and once the walk has run out those rows
	 * must show their stand-in exactly as before this change — the hold is not a
	 * way of hiding a row forever.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const missing = new Set(unlabelledIn(page, liveEvents));
	const pruned = durable.filter(
		(entry) =>
			!(entry.payload.tool_calls ?? []).some((call) => missing.has(call.id)),
	);
	const { handle } = await open({ page, liveEvents, durable: pruned });
	const view = handle();
	assert.equal(view.labelPending.size, 0, "the hold is released");
	const tools = view.transcript.records.filter(
		(record) => record.kind === "tool" && missing.has(record.toolCallId),
	);
	assert.ok(
		tools.length > 0,
		"the rows are painted from the durable tool rows",
	);
	const standIns = tools.filter((record) =>
		objectColumn(record, view.labelPending)?.startsWith("… "),
	);
	assert.ok(
		standIns.length > 0,
		"and a row with output falls back to its stand-in",
	);
	const reads = historyReads();
	assert.ok(
		reads.reduce((sum, read) => sum + read.limit, 0) <= 500,
		"within the walk's bound",
	);
});

test("a round-end retry reads at least as deep as the walk that missed", async () => {
	/*
	 * The retry rule. A round end re-asks for the calls still unlabelled, and
	 * those are the OLDEST of the gap: the newer ones were labelled by the first
	 * read. It used to be sized `reconcileLimit(remaining)`, which shrinks as the
	 * gap closes, so it could not reach the calls it was for — on the reported
	 * session it labelled none. Here the walk's SECOND page fails (and its one
	 * immediate retry), so the first walk ends part-way; the round-end retry must
	 * start no shallower than the rows that walk already read, and finish the job.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const missing = new Set(unlabelledIn(page, liveEvents));
	const journal = padded(durable, missing);
	let failing = 2;
	const serve = globalThis.__seedRequest;
	globalThis.__seedRequest = async (request) => {
		if (
			request.op === "sessions.history" &&
			request.beforeId !== undefined &&
			failing > 0
		) {
			failing -= 1;
			requests.push(request);
			throw new Error("history unavailable");
		}
		return serve(request);
	};
	try {
		const { handle } = await open({ page, liveEvents, durable: journal });
		const first = historyReads();
		const firstDepth = first[0].limit;
		const tools = () =>
			handle().transcript.records.filter((record) => record.kind === "tool");
		const left = [...missing].filter(
			(callId) => !tools().find((entry) => entry.toolCallId === callId)?.args,
		);
		assert.ok(
			left.length > 0,
			"the failed page left the oldest calls unlabelled",
		);
		requests.length = 0;
		deliver({
			session_id: SESSION,
			epoch: "bridge-epoch",
			seq: 3,
			type: "event",
			payload: { type: "turn_end" },
		});
		await pump();
		const retry = historyReads();
		assert.ok(retry.length >= 1, "the round end retried");
		assert.ok(
			retry[0].limit >= firstDepth,
			`the retry reads ${retry[0].limit}, not less than the ${firstDepth} rows already read`,
		);
		const still = left.filter(
			(callId) => !tools().find((entry) => entry.toolCallId === callId)?.args,
		);
		assert.deepEqual(
			still,
			[],
			`${still.length} calls the retry did not reach`,
		);
	} finally {
		globalThis.__seedRequest = serve;
	}
});

test("a stripped seed end keeps the durable +N -M on an edit row", async () => {
	const { durable, page, liveEvents } = moment("counts");
	const callId = "toolu_01U3Y21CrbaP1HVMGcKMapJu";
	const durableRow = page.find(
		(entry) => entry.payload.tool_call_id === callId,
	);
	assert.deepEqual(
		[
			durableRow.payload.provider_payload.details.added,
			durableRow.payload.provider_payload.details.removed,
		],
		[91, 19],
		"the page carries the durable counts",
	);
	const seeded = liveEvents.find((event) => event.tool_call_id === callId);
	assert.equal(seeded.result.details, null, "and the seed's end was stripped");

	const counts = (view) => {
		const row = view.transcript.records.find(
			(record) => record.id === `tool:${callId}`,
		);
		return { diff: row.diff?.length ?? 0, pill: [row.added, row.removed] };
	};
	let firstFrame = null;
	const { handle, runtime } = await open({
		page,
		liveEvents,
		durable,
		beforePump: (view) => {
			firstFrame = counts(view);
		},
	});
	/*
	 * The FIRST frame is where the reader saw it: the page paints `+91 -19` and
	 * the seed's end, folded straight after it in the same flush, wrote 0/0 over
	 * it while `preferDiff` kept the body.
	 */
	assert.ok(firstFrame.diff > 0, "the diff body survives (it always did)");
	assert.deepEqual(
		firstFrame.pill,
		[91, 19],
		"first frame: the counts survive",
	);
	assert.deepEqual(
		counts(handle()).pill,
		[91, 19],
		"settled: the counts survive",
	);
	/*
	 * And a LATER snapshot (a reconnect, or clicking back into the conversation)
	 * whose seed is the same: every call is labelled by now, so it fires no read
	 * that could repaint the durable row, and the stripped end is the last word.
	 */
	deliver(snapshotFrame(4, { entries: page, liveEvents, streaming: true }));
	await pump();
	runtime.rerender();
	assert.deepEqual(
		counts(handle()).pill,
		[91, 19],
		"a re-applied seed does not blank them either",
	);
});

/* ------------------------------------------------------------------ round 1 */

/*
 * Filler rows with no tool results, so no page boundary can cut a call in two
 * and no orphan (see the Q4 case below) can appear in a journal built for
 * another question. `session_spend.v1` is the shape a real turn writes once per
 * round, and it projects to nothing.
 */
const spendRow = (id, ts) => ({
	id,
	ts,
	type: "custom",
	payload: { custom_type: "session_spend.v1", details: {} },
});

const userRow = (id, ts) => ({
	id,
	ts,
	type: "message",
	payload: {
		kind: "message",
		role: "user",
		content: [{ text: "task" }],
		producer_command_id: "cmd",
	},
});

const assistantRow = (id, ts, calls) => ({
	id,
	ts,
	type: "message",
	payload: {
		kind: "message",
		role: "assistant",
		content: [{ text: "working" }],
		stop_reason: "toolUse",
		tool_calls: calls.map(([callId, command]) => ({
			id: callId,
			name: "bash",
			arguments: { command, i: "why" },
		})),
	},
});

const toolRow = (id, ts, callId, output) => ({
	id,
	ts,
	type: "message",
	payload: {
		kind: "message",
		role: "tool",
		tool_call_id: callId,
		content: [{ text: output }],
		provider_payload: { duration_s: 0.2, details: null },
	},
});

/** One settled end frame, as the owner's live seed carries it (no arguments). */
const endFrame = (callId, output, at = 2_000) => ({
	type: "tool_execution_end",
	tool_call_id: callId,
	tool_name: "bash",
	result: { content: [{ text: output }], details: null },
	duration_s: 0.2,
	is_error: false,
	started_at_epoch: at,
});

/** A call id no page can ever name: the shape a replay of a pruned turn leaves. */
const UNPRESENT = "toolu_01SYNTHETICNOTINJOURNAL000";

/*
 * ROUND 4, R11: the veto is narrow, and these pin it. A `tool_call_compose` with
 * `dictation_complete` and NO `not_run_reason` is a call still waiting at a gate —
 * the backend keeps it in the seed until its own `tool_execution_start` replaces it,
 * and its assistant row is written when the round closes, so no page can name it
 * yet. Refusing the floor for one turned the whole walk's floor off, which is the
 * cost class QA ruled FAIL (minor) in round 2: measured on the round-4 head, the
 * two shapes below cost 2 reads / 429 rows and 4 / 431 where they had cost 1 / 325
 * and 1 / 107.
 */
const PENDING_COMPOSE = "toolu_01PENDINGGATECALLNOTRUNYET";
const pendingCompose = () => ({
	type: "tool_call_compose",
	tool_call_id: PENDING_COMPOSE,
	tool_name: "bash",
	dictation_complete: true,
});

/**
 * A settled end whose producer states NO clock — what a backend older than v0.57.0
 * sends, or what a viewer that joined after the call started sees. The call DID run,
 * so a page may hold the assistant row that labels it (round 6, R16).
 */
const endFrameWithoutStart = (callId, output) => ({
	type: "tool_execution_end",
	tool_call_id: callId,
	tool_name: "bash",
	result: { content: [{ text: output }], details: null },
	duration_s: 0.2,
	is_error: false,
});

/**
 * The orphan on the edge of a 107-row page (the size `reconcileLimit(2)` asks for):
 * its result row is journal index 300 and its assistant row 299, outside the page.
 */
const ORPHAN_ON_107_ROW_PAGE = "toolu_014TGCtWm8PFXDecV1fpz9n8";

/**
 * The fixture's own tail-page orphan: the call whose RESULT is the oldest row of
 * the `labels` moment's first 104-row page, its assistant row being one row older
 * (journal index 302) and so outside that page (R6a's shape).
 */
const ORPHAN_ON_TAIL_PAGE = "toolu_01JqcAjwSyFQxRL4Th77FneZ";

/**
 * A call the earlier turn named, at journal index 98 of the `labels` moment — one
 * turn beyond the first two pages, so a walk that means to label it has to reach it.
 */
const EARLIER_TURN_CALL = "toolu_01SDbpziaz9MBtxwosfMLe2d";

test("a join whose targets cannot be durable yet stops at the turn boundary", async () => {
	/*
	 * ROUND 1, R1, ON THE SHAPE THAT CASE ACTUALLY BUILDS — which round 2's N3 was
	 * right about: this journal's current turn opens 50 rows above the tail (150
	 * rows of an earlier turn, then `turn-user`, then 49 rows), i.e. the shape a
	 * join during a turn's FIRST round makes, and its whole turn is 50 rows long.
	 * So it discriminates on the TURN BOUNDARY, not on R1's own input: R1's journal
	 * is ONE long turn (the fixture's, whose opening row is at index 3), where there
	 * is no boundary row for a page to meet. That shape is the case after this one,
	 * bounded by the calls' own start instants instead.
	 *
	 * Here: the seed names a call whose assistant row the journal does not hold, so
	 * no page can ever label it and `labelTargetsBehind` finds no anchor. The walk
	 * used to read that as "everything is further back" and page to its bound; the
	 * row that OPENED the turn ends it, because no call of this turn was journaled
	 * before it. Main pays two reads on this journal; head pays one.
	 */
	const rows = [];
	for (let i = 0; i < 150; i++) rows.push(spendRow(`earlier-${i}`, 1_000 + i));
	rows.push(userRow("turn-user", 1_500));
	for (let i = 0; i < 49; i++) rows.push(spendRow(`turn-${i}`, 1_600 + i));
	const liveEvents = [endFrame(UNPRESENT, "nothing durable names this call")];
	const page = rows.slice(-100);

	const { handle } = await open({ page, liveEvents, durable: rows });
	const reads = historyReads();
	assert.equal(
		reads.length,
		1,
		"the turn boundary ends the walk after one page",
	);
	assert.equal(reads[0].beforeId, undefined, "and that page is the tail");
	assert.equal(
		reads[0].limit,
		reconcileLimit(1),
		"the read is sized by the goal, exactly as it was before this change",
	);
	assert.equal(
		handle().labelPending.size,
		0,
		"and the hold ended with that read rather than with the walk",
	);
});

test("a call nothing can label does not walk to the bound or raise the retry depth", async () => {
	/*
	 * ROUND 1, R1 + QA Q2. Two seeded ends no page names, against the reported
	 * session's own journal: the walk descends to the row that opened the turn
	 * (index 3 of 407) and stops there instead of reading to `has_more`, and - the
	 * half that costs every LATER read in the session - a walk that labelled
	 * nothing does not record its depth, so the round-end retry below starts from
	 * the goal's own size rather than from the 407 rows this walk happened to read.
	 */
	const { durable, page } = moment("labels");
	const liveEvents = [
		endFrame(UNPRESENT, "no page names this one", 1_790_000_000),
		endFrame(`${UNPRESENT}b`, "nor this one", 1_790_000_100),
	];
	const { handle } = await open({ page, liveEvents, durable });
	const reads = historyReads();
	assert.ok(
		reads.length <= RECONCILE_WALK_MAX_REQUESTS,
		`the walk made ${reads.length} requests, over the cap`,
	);
	const rowsRead = reads.reduce((sum, read) => sum + read.limit, 0);
	assert.ok(
		rowsRead <= RECONCILE_WALK_MAX_ROWS,
		`the walk read ${rowsRead} rows, over the bound`,
	);

	requests.length = 0;
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 3,
		type: "event",
		payload: { type: "turn_end" },
	});
	await pump();
	const retry = historyReads();
	assert.ok(retry.length >= 1, "the round end retried");
	assert.equal(
		retry[0].limit,
		reconcileLimit(2),
		`the retry is sized by what is missing (${reconcileLimit(2)}), not by the rows the last walk read (${retry[0].limit})`,
	);
	assert.equal(handle().labelPending.size, 0, "and nothing stayed held");
});

test("returning to a conversation does not re-blank rows already painted", async () => {
	/*
	 * ROUND 1, QA Q1. A second mount of the same conversation is a switch away and
	 * back, and the rows it paints are the ones this window painted before. The
	 * hold is a FIRST-PAINT device, so it must not fire again: the reader already
	 * saw the stand-in, and blanking it now is the flicker the hold exists to
	 * avoid. The bookkeeping is what makes the two mounts one conversation.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const first = await open({
		page,
		liveEvents,
		durable,
		beforePump: (view) => {
			assert.ok(
				view.labelPending.size > 0,
				"the first join of a conversation does hold its seeded rows",
			);
		},
	});
	assert.equal(first.handle().labelPending.size, 0, "and releases them");

	let secondFrame = null;
	const second = await open({
		page,
		liveEvents,
		durable,
		keepGapBookkeeping: true,
		beforePump: (view) => {
			secondFrame = view;
		},
	});
	assert.ok(secondFrame, "the second mount painted a first frame");
	assert.equal(
		secondFrame.labelPending.size,
		0,
		"rows this window already painted are not held empty again",
	);
	assert.ok(
		historyReads().length >= 1,
		"and the read still fires: a switch back may label more than it did",
	);
	assert.equal(second.handle().labelPending.size, 0, "nothing left held");
});

test("a read that never answers releases the hold at its own cap", async () => {
	/*
	 * ROUND 1, design D1 and QA Q3. An owner that accepts `/history` and never
	 * answers left 26 rows objectless for 40 s - two 20 s control deadlines - under
	 * a comment promising "one read". The hold's first exit is the first attempt
	 * SETTLING, which a hang never does, so it also has a wall-clock cap; the
	 * retries keep running either way and fill the labels in when they land.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const serve = globalThis.__seedRequest;
	globalThis.__seedRequest = async (request) => {
		requests.push(request);
		if (request.op === "sessions.history") return new Promise(() => {});
		return {};
	};
	try {
		let firstFrame = null;
		const { handle } = await open({
			page,
			liveEvents,
			durable,
			beforePump: (view) => {
				firstFrame = view;
			},
		});
		assert.ok(
			firstFrame.labelPending.size > 0,
			"the rows are held while the read is outstanding",
		);
		assert.equal(
			historyReads().length,
			1,
			"the read was issued and never answered",
		);
		assert.ok(
			handle().labelPending.size > 0,
			"and the hold outlasts it, for now",
		);
		fireTimers(LABEL_HOLD_MAX_MS);
		await pump();
		assert.equal(
			handle().labelPending.size,
			0,
			"the cap releases the hold, so the stand-in can speak",
		);
	} finally {
		globalThis.__seedRequest = serve;
	}
});

test("a route answering with short pages cannot make the walk unbounded", async () => {
	/*
	 * ROUND 1, R4. The row bound is only a bound on a route that fills its pages:
	 * `rows` grows by what a page RETURNS, so one row per page with `has_more`
	 * still true costs a request per row. The request cap makes the walk's cost
	 * independent of the server, and this route is the shape that needs it.
	 */
	const { durable } = moment("labels");
	/*
	 * The painted rows are an OLD slice of the journal, not its tail, so the pages
	 * this route serves never overlap them and the walk cannot end by connecting:
	 * what stops it here is the request cap and nothing else. (Against a tail-shaped
	 * snapshot the walk on `origin/main` would stop on its first page, which is the
	 * connect rule this branch replaces, and the case would prove nothing.)
	 */
	const page = durable.slice(0, 100);
	const liveEvents = [endFrame(UNPRESENT, "nothing durable names this call")];
	const serve = globalThis.__seedRequest;
	globalThis.__seedRequest = async (request) => {
		requests.push(request);
		if (request.op !== "sessions.history") return {};
		const rows = globalThis.__seedDurable;
		const end =
			request.beforeId === undefined
				? rows.length
				: rows.findIndex((entry) => entry.id === request.beforeId);
		const start = Math.max(0, (end < 0 ? rows.length : end) - 1);
		return {
			entries: rows.slice(start, end < 0 ? undefined : end),
			has_more: start > 0,
			cursor_missing: false,
		};
	};
	try {
		await open({ page, liveEvents, durable });
		const reads = historyReads();
		assert.ok(
			reads.length <= RECONCILE_WALK_MAX_REQUESTS,
			`the walk made ${reads.length} requests against a one-row page, over the cap`,
		);
	} finally {
		globalThis.__seedRequest = serve;
	}
});

test("a page that begins on a result labels the call whose start is one row older", async () => {
	/*
	 * ROUND 1, QA Q4. A page boundary can fall between an assistant row and its
	 * own result, so the page opens with a tool row whose arguments are one row
	 * older - a call the seed never named, so the walk never asked for it, and the
	 * row painted its output where the command belongs. Its start is one page away,
	 * which is one page the walk will pay: it is the same defect this read exists
	 * to fix. Main stops after the tail page (its one target is found there) and
	 * leaves the row unlabelled.
	 */
	const ORPHAN = "toolu_01SYNTHETICORPHANRESULT00";
	const TARGET = "toolu_01SYNTHETICTARGETCALL000";
	const rows = [];
	for (let i = 0; i < 100; i++) rows.push(spendRow(`early-${i}`, 1_000 + i));
	rows.push(
		assistantRow("synth-assistant-orphan", 1_100, [[ORPHAN, "orphan cmd"]]),
	);
	rows.push(toolRow("synth-tool-orphan", 1_101, ORPHAN, "orphan output"));
	rows.push(
		assistantRow("synth-assistant-target", 1_102, [[TARGET, "target cmd"]]),
	);
	rows.push(toolRow("synth-tool-target", 1_103, TARGET, "target output"));
	for (let i = 0; i < 101; i++) rows.push(spendRow(`late-${i}`, 1_200 + i));
	assert.equal(
		rows.length,
		205,
		"the tail read starts exactly on the orphan result",
	);
	const liveEvents = [endFrame(TARGET, "target output", 1_100)];
	const page = rows.slice(-100);
	assert.equal(
		page[0].id,
		"late-4".replace("late-4", page[0].id),
		"the snapshot page is the last hundred rows",
	);

	const { handle } = await open({ page, liveEvents, durable: rows });
	const reads = historyReads();
	assert.equal(
		reads.length,
		2,
		"the walk paid one page for the orphan's start",
	);
	assert.equal(
		reads[1].beforeId,
		"synth-tool-orphan",
		"read from the page's own first row",
	);
	const orphan = handle().transcript.records.find(
		(record) => record.toolCallId === ORPHAN,
	);
	assert.ok(orphan, "the orphan row was painted");
	assert.ok(
		orphan.args,
		"and it has its arguments, so the object column shows the command",
	);
});

test("the fixture carries structure and no free text", async () => {
	/*
	 * ROUND 1, R2. The first version of `fixtures/seed-label-gap.json` carried a
	 * real session's prompt, prose, git output and `~/...` paths into a public
	 * repository's permanent history. Every string the backend could strip, render
	 * or show is a placeholder now, and this is the guard that keeps it that way:
	 * the free-text carriers must be placeholder-shaped (a scheme prefix may
	 * survive) and no string may carry the shapes that leaked.
	 */
	const textKeys = new Set([
		"text",
		"notice",
		"content",
		"command",
		"code",
		"edits",
		"old_text",
		"new_text",
		"path",
		"range",
		"url",
		"handle",
		"detail",
		"reset_reason",
		"kernel_generation",
		"conversation_id",
		"__fault",
		"selector",
		"new_label",
		"previous_label",
		"boot",
		"token",
	]);
	const offenders = [];
	const leaks = [];
	const visit = (node, key, where) => {
		if (Array.isArray(node)) {
			node.forEach((value, index) =>
				visit(value, key === "diff" ? "diff" : key, `${where}[${index}]`),
			);
			return;
		}
		if (node && typeof node === "object") {
			for (const [name, value] of Object.entries(node)) {
				visit(value, name, where ? `${where}.${name}` : name);
			}
			return;
		}
		if (typeof node !== "string") return;
		if (
			/[\w.%-]+@[\w.-]+\.[a-z]{2,}/i.test(node) ||
			/\/Users|~\/|session\/[0-9a-f]|\.py\b|\.md\b|https?:|\/\/local-operator/.test(
				node,
			)
		)
			leaks.push(`${where}: ${node.slice(0, 40)}`);
		if (key === "diff") {
			// A diff line keeps its first character: the ink `diffLineKind` reads.
			if (!/^.[a-z @]*$/.test(node)) offenders.push(`${where}: ${node}`);
			return;
		}
		if (!textKeys.has(key)) return;
		if (/^[a-z]*$/.test(node)) return;
		if (/^(spill|guide|skill|session):?\/\/?[a-z]*$/.test(node)) return;
		offenders.push(`${where}: ${node.slice(0, 60)}`);
	};
	visit(fixture.journal, "", "journal");
	visit(fixture.moments, "", "moments");
	assert.deepEqual(offenders, [], "every free-text field is a placeholder");
	assert.deepEqual(leaks, [], "and no string carries a path, handle or link");
});

/*
 * THE ONE-TURN JOURNAL, which is where round 2's Q1/R1 landed. The fixture's own
 * journal is ONE turn of 471 rows, so there is no opening row behind the tail page
 * for `pageOpensTurn` to meet, and a seeded call no page can label used to cost the
 * whole journal: 4 requests / 409 rows on the round-1 head, 5 / 500 on the
 * reviewer's `counts` input, against `origin/main`'s single page. The floor that
 * ends it is the call's OWN start instant, which every retained seed entry carries
 * (`started_at_epoch`) and every journal row is comparable against (its `ts`), so
 * it holds on this shape as well as on a journal with turns in it.
 */

/**
 * The seed with one settled call no page names, placed OLDEST (first in the
 * order the seed is read in), started at `at` (epoch seconds).
 *
 * OLDEST on purpose: `labelTargetsBehind` counts a target only when it sits
 * OLDER than a call a page already labelled — a target newer than one of those is
 * inside the read's span by construction, so a stray appended at the end costs no
 * walk at all and would prove nothing.
 */
const withStray = (liveEvents, at) => [
	endFrame(UNPRESENT, "nothing durable names this call", at),
	...liveEvents,
];

test("a one-turn journal bounds the walk by the oldest unlabelled call's own start", async () => {
	const { durable, page, liveEvents } = moment("labels");
	/*
	 * The reviewer's `labels` input: the stray call is placed OLDEST in the seed's
	 * order — the position `labelTargetsBehind` counts as "behind what was read",
	 * because a target NEWER than a labelled call is inside the read's span by
	 * construction — and its own instant is the newest seed start, so an assistant
	 * row naming it would sit inside the first page if the journal held one.
	 *
	 * Pre-fix this cost 2 requests (325 + 104 rows): the turn boundary is the only
	 * floor on a one-turn journal and it sits at index 3, so the walk had to reach
	 * it. The call's own instant is the floor that ends it after one page.
	 */
	const at = Math.max(...liveEvents.map((event) => event.started_at_epoch));
	const { handle } = await open({
		page,
		liveEvents: withStray(liveEvents, at),
		durable,
	});
	const reads = historyReads();
	assert.equal(
		reads.length,
		1,
		`one page, not the journal (read ${reads.length})`,
	);
	assert.equal(reads[0].beforeId, undefined, "and it is the tail");
	assert.equal(
		handle().labelPending.size,
		0,
		"the hold ends with that read rather than with the walk",
	);
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(
		tools.some((record) => record.args),
		"the findable half of the seed is still labelled",
	);
});

test("a page that opens on a result takes the one extra page its assistant row needs", async () => {
	/*
	 * ROUND 3, R6a, on QA's `f-noargs` shape — the seed carries ONLY the call
	 * nothing can label, so `labelTargetsBehind` has no anchor and `reconcileLimit(1)`
	 * sizes the first page at 104 rows. That page's OLDEST row is a tool RESULT
	 * (`ORPHAN_ON_TAIL_PAGE`) whose assistant row is the row immediately older, i.e.
	 * outside the page: `pageOrphanResults` turns it into a target and its own
	 * result row's `ts` becomes the instant that stands in for its start
	 * (`pageOrphanResultInstants`), so the floor does not stop on it and the walk
	 * reads the page holding the pair.
	 *
	 * Without that instant the floor fired here on the unlabelable call's own recent
	 * start and the walk stopped after one page, painting the orphan with its output
	 * — Q4's defect, one row away from the page that fixes it. Round 2's head made 1
	 * read; `f1ef98c4c` made 2 and labelled it, which is the behaviour restored.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const at = Math.max(...liveEvents.map((event) => event.started_at_epoch));
	const { handle } = await open({
		page,
		liveEvents: [endFrame(UNPRESENT, "no page names this", at)],
		durable,
	});
	const reads = historyReads();
	assert.equal(
		reads.length,
		2,
		`two pages, not the journal (read ${reads.length})`,
	);
	assert.equal(
		reads[0].limit,
		reconcileLimit(1),
		"the first is sized by the goal, exactly as it was before this change",
	);
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(
		tools.some(
			(record) => record.toolCallId === ORPHAN_ON_TAIL_PAGE && record.args,
		),
		"the orphan on the page's edge is labelled rather than left with its output",
	);
	assert.ok(
		!tools.some((record) => record.toolCallId === UNPRESENT && record.args),
		"and the call nothing names still gets no label, as it must not",
	);
	assert.equal(handle().labelPending.size, 0, "with the hold released");
});

test("a startless target refuses the floor, so the walk reaches its row", async () => {
	/*
	 * ROUND 3, R6b. Every `tool_call_compose` target is startless BY TYPE — the frame
	 * has no clock field — and it is how a call that never ran, or whose dictation is
	 * complete, is announced. Skipping such a target let a co-target's own instant set
	 * the floor alone, so a settled call from the CURRENT turn ended the walk above an
	 * earlier turn's compose call: the reviewer's probe went from `f1ef98c4c`'s 3 reads
	 * / 321 rows and labelled to 1 read / 107 rows and unlabelled. The floor now
	 * refuses outright when any behind target states no instant, which leaves the walk
	 * its other exits — and here that means the pages down to the assistant row that
	 * names it (`EARLIER_TURN_CALL`, journal index 98).
	 */
	const { durable, page, liveEvents } = moment("labels");
	const compose = {
		type: "tool_call_compose",
		tool_call_id: EARLIER_TURN_CALL,
		tool_name: "bash",
		not_run_reason: "the turn ended before this call ran",
	};
	const at = Math.max(...liveEvents.map((event) => event.started_at_epoch));
	const { handle } = await open({
		page,
		liveEvents: [compose, endFrame(UNPRESENT, "no page names this", at)],
		durable,
	});
	const reads = historyReads();
	assert.ok(
		reads.length >= 3,
		`the walk reaches the earlier turn rather than the floor (read ${reads.length})`,
	);
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(
		tools.some(
			(record) => record.toolCallId === EARLIER_TURN_CALL && record.args,
		),
		"and the compose call is labelled by the page that names it",
	);
	assert.equal(handle().labelPending.size, 0, "with the hold released");
});

test("the start floor reads exactly as deep as the instant it is given", async () => {
	/*
	 * THE CEILING, so the floor cannot be read as "one page, always". A stray call
	 * whose own start is the journal's FIRST row really could have its assistant
	 * row anywhere in the journal, so the walk pays for that: the same four
	 * requests the round-1 head made, and no more. Everything between the two is
	 * priced by the instant (measured on this head: the newest seed start 1 request
	 * / 104 rows, the median 2 / 211, the oldest 3 / 315, the journal's head
	 * 4 / 419).
	 */
	const { durable, page } = moment("labels");
	const { handle } = await open({
		page,
		liveEvents: [endFrame(UNPRESENT, "no page names this", durable[0].ts)],
		durable,
	});
	const reads = historyReads();
	assert.equal(
		reads.length,
		4,
		`the journal's own span (read ${reads.length})`,
	);
	assert.equal(
		reads.reduce((total, read) => total + read.limit, 0),
		419,
		"and it stops at `has_more`, never at the row bound",
	);
	assert.equal(handle().labelPending.size, 0, "with the hold released");
});

test("a later mount does not re-hold a row whose label an earlier read found", async () => {
	/*
	 * ROUND 2, N1 — the half of Q1 that lives BEHIND the fix rather than in front
	 * of it. The hold was keyed off `labelGapRef.current.attempts`, and the sweep
	 * that keeps the retry budget honest DELETES an id from that map as soon as the
	 * transcript learns its arguments. So the state that answers "this row has been
	 * painted once" was destroyed exactly when the fix worked, and a later mount
	 * held the row empty again (the reviewer measured 3 of 3 targets re-held with
	 * one benign live frame between two mounts).
	 *
	 * That frame is why this case delivers one: the sweep runs on a flush, and a
	 * mount immediately after the read is not always a flush later.
	 */
	const { durable, page, liveEvents } = moment("labels");
	await open({ page, liveEvents, durable });
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 3,
		type: "event",
		payload: { type: "provider_start" },
	});
	await pump();
	let firstFrame = null;
	const { handle } = await open({
		page,
		liveEvents,
		durable,
		keepGapBookkeeping: true,
		beforePump: (view) => {
			firstFrame = view.labelPending ?? new Set();
		},
	});
	assert.equal(
		firstFrame.size,
		0,
		`${firstFrame.size} rows re-held on a mount whose rows were already painted`,
	);
	assert.ok(
		historyReads().length >= 1,
		"and the read still fires, so the labels are still being chased",
	);
	assert.equal(handle().labelPending.size, 0, "the hold is released at settle");
});

test("a call still waiting at a gate does not refuse the floor", async () => {
	const { durable, page, liveEvents } = moment("labels");
	const at = Math.max(...liveEvents.map((event) => event.started_at_epoch));
	const { handle } = await open({
		page,
		// The reviewer's first shape: the real seed, a stray placed OLDEST (the
		// position `labelTargetsBehind` counts as behind), and the pending compose
		// NEWEST — newer than everything a page names, which is why no page can
		// label it and why it has no business stopping the walk.
		liveEvents: [
			endFrame(UNPRESENT, "nothing durable names this call", at),
			...liveEvents,
			pendingCompose(),
		],
		durable,
	});
	const reads = historyReads();
	assert.equal(reads.length, 1, `one page (read ${reads.length})`);
	assert.equal(reads[0].limit, reconcileLimit(69), "sized by the goal");
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(
		!tools.some(
			(record) => record.toolCallId === PENDING_COMPOSE && record.args,
		),
		"and the pending call is not labelled, because no row states its arguments",
	);
	assert.equal(handle().labelPending.size, 0, "with the hold released");
});

test("a lone unlabelable call stops at the page its orphan needs, not at the journal", async () => {
	const { durable, page } = moment("labels");
	const at = Math.max(
		...moment("labels").liveEvents.map((event) => event.started_at_epoch),
	);
	const { handle } = await open({
		page,
		liveEvents: [
			pendingCompose(),
			endFrame(UNPRESENT, "no page names this", at),
		],
		durable,
	});
	const reads = historyReads();
	// The reviewer's third shape, and the one number that does NOT return to its
	// round-3 value: the walk costs TWO pages here, not the one page it cost on the
	// round-3 head. That is R6a's own cost rather than an R11 over-read — a 107-row
	// page opens on a result at journal index 300 whose assistant row is 299, so the
	// correct walk fetches that pair, and the second page labels it. What the pending
	// compose contributes is a target to the page's SIZE (107 = `reconcileLimit(2)`)
	// and nothing to the walk, which is what R11 is about.
	assert.equal(
		reads[0].limit,
		reconcileLimit(2),
		"the first page is sized by the goal",
	);
	assert.equal(reads.length, 2, `two pages (read ${reads.length})`);
	assert.equal(
		reads.reduce((total, read) => total + read.limit, 0),
		217,
		"107 for the goal, 110 for the orphan's pair",
	);
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(
		tools.some(
			(record) => record.toolCallId === ORPHAN_ON_107_ROW_PAGE && record.args,
		),
		"and that second page is what labels the orphan on the first page's edge",
	);
});

test("a settled call whose end frame states no clock still refuses the floor", async () => {
	/*
	 * ROUND 6, R16. Round 5's rule let only a compose that STATES a verdict refuse the
	 * floor, so a settled `tool_execution_end` carrying no `started_at_epoch` — an older
	 * producer, or a viewer that joined after the call began — was skipped: the floor
	 * stayed on, the walk stopped after two pages, and that row kept its output stand-in.
	 * It did run, a page holds its assistant row, and the reviewer's swap of R6(b)'s
	 * compose for one of these measured 3 pages and labelled on the round-5 head's
	 * predecessor against 2 and unlabelled here.
	 *
	 * The rule is now the other way round: every startless target refuses the floor but
	 * a compose still waiting at a gate, which no page can label anyway.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const at = Math.max(...liveEvents.map((event) => event.started_at_epoch));
	const { handle } = await open({
		page,
		liveEvents: [
			endFrameWithoutStart(EARLIER_TURN_CALL, "a settled call with no clock"),
			endFrame(UNPRESENT, "no page names this", at),
		],
		durable,
	});
	const reads = historyReads();
	assert.equal(reads.length, 3, `three pages (read ${reads.length})`);
	assert.equal(
		reads.reduce((total, read) => total + read.limit, 0),
		324,
		"107 + 110 + 107, the same walk R6(b)`s verdict compose costs",
	);
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(
		tools.some(
			(record) => record.toolCallId === EARLIER_TURN_CALL && record.args,
		),
		"and the earlier turn`s row is labelled rather than left with its output",
	);
	assert.equal(handle().labelPending.size, 0, "with the hold released");
});
