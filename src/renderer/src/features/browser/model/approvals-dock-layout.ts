/**
 * Where the approvals dock stops being a side panel.
 *
 * The side-by-side layout is a flex row: the dock takes its 320px design width
 * and the page keeps the rest. At the browser pane's narrow widths that
 * arithmetic fails — the dock's old `max-w-[calc(100%-15rem)]` could shrink it
 * to 24px at a 264px pane, which is not a readable panel and is the D11/U17
 * failure this slice closes.
 *
 * At or below `APPROVALS_DOCK_FULL_WIDTH_MAX` the side layout cannot keep both
 * the 320px dock and the 240px page floor the design names (the design's own
 * threshold is "~520px", docs/design/browser-approval-ux.md §4.4). The dock then
 * takes the full width and stays IN FLOW: the content element shrinks to zero
 * rather than the dock overlaying it. That is a layout decision, not a
 * suppression: the page is displaced, and the panel is readable at the width it
 * is actually given.
 *
 * The numbers are exported so the surface, the static render and the real-app
 * measurement rig cannot drift from each other.
 */
export const APPROVALS_DOCK_FULL_WIDTH_MAX = 520;

/**
 * True when the available row width is at or below the full-width threshold.
 * Zero/unknown widths are not treated as narrow: a mount before the first
 * ResizeObserver report must not flash a full-width panel in a wide pane.
 */
export function approvalsDockFullWidth(availableWidth: number): boolean {
	return (
		Number.isFinite(availableWidth) &&
		availableWidth > 0 &&
		availableWidth <= APPROVALS_DOCK_FULL_WIDTH_MAX
	);
}

/**
 * The dock's width classes. `fullWidth` comes from the measured row, never
 * from a viewport media query: the browser pane can be narrow inside a wide
 * window, and the route is only one of the two hosts.
 */
export function approvalsDockClasses(fullWidth: boolean): string {
	return fullWidth
		? "w-full max-w-full"
		: "w-80 max-w-[calc(100%-15rem)] min-[1280px]:w-96";
}
