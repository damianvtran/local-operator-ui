import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * Regex literals hoisted to the top level: `useTopLevelRegex` charges a literal
 * constructed inside a function, and `scripts/` is outside `pnpm lint`'s path
 * list, so this tree's own gate is the only thing that would say so (the same
 * note `session-load-recovery.test.mjs` carries).
 */
const RE_DESKTOP_API = /desktop-api$/;
const RE_TRANSPORT = /^transport$/;
const RE_CONNECTIVITY_STATUS = /use-connectivity-status$/;
const RE_STATUS = /^status$/;
const RE_WHITESPACE = /\s+/g;

/*
 * THE LOAD SEQUENCE of a conversation switched into WHILE A TURN IS IN FLIGHT:
 * what each commit of the shipped transcript paints, in order.
 *
 * WHY THIS FILE EXISTS (operator report, 2026-10-01). "Loading into a new
 * conversation jitters - a preliminary state paints first (uncondensed rows /
 * inactive cue), then ~a second later the full state re-renders with in-flight
 * actions and the condensation applied." The sibling lane's #745 fixes the
 * POST-load trigger (a wake/peer landing on an already-painted pane); nothing
 * on either side has a datapoint for the LOAD moment itself. This file is that
 * datapoint: it drives the REAL load pipeline - the shipped
 * `useCanonicalSessionStream` handle feeding the shipped `CanonicalTranscript`
 * the same way `chat-content.tsx` composes them - and records, after every
 * scripted frame, what the pane would paint.
 *
 * WHAT IS REAL AND WHAT IS SCRIPTED. Real: the hook, the store, the reducer,
 * the transcript component, the working line, the collapse model - everything
 * between the transport and the DOM. Scripted: the owner at the far end of the
 * transport (a fixture module behind the same `desktopResult` /
 * `subscribeDesktopStream` calls the app makes), because the question is what
 * the renderer does with a stated frame sequence, and driving that sequence by
 * hand is what makes each commit attributable.
 *
 * WHAT IS READ. Counts and identity, not geometry: jsdom has no layout engine,
 * so nothing here is a frame. Rows = painted `[data-record-id][data-record-kind]`
 * nodes; bars = `[data-turn-summary]` nodes with their visible text; the working
 * line = `[data-lo-working-line]`; the placeholder = its own sentence. The
 * transcript's shipped per-commit performance mark (`lop:transcript:render`)
 * gives the commit count, so "two paints" is countable rather than argued.
 *
 * THE FIXTURE IS THE OPERATOR'S SHAPE: `U T88 A1(stop) W T2 [T3 in flight]` -
 * a settled span whose bar should stand, a wake receipt, and a cycle still
 * being written (the shape `turn-collapse.stories.tsx`'s `midCycleTurn` holds,
 * driven here through the durable page + the snapshot's live seed exactly as a
 * reload receives it).
 */

/* -------------------------------------------------------------------- jsdom */

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
/** Frames the app queued but the test has not run yet. */
const rafQueue = [];
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	localStorage: window.localStorage,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => {
		rafQueue.push(callback);
		return rafQueue.length;
	},
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	MutationObserver: window.MutationObserver,
	NodeFilter: window.NodeFilter,
	HTMLInputElement: window.HTMLInputElement,
	IntersectionObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
window.requestAnimationFrame = shims.requestAnimationFrame;
window.cancelAnimationFrame = shims.cancelAnimationFrame;
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
/** Ids for the never-firing timer stub; the handle they name is never read. */
let timerSeq = 0;
/*
 * The hook's deadline and fallback timers are NOT real and never fire: they
 * measure wall-clock bounds (a stream that stalls, a retry budget) that this
 * drive never advances - firing them would race states the real fast path
 * never reaches (draining the snapshot deadline at mount manufactured a
 * stalled stream and a cache paint, measured). The sibling rigs
 * (frontend-replace.test.mjs) stub the same way, for the same reason:
 * synchronous drive, explicit frame queue.
 */
/*
 * jsdom has no canvas, and the shipped console-measure module asks for a 2d
 * context at import time: without this the run prints "Not implemented:
 * HTMLCanvasElement.prototype.getContext" - benign, jsdom's virtual console,
 * but a reader grepping CI for "Error" hits it (agent review round 1, nit 5).
 * The shim is the house pattern (`console-mirror.test.mjs`) and its metrics are
 * a deterministic stand-in rather than layout evidence: jsdom has no layout.
 */
window.HTMLCanvasElement.prototype.getContext = function getContext() {
	return {
		font: "",
		measureText: (text) => ({ width: String(text).length * 6 }),
	};
};
window.setTimeout = () => {
	timerSeq += 1;
	return timerSeq;
};
window.clearTimeout = () => {};
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

/* ------------------------------------------------------------- the transport */

/**
 * The renderer-side transport, scripted. Same module boundary
 * `session-load-recovery.test.mjs` substitutes: everything ABOVE
 * `desktopResult`/`subscribeDesktopStream` is the shipped code; the owner below
 * is this file's.
 */
globalThis.__loadNet = {
	requests: [],
	subscriptions: [],
	/** The test replaces this per arm. Unwrapped results, as the real call returns. */
	network: async () => ({}),
};
globalThis.__loadNet.request = async (request) => {
	globalThis.__loadNet.requests.push({ op: request.op, at: performance.now() });
	return globalThis.__loadNet.network(request);
};
globalThis.__loadNet.subscribe = (args, onEvent) => {
	const subscription = { args, onEvent, disposed: false };
	globalThis.__loadNet.subscriptions.push(subscription);
	return () => {
		if (subscription.disposed) return;
		subscription.disposed = true;
		onEvent({ kind: "end" });
	};
};
/*
 * THE PRELOAD, STUBBED. Without it two things reach the real network, both
 * measured here as leaks rather than theory: `useServerHealth` falls back
 * to `HealthApi.healthCheck` against the configured base URL (a REAL dial to
 * localhost:1111, kept alive by undici's pool and its refetch timers), and
 * every `desktopControlResponse` caller fetches a relative `/__desktop` that
 * node cannot even parse. With the bridge installed the app takes the same
 * branch it takes in Electron: `desktop.request` answers the control calls
 * and `backend.getStatus` answers the health query with no socket at all.
 * `onStatusChange` is deliberately absent - the hook's own guard treats that
 * as "no push updates", which is the shape a plain load has.
 */
