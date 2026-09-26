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

/**
 * Run every still-armed timer whose delay is exactly `delay` (fake timers).
 *
 * OVER A SNAPSHOT OF THE LIST, not the live array. A deadline that refuses to
 * fire - the backstop, while a read is still out - re-arms a new timer at its own
 * delay from inside its own callback, and `for...of` over a growing array would
 * run the re-armed copy, and its copy, until the heap ran out: measured as a V8
 * OOM at 4.08 GB mid-suite while the rule was being written. One pass, one fire
 * per armed timer, is what "advance to this instant" means.
 */
function fireTimers(delay) {
	for (const timer of [...timers]) {
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
		 * A read that is STILL OUTSTANDING when the reader leaves: the state a
		 * switch away happens in whenever the owner is slower than the click, and
		 * the state the paint cache has to describe honestly. `true` here holds the
		 * promise open for the rest of the case, so the hold is never released by an
		 * answer and the cached paint is written while its rows are still owed.
		 */
		if (globalThis.__seedHangHistory) return new Promise(() => {});
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
			export { __resetPaintCache, readPaint, writePaint } from "./src/renderer/src/shared/store/paint-cache";
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
	readPaint,
	outputFallbackLine,
	reconcileLimit,
	writePaint,
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
/**
 * The late-hold mark's own threshold (design round 3, D7). Named here for the
 * same reason as every other bound: a case that asserts the mark ARRIVES at the
 * threshold has to fail on a head where the constant is missing, not on an
 * `undefined` delay that would fire the mark case's timer for the wrong reason.
 */
const LABEL_HOLD_MARK_MS = sessionModule.LABEL_HOLD_MARK_MS ?? 0;
/*
 * The three JSX-level readings the D7 case takes, hoisted as literals: the rule
 * they assert lives in a `.tsx` the node suite cannot mount without the whole chat
 * tree, which is the convention this file already follows for JSX rules (see
 * `canonical-chat.test.mjs`'s sidebar case), and a literal per call site is what
 * biome's `useTopLevelRegex` asks not to do.
 *
 * They are deliberately STRUCTURAL rather than line-anchored: `data-label-hold`
 * must be inside the `summaryHold ? (` branch, so the attribute cannot be moved to
 * the blank branch and keep a green gate.
 */
const COMMENT_TEXT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const MARK_ON_SUMMARY_HOLD =
	/summaryHold\s*\?\s*\(\s*<span[^>]*data-label-hold="true"/s;
const TITLE_SUPPRESSED_WHILE_HELD =
	/title=\{summaryHold\s*\?\s*undefined\s*:\s*summaryText\}/;
/*
 * The row's `summaryHold` expression, which round 4 widens: the mark stands on a
 * row a REFUSAL released as well as on one whose hold has outlived the threshold.
 * Structural rather than line-anchored, and it must name BOTH halves for the reason
 * the case states - a tree with only the late half compiles and quietly loses the
 * cue on the refusing route.
 */
const SUMMARY_HOLD_PROP =
	/summaryHold=\{\s*labelMarked === true \|\|\s*\(labelPending === true && labelHoldLate === true\)\s*\}/;
/*
 * The settle path's own allowance, and the fallback is the HEAD value for the
 * reason above it: a case that pins what the path may SPEND has to fail on what a
 * tree without the bound does (a bounded walk per settle, forever), not on an
 * `undefined` arithmetic quietly becoming `NaN`.
 */
const LABEL_SETTLE_ROWS_MAX = sessionModule.LABEL_SETTLE_ROWS_MAX ?? 500;

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
	/**
	 * Tear the tree down through the REAL cleanup path.
	 *
	 * A switch away in the app UNMOUNTS the pane, and the mount's cleanups are where
	 * its teardown lives - the paint the next mount seeds from is written by one of
	 * them. This stand-in ran a cleanup only when a DEP changed, so no case could
	 * reach that path (agent review round 3, M2: the switch-back case had to
	 * hand-write `owedLabels` instead). Cleanups run in MOUNT order, which is the
	 * order React runs them in.
	 */
	runtime.unmount = () => {
		for (const cell of cells) cell.cleanup?.();
		for (const cell of cells) cell.cleanup = undefined;
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
	/**
	 * Every render's own view, in order: the frames the reader would have seen,
	 * including the ones before the first flush. A case that claims something about
	 * a FRAME ("no stand-in frame on open") needs all of them, and the join below is
	 * where a painted row's states can be observed one commit at a time.
	 */
	onFrame,
	/*
	 * The label bookkeeping is per CONVERSATION and survives a mount, because a
	 * session switch unmounts the pane (round 1, QA Q1). A test that opens the
	 * same conversation twice therefore means one of two things and has to say
	 * which: two separate JOINS (the default, bookkeeping cleared) or a switch
	 * AWAY AND BACK (`keepGapBookkeeping: true`, the second mount meeting rows
	 * this window has already painted).
	 */
	keepGapBookkeeping = false,
	/**
	 * The wire's own statement about whether a TURN is in flight, and therefore the
	 * field every case here is implicitly a case about (agent review round 3, M3).
	 * The fixture does not carry the flag - `snapshotFrame` states it - and the join
	 * it is cut from is a mid-turn one, so `true` is the default and the one every
	 * other case has always been driven at. `false` is what a finished conversation
	 * sends, and it is a different rule.
	 */
	streaming = true,
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
		onFrame?.(handle);
		return handle;
	};
	runtime.rerender();
	deliver(openFrame(1, false));
	deliver(snapshotFrame(2, { entries: page, liveEvents, streaming }));
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
/*
 * THE HOLD'S EXIT, SPLIT BY CALL (2026-09-25 decision).
 *
 * A read ENDING is not a label SETTLING, and the old assertions here conflated
 * them: they required `labelPending` to be empty once the walk's first read came
 * back, which is the release that painted the output stand-in for a call the next
 * page of the same walk was about to name (review round 1, M1: 24 repaints on the
 * fall-short route, 68 on the failure arm). The hold now ends per call - when the
 * view can name it, or when its per-call read budget is spent with no page naming
 * it anywhere - so what a case can assert after a read is this split: NOTHING the
 * view can name may still be held, and the calls no page named keep their empty
 * column while a read can still answer for them.
 */
const heldSplit = (handle) => {
	const view = handle();
	const held = [...(view.labelPending ?? [])];
	return {
		held,
		labelled: held.filter((id) => view.transcript.argsByCall.has(id)),
		unlabelled: held.filter((id) => !view.transcript.argsByCall.has(id)),
	};
};

/** No call the view can name may still be held; returns the ones still owed. */
const assertHoldIsPerCall = (handle, why) => {
	const split = heldSplit(handle);
	assert.deepEqual(
		split.labelled,
		[],
		`${why}: a call the view can name is not held (${split.labelled.join(", ")})`,
	);
	return split.unlabelled;
};

/*
 * What a row's object column PRINTS, per the row's own rule in `tool-row.tsx`:
 * the command once its arguments are known, the mark while its id is marked, the
 * empty column while it is held, and the output stand-in otherwise. The mark is
 * the glyph ALONE and a stand-in is the glyph plus content, so every
 * `startsWith("… ")` probe in this file remains a probe for the stand-in - which
 * is what makes "no stand-in frame" a claim a marked row cannot satisfy by
 * accident (round 4: the mark stands on rows a refusal released from the hold).
 */
const objectColumn = (record, pending, marked) =>
	record.args
		? "args"
		: marked?.has(record.toolCallId)
			? "…"
			: outputFallbackLine(record.output, pending.has(record.toolCallId));

/**
 * Mount the hook over whatever the paint cache holds, recording every render.
 *
 * This is the SWITCH-BACK shape rather than a join: no wire frame is delivered,
 * so the only rows on screen are the ones `paintSeed` read from the cache, and
 * the first recorded render is the first frame the reader would see. What the
 * cases below assert is a property of THAT frame - the frame the pre-fix tree
 * paints a call's result in the command column - so nothing here pumps or waits.
 */
function mountCached({ onFrame }) {
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	timers = [];
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION, true);
		onFrame?.(handle);
		return handle;
	};
	runtime.rerender();
	return { handle: () => handle, runtime };
}

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
	/*
	 * THE FIRST READ NO LONGER SETTLES THEM. A read that found no assistant row for
	 * a call has not proved the call unlabelable - the retry at the next durable
	 * round end can still name it - and releasing the hold on that read is what put
	 * the output stand-in on screen for a frame before the command arrived (the
	 * operator's report, and review round 1's M1/U1). So the rows stay objectless
	 * while their budget is unspent...
	 */
	/*
	 * THE WALK ENDING NO LONGER SETTLES THEM, AND THE TURN IS WHAT DOES. This
	 * assertion used to read the other way (the rows released here) because
	 * `turnRunning` asked the newest RECORD whether the turn was live, and on this
	 * conversation the newest record is a settled tool call - so term (b) was inert
	 * and a walk that fell short released everything it could not name (agent review
	 * round 3, M3). The fixture's own snapshot is `streaming: true`: the owner is
	 * mid-turn, a durable round ending can still name these calls, so the hold stands
	 * - `pending` empty, term (b) true.
	 */
	assert.deepEqual(
		heldSplit(handle).unlabelled,
		[...missing].filter((id) => heldSplit(handle).held.includes(id)),
		"a walk that found nothing does not release a row while the owner's turn is running",
	);
	/*
	 * ...AND THE SECOND ATTEMPT IS WHAT SETTLES THEM. The budget is the per-call
	 * read allowance (`LABEL_GAP_ATTEMPTS`), so a round end re-asks and, when that
	 * read comes back empty too, nothing can label these calls any more: the
	 * stand-in is then the true answer and the hold ends - which is what keeps the
	 * hold from hiding a row forever.
	 */
	requests.length = 0;
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 3,
		type: "event",
		payload: { type: "turn_end" },
	});
	await pump();
	assert.ok(historyReads().length >= 1, "the round end re-asked for them");
	assert.equal(
		handle().labelPending.size,
		0,
		"and the budget's second read is what settles them",
	);
	const tools = view.transcript.records.filter(
		(record) => record.kind === "tool" && missing.has(record.toolCallId),
	);
	assert.ok(
		tools.length > 0,
		"the rows are painted from the durable tool rows",
	);
	/*
	 * Read off the LIVE view, not the one taken before the round end: the hold's
	 * question is what the pane is showing now, and the rows are only at their
	 * stand-in once the release has actually committed.
	 */
	const standIns = tools.filter((record) =>
		objectColumn(record, handle().labelPending)?.startsWith("… "),
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
	const leftover = assertHoldIsPerCall(handle, "the turn-bounded walk");
	/*
	 * m4: THE LEFTOVER SET IS KEPT. This helper's RETURN is the case's subject - which
	 * calls a walk that fell short left owed - and asserting only that it is empty
	 * throws the subject away: the assertion cannot be read against what the walk was
	 * given. So the set is named, and the case shows its own candidate was not empty
	 * (the live end frame's call is in no page), which is what makes the emptiness
	 * mean something rather than pass vacuously.
	 */
	assert.deepEqual(
		leftover,
		[UNPRESENT],
		`and the one call this walk could not reach is still HELD, because the owner's turn is running and its round ending can still name it (leftover: ${leftover.join(", ")})`,
	);
	assert.ok(
		page.every((record) => record.toolCallId !== UNPRESENT),
		"the case's candidate: no page names this call, so the walk really did fall short of a target",
	);
	/*
	 * AND THE ROUND ENDING IS WHAT RELEASES IT, which is the other direction of the
	 * same rule and the half that keeps a hold from lasting the conversation. The
	 * turn's own end clears term (b), so the release lets the stand-in speak.
	 */
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 3,
		type: "event",
		payload: { type: "turn_end" },
	});
	await pump();
	assert.deepEqual(
		heldSplit(handle).held,
		[],
		"and the turn's own ending releases it, so the hold is bounded by the turn and not by the clock",
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
	/*
	 * m4: THE LEFTOVER SET IS KEPT AND ASSERTED (agent review rounds 2 and 3).
	 * `assertHoldIsPerCall`'s RETURN is this case's subject - which calls a walk that
	 * fell short was still holding - and discarding it throws the subject away: a
	 * claim about the hold cannot be read against what the walk was given. So the set
	 * is named and printed, and the emptiness is made to MEAN something by pinning
	 * the candidate side first: both seeded calls are in no page, and the round has
	 * ENDED, so nothing left can name them and the hold is correctly over. Before the
	 * round ended this same helper returns both of them - see the turn-bounded case,
	 * which asserts exactly that.
	 */
	const unnameable = handle()
		.transcript.records.filter(
			(record) =>
				record.kind === "tool" &&
				(record.toolCallId === UNPRESENT ||
					record.toolCallId === `${UNPRESENT}b`) &&
				record.args,
		)
		.map((record) => record.toolCallId);
	assert.deepEqual(
		unnameable,
		[],
		"the case's candidate: no page names either seeded call, so neither can be labelled",
	);
	const leftover = assertHoldIsPerCall(handle, "the retry").sort();
	assert.deepEqual(
		leftover,
		[],
		`and with the round over the hold is empty rather than blank-forever (leftover: ${leftover.join(", ")})`,
	);
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

test("the backstop defers to a read that is still out, and fires once none is", async () => {
	/*
	 * ROUND 3, U4 / Q-4 - AND THE RULE THIS CASE ASSERTS IS THE REVERSE OF THE ONE
	 * IT USED TO. It previously required `fireTimers(LABEL_HOLD_MAX_MS)` to release a
	 * hold whose read never answers; that single shot was the defect. The deadline
	 * was armed once per BATCH and fired on a clock, so it painted the stand-in
	 * WHILE A READ WAS IN FLIGHT: measured on the abort-then-retry arm, 26 rows
	 * showed the call's OUTPUT in the command column for 4.97 s from 25 124 ms with
	 * the read issued at 20 005 ms still running, and the wedge ended at 25 159 ms,
	 * 5.2 s into attempt two's own 20 s window. The deadline now DEFERS to the read
	 * it is waiting for, and re-arms per attempt.
	 *
	 * BOTH DIRECTIONS, on one route and with the clock under the case's control:
	 * while the read is out the deadline re-arms and the rows stay held; once nothing
	 * is out for them, the next fire releases them - which is what still bounds the
	 * hold, and what keeps a wedged owner from holding to the end of the
	 * conversation.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const serve = globalThis.__seedRequest;
	const armedDeadlines = () =>
		timers.filter(
			(timer) => timer.delay === LABEL_HOLD_MAX_MS && !timer.cleared,
		).length;
	try {
		/* ARM ONE: a read that is accepted and never answered. */
		globalThis.__seedRequest = async (request) => {
			requests.push(request);
			if (request.op === "sessions.history") return new Promise(() => {});
			return {};
		};
		const hanging = await open({ page, liveEvents, durable });
		const heldWhileOut = hanging.handle().labelPending.size;
		assert.ok(
			heldWhileOut > 0,
			"the rows are held while the read is outstanding",
		);
		assert.equal(
			historyReads().length,
			1,
			"the read was issued and never answered",
		);
		assert.equal(armedDeadlines(), 1, "one deadline is armed for the batch");
		fireTimers(LABEL_HOLD_MAX_MS);
		await pump();
		assert.equal(
			hanging.handle().labelPending.size,
			heldWhileOut,
			"the deadline does NOT fire while the read it is waiting for is still out",
		);
		assert.equal(
			armedDeadlines(),
			1,
			"it re-arms instead, so the hold is still bounded rather than held with no deadline at all",
		);
		/*
		 * ARM TWO: the owner REFUSES the read, so the walk spends its attempts and
		 * stands down - nothing is out for these calls any more, while the turn it is
		 * running for carries on. That is the state the deadline exists for, and the
		 * state U4's defect fired in the middle of.
		 */
		const refusingStub = async (request) => {
			requests.push(request);
			if (request.op === "sessions.history")
				throw new Error("history unavailable");
			return {};
		};
		globalThis.__seedRequest = refusingStub;
		const refusing = await open({ page, liveEvents, durable });
		assert.ok(
			historyReads().length >= 2,
			"the walk spent its retry against the refusing owner and stood down",
		);
		assert.equal(
			refusing.handle().labelPending.size,
			0,
			"and the HOLD ends there (round 4), because nothing is out for these calls any more",
		);
		assert.ok(
			refusing.handle().labelMarked.size > 0,
			"while the MARK stands in its place: the turn it is running for can still name them, so the output must not be stated and a cue must be",
		);
		assert.equal(
			armedDeadlines(),
			1,
			"and the deadline covers the marked set too, so the cue is bounded by the transport rather than standing with no deadline at all",
		);
		fireTimers(LABEL_HOLD_MAX_MS);
		await pump();
		assert.equal(
			refusing.handle().labelMarked.size,
			0,
			"with nothing out for them the deadline fires, so the stand-in speaks - the cue is bounded by the transport, not by the pane's patience",
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
	/*
	 * m4: THE LEFTOVER SET IS KEPT AND ASSERTED - this site and the one
	 * `:1166`-era case above are the two round 2 named, and the site where the round-8
	 * tripwire lived. The helper's return is the case's subject, so it is named and
	 * printed rather than discarded.
	 */
	const leftover = assertHoldIsPerCall(handle, "the single page").sort();
	assert.deepEqual(
		leftover,
		[UNPRESENT],
		`and the stray call, which no page in this journal holds, is the one the walk ends up still holding (leftover: ${leftover.join(", ")})`,
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
	/*
	 * AND THE RULE IS WHAT DECIDES, NOT THE WALK ENDING. `unlabelled` here is
	 * `pending`, the calls a walk could not name - and a walk that ends does not
	 * release them while the owner's turn is running, because a durable round ending
	 * can still name them. This assertion used to require `[]` on the premise "the
	 * walk ended and no round ending is coming", which was true only because
	 * `turnRunning` asked the newest RECORD rather than the turn (agent review round
	 * 3, M3: the fixture's own snapshot is `streaming: true`).
	 */
	assert.deepEqual(
		heldSplit(handle).unlabelled,
		[UNPRESENT],
		"and the call nothing can name is still held, because the owner's turn is running and its round ending can still name it",
	);
	/*
	 * The turn's own ending is what releases it: with the round over, nothing left
	 * can name the call, so the stand-in is the truth and the column says so.
	 */
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 4,
		type: "event",
		payload: { type: "turn_end" },
	});
	await pump();
	assert.deepEqual(
		heldSplit(handle).held,
		[],
		"and the round's own ending releases it, so the hold is bounded by the turn",
	);
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
	assertHoldIsPerCall(handle, "the compose page");
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
	assertHoldIsPerCall(handle, "the journal-span walk");
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
	assertHoldIsPerCall(handle, "the cached mount's walk");
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
	/*
	 * Both of the case's unlabelable calls, and only they: the one waiting at a
	 * gate (whose start may not refuse the floor) and the one the journal does not
	 * hold at all. Neither can be named by any read, so both keep their empty column
	 * while the owner's turn runs - and the turn's own ending is what releases them.
	 */
	const leftover = heldSplit(handle).unlabelled.sort();
	assert.deepEqual(
		leftover,
		[PENDING_COMPOSE, UNPRESENT].sort(),
		`and the calls no read can name are held while the owner's turn is running (leftover: ${leftover.join(", ")})`,
	);
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 4,
		type: "event",
		payload: { type: "turn_end" },
	});
	await pump();
	assert.deepEqual(
		heldSplit(handle).held,
		[],
		"and the round's own ending releases both, so neither stays blank forever",
	);
	/*
	 * m4: THE LEFTOVER SET IS KEPT. `leftover` is the helper's own return - the calls
	 * the walk was still holding - and it is named and printed rather than discarded, so
	 * the assertion above reads as a statement about THOSE calls. The case's candidate
	 * side is its fixture (the gate-row call), which the assertion above this block
	 * already pins as unlabelled; repeating it here would assert the same fact twice.
	 */
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
	 * stayed on, the walk stopped after two pages, and the call kept no label. It did
	 * run, a page holds its assistant row, and the reviewer's swap of R6(b)'s compose for
	 * one of these measured 3 pages and labelled on `f1ef98c4c` against 2 and unlabelled
	 * on `7b5ee49d` (round 7, R19: the 3-read figure belongs to the head BEFORE round 5's
	 * regression, not to it).
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
	assertHoldIsPerCall(handle, "the earlier turn's page");
});

