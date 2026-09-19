import {
	effectiveSearchQuery,
	searchQueryExceedsLimit,
} from "@features/chat/chat-search";
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
 * Three deliberate properties:
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
 * - **One string decides and is sent.** The gate that refuses an over-limit
 *   query and the `q` that goes out are the same value, resolved once here —
 *   this module is the only place that knows what would actually be sent. Gating
 *   on anything else is how an over-limit query reached the wire while the box
 *   read as legal (review round 7, R37).
 */
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
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

/**
 * One cache entry per question, so a repeated question is not re-asked.
 *
 * `includeArchived` is PART of the question and therefore part of the key, which
 * is the whole reason the sidebar's control can be a control: the two answers to
 * one query text are answers to two different questions, and a cache keyed on the
 * text alone would serve the answer that carries the archived hits to a panel
 * whose control says they are hidden - rows that then survive their own removal.
 */
export function chatSearchKey(query: string, includeArchived = false) {
	return ["desktop", "sessions", "search", query, includeArchived] as const;
}
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";

export function useChatSearch(
	query: string,
	enabled: boolean,
	includeArchived = false,
) {
	// The DEBOUNCED query is what is asked for and what keys the cache; the raw
	// box value stays with the caller so the list can still narrow on a local
	// match while the request is in flight.
	const debounced = useDebouncedValue(query.trim(), CHAT_SEARCH_DEBOUNCE_MS);
	/*
	 * The one string this hook acts on, resolved from both inputs: the debounced
	 * value, except where the box has already left an over-limit string behind
	 * (see `effectiveSearchQuery`). `asked` is what the gate is measured against
	 * AND what is sent, so the two cannot disagree — which they did while the gate
	 * read the box and the request carried the debounced value (review round 7,
	 * R37).
	 */
	const asked = effectiveSearchQuery(query, debounced);
	/*
	 * Whether that string is refused, computed HERE rather than left to the caller:
	 * a surface that re-derives it from the box can only re-derive the old answer,
	 * and the caller's job is to say what the refusal means, not to decide it.
	 */
	const refused = searchQueryExceedsLimit(asked);
	const result = useQuery({
		queryKey: chatSearchKey(asked, includeArchived),
		enabled: enabled && asked.length > 0 && !refused,
		queryFn: async () => {
			/*
			 * THE ANSWER'S CURRENCY, taken here rather than where the answer is read. The
			 * sequence describes the moment this request STARTS, so an answer that was in
			 * flight across a pin press cannot supersede the press it predates - and an
			 * answer requested after a press does supersede it, which is what makes a pin
			 * removed on the other surface stop reading pinned here (round 3's code round:
			 * without this the client's fact outranked every later answer). The same
			 * currency carries the archive facts, which is why ONE counter orders both:
			 * an answer in flight across an archive press cannot supersede it either, and
			 * one requested after a press settles it, which is what makes an unarchive
			 * made in the terminal stop reading archived here.
			 */
			const seq = useCanonicalSessionsStore.getState().beginAnswer();
			const answer = await desktopResult<SessionSearchResult>({
				op: "sessions.search",
				q: asked,
				limit: SESSION_SEARCH_DEFAULT_LIMIT,
				/*
				 * Omitted when false rather than sent as `false`: the route's default IS
				 * false, so the ordinary search keeps the request it always sent, and a
				 * backend that has not learned the flag keeps answering it.
				 */
				...(includeArchived ? { include_archived: true } : {}),
			});
			useCanonicalSessionsStore
				.getState()
				.applySearchAnswer(seq, answer.sessions ?? []);
			return answer;
		},
		// Long enough that re-typing the same query during a session is free,
		// short enough that a conversation finished a moment ago appears when its
		// name is typed without waiting for a refetch.
		staleTime: 30_000,
		// Keeps the previous answer visible while the next request runs, so the
		// list does not flash empty between keystrokes. It is USED only when the
		// echoed query is EXACTLY the box's (`hitsAnswerQuery`), which is the rule
		// round 2 (R10) settled on after a prefix rule was tried and withdrawn: a
		// prefix is not a smaller question but a LARGER one, so `retention`'s
		// answer shown under `retentionx` puts rows in the list that the box's own
		// search would not return, every one of them marked as a conversation
		// match. What a stale answer therefore buys is only that the list holds
		// its name matches while the new answer is in flight, and the panel says
		// as much in words (`awaiting`). The cost is that conversation matches lag
		// the box by at most one debounce plus a round trip, which is the trade
		// this makes against a list that collapses and re-expands on every
		// character.
		placeholderData: keepPreviousData,
		retry: false,
	});
	return { settled: asked, refused, ...result };
}
