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
 * The strip lives inside the turn it belongs to, which is also the element a
 * selection is tested against - so a reader who drags across the whole row
 * would otherwise hand `selectionTextIn` the word "Quote" as the thing to
 * quote. Checked here rather than by hiding the strip from the selection,
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
	 * `bodyText` is the text the toolkit would actually stage - the row's own
	 * text with any reply markup taken out - and this rule reads THAT rather than
	 * `record.text`. A turn whose whole text is `<reply-to>x</reply-to>` has a
	 * non-empty raw text and an EMPTY body, so gating on the raw text mounted a
	 * control whose press was a silent no-op: `quoteText` answers `null` for an
	 * empty body, and `handleQuote` returns before staging anything (round 1,
	 * finding 5). The rule is "this row has words to offer", so it has to read
	 * the words that would be offered.
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
 * The reader's selection, when one lies inside `element` and is theirs.
 *
 * Returns `null` for a collapsed caret, for a selection that starts in one turn
 * and ends in another (a drag across rows is not a quote of either), and for one
 * with an end inside the toolkit.
 *
 * BOTH ends are tested, for the containment rule and for the toolkit rule: an
 * anchor inside this turn whose focus is in the next one would otherwise be
 * quoted as this turn's words, and the reader would watch a partial drag become
 * a quote of the wrong half.
 *
 * `document`/`window` are read lazily rather than at module load so this file
 * stays importable by a node test, which is where its rules are asserted.
 */
export function selectionTextIn(element: HTMLElement | null): string | null {
	if (!element) return null;
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return null;
	}
	const range = selection.getRangeAt(0);
	if (
		!element.contains(range.startContainer) ||
		!element.contains(range.endContainer)
	) {
		return null;
	}
	/*
	 * Both endpoints, not `range.commonAncestorContainer` (round 1, finding 3).
	 * A drag that starts in the prose and ends on the strip has the TURN as its
	 * common ancestor, so testing the ancestor tested the one node that is
	 * guaranteed not to be inside the toolkit - and the strip's visible text
	 * joined the quote, which is the case the `QUOTE_TOOLKIT_ATTR` doc comment
	 * above gives as the reason that attribute exists. Harmless while the strip
	 * renders a lone `<Quote/>` glyph and no text node, and reachable the moment
	 * it carries a label or a timestamp, which is what the copy of this strip in
	 * `message-controls.tsx` already does.
	 */
	if (
		toolkitAncestor(range.startContainer) ||
		toolkitAncestor(range.endContainer)
	) {
		return null;
	}
	const text = selection.toString().trim();
	return text.length > 0 ? text : null;
}

/**
 * The reader's selection CLIPPED to this turn, or `null` when none reaches it.
 *
 * This is the second half of the selection rule, and it exists because the two
 * ways `selectionTextIn` answers `null` are not the same thing. One is "the
 * reader made no selection", where quoting the turn's own words is the
 * documented fallback and is honest. The other is "the reader made a selection
 * I cannot attribute to this turn" - and the fallback answered THAT with the
 * turn's whole body, which is a silent WIDENING: the reader highlights 132
 * characters, the chip claims the entire turn, and the chip's one-line
 * truncation makes the two easy to tell apart only by someone who reads both
 * ends (UX round 1, U3; QA round 1, Q3, which measured exactly that: a real
 * drag released 5px below the turn staged the whole body).
 *
 * WHY A DRAG THAT LEAVES THE TURN IS CLIPPED RATHER THAN REFUSED. The reader
 * began the drag inside this turn and dragged past its end - the overshoot
 * everyone makes selecting to the end of a paragraph by hand. Refusing would
 * leave the press either a no-op or, worse, exactly the widening above, so the
 * honest reading is the part of the highlight that lies in this turn.
 *
 * A NON-EMPTY CLIP NARROWS AND NEVER WIDENS, which is the property this
 * function is written to hold. A range is ordered, so with one endpoint inside
 * and the other outside, the outside end is necessarily BEYOND the
 * corresponding edge of this turn: clamping it to that edge can only drop text
 * the reader did not highlight in this turn. Both endpoints inside is
 * `selectionTextIn`'s answer and answers `null` here rather than a second,
 * possibly divergent one; neither endpoint inside means the selection does not
 * reach this turn at all, where clipping would have to invent a boundary and
 * the caller's whole-turn fallback is right.
 *
 * THE EMPTY CLIP IS THE BOUNDARY WHERE THAT STOPS HOLDING, and this paragraph
 * exists because three round-2 streams read the sentence above as an absolute
 * and each found the exception (code review, MINOR 2; UX round 2, U8; QA round
 * 2, Q8, which reproduced it with a real drag). The clip is measured as a
 * RANGE, and a range whose in-turn part holds no characters is empty: a drag
 * that starts inside and releases on the turn's exact first character, or one
 * that begins in the whitespace past the last line's ink and never crosses it,
 * both leave `clipped.toString().trim()` at `""`. An empty clip is answered as
 * `null`, and `null` is also the answer for "no selection reaches this turn",
 * so the caller cannot tell the two apart and stages the turn's WHOLE BODY. The
 * reader therefore gets a LONGER quote than they highlighted - the widening U3
 * was filed for, narrowed to a character-exact boundary rather than removed.
 *
 * WHY THAT FALLBACK IS THE CHOSEN ONE RATHER THAN A REFUSAL. Refusing the
 * press means making the empty clip distinguishable at the call site (which
 * `quoteText` can no longer do, since it reads an empty string as "no
 * selection"), and it buys a silent no-op on a gesture that reads as a quote -
 * while the boundary it refuses on is not one a reader can aim at. The
 * zero-character clip needs the release, or the press anchor, to land on an
 * exact character boundary; a release inside the turn, below it, or spanning two
 * turns clips to the words that were actually highlighted and behaves (UX round
 * 2's boundary table; QA's boundary pair). What the reader sees is then the same
 * thing a press with nothing selected shows: the composer's chip paints the
 * turn's opening words truncated to one line, the sent block repeats it above
 * the body, and the whole text goes on the wire. A gesture that caught no ink of
 * this turn is, at this boundary, indistinguishable from one that selected
 * nothing in it, so it gets the turn's own words rather than nothing.
 *
 * The toolkit rule is refused here too, and for the same reason it is refused in
 * `selectionTextIn`: a drag ending on the strip is a drag to the strip, and
 * clamping its end to the turn's end would quietly turn that into a quote of
 * the prose the reader dragged away from.
 *
 * Consequence worth naming: a selection that spans two turns now quotes each
 * turn's own part of it rather than either whole turn. That is a narrowing of
 * the same defect, not a separate decision - a cross-turn drag was previously
 * answered with a whole turn the reader had not selected.
 */
