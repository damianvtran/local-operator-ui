/**
 * The pane's sentence for a conversation this machine does not have, named for
 * the two surfaces that are NOT in the same file.
 *
 * A module of its own for the reason `composer-field.ts` is one: the element and
 * the reference to it live in different components, and a second spelling of the
 * id is how one of them quietly stops describing the other.
 *
 * - `canonical-transcript.tsx` RENDERS it: "This conversation is no longer on
 *   this machine." is the pane's statement of the state, and its way out
 *   (`Start a new chat`) sits under it.
 * - `components/message-input.tsx` POINTS at it: a composer that refuses input
 *   is the one control whose own reason a reader cannot otherwise reach (UX
 *   round 1, U3). The box's placeholder states the refusal only while the box is
 *   EMPTY, and the state this exists for is a box holding the reader's own words;
 *   a screen reader parked there heard the value and "read-only" and never why.
 *   `aria-describedby` is what carries the sentence to the control - see the
 *   textarea's own note for why the association is the honest fix rather than a
 *   live announcement.
 *
 * The transcript is not a dependency of the composer and must not become one
 * (the composer is mounted alone by stories and by the measurement rigs), so the
 * id is the whole contract and not the sentence: the composer names the element,
 * and an element that is not in the document is an ignored reference rather than
 * a broken one, which is what a composer without a transcript gets.
 */
export const MISSING_SESSION_NOTICE_ID = "lo-missing-session-notice";
