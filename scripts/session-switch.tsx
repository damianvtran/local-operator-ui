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
import { HashRouter, Route, Routes } from "react-router-dom";
import {
	type BridgeHandle,
	type BridgeLatency,
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
 * How long the race arm waits for the view to HOLD STILL before reading it.
 *
 * The readback is a claim about the settled view, so the window has to outlast
 * the last thing that can move it - the two guard reads, and the panel's own
 * hydration behind them. Short enough to keep the arm a second long, long
 * enough that a stale load landing after the second click cannot slip past it
 * unobserved (which is the one failure mode that would make this arm report a
 * PASS it did not earn).
 */
const QUIET_MS = param("raceQuiet", 600);

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
/**
 * The RACE arm's two conversations - the first two after the one the page BOOTS
 * on.
 *
 * `OUTGOING` cannot be one of them: the harness's boot is `openSession(OUTGOING)`
 * (see the bottom of this file), so a click on it is the store's own no-op
 * re-select and the hop the arm exists to slow would never be issued at all. The
 * pair is therefore the two rows below the boot session, and A/B name the ORDER
 * of the clicks rather than a role: A is clicked first and is scripted to answer
 * LAST.
 */
const RACE_FIRST = SESSION_IDS[1];
const RACE_SECOND = SESSION_IDS[2];

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
	/** The route the router is on, as `/chat/<id>` or `/chat`. */
	path: () => string;
	/** Every `openSession` call this page has made, with its call site. */
	openCalls: () => Array<{
		id: string;
		active: string | null;
		path: string;
		t: number;
		from: string;
	}>;
	/**
	 * The TWO-CLICK arm: row `first`, then row `second` `gapMs` later, with the
	 * first click's hop scripted to answer AFTER the second's (`raceLatency`).
	 */
	/**
	 * The same arm again, with the second click dispatched AT THE FIRST CLICK'S
	 * URL WRITE (`runSequence`'s `when`) rather than after a delay.
	 *
	 * The two-click arm's `gapMs` is a deadline, and a deadline can only ever
	 * RACE the renderer's frame: `select` writes the URL in a microtask after the
	 * switch's guard read answers, React renders that write in a later task, and a
	 * timer scheduled for the same frame may land on either side of it. This arm
	 * takes the ordering rather than gambling on it - it clicks the second row the
	 * moment the first row's write is observable to JavaScript, which is before
	 * the renderer has painted it, and that is the whole of the window in which a
	 * stale route can be read as an instruction.
	 */
	raceAtWrite: (first: string, second: string) => Promise<RaceResult>;
	/**
	 * The same arm, repeated over many click SEQUENCES - the shape the operator
	 * described was "clicking across multiple conversations", and a hypothesis
	 * about which hop loses the race is not evidence that no OTHER sequence does.
	 *
	 * Each sequence is clicked with its own gaps and the settled view is read the
	 * same way `raceTo` reads it; the property asserted of every sequence is the
	 * same one, that the LAST row clicked is the one the view lands on.
	 */
	raceMany: (
		sequences: Array<Array<{ id: string; gapAfter: number }>>,
	) => Promise<RaceTrial[]>;
	record: () => RecordHandle;
};

/**
 * One frame of the race, kept only when something a reader can see moved.
 *
 * `painted` is the conversation whose transcript ROWS are on screen, read from
 * the DOM rather than from the store: the whole question this arm exists to ask
 * is whether the paint can disagree with the store, and a sample taken from the
 * store can only ever report the store.
 */
type RaceSample = {
	t: number;
	active: string | null;
	path: string;
	painted: string[];
};

type RaceResult = {
	first: string;
	second: string;
	gapMs: number;
	clickAt: number;
	secondClickAt: number;
	/** How long the view had to hold still before the run was read. */
	quietMs: number;
	settled: boolean;
	active: string | null;
	path: string;
	/** Every conversation whose transcript rows were painted, in DOM order. */
	painted: string[];
	selectedRow: string | null;
	/** Whether the row for the SECOND click is the one marked current. */
	selectedIsSecond: boolean;
	/** Every change of (active, path, painted), in the order it happened. */
	samples: RaceSample[];
};

