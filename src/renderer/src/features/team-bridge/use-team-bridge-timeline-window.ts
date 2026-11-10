import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { RefObject } from "react";
import type { WindowEntry } from "./team-bridge-window";
import {
	type StickyDay,
	type WindowAnchor,
	type WindowLayout,
	firstVisibleIndex,
	nearHistoryEdge,
	stickyDayAt,
	windowAnchor,
	windowAnchorDelta,
	windowLayout,
	windowRange,
	windowSpacers,
} from "./team-bridge-window";

/**
 * THE WINDOWED TIMELINE, THE PART THAT TOUCHES THE DOM.
 *
 * `team-bridge-window.ts` owns the arithmetic; this hook owns the three things
 * arithmetic cannot know: how tall a mounted row actually IS, where the scroll
 * viewport is, and what the scroll position must be corrected BY when history
 * lands above the reader.
 *
 * MEASURED BY POSITION, NOT BY BOX. The strip is a flex column whose rows carry
 * padding AND margins (`data-unread-divider` is `mt-3 mb-1`, an event line is
 * `py-1`), and flex items' vertical margins never collapse - so summing
 * `offsetHeight` would drift by a few pixels per row and the spacers would stop
 * matching the content. Instead each item's FIRST element is tagged
 * `data-window-item`, and one pass per commit records the DISTANCE between
 * consecutive tags (the last item is bounded by the trailing spacer's top).
 * Padding, margins and collapsed borders are inside that distance by
 * construction, whatever the row turns out to contain.
 *
 * THE ANCHOR IS AN ITEM, NOT A PIXEL COUNT. `scrollHeight` and `scrollTop` both
 * change when anything above the reader changes size; the item the reader is
 * looking at does not. So the anchor is `{key, offset}` - the topmost visible
 * item and its offset in the strip - captured on scroll and after every
 * correction, then re-applied in a LAYOUT effect (before paint) as the
 * difference between its old and new offsets, so the reader never sees the
 * intermediate position.
 *
 * THIS HOOK NEVER MOVES A READER WHO IS READING. It only restores the item they
 * were already looking at. Pinning to the newest message stays
 * `use-stick-to-bottom.ts`'s job: a prepend leaves the anchor where it was, and
 * a reader at the bottom is not dragged by anything here.
 *
 * OFF BY DEFAULT. The thread pane, the owner audit and every story mount the
 * list without a scroll root; only the Team Bridge page's timeline passes
 * `enabled`, and the caller's `onLoadOlder` is what makes the older-history
 * affordance live.
 */
const VIEWPORT = "[data-radix-scroll-area-viewport]";
const ITEM = "[data-window-item]";
const TRAILING = "[data-window-spacer='after']";

