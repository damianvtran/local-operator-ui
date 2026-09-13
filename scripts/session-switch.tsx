/*
 * The switch-latency harness surface: the SHIPPED chat page, driven by real
 * clicks, behind the scripted owner in `session-switch-bridge.ts`.
 *
 * Run it with
 *
 *     pnpm vite --config scripts/session-switch.vite.mjs      # one shell
 *     node scripts/session-switch-latency.mjs                 # another
 *
 * and read the driver's phase table; this file is the page it drives.
 *
 * WHY THE PAGE AND NOT THE ELECTRON APP. The switch is a renderer problem: the
 * click, the store transition, the mounted panel, the transcript. Every one of
 * those is in this page and is the shipped code. What is missing versus the
 * packaged app is the environment - no Chromium IPC hop, no minified bundle -
 * and both are stated by the driver rather than hidden, because a number whose
 * caveats are invisible is worse than no number.
 *
 * NO StrictMode. The app mounts under it, and in a dev build React then
 * double-invokes every effect and double-renders every tree once. That is a
 * development-only artifact - the shipped bundle does not do it - so measuring
 * with it on would report render work the user never pays for. The harness
 * keeps the component tree exactly as the app mounts it and drops only the
 * double-invocation wrapper.
 */

import "@renderer/styles/index.css";
import { ChatPage } from "@features/chat/components/chat-page";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
	type BridgeHandle,
	type SessionFixture,
	type TranscriptStep,
	installSwitchBridge,
} from "./session-switch-bridge";

// ---------------------------------------------------------------- fixtures

/** 12 hex characters, which is what a canonical session id is. */
const sessionId = (n: number) => `abcdef${String(n).padStart(6, "0")}`;

const param = (name: string, fallback: number) => {
	const value = new URLSearchParams(window.location.search).get(name);
	const parsed = value === null ? Number.NaN : Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const SESSION_COUNT = param("sessions", 24);
/** Steps in the INCOMING session's transcript: the one whose paint we time. */
const INCOMING_STEPS = param("steps", 200);
/** Steps in the outgoing session, so the view being replaced is real work too. */
const OUTGOING_STEPS = param("outgoingSteps", 80);

/**
 * A transcript of `count` steps, alternating turns with a tool call every third
 * step - the mix a real session has, and the reason the mounted row count is
 * not simply `count`.
 */
function steps(count: number): TranscriptStep[] {
	const out: TranscriptStep[] = [];
	for (let i = 0; i < count; i += 1) {
		const turn = Math.floor(i / 3);
		if (i % 3 === 0) {
			out.push({
				kind: "user",
				text: `Turn ${turn}: check the workspace and report what changed since yesterday, briefly.`,
			});
		} else if (i % 3 === 1) {
			out.push({
				kind: "assistant",
				text: `Reading the workspace now. Turn ${turn} has three files newer than the last run; I am checking each one before saying anything about them, because a summary of a stale read is worse than no summary.`,
			});
		} else {
			out.push({
				kind: "tool",
				name: "read_file",
				output: `notes.md (${turn}): 214 lines, last modified 09:1${turn % 10}.`,
			});
		}
	}
	return out;
}

const SESSION_IDS = Array.from({ length: SESSION_COUNT }, (_, i) =>
	sessionId(i + 1),
);
const OUTGOING = SESSION_IDS[0];
const INCOMING = SESSION_IDS[SESSION_IDS.length - 1];

const sessions: SessionFixture[] = SESSION_IDS.map((id, index) => ({
	id,
	name:
		id === INCOMING
			? "Invoice reconciliation"
			: `Workspace session ${index + 1}`,
	mtime: Date.now() / 1000 - index * 3600,
}));

const stepsBySession: Record<string, TranscriptStep[]> = {};
for (const id of SESSION_IDS) stepsBySession[id] = steps(6);
stepsBySession[OUTGOING] = steps(OUTGOING_STEPS);
stepsBySession[INCOMING] = steps(INCOMING_STEPS);

// ------------------------------------------------------------------ probe

type Run = {
	label: string;
	target: string;
	/** Click dispatched. */
	clickAt: number;
	/** The store's `pendingSessionId` became the target. */
	pendingAt: number | null;
	/** First frame in which the pending affordance was on screen. */
	pendingPaintedAt: number | null;
	/** The `sessions.get` for the target settled. */
	getSettledAt: number | null;
	/** The stream subscription for the target opened, and snapshotted. */
	streamSubscribedAt: number | null;
	streamOpenedAt: number | null;
	streamSnapshotAt: number | null;
	/** `activeSessionId` became the target - the commit. */
	committedAt: number | null;
	/** The transcript list committed with at least one row. */
	firstRowAt: number | null;
	/** First frame in which transcript content was on screen. */
	transcriptPaintedAt: number | null;
	/** Every request the switch issued, in order. */
	requests: string[];
	targetRequests: number;
	/** True when the run hit its deadline instead of settling. */
	timedOut: boolean;
};

type Probe = {
	ready: boolean;
	bridge: BridgeHandle | null;
	runs: Run[];
	relaunch: (query: string) => void;
	settle: (id: string) => Promise<void>;
	switchTo: (id: string, label: string) => Promise<Run>;
	snapshot: () => unknown;
};

const pendingIndicator = () =>
	document.querySelector('[aria-label="Opening chat"]') !== null;
const transcriptHasContent = () => {
	const content = document.querySelector("[data-lo-transcript-content]");
	return (content?.textContent ?? "").trim().length > 0;
};
const rowFor = (id: string) => {
	const title = sessions.find((row) => row.id === id)?.name ?? "";
	return document.querySelector<HTMLButtonElement>(
		`[data-chat-row][title^=${JSON.stringify(title)}]`,
	);
};

const probe = window as unknown as { __lopSwitch?: Probe };

const latencyOf = () => ({
	"sessions.get": param("get", 12),
	"sessions.history": param("history", 14),
	"sessions.list": param("list", 2),
	capabilities: param("capabilities", 1),
	stream: param("stream", 12),
});

// --------------------------------------------------------------- the page

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
});

