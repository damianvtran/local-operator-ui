import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { ThreadFindAnswer } from "../../../../../shared/desktop-contract";
import {
	THREAD_FIND_DEFAULT_LIMIT,
	THREAD_FIND_MAX_CHARS,
	THREAD_FIND_MAX_LIMIT,
} from "../../../../../shared/desktop-contract";

/**
 * The in-thread find client: the one place a query becomes a `sessions.find`
 * request, so the hook above it holds policy and nothing holds a second copy
 * of the wire shape.
 *
 * Three decisions live here rather than being re-derived per caller:
 *
 * - TRIMMED AND BOUNDED, ONCE. The box's own `maxLength` stops a paste at 256,
 *   and this slice is the belt to that brace: a query that ever arrived longer
 *   (a caller that computed one, a paste that outran the input) is cut to the
 *   schema's bound here rather than earning the transport's generic 422. The
 *   same string is what the request carries, so the gate and the wire cannot
 *   disagree — the failure `searchQueryExceedsLimit` exists for on the sidebar,
 *   handled at the source instead of with a notice.
 * - AN EMPTY QUERY IS NOT A SEARCH, and it is answered WITHOUT a request: the
 *   box's clear gesture is the commonest way to reach this function, and a
 *   round trip for "nothing matches nothing" would be a scan spent to be told
 *   what the caller already knows. The synthetic answer is `ready` with no
 *   hits, which is exactly what the panel's empty state renders — no state of
 *   its own, no spinner.
 * - THE LIMIT IS ALWAYS SENT. The route's default is a second authority the
 *   app cannot see, and `truncated` is a fact about the list the caller asked
 *   for; `THREAD_FIND_DEFAULT_LIMIT` travels explicitly so the request is the
 *   same request whatever the backend's default becomes.
 */
export async function findThreadMessages(args: {
	sessionId: string;
	query: string;
	limit?: number;
}): Promise<ThreadFindAnswer> {
	const query = args.query.trim().slice(0, THREAD_FIND_MAX_CHARS);
	if (query.length === 0) {
		return {
			query: "",
			state: "ready",
			partial: false,
			hits: [],
			truncated: false,
		};
	}
	const limit = Math.min(
		Math.max(args.limit ?? THREAD_FIND_DEFAULT_LIMIT, 1),
		THREAD_FIND_MAX_LIMIT,
	);
	return desktopResult<ThreadFindAnswer>({
		op: "sessions.find",
		sessionId: args.sessionId,
		q: query,
		limit,
	});
}
