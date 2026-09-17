/**
 * The one horizontal break in the message list.
 *
 * Two things used to want a rule across the conversation and only one of them
 * had it: `info` records ("Conversation started in the invoices workspace")
 * drew a flanked rule inline in `messages-view`, while the passage of time was
 * carried by printing a date under every single turn. Both are the same
 * gesture — "the thread pauses here" — so they are the same component, and the
 * per-ROW timestamps that used to repeat stay gone.
 *
 * THE CANONICAL TRANSCRIPT DOES NOT PAINT A DIVIDER AT ALL, and time on the
 * live surface is now stated per turn instead: this component is reached only
 * from `messages-view`, the legacy path with no canonical session, which the
 * shipped app cannot take (see the note in `message-item/index.tsx`). What the
 * live surface gained is `TurnTimestamp` — one stamp per user turn and one
 * inside a tool call the reader has opened — which is the operator's request
 * and not a return of the date-under-every-row this comment removed.
 *
 * The idiom is iMessage's and Slack's: a hairline through the column with a
 * short label sitting in it, at the smallest type step and the dimmest ink the
 * contract still measures. It carries no accent, no fill and no border box,
 * because it is the least important thing on screen that is nonetheless worth
 * reading once.
 */

import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";

export type ConversationDividerProps = {
	children: ReactNode;
	isSmallView?: boolean;
	className?: string;
};

export const ConversationDivider: FC<ConversationDividerProps> = ({
	children,
	isSmallView,
	className,
}) => (
	<div className={cn("flex items-center gap-3", className)}>
		<div className="h-px flex-1 bg-hairline" />
		<span
			className={cn(
				"max-w-[60%] truncate text-center text-ink-dim text-meta",
				isSmallView && "max-w-[75%]",
			)}
		>
			{children}
		</span>
		<div className="h-px flex-1 bg-hairline" />
	</div>
);
