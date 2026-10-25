import type { TextDirection } from "../../../../../i18n/direction";

/** The physical move target, or null at that physical edge of the strip. */
export function physicalMoveTarget(
	index: number,
	count: number,
	side: "left" | "right",
	direction: TextDirection,
): number | null {
	const delta = (side === "left" ? -1 : 1) * (direction === "rtl" ? -1 : 1);
	const target = index + delta;
	return target >= 0 && target < count ? target : null;
}

/**
 * Physical overflow edges for Chromium's horizontal scroller.
 *
 * Browser tabs reorder with the writing direction, but scrolling remains a
 * physical operation. Chromium reports RTL `scrollLeft` from zero at the right
 * edge to negative `-(scrollWidth - clientWidth)` at the left edge; applying
 * the LTR inequalities there disables both controls or enables the wrong one.
 */
export function physicalScrollEdges(
	scrollLeft: number,
	clientWidth: number,
	scrollWidth: number,
	direction: TextDirection,
): { left: boolean; right: boolean } {
	if (direction === "rtl") {
		const maxScroll = Math.max(0, scrollWidth - clientWidth);
		return {
			left: scrollLeft > -maxScroll + 1,
			right: scrollLeft < -1,
		};
	}
	return {
		left: scrollLeft > 1,
		right: scrollLeft + clientWidth < scrollWidth - 1,
	};
}

/**
 * Whether a pointer is on the DOM-order "after" half of a tab.
 * DOM order runs right-to-left in RTL, so the physical comparison reverses.
 */
export function pointerIsAfterTab(
	clientX: number,
	midpoint: number,
	direction: TextDirection,
): boolean {
	return direction === "rtl" ? clientX < midpoint : clientX > midpoint;
}
