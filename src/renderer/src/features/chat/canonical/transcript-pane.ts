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
 * - `filterHeld` (added with the settings hold): is the cross-session filter
 *   still PENDING, with the rows it governs withheld from this render? This is
 *   the one input that is not a fact about the conversation but about what the
 *   pane is WILLING to paint, and it exists because withholding rows and claiming
 *   nothing is not a state a reader can read (design round 1, D1, measured: with
 *   a seeded window and a stalled settings answer the loading line was gone by
 *   t0+239 ms and the pane showed 0 rows and no claim at all until t0+947 ms - it
 *   read as an EMPTY CONVERSATION, not a loading one). Held rows are exactly the
 *   case where the placeholder is the true claim: the pane has the records and is
 *   deliberately not painting them yet.
 * - `admittedSend` (added with the wait line): has this pane admitted a send the
 *   owner has not answered yet? The pane's own fact, and the only one of the
 *   five that no record can carry - the optimistic echo is not durable history,
 *   and on the New-chat path the identity flip lands before the owner's first
 *   frame, so the record list is legitimately empty for the whole engage.
 *
 * Which gives, for a pane with no rows:
 *
 * - `statement` -> the statement alone (the failure notice, or "Reconnecting").
 *   The scroller still grows for it; see `collapsed` below.
 * - `!statement && admittedSend` -> the wait line alone: the reader has just
 *   sent and is waiting on the turn, which outranks the placeholder (see
 *   `transcriptPaneHoldsPlaceholder`). The scroller grows for the line, which is
 *   what makes it paintable at all.
 * - `!statement && !admittedSend && awaitingHydration` -> the placeholder: nothing
 *   has told the reader what this conversation holds yet, and the pane has
 *   nothing of its own to say.
 * - `!statement && !admittedSend && !awaitingHydration` -> nothing at all: the pane
 *   collapses, and the band may claim the conversation is empty because the read
 *   proved it (or because nothing here owes a read in the first place).
 *
 * A pane WITH rows of its own paints them and holds nothing. A statement may
 * stand above them, which is not a contradiction: rows are the conversation's own
 * content and the notice is a claim about the transport that failed to extend it.
 *
 * THE SIXTH INPUT IS THE CACHE'S ROWS, AND THEY ARE NOT ROWS OF THE PANE'S OWN
 * (operator report, 2026-09-26: "there's no jitter where things seem to load at
 * different times ... everything should load in one solid paint instead of
 * incrementally"). A `stale` paint is this window's MEMORY of the conversation,
 * not the conversation: painted early it is a partial state that the snapshot then
 * corrects on screen - measured on the switch harness, a cached switch painted its
 * rows in the click's own frame, the readings strip at +67 ms and the stale
 * caption's removal at the same moment, which moved the whole transcript up by
 * 33.4 px (pane top 174.4 -> 141) under the reader. The rule above read "has rows"
 * and let all of that paint piecemeal. It now reads the cache flag the pane
 * already carried: while a page is OWED, rows that are the CACHE's hold the
 * placeholder exactly as no rows did, so the page - rows, readings, everything -
 * lands in ONE commit, and what the reader sees first is the finished frame. The
 * cache's own rows still paint on every path where the page is not coming
 * (a refusal, a failed stream, a tombstoned id), which is where the caption that
 * describes them belongs. And a row that is NOT this window's memory (a live
 * event, an optimistic echo) still paints while a page is owed, unchanged,
 * because it is the conversation's own content - but only on a pane that is not
 * STALE: `stale` is a pane-level flag, so on a cached pane the hold withholds
 * every row, the live ones included, and they arrive in the page's commit. The
 * CACHED table in `scripts/session-switch.test.mjs` pins that mixed cell
 * (`live|cached|owed` holds) beside the rule itself, which is why the scoped
 * wording at `transcriptPaneHoldsPlaceholder` says `stale` ends the hold only
 * when false.
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
 * The pane's own STATEMENT: the states in which the pane has something to say
 * that is neither the placeholder nor the reader's rows.
 *
 * ONE spelling, two readers, because they must agree about which states outrank
 * the placeholder: `canonicalTranscriptSpeaks` adds the stale paint to this set
 * (for its callers, the caption IS something the pane is saying), while the hold
 * below asks the narrower question - a stale paint is a reason to keep holding
 * until the page lands, not a statement that would end the hold.
 */
