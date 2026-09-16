/**
 * Where the floating Quote control sits for a highlight.
 *
 * Geometry, not styling, and separate from `quote-model.ts` because it is the
 * half of this affordance that has an answer in numbers: every rule below is a
 * pure function of boxes, so `scripts/message-quote.test.mjs` asserts the flip,
 * the clamps and the hide directly instead of reading them off a frame. What a
 * frame can show is that the numbers were computed from the right boxes; what
 * it cannot show is what happens at the row just above the fold.
 *
 * WHY THE HIGHLIGHT ANCHORS IT, RATHER THAN THE TURN. The control used to hang
 * off the turn's own top-right corner, which read as "quote this whole message"
 * - the operator's report, in his words: the strip "can look a bit out of
 * place and confusing" sitting beside a code block's own copy control, because
 * nothing on screen said the highlight was the target. It now floats
 * immediately above the highlight's own first line, at the highlight's own left
 * edge, which is his second ask: "hover above the highlighted frame and not at
 * the edge of the whole message block so that from a UX perspective we properly
 * broadcast that you're only quoting the selected section".
 *
 * WHY THE FIRST LINE OWNS THE ANCHOR AND THE FLIP. `Range.getClientRects`
 * answers one rect per line of a wrapped highlight, in document order, so
 * `lines[0]` is where the highlight BEGINS and the last is where it ends. The
 * control is placed against the first: its `left` is the reader's own start
 * point rather than the paragraph's left margin (the union box's left edge is
 * the line start, which would point at a line the reader did not begin on), and
 * "is there room above" is asked about that line, because that is the line the
 * control would cover. The flip is asked about the LAST, which is the line it
 * would cover on the other side - and both are boxes of the reader's highlight,
 * never of this control.
 *
 * FLIPPING PUTS IT BELOW THE LAST LINE, NOT BELOW THE FIRST, so it cannot land
 * on the text it is quoting - the failure mode of a naive flip is a control
 * sitting over the second line of the sentence it quotes.
 *
 * "THE LAST LINE" IS THE HIGHLIGHT'S LAST LINE, INCLUDING ANY PART OF IT THAT
 * LIES OUTSIDE THE TURN THAT OWNS THE CONTROL. Those are two different lines and
 * taking the wrong one is a real defect rather than a refinement: a drag that
 * leaves the owner turn highlights the next turn too, so a flip measured from the
 * owner turn's own end lands in the highlighted continuation below it. That is
 * what round 1 measured (code review M1, UX U9, QA Q27) - the control painted over
 * the reader's own selection, 128px and later 210px from anything the reader had
 * pointed at - and the caller's job is to hand in the boxes that answer the
 * question, which is why `quoteSelectionIn` reads them from the reader's own range
 * and not from the range it clipped for the text.
 *
 * THE ONE PLACE IT CAN STILL LAND ON THE TEXT IS THE CLAMP (code review round 1,
 * m2). A highlight taller than the pane puts `below` - the highlight's own last
 * line plus the gap - past the pane's floor, and the vertical clamp then pins the
 * control inside the pane, which is over the highlight. The clamp is what keeps
 * the press reachable there, and the alternative (hide the control whenever the
 * highlight is taller than its pane) takes the affordance away exactly when the
 * reader has selected the most; `scripts/message-quote.test.mjs` pins the
 * clamped position. So the rule this module holds is "never on the highlighted
 * text unless the highlight is taller than the pane, where the clamp wins".
 *
 * THE HIDE IS THE READER'S OWN OFFSET, NOT THE CONTROL'S. The control is
 * anchored to the line the highlight begins on, so once that line is off screen
 * there is nothing left for it to be about: it reports `null`, which the caller
 * renders as an absent control rather than a control pinned to a pane edge. It
 * comes back when the reader scrolls the highlight's own first line back into
 * view, which is why the check is here (a pure function of where things are)
 * and not in a one-way `hasScrolledAway` flag in the view.
 */

