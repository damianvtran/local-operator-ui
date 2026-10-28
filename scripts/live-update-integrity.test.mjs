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
		"@shared/i18n": "./src/i18n",
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

const frontendState = ({
	cwd = "/repo",
	sequence,
	sessionId = SESSION,
	jobs = [],
}) => ({
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
	jobs,
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

const openFrame = (seq, gap = false, id = SESSION) => ({
	session_id: id,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "open",
	payload: { subscription_id: `sub-${seq}`, gap, watch_ttl_seconds: 45 },
});

const snapshotFrame = (seq, ownerSequence = 1, jobs = [], id = SESSION) => ({
	session_id: id,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch: OWNER_EPOCH,
			sequence: ownerSequence,
			live_cursor: null,
			snapshot: frontendState({ sequence: ownerSequence, jobs, sessionId: id }),
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

/**
 * A live roster tick: the delta form `frontend.update.job_deltas`. The
 * snapshot's `changes.jobs` path is untouched (the fixture above seeds it).
 */
const jobDeltaFrame = (seq, ownerSequence, jobDeltas) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.update",
	payload: {
		epoch: OWNER_EPOCH,
		sequence: ownerSequence,
		changes: {},
		job_deltas: jobDeltas,
		job_trajectory_appends: {},
		job_trajectory_replacements: [],
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
async function mount(
	frames = [],
	{
		paintSend = false,
		snapshotJobs = [],
		/*
		 * THE DRAFT PANE'S OWN ANSWER (agent review round 1, R1-2): the hook's
		 * third argument is the caller's "is that id a SESSION's?", and a draft's
		 * bridge is the case the parameter exists for. Passed here so the 404 arm
		 * can be exercised on the shape it guards, not only on a session.
		 */
		sessionId = SESSION,
		isSession = true,
		drafts = {},
	} = {},
) {
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts,
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
		handle = useCanonicalSessionStream(sessionId, true, isSession);
		return handle;
	};
	runtime.rerender();
	assert.equal(subscriptions.length, 1, "the panel subscribes on mount");
	let seq = 1;
	deliver(openFrame(seq++, false, sessionId));
	deliver(snapshotFrame(seq++, 1, snapshotJobs, sessionId));
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

/*
 * The EXACT shape `relay_frame_or_degraded` emits when it sheds an oversized
 * body: epoch, sequence, degraded, degraded_reason, paused - and NO `changes`.
 * The handler must fold this frame without throwing; a `...update.changes`
 * spread tolerates undefined, but anything that reads a field off it does not.
 */
const degradedFrame = (seq, ownerSequence) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.update",
	payload: {
		epoch: OWNER_EPOCH,
		sequence: ownerSequence,
		degraded: true,
		degraded_reason: "frame_too_large",
		paused: false,
	},
});

/**
 * `replace_and_notify`'s shape: a complete same-epoch republish. It is the
 * backend's own recovery from a shed delta, so it must clear an update-origin
 * notice even though the epoch did not change.
 */
const fullStateFrame = (seq, ownerSequence) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.update",
	payload: {
		epoch: OWNER_EPOCH,
		sequence: ownerSequence,
		changes: { epoch: OWNER_EPOCH, cwd: "/repo" },
		job_trajectory_appends: {},
		job_trajectory_replacements: [],
	},
});

/** A full-state rollover: a new owner epoch, which is the one update that proves current. */
const rolloverFrame = (seq, ownerSequence, epoch) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "frontend.update",
	payload: {
		epoch,
		sequence: ownerSequence,
		changes: { epoch, cwd: "/repo" },
		job_trajectory_appends: {},
		job_trajectory_replacements: [],
	},
});

function deliverEvent(event) {
	const active = subscriptions.filter((entry) => !entry.disposed).at(-1);
	assert.ok(active, "no live subscription to deliver to");
	active.onEvent(event);
}

test("a degraded frame with no changes raises the banner and does not throw", async () => {
	const view = await mount([degradedFrame(3, 2)]);
	assert.equal(
		view().liveUpdatesPaused,
		true,
		"the runtime's own degraded shape must be tolerated",
	);
	assert.equal(view().liveUpdatesNotice, "update");
	assert.equal(view().liveUpdatesReloading, false);
});