globalThis.window.api = {
	...(globalThis.window.api ?? {}),
	desktop: {
		request: async (request) => ({
			status: 200,
			body: { result: await globalThis.__loadNet.request(request) },
		}),
	},
	backend: {
		getStatus: async () => ({
			url: "http://127.0.0.1:1111",
			state: "connected",
		}),
	},
};

/* ------------------------------------------------------------------ the bundle */

const REAL_DESKTOP_API = `${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`;

const bundle = await build({
	stdin: {
		contents: `
			import { createElement as h } from "react";
			import { useCanonicalSessionStream } from "./src/renderer/src/shared/hooks/use-canonical-session";
			import { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";

			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { writePaint, __resetPaintCache, readPaint } from "./src/renderer/src/shared/store/paint-cache";
			/*
			 * The settings arms below seed the persisted display flags, and they
			 * seed them through the SHIPPED key and the SHIPPED flag names: a rig
			 * that respelled either would keep passing after a rename that broke
			 * every real window.
			 */
			export { HIDE_CROSS_SESSION_KEY } from "./src/renderer/src/features/chat/canonical/use-cross-session-hidden";
			export { TURN_ANSWER_RAIL_KEY } from "./src/renderer/src/features/chat/canonical/turn-answer-rail";
			export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";

			/*
			 * The composition chat-content.tsx performs, with the call site's own
			 * expressions where this rig uses them, because a second spelling of
			 * the call site is how a harness stops measuring the app. WHICH PROPS
			 * ARE THE CALL SITE'S AND WHICH ARE A NO-SEND LOAD'S OWN, stated
			 * rather than implied (agent review round 1, nit 3): read straight off
			 * the handle are frontend, transcript, gate, waiting (the call site's
			 * turnAlive and the same expression, (canonical.frontend ??
			 * canonical.heldFrontend)?.streaming === true - the pair, because the
			 * claim surfaces read through the hold; operator incident, 2026-10-07),
			 * loadingOlder, onLoadOlder, onLoadOlderOutcome, olderFailed,
			 * status, failure, awaitingHydration, conversationId, the three label
			 * sets, onReconnect, stale and containerRef (the rig's own div). NOT an
			 * exhaustive prop list - only the ones this rig's fidelity question is
			 * about (agent review round 2, nit); the interface itself is the
			 * authority. The values a load with NO admitted send
			 * holds are undelivered null, isSmallView false, missing false and the
			 * starting quartet false/null - the panel's own send latches, which
			 * never fire without a send.
			 */
			export function LoadPane({ sessionId, containerRef }) {
				/*
				 * The handle IS the view (CanonicalSessionHandle = CanonicalSessionView & …),
				 * which is why chat-content.tsx reads canonical.view.X for a view that IS
				 * this same object - the name is a wrapper local to that call site, not a
				 * second layer. Every expression below mirrors the call site's own:
				 * SessionPanel's busy/starting latches are panel-owned, so a load with no
				 * admitted send passes the values that latch would hold (false, null).
				 */
				const canonical = useCanonicalSessionStream(sessionId, true, true, sessionId);
				/*
				 * The diagnostic half (read-only): what the handle holds each render, so
				 * the sequence table can say WHY a commit paints what it paints rather
				 * than only what. Cheap: one object assignment per render.
				 */
				globalThis.__loadDiag = {
					records: canonical.transcript.records.length,
					hydrated: canonical.hydrated,
					status: canonical.status,
					stale: canonical.stale,
					streaming: canonical.frontend?.streaming ?? null,
					hasMore: canonical.transcript.hasMore,
				};
				return h(CanonicalTranscript, {
					frontend: canonical.frontend,
					transcript: canonical.transcript,
					undelivered: null,
					gate: canonical.frontend?.pending_gate ?? null,
					waiting: (canonical.frontend ?? canonical.heldFrontend)?.streaming === true,
					starting: false,
					startingAfterId: null,
					startingSession: false,
					startingSince: null,
					loadingOlder: canonical.loadingOlder,
					onLoadOlder: canonical.loadOlder,
					onLoadOlderOutcome: canonical.loadOlderDetailed,
					olderFailed: canonical.olderFailed,
					containerRef,
					isSmallView: false,
					status: canonical.status,
					failure: canonical.failure,
					awaitingHydration: canonical.awaitingHydration,
					/*
					 * The end claim's proof and its retry, read off the same handle the
					 * chat page reads (remote-load-hydration): passed here so this rig's
					 * composition stays the call site's own.
					 */
					hydrationProven: canonical.hydrated,
					onRetryHydration: canonical.rehydrate,
					conversationId: sessionId,
					labelPending: canonical.labelPending,
					labelHoldLate: canonical.labelHoldLate,
					labelMarked: canonical.labelMarked,
					onReconnect: canonical.retry,
					stale: canonical.stale,
					missing: false,
				});
			}
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	plugins: [
		{
			name: "load-sequence-transport",
			setup(builder) {
				builder.onResolve({ filter: RE_DESKTOP_API }, (args) => {
					/* The fixture's own re-export of the REAL module must not be
					 * re-substituted; only importers outside the fixture are. */
					if (args.namespace === "load-sequence-fixture") return null;
					return {
						path: "transport",
						namespace: "load-sequence-fixture",
					};
				});
				builder.onLoad(
					{ filter: RE_TRANSPORT, namespace: "load-sequence-fixture" },
					() => ({
						contents: `
						/*
						 * The real module, re-exported, with ONLY the two calls that would reach a
						 * server substituted: everything else (DesktopControlError, userFacingMessage,
						 * desktopMedia, mediaError, ...) is the shipped module, because the graph
						 * imports its actual behaviour from there - a stand-in that restated them
						 * would pass while the product read something else (the
						 * session-load-recovery.test.mjs split, for the same reason).
						 */
						export * from ${JSON.stringify(REAL_DESKTOP_API)};
						export function desktopResult(request) { return globalThis.__loadNet.request(request); }
						export function subscribeDesktopStream(args, onEvent) { return globalThis.__loadNet.subscribe(args, onEvent); }`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
				/*
				 * `use-connectivity-status`, substituted whole. The shipped module's
				 * `useServerHealth` falls back to a REAL HTTP probe of the configured base
				 * URL when there is no Electron backend bridge (`HealthApi.healthCheck` -
				 * measured here as a live localhost:1111 socket plus its refetch timers, the
				 * leak that kept this file's worker alive), and the transcript's own
				 * quote/speak path reaches it through QuoteToolkit -> useSpeakControl ->
				 * useRadientCredentialProbe -> useCredentials -> useConnectivityGate. Nothing
				 * this file measures reads connectivity, and the readings below are the
				 * static "everything is up" a desktop load has, so the gate never
				 * invalidates or refetches. (The same substitution, for the same reason, in
				 * `session-load-recovery.test.mjs` - scoped there to the gate's own import
				 * because that is the only edge its graph has.)
				 */
				builder.onResolve({ filter: RE_CONNECTIVITY_STATUS }, () => ({
					path: "status",
					namespace: "load-sequence-fixture",
				}));
				builder.onLoad(
					{ filter: RE_STATUS, namespace: "load-sequence-fixture" },
					() => ({
						contents: `
							export const serverHealthQueryKey = ["server-health"];
							export const internetConnectivityQueryKey = ["internet-connectivity"];
							export const useServerHealth = () => ({
								data: { online: true, snapshot: null },
								isLoading: false,
								refetch: () => {},
							});
							export const useInternetConnectivity = () => ({
								data: true,
								isLoading: false,
								refetch: () => {},
							});
							export const useConnectivityStatus = () => ({
								isServerOnline: true,
								serverSnapshot: null,
								isOnline: true,
								hostingProvider: "",
								shouldCheckInternet: true,
								hasConnectivityIssue: false,
								connectivityIssue: null,
								isLoading: false,
								refetchInternetStatus: () => {},
								refetchServerStatus: () => {},
							});`,
						loader: "js",
					}),
				);
			},
		},
	],
});
const bundlePath = new URL(
	`./_session-load-sequence-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	LoadPane,
	writePaint,
	__resetPaintCache,
	applyHistoryPage,
	EMPTY_TRANSCRIPT,
	HIDE_CROSS_SESSION_KEY,
	TURN_ANSWER_RAIL_KEY,
} = await import(bundlePath.href);
await unlink(bundlePath);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

/* ------------------------------------------------------------------ fixtures */

const SESSION = "a1b2c3d4e5f6";
const EPOCH = `epoch-${SESSION}`;
/** Seconds, as the wire carries them (durable `ts`, `*_epoch`). */
const S = Math.round(Date.now() / 1000) - 245;
const NOW_MS = Date.now();

/** One durable entry, the `{id, ts, type, payload}` shape a page carries. */
const entry = (id, ts, payload) => ({ id, ts, type: "message", payload });

/** A settled call, exactly the durable door the story cell uses. */
const settledCall = (n, ts) =>
	entry(`t${n}`, ts, {
		kind: "message",
		role: "tool",
		tool_call_id: `c${n}`,
		tool_name: n % 3 === 0 ? "read" : "bash",
		content: [{ type: "text", text: `c${n} done\n` }],
		provider_payload: { duration_s: 1.5, details: {} },
	});

const QUESTION =
	"Which invoices were late last month, and chase the four oldest.";
const CLOSE =
	"Four invoices were late: 1042, 1088, 1103 and 1177. I have started chasing them.";
const WORK = Array.from({ length: 88 }, (_, i) =>
	settledCall(i + 1, S + 2 + i * 2),
);

/** `U T88 A1(stop) W T2` — the prefix a reload paints from the durable page. */
const PAGE_ENTRIES = [
	entry("u1", S, {
		kind: "message",
		role: "user",
		content: [{ text: QUESTION }],
	}),
	...WORK,
	entry("a1", S + 185, {
		kind: "message",
		role: "assistant",
		content: [{ text: CLOSE }],
		stop_reason: "stop",
	}),
	entry("w1", S + 205, {
		kind: "custom",
		custom_type: "wake_prompt",
		details: {
			text: "(alarm) Scheduled wake w-9 (1, every 6h)\n\nCollect the staged records.",
		},
	}),
	settledCall(89, S + 215),
	settledCall(90, S + 218),
];

/** The call still out at the snapshot: the live seed's own event. */
const IN_FLIGHT_SEED = {
	type: "tool_execution_start",
	tool_call_id: "c91",
	tool_name: "bash",
	started_at_epoch: S + 225,
};

/** The frontend a LIVE owner snapshots mid-cycle. */
const frontendState = (over = {}) => ({
	state_version: 1,
	epoch: EPOCH,
	sequence: 5,
	snapshot: {
		state_version: 1,
		session_id: SESSION,
		epoch: EPOCH,
		sequence: 5,
		attention: {
			anchor_id: null,
			kind: null,
			viewed: true,
			completion_token: null,
			session_name: "Load sequence fixture",
			focus_policy: "when_unfocused",
		},
		cwd: "/Users/operator/workspace",
		conversation_title: "Load sequence fixture",
		conversation_title_user_set: true,
		conversation_title_forked: false,
		goal: "",
		active_agent: "operator",
		active_team: "",
		selected_model: { provider: "anthropic", name: "claude-sonnet-4" },
		effective_model: { provider: "anthropic", name: "claude-sonnet-4" },
		streaming: true,
		generation: 1,
		pending_gate: null,
		history_cursor: "cursor-9",
		live_events: [IN_FLIGHT_SEED],
		queued_steering: [],
		jobs: [],
		todos: [],
		wakes: [],
		mcp_servers: [],
		model_catalogue: [],
		context_tokens: 4200,
		context_is_estimate: false,
		context_window: 200000,
		context_breakdown: null,
		cumulative_parent_cost: 0.12,
		subagent_cost: 0,
		cost_knowledge: "exact",
		/*
		 * Overridable, because one arm below needs a SETTLED conversation: an
		 * answer the reader can see as the turn's closing row is the only row the
		 * rail marks, and a live cycle in the same snapshot changes which row
		 * that is. The default stays the mid-cycle shape every other arm reads.
		 */
		...over,
	},
	live_cursor: null,
});

const frame = (seq, type, payload) => ({
	session_id: SESSION,
	epoch: EPOCH,
	seq,
	type,
	payload,
});

const openFrame = frame(1, "open", {
	subscription_id: "sub-load-sequence",
	gap: false,
	watch_ttl_seconds: 45,
});
/**
 * The snapshot frame, over any page.
 *
 * The page is a parameter because the settings arms below paint a page that
 * CARRIES cross-session rows where the shipped fixture has none, and a rig that
 * tested the filter against a page with nothing to filter would pass on any
 * implementation at all.
 */
const snapshotFrameFor = (entries) =>
	frame(2, "snapshot", {
		frontend: frontendState(),
		history: {
			entries,
			has_more: false,
			cursor_missing: false,
		},
		cold: false,
		cold_reason: null,
	});
const snapshotFrame = snapshotFrameFor(PAGE_ENTRIES);

/* ------------------------------------------------------------------ the reads */

/** What the pane would paint, read off the committed DOM. */
const readView = (container) => ({
	rows: container.querySelectorAll("[data-record-id][data-record-kind]").length,
	bars: [...container.querySelectorAll("[data-turn-summary]")].map((bar) =>
		(bar.textContent ?? "").replace(RE_WHITESPACE, " ").trim().slice(0, 44),
	),
	/*
	 * THE ANSWER RAIL, counted rather than argued: askers wear
	 * `data-turn-answer` from the election ALONE, so the mark itself is the
	 * `border-l` the rail's class carries when the setting is on
	 * (`turn-answer-mark-class`). Two numbers, because "no mark" and "no
	 * elected answer" are different states and an arm that read only the first
	 * could pass over a fixture that elects nothing.
	 */
	electedAnswers: container.querySelectorAll("[data-turn-answer]").length,
	railMarks: container.querySelectorAll("[data-turn-answer][class*='border-l']")
		.length,
	workingLine:
		container
			.querySelector("[data-lo-working-line]")
			?.textContent?.replace(RE_WHITESPACE, " ")
			.trim()
			.slice(0, 56) ?? null,
	placeholder: (container.textContent ?? "").includes("Loading conversation"),
});
const markCount = () =>
	performance.getEntriesByName("lop:transcript:render").length;

/** Run the queued animation frames inside `act`, so their commits settle. */
const flushFrames = async () => {
	for (let depth = 0; depth < 8 && rafQueue.length > 0; depth += 1) {
		const queued = rafQueue.splice(0);
		await act(async () => {
			for (const callback of queued) callback(0);
		});
	}
};

/* ------------------------------------------------------ the shared arm setup */

/*
 * The owner at the far end of the transport, as every op this graph reaches
 * needs it answered. Hoisted so the two arms answer identically (agent review
 * round 1, nit 4): a stub that lived in one arm only would let the pair drift,
 * and the drift would show up as a mysterious difference between them rather
 * than as a missing stub.
 */
const answerNetwork = async (request) => {
	if (request.op === "sessions.history") {
		return { entries: [], has_more: false, cursor_missing: false };
	}
	if (request.op === "sessions.list") return { sessions: [] };
	if (request.op === "config.get") return { values: { hosting: "" } };
	if (request.op === "credentials.list") return { credentials: [] };
	if (request.op === "sessions.checkpoints") {
		return {
			session_id: SESSION,
			index: { state: "ready" },
			checkpoints: [],
		};
	}
	return {};
};

/*
 * Mount one arm and return its recorder: the pane, a fresh query client, the
 * scripted owner, and `send`/`record` bound to this mount.
 *
 * `label` is the first sample's step name, because the two arms name their own
 * first sample differently (a cold mount and a mount that found a cached paint
 * are different states, and the table should say which one it read).
 */
const mountArm = async (t, label = "mount", network = answerNetwork) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const client = new QueryClient({
		/*
		 * `gcTime: Infinity` is load-bearing for the RUNNER, not the render: the
		 * default 5-minute gc schedules a timer per query at unmount
		 * (`Query.scheduleGc`), and under `scripts/run-desktop-tests.mjs` - which
		 * passes no `--test-force-exit` - those pending timers keep the worker
		 * alive after the last test (measured here: 8 pending timers, "Promise
		 * resolution is still pending but the event loop has already resolved").
		 * The same rule the socket-reaping note in `update-robustness.test.mjs`
		 * states. Nothing here waits on gc.
		 */
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	let root;
	t.after(async () => {
		await act(async () => {
			root?.unmount();
		});
		client.clear();
		container.remove();
	});
	globalThis.__loadNet.network = network;
	const records = [];
	const record = async (step) => {
		await flushFrames();
		records.push({
			step,
			...readView(container),
			commit: markCount(),
			diag: globalThis.__loadDiag,
			ids: [...container.querySelectorAll("[data-record-id]")]
				.map((node) => node.getAttribute("data-record-id"))
				.slice(0, 120),
			text: (container.textContent ?? "")
				.replace(RE_WHITESPACE, " ")
				.slice(0, 400),
		});
	};
	await act(async () => {
		root = createRoot(container);
	});
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(LoadPane, {
					sessionId: SESSION,
					containerRef: { current: container },
				}),
			),
		);
	});
	await record(label);
	const send = async (next) => {
		const subscription = globalThis.__loadNet.subscriptions.at(-1);
		await act(async () => {
			subscription.onEvent({ kind: "data", data: JSON.stringify(next) });
		});
	};
	return { container, records, record, send };
};

