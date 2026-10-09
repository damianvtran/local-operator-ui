/**
 * The asks drawer's OPEN POLICY: when a conversation that carries pending asks is
 * opened, the drawer comes up on its own - once - and otherwise stays exactly where
 * the user left it.
 *
 * ## Why it exists
 *
 * The queued ask is answered in the drawer, and the only thing that announces it
 * while the drawer is shut is a chip above the composer. A first-time user does not
 * know the chip is a door: the operator's report (2026-10-07) is that the collapsed
 * component is easy to miss, so a conversation opened with an unanswered question
 * looks like a conversation with nothing to answer. The fix is discoverability, not
 * insistence: open the surface ONCE when the conversation is opened, and let go.
 *
 * ## One contract, four surfaces
 *
 * This is the web UI's half of a SHARED OPEN-POLICY CONTRACT. The TUI's ask panel,
 * the mobile relay's asks sheet and the native app's asks sheet implement the same
 * six rules in their own idiom, so a rule changed here is a rule to change there:
 *
 *  1. NOTHING PENDING ON OPEN -> closed (what every surface did before the policy).
 *  2. PENDING ON OPEN -> open, ONCE for that view of that conversation.
 *  3. ALL ADDRESSED ON OPEN -> closed, and a queue that settles never re-opens.
 *  4. A DELIBERATE CLOSE WHILE ASKS REMAIN IS RESPECTED for that conversation: not on
 *     a re-render, a queue refresh, an ask arriving or changing, or a switch away and
 *     back. It lives in memory only (a fresh start may open again), and a NEW ask
 *     arriving later does not force the surface open - the chip and the badge already
 *     cover that. THE RECORD IS THE ASK IDS the close waved off (the outstanding set at
 *     close time), under three clauses every surface shares (the cross-surface "U10"
 *     wording, which replaced "forget it when the queue is seen empty"):
 *       a. it HOLDS while any of those asks is still outstanding and is FORGOTTEN once
 *          none is (answered, declined, withdrawn, expired), so a later batch gets the
 *          same discoverability as the first - including a batch that emptied and
 *          refilled while the user was away, which needs no "seen empty" observation;
 *       b. an id list that cannot be named in full (a bounded prefix, a tally with no
 *          rows: a frame whose tally is above the outstanding rows it carries) HOLDS:
 *          such a record clears only when the queue is observed empty.
 *          Fail closed - under-opening is the safe failure, forcing open a panel the
 *          user refused is not;
 *       c. a SECOND close over a different set UNIONS into the record, never replaces it.
 *  5. NO THEFT, NO TRAP, NO GUESSING: opening never moves focus, the user can always
 *     close (the drawer's own unconditional close control, #864), and the policy
 *     never acts on a frame that has not actually answered.
 *  6. AN AUTO-OPEN IS NOT A DOOR PRESS: it must not look like one to the drawer's
 *     door-focus signal (`ask-drawer.tsx`'s `openedByDoor`), which means "the user
 *     pressed the chip or the header trigger" and nothing else.
 *
 * ## Why a module and not conditions in an effect
 *
 * Every rule above is a decision about FACTS, none about React or the DOM, and each
 * is the kind of rule that is easy to get subtly wrong inside an effect body (re-fire
 * on a re-render, open on a frame that has not loaded, forget a close the moment the
 * component remounts). Kept here it is driven frame by frame in a plain node test,
 * and the module is DOM-free by construction: it holds no `focus()` call because it
 * has no document to call it on, which is rule 5's first clause as a property of the
 * file rather than a promise of its caller. `use-ask-open-policy.ts` is the thin
 * React shell that feeds it facts and applies its verdict.
 *
 * ## What it yields to
 *
 * Auto-open is a courtesy, so it gives way to anything the user is already doing,
 * and it gives way FOR GOOD (the view decides once): the composer holds text (not
 * mid-sentence), the keyboard is on one of the drawer's doors (it would read as a
 * press), or the drawer is already up. None of those is a dismissal and none mutes the
 * conversation: the next view of it decides afresh.
 *
 * IT DOES NOT YIELD TO A DURABLE PANE. A press on the chip BORROWS the right slot from
 * the canvas, run panel, browser or console and the close gives it back
 * (`askDrawerEvictedPane`); an auto-open is the same borrow, through the same writer.
 * Yielding would make the feature a no-op for exactly the user who keeps a pane open -
 * the one most likely to miss a chip - and the shared contract has no such exception.
 *
 * ## "On open" means the ask EXISTED BEFORE the view did, and the wait is bounded
 *
 * A "view" is one mount of a conversation's pane (the pane is keyed by conversation,
 * so switching away unmounts it and coming back is a NEW view). Each view gets exactly
 * one decision, taken on the first frame in which the queue has PUBLISHED ROWS (or says
 * it holds none), and two further tests keep that from becoming "whenever an ask
 * shows up":
 *
 *  - AN ASK THAT ARRIVED DURING THE VIEW IS NOT PENDING ON OPEN. The first published
 *    frame of a view can already carry an ask the agent raised a moment after the
 *    pane mounted (a conversation resumed cold only builds its queue once it is
 *    engaged; a brand-new one's first question can land on its very first frame).
 *    Opening over that pops the surface onto a user who is simply watching the agent
 *    work - an ask ARRIVING, which rule 4 says never forces it open. Each outstanding
 *    row is therefore compared with the instant the view began: only a row queued
 *    before it (plus `ASK_ARRIVAL_SKEW_MS`, because the owner stamps `created_at` and
 *    a conversation viewed across the mesh is read against THIS machine's clock) is
 *    pending on open. The skew is deliberately biased toward opening: a real arrival
 *    in the view's first seconds read as pending costs a drawer that appears a
 *    moment after the conversation did, which is the behaviour being asked for; the
 *    other direction costs the feature.
 *  - THE WAIT FOR A FIRST ANSWER IS BOUNDED (`ASK_OPEN_WINDOW_MS`). A frame that
 *    resolves long after the view began is not "on open" any more, and waiting forever
 *    would open the drawer at minute ten over whatever the user is doing then. The
 *    bound is the shared contract's, not this surface's: the TUI's is the engage
 *    seam's 30 s plus 15 s, and the desktop's own snapshot bound
 *    (`STREAM_SNAPSHOT_DEADLINE_MS`, 20 s, plus one silent 10 s re-check) sits inside
 *    it, so an owner that stalls and recovers still counts as on open.
 *
 * What counts as "has not answered", and so decides nothing and spends nothing:
 *
 *  - An UNREAD frame (`frontend == null`) is not an empty one, and a RESOLVED frame
 *    that publishes no queued engine is not an empty one either (#864's lesson: the
 *    capability is the presence of `asks` OR `asks_open`, `askQueuePublished`).
 *  - A TALLY-ONLY frame (`asks` absent, `asks_open: N`) says N asks are outstanding
 *    without being able to show one. It is not "pending asks" - the surface it would
 *    open can only say that the details could not be loaded - but it is not "no asks"
 *    either, so the view keeps waiting (inside the window) for a frame that carries
 *    the rows. The chip still carries the count meanwhile.
 *
 * Everything after the decision is the user's: later frames cannot re-open, which is
 * what makes "an ask arriving later does not force the surface open" a property of the
 * view rather than a check somebody has to remember.
 */

