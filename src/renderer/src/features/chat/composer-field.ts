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
