import { cn } from "@shared/lib/utils";
import { ArrowLeftRight, Unlink } from "lucide-react";

/**
 * The locality mark: a 16 px `⇄` drawn as the FIRST child of a conversation row
 * whose conversation lives on another device (`mesh-ui.md` §2.3).
 *
 * WHY ONLY ON REMOTE ROWS, and never a reserved slot on every row. The sidebar is
 * 280 px by default (clamped 240-360), and a row is a 16 px status glyph, a
 * truncating title and exactly one trailing statement - which leaves the title
 * 179 px at the default width. A second icon reserved list-wide costs 20 px (the
 * 16 px glyph plus the row's 4 px gap), about 11% of that title, on EVERY row, to
 * say something true of NO row in the common case (one device, no network). The
 * repo's own rule, from the search mark, is to render a mark on the rows that
 * carry it and never reserve it; so a remote row pays 20 px and a local row's
 * geometry is unchanged by this component's existence.
 *
 * WHY NOT THE TRAILING SLOT: it is capped at one claim (`rowTrailingStatement` in
 * `chat-search.ts` records the three layouts that failed when it admitted more),
 * and it already belongs to the search mark, `· Not sent yet` or the binding.
 *
 * WHY THE MARK SURVIVES THE PEER HEADING: in the sectioned list the peer's heading
 * already says where the rows live, but the flat `All chats` list and a search
 * have no heading - the mark is the ONLY annotation there. One mechanism, both
 * lists.
 *
 * Accessibility follows `chat-session-status.tsx`: the glyph is `aria-hidden` and
 * the meaning is an `sr-only` sentence; the peer's name is in the row's flyout.
 *
 * `reachable` false dims the MARK alone (`text-ink-dim`, a colour step - never
 * opacity, branding § 6). The row's status glyph keeps its own ink, because a
 * cached row's status is its truth as of the last sync and must not read as
 * disabled (§2.5, S4).
 *
 * TWO DRAWINGS, ONE MEANING EACH (design round 1, D2 and D6). `RemoteGlyph` is the
 * single place the motif is drawn, and it draws exactly two shapes: the paired
 * arrows for a peer that answers, and `Unlink` for one that does not. Before this,
 * the SAME arrow shape appeared mirrored for two different meanings - the heading's
 * font glyph `⇄` read as decoration while lucide's `ArrowLeftRight` (which draws
 * `⇆`) meant "lives elsewhere", and the flat list told an unreachable row apart from
 * a live one by a 1.38:1 ink step alone, i.e. by colour only, which §2.5 exists to
 * avoid. The shape now carries it: distinguishable in greyscale.
 */
export function RemoteGlyph({
	reachable,
	className,
}: {
	reachable: boolean;
	/** Size only: the ink and the shape are decided here, never by the caller. */
	className?: string;
}) {
	// `ink-dim` rather than `ink-disabled`: an unreachable peer's row still opens
	// its cached transcript, so the mark says "not live", not "off".
	const ink = reachable ? "text-ink-muted" : "text-ink-dim";
	if (!reachable) {
		return (
			<Unlink
				aria-hidden="true"
				data-remote-glyph="unreachable"
				className={cn("size-4 shrink-0", ink, className)}
			/>
		);
	}
	return (
		<ArrowLeftRight
			aria-hidden="true"
			data-remote-glyph="reachable"
			className={cn("size-4 shrink-0", ink, className)}
		/>
	);
}

export function ChatRemoteMark({
	owner,
	reachable,
}: {
	/** The owning device's label, as `ownerLabel` spells it. */
	owner: string;
	reachable: boolean;
}) {
	return (
		<span data-remote-mark className="flex size-4 shrink-0">
			<RemoteGlyph reachable={reachable} />
			<span className="sr-only">
				{reachable ? `On ${owner}, ` : `On ${owner}, unreachable, `}
			</span>
		</span>
	);
}
