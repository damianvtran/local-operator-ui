import { ArrowLeftRight } from "lucide-react";

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
 */
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
			<ArrowLeftRight
				aria-hidden="true"
				// `ink-dim` rather than `ink-disabled`: an unreachable peer's row still
				// opens its cached transcript, so the mark says "not live", not "off".
				className={reachable ? "size-4 text-ink-muted" : "size-4 text-ink-dim"}
			/>
			<span className="sr-only">
				{reachable ? `On ${owner}, ` : `On ${owner}, unreachable, `}
			</span>
		</span>
	);
}