import { type AskQueueView, askChipCountClause } from "./ask-queue";

/**
 * How long after a view begins it may still choose to open. See "On open means the ask
 * existed before the view did" in the module note for why this is the shared
 * contract's number (the TUI's `OPEN_WINDOW_S`) and not a desktop-specific one.
 */
export const ASK_OPEN_WINDOW_MS = 45_000;

/**
 * How far past the instant a view began an ask's `created_at` may sit and still count
 * as having existed on open. Mirrors the TUI's `ARRIVAL_SKEW_MS`; the reasoning (the
 * owner's clock against this machine's, biased toward opening) is in the module note.
 */
export const ASK_ARRIVAL_SKEW_MS = 5_000;

/**
 * Why a verdict is what it is. Also the vocabulary the tests and the evidence rows
 * use, so a frame in the PR and a line in the suite name the same thing.
 */
export type AskOpenReason =
	/** The only reason that opens. */
	| "pending-on-open"
	/** No conversation (a draft): there is no queue to have an opinion about. */
	| "no-conversation"
	/** The queue has not answered (unread, or a runtime that publishes nothing yet). */
	| "unresolved"
	/** This view already took its one decision. */
	| "already-decided"
	/** The view is older than `ASK_OPEN_WINDOW_MS`: whatever resolves now is not "on open". */
	| "too-late"
	/** The queue answered and nothing in it is pending (rules 1 and 3). */
	| "nothing-pending"
	/**
	 * Every outstanding ask was queued AFTER the view began: they arrived, they were not
	 * pending on open (rule 4: an arrival never forces the surface open). Final.
	 */
	| "arrived"
	/**
	 * The queue published a TALLY and no rows to show (the wire bound's frame: `asks`
	 * absent, `asks_open: N`). Asks ARE outstanding, so `nothing-pending` would be a
	 * false sentence; but the surface it would open can only apologise for the missing
	 * details, so it stays shut for now (rule 5) and the view keeps waiting.
	 */
	| "tally-only"
	/** The user closed this conversation's surface while asks remained (rule 4). */
	| "dismissed"
	/** The composer holds text: the user is typing (rule 5; a judgment call on the desktop). */
	| "composer-has-text"
	/** The keyboard is on one of the drawer's doors: an open would read as a press (rule 6). */
	| "door-focused"
	/** The asks drawer is already up, in either scope: there is nothing to open. */
	| "drawer-open";