/*
 * The frames the two R18 cases are built from: a compose for a named call, with or
 * without the verdict that says it never ran, and a settled end for the call the
 * transcript's pages have named (`EARLIER_TURN_CALL`, journal index 98).
 */
const composeFor = (callId, reason) => ({
	type: "tool_call_compose",
	tool_call_id: callId,
	tool_name: "bash",
	dictation_complete: true,
	...(reason ? { not_run_reason: reason } : {}),
});

test("a second pass retracts an exemption an earlier seed announced", async () => {
	/*
	 * ROUND 7, R18. The waiting set is per CONVERSATION and outlives the seed that
	 * filled it, so an id added on one pass stayed exempt from the floor on every
	 * later one: the reviewer reproduced this in the shipped hook, where R6(b)'s
	 * verdict-compose shape on a second pass reads 2 pages / 217 rows and leaves the
	 * call unlabelled, against 3 / 324 labelled with fresh bookkeeping. The stale
	 * exemption is what the floor was reading, not the seed in front of it.
	 *
	 * Pass one announces the call as WAITING — a compose with no reason, which is the
	 * only startless kind that may not refuse the floor. Pass two names the same id
	 * with a verdict, and that statement has to be able to TAKE THE EXEMPTION BACK.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const at = Math.max(...liveEvents.map((event) => event.started_at_epoch));
	const settled = endFrame(UNPRESENT, "no page names this", at);
	await open({
		page,
		liveEvents: [composeFor(EARLIER_TURN_CALL), settled],
		durable,
	});
	const { handle } = await open({
		page,
		liveEvents: [
			composeFor(EARLIER_TURN_CALL, "the turn ended before this call ran"),
			settled,
		],
		durable,
		keepGapBookkeeping: true,
	});
	const reads = historyReads();
	assert.equal(reads.length, 3, `three pages (read ${reads.length})`);
	assert.equal(
		reads.reduce((total, read) => total + read.limit, 0),
		324,
		"107 + 110 + 107, the walk a fresh exemption reads",
	);
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(
		tools.some(
			(record) => record.toolCallId === EARLIER_TURN_CALL && record.args,
		),
		"and the call is labelled on the pass that states its verdict",
	);
});

test("one seed naming a call both waiting and settled does not exempt it", async () => {
	/*
	 * ROUND 7, R18, the same predicate error with no staleness at all: one seed can
	 * carry both frames for one id — a settled end whose producer states no clock, and
	 * a compose with no reason — and the exemption won, because it was the only
	 * statement about the call the set ever heard. The ordering in the seeding block is
	 * the fix: the add runs first and the retraction after it, so a call named both
	 * ways ends up NOT exempt and the floor keeps the walk going to the page that
	 * labels it.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const at = Math.max(...liveEvents.map((event) => event.started_at_epoch));
	const { handle } = await open({
		page,
		liveEvents: [
			endFrameWithoutStart(EARLIER_TURN_CALL, "a settled call with no clock"),
			composeFor(EARLIER_TURN_CALL),
			endFrame(UNPRESENT, "no page names this", at),
		],
		durable,
	});
	const reads = historyReads();
	assert.equal(reads.length, 3, `three pages (read ${reads.length})`);
	assert.equal(
		reads.reduce((total, read) => total + read.limit, 0),
		324,
		"107 + 110 + 107",
	);
	const tools = handle().transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(
		tools.some(
			(record) => record.toolCallId === EARLIER_TURN_CALL && record.args,
		),
		"and the call the seed names both ways is labelled",
	);
});

/*
 * ROUND 8: A LIVE SETTLE IS THE SEED'S SIBLING, AND IT HAD NO READ OF ITS OWN.
 *
 * `tool_execution_end` is argument-less in both carriers, so the row asks the
 * durable assistant row for its command. The SEED path asks for the newest
 * `LIVE_EVENT_END_ROWS_MAX` ends a snapshot carries. A live settle - the same
 * frame, delivered while the turn runs - asked for nothing, and the two moments
 * that could have stood in for it are not guaranteed to arrive:
 *
 *   - the seed keeps only the turn's newest 100 ends, so a call that has fallen
 *     out of that window is named by no later snapshot at all;
 *   - the round-end retry (`retryLabels`) draws its candidates from a budget only
 *     the seed path filled, so a settle it never tracked was not retried either.
 *
 * Measured on the reported conversation (`b747a2c8d3bb`): a 24.2-hour turn with 170
 * calls in it, whose whole app-log history carries three `sessions.history` reads -
 * `limit=100` at 2026-09-24 00:00:05, and `limit=100` plus one
 * `limit=100&before_id=…` at 2026-09-25 09:17:25-26 - every one of them a plain
 * tail or the reader's own page, and NOT ONE with a computed limit, i.e. no label
 * read was ever asked for. (What that log cannot say is why; the code-verifiable
 * half is that a live settle asked for nothing at all, per review round 1's R3.)
 *
 * So the row kept its output stand-in until the reader scrolled its assistant row
 * into a page - the report's "garbled lines that go away after scrolling up".
 * Asking here is the same request the seed path makes, sized by the same
 * `reconcileLimit` - but a settle's read is SPECULATIVE (the runtime appends a
 * round's assistant row and its results together, so a settle from a step that is
 * still open is asking for a row that does not exist yet), so it is NOT charged to
 * `LABEL_GAP_ATTEMPTS`: that budget is spent at the durable round ending, where the
 * same call is a retry candidate, and `LABEL_SETTLE_ROWS_MAX` is what bounds the
 * speculative path's own total spend.
 */
test("a live settle with no start asks for the page that carries its command", async () => {
	const callId = "toolu_01LIVESETTLEWITHNOSEED00";
	const durable = [
		userRow("u1", 1),
		assistantRow("a1", 2, [[callId, "npm test"]]),
		toolRow("t0", 3, callId, "tests passed"),
	];
	for (let i = 0; i < 130; i++) durable.push(spendRow(`pad${i}`, 4 + i));
	const page = durable.slice(-100);
	assert.equal(
		page.some((entry) =>
			(entry.payload.tool_calls ?? []).some((call) => call.id === callId),
		),
		false,
		"the tail page must not name the call",
	);

	const { handle } = await open({ page, liveEvents: [], durable });
	const readsBefore = historyReads().length;
	// The settling frame alone: no seed, no start, no round end.
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 3,
		type: "event",
		payload: {
			type: "tool_execution_end",
			tool_call_id: callId,
			tool_name: "bash",
			result: { content: [{ text: "tests passed" }], details: null },
			duration_s: 0.2,
			is_error: false,
		},
	});
	await pump();
	const record = handle().transcript.records.find(
		(entry) => entry.toolCallId === callId,
	);
	assert.ok(record, "the live settle paints the row");
	assert.ok(record.args, "and a read labels it");
	assert.ok(
		historyReads().length > readsBefore,
		"a read was asked for, rather than the reader's own paging",
	);
});

