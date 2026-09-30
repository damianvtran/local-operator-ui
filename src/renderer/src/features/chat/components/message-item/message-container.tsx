/**
 * The row that every conversation turn sits in, and the thing that guarantees
 * a single left edge.
 *
 * ## The agent gutter and its avatar are gone (D11)
 *
 * Agent rows used to be one column indented by a fixed 40px gutter with a robot
 * glyph absolutely positioned inside it, on the first row of an agent turn only.
 * Both are deleted: the transcript's row content box is the only left edge now.
 *
 * The glyph marked a boundary that carried no information - who is speaking is
 * already said by the register, because a user turn is a filled block and an
 * agent turn is prose on no ground at all (D2/D3) - and the gutter it justified
 * was a 40px indent that every agent-side row paid so that ONE absolutely
 * positioned 28px box could sit in it. The cost of deleting the gutter was
 * measured before it was removed, because the comment this replaces argued the
 * opposite: with `pl-10` gone the avatar's box would have landed on the first
 * prose line at 524. That is exactly the collision the deletion settles, by
 * deleting the avatar rather than by finding the avatar a flex slot.
 *
 * What stands in for the glyph: nothing. A turn boundary is 32px of air and the
 * two registers differ by ground and width (`transcript-rows.ts`'s `GAP.turn`
 * and `GAP.item`). This is the vocabulary every reference in the design board
 * uses - Cursor 3, Codex, Conductor, Zed, VS Code, JetBrains, Claude Code - and
 * it is what the redesign's §D1 states.
 *
 * User rows never had an avatar: right alignment plus the filled block already
 * says who is speaking, and a repeated portrait of the person reading the screen
 * is the clearest example of chrome that carries no information.
 */

import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";

export type MessageContainerProps = {
	isUser: boolean;
	children: ReactNode;
	isSmallView?: boolean;
	className?: string;
};

export const MessageContainer: FC<MessageContainerProps> = ({
	isUser,
	children,
	className,
}) => {
	if (isUser) {
		return (
			<div className={cn("flex w-full justify-end", className)}>{children}</div>
		);
	}

	return <div className={cn("relative w-full", className)}>{children}</div>;
};
