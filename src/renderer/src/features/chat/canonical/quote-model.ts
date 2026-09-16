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

/**
 * The reader's highlight, as a quote of THIS turn: the part of the highlight
 * that lies in `element`, the RANGE it was read from, and nothing at all when
 * this turn is not where the highlight begins.
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
 * Both endpoints are tested against the toolkit, for the reason the
 * `QUOTE_TOOLKIT_ATTR` comment above gives. It is defence in depth rather than
 * a live path today: a drag can only reach the control by starting on it, and a
 * start inside the toolkit is refused by the same guard.
 *
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
export function quoteSelectionIn(
	element: HTMLElement | null,
): { text: string; range: Range } | null {
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
		clipped.setEnd(element, element.childNodes.length);
	}
	const text = clipped.toString().trim();
	return text.length > 0 ? { text, range: clipped } : null;
}
