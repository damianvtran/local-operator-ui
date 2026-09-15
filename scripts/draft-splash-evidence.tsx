/**
 * Evidence harness: the shipped chat surface on a NEW CHAT, in a browser.
 *
 * See `draft-splash-evidence.html` for why this exists. The short version: the
 * claim under test is "a fresh New chat settles on the greeting and the
 * suggestion chips, not on a loading skeleton", which is a claim about a
 * rendered frame; and the state it is a claim about is a DRAFT the app's own
 * store stages, so nothing on that path may be stubbed. This mounts the real
 * `ChatPage`, which drives the real canonical sessions store, the real
 * `useCanonicalSessionStream` and the real composer.
 *
 * WHAT IS REAL HERE: `ChatPage` and everything under it, the canonical sessions
 * store, `useCanonicalSessionStream` (including the session-less draft, where
 * it deliberately subscribes to nothing), `desktopRequest`'s same-origin
 * `/__desktop` branch, the dev desktop proxy, the backend and the event stream.
 *
 * WHAT IS NOT: there is no Electron main process, so no IPC hop and no packaged
 * build. `desktopRequest` reaches the same backend by its OTHER shipped branch
 * — the one browser development already uses — rather than through
 * `ipcRenderer`. Stated on the PR and in docs/evidence/draft-splash/README.md
 * so no reader over-reads these frames.
 *
 * WHY THE READBACK IS IN THE PAGE. The instrument a browser driver has is its
 * own page reading, and the questions a reader has about these frames are not
 * all answerable from pixels: which store state the pane is in, whether the
 * band's DOM holds an `h2` or the skeleton's `<output>`, how many chips are in
 * it and from which list, and — for the draft-to-session flip — what the band
 * rendered on EVERY frame of that transition rather than only in the last one.
 * `#probe` carries all of it as text. The frames themselves are committed
 * unchanged beside it.
 */

import { ChatPage } from "@features/chat/components/chat-page";
import { queryClient } from "@shared/api/query-client";
import { useCanonicalSessionStream } from "@shared/hooks/use-canonical-session";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { ThemeProvider } from "@shared/themes/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "./draft-splash-evidence.css";

/*
 * Surface a mount failure where a driver can read it, instead of leaving an
 * empty body whose only diagnosis is "did not render".
 */
window.addEventListener("error", (event) => {
	(window as unknown as { __HARNESS_ERROR__?: string }).__HARNESS_ERROR__ =
		String(event.error?.stack ?? event.message);
});

/*
 * HARNESS-ONLY `window.api` / `window.electron` SHIMS, for the reasons
 * `submit-latency-evidence.tsx` records in full: the app cannot mount in a plain
 * browser because `app.tsx:91` (avoided here — this harness does not boot
 * `app.tsx`), `message-input.tsx`'s `get-platform-info` at mount and
 * `use-speech-to-text-manager.ts`'s `removeListener` on unmount all reach for
 * a preload that is not there. All three are pre-existing and byte-identical on
 * `origin/main`; none is on the path under test.
 *
 * `window.api.desktop` is POINTEDLY ABSENT, because defining it would route the
 * transport into an IPC bridge that does not exist here.
 */
const HARNESS_HOME = "/Users/damian";
(window as unknown as { api: Record<string, unknown> }).api = {
	getHomeDirectory: async () => HARNESS_HOME,
	directoryExists: async () => true,
	selectDirectory: async () => null,
};
(window as unknown as { electron: Record<string, unknown> }).electron = {
	ipcRenderer: {
		invoke: async (channel: string) => {
			if (channel === "get-platform-info") return { platform: "darwin" };
			if (channel === "show-open-dialog")
				return { canceled: true, filePaths: [] };
			return undefined;
		},
		on: () => () => undefined,
		removeListener: () => undefined,
		send: () => undefined,
	},
};

