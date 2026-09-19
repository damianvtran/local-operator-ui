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

/**
 * What a LIVE refusal says beyond the route's own sentence, and why it is needed.
 *
 * The route's sentence names the guard and then sends the reader to a remedy this
 * surface does not have: "Stop it before deleting it" is an instruction to use a
 * control that is not there. The composer's own Stop is gated on a running TURN
 * (`message-input.tsx`), so a conversation refused for a claim or lease - the case
 * this sentence is for - has no stop control anywhere in the pane, and the only
 * control whose name matches is the dialog's own Close (UX round 1, U3).
 *
 * So the client says what is TRUE from where the refusal is read: the session is
 * held by a running session, this window cannot end that hold, and the delete can
 * be retried once the holder is done. It is a separate constant because it is
 * about a CAUSE, not about the delete: a transport failure or a 404 gets the
 * route's sentence alone.
 */
export const DELETE_LIVE_REMEDY =
	"This window cannot stop a session that is running: stop it where it was started, or wait for it to finish, and try again.";
