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
