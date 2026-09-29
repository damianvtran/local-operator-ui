/**
 * The in-thread search overlay's pure half: the chord that opens it, the state
 * ladder an answer resolves to, the cursor arithmetic, and the segment split
 * the results list renders.
 *
 * Extracted from the overlay so each decision can be exercised directly
 * (`scripts/thread-search-model.test.mjs` bundles this module), for the reason
 * `checkpoint-model.ts` gives one file over: a rule that is only eyeballed in a
 * story is a rule that drifts silently when the surface around it changes.
 *
 * The WIRE DTOs live in `src/shared/desktop-contract.ts` beside the op that
 * answers with them (`sessions.find`); this module imports them rather than
 * holding a second definition that could drift from the schema.
 */

import type {
	ThreadFindAnswer,
	ThreadFindHit,
	ThreadFindState,
} from "../../../../../shared/desktop-contract";

/**
 * Whether this is the in-thread find press: `⌘F` on macOS, `Ctrl+F` elsewhere.
 *
 * WHY `F` IS FREE TO TAKE. Nothing in the app bound it: the main process's
 * `before-input-event` ladder covers zoom, `⌘P` (the command palette) and
 * `⌘⇧S`, and no `findInPage` call site exists anywhere in `src` — so this chord
 * takes nothing away from a reader, which is the test every new binding here
 * has to pass (`canvas-shortcut.ts` states it for `⌘⇧C`).
 *
 * SHIFT AND ALT ARE REFUSED rather than folded in: `⌘⇧F` and `⌥⌘F` are other
 * apps' search-in-files chords, and a binding that answered them would claim
 * gestures this app never documented. `toLowerCase` covers the layouts that
 * report the produced character (`"F"`) rather than the base key.
 *
 * The press is answered by the OVERLAY's own listener, which adds the two
 * scoping rules a predicate cannot see: the chat surface must have the focus
 * (`chatRegionOf`), and a foreign overlay's press stays the foreign overlay's
 * (`pressLandsOnOverlay`) — except the search panel's own, which re-answers
 * the chord by selecting the input.
 */
export function isThreadSearchPress(event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}): boolean {
	if (event.shiftKey || event.altKey) return false;
	if (!(event.metaKey || event.ctrlKey)) return false;
	return event.key.toLowerCase() === "f";
}

/**
 * The caption for that chord, e.g. `⌘F`, shared with whatever prints it so the
 * cap and the press cannot drift — the shape `canvasToggleCap` established.
 */
export const threadSearchCap = (isMac: boolean): string =>
	isMac ? "⌘F" : "Ctrl+F";

/**
 * The overlay's own state, as the panel renders it.
 *
 * `loading` is the debounce window: the box holds a query the answer to which
 * has not arrived (or been asked for yet). `ready` covers "no matches as well
 * as hits — emptiness is a property of the LIST, not a phase of the request,
 * and a state of its own would have to be kept in sync with `hits.length` for
 * no reader's benefit. `building`, `unsupported` and `error` are the wire's
 * three degraded answers; the panel gives each its own copy (D9).
 */
export type ThreadSearchState =
	| "idle"
	| "loading"
	| "ready"
	| "building"
	| "unsupported"
	| "error";

/** What every phase but the box's own two resolves to. */
export type ThreadSearchAnswerState = Exclude<
	ThreadSearchState,
	"idle" | "loading"
>;

/**
 * The state one answer resolves to.
 *
 * Total rather than a pass-through: a state this client does not know is NOT
 * `ready` — the one reading that would render a payload the app cannot
 * vouch for — and it is not `unsupported` either, which names a fact about
 * where the bytes live. The honest reading is "this answer could not be
 * understood", which is what the error arm already says in the reader's terms.
 */
export function threadSearchAnswerState(
	state: ThreadFindState,
): ThreadSearchAnswerState {
	switch (state) {
		case "ready":
		case "building":
		case "unsupported":
		case "error":
			return state;
		default:
			return "error";
	}
}

/**
 * Move the results cursor by `delta`, wrapping at both ends.
 *
 * Wrapping (rather than clamping) is the find-bar convention Enter teaches:
 * `↓` on the last result returns to the first, so a reader who overshoots
 * presses once more instead of discovering a dead end. A cursor of `-1` (no
 * active row — an empty list, or an answer that just landed) resolves to the
 * first row going forward and the last going back.
 *
 * With nothing to point at the cursor is `-1`, never `0`: "the first result"
 * and "there is no result" are different answers, and the difference is
 * exactly what `aria-activedescendant` must not get wrong.
 */
export function threadSearchCursorMove(
	cursor: number,
	delta: number,
	count: number,
): number {
	if (count <= 0) return -1;
	const from = cursor < 0 || cursor >= count ? (delta > 0 ? -1 : 0) : cursor;
	return (((from + delta) % count) + count) % count;
}

/** The hit the cursor points at, or `null` when there is none. */
export function threadSearchActiveHit(
	hits: readonly ThreadFindHit[],
	cursor: number,
): ThreadFindHit | null {
	return cursor >= 0 && cursor < hits.length ? hits[cursor] : null;
}

