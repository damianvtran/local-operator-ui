/**
 * The paused-live-updates banner, driven through the REAL hook.
 *
 * WHY THIS FILE EXISTS. The backend replaces any frame over its 1 MiB socket cap
 * with a passive notice (`frontend.update.degraded`/`.paused`, or an `event`
 * whose `action` is `reload`). The desktop app used to fold the notice's empty
 * delta and go on looking live: a long-lived session froze with no affordance.
 * The view now carries `liveUpdatesPaused` and the handle exposes
 * `reloadFromHistory`; this file pins the three things a regression would take
 * away silently:
 *
 *   1. a notice RAISES the flag, whatever the frame's sequence says - it is a
 *      statement about the transport, not about the facade's clock;
 *   2. only a frame that PROVES the view current clears it (a snapshot, a
 *      replacement, or an accepted clean update), and the press itself does not;
 *   3. the reload is the reconnect/resync path, and the repaint MERGES - an
 *      in-flight message's echo row survives it, and its retained pending send
 *      is neither dropped nor duplicated.
 *
 * HOW. The same harness `scripts/context-readout-monotonic.test.mjs` uses: the
 * shipped hook and store, a cell-based React stand-in, a stubbed transport and
 * a drained frame queue. Assertions are on the handle the hook returns after a
 * stated frame sequence, never on a helper's return value.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

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
			export { useCanonicalSessionStream, paintPendingSend, pendingSendForView, hasPendingSend } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
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
			name: "live-updates-fixture",
			setup(builder) {
				builder.onResolve({ filter: DESKTOP_API_FILTER }, () => ({
					path: "transport",
					namespace: "live-updates-fixture",
				}));
				builder.onLoad(
					{ filter: ANY_FILE_FILTER, namespace: "live-updates-fixture" },
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
					namespace: "live-updates-react",
				}));
				builder.onLoad(
					{ filter: ANY_FILE_FILTER, namespace: "live-updates-react" },
					() => ({
						contents: reactStandIn,
						loader: "js",
					}),
				);
			},
		},
	],
});
const {
	useCanonicalSessionStream,
	paintPendingSend,
	pendingSendForView,
	hasPendingSend,
	useCanonicalSessionsStore,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "aaaaaaaaaaaa";
const OWNER_EPOCH = "owner-epoch";
const BRIDGE_EPOCH = "bridge-epoch";

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

const frontendState = ({ cwd = "/repo", sequence, sessionId = SESSION }) => ({
	state_version: 1,
	session_id: sessionId,
	epoch: OWNER_EPOCH,
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
	history_cursor: null,
	live_events: [],
	queued_steering: [],
	jobs: [],
	todos: [],
	wakes: [],
	mcp_servers: [],
	model_catalogue: [],
	context_tokens: 100000,
	context_window: 1000000,
	context_is_estimate: false,
	context_breakdown: null,
	last_usage: null,
});

const openFrame = (seq, gap = false) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "open",
	payload: { subscription_id: `sub-${seq}`, gap, watch_ttl_seconds: 45 },
});

const snapshotFrame = (seq, ownerSequence = 1) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch: OWNER_EPOCH,
			sequence: ownerSequence,
			live_cursor: null,
			snapshot: frontendState({ sequence: ownerSequence }),
		},
		history: { entries: [], has_more: false, cursor_missing: false },
		cold: false,
	},
});

const updateFrame = (seq, ownerSequence, extra = {}) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.update",
	payload: {
		epoch: OWNER_EPOCH,
		sequence: ownerSequence,
		changes: { cwd: "/repo" },
		job_trajectory_appends: {},
		job_trajectory_replacements: [],
		...extra,
	},
});

/**
 * A replacement that belongs to ANOTHER conversation. The bridge checks the
 * payload's session id (`acceptFrontendReplace`) and the renderer must refuse
 * it; the banner must not clear on a frame that proves nothing about this view.
 */
const foreignReplaceFrame = (seq) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.replace",
	payload: {
		frontend: {
			state_version: 1,
			epoch: OWNER_EPOCH,
			sequence: 2,
			live_cursor: null,
			snapshot: frontendState({
				sequence: 2,
				sessionId: "bbbbbbbbbbbb",
			}),
		},
		cold: false,
	},
});

const reloadNoticeFrame = (seq) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "event",
	payload: { type: "notice", action: "reload" },
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

