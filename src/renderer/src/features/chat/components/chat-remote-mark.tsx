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
 * WHAT IT DELIBERATELY DOES NOT CARRY. No `title`: the row's hover channel is
 * its flyout (the native `title` was deleted for it), and a nested `title` on a
 * glyph inside the row's button would open a second tooltip over the first -
 * review round 1's MINOR 1 on the subagent marks is the same defect. The WORDS
 * are the row's: the flyout's own line and the `sr-only` sentence beside the
 * title both read them from `remoteClause` (chat-remote.ts), so the two channels
 * cannot disagree about which device and network a row is on.
 *
 * `data-remote-mark` is the hook this change's tests and its evidence rig address
 * the mark by, following the row's existing convention (`data-session-time`,
 * `data-session-archived`, `data-subagent-mark`).
 */
import { ArrowLeftRight } from "lucide-react";
import type { FC } from "react";

export const ChatRemoteMark: FC = () => (
	<ArrowLeftRight
		aria-hidden="true"
		data-remote-mark
		className="size-3.5 shrink-0 text-ink-dim"
	/>
);