/* ------------------------------------------ the settle path's own allowance (R1/R2) */

test("a settle whose step is still open keeps the call's durable read", async () => {
	/*
	 * REVIEW ROUND 1, R1, in the reviewer's own sequence: a live settle whose
	 * assistant row the journal does not hold yet -> a re-sync snapshot whose seed
	 * names the same call -> the step commits -> a durable `turn_end`.
	 *
	 * On `origin/main` that sequence ended with the row LABELLED, because the round
	 * end still had an attempt to spend. On the first head of this change the
	 * settle charged one attempt (its read asked for a row that did not exist yet)
	 * and the snapshot charged the second, so the durable moment - the one read that
	 * can always succeed - had no budget left at all and the row kept its `… ok`
	 * stand-in. A settle therefore NAMES its call without charging it, and the row
	 * is read where `main` read it: at the durable round ending.
	 *
	 * The instants are the fixture's own units: `ts` and `started_at_epoch` are
	 * epoch SECONDS, and the floor converts the page's oldest row to ms.
	 */
	const base = 1_790_219_600;
	const rows = [];
	for (let i = 0; i < 140; i++) rows.push(spendRow(`earlier-${i}`, base + i));
	rows.push(userRow("turn-user", base + 200));
	for (let i = 0; i < 20; i++) rows.push(spendRow(`turn-${i}`, base + 260 + i));
	const page = rows.slice(-100);
	const callId = "toolu_01SETTLESTILLOPEN0000000";
	const startedAt = base + 305;
	const settled = endFrame(callId, "… ok", startedAt);
	const { handle } = await open({ page, liveEvents: [], durable: rows });
	const record = () =>
		handle().transcript.records.find((entry) => entry.toolCallId === callId);

	// 1. THE SETTLE, whose call's row no page can hold yet. The frame states the
	// call's own start, so the walk's floor ends the speculative read at the tail
	// page: one request, not a walk to the bound.
	requests.length = 0;
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 3,
		type: "event",
		payload: settled,
	});
	await pump();
	assert.ok(record(), "the live settle paints the row");
	assert.ok(!record().args, "no page can label it yet");
	assert.equal(
		historyReads().length,
		1,
		"the speculative read is one request, not a walk to the bound",
	);

	// 2. THE RE-SYNC. The owner re-publishes a snapshot whose seed names the same
	// call: this is the seed path, and its charge is the call's first real one.
	deliver(
		snapshotFrame(4, {
			entries: page,
			liveEvents: [settled],
			streaming: true,
		}),
	);
	await pump();
	assert.ok(
		!record().args,
		"the seed cannot label a call whose row is not durable",
	);

	// 3. THE STEP COMMITS, and the durable round ending follows. The journal now
	// holds the call's assistant row - the one that carries its arguments - and its
	// result, so this read can answer, if the settle left it an attempt.
	globalThis.__seedDurable = [
		...rows,
		assistantRow("asst-r1", startedAt, [[callId, "npm test"]]),
		toolRow("res-r1", startedAt, callId, "… ok"),
	];
	requests.length = 0;
	deliver({
		session_id: SESSION,
		epoch: "bridge-epoch",
		seq: 5,
		type: "event",
		payload: { type: "turn_end" },
	});
	await pump();
	const retry = historyReads();
	assert.ok(
		retry.length >= 1,
		"the durable round ending still had its attempt to spend",
	);
	assert.ok(
		record().args,
		`the round end labels the row (reads: ${JSON.stringify(retry.map((read) => read.limit))})`,
	);
});