/*
 * A durable cwd, so the composer's chip is the same in the before and after
 * runs and the two frames differ only by the change under test. The store
 * persists to localStorage, so without this a capture could inherit whatever a
 * previous run left behind.
 */
useCanonicalSessionsStore.setState({ cwd: HARNESS_HOME });

/**
 * One row of the chip stack, as the browser laid it out.
 *
 * The rows are derived from the chips' own boxes rather than from a row pitch,
 * because a suggestion long enough to wrap inside its own chip makes a row
 * taller than its neighbours: the containment fix (D1) caps the stack to whole
 * rows, so "which row does the boundary fall on" has to be answered by the
 * geometry that is actually on screen rather than by an assumed line height.
 */
type ChipRow = {
	top: number;
	bottom: number;
	chips: number;
};

/** One reading of every loading claim on the page, wherever it is painted. */
type LoadingClaims = {
	placeholders: number;
	outsideBand: number;
	shimmerBars: number;
	captionVisible: boolean;
};

/** A measured box, rounded to a tenth of a pixel; `null` when nothing is there. */
type Box = { x: number; y: number; w: number; h: number };

const rect = (element: Element | null): Box | null => {
	if (!element) return null;
	const box = element.getBoundingClientRect();
	const round = (value: number) => Math.round(value * 10) / 10;
	return {
		x: round(box.x),
		y: round(box.y),
		w: round(box.width),
		h: round(box.height),
	};
};

/** One reading of the band, taken in one animation frame. */
type BandFrame = {
	at: number;
	text: string;
	greeting: number;
	skeleton: number;
	chips: number;
	chipLabels: string[];
	bandHeight: number;
	/**
	 * The boxes behind the pixels: the band, its greeting `h2`, the skeleton it
	 * replaces, the chip row and the composer form. `null` where the element is
	 * not in the document, which is itself a reading - a small-view band has no
	 * greeting box at all.
	 */
	boxes: {
		band: Box | null;
		greeting: Box | null;
		skeleton: Box | null;
		chipRow: Box | null;
		composer: Box | null;
	};
	/**
	 * The chip stack's own geometry, which is what D1 is a claim about: how many
	 * rows the sample wrapped to, how tall each is, and whether the last one is
	 * inside the window.
	 */
	stack: {
		top: number;
		bottom: number;
		height: number;
		clientHeight: number;
		scrollHeight: number;
		scrollable: boolean;
		topEdgeInside: boolean;
		rows: ChipRow[];
		rowCount: number;
		visibleRows: number;
		lastVisibleRowBottom: number;
		lastVisibleRowInside: boolean;
		boundaryInGap: boolean;
		contentHeight: number;
		/** How much of the window is left below the stack's top edge. */
		room: number;
	} | null;
	/**
	 * Whether the driver's own probe text is painted in the TRANSCRIPT.
	 *
	 * This is the frame-by-frame half of the admission flip: the question is not
	 * only what the band showed but whether the band showed it OVER a painted
	 * message. The transcript is read by its own attribute rather than through
	 * the band, because the composer box legitimately holds the text until the
	 * identity flip and counting that as a painted row would answer a different
	 * question.
	 */
	transcriptPainted: boolean;
};

/**
 * The harness's own clock, and the one stamp every published reading carries.
 *
 * WHY A READING NEEDS ONE AT ALL. This screen is not one layout, it is a
 * sequence of them: the pane paints the splash before the chat column's
 * `ResizeObserver` has measured it (`chat-content.tsx` starts `isSmallView` at
 * `false` and sets it from a container measurement, so at the minimum window the
 * splash paints first and the small view takes over), and the composer relayouts
 * again when the session's readings row resolves its content. A reading taken
 * before either settles is an honest reading of a state that is NOT the one the
 * shutter photographs - and with no stamp on it, nothing in the published file
 * distinguishes it from a settled one. That is exactly what design round 5 read
 * out of the previous set's 800x572 and 830x572 rows: numbers contradicting the
 * pixels committed beside them, with no way to tell from the file which state
 * they described.
 *
 * So every read is stamped with when it was taken, and `settlement` below
 * publishes every DISTINCT layout this page has shown together with the span it
 * was observed over. "This number is of the settled state" becomes checkable
 * rather than assumed.
 */
