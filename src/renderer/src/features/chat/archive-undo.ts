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
 * Offer the undo for a conversation this window has just archived.
 *
 * Mirrors the goal confirmation's shape (`showInfoToast` with an `action`, the id
 * held so it can be taken back) rather than inventing a second offer vocabulary.
 */
export function offerArchiveUndo(input: {
	sessionId: string;
	title?: string;
	/** The state the offer is about: what pressing Undo would take back. */
	archived: boolean;
}): void {
	const store = () => useCanonicalSessionsStore.getState();
	/*
	 * ONE UPDATE RAISES THE OFFER AND RETIRES THE REFUSAL IT SUPERSEDES, and the two
	 * halves are not separable without a defect.
	 *
	 * The lane draws one message under one stable id, so raising the offer is what
	 * takes a refusal off the screen. Clearing the refusal in `setSessionArchived`
	 * instead would leave a window in which the store holds neither message: the
	 * panel's effect would dismiss the lane on that render and the offer's own toast
	 * would then be created into the id's unmount window and destroyed with it -
	 * the mechanism `canonical-sessions-store.ts` records beside its press (UX report
	 * round 1, U3). Setting both in one `set` is what makes the replacement-
	 * rather-than-dismissal property structural instead of a matter of render order.
	 *
	 * The refusal cleared is this conversation's own: a sentence about another row's
	 * failed write is not superseded by this offer, and `chat-sidebar.tsx`'s lane effect now
	 * decides which of the two it DRAWS by their write stamps (`at`), not by preferring one
	 * kind - the `laneMessageRef` beside that effect answers only the empty-lane dismissal,
	 * so it is not what arbitrates them (agent review round 3, R3-1; the earlier comment here
	 * claimed otherwise and the claim was wrong).
	 */
	useCanonicalSessionsStore.setState((state) => ({
		archiveUndo: {
			sessionId: input.sessionId,
			title: input.title,
			archived: input.archived,
			/*
			 * STAMPED WITH THE WRITE THAT RAISED IT. A successful archive's press has already
			 * advanced `answerSeq`, so this is strictly newer than the refusal it supersedes -
			 * which is what lets the lane draw it while the refusal is still in the store.
			 */
			at: state.answerSeq,
		},
		archiveFailure:
			state.archiveFailure?.sessionId === input.sessionId
				? null
				: state.archiveFailure,
	}));
	let closed = false;
	const stop = () => {
		if (closed) return;
		closed = true;
		unsubscribe();
		clearTimeout(ceiling);
		/*
		 * CLEARED ONLY IF IT IS STILL THIS OFFER'S. Two archives in a row (the second
		 * while the first's ceiling is running) leave two subscriptions, and the first
		 * one's expiry must not take the SECOND offer off the screen - it would clear
		 * an offer that is still true, which is the same lie the retirement rule
		 * exists to avoid, one press later.
		 */
		const current = store().archiveUndo;
		if (current?.sessionId === input.sessionId) store().setArchiveUndo(null);
	};
	const unsubscribe = useCanonicalSessionsStore.subscribe(() => {
		/*
		 * A PRESS THAT HAS NOT BEEN ANSWERED DECIDES NOTHING (agent review round 2, R2-1).
		 *
		 * The rule below reads the client's own fact first, and the fact is written
		 * OPTIMISTICALLY - so at the press it already says the conversation no longer holds
		 * the state the offer was taken from, before the daemon has said anything. Asking the
		 * rule then retires the offer at the press, the panel dismisses the lane, and the
		 * refusal that a refused write produces a few milliseconds later is created on the id
		 * that was just dismissed - which sonner destroys with the entry it is removing. That
		 * is the lost-message mechanism U3 was about, on the Undo control beside the Retry,
		 * and the reason the answer owns the retirement rather than the press.
		 *
		 * It is one gate for every writer of this route, which is why it lives here rather than
		 * in the control that happens to be nearest: the offer's own Undo, the header's restore
		 * control and `/unarchive` all call `setSessionArchived`, and all three would otherwise
		 * take the lane down before their answer.
		 *
		 * The ceiling still bounds the offer, so an answer that never comes costs the listener
		 * nothing but the wait it already had.
		 */
		const fact = archiveFactFor(input.sessionId);
		if (fact !== undefined && !fact.answered) return;
		// The rule lives in `chat-archived.ts`, with the sentence it implements, so the
		// comment and the behaviour cannot drift apart.
		if (undoOfferStands(input.archived, knownArchived(input.sessionId))) return;
		stop();
	});
	const ceiling = setTimeout(stop, ARCHIVE_UNDO_CEILING_MS);
}