const bridge = installSwitchBridge({
	sessions,
	stepsBySession,
	latency: latencyOf(),
});

const api: Probe = {
	ready: false,
	bridge,
	runs: [],
	relaunch: (query) => {
		window.location.search = query;
	},
	settle: (id) =>
		new Promise((resolve) => {
			/*
			 * Bounded, and on a `setTimeout` as well as the frame loop: a backgrounded
			 * or throttled renderer stops delivering `requestAnimationFrame`, and a
			 * settle that waits forever is how a harness hangs instead of reporting.
			 * The deadline resolves anyway - a run that started from an unsettled
			 * view shows up in its own phase table, which beats a driver that never
			 * returns.
			 */
			const deadline = performance.now() + 15_000;
			const timer = setTimeout(resolve, 15_000);
			const tick = () => {
				const state = useCanonicalSessionsStore.getState();
				if (
					(state.activeSessionId === id && transcriptHasContent()) ||
					performance.now() > deadline
				) {
					clearTimeout(timer);
					resolve();
					return;
				}
				requestAnimationFrame(tick);
			};
			tick();
		}),
	switchTo: (id, label) =>
		new Promise<Run>((resolve) => {
			const run: Run = {
				label,
				target: id,
				clickAt: performance.now(),
				pendingAt: null,
				pendingPaintedAt: null,
				getSettledAt: null,
				streamSubscribedAt: null,
				streamOpenedAt: null,
				streamSnapshotAt: null,
				committedAt: null,
				firstRowAt: null,
				transcriptPaintedAt: null,
				requests: [],
				targetRequests: 0,
				timedOut: false,
			};
			let settled = false;
			const requestsBefore = bridge.log.requests.length;
			const store = useCanonicalSessionsStore;
			const unsubscribe = store.subscribe((state, previous) => {
				if (
					run.pendingAt === null &&
					state.pendingSessionId === id &&
					previous.pendingSessionId !== id
				)
					run.pendingAt = performance.now();
				if (
					run.committedAt === null &&
					state.activeSessionId === id &&
					previous.activeSessionId !== id
				)
					run.committedAt = performance.now();
			});
			// The transcript's own commit mark, from the shipped component
			// (`useLayoutEffect` in canonical-transcript.tsx) rather than a
			// second instrument: it fires post-mutation, pre-paint, for every
			// commit of that list.
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					if (entry.name !== "lop:transcript:render") continue;
					const rows = (entry as PerformanceEntry & { detail?: { rows?: number } })
						.detail?.rows;
					if (!rows) continue;
					/* `startTime >= run.committedAt` matters: the observer is created
						* before the click and `buffered: true` replays marks from earlier in
						* the page's life, so without the guard the settled view's own render
						* reads as this switch's first row (measured: a negative
						* `committed → rows` phase). */
						if (
						run.committedAt !== null &&
						entry.startTime >= run.committedAt &&
						run.firstRowAt === null
						)
						run.firstRowAt = entry.startTime;
				}
			});
			observer.observe({ type: "mark", buffered: true });
			/*
			 * A frame loop is how the phases are OBSERVED, but it is not how the run
			 * ends: a throttled renderer stops delivering frames, and a harness that
			 * waits on one hangs instead of reporting a timeout. This timer resolves
			 * the run with whatever it managed to see.
			 */
			const deadlineTimer = setTimeout(() => finish(true), 20_000);
			const deadline = performance.now() + 20_000;
			/*
			 * The pending phase is satisfied EITHER by seeing it painted or by a
			 * commit that arrived without one: a switch that commits optimistically
			 * may never paint a pending state at all, and a harness that waited for
			 * one would report that as a timeout rather than as the improvement it
			 * is.
			 */
			const pendingPhaseDone = () =>
				run.pendingPaintedAt !== null ||
				(run.committedAt !== null && run.pendingAt === null);
			const tick = () => {
				const time = performance.now();
				if (run.pendingAt !== null && run.pendingPaintedAt === null) {
					if (pendingIndicator()) run.pendingPaintedAt = time;
				}
				if (run.firstRowAt !== null && run.transcriptPaintedAt === null) {
					if (transcriptHasContent()) run.transcriptPaintedAt = time;
				}
				const done =
					run.committedAt !== null &&
					run.transcriptPaintedAt !== null &&
					pendingPhaseDone();
				if (done || time > deadline) {
					finish(!done);
					return;
				}
				requestAnimationFrame(tick);
			};
			const finish = (timedOut: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(deadlineTimer);
				run.timedOut = timedOut;
				const issued = bridge.log.requests.slice(requestsBefore);
				for (const request of issued) {
					run.requests.push(request.op);
					if (request.op === "sessions.get" && request.sessionId === id) {
						run.targetRequests += 1;
						run.getSettledAt ??= request.settledAt;
					}
				}
				const subscription = bridge.log.streams
					.filter(
						(stream) =>
							stream.sessionId === id && stream.subscribedAt >= run.clickAt,
					)
					.at(0);
				if (subscription) {
					run.streamSubscribedAt = subscription.subscribedAt;
					run.streamOpenedAt = subscription.openedAt || null;
					run.streamSnapshotAt = subscription.snapshotAt || null;
				}
				unsubscribe();
				observer.disconnect();
				resolve(run);
			};
			const row = rowFor(id);
			if (!row) {
				clearTimeout(deadlineTimer);
				unsubscribe();
				observer.disconnect();
				throw new Error(`no sidebar row for ${id}`);
			}
			row.click();
			requestAnimationFrame(tick);
		}),
	snapshot: () => ({
		sessions: SESSION_IDS,
		outgoing: OUTGOING,
		incoming: INCOMING,
		latency: bridge.log.latency,
		hasRow: (id: string) => rowFor(id) !== null,
	}),
};