/** One click sequence: what was clicked, in order, and where the view settled. */
type RaceTrial = {
	/** Every id clicked, in order - the last one is the one that must win. */
	clicks: string[];
	gapsMs: number[];
	/** The view the trial started from, before its reset click. */
	from: string | null;
	/** What the store held when each of the trial's clicks was dispatched. */
	activeBefore: Array<string | null>;
	timedOut: boolean;
	active: string | null;
	path: string;
	painted: string[];
	selectedIsLast: boolean;
	samples: RaceSample[];
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
	const search = new URLSearchParams(window.location.search);
	const raw = search.get("fail");
	const ids: string[] = [];
	// `?fail=incoming` names the session the driver times, which the driver
	// cannot spell itself: it learns the fixture ids from the page.
	if (raw === "incoming") ids.push(INCOMING);
	else if (raw) ids.push(raw);
	// The race arm's sides, which are neither of the two the other arms name:
	// see `raceLatency` for why the pair is the two rows below the boot session.
	if (search.get("raceFailA") !== null) ids.push(RACE_FIRST);
	if (search.get("raceFailB") !== null) ids.push(RACE_SECOND);
	return ids;
};

/**
 * The RACE arm's per-session latencies, from `?race=1&raceGetA=600&raceGetB=40`.
 *
 * ABSENT UNLESS `?race=1`, so every other arm keeps the uniform table it was
 * measured with: a global `--get` cannot express this race at all, because with
 * both hops the same length the second click's read settles last by construction
 * and there is no window in which the FIRST click's load can land on the view.
 *
 * The pair is the two rows below the session the page boots on (`RACE_FIRST`
 * and `RACE_SECOND`), so both clicks are real switches from a settled view, and
 * `A`/`B` name the ORDER of the clicks rather than a role.
 *
 * `raceStream*` is here as well as `raceGet*` because the hop the race is about
 * is a question about this codebase, not about the fixture: an arm that could
 * only slow the guard read would report "not reproduced" for a race that lives
 * on the stream.
 */
const raceLatency = (): Record<string, Partial<BridgeLatency>> | undefined => {
	const search = new URLSearchParams(window.location.search);
	if (search.get("race") === null) return undefined;
	const ms = (name: string) => {
		const raw = search.get(name);
		if (raw === null) return undefined;
		const value = Number(raw);
		return Number.isFinite(value) ? value : undefined;
	};
	const override = (suffix: string) => {
		const get = ms(`raceGet${suffix}`);
		const history = ms(`raceHistory${suffix}`);
		const stream = ms(`raceStream${suffix}`);
		const entry: Partial<BridgeLatency> = {
			...(get === undefined ? {} : { "sessions.get": get }),
			...(history === undefined ? {} : { "sessions.history": history }),
			...(stream === undefined ? {} : { stream }),
		};
		return Object.keys(entry).length > 0 ? entry : undefined;
	};
	const first = override("A");
	const second = override("B");
	if (!first && !second) return undefined;
	return {
		...(first ? { [RACE_FIRST]: first } : {}),
		...(second ? { [RACE_SECOND]: second } : {}),
	};
};

/**
 * WHICH conversations have transcript rows on screen, read from the DOM.
 *
 * The wire ids are `<sessionId>-e<index>` (`historyPage`), and the row renders
 * `data-record-id={record.id}`, so the rendered rows name the sessions the paint
 * belongs to without a second instrument and without touching the fixtures -
 * changing their text for a test's benefit would re-shoot every committed frame
 * in `docs/evidence/session-switch/`.
 *
 * A SET rather than one id, because a splice is one of the shapes this arm
 * exists to catch: a transcript holding two sessions' rows is not a question a
 * single `querySelector` can ask, and reading only the first row would report
 * the winner of a page merge as if nothing had happened.
 */
