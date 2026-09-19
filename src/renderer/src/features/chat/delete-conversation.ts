/**
 * What a typed `/delete` says on a backend with no delete route.
 *
 * A sentence rather than silence, and the SAME shape `MOVE_UNAVAILABLE_REASON`
 * uses for a route this renderer can see the absence of: the catalogue is the
 * backend's own, so a daemon that advertises `/delete` without the capability is
 * a backend skew the user cannot fix by trying again - they are told what is
 * missing and that an update is the way to get it.
 */
export const DELETE_UNAVAILABLE_REASON =
	"This backend cannot delete conversations. Update the backend and try again.";

/**
 * The words a permanent delete asks with, and the ONE place they are written.
 *
 * Two surfaces reach this dialog — the header's conversation menu and a typed
 * `/delete` — so the copy lives here rather than in either of them, and it is a
 * pure function of two facts so it can be asserted without a browser.
 *
 * WHAT THE COPY HAS TO DO, and each clause is load-bearing:
 *
 * - **Name the conversation.** A danger dialog that asks "Delete this
 *   conversation?" over a transcript the user has scrolled past is a dialog about
 *   nothing; the row they think they are on is the thing they are agreeing to
 *   lose. Curly quotes, the shape every other named-thing sentence in this app
 *   uses.
 * - **Say where it is removed FROM** ("from this machine") and that it is
 *   permanent. The archive control sits in the same menu and is recoverable, so
 *   the difference between the two has to be stated rather than implied by a
 *   colour: this is the sentence the archive path deliberately never shows.
 * - **Say what is KEPT, when there is something to keep.** A delete removes the
 *   addressed conversation and NOT the subagent runs it started (the frozen
 *   contract's own words). A dialog that stayed silent about them would leave the
 *   user to guess at the blast radius in the direction that costs them work, and a
 *   dialog that claimed to remove them would be false about the wire.
 */
export function deleteConversationMessage(
	title: string,
	hasSubagentRuns: boolean,
): string {
	const named = `“${title}”`;
	const base = `Every message in ${named} is permanently removed from this machine. This cannot be undone.`;
	if (!hasSubagentRuns) return base;
	/*
	 * "are kept", not "are unaffected": the children are separate sessions that
	 * survive this delete, and the user is being told what they will still find
	 * rather than what will not happen to them.
	 */
	return `${base} The subagent runs it started are kept.`;
}
