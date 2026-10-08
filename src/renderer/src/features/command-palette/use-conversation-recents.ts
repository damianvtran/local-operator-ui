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