test("settle reads are coalesced across a flush and bounded by their own allowance", async () => {
	/*
	 * REVIEW ROUND 1, R2. A settle's read used to be a full bounded walk PER CALL -
	 * measured at 5 requests / 500 rows, twice, for one call whose row no page could
	 * read at all - against a body that said "one read per unlabelled settle". The
	 * properties pinned here are the ones the QA round measured in the shipped app:
	 * an OPEN with nothing to label is still exactly one request; N settles in ONE
	 * flush are ONE walk, sized by N targets rather than by one; a settle whose call
	 * a page already labelled asks for nothing; and what the path may spend when
	 * nothing can be labelled is `LABEL_SETTLE_ROWS_MAX` per conversation, not a walk
	 * per call.
	 */
	const { durable, page } = moment("labels");
	const starts = new Map();
	for (const row of durable.slice(0, -100)) {
		for (const call of row.payload.tool_calls ?? [])
			starts.set(call.id, row.ts);
	}
	const targets = [...starts.keys()].slice(-6);
	assert.equal(targets.length, 6, "the fixture needs six older calls");
	const deliverAll = (seq, payloads) => {
		for (const [index, payload] of payloads.entries())
			deliver({
				session_id: SESSION,
				epoch: "bridge-epoch",
				seq: seq + index,
				type: "event",
				payload,
			});
	};

	const { handle } = await open({ page, liveEvents: [], durable });
	assert.equal(
		historyReads().length,
		1,
		"an open with nothing to label is one request",
	);

	// N settles in one flush: one walk, over all of them.
	requests.length = 0;
	deliverAll(
		3,
		targets.map((callId) => endFrame(callId, "… ok", starts.get(callId))),
	);
	await pump();
	const coalesced = historyReads();
	assert.equal(
		coalesced[0]?.limit,
		reconcileLimit(targets.length),
		`one walk sized by the ${targets.length} targets, not one walk per call`,
	);
	assert.ok(
		coalesced.length <= RECONCILE_WALK_MAX_REQUESTS,
		`the coalesced walk stays inside its request bound (${coalesced.length})`,
	);
	for (const callId of targets) {
		const record = handle().transcript.records.find(
			(entry) => entry.toolCallId === callId,
		);
		assert.ok(record?.args, `the coalesced walk labels ${callId}`);
	}

	// A second batch whose calls a page has already labelled costs nothing further.
	requests.length = 0;
	deliverAll(
		9,
		targets
			.slice(0, 2)
			.map((callId) => endFrame(callId, "… ok", starts.get(callId))),
	);
	await pump();
	assert.equal(
		historyReads().length,
		0,
		"a settle for a call whose arguments are known asks for nothing",
	);

	// The unlabelable end of the path is bounded by its own allowance: six settles
	// whose rows are in no journal at all, one per flush, so each is its own walk.
	requests.length = 0;
	for (const [index, suffix] of ["A", "B", "C", "D", "E", "F"].entries()) {
		deliverAll(20 + index, [
			endFrameWithoutStart(`toolu_01SETTLEBUDGET${suffix}NOTINJOURNAL`, "… ok"),
		]);
		await pump();
	}
	const spent = historyReads().reduce((sum, read) => sum + read.limit, 0);
	assert.ok(spent > 0, "the first unlabelable settle is still read for");
	assert.ok(
		spent <= LABEL_SETTLE_ROWS_MAX,
		`the settle path spent ${spent} rows, over its ${LABEL_SETTLE_ROWS_MAX}-row allowance`,
	);
});

