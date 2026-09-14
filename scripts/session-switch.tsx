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

import "./session-switch.css";
/* The app's real faces, imported by both renderer entries and by Storybook's
 * preview for the same reason: without them `font-mono` resolves to the
 * platform fallback, so a frame would be a picture of the reviewer's OS rather
 * than of the product. */
import "@renderer/assets/fonts/fonts.css";
import { ChatPage } from "@features/chat/components/chat-page";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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
	view: () => {
		activeSessionId: string | null;
		errorState: string | null;
		selectedRow: string | null;
		errorShown: boolean;
		transcriptHasContent: boolean;
		outgoing: string;
		pendingIndicator: boolean;
	};
	/** What a CAPTURE has to read back before its bytes may be written. */
	frame: () => {
		active: string | null;
		target: string;
		outgoing: string;
		pendingIndicator: boolean;
		placeholder: boolean;
		placeholderOpacity: number | null;
		content: boolean;
		rowInView: boolean;
		composerAlert: string | null;
		sentMessages: number;
	};
	record: () => RecordHandle;
};

type RecordStats = {
	frames: number;
	shownFrames: number;
	firstShownAt: number | null;
	lastShownAt: number | null;
	shownAtEnd: boolean;
	recorded: boolean;
	maxSurfaces: number;
	transitions: Array<{
		t: number;
		active: string | null;
		shown: boolean;
		surfaces: number;
		error: string | null;
		navigation: string | null;
	}>;
};
type RecordHandle = {
	stats: () => RecordStats;
	stop: () => void;
};

const pendingIndicator = () =>
	document.querySelector('[aria-label="Opening chat"]') !== null;
/*
 * Whether the transcript has ROWS in it.
 *
 * The placeholder renders inside this same content box (it stands where the rows
 * will be), so its caption is text in here and a plain textContent read turned
 * every hydrating frame into a settled one - which is the state the whole
 * harness exists to tell apart. The placeholder's own subtree is removed from
 * the copy first, so this answers the question it is asked.
 */
const transcriptHasContent = () => {
	const content = document.querySelector("[data-lo-transcript-content]");
	if (!(content instanceof HTMLElement)) return false;
	const copy = content.cloneNode(true) as HTMLElement;
	copy.querySelector('[aria-label="Loading conversation"]')?.remove();
	return (copy.textContent ?? "").trim().length > 0;
};
const placeholderPresent = () =>
	document.querySelector('[aria-label="Loading conversation"]') !== null;
/**
 * The placeholder bar's rendered opacity - the pulse's phase, as painted.
 *
 * Read off the FIRST bar of the live region rather than off the animation's
 * bookkeeping: a frame captured at the maximum pulse trough has to be a picture
 * of a nearly-transparent bar (design D2), and this is the number that says
 * whether the shutter landed there.
 */
const placeholderOpacity = () => {
	const bar = document.querySelector(
		'[aria-label="Loading conversation"]',
	)?.firstElementChild;
	if (!(bar instanceof HTMLElement)) return null;
	return Math.round(Number(getComputedStyle(bar).opacity) * 100) / 100;
};
const rowInView = (el: Element | null) => {
	if (!(el instanceof HTMLElement)) return false;
	const rect = el.getBoundingClientRect();
	return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
};
/*
 * The composer's own failure row, as painted.
 *
 * Scoped to the FORM rather than read as `[role="alert"]` off the document: a
 * switch can have a navigation failure on screen at the same time, and a frame
 * claiming "the composer states the read window's refusal" has to be about the
 * row above the box the user pressed Enter in (UX round 2 U8, round 3 U9).
 */
const composerAlert = () => {
	const form = document.querySelector("textarea")?.closest("form");
	const alert = form?.querySelector('[role="alert"]');
	return alert instanceof HTMLElement ? alert.innerText : null;
};
/*
 * How many surfaces state the failure sentence. One is the contract (U3): it
 * used to be painted in the sidebar under a `Retry refresh` that refreshes the
 * chat LIST - a remedy that cannot re-open a chat - beside the panel's own copy
 * of the same words.
 */
const errorSurfaces = () =>
	Array.from(document.querySelectorAll('[role="alert"]')).filter((surface) =>
		(surface.textContent ?? "").includes("Unknown session"),
	).length;
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

