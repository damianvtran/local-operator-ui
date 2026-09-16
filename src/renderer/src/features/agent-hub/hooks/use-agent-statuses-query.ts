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
 * `shared/api/radient/proxy.ts`). It is additive: a backend older than this app
 * answers 404, which is this app's standing signal for "this server predates
 * that control" (`DesktopControlError.status === 404`, read the same way by the
 * compatibility banner).
 *
 * ## Why a 404 is not an error state here
 *
 * A hub card with no viewer state still works. The upstream like and favourite
 * endpoints are idempotent — liking an already-liked agent answers 200
 * `already_liked: true` rather than 409 — so an unfilled heart on an agent the
 * viewer has liked costs a no-op request, not a wrong write. That is what makes
 * failing open safe here, and it is why this hook reports `statuses` rather
 * than an error to render: nothing the user did is broken, so nothing says it
 * is.
 *
 * `retry: false` is deliberate for the same reason. The read is a courtesy; a
 * retry spends a second round trip to learn the same thing, and a stale
 * unfilled heart is corrected by the next page fetch rather than by a retry
 * loop.
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
		 * The map to read per card. Empty while loading and when the op is
		 * unavailable, which the card renders as "no viewer state known".
		 */
		statuses: (query.data ?? {}) as AgentStatusMap,
		/** True only once the read has actually answered. */
		isKnown: query.isSuccess,
	};
};

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