test("a cached paint does not paint a stand-in for a row its read was still waiting on", async () => {
	/*
	 * THE SWITCH-BACK PATH, which is where the reported symptom's own words land: a
	 * run of result lines where the commands belong, replaced a moment later.
	 *
	 * The rows here are what a paint cache holds when the reader leaves BEFORE the
	 * label read answers - the seed's argument-less calls, every one of them held
	 * empty by `labelPending` while the read is outstanding, and therefore stored
	 * with no arguments and no record of why. On the pre-fix tree the next mount
	 * paints the first line of such a row's OUTPUT into the object column
	 * (`outputFallbackLine`) and repaints the row when a read lands: the
	 * stand-in-to-command repaint no open may contain. What separates those rows
	 * from ones whose stand-in is the terminal truth is not in the rows - it is the
	 * owed set carried beside them.
	 */
	const { durable, page, liveEvents } = moment("labels");
	__resetPaintCache();
	__resetLabelGapBookkeeping();
	// The reader leaves while the read is still outstanding: the state that leaves
	// a hold behind, and the state the rows themselves cannot describe.
	globalThis.__seedHangHistory = true;
	const leaving = await open({ page, liveEvents, durable });
	const away = leaving.handle();
	assert.ok(away.labelPending.size > 0, "the join was still waiting on rows");
	writePaint(SESSION, {
		transcript: away.transcript,
		owedLabels: away.labelPending,
	});
	globalThis.__seedHangHistory = false;

	const frames = [];
	const back = mountCached({ onFrame: (view) => frames.push(view) });
	const firstFrame = frames[0];
	assert.ok(firstFrame, "the switch back painted a first frame");
	const standIns = firstFrame.transcript.records.filter(
		(record) =>
			record.kind === "tool" &&
			objectColumn(record, firstFrame.labelPending)?.startsWith("… ") === true,
	);
	assert.deepEqual(
		standIns.map((record) => record.toolCallId),
		[],
		"no stand-in on the first frame of a switch back",
	);
	// The rows the paint was waiting on are exactly the ones held, read off the
	// paint rather than guessed from the rows.
	for (const callId of away.labelPending)
		assert.ok(
			firstFrame.labelPending.has(callId),
			`${callId} is still held after the switch back`,
		);
	const tools = firstFrame.transcript.records.filter(
		(record) => record.kind === "tool",
	);
	assert.ok(tools.length > 0, "the paint carried the rows it was painted with");
	assert.equal(
		back.handle().labelPending.size,
		firstFrame.labelPending.size,
		"and the hold is still what the paint said it was",
	);
});

