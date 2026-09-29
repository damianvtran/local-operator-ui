/**
 * The undo offer a successful archive makes, and the rule that retires it.
 *
 * WHY AN OFFER AT ALL. An archive REMOVES the row from every list the default
 * surfaces draw, and it is reached two ways: a typed `/archive`, which leaves
 * nothing on screen at all, and the row's own control, which takes the row - and
 * with it the control - out from under the press. Either way the only thing that
 * says what happened is a line of feedback, and a recoverable action with no
 * visible trace is indistinguishable from a delete at the moment the user reads
 * it. That is the failure the design record names in Claude desktop's
 * archive-without-restore, and it is the same sentence for both routes on purpose:
 * one act, one register (UX round 1, U2 - the row press used to be silent while
 * the typed one offered a restore).
 *
 * THE RETIREMENT RULE, in one sentence, and it is the sentence the code
 * implements: the offer stands while the conversation still holds the state the
 * offer was taken from, and it is retired the moment this client knows it does
 * not. "Knows it" is the effective value - this window's own fact first
 * (`archiveFacts` in `canonical-sessions-store.ts`), the catalogue row second -
 * and the states that end the offer are the two that make it a lie: the value has
 * changed (the user pressed Undo, or another surface restored the conversation)
 * or the row is gone altogether (it was deleted).
 *
 * WHAT IT DELIBERATELY IS NOT, because the version that shipped was wrong in a
 * way worth recording: it retired on the first answer that MENTIONED the row,
 * which is any catalogue page - so the offer lasted 0.4-1.6 s in the measured
 * cases and a reader could not reach it (UX round 1, U4: "that is not an
 * offer"). The premise behind that version was that the row's own state is what
 * the user can see for themselves once the answer lands; the truth is the
 * opposite - an archived conversation is exactly the row they CANNOT see, which is
 * why they need the offer.
 *
 * NO CEILING ANY MORE (2026-09-27, superseding design rounds 4-9's D6/D30 pair):
 * a 15 s timeout used to stand beside the subscription, on the premise that a
 * subscription per archive press could otherwise outlive the press - the offer
 * was `Infinity`-lived then, and only the panel's own clock ever took it down.
 * The message now ends itself (sonner's documented life, `ARCHIVE_UNDO_TOAST_MS`,
 * pausable while the reader holds it), and its end clears the store slot, which
 * is what tears this watch down - so the listener's bound is the offer's own life
 * rather than a second, unseen clock. Keeping the ceiling would also retire a
 * message the reader is HOLDING, which is the one moment the watch must still be
 * armed: the state moving while the offer is held is exactly when the offer has
 * to go. A LATE PRESS remains harmless in every ordering: `sessions.archive`
 * carries the DESIRED state rather than a toggle, so an Undo pressed after
 * another surface restored the conversation re-sends `archived: false` - a no-op,
 * not a double flip.
 *
 * BACK TO AN ORDINARY TOAST, WHICH IS THE OPERATOR'S OWN CALL (2026-09-27,
 * verbatim: "instead of having a separate sidebar notification, we should
 * probably just use the normal sonner toast. These don't properly show up and
 * look janky"). Design round 2's D12 is the trade being re-accepted rather than
 * refuted, and it is recorded here so nobody re-discovers it as new: measured in
 * both palettes, a bottom-right toast covers x 1001..1360.5, y 789..842.5 while
 * the composer's Send control sits at x 1307..1339, y 803..835 - so an offer can
 * sit over Send for its (now hover-pausable) eight seconds. The panel register
 * that answer built was itself retired by the operator's request, this time in
 * favour of the standard register the app's other toasts use; the lane it became
 * (`docs/design/sidebar-row-space.md` §10, D11) and that record's supersession
 * entry carry the full history.
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { ArchiveFact } from "@shared/store/canonical-sessions-store";
import { useEffect } from "react";
import { undoOfferStands } from "./chat-archived";

/**
 * The offer's documented display life - sonner's own `duration` now.
 *
 * WHY THIS NUMBER LIVES HERE (agent review round 2's R9 context, design round 2's
 * D6): it was spelled in `chat-sidebar.tsx` beside the clock effect that ran it;
 * the clock is gone (sonner ends the message now, pausably), but the number
 * still has one home because BOTH offers share it - the discard offer's toast
 * reads this constant - and because the design record quotes it ("the offer's
 * eight seconds"). It is no longer a ceiling's neighbour: the 15 s subscription
 * bound beside it was removed with the panel clocks (see the header).
 */
export const ARCHIVE_UNDO_TOAST_MS = 8_000;

/**
 * The refusal's documented display life - sonner's `duration` for it.
 *
 * Longer than an offer's, because the refusal carries a Retry the reader has to
 * read before pressing, and the read-ack announcement (`chat-sidebar.tsx`) takes
 * the same number for the same shape. It lives here so the archive family's two
 * lifetimes sit together and cannot drift.
 */
export const ARCHIVE_FAILURE_TOAST_MS = 10_000;