/* ------------------------------------------------------------------- the arm */

test("the load sequence, mid-cycle: what each commit paints", async (t) => {
	const { records, record, send } = await mountArm(t);

	await send(openFrame);
	await record("open");

	await send(snapshotFrame);
	await record("snapshot");

	/* The cycle continues: the out call settles, another starts. */
	await send(
		frame(3, "event", {
			type: "tool_execution_end",
			tool_call_id: "c91",
			tool_name: "bash",
			duration_s: 6,
			status: "success",
			output: "collected\n",
		}),
	);
	await record("event: c91 settled");
	await send(
		frame(4, "event", {
			type: "tool_execution_start",
			tool_call_id: "c92",
			tool_name: "bash",
			started_at_epoch: Math.round(NOW_MS / 1000),
		}),
	);
	await record("event: c92 started");

	/* The cycle ENDS: the second call settles, the agent replies, the turn is over. */
	await send(
		frame(5, "event", {
			type: "tool_execution_end",
			tool_call_id: "c92",
			tool_name: "bash",
			duration_s: 4,
			status: "success",
			output: "done\n",
		}),
	);
	await record("event: c92 settled");
	await send(
		frame(6, "event", {
			type: "message_start",
			message: { id: "m2", role: "assistant", content: [] },
		}),
	);
	await send(
		frame(7, "event", {
			type: "message_update",
			message: { id: "m2", role: "assistant", content: [] },
			delta: "Collected both. Closing out.",
		}),
	);
	await send(
		frame(8, "event", {
			type: "message_end",
			message: {
				id: "m2",
				role: "assistant",
				content: [{ type: "text", text: "Collected both. Closing out." }],
				stop_reason: "stop",
			},
		}),
	);
	await record("event: reply settled");
	await send(
		frame(9, "frontend.update", {
			epoch: `epoch-${SESSION}`,
			sequence: 6,
			changes: { streaming: false },
		}),
	);
	await record("frontend: turn over");

	/*
	 * The table is the instrument: it states, per commit, what the pane would
	 * paint. The discrimination this file exists for is read off it (does the
	 * FIRST contentful commit already carry the bars + the in-flight row, or
	 * does a later commit move them?).
	 */
	console.log("\nthe load sequence:");
	for (const row of records) {
		console.log(
			`  ${row.step.padEnd(20)} commits=${String(row.commit).padStart(3)} rows=${String(row.rows).padStart(3)} bars=${JSON.stringify(row.bars)} workingLine=${JSON.stringify(row.workingLine)} placeholder=${row.placeholder} diag=${JSON.stringify(row.diag)}`,
		);
		console.log(`      ids: ${JSON.stringify(row.ids)}`);
		console.log(`      text: ${JSON.stringify(row.text)}`);
	}

	/*
	 * THE DISCRIMINATION, PINNED. The property the load path owes the reader (and
	 * the one #745's per-segment `live` delivers): the FIRST commit that paints
	 * content already carries the settled span as its bar, with the cycle still in
	 * flight - no later commit re-condenses what the reader is already reading.
	 *
	 * On the pre-#745 base this file's table shows NO bar at the snapshot commit
	 * and both bars appearing only at the settle, which is the operator's flip;
	 * the assertion below fails there and passes on #745 (measured, both heads).
	 */
	const firstContentful = records.find((row) => !row.placeholder);
	assert.equal(
		firstContentful?.step,
		"snapshot",
		`the first contentful commit is the snapshot's: ${firstContentful?.step}`,
	);
	assert.ok(
		firstContentful.bars.some((bar) => bar.includes("88 actions")),
		`the settled span is condensed in the first contentful commit: ${JSON.stringify(firstContentful.bars)}`,
	);
	/*
	 * "COMMIT", not just "sample" (agent review round 1, minor 2): the content
	 * appears in a NEW commit of the list - the per-commit mark count strictly
	 * exceeds the previous sample's - rather than in a mutation between two
	 * samples this file happened to take.
	 */
	const openSample = records.find((row) => row.step === "open");
	assert.ok(
		firstContentful.commit > openSample.commit,
		`content arrived in a commit of its own: ${openSample.commit} -> ${firstContentful.commit}`,
	);
	assert.ok(
		firstContentful.workingLine !== null,
		"the in-flight cycle reads as live (working line) in the same commit",
	);
	/* And the cycle's own bar is NOT condensed while the cycle is being written. */
	assert.equal(
		firstContentful.bars.length,
		1,
		`only the settled span is barred mid-cycle: ${JSON.stringify(firstContentful.bars)}`,
	);

	/* The floor: the conversation is contentful by the end (the records the
	 * hook holds, not the painted subset - the window and the folds decide the
	 * paint; the RECORDS are what the load delivered). */
	const final = records.at(-1);
	assert.ok(final.diag.records > 80, `final records: ${final.diag.records}`);
});

