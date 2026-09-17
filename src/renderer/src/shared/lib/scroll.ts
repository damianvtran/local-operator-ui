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
 * measurement already includes the region's current scroll position, and each
 * end of the result is held by a DIFFERENT guard rather than by one clamp.
 * `Math.max(0, …)` below holds the LOW end, so a target above the region's
 * content top assigns 0 rather than a negative `scrollTop` — a value no box can
 * hold. The HIGH end is left to the browser, which clamps at
 * `scrollHeight - clientHeight`; this helper cannot know that value, because the
 * region may still grow after the assignment.
 *
 * PRECONDITION: the region must be the target's containing scroll box, or an
 * ancestor of it. The arithmetic resolves the target's position against THIS
 * region's box, so a region that does not contain the target produces a number
 * with no meaning rather than a throw — the third call site this ever gets
 * should be checked against that rule first.
 *
 * Two `scrollIntoView` behaviours are deliberately not reproduced, and nothing
 * in this renderer uses either today (no `scroll-margin`, `scroll-padding`,
 * `scroll-mt` or `scroll-pt` anywhere in `src/`): `scroll-padding-top` on a
 * region and `scroll-margin-top` on a target, which `scrollIntoView({ block:
 * "start" })` honours and this helper ignores. If a sticky header ever appears
 * above a section a reveal targets, the offset here gains that padding term
 * rather than the call site going back to `scrollIntoView`.
 *
 * Adopted from PR #207 (`damianvtran/fix/reveal-view-shift`), which carried this
 * same function for the same three call sites. This branch adds two more
 * triggers for the defect — the composer's subagents and jobs chips — so the fix
 * could not wait for that PR, and duplicating the helper in a second place is
 * worse than landing it here. #207 landed second and imports THIS copy for the
 * run panel's reveal and the story sweep's own scroll rather than carrying a
 * second one under the same name.
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