/** One rendered run of a snippet: matched text, or the text between matches. */
export type ThreadSearchSegment = {
	text: string;
	/** Whether this run is part of the query's own literal occurrence. */
	matched: boolean;
};

/**
 * Split a snippet into the marked and unmarked runs the results row renders.
 *
 * `ranges` are the wire's snippet-relative offsets — non-overlapping, oldest
 * first, at most five, and EMPTY on a soft hit (which by construction contains
 * no literal occurrence of the query, so the row shows the words around where
 * the index says the sense matched). The walk is forward-only and clamps as it
 * goes, rather than trusting the wire or sorting: a range that starts before
 * the cursor can only mean the data disagreed with the contract, and the
 * recovery that cannot throw and cannot paint overlapping marks is to move
 * forward from wherever the cursor is. Empty runs are dropped — a zero-length
 * `<mark>` is not a match.
 */
export function splitThreadSearchRanges(
	snippet: string,
	ranges: readonly (readonly [number, number])[],
): ThreadSearchSegment[] {
	const segments: ThreadSearchSegment[] = [];
	let at = 0;
	for (const [rawStart, rawEnd] of ranges) {
		const start = Math.max(at, Math.min(snippet.length, rawStart));
		const end = Math.max(start, Math.min(snippet.length, rawEnd));
		/*
		 * A range that marks nothing (zero length, or one already covered by an
		 * earlier range) changes nothing: it does not split the run around it and
		 * it does not move the cursor. Splitting there would be invisible in the
		 * rendered text and a lie in the segment count, which is what the tests
		 * read.
		 */
		if (end <= start) continue;
		if (start > at)
			segments.push({ text: snippet.slice(at, start), matched: false });
		segments.push({ text: snippet.slice(start, end), matched: true });
		at = end;
	}
	if (at < snippet.length) {
		segments.push({ text: snippet.slice(at), matched: false });
	}
	return segments;
}

/**
 * The visible word for each role, sentence case.
 *
 * `Agent` rather than the wire's own `agent`, because the row is read by a
 * person: the manifest-level vocabulary stays on the wire (`role`), and only
 * the label is humanised. `You` rather than `User` for the same reason the
 * transcript calls the reader's own message theirs.
 */
export const THREAD_SEARCH_ROLE_LABELS: Record<ThreadFindHit["role"], string> =
	{
		user: "You",
		agent: "Agent",
	};

/** The mark a soft hit carries instead of a highlighted range (D3/D9). */
export const THREAD_SEARCH_TIER_HINT = "related";

export const THREAD_SEARCH_PLACEHOLDER = "Search this conversation";
export const THREAD_SEARCH_LIST_LABEL = "Search results";
export const THREAD_SEARCH_CLOSE_LABEL = "Close search";

/**
 * The count line's spelling, off the hit list rather than a total the wire
 * does not carry: the backend ranks and truncates, so `hits.length` is what
 * this panel can promise.
 */
export function threadSearchCountLabel(count: number): string {
	return count === 1 ? "1 match" : `${count} matches`;
}

/**
 * The panel's sentences, one per state (design D9's copy rules: every state
 * says what happened, and the recoverable ones say what to do).
 */
export const THREAD_SEARCH_EMPTY_COPY = "No messages match this search.";
export const THREAD_SEARCH_BUILDING_COPY = "Still indexing this conversation.";
export const THREAD_SEARCH_BUILDING_HINT =
	"Results appear as the index catches up.";
export const THREAD_SEARCH_PARTIAL_COPY =
	"Newer messages may be missing while the index catches up.";
export const THREAD_SEARCH_UNSUPPORTED_COPY =
	"This conversation lives on another device, so it cannot be searched here.";
export const THREAD_SEARCH_ERROR_COPY =
	"This conversation could not be searched.";
export const THREAD_SEARCH_RETRY_LABEL = "Try again";
/** The building state's control: a re-check, not a retry — nothing failed. */
export const THREAD_SEARCH_RECHECK_LABEL = "Check again";

/**
 * What the reader is told when a hit cannot be reached at all.
 *
 * `ensureReachable`'s budgets (12 pages, 1200 rows from the tail) are the
 * near path's; a message further back than that is refused honestly rather
 * than stalling the pane. The sentence names the reason rather than the
 * budget, because a reader cannot do arithmetic on the window anyway.
 */
export const THREAD_SEARCH_JUMP_MISS_COPY =
	"Could not reach that message. It is further back than the loaded history.";

/** The line a truncated list carries, so a floor is never read as a total. */
export function threadSearchTruncatedLabel(count: number): string {
	return `Showing the first ${count} matches.`;
}

/**
 * Whether an answer leaves something worth re-asking.
 *
 * Only `building` does, and it is the ONE follow-up the hook arms: the backend
 * answers `building` inside its first-paint budget while a background scan
 * runs, so a single re-ask after a short delay is how a reader who paused
 * still sees the index's own result. `ready` has nothing left to wait for,
 * `error`'s retry belongs to a gesture (the panel's own control), and
 * `unsupported` is a fact about where the bytes live that no amount of asking
 * changes — polling it would be minutes of requests that cannot answer
 * differently.
 */
export function threadSearchWantsFollowUp(answer: ThreadFindAnswer): boolean {
	return answer.state === "building";
}