/* ---------------------------------------------------------------- the warm arm */

/*
 * THE WARM (CACHED) LOAD: the same drive with this window's paint cache seeded
 * for the conversation, which is the switch a reader makes after having looked
 * at the conversation once in this window. The cache is what the 2026-09-26
 * held-first-paint work withheld from the screen: the hold must keep the
 * window's own memory off the screen until the page lands, so the FIRST
 * contentful commit is the page's - bar, in-flight cycle and working line
 * together - rather than a cached paint the snapshot then corrects.
 */
test("the warm load: the window's memory stays off the screen until the page", async (t) => {
	__resetPaintCache();
	const seeded = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: PAGE_ENTRIES,
		has_more: false,
		cursor_missing: false,
	});
	writePaint(SESSION, { transcript: seeded });

	const { records, record, send } = await mountArm(t, "mount (cached)");

	await send(openFrame);
	await record("open");
	await send(snapshotFrame);
	await record("snapshot");

	console.log("\nthe warm load sequence:");
	for (const row of records) {
		console.log(
			`  ${row.step.padEnd(20)} commits=${String(row.commit).padStart(3)} rows=${String(row.rows).padStart(3)} bars=${JSON.stringify(row.bars)} workingLine=${JSON.stringify(row.workingLine)} placeholder=${row.placeholder} diag=${JSON.stringify(row.diag)}`,
		);
		console.log(`      ids: ${JSON.stringify(row.ids)}`);
	}

	/*
	 * The hold: the cache's rows may not paint before the page - and `stale` is
	 * asserted rather than logged (agent review round 1, minor 1), because
	 * `rows === 0` alone cannot tell a HELD cached pane from a pane that never
	 * had a cache: a seed discarded at mount would read identically. `stale`
	 * true is the shipped statement that this pane knows of cached rows it is
	 * withholding, and it clears in the page's own commit.
	 */
	const before = records.find((row) => row.step === "open");
	assert.equal(
		before.rows,
		0,
		`cached rows painted before the page: ${before.rows}`,
	);
	assert.equal(
		before.placeholder,
		true,
		"the hold's loading claim stands while the page is owed",
	);
	assert.equal(
		before.diag?.stale,
		true,
		"the pane is withholding a cached paint, not missing one",
	);
	/* The page's commit is contentful, and the pane says which paint it is. */
	const final = records.at(-1);
	assert.ok(final.diag.records > 80, `final records: ${final.diag.records}`);
	assert.equal(
		final.diag?.stale,
		false,
		"the page's commit retires the cached-paint claim",
	);
});

