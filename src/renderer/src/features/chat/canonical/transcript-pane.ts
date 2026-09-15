import type { SessionFailureNotice } from "../../../../../shared/desktop-stream-notice";

/**
 * The transcript pane's own decisions: does it HOLD the placeholder with no
 * rows, does it COLLAPSE out of the layout, and does it have a statement of its
 * own to paint instead?
 *
 * Pure and separate from the component for the reason `scroll-paging.ts` is:
 * the decisions are rules about state, so a node test can pin them, and the
 * component should be left with the rendering rather than the reasoning. The
 * band that shares the hold lives in `chat-content.tsx`/`message-input.tsx` and
 * asks the same properties - one question, two readers.
 *
 * THE WHOLE MATRIX, NOT ONE CASE PER DISCOVERED BUG. A row-less pane has exactly
 * one claim to make, and that claim is a function of five values, so the rule is
 * stated once, over all of them, rather than patched where a defect was last
 * found:
 *
 * - `speaks` (below): the pane is ALREADY saying something - it is reconnecting,
 *   or it has published a failure. That statement IS the pane's content, so
 *   nothing else may be painted beside it.
 * - `hydrated`: has the durable history been READ? This is the READER's question,
 *   and it is deliberately not `status`.
 * - `recordCount`: is there anything to scroll? Records rather than rendered
 *   rows, because a record that renders to no row is still nothing to scroll.
 * - `admittedSend` (added with the wait line): has this pane admitted a send the
 *   owner has not answered yet? The pane's own fact, and the only one of the
 *   five that no record can carry - the optimistic echo is not durable history,
 *   and on the New-chat path the identity flip lands before the owner's first
 *   frame, so the record list is legitimately empty for the whole engage.
 *
 * Which gives, for a pane with no rows:
 *
 * - `speaks` -> the statement alone (the failure notice, or "Reconnecting"). The
 *   scroller still grows for it; see `collapsed` below.
 * - `!speaks && admittedSend` -> the wait line alone: the reader has just sent
 *   and is waiting on the turn, which outranks the placeholder (see
 *   `transcriptPaneHoldsPlaceholder`). The scroller grows for the line, which is
 *   what makes it paintable at all.
 * - `!speaks && !admittedSend && !hydrated` -> the placeholder: nothing has told
 *   the reader what this conversation holds, and the pane has nothing of its own
 *   to say.
 * - `!speaks && !admittedSend && hydrated` -> nothing at all: the pane collapses,
 *   and the band may claim the conversation is empty because the read proved it.
 *
 * A pane WITH rows paints them and holds nothing. A statement may stand above
 * them, which is not a contradiction: rows are the conversation's own content
 * and the notice is a claim about the transport that failed to extend it.
 *
 * WHY THE READER'S QUESTION AND NOT THE TRANSPORT'S. `hydrated` means the
 * durable history has been read; `status` says where the stream is. On this path
 * the two disagree in BOTH directions, and each direction was a defect the
 * pre-merge resolution check found (Finding 1):
 *
 * - `status === "connecting"` with `hydrated === true`: `Retry` after a stream
 *   failure re-arms the stream (`use-canonical-session.ts` sets
 *   `failure: null, status: "connecting"` and leaves `hydrated` alone) in front
 *   of a conversation a completed read has already proven EMPTY. Holding there
 *   painted "Loading conversation…" over a conversation that is known to hold
 *   nothing, while the band took the greeting and its `grow` - two contradictory
 *   loading claims splitting one column, and the composer dropped to the
 *   empty-chat position when the snapshot landed. That is the 468px -> 736px
 *   move this work exists to remove.
 * - `status === "live"` with `hydrated === false`: a cold session's snapshot
 *   carries `cursor_missing`, so it goes `live` without hydrating. Not holding
 *   there left the pane collapsed and the band at natural height with no
 *   greeting, i.e. no loading claim anywhere until the history read landed.
 *
 * WHY THE STATEMENT TERM EXISTS, and why it is a term in THIS rule rather than a
 * guard at the render site. Two states reach the pane with nothing read and
 * nothing painted while the pane is already speaking: the else arm of
 * `reconcileTail`'s `records.length > 0` split, which publishes `unavailable`
 * with `HISTORY_UNREADABLE` and leaves `hydrated` false by construction, and the
 * stream's `gap` arm, which publishes `reconnecting`. Without the term both
 * painted the pulsing placeholder NEXT TO the notice or the "Reconnecting" line -
 * the same two-contradictory-claims class as Finding 1, with one of the two
 * claims untrue (the load is not still running; it failed, or the stream is
 * re-establishing). The term costs no geometry: `canonicalTranscriptSpeaks`
 * already keeps the scroller out of `collapsed` in those states, so the
 * statement is never clipped and the placeholder was buying nothing.
 *
 * Keyed this way, the pane holds exactly while the reader has not been told what
 * the conversation holds, there is nothing to scroll, no send of this pane's is
 * in flight, AND the pane has nothing of its own to say - and the collapse
 * happens exactly in the single row where none of the terms is true.
 */