export type AskOpenVerdict = {
	action: "open" | "leave";
	/**
	 * Whether this verdict SPENDS the view's one decision. `false` only for the reasons
	 * that mean "the queue has not answered in a form a surface can draw" (`unresolved`,
	 * `tally-only`) and for a view with no conversation: the caller asks again on the
	 * next frame, inside the window. Every other verdict - including every `leave` - is
	 * final for the view.
	 */
	settled: boolean;
	reason: AskOpenReason;
};

/** What a caller must know to decide. Every field is a fact, none is a handle. */
export type AskOpenInput = {
	/** The conversation this view shows, or nothing for a draft. */
	conversationId: string | null | undefined;
	/**
	 * Whether the queue has PUBLISHED (`AskQueueView.published`): an `asks` array or an
	 * `asks_open` tally is on the frame. NOT merely "a frame arrived".
	 */
	resolved: boolean;
	/**
	 * Outstanding rows the frame carries that EXISTED BEFORE the view began - open or
	 * timed out, answerable. The only rows that make a queue "pending on open".
	 */
	pendingRows: number;
	/** Outstanding rows queued AFTER the view began: arrivals, which never open it. */
	arrivedRows: number;
	/**
	 * The wire's own outstanding tally (`AskQueueView.open`). Read for ONE purpose: to
	 * tell a queue with nothing in it from a queue whose rows were dropped (see
	 * `tally-only`). It never opens anything by itself.
	 */
	outstanding: number;
	/** Milliseconds since the view began, on this machine's clock. */
	viewAgeMs: number;
	/**
	 * Whether a dismissal is still HELD for this conversation (`AskDismissals.has`): the user
	 * closed the surface while asks remained, and at least one of those asks still is.
	 */
	dismissed: Pick<AskDismissals, "has">;
	/** Whether this view already took its one decision. */
	viewDecided: boolean;
	/**
	 * Whether the composer holds text at this instant - typed, or a draft restored for
	 * this conversation. Empty is the ordinary state and is not a reason to wait.
	 *
	 * WHY A HELD DRAFT BLOCKS THE OPEN, AND WHY THAT IS A JUDGMENT CALL. Rule 5 says an
	 * auto-open never lands on a user who is typing, and the other three surfaces keep it
	 * literally (the phone's sheet is modal and covers the box; the TUI's panel stashes
	 * the draft). On THIS surface the drawer docks BESIDE the composer and covers
	 * nothing, and the composer's routing no longer depends on the drawer, so there is no
	 * hazard to the draft - what remains is motion: a pane sliding in beside the line
	 * being typed, and the column narrowing under the caret.
	 *
	 * THE COST IS THE LATCH. The view decides once, so a user who had a half-written
	 * message when the conversation opened and clears it a moment later does not get the
	 * drawer for that view (the chip and the badge still announce the queue, which is
	 * today's behaviour). Waiting for the box to empty would instead open the surface
	 * mid-conversation, which is the "arrival" this contract forbids. Whether the desktop
	 * should keep the latch, or open over a held draft because the drawer cannot hurt it,
	 * is a UX call the design round is asked to make; flipping it is deleting one clause
	 * in `decideAskAutoOpen`.
	 */
	composerHasText: boolean;
	/**
	 * Whether the keyboard is on one of the drawer's two DOORS (the composer chip or the
	 * header trigger) at this instant.
	 *
	 * RULE 6 AS A FACT RATHER THAN A PROMISE. The drawer decides "the user pressed a door"
	 * by reading what held focus when it mounted (`ask-drawer.tsx`'s entry effect), and
	 * on that reading it moves the keyboard into its list. An auto-open that landed while
	 * focus happened to be on a door would therefore be read as a press and would move
	 * the keyboard - a theft by a mount nobody pressed. Declining to auto-open in that
	 * one moment keeps the drawer's signal meaning exactly what #864 made it mean, with
	 * no change to the drawer.
	 */
	keyboardOnDoor: boolean;
	/**
	 * Whether the asks drawer is already open, in either scope. The flag survives a
	 * conversation switch on purpose (`isAskDrawerOpen`), so a drawer the user opened
	 * stays, and a fleet pane they opened is not swapped for this conversation's.
	 *
	 * A DURABLE PANE (canvas, run panel, browser, console) IS DELIBERATELY NOT A REASON
	 * TO LEAVE. The drawer is the right slot's one transient occupant and BORROWS the
	 * slot (`askDrawerEvictedPane`): closing it gives the displaced pane back, exactly
	 * as a press on the chip does today. An auto-open that refused to borrow would hide
	 * the asks from precisely the users who keep a pane open, and rule 2 has no such
	 * exception - a surface-specific one here would be a fifth idiom for a contract that
	 * is meant to read the same on all four.
	 */
	drawerOpen: boolean;
};

const wait = (reason: AskOpenReason): AskOpenVerdict => ({
	action: "leave",
	settled: false,
	reason,
});

