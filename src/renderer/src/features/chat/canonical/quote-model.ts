/**
 * Which transcript records can be quoted, and what text a quote from one
 * carries.
 *
 * Split out of the view for the same reason `transcript-rows.ts` is split out
 * of `canonical-transcript.tsx`: these are rules with a right answer, so they
 * are asserted directly (`scripts/message-quote.test.mjs`) rather than judged
 * from a frame. The frame proves the toolkit paints; these rules are what keep
 * it off a row that has nothing honest to quote.
 */

import type { Box } from "./quote-anchor";
import type { TranscriptRecord } from "./transcript-reducer";

/**
 * Marks the quote toolkit so a selection cannot be read as content.
 *
 * The control lives inside the turn it belongs to, which is also the element a
 * selection is tested against - so a reader who drags across the whole row
 * would otherwise hand `quoteSelectionIn` the word "Quote" as the thing to
 * quote. Checked here rather than by hiding the control from the selection,
 * because the button has to stay operable and readable to assistive
 * technology.
 */
export const QUOTE_TOOLKIT_ATTR = "data-lo-quote-toolkit";

/**
 * The record kinds that offer Quote.
 *
 * Prose only, and the boundary is the § 7 hierarchy rather than what happens to
 * carry a string. A `tool`, `notice`, `peer`, `wake`, `compaction` or `custom`
 * row is the machine-voice ledger: § 7 puts a completed action at one quiet
 * line and its output behind a disclosure, and quoting one would promote an
 * implementation detail to reading weight in the composer — which is the one
 * thing the hierarchy exists to prevent. Those rows also hold stdout, logs and
 * receipts, which are not the agent's words to the user and read as a mistake
 * once they are pasted into a reply.
 *
 * Written as a narrowing guard rather than a `Set` of kinds so the compiler
 * carries the same conclusion this comment states; a lookup table would let a
 * later reader reach `record.text` on a tool row having read a rule that only
 * claimed to exclude it.
 */
export function isQuotable(
	record: TranscriptRecord,
	bodyText: string,
): boolean {
	if (record.kind !== "user" && record.kind !== "assistant") return false;
	/*
	 * `bodyText` is the row's own text with any reply markup taken out, and this
	 * rule reads THAT rather than `record.text`. A turn whose whole text is
	 * `<reply-to>x</reply-to>` has a non-empty raw text and an EMPTY body, so
	 * gating on the raw text mounted a control whose press was a silent no-op:
	 * there is nothing under the pointer to highlight, and a control that can
	 * only be raised by a highlight it has no words for can never be raised
	 * (round 1, finding 5). The rule is "this row has words to offer", so it has
	 * to read the words that would be offered.
	 */
	if (bodyText.trim().length === 0) return false;
	if (record.kind !== "assistant") return true;
	/*
	 * A streaming assistant record is a prefix that the next token falsifies.
	 * The quote is staged IMMEDIATELY on press, so a row still receiving deltas
	 * would stage a snapshot of a sentence the agent had not finished - and the
	 * staged text is what the next send carries, so the reader would be
	 * answering a half-sentence they never saw completed. The toolkit therefore
	 * does not mount while the row streams and reappears on the settled row.
	 *
	 * The alternative - mount it, and quote the settled prefix - was rejected:
	 * neither the reader nor this file can tell "the model finished its thought"
	 * from "the model paused here", and a quote that is honest only by accident
	 * is worse than an affordance that arrives a moment later.
	 */
	return !record.streaming;
}

/** The toolkit ancestor of a selection endpoint, if it has one. */
const toolkitAncestor = (node: Node): Element | null => {
	const host =
		node.nodeType === Node.ELEMENT_NODE
			? (node as Element)
			: node.parentElement;
	return host?.closest(`[${QUOTE_TOOLKIT_ATTR}]`) ?? null;
};

const isElement = (node: Node): node is Element =>
	node.nodeType === Node.ELEMENT_NODE;

/**
 * Where this turn's own words end, as a `Range.setEnd` offset.
 *
 * NOT `childNodes.length`, and the difference is the whole of M1 (code review),
 * U9 (UX) and Q27 (QA) from round 1: the control is rendered inside the turn it
 * belongs to, so a clip to the turn's own end EXTENDS the range over the
 * control's box - the range then measures its own output, and the second
 * consumer of that range was the placement, which read it back as the last line
 * of the highlight. Ending at the control's own child keeps the range over the
 * turn's words and nothing else.
 *
 * The words are unaffected: the control renders an icon and no text node, so a
 * clip that stops short of it quotes exactly what a clip to the turn's end did.
 * This is the tripwire the `QUOTE_TOOLKIT_ATTR` comment above names, removed
 * rather than documented - a control that grows a label or a timestamp would
 * have joined the quote through this clip otherwise.
 */
