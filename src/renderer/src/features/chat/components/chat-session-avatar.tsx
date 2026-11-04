/**
 * A session row's leading mark: the row's status, then the agent's picture, or
 * the status glyph alone.
 *
 * THE RULE THE OPERATOR SET: a status must never be hidden behind a picture.
 * The picture never covers the glyph: in the shipped `beside` arm they are two
 * boxes, and the glyph is the untouched 16px status cell (`ChatSessionStatus`),
 * drawn from the same predicate (`sessionStatusMark`) every row uses, so
 * running, done, waiting and attention keep both their silhouette and their ink.
 *
 * STATUS FIRST, PICTURE SECOND (presence round). The status used to follow the
 * picture, which put the glyph at one x on a row with a picture and 22px to the
 * left on one without: a list that mixed both read as two ragged status columns,
 * and the glyph (a circle, a check, a bubble) sat directly against a face, where
 * it is easy to read as a badge OF the face rather than as the row's state.
 * Leading with the status keeps ONE status column down the whole list - the
 * place every row has always drawn it - and lets the picture sit beside the
 * title, where a chat app puts the face of whoever the row is with. The
 * alternatives (status trailing next to the age, or a small dot on the picture)
 * were weighed in the PR text: the trailing slot admits one statement already
 * (`rowTrailingStatement`), and the dot is the corner badge the arm below keeps
 * switchable and whose ink measured under 3:1 at 16px.
 *
 * TWO ARMS, ONE SWITCH. `AVATAR_STATUS_VARIANT` picks the treatment: `beside`
 * (what ships) or `badge` (the status on the picture's corner, for a larger
 * mark). Flipping this constant is the whole change.
 *
 * NO PICTURE, NO CHANGE - AND NO PLACEHOLDER HERE. Without a picture this renders
 * exactly the cell main drew, so every row that has no picture is byte-identical.
 * The no-picture session row deliberately does NOT gain the camera placeholder:
 * a conversation list repeats the row dozens of times, the sidebar's pictureless
 * rows must stay as they are (the operator's ask), and the door is already one
 * press away in the header and the first turn of the open conversation. A digest
 * whose bytes FAIL draws the same no-picture row (`PicturedSessionAvatar`), so
 * failed and absent cannot disagree here either.
 *
 * THE NAME IS KEPT. `ChatSessionStatus`'s `sr-only` sentence is part of the
 * row button's accessible name; the badge arm renders the same sentence from
 * the same function, so a picture changes what is drawn and not what is read.
 */

import { useAgentAvatarState } from "@shared/agent-avatar/agent-avatar";
import { AgentAvatarEditLink } from "@shared/agent-avatar/agent-avatar-edit-link";
import { sessionAvatarTarget } from "@shared/agent-avatar/agent-avatar-meta";
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
	reservePicture = false,
}: {
	row: CanonicalSessionRow;
	nowSeconds?: number;
	/**
	 * True when ANY row in the list draws a picture: a row that has none then
	 * holds the picture's box empty, so every title in the list starts on one x
	 * (design review D1). False - the whole list is pictureless, which is every
	 * list before this feature and every backend that publishes no digest - draws
	 * the cell main drew, byte for byte.
	 */
	reservePicture?: boolean;
}) {
	const agentId = row.agent_id ?? null;
	const sha256 = row.avatar_sha256 ?? null;
	if (!agentId || !sha256) {
		// No picture to draw: the cell main drew, with its own subscription.
		return (
			<BareSessionStatus
				row={row}
				nowSeconds={nowSeconds}
				reserve={reservePicture}
			/>
		);
	}
	return (
		<PicturedSessionAvatar
			row={row}
			agentId={agentId}
			sha256={sha256}
			nowSeconds={nowSeconds}
			reservePicture={reservePicture}
		/>
	);
}

/**
 * The status cell of a row with no picture, plus - only when the list has
 * pictures elsewhere - an empty box where the picture would be, in the SAME
 * cluster geometry a pictured row uses (`gap-1.5`), so the title's x is the
 * pictured row's. The box is `aria-hidden` and carries no text: the row's one
 * status sentence is still the status cell's.
 */
function BareSessionStatus({
	row,
	nowSeconds,
	reserve,
}: {
	row: CanonicalSessionRow;
	nowSeconds?: number;
	reserve: boolean;
}) {
	if (!reserve) return <ChatSessionStatus row={row} nowSeconds={nowSeconds} />;
	return (
		<span
			data-session-mark="reserved"
			className="relative flex shrink-0 items-center gap-1.5"
		>
			<ChatSessionStatus row={row} nowSeconds={nowSeconds} />
			<span
				aria-hidden="true"
				data-session-picture-slot=""
				className={cn("shrink-0", SESSION_MARK_BOX)}
			/>
		</span>
	);
}

/**
 * THE ROW'S ANSWER FOR A CLAIMED DIGEST. While the bytes are cold the plate holds
 * the picture's box (so the title does not move when the face lands); once the
 * read has SETTLED with no bytes - a 404, a removed file, a stale digest - the row
 * draws exactly what a row with no picture draws, the status cell alone. Before
 * this, a failed digest kept a Bot plate in the row that an absent picture never
 * drew: the one surface where "failed" and "no picture" disagreed. The row never
 * draws the placeholder mark itself (see the module note): that door lives in the
 * header and the transcript, and the sidebar row stays as it is.
 */
