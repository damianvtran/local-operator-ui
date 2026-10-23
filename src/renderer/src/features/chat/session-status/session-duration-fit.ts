/**
 * The duration reading's fit, as arithmetic with the DOM taken out.
 *
 * WHY THIS MODULE EXISTS. The strip decides the reading's visibility from two
 * rectangles — the controls group's edge nearest the readings, and the last
 * visible non-duration reading's edge — plus the reading's own width. Keeping
 * that comparison inside the component made the DIRECTION case untestable
 * without a browser, and the direction case is exactly where the first
 * implementation was wrong: `dir="rtl"` (the shipped `ur` locale) mirrors the
 * row, so "the last reading" is the LEFTMOST one and the free gap is measured
 * to the controls' RIGHT edge. A physical rule (`controls.left − max(right)`)
 * hid the reading at every width in that locale while every LTR frame passed.
 * A pure function can be asked both directions at the boundary in a unit test.
 *
 * WHAT IT DOES NOT OWN. The DOM: which elements are readings, which is the
 * controls group, and which direction the strip resolved are the component's
 * reads. This module is only the two comparisons they feed.
 */

/**
 * The gap between readings, in CSS pixels — the strip's `gap-x-1`.
 *
 * ONE NUMBER, TWO SPELLINGS, AND THEY MUST STAY TWINS. The class draws the gap;
 * the reading's anchor (`insetInlineStart: calc(100% + READING_GAP)`) and the
 * fit comparison cross it. The class is the source of the visual fact and this
 * constant is the source of the arithmetic; `scripts/composer-readings.test.mjs`
 * pins this value to the `gap-x-1` token so the pair cannot drift silently.
 */
export const READING_GAP = 4;

/** The row's inline direction, as `getComputedStyle(...).direction` reports it. */
export type ReadingDirection = "ltr" | "rtl";

/**
 * The free gap between the controls group and the last visible non-duration
 * reading, in the row's inline direction.
 *
 * LTR: the readings flow rightwards, so the last one is the rightmost and the
 * gap runs from its right edge to the controls' left edge. RTL: the flow is
 * mirrored, so the last one is the leftmost and the gap runs from its left edge
 * to the controls' right edge.
 *
 * `lastEdge` is therefore the reading's INLINE-END edge — its `right` in LTR,
 * its `left` in RTL — and the caller is responsible for picking the extreme in
 * the same direction.
 */
export function inlineGap(
	direction: ReadingDirection,
	lastEdge: number,
	controlsLeft: number,
	controlsRight: number,
): number {
	return direction === "rtl"
		? lastEdge - controlsRight
		: controlsLeft - lastEdge;
}

/**
 * Whether the reading fits: the free gap must hold its own width plus the one
 * gap the anchor places it at. Strictly `>=`, so a row at exactly
 * `width + READING_GAP` shows the reading rather than flickering at the edge.
 */
export function durationFits(gap: number, durationWidth: number): boolean {
	return gap >= durationWidth + READING_GAP;
}
