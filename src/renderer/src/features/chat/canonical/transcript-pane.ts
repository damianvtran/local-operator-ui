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
 * - `awaitingHydration`: is an authoritative page for THIS session still OWED?
 *   This is the READER's question, it is deliberately not `status`, and it is
 *   the SAME composed fact the composer band reads - one question, two readers.
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
 * - `!speaks && !admittedSend && awaitingHydration` -> the placeholder: nothing
 *   has told the reader what this conversation holds yet, and the pane has
 *   nothing of its own to say.
 * - `!speaks && !admittedSend && !awaitingHydration` -> nothing at all: the pane
 *   collapses, and the band may claim the conversation is empty because the read
 *   proved it (or because nothing here owes a read in the first place).
 *
 * A pane WITH rows paints them and holds nothing. A statement may stand above
 * them, which is not a contradiction: rows are the conversation's own content
 * and the notice is a claim about the transport that failed to extend it.
 *
 * WHY THE READER'S QUESTION AND NOT THE TRANSPORT'S. `awaitingHydration` asks
 * whether this session is still owed a page; `status` says where the stream is.
 * On this path the two disagree in BOTH directions, and each direction was a
 * defect the pre-merge resolution check found (Finding 1):
 *
 * - `status === "connecting"` with no page owed: `Retry` after a stream
 *   failure re-arms the stream (`use-canonical-session.ts` sets
 *   `failure: null, status: "connecting"` and leaves `hydrated` alone) in front
 *   of a conversation a completed read has already proven EMPTY. Holding there
 *   painted "Loading conversation…" over a conversation that is known to hold
 *   nothing, while the band took the greeting and its `grow` - two contradictory
 *   loading claims splitting one column, and the composer dropped to the
 *   empty-chat position when the snapshot landed. That is the 468px -> 736px
 *   move this work exists to remove.
 * - `status === "live"` with a page still owed: a cold session's snapshot
 *   carries `cursor_missing`, so it goes `live` without hydrating. Not holding
 *   there left the pane collapsed and the band at natural height with no
 *   greeting, i.e. no loading claim anywhere until the history read landed.
 *
 * WHY THE OWED QUESTION AND NOT `hydrated`, WHICH IS THE THIRD DIRECTION. A pane
 * with NO session answers "not hydrated" forever, so `hydrated` cannot be read
 * as "still loading" for one. A New chat is a staged DRAFT: `chat-page.tsx`
 * calls `useCanonicalSessionStream(undefined, false)`, the hook's effect returns
 * before subscribing (`if (!sessionId || !enabled) return`), and no page can ever
 * be applied to it. Keyed on `hydrated` this rule held `Loading conversation…`
 * and its shimmer rows over a band that was already offering the greeting and
 * its chips - the same two-contradictory-claims class as Finding 1, and the one
 * the operator read as "the stuck loader is still not fixed". Only the session
 * can answer whether a page is owed, so the question is composed ONCE on the
 * canonical session handle (`awaitingHydration`: there is a stream for this
 * session, and no page has been applied to it) and BOTH readers read that value
 * rather than each deriving their own wording of it. `hydrated` keeps its own
 * meaning - "has a page been applied" - and a reader of it must keep reading it
 * that way.
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
	/*
	 * The two states a notification click can paint, optional for the same reason
	 * they are optional on `TranscriptPaneView`: a caller that knows neither is a
	 * caller for which neither is true. They are named here rather than read off
	 * the whole view because the band and the working-line rung both ask this
	 * question with only what they hold, and widening the parameter to the full
	 * pane view would make every asker hand over fields this predicate ignores.
	 */
	missing?: boolean;
	stale?: boolean;
}): boolean {
	return (
		view.status === "reconnecting" ||
		(view.status === "unavailable" && Boolean(view.failure)) ||
		Boolean(view.missing) ||
		Boolean(view.stale)
	);
}

/** The state every decision in this module reads. */
export type TranscriptPaneView = {
	/** Where the stream is. Only the pane's own statement depends on it. */
	status: CanonicalTranscriptStatus;
	/** The published failure, if any: the notice's copy and its control. */
	failure: SessionFailureNotice | null;
	/** Is an authoritative page for this session still owed? */
	awaitingHydration: boolean;
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
	/*
	 * The two states a notification click can paint with no authoritative answer
	 * in hand. Both are statements the pane makes about ITSELF, which is why they
	 * live in this view rather than as guards at the render site: the hold and
	 * the collapse are the same question asked twice, and one of them reading a
	 * proxy for it is how a row-less pane ended up collapsed with its own
	 * sentence clipped.
	 *
	 * Optional, and deliberately: a caller that knows neither is a caller for
	 * which neither is true, which is the behaviour every decision here had
	 * before these states existed (a draft conversation, the legacy twin).
	 */
	missing?: boolean;
	stale?: boolean;
};

/**
 * Does the pane paint the loading placeholder?
 *
 * The one row-less state where nothing else is being claimed: a page is still
 * owed for this session, and the pane has no statement of its own. See the
 * matrix at the head of this file for the other three.
 *
 * ITS THIRD EXCLUSION IS THE ADMITTED SEND, and it is a ruling rather than a
 * convenience: a row-less pane makes ONE claim, and while a send is admitted the
 * claim that matters is the wait line ("the app is waiting for the agent"), not
 * the placeholder ("a page for this session is still owed"). Both are true, and
 * the placeholder is the weaker one - the reader who just pressed Enter is
 * waiting on the turn, and the history of a session they created seconds ago is
 * nothing they are waiting for. Keeping both would also put two loading claims
 * in one column, which is the shape `#150` exists to remove.
 */
export function transcriptPaneHoldsPlaceholder(
	view: TranscriptPaneView,
): boolean {
	return (
		view.recordCount === 0 &&
		view.awaitingHydration &&
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
 * nothing is owed - either the read has proved the conversation empty, or there
 * is no session here to owe a read - and nothing is on its way.
 */
export function transcriptPaneCollapses(view: TranscriptPaneView): boolean {
	return (
		view.recordCount === 0 &&
		!view.admittedSend &&
		!transcriptPaneHoldsPlaceholder(view) &&
		!canonicalTranscriptSpeaks(view)
	);
}