/* ------------------------------------------------- the settings settle (F10) */

/*
 * THE SETTINGS SETTLE BEFORE THE FIRST CONTENTFUL COMMIT.
 *
 * The audit's F10: "row visibility (`visibleRecords`) and the answer rail depend
 * on a settings query that resolves AFTER the transcript can paint. With
 * `display.hide_cross_session=true`, peer/send rows paint and are then removed.
 * When the rail setting resolves, rail chrome appears."
 *
 * These arms script exactly that race — the answer HELD while the page lands,
 * which is the shape the audit describes — and assert the property rather than
 * the timing: no commit may paint a row the answer is about to take back, the
 * answer's own commit is the FIRST contentful one, and the elected answer's rail
 * mark is in that same commit. The control arms (setting off, and the rail's
 * off) are what make the pair discriminating: they paint the very rows the
 * "on" arm forbids, so a fixture that quietly stopped painting them, or an
 * implementation that filtered unconditionally, would fail here rather than
 * pass twice.
 */

/**
 * The settings arms' own table: what each sample painted, in order.
 *
 * The same instrument the two arms above carry, for the same reason — the
 * property is read off the sequence, and a reader debugging a red arm needs the
 * sequence rather than the assertion that failed.
 */
const printSequence = (records, title) => {
	console.log(`\n${title}:`);
	for (const row of records) {
		console.log(
			`  ${row.step.padEnd(24)} commits=${String(row.commit).padStart(3)} rows=${String(row.rows).padStart(3)} elected=${row.electedAnswers} marks=${row.railMarks} placeholder=${row.placeholder}`,
		);
		console.log(`      ids: ${JSON.stringify(row.ids)}`);
	}
};