test("an ordinary clean update does not clear the banner; a rollover does", async () => {
	const view = await mount([degradedFrame(3, 2), updateFrame(4, 3)]);
	assert.equal(
		view().liveUpdatesPaused,
		true,
		"one field delta cannot restore a shed body",
	);
	deliver(rolloverFrame(5, 4, "owner-epoch-2"));
	await pump();
	assert.equal(
		view().liveUpdatesPaused,
		false,
		"a rollover carries the whole state and proves the view current",
	);
	assert.equal(view().liveUpdatesNotice, "none");
});

test("a same-epoch full-state update at the SAME sequence clears the notice", async () => {
	/*
	 * The producer's actual re-seat: `replace_and_notify` republishes the whole
	 * state at `state.sequence` - the sequence the degraded delta already
	 * consumed - so a strictly-newer gate would drop the one frame that repairs
	 * the view. Only the full-state shape may reuse a sequence.
	 */
	const view = await mount([degradedFrame(3, 2), fullStateFrame(4, 2)]);
	assert.equal(
		view().frontend.cwd,
		"/repo",
		"the full state folded; its cwd is the applied one",
	);
	assert.equal(view().frontend.sequence, 2, "the sequence did not advance");
	assert.equal(
		view().liveUpdatesPaused,
		false,
		"replace_and_notify restores the shed body at the sequence already held",
	);
	assert.equal(view().liveUpdatesNotice, "none");
});

test("an ordinary delta at an equal sequence is still rejected", async () => {
	const view = await mount([]);
	deliver(updateFrame(3, 1, { changes: { cwd: "/replayed" } }));
	await pump();
	assert.equal(
		view().frontend.cwd,
		"/repo",
		"a replay must not double-apply a delta",
	);
});

test("an event-origin notice outlives ticks and a rollover, and clears on a snapshot", async () => {
	const view = await mount([
		reloadNoticeFrame(3),
		updateFrame(4, 2),
		rolloverFrame(5, 3, "owner-epoch-2"),
	]);
	assert.equal(
		view().liveUpdatesPaused,
		true,
		"a rollover carries frontend state, never transcript rows",
	);
	assert.equal(view().liveUpdatesNotice, "event");
	deliver(openFrame(6, true));
	deliver(snapshotFrame(7));
	await pump();
	assert.equal(
		view().liveUpdatesPaused,
		false,
		"a snapshot proves the transcript whole",
	);
});

test("an event notice is a banner statement, never a transcript row", async () => {
	const view = await mount([reloadNoticeFrame(3)]);
	const notices = view().transcript.records.filter(
		(record) => record.kind === "notice",
	);
	assert.equal(
		notices.length,
		0,
		"the band owns the sentence; a second row would state it twice",
	);
});

test("a new notice while the press is out gives the control back", async () => {
	const view = await mount([degradedFrame(3, 2)], { paintSend: true });
	view().reloadFromHistory();
	assert.equal(view().liveUpdatesReloading, true);
	deliver(degradedFrame(5, 3));
	await pump();
	assert.equal(
		view().liveUpdatesReloading,
		false,
		"the attempt did not repair the stream, so the reader can press again",
	);
	assert.equal(view().liveUpdatesPaused, true);
});

test("a reload press that ends in a failed stream says so", async () => {
	const view = await mount([degradedFrame(3, 2)]);
	view().reloadFromHistory();
	deliverEvent({ kind: "error", status: 404, detail: "not found" });
	await pump();
	assert.equal(view().liveUpdatesReloading, false);
	assert.equal(
		view().liveUpdatesReloadFailed,
		true,
		"the band owns the failure sentence rather than silently reverting",
	);
	assert.equal(view().missing, true, "404 is the session-gone terminal state");
});

