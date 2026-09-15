import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The renderer half of the empty-conversation bug: a stream that cannot be
 * established must be retried, and the app must not claim a conversation is
 * empty until it has actually read one.
 *
 * The operator's report - every conversation opens with its title, an empty
 * composer and "What can I help you with today?" over a conversation with
 * hundreds of durable rows - was reachable because of two decisions in this
 * hook, and both are asserted here against the shipped hook:
 *
 *   1. The reconnect was gated on `receiptRef.current` being non-null. A stream
 *      that never OPENED has no receipt, so the single automatic reconnect was
 *      skipped and the view sat at "connecting" forever; restarting the app was
 *      the only cure. The retry is now bounded, backed off, and independent of
 *      the receipt (which is still used as a cursor when there is one).
 *   2. `status === "connecting"` was the whole hydration test, so as soon as
 *      the transport gave up the composer stopped claiming to load and started
 *      claiming the conversation was empty. `hydrated` answers the question the
 *      reader is actually asking - has an authoritative page been applied for
 *      THIS session - and is the only thing the composer now trusts.
 *
 * How this is driven. The hook is the real module, bundled in memory; the
 * transcript reducer, the session-model selectors and every state transition
 * under test are the shipping ones. Three things are substituted:
 *
 *   - `react` is a ~60-line hooks runtime (useState/useRef/useEffect/useCallback/
 *     useMemo - the five this hook uses) plus an explicit render loop. The repo
 *     has no test renderer and installing one would be a new dependency for a
 *     single file; a runtime this small is auditable in the same read as the
 *     test, which a black box is not. It is deliberately NOT a general React:
 *     anything the hook starts using that it does not implement will throw.
 *   - the desktop transport is a fixture, so a stream refusal is a callback call
 *     rather than a real socket. This is the `canonical-chat.test.mjs` pattern:
 *     the network is the only thing faked, because the bug is in what the hook
 *     does with its answers.
 *   - `requestAnimationFrame` and `window.setTimeout` are explicit queues, so
 *     the retry schedule is read exactly instead of waited out (its sum is
 *     23.5s) and no assertion depends on wall-clock timing.
 */

/** A render loop with just enough React to run this hook. */
const HARNESS_SOURCE = `
export let __runtime = null;
export function __setRuntime(runtime) { __runtime = runtime; }
export function useState(initial) { return __runtime.hooks.useState(initial); }
export function useRef(initial) { return __runtime.hooks.useRef(initial); }
export function useEffect(fn, deps) { return __runtime.hooks.useEffect(fn, deps); }
export function useCallback(fn, deps) { return __runtime.hooks.useCallback(fn, deps); }
export function useMemo(fn, deps) { return __runtime.hooks.useMemo(fn, deps); }
`;

const TRANSPORT_SOURCE = `
export const DesktopControlError = class DesktopControlError extends Error {};
export function desktopResult(request) {
	return globalThis.__hookTest.network(request);
}
export function subscribeDesktopStream(args, onEvent) {
	return globalThis.__hookTest.subscribe(args, onEvent);
}
`;

const bundle = await build({
	stdin: {
		contents: [
			'export { useCanonicalSessionStream } from "./src/renderer/src/shared/hooks/use-canonical-session.ts";',
			// The notice module is the ONE authority for the sentence the reader sees.
			// Exported through the same bundle so this test compares the shipping mapping
			// rather than a copy of it (design round 1, D1).
			'export { streamFailureNotice, DESKTOP_STREAM_DETAIL, HISTORY_UNREADABLE } from "./src/shared/desktop-stream-notice.ts";',
			// Re-exported from the fixture so each fresh copy of the hook can be
			// bound to its own runtime: a shared global would let a previous
			// mount's pending render read THIS mount's hook slots.
			'export { __setRuntime } from "react";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
	// The renderer's `@features` / `@shared` aliases are tsconfig paths rather
	// than node resolutions, and the root tsconfig carries no `paths` of its own
	// (it is the project-references shell), so the app config is named here the
	// way `provider-state.test.mjs` names it.
	tsconfig: "tsconfig.web.json",
	plugins: [
		{
			name: "hook-test-fixtures",
			setup(builder) {
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "fixture",
				}));
				builder.onResolve(
					{ filter: /^@shared\/api\/local-operator\/desktop-api$/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
					contents: args.path === "react" ? HARNESS_SOURCE : TRANSPORT_SOURCE,
					loader: "js",
				}));
			},
		},
	],
});

