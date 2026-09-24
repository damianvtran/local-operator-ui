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
 * What a GUARD refusal says beyond the route's own sentence, and why it is needed.
 *
 * The route's sentence names the guard and, for the live-session arm, sends the
 * reader to a remedy this surface does not have: "Stop it before deleting it" is an
 * instruction to use a control that is not there. The composer's own Stop is gated
 * on a running TURN, so a conversation refused for a claim or lease has no stop
 * control anywhere in the pane (UX round 1, U3) - and the client therefore says
 * what is TRUE from where the refusal is read: the guard is the daemon's, nothing
 * in this window clears it, and here is where it has to be cleared.
 *
 * IT NAMES NO SINGLE CAUSE, AND THAT IS THE FIX RATHER THAN A COMPROMISE (QA round
 * 3, Q11). `409` is ONE arm of the route's ladder for FOUR guards - a live session,
 * an armed wake, unread mail, and a guard the store could not be read for - and the
 * backend's own docstring says the split is deliberate: the code
 * (`session_delete_refused`) "does not vary by which guard fired" while the
 * SENTENCE names the specific remedy. So a client cannot attribute the refusal, and
 * the version of this sentence that did - "This window cannot stop a session that
 * is running…", emitted for every 409 - followed an armed-wake refusal with advice
 * about stopping a session, which is the same defect U3 was about with the arm
 * swapped. What is left is the half that is true for every guard: the guard is not
 * this window's to clear, and it has to be cleared where the session actually runs.
 * The route's sentence above still names the specific remedy, and this one now
 * agrees with it instead of contradicting it.
 */
export const DELETE_GUARD_REMEDY =
	"The guard above is the daemon's own, and nothing in this window can clear it: clear it where the session runs - stop it there, or cancel the wake it names - and ask again.";
