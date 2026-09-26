import { cn } from "@shared/lib/utils";
import type { PeerRow } from "../../../../../shared/desktop-session-contract";
import { peerTrailingParts, peerTrailingTitle } from "../chat-peers";

/**
 * The trailing cell of a `Peers` row: the state word, then the age, as two spans
 * (design round 3, D21 - the shape round 2 asked for and did not ship).
 *
 * WHY TWO SPANS AND NOT ONE STRING. The cell is the row's deadline: at the 240 px
 * clamp the row's fixed costs are the 16 px mark, the device name's 14 `ch` floor
 * (115 px) and two 2 px gaps, which leaves the statement 72 px. `unreachable` alone
 * is ~68 px of that, so the WORD fits and the AGE does not - and the age is what
 * should give way. With one truncated string the truncator cut whichever character
 * came last, i.e. the word (`unreacha…`), because the two halves are one text node.
 * Split, the word is `shrink-0` and only the age can be cut.
 *
 * WHY NOTHING SIZES THE WORD. The cell carries NO `min-w-0`, so as a flex item its
 * automatic minimum is its own min-content - and that min-content is the word,
 * because the age beside it is `min-w-0` and contributes zero. Flex therefore
 * cannot shrink the cell below the word. Round 2 tried `min-w-0` on the CELL and
 * measured a 2.75 px box with the word printing over the rows above it; this is the
 * same property used the other way round, which is why the floor is stated here
 * rather than left to arithmetic. Measured at the clamp after this change: cell
 * 72 px, word 68 px whole, age clipped to nothing, row still inside the panel.
 *
 * WHY 46%. The cap is what fits a three-character age (`unreachable · 10d`, ~99 px)
 * at the 280 px default instead of cutting it to `1…` - a wrong number, which is
 * worse than no number at all (design round 2, D4) - while still yielding the row
 * to the device name at the clamp.
 *
 * WHY THE AGE IS ALLOWED TO DISAPPEAR HERE. Losing it costs the least of the three
 * facts the row carries: the section heading and the row's own `title` both still
 * state it (`peerTrailingTitle`), while the word is the only place a row says a
 * device is unreachable, and the name is the reader's answer to "which device is
 * this?".
 *
 * THE AGE EXISTS ONLY WHERE THE MOVE CONTROL DOES NOT: an unreachable peer is the
 * only one with a detail, and `MoveChatHere` beside this cell is gated on
 * `peer.reachable` in the sidebar. So the 24 px control and the age never compete
 * for one row - which is why this shape holds at both widths, and why it would need
 * re-measuring if a detail were ever added to a REACHABLE peer.
 *
 * `data-peer-trailing-state` / `data-peer-trailing-detail` are the handles the chip
 * suite and the story plays assert on: a caller that went back to rendering the
 * joined string drops the first of them.
 */
export function PeerRowTrailing({
	peer,
	/**
	 * The chat count from the rows THIS SIDEBAR grouped - the same number the peer's
	 * section heading shows, never `peer.session_count` (design round 1, D1).
	 */
	chatCount,
}: {
	peer: PeerRow;
	chatCount: number;
}) {
	const now = Date.now() / 1000;
	const { state, detail } = peerTrailingParts(peer, chatCount, now);
	return (
		<span
			data-peer-row-trailing
			/* THE FULL SENTENCE SURVIVES THE SPLIT, for the reader who hovers and for a
			   screen reader: the word alone is not a statement. */
			title={peerTrailingTitle(peer, chatCount, now)}
			className={cn(
				/*
				 * `min-w-0` IS WHAT MAKES THE AGE GIVE WAY, and it has to be explicit
				 * (measured, not read off the spec). Left to its automatic minimum this
				 * cell cannot shrink at all: the age's `whitespace-nowrap` makes its
				 * min-content its FULL width, so the cell's min-content is the word plus
				 * the age - 93px in the clamp frame - and the row overflowed the panel by
				 * 17px (row 215, scrollWidth 232) rather than yielding the age. With the
				 * floor lifted, flex hands the cell exactly the row's remainder, which at
				 * the 240px clamp is the word's own 70px plus the 2px gap and no more.
				 *
				 * `overflow-hidden` is the belt for a width the app does not allow: at any
				 * width the sidebar clamp permits (240-360) the row's floors - 16 + 2 +
				 * 115 + 2 + 70 = 205 of the 207 a 240px row has - keep the word whole, and
				 * below that the cell CLIPS rather than painting the word over the rows
				 * above it, which is what round 2 measured when this was tried with the
				 * word inside the truncating node.
				 */
				"flex min-w-0 max-w-[46%] items-baseline justify-end gap-0.5 overflow-hidden text-right text-meta tabular-nums",
				/* Warning ink for unreachable is the design's; the words carry it too, so
				   the colour is never the only channel. */
				peer.reachable ? "text-ink-dim" : "text-warning",
			)}
		>
			<span data-peer-trailing-state className="shrink-0 whitespace-nowrap">
				{state}
			</span>
			{detail !== null && (
				<span
					data-peer-trailing-detail
					className="min-w-0 truncate whitespace-nowrap"
				>
					{/*
					 * THE SEPARATOR TRAVELS WITH THE AGE, and it keeps its own leading
					 * space ({` · ${detail}`}), which is what makes a vanishing age clean
					 * rather than a smudge: at the clamp the cell is 72px against a ~68px
					 * word, so the age gets the remainder - and the remainder is the SPACE
					 * first, then the dot. A separator left behind by its value is the
					 * orphan-`·` failure `chat-search.ts` records from the other list.
					 */}
					{` · ${detail}`}
				</span>
			)}
		</span>
	);
}