// ------------------------------------------------------------------ runtime

/**
 * The render loop.
 *
 * Hook slots are positional, exactly as React's are: they are reused across
 * renders and reset to the top at each render, so the order the hook calls them
 * in IS the identity. Effects run after the render that scheduled them, and
 * only when their dependency array changed, which is the property the hook's
 * stream lifecycle depends on.
 */
function createRenderer(component) {
	const slots = [];
	let index = 0;
	let scheduled = false;
	let queued = [];
	let mounted = false;

	const sameDeps = (a, b) =>
		Array.isArray(a) &&
		Array.isArray(b) &&
		a.length === b.length &&
		a.every((value, position) => Object.is(value, b[position]));

	const slot = (position) => {
		slots[position] ??= {};
		return slots[position];
	};

	const hooks = {
		useState(initial) {
			const s = slot(index++);
			if (!("state" in s)) {
				s.state = typeof initial === "function" ? initial() : initial;
			}
			return [
				s.state,
				(next) => {
					const value = typeof next === "function" ? next(s.state) : next;
					if (Object.is(value, s.state)) return;
					s.state = value;
					schedule();
				},
			];
		},
		useRef(initial) {
			const s = slot(index++);
			s.ref ??= { current: initial };
			return s.ref;
		},
		useMemo(factory, deps) {
			const s = slot(index++);
			if (!s.computed || !sameDeps(s.deps, deps)) {
				s.value = factory();
				s.deps = deps;
				s.computed = true;
			}
			return s.value;
		},
		/**
		 * Memoize the callback ITSELF. Deliberately not `useMemo(fn, deps)`: a
		 * memo invokes its factory, so aliasing the two returns whatever the
		 * callback returns - which is how this harness first reported every
		 * handle method as a Promise or undefined.
		 */
		useCallback(fn, deps) {
			const s = slot(index++);
			if (!s.computed || !sameDeps(s.deps, deps)) {
				s.value = fn;
				s.deps = deps;
				s.computed = true;
			}
			return s.value;
		},
		useEffect(fn, deps) {
			const s = slot(index++);
			if (!s.ran || !sameDeps(s.deps, deps)) {
				s.deps = deps;
				s.ran = true;
				queued.push(s);
				queued[queued.length - 1].fn = fn;
			}
		},
	};

	function schedule() {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(render);
	}

	function render() {
		scheduled = false;
		index = 0;
		queued = [];
		const value = component();
		const effects = queued;
		// Cleanups run before the new effect, and only for the effects this render
		// re-ran - the same order React uses, which is what lets the hook's
		// session-switch effect tear its stream down before opening another.
		for (const s of effects) {
			if (s.cleanup) s.cleanup();
		}
		for (const s of effects) {
			s.cleanup = s.fn?.() ?? undefined;
		}
		mounted = true;
		return value;
	}

	return { hooks, render, schedule, isMounted: () => mounted };
}

/**
 * A fresh copy of the hook per test.
 *
 * A new copy carries new module-level state (the retry constants are read at
 * call time, but the hook's maps and refs are per-mount anyway) and, more
 * importantly, its own `react` runtime - so one test's slots can never be
 * reused by the next test's render, which would silently shift hook positions.
 */
