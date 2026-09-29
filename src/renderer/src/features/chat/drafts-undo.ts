/**
 * The undo offer a discard stands, and the copy the toast raises with.
 *
 * WHY AN OFFER AT ALL (design round 1, D1; UX round 1, U3). A discard deletes
 * the user's text outright — the draft row and the composer row whole — and the
 * app's own two precedents both refuse a permanent, unnamed, unoffered delete:
 * an archive is recoverable and still offers an Undo, because "a recoverable
 * action with no visible trace is indistinguishable from a delete"
 * (`archive-undo.ts` states the same sentence for its own surface), and a
 * conversation delete is permanent and asks in a dialog that names the thing.
 * The store half of the offer is the snapshot (`DraftsUndoOffer`); this module is
 * the copy, and the toast that draws it — the app's standard sonner toast since
 * 2026-09-27 — is `components/undo-toasts.tsx`.
 *
 * WHERE THE OFFER'S LIFE COMES FROM NOW (2026-09-27, superseding the lane's card
 * life and its ceiling): sonner's own `duration`, `ARCHIVE_UNDO_TOAST_MS` — the
 * same eight seconds both offers share, whose one home is `archive-undo.ts`. The
 * old design ran an 8 s ceiling inside the panel, because the lane's entry was
 * `Infinity`-lived and the panel had to end the message and clear the store slot
 * itself. The slot is still cleared the moment the message ends (auto-close, the
 * close button, the swipe — the `settle` callbacks in `components/undo-toasts.tsx`),
 * so nothing re-draws later; what a ceiling cannot do any more is end a message
 * the reader is HOLDING, which is exactly what hover-pause is for. Nothing else
 * about the retirement rule moved: it never watched an answer (unlike the
 * archive's), because a discard is a LOCAL write.
 *
 * THE RETIREMENT RULE, in one sentence: the offer stands until its message ends,
 * and nothing ends it early. The archive's rule watches an answer because the
 * server can contradict it; a discard is this window's own fact, so the only ways
 * the offer ends are the message's own end, the reader's own Undo, or a second
 * discard replacing it (the store keeps ONE slot, `DraftsUndoOffer`).
 */

/**
 * The count an offer prints, with the verb left outside it.
 *
 * TWO PARTS RATHER THAN ONE SENTENCE, the archive offer's own shape
 * (`archiveOfferedName`) and for the same one-line reason: the count and noun
 * are short at every width, so what a narrow card gives, if anything, is never
 * the verb — the half that says what happened.
 */
export function draftsOfferedName(count: number): string {
	return count === 1 ? "Draft" : `${count} drafts`;
}

/** The verb a discard offer prints after the count. One home for the copy. */
export const DRAFTS_OFFERED_VERB = "discarded.";
