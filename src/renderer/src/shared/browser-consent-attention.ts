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