async function loadHook(tag) {
	const module = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${tag}`
	);
	return module;
}

/**
 * The shipping notice mapping, from the same bundle the hook runs.
 *
 * Imported once at module scope under its own tag so the assertions below can
 * name the exact sentence a transport detail must produce.
 */
const { streamFailureNotice, DESKTOP_STREAM_DETAIL, HISTORY_UNREADABLE } =
	await loadHook("notice");

/** The hook's view, and its handle, as last rendered. */
function mountHook(module, sessionId, enabled = true) {
	let latest = null;
	const renderer = createRenderer(() => {
		latest = module.useCanonicalSessionStream(sessionId, enabled);
		return latest;
	});
	module.__setRuntime(renderer);
	// `setTimeout` and `requestAnimationFrame` are read during the render, so the
	// page globals must exist before it happens.
	renderer.render();
	return { view: () => latest };
}

// -------------------------------------------------------------- page globals

const rafQueue = [];
const timerQueue = [];
let nextId = 1;

globalThis.requestAnimationFrame = (callback) => {
	const id = nextId++;
	rafQueue.push({ id, callback });
	return id;
};
globalThis.cancelAnimationFrame = (id) => {
	const at = rafQueue.findIndex((entry) => entry.id === id);
	if (at >= 0) rafQueue.splice(at, 1);
};
globalThis.window = {
	/*
	 * A listener registry, because the connectivity gate subscribes to the
	 * browser's own online/offline events: without these the gate cannot mount at
	 * all, and a harness that cannot mount the hook cannot say anything about it.
	 */
	listeners: {},
	addEventListener(type, handler) {
		(this.listeners[type] ??= []).push(handler);
	},
	removeEventListener(type, handler) {
		const at = (this.listeners[type] ?? []).indexOf(handler);
		if (at >= 0) this.listeners[type].splice(at, 1);
	},
	setTimeout: (callback, delay) => {
		const id = nextId++;
		timerQueue.push({ id, callback, delay });
		return id;
	},
	clearTimeout: (id) => {
		const at = timerQueue.findIndex((entry) => entry.id === id);
		if (at >= 0) timerQueue.splice(at, 1);
	},
};

/** Run everything the hook has queued on requestAnimationFrame. */
async function flushFrames() {
	for (let pass = 0; pass < 6 && rafQueue.length > 0; pass += 1) {
		const pending = rafQueue.splice(0, rafQueue.length);
		for (const entry of pending) entry.callback();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

/**
 * Run the queued timers, oldest first, and report the delays that were asked
 * for. The retry schedule is asserted through this: the delays are the contract
 * (a bounded, backing-off budget), and reading them is cheaper and stricter
 * than waiting 23.5s of wall clock.
 */
async function runTimers() {
	const delays = [];
	for (let pass = 0; pass < 64 && timerQueue.length > 0; pass += 1) {
		// Oldest first, so a retry that re-arms another timer is drained in order.
		timerQueue.sort((a, b) => a.id - b.id);
		const entry = timerQueue.shift();
		delays.push(entry.delay);
		entry.callback();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await flushFrames();
	}
	await flushFrames();
	return delays;
}

async function settle() {
	for (let pass = 0; pass < 8; pass += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await flushFrames();
	}
}

// -------------------------------------------------------------------- fixture

const SESSION = "92602660eb9e";
const SUBSCRIPTION = "a".repeat(32);

const test_state = {
	network: async () => ({
		entries: [],
		has_more: false,
		cursor_missing: false,
	}),
	streams: [],
	historyRequests: [],
};

globalThis.__hookTest = {
	network(request) {
		test_state.historyRequests.push(request);
		return test_state.network(request);
	},
	subscribe(args, onEvent) {
		const stream = {
			args,
			onEvent,
			disposed: false,
		};
		test_state.streams.push(stream);
		return () => {
			if (stream.disposed) return;
			stream.disposed = true;
			// The BROWSER transport's teardown shape, from
			// `subscribeDesktopStream`: it emits `end` from inside its own dispose
			// while Electron's relay emits nothing. Modelled here because the hook
			// has to survive both, and the difference is what made a retry spend
			// two attempts per failure.
			onEvent({ kind: "end", streamId: "s" });
		};
	},
};

/** The latest stream the hook opened. */
const stream = (at = -1) => test_state.streams.at(at);

const openFrame = () => ({
	type: "open",
	epoch: "e".repeat(16),
	seq: 0,
	payload: { subscription_id: SUBSCRIPTION, gap: false },
});

/** A snapshot whose durable page was APPLIED (`cursor_missing: false`). */
const snapshotFrame = (entries = []) => ({
	type: "snapshot",
	epoch: "e".repeat(16),
	seq: 1,
	payload: {
		cold: false,
		history: { entries, has_more: false, cursor_missing: false },
		frontend: {
			epoch: "e".repeat(16),
			snapshot: {
				session_id: SESSION,
				epoch: "e".repeat(16),
				sequence: 1,
				streaming: false,
				attention: undefined,
				pending_gate: null,
				live_events: [],
			},
		},
	},
});

/** A snapshot that carries NO usable page: the `/history` reconcile's case. */
const cursorMissingSnapshotFrame = () => {
	const frame = snapshotFrame([]);
	frame.payload.history = {
		entries: [],
		has_more: false,
		cursor_missing: true,
	};
	return frame;
};

/** A durable user row, in the shape `durableRecord` reads off the wire. */
const userEntry = (id, text) => ({
	id,
	ts: 1_760_000_000,
	type: "message",
	payload: { role: "user", content: [{ type: "text", text }] },
});

/** Deliver one canonical frame over the stream, exactly as preload would. */
const send = (frame) =>
	stream().onEvent({
		kind: "data",
		data: JSON.stringify(frame),
		streamId: "s",
	});

/** Deliver a stream failure, the shape both the relay and preload use. */
const fail = (detail) =>
	stream().onEvent({ kind: "error", detail, streamId: "s" });

// ---------------------------------------------------------------------- tests

test("completion pulses ignore wait-latch starts and steering", async (t) => {
	// Completion events schedule history reconciliation; drain those before the
	// neighbouring retry test measures its own timer delays.
	t.after(runTimers);
	test_state.streams.length = 0;
	const mounted = mountHook(await loadHook("completion-pulses"), SESSION);
	await settle();
	send(openFrame());
	send(snapshotFrame());
	await settle();
	let seq = 2;
	// Separate painted frames expose excess invalidations that batching all
	// events together would hide. The wait latch must still see every event.
	for (const [type, completed] of [
		["agent_start", 0],
		["turn_start", 0],
		["provider_start", 0],
		["steering_delivered", 0],
		["turn_end", 1],
		["agent_end", 2],
		["turn_start", 2],
		["turn_end", 3],
		["turn_end", 4],
	]) {
		send({
			type: "event",
			epoch: "e".repeat(16),
			seq: seq++,
			payload: { type },
		});
		await settle();
		assert.equal(
			mounted.view().terminal,
			type,
			"wait-latch semantics stay intact",
		);
		assert.equal(mounted.view().turnsCompleted, completed, type);
	}
	await settle();
	assert.equal(
		mounted.view().turnsCompleted,
		4,
		"no events means no new pulse",
	);
});

test("a stream that never opens is retried without a receipt, within a bounded schedule", async () => {
	test_state.streams.length = 0;
	test_state.historyRequests.length = 0;
	const mounted = mountHook(await loadHook("a"), SESSION);
	await settle();
	assert.equal(test_state.streams.length, 1, "the hook opens one stream");

	// Six refusals, each answered only after the delay it asked for.
	const delays = [];
	for (let attempt = 0; attempt < 6; attempt += 1) {
		fail("The event stream was refused (401).");
		await settle();
		assert.equal(
			mounted.view().status,
			"reconnecting",
			"a refused stream is retried, not left at connecting",
		);
		delays.push(...(await runTimers()));
	}
	assert.deepEqual(
		delays,
		[500, 1000, 2000, 4000, 8000, 8000],
		"the retry schedule is the documented bounded backoff, not one attempt and not an unbounded loop",
	);
	assert.equal(
		test_state.streams.length,
		7,
		"every delay bought a retry even though no receipt was ever received",
	);

	// The seventh refusal exhausts the budget, and says so.
	fail("The event stream was refused (401).");
	await settle();
	assert.equal(mounted.view().status, "unavailable");
	assert.deepEqual(
		mounted.view().failure,
		streamFailureNotice(DESKTOP_STREAM_DETAIL.refused(401)),
		"the surfaced state is the product sentence for the 401 the relay emitted, not the transport detail itself (D1)",
	);
	assert.doesNotMatch(
		mounted.view().failure.statement,
		/401|refused|event stream/i,
		"the reader is never shown transport register",
	);
	assert.equal(
		mounted.view().hydrated,
		false,
		"a stream that never delivered a page must not leave the view claiming to know the conversation",
	);
	assert.equal(
		mounted.view().subscriptionId,
		null,
		"the dead subscription is dropped, so the watch lease stops posting an id the backend no longer holds",
	);

	// And the user's own way back works: a Retry re-arms the stream at once.
	const before = test_state.streams.length;
	mounted.view().retry();
	await settle();
	assert.equal(
		test_state.streams.length,
		before + 1,
		"Retry reopens the stream after the budget is exhausted",
	);
	send(openFrame());
	await settle();
	send(snapshotFrame([userEntry("m1", "hello")]));
	await settle();
	assert.equal(mounted.view().status, "live");
	assert.equal(mounted.view().hydrated, true);
	assert.equal(mounted.view().transcript.records.length, 1);
	assert.equal(mounted.view().subscriptionId, SUBSCRIPTION);
});

test("an applied snapshot page is what proves history, and a missing one stays unproven until the reconcile lands", async () => {
	test_state.streams.length = 0;
	test_state.historyRequests.length = 0;
	let resolveHistory;
	test_state.network = () =>
		new Promise((resolve) => {
			resolveHistory = resolve;
		});
	const mounted = mountHook(await loadHook("b"), SESSION);
	await settle();
	send(openFrame());
	await settle();
	send(cursorMissingSnapshotFrame());
	await settle();

	assert.equal(mounted.view().status, "live", "the stream itself is healthy");
	assert.equal(
		mounted.view().hydrated,
		false,
		"a snapshot with no usable page is NOT proof: the conversation may be empty or may not have arrived",
	);
	assert.deepEqual(
		test_state.historyRequests.map((request) => request.op),
		["sessions.history"],
		"the snapshot's missing cursor is what triggers the read-back",
	);

	resolveHistory({ entries: [userEntry("m1", "durable")], has_more: false });
	await settle();
	assert.equal(
		mounted.view().hydrated,
		true,
		"a settled reconcile is the proof the snapshot could not give",
	);
	assert.equal(mounted.view().transcript.records.length, 1);
});

test("a failed history read on an empty transcript is retried, then surfaced instead of swallowed", async () => {
	test_state.streams.length = 0;
	test_state.historyRequests.length = 0;
	test_state.network = async () => {
		throw new Error("history unavailable");
	};
	const mounted = mountHook(await loadHook("c"), SESSION);
	await settle();
	send(openFrame());
	await settle();
	send(cursorMissingSnapshotFrame());
	await settle();
	// The retries are on the same explicit queue as the stream's.
	await runTimers();
	await settle();

	const reads = test_state.historyRequests.length;
	assert.equal(
		reads,
		3,
		"a failed read on an empty transcript is retried a bounded number of times",
	);
	assert.equal(
		mounted.view().hydrated,
		false,
		"an unreadable history is not an empty history - this is the assertion that stops the greeting painting over real rows",
	);
	assert.equal(mounted.view().status, "unavailable");
	assert.match(mounted.view().failure?.statement ?? "", /history/i);
	assert.equal(
		mounted.view().transcript.records.length,
		0,
		"nothing is invented to fill the gap",
	);
});

test("an empty applied page IS a claim the app may make", async () => {
	test_state.streams.length = 0;
	test_state.historyRequests.length = 0;
	test_state.network = async () => ({ entries: [], has_more: false });
	const mounted = mountHook(await loadHook("d"), SESSION);
	await settle();
	send(openFrame());
	await settle();
	send(snapshotFrame([]));
	await settle();

	assert.equal(
		mounted.view().hydrated,
		true,
		"a genuinely empty conversation must still be able to say so - the fix is about proof, not about never being sure",
	);
	assert.equal(mounted.view().transcript.records.length, 0);
});

test("Retry during a pending stream retry opens ONE subscription and leaves no orphan (R1-1)", async () => {
	test_state.streams.length = 0;
	test_state.historyRequests.length = 0;
	timerQueue.length = 0;
	rafQueue.length = 0;
	// The history read fails for good, so the reconcile retries on the same
	// backoff schedule as the stream. That is what puts the Retry control on
	// screen while a stream retry is STILL pending: the two error surfaces are
	// independent, and only one of them has to give up.
	test_state.network = async () => {
		throw new Error("history unavailable");
	};
	const known = new Set();
	/** Retry timers armed since the last call, oldest first. The frame-flush
	 * backstop (250ms) shares this queue and is filtered out. */
	const freshRetries = () => {
		const out = timerQueue
			.filter((entry) => !known.has(entry.id) && entry.delay >= 500)
			.sort((a, b) => a.id - b.id);
		for (const entry of timerQueue) known.add(entry.id);
		return out;
	};
	const fire = (entry) => {
		const at = timerQueue.indexOf(entry);
		if (at >= 0) timerQueue.splice(at, 1);
		entry.callback();
	};

	const mounted = mountHook(await loadHook("race"), SESSION);
	await settle();
	freshRetries();
	send(openFrame());
	await settle();
	send(cursorMissingSnapshotFrame());
	await settle();
	const reconcileRetry1 = freshRetries();
	assert.equal(reconcileRetry1.length, 1, "the reconcile armed its first retry");
	assert.equal(reconcileRetry1[0].delay, 500);

	fire(reconcileRetry1[0]);
	await settle();
	const reconcileRetry2 = freshRetries();
	assert.equal(reconcileRetry2.length, 1, "the reconcile armed its second retry");
	assert.equal(reconcileRetry2[0].delay, 1000);

	// The stream dies AFTER that, so its retry is the newest retry timer.
	fail("The event stream was refused (401).");
	await settle();
	const streamRetry = freshRetries();
	assert.equal(streamRetry.length, 1, "the stream armed its own retry");

	// Fire only the reconcile's retry: the history failure surfaces while the
	// stream's retry is still pending - the exact state the Retry control is on
	// screen in, with `dispose === null` and a queued `connect()`.
	fire(reconcileRetry2[0]);
	await settle();
	assert.equal(mounted.view().status, "unavailable", "the history failure surfaced");
	assert.ok(mounted.view().failure, "with a sentence to show");
	assert.ok(
		timerQueue.includes(streamRetry[0]),
		"a stream retry is still pending while Retry is offered",
	);

	const before = test_state.streams.length;
	mounted.view().retry();
	await settle();
	assert.equal(
		test_state.streams.length,
		before + 1,
		"Retry opened a stream",
	);
	assert.equal(
		timerQueue.includes(streamRetry[0]),
		false,
		"Retry must CANCEL the pending retry timer; leaving it queued is what opened a second subscription - and overwrote the single dispose closure, orphaning the first (R1-1)",
	);
	// The regression, stated as the invariant the effect owes: one subscription.
	const live = test_state.streams.filter((s) => !s.disposed).length;
	assert.equal(
		live,
		1,
		"exactly one subscription may be live after Retry settles",
	);
	// And draining every remaining timer cannot resurrect the orphan.
	await runTimers();
	assert.equal(
		test_state.streams.filter((s) => !s.disposed).length,
		1,
		"no queued timer may open a stream the effect can no longer dispose",
	);
});

test("every transport detail maps to ONE product sentence, and none of them leaks transport register (D1)", async () => {
	const refused = streamFailureNotice(DESKTOP_STREAM_DETAIL.refused(401));
	const ended = streamFailureNotice(DESKTOP_STREAM_DETAIL.ended);
	const connectionFailed = streamFailureNotice(
		DESKTOP_STREAM_DETAIL.connectionFailed,
	);
	assert.equal(
		refused.statement,
		ended.statement,
		"the packaged relay's 401 and the browser proxy's `ended` must paint the SAME sentence - two sentences for one failure is what the round-1 frame showed",
	);
	assert.equal(ended.statement, connectionFailed.statement);
	assert.equal(
		ended.statement,
		streamFailureNotice(DESKTOP_STREAM_DETAIL.openFailed).statement,
	);
	for (const detail of [
		DESKTOP_STREAM_DETAIL.refused(401),
		DESKTOP_STREAM_DETAIL.refused(403),
		DESKTOP_STREAM_DETAIL.refusedWithoutStatus,
		DESKTOP_STREAM_DETAIL.ended,
		DESKTOP_STREAM_DETAIL.connectionFailed,
		DESKTOP_STREAM_DETAIL.openFailed,
		"a detail this build has never heard of",
	]) {
		const notice = streamFailureNotice(detail);
		assert.doesNotMatch(
			notice.statement,
			/401|403|refused|event stream|http/i,
			`the reader is never shown transport register (${detail})`,
		);
		assert.match(
			notice.statement,
			/reconnect/i,
			"the sentence has to say what to do about it",
		);
	}
	assert.equal(
		streamFailureNotice(DESKTOP_STREAM_DETAIL.serverDown).statement.includes(
			"server",
		),
		true,
		"a backend that is not answering is named as the server, not as the stream (Q-2)",
	);
	assert.equal(
		streamFailureNotice(DESKTOP_STREAM_DETAIL.notPaired).action,
		null,
		"no control is offered where reconnecting cannot help",
	);
	assert.deepEqual(streamFailureNotice(null), refused);
});

// ------------------------------------------------------- the connectivity gate

/*
 * The gate's half of the operator's second symptom: after a reload, no
 * conversations or messages would load, and only a later reload brought them
 * back.
 *
 * The mechanism was the effect that ran on the way DOWN. React Query's
 * `invalidateQueries({ refetchType: "active" })` re-runs the reads it marks
 * stale, and against a connection main had just called unreachable those reads
 * can only fail - so a state flap replaced rendered rows with an error and threw
 * away in-flight work at the exact moment the daemon was least able to answer.
 * Nothing about a lost connection is a reason to re-ask a question; what the app
 * owes the reader on the way back up is the re-read.
 *
 * The gate is bundled here with two fixtures and nothing else: a query client
 * that records what it is asked to invalidate, and a status source the test
 * drives. Everything between them is the shipping hook.
 */

const QUERY_SOURCE = `
export const useQueryClient = () => globalThis.__gateTest.client;
export const useQuery = () => ({ data: undefined, isLoading: false });
`;

const STATUS_SOURCE = `
export const useConnectivityStatus = () => globalThis.__gateTest.status;
`;

const gateBundle = await build({
	stdin: {
		contents:
			'export { useConnectivityGate } from "./src/renderer/src/shared/hooks/use-connectivity-gate.ts"; export { __setRuntime } from "react";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
	tsconfig: "tsconfig.web.json",
	plugins: [
		{
			name: "gate-test-fixtures",
			setup(builder) {
				const fixtures = {
					react: HARNESS_SOURCE,
					query: QUERY_SOURCE,
					status: STATUS_SOURCE,
				};
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({
					path: "query",
					namespace: "fixture",
				}));
				// Resolved by IMPORTER as well as specifier: `./use-connectivity-status`
				// is a relative import, and only the gate's own copy may be
				// substituted.
				builder.onResolve(
					{ filter: /^\.\/use-connectivity-status$/ },
					(args) =>
						args.importer.endsWith("shared/hooks/use-connectivity-gate.ts")
							? { path: "status", namespace: "fixture" }
							: undefined,
				);
				builder.onLoad(
					{ filter: /.*/, namespace: "fixture" },
					(args) => ({ contents: fixtures[args.path], loader: "js" }),
				);
			},
		},
	],
});

globalThis.__gateTest = {
	client: { calls: [], invalidateQueries(options) { this.calls.push(options); } },
	status: {
		isServerOnline: true,
		isOnline: true,
		hostingProvider: "",
		shouldCheckInternet: true,
		hasConnectivityIssue: false,
		connectivityIssue: null,
		isLoading: false,
		refetchInternetStatus: () => {},
		refetchServerStatus: () => {},
	},
};

const { useConnectivityGate, __setRuntime } = await import(
	`data:text/javascript;base64,${Buffer.from(gateBundle.outputFiles[0].text).toString("base64")}#gate`
);

