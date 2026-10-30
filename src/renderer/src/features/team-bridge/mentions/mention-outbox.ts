import type { TeamBridgeMentionRow } from "@shared/api/local-operator/team-bridge-api";

/**
 * The hand-off from a composer's mention tokens to the send that carries them.
 *
 * WHY AN OUTBOX AND NOT ONE MORE ARGUMENT. Between the composer and
 * `TeamBridgeApi.send` sit the page's `submit` and `onSend` (idempotency key,
 * retry-on-conflict, draft journal), which several lanes are rewriting at
 * once. Threading `mentions` through each signature would conflict with all of
 * them. Instead the composer STAGES the rows for (conversation, body) just
 * before it submits, and the two send mutations (channel and thread) read them
 * by the same pair at the moment they build the request.
 *
 * Keyed by the trimmed body because that is exactly what the page sends
 * (`content.trim()`), so a staged entry can only attach to the message whose
 * text produced it. It is PEEKED, not taken, so the page's retry paths (the
 * 409 auto-retry, a manual retry of the same text) send the same mentions; an
 * accepted send clears it. A later different message never matches.
 */
const staged = new Map<string, readonly TeamBridgeMentionRow[]>();
const MAX_STAGED = 32;

const keyOf = (conversationId: string, body: string) =>
	`${conversationId}\u0000${body.trim()}`;

export function stageMentions(
	conversationId: string,
	body: string,
	rows: readonly TeamBridgeMentionRow[] | undefined,
): void {
	const key = keyOf(conversationId, body);
	staged.delete(key);
	if (!rows || rows.length === 0) return;
	staged.set(key, rows);
	// Insertion-ordered: drop the oldest abandoned entries first.
	while (staged.size > MAX_STAGED) {
		const oldest = staged.keys().next().value;
		if (oldest === undefined) break;
		staged.delete(oldest);
	}
}

export function stagedMentions(
	conversationId: string,
	body: string,
): readonly TeamBridgeMentionRow[] | undefined {
	return staged.get(keyOf(conversationId, body));
}

export function clearStagedMentions(
	conversationId: string,
	body: string,
): void {
	staged.delete(keyOf(conversationId, body));
}