/*
 * THE SAME 404, ON THE OTHER CALLER'S ANSWER (agent review round 1, R1-2).
 *
 * `isSession` is the only fact that can tell a conversation's id from a DRAFT's
 * bridge (`sessions.draft`'s minted id, which the pane streams on while it waits
 * for the first send). A 404 on the bridge says the daemon's registry entry is
 * gone - not that a conversation was lost - so the hook must retire the warm and
 * commit NOTHING terminal, while the session arm above must keep painting the
 * missing state. This is the case a regression in the wiring fails; the source
 * order pin in `team-new-chat-stale-draft.test.mjs` cannot, because it passes
 * even if the store action did nothing.
 */
test("a draft's bridge 404 retires the warm and commits no missing state", async () => {
	const WARM = "c0ffee123456";
	const KEY = "draft:team:minervadev";
	const BEFORE = "11111111-2222-4333-8444-555555555555";
	const view = await mount([], {
		sessionId: WARM,
		isSession: false,
		drafts: {
			[KEY]: {
				key: KEY,
				target: { kind: "team", name: "minervadev" },
				createRequestId: "aaaaaaaa-1111-4222-8333-444444444444",
				admissionRequestId: "bbbbbbbb-1111-4222-8333-444444444444",
				draftRequestId: BEFORE,
				warmId: WARM,
			},
		},
	});
	deliverEvent({ kind: "error", status: 404, detail: "not found" });
	await pump();
	assert.equal(
		view().missing,
		false,
		"a draft's bridge 404 is not a conversation verdict: no missing state",
	);
	assert.notEqual(
		view().status,
		"unavailable",
		"and not the terminal status the session arm paints",
	);
	const row = useCanonicalSessionsStore.getState().drafts[KEY];
	assert.equal(row?.warmId, undefined, "the dead warm id was retired");
	assert.notEqual(
		row?.draftRequestId,
		BEFORE,
		"and the mint's request id was re-minted, so its receipt cannot replay the dead id",
	);
	assert.equal(
		row?.target?.name,
		"minervadev",
		"the draft's own destination survived the verdict",
	);
});

test("reload re-arms the stream, acknowledges the press, and the snapshot clears both", async () => {
	const view = await mount([degradedFrame(3, 2)], { paintSend: true });
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
	assert.equal(view().liveUpdatesReloadFailed, false);
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

test("a job_deltas tick upserts and removes rows on the live roster", async () => {
	const view = await mount(
		[
			jobDeltaFrame(3, 2, {
				upserted: [{ id: "job-b", title: "B updated" }],
				removed: ["job-c"],
				order: ["job-b", "job-a"],
				roster_size: 2,
			}),
		],
		{
			snapshotJobs: [
				{ id: "job-a", title: "A" },
				{ id: "job-b", title: "B" },
				{ id: "job-c", title: "C" },
			],
		},
	);
	assert.deepEqual(
		view().frontend.jobs.map((row) => row.id),
		["job-b", "job-a"],
		"the removed row left, the order was applied, and no row was dropped",
	);
	assert.equal(
		view().frontend.jobs.find((row) => row.id === "job-b").title,
		"B updated",
		"the upsert replaced the same-id row",
	);
});

test("a frame carrying the full roster and a delta applies the full list", async () => {
	const view = await mount(
		[
			{
				session_id: SESSION,
				epoch: BRIDGE_EPOCH,
				seq: 3,
				type: "frontend.update",
				payload: {
					epoch: OWNER_EPOCH,
					sequence: 2,
					changes: {
						jobs: [
							{ id: "job-x", title: "X" },
							{ id: "job-y", title: "Y" },
						],
					},
					job_deltas: {
						upserted: [{ id: "job-z", title: "Z" }],
						removed: ["job-x"],
					},
					job_trajectory_appends: {},
					job_trajectory_replacements: [],
				},
			},
		],
		{
			snapshotJobs: [
				{ id: "job-a", title: "A" },
				{ id: "job-x", title: "old X" },
			],
		},
	);
	assert.deepEqual(
		view().frontend.jobs.map((row) => row.id),
		["job-x", "job-y"],
		"the full list wins; the delta is not folded over it",
	);
});

test("a replacement for another conversation does not clear the banner", async () => {
	const view = await mount([degradedFrame(3, 2), foreignReplaceFrame(4)]);
	assert.equal(
		view().liveUpdatesPaused,
		true,
		"a refused replacement proves nothing about this view",
	);
});