function paneStatement(view: {
	status: CanonicalTranscriptStatus;
	failure: SessionFailureNotice | null;
	missing?: boolean;
}): boolean {
	return (
		view.status === "reconnecting" ||
		(view.status === "unavailable" && Boolean(view.failure)) ||
		Boolean(view.missing)
	);
}

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
	return paneStatement(view) || Boolean(view.stale);
}

/**
 * Whether the pane's statement is TERMINAL - the states a working claim must
 * yield to, and the reason the reconnecting window is not one of them.
 *
 * `canonicalTranscriptSpeaks` answers "is the pane saying something of its own";
 * this answers the narrower question the working line and the composer's hint
 * ask: can the stream still vouch for progress? A published failure, a
 * conversation this machine no longer has, and a page that is nothing but this
 * window's cache are all statements the stream cannot revise - a claim beside
 * them is a claim nobody can withdraw. RECONNECTING IS THE DELIBERATE EXCLUSION
 * (operator incident, 2026-10-07): a receipt gap drops the authoritative
 * frontend and the pane says so, but the app still holds the last reading and
 * the work on the far side is real - blanking the in-flight claim through every
 * ~1.5-4 s reconnect left a running turn with no indicator at all, and a
 * reconnect is exactly when the reader most needs to be told the work did not
 * end. See the waiting arm in `working-line-model.ts` for the rung's half of
 * this rule, and `reconnect-gap.stories.tsx`'s `RestoredRunning` for the frame
 * it is about.
 */
export function canonicalTranscriptTerminal(view: {
	status: CanonicalTranscriptStatus;
	failure: SessionFailureNotice | null;
	missing?: boolean;
	stale?: boolean;
}): boolean {
	if (view.status === "reconnecting") return false;
	return canonicalTranscriptSpeaks(view);
}

/** The state every decision in this module reads. */
export type TranscriptPaneView = {
	/**
	 * The cross-session filter is pending and its rows are withheld from this
	 * render (`canonical-transcript.tsx`'s `holdFiltering`). Optional so every
	 * existing caller and test fixture stays valid, and read strictly `=== true`
	 * like the other flags in this file.
	 */
	filterHeld?: boolean;
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
 * The one state where nothing else is being claimed: a page is still owed for
 * this session, and the pane has no statement of its own. See the matrix at the
 * head of this file for the other rows.
 *
 * ITS THIRD EXCLUSION IS THE ADMITTED SEND, and it is a ruling rather than a
 * convenience: a row-less pane makes ONE claim, and while a send is admitted the
 * claim that matters is the wait line ("the app is waiting for the agent"), not
 * the placeholder ("a page for this session is still owed"). Both are true, and
 * the placeholder is the weaker one - the reader who just pressed Enter is
 * waiting on the turn, and the history of a session they created seconds ago is
 * nothing they are waiting for. Keeping both would also put two loading claims
 * in one column, which is the shape `#150` exists to remove.
 *
 * AND ITS ROWS TERM IS WHY IT REACHES BEYOND A ROW-LESS PANE: rows this window
 * CACHED (`stale`) do not end the hold, because they are not yet the
 * conversation - see the cache paragraph at the head of this file. Rows that are
 * not the cache's (any record while `stale` is false) still end it, so a live
 * event and an optimistic echo paint exactly as they did.
 */
export function transcriptPaneHoldsPlaceholder(
	view: TranscriptPaneView,
): boolean {
	if (view.admittedSend || paneStatement(view)) return false;
	if (view.filterHeld === true) return true;
	return (
		view.awaitingHydration && (view.recordCount === 0 || view.stale === true)
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
