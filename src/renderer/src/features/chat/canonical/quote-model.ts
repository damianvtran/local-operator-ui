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
export function isQuotable(record: TranscriptRecord): boolean {
	if (record.kind !== "user" && record.kind !== "assistant") return false;
	// A record whose text is whitespace paints an empty row under the same rule
	// `paintsSomething` applies, so the toolkit must not hang off it.
	if (record.text.trim().length === 0) return false;
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

/**
 * The reader's selection, when one lies inside `element` and is theirs.
 *
 * Returns `null` for a collapsed caret, for a selection that starts in one turn
 * and ends in another (a drag across rows is not a quote of either), and for one
 * that resolved to the toolkit itself.
 *
 * Both ends are tested rather than just the anchor: an anchor inside this turn
 * whose focus is in the next one would otherwise be quoted as this turn's words,
 * and the reader would watch a partial drag become a quote of the wrong half.
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
	const node = range.commonAncestorContainer;
	const host =
		node.nodeType === Node.ELEMENT_NODE
			? (node as Element)
			: node.parentElement;
	if (host?.closest(`[${QUOTE_TOOLKIT_ATTR}]`)) return null;
	const text = selection.toString().trim();
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
