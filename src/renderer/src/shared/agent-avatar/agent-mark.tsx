/**
 * One agent's mark: its picture when it has one, the existing glyph when not.
 *
 * WHY ONE COMPONENT. The roster, the chat header, the sidebar rows and the
 * editor's previews all draw "this agent's picture, else its glyph", and each
 * of them had (or would grow) its own copy of that branch - the class of
 * duplicate where one copy forgets the fallback for a digest that fails to
 * load. Here the fallback is structural: `useAgentAvatar` answers `null` for
 * no picture AND for a picture that could not be read, and Radix renders the
 * fallback arm until an image has actually loaded.
 *
 * NO PICTURE, NO PLATE. When the agent has no picture this renders the caller's
 * `fallback` exactly as the surface drew it before (`AgentAvatar`'s bordered
 * plate is only for a picture), which is what keeps every surface without a
 * picture byte-identical to main - the brief's "without a picture the row is
 * unchanged".
 *
 * It is deliberately independent of Team Bridge's identity resolver
 * (`shared/identity-avatar.ts` on that lane): those surfaces draw people and
 * remote agents from the hub, these draw local agents from core, and a surface
 * that shows both composes the two rather than one resolver learning the other.
 */

import {
	AgentAvatar,
	AvatarFallback,
	AvatarImage,
} from "@shared/components/ui/avatar";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useEffect } from "react";
import { useAgentAvatar } from "./agent-avatar";

export type AgentMarkProps = {
	agentId: string | null | undefined;
	/**
	 * The digest the caller already holds (a session row's `avatar_sha256`), so
	 * the agents list is not consulted; `undefined` means "look it up".
	 */
	sha256?: string | null;
	/** The box: a `size-*` class. The picture fills it. */
	className?: string;
	/**
	 * What the surface drew before pictures existed, WHOLE - the box and its
	 * fallback. Rendered unchanged when the agent has no picture, which is what
	 * makes "no picture, no change" true per surface rather than per component.
	 */
	fallback: ReactNode;
	/**
	 * The glyph the surface draws INSIDE the picture's plate, for the two
	 * moments the image itself cannot paint: before it loads, and when the
	 * stored file cannot be decoded.
	 */
	glyph?: ReactNode;
	/** Overrides the image URL (stories, the editor's own preview). */
	src?: string | null;
	/**
	 * Told whether a picture is being shown, for a caller whose controls depend
	 * on it (the editor's Upload/Replace label and its Remove button).
	 */
	onPresence?: (present: boolean) => void;
};

export function AgentMark({
	agentId,
	sha256,
	className,
	fallback,
	src,
	glyph = null,
	onPresence,
}: AgentMarkProps) {
	const fetched = useAgentAvatar(src === undefined ? agentId : null, sha256);
	const url = src === undefined ? fetched : src;
	const present = Boolean(url);
	useEffect(() => {
		onPresence?.(present);
	}, [onPresence, present]);
	if (!url) return <>{fallback}</>;
	return (
		<AgentAvatar className={cn("shrink-0", className)} data-agent-mark="">
			<AvatarImage src={url} alt="" />
			<AvatarFallback>{glyph}</AvatarFallback>
		</AgentAvatar>
	);
}

/** Whether an agent has a paintable picture right now (for layout choices). */
export function useHasAgentPicture(
	agentId: string | null | undefined,
	sha256?: string | null,
): boolean {
	return useAgentAvatar(agentId, sha256) !== null;
}
