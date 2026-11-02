/** Shared by the sidebar receipt set and the native app projection. A stored
 * unseen watermark alone is not an ackable completion: a running/gated status
 * takes precedence and a missing token cannot name a read. Aida presents this
 * same session set, so it must never be added as another attention source.
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

export function isUnreadAckableCompletion(
	row: CompletionAttentionRow,
): boolean {
	if (unreadCompletionKind(row) === null) return false;
	const token = row.attention?.completion_token;
	return typeof token === "string" && token.length > 0;
}
