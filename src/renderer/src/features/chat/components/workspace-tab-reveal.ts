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
	let pending: "selection" | "layout" | undefined;
	let manual = false;
	let motion: { lane: HTMLElement } | undefined;
	let dragging = false;
	const pointers = new Set<number>();

	const cancelFrame = () => {
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
	};
	const stopMotion = () => {
		const lane = motion?.lane;
		motion = undefined;
		if (lane) lane.scrollTo({ left: lane.scrollLeft, behavior: "instant" });
	};
	const schedule = () => {
		if (!target || manual || frame !== undefined) return;
		frame = requestAnimationFrame(() => {
			frame = undefined;
			const layout = measure(target);
			if (!layout) return;
			if (layoutChanged(lastLayout, layout)) {
				lastLayout = layout;
				pending ??= "layout";
			}
			// Geometry observed during a press or native animation is still
			// relevant. Keep one correction, measured again when the lane is free.
			if (
				!pending ||
				motion ||
				pointers.size ||
				dragging ||
				strip.querySelector(OPEN_MENU)
			)
				return;
			const isSelection = pending === "selection";
			pending = undefined;
			const { lane } = layout;
			// Native Tab focus can scroll another row into view without selecting
			// it. Do not steal that viewport for a late rename or interrupted move.
			const focused = document.activeElement;
			if (
				!isSelection &&
				focused?.matches(":focus-visible") &&
				lane.contains(focused) &&
				!target?.contains(focused)
			)
				return;
			const left = nearestOffset(layout);
			if (Math.abs(left - lane.scrollLeft) <= EDGE_TOLERANCE) return;
			const reduce = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;
			// Unlike scrollIntoView this cannot move the transcript, page or other lane.
			if (reduce) {
				lane.scrollTo({ left, behavior: "instant" });
				return;
			}
			const request = { lane };
			motion = request;
			// Bundled Chromium returns a promise, even for a zoom-rounded no-op
			// that emits no scrollend. TS's DOM types still say void; a host
			// without the promise must not indefinitely lock out the next reveal.
			const completion = lane.scrollTo({
				left,
				behavior: "smooth",
			}) as unknown as Promise<unknown> | undefined;
			const settle = () => {
				// Cancellation or a new selection can supersede this request in the
				// same lane before its native promise callback runs.
				if (motion !== request) return;
				motion = undefined;
				if (pending) schedule();
			};
			if (completion) void completion.then(settle, settle);
			else settle();
		});
	};

	const interrupt = () => {
		cancelFrame();
		if (motion) pending ??= "layout";
		stopMotion();
	};
	const onPointerDown = (event: PointerEvent) => {
		pointers.add(event.pointerId);
		interrupt();
	};
	const onPointerEnd = (event: PointerEvent) => {
		if (pointers.delete(event.pointerId)) schedule();
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
		pending = undefined;
	};
	const onDragStart = () => {
		dragging = true;
		interrupt();
	};
	const onDragEnd = () => {
		if (!dragging) return;
		dragging = false;
		pointers.clear(); // Native HTML drag cancels the initiating pointer.
		schedule();
	};
	const onBlur = () => {
		if (!pointers.size && !dragging) return;
		pointers.clear();
		dragging = false;
		schedule();
	};

	// Capture on the real DOM strip (not React's portal event path) and release
	// at window scope: a pointer can end outside the lane where it began.
	const listeners = new AbortController();
	const capture = { capture: true, signal: listeners.signal };
	strip.addEventListener("pointerdown", onPointerDown, capture);
	strip.addEventListener("wheel", onWheel, { ...capture, passive: true });
	strip.addEventListener("dragstart", onDragStart, capture);
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
			pending = tab ? "selection" : undefined;
			schedule();
		},
		layoutChanged: schedule,
		menuChanged(open: boolean) {
			if (open) interrupt();
			else schedule();
		},
		dispose() {
			listeners.abort();
			interrupt();
		},
	};
}
