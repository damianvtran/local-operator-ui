/**
 * WHICH TAB THE READER IS ON AFTER A CLOSE, as one rule with one home.
 *
 * Closing a tab is a repeated gesture - close, close, close - so the tab the
 * close leaves selected decides what the NEXT close costs. The rule readers
 * already have from Chrome, VS Code and Safari, and the one the ARIA tabs
 * pattern states, is the neighbour: the tab FOLLOWING the closed one, or the
 * PRECEDING one when the closed tab was last.
 *
 * It lives here rather than inline at each site because there are three of them
 * - the ✕ handler in `chat-content.tsx`, the same handler in `canvas/index.tsx`,
 * and the strip's own focus move in `canvas-tabs.tsx` - and they must agree: if
 * the strip focused one tab while the pane selected another, a close would leave
 * focus and selection on two different documents. A rule copied three times is a
 * rule that will disagree with itself, which is the same reason `file-tiles.ts`
 * and `viewer-routing.ts` beside it are modules rather than component bodies.
 *
 * WHAT IT IS NOT. It is not a "first remaining tab" fallback: that is what the
 * sites this replaces did, and it is wrong in the ordinary overflowing strip - a
 * five-document row scrolls, and the strip scrolls the SELECTION into view
 * (`canvas-tabs.tsx`), so landing on the oldest document slides the whole row
 * back to the left under the pointer and the next close costs a scroll and a
 * re-select. `null` means "there is nothing left", which is the empty state and
 * not a tab.
 *
 * The list passed in is the one the strip renders (the conversation's open
 * `files`, in order) and `closedId` is expected to still be IN it - the caller
 * runs before the removal. An id that is not found yields `null` rather than the
 * first tab, because a close of something that was never open leaves nothing to
 * move to and guessing would move the reader off the document they are reading.
 */
export function tabFollowingClose<T extends { id: string }>(
	documents: T[],
	closedId: string,
): T | null {
	const closedAt = documents.findIndex((document) => document.id === closedId);
	if (closedAt === -1) return null;
	return documents[closedAt + 1] ?? documents[closedAt - 1] ?? null;
}
