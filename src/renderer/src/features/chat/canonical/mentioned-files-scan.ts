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
 * "first N of M" case is settled by a test rather than by a screenshot.
 */

/**
 * Pages fetched before the scan pauses and asks.
 *
 * One page is 100 durable records, so this is ~2,400 messages — deeper than any
 * conversation in the store this machine has (the largest measured session is
 * 15,674 records, and a reader who wants the whole of it is two clicks away).
 * The number is a pause, not a limit: `resume` extends it by the same step.
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
