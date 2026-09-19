/**
 * The undo offer a successful `/archive` makes, and the rule that retires it.
 *
 * WHY AN OFFER AT ALL, given the row itself leaves the list. `/archive` is the
 * one archive path with no row to look at afterwards: the command was typed, the
 * conversation vanished from the sidebar, and the only thing that says what
 * happened is a line of feedback. A recoverable action with no visible trace is
 * indistinguishable from a delete at the moment the user reads it, which is the
 * failure the design record names in Claude desktop's archive-without-restore.
 *
 * WHY IT HAS TO BE RETIRED, and what "inside the rule" means here (the reason
 * `dismissToast` exists at all, stated for the goal confirmation): an offer is
 * only honest while the state it was taken from still holds. So the offer stands
 * exactly as long as THE CLIENT'S OWN FACT is what is holding the archived state
 * (`archiveFacts` in `canonical-sessions-store.ts`) — because that fact is
 * dropped the moment an answer that is newer than the press speaks about this
 * conversation. When the catalogue answers, the row is re-read, its state is the
 * backend's rather than this window's memory, and an Undo button sitting over it
 * would be offering to invert something the user can now see for themselves.
 *
 * A CEILING AS WELL AS THE SUBSCRIPTION, because the catalogue is not
 * guaranteed to answer at all: a backend that is down leaves the fact
 * standing, and an unretired subscription per archive press is a listener that
 * outlives the press that made it. Both halves are needed and neither is a
 * fallback for the other.
 *
 * A LATE PRESS IS HARMLESS, which is why the ceiling is a bound rather than a
 * correctness constraint: `sessions.archive` carries the DESIRED state rather
 * than a toggle, so an Undo pressed after another surface restored the
 * conversation re-sends `archived: false` — a no-op, not a double flip.
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { dismissToast, showInfoToast } from "@shared/utils/toast-manager";

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
 * Offer the undo for a conversation this window has just archived.
 *
 * Mirrors the goal confirmation's shape (`showInfoToast` with an `action`, the
 * id held so it can be taken back) rather than inventing a second offer
 * vocabulary.
 */
export function offerArchiveUndo(input: {
	sessionId: string;
	title?: string;
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
	const unsubscribe = useCanonicalSessionsStore.subscribe((state) => {
		// Still this window's own fact: nothing newer has spoken about the row.
		if (state.archiveFacts[input.sessionId] !== undefined) return;
		stop();
		// Retired EARLY rather than left to its timer: the answer that settled the
		// row is the same moment the offer stopped being about anything.
		dismissToast(toastId);
	});
	const ceiling = setTimeout(stop, ARCHIVE_UNDO_CEILING_MS);
}