export function useTimelineWindow({
	entries,
	listRef,
	scrollRootRef,
	resetKey,
	hasOlder,
	loadingOlder,
	onLoadOlder,
	enabled = true,
	isPinned,
}: {
	entries: readonly WindowEntry[];
	/** The `<ol>` the strip renders into; the measure pass walks its rows. */
	listRef: RefObject<HTMLElement | null>;
	/** The ScrollArea ROOT. The viewport is found inside it the same way
	 * `use-stick-to-bottom.ts` finds it, so both hooks read one element. */
	scrollRootRef?: RefObject<HTMLElement | null>;
	resetKey: string;
	hasOlder: boolean;
	loadingOlder: boolean;
	onLoadOlder?: () => void;
	enabled?: boolean;
	/**
	 * The stick-to-bottom hook's decision, when the caller has one (the page's
	 * timeline does). ONE AUTHORITY: this hook used to keep its own `atBottom`,
	 * refreshed a frame AFTER each scroll, so a layout change landing between a
	 * reader's upward scroll and that frame snapped them back to the end - a
	 * second writer fighting the reader on top of the first. With `isPinned`
	 * given, the strip holds the bottom only while stick-to-bottom agrees the
	 * reader is still there, read at the moment of the correction.
	 */
	isPinned?: () => boolean;
}): {
	layout: WindowLayout;
	range: { start: number; end: number };
	spacers: { before: number; after: number };
	/**
	 * The day the floating pill shows, read from the scroll signal this hook
	 * already keeps - no second listener, so the pill and the window can never
	 * disagree about what is on screen.
	 */
	stickyDay: StickyDay | null;
} {
	const active = enabled && scrollRootRef !== undefined;
	const heights = useRef(new Map<string, number>());
	const anchor = useRef<(WindowAnchor & { atBottom: boolean }) | null>(null);
	const previousLayout = useRef<WindowLayout | null>(null);
	const [measuredVersion, setMeasuredVersion] = useState(0);
	const [scroll, setScroll] = useState({ top: 0, height: 0 });
	/* What is already in `scroll`, so a repeated observation of the same geometry
	   is not a state update. Without this, every scroll frame and every resize
	   notification re-renders the list even when nothing moved - which is the
	   shape of a feedback loop once anything else writes the scroll position. */
	const committed = useRef({ top: 0, height: 0 });
	const commitScroll = useCallback((top: number, height: number) => {
		if (committed.current.top === top && committed.current.height === height)
			return;
		committed.current = { top, height };
		setScroll({ top, height });
	}, []);
	const viewport = useRef<HTMLElement | null>(null);
	/*
	 * HAS ANYTHING MOVED THIS STRIP YET? Set SYNCHRONOUSLY in the scroll handler,
	 * never inside its rAF: the frame after a scroll can carry a layout change (a
	 * message arriving), and a rule that only learned about the scroll a frame
	 * later would pin a reader who has already scrolled straight back to the end.
	 */
	const scrolledSinceMount = useRef(false);
	/* The row count this mount was last pinned for, so the opening pin runs once per
	   shape of the strip instead of on every layout: re-pinning a strip whose rows
	   have not changed can oscillate against its own range (the pinned position
	   selects a different slice, which changes the height again). */
	const pinnedForRows = useRef(-1);

	/*
	 * A NEW CONVERSATION IS A NEW STRIP. Heights are keyed by row identity (the
	 * stored id, or an optimistic row's local key), so a stale map would never be
	 * WRONG - but it would grow with every
	 * conversation a session opens. Dropping it is also what lets the anchor go:
	 * a prepend in the previous conversation must not correct the next one.
	 */
	const [windowKey, setWindowKey] = useState(resetKey);
	if (windowKey !== resetKey) {
		setWindowKey(resetKey);
		heights.current = new Map();
		anchor.current = null;
		previousLayout.current = null;
		scrolledSinceMount.current = false;
		pinnedForRows.current = -1;
	}

	/*
	 * Keyed on the ROWS, not on the `entries` array: the entries are derived in
	 * the list's render, so a parent re-render that changed nothing about the
	 * history must not produce a new layout object - the correction effect keys on
	 * it, and a fresh object per render would re-apply a correction already
	 * applied.
	 */
	const rowSignature = useMemo(
		() => entries.map((entry) => entry.key).join("|"),
		[entries],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the height map is a ref and `measuredVersion` is its revision; `rowSignature` is `entries` by value, which is what the layout actually depends on.
	const layout = useMemo(
		() => windowLayout(entries, heights.current),
		[rowSignature, measuredVersion],
	);
	/*
	 * BEFORE THE VIEWPORT HAS BEEN OBSERVED, THE STRIP IS CUT AT ITS END (QA
	 * round 1, Q-2). A channel opens at the newest message, so the first slice is
	 * the LAST one: cutting from `scrollTop 0` instead mounts the oldest rows for
	 * one frame, and - because the spacers that stand in for the unmounted history
	 * are what the page's pin measures - it also made the pin land short. With the
	 * tail mounted, `scrollHeight` already describes the whole strip and
	 * `use-stick-to-bottom` puts the reader at the bottom in its first effect.
	 */
	const range = active
		? windowRange(
				layout,
				scroll.height === 0 ? layout.total : scroll.top,
				scroll.height,
			)
		: { start: 0, end: entries.length };
	const spacers = active
		? windowSpacers(layout, range)
		: { before: 0, after: 0 };

	// Live copies for the scroll handler: rebinding the listener on every layout
	// would drop scroll events during a page load, which is exactly when they matter.
	const layoutRef = useRef(layout);
	layoutRef.current = layout;
	const onLoadRef = useRef(onLoadOlder);
	onLoadRef.current = onLoadOlder;
	const hasOlderRef = useRef(hasOlder);
	hasOlderRef.current = hasOlder;
	const loadingRef = useRef(loadingOlder);
	loadingRef.current = loadingOlder;
	const isPinnedRef = useRef(isPinned);
	isPinnedRef.current = isPinned;

	/*
	 * THE VIEWPORT: found the same way the stick-to-bottom hook finds it, from the
	 * ScrollArea root the page owns. Position and height are state, not refs,
	 * because the window is a pure function of them.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: a conversation change can mount a new viewport.
	useEffect(() => {
		if (!active) return;
		const element =
			scrollRootRef?.current?.querySelector<HTMLElement>(VIEWPORT) ?? null;
		viewport.current = element;
		if (element === null) return;
		commitScroll(element.scrollTop, element.clientHeight);
		let frame = 0;
		const onScroll = () => {
			scrolledSinceMount.current = true;
			if (frame !== 0) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				const top = element.scrollTop;
				const height = element.clientHeight;
				commitScroll(top, height);
				anchor.current = paintAnchor(element, layoutRef.current, top);
				const load = onLoadRef.current;
				if (
					load !== undefined &&
					nearHistoryEdge({
						scrollTop: top,
						viewportHeight: height,
						firstVisible: firstVisibleIndex(layoutRef.current, top),
						hasOlder: hasOlderRef.current,
						loading: loadingRef.current,
					})
				)
					load();
			});
		};
		element.addEventListener("scroll", onScroll, { passive: true });
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() =>
						commitScroll(element.scrollTop, element.clientHeight),
					);
		observer?.observe(element);
		return () => {
			element.removeEventListener("scroll", onScroll);
			observer?.disconnect();
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	}, [active, commitScroll, scrollRootRef, resetKey]);

	/*
	 * THE MEASURE PASS. Runs after every commit, and again when the strip's own
	 * box changes (an image arriving, a code block reflowing, a disclosure
	 * opening). It reads a handful of rects and calls `setState` ONLY when a row's
	 * height actually moved by a pixel or more - which is what keeps it from being
	 * a render loop: a pass that measures what it measured last is a no-op.
	 *
	 * ONE MARKER PER ITEM, FIRST WINS (agent review round 1, m1). An item can
	 * paint two elements (the unread divider and the row it precedes), and both
	 * carry the item's key; keying the pass by `dataset.windowItem` alone let the
	 * later one overwrite the item's height, so the divider's ~20px was missing
	 * from `offsets` and the trailing spacer was sized from a total that no
	 * longer matched the DOM.
	 *
	 * A ZERO OR NEGATIVE MEASUREMENT IS IGNORED. A mounted row is never zero
	 * pixels tall; a zero means the browser has not laid it out yet (a hidden
	 * pane, a document still loading styles). Believing it would collapse the
	 * model to an empty strip and then rebuild it, which is a visible jump at
	 * best and a loop at worst.
	 */
	const measure = useCallback(() => {
		const list = listRef.current;
		if (list === null) return;
		const spacer = list.querySelector<HTMLElement>(TRAILING);
		if (spacer === null) return;
		/* The FIRST element of each item, in DOM order: an item may paint more than
		   one element (a divider and its row), and the height it contributes is the
		   distance from that first element to the next ITEM's first element. */
		const markers: HTMLElement[] = [];
		for (const marker of list.querySelectorAll<HTMLElement>(ITEM)) {
			if (markers.at(-1)?.dataset.windowItem === marker.dataset.windowItem)
				continue;
			markers.push(marker);
		}
		const spacerTop = spacer.getBoundingClientRect().top;
		let changed = false;
		for (let index = 0; index < markers.length; index += 1) {
			const key = markers[index].dataset.windowItem;
			if (key === undefined) continue;
			const top = markers[index].getBoundingClientRect().top;
			const next = markers[index + 1]?.getBoundingClientRect().top ?? spacerTop;
			const height = Math.round(next - top);
			/* A mounted row is never zero pixels tall: a zero means the browser has not
			 * laid it out yet, and believing it would collapse the model. */
			if (height <= 0) continue;
			const current = heights.current.get(key);
			if (current !== undefined && Math.abs(current - height) < 1) continue;
			heights.current.set(key, height);
			changed = true;
		}
		if (changed) setMeasuredVersion((version) => version + 1);
	}, [listRef]);

	/*
	 * MEASURED ON THE THINGS THAT CAN CHANGE WHAT IS MOUNTED, NEVER ON THE
	 * REVISION THIS PASS WRITES (QA round 1, Q-1). `measuredVersion` in this
	 * dependency list was the cycle: measure -> setState -> the effect re-runs
	 * because its own output changed -> measure again. The triggers are the rows,
	 * the mounted range and the strip's own box (below); a pass that measures what
	 * it measured last writes nothing, so it cannot ask itself to run.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the triggers are the rows and the range; the pass reads the DOM directly.
	useLayoutEffect(() => {
		if (!active) return;
		measure();
	}, [active, measure, rowSignature, range.start, range.end]);

	/* The strip's own box is the cheapest signal that a mounted row changed size
	 * without a scroll. The callback measures DIRECTLY (no state of its own):
	 * `measure` decides whether anything changed, so a resize cannot schedule a
	 * render that schedules a resize. */
	useEffect(() => {
		if (!active) return;
		const list = listRef.current;
		if (list === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => measure());
		observer.observe(list);
		return () => observer.disconnect();
	}, [active, listRef, measure]);

	/*
	 * THE CORRECTION. Every layout change - a measurement, a prepend, a trim -
	 * runs this before paint.
	 *
	 * A READER AT THE BOTTOM STAYS AT THE BOTTOM (QA round 1, Q-2). Measurement is
	 * not free of geometry: the last mounted rows' heights replace estimates, so
	 * the strip's total shrinks or grows after the page has already pinned to the
	 * newest message. Holding an ITEM there would move the reader a screenful off
	 * the bottom; holding the BOTTOM is what "opens at the newest message" means.
	 * So an anchor recorded at the bottom re-pins instead of applying a delta.
	 *
	 * A WRITE THAT CANNOT BE ABSORBED IS NOT MADE. If the browser would clamp
	 * `scrollTop`, writing anyway fires a scroll event, which re-cuts the window,
	 * which re-measures, which corrects again - a loop with the reader standing
	 * still. Comparing against the clamped target first makes the correction
	 * idempotent.
	 */
	useLayoutEffect(() => {
		const previous = previousLayout.current;
		previousLayout.current = layout;
		const element = viewport.current;
		if (!active || element === null) return;
		/* The RANGE is a trigger as well as the layout: mounting a new slice changes
		   the DOM's height with no layout change at all (a scroll), and a pinned
		   reader must survive that. An empty strip has nothing to correct. */
		if (range.end - range.start === 0) return;
		const max = Math.max(0, element.scrollHeight - element.clientHeight);
		/*
		 * NOTHING HAS MOVED THIS STRIP YET, SO IT BELONGS AT ITS END (QA round 1's
		 * r8 m1; agent review round 2, M4's neighbour). A mount pins against the rows
		 * its first frame carries; a row that arrives in the next commit - the
		 * optimistic send this conversation still holds, the slice growing as the
		 * first measurement replaces estimates - makes the strip taller with no scroll
		 * event, so there was nothing to correct against and the reader opened rows
		 * short of the newest message (measured: 8 rows, top 520, height 1160).
		 *
		 * THE FIRST SCROLL HANDS THE DECISION OVER FOR GOOD. It is recorded
		 * synchronously by the handler above, whoever causes it - the page's own pin,
		 * a restored position, the reader - and from then on the anchor (including
		 * its `atBottom`) is the authority. This is a layout effect, so it lands
		 * before paint and cannot race the frame that grows the strip.
		 */
		if (
			!scrolledSinceMount.current &&
			pinnedForRows.current !== entries.length
		) {
			pinnedForRows.current = entries.length;
			if (range.end !== entries.length || element.scrollTop === max) return;
			element.scrollTop = max;
			commitScroll(element.scrollTop, element.clientHeight);
			return;
		}
		if (previous === null || anchor.current === null) return;
		/* A VETO, not a second trigger: the strip still only holds the bottom it
		   recorded itself, but never once stick-to-bottom has seen the reader
		   leave (its decision is synchronous with the scroll; `atBottom` lags a
		   frame). Letting `isPinned` ADD snaps instead would write `max` where
		   the strip did not record an end, and a write that re-cuts the slice
		   can change `max` again - the oscillation the first-pin branch above
		   already guards against (measured: "Maximum update depth exceeded" in
		   the F9 timeline test). */
		const atBottom =
			anchor.current.atBottom && (isPinnedRef.current?.() ?? true);
		const target = atBottom
			? max
			: anchorDeltaTarget(element, layout, anchor.current, max);
		if (target === null) {
			anchor.current = null;
			return;
		}
		if (target === element.scrollTop) return;
		element.scrollTop = target;
		commitScroll(element.scrollTop, element.clientHeight);
		anchor.current = paintAnchor(element, layout, element.scrollTop);
	}, [active, commitScroll, entries.length, layout, range.start, range.end]);

	/* The pill's day is the first visible item's day (`stickyDayAt`), read from
	   the same `scroll` state the window is cut from. Off with the window: an
	   unwindowed list still has per-day sticky pills of its own. */
	const stickyDay = active ? stickyDayAt(entries, layout, scroll.top) : null;
	return { layout, range, spacers, stickyDay };
}

/** How close to the end counts as "at the bottom": a pixel, because a fractional
 * layout settles the last row's height a fraction at a time. */
const AT_BOTTOM_PX = 1;

/**
 * The anchor to restore after a layout change, with the one piece of state a
 * browser scroll position carries that an item offset cannot: whether the reader
 * was AT THE END. Without it, rows settling above the newest message would drag
 * a pinned reader upward row by row.
 */
function paintAnchor(
	element: HTMLElement,
	layout: WindowLayout,
	scrollTop: number,
): (WindowAnchor & { atBottom: boolean }) | null {
	const anchor = windowAnchor(layout, scrollTop);
	if (anchor === null) return null;
	return {
		...anchor,
		atBottom:
			element.scrollHeight - scrollTop - element.clientHeight <= AT_BOTTOM_PX,
	};
}

/** The clamped scroll target for an item anchor, or null when it left the strip. */
function anchorDeltaTarget(
	element: HTMLElement,
	layout: WindowLayout,
	anchor: WindowAnchor,
	max: number,
): number | null {
	const delta = windowAnchorDelta(anchor, layout);
	if (delta === null) return null;
	if (Math.abs(delta) < 1) return element.scrollTop;
	return Math.min(Math.max(element.scrollTop + delta, 0), max);
}