/** A `settings.list` payload carrying the given display flags. */
const settingsPayload = (flags) => ({
	sections: [],
	settings: Object.entries(flags).map(([key, value]) => ({ key, value })),
});

/** The capability answer every settings arm needs: a plane with the registry. */
const CAPABILITIES_WITH_SETTINGS = {
	desktop_available: true,
	features: { settings: 1 },
};

/**
 * The persisted seed the last window would have left, written before mounting.
 *
 * THE KEY IS SPELLED HERE rather than imported, and it is the one spelling in
 * this file that is not the product's own: it is the PERSISTED contract (a
 * store another window wrote, and another build reads), and spelling it in the
 * rig is what lets these arms run against a tree from before the seed existed —
 * which is how the discrimination below is measured. A rename on the branch is
 * still caught, in the safe direction: the seed would not be found, the page
 * would paint the rows it hides, and the arm fails.
 */
const DISPLAY_SEED_KEY = "display-settings";
const seedDisplayFlags = (flags) =>
	localStorage.setItem(DISPLAY_SEED_KEY, JSON.stringify(flags));
/**
 * A window that has never seen an answer, which is what the default-path arms
 * are: the store is shared across every mount in this file (it is one jsdom),
 * so an arm that wants "nothing seeded" has to say so rather than inherit the
 * arm above it.
 */
const clearDisplayFlags = () => localStorage.removeItem(DISPLAY_SEED_KEY);

/**
 * A network whose `settings.list` answer is HELD until the arm releases it.
 *
 * Everything else is the shipped stub (`answerNetwork`), so the only scripted
 * fact is the one under test: when the registry answers relative to the page.
 */
