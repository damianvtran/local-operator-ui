import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE PAINT'S CLAIMS, AND THE COMMIT THAT ENDS THEM.
 *
 * The paint cache can carry a reader's place, the fact that a turn was running,
 * and whether the rows it kept are the WHOLE conversation (see `paint-cache.ts`).
 * All are claims about the RECENT PAST: the seeded mount reads them in its first
 * frame, and the owner's snapshot - the only authority - keeps or withdraws them
 * in the commit that replaces the rows. This file drives the SHIPPED hook to pin
 * that hand-off, because it is the seam neither the store's suites (which stub
 * the hook) nor the transcript's (which take `paintBusy`/`paintScroll`/
 * `paintComplete` as props) can see.
 *
 * WHY THIS FILE EXISTS (agent review C2 on #1883): the seeded half had tests
 * through the props, and the CLEARING half had none - so a snapshot that forgot
 * to withdraw a claim would have left a return painting a working line for a
 * turn that ended while the reader was away, with every suite green. The same
 * hole for `complete` is agent review M1 round 1: reverting the seed, the
 * snapshot's clear, the TSX prop or the seeded leave's carry left every suite
 * green.
 *
 * The substitutions are the same three `seed-placement.test.mjs` documents:
 * React's scheduler (a cell-based stand-in), the transport (a scripted
 * subscription), and the clock (the hook's two flush triggers are taken over so
 * `pump()` decides when a flush happens). The reducer, the hook and the paint
 * cache are the shipped modules.
 */

// `zustand/middleware` reaches for localStorage at import time.
const store = new Map();
globalThis.localStorage = {
	getItem: (key) => store.get(key) ?? null,
	setItem: (key, value) => store.set(key, value),
	removeItem: (key) => store.delete(key),
};

// The hook's flush triggers, owned by the test.
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

const subscriptions = [];
const requests = [];
globalThis.__paintSubscribe = (args, onEvent) => {
	const entry = { args, onEvent, disposed: false };
	subscriptions.push(entry);
	return () => {
		entry.disposed = true;
	};
};
globalThis.__paintRequest = async (request) => {
	requests.push(request);
	// The one read the hook makes on its own: the reconcile behind a snapshot.
	// An empty page is a complete answer, and it ends the walk instead of
	// leaving a promise that never settles.
	if (request.op === "sessions.history") {
		return { entries: [], has_more: false, cursor_missing: false };
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
			export { __resetPaintCache, readPaint, writePaint, writePaintScroll } from "./src/renderer/src/shared/store/paint-cache";
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
			name: "paint-claims-fixture",
			setup(builder) {
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "paint-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "paint-fixture" }, () => ({
					contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {};
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__paintRequest(request);
						export const subscribeDesktopStream = (args, onEvent) => globalThis.__paintSubscribe(args, onEvent);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "paint-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "paint-react" }, () => ({
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
	__resetPaintCache,
	readPaint,
	writePaint,
	writePaintScroll,
} = hook;

const SESSION = "paint-claims-session";

/**
 * The C8 pins, at module scope so biome's `useTopLevelRegex` stays quiet: the
 * hook's unmount cleanup cannot be driven into this state through a mounted
 * draft panel, so its two facts are read off the source.
 */
const PAINT_CLEANUP_IDENTITY = /pendingSendForView\(identityRef\.current\)/;
const PAINT_CLEANUP_DEPS =
	/inFlightOwned\.current\.clear\(\);[\s\S]{0,400}?\}, \[sessionId\]\);/;
/** The transcript's own read of the view's flag; a dropped prop disables the fix. */
const PAINT_COMPLETE_PROP = /paintComplete=\{canonical\.view\.paintComplete\}/;

