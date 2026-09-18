/**
 * The composer's text field, as the surfaces that look for it identify it.
 *
 * A module of its own rather than a constant beside the component, because two
 * things that are NOT in the same file need the same name for the same element,
 * and a second copy of a selector is how one of them quietly stops matching the
 * field it means:
 *
 * - `message-input.tsx` reads it to decide whether the composer holds focus
 *   (`composerHoldsFocusUntouched`, called from `chat-page.tsx`'s layout effect,
 *   outside this component's render - which is why it is queried rather than
 *   held in a ref);
 * - `hooks/use-interrupt-on-escape.ts` reads it as the identity of the ONE field
 *   that does not own Escape for itself. Every other text field on the page
 *   (the sidebar's search, the working-directory chip's inline edit) consumes
 *   Escape without announcing it, so the escape ladder defers to them by name;
 *   deferring to the composer too would make the interrupt key unreachable from
 *   the place it is most wanted.
 *
 * A leaf module on purpose: the escape ladder is bundled on its own by
 * `scripts/interrupt-control.test.mjs`, and a selector reached through a
 * component module would drag that component's whole import graph in with it.
 * `aria-label="Message"` is the same handle the answer options are found by.
 */
export const COMPOSER_TEXTAREA_SELECTOR = 'textarea[aria-label="Message"]';

/*
 * The composer's own focus hand-off, as surfaces OUTSIDE the composer reach it.
 *
 * The transcript's Quote toolkit needs this: a press stages a quote, and the
 * reader's next act is writing the message that quote belongs to, so the press
 * has to leave the caret in the box. It cannot reach `MessageInput`'s imperative
 * handle - the toolkit is rendered by `canonical-transcript.tsx`, several
 * component boundaries away from the composer, and neither the transcript nor
 * the rows in it are given that handle - so the hand-off is registered here, in
 * the module that already exists to name this one element for the surfaces that
 * must find it without being handed it (see `composerHoldsFocusUntouched`).
 *
 * The registration carries the composer's OWN `focusInput` rather than
 * reimplementing it, because that function is the single place focus is given:
 * it also clears the "the user took the box" flag the ask gate reads. A second
 * implementation here that focused the textarea directly would leave that flag
 * set and make the next automatic hand-off think the user had moved on.
 *
 * ONE SLOT, because there is one composer: the app mounts `MessageInput` once
 * (`chat-content.tsx`), and a story mounts one of its own. Unregistering is
 * scoped to the function that registered, so a remount cannot leave a stale
 * composer's node behind for the next press to focus. `focusComposer` is a
 * no-op when nothing is registered - the composer unmounted while a
 * transcript was still on screen - which is the honest outcome rather than
 * throwing into an event handler.
 *
 * THE SLOT CARRIES THE NODE AS WELL AS THE HAND-OFF, because a caller that
 * wants to report WHERE the caret landed has to be able to name the same
 * element it just focused (review round 1, NIT 1). A caller that queries the
 * document for a composer instead can name a DIFFERENT one - a second
 * `MessageInput` mounted by a story or a rig is enough - and then answer
 * `false` about a focus that worked. `composerField` is that name, and it is
 * deliberately a read, not a query: the registry is the only thing that knows
 * which composer this app has.
 */
let composer: {
	give: () => void;
	field: () => HTMLTextAreaElement | null;
} | null = null;

/**
 * Register the composer's focus hand-off and the node it focuses; returns the
 * unregister.
 *
 * `field` is a getter rather than an element because the textarea's identity
 * changes with the pane (`SessionPanel` is keyed on the conversation) while the
 * registration is an effect keyed on the callback.
 */
export function registerComposerFocus(
	give: () => void,
	field: () => HTMLTextAreaElement | null,
): () => void {
	composer = { give, field };
	return () => {
		if (composer?.give === give) composer = null;
	};
}

/** The node the registered hand-off focuses, or `null` when none is registered. */
export function composerField(): HTMLTextAreaElement | null {
	return composer?.field() ?? null;
}

/** Ask the mounted composer to take focus, if there is one. */
export function focusComposer(): void {
	composer?.give();
}