const heldSettings = () => {
	/**
	 * Every held read, not just the last: the query is shared, and a read that
	 * was already in flight when a second one starts still has to be answered —
	 * leaving one pending would hold the settings settle in the rig for a reason
	 * the product does not have.
	 */
	const held = [];
	/**
	 * Whether the registry read has gone out, and who is waiting to be told.
	 *
	 * A LATCH, not just a list of resolvers: the query starts as soon as the
	 * pane's capability answer arrives, which is inside `mountArm` - so by the
	 * time an arm asks, the read has usually been seen already, and a
	 * promise-without-a-latch would wait for a second request that never comes
	 * (measured: the first shape of this hung the arm for the whole lane budget).
	 */
	let sawRequest = false;
	const seen = [];
	const network = async (request) => {
		if (request.op === "capabilities") return CAPABILITIES_WITH_SETTINGS;
		if (request.op === "settings.list") {
			sawRequest = true;
			for (const resolve of seen.splice(0)) resolve();
			return await new Promise((resolve) => {
				held.push(resolve);
			});
		}
		return answerNetwork(request);
	};
	return {
		network,
		/**
		 * Wait until the registry read is actually in flight.
		 *
		 * THE ARMS NEED THIS PRECONDITION, not just the mount: the hold is produced
		 * by "an answer is owed", and a pane whose query has not started yet holds
		 * nothing - it paints the page with the seed's own value, which is correct
		 * and is not the state under test. Without it the arm raced the query's own
		 * start (it failed once, on a fleet-bound host at load 200), and that race
		 * was the RIG's, not the product's.
		 */
		requestSeen: () =>
			sawRequest
				? Promise.resolve()
				: new Promise((resolve) => seen.push(resolve)),
		/** Answer every held read; the caller flushes frames inside `act`. */
		answer: async (flags) => {
			const payload = settingsPayload(flags);
			await act(async () => {
				for (const resolve of held.splice(0)) resolve(payload);
				/*
				 * A REAL TICK, not just a flushed microtask queue: react-query settles
				 * through the notify manager's own scheduled task, so a release that is
				 * only awaited inside `act` leaves the query `fetching` (measured in this
				 * rig: `await act(async () => {})` after the release still read
				 * `pending`/`fetching`; a macrotask later the observer had it).
				 */
				await new Promise((settle) => setTimeout(settle, 0));
			});
		},
	};
};

/**
 * The hidden set this arm's page really paints, and the page that holds it.
 *
 * `peer1` is the durable half — an inbound receipt in the middle of the live
 * tail, where `record`'s samples show custom rows are painted — and the send
 * half rides the snapshot's own live seed, because a `send` row painted from
 * the durable tail lands inside a condensed run and would not be observable as
 * a painted row at all. Both are what `visibleRecords` drops, which is the
 * point: the arm has to be able to see them being painted when nothing hides
 * them, or it would pass on a fixture with nothing to hide.
 */
const CROSS_SESSION_IDS = ["peer1", "tool:c1"];
const CROSS_ENTRIES = [
	PAGE_ENTRIES[0],
	/*
	 * The run's FIRST call is the `send` one, and that is the position that
	 * matters rather than a tidy story: a condensed run paints its anchor row
	 * (`tool:c1` in every sample this rig takes) and no other, so the anchor is
	 * the one place a tool row is observable as a painted row mid-run — which is
	 * exactly what an arm about "was it painted and then removed" needs. Its
	 * presence also changes the bar's count, which the samples carry.
	 */
	entry("t1", S + 2, {
		kind: "message",
		role: "tool",
		tool_call_id: "c1",
		tool_name: "send",
		content: [{ type: "text", text: "delivered to the other session" }],
		provider_payload: { duration_s: 0.4, details: {} },
	}),
	...WORK.slice(1),
	...PAGE_ENTRIES.slice(-4),
	entry("peer1", S + 210, {
		kind: "custom",
		custom_type: "peer_message",
		details: { text: "Please re-run the export when the suite is green." },
	}),
	settledCall(89, S + 215),
	settledCall(90, S + 218),
];
/** The in-flight `send` call: the same live seed shape, under the send tool. */
const SEND_SEED = {
	...IN_FLIGHT_SEED,
	tool_name: "send",
};
/** The page plus the live send, as one snapshot frame. */
const crossSnapshot = () =>
	frame(2, "snapshot", {
		frontend: frontendState({ live_events: [SEND_SEED] }),
		history: { entries: CROSS_ENTRIES, has_more: false, cursor_missing: false },
		cold: false,
		cold_reason: null,
	});

test("the hide setting, last known ON: no commit paints a row the answer takes back", async (t) => {
	__resetPaintCache();
	seedDisplayFlags({ [HIDE_CROSS_SESSION_KEY]: true });
	const settings = heldSettings();
	const { records, record, send } = await mountArm(
		t,
		"mount (answer owed)",
		settings.network,
	);

	await settings.requestSeen();
	await send(openFrame);
	await record("open");
	await send(crossSnapshot());
	await record("page (answer owed)");

	/*
	 * THE HOLD. The last known value says hidden and the answer that could
	 * contradict it is still owed, so the pane withholds the records rather than
	 * painting two rows it would have to take back one commit later.
	 */
	assert.equal(
		records.at(-1).rows,
		0,
		`rows painted ahead of the answer that governs them: ${JSON.stringify(records.at(-1).ids)}`,
	);

	await settings.answer({ [HIDE_CROSS_SESSION_KEY]: true });
	await record("settings: hidden");
	printSequence(records, "the hide setting, last known ON");

	const settled = records.at(-1);
	assert.ok(
		settled.rows > 0,
		`the page painted once the answer landed: ${settled.rows}`,
	);
	assert.equal(
		settled.ids.filter((id) => CROSS_SESSION_IDS.includes(id)).length,
		0,
		`the hidden rows are not in the page: ${JSON.stringify(settled.ids)}`,
	);
	assert.equal(
		settled.railMarks,
		records.at(-1).railMarks,
		"the rail does not move in the answer's own commit either",
	);

	/*
	 * THE INVARIANT THIS WHOLE ARM EXISTS FOR, read off every sample the drive
	 * took rather than off the two ends: no commit in this sequence — before the
	 * answer, in the answer's commit, or after it — ever painted one of the
	 * hidden rows. On the pre-fix tree the page's own commit paints both of
	 * them.
	 */
	for (const row of records) {
		const painted = row.ids.filter((id) => CROSS_SESSION_IDS.includes(id));
		assert.deepEqual(painted, [], `${row.step} painted a cross-session row`);
	}
});

