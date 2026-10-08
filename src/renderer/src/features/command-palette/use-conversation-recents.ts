import { visibleRows } from "@features/chat/chat-archived";
import {
	panelSessionIdOfView,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useEffect } from "react";

/**
 * Record every conversation that becomes the displayed one into the visited
 * ring behind the command palette's Recents section.
 *
 * THE VISIT RULE, in one place: the conversation the app is DISPLAYING
 * (`panelSessionIdOfView`, the shell's own answer, which looks through a staged
 * draft) changed to a non-null id. Reading the displayed value, rather than
 * asking each way of switching to declare itself, is what makes the rule
 * complete: the palette, a sidebar click, a deep link, a notification click and
 * a restored window all move that one value, and none of them has to remember to
 * call anything. A draft with no session yet is undefined and is skipped - there
 * is no conversation to return to.
 *
 * Mounted once, in the app shell beside `useCommandPaletteShortcut()`, because
 * the palette component returns null while closed and the ring has to be filling
 * while it is.
 *
 * `rememberConversation` is a move-to-front, so a repeat of the same id (an
 * effect re-run, a re-select of the open conversation) is a no-op rather than a
 * second entry; `visitedConversationId` is split out so the rule is testable
 * without mounting React (`scripts/palette-recents.test.mjs`).
 */
export function useConversationRecents(): void {
	const displayedSessionId = useCanonicalSessionsStore((state) =>
		visitedConversationId(
			state.activeDraftKey,
			state.activeDraftKey
				? state.drafts[state.activeDraftKey]?.sessionId
				: undefined,
			state.activeSessionId,
		),
	);
	const rememberConversation = useUiPreferencesStore(
		(state) => state.rememberConversation,
	);
	useEffect(() => {
		if (displayedSessionId !== null) rememberConversation(displayedSessionId);
	}, [displayedSessionId, rememberConversation]);
}

/**
 * The id to record for a view, or null when it shows no conversation yet.
 * `panelSessionIdOfView` answers `undefined` for a draft with no session; the
 * empty string is not an id either, so both read as "nothing to remember".
 */
export function visitedConversationId(
	activeDraftKey: string | null,
	draftSessionId: string | null | undefined,
	activeSessionId: string | null | undefined,
): string | null {
	const id = panelSessionIdOfView(
		activeDraftKey,
		draftSessionId,
		activeSessionId,
	);
	return id ? id : null;
}

/**
 * The three palette facts a catalogue row and the visited ring decide together,
 * as one pure function.
 *
 * WHY A NAMED EXPORT RATHER THAN THE INLINE DERIVATION IT REPLACES. This is the
 * only place a catalogue row meets the visited ring, and the source hook that
 * carries it (`use-palette-sources.ts`'s `chatItems` memo) cannot be mounted in
 * this repository's node harness - so the join was the one seam no unit test
 * touched: deleting the `current` flag left every palette test green and only the
 * heavy `--scene` rig would have noticed (agent review round 1, R1-1). Extracted,
 * `scripts/palette-recents.test.mjs` exercises it for real instead of through the
 * rig.
 *
 * `recentRank` is the row's index in the ring, 0 being the visit most recent, and
 * `undefined` when the row is not in it - a conversation this window has not
 * displayed lately, which is what keeps the section from drawing at all. The read
 * is `indexOf`, so a DUPLICATED id resolves to its FIRST (most recent) position:
 * the ring's order is a most-recent-first contract, and a hand-edit that duplicated
 * an id must not DEMOTE a row whose visit is the more recent of the two. The write
 * path (`pushConversationRecent`) never produces a duplicate in the first place.
 *
 * `current` is the shell's displayed conversation (`panelSessionIdOfView`, read
 * once by the caller and passed in because a staged draft leaves `activeSessionId`
 * pointing at the conversation the reader came FROM), which the pin leaves out.
 *
 * `archived` is the row's own archive fact, and it is the SIDEBAR'S own rule rather
 * than a second one: `visibleRows` (`chat-archived.ts`) is CALLED, so a backend
 * that advertises no `session_archive` capability partitions nothing and an
 * archived row stays eligible - exactly the arm in which `visibleRows` returns the
 * rows unfiltered. The Recents pin is its only reader (QA round 1, Q-1).
 */
export function chatRecentsOfRow(
	row: { session_id: string; archived?: boolean },
	ring: readonly string[],
	displayedSessionId: string | null | undefined,
	archiveEnabled: boolean,
): { recentRank?: number; current: boolean; archived: boolean } {
	const rank = ring.indexOf(row.session_id);
	return {
		recentRank: rank === -1 ? undefined : rank,
		current: row.session_id === displayedSessionId,
		/* The row is "archived out of view" precisely when the sidebar's own list
		 * would drop it: `visibleRows` returns the row unfiltered with no capability
		 * and drops it only when `archived === true` with the capability on. */
		archived: visibleRows([row], archiveEnabled).length === 0,
	};
}