probe.__lopSwitch = api;

createRoot(document.getElementById("root") as HTMLElement).render(
	<QueryClientProvider client={queryClient}>
		{/*
		 * `MemoryRouter`, not the app's `HashRouter`, and for the same reason
		 * `.storybook/preview.tsx` uses it: a harness page has no URL to keep, and
		 * an empty hash matches no route at all - which mounts nothing and looks
		 * like a broken harness rather than an empty one. The route only feeds the
		 * page's deep-link effect; the panel the switch swaps is driven by the
		 * STORE, so nothing under measurement depends on which router is in use.
		 */}
		<MemoryRouter initialEntries={["/chat"]}>
			<Routes>
				<Route path="/chat" element={<ChatPage />} />
				<Route path="/chat/:agentId" element={<ChatPage />} />
			</Routes>
		</MemoryRouter>
	</QueryClientProvider>,
);

/*
 * The boot is not a measured switch: it is "the app is open on a session",
 * which is the state every measured switch starts from. It goes through the
 * store's own action rather than a click because no row has been painted yet
 * at this point - the sidebar's list arrives from `sessions.list` a moment
 * later, and the driver waits for `ready` before timing anything.
 */
void useCanonicalSessionsStore
	.getState()
	.openSession(OUTGOING)
	.then(() => api.settle(OUTGOING))
	.then(() => {
		api.ready = true;
	});