const leave = (reason: AskOpenReason): AskOpenVerdict => ({
	action: "leave",
	settled: true,
	reason,
});

/**
 * The decision, as a pure function of the facts.
 *
 * THE ORDER IS THE SPEC for which reason is reported, because each `leave` should
 * name the first thing that kept the drawer closed: `dismissed`, `composer-has-text`,
 * `door-focused` and `drawer-open` are reported only for a queue that WOULD have
 * opened (they are overrides on a pending queue, so a settled queue in a dismissed
 * conversation says `nothing-pending`, which is the truer sentence).
 *
 * Only `no-conversation`, `unresolved` and `tally-only` return without settling: each
 * means "the queue has not answered in a form a surface can draw", and each is bounded
 * by the window check above it, so a view that never gets an answer is decided
 * (`too-late`) rather than left to open whenever one finally arrives.
 */
export const decideAskAutoOpen = (input: AskOpenInput): AskOpenVerdict => {
	const { conversationId } = input;
	if (!conversationId) return wait("no-conversation");
	if (input.viewDecided) return leave("already-decided");
	if (input.viewAgeMs > ASK_OPEN_WINDOW_MS) return leave("too-late");
	if (!input.resolved) return wait("unresolved");
	if (input.pendingRows <= 0) {
		if (input.arrivedRows > 0) return leave("arrived");
		/* Rows absent but a tally present: asks exist that no surface can draw yet. */
		return input.outstanding > 0
			? wait("tally-only")
			: leave("nothing-pending");
	}
	if (input.dismissed.has(conversationId)) return leave("dismissed");
	if (input.composerHasText) return leave("composer-has-text");
	if (input.keyboardOnDoor) return leave("door-focused");
	if (input.drawerOpen) return leave("drawer-open");
	return { action: "open", settled: true, reason: "pending-on-open" };
};

/**
 * The queue facts a decision reads off a view, derived once.
 *
 * `resolved` is `published`, not "a frame arrived": a frame with no `asks` and no
 * `asks_open` has not answered (see the module note). The rows are the OUTSTANDING ones
 * (`open` is the backend's fold: `open` plus `timed_out`, because a late answer still
 * reaches the agent - the same set the header badge counts), never the wire's tally:
 * rule 5 opens only over rows that are actually there. An unknown status is not
 * outstanding: `presentAsk` refuses to coerce it into `open`, and this inherits that.
 *
 * Each outstanding row is split by whether it EXISTED BEFORE the view began
 * (`startedAtMs`, on this machine's clock; `created_at` is epoch milliseconds from the
 * owner). A row that states no usable `created_at` is read as old - "an ask that has
 * been there a while" is the safe reading of a fact that was not stated.
 */
export const askOpenFacts = (
	view: Pick<AskQueueView, "published" | "rows" | "open">,
	startedAtMs: number,
): Pick<
	AskOpenInput,
	"resolved" | "pendingRows" | "arrivedRows" | "outstanding"
> &
	AskOutstandingReading => {
	const cutoff = startedAtMs + ASK_ARRIVAL_SKEW_MS;
	let pendingRows = 0;
	let arrivedRows = 0;
	for (const row of view.rows) {
		if (!row.open) continue;
		const createdAt = Number(row.ask.created_at);
		if (Number.isFinite(createdAt) && createdAt > cutoff) arrivedRows += 1;
		else pendingRows += 1;
	}
	return {
		resolved: view.published,
		pendingRows,
		arrivedRows,
		outstanding: view.open,
		...askOutstandingReading(view),
	};
};