const HARNESS_STARTED_AT = performance.now();

/** Milliseconds since the harness page mounted. */
const at = () => Math.round(performance.now() - HARNESS_STARTED_AT);

/**
 * How long a layout must be unchanged before this harness calls it settled.
 *
 * Six times the probe's own re-read interval, so a state that is still moving -
 * or that a late-arriving field is about to move - cannot be published as the
 * settled one. It is a LOWER bound on the true stability rather than a
 * measurement of it: a change is detected by the first read that observes it, so
 * `stableForMs` can only understate how long the layout has held.
 */
const SETTLE_WINDOW_MS = 3000;

/** A layout this page has shown, and the span of reads that observed it. */
type LayoutState = {
	/** The stamp of the reading that FIRST saw this layout. */
	at: number;
	/** The stamp of the last reading that still saw it. */
	lastSeenAt: number;
	reads: number;
	/** The chat column's own width - the measurement `isSmallView` is taken from. */
	columnWidth: number | null;
	bandY: number | null;
	bandHeight: number | null;
	composerY: number | null;
	composerHeight: number | null;
	stackTop: number | null;
	stackHeight: number | null;
	greeting: number;
	skeleton: number;
	chipLabels: string[];
	rowsLaidOut: number | null;
	rowsInside: number | null;
	boundaryInGap: boolean | null;
	claims: LoadingClaims;
};

/**
 * What the probe publishes about WHEN each number was true.
 *
 * `states` is the whole point: a reader comparing a published row against a
 * committed frame can see that the reading describes the first state this page
 * held (a splash at a 520px column, say) or the settled one, and `settled` says
 * whether the LAST state had stopped moving before the reading that published
 * it. `noLoadingClaimInAnyState` is the strongest form of this set's one claim
 * that a single end-of-run read could not make: no layout this page ever showed
 * claimed to be loading, not merely the last one.
 */
type Settlement = {
	now: number;
	reads: number;
	layoutChanges: number;
	lastChangeAt: number | null;
	stableForMs: number;
	settleWindowMs: number;
	settled: boolean;
	noLoadingClaimInAnyState: boolean;
	states: LayoutState[];
	note: string;
};

/**
 * The fields that make a reading's LAYOUT, as opposed to its text or its store.
 *
 * Only what a reader of a frame could see: the box the band occupies, the
 * composer's own box, the stack's, and the three counts that decide whether the
 * splash is painted at all. A signature that moves is a layout change; the
 * `text` of a chip or the identity of a draft is not, and counting those would
 * report a settled screen as still settling.
 */
const layoutSignature = (frame: BandFrame): string =>
	[
		frame.boxes.band?.y ?? null,
		frame.boxes.band?.h ?? null,
		frame.boxes.composer?.y ?? null,
		frame.boxes.composer?.h ?? null,
		frame.stack?.top ?? null,
		frame.stack?.height ?? null,
		frame.greeting,
		frame.skeleton,
		frame.chips,
		frame.stack?.rowCount ?? null,
		frame.stack?.visibleRows ?? null,
		frame.stack?.boundaryInGap ?? null,
		frame.transcriptPainted,
	].join("|");

