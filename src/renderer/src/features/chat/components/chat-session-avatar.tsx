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
import { AgentAvatar, AvatarFallback } from "@shared/components/ui/avatar";
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
 * Which treatment the row uses when the agent has a picture: `badge` puts a
 * 10px status disc on the picture's corner, `beside` keeps the untouched 16px
 * status cell next to it. Flip this one constant to switch - nothing else in
 * this file changes.
 *
 * IT IS `beside`, ON MEASUREMENT, NOT PREFERENCE (design review round 1, D1).
 * The badge was sized for a 24px mark, and this row's mark is 16px: on the
 * rendered frames its 10px disc covered 7 of those 16 columns, and the ink that
 * reached the eye inside it measured **2.24-2.40:1 in light and 2.90:1 in dark**
 * for `done`/`failed` (best ink in the disc against its own `sunken` fill),
 * against **5.92-6.66:1** for the same statuses on a row without a picture.
 * WCAG 1.4.11 asks for 3:1 on exactly this kind of non-text state, and the
 * operator's rule is that status must stay legible and must never hide behind
 * the avatar - so a status only a pixel-sampler can read is a defect.
 *
 * The badge arm is kept, and kept switchable, because the treatment is right for
 * a LARGER mark: at a 24px picture (what `SESSION_MARK_BOX` would need to be for
 * the disc to cover under half the columns) the same ink reaches the ratios the
 * no-picture rows already show. Revisit then; the baseline to beat is the table
 * above, and the discriminating frame is `chat-row-statuses` in light and dark.
 */
const AVATAR_STATUS_VARIANT: "badge" | "beside" = "beside";

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
			/*
			 * `gap-1.5`, not `gap-1`: the pencil's focus ring (a 24px target around the
			 * 16px picture) ended 1px short of the status glyph's ink and read as
			 * touching it (design review round 2, N5).
			 */
			className={cn("relative flex shrink-0 items-center gap-1.5")}
		>
			<span className={cn("relative flex shrink-0", SESSION_MARK_BOX)}>
				<AgentMark
					agentId={agentId}
					sha256={sha256}
					className={cn(SESSION_MARK_BOX, "rounded-full")}
					/*
					 * A PLATE, NEVER A SECOND STATUS (agent review round 2, MAJOR-1). While the
					 * bytes are cold - every pictured row until its fetch lands, and for good
					 * when a digest 404s - `AgentMark` draws this instead of the picture. It
					 * used to be a `ChatSessionStatus`, which in the `beside` arm sat next to
					 * the real one: two check glyphs side by side, and the sentence spoken
					 * three times. The status is drawn exactly once per row, by the cell
					 * below (or by the badge), so this is the picture's own shape only.
					 */
					fallback={<AgentMarkPlate />}
					glyph={<Bot className="size-2.5" aria-hidden="true" />}
				/>
				{AVATAR_STATUS_VARIANT === "badge" ? (
					<ChatSessionStatusBadge row={row} />
				) : null}
			</span>
			{AVATAR_STATUS_VARIANT === "beside" ? (
				/* `ChatSessionStatus` carries its own `sr-only` sentence - the row's one. */
				<ChatSessionStatus row={row} nowSeconds={nowSeconds} />
			) : (
				/* The badge is `aria-hidden`, so the sentence has to come from here. */
				<span className="sr-only">
					{statusSpokenText(
						row,
						nowSeconds ?? Date.now() / 1000,
						sessionStatusMark(row),
					)}
				</span>
			)}
		</span>
	);
}

/**
 * The picture's plate for the moment it cannot paint: the same plate and glyph
 * `AgentMark` shows inside a picture whose image has not decoded, drawn without
 * the image. `aria-hidden` because it names nothing - the row's status does.
 */
function AgentMarkPlate() {
	return (
		<AgentAvatar
			aria-hidden="true"
			className={cn(SESSION_MARK_BOX, "rounded-full")}
			data-agent-mark=""
		>
			<AvatarFallback>
				<Bot className="size-2.5" aria-hidden="true" />
			</AvatarFallback>
		</AgentAvatar>
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
	/*
	 * A REMOTE ROW MOUNTS NOTHING (agent review round 2, m-B). The link's unowned
	 * arm draws a positioned 16px span over the mark; on top of the row's
	 * non-positioned button that span would take the press on the mark, a dead
	 * zone where the row button used to receive it. No door means no element.
	 */
	const owned = sessionPictureEditable(row);
	if (!owned) return null;
	return (
		<AgentAvatarEditLink
			agentName={agentName}
			agentId={agentId}
			owned={owned}
			overlay={true}
			/*
			 * THE TARGET IS BIGGER THAN THE PICTURE (design review round 1, D4). The
			 * anchor's box has to stay the mark's 16px - the scrim and the pencil are
			 * inset to it, and a bigger box would paint a disc wider than the picture -
			 * so the extra reach is a pseudo-element: `before:-inset-1` makes the
			 * pointer's target 24x24 around the same 16px disc, which is WCAG 2.5.8's
			 * minimum without moving the row by a pixel.
			 */
			linkProps={{
				className: "before:absolute before:-inset-1 before:content-['']",
			}}
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