/**
 * Which asks a frame names as outstanding, and whether that is ALL of them: the one
 * reading a dismissal is recorded from (`AskDismissals.record`) and settled against
 * (`AskDismissals.reconcile`).
 *
 * ITS OWN FUNCTION, with no view start time, because it has two callers and one of them
 * has no view yet: `askOpenFacts` feeds it into every frame, and the hook's layout
 * effect settles the record against the frame a pane MOUNTS with, before the view that
 * would observe it exists. Both must read "complete" the same way, so there is one
 * expression of it.
 *
 * THE LIST IS COMPLETE WHEN THE FRAME'S TALLY IS NOT ABOVE THE OUTSTANDING ROWS IT CARRIES,
 * and that comparison is the whole test. `view.open` is the wire's count of outstanding
 * asks (`asks_open`), taken by the core BEFORE its text budget drops any row, so a row the
 * budget dropped while it was still outstanding always shows as a tally above the rows
 * named - and so does a frame that carries the tally alone (`asks` absent, `asks_open: N`).
 * A tally BELOW the rows is not a gap: every id is named, some are just stale. An unread
 * or unpublished frame is not complete either (`published` is false for both), which is
 * what keeps it from settling a record in either direction.
 *
 * THIS NEVER READS `asks_truncated`, AND THE TYPE ABOVE IS WHY IT CANNOT: `truncated` is
 * not in the `Pick`. The flag is STICKY. The core sets it whenever the text budget drops
 * ANY row - including rows that are already answered - and it stays set for as long as
 * those rows ride the projection (up to `LATE_WINDOW_S`, seven days past their deadlines).
 * Derived by running the shipped `ask_wire` + `bound_ask_rows` over eight ~900-character
 * asks: 8 open gave 7 rows, tally 8, flag; 7 answered gave 7 rows (one open), tally 1,
 * flag; ALL answered gave 7 answered rows, tally 0, flag STILL SET; one new short ask gave
 * 7 rows, tally 1, flag. A predicate that required `!truncated` could therefore never be
 * true again, so a record made over a prefix could never be cleared by "a complete frame
 * with nothing outstanding" and the conversation stayed muted until the dropped rows aged
 * out. That was this function's first cut, and the live capture (s16) is what caught it.
 * The tally says everything the flag was being read for, and it says it per frame.
 *
 * WHAT THE WIRE CANNOT SAY, derived rather than assumed: `ask_wire` (core,
 * `session/frontend_state.py`) counts `asks_open` over the rows `AskQueue.projection` has
 * already clipped to `PROJECTION_CAP` (20 rows: open asks first, then everything else
 * newest-first). Run over 25 outstanding asks it published 20 rows beside `asks_open: 20`
 * and no flag, so an outstanding ask that clip drops is on neither field and no client can
 * name it. The cost points the harmless way: once the named asks are gone the hidden one
 * surfaces as an id nobody waved off, which reads as a refill and opens the drawer once for
 * an ask the user was never shown (E2); closing it records that batch again. The clip
 * needs more than twenty rows in the projection (`OPEN_ASK_CAP` holds the genuinely open
 * ones to 8), so it is a long-lived, mostly-unanswered session and not an ordinary one.
 */
export const askOutstandingReading = (
	view: Pick<AskQueueView, "published" | "rows" | "open">,
): AskOutstandingReading => {
	const outstandingIds: string[] = [];
	for (const row of view.rows) {
		if (row.open) outstandingIds.push(row.ask.ask_id);
	}
	return {
		outstandingIds,
		listComplete: view.published && view.open <= outstandingIds.length,
	};
};

/**
 * Whether a drawer that is ALREADY UP when a view begins must be closed instead of
 * carried onto the conversation being opened.
 *
 * WHY THIS EXISTS AT ALL. `isAskDrawerOpen` is one flag for the whole window and it
 * deliberately follows the user between conversations (like the four panes it shares
 * the slot with). So the per-view rules (1, 3 and 4) have a hole the per-view
 * surfaces (the TUI, the relay, the native app) cannot have: open A, arrive at B -
 * the flag is CARRIED, and the landing view never decided to have a drawer up.
 * Two landings make that a defect rather than a curiosity, one arm each:
 *
 *  - a DISMISSAL the conversation HOLDS (`AskDismissals.has`): asks the user waved
 *    off are still outstanding, or cannot be shown to have resolved. The user closed
 *    this conversation's asks and is seeing them again - the insistence rule 4
 *    forbids (dismiss A, the policy opens B, go back to A, and the drawer is open on
 *    A although the policy never re-opened it).
 *  - NOTHING TO SHOW: the landing frame has ANSWERED and proves every outstanding
 *    ask resolved (`listComplete` with no outstanding ids) - rule 3's settled queue,
 *    arriving with a drawer on it (U3, agent review round 1). An open drawer over
 *    `All asks settled` keeps the composer narrowed for a record the reader already
 *    read, and a first-view open of the same conversation would have been closed.
 *
 * THE SECOND ARM STILL FAILS CLOSED: it needs the frame's own word that it is
 * complete (`listComplete`, never the sticky truncation flag), so an unread,
 * unpublished, tally-only or clipped frame closes nothing - the landing view waits
 * for an answer rather than guessing (the same reading every other decision here
 * uses). And it is NOT rule 3 for a LIVE settle: a view that opened the drawer
 * itself keeps it through its queue settling (`!wasDecided` in the hook), which is
 * the pre-existing #864 behaviour, unchanged.
 *
 * THE RULE IS NARROW ON PURPOSE: close only when the drawer is up in the SESSION scope,
 * it was opened by THE POLICY (never by the user's own press - a drawer the user opened
 * is theirs and follows them as it always did), and one of the two arms holds.
 * "Opened by the policy" is provenance the store does not keep, so the hook that
 * applies verdicts tracks it (`use-ask-open-policy.ts`) and hands it in as a fact -
 * one boolean for the whole window, which assumes the ONE mounted `ChatContent` that
 * file's call site states (`chat-content.tsx`, the right-slot route note).
 */
