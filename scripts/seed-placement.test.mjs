import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * A conversation read back after its turn ended must END where the conversation
 * ended: the operator opened a finished session and saw `wait`/`hub`/`task`/
 * `bash` rows from hours earlier painted BELOW the final assistant message.
 *
 * WHY THIS FILE EXISTS. Those rows cannot have come from the history page. The
 * snapshot's page is read `through_id=<frontend.history_cursor>`, which is the
 * transcript's own last entry, so it is the newest 100 journal entries and it
 * ends at the final message. Everything below that message was therefore
 * injected by the SEED path — `applyLiveSeed` folds the snapshot's
 * `frontend.live_events` after the page — and `applyEvent` stamps a row it
 * creates with the clock it is handed while `upsert` APPENDS an unknown id. A
 * seed row the page does not name is painted after the page's tail whatever
 * time it really belongs to.
 *
 * THE FIXTURE IS THE REAL SESSION, not a hand-made one. Both halves are derived
 * from the journal of `~/.local-operator/sessions/f91fbda61750/transcript.jsonl`
 * (1477 entries, "Runtimes interrupted by updates"):
 *
 *   - `page` is entries 1377..1476 — the last 100, which is what the snapshot's
 *     `through_id=<history_cursor>` read returns, ending at the final assistant
 *     message `320f69f0aa1543a2aa2b0393148d873f` at 12:56:16;
 *   - `live_events` is the newest 100 `tool_execution_end` rows of the journal
 *     (entries 1171..1473, 04:30:40..12:56:02) in journal order — the shape the
 *     runtime serves, because its seed retains at most
 *     `LIVE_EVENT_END_ROWS_MAX` (100) settled calls per turn and that session's
 *     turn ran for over eight hours, so the window reaches hours past the page.
 *     Every id, timestamp, call id, tool name and duration is verbatim; tool
 *     output text is truncated to 60 characters and long argument objects are
 *     dropped, because only identity and order are asserted here.
 *
 * The derivation is checkable against the arithmetic the app itself produced:
 * 33 of the seed's calls are named by an assistant row inside the page, so 67
 * are not — and the backend log of the operator's own open
 * (`.../sessions/f91fbda61750/history?limit=234`) is exactly
 * `reconcileLimit(67) = 100 + 2 * 67`, the read the client fires for the calls
 * a seed names and the transcript cannot label.
 *
 * WHAT THIS PROVES: the painted ORDER the reducer ends up with for that real
 * page and that real seed, through the shipped hook (frames -> flush ->
 * `applyLiveSeed`), including the re-subscribe path that a reader hits by
 * clicking back into a finished session. WHAT IT DOES NOT PROVE: that the
 * runtime still served that seed at the moment the operator clicked (the
 * runtime in question is his live one and was not attached to), and nothing
 * about the pixels — `docs/evidence/seed-placement/` carries the frames.
 *
 * React's scheduler, the transport and the clock are the only substitutions;
 * the reducer, the hook's flush loop and the paint cache are the shipped
 * modules.
 */

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/stale-seed-order.json", import.meta.url), "utf8"),
);

/** The final assistant row of the real conversation (journal entry 1474). */
const FINAL_MESSAGE = "320f69f0aa1543a2aa2b0393148d873f";

/** The operator's report, as an id: rows painted after this one are the defect. */
const unlabelledCalls = (() => {
	const labelled = new Set(
		fixture.page.entries.flatMap((entry) =>
			(entry.payload.tool_calls ?? []).map((call) => call.id),
		),
	);
	return fixture.seed.live_events
		.map((event) => event.tool_call_id)
		.filter((callId) => !labelled.has(callId));
})();

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
globalThis.window = {
	setTimeout: () => {
		fallbackSeq += 1;
		return fallbackSeq;
	},
	clearTimeout: () => {},
};

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
		return { entries: rows.slice(start, end < 0 ? undefined : end), has_more: start > 0, cursor_missing: false };
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
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
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
			name: "seed-placement-fixture",
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
const { useCanonicalSessionStream, useCanonicalSessionsStore, __resetPaintCache } =
	hook;

const SESSION = "f91fbda61750";

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
				conversation_title: "Runtimes interrupted by updates",
				conversation_title_user_set: true,
				conversation_title_forked: false,
				goal: "",
				active_agent: "",
				active_team: "",
				selected_model: null,
				effective_model: null,
				streaming,
				generation: fixture.seed.generation,
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
	for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
};

const ids = (transcript) => transcript.records.map((record) => record.id);

/**
 * Open the conversation once and hand back what the reader would see.
 *
 * `durable` is what the backend holds when the read-back happens (the fixture's
 * page unless a case says otherwise), and `streaming` is the snapshot's own
 * statement about the turn.
 */
async function open({ entries, liveEvents, streaming, durable = entries }) {
	__resetPaintCache();
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
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
	assert.equal(subscriptions.length, 1, "the panel subscribes on mount");
	deliver(openFrame(1, false));
	deliver(snapshotFrame(2, { entries, liveEvents, streaming }));
	await pump();
	return { handle, runtime };
}