/** Sessions whose guard read is scripted to fail, from `?fail=<id>`. */
const failGet = () => {
	const raw = new URLSearchParams(window.location.search).get("fail");
	if (!raw) return [];
	// `?fail=incoming` names the session the driver times, which the driver
	// cannot spell itself: it learns the fixture ids from the page.
	return raw === "incoming" ? [INCOMING] : [raw];
};

// --------------------------------------------------------------- the page

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
});

const bridge = installSwitchBridge({
	sessions,
	stepsBySession,
	latency: latencyOf(),
	failGet: failGet(),
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
					const rows = (
						entry as PerformanceEntry & { detail?: { rows?: number } }
					).detail?.rows;
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
			const tick = () => {
				const time = performance.now();
				if (run.firstRowAt !== null && run.transcriptPaintedAt === null) {
					if (transcriptHasContent()) run.transcriptPaintedAt = time;
				}
				const done =
					run.committedAt !== null && run.transcriptPaintedAt !== null;
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
		incomingTitle: sessions.find((row) => row.id === INCOMING)?.name ?? "",
		latency: bridge.log.latency,
		hasRow: (id: string) => rowFor(id) !== null,
	}),
	/*
	 * What the user can actually see, read from the document rather than from
	 * the store alone.
	 *
	 * `error` is taken from the rendered text: the store's `error` field being
	 * set proves the state, not that the sentence reached the screen, and the
	 * rollback path's whole promise is a claim about the screen.
	 */
	view: () => ({
		activeSessionId: useCanonicalSessionsStore.getState().activeSessionId,
		/*
		 * The NAVIGATION failure, which is the one a switch can produce. It was
		 * the shared `error` field until the split, and reading the shared one
		 * here would report a switch failure that the catalogue's own poll had
		 * already erased - the exact confusion this harness was rewritten to
		 * stop making.
		 */
		errorState: useCanonicalSessionsStore.getState().navigationError,
		selectedRow:
			document
				.querySelector('[data-chat-row][aria-current="page"]')
				?.textContent?.trim() ?? null,
		/*
		 * Read from the SCREEN, not the store: `errorState` can be cleared by the
		 * sidebar's five-second catalogue poll, which sets `error: null` when it
		 * starts, so a state read alone cannot say whether the sentence was ever
		 * shown.
		 */
		errorShown: document.body.innerText.includes("Unknown session"),
		transcriptHasContent: transcriptHasContent(),
		/** The pre-change state: the outgoing view, held, with its affordance. */
		outgoing: OUTGOING,
		pendingIndicator: pendingIndicator(),
	}),
	/**
	 * The reads a CAPTURE refuses to write without; see the driver's `shoot`.
	 *
	 * Separate from `view()` because these are facts about a FRAME rather than
	 * about the flow: whether the row carrying the selection is actually on
	 * screen (design D5 - it is below the fold in a 24-row list, and no still
	 * says so by itself), and what the placeholder bar's opacity is at the
	 * moment the shutter lands (design D6 - the state that has no frame is the
	 * slow hydration, i.e. the one that reaches the pulse trough).
	 */
	frame: () => ({
		active: useCanonicalSessionsStore.getState().activeSessionId,
		target: INCOMING,
		outgoing: OUTGOING,
		pendingIndicator: pendingIndicator(),
		placeholder: placeholderPresent(),
		placeholderOpacity: placeholderOpacity(),
		content: transcriptHasContent(),
		rowInView: rowInView(rowFor(INCOMING)),
		/**
		 * The refusal, and the fact that nothing left the app.
		 *
		 * The read window's refusal is a claim about two things at once: the
		 * sentence is on screen where the composer can be read, and no message
		 * reached the transport. The requests are the bridge's own log, so this is
		 * the transport's answer rather than the absence of a render.
		 */
		composerAlert: composerAlert(),
		sentMessages: bridge.log.requests.filter(
			(request) => request.op === "sessions.message",
		).length,
	}),
	/**
	 * Every state transition the rollback makes, so a reader can tell "the
	 * error was never set" from "it was set and something cleared it".
	 */
	record: () => {
		/*
		 * A DIGEST, not a dump of samples.
		 *
		 * The observation window is longer than the catalogue's own five-second
		 * poll - about 400 frames - and a raw entry per frame buries the two
		 * facts anyone reads out of it (was the sentence ever PAINTED, and was it
		 * still there at the end) in a thousand lines of JSON. So this keeps the
		 * counts, the first and last frame that showed it, and one entry per
		 * CHANGE between frames.
		 */
		const stats: RecordStats = {
			frames: 0,
			shownFrames: 0,
			firstShownAt: null,
			lastShownAt: null,
			shownAtEnd: false,
			recorded: false,
			maxSurfaces: 0,
			transitions: [],
		};
		let running = true;
		let previous = { active: null as string | null, shown: false };
		/*
		 * PER FRAME, not per store notification.
		 *
		 * This used to push an entry from a `store.subscribe` callback, so the
		 * `shown` it recorded was true AT AN INSTANT NO BROWSER EVER PAINTED.
		 * On this head the rollback wrote the failure sentence and the catalogue
		 * refetch its own rollback triggers cleared it 4.5-8.1 ms later: the
		 * subscription saw both, and the verdict built on it ("the failure
		 * sentence reached the screen") was therefore a claim about the store's
		 * history rather than about the screen. An `rAF` callback runs
		 * immediately BEFORE that frame is painted, so a sample taken here states
		 * what the frame about to be shown contains - which is the only reading
		 * the word "shown" may be built on.
		 */
		const tick = () => {
			const state = useCanonicalSessionsStore.getState();
			const t = Math.round(performance.now() * 10) / 10;
			const shown = document.body.innerText.includes("Unknown session");
			const surfaces = errorSurfaces();
			stats.frames += 1;
			if (shown) {
				stats.shownFrames += 1;
				stats.firstShownAt ??= t;
				stats.lastShownAt = t;
			}
			stats.shownAtEnd = shown;
			stats.maxSurfaces = Math.max(stats.maxSurfaces, surfaces);
			if (state.navigationError !== null) stats.recorded = true;
			if (
				shown !== previous.shown ||
				state.activeSessionId !== previous.active
			) {
				stats.transitions.push({
					t,
					active: state.activeSessionId,
					shown,
					surfaces,
					error: state.error,
					navigation: state.navigationError,
				});
				previous = { active: state.activeSessionId, shown };
			}
			if (running) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return {
			stats: () => stats,
			stop: () => {
				running = false;
			},
		};
	},
};

probe.__lopSwitch = api;

/**
 * The app shell a page lives inside, copied from `shell.stories.tsx`'s
 * `ShellFrame` - which is where this repository already renders a page in the
 * shell outside Electron, and the reason it exists there is the reason it
 * exists here: `ChatPage` is a ROUTE, and everything that gives it a box -
 * `h-screen`, `overflow-hidden`, `min-w-0 grow` - lives in the shell above it.
 * Mounting the page alone compiles, renders and measures, and produces a frame
 * of a 32px-wide column 128,805px tall: the first capture attempt did exactly
 * that, and only looking at the frame caught it.
 *
 * Mounting the whole `App` instead would drag in the first-run gating (the
 * onboarding modal and the compatibility banner) and photograph that rather
 * than the switch; the shell story draws the same conclusion.
 */
const ShellFrame = ({ children }: { children: React.ReactNode }) => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas")}>
		{/*
		 * No `SidebarNavigation`. The shell story renders it; here it paints the
		 * product's splash mark at viewport size (a browser has no desktop bridge
		 * to tell it otherwise) and pushes the chat column off the right edge.
		 * The rail is app chrome beside the subject, and the switch is the chat
		 * column's, so the frame is the chat column: same box the app gives it,
		 * minus the rail that sits to its left.
		 */}
		<main className="flex min-w-0 grow flex-col overflow-hidden">
			{children}
		</main>
	</div>
);

createRoot(document.getElementById("app") as HTMLElement).render(
	<QueryClientProvider client={queryClient}>
		{/*
		 * `MemoryRouter` at `/chat`, which is where the app boots: `/` redirects
		 * there, so this is the route the operator is on when they click a
		 * conversation. A harness page has no URL to keep, and an empty hash
		 * matches no route at all - which mounts nothing and looks like a broken
		 * harness rather than an empty one.
		 */}
		<MemoryRouter initialEntries={["/chat"]}>
			<ShellFrame>
				<ChatPage />
			</ShellFrame>
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