const paintedOwners = () => {
	const owners = new Set<string>();
	for (const row of document.querySelectorAll("[data-record-id]")) {
		const id = row.getAttribute("data-record-id") ?? "";
		const owner = SESSION_IDS.find((session) => id.startsWith(`${session}-e`));
		if (owner) owners.add(owner);
	}
	return [...owners];
};

/** The sidebar's own mark: the row the list says is current, as its title. */
const selectedRowText = () =>
	document
		.querySelector('[data-chat-row][aria-current="page"]')
		?.textContent?.trim() ?? null;

// --------------------------------------------------------------- the page

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
});

const bridge = installSwitchBridge({
	sessions,
	stepsBySession,
	latency: latencyOf(),
	latencyBySession: raceLatency(),
	failGet: failGet(),
});

/**
 * EVERY `openSession` call, with the call site that made it.
 *
 * The settled view cannot say WHO moved it. `ChatPage` has four callers of the
 * store's switch - a sidebar click, the route-to-store sync, a legacy rebind and
 * the command palette - and the arm exists to tell "the user's click moved the
 * view" from "something re-issued an older intent and the click lost". So the
 * switch is wrapped HERE, in the harness page, and each call records the store it
 * was made against, the route at that moment, and its own call site: the product
 * code is untouched and the answer is an origin rather than an inference.
 */
