/**
 * The completeness rule of the Files panel, as a pure function.
 *
 * ## Why this module exists
 *
 * The panel's list is only as complete as the transcript the extractor is given,
 * and the transcript is paged: the reducer holds the durable tail the reader has
 * loaded, and older rows arrive a page at a time (`sessions.history`). A panel
 * that reads only the loaded tail is silently partial — measured on this
 * machine, one long session showed 14 tiles while its own durable transcript
 * holds 160 distinct paths — and "silently" is the defect: the user has no way
 * to tell a short conversation from a long one that has not been read.
 *
 * So the panel drives the reader's own paging until the transcript is whole, and
 * says what it is doing while it does it. Two consequences fall out, and both
 * are decided HERE rather than in the React effect so they can be asserted
 * rather than described:
 *
 * 1. **The bound is a SCAN bound, and it is stated.** A conversation can hold
 *    thousands of messages; paging all of them the moment the Files view opens
 *    is a page storm the user did not ask for. So the scan stops after
 *    `budget` pages, the panel head says which messages were searched and which
 *    were not, and `resume` raises the budget — the previously unsearched tail
 *    is fetched, never dropped. Nothing is ever silently omitted.
 * 2. **Only the Files view drives it.** Paging the reader's transcript is a
 *    visible side effect (rows appear above them; scroll anchoring moves). It
 *    happens because the user asked to see every file, not because a
 *    conversation is open.
 *
 * Pure: no React, no DOM. The React hook that uses it is a shell, so the
 * "first N of M" case is settled by a test rather than by a screenshot. The
 * LANE rule is here for the same reason - which of `ask`, `wait`, `stop` and
 * `leave it to the request already out` a cursor earns, and what `resume` does
 * to the book - because the failure it guards is invisible in a frame: a retry
 * action that re-enters the lane and issues nothing.
 */

/**
 * Pages fetched before the scan pauses and asks.
 *
 * One page is 100 durable records, so this is ~2,400 messages: wider than the
 * median conversation, though not the deepest one - the largest session in this
 * machine's store is 15,674 records, about 6.5 windows of this size, and reading
 * all of it takes six `resume` clicks (each one raises the budget by this same
 * step). The number is a pause, not a limit: the head states which messages were
 * searched and which were not, and `resume` reads the rest.
 */
export const SCAN_PAGE_BUDGET = 24;

/** What the panel head needs to say about the scan. */
export type MentionScanState = {
	/** The Files view is open, so the scan is being driven at all. */
	active: boolean;
	/** Messages (transcript records) the extractor has read so far. */
	scanned: number;
	/** The transcript still holds earlier messages that have not been searched. */
	hasMore: boolean;
	/** A page request is in flight, or more pages remain inside the budget. */
	paging: boolean;
	/** The budget stopped the scan with earlier messages still unloaded. */
	stopped: boolean;
};

export type MentionScanInput = {
	active: boolean;
	scanned: number;
	hasMore: boolean;
	inFlight: boolean;
	/** Pages fetched since the budget was last raised. */
	pagesFetched: number;
	/** The current budget, in pages. */
	budget: number;
};

/**
 * The published state, derived from the bookkeeping and nothing else.
 *
 * `stopped` and `paging` are mutually exclusive by construction: either more
 * pages remain inside the budget (paging) or the budget is what is holding the
 * scan back (stopped). A view that is not active reports neither, because the
 * honest answer for "is the panel complete" while the panel is closed is "not
 * being asked".
 */
export function mentionScanState(input: MentionScanInput): MentionScanState {
	const reading = input.active && input.hasMore;
	const stopped = reading && input.pagesFetched >= input.budget;
	return {
		active: input.active,
		scanned: input.scanned,
		hasMore: input.hasMore,
		paging: reading && !stopped,
		stopped,
	};
}

/**
 * May another page be asked for now?
 *
 * One page at a time: the hook re-runs on every transcript delta, and a loop
 * that fired concurrently would issue the same `beforeId` page several times
 * (the reducer would apply one and drop the rest, but the backend would have
 * done the work). `inFlight` is the hook's own flag, not a promise.
 */