export function selectionClippedTo(element: HTMLElement | null): string | null {
	if (!element) return null;
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return null;
	}
	const range = selection.getRangeAt(0);
	if (
		toolkitAncestor(range.startContainer) ||
		toolkitAncestor(range.endContainer)
	) {
		return null;
	}
	const startInside = element.contains(range.startContainer);
	const endInside = element.contains(range.endContainer);
	if (startInside === endInside) return null;
	const clipped = range.cloneRange();
	if (!startInside) clipped.setStart(element, 0);
	if (!endInside) clipped.setEnd(element, element.childNodes.length);
	/*
	 * An empty clip answers the SAME `null` as "no selection reaches this turn",
	 * so the caller's `??` chain passes it through and `quoteText` falls back to
	 * the whole body. That widening is deliberate and bounded - the doc comment
	 * above says why it is not refused - so it is stated here rather than left
	 * to be rediscovered as a bug in this line.
	 */
	const text = clipped.toString().trim();
	return text.length > 0 ? text : null;
}

/**
 * The text a quote from a turn carries, or `null` when there is none.
 *
 * There is no truncation here on purpose. A quote is a claim about what was
 * said, and a prefix of a sentence silently presented as the whole of it is the
 * failure mode this file exists to avoid; the composer's own `ReplyPreview`
 * truncates for DISPLAY, which is a different thing from the text that is sent.
 *
 * `selected` is the reader's own selection when one lies inside this turn, and
 * wins over the turn's whole text: they chose it, so it is the more specific
 * thing to quote. It arrives already trimmed and free of markup because it was
 * read from the DOM, where the markup was never text.
 *
 * The `bodyText` fallback is the turn's text with any `<reply-to>` markup
 * removed. Not a nicety: quoting a turn that was itself a reply would otherwise
 * nest the tags one level deeper on every quote of a quote, and `parseReplies`
 * is a non-greedy scan, so the nesting it eventually misreads is a reply
 * attributed to the wrong speaker. The markup is transport, and neither speaker
 * said it.
 */
export function quoteText(
	bodyText: string,
	selected: string | null,
): string | null {
	/*
	 * A selection that trims to nothing is not a selection. `selectionTextIn`
	 * already answers `null` for one, so this is the second half of one rule
	 * rather than a duplicate guard: it keeps the answer the same for a caller
	 * that hands the raw result of `window.getSelection().toString()` in
	 * without going through that function, where a whitespace-only drag would
	 * otherwise yield no quote at all instead of the turn's own words.
	 */
	const chosen = selected && selected.trim().length > 0 ? selected : bodyText;
	const text = chosen.trim();
	return text.length > 0 ? text : null;
}
