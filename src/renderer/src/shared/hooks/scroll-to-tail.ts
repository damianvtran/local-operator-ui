/**
 * The "take me to the newest row" motion: what a send (and the jump-to-latest
 * chip) does to a reader who is scrolled up.
 *
 * WHY THIS EXISTS (operator report, 2026-11-23: "after sending a message, the
 * chat doesn't always automatically smoothly scroll down"). Two defects stacked:
 *
 * 1. An echoed send never scrolled at all. `useMessageInput` skipped its
 *    post-send scroll whenever the optimistic echo painted - the normal case -
 *    on the theory that the transcript's follow policy had already handled it.
 *    That policy only follows a reader who is ALREADY at the tail, so a
 *    scrolled-up sender stayed where they were with their message off-screen.
 * 2. The fallback used `scrollTo({ behavior: "smooth" })`, whose duration the
 *    browser picks and which any layout change mid-flight (a streaming token, a
 *    paging correction) can cancel - the "doesn't always" half.
 *
 * So the motion is driven here, one `scrollTop` write per animation frame, with
 * a duration we choose. Everything below is written against a minimal element
 * shape and injected clocks so the node tests drive it without a DOM.
 *
 * AXIS. Every scroller this serves is `flex-col-reverse`: the tail (newest row)
 * is `scrollTop === 0` and reading back in history makes `scrollTop` negative.
 * The target is therefore the constant 0 and is re-asserted on every frame, so
 * content growing at the tail during the flight (a streaming answer) cannot
 * strand the motion short of it - growth at the tail does not move 0.
 */

/**
 * Duration model: `clamp(BASE + K * sqrt(distancePx), MIN, MAX)`.
 *
 * Sublinear on purpose. The operator asked for "faster if farther up": a
 * linear model would make a far reader wait proportionally longer, and a fixed
 * duration would make a short hop feel like a lurch. Square-root growth gives
 * the far reader a much higher effective speed while keeping every flight under
 * MAX. Sample points (derived from the formula):
 *
 *   distance   raw ms   clamped   effective speed
 *     100 px    180       180       0.6 px/ms
 *     400 px    240       240       1.7 px/ms
 *    2500 px    420       420       6.0 px/ms
 *   10000 px    720       600      16.7 px/ms
 *
 * MIN keeps a short hop visible as motion rather than a flicker; MAX keeps a
 * send from feeling sluggish however deep the reader was (600 ms is the upper
 * end of what reads as a UI transition rather than a wait).
 */
export const TAIL_SCROLL_BASE_MS = 120;
export const TAIL_SCROLL_K_MS = 6;
export const TAIL_SCROLL_MIN_MS = 180;
export const TAIL_SCROLL_MAX_MS = 600;

/**
 * At or below this distance the reader is snapped rather than animated.
 *
 * Matches the transcript's follow epsilon (`TAIL_EPS_PX`, 24px, in
 * `canonical/scroll-paging.ts`) by value: inside it the reader already counts as
 * following, so an animation would be an imperceptible 180 ms crawl. The snap
 * still matters, because the layout coordinator pins only an EXACT
 * `scrollTop === 0` (`followingLayout` in `use-scroll-paging.ts`); a reader
 * left at -10px would be following for the chip but not for the pin.
 * Not imported, to keep this shared module free of a feature dependency; the
 * node test pins the two values equal.
 */
export const TAIL_SNAP_PX = 24;

/** Flight time for a reader `distancePx` above the tail; 0 means no motion. */
export function tailScrollDurationMs(distancePx: number): number {
	if (!(distancePx > 0)) return 0;
	const raw = TAIL_SCROLL_BASE_MS + TAIL_SCROLL_K_MS * Math.sqrt(distancePx);
	return Math.min(TAIL_SCROLL_MAX_MS, Math.max(TAIL_SCROLL_MIN_MS, raw));
}

/**
 * Ease-out cubic: fast departure, gentle landing. The reader's eye is on the
 * destination (their own message), so the motion spends its time arriving
 * rather than leaving. Clamped so a late frame past the duration lands at 1.
 */