const stateOf = (frame: BandFrame, claims: LoadingClaims): LayoutState => ({
	at: frame.at,
	lastSeenAt: frame.at,
	reads: 1,
	columnWidth: frame.boxes.band?.w ?? null,
	bandY: frame.boxes.band?.y ?? null,
	bandHeight: frame.boxes.band?.h ?? null,
	composerY: frame.boxes.composer?.y ?? null,
	composerHeight: frame.boxes.composer?.h ?? null,
	stackTop: frame.stack?.top ?? null,
	stackHeight: frame.stack?.height ?? null,
	greeting: frame.greeting,
	skeleton: frame.skeleton,
	chipLabels: frame.chipLabels,
	rowsLaidOut: frame.stack?.rowCount ?? null,
	rowsInside: frame.stack?.visibleRows ?? null,
	boundaryInGap: frame.stack?.boundaryInGap ?? null,
	claims,
});

/** Nothing in this document claims to be loading. */
const claimsNothing = (claims: LoadingClaims) =>
	claims.placeholders === 0 &&
	claims.outsideBand === 0 &&
	claims.shimmerBars === 0 &&
	!claims.captionVisible;

/** The tracker itself: module state, read and written by the probe's own effect. */
const tracker = {
	reads: 0,
	layoutChanges: 0,
	lastChangeAt: null as number | null,
	lastSignature: null as string | null,
	states: [] as LayoutState[],
	/** Every layout seen so far, so `noLoadingClaimInAnyState` survives a late state. */
	claimSeen: false,
};

/**
 * Record ONE reading and answer what the page's settlement is, as of it.
 *
 * Called from the probe's own publish effect rather than from `readBand` itself,
 * because `readBand` runs during render in places and a tracker mutated during
 * render would count StrictMode's double render as two readings of one state.
 */
function observe(frame: BandFrame, claims: LoadingClaims): Settlement {
	const signature = layoutSignature(frame);
	tracker.reads += 1;
	if (signature === tracker.lastSignature) {
		const previous = tracker.states.at(-1);
		if (previous) {
			previous.reads += 1;
			previous.lastSeenAt = frame.at;
		}
	} else {
		if (tracker.lastSignature !== null) {
			tracker.layoutChanges += 1;
			tracker.lastChangeAt = frame.at;
		}
		tracker.lastSignature = signature;
		tracker.states.push(stateOf(frame, claims));
	}
	if (!claimsNothing(claims)) tracker.claimSeen = true;
	/*
	 * `lastChangeAt` is the stamp of the FIRST read that saw the current layout, so
	 * the span below is a lower bound: the layout may have been in place since
	 * just after the previous read. After the first read there is nothing to
	 * compare against, so stability is counted from the first read instead.
	 */
	const stableSince = tracker.lastChangeAt ?? tracker.states[0]?.at ?? frame.at;
	const stableForMs = Math.max(0, frame.at - stableSince);
	return {
		now: frame.at,
		reads: tracker.reads,
		layoutChanges: tracker.layoutChanges,
		lastChangeAt: tracker.lastChangeAt,
		stableForMs,
		settleWindowMs: SETTLE_WINDOW_MS,
		settled: stableForMs >= SETTLE_WINDOW_MS,
		noLoadingClaimInAnyState: !tracker.claimSeen,
		states: tracker.states.map((state) => ({ ...state })),
		note: "Every DISTINCT layout this page showed, with the span of readings that observed it. `at`/`lastSeenAt` are milliseconds since mount. `settled` means the reading that published this file was taken at least `settleWindowMs` after the last observed layout change, so it is not a pre-settlement snapshot; a state other than the last one is a TRANSIENT and is labelled by its own span.",
	};
}

/**
 * Read the band the way a reader of the frame reads it.
 *
 * The three counts are what the whole change turns on and none of them is
 * visible in a screenshot of a *broken* run — an empty band and a skeleton band
 * can look alike in a small frame — so they are read from the DOM instead:
 * `greeting` is the `h2` in the band, `skeleton` is the `<output
 * aria-label="Loading conversation">` the hydrating branch renders, and `chips`
 * is the buttons inside the suggestion row (`div.flex-wrap`, the only one in
 * the band).
 *
 * `boxes` is the geometry behind the pixels, which is the half a still cannot
 * carry: a skeleton that stands in the greeting's slot and a greeting that has
 * been pushed off the top of the band both look like "the band" in a frame, and
 * the band's own height is what says which happened. Rounded to a tenth of a
 * pixel — a sub-pixel difference between two runs of one state is not a claim.
 */
