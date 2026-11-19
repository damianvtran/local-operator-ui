/**
 * The agent's mark at the head of a turn: its picture (or, for the few frames a
 * claimed picture's bytes are cold, the plate that holds its box).
 *
 * WHAT CHANGED SINCE D11, and why the deletion was right then and is wrong now.
 * D11 deleted the agent glyph and the 40px gutter it was absolutely positioned
 * in, for a measured reason: every agent row paid that indent so ONE 28px box
 * could sit in it, the glyph repeated once per message, and the fact it marked -
 * "the agent is speaking" - was already carried by the register (a user turn is
 * a filled block, an agent turn is prose on no ground). The picture says
 * something the register CANNOT: WHICH agent this turn belongs to. So it is back,
 * under those constraints: drawn once per turn, as a line of its own above the
 * turn's first line (never beside it, so no row's text measure moves), and at the
 * reader's chosen size (`agent-avatar-size.ts`; 20px by default) rather than
 * 28-40px, because a photograph is intrinsically louder than a muted glyph and
 * it must not become the loudest thing in the left column.
 *
 * NO PICTURE MEANS NO MARK - and no line. The look for an agent without a
 * picture is D11's own: nothing above the turn's first line, so its first tool
 * row sits exactly where it sat before pictures existed. #1651 briefly drew a
 * dashed camera placeholder here once per transcript; the operator removed it
 * (2026-11-04: it occupied a row and attention for an agent with no image). The
 * transcript never passes `suggestPicture`, so `decideAvatarMark` answers only a
 * picture, the plate of a claimed picture still loading, or nothing - and a
 * nothing mounts no wrapper and no gap (callers gate on it).
 *
 * `rounded-full` is one of the three places § 5 permits it. THE EDGE IS THE
 * SHARED ONE (design review round 1, D1 on #1518): the same 1px `border-control`
 * boundary and `sunken` plate as the roster, the rail and the settings field,
 * on the circle's owner (`AgentAvatar`).
 */

import { AgentAvatarSlot } from "@shared/agent-avatar/agent-avatar-slot";
import type { AvatarMark } from "@shared/agent-avatar/avatar-presence";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC } from "react";
import {
	TURN_AVATAR_BOX,
	TURN_AVATAR_GAP,
	parseAgentAvatarSize,
} from "../../agent-avatar-size";

export type MessageAvatarProps = {
	/** What the head draws; see `decideAvatarMark`. Never "nothing" - callers gate on it. */
	mark: AvatarMark;
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
	mark,
	name,
	className,
}) => {
	const size = parseAgentAvatarSize(
		useUiPreferencesStore((state) => state.agentAvatarSize),
	);
	const box = TURN_AVATAR_BOX[size];
	const gap = TURN_AVATAR_GAP[size];
	/*
	 * The gap under the mark (4px at the default, the same `mb-1` the row's own
	 * meta caption takes from its chunk) grows with the box - 6 and 8px at the
	 * larger steps - so a big face is not stuck to its line. It is read from the
	 * table the transcript's height estimate reads, so the class and the estimate
	 * cannot drift; the literal classes in that table are what Tailwind scans.
	 */
	return (
		<div
			className={cn("flex", gap.className, className)}
			data-turn-avatar-gap={gap.px}
		>
			{/*
			 * `alt` NAMES THE SPEAKER, AND ONLY WHEN THERE IS A NAME (review round 1,
			 * R-3). The row this mark sits in is already a `role="group"` labelled
			 * "Agent message", so the register had already spoken, and every agent's
			 * picture then announced the same word - coder and reviewer were
			 * indistinguishable. The name is the one fact the register cannot state,
			 * so it is what the image says; with no name the mark is decoration
			 * (`alt=""`), which is the same answer the sidebar and roster give.
			 */}
			<AgentAvatarSlot
				mark={mark}
				boxClassName={box.className}
				glyphClassName={box.glyphClassName}
				hitClassName={box.hitClassName}
				alt={name ?? ""}
				agentName={name}
			/>
		</div>
	);
};
