/**
 * The hover toolkit on a canonical transcript turn: Quote.
 *
 * One affordance, revealed on hover, pinned to the turn's top-right corner -
 * the same visual object as `message-controls.tsx`'s strip on the legacy
 * transcript, because two hover toolbars that look different is a defect rather
 * than a style choice. Copy and Speak deliberately do NOT ride along: both
 * already exist on `MessageControls`, and that component couples them to its own
 * timestamp in one strip. Reusing it here would drag the timestamp (out of scope
 * for this change) onto the canonical rows, and writing a second copy button
 * would be the second implementation § 9 of `docs/branding.md` refuses.
 *
 * Visibility is driven by the parent's `group`, like `message-controls`: the
 * strip stays at `opacity-0` until the row is hovered. The `group-focus-within`
 * twins are what make it reachable without a mouse - `opacity-0` is not
 * `visibility: hidden`, so the button keeps its place in the tab order, and
 * without a focus reveal a keyboard user would be tabbing into an invisible
 * control. `pointer-events-none` rides with the same two variants so the hidden
 * strip cannot swallow a click on the row beneath it.
 */

import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { Quote } from "lucide-react";
import type { FC } from "react";
import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { focusComposer } from "../composer-field";
import {
	QUOTE_TOOLKIT_ATTR,
	quoteText,
	selectionClippedTo,
	selectionTextIn,
} from "./quote-model";

type QuoteToolkitProps = {
	/**
	 * The conversation the staged quote is filed under.
	 *
	 * This MUST be the same identity the composer reads its replies by, or the
	 * quote is staged into a key nobody paints - which is why it is threaded from
	 * `chat-content.tsx` as that component's own local `conversationId` const, the
	 * same value it hands `MessageInput`, rather than derived here.
	 */
	conversationId: string;
	/** The turn's own text, already stripped of `<reply-to>` markup. */
	bodyText: string;
	/**
	 * The turn element a selection has to lie inside to count as a quote.
	 *
	 * Read-only rather than `RefObject<HTMLElement>`: the rows hold a
	 * `RefObject<HTMLDivElement>`, and `{ current: T }` is mutable, so a
	 * `RefObject` parameter would be invariant in `T` and no row's ref would be
	 * assignable to it. This type only ever reads `current`.
	 */
	turnRef: { readonly current: HTMLElement | null };
};

export const QuoteToolkit: FC<QuoteToolkitProps> = ({
	conversationId,
	bodyText,
	turnRef,
}) => {
	const addReply = useConversationInputStore((state) => state.addReply);

	const handleQuote = useCallback(() => {
		/*
		 * The selection is read through TWO rules, in this order, and the second is
		 * the one that keeps a press from widening the quote.
		 *
		 * `selectionTextIn` answers the reader's selection when it lies wholly inside
		 * this turn. When it answers nothing, the press used to fall straight
		 * through to the turn's OWN words - which is right when the reader made no
		 * selection, and is a silent widening when they made one this turn only
		 * partly contains: measured (UX round 1, U3) a drag released 5px below the
		 * turn highlighted 132 characters and staged the whole body. So a selection
		 * that exists but is not attributable is CLIPPED to this turn instead, and
		 * the whole-turn fallback is left to the case it was written for - no
		 * selection at all. See `selectionClippedTo`.
		 */
		const selection =
			selectionTextIn(turnRef.current) ?? selectionClippedTo(turnRef.current);
		const staged = quoteText(bodyText, selection);
		if (!staged) return;
		addReply(conversationId, { id: uuidv4(), text: staged });
		// The selection has been answered; leaving it lit over text that is now
		// also above the composer reads as two live selections.
		window.getSelection()?.removeAllRanges();
		/*
		 * THE PRESS HANDS THE CARET BACK (design round 1, D2; UX round 1, U1; QA
		 * round 1, Q1).
		 *
		 * Staging a quote is the moment the reader has committed to writing the
		 * message it belongs to, and focus left on this button is not neutral: it
		 * silently discarded the next keystrokes (measured: typing after a press left
		 * the textarea empty and the characters nowhere in the document) and turned
		 * Enter - which everywhere else in this composer means "send" - into a second
		 * press of this button, staging a duplicate quote (measured: replies 1 -> 2).
		 * A control that eats the reader's next words and then repeats itself on the
		 * key that sends is the defect, not the styling.
		 *
		 * Slack and Linear return focus to the composer for this same reason. The
		 * hand-off is the composer's own `focusInput` (through `composer-field`)
		 * rather than a `.focus()` here, so the "the user took the box" flag the ask
		 * gate reads is cleared by the one function that owns it.
		 */
		focusComposer();
	}, [addReply, bodyText, conversationId, turnRef]);

	return (
		<div
			{...{ [QUOTE_TOOLKIT_ATTR]: "" }}
			className={cn(
				// Slack's and Linear's hover toolbar: a small group pinned to the
				// turn's top-right corner rather than a strip reserved beside every
				// message, so nothing is reserved and the turn rhythm is unchanged
				// whether or not the toolkit is up. The `elevated` ground plus a
				// hairline is what makes it read as floating - § 2 keeps the one
				// shadow for objects that genuinely leave the flow.
				"absolute -top-2 right-0 z-10 flex h-8 items-center rounded-md border border-hairline bg-elevated px-1",
				"pointer-events-none opacity-0 transition-opacity duration-fast ease-out-quart",
				"group-hover:pointer-events-auto group-hover:opacity-100",
				"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
			)}
		>
			<Tooltip content="Quote" side="top">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Quote"
					className="text-ink-dim hover:bg-accent-wash hover:text-accent"
					onClick={handleQuote}
				>
					<Quote />
				</Button>
			</Tooltip>
		</div>
	);
};
