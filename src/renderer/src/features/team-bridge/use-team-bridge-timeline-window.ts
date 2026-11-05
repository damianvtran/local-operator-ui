import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { WindowEntry } from "./team-bridge-window";
import {
	type WindowAnchor,
	type WindowLayout,
	firstVisibleIndex,
	nearHistoryEdge,
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
}): {
	layout: WindowLayout;
	range: { start: number; end: number };
	spacers: { before: number; after: number };
} {
	const active = enabled && scrollRootRef !== undefined;
	const heights = useRef(new Map<string, number>());
	const anchor = useRef<WindowAnchor | null>(null);
	const previousLayout = useRef<WindowLayout | null>(null);
	const [measuredVersion, setMeasuredVersion] = useState(0);
	const [contentVersion, setContentVersion] = useState(0);
	const [scroll, setScroll] = useState({ top: 0, height: 0 });
	const viewport = useRef<HTMLElement | null>(null);

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
	const range = active
		? windowRange(layout, scroll.top, scroll.height)
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
		setScroll({ top: element.scrollTop, height: element.clientHeight });
		let frame = 0;
		const onScroll = () => {
			if (frame !== 0) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				const top = element.scrollTop;
				const height = element.clientHeight;
				setScroll({ top, height });
				anchor.current = windowAnchor(layoutRef.current, top);
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
						setScroll({ top: element.scrollTop, height: element.clientHeight }),
					);
		observer?.observe(element);
		return () => {
			element.removeEventListener("scroll", onScroll);
			observer?.disconnect();
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	}, [active, scrollRootRef, resetKey]);

	/*
	 * THE MEASURE PASS. Runs after every commit that could have changed what is
	 * mounted: the range, the rows, a content resize (a row's markdown finishing
	 * layout, an image arriving, a code block reflowing) or a previous measurement.
	 *
	 * A height that moved by less than a pixel is ignored: sub-pixel reflow
	 * between two passes would otherwise loop (measure -> spacer -> measure).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the triggers are the deps; the DOM is read directly.
	useLayoutEffect(() => {
		if (!active) return;
		const list = listRef.current;
		if (list === null) return;
		const markers = [...list.querySelectorAll<HTMLElement>(ITEM)];
		const spacer = list.querySelector<HTMLElement>(TRAILING);
		if (markers.length === 0 || spacer === null) return;
		let changed = false;
		for (let index = 0; index < markers.length; index += 1) {
			const key = markers[index].dataset.windowItem;
			if (key === undefined) continue;
			const top = markers[index].getBoundingClientRect().top;
			const next =
				index + 1 < markers.length
					? markers[index + 1].getBoundingClientRect().top
					: spacer.getBoundingClientRect().top;
			const height = Math.round(next - top);
			const current = heights.current.get(key);
			if (current !== undefined && Math.abs(current - height) < 1) continue;
			heights.current.set(key, height);
			changed = true;
		}
		if (changed) setMeasuredVersion((version) => version + 1);
	}, [
		active,
		listRef,
		rowSignature,
		range.start,
		range.end,
		measuredVersion,
		contentVersion,
	]);

	// The strip's own height is the cheapest signal that a mounted row changed
	// size without a scroll: the strip IS the sum of every row and spacer.
	useEffect(() => {
		if (!active) return;
		const list = listRef.current;
		if (list === null || typeof ResizeObserver === "undefined") return;
		let frame = 0;
		const observer = new ResizeObserver(() => {
			if (frame !== 0) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				setContentVersion((version) => version + 1);
			});
		});
		observer.observe(list);
		return () => {
			observer.disconnect();
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	}, [active, listRef]);

	/*
	 * THE CORRECTION. Every layout change - a measurement, a prepend, a trim -
	 * runs this before paint. `windowAnchorDelta` answers with `null` when the
	 * anchor is no longer in the strip (trimmed out, or the conversation
	 * changed); the position is then left ALONE on purpose: guessing there is how
	 * a prepend yanks a reader who had scrolled up.
	 */
	useLayoutEffect(() => {
		const previous = previousLayout.current;
		previousLayout.current = layout;
		const element = viewport.current;
		if (!active || element === null) return;
		if (previous === null || anchor.current === null) return;
		const delta = windowAnchorDelta(anchor.current, layout);
		if (delta === null) {
			anchor.current = null;
			return;
		}
		if (Math.abs(delta) < 1) return;
		element.scrollTop += delta;
		setScroll({ top: element.scrollTop, height: element.clientHeight });
		anchor.current = windowAnchor(layout, element.scrollTop);
	}, [active, layout]);

	return { layout, range, spacers };
}