function PicturedSessionAvatar({
	row,
	agentId,
	sha256,
	nowSeconds,
	reservePicture,
}: {
	row: CanonicalSessionRow;
	agentId: string;
	sha256: string;
	nowSeconds?: number;
	reservePicture: boolean;
}) {
	const { url, settled } = useAgentAvatarState(agentId, sha256, 16);
	if (settled && !url)
		return (
			<BareSessionStatus
				row={row}
				nowSeconds={nowSeconds}
				reserve={reservePicture}
			/>
		);
	const picture = (
		<span className={cn("relative flex shrink-0", SESSION_MARK_BOX)}>
			<AgentMark
				agentId={agentId}
				sha256={sha256}
				className={cn(SESSION_MARK_BOX, "rounded-full")}
				// `SESSION_MARK_BOX` is `size-4`: 16 CSS px.
				cssPx={16}
				/*
				 * A PLATE, NEVER A SECOND STATUS (agent review round 2, MAJOR-1). While the
				 * bytes are cold - every pictured row until its fetch lands, and for good
				 * when a digest 404s - `AgentMark` draws this instead of the picture. It
				 * used to be a `ChatSessionStatus`, which in the `beside` arm sat next to
				 * the real one: two check glyphs side by side, and the sentence spoken
				 * three times. The status is drawn exactly once per row, by the cell
				 * beside it (or by the badge), so this is the picture's own shape only.
				 */
				fallback={<AgentMarkPlate />}
				glyph={<Bot className="size-2.5" aria-hidden="true" />}
			/>
			{AVATAR_STATUS_VARIANT === "badge" ? (
				<ChatSessionStatusBadge row={row} />
			) : null}
		</span>
	);
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
			{AVATAR_STATUS_VARIANT === "beside" ? (
				<>
					{/*
					 * THE STATUS LEADS, THE PICTURE FOLLOWS (presence round). The status
					 * cell is where every row without a picture has always drawn it, so a
					 * list that mixes both keeps ONE status column: the glyph's x no longer
					 * moves by 22px (16 + the 6px gap) between a row that has a picture and
					 * one that does not, which is what made the pictured rows read as a
					 * second, ragged column. The picture then sits beside the title - the
					 * place a chat app puts the face of whoever the row is with - instead of
					 * between two glyph-sized marks that read as one double-icon cluster.
					 * `ChatSessionStatus` carries its own `sr-only` sentence - the row's one.
					 */}
					<ChatSessionStatus row={row} nowSeconds={nowSeconds} />
					{picture}
				</>
			) : (
				<>
					{picture}
					{/* The badge is `aria-hidden`, so the sentence has to come from here. */}
					<span className="sr-only">
						{statusSpokenText(
							row,
							nowSeconds ?? Date.now() / 1000,
							sessionStatusMark(row),
						)}
					</span>
				</>
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
 * WHERE IT LANDS IS MEASURED, NOT ASSUMED (presence round). The old `start-1`
 * ("matches the row button's `px-1`") ignored the locality cell every sidebar
 * row draws (14px + the row's 4px gap) and put the pencil 18px LEFT of the
 * picture on main - on the empty locality cell, measured at x=16 against a
 * picture at x=34 in the real sidebar. The picture now follows the status cell,
 * so the offset from the row box is: `px-1` 4 + locality 14 + gap 4 + status 16
 * + the cluster's own 6 = 44px (`start-11`), and a nested row's `ps-7` (28
 * instead of 4) adds 24 (`start-17`). Both are literal classes because Tailwind
 * finds a class by scanning the source; `scripts/avatar-layout.test.mjs` pins
 * the numbers beside the row's own classes.
 */
export function ChatSessionAvatarEdit({
	row,
	className,
	nested = false,
}: {
	row: CanonicalSessionRow;
	className?: string;
	/** The row is a child under its agent's entity row (`ps-7`, not `px-1`). */
	nested?: boolean;
}) {
	const target = sessionAvatarTarget(row);
	/*
	 * A DOOR ONLY ONTO A PICTURE THAT DRAWS (agent review m-1). A stale digest, a
	 * removed file or a 404 settles with no bytes, and the row then draws the bare
	 * status cell (`PicturedSessionAvatar`): an overlay mounted anyway would put a
	 * hover-revealed pencil over the title of a row that shows no picture. The read
	 * is the same shared one the row's own picture makes (one fetch, one cache
	 * key), and while it is still cold the overlay stays mounted over the plate,
	 * which is about to become the picture.
	 */
	const { url, settled } = useAgentAvatarState(
		target?.agentId ?? null,
		target?.sha256 ?? null,
		// The same 16 CSS px box the row's mark and this overlay share.
		16,
	);
	/*
	 * A REMOTE ROW MOUNTS NOTHING (agent review round 2, m-B). The link's unowned
	 * arm draws a positioned 16px span over the mark; on top of the row's
	 * non-positioned button that span would take the press on the mark, a dead
	 * zone where the row button used to receive it. No door means no element.
	 * A row with no bound agent name has no address for the door either.
	 */
	if (!target?.owned || !target.agentName) return null;
	if (settled && !url) return null;
	const { agentId, agentName, owned } = target;
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
				"absolute top-1/2 -translate-y-1/2",
				nested ? "start-17" : "start-11",
				className,
			)}
		>
			<span aria-hidden="true" className={cn(SESSION_MARK_BOX, "block")} />
		</AgentAvatarEditLink>
	);
}