/* -------------------------------------------------------------------- cases */

test("a seed that arrives with the turn over paints nothing after the last message", async () => {
	const page = fixture.page.entries;
	const { handle } = await open({
		entries: page,
		// The seed the runtime actually holds for this session: 100 settled
		// calls, 67 of them older than the page's own first row.
		liveEvents: fixture.seed.live_events,
		streaming: false,
	});

	assert.ok(unlabelledCalls.length > 0, "the fixture still carries the gap");
	assert.equal(
		handle.transcript.records.at(-1).id,
		FINAL_MESSAGE,
		"the conversation still ends where the conversation ended",
	);
	for (const callId of unlabelledCalls) {
		assert.ok(
			!ids(handle.transcript).includes(`tool:${callId}`),
			`no row is painted for ${callId}, which the page never named`,
		);
	}

	/*
	 * The whole assertion, stated as the reader's own comparison: opening the
	 * finished conversation paints what opening it without a seed paints. The
	 * seed cannot move a row, and cannot add one, because every row it names is
	 * already durable somewhere the page or the reader's paging owns.
	 */
	const plain = await open({ entries: page, liveEvents: [], streaming: false });
	assert.deepEqual(
		ids(handle.transcript),
		ids(plain.handle.transcript),
		"the seed does not change the painted conversation",
	);
});

test("the snapshot's seed is refused again on every later snapshot", async () => {
	const page = fixture.page.entries;
	const { handle, runtime } = await open({
		entries: page,
		liveEvents: fixture.seed.live_events,
		streaming: false,
	});
	const before = ids(handle.transcript);

	// A reconnect / re-subscribe on the same panel: the same snapshot again,
	// which is the frame a reader gets by clicking back into the session.
	deliver(
		snapshotFrame(3, {
			entries: page,
			liveEvents: fixture.seed.live_events,
			streaming: false,
		}),
	);
	await pump();
	runtime.rerender();
	assert.deepEqual(
		ids(handle.transcript),
		before,
		"a re-applied seed repaints nothing",
	);
});

test("a seed that arrives mid-turn still settles the calls it names", async () => {
	const page = fixture.page.entries;
	const { handle } = await open({
		entries: page,
		liveEvents: fixture.seed.live_events,
		streaming: true,
	});

	/*
	 * The behaviour the seed exists for, and the one the fix must not take
	 * away: a viewer that joins while the turn runs is the only reader those
	 * rows have, so they are painted — after the page, which is where an
	 * in-flight turn's rows belong.
	 */
	const painted = ids(handle.transcript);
	assert.notEqual(handle.transcript.records.at(-1).id, FINAL_MESSAGE);
	for (const callId of unlabelledCalls) {
		assert.ok(
			painted.includes(`tool:${callId}`),
			`the mid-turn join still paints ${callId}`,
		);
	}
});

test("a seed naming calls the page already holds folds onto those rows", async () => {
	const page = fixture.page.entries;
	const labelled = new Set(
		page.flatMap((entry) =>
			(entry.payload.tool_calls ?? []).map((call) => call.id),
		),
	);
	const { handle } = await open({
		entries: page,
		// Only the calls the page names: the durable row wins, so the seed has
		// nothing to add — and nothing to say about position.
		liveEvents: fixture.seed.live_events.filter((event) =>
			labelled.has(event.tool_call_id),
		),
		streaming: false,
	});
	const plain = await open({ entries: page, liveEvents: [], streaming: false });
	assert.deepEqual(ids(handle.transcript), ids(plain.handle.transcript));
});

test("a settling frame for a call the page already names lands at the call's own time", async () => {
	/*
	 * The cursor-lag shape, on the real rows: the page stops at the assistant
	 * rows that ASKED for the calls, so the results behind them are not durable
	 * in hand and the seed is the only frame carrying them. They belong where
	 * the calls were made — between those assistant rows — and the only
	 * statement of when that was is the durable row that named each call
	 * (`anchoredAt`). Appending them at the reader's arrival would paint the
	 * conversation's tail out of order, which is the same defect one page
	 * smaller.
	 */
	const full = fixture.page.entries;
	const withoutResults = full.filter((entry) => entry.payload.role !== "tool");
	const results = new Set(
		withoutResults.flatMap((entry) =>
			(entry.payload.tool_calls ?? []).map((call) => call.id),
		),
	);
	const { handle } = await open({
		entries: withoutResults,
		liveEvents: fixture.seed.live_events.filter((event) =>
			results.has(event.tool_call_id),
		),
		streaming: false,
		durable: withoutResults,
	});
	const complete = await open({ entries: full, liveEvents: [], streaming: false });
	assert.deepEqual(
		ids(handle.transcript),
		ids(complete.handle.transcript),
		"the replayed results land back in the order the conversation happened in",
	);
});