test("no frame of an open paints a stand-in for a seeded row whose read is outstanding", async () => {
	/*
	 * THE SEED PAINT, frame by frame rather than at one instant. `open()` records
	 * every render, and this walks all of them: the flush that paints the seed's
	 * rows registers their label targets in the SAME commit, so a row is never on
	 * screen showing result text in the command column while a read for it is
	 * outstanding. Allowed transitions are blank -> command, blank -> stand-in
	 * (after the hold is released) and command -> command; a stand-in that becomes
	 * anything else is the row repainting itself, which is the jitter this pins.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const frames = [];
	const { handle } = await open({
		page,
		liveEvents,
		durable,
		onFrame: (view) => frames.push(view),
	});
	const seen = new Map();
	for (const [index, view] of frames.entries()) {
		for (const record of view.transcript.records) {
			if (record.kind !== "tool") continue;
			const state = objectColumn(record, view.labelPending);
			const previous = seen.get(record.toolCallId);
			if (previous !== state) seen.set(record.toolCallId, state);
			assert.ok(
				!(previous?.startsWith("… ") && !state?.startsWith("… ")),
				`${record.toolCallId} repainted from its stand-in to ${state} on frame ${index}`,
			);
		}
	}
	assert.ok(frames.length > 1, "the open painted more than one frame");
	const firstWithRows = frames.find((view) =>
		view.transcript.records.some((record) => record.kind === "tool"),
	);
	const standInsOnFirstRows = firstWithRows.transcript.records.filter(
		(record) =>
			record.kind === "tool" &&
			!record.args &&
			objectColumn(record, firstWithRows.labelPending)?.startsWith("… "),
	);
	assert.deepEqual(
		standInsOnFirstRows.map((record) => record.toolCallId),
		[],
		"no stand-in on the first frame that shows rows",
	);
	assert.equal(handle().labelPending.size, 0, "the hold ends with the read");
});

test("no frame of an open paints a stand-in on the fall-short route either", async () => {
	/*
	 * THE SAME FRAME-COUNTED CLAIM ON THE ROUTE THE FIRST VERSION COULD NOT SEE
	 * (review round 1, m2): the recorder above runs on a TAIL page, where
	 * `reconcileLimit` covers the whole gap in one read, so the defect it exists to
	 * catch - a row let go by one page and named by the NEXT page of the same walk -
	 * structurally cannot appear there. This case serves the fall-short journal
	 * (`padded(durable, missing)`, the fixture of the case above), which makes the
	 * walk page backwards, and it is the route the reviewer measured 24 stand-in ->
	 * command repaints on: one per call the releasing commit had not labelled.
	 *
	 * The assertion is the invariant, not a count: the object column may go blank ->
	 * command, blank -> stand-in (once the budget is spent) or command -> command,
	 * and a stand-in that becomes anything else is a row repainting itself under the
	 * reader - exactly the operator's report.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const missing = new Set(unlabelledIn(page, liveEvents));
	const frames = [];
	await open({
		page,
		liveEvents,
		durable: padded(durable, missing),
		onFrame: (view) => frames.push(view),
	});
	assert.ok(
		historyReads().length >= 2,
		"the route really fell short, so the walk paged back",
	);
	const seen = new Map();
	for (const [index, view] of frames.entries()) {
		for (const record of view.transcript.records) {
			if (record.kind !== "tool") continue;
			const state = objectColumn(record, view.labelPending);
			const previous = seen.get(record.toolCallId);
			if (previous === state) continue;
			seen.set(record.toolCallId, state);
			assert.ok(
				!(previous?.startsWith("… ") && !state?.startsWith("… ")),
				`${record.toolCallId} repainted from its stand-in to ${state} on frame ${index}`,
			);
		}
	}
	const firstWithRows = frames.find((view) =>
		view.transcript.records.some((record) => record.kind === "tool"),
	);
	assert.deepEqual(
		firstWithRows.transcript.records
			.filter(
				(record) =>
					record.kind === "tool" &&
					!record.args &&
					objectColumn(record, firstWithRows.labelPending)?.startsWith("… "),
			)
			.map((record) => record.toolCallId),
		[],
		"no stand-in on the first frame that shows rows, on the paging route too",
	);
});

test("the turn's own liveness, not the newest row's, is what holds a spent read", async () => {
	/*
	 * AGENT REVIEW ROUND 3, M3, BOTH DIRECTIONS - and the case is built so that the
	 * ONLY difference between them is the turn's liveness.
	 *
	 * `turnRunning` used to walk the transcript backwards to the newest
	 * assistant-or-tool RECORD and ask whether that was unsettled. On this fixture
	 * every newest row is a settled tool call, the tail is
	 * `tool(done) | assistant(settled) | tool(done) | ... | tool(done)`, so it
	 * answered false on a live owner mid-turn: the rule's second term was inert on
	 * the very conversation the branch exists for, and a walk that stood down
	 * released rows a durable round ending then repainted - measured as 68
	 * stand-in -> command flips, unchanged across two heads.
	 *
	 * Both arms here run the SAME refusing owner and the SAME walk, so the page
	 * count and the read count are held constant: arm one is a turn in flight, arm
	 * two is the same conversation with no turn running. If the predicate went back
	 * to reading a record, arm two would still pass (nothing is streaming there
	 * either way) and arm one is the one that would fail.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const serve = globalThis.__seedRequest;
	const refuse = async (request) => {
		requests.push(request);
		if (request.op === "sessions.history")
			throw new Error("history unavailable");
		return {};
	};
	try {
		/* ARM ONE: the owner is mid-turn. The walk spends its retry on a refusal and
		 * stands down; the HOLD ends - nothing is out for these calls - and the MARK
		 * stands in its place, because the turn is still running and a round ending can
		 * still name them. */
		globalThis.__seedRequest = refuse;
		const live = await open({ page, liveEvents, durable });
		assert.equal(
			live.handle().labelPending.size,
			0,
			"a walk that stood down does not keep a row held once nothing is out for it",
		);
		assert.ok(
			live.handle().labelMarked.size > 0,
			"and the mark stands on those rows, which is what keeps the call's OUTPUT off them while a round ending can still name it",
		);
		assert.ok(
			historyReads().length >= 2,
			"and the case's route really is the spent-read one: the refusal cost the walk its retry",
		);
		/* The turn's own ending settles the question - its retry refuses too, so nothing
		 * is owed any more and the stand-in is the truth - and that is the other
		 * direction of the same rule, which is what makes the turn's liveness the thing
		 * this case is about. */
		deliver({
			session_id: SESSION,
			epoch: "bridge-epoch",
			seq: 3,
			type: "event",
			payload: { type: "turn_end" },
		});
		await pump();
		assert.equal(
			live.handle().labelMarked.size,
			0,
			"and the round's own ending releases them, which is the other direction of the same rule",
		);

		/* ARM TWO: the same refusal, the same walk, and no turn running. Nothing
		 * left can name these calls, so the stand-in is the truth and the release
		 * is immediate rather than at the backstop. */
		globalThis.__seedRequest = refuse;
		const finished = await open({
			page,
			liveEvents,
			durable,
			streaming: false,
		});
		assert.ok(
			historyReads().length >= 2,
			"the second arm ran the same walk, so the two arms differ only in the turn",
		);
		assert.equal(
			finished.handle().labelPending.size,
			0,
			"with no turn running the same stand-down releases the rows immediately: an unproven turn is not a running one",
		);
		assert.equal(
			finished.handle().labelMarked.size,
			0,
			"and nothing is marked either: the mark is the cue for a question that is still open, and with the turn over the stand-in is the truth",
		);
	} finally {
		globalThis.__seedRequest = serve;
	}
});

