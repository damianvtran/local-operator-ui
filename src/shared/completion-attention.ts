/** Shared by the sidebar receipt set and the native app projection. A stored
 * unseen watermark alone is not an ackable completion: a running/gated status
 * takes precedence and a missing token cannot name a read. App-icon counts
 * equal the rail pills: the whole-feed isUnreadAckableCompletion set
 * deliberately does NOT reach the badge. Only the visible Aida rail subset
 * contributes a completion number; ordinary session marks are not rail pills.
 */
export type UnreadCompletionKind = "complete" | "error" | "interrupted";

export interface CompletionAttentionRow {
	attention?: { unseen: boolean; completion_token: string | null } | null;
	status?: { code: string } | null;
}

export function unreadCompletionKind(
	row: CompletionAttentionRow,
): UnreadCompletionKind | null {
	if (row.attention?.unseen !== true) return null;
	const code = row.status?.code;
	return code === "complete" || code === "error" || code === "interrupted"
		? code
		: null;
}

/** The Aida rail pill, shared with app-main: ordinary session unread marks
 * are not rail pills and must not silently inflate the app-icon number. */
export function aidaMissedMessages(
	rows: (CompletionAttentionRow & { session_id: string })[],
	sessionId: string | null | undefined,
): number {
	return sessionId
		? rows.filter(
				(row) => row.session_id === sessionId && isUnreadAckableCompletion(row),
			).length
		: 0;
}

export function isUnreadAckableCompletion(
	row: CompletionAttentionRow,
): boolean {
	if (unreadCompletionKind(row) === null) return false;
	const token = row.attention?.completion_token;
	return typeof token === "string" && token.length > 0;
}
