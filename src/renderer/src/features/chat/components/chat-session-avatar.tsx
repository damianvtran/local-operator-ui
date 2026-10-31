/**
 * A session row's leading mark: the agent's picture with the row's status on
 * its corner, or the status glyph alone.
 *
 * THE RULE THE OPERATOR SET: a status must never be hidden behind a picture.
 * The row's leading slot is one 16px box, and until now it held the status
 * glyph. A picture takes that box - but the glyph comes with it as a corner
 * badge (`ChatSessionStatusBadge`), drawn from the same predicate
 * (`sessionStatusMark`) the full-size cell uses, so running, done, waiting and
 * attention keep both their silhouette and their ink.
 *
 * TWO ARMS, ONE SWITCH. `AVATAR_STATUS_VARIANT` picks the proposed treatment:
 * `badge` (the picture in the slot, status on its corner - what ships) or
 * `beside` (the picture plus the untouched 16px status cell, for a wider row).
 * The designer decides; flipping this constant is the whole change.
 *
 * NO PICTURE, NO CHANGE. Without one this renders exactly the cell main drew,
 * so every row that has no picture - every row before this feature, and every
 * row on a backend that does not publish `avatar_sha256` - is byte-identical.
 *
 * THE NAME IS KEPT. `ChatSessionStatus`'s `sr-only` sentence is part of the
 * row button's accessible name; the badge arm renders the same sentence from
 * the same function, so a picture changes what is drawn and not what is read.
 */

import { AgentAvatarEditLink } from "@shared/agent-avatar/agent-avatar-edit-link";
import { sessionPictureEditable } from "@shared/agent-avatar/agent-avatar-meta";
import { AgentMark } from "@shared/agent-avatar/agent-mark";
import { cn } from "@shared/lib/utils";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { Bot } from "lucide-react";
import {
	ChatSessionStatus,
	ChatSessionStatusBadge,
	sessionStatusMark,
	statusSpokenText,
} from "./chat-session-status";

/**
 * Which treatment the row uses when the agent has a picture. `badge` is the
 * shipping proposal; `beside` keeps the full status cell next to the picture.
 * Flip this one constant to switch - nothing else in this file changes.
 */
const AVATAR_STATUS_VARIANT: "badge" | "beside" = "badge";

/** The box every arm of the leading slot occupies. */
export const SESSION_MARK_BOX = "size-4";

export function ChatSessionAvatar({
	row,
	nowSeconds,
}: {
	row: CanonicalSessionRow;
	nowSeconds?: number;
}) {
	const agentId = row.agent_id ?? null;
	const sha256 = row.avatar_sha256 ?? null;
	if (!agentId || !sha256) {
		// No picture to draw: the cell main drew, with its own subscription.
		return <ChatSessionStatus row={row} nowSeconds={nowSeconds} />;
	}
	return (
		<span
			data-session-mark="avatar"
			data-avatar-variant={AVATAR_STATUS_VARIANT}
			className={cn("relative flex shrink-0 items-center gap-1")}
		>
			<span className={cn("relative flex shrink-0", SESSION_MARK_BOX)}>
				<AgentMark
					agentId={agentId}
					sha256={sha256}
					className={cn(SESSION_MARK_BOX, "rounded-full")}
					fallback={<ChatSessionStatus row={row} nowSeconds={nowSeconds} />}
					glyph={<Bot className="size-2.5" aria-hidden="true" />}
				/>
				{AVATAR_STATUS_VARIANT === "badge" ? (
					<ChatSessionStatusBadge row={row} />
				) : null}
			</span>
			{AVATAR_STATUS_VARIANT === "beside" ? (
				<ChatSessionStatus row={row} nowSeconds={nowSeconds} />
			) : null}
			{/* The sentence the glyph cell contributes to the row's name. */}
			<span className="sr-only">
				{statusSpokenText(
					row,
					nowSeconds ?? Date.now() / 1000,
					sessionStatusMark(row),
				)}
			</span>
		</span>
	);
}

/**
 * The pencil that opens this row's agent editor, for a row whose agent the
 * viewer owns.
 *
 * IT SITS OUTSIDE THE ROW BUTTON, and it has to: interactive content inside a
 * `button` is invalid and swallows the press, so this is a SIBLING positioned
 * over the picture's box (`chat-sidebar.tsx` places it in the row's wrapper).
 * Absent on a human picture and on a row with no picture (nothing to change, and
 * the row's status cell owns the box).
 *
 * WHETHER THE PENCIL IS DRAWN AT ALL IS NOT THIS FILE'S ANSWER. Ownership comes
 * from `sessionPictureEditable(row)`, the same one function the chat header
 * reads (agent review round 1, M2): a remote conversation's agent belongs to
 * another device, and the wrapper draws the bare picture for an agent the
 * viewer does not own - one implementation of "no pencil", in one place.
 *
 * `start-1` matches the row button's `px-1`, so the pencil lands on the mark.
 */
export function ChatSessionAvatarEdit({
	row,
	className,
}: {
	row: CanonicalSessionRow;
	className?: string;
}) {
	const agentId = row.agent_id ?? null;
	const agentName = row.binding?.agent ?? null;
	if (!agentId || !row.avatar_sha256 || !agentName) return null;
	return (
		<AgentAvatarEditLink
			agentName={agentName}
			agentId={agentId}
			owned={sessionPictureEditable(row)}
			overlay={true}
			className={cn(
				SESSION_MARK_BOX,
				"absolute start-1 top-1/2 -translate-y-1/2",
				className,
			)}
		>
			<span aria-hidden="true" className={cn(SESSION_MARK_BOX, "block")} />
		</AgentAvatarEditLink>
	);
}
