import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
/**
 * The chat sidebar's backend search, as a query the sidebar can read.
 *
 * The sidebar used to filter the rows it already held, on their titles. That
 * cannot find a conversation by anything SAID in it, which is how people
 * remember them — the reported failure behind the CLI's `/resume` work, and the
 * reason the store has a digest index at all. So the sidebar asks the same
 * endpoint the picker and the phone run, and this module is the whole of its
 * side: debounce the box, ask for the settled query, and hand back the answer
 * with the question it answers.
 *
 * Two deliberate properties:
 *
 * - **The answer is keyed and echoed, never assumed.** `react-query` caches per
 *   query string (so backspacing re-uses an answer instead of re-asking), and
 *   the response's own echoed `query` is what the caller checks before using it
 *   (see `hitsAnswerQuery`). A slow request landing after a fast later one would
 *   otherwise filter the list by the wrong question.
 * - **No retry.** Each keystroke is its own request and the next one supersedes
 *   this one; retrying a failed search only delays the honest fallback the
 *   caller already applies, and re-asking a question the user has moved on from
 *   spends the store scan for an answer nobody is waiting for.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SESSION_SEARCH_DEFAULT_LIMIT } from "../../../../../shared/desktop-contract";
import type { SessionSearchResult } from "../../../../../shared/desktop-session-contract";
import { desktopResult } from "./desktop-api";

/**
 * How long the sidebar waits after the last keystroke before asking.
 *
 * A measured, not a guessed, number: a search over the reporting machine's
 * store costs ~45 ms of server work (a bounded head read per session, the
 * cached index, and the query), so the debounce exists to keep a fast typist
 * from queueing a scan per character rather than to hide the cost. Below ~100 ms
 * the box feels uncoupled from the list; above ~250 ms a search that is already
 * fast reads as sluggish.
 */
export const CHAT_SEARCH_DEBOUNCE_MS = 150;

/** One cache entry per query string, so a repeated query is not re-asked. */
export function chatSearchKey(query: string) {
	return ["desktop", "sessions", "search", query] as const;
}

export function useChatSearch(query: string, enabled: boolean) {
	// The DEBOUNCED query is what is asked for and what keys the cache; the raw
	// box value stays with the caller so the list can still narrow on a local
	// match while the request is in flight.
	const settled = useDebouncedValue(query.trim(), CHAT_SEARCH_DEBOUNCE_MS);
	const result = useQuery({
		queryKey: chatSearchKey(settled),
		enabled: enabled && settled.length > 0,
		queryFn: () =>
			desktopResult<SessionSearchResult>({
				op: "sessions.search",
				q: settled,
				limit: SESSION_SEARCH_DEFAULT_LIMIT,
			}),
		// Long enough that re-typing the same query during a session is free,
		// short enough that a conversation finished a moment ago appears when its
		// name is typed without waiting for a refetch.
		staleTime: 30_000,
		// Keeps the previous answer visible while the next request runs, so the
		// list does not flash empty between keystrokes. It is only USED when the
		// echoed query is the box's or a prefix of it (`hitsAnswerQuery`), so what
		// survives a keystroke is the answer to the word being extended -- never an
		// answer to some unrelated earlier query (select-all and retype). The cost
		// is that conversation matches lag the box by at most one debounce plus a
		// round trip, which is the trade this makes against a list that collapses
		// and re-expands on every character.
		placeholderData: keepPreviousData,
		retry: false,
	});
	return { settled, ...result };
}
