/**
 * Which Team Bridge conversation is on screen right now, for the banner
 * watcher's per-conversation quiet rule.
 *
 * WHY A MODULE CELL AND NOT CONTEXT OR A QUERY. The watcher is mounted in the
 * app shell (`app.tsx`) and the page is mounted by the router below it; the
 * page owns its selection as local state, and the parent lane is still
 * reshaping that state. A one-line report from the page into a cell the
 * watcher reads at notify time is the smallest seam that does not thread a
 * provider through the shell or re-derive the page's selection rule here. It is
 * read only when a banner is about to be raised, so nothing needs to
 * re-render when it changes.
 *
 * WHAT IT IS NOT. It is not the quiet authority: main still decides from the
 * window's real focus. This only tells main WHICH conversation a focused window
 * is showing (`TeamBridgeNotifyRequest.viewing`).
 */
import { useEffect } from "react";

let viewing: string | null = null;

/** The conversation the Team Bridge page is showing, or `null` off the page. */
export function teamBridgeViewingConversation(): string | null {
	return viewing;
}

/**
 * Report the shown conversation for as long as the caller is mounted.
 *
 * The cleanup clears only its OWN report, so a quick page remount (a route
 * change that mounts the next page before the previous cleanup runs) cannot
 * blank the newer page's value.
 */
export function useReportTeamBridgeViewing(
	conversationId: string | null | undefined,
): void {
	useEffect(() => {
		const id = conversationId ?? null;
		viewing = id;
		return () => {
			if (viewing === id) viewing = null;
		};
	}, [conversationId]);
}
