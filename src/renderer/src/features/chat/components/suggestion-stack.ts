/**
 * How tall the composer band's suggestion stack may grow before it outgrows the
 * pane it sits in (design round 1, D1).
 *
 * ## The defect this exists for
 *
 * The band deliberately carries no bound of its own (`message-input.tsx` says
 * why: a `max-height` or an `overflow` there erases the slash popup, which is
 * an unportaled `absolute bottom-full` child of the composer box and would be
 * clipped by any ancestor that establishes a vertical clipping context). Its
 * comment's rule is "cap whatever new content grows, where it grows" — and the
 * stack of suggestion chips is the only thing in the band that grows without a
 * bound of its own. On a New chat at the app's own minimum window height
 * (`WINDOW_MIN_HEIGHT = 600` -> a 572px CSS viewport) the greeting, the
 * composer box and seven wrapped chips made the band 528.5px tall inside a
 * 468px pane; the column's `overflow: hidden` then cut the last chip row
 * through its glyphs, with nothing to scroll.
 *
 * ## Why the cap is measured rather than stated
 *
 * A chip row is not a fixed height. A label long enough to wrap inside its own
 * chip makes its row taller than its neighbours (the chips are
 * `whitespace-normal break-words` on purpose: truncating a suggestion label
 * would make the band read as a request nobody wrote). So a cap in px cannot be
 * aligned to a row by construction, and a cap that lands mid-row is exactly the
 * defect being fixed — one row of glyphs sliced in half. The only thing that
 * knows where the rows are is the layout, so the cap is derived from it.
 *
 * ## The shape of the answer
 *
 * Given the chips' own boxes and the room the stack has, return the y (measured
 * from the stack's top edge) of the last row that fits ENTIRELY — or `null`
 * when the whole stack already fits. A stack capped at a row's bottom edge cuts
 * nothing: the next row begins one `gap-2` (8px) below that edge, so it is
 * wholly outside the clip rather than half inside it.
 *
 * Both inputs are the caller's to measure, and the caller is `message-input.tsx`
 * — see its layout effect for why the room is the band's own budget rather than
 * anything the stack can influence (which is what keeps this a single pass
 * instead of a layout feedback loop).
 */
export type SuggestionChipBox = {
	/** Viewport y of the chip's top edge. */
	top: number;
	/** Viewport y of the chip's bottom edge. */
	bottom: number;
};

export const suggestionStackCapFor = (
	chips: readonly SuggestionChipBox[],
	stackTop: number,
	allowance: number,
): number | null => {
	if (chips.length === 0) return null;

	/*
	 * Rows first: the chips are laid out by `flex-wrap`, so a row is the set of
	 * chips sharing a top edge, and its bottom is the lowest of theirs (they
	 * stretch to the tallest in the line).
	 */
	const rows = new Map<number, number>();
	for (const chip of chips) {
		const top = Math.round((chip.top - stackTop) * 10) / 10;
		const bottom = Math.round((chip.bottom - stackTop) * 10) / 10;
		rows.set(top, Math.max(bottom, rows.get(top) ?? bottom));
	}
	const bottoms = [...rows.values()].sort((a, b) => a - b);

	if (bottoms[bottoms.length - 1] <= allowance) return null;

	let cap = 0;
	for (const bottom of bottoms) {
		if (bottom <= allowance) cap = bottom;
	}
	/*
	 * The last row is kept even when it does not fit. A pane too short for one
	 * row of suggestions is a pane whose band is over its budget already (the
	 * greeting and the composer are above this), so dropping the stack would not
	 * save it — it would only trade a crowded band for a missing one, which is a
	 * larger claim than the constraint justifies.
	 */
	return cap > 0 ? cap : bottoms[0];
};
