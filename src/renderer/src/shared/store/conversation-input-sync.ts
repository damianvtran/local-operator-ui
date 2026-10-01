/**
 * Cross-document convergence for the composer's draft store (risk R5).
 *
 * THE PROBLEM. `conversation-input-store` persists WHOLE-STATE to one
 * localStorage key, and until the mini restyle only one document ever wrote
 * it. The mini view now mounts the shared composer, so TWO documents (the main
 * window and the mini view) hold independent in-memory copies and each writes
 * its full copy on every change. Without a sync the last writer's copy wins on
 * the next boot, so a draft typed in one document can be resurrected or
 * silently dropped by the other - and the same seat conversation's draft can
 * diverge between the two windows while both are open.
 *
 * THE FIX, and why it is this one. The platform's own `storage` event already
 * tells each document when another document wrote the key; re-hydrating on that
 * event converges both copies without a new transport and without changing the
 * store's shape. Deliberately NOT `${key}` namespacing for the mini's drafts:
 * the seat conversation's draft is the same draft whether it is read in the
 * chat pane or the quick-send popup, and two rows for one draft would make
 * "which box holds my text" depend on which window was last seen.
 *
 * THE FOCUS GUARD, which is the whole safety argument. A `storage` event
 * arrives only in the OTHER documents, and re-hydration REPLACES the map: if
 * the receiving document is the one the user is typing in, absorbing the other
 * document's copy could replace an in-flight keystroke's row with a version
 * from before it. `document.hasFocus()` is the edit-in-progress test - the
 * platform keeps focus on exactly one document - so an unfocused document
 * (the hidden mini; the main window behind an open popup) absorbs every write
 * and a focused one absorbs none. When the focused document writes next, its
 * copy is the one that propagates, so the pair converges either way.
 *
 * Idempotent install: one listener per document, module-scope flag, and the
 * installers are the two document entries (`main.tsx` and the mini's), not
 * React components - the listener must outlive every render.
 */

import { useConversationInputStore } from "./conversation-input-store";

/**
 * Whether a storage event means "adopt the writer's copy".
 *
 * Pure and exported so the desktop suite drives every arm without a window:
 * the key must match the store's persist name, and the receiving document
 * must NOT be focused (see the module note for the exposure the focus arm
 * closes).
 */
export function shouldAdoptStorageWrite(input: {
	eventKey: string | null;
	storeKey: string;
	focused: boolean;
}): boolean {
	return input.eventKey === input.storeKey && !input.focused;
}

let installed = false;

/** Install the sync for this document. Safe to call more than once. */
export function installConversationInputSync(): void {
	if (installed) return;
	installed = true;
	const storeKey =
		useConversationInputStore.persist?.getOptions?.()?.name ??
		"conversation-input-store";
	const onStorage = (event: StorageEvent): void => {
		if (
			!shouldAdoptStorageWrite({
				eventKey: event.key,
				storeKey,
				focused: document.hasFocus(),
			})
		) {
			return;
		}
		/*
		 * A failed re-hydration is left as the in-memory state it was: the next
		 * write from either document re-raises the event, so a swallowed error
		 * here heals on the next edit rather than needing a surface.
		 */
		void useConversationInputStore.persist?.rehydrate?.()?.catch?.(() => {});
	};
	window.addEventListener("storage", onStorage);
}