export function easeOutCubic(t: number): number {
	const x = Math.min(1, Math.max(0, t));
	return 1 - (1 - x) ** 3;
}

/** The offset `elapsedMs` into a flight from `start` to the tail (0). */
export function tailOffsetAt(
	start: number,
	elapsedMs: number,
	durationMs: number,
): number {
	if (durationMs <= 0 || elapsedMs >= durationMs) return 0;
	return start * (1 - easeOutCubic(elapsedMs / durationMs));
}

export type TailScrollPlan = "none" | "snap" | "animate";

/**
 * What a request to reach the tail does from `scrollTop`.
 *
 * - `none`: already exactly at the tail; writing would only emit a scroll event.
 * - `snap`: within `TAIL_SNAP_PX`, or the OS asked for reduced motion - the
 *   preference outranks the animation entirely, so the reader still lands at
 *   the tail, instantly.
 * - `animate`: everything else.
 */
export function planTailScroll(
	scrollTop: number,
	reducedMotion: boolean,
): TailScrollPlan {
	const distance = Math.abs(scrollTop);
	if (distance < 0.5) return "none";
	if (reducedMotion || distance <= TAIL_SNAP_PX) return "snap";
	return "animate";
}

/* ------------------------------------------------------------------------ */
/* Own-write acknowledgement                                                  */
/* ------------------------------------------------------------------------ */

/**
 * The transcript's paging hook, as seen by a writer that does not own it.
 *
 * WHY A REGISTRY. The scroller is owned by the page (`useScrollToBottom`), but
 * the hook that interprets its `scroll` events (`useScrollPaging`) lives three
 * components down inside the transcript. Its `onScroll` cannot tell a writer
 * from a reader, so an unacknowledged animation frame landing inside its drag
 * window would be recorded as the reader dragging and could arm paging. The
 * hook already exposes `acknowledgeOwnWrite` for exactly this (the press-anchor
 * correction uses it); this registry lets a writer elsewhere reach it keyed by
 * the element itself, without threading a callback up through the tree.
 * A `WeakMap` so an unmounted scroller is never retained.
 *
 * `releaseHold` drops the standing reader-hold. The hold defends the place a
 * scrolled-up reader left; a send is that reader asking to leave it, and a
 * hold left armed would make the next streaming resize "correct" the flight
 * back toward where they were - visible as a one-frame jump mid-animation.
 *
 * `setFlight` brackets an animated flight. Releasing the hold once at takeoff
 * is not enough: the hook can RE-arm it mid-flight (a settle timer from the
 * reader's last scroll, a scroll event the browser's own anchoring shifted so
 * our claim did not match), and a re-armed hold corrects toward a mid-flight
 * position. The flag tells every hold path to stand down until the flight ends.
 */
export type ScrollerWriteSink = {
	acknowledge: (before: number, after: number) => void;
	releaseHold: () => void;
	setFlight?: (active: boolean) => void;
};

const sinks = new WeakMap<object, ScrollerWriteSink>();

/** Register `sink` for `el`; returns the unregister (only removes its own). */
export function registerScrollerWriteSink(
	el: object,
	sink: ScrollerWriteSink,
): () => void {
	sinks.set(el, sink);
	return () => {
		if (sinks.get(el) === sink) sinks.delete(el);
	};
}

/* ------------------------------------------------------------------------ */
/* The driver                                                                 */
/* ------------------------------------------------------------------------ */

/** The slice of an `HTMLElement` the driver touches. */
export type TailScrollTarget = {
	scrollTop: number;
	addEventListener: (
		type: string,
		listener: () => void,
		options?: AddEventListenerOptions,
	) => void;
	removeEventListener: (type: string, listener: () => void) => void;
};

export type TailScrollEnv = {
	raf: (cb: (time: number) => void) => number;
	caf: (handle: number) => void;
	now: () => number;
	reducedMotion: () => boolean;
};

export type TailScrollOutcome = "none" | "snapped" | "landed" | "cancelled";