/** A source file with its comments stripped, so a lexical pin reads code alone. */
function code(path) {
	return readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/* ------------------------------------- the React stand-in (one cell per call) */

/** The cell-based stand-in `seed-placement.test.mjs` documents. */
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

/* --------------------------------------------------------------- the wire */

const openFrame = (seq, gap) => ({
	session_id: SESSION,
	epoch: "bridge-epoch",
	seq,
	type: "open",
	payload: { subscription_id: `sub-${seq}`, gap, watch_ttl_seconds: 45 },
});

/** A snapshot that names no rows, so only the paint's claims are under test. */
const snapshotFrame = (seq, { streaming }) => ({
	session_id: SESSION,
	epoch: "bridge-epoch",
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch: "owner-epoch",
			sequence: seq,
			live_cursor: "",
			snapshot: {
				epoch: "owner-epoch",
				sequence: seq,
				cwd: "/tmp/probe",
				conversation_title: "Paint claims",
				conversation_title_user_set: false,
				conversation_title_forked: false,
				goal: "",
				active_agent: "",
				active_team: "",
				selected_model: null,
				effective_model: null,
				streaming,
				generation: 1,
				pending_gate: null,
				history_cursor: "",
				live_events: [],
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
		history: { entries: [], has_more: false, cursor_missing: false },
		cold: false,
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

/* --------------------------------------------------------------- the case */

const TS = 1_760_000_000_000;
const ROW = {
	kind: "user",
	id: "user:1",
	ts: TS,
	text: "Which invoices were late last month?",
	images: [],
};
const PAINTED = {
	records: [ROW],
	index: new Map([[ROW.id, 0]]),
	generation: 1,
	oldestId: null,
	oldestTs: 0,
	hasMore: false,
	argsByCall: new Map(),
	compacting: false,
	compactingSince: 0,
	viewEpoch: 0,
};
/**
 * The same paint as the pane that PROVED the conversation whole: its page named
 * the first row as the cursor and owed nothing older, so the write derives
 * `complete: true` (the stored copy still carries no cursor - that is the whole
 * point of the F1 case below).
 */
const COMPLETE_PAINTED = {
	...PAINTED,
	oldestId: ROW.id,
	oldestTs: TS,
};

test("the seeded claims stand in the first frame and the snapshot clears both", async () => {
	__resetPaintCache();
	// What a reader's leave wrote: rows, the place they were looking at, and the
	// fact that a turn was running.
	writePaint(SESSION, { transcript: PAINTED, busy: true });
	writePaintScroll(SESSION, {
		pinned: false,
		id: "user:1",
		offsetPx: 42,
	});
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});

	const runtime = makeRuntime();
	// Every render's view is kept: the SEED is what the first frame holds (the
	// transcript restores it in that commit's layout phase) and the hook then
	// spends the place so a later render cannot restore it twice - both are
	// asserted below.
	const frames = [];
	runtime.render = () => {
		const view = useCanonicalSessionStream(SESSION, true);
		frames.push(view);
		return view;
	};
	runtime.rerender();
	const seeded = frames[0];
	// The seeded mount: the claims are this window's memory, so they are on
	// screen before the owner has said anything.
	assert.equal(
		seeded.paintBusy,
		true,
		"the turn was running when the reader left",
	);
	assert.deepEqual(
		seeded.paintScroll,
		{ pinned: false, id: "user:1", offsetPx: 42 },
		"and the reader left mid-transcript",
	);
	assert.equal(
		seeded.stale,
		true,
		"the rows are this window's, not the owner's",
	);
	assert.equal(
		frames.at(-1).paintScroll,
		null,
		"the first frame spent the place; a later render cannot restore it twice",
	);
	deliver(openFrame(1, false));
	/*
	 * A snapshot whose turn IS running: the flag must still be withdrawn, because
	 * from this commit on the authority is `frontend.streaming` - the same field
	 * the live pane's working line reads - and not the cache's older claim.
	 */
	deliver(snapshotFrame(2, { streaming: true }));
	await pump();
	// The commit's own view, not the pre-snapshot one: `setView` publishes a new
	// object and the handle above is a frame the reader has moved past.
	const settled = frames.at(-1);

	assert.equal(
		settled.paintBusy,
		false,
		"the snapshot's streaming bit is the authority, the paint's flag is not",
	);
	assert.equal(
		settled.paintScroll,
		null,
		"the place was consumed by the mount",
	);
	assert.equal(settled.stale, false, "the rows are the owner's now");
	assert.equal(settled.frontend?.streaming, true, "and the live claim stands");
});

test("a seeded claim survives a leave taken before the snapshot", async () => {
	/*
	 * Agent review round 2, C7. The seeded mount paints a working line in its
	 * first frame with NO live reading behind it (`frontend` and `heldFrontend`
	 * are null until the snapshot lands), so a leave taken inside that window - the
	 * measured median is ~1.3 s, which makes a quick toggle common - wrote
	 * `busy:false` over the running turn and the next return painted idle chrome.
	 *
	 * Driven through the SHIPPED hook, because the defect lives at the write: the
	 * predicate cases beside this file pin the rule, and this one pins that the
	 * rule is the one the unmount uses.
	 */
	__resetPaintCache();
	writePaint(SESSION, { transcript: PAINTED, busy: true });
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});

	const runtime = makeRuntime();
	let mountedSession = SESSION;
	runtime.render = () => useCanonicalSessionStream(mountedSession, true);
	runtime.rerender();
	assert.equal(
		readPaint(SESSION).busy,
		true,
		"the seeded mount still holds the claim (the snapshot has not answered)",
	);
	// Leave without ever delivering the snapshot: this is the second toggle.
	mountedSession = null;
	runtime.rerender();
	const left = readPaint(SESSION);
	assert.equal(
		left.busy,
		true,
		"the claim this mount painted travels with its rows",
	);
});

