/**
 * The agent's picture at the head of a turn.
 *
 * WHAT CHANGED SINCE D11, and why the deletion was right then and is wrong now.
 * D11 deleted the agent glyph and the 40px gutter it was absolutely positioned
 * in, for a measured reason: every agent row paid that indent so ONE 28px box
 * could sit in it, the glyph repeated once per message, and the fact it marked -
 * "the agent is speaking" - was already carried by the register (a user turn is
 * a filled block, an agent turn is prose on no ground). The picture says
 * something the register CANNOT: WHICH agent this turn belongs to. So it is back,
 * under those constraints: drawn once per turn, as a line of its own above the
 * turn's first line (never beside it, so no row's text measure moves), and at
 * 20px rather than 28-40px, because a photograph is intrinsically louder than a
 * muted glyph and it must not become the loudest thing in the left column.
 *
 * NO PICTURE MEANS NO MARK. There is no placeholder here: the current look - no
 * mark at all - is D11's own answer for an agent without a picture, and a Bot
 * glyph per turn would be exactly the repetition D11 removed. `src` is
 * therefore required, and every caller renders this only when it has one.
 *
 * `rounded-full` is one of the three places § 5 permits it. THE EDGE IS THE
 * SHARED ONE (design review round 1, D1 on #1518): the same 1px `border-control`
 * boundary and `sunken` plate as the roster, the rail and the settings field,
 * on the circle's owner (`AgentAvatar`). It used to draw none, on the argument
 * that a picture is its own boundary - true only for pictures whose edge
 * contrasts with the transcript's ground; a photo whose edge matches it became
 * an invisible disc. The shared plate is the answer every other agent surface
 * already gives.
 *
 * The DESIGNER HAS NOT YET SEEN THE 20PX MARK WITH THE EDGE RENDERED. The
 * round-1 design pass could not produce a conversation in its rig, so the
 * boundary and the 24px rhythm there were unjudged; this change keeps the 20px
 * outer box and the `mb-1` line exactly, and the frame pass is what confirms
 * the edge reads as quiet at this size.
 */

import { AgentAvatar, AvatarImage } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

export type MessageAvatarProps = {
	/** The agent's stored picture. Always present; see the note above. */
	src: string;
	/**
	 * The speaking agent's name, for the image's accessible name.
	 *
	 * Empty or absent means the caller could not resolve one, and the mark is then
	 * DECORATIVE (`alt=""`): naming the role again would say nothing the row has
	 * not already said, and a made-up name would be worse than silence.
	 */
	name?: string | null;
	className?: string;
};

export const MessageAvatar: FC<MessageAvatarProps> = ({
	src,
	name,
	className,
}) => {
	return (
		/*
		 * `mb-1` is the same 4px the row's own meta caption takes from its chunk:
		 * the mark belongs to the line under it, and anything wider would read as
		 * a block of its own. `flex` on the root is what keeps it a line rather
		 * than an inline box that the first paragraph would wrap around.
		 */
		<AgentAvatar className={cn("mb-1 size-5", className)}>
			{/*
			 * `alt` NAMES THE SPEAKER, AND ONLY WHEN THERE IS A NAME (review round 1,
			 * R-3). The old label was the fixed role word ("Assistant") and the comment
			 * claimed it was the only place a screen reader learned whose turn it was;
			 * both were wrong. The row this mark sits in is already a `role="group"`
			 * labelled "Agent message", so the register had already spoken, and every
			 * agent's picture then announced the same word - coder and reviewer were
			 * indistinguishable. The name is the one fact the register cannot state,
			 * so it is what the image says; with no name the mark is decoration
			 * (`alt=""`), which is the same answer the sidebar and roster give.
			 */}
			<AvatarImage src={src} alt={name ?? ""} loading="eager" />
		</AgentAvatar>
	);
};
