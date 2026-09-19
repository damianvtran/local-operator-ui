import type { WebauthnChoiceRequest } from "@features/browser/model/webauthn-chooser";
import { useCallback, useSyncExternalStore } from "react";

/**
 * The renderer's mirror of main's pending passkey choosers.
 *
 * WHY THIS LIVES IN `shared/` AND NOT UNDER `features/browser/`, the same reason
 * `browser-consent-attention` does: the event arrives at the APP SHELL, and the
 * shell is what has to act on it. The previous version subscribed inside
 * `BrowserSurface`, which is mounted only on the browser route or as the chat
 * side pane — so a request raised while the user was anywhere else was pushed to
 * nobody, and leaving the surface and coming back did not bring it back either
 * (agent review round 1, finding 1 MAJOR; UX round 1, U2 MAJOR). The consent
 * queue paid for exactly this defect once already and was fixed by moving its
 * subscription to the shell; this module is that shape applied to passkeys.
 *
 * MAIN IS THE SOURCE OF TRUTH. This holds a MIRROR: `pending` adds, `settled`
 * removes, and a mount of the prompt replaces the whole set with main's own
 * answer (`browser-webauthn-pending`). Nothing here decides whether a request is
 * outstanding — otherwise the surface and the chooser could disagree about it,
 * which is the class of bug this whole change is closing.
 *
 * ORDER IS MAIN'S OWN: oldest first, so the request the user has been ignoring
 * longest is the one on screen and the newer ones are named as waiting rather
 * than silently replacing it (agent review round 1, finding 7).
 */

let pending: WebauthnChoiceRequest[] = [];
const listeners = new Set<() => void>();

function publish(next: WebauthnChoiceRequest[]): void {
	pending = next;
	for (const listener of listeners) listener();
}

/**
 * A request main has raised. Re-adding one that is already mirrored REPLACES it
 * rather than appending a second copy: a duplicate would render two rows of
 * buttons for one credential, and Electron's payload is the same either way.
 */
export function noteWebauthnRequest(request: WebauthnChoiceRequest): void {
	const index = pending.findIndex(
		(entry) => entry.requestId === request.requestId,
	);
	if (index === -1) {
		publish([...pending, request]);
		return;
	}
	const next = pending.slice();
	next[index] = request;
	publish(next);
}

/**
 * Main's own answer to "what is still waiting". Called when the prompt mounts, so
 * a request raised while nothing was listening is recoverable rather than lost.
 *
 * MERGED rather than overwritten (agent review round 2, N1). The reply and a
 * concurrent push are ordered today only because main sets its pending entry
 * BEFORE it notifies, so anything the renderer has seen is already in the
 * snapshot it pulls; overwriting was correct by that ordering coincidence and
 * would silently drop a request if the two adjacent lines in `webauthn.ts` were
 * ever reordered. Entries main's snapshot does not know about are kept, appended
 * in arrival order, and the settle push is what removes a request main no longer
 * holds.
 */
export function replaceWebauthnRequests(
	requests: WebauthnChoiceRequest[],
): void {
	const known = new Set(requests.map((entry) => entry.requestId));
	publish([
		...requests,
		...pending.filter((entry) => !known.has(entry.requestId)),
	]);
}

/**
 * A request main has settled. Returns what it was, so a caller can explain an
 * outcome the user did not cause — the mirror itself only records that the
 * request is gone.
 */
export function clearWebauthnRequest(
	requestId: string,
): WebauthnChoiceRequest | null {
	const index = pending.findIndex((entry) => entry.requestId === requestId);
	if (index === -1) return null;
	const removed = pending[index];
	publish(pending.filter((entry) => entry.requestId !== requestId));
	return removed;
}

export function webauthnRequestsSnapshot(): WebauthnChoiceRequest[] {
	return pending;
}

export function subscribeWebauthnRequests(callback: () => void): () => void {
	listeners.add(callback);
	return () => {
		listeners.delete(callback);
	};
}

/** The pending choosers, oldest first. */
export function useWebauthnRequests(): WebauthnChoiceRequest[] {
	return useSyncExternalStore(
		useCallback(subscribeWebauthnRequests, []),
		webauthnRequestsSnapshot,
		webauthnRequestsSnapshot,
	);
}