test("a refusal hands the hold to the mark, and a retry that names the call gives it the command", async () => {
	/*
	 * ROUND 4, THE ARM THE RULE IS ABOUT. Two routes reach a refused stand-down, and
	 * up to the instant the answer would arrive they are the same walk: an owner that
	 * will refuse forever, whose rows end on the output stand-in, and an owner whose
	 * next round ending names the calls, whose rows must never state the output in the
	 * meantime. A walk cannot tell them apart, so the refusal decides neither - it
	 * ends the HOLD (no read is out for these ids any more) and stands the MARK, which
	 * states no fact and therefore cannot state the wrong one.
	 *
	 * Both of that mark's exits are pinned here on ONE route: the owner refuses the
	 * walk's own two attempts and then ANSWERS the round ending's retry, so the row
	 * goes mark -> COMMAND and never states the call's output. Releasing to the
	 * stand-in at the stand-down instead - the variant round 4 priced and rejected -
	 * shows the call's output in the command column on this route and then repaints
	 * it: 26 rows of output text, from 125 ms to the read that names them. This case
	 * fails on that tree at the FRAME WALK below, because those rows are released and
	 * their column is therefore the stand-in - which is the property round 4's rig
	 * measures in the DOM, one state later.
	 *
	 * WHAT THIS CASE CANNOT SEE, stated so the gate is not read as covering it: this
	 * harness computes a row's column from the view's own sets (see `objectColumn`),
	 * so a tree that FILLS `labelMarked` and then does not render it passes here. That
	 * tree is caught by the markup case's shape assertion on `summaryHold`, and by the
	 * built app's census of `[data-label-hold]` - not by this walk, and not by the
	 * counts beside it.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const serve = globalThis.__seedRequest;
	let reads = 0;
	const frames = [];
	try {
		globalThis.__seedRequest = async (request) => {
			requests.push(request);
			if (request.op !== "sessions.history") return {};
			reads += 1;
			/* The walk's OWN attempts refuse; everything after them answers. */
			if (reads <= 2) throw new Error("history unavailable");
			return { entries: durable, has_more: false, cursor_missing: false };
		};
		const live = await open({
			page,
			liveEvents,
			durable,
			onFrame: (view) => frames.push(view),
		});
		assert.ok(
			historyReads().length >= 2,
			"the walk spent its retry on the refusal and stood down",
		);
		/*
		 * The ids under test are the ones the HOLD was for, read off the frames rather
		 * than off `labelMarked`: a tree that released these rows to their stand-ins
		 * instead of marking them would leave that set empty, and a case whose subject
		 * came from the set it is testing could not see the difference. Every one of
		 * these is a call the refusal failed to name, and not one may ever show the
		 * call's output.
		 */
		const firstWithHold = frames.find((view) => view.labelPending.size > 0);
		assert.ok(
			firstWithHold,
			"the open holds the seed's unlabelled calls while its read is out",
		);
		const targets = [...firstWithHold.labelPending];
		assert.ok(
			targets.length > 0,
			"and the hold has rows to hand on, so the route really is the refusal one",
		);
		const marked = [...live.handle().labelMarked];
		assert.equal(
			live.handle().labelPending.size,
			0,
			"the hold itself is over - the mark is what stands in its place",
		);
		/*
		 * NOT ONE FRAME MAY SHOW THOSE ROWS AS STAND-INS. `objectColumn` prints the
		 * mark as the bare glyph and a stand-in as `… ` plus content, so a stand-in
		 * here is the call's OUTPUT in the command column - the repaint this branch
		 * exists to remove, one state earlier.
		 */
		const standInFrames = frames.filter((view) =>
			targets.some((id) => {
				const record = view.transcript.records.find(
					(row) => row.kind === "tool" && row.toolCallId === id,
				);
				return (
					record !== undefined &&
					objectColumn(record, view.labelPending, view.labelMarked)?.startsWith(
						"… ",
					)
				);
			}),
		);
		assert.deepEqual(
			standInFrames.map((view) => view.labelMarked.size),
			[],
			"no frame states the call's output while the question is open",
		);
		assert.ok(
			marked.length > 0,
			"and the refusal handed those rows to the mark: no read is out for them, and the cue is what stands in the hold's place",
		);
		/* The round ending: its retry ANSWERS, and the page names every call. */
		deliver({
			session_id: SESSION,
			epoch: "bridge-epoch",
			seq: 3,
			type: "event",
			payload: { type: "turn_end" },
		});
		await pump();
		assert.equal(
			live.handle().labelMarked.size,
			0,
			"and the read that names the call ends the mark, so the cue gives way to the command",
		);
		assert.deepEqual(
			marked.filter((id) => !live.handle().transcript.argsByCall.has(id)),
			[],
			"every marked call is named now, which is the answer the cue was standing in for",
		);
	} finally {
		globalThis.__seedRequest = serve;
	}
});

test("the held column is marked once the hold has outlived its own threshold", async () => {
	/*
	 * DESIGN REVIEW ROUND 3, D7 - BLOCKER - AND THE DEFECT WAS THAT NOTHING WROTE
	 * THE FLAG. The round-2 commit threaded `labelHoldLate` from the view through
	 * the pane to `ToolLedgerRow`'s `summaryHold`, and the mark's own design was
	 * approved on the designer's armed probe tree; but `git grep labelHoldLate`
	 * found two `false` initialisers and consumers and no writer, `LABEL_HOLD_MARK_MS`
	 * was named only in comments, and the built chunk wrote `labelHoldLate:!1`
	 * twice and `:!0` never - 5 395 head pane frames, 0 marks.
	 *
	 * The case drives the threshold with the same fake-timer harness the backstop
	 * case uses, and asserts the three names the finding is about: the CONSTANT
	 * (read by code, not only declared), the view FLAG the pane passes down, and the
	 * row's `data-label-hold` markup - the last of the three the JSX-level way this
	 * suite already asserts a rule that needs the whole chat tree to render.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const serve = globalThis.__seedRequest;
	globalThis.__seedRequest = async (request) => {
		requests.push(request);
		if (request.op === "sessions.history") return new Promise(() => {});
		return {};
	};
	try {
		const { handle } = await open({ page, liveEvents, durable });
		assert.ok(
			handle().labelPending.size > 0,
			"the rows are held while the read that would name them is outstanding",
		);
		assert.equal(
			handle().labelHoldLate,
			false,
			"and a fresh hold is BLANK: the first paint carries no ink the reader has to un-see",
		);
		fireTimers(LABEL_HOLD_MARK_MS);
		await pump();
		assert.equal(
			handle().labelHoldLate,
			true,
			"a hold past the threshold is marked, which is the state that had no writer",
		);
		/* THE PROP. `canonical-transcript.tsx` passes `summaryHold={labelPending
		 * === true && labelHoldLate === true}`, so the flag alone is not the mark:
		 * a row that has left the held set must not paint it, and the two together
		 * are what the row renders off. */
		const summaryHold = (id) =>
			handle().labelPending.has(id) === true && handle().labelHoldLate === true;
		assert.deepEqual(
			[...handle().labelPending].filter(summaryHold).sort(),
			[...handle().labelPending].sort(),
			"every held row's summaryHold prop is true once the flag is armed, which is what makes the mark reachable at all",
		);
	} finally {
		globalThis.__seedRequest = serve;
	}

	/* THE MARK DOES NOT ARRIVE FOR A HOLD THAT ENDED BEFORE THE THRESHOLD. Design
	 * round 3 measured the other side of the number - 0 marks in 724 frames on a
	 * 1 500 ms read whose hold ended at 1 566 ms - and it is what stops the cue
	 * from firing on every read that is merely slow. */
	globalThis.__seedRequest = serve;
	const finished = await open({ page, liveEvents, durable, streaming: false });
	assert.equal(
		finished.handle().labelPending.size,
		0,
		"the second arm's hold is over before its threshold",
	);
	fireTimers(LABEL_HOLD_MARK_MS);
	await pump();
	assert.equal(
		finished.handle().labelHoldLate,
		false,
		"and the deadline was cleared with the set, so no mark arrives after the hold ended",
	);
});