export const shouldCloseCarriedDrawer = (facts: {
	conversationId: string | null | undefined;
	dismissed: Pick<AskDismissals, "has">;
	sessionDrawerOpen: boolean;
	openedByPolicy: boolean;
	/**
	 * What the frame the landing view is DECIDING ON says is outstanding
	 * (`askOutstandingReading`). Only its `listComplete` arm can close anything: a
	 * frame that has not answered, cannot name every ask it counts, or carries
	 * outstanding rows keeps the drawer exactly as it is.
	 */
	landing: Pick<AskOutstandingReading, "outstandingIds" | "listComplete">;
}): boolean =>
	Boolean(facts.conversationId) &&
	facts.sessionDrawerOpen &&
	facts.openedByPolicy &&
	(facts.dismissed.has(facts.conversationId as string) ||
		(facts.landing.listComplete && facts.landing.outstandingIds.length === 0));

/**
 * What one frame says about WHICH asks are outstanding: the facts a dismissal is
 * recorded from and reconciled against (rule 4).
 *
 * Two fields because "the ids I can see" and "all of them" are different claims, and
 * the second is the one the wire does not always make: the row list is a bounded prefix
 * (its tally is above the rows), and a frame can carry the tally with no rows at all.
 */
export type AskOutstandingReading = {
	/** The ids of the outstanding rows (open, or timed out and still answerable) the frame carries. */
	outstandingIds: readonly string[];
	/**
	 * Whether `outstandingIds` is EVERY outstanding ask. False for a frame that has not
	 * answered, a bounded prefix, a tally with no rows, and a list that lags its own
	 * tally - each says some asks exist that this reading cannot name, and each is one
	 * comparison: the tally against the outstanding rows (never `asks_truncated`, which
	 * sticks; see `askOutstandingReading`).
	 */
	listComplete: boolean;
};

/**
 * The ONE sentence a screen reader is told when the policy opens the drawer, and
 * nothing else ever writes it (design review round 1, D1).
 *
 * WHY A SENTENCE AT ALL. Rule 5 deliberately takes no focus, which is right - and
 * it means a live region is the only channel through which a reader who cannot see
 * the drawer learns it appeared. Without one the feature ships silent for them: the
 * surface arrives, the chip's `aria-expanded` flips, and nothing is announced.
 *
 * THE COUNT IS THE CHIP'S OWN CLAUSE (one vocabulary point,
 * `askChipCountClause`), so the sentence and the chip can never disagree about
 * what is waiting. It is spoken ONCE per policy open - the reader who pressed the
 * chip did that themselves, and a queue refresh is not an appearance - and the
 * surface that renders it (chat-content.tsx's `<output aria-live="polite">`)
 * clears it when the drawer closes, so a later open re-announces.
 */
export const askOpenAnnouncement = (view: AskQueueView): string =>
	`Opened your questions: ${askChipCountClause(view)}.`;

/**
 * The conversations whose surface the user has closed while asks remained, and WHICH
 * asks they waved off.
 *
 * IN MEMORY AND NOWHERE ELSE, on purpose (rule 4): a dismissal is a remark about
 * what the user wanted to see in the window they have open, not a preference. It is
 * not persisted, so a fresh start may open the surface again; and it is keyed by
 * conversation, so dismissing one never mutes another.
 *
 * WHY IT RECORDS ASK IDS AND NOT A BARE FLAG (the shared contract's "U10" wording). A
 * dismissal means "not THESE questions". Keyed by conversation alone, the only way to
 * tell the user's questions from a later batch was to watch the queue go empty, and a
 * batch that emptied and refilled while the user was in another conversation left the
 * flag in place: the conversation stayed quiet for good after one close, which is the
 * opposite of the discoverability the policy exists for. With the ids recorded the
 * question answers itself from any resolved frame (`reconcile`), and no "seen empty"
 * observation is needed. The three clauses, one per method:
 *
 *  - `reconcile`: the record HOLDS while any waved-off ask is still outstanding and is
 *    FORGOTTEN once none is. "The asks changed" is still not an event that brings the
 *    surface back: a new ask beside a waved-off one that remains changes nothing.
 *  - `reconcile`, again: a record whose ids are NOT ALL KNOWN (the close happened over
 *    a bounded prefix or a tally-only frame) HOLDS, and so does a frame that cannot name
 *    every outstanding ask. The only observation that proves such a record empty is a
 *    COMPLETE frame with nothing outstanding. Fail closed: a missed auto-open costs a
 *    discoverability nudge the chip and the badge still make, and forcing open a panel
 *    the user refused costs their trust in the close.
 *  - `record`: a SECOND close over a different set UNIONS into the record and never
 *    replaces it, and the record is only as complete as the least complete close.
 *
 * The entry holds ids only for as long as it lives, and it lives only while one of them
 * is outstanding, so its size is bounded by the wire's own bounded list.
 */