function readBand(): BandFrame {
	const band = document.querySelector<HTMLElement>("[data-lo-composer-band]");
	if (!band)
		return {
			at: at(),
			text: "<no band in the document>",
			greeting: 0,
			skeleton: 0,
			chips: 0,
			chipLabels: [],
			bandHeight: 0,
			boxes: {
				band: null,
				greeting: null,
				skeleton: null,
				chipRow: null,
				composer: null,
			},
			stack: null,
			transcriptPainted: false,
		};
	/*
	 * The chips are identified by their LABEL, not by a layout class.
	 *
	 * `message-input.tsx` samples `MAX_SUGGESTIONS` of
	 * `DEFAULT_MESSAGE_SUGGESTIONS` at random for the empty band (25 entries,
	 * seven shown), so the row cannot be counted by position, and a
	 * `div.flex-wrap` lookup is answered by whichever wrapper happens to carry
	 * that class - the first version of this probe counted six buttons out of a
	 * different row. The driver hands the list in
	 * (`window.__draftSplashChipList`, parsed from the product), and what is
	 * counted is the band's buttons whose own text is a member of it.
	 */
	const chipList = (window as unknown as { __draftSplashChipList?: string[] })
		.__draftSplashChipList;
	const chips = Array.isArray(chipList)
		? Array.from(band.querySelectorAll("button")).filter((button) =>
				chipList.includes((button.textContent ?? "").trim()),
			)
		: [];
	const composer = band.querySelector("form");
	/*
	 * The chip stack's geometry, which is what D1 turns on.
	 *
	 * `room` is the honest measure of what the stack has: the distance from its
	 * own top edge to the bottom of the visible column, which is the window's own
	 * bottom because the chat column is `h-full`. Measured from the WINDOW rather
	 * than from the band, because the band is exactly what overflows when this
	 * fails: its own box runs past the window and reading its bottom would report
	 * the space it claimed rather than the space the user has.
	 */
	const stack = (() => {
		const wrap = document.querySelector<HTMLElement>(
			"[data-lo-suggestion-stack]",
		);
		if (!wrap) return null;
		const wrapBox = wrap.getBoundingClientRect();
		const rows = new Map<number, ChipRow>();
		for (const chip of wrap.children) {
			const box = chip.getBoundingClientRect();
			const top = Math.round(box.top * 10) / 10;
			const bottom = Math.round(box.bottom * 10) / 10;
			const existing = rows.get(top);
			rows.set(top, {
				top,
				bottom: Math.max(bottom, existing?.bottom ?? bottom),
				chips: (existing?.chips ?? 0) + 1,
			});
		}
		const ordered = [...rows.values()].sort((a, b) => a.top - b.top);
		/*
		 * Visible vs laid out: the stack keeps every chip in the document and caps
		 * the box (see `suggestion-stack.ts`), so the rows below the cap still have
		 * boxes - they are simply outside the box that is painted. Reporting the last
		 * LAID OUT row as "inside the window" would call a cut stack contained, which
		 * is the reading this probe exists to be able to refuse.
		 */
		const visible = ordered.filter((row) => row.bottom <= wrapBox.bottom + 0.5);
		const firstClipped =
			ordered.find((row) => row.bottom > wrapBox.bottom + 0.5) ?? null;
		const contentBottom = ordered.at(-1)?.bottom ?? wrapBox.bottom;
		const lastVisibleBottom = visible.at(-1)?.bottom ?? wrapBox.top;
		return {
			top: Math.round(wrapBox.top * 10) / 10,
			bottom: Math.round(wrapBox.bottom * 10) / 10,
			height: Math.round(wrapBox.height * 10) / 10,
			clientHeight: wrap.clientHeight,
			scrollHeight: wrap.scrollHeight,
			scrollable: wrap.scrollHeight > wrap.clientHeight + 1,
			topEdgeInside: wrapBox.top >= 0,
			rows: ordered,
			rowCount: ordered.length,
			visibleRows: visible.length,
			lastVisibleRowBottom: Math.round(lastVisibleBottom * 10) / 10,
			lastVisibleRowInside: lastVisibleBottom <= window.innerHeight,
			/** Nothing is cut: the first row below the box starts at or below it. */
			boundaryInGap: firstClipped
				? firstClipped.top >= wrapBox.bottom - 1
				: true,
			contentHeight: Math.round((contentBottom - wrapBox.top) * 10) / 10,
			/** How much of the window is left below the stack's top edge. */
			room: Math.round((window.innerHeight - wrapBox.top) * 10) / 10,
		};
	})();
	return {
		at: at(),
		text: (band.innerText ?? "").replace(/\s+/g, " ").trim(),
		greeting: band.querySelectorAll("h2").length,
		skeleton: band.querySelectorAll('output[aria-label="Loading conversation"]')
			.length,
		chips: chips.length,
		chipLabels: chips.map((chip) => (chip.textContent ?? "").trim()),
		bandHeight: Math.round(band.getBoundingClientRect().height),
		boxes: {
			band: rect(band),
			greeting: rect(band.querySelector("h2")),
			skeleton: rect(
				band.querySelector('output[aria-label="Loading conversation"]'),
			),
			chipRow: rect(chips[0]?.parentElement ?? null),
			composer: rect(composer),
		},
		stack,
		transcriptPainted: (() => {
			const marker = (window as unknown as { __draftSplashMarker?: string })
				.__draftSplashMarker;
			const transcript = document.querySelector(
				"[data-lo-canonical-transcript]",
			);
			return Boolean(
				marker &&
					transcript &&
					(transcript as HTMLElement).innerText.includes(marker),
			);
		})(),
	};
}