/**
 * The quoted NAME an archive offer prints, with the verb left outside it.
 *
 * TWO PARTS RATHER THAN ONE SENTENCE, because the card is one line and only one of the
 * two may be cut: the name flexes and ellipsises (`truncate` in the panel's own JSX),
 * while the verb is a fixed tail that always fits. The version that shipped put both in
 * one string and ellipsised that string, so the operator's own 55-character title
 * rendered as `“Quarterly retention sweep and the transc…` - the closing quote and the
 * word `archived.` gone, i.e. a card that no longer said what had happened (agent review
 * round 2, R2-3). The name is also the half a reader can recover in full: it is the row
 * they just pressed, and the row's own flyout carries it untruncated.
 *
 * The no-name spelling is the same statement: a conversation this client does not list
 * has no title to quote, so the name is the generic noun and the verb still follows.
 */
export function archiveOfferedName(title: string | undefined): string {
	return title ? `“${title}”` : "Conversation";
}

/** The verb an archive offer prints after the name. One home for the offer's copy. */
export const ARCHIVE_OFFERED_VERB = "archived.";

/**
 * The archive fact this window holds for a conversation, if it holds one.
 *
 * Separate from `knownArchived` below because the two questions are different: this one
 * is about THIS CLIENT'S OWN WRITE (whether it has been answered), and that one is about
 * what the client knows of the state.
 */
function archiveFactFor(sessionId: string): ArchiveFact | undefined {
	return useCanonicalSessionsStore.getState().archiveFacts[sessionId];
}

/**
 * The archived state this client currently knows, or `undefined` when it knows of
 * no such conversation at all.
 *
 * The SAME precedence every other reader uses (the drill the dispatcher, the row
 * and the header all follow): this window's own fact first, the catalogue row
 * second, and `undefined` - never `false` - when neither speaks.
 */
function knownArchived(sessionId: string): boolean | undefined {
	const state = useCanonicalSessionsStore.getState();
	const fact = state.archiveFacts[sessionId];
	if (fact) return fact.archived;
	return state.sessions.find((row) => row.session_id === sessionId)?.archived;
}

/**
 * Retire the standing offer when the state it was taken from stops being true.
 *
 * WHY THIS IS A HOOK RATHER THAN PART OF THE RAISE (design round 8, D27's second clause).
 * The offer itself is written by the STORE, in the update that settles the archive
 * write, because the accepted departure and the state that answers it have to land in one
 * commit - and the store cannot call into this module (this module imports the store).
 * WHAT CANNOT MOVE TO THE STORE IS THIS SUBSCRIPTION, and it should not: deciding WHEN
 * the offer stops being true is this module's rule, the same way `undoOfferStands` and the
 * sentence beside it are. So the undo-toast surface (`components/undo-toasts.tsx`, mounted
 * for the app's whole life since 2026-09-27) calls this once, and the watch keys on the
 * offer's identity - a second archive in a row re-arms it rather than stacking two.
 *
 * The offer's own claim, kept from the version that installed this at the raise: a press
 * that has NOT been answered decides nothing (`fact.answered`), so an optimistic fact cannot
 * retire an offer before the daemon has spoken - the mechanism UX round 1's U3 was about,
 * where the panel dismissed the lane and the refusal that replaced the offer was created
 * into the id's own unmount window.
 *
 * ITS BOUND IS THE OFFER'S OWN LIFE, not a clock (2026-09-27; the 15 s ceiling that stood
 * here went with the panel clocks - see the module header). The watch lives exactly as long
 * as the store holds the offer, and the offer's end now clears that slot in every ending
 * route (sonner's timed end, the close button, the swipe, or the state moving). A HELD
 * offer is the case the ceiling used to shorten: while the reader hovers, both the message
 * and this watch stand, which is right - the state moving under a held offer is precisely
 * when the offer must retire.
 */
export function useArchiveUndoRetirement(): void {
	const offer = useCanonicalSessionsStore((state) => state.archiveUndo);
	useEffect(() => {
		if (offer === null) return;
		let closed = false;
		/** Tear the watch down, leaving the store's value alone (an unmount is not a statement about the offer). */
		const teardown = () => {
			if (closed) return;
			closed = true;
			unsubscribe();
		};
		/*
		 * Retire the offer, but only if THIS offer is still the one the store holds.
		 *
		 * GUARDED BY THE OFFER'S OWN IDENTITY, NOT BY ITS SESSION ID (agent review round 5, R5-5).
		 * Two offers for the SAME conversation can follow one another - archive, undo it, archive it
		 * again while the first watch is still armed - and a guard on the id alone lets the first watch's
		 * expiry take the SECOND offer off the screen: the same lie the retirement rule exists to
		 * avoid, one press later. The stamp tells them apart, because every raise carries the write's
		 * own `at`.
		 */
		const stop = () => {
			teardown();
			const current = useCanonicalSessionsStore.getState().archiveUndo;
			if (
				current !== null &&
				current.sessionId === offer.sessionId &&
				current.at === offer.at
			)
				useCanonicalSessionsStore.getState().setArchiveUndo(null);
		};
		const unsubscribe = useCanonicalSessionsStore.subscribe(() => {
			const fact = archiveFactFor(offer.sessionId);
			if (fact !== undefined && !fact.answered) return;
			// The rule lives in `chat-archived.ts`, with the sentence it implements, so the
			// comment and the behaviour cannot drift apart.
			if (undoOfferStands(offer.archived, knownArchived(offer.sessionId)))
				return;
			stop();
		});
		return teardown;
	}, [offer]);
}