/**
 * Gestures that mean "the reader has taken the scroller back".
 *
 * Listened for on the scroller only, and only for the flight's lifetime. These
 * are INPUT events, not `scroll`: a `scroll` event is also what our own frames
 * emit, so it cannot distinguish the reader. A scrollbar drag starts with
 * `pointerdown`; keyboard scrolling needs focus inside the scroller, so its
 * `keydown` reaches here; the composer (where Enter sent the message) is
 * outside the scroller and cannot cancel its own send's flight.
 */
const CANCEL_EVENTS = [
	"wheel",
	"touchstart",
	"pointerdown",
	"keydown",
] as const;

export const browserTailScrollEnv = (): TailScrollEnv => ({
	raf: (cb) => window.requestAnimationFrame(cb),
	caf: (handle) => window.cancelAnimationFrame(handle),
	now: () => performance.now(),
	reducedMotion: () =>
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
});

/**
 * Move `el` to the tail. Returns a cancel function (idempotent).
 *
 * `onSettle` fires exactly once with how the request ended, so the caller can
 * re-read chip state from the real position (a cancelled flight leaves the
 * reader wherever the gesture took them).
 */
export function scrollToTail(
	el: TailScrollTarget,
	env: TailScrollEnv,
	onSettle?: (outcome: TailScrollOutcome) => void,
): () => void {
	let settled = false;
	const settle = (outcome: TailScrollOutcome) => {
		if (settled) return;
		settled = true;
		onSettle?.(outcome);
	};
	/*
	 * Every write goes through the sink, looked up per write rather than once:
	 * the transcript can remount under a long flight, and a stale sink would
	 * acknowledge into a hook that no longer reads it.
	 */
	const write = (value: number, acknowledge = true) => {
		const before = el.scrollTop;
		el.scrollTop = value;
		if (acknowledge) sinks.get(el)?.acknowledge(before, el.scrollTop);
	};

	const plan = planTailScroll(el.scrollTop, env.reducedMotion());
	if (plan === "none") {
		settle("none");
		return () => {};
	}
	sinks.get(el)?.releaseHold();
	if (plan === "snap") {
		// One settled write, observed like the landing frame below (see there).
		write(0, false);
		settle("snapped");
		return () => {};
	}

	/*
	 * Start and duration are read on the FIRST frame, not here (QA round 1, Q-1):
	 * a send calls in at the echo's paint, and the browser's scroll anchoring then
	 * moves the reader one row (~110 px) farther from the tail as the echo is
	 * added. A start read now made the first visible step a jump of that row's
	 * height and timed the trip from the shorter distance.
	 */
	let start = 0;
	let duration = 0;
	let handle = 0;
	let t0: number | null = null;
	const stop = (outcome: TailScrollOutcome) => {
		if (settled) return;
		env.caf(handle);
		for (const type of CANCEL_EVENTS) el.removeEventListener(type, onInput);
		sinks.get(el)?.setFlight?.(false);
		settle(outcome);
	};
	const onInput = () => stop("cancelled");
	const frame = () => {
		if (settled) return;
		/*
		 * The clock starts at the FIRST frame, not at the call: the send's own
		 * commit (the echo painting) can hold the main thread for a frame or two,
		 * and starting earlier would spend part of a short flight invisibly.
		 */
		const now = env.now();
		if (t0 === null) {
			t0 = now;
			start = el.scrollTop;
			duration = tailScrollDurationMs(Math.abs(start));
		}
		const elapsed = now - t0;
		const landing = elapsed >= duration;
		/*
		 * The LANDING write is deliberately left unacknowledged. Mid-flight frames
		 * are claimed so the paging hook ignores them (positions the reader is
		 * passing through, not a place). The landing at 0 is a settled position the
		 * hook should observe like any other non-input motion: its observation path
		 * re-reads the tail state and schedules its pump, which can never arm an
		 * older-page fetch (only input can). Claiming it would leave the hook
		 * believing the reader is still wherever its last unclaimed event put them.
		 */
		write(tailOffsetAt(start, elapsed, duration), !landing);
		if (landing) {
			stop("landed");
			return;
		}
		handle = env.raf(frame);
	};
	sinks.get(el)?.setFlight?.(true);
	for (const type of CANCEL_EVENTS)
		el.addEventListener(type, onInput, { passive: true });
	handle = env.raf(frame);
	return () => stop("cancelled");
}
