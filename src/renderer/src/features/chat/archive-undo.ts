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
 * never from the composer. The register lives beside the list in the panel, so it
 * cannot reach the composer at all, and the rule above is implemented exactly as
 * it was: the offer is written when the press is accepted and cleared by the same
 * subscription or the same ceiling.
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
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
}): void {
	const store = () => useCanonicalSessionsStore.getState();
	store().setArchiveUndo({
		sessionId: input.sessionId,
		title: input.title,
		archived: input.archived,
	});
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
		// The rule lives in `chat-archived.ts`, with the sentence it implements, so the
		// comment and the behaviour cannot drift apart.
		if (undoOfferStands(input.archived, knownArchived(input.sessionId))) return;
		stop();
	});
	const ceiling = setTimeout(stop, ARCHIVE_UNDO_CEILING_MS);
}