/** Mount the shipped hook, deliver `frames`, and hand back its handle. */
async function mount(frames = [], { paintSend = false } = {}) {
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
	});
	if (paintSend) {
		/*
		 * Painted BEFORE the mount, exactly as the New-chat press does: the
		 * retained entry is seeded into the pane's first frame by
		 * `seedPendingSends`, which is also the path a snapshot repaint must
		 * preserve. The row's id is the admission request id the store would use.
		 */
		paintPendingSend(SESSION, {
			id: "request-echo",
			text: "still sending",
			images: [],
		});
	}
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
	deliver(snapshotFrame(seq++));
	await pump();
	for (const frame of frames) deliver(frame);
	await pump();
	/*
	 * A LIVE READER, not the object captured at the last render: every commit
	 * replaces the handle, so a test that held the first one would assert against
	 * a frozen view - the same mistake `context-readout-monotonic.test.mjs` avoids
	 * by asserting only after the run has settled. The cases below press a control
	 * and then keep watching, so they need the current one.
	 */
	return () => handle;
}

/* ----------------------------------------------------------------- the cases */

test("a degraded delta raises the banner, and a clean accepted delta clears it", async () => {
	const view = await mount([updateFrame(3, 2, { degraded: true })]);
	assert.equal(
		view().liveUpdatesPaused,
		true,
		"a degraded update must say the view may be stale",
	);
	assert.equal(view().liveUpdatesReloading, false);

	const cleanView = await mount([
		updateFrame(3, 2, { degraded: true }),
		updateFrame(4, 3),
	]);
	assert.equal(
		cleanView().liveUpdatesPaused,
		false,
		"the owner speaking at the next sequence, with no notice, proves the view current",
	);
});

test("a paused delta raises the banner even when its sequence is behind the painted clock", async () => {
	/*
	 * The notice describes the TRANSPORT, not the facade, so the same-sequence /
	 * older-sequence gate that rejects a stale delta must not swallow it. This is
	 * the frame that used to freeze a long-lived session with no affordance.
	 */
	const view = await mount([updateFrame(3, 1, { paused: true })]);
	assert.equal(view().liveUpdatesPaused, true);
});

test("a replacement for another conversation does not clear the banner", async () => {
	const view = await mount([
		updateFrame(3, 2, { degraded: true }),
		foreignReplaceFrame(4),
	]);
	assert.equal(
		view().liveUpdatesPaused,
		true,
		"a refused replacement proves nothing about this view",
	);
});

test("an event notice asking for a reload raises the banner", async () => {
	const view = await mount([reloadNoticeFrame(3)]);
	assert.equal(view().liveUpdatesPaused, true);
});

test("reload re-arms the stream, acknowledges the press, and the snapshot clears both", async () => {
	const view = await mount(
		[
			updateFrame(3, 2, { degraded: true }),
			updateFrame(4, 3, { degraded: true }),
		],
		{ paintSend: true },
	);
	assert.equal(view().liveUpdatesPaused, true);
	assert.equal(
		hasPendingSend(SESSION, "request-echo"),
		true,
		"precondition: the in-flight message's row is retained",
	);

	view().reloadFromHistory();
	assert.equal(
		view().liveUpdatesReloading,
		true,
		"the press acknowledges itself before the socket answers",
	);
	assert.equal(
		view().liveUpdatesPaused,
		true,
		"the press must NOT clear the banner - only an answer may",
	);
	assert.equal(
		subscriptions.filter((entry) => !entry.disposed).length,
		1,
		"resync replaced the subscription rather than stacking a second one",
	);
	assert.equal(subscriptions.length, 2, "a fresh subscription was opened");

	/*
	 * The replacement stream's first complete projection. `gap: true` is what
	 * the bridge answers a cursor-less subscription with - there is no earlier
	 * epoch to resume - and it is the frame pair that makes the snapshot
	 * authoritative over a pane that was already painting.
	 */
	deliver(openFrame(5, true));
	deliver(snapshotFrame(6));
	await pump();
	assert.equal(
		view().liveUpdatesPaused,
		false,
		"the snapshot cleared the banner",
	);
	assert.equal(view().liveUpdatesReloading, false);
	/*
	 * THE IN-FLIGHT MESSAGE SURVIVES THE REPAINT. The snapshot's page is merged
	 * over the transcript that was already painted, so the echo row is still
	 * there exactly once - and the retained pending send still names it, so a
	 * later retract can find the row it owns.
	 */
	const echoes = view().transcript.records.filter(
		(record) => record.id === "request-echo",
	);
	assert.equal(echoes.length, 1, "the echo was neither dropped nor duplicated");
	assert.equal(hasPendingSend(SESSION, "request-echo"), true);
	assert.equal(pendingSendForView(SESSION)?.id, "request-echo");
});
