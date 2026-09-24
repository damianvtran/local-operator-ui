import { Button } from "@shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { MoreHorizontal } from "lucide-react";

/**
 * How many local conversations the menu lists. The menu is a picker over the
 * NEWEST local chats, not the whole store: a 500-item menu is unusable, and the
 * chat a user wants to hand to another device is almost always a recent one.
 */
const MOVE_MENU_LIMIT = 12;

/**
 * `Move a chat here…` on a `Peers` row (`mesh-ui.md` §2.4): the ONE entry point
 * for moving a conversation to another device.
 *
 * WHY HERE AND NOT ON EVERY CHAT ROW: a chat row has room for one trailing claim
 * and it is already spoken for; a per-row move control would be a third control
 * on a row with room for one, for a gesture that is rare (§2.7). The peer's row
 * owns the gesture instead, and it is mounted only when the backend advertises
 * `features.session_transfer` - on `peers` alone the route would 404.
 *
 * The move itself is the store's (`transferSession`): the chosen row stays in
 * place, busy, until the backend answers (S6), and a refusal is the sidebar's
 * `role="alert"` notice in the route's own words (S7).
 *
 * WHY THE OVERFLOW GLYPH AND NOT THE PAIRED ARROWS (design round 1, D2). lucide's
 * `ArrowRightLeft` draws `⇄`, which is the same two-arrow shape the locality mark
 * uses - so the row read `⇆ devon-laptop ⇄`, one motif mirrored, meaning "this chat
 * lives elsewhere" on the left and "move a chat here" on the right, and the only
 * entry point for the gesture looked like decoration. `MoreHorizontal` is this
 * app's row-action affordance (the same glyph the chat header's menu uses), so the
 * shape says "actions here" and the locality mark keeps the arrows to itself. The
 * tooltip and the `aria-label` still spell the gesture out, so the change costs no
 * discoverability.
 */
export function MoveChatHere({
	peerLabel,
	rows,
	onMove,
	isMoving,
}: {
	peerLabel: string;
	/** This device's conversations, newest first (the sidebar's `rest`). */
	rows: CanonicalSessionRow[];
	onMove: (row: CanonicalSessionRow) => void;
	/**
	 * Whether that conversation already has a move in flight (QA round 1, Q3).
	 *
	 * The menu is the surface that STARTS a move, and it did not read the store's
	 * `transfers`: the conversation being moved stayed listed and pressable, and every
	 * press minted a fresh request id - which is exactly what the route's at-most-once
	 * guard keys on, so one gesture reached the peer's relay twice, 3 ms apart. The
	 * store refuses a second move now; this is the visible half of the same rule, so
	 * the reader is not offered a control that will do nothing.
	 */
	isMoving?: (sessionId: string) => boolean;
}) {
	const choices = rows.slice(0, MOVE_MENU_LIMIT);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Move a chat to ${peerLabel}…`}
					title={`Move a chat to ${peerLabel}…`}
					className="shrink-0"
				>
					<MoreHorizontal aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-w-72">
				<DropdownMenuLabel>Move a chat to {peerLabel}</DropdownMenuLabel>
				{choices.length === 0 ? (
					<DropdownMenuItem disabled>No chats on this device</DropdownMenuItem>
				) : (
					choices.map((row) => (
						<DropdownMenuItem
							key={row.session_id}
							disabled={isMoving?.(row.session_id) === true}
							onSelect={() => onMove(row)}
						>
							<span className="truncate">{row.title || "Untitled chat"}</span>
							{isMoving?.(row.session_id) === true && (
								<span className="shrink-0 text-ink-dim">Moving…</span>
							)}
						</DropdownMenuItem>
					))
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
