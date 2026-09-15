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
import { QUOTE_TOOLKIT_ATTR, quoteText, selectionTextIn } from "./quote-model";

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
		const staged = quoteText(bodyText, selectionTextIn(turnRef.current));
		if (!staged) return;
		addReply(conversationId, { id: uuidv4(), text: staged });
		// The selection has been answered; leaving it lit over text that is now
		// also above the composer reads as two live selections.
		window.getSelection()?.removeAllRanges();
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