export type AskDismissals = {
	/** Whether a dismissal is HELD for this conversation right now. */
	has: (conversationId: string) => boolean;
	/** Record a close over the asks `reading` names; unions into a held record. */
	record: (conversationId: string, reading: AskOutstandingReading) => void;
	/**
	 * Settle the record against a frame: forget it once the frame proves none of the
	 * waved-off asks is outstanding, and leave it alone in every other case.
	 */
	reconcile: (conversationId: string, reading: AskOutstandingReading) => void;
	/** The test seam. The app only forgets through `reconcile`. */
	clear: () => void;
	readonly size: number;
};

export const createAskDismissals = (): AskDismissals => {
	const held = new Map<string, { ids: Set<string>; complete: boolean }>();
	return {
		has: (conversationId) => held.has(conversationId),
		record: (conversationId, reading) => {
			if (!conversationId) return;
			/*
			 * A close over a COMPLETE, EMPTY reading refused nothing, so it records nothing and
			 * must not disturb a record already held. An empty but INCOMPLETE reading is the
			 * tally-only close: asks existed, no id is known, and that is a record.
			 */
			if (reading.outstandingIds.length === 0 && reading.listComplete) return;
			const existing = held.get(conversationId);
			if (existing === undefined) {
				held.set(conversationId, {
					ids: new Set(reading.outstandingIds),
					complete: reading.listComplete,
				});
				return;
			}
			/* UNIONED, never replaced: the first close's asks are still waved off. */
			for (const id of reading.outstandingIds) existing.ids.add(id);
			existing.complete = existing.complete && reading.listComplete;
		},
		reconcile: (conversationId, reading) => {
			const existing = held.get(conversationId);
			if (existing === undefined) return;
			/*
			 * A frame that cannot name every outstanding ask DECIDES NOTHING, whatever the ids
			 * it does show: a waved-off ask missing from a prefix may be in the part that was
			 * left out. This is also what makes an unresolved frame inert, since an unread or
			 * unpublished frame is never `listComplete`.
			 */
			if (!reading.listComplete) return;
			if (!existing.complete) {
				/*
				 * Some waved-off ids were never named, so "none of them is outstanding" cannot be
				 * checked by comparing ids. A complete frame with NOTHING outstanding is the one
				 * observation that settles it: no waved-off ask, named or not, can be outstanding
				 * when none is.
				 */
				if (reading.outstandingIds.length === 0) held.delete(conversationId);
				return;
			}
			for (const id of reading.outstandingIds) {
				if (existing.ids.has(id)) return;
			}
			held.delete(conversationId);
		},
		clear: () => held.clear(),
		get size() {
			return held.size;
		},
	};
};

/**
 * The page's own record. A module singleton because its lifetime IS the page's:
 * the renderer's module graph lives exactly as long as the app window does, and that
 * is the "same app/page lifetime" rule 4 is written in. Tests build their own with
 * `createAskDismissals` so no case inherits another's.
 */
export const askDismissals: AskDismissals = createAskDismissals();

/** What a view is fed on each frame: the decision's inputs minus its own memory. */
export type AskOpenFrame = Omit<
	AskOpenInput,
	"dismissed" | "viewDecided" | "viewAgeMs"
> &
	AskOutstandingReading & {
		/** This machine's clock at the moment of the observation, in epoch milliseconds. */
		nowMs: number;
		/**
		 * Whether the SESSION-scoped drawer is the one up (`isAskDrawerOpen` and the
		 * session scope). Distinct from `drawerOpen`, which is true for a fleet pane too:
		 * a session pane replaced by the fleet pane was not closed by the user, it was
		 * swapped, and the close watch must not read the swap as a dismissal.
		 */
		sessionDrawerOpen: boolean;
	};

export type AskOpenObservation = {
	verdict: AskOpenVerdict;
	/**
	 * What the close watch made of an open -> closed edge on THIS frame, or `null`
	 * when the frame was not one:
	 *  - `dismissed`: a close while asks remained, now recorded for the conversation;
	 *  - `before-decision`: a close over a frame that had not answered, which spends
	 *    this view's one decision without recording anything (nothing was on screen
	 *    to have turned away, so a later view of the conversation may still open);
	 *  - `nothing-to-show`: a close over a queue with nothing in it (the drawer's own
	 *    auto-close, #864), which is no remark by the user and records nothing.
	 */
	closeWatch: "dismissed" | "before-decision" | "nothing-to-show" | null;
};

