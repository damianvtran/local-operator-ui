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
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { dismissToast, showInfoToast } from "@shared/utils/toast-manager";
import { undoOfferStands } from "./chat-archived";

/**
 * How long the offer stands if no answer ever speaks about the conversation.
 *
 * Long enough to read the line and reach for it, and short enough that a
 * forgotten subscription cannot accumulate over a session of archives.
 */
export const ARCHIVE_UNDO_CEILING_MS = 15_000;

/** The one sentence an archive offer makes, so the toast and a test agree. */
export function archiveOfferedText(title: string | undefined): string {
	/*
	 * Two spellings because a conversation this client does not list has no name to
	 * quote: the hit that produced its row carried one, but the row may not be in
	 * the page and an empty pair of curly quotes would read as a bug. "Conversation
	 * archived." is the honest version of the same statement.
	 */
	return title ? `“${title}” archived.` : "Conversation archived.";
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
	onUndo: () => void;
}): void {
	const toastId = showInfoToast(archiveOfferedText(input.title), {
		action: { label: "Undo", onClick: input.onUndo },
		duration: ARCHIVE_UNDO_CEILING_MS,
	});
	let closed = false;
	const stop = () => {
		if (closed) return;
		closed = true;
		unsubscribe();
		clearTimeout(ceiling);
	};
	const unsubscribe = useCanonicalSessionsStore.subscribe(() => {
		// The rule lives in `chat-archived.ts`, with the sentence it implements, so the
		// comment and the behaviour cannot drift apart.
		if (undoOfferStands(input.archived, knownArchived(input.sessionId))) return;
		stop();
		// Retired EARLY rather than left to its timer: the moment the state changed
		// is the moment the offer stopped being about anything.
		dismissToast(toastId);
	});
	const ceiling = setTimeout(stop, ARCHIVE_UNDO_CEILING_MS);
}
