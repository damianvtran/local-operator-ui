import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { useQuery } from "@tanstack/react-query";
import { PROJECTS_SEARCH_DEFAULT_LIMIT } from "../../../../../shared/desktop-contract";
import type { DesktopProjectSearchResults } from "../../../../../shared/desktop-control-contract";
import { projectsSearchQuery } from "../project-search";

/**
 * The Projects search's BACKEND engine: the box, debounced, asked of
 * `GET /v1/desktop/projects/search`, with an answer handed back only when it is
 * the answer to what is in the box RIGHT NOW.
 *
 * WHY THE BACKEND HAS AN ENGINE AT ALL. The client matcher (`project-search.ts`)
 * ranks over the fields the LISTING carries, and it is deliberately blind to the
 * two the wire keeps back: `updates[]` and the progress snippet are detail-only
 * by design, and they are the largest slice of the corpus (564 KB of the store's
 * 651 KB when the design was measured). No renderer-side matcher can find a word
 * said in an update, so the client matcher never fakes one; the backend's
 * derived index ranks over all of it, with the soft-match tiers the session
 * search already ships (casefold + diacritic fold, prefixes, bounded typos,
 * order-independent token-AND).
 *
 * THE CLIENT MATCHER IS NOT RETIRED BY THIS HOOK. It has two jobs it keeps:
 * it is the compatibility path for a backend that advertises `projects` at
 * version 1 (which has no such route to answer), and it is the row set the page
 * paints WHILE this hook has no answer — during the debounce window, across the
 * round trip, and permanently when the request fails. The page composes the two
 * (`matchedProjects`), so this hook holds policy about the wire and nothing
 * about what a view draws.
 *
 * WHERE THE CANCELLATION IS, since there is none at the transport: an IPC
 * `invoke` cannot be aborted, and `use-thread-search` states the same limit for
 * the same reason. Three properties make aborting unnecessary rather than
 * merely absent. The DEBOUNCE coalesces a fast typist into one request per
 * pause instead of one per character. The ANSWER'S OWN ECHO gates it — the
 * route echoes `query`, and an answer is applied only when that echo equals the
 * string this client asked for, so a slow answer landing after a fast later one
 * cannot filter the list by the wrong question. And React Query keys the cache
 * by the asked string, so backspacing re-uses an answer instead of re-asking,
 * and re-typing a query is free inside `staleTime`.
 *
 * Reads with no retry, deliberately: each keystroke is its own request and the
 * next one supersedes this one, so retrying a failure only delays the honest
 * fallback the page already applies (the client matcher's rows, which are a true
 * answer to the same box). That is `useChatSearch`'s rule for the same reason.
 */

/**
 * How long the box waits after the last keystroke before asking.
 *
 * The sidebar's own 150 ms (`CHAT_SEARCH_DEBOUNCE_MS`) is measured against a
 * ~45 ms server scan; this route's live 146-row store measured a ~65 ms warm p95
 * against a ~40 ms internal budget (core PR #1896, and re-measured on this
 * branch), so the debounce sits on the slow half of the 150-250 ms window the
 * design allows. The cost that buys is that a fast typist queues one request per
 * pause rather than one per character; the price is that a query is answered by
 * the index ~180 ms after the typing stops rather than immediately, which is why
 * the page keeps painting the client matcher's rows throughout that window
 * instead of blanking the list.
 */
export const PROJECTS_SEARCH_DEBOUNCE_MS = 180;

export type UseProjectsSearchResult = {
	/**
	 * The backend's answer for the box's CURRENT value, or `null` while none has
	 * landed (still debouncing, in flight, failed, or no backend engine at all).
	 * A non-null answer is authoritative: the page paints its rows.
	 */
	answer: DesktopProjectSearchResults | null;
	/**
	 * The box's value has no answer yet and none has failed: a request is due.
	 *
	 * THIS IS THE WHOLE CALLER-FACING CONTRACT, and the failure arm is
	 * deliberately not a third field: a failure is not a state the page renders
	 * differently — it is the FALLBACK ENGINE's rows, which the page already
	 * paints whenever `answer` is null, and whose honesty is carried by the
	 * per-engine no-match sentence rather than by a flag nobody would read
	 * (review round 1, MINOR-1). `failed` is computed below because `pending`
	 * cannot be: both are answered by "the answer is absent", and they are told
	 * apart by whether the request ERRORED.
	 */
	pending: boolean;
};

/**
 * Ask the backend for the box's value, debounced, and report what is known.
 *
 * `enabled` is an INPUT rather than a derivation, the rule this feature's data
 * layer states: the caller owns the capability gate, because a request fired
 * before the capability answer arrives would 404 against a backend that
 * advertises no such route and paint a failure the reader cannot act on.
 */
export function useProjectsSearch(
	query: string,
	enabled: boolean,
): UseProjectsSearchResult {
	const asked = projectsSearchQuery(query);
	const debounced = useDebouncedValue(asked, PROJECTS_SEARCH_DEBOUNCE_MS);
	const result = useQuery({
		queryKey: ["desktop", "projects", "search", debounced] as const,
		enabled: enabled && debounced.length > 0,
		queryFn: () =>
			desktopResult<DesktopProjectSearchResults>({
				op: "projects.search",
				q: debounced,
				limit: PROJECTS_SEARCH_DEFAULT_LIMIT,
			}),
		retry: false,
		staleTime: 30_000,
	});
	/*
	 * The debounce has settled on the box's current value. Until it has, the
	 * query's data belongs to an EARLIER box, and using it would put rows in the
	 * list that the box's own search would not return — the failure the session
	 * search withdrew a prefix rule over (a prefix is not a smaller question but
	 * a larger one).
	 */
	const settled = debounced === asked;
	/*
	 * The echo is checked as well as the key, and the check is not redundant
	 * bookkeeping: `query` is the route's own statement of what it answered, so a
	 * backend that ignored `q` — or a proxy that served a cached answer for
	 * another string — is caught here rather than silently painting the wrong
	 * rows. `hitsAnswerQuery` is the session search's rule in the same words.
	 */
	const answer =
		settled && result.data && result.data.query === asked ? result.data : null;
	const failed = settled && asked.length > 0 && !answer && result.isError;
	return {
		answer,
		pending: enabled && asked.length > 0 && !answer && !failed,
	};
}