test("the same page with the setting off: nothing waits, and the rows paint", async (t) => {
	/*
	 * THE CONTROL, and half of what makes the arm above mean anything: this page
	 * really does paint `peer1` and `send1` when nothing hides them, and it does
	 * so while the registry answer is STILL OWED — the default path waits for
	 * nothing (the operator's rule for this lane). On the pre-fix tree both arms
	 * paint the rows; on the branch exactly one does.
	 */
	__resetPaintCache();
	clearDisplayFlags();
	const settings = heldSettings();
	const { records, record, send } = await mountArm(
		t,
		"mount (answer owed)",
		settings.network,
	);

	await settings.requestSeen();
	await send(openFrame);
	await record("open");
	await send(crossSnapshot());
	await record("page (answer owed)");

	printSequence(records, "the setting off");
	const painted = records.at(-1);
	assert.ok(
		painted.rows > 0,
		`the page paints without the answer: ${painted.rows}`,
	);
	assert.deepEqual(
		CROSS_SESSION_IDS.filter((id) => painted.ids.includes(id)),
		CROSS_SESSION_IDS,
		`the filter is off, so both rows paint: ${JSON.stringify(painted.ids)}`,
	);

	await settings.answer({ [HIDE_CROSS_SESSION_KEY]: false });
	await record("settings: visible");
	assert.deepEqual(
		CROSS_SESSION_IDS.filter((id) => records.at(-1).ids.includes(id)),
		CROSS_SESSION_IDS,
		"and the answer changes nothing",
	);
});

test("the answer rail, last known ON: the mark is in the first contentful commit", async (t) => {
	/*
	 * F10's second half. The rail is a mark on the elected answer, and the answer
	 * row is painted with the page — so a setting that resolves after the page
	 * adds the mark to a row the reader is already reading, and the row's box
	 * moves with it (`-ml-[13px] border-l pl-3`, which nets to the same prose box
	 * but is still a repaint under the reader).
	 *
	 * The fixture is a single settled turn with no calls between the question and
	 * the answer, because an answer that closes a CONDENSED run is behind its own
	 * bar and this arm is about what the page paints.
	 */
	__resetPaintCache();
	seedDisplayFlags({ [TURN_ANSWER_RAIL_KEY]: true });
	const settings = heldSettings();
	const { records, record, send } = await mountArm(
		t,
		"mount (answer owed)",
		settings.network,
	);

	const short = [
		entry("u1", S, {
			kind: "message",
			role: "user",
			content: [{ text: QUESTION }],
		}),
		entry("a1", S + 40, {
			kind: "message",
			role: "assistant",
			content: [{ text: CLOSE }],
			stop_reason: "stop",
		}),
	];

	await settings.requestSeen();
	await send(openFrame);
	await record("open");
	await send(
		frame(2, "snapshot", {
			frontend: frontendState({ streaming: false, live_events: [] }),
			history: { entries: short, has_more: false, cursor_missing: false },
			cold: false,
			cold_reason: null,
		}),
	);
	await record("page (answer owed)");

	printSequence(records, "the answer rail, last known ON");
	const first = records.at(-1);
	assert.equal(
		first.electedAnswers,
		1,
		`one elected answer is painted: ${JSON.stringify(first.ids)}`,
	);
	assert.equal(
		first.railMarks,
		1,
		"the mark is on the answer in the commit that paints it",
	);

	await settings.answer({ [TURN_ANSWER_RAIL_KEY]: true });
	await record("settings: rail on");
	assert.equal(records.at(-1).railMarks, 1, "and the answer does not move it");
});

test("the same page with the rail off: the answer is elected and wears no mark", async (t) => {
	/*
	 * The rail arm's control. `data-turn-answer` is set from the ELECTION alone,
	 * so an arm that only ever asserted `railMarks === 1` could be passing
	 * because the mark is unconditional rather than because the setting was
	 * settled: this arm reads the other side of the same row — one elected
	 * answer, no mark — with the setting answered off and no seed.
	 */
	__resetPaintCache();
	clearDisplayFlags();
	const settings = heldSettings();
	const { records, record, send } = await mountArm(
		t,
		"mount (answer owed)",
		settings.network,
	);

	const short = [
		entry("u1", S, {
			kind: "message",
			role: "user",
			content: [{ text: QUESTION }],
		}),
		entry("a1", S + 40, {
			kind: "message",
			role: "assistant",
			content: [{ text: CLOSE }],
			stop_reason: "stop",
		}),
	];

	await settings.requestSeen();
	await send(openFrame);
	await record("open");
	await send(
		frame(2, "snapshot", {
			frontend: frontendState({ streaming: false, live_events: [] }),
			history: { entries: short, has_more: false, cursor_missing: false },
			cold: false,
			cold_reason: null,
		}),
	);
	await record("page (answer owed)");
	assert.equal(
		records.at(-1).electedAnswers,
		1,
		"the answer is elected with the setting off as well",
	);
	assert.equal(records.at(-1).railMarks, 0, "and it wears no mark");

	await settings.answer({ [TURN_ANSWER_RAIL_KEY]: false });
	await record("settings: rail off");
	assert.equal(records.at(-1).railMarks, 0, "and the answer changes nothing");
});
