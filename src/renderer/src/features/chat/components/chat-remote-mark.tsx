/**
 * The locality mark: the one glyph a remote row carries in the sidebar.
 *
 * WHY A MARK AND NOT A SECTION: remote rows merge into the ordinary bins (the
 * shared convention `canonical-sessions-store.ts` names), so there is no peer
 * heading to say where a row runs - the row itself must, and the mark is that
 * statement. It sits FIRST in the row, before the status glyph, for the reason
 * the archived marker states one slot over: the trailing slot admits exactly one
 * statement, and a leading fact cannot be truncated away or compete for it.
 *
 * THE GLYPH IS A CROSS-SURFACE DECISION (design round, 2026-10-05): the mark is
 * the "elsewhere / external" arrow - `↗` in the TUI's own register - rather than
 * a two-way arrow, which read as "sync". An owner that did not answer draws the
 * SAME arrow with ONE quiet stroke across it (`↛`), same ink, same cell, no
 * reflow: unreachable is visible at rest in the row's own register, and the
 * tooltip only expands it (the sibling surface's D2 sentence, applied here).
 * The stroke's path carries `data-remote-mark-stroke`, so this state is
 * addressable by tests and the evidence rig without pixel-hunting.
 *
 * WHY AN INLINE SVG AND NOT A LUCIDE COMPONENT: lucide has no "arrow with
 * stroke", and the two states must be ONE element that cannot reflow when a
 * link drops - so the arrow's own two paths and the stroke live here, drawn to
 * lucide's own geometry (24 box, 2 width, round joins) to hold the cluster's
 * optical weight.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY. No `title`: the row's hover channel is
 * its flyout (the native `title` was deleted for it), and a nested `title` on a
 * glyph inside the row's button would open a second tooltip over the first -
 * review round 1's MINOR 1 on the subagent marks is the same defect. The WORDS
 * are the row's: the flyout's own line and the `sr-only` sentence beside the
 * title both read them from `remoteClause` (chat-remote.ts), which speaks the
 * unreachable reason when the wire carries one, so the two channels cannot
 * disagree about which device and network a row is on - or that it did not
 * answer.
 *
 * `data-remote-mark` is the hook this change's tests and its evidence rig address
 * the mark by, following the row's existing convention (`data-session-time`,
 * `data-session-archived`, `data-subagent-mark`).
 */
import type { FC } from "react";

export const ChatRemoteMark: FC<{ unreachable: boolean }> = ({
	unreachable,
}) => (
	<svg
		aria-hidden="true"
		data-remote-mark
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		className="size-3.5 shrink-0 text-ink-dim"
	>
		{/* The "elsewhere" arrow: head at the top-right, along the shaft. */}
		<path d="M7 7h10v10" />
		<path d="M7 17 17 7" />
		{/*
		 * The stroke, drawn only when the owner did not answer: one line across
		 * the shaft, short of the head so the arrow still reads as an arrow.
		 */}
		{unreachable && <path data-remote-mark-stroke d="M9 9 15 15" />}
	</svg>
);
