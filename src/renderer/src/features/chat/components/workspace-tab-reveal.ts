// clientWidth/scrollWidth are integer CSS pixels, whereas tab edges and
// scrollLeft can be fractional. Do not chase subpixel rounding at a lane edge.
const EDGE_TOLERANCE = 0.5;

function measure(tab: HTMLElement | null) {
	const lane = tab?.parentElement;
	if (!tab?.isConnected || !lane?.clientWidth) return;
	const row = tab.getBoundingClientRect();
	// Below the combined minimum hit widths, the non-shrinking Close button
	// can project past the row's max-width. Include that edge in the fallback.
	const close = tab.lastElementChild?.getBoundingClientRect() ?? row;
	const origin = lane.getBoundingClientRect().left + lane.clientLeft;
	const width = lane.clientWidth;
	const offset = lane.scrollLeft;
	// Use content coordinates: the observer must not mistake either a user's
	// scrolling or our own animation for a layout change.
	return {
		lane,
		start: Math.min(row.left, close.left) - origin + offset,
		end: Math.max(row.right, close.right) - origin + offset,
		width,
		max: Math.max(0, lane.scrollWidth - width),
		rtl: getComputedStyle(lane).direction === "rtl",
	};
}

type Layout = NonNullable<ReturnType<typeof measure>>;

function layoutChanged(previous: Layout | undefined, next: Layout) {
	return (
		!previous ||
		previous.lane !== next.lane ||
		previous.rtl !== next.rtl ||
		previous.width !== next.width ||
		Math.abs(previous.start - next.start) > EDGE_TOLERANCE ||
		Math.abs(previous.end - next.end) > EDGE_TOLERANCE
	);
}

function nearestOffset({ lane, start, end, width, max, rtl }: Layout) {
	const offset = lane.scrollLeft;
	let wanted = offset;
	if (end - start > width + EDGE_TOLERANCE) {
		// The row normally fits by ellipsizing its title. Below even its control
		// widths, prefer the logical end (More/Close); don't alternate edges.
		wanted = rtl ? start : end - width;
	} else if (start < offset - EDGE_TOLERANCE) {
		wanted = start;
	} else if (end > offset + width + EDGE_TOLERANCE) {
		wanted = end - width;
	}
	// Chromium's RTL scroll origin is the right edge, with negative offsets.
	return Math.max(rtl ? -max : 0, Math.min(rtl ? 0 : max, wanted));
}

// Read Radix's current trigger state so an opener unmounted by a menu action
// cannot leave behind a lock waiting for an onOpenChange that never arrives.
const OPEN_MENU =
	'[data-workspace-tab][data-state="open"], [data-workspace-tab-more][data-state="open"], [data-workspace-more][data-state="open"]';

/** One selection intent per strip; only the active row's own lane may move. */
export function createWorkspaceTabReveal(strip: HTMLElement) {
	let target: HTMLElement | null = null;
	let lastLayout: Layout | undefined;
	let frame: number | undefined;
	let selection = false;
	let manual = false;
	let motion: HTMLElement | undefined;
	let followUp = false;
	let dragging = false;
	const pointers = new Set<number>();

	const cancelFrame = () => {
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
	};
	const stopMotion = () => {
		if (motion) {
			motion.scrollTo({ left: motion.scrollLeft, behavior: "instant" });
			motion = undefined;
		}
		followUp = false;
	};
	const schedule = () => {
		if (!target || manual || frame !== undefined) return;
		frame = requestAnimationFrame(() => {
			frame = undefined;
			const layout = measure(target);
			if (!layout) return;
			const changed = layoutChanged(lastLayout, layout);
			if (changed) lastLayout = layout;
			if (pointers.size || dragging || strip.querySelector(OPEN_MENU)) return;
			if (!selection && !changed && !followUp) return;
			selection = false;
			// Let native smooth scrolling settle before correcting a moving edge.
			// Streaming title/layout changes leave one follow-up, not a restart per
			// resize. A fresh selection can still cancel the motion immediately.
			if (motion) {
				followUp = true;
				return;
			}
			followUp = false;
			const { lane } = layout;
			const left = nearestOffset(layout);
			if (Math.abs(left - lane.scrollLeft) <= EDGE_TOLERANCE) return;
			const reduce = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;
			if (!reduce) motion = lane;
			// Unlike scrollIntoView this cannot move the transcript, page or other lane.
			lane.scrollTo({ left, behavior: reduce ? "instant" : "smooth" });
		});
	};

	const interrupt = () => {
		cancelFrame();
		stopMotion();
		selection = false;
	};
	const resume = () => {
		// Don't replay incidental layout changes that occurred under a held
		// pointer, menu or drag. An explicit selection made there is different.
		lastLayout = measure(target);
		if (selection) schedule();
	};
	const onPointerDown = (event: PointerEvent) => {
		pointers.add(event.pointerId);
		interrupt();
	};
	const onPointerEnd = (event: PointerEvent) => {
		if (pointers.delete(event.pointerId)) resume();
	};
	const onWheel = (event: WheelEvent) => {
		const lane = target?.parentElement;
		if (!event.deltaX && !(event.shiftKey && event.deltaY)) return;
		if (
			!lane?.contains(event.target as Node) ||
			lane.scrollWidth <= lane.clientWidth
		)
			return;
		// Wheel/trackpad scrolling claims this viewport until the person selects
		// again. A late ResizeObserver notification cannot snap it back.
		manual = true;
		interrupt();
	};
	const onDragStart = () => {
		dragging = true;
		interrupt();
	};
	const onDragEnd = () => {
		if (!dragging) return;
		dragging = false;
		pointers.clear(); // Native HTML drag cancels the initiating pointer.
		resume();
	};
	const onBlur = () => {
		if (!pointers.size && !dragging) return;
		pointers.clear();
		dragging = false;
		resume();
	};
	const onScrollEnd = (event: Event) => {
		if (!motion || event.target !== motion) return;
		motion = undefined;
		if (followUp) schedule();
	};

	// Capture on the real DOM strip (not React's portal event path) and release
	// at window scope: a pointer can end outside the lane where it began.
	const listeners = new AbortController();
	const capture = { capture: true, signal: listeners.signal };
	strip.addEventListener("pointerdown", onPointerDown, capture);
	strip.addEventListener("wheel", onWheel, { ...capture, passive: true });
	strip.addEventListener("dragstart", onDragStart, capture);
	strip.addEventListener("scrollend", onScrollEnd, capture);
	window.addEventListener("pointerup", onPointerEnd, capture);
	window.addEventListener("pointercancel", onPointerEnd, capture);
	window.addEventListener("dragend", onDragEnd, capture);
	// Element blur during the click's default focus change is not window blur.
	window.addEventListener("blur", onBlur, { signal: listeners.signal });

	return {
		select(tab: HTMLElement | null, reselect = false) {
			if (tab === target && !reselect) return;
			stopMotion();
			target = tab;
			lastLayout = undefined;
			manual = false;
			selection = tab !== null;
			schedule();
		},
		layoutChanged: schedule,
		menuChanged(open: boolean) {
			if (open) interrupt();
			else resume();
		},
		dispose() {
			listeners.abort();
			interrupt();
		},
	};
}