test("a complete seed reaches the pane and the snapshot's page takes over", async () => {
	/*
	 * Agent review M1. Three production lines carry this one claim, and reverting
	 * any of them left every suite green: `complete: cached.complete` in
	 * `paintSeed`, `paintComplete: null` in the snapshot's commit, and the prop the
	 * transcript reads. Driven through the SHIPPED hook, the claim is on the first
	 * frame and the owner's answer is the authority from its commit on.
	 */
	__resetPaintCache();
	writePaint(SESSION, { transcript: COMPLETE_PAINTED });
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});

	const runtime = makeRuntime();
	const frames = [];
	runtime.render = () => {
		const view = useCanonicalSessionStream(SESSION, true);
		frames.push(view);
		return view;
	};
	runtime.rerender();
	const seeded = frames[0];
	assert.equal(
		seeded.stale,
		true,
		"the rows are this window's, not the owner's",
	);
	assert.equal(
		seeded.paintComplete,
		true,
		"and they are the whole conversation the last visit proved",
	);
	deliver(openFrame(1, false));
	// The snapshot's own page names no rows, and the commit withdraws the claim
	// regardless: the page, not the cache, is the coverage authority from here on.
	deliver(snapshotFrame(2, { streaming: false }));
	await pump();
	const settled = frames.at(-1);
	assert.equal(settled.stale, false, "the rows are the owner's now");
	assert.equal(
		settled.paintComplete,
		null,
		"the seed's claim stops at the page's commit",
	);
});

test("a seeded leave before the snapshot keeps the entry's coverage", async () => {
	/*
	 * Agent review F1 / QA Q1. The pane is stale, so its transcript is the seeded
	 * one and has no paging cursor; re-deriving would demote a complete short
	 * conversation, and the NEXT return would bottom-align it then move every row
	 * UP when the page landed (253.1 px on a one-turn session, 4/4).
	 */
	__resetPaintCache();
	writePaint(SESSION, { transcript: COMPLETE_PAINTED });
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});

	const runtime = makeRuntime();
	let mountedSession = SESSION;
	runtime.render = () => useCanonicalSessionStream(mountedSession, true);
	runtime.rerender();
	assert.equal(
		readPaint(SESSION).complete,
		true,
		"the seed this mount paints is complete",
	);
	// Leave without ever delivering the snapshot: the second toggle.
	mountedSession = null;
	runtime.rerender();
	const left = readPaint(SESSION);
	assert.equal(
		left.transcript.oldestId,
		null,
		"the stored copy carries no cursor, so the derivation alone would say incomplete",
	);
	assert.equal(
		left.complete,
		true,
		"so the claim the stale pane was painting travels with its rows",
	);
});

test("a mount with no cached paint reports no paint at all", () => {
	/*
	 * Agent review M2: `paintComplete` describes a cache entry, and a mount the
	 * cache did not seed has none. `false` left `hasEntry` true and contradicted
	 * the field's own doc, leaving `stale` as the only thing keeping a no-entry
	 * pane top-anchored.
	 */
	__resetPaintCache();
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});
	const runtime = makeRuntime();
	const frames = [];
	runtime.render = () => {
		const view = useCanonicalSessionStream(SESSION, true);
		frames.push(view);
		return view;
	};
	runtime.rerender();
	assert.equal(frames[0].stale, false, "nothing was seeded");
	assert.equal(
		frames[0].paintComplete,
		null,
		"and the flag says so rather than claiming an entry",
	);
});

test("the paint's cleanup depends on the conversation, not the identity", () => {
	/*
	 * Agent review round 2, C8. A fresh draft's identity moves `draftKey` ->
	 * the created session's id while the STREAM id stays the same, so an
	 * `identity` dependency fired this cleanup mid-session: it wrote a paint for
	 * a conversation the reader was still looking at and dropped this mount's
	 * `inFlight` label reads with it. The identity is read through a ref for
	 * exactly that reason, and the write still names the CURRENT identity because
	 * the echo registry a send paints into is keyed by it.
	 *
	 * ASSERTED IN THE SOURCE, the shape the siblings use for a call-site fact
	 * (`working-line-clock.test.mjs`'s memo-dependency case): the hook's unmount
	 * cleanup cannot be driven into this state through the shipped hook without
	 * a mounted draft panel, and the two things that must hold are both lexical -
	 * the ref read at the write, and `sessionId` alone in the array.
	 */
	const source = code("src/renderer/src/shared/hooks/use-canonical-session.ts");
	assert.match(
		source,
		PAINT_CLEANUP_IDENTITY,
		"the write reads the identity of the last committed render",
	);
	assert.match(
		source,
		PAINT_CLEANUP_DEPS,
		"and the cleanup runs on a conversation change alone",
	);
});

test("the transcript is handed the view's coverage flag", () => {
	/*
	 * Agent review M1's third line. The hook can seed and clear `paintComplete`
	 * perfectly and the layout still reads nothing if this prop is dropped: the
	 * transcript takes the flag as a prop, so the seam is the JSX call site.
	 */
	assert.match(
		code("src/renderer/src/features/chat/components/chat-content.tsx"),
		PAINT_COMPLETE_PROP,
		"a dropped or renamed prop disables the anchor rule the whole PR rests on",
	);
});
