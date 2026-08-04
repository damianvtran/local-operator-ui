/**
 * The agent's mark at the head of a turn.
 *
 * 28px, not the 34/40 it was, and drawn once per turn rather than once per
 * message. At 40px repeated on every row it was the loudest thing in the
 * left column and the only element competing with the accent for attention;
 * at 28px on the first row of a turn it does the one job an avatar has here,
 * which is to mark where the agent started talking. Slack ships 36px because
 * a channel has many speakers to tell apart; this surface has exactly one.
 *
 * Quiet `sunken` ground and `ink-muted` glyph — the agent is not an accent
 * spend, the thing waiting on the user is. `rounded-full` is one of the three
 * places § 5 permits it.
 *
 * There is no user variant. See `message-container` for why.
 */

import { cn } from "@shared/lib/utils";
import { Bot } from "lucide-react";
import type { FC } from "react";

export type MessageAvatarProps = {
	className?: string;
};

export const MessageAvatar: FC<MessageAvatarProps> = ({ className }) => (
	<div
		className={cn(
			"flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-muted",
			className,
		)}
	>
		<Bot size={16} aria-label="Assistant" />
	</div>
);
