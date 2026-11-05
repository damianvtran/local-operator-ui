/**
 * The mark an agent's picture slot draws: the picture, the placeholder that
 * suggests one, or the plate that holds the box while a claimed picture is read.
 *
 * WHAT TO DRAW IS NOT DECIDED HERE. `decideAvatarMark` (pure, executed by a Node
 * test) answers picture / placeholder / plate / nothing and whether there is a
 * door; this file paints the answer, so the chat header and the transcript's
 * turn head - which share the decision - cannot disagree.
 *
 * THE PLACEHOLDER IS RARE BY DESIGN (operator, 2026-11-04). An agent with no
 * picture draws nothing on every chat surface - no mark, no reserved box - with
 * one exception: the chat header of a proactive-class agent or the chief of
 * staff (`suggestPicture`, see `avatar-presence.ts`). There it is a door that
 * looks like one: a dashed `border-control` ring (the repo's "empty slot"
 * grammar) around a camera glyph that names the act. Hover and focus step the
 * ring and glyph toward `ink` (a colour step, no lift); focus is the link's own
 * `outline`. It opens the SAME editor every other door opens
 * (`AgentAvatarEditLink` -> `?edit=picture`); nothing here uploads anything.
 * While a write is in flight the slot keeps its box as a solid plate with the
 * busy spinner - no dashed ring, no door.
 */

import {
	AgentAvatar,
	AvatarFallback,
	AvatarImage,
} from "@shared/components/ui/avatar";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Camera, LoaderCircle } from "lucide-react";
import type { FC } from "react";
import { useAgentAvatarState, useAgentAvatarWriting } from "./agent-avatar";
import { AgentAvatarEditLink } from "./agent-avatar-edit-link";
import { type AvatarMark, decideAvatarMark } from "./avatar-presence";

export type AgentAvatarSlotProps = {
	mark: AvatarMark;
	/** The box: a `size-*` class from the size tables. */
	boxClassName: string;
	/** The glyph size inside the placeholder, from the same table. */
	glyphClassName: string;
	/**
	 * Extra classes for the door's link (the size table's 24px hit halo). Never
	 * applied to a mark with no door, and never moves a layout box.
	 */
	hitClassName?: string;
	/**
	 * The image's accessible name. Empty draws the picture as decoration (the
	 * header, whose title names the conversation beside it).
	 */
	alt?: string;
	/** The agent's name, for the door's accessible name. */
	agentName?: string | null;
	className?: string;
};

export const AgentAvatarSlot: FC<AgentAvatarSlotProps> = ({
	mark,
	boxClassName,
	glyphClassName,
	hitClassName,
	alt = "",
	agentName,
	className,
}) => {
	useI18nLocale();
	if (mark.kind === "plate") {
		return (
			<AgentAvatar
				aria-hidden="true"
				data-agent-mark="plate"
				className={cn(boxClassName, className)}
			/>
		);
	}
	if (mark.kind === "picture") {
		const picture = (
			<AgentAvatar
				data-agent-mark=""
				className={cn("shrink-0", boxClassName, className)}
			>
				<AvatarImage src={mark.src} alt={alt} loading="eager" />
				<AvatarFallback />
			</AgentAvatar>
		);
		if (!mark.door) return picture;
		return (
			<AgentAvatarEditLink
				agentName={mark.door.agentName}
				agentId={mark.door.agentId}
				owned={true}
				className={cn(boxClassName, hitClassName)}
				pencilClassName={glyphClassName}
			>
				{picture}
			</AgentAvatarEditLink>
		);
	}
	/*
	 * UPLOADING IS A PLATE WITH A SPINNER, NOT A DASHED RING (design review D2).
	 * The dashed edge is the repo's "empty slot, fill me" grammar and the door's
	 * whole signal; a write in flight is neither empty nor offering anything, so
	 * it keeps the box (nothing reflows) in the same solid plate every picture
	 * sits on and says "working" with the spinner alone.
	 */
	if (mark.busy) {
		return (
			<AgentAvatar
				aria-hidden="true"
				data-agent-mark="placeholder"
				data-busy=""
				className={cn(
					"items-center justify-center text-ink-muted",
					boxClassName,
					className,
				)}
			>
				<LoaderCircle
					className={cn(
						glyphClassName,
						"animate-spin motion-reduce:animate-none",
					)}
					aria-hidden="true"
				/>
			</AgentAvatar>
		);
	}
	const face = (
		<span
			aria-hidden="true"
			data-agent-mark="placeholder"
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full",
				"border border-dashed border-control bg-transparent text-ink-muted",
				/* A colour step under the door's hover/focus, never a lift. */
				mark.door &&
					"transition-colors duration-fast ease-out-quart group-hover/avatar-edit:border-ink-muted group-hover/avatar-edit:text-ink",
				boxClassName,
				className,
			)}
		>
			<Camera className={glyphClassName} aria-hidden="true" />
		</span>
	);
	if (!mark.door) return face;
	return (
		<AgentAvatarEditLink
			agentName={mark.door.agentName}
			agentId={mark.door.agentId}
			owned={true}
			scrim={false}
			label={t("ui.agents.avatar.add_link", {
				name: agentName ?? mark.door.agentName,
			})}
			className={cn(boxClassName, hitClassName)}
		>
			{face}
		</AgentAvatarEditLink>
	);
};

/**
 * The slot's mark for one agent, read from the same sources every surface uses:
 * the bytes (`useAgentAvatarState`), whether a write is in flight, and the
 * ownership the caller derived from the session row.
 *
 * `pictureDoor` is false for the transcript's turn head, whose PICTURE has never
 * been a link (it repeats every turn; a pencil there would be the per-message
 * noise D11 removed). The header keeps the door on its picture, as it always has.
 *
 * `suggestPicture` is the header's alone (see `avatar-presence.ts`): no other
 * caller passes it, so no other surface can draw the placeholder.
 */
export function useAgentSlotMark(input: {
	agentId: string | null;
	agentName: string | null;
	/** The row's digest: `undefined` looks the agent up, `null` says it has none. */
	sha256Hint?: string | null;
	owned: boolean;
	pictureDoor: boolean;
	/** May this surface suggest a picture when there is none? Header only. */
	suggestPicture?: boolean;
	/** The header's class read is still pending: hold a plate (`avatar-presence.ts`). */
	suggestPending?: boolean;
	/**
	 * The CSS size the caller's box draws the mark at, so the byte read asks for
	 * the right-sized derivative (`useAgentAvatarState`'s third parameter).
	 * Omitted by callers whose box is not a single fixed size.
	 */
	cssPx?: number;
}): AvatarMark | null {
	const { url, settled, unreadable, claimed } = useAgentAvatarState(
		input.agentId,
		input.sha256Hint,
		input.cssPx,
	);
	const uploading = useAgentAvatarWriting(input.agentId);
	const mark = decideAvatarMark({
		agentId: input.agentId,
		agentName: input.agentName,
		src: url,
		settled,
		claimed,
		uploading,
		unreadable,
		owned: input.owned,
		suggestPicture: input.suggestPicture,
		suggestPending: input.suggestPending,
	});
	if (mark?.kind === "picture" && !input.pictureDoor)
		return { ...mark, door: null };
	return mark;
}