/**
 * The band's own frames, recorded rather than sampled.
 *
 * The draft-to-session flip is the state where a still is least able to carry
 * the claim: the panel is unmounted and replaced by another one, so a reader
 * needs to know what the band showed BETWEEN the two settled states — a
 * one-frame greeting or a one-frame skeleton painted over the optimistic echo
 * would be invisible in any pair of stills. A `MutationObserver` over the whole
 * document (the band element itself is replaced, so it cannot be the target)
 * schedules ONE reading per animation frame while mutations keep arriving, and
 * the log is what the probe publishes.
 */
function useBandTrace(limit = 200) {
	const frames = useRef<BandFrame[]>([]);
	const total = useRef(0);
	const [, bump] = useState(0);

	useEffect(() => {
		let scheduled = false;
		const read = () => {
			scheduled = false;
			const frame = readBand();
			/* `readBand` stamps `at` off the harness clock, the one clock every
			 * published reading shares, so a trace frame and `bandNow` are directly
			 * comparable - which is what lets a reader place a state in the same
			 * timeline `settlement.states` publishes. */
			frames.current = [...frames.current, frame].slice(-limit);
			total.current += 1;
			bump((n) => n + 1);
		};
		const observer = new MutationObserver((records) => {
			/*
			 * The readback element is a mutation target too, and observing it would
			 * feed the log back into itself: every reading re-renders the probe,
			 * whose text is a DOM change, which schedules the next reading. That is
			 * a per-frame loop that never settles and a trace of its own output, so
			 * mutations that are ONLY the probe's are dropped. Everything else in the
			 * document still counts, which is what keeps a band that is unmounted
			 * and replaced (the identity flip) inside the trace.
			 */
			const onlyProbe = records.every((record) => {
				const node = record.target;
				const element =
					node.nodeType === Node.ELEMENT_NODE
						? (node as Element)
						: node.parentElement;
				return Boolean(element?.closest("#probe"));
			});
			if (onlyProbe) return;
			if (scheduled) return;
			scheduled = true;
			requestAnimationFrame(read);
		});
		/*
		 * Every mutation kind, because each of the three readings arrives by a
		 * different one: the greeting's `h2` is a childList insertion, the
		 * skeleton is too, and a chip count that changes without the row being
		 * re-inserted would be a characterData or attribute change.
		 */
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
		});
		read();
		return () => observer.disconnect();
	}, [limit]);

	return {
		frames: frames.current,
		total: total.current,
	};
}