/** Where the transcript's stream is. The union the component renders against. */
export type CanonicalTranscriptStatus =
	| "connecting"
	| "live"
	| "reconnecting"
	| "unavailable";

/**
 * Does the transcript pane have something of its own to say right now?
 *
 * ONE authority for the two decisions that must agree: whether the pane may
 * collapse out of the layout (so the composer band can grow for the greeting),
 * and whether the band may claim the conversation is empty. They are the same
 * question - "is anything painted above the composer?" - and the failure notice
 * and the reconnecting line are both answers of "yes".
 *
 * The reconnecting half is design round 1's D3: the collapse stand-down used to
 * cover only `unavailable` + error, so for the whole ~23.5s retry budget this
 * PR introduces the pane was `h-0 overflow-hidden` and the "Reconnecting" line
 * was clipped above the box (measured: scroller h 0, text at y 70.6). A state
 * the user is waiting through has to be visible, and it has to stop the band
 * from offering the greeting over a conversation nobody has read.
 */
export function canonicalTranscriptSpeaks(view: {
	status: CanonicalTranscriptStatus;
	failure: SessionFailureNotice | null;
}): boolean {
	return (
		view.status === "reconnecting" ||
		(view.status === "unavailable" && Boolean(view.failure))
	);
}

/** The state every decision in this module reads. */
export type TranscriptPaneView = {
	/** Where the stream is. Only the pane's own statement depends on it. */
	status: CanonicalTranscriptStatus;
	/** The published failure, if any: the notice's copy and its control. */
	failure: SessionFailureNotice | null;
	/** Has the durable history been read for this conversation? */
	hydrated: boolean;
	/** How many records the transcript holds, painted or not. */
	recordCount: number;
	/**
	 * Has this pane admitted a send the owner has not answered yet? The pane's
	 * own fact rather than the stream's, and the fifth term the matrix needs:
	 * a cold send has no records to speak of - the optimistic echo is not durable
	 * history and, on the New-chat path, the identity flip lands before the
	 * owner's first frame - so without this term a row-less pane with an admitted
	 * send is indistinguishable from a row-less pane with nothing happening,
	 * and the wait line rendered at this scroller's foot has no height to paint
	 * in (measured before the term existed: in the DOM at t+258 ms, first painted
	 * pixel at t+13.8 s - the dead air the operator reported).
	 */
	admittedSend: boolean;
};

/**
 * Does the pane paint the loading placeholder?
 *
 * The one row-less state where nothing else is being claimed: the reader has not
 * been told what the conversation holds, and the pane has no statement of its
 * own. See the matrix at the head of this file for the other three.
 *
 * ITS THIRD EXCLUSION IS THE ADMITTED SEND, and it is a ruling rather than a
 * convenience: a row-less pane makes ONE claim, and while a send is admitted the
 * claim that matters is the wait line ("the app is waiting for the agent"), not
 * the placeholder ("the conversation's history is still being read"). Both are
 * true, and the placeholder is the weaker one - the reader who just pressed
 * Enter is waiting on the turn, and the history of a session they created
 * seconds ago is nothing they are waiting for. Keeping both would also put two
 * loading claims in one column, which is the shape `#150` exists to remove.
 */
export function transcriptPaneHoldsPlaceholder(
	view: TranscriptPaneView,
): boolean {
	return (
		view.recordCount === 0 &&
		!view.hydrated &&
		!view.admittedSend &&
		!canonicalTranscriptSpeaks(view)
	);
}

/**
 * Does the pane collapse out of the layout?
 *
 * Only when it has nothing to paint at all: no rows, no placeholder, no
 * statement, and no send of this pane's in flight. That last term is not implied
 * by the placeholder standing down - it is the INVERSE case, and reading it off
 * the placeholder is how an earlier pass of this change collapsed the pane
 * exactly while the wait line was being rendered into it, which is the dead air
 * the term exists to remove (QA round 1's Q1, and again in the live app once
 * this matrix was introduced). That is the single row where the band is allowed
 * to take the free height for the greeting, because it is the single row where
 * the read has proved the conversation empty and nothing is on its way.
 */
export function transcriptPaneCollapses(view: TranscriptPaneView): boolean {
	return (
		view.recordCount === 0 &&
		!view.admittedSend &&
		!transcriptPaneHoldsPlaceholder(view) &&
		!canonicalTranscriptSpeaks(view)
	);
}
