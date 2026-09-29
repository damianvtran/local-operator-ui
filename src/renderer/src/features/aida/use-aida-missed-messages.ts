/**
 * How many missed messages her rail row's badge carries.
 *
 * WHAT THE NUMBER COUNTS, and it is narrowed twice before it reaches the badge
 * (operator ask, 2026-09-28: "a count/notification badge that indicates how many
 * missed messages"). The source is the attention/receipts system - the durable
 * state the sidebar's unread mark and `use-completion-view`'s read receipt both
 * move - and that system exposes ONE current completion plus `unseen`, a LEVEL,
 * per conversation: `state_many` reports the conversation's newest completion's
 * token (`local_operator/session/attention.py`, `_state_many_once`), and the
 * store's older unacknowledged rows are not served as a count, so the largest
 * number this client can derive per session is 1 - the receipt a `/seen` can
 * name and clear. The count therefore says "one missed message" when she has an
 * unread receipt, in the words the badge's accessible name carries.
 *
 * SECOND NARROWING, the app's OWN predicate: the count reads `unreadAckableRows`
 * (a DRAWN mark AND a completion token), not bare `unseen`, so a row whose live
 * state has taken it over (a spinner, a parked gate) or a mark no gesture can
 * clear does not put a number on the rail that viewing her conversation cannot
 * take off it. That is the same set the bulk control counts, for the same
 * reason: one fact, one derivation.
 *
 * WHY A HOOK RATHER THAN A FIELD READ AT RENDER: the count must move LIVE. The
 * machine-wide feed publishes an attention frame when her turn completes (the
 * badge appears), and the read receipt clears the same state when her
 * conversation is viewed (the badge goes) - so the rail subscribes to the store
 * the way `useAppWideApprovals` subscribes to the browser projection.
 */
import {
	type CanonicalSessionRow,
	unreadAckableRows,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";

/** The pure half, so the count's rules are executable in the desktop suite. */
export const aidaMissedMessages = (
	sessions: CanonicalSessionRow[],
	sessionId: string | null | undefined,
): number =>
	sessionId
		? unreadAckableRows(sessions.filter((row) => row.session_id === sessionId))
				.length
		: 0;

/** Her session's count, kept current as the store moves. */
export function useAidaMissedMessages(
	sessionId: string | null | undefined,
): number {
	return useCanonicalSessionsStore((state) =>
		aidaMissedMessages(state.sessions, sessionId),
	);
}