test("a server flap does not re-ask or cancel a read on the way down, and refreshes on the way up", () => {
	let view = null;
	const renderer = createRenderer(() => {
		view = useConnectivityGate();
		return {};
	});
	__setRuntime(renderer);
	renderer.render();

	const client = globalThis.__gateTest.client;
	assert.equal(view.isServerOnline, true);
	assert.deepEqual(client.calls, [], "a healthy connection invalidates nothing");

	// DOWN: main has called the connection unreachable.
	client.calls.length = 0;
	globalThis.__gateTest.status.isServerOnline = false;
	renderer.render();
	assert.deepEqual(
		client.calls,
		[],
		"going offline must not re-run a single backend read: they can only fail, and re-running them is what replaced the rendered conversations with an error",
	);
	assert.equal(view.isServerOnline, false);
	assert.equal(
		view.shouldEnableQuery({ bypassInternetCheck: true }),
		false,
		"and the gate still disables a NEW read while there is no connection to read through",
	);

	// UP: the daemon is back.
	client.calls.length = 0;
	globalThis.__gateTest.status.isServerOnline = true;
	renderer.render();
	assert.equal(
		client.calls.length,
		1,
		"the recovery is what owes the reader a re-read - exactly once",
	);
	const call = client.calls[0];
	assert.equal(call.refetchType, "active");
	const invalidates = (key) => call.predicate({ queryKey: [key] });
	assert.equal(
		invalidates("conversation-messages"),
		true,
		"the transcript is refreshed on recovery",
	);
	assert.equal(invalidates("credentials"), true);
	for (const key of ["server-health", "internet-connectivity", "config"]) {
		assert.equal(
			invalidates(key),
			false,
			`${key} is the signal itself, not a read it should re-trigger`,
		);
	}

	// A second render with nothing changed does not invalidate again.
	client.calls.length = 0;
	renderer.render();
	assert.deepEqual(client.calls, []);
});
