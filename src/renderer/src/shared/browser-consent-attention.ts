import { useCallback, useSyncExternalStore } from "react";

/**
 * Which pending consent request a banner click asked to see.
 *
 * WHY THIS IS IN `shared/` AND NOT UNDER `features/browser/`, the same reason
 * `browser-view-policy` is: the event arrives at the APP SHELL, and the shell is
 * what has to act on it. A native banner is raised for a request the user cannot
 * see, because the window may be on another Space or behind something (design 9.2),
 * and the click is only useful if it reaches the user wherever they are — on chat,
 * on settings, on any route at all.
 *
 * THE BUG THIS EXISTS FOR (review round 1, R8): the only subscriber to
 * `browser-consent-attention` lived inside `BrowserPage`, which is exactly the
 * component that is NOT mounted when the user is somewhere else. So the one
 * situation the banner exists for — the browser route not being on screen — was the
 * one where its click did nothing. Meanwhile, already ON the browser route, the
 * click only re-read state and did not name which of several pending requests was
 * meant. Two halves of one failure, and this module is the state that fixes both:
 * the shell navigates, and the browser surface renders the request that was named.
 *
 * It is deliberately a single `entryId` rather than a queue. Attention is a
 * momentary instruction ("show me THIS one"), and the pending set itself already
 * lives in the host's own queue — a second queue here would be a second truth about
 * which requests are outstanding.
 */

/** The entry a banner click named, or null. */
let attention: string | null = null;
const listeners = new Set<() => void>();

/**
 * The `entryId` is OPAQUE and is never rendered: it is the host's own handle for the
 * pending entry, and naming it in the UI would put a wire identifier in front of a
 * user who is choosing between sites. It is used only to pick which entry the band
 * shows.
 */
export function noteConsentAttention(entryId: string): void {
	if (entryId === attention) return;
	attention = entryId;
	for (const listener of listeners) listener();
}

/**
 * Forget the attention when the request it names is gone, or when the user has
 * answered it. Called with the entry id so a late clear cannot drop the attention
 * for a NEWER request that arrived while the older one was being answered.
 */
export function clearConsentAttention(entryId?: string): void {
	if (attention === null) return;
	if (entryId !== undefined && attention !== entryId) return;
	attention = null;
	for (const listener of listeners) listener();
}

export function consentAttentionSnapshot(): string | null {
	return attention;
}

export function subscribeConsentAttention(callback: () => void): () => void {
	listeners.add(callback);
	return () => {
		listeners.delete(callback);
	};
}

/** The entry a banner click named, for as long as it is still pending. */
export function useConsentAttention(): string | null {
	return useSyncExternalStore(
		useCallback(subscribeConsentAttention, []),
		consentAttentionSnapshot,
		consentAttentionSnapshot,
	);
}

/** One conversation, as much of it as a landing decision needs. */
export interface NamedConversation {
	session_id: string;
}

/**
 * Where a banner click should land, from the requester it carried.
 *
 * WHY THE ASKING CONVERSATION WINS WHEN IT IS KNOWN (operator ask, 2026-09-23,
 * reversing the decision recorded at design 7.3): the click's promise is "show me
 * the request you told me about", and the conversation-scoped pane is the surface
 * that shows it beside the work it belongs to. The earlier ruling rejected that
 * because a click must work "from anywhere without knowing which conversation is
 * open" — and it does: nothing here reads the currently open conversation, so the
 * target is the same on every route. What the ruling was right about is the
 * FALLBACK, which is exactly what an unattributed request gets: the browser route,
 * the one surface that shows a request no conversation owns.
 *
 * MEMBERSHIP, NOT A TITLE LOOKUP: the question is whether the app can SHOW that
 * conversation, and a conversation whose title has not landed yet is still one the
 * sidebar lists. The list handed in is the same one the sidebar and the consent
 * card read, so a click cannot land on a conversation the card would have called
 * unattributed — and a subagent's own session, which is a valid requester but is
 * not a conversation in that list, falls back rather than opening a conversation
 * that does not exist.
 *
 * PURE AND OUT OF THE SHELL so the rule can be asserted without a window: the
 * shell's job is the navigation, not the arithmetic (the same split
 * `browser-view-policy` and `new-chat-shortcut` already use).
 */
export function consentClickTarget(
	requesterSessionId: string | null,
	sessions: ReadonlyArray<NamedConversation>,
): { kind: "conversation"; sessionId: string } | { kind: "browser" } {
	if (requesterSessionId === null) return { kind: "browser" };
	const known = sessions.some((row) => row.session_id === requesterSessionId);
	return known
		? { kind: "conversation", sessionId: requesterSessionId }
		: { kind: "browser" };
}

/**
 * Whether a surface may FORGET which request a banner click named.
 *
 * The memory exists so a click can land on the request it names, and it has to be
 * dropped once that request is genuinely gone — otherwise a later arrival inherits
 * an answer given to an earlier one (review round 1, R8). What it must NOT do is
 * treat "I have not read the queue yet" as "that request is gone", which is what
 * the first version did: the click arrives on a route where the surface is not
 * mounted, the shell navigates, the surface mounts with `state === null`, its
 * pending list is empty, and the effect dropped the attention before the read that
 * would have shown it landed. `landed` is that distinction, and it is passed in
 * rather than inferred because only the caller knows whether it holds a projection.
 *
 * `named` is the entry the surface found in the list it is showing, in scope: an
 * attention whose entry is out of scope here is one this surface cannot show, so
 * clearing it is the honest answer — the surface that CAN show it is a navigation
 * away.
 */
export function shouldForgetConsentAttention(
	attention: string | null,
	named: unknown,
	landed: boolean,
): boolean {
	if (attention === null || !landed) return false;
	return named === undefined || named === null;
}