const contentEnd = (element: HTMLElement): number => {
	const children = Array.from(element.childNodes);
	const control = children.findIndex(
		(child) => isElement(child) && child.hasAttribute(QUOTE_TOOLKIT_ATTR),
	);
	return control === -1 ? children.length : control;
};

/**
 * Whether two boxes are the same box, allowing for sub-pixel rounding.
 *
 * A range's box for an element IS that element's border box, and the two are
 * read through different APIs (`Range.getClientRects` against
 * `Element.getBoundingClientRect`), so exact equality would be a coin toss on a
 * fractional layout. The tolerance is under the smallest difference that can
 * mean anything here: a line is 14-17px tall and the control is 32, so no two
 * distinct boxes are within 0.5px of each other in every coordinate at once.
 */
const sameBox = (a: Box, b: Box): boolean =>
	Math.abs(a.top - b.top) < 0.5 &&
	Math.abs(a.left - b.left) < 0.5 &&
	Math.abs(a.right - b.right) < 0.5 &&
	Math.abs(a.bottom - b.bottom) < 0.5;

/**
 * The lines the control is placed against: the reader's highlight, and NOT the
 * control.
 *
 * Two rules, both learned the hard way, and they are one rule stated twice: the
 * placement must be a pure function of the highlight, so nothing it produces may
 * appear in its own input.
 *
 * 1. THE HIGHLIGHT'S OWN RANGE, not the clipped one. `quoteSelectionIn` returns
 *    a clipped range for the TEXT, because only this turn's words are quoted -
 *    but a drag that leaves this turn and ends in the next one has highlighted
 *    the next turn too, and the flip has to clear that part as well. Measured in
 *    round 1 (QA Q27): with the clipped range the control was placed below this
 *    turn's own last line, which is where the highlighted continuation
 *    begins - the control painted on the reader's own selection, the state
 *    `quote-anchor.ts` claimed was impossible.
 * 2. NO MOUNTED CONTROL'S BOX IS A LINE, which is what `QUOTE_TOOLKIT_ATTR` is
 *    for. An element inside the range contributes its own border box, so our
 *    shell - rendered inside the turn we are measuring - arrives as one of the
 *    highlight's boxes. It was last, so it became `lines[lines.length - 1]` and
 *    the flip placed the control below its OWN previous position: 40px down the
 *    pane per re-measuring event while the pointer was still down (QA measured
 *    `440 → 480 → 520 → 560 → 600 → 640`, UX `95.7 → 135.7 → 175.7`).
 *
 * The boxes are the range's own `getClientRects()` - one per line, in document
 * order - with the controls filtered out by geometry, because a `DOMRect` does
 * not say which node it came from. Filtering by BOX rather than by node is safe
 * in the direction that matters: it can only ever drop a box that is exactly a
 * mounted control's, and a control that exactly covers one of the highlight's
 * own lines is the failure this filters, not a line to keep.
 */
export const highlightLines = (range: Range): Box[] => {
	const controls = Array.from(
		document.querySelectorAll(`[${QUOTE_TOOLKIT_ATTR}]`),
		(node) => node.getBoundingClientRect(),
	);
	return Array.from(range.getClientRects())
		.filter((rect) => !controls.some((control) => sameBox(control, rect)))
		.map((rect) => ({
			top: rect.top,
			left: rect.left,
			right: rect.right,
			bottom: rect.bottom,
		}));
};

