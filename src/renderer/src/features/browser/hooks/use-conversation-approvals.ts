import { useConversationBrowserSummaries } from "./use-conversation-browser-summaries";

/**
 * How many approvals THIS conversation is waiting on, for the chat header's Globe
 * trigger badge.
 * Design: docs/design/browser-approval-ux.md 5.1 (the badge's grammar), 7.2
 * (requests are scoped by requester), 7.3 (the trigger carries the badge).
 *
 * WHY THIS EXISTS SEPARATELY FROM THE PANE'S OWN MODEL, and why it is not simply
 * read off the pane: the trigger is in the chat header, which is mounted whether or
 * not the pane is, and the badge's whole job is to say "an agent in THIS
 * conversation is waiting on you" to a user who has not opened the pane. So the
 * count has to exist while the pane does not — and the pane's own instance of the
 * model goes away with the pane.
 *
 * IT USED TO BE THE SAME COUNT AS THE SIDEBAR MARK'S (design R2), and that mark is
 * gone (operator ask, 2026-09-18): the change of mechanism it made is kept, because it
 * is the half that was ever load-bearing. Both the badge and the deleted mark read
 * `summariseConversations` over the one shared projection, so a conversation's badge
 * here cannot disagree with the pane's tray; the badge is now the only surface drawing
 * it, and the rule is unchanged — live requests (`expiresAt > now`) whose requester is
 * this conversation, counted off the app's single clock. What the deletion costs is
 * stated where it belongs: nothing in the chrome now surfaces ANOTHER conversation's
 * waiting request without opening the browser.
 *
 * A DRAFT OWNS NO REQUESTS: with no session id the count is zero rather than every
 * request in the app. A chat whose header badge counted another conversation's
 * approval would be telling the user to answer a prompt that is not theirs.
 */
export function useConversationApprovals(sessionId: string | null): number {
	const { summaries } = useConversationBrowserSummaries();
	// `undefined` is "no browser here" (see the summaries hook), which is also "no
	// requests to wait on" — so the badge is zero rather than a second branch.
	if (!sessionId || !summaries) return 0;
	return summaries.get(sessionId)?.pendingApprovals ?? 0;
}
