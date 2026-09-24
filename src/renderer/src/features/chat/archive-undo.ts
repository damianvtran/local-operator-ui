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
 * A CEILING AS WELL AS THE SUBSCRIPTION, because the catalogue is not guaranteed
 * to answer at all: a backend that is down leaves the fact standing, and an
 * unretired subscription per archive press is a listener that outlives the press
 * that made it. Both halves are needed and neither is a fallback for the other.
 *
 * A LATE PRESS IS HARMLESS, which is why the ceiling is a bound rather than a
 * correctness constraint: `sessions.archive` carries the DESIRED state rather than
 * a toggle, so an Undo pressed after another surface restored the conversation
 * re-sends `archived: false` - a no-op, not a double flip.
 *
 * A PANEL REGISTER RATHER THAN A TOAST (design round 2, D12), and that is the one
 * thing about this module's shape that changed. The offer used to be
 * `showInfoToast(..., { action: "Undo" })`, which put a box with the word Undo in
 * it over the composer: measured in both palettes the toast covered x
 * 1001..1360.5, y 789..842.5 while the Send control sits at x 1307..1339, y
 * 803..835, so the offer's own press target sat exactly where Send had been for up
 * to 15 s. An offer to take an action back must not be able to send a message, and
 * it must sit on the surface that performed the action - and the archive is
 * performed from the sidebar (a row's control, the conversation header's menu, a
 * typed slash command dispatched by the composer but acting on the chat pane),
 * never from the composer. The register lives at the panel's ROOT, above both regions
 * (drawn beside the pin's own failure line, so every assembly mode carries it), so it
 * cannot reach the composer at all, and the rule above is implemented exactly as
 * it was: the offer is written when the press is accepted and cleared by the same
 * subscription or the same ceiling.
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { ArchiveFact } from "@shared/store/canonical-sessions-store";
import { useEffect } from "react";
import { undoOfferStands } from "./chat-archived";

/**
 * How long the offer stands if no answer ever speaks about the conversation.
 *
 * Long enough to read the line and reach for it, and short enough that a
 * forgotten subscription cannot accumulate over a session of archives.
 */
export const ARCHIVE_UNDO_CEILING_MS = 15_000;

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
 * The offer itself is now written by the STORE, in the update that settles the archive
 * write, because the accepted departure and the band that answers it have to land in one
 * commit - and the store cannot call into this module (this module imports the store). What
 * cannot move to the store is this subscription, and it should not: deciding WHEN the offer
 * stops being true is this module's rule, the same way `undoOfferStands` and the sentence
 * beside it are. So the panel calls this once, and the watch keys on the offer's identity -
 * a second archive in a row re-arms it rather than stacking two.
 *
 * The offer's own claim, kept from the version that installed this at the raise: a press
 * that has NOT been answered decides nothing (`fact.answered`), so an optimistic fact cannot
 * retire an offer before the daemon has spoken - the mechanism UX round 1's U3 was about,
 * where the panel dismissed the lane and the refusal that replaced the offer was created
 * into the id's own unmount window.
 *
 * The ceiling bounds it as well, because the catalogue is not obliged to answer at all: a
 * backend that is down leaves the fact standing, and a subscription per archive press is a
 * listener that would outlive the press that made it.
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
			clearTimeout(ceiling);
		};
		/*
		 * Retire the offer, but only if THIS offer is still the one the store holds.
		 *
		 * GUARDED BY THE OFFER'S OWN IDENTITY, NOT BY ITS SESSION ID (agent review round 5, R5-5).
		 * Two offers for the SAME conversation can follow one another - archive, undo it, archive it
		 * again inside the first watch's ceiling - and a guard on the id alone lets the first watch's
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
		const ceiling = setTimeout(stop, ARCHIVE_UNDO_CEILING_MS);
		return teardown;
	}, [offer]);
}