/**
 * The session-less draft's own view, from the shipping hook.
 *
 * This is the SAME call the draft pane makes — `chat-page.tsx` calls
 * `useCanonicalSessionStream(sessionId, Boolean(sessionId))`, and on a New chat
 * `sessionId` is `undefined` — so the `hydrated` field below is the composer's
 * actual input rather than a re-derivation of it. Mounted here as well as
 * inside the panel because the panel's handle is not reachable from a driver.
 *
 * It opens NO transport: the hook returns before subscribing when there is no
 * session (`use-canonical-session.ts`, the `if (!sessionId || !enabled) return`
 * at the top of its effect), which is a property this harness relies on rather
 * than one it changes.
 */
function useDraftStreamView() {
	const view = useCanonicalSessionStream(undefined, false);
	return {
		hydrated: view.hydrated,
		/*
		 * The COMPOSED fact both readers take (the composer band as `isHydrating`, the
		 * transcript pane's hold directly). Published beside `hydrated` rather than
		 * instead of it, because the two disagree in exactly the state this set is
		 * about - a session-less draft is `hydrated: false` and owes no page - and a
		 * readback that could not show them disagreeing would not be evidence about
		 * which of them the screen followed.
		 */
		awaitingHydration: view.awaitingHydration,
		status: view.status,
		failed: view.failure !== null,
	};
}

/**
 * Every "still loading" claim in the DOCUMENT, not only in the band.
 *
 * The acceptance bar for the pane's repair is about the whole screen: on a fresh
 * New chat NOTHING may claim to be loading. The band's own counts cannot see the
 * pane's claim at all - the placeholder renders in the transcript region, outside
 * `[data-lo-composer-band]` - so a frame that showed the pane's
 * `Loading conversation…` above the band's greeting passed every assertion this
 * driver had, which is how the pair of contradictory claims survived capture.
 *
 * One count per kind of claim, because they are separable and each names a
 * different element: the placeholder is a single `<output>` (its three shimmer
 * bars and its caption are its own subtree, so its presence covers all three), a
 * shimmer bar is `.animate-pulse-visible` (`styles/index.css` owns the keyframe),
 * and the caption is read from the rendered text so a claim that is painted
 * `sr-only` or clipped does not count as visible.
 */
function readLoadingClaims(): LoadingClaims {
	const placeholders = Array.from(
		document.querySelectorAll('output[aria-label="Loading conversation"]'),
	);
	const band = document.querySelector("[data-lo-composer-band]");
	return {
		placeholders: placeholders.length,
		outsideBand: placeholders.filter(
			(element) => !(band?.contains(element) ?? false),
		).length,
		shimmerBars: document.querySelectorAll(".animate-pulse-visible").length,
		captionVisible: document.body.innerText.includes("Loading conversation"),
	};
}

