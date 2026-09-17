import { getAgentStatuses } from "@shared/api/radient/agents-api";
import type { AgentViewerStatus } from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * The viewer's like and favourite state for a page of agents, in ONE request.
 *
 * ## What this replaces
 *
 * Each card used to run its own `agents.liked` and `agents.favourited` read, so
 * a twelve-card hub page fired twenty-four status requests on mount, and
 * `refetchOnWindowFocus: true` fired them again on every window focus — while
 * the list they belong to (`use-public-agents-query`) had focus refetching
 * turned OFF. That is the shape of the bug the operator reported as "feels
 * slow": the second wave arrived after first paint and then again on every
 * focus, and none of it was the list's doing.
 *
 * The op is `agents.statuses` (one call for a bounded id list, see
 * `shared/api/radient/proxy.ts`). It is additive, and the status an older
 * backend answers is **422, not 404**: `RadientRequest.operation` is a
 * `Literal`, so an op the server does not know fails VALIDATION rather than
 * routing, and `local_operator/server/app.py` flattens every `/v1/desktop/*`
 * validation failure to `422 {"detail": "The request has invalid fields."}`.
 * 404 is this app's standing signal for "this server predates that control"
 * (`shared/api/local-operator/backend-error.ts`, whose classifier returns
 * `outdated` for 404 alone and `unknown` for this), which is why nothing here
 * may be written against a 404 that never arrives: the absent op is one more
 * way this read can fail, not a distinct state with its own handling.
 *
 * ## What an absent entry means, and why the caller has to know
 *
 * The read fails as a WHOLE, so a caller cannot recover per card: a 500 from
 * the proxy, a 401/403/429, the 422 above, a dead transport, or a 200 that
 * carries fewer entries than ids all leave the same hole. An absent entry is
 * NOT `liked: false` — it is "no answer", and the two render differently:
 * `isKnown` (`query.isSuccess`) is the discriminator, and every consumer is
 * expected to read it rather than treat `statuses[id]` as a boolean.
 *
 * The degradation is otherwise safe: the upstream like and favourite endpoints
 * are idempotent (an already-liked agent answers 200 `already_liked: true`
 * rather than 409), so not KNOWING a viewer state costs at worst a no-op
 * request. What is not safe is STATING one, which is why this hook hands the
 * caller the fact that it does not know instead of an empty map dressed as
 * "nothing is liked".
 *
 * `retry: false` is deliberate. The read is a courtesy; a retry spends a second
 * round trip to learn the same thing, and the caller can offer the user the
 * choice (`refetch`, in the page's own failure line) rather than a loop paying
 * it silently.
 */

/** Query keys for the batched viewer status read, one entry per id set. */
export const agentStatusKeys = {
	all: ["agent-statuses"] as const,
	page: (agentIds: readonly string[]) =>
		[...agentStatusKeys.all, "page", [...agentIds]] as const,
};

export type AgentStatusMap = Record<string, AgentViewerStatus>;

type UseAgentStatusesQueryParams = {
	/** The ids to read, in page order; duplicates and order do not matter. */
	agentIds: readonly string[];
	enabled?: boolean;
};

/**
 * Normalise an id list into the key it will be fetched and cached under.
 *
 * Sorted and de-duplicated, so two renders that pass the same ids in a
 * different order share one cache entry instead of fetching twice.
 */
const statusIds = (agentIds: readonly string[]) =>
	[...new Set(agentIds)].sort();

export const useAgentStatusesQuery = ({
	agentIds,
	enabled = true,
}: UseAgentStatusesQueryParams) => {
	const { isAuthenticated } = useRadientAuth();

	// Keyed on the joined ids rather than the array identity: the page builds a
	// fresh array every render, and depending on it directly would refetch the
	// statuses on every keystroke elsewhere on the surface.
	const joined = agentIds.join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: `joined` IS the dependency; the array is derived from it.
	const ids = useMemo(() => statusIds(agentIds), [joined]);

	const query = useQuery<AgentStatusMap, Error>({
		queryKey: agentStatusKeys.page(ids),
		queryFn: async () => {
			const response = await getAgentStatuses(ids);
			return response.result?.statuses ?? {};
		},
		enabled: enabled && isAuthenticated && ids.length > 0,
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		// The list beside this read has focus refetching OFF; a status read that
		// kept it on is the wave this change removes. A status that changed while
		// the window was hidden is picked up by the next page or filter fetch.
		refetchOnWindowFocus: false,
		retry: false,
	});

	return {
		...query,
		/**
		 * The map to read per card — meaningful ONLY where `isKnown` is true. It is
		 * empty while the read is in flight and after it fails, and `{}` is not a
		 * claim that nothing is liked.
		 */
		statuses: (query.data ?? {}) as AgentStatusMap,
		/**
		 * Whether the read ANSWERED. False before it settles and after it fails,
		 * so a consumer renders "unknown" rather than `liked: false`.
		 */
		isKnown: query.isSuccess,
	};
};

/**
 * Whether this one agent's viewer state is known.
 *
 * Two ways to be unknown, and the entry-level check is the part that is easy to
 * miss: a 200 that carries fewer entries than ids leaves those ids with no
 * answer, so "the read succeeded" is not the same as "this id was answered".
 * Both consumers (the grid's cards and the details page) ask this rather than
 * spreading the map and defaulting each card to `false`.
 */
export const isAgentStatusKnown = (
	isKnown: boolean,
	statuses: AgentStatusMap,
	agentId: string | undefined,
): boolean => (agentId ? isKnown && statuses[agentId] !== undefined : false);

/**
 * Apply one agent's new viewer state to every cached status page.
 *
 * Used by the like and favourite mutations, which know the new state from their
 * own response. Patching rather than invalidating keeps a toggle at zero
 * further requests: the page's status map was one read, and a refetch of it to
 * learn one boolean would undo the point of batching it.
 */
export const patchAgentStatus = (
	queryClient: QueryClient,
	agentId: string,
	patch: Partial<AgentViewerStatus>,
) => {
	queryClient.setQueriesData<AgentStatusMap>(
		{ queryKey: agentStatusKeys.all },
		(previous) => {
			if (!previous) return previous;
			const current = previous[agentId] ?? { liked: false, favourited: false };
			return { ...previous, [agentId]: { ...current, ...patch } };
		},
	);
};