/**
 * The reader's highlight, as a quote of THIS turn: the part of the highlight
 * that lies in `element`, the LINES the control is placed against, and nothing
 * at all when this turn is not where the highlight begins.
 *
 * The two halves come from two different ranges on purpose, and the reason is
 * the round-1 defect (review M1, UX U9, QA Q27): the TEXT is this turn's part of
 * the highlight, because only this turn's words are quoted, while the GEOMETRY
 * has to describe the WHOLE highlight, because the control is placed against it
 * and a flip that clears only this turn's last line lands on the highlighted
 * continuation in the next turn. See `highlightLines`.
 *
 * ONE RULE WHERE THERE WERE THREE, and the reason is the affordance's own
 * trigger. It used to be raised by the row's hover, so a press had to answer
 * "what does a press with no selection mean", and that answer - the turn's own
 * words - dragged two more functions behind it to stop it widening:
 * `selectionTextIn` (a highlight wholly inside this turn), `selectionClippedTo`
 * (one that overshoots it, clipped) and `quoteText`'s `bodyText` fallback (no
 * highlight at all). Nothing raises the control without a highlight now, so the
 * no-highlight case has no press to answer: it is answered by there being no
 * control. The three collapse into this one function, and with them the
 * empty-clip boundary that code review round 2 (MINOR 2), UX round 2 (U8) and
 * QA round 2 (Q8) each landed on - a clip holding no character of this turn is
 * not a highlight of it, and raises nothing.
 *
 * WHY THE HIGHLIGHT HAS TO BEGIN HERE. One drag can touch two turns, and a
 * control mounted in each of them would be two controls claiming one highlight.
 * The START endpoint is what makes the owner unique: a range has exactly one,
 * and it lies in exactly one turn. The control therefore belongs to the turn
 * the reader began in - the turn the operator's second ask is about, the one
 * the highlight reads as belonging to - and that turn's own part of the
 * highlight is what it quotes.
 *
 * The END is deliberately NOT required to lie here. A drag that starts in this
 * turn and overshoots into the next one is the overshoot everyone makes
 * selecting to the end of a paragraph by hand, and clipping it to this turn can
 * only ever drop text the reader did not highlight in this turn. A start
 * OUTSIDE is the opposite case and answers `null` - that is the next turn's
 * control, or a row that has none.
 *
 * A ROW THAT HAS NONE IS A DELIBERATE NARROWING (code review round 1, m3). A
 * drag that BEGINS in a tool or ledger row - or in an answer that is still
 * streaming - and runs down into a settled answer highlights quotable prose and
 * raises nothing, because the owner is the turn the highlight begins in and a
 * ledger row mounts no control. The hover press this replaces used to answer
 * that case with the whole turn body, so this is a narrowing rather than a
 * regression, and it is recorded here rather than only in the PR thread: the
 * alternative is a fallback to "the first quotable turn the highlight reaches",
 * which would put a control on a turn the reader did not begin in and break the
 * one-control rule that the paragraph above exists for.
 *
 * Both endpoints are tested against the toolkit, for the reason the
 * `QUOTE_TOOLKIT_ATTR` comment above gives. It is defence in depth rather than
 * a live path today: a drag can only reach the control by starting on it, and a
 * start inside the toolkit is refused by the same guard. *
 * The text is trimmed and never truncated. The trim is not truncation - a
 * highlight's leading and trailing whitespace is not what the reader pointed at
 * - and the text is free of `<reply-to>` markup because it was read from the
 * DOM, where the markup was never text. There is no truncation anywhere on this
 * path on purpose: a quote is a claim about what was said, and a prefix of a
 * sentence silently presented as the whole of it is the failure this file
 * exists to avoid. The composer's own `ReplyPreview` truncates for DISPLAY,
 * which is a different thing from the text that is sent.
 *
 * `window` is read lazily rather than at module load so this file stays
 * importable by a node test, which is where its rules are asserted.
 */
/** What a highlight of this turn gives the control: the words, and the lines. */
export type QuoteHighlight = {
	/** This turn's part of the highlight, trimmed: what a press stages. */
	text: string;
	/** The whole highlight's own line boxes. See `highlightLines`. */
	lines: Box[];
};

export function quoteSelectionIn(
	element: HTMLElement | null,
): QuoteHighlight | null {
	if (!element) return null;
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return null;
	}
	const range = selection.getRangeAt(0);
	/*
	 * Both endpoints, not `range.commonAncestorContainer` (round 1, finding 3).
	 * A drag that starts in the prose and ends on the control has the TURN as
	 * its common ancestor, so testing the ancestor tested the one node that is
	 * guaranteed not to be inside the toolkit - and the control's visible text
	 * joined the quote, which is the case the `QUOTE_TOOLKIT_ATTR` doc comment
	 * above gives as the reason that attribute exists. Harmless while the
	 * control renders a lone `<Quote/>` glyph and no text node, and reachable
	 * the moment it carries a label or a timestamp, which is what the copy of
	 * this strip in `message-controls.tsx` already does.
	 */
	if (
		toolkitAncestor(range.startContainer) ||
		toolkitAncestor(range.endContainer)
	) {
		return null;
	}
	if (!element.contains(range.startContainer)) return null;
	const clipped = range.cloneRange();
	if (!element.contains(range.endContainer)) {
		clipped.setEnd(element, contentEnd(element));
	}
	const text = clipped.toString().trim();
	if (text.length === 0) return null;
	/*
	 * The GEOMETRY is taken from the reader's own range rather than from
	 * `clipped`, for the reason `highlightLines` gives: the clip narrows the
	 * TEXT to this turn, and the reader's highlight does not stop there.
	 */
	return { text, lines: highlightLines(range) };
}