/**
 * One view's memory: the bit that makes "ONCE" true and the edge that makes rule 4
 * observable.
 *
 * Created per mounted pane (and so per view: remounting is a new one) and fed every
 * frame. The hook that applies the policy holds exactly this object, which is why
 * the tests drive it rather than a copy of its loop: what is asserted frame by frame
 * here is what runs in the app.
 *
 * THE CLOSE WATCH LIVES HERE, not in each close door. The drawer is closed by the
 * chrome's X, by Escape inside it, by the window-level Escape claim, by a toggle on
 * the composer chip, by a toggle on the header trigger, and by another pane claiming
 * the slot - six writers to one store flag. Wrapping each would be six places to
 * forget; observing the flag's open -> closed edge catches all of them, and a pane
 * that replaced the drawer is correctly a dismissal too (the user chose something
 * else for the slot, and reopening the asks over it on every visit is insistence).
 *
 * WHAT IS NOT A DISMISSAL, which is the other half of the rule:
 *  - a close with nothing outstanding: the drawer's own auto-close (#864) fires only
 *    when there is nothing to show, as does the queue settling under it;
 *  - a close over a frame that has not answered: nothing was on screen to have turned
 *    away (it still spends the view's decision - see `closeWatch`);
 *  - a swap to the fleet pane (see `sessionDrawerOpen`).
 *
 * A pane that took the slot from the drawer IS read as a dismissal, even when the
 * pane opened itself (an agent's `reveal`): the store cannot say who wrote the flag,
 * and the two mistakes are not symmetric - a missed auto-open costs a discoverability
 * nudge the chip and the badge still make, a wrong one puts the asks back over what
 * somebody chose to show there.
 */
export type AskOpenView = {
	observe: (frame: AskOpenFrame) => AskOpenObservation;
	/** When this view began, which is what "existed before the view" is measured from. */
	readonly startedAtMs: number;
	/** Whether this view has taken its decision (tests and evidence read it). */
	readonly settled: boolean;
};

export const createAskOpenView = (
	dismissals: AskDismissals,
	startedAtMs: number,
): AskOpenView => {
	let settled = false;
	let wasSessionOpen = false;
	return {
		observe(frame) {
			let closeWatch: AskOpenObservation["closeWatch"] = null;
			/* The ids this frame names, in the one shape the record reads and writes. */
			const reading: AskOutstandingReading = {
				outstandingIds: frame.outstandingIds,
				listComplete: frame.listComplete,
			};
			/*
			 * THE EDGE: this view's session drawer was up on the previous frame and is gone
			 * now, and no drawer of the other scope took its place. `conversationId` gates
			 * it because a draft has no queue to have turned away.
			 */
			if (
				wasSessionOpen &&
				!frame.sessionDrawerOpen &&
				!frame.drawerOpen &&
				frame.conversationId
			) {
				if (!frame.resolved) {
					/*
					 * CLOSED BEFORE THE QUEUE ANSWERED (a slow or cold conversation shows the
					 * unread line for as long as the read takes). The press is still a
					 * decision, and popping the surface back open when the frame lands would
					 * be the insistence rule 4 forbids, so it spends the view's chance. It
					 * records NOTHING against the conversation: nobody saw whether asks
					 * remained, and a later view that finds them should still open once.
					 */
					settled = true;
					closeWatch = "before-decision";
				} else if (
					frame.pendingRows > 0 ||
					frame.arrivedRows > 0 ||
					frame.outstanding > 0
				) {
					/*
					 * ASKS REMAIN - an outstanding row (old or arrived: the user turned the
					 * surface away over live asks either way), or a tally the frame could not
					 * show rows for (the chip still counts them). That is the rule-4 dismissal,
					 * recorded AGAINST THE IDS the frame names: those are the asks waved off, and
					 * a frame that could not name them all says so (`listComplete`), which makes
					 * the record hold until a complete frame shows an empty queue.
					 */
					dismissals.record(frame.conversationId, reading);
					closeWatch = "dismissed";
				} else {
					closeWatch = "nothing-to-show";
				}
			}
			wasSessionOpen = frame.sessionDrawerOpen;
			/*
			 * EVERY FRAME SETTLES THE RECORD, before the decision reads it, and in this order
			 * for two reasons the shared contract names. (1) A fresh view that meets only a
			 * LATER batch - the waved-off asks resolved while the user was in another
			 * conversation, the queue emptied and refilled without anyone watching - must find
			 * the record already gone when `decideAskAutoOpen` asks `has`; no "seen empty"
			 * frame ever happened, and none is needed. (2) A view that has already decided (the
			 * user closed the drawer) still watches the asks get answered, and that is the very
			 * frame that must clear the record, so this runs ahead of the decided latch too.
			 * A frame that has not answered, or cannot name every ask, settles nothing
			 * (`reconcile`), so a stale or partial reading can only keep a record, never drop
			 * one. The cost per frame is one Map lookup while nothing is dismissed.
			 */
			if (frame.conversationId) {
				dismissals.reconcile(frame.conversationId, reading);
			}
			const verdict = decideAskAutoOpen({
				...frame,
				viewAgeMs: frame.nowMs - startedAtMs,
				dismissed: dismissals,
				viewDecided: settled,
			});
			if (verdict.settled) settled = true;
			return { verdict, closeWatch };
		},
		get settled() {
			return settled;
		},
		startedAtMs,
	};
};
