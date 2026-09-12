/**
 * The row that every conversation turn sits in, and the thing that guarantees
 * a single left edge.
 *
 * Agent rows are laid out as one column indented by a fixed 40px gutter — the
 * avatar is absolutely positioned inside that gutter rather than being a flex
 * sibling. That is the whole reason the alignment holds: the avatar appears on
 * the first row of an agent turn only, and a flex layout would then indent
 * that row and no other. Trace lines, the question callout, the security
 * notice and the answer all take the same padding, so they share one edge
 * regardless of which of them opened the turn.
 *
 * Slack, Linear's activity feed and Zed's agent panel all do the same thing:
 * one avatar per block, everything under it on one rail.
 *
 * User rows carry no avatar at all. Right alignment plus the bubble already
 * says who is speaking, and a repeated portrait of the person reading the
 * screen is the clearest example of chrome that carries no information.
 *
 * ## Why the gutter is NOT simply removed (design rounds 1 and 2, D4)
 *
 * This 40px indent applies to EVERY agent-side row — prose, trace lines, the
 * question callout, the security notice and the tool rows alike — so it moves
 * them together and cannot put one register out of line with another. That is
 * the point of it, and it is why the gutter was never the cause of the
 * misalignment reported against this surface: the answer sat inboard of the
 * ledger because `markdown.css` capped and centred it INSIDE this padding,
 * not because of the padding. Removing the cap (see that file's measure
 * comment) put both registers on this gutter's inner edge, measured 102..962
 * for each at 1024x620.
 *
 * Deleting the gutter would not have fixed the alignment and would break the
 * avatar, which was measured rather than assumed: with `pl-10` removed and the
 * avatar still `absolute`, its box `[524..552]` lands on the first prose line,
 * which now also starts at 524. The probe that reports this was verified
 * against a positive control (shoving the avatar onto the text turns it red)
 * so its "no collision" at rest means something.
 *
 * The gutter therefore stays until the row is restructured so the avatar
 * occupies its own flex slot rather than an absolutely-positioned one. That is
 * a change to every agent row's box model with a real regression surface
 * (streaming rows, notices, tool rows, the small view), and nothing currently
 * reported requires it: the rail is shared, which is what the reader sees.
 */

import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";
import { MessageAvatar } from "./message-avatar";

/** Avatar 28px + 12px gap. Kept here so the two users of it cannot drift. */
export const AGENT_GUTTER = "pl-10";

export type MessageContainerProps = {
	isUser: boolean;
	children: ReactNode;
	isSmallView?: boolean;
	/** Renders the avatar in the gutter. True on the first row of an agent turn. */
	showAvatar?: boolean;
	className?: string;
};

export const MessageContainer: FC<MessageContainerProps> = ({
	isUser,
	children,
	isSmallView,
	showAvatar,
	className,
}) => {
	if (isUser) {
		return (
			<div className={cn("flex w-full justify-end", className)}>{children}</div>
		);
	}

	return (
		<div
			className={cn("relative w-full", !isSmallView && AGENT_GUTTER, className)}
		>
			{showAvatar && !isSmallView && (
				<MessageAvatar className="absolute top-0 left-0" />
			)}
			{children}
		</div>
	);
};