/**
 * The viewport boxes this module reasons about. All four numbers are client
 * coordinates, the space `getBoundingClientRect()` reports in, so every box
 * passed in has to come from that same source: mixing a scroll offset into one
 * of them is the way this arithmetic goes wrong silently.
 */
export type Box = {
	top: number;
	left: number;
	right: number;
	bottom: number;
};

/**
 * The clearance between the highlight and the control: 8px, the same gap the
 * legacy transcript's `TextSelectionControls` leaves over its own selection.
 * Two selection toolbars in one app floating at two different distances from
 * the text they act on is a difference a reader cannot attribute to anything.
 */
export const QUOTE_CONTROL_GAP = 8;

export type QuotePlacement = {
	/** Viewport coordinates of the control's own top-left corner. */
	top: number;
	left: number;
	/** Which side of the highlight it ended up on. */
	placement: "above" | "below";
};

export type QuoteAnchorInput = {
	/**
	 * The highlight's own client rects, one per line, in document order - the
	 * WHOLE highlight, and with no mounted control's own box among them, which is
	 * what `quoteSelectionIn` promises. A box this control produced would make
	 * the placement a function of its own output, and `last` is exactly the box
	 * that would be read back as the flip's anchor.
	 */
	lines: readonly Box[];
	/** The transcript scroller's client box. */
	container: Box;
	/** The window viewport. */
	viewport: Box;
	/** The control's own rendered size, measured from the control. */
	size: { width: number; height: number };
	/** Override for the 8px clearance; the tests pass 0 to keep arithmetic flat. */
	gap?: number;
};

/** The overlap of two boxes, or `null` when they do not meet. */
export function overlap(a: Box, b: Box): Box | null {
	const box: Box = {
		top: Math.max(a.top, b.top),
		left: Math.max(a.left, b.left),
		right: Math.min(a.right, b.right),
		bottom: Math.min(a.bottom, b.bottom),
	};
	return box.right > box.left && box.bottom > box.top ? box : null;
}

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the control goes for a highlight, in viewport coordinates, or `null`
 * when it should not be on screen at all.
 *
 * The bounds are the intersection of the scroller and the window, so the
 * control can never be clamped outside either one - the requirement stated as
 * two bounds is one bound, because the transcript's scroller is the thing that
 * can be scrolled and the window is the thing that can be resized.
 *
 * Both axes are clamped rather than only the horizontal one. A vertical clamp
 * looks redundant next to the flip, and it is not: `below` is measured from the
 * highlight's LAST line, so a highlight whose tail is under the fold - or whose
 * tail is in a turn further down the transcript - puts the flip's own position
 * off screen, and the clamp is what keeps the press reachable there. It is also
 * the one path on which the control can end up over highlighted text; the module
 * header says why that is the accepted trade.
 */
export function placeQuoteControl({
	lines,
	container,
	viewport,
	size,
	gap = QUOTE_CONTROL_GAP,
}: QuoteAnchorInput): QuotePlacement | null {
	if (lines.length === 0) return null;
	const limits = overlap(container, viewport);
	if (!limits) return null;
	const first = lines[0];
	const last = lines[lines.length - 1];
	/*
	 * The line the control is anchored to has to be on screen. Intersecting on
	 * the vertical axis alone is deliberate: a highlight that begins at the very
	 * left edge of a scrolled pane begins at a line whose horizontal overlap
	 * with the visible box is partial even though the reader can see it.
	 */
	if (first.bottom <= limits.top || first.top >= limits.bottom) return null;
	const above = first.top - gap - size.height >= limits.top;
	/*
	 * A degenerate limit - a pane shorter than the control - inverts the clamp
	 * range, and `Math.max` last pins the control to the visible top instead of
	 * producing a negative offset that would put it under the pane's own header.
	 */
	return {
		top: clamp(
			above ? first.top - gap - size.height : last.bottom + gap,
			limits.top,
			limits.bottom - size.height,
		),
		left: clamp(first.left, limits.left, limits.right - size.width),
		placement: above ? "above" : "below",
	};
}
