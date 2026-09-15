/**
 * The one place the "selectable text inside a summary" marker is spelled.
 *
 * Two components have to agree on it and neither can import the other: a row
 * writes the marker onto the parts of its summary that are text (`TraceLine`),
 * and the disclosure trigger reads it to decide whether a press landed on text
 * or on chrome (`Disclosure`). They meet here rather than at a string literal
 * because the failure mode of a divergence is silent and is a defect this
 * repository has already fixed once: a span written without the marker makes a
 * drag across it toggle the row and drop that span from the copy — round 3's
 * U7/U17, re-opened by a change nobody would think to test.
 *
 * So the attribute is a constant the writer and the reader both import, and
 * `scripts/tool-row.test.mjs` renders the real row and asserts the marker is
 * actually emitted, which is the property neither side can assert alone.
 */

/** The attribute that marks a summary's selectable text. */
export const TEXT_SURFACE_ATTR = "data-text-surface";

/**
 * The same marker as JSX spread props, for the row that writes it.
 *
 * A spread rather than a literal so the attribute name cannot be typed twice:
 * `value` is deliberately a string (React renders `data-*` attributes as given)
 * and the object is frozen because every row shares this exact value.
 */
export const TEXT_SURFACE_PROPS = Object.freeze({
	[TEXT_SURFACE_ATTR]: "true",
});
