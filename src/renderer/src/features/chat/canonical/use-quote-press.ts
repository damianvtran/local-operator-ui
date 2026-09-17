/**
 * The Quote press, once, for every control that offers one.
 *
 * Extracted from `quote-toolkit.tsx` when the transcript gained a second control
 * that can quote (the link toolbar's Quote, offered when the reader's highlight
 * lies inside one link), because the press is the half of this affordance with a
 * recorded history of defects and a second copy would re-derive them:
 *
 * - staging the quote and leaving focus on the button silently DISCARDED the
 *   reader's next keystrokes (measured: typing after a press left the textarea
 *   empty and the characters nowhere in the document);
 * - the same leftover focus turned Enter - which everywhere else in the composer
 *   means "send" - into a second press, staging a duplicate quote (measured:
 *   replies 1 -> 2);
 * - answering a press with the turn's whole words when the highlight only partly
 *   covered it staged a 132-character quote for a 5px overshoot (UX round 1, U3;
 *   QA round 1, Q3).
 *
 * A PRESS WITH NOTHING HIGHLIGHTED IS A CALLER'S DECISION, not this hook's. The
 * turn's own control is only ever raised by a highlight, so for it an empty
 * selection is a no-op and stays one. The LINK toolbar's Quote is offered on
 * hover as well (round 2, UX U4: the highlight-inside-a-link state is not
 * reachable with a mouse, so a Quote that waited for one was dead UI for a
 * pointer reader), and the link itself is what such a press quotes. That is the
 * `fallbackText` the link toolbar passes and the quote control does not, and it
 * is read at press time for the same reason the highlight is: the row re-renders
 * per delta, and the text that is staged has to be the text on screen when the
 * reader pressed.
 *
 * Every one of those is answered here, once, and every caller inherits the
 * answer rather than restating it. The alternative the operator's own rules
 * refuse is a second implementation of "what a Quote press does" that agrees
 * with this one until someone fixes only one of them (§ 9 of `docs/branding.md`).
 */

import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { focusComposer } from "../composer-field";
import { hasHighlight } from "../utils/link-actions";
import { quoteSelectionIn } from "./quote-model";

export function useQuotePress(
	conversationId: string,
	turnRef: { readonly current: HTMLElement | null },
	/**
	 * What a press stages when there is NO highlight, or `undefined` for a control
	 * whose press is only meaningful over one. Read lazily, like the highlight.
	 */
	fallbackText?: () => string | null,
): () => void {
	const addReply = useConversationInputStore((state) => state.addReply);

	return useCallback(() => {
		/*
		 * The highlight is read HERE, at the press, rather than carried from the
		 * render that raised the control: the control is only up because a
		 * highlight of this turn's exists, so re-reading cannot answer with
		 * another turn's words, and it is what makes a press after a second drag
		 * quote what is lit rather than what was lit when the control was placed.
		 * Nothing to quote is a no-op rather than a fallback, which is the
		 * boundary that used to widen a quote to the whole turn (code review
		 * round 2, MINOR 2; UX U8; QA Q8) - and that boundary is unchanged, because
		 * the fallback is a CALLER's answer (see this module's header) rather than
		 * this hook's second guess at "what did they mean".
		 */
		const selection = quoteSelectionIn(turnRef.current);
		/*
		 * The highlight when there is one, the caller's own text otherwise - and
		 * NOTHING when a highlight exists that this turn cannot quote. The last
		 * case is the old no-op, kept: a spanning highlight is the turn control's
		 * (or nobody's), and answering it with the link's own words would be the
		 * misattribution this file's history is about.
		 */
		const text =
			selection?.text ?? (hasHighlight() ? null : (fallbackText?.() ?? null));
		if (!text) return;
		addReply(conversationId, { id: uuidv4(), text });
		// The highlight has been answered; leaving it lit over text that is now
		// also above the composer reads as two live selections.
		window.getSelection()?.removeAllRanges();
		/*
		 * THE PRESS HANDS THE CARET BACK (design round 1, D2; UX round 1, U1; QA
		 * round 1, Q1).
		 *
		 * Staging a quote is the moment the reader has committed to writing the
		 * message it belongs to, and focus left on this button is not neutral:
		 * see this module's header for the two things it broke. Slack and Linear
		 * return focus to the composer for the same reason. The hand-off is the
		 * composer's own `focusInput` (through `composer-field`) rather than a
		 * `.focus()` here, so the "the user took the box" flag the ask gate reads
		 * is cleared by the one function that owns it.
		 */
		focusComposer();
	}, [addReply, conversationId, turnRef, fallbackText]);
}
