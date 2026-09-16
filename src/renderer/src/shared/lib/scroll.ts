/**
 * Move ONE scroll region, and move nothing else.
 *
 * `element.scrollIntoView()` is the obvious way to bring something into view and
 * it is the wrong tool for a surface that lives inside the app's frame. Its
 * default is `container: "all"`, so it walks every scrolling box in the ancestor
 * chain and scrolls each one that can move, aiming to put the target at the top
 * of the OUTERMOST box as well as of the nearest one. An `overflow: hidden` box
 * is not skipped either: it is still programmatically scrollable, and only
 * `overflow: clip` opts a box out of that walk.
 *
 * Measured in the built app, pressing the composer's plan chip at 1024x673 — the
 * window the operator reported this from — scrolled the chat column's slot row
 * (`div.relative.flex.h-full`, the row that holds the column and the run pane)
 * 108px sideways, and 221px at 800x600. The row has scrollable overflow at those
 * widths because the run pane does not fit beside the chat column, so the walk
 * had something to grab: the chat column, the transcript and the composer slid
 * under the sidebar. A pane may move its OWN reading position; it may not move
 * the frame around it.
 *
 * The offset is computed from RECTS rather than from `offsetTop`, which is
 * relative to the nearest POSITIONED ancestor — not the region on either call
 * site here — and a wrong reference point is a reveal that lands in the wrong
 * place rather than a throw. `clientTop` is subtracted because the region's rect
 * starts at its border box while its scroll origin is its padding box.
 *
 * Assigning `scrollTop` rather than adding to it keeps this idempotent: the
 * measurement already includes the region's current scroll position, and the
 * browser clamps the result to the region's own scrollable range.
 *
 * Adopted from PR #207 (`damianvtran/fix/reveal-view-shift`), which carried this
 * same function for the same three call sites and is still open and conflicting.
 * This branch adds two more triggers for the defect — the composer's subagents
 * and jobs chips — so the fix could not wait for that PR, and duplicating the
 * helper in a second place is worse than landing it here: if #207 lands first,
 * delete this file and import its copy, which is the same semantics under the
 * same name.
 */
export const scrollRegionToTop = (
	region: HTMLElement,
	target: HTMLElement,
): void => {
	const offset =
		region.scrollTop +
		target.getBoundingClientRect().top -
		region.getBoundingClientRect().top -
		region.clientTop;
	region.scrollTop = Math.max(0, offset);
};