function Probe() {
	const { frames, total } = useBandTrace();
	const draftView = useDraftStreamView();
	/*
	 * Re-render on a timer, so `#probe` is a reading of NOW rather than of the
	 * last time something this component happens to subscribe to changed.
	 *
	 * The staleness is not theoretical: the band mounts when the suggestion
	 * sample arrives, which is not one of the store slices below, so a driver
	 * reading `#probe` at an arbitrary moment could read "no band in the
	 * document" - and `loadingClaims` all zeros - off a page whose splash is
	 * painted. A zero claim count from a document that had not yet rendered the
	 * thing being counted is a vacuous reading, which is the one kind of
	 * evidence these frames must never carry. The render is of this component,
	 * which returns null, so nothing in the photographed surface depends on it.
	 */
	const [, tick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => tick((value) => value + 1), 500);
		return () => clearInterval(id);
	}, []);
	/*
	 * One selector per field, deliberately. A selector returning a fresh object
	 * makes every snapshot unequal and sends the store subscription into an
	 * infinite re-render (measured: `Maximum update depth exceeded`, and the page
	 * never paints) - so the multi-field read a human would write is the one
	 * shape this instrument cannot have.
	 */
	const activeDraftKey = useCanonicalSessionsStore(
		(state) => state.activeDraftKey,
	);
	const activeSessionId = useCanonicalSessionsStore(
		(state) => state.activeSessionId,
	);
	const pendingSessionId = useCanonicalSessionsStore(
		(state) => state.pendingSessionId,
	);
	const store = { activeDraftKey, activeSessionId, pendingSessionId };
	/*
	 * The probe's own reading and publish, in ONE effect that runs after every
	 * render.
	 *
	 * The read and the write are together because the settlement verdict has to be
	 * OF the reading that is published, not of a different one taken a half-second
	 * earlier: `observe` is handed the very frame and claim count the payload
	 * carries, so `settlement.states.at(-1)` and `bandNow` cannot describe
	 * different moments. That is the defect this pass exists to remove - design
	 * round 5 read the previous set's 830x572 and 800x572 rows as readings of a
	 * state the frames beside them did not show - and a probe that published a
	 * stamp from one read beside geometry from another would reintroduce it in a
	 * new spelling.
	 *
	 * Reading during render was also the older shape's own hazard: `readBand` and
	 * `readLoadingClaims` measure layout, and a measurement taken in render is not
	 * guaranteed to be of the frame React is about to commit. An effect runs after
	 * the commit, which is the moment these boxes are a reading of what is painted.
	 */
	useEffect(() => {
		const bandNow = readBand();
		const loadingClaims = readLoadingClaims();
		const payload = {
			href: window.location.href,
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			theme: document.documentElement.dataset.theme,
			harnessError:
				(window as unknown as { __HARNESS_ERROR__?: string })
					.__HARNESS_ERROR__ ?? null,
			store,
			bandNow,
			loadingClaims,
			draftStreamView: draftView,
			framesRead: total,
			frames: frames.map(({ at, ...rest }) => ({ at, ...rest })),
			settlement: observe(bandNow, loadingClaims),
		};
		/*
		 * Written into the document's own `<pre id="probe">`, NOT rendered here.
		 *
		 * That element sits outside `#root` on purpose, so the readback cannot take
		 * part in the chat surface's layout - which is one of the things these frames
		 * are read for - and it is a plain text target a driver reads with one CDP
		 * `Runtime.evaluate`. An effect rather than a render-time write because React
		 * owns the tree it renders and must not be mutated from it.
		 */
		const element = document.getElementById("probe");
		if (element) element.textContent = `${JSON.stringify(payload, null, 2)}\n`;
	});
	return null;
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			{/*
			 * `ThemeProvider` is the app's own; the chat surface reads MUI theme
			 * values in the files not yet ported to Tailwind, and without it those
			 * throw on first paint.
			 *
			 * `MemoryRouter` rather than the app's `HashRouter`: `ChatPage` reads
			 * `useParams`/`useNavigate`, and a memory router starts at a known route
			 * with no address bar to photograph and no way for a stray navigation to
			 * survive a reload into the next capture.
			 */}
			<ThemeProvider>
				<MemoryRouter initialEntries={["/chat"]}>
					<ChatPage />
					<Probe />
				</MemoryRouter>
			</ThemeProvider>
		</QueryClientProvider>
	</StrictMode>,
);