export function shouldRequestPage(input: MentionScanInput): boolean {
	return (
		input.active &&
		input.hasMore &&
		!input.inFlight &&
		input.pagesFetched < input.budget
	);
}

/**
 * The per-conversation page bookkeeping, and the state the lane's rules read.
 *
 * Lives here rather than in the hook's ref because `resume` and the lane
 * decision are the two halves of ONE rule - when the scan may ask for a page
 * again - and that rule has a failure mode a screenshot cannot show: a stop
 * whose cursor did not move used to leave `requestedFor` naming the cursor it
 * had already asked for, so the action the head offers as the way out of that
 * stop re-entered the lane, saw "already asked for this cursor, nothing in
 * flight" and stopped again without issuing anything. A dead retry, exactly
 * where the user needs it. Asserted in `scripts/mentioned-files.test.mjs`.
 */
export type ScanBook = {
	/** Pages fetched since the budget was last raised. */
	pages: number;
	/** The current budget, in pages. `restartScan` raises it. */
	budget: number;
	/** A page request is in flight. */
	inFlight: boolean;
	/** The `oldestId` a request was last issued for. */
	requestedFor: string | null;
};

/** A fresh book, at the shipped starting budget. */
export function newScanBook(): ScanBook {
	return {
		pages: 0,
		budget: SCAN_PAGE_BUDGET,
		inFlight: false,
		requestedFor: null,
	};
}

/**
 * What the lane does with the cursor this render, given the book.
 *
 * - `idle` — nothing to ask for: the view is closed, the history is whole, or
 *   the budget is spent.
 * - `wait` — the reader's OWN older-history page owns the cursor right now.
 *   Asking would be answered with the stand-down `false`, and on this code path
 *   that `false` spends the budget (round 2, R2-5). The page that lands moves
 *   the cursor and re-runs the caller with `blocked` false.
 * - `in-flight` — a request for this cursor is already out; it will move the
 *   cursor or stop the scan.
 * - `stop` — nothing is in flight and the cursor has not moved since the last
 *   request: no page arrived. Stop asking and let the head say so, because a cue
 *   that keeps promising more is worse than an honest "not searched", whose own
 *   action is the retry.
 * - `request` — ask for this cursor.
 */
export type ScanLane = "idle" | "wait" | "in-flight" | "stop" | "request";

/**
 * Decide the lane, and apply the bookkeeping the decision implies.
 *
 * The two transitions that are part of the DECISION rather than of the caller's
 * wiring live here so they can be asserted: `stop` spends the budget (that is
 * what makes the head's stopped state and its action the honest answer), and
 * `request` records the cursor it is asking for and that a request is out. The
 * caller performs the effects - publishing the state and calling `loadOlder` -
 * and clears `inFlight` when the request settles.
 */
export function scanLane(
	book: ScanBook,
	input: { canRequest: boolean; blocked: boolean; oldestId: string | null },
): ScanLane {
	if (!input.canRequest) return "idle";
	if (input.blocked) return "wait";
	if (input.oldestId !== null && book.requestedFor === input.oldestId) {
		if (book.inFlight) return "in-flight";
		book.pages = book.budget;
		return "stop";
	}
	book.requestedFor = input.oldestId;
	book.inFlight = true;
	return "request";
}

/**
 * The `Search earlier messages` action: raise the budget and re-arm the cursor.
 *
 * Why re-arming is not optional. A stop can be reached with the cursor UNMOVED -
 * a page request that failed, or an empty page at the end of a history that
 * still claims more - and `scanLane` spends the budget for it. Raising the
 * budget alone leaves `requestedFor` naming that same cursor, so the lane reads
 * "already asked for this cursor, nothing in flight" and stops again without
 * issuing anything: the one action offered at that stop would be a no-op exactly
 * where the user needs it. Clearing it here makes the retry mean what its copy
 * says - ask again for the page that is still missing - while the cursor itself
 * is untouched, so the request that follows is for the SAME page and the wait
 * semantics of R2-5 are unaffected (a request in flight is left alone, because
 * its own answer is what will move the cursor).
 */
export function restartScan(book: ScanBook): void {
	book.budget += SCAN_PAGE_BUDGET;
	if (!book.inFlight) book.requestedFor = null;
}