test("the mark's own markup, the constant's reader and the prop's guard are all wired", () => {
	/*
	 * The half of D7 a hook-level case cannot reach: the mark is rendered by
	 * `tool-row.tsx`, which needs the whole chat feature tree to mount. This suite
	 * already asserts JSX-level rules this way (see `canonical-chat.test.mjs`'s
	 * sidebar case for the rationale), and the specific defect being guarded is
	 * "a described cue that cannot render", so the assertions are about the WIRING
	 * rather than about a frame.
	 *
	 * Comments are stripped before matching: prose that names an attribute is
	 * exactly what D7 found, and a match against a comment would pass on the
	 * broken tree.
	 */
	const strip = (text) => text.replace(COMMENT_TEXT, "");
	const hook = strip(
		readFileSync(
			"src/renderer/src/shared/hooks/use-canonical-session.ts",
			"utf8",
		),
	);
	const readByCode = hook.match(/LABEL_HOLD_MARK_MS/g) ?? [];
	assert.ok(
		readByCode.length > 1,
		`LABEL_HOLD_MARK_MS is declared and READ: D7's defect was that its only other mentions were comments (${readByCode.length} code occurrence(s))`,
	);
	const row = strip(
		readFileSync(
			"src/renderer/src/features/chat/components/trace/tool-row.tsx",
			"utf8",
		),
	);
	assert.match(
		row,
		MARK_ON_SUMMARY_HOLD,
		"the row's own mark is gated on the summaryHold prop and carries data-label-hold, so the census a rig takes is a census of this cue",
	);
	assert.match(
		row,
		TITLE_SUPPRESSED_WHILE_HELD,
		"and a held cell states no title, so the tooltip cannot answer with the fact the cell is withholding",
	);
	const transcript = strip(
		readFileSync(
			"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
			"utf8",
		),
	);
	assert.match(
		transcript,
		SUMMARY_HOLD_PROP,
		"the prop the row reads stands the mark on a row a refusal RELEASED as well as on a held row past its threshold, so the cue cannot be lost on the route where the hold no longer applies",
	);
});

test("a switch back through the real tear-down paints no stand-in on its first frame", async () => {
	/*
	 * AGENT REVIEW ROUND 3, M2'S SWITCH-BACK ROUTE, THROUGH THE PRODUCTION
	 * EXPRESSION. The shipped case hand-wrote the cache entry
	 * (`owedLabels: away.labelPending`) because this stand-in ran an effect cleanup
	 * only when a dep changed: the tear-down that actually WRITES the paint was
	 * unreachable, so the expression `labelPending INTERSECT labelOwed` had no
	 * coverage on any route, hanging or ended. `runtime.unmount()` is that path.
	 *
	 * TWO ARMS, because the cache carries TWO states now (round 4) and only one of
	 * them is the owed set. ARM ONE leaves with a read still outstanding, so the row
	 * is held and what has to travel is `owedLabels` - the intersection above, which
	 * had no coverage on any route before this case. ARM TWO leaves after a REFUSAL:
	 * the hold is over and the mark stands, which is a state `owedLabels` cannot carry
	 * at all, so what travels is `markLabels`. A mount that ignores either paints the
	 * call's output in the command column on its FIRST frame - the jitter moved one
	 * mount later - so both arms assert the same frame-level property.
	 */
	const { durable, page, liveEvents } = moment("labels");
	const serve = globalThis.__seedRequest;
	const leaveWith = async (respond) => {
		globalThis.__seedRequest = respond;
		let away = null;
		try {
			const leaving = await open({ page, liveEvents, durable });
			away = leaving.handle();
			leaving.runtime.unmount();
		} finally {
			globalThis.__seedRequest = serve;
		}
		return away;
	};
	/* ARM ONE: the read is out when the reader leaves, so the row is HELD. */
	const hanging = await leaveWith(async (request) => {
		requests.push(request);
		if (request.op === "sessions.history") return new Promise(() => {});
		return {};
	});
	assert.ok(
		hanging.labelPending.size > 0,
		"the reader leaves with rows still held, which is the state `owedLabels` carries",
	);
	const firstPaint = readPaint(SESSION);
	assert.ok(
		firstPaint,
		"the real tear-down wrote this conversation's paint, so the case is not reading a hand-written entry",
	);
	assert.equal(
		firstPaint.owedLabels.size,
		hanging.labelPending.size,
		`the paint carries what it was still waiting on (${firstPaint.owedLabels.size} of ${hanging.labelPending.size} held rows)`,
	);
	const heldFrames = [];
	const heldBack = mountCached({ onFrame: (view) => heldFrames.push(view) });
	const heldFirst = heldFrames[0];
	assert.ok(
		heldFirst.labelPending.size > 0,
		"and the switch back seeds its hold from that field, so the rows are held in its first frame",
	);
	assert.deepEqual(
		heldFirst.transcript.records
			.filter(
				(record) =>
					record.kind === "tool" &&
					!record.args &&
					objectColumn(
						record,
						heldFirst.labelPending,
						heldFirst.labelMarked,
					)?.startsWith("… "),
			)
			.map((record) => record.toolCallId),
		[],
		"no stand-in on the switch back's first frame: the row shows its empty column, not the call's output where its command belongs",
	);
	assert.ok(
		heldBack.handle().labelPending.size > 0,
		"and the hold is real rather than a frame that happens to be empty",
	);

	/* ARM TWO: the route REFUSED, so the reader leaves with the mark STANDING. */
	const refused = await leaveWith(async (request) => {
		requests.push(request);
		if (request.op === "sessions.history")
			throw new Error("history unavailable");
		return {};
	});
	assert.equal(
		refused.labelPending.size,
		0,
		"a refusal ends the hold, so what the reader leaves with is the mark rather than a held row",
	);
	assert.ok(
		refused.labelMarked.size > 0,
		"and the mark is the state the cache has to carry for those rows",
	);
	const markPaint = readPaint(SESSION);
	assert.equal(
		markPaint.markLabels.size,
		refused.labelMarked.size,
		`the paint carries the rows whose mark was standing (${markPaint.markLabels.size} of ${refused.labelMarked.size})`,
	);
	const markFrames = [];
	const markedBack = mountCached({ onFrame: (view) => markFrames.push(view) });
	const markFirst = markFrames[0];
	assert.ok(
		markFirst.labelMarked.size > 0,
		"and the switch back seeds the mark from that field, so the cue is standing in its first frame",
	);
	assert.deepEqual(
		markFirst.transcript.records
			.filter(
				(record) =>
					record.kind === "tool" &&
					!record.args &&
					objectColumn(
						record,
						markFirst.labelPending,
						markFirst.labelMarked,
					)?.startsWith("… "),
			)
			.map((record) => record.toolCallId),
		[],
		"no stand-in on the switch back's first frame after a refusal either: the row shows the cue, not the call's output where its command belongs",
	);
	assert.ok(
		markedBack.handle().labelMarked.size > 0,
		"and the mark is real rather than a frame that happens to be empty",
	);
});
