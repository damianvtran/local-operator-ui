import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
/**
 * The undo offer a discard stands, and the rule that retires it.
 *
 * WHY AN OFFER AT ALL (design round 1, D1; UX round 1, U3). A discard deletes
 * the user's text outright — the draft row and the composer row whole — and the
 * app's own two precedents both refuse a permanent, unnamed, unoffered delete:
 * an archive is recoverable and still offers an Undo, because "a recoverable
 * action with no visible trace is indistinguishable from a delete"
 * (`archive-undo.ts` states the same sentence for its own surface), and a
 * conversation delete is permanent and asks in a dialog that names the thing.
 * The store half of the offer is the snapshot (`DraftsUndoOffer`); this module
 * is the copy and the clock — one line in the same sidebar lane the archive's
 * offer uses, with one pressable Undo (`chat-sidebar.tsx` draws it).
 *
 * THE RETIREMENT RULE, in one sentence: the offer stands until its ceiling, and
 * nothing ends it early. The archive's rule watches an answer because the server
 * can contradict it; a discard is a LOCAL write, so nothing outside this client
 * can make the offer a lie, and the only ways it ends are the ceiling, the
 * reader's own Undo, or a second discard replacing it (the store keeps ONE slot,
 * `DraftsUndoOffer`).
 *
 * THE CEILING IS THE LANE'S CARD LIFE, not a second guess at "long enough to
 * read and reach for": the archive offer's card is drawn for
 * `ARCHIVE_UNDO_TOAST_MS` (the number the lane's own design record quotes) and
 * this offer, standing in the same lane at the same price (the band gives up the
 * card's height), shares it by construction. THE CEILING IS *NOT* THE ARCHIVE'S
 * `ARCHIVE_UNDO_CEILING_MS` (15 s) — design round 2's D6 measured exactly that
 * mistake, 15.2 s of card where the lane records eight: the 15 s number answers
 * how long an unanswered RETIREMENT SUBSCRIPTION may stand, a safety bound
 * nobody sees, and reaching for it here spent the band for nearly double the
 * recorded price on every discard.
 *
 * THE WATCH KEYS ON THE OFFER'S IDENTITY (`at`), not on the field — the same
 * guard `useArchiveUndoRetirement` carries and for the same measured reason
 * (agent review round 5's R5-5 there): a second discard inside the window is a
 * NEW offer, and the first watch's expiry must not take it off the screen. And
 * it retires only the value IT was armed for, because by the time a watch fires
 * the store may hold a later offer that this watch has never seen.
 */
import { useEffect } from "react";
import { ARCHIVE_UNDO_TOAST_MS } from "./archive-undo";

/** The lane's card life, shared with the archive offer (the header's D6 note). */
export const DRAFTS_UNDO_CEILING_MS = ARCHIVE_UNDO_TOAST_MS;

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

/**
 * Retire the standing offer at its ceiling.
 *
 * Armed per OFFER (see the header): the effect re-runs on every new value, so a
 * second discard re-arms the clock against the new offer while the old watch
 * stands down at its `at` check.
 */
export function useDraftsUndoRetirement(): void {
	const offer = useCanonicalSessionsStore((state) => state.draftsUndo);
	useEffect(() => {
		if (offer === null) return;
		let closed = false;
		const stop = () => {
			if (closed) return;
			closed = true;
			clearTimeout(ceiling);
			const current = useCanonicalSessionsStore.getState().draftsUndo;
			/*
			 * ONLY THE OFFER THIS WATCH WAS ARMED FOR: a later discard has already
			 * replaced the value, and clearing it here would take a fresh offer off
			 * the screen one press after it was made.
			 */
			if (current !== null && current.at === offer.at)
				useCanonicalSessionsStore.getState().setDraftsUndo(null);
		};
		const ceiling = setTimeout(stop, DRAFTS_UNDO_CEILING_MS);
		/*
		 * A TEARDOWN LEAVES THE STORE'S VALUE ALONE — an unmount is not a statement
		 * about the offer (the archive's rule). A remount re-arms a fresh ceiling
		 * for the remaining value, which bounds the offer rather than extending it.
		 */
		return () => {
			closed = true;
			clearTimeout(ceiling);
		};
	}, [offer]);
}