const openCalls: Array<{
	id: string;
	active: string | null;
	path: string;
	t: number;
	from: string;
}> = [];
{
	const original = useCanonicalSessionsStore.getState().openSession;
	useCanonicalSessionsStore.setState({
		openSession: (sessionId: string) => {
			const store = useCanonicalSessionsStore.getState();
			const frames = (new Error().stack ?? "").split("\n").slice(2, 4);
			openCalls.push({
				id: sessionId,
				active: store.activeSessionId,
				path: probePath(),
				t: Math.round(performance.now()),
				from: frames
					.map((frame) => frame.trim().replace(/^\(?/, ""))
					.join(" <- ")
					.slice(0, 260),
			});
			return original(sessionId);
		},
	});
}

/**
 * ONE click sequence, watched until every load it started is OVER.
 *
 * Shared by the two-click arm (`raceTo`) and the fuzz arm (`raceMany`) rather
 * than written twice: the question - which conversation owns the view once the
 * clicks and their loads have all settled - is one question, and a second
 * implementation of the watching rule would be a second answer to it.
 *
 * WHY IT SAMPLES EVERY FRAME. The samples are the mechanism's fingerprint: a
 * view that goes B -> A has a different timeline from one that never left A, and
 * the difference is invisible in the end state alone. Only CHANGES are kept, so
 * the list is a sequence of transitions rather than a frame dump.
 *
 * WHEN IT IS OVER. Every click's guard read must have SETTLED and every click's
 * stream subscription must have reached a terminal state - a snapshot delivered,
 * or a `dispose` (the bridge logs both) - and only then does the quiet window
 * start. Waiting only for the LAST click would read the view while a superseded
 * load was still in flight, which was the first shape of this arm's failure: a
 * superseded stream delayed past the readback was never observed at all. Bounded
 * at `sum(gaps) + 10 s`, and a run that hits the bound is REPORTED
 * (`timedOut: true`) rather than read as a settled one.
 */
const runSequence = (
	clicks: Array<{ id: string; gapAfter: number; when?: string }>,
) =>
	new Promise<{
		samples: RaceSample[];
		clickTimes: number[];
		/** What the store held when each click was dispatched. */
		activeBefore: Array<string | null>;
		timedOut: boolean;
	}>((resolve) => {
		const samples: RaceSample[] = [];
		let last = "";
		let lastChangeAt = performance.now();
		const sample = () => {
			const active = useCanonicalSessionsStore.getState().activeSessionId;
			const painted = paintedOwners();
			const next = JSON.stringify([active, probePath(), painted]);
			if (next === last) return;
			last = next;
			lastChangeAt = performance.now();
			samples.push({
				t: Math.round(performance.now() * 10) / 10,
				active,
				path: probePath(),
				painted,
			});
		};
		/*
		 * NOTHING IS STILL RUNNING.
		 *
		 * The gate is "no request in flight, and the view has held still for the quiet
		 * window" rather than "the last click's read answered", and the difference is
		 * the whole subject of the arm: a superseded click's read is abandoned work
		 * that keeps running, and a readback taken before it answers would pronounce
		 * on a race it stopped watching. Reading it off the in-flight log also fixes
		 * the subtler form of the same mistake - two clicks on the SAME row produce
		 * two reads for one id, and a gate keyed on "a read for this id settled after
		 * this click" accepts the FIRST click's read as the second's, which read the
		 * URL 235 ms before the second click's navigate had been written and reported
		 * a stale URL that was only stale at that instant (measured, fuzz trial 3).
		 */
		const nothingInFlight = () =>
			bridge.log.requests.every((request) => request.settledAt > 0);
		sample();
		const clickTimes: number[] = [];
		const activeBefore: Array<string | null> = [];
		const dispatch = (click: { id: string; gapAfter: number }) => {
			const row = rowFor(click.id);
			if (!row) throw new Error(`no sidebar row for ${click.id}`);
			const store = useCanonicalSessionsStore.getState();
			clickTimes.push(performance.now());
			activeBefore.push(store.activeSessionId);
			sample();
			row.click();
		};
		/*
		 * A click can be gated on ANOTHER click's URL write instead of on a
		 * deadline (`when`), and that is the arm's sharpest form: the second click is
		 * dispatched the instant the first one's write is observable to JavaScript,
		 * before the renderer has painted it, which is the whole of the interval in
		 * which a route this window is still writing can be read as an instruction.
		 *
		 * BOUNDED BY MICROTASK TURNS, not by a wall-clock deadline. A loop that
		 * re-queues itself is a microtask STORM: the renderer never yields to the
		 * event loop, so the first click's OWN continuation is starved for as long as
		 * the loop runs - and on the first version of this arm the second click was
		 * dispatched 45 ms after the FIRST one and 2 ms BEFORE the second one's store
		 * commit had even been applied (measured: `active=3` then `active=2` 10 ms
		 * later). The clock was the wrong bound; turns are the right one, because the
		 * write this gate waits for is issued by a microtask of the click that owns
		 * it - so a few turns is all it can ever need, and the gate can never outlive
		 * the turn that would have produced the write.
		 */
		const atWrite = (sessionId: string, run: () => void) => {
			const target = `/chat/${sessionId}`;
			let turns = 0;
			const step = () => {
				if (probePath() === target || turns++ > 64) run();
				else queueMicrotask(step);
			};
			queueMicrotask(step);
		};
		let at = 0;
		const watchers: Array<{
			click: { id: string; when?: string };
			run: () => void;
		}> = [];
		for (const click of clicks) {
			const row = rowFor(click.id);
			if (!row) throw new Error(`no sidebar row for ${click.id}`);
			if (click.when) {
				watchers.push({ click, run: () => dispatch(click) });
				continue;
			}
			at += click.gapAfter;
			/*
			 * The click that a watcher is gated on is dispatched HERE, synchronously,
			 * rather than through a `setTimeout(0)` like every other one: a watcher
			 * started during this loop would otherwise be watching for a write whose
			 * click had not happened yet, run out its turns, and fire the gated click
			 * FIRST - which is what the first version of this arm did (measured: the
			 * store went to B and then to A, 10 ms apart).
			 */
			if (at === 0) dispatch(click);
			else setTimeout(() => dispatch(click), at);
		}
		for (const watcher of watchers)
			atWrite(watcher.click.when as string, watcher.run);
		const deadline = performance.now() + at + 12_000;
		const tick = () => {
			sample();
			const quiet = performance.now() - lastChangeAt >= QUIET_MS;
			const ready = quiet && transcriptHasContent() && nothingInFlight();
			if (ready || performance.now() > deadline) {
				sample();
				resolve({ samples, clickTimes, activeBefore, timedOut: !ready });
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

/** The settled view, read once, from the surfaces that own each fact. */
const settledView = () => ({
	active: useCanonicalSessionsStore.getState().activeSessionId,
	path: probePath(),
	painted: paintedOwners(),
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
		/** The race arm's pair, so the driver never spells a fixture id itself. */
		raceFirst: RACE_FIRST,
		raceSecond: RACE_SECOND,
		raceGap: param("raceGap", 150),
		/*
		 * The rows' TITLES as data rather than as a `titleOf(id)` helper here:
		 * `snapshot()` crosses the websocket BY VALUE, so a closure would arrive as
		 * nothing and a verdict that compared against it would pass for the wrong
		 * reason.
		 */
		raceFirstTitle: sessions.find((row) => row.id === RACE_FIRST)?.name ?? "",
		raceSecondTitle: sessions.find((row) => row.id === RACE_SECOND)?.name ?? "",
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
	/** The route the router is on, from the probe mounted inside it. */
	path: () => probePath(),
	openCalls: () => openCalls,
	/*
	 * THE TWO-CLICK RACE: row `first` now, row `second` `gapMs` later.
	 *
	 * WHY IT IS AN ARM AND NOT A TIMING RUN. The other arms stop at the first
	 * click because a switch is one click; the operator's report is about TWO -
	 * "if you click one and then click another and the first loads, it switches you
	 * to that one even if the second loads first" - so the property is about which
	 * of two in-flight loads owns the view when the dust settles, and it is not
	 * observable one click at a time.
	 *
	 * WHAT IT READS BACK is the SETTLED view, and each fact is asked of the surface
	 * that owns it rather than of a convenient one: the store for
	 * `activeSessionId`, the ROUTER for the path, and the DOM for which
	 * conversation's rows were painted. A store-only readback cannot observe the
	 * symptom, because the symptom is a paint that disagrees with the store.
	 */
	raceTo: async (first, second, gapMs) => {
		const run = await runSequence([
			{ id: first, gapAfter: 0 },
			{ id: second, gapAfter: gapMs },
		]);
		const [clickAt = 0, secondClickAt = 0] = run.clickTimes;
		return {
			first,
			second,
			gapMs,
			clickAt,
			secondClickAt,
			quietMs: QUIET_MS,
			settled: !run.timedOut,
			...settledView(),
			selectedRow: selectedRowText(),
			/*
			 * Marked with the harness's own row lookup rather than by comparing text: a
			 * row's `textContent` carries its status chip (a row with no live status
			 * reads "Recent"), so a string equality on it fails against a correct view.
			 * This asks the question the claim is about - is the row for `second` the
			 * one carrying `aria-current` - and the text is kept beside it for a human
			 * to read.
			 */
			selectedIsSecond: rowFor(second)?.getAttribute("aria-current") === "page",
			samples: run.samples,
		};
	},
	raceAtWrite: async (first, second) => {
		const run = await runSequence([
			{ id: first, gapAfter: 0 },
			{ id: second, gapAfter: 0, when: first },
		]);
		const [clickAt = 0, secondClickAt = 0] = run.clickTimes;
		return {
			first,
			second,
			/* No delay at all: the gate is `first`'s URL write, and the measured interval is reported by the driver. */
			gapMs: 0,
			clickAt,
			secondClickAt,
			quietMs: QUIET_MS,
			settled: !run.timedOut,
			...settledView(),
			selectedRow: selectedRowText(),
			selectedIsSecond: rowFor(second)?.getAttribute("aria-current") === "page",
			samples: run.samples,
		};
	},
	/*
	 * THE FUZZ ARM: the same watching rule over many click sequences.
	 *
	 * A hypothesis about WHICH hop loses a race is not evidence that no other
	 * sequence does, and "clicking across multiple conversations" is open-ended.
	 * So each sequence is asserted for the one property that is true of all of
	 * them - the LAST row clicked is the one the view settles on - and the
	 * sequences differ in length, order and interval.
	 *
	 * THE RESET CLICK IS PART OF THE ARM. Every trial first clicks the session the
	 * page booted on, which is a switch with an UNSLOWED hop, so a trial begins from
	 * a settled view and the second and later trials run with the paint cache their
	 * predecessors filled - the state a real user's third and fourth clicks are
	 * made from, and the one a single-shot arm never reaches.
	 */
	raceMany: async (sequences) => {
		const trials: RaceTrial[] = [];
		for (const sequence of sequences) {
			const last = sequence.at(-1);
			if (!last) continue;
			const from = useCanonicalSessionsStore.getState().activeSessionId;
			await api.switchTo(OUTGOING, "reset");
			await api.settle(OUTGOING);
			const run = await runSequence(sequence);
			trials.push({
				clicks: sequence.map((click) => click.id),
				gapsMs: sequence.map((click) => click.gapAfter),
				from,
				activeBefore: run.activeBefore,
				timedOut: run.timedOut,
				...settledView(),
				selectedIsLast:
					rowFor(last.id)?.getAttribute("aria-current") === "page",
				samples: run.samples,
			});
		}
		return trials;
	},
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
/**
 * The URL, read where the app WRITES it.
 *
 * The page mounts the app's own router (`HashRouter`, from `main.tsx`) and
 * `ChatPage` as a ROUTE, and the readback is `window.location.hash` - not a
 * `useLocation()` value and not a rendered prop. Both of those are the router's
 * BELIEF about the location, which lags the `navigate` call by a render: on a
 * loaded machine the render can be a frame or more behind, and an arm reading it
 * would report "the URL never moved" for a switch that wrote the URL correctly.
 * `HashRouter` sets the hash synchronously inside `navigate`, so this is the
 * same write the app's own address bar gets, read at the moment it happened.
 *
 * `ChatPage` is mounted as a route rather than as a bare element because
 * `useParams` is where the page's route identity comes from, and `ChatPage` has
 * an effect that reconciles the store TO it. A harness that mounted the element
 * outside a `<Routes>` gave `useParams` nothing, so that effect could never run
 * and the page under test was one effect short of the shipped one.
 */
const probePath = () => window.location.hash.replace(/^#/, "") || "/chat";

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

/*
 * The app boots at `/chat` (`/` redirects there, and `main.tsx` mounts the same
 * `HashRouter`), and a hash router with an empty hash matches NEITHER chat route
 * - which mounts nothing at all and reads as a broken harness rather than an
 * empty one. Set before the first render, because `navigate` is how the routes
 * move after that.
 */
if (!window.location.hash) window.location.hash = "#/chat";

createRoot(document.getElementById("app") as HTMLElement).render(
	<QueryClientProvider client={queryClient}>
		{/*
		 * The app's own router and its two chat routes, in the order `app.tsx`
		 * declares them. `/chat` is where the app boots (`/` redirects there), so
		 * it is the route the operator is on when they click a conversation - and
		 * the `:agentId` route is the one a click navigates to, which is where the
		 * page's route identity and its route-to-store effect come alive.
		 */}
		<HashRouter>
			<ShellFrame>
				<Routes>
					<Route path="/chat" element={<ChatPage />} />
					<Route path="/chat/:agentId" element={<ChatPage />} />
				</Routes>
			</ShellFrame>
		</HashRouter>
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
