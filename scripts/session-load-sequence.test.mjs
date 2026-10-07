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
			export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";

			/*
			 * The composition chat-content.tsx performs, with the call site's own
			 * expressions where this rig uses them, because a second spelling of
			 * the call site is how a harness stops measuring the app. WHICH PROPS
			 * ARE THE CALL SITE'S AND WHICH ARE A NO-SEND LOAD'S OWN, stated
			 * rather than implied (agent review round 1, nit 3): read straight off
			 * the handle are frontend, transcript, gate, waiting (the call site's
			 * canonical.busy and the same expression, canonical.frontend?.streaming
			 * === true), loadingOlder, onLoadOlder, onLoadOlderOutcome, olderFailed,
			 * status, failure, awaitingHydration, conversationId, the three label
			 * sets, onReconnect, stale and containerRef (the rig's own div). NOT an
			 * exhaustive prop list - only the ones this rig's fidelity question is
			 * about (agent review round 2, nit); the interface itself is the
			 * authority. The values a load with NO admitted send
			 * holds are undelivered null, isSmallView false, missing false and the
			 * starting quartet false/null - the panel's own send latches, which
			 * never fire without a send. measureHandle is deliberately OMITTED: the
			 * call site's opt-in for the measure's drag handles, which the run
			 * panel's child reader does not pass either.
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
					waiting: canonical.frontend?.streaming === true,
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
const frontendState = () => ({
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
const snapshotFrame = frame(2, "snapshot", {
	frontend: frontendState(),
	history: {
		entries: PAGE_ENTRIES,
		has_more: false,
		cursor_missing: false,
	},
	cold: false,
	cold_reason: null,
});

/* ------------------------------------------------------------------ the reads */

/** What the pane would paint, read off the committed DOM. */
const readView = (container) => ({
	rows: container.querySelectorAll("[data-record-id][data-record-kind]").length,
	bars: [...container.querySelectorAll("[data-turn-summary]")].map((bar) =>
		(bar.textContent ?? "").replace(RE_WHITESPACE, " ").trim().slice(0, 44),
	),
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
const mountArm = async (t, label = "mount") => {
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
	globalThis.__loadNet.network = answerNetwork;
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
