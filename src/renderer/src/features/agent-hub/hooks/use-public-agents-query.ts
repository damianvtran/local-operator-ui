import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { listAgents, listOrgAgents } from "@shared/api/radient/agents-api";
import type {
	PaginatedAgentList,
	RadientApiResponse,
} from "@shared/api/radient/types";
import {
	type QueryClient,
	keepPreviousData,
	useQuery,
} from "@tanstack/react-query";

/**
 * The filters the hub's list control actually offers.
 *
 * `name` and `description` are separate because that is what the API has: the
 * backend puts both on one Mongo filter, so sending both for one search box is
 * an AND between them rather than an OR, and a search that only matches the
 * description would return nothing. The hub therefore searches one field at a
 * time, which is why the control has a scope rather than a single free-text box.
 *
 * `sort`/`order` are the pair the repository whitelists
 * (`agent_repository.go`, `allowedSortFields`); anything else silently falls
 * back to `created_at desc` upstream, so a control that offered more would be
 * offering a sort that does not happen.
 */
export type PublicAgentFilters = {
	page: number;
	perPage: number;
	categories?: readonly string[];
	name?: string;
	description?: string;
	sort: PublicAgentSort;
	order: "asc" | "desc";
};

export type PublicAgentSort =
	| "name"
	| "created_at"
	| "updated_at"
	| "like_count"
	| "favourite_count"
	| "download_count";

export const DEFAULT_PUBLIC_AGENT_SORT: PublicAgentSort = "download_count";

/**
 * Query keys for the public agent list.
 *
 * ONE shape, and the hook below builds its key with it rather than with a
 * literal of its own. It used to do both: `list(page, perPage)` existed for
 * callers to invalidate while the hook keyed its own inline array carrying the
 * category, sort and order — so the delist mutation invalidated a key no query
 * was ever registered under, and a delisted agent stayed on the grid until the
 * five-minute `staleTime` expired. Anything that wants to reach every list
 * cache goes through {@link invalidatePublicAgentLists}, which matches this
 * prefix, rather than through a guess at one page's filters.
 */
export const publicAgentKeys = {
	all: ["public-agents"] as const,
	list: (filters: PublicAgentFilters) =>
		[
			...publicAgentKeys.all,
			"list",
			{
				page: filters.page,
				perPage: filters.perPage,
				categories: filters.categories?.join(",") ?? undefined,
				name: filters.name ?? undefined,
				description: filters.description ?? undefined,
				sort: filters.sort,
				order: filters.order,
			},
		] as const,
};

/**
 * Query keys for one organization's workspace list.
 *
 * A SEPARATE prefix rather than the public one with a tenant in it, because the
 * two reads are different questions answered by different routes: a cache entry
 * shared between them would let a page that flipped its scope render the other
 * scope's records under the new scope's label — the one failure a scope selector
 * must not have. The tenant id is in the key for the same reason; the filters
 * are laid out exactly as the public builder lays them out, so a reader compares
 * one shape, not two.
 */
export const orgAgentKeys = {
	all: ["org-agents"] as const,
	list: (tenantId: string, filters: PublicAgentFilters) =>
		[
			...orgAgentKeys.all,
			"list",
			tenantId,
			{
				page: filters.page,
				perPage: filters.perPage,
				categories: filters.categories?.join(",") ?? undefined,
				name: filters.name ?? undefined,
				description: filters.description ?? undefined,
				sort: filters.sort,
				order: filters.order,
			},
		] as const,
};

/**
 * Drop every cached page of the public list.
 *
 * A publish or a delist changes membership, and which cached pages that affects
 * is not knowable from here — a delist shifts the records after it onto the
 * previous page. Invalidating the prefix is one round trip for the visible page
 * and correct for the rest, which is the trade this makes deliberately: the
 * alternative is a key no query matches, which is the defect this replaces.
 */
export const invalidatePublicAgentLists = (queryClient: QueryClient) =>
	queryClient.invalidateQueries({ queryKey: publicAgentKeys.all });

/**
 * Drop every cached page of one organization's workspace list — or of all of
 * them, when no tenant is named.
 *
 * Beside the public invalidator and separate from it, because the two prefixes
 * are separate: a caller that delists an org agent has to reach the org pages,
 * and one that delists a public agent must not re-read an org's. A delist shifts
 * the records after it onto the previous page for the same reason it does on the
 * hub, which is why the prefix is the scope rather than one page's key.
 */
export const invalidateOrgAgentLists = (
	queryClient: QueryClient,
	tenantId?: string,
) =>
	queryClient.invalidateQueries({
		queryKey: tenantId
			? ([...orgAgentKeys.all, "list", tenantId] as const)
			: orgAgentKeys.all,
	});

/**
 * Parameters for usePublicAgentsQuery.
 *
 * @property enabled - Whether the query should be enabled (default: true)
 * @property categories - Filter by categories (array of category keys, snake_case)
 */
export type UsePublicAgentsQueryParams = Partial<PublicAgentFilters> & {
	enabled?: boolean;
	/**
	 * The organization whose workspace to read instead of the public hub.
	 *
	 * Absent means the public hub — the scope every caller had before this field
	 * existed — and present means `org_agents.list`, a DIFFERENT route with a
	 * different key prefix and a different cache entry. One hook rather than two,
	 * because the page must not be able to hold both scopes' records at once: the
	 * scope decides the read, and a single call site is what makes that true.
	 */
	tenantId?: string;
};

/**
 * React Query hook for fetching a paginated list of public agents.
 *
 * The counts the hub cards print — likes, favourites, downloads — come from the
 * records this returns, not from three further reads per card: the list
 * projection already carries all three (`responses.AgentResponse`), so the
 * per-card count queries were asking the same question twelve more times.
 *
 * `keepPreviousData` is what keeps the grid on screen while the next page or
 * the next filter loads. Without it React Query reports no data for the new key
 * and the page emptied to a spinner on every page change.
 */
export const usePublicAgentsQuery = ({
	page = 1,
	perPage = 20,
	enabled = true,
	categories,
	name,
	description,
	sort = DEFAULT_PUBLIC_AGENT_SORT,
	order = "desc",
	tenantId,
}: UsePublicAgentsQueryParams = {}) => {
	const filters: PublicAgentFilters = {
		page,
		perPage,
		categories,
		name,
		description,
		sort,
		order,
	};

	/*
	 * The key and the request are decided by the SAME `tenantId`, in this one
	 * expression's neighbourhood, because the pair drifting apart is the defect
	 * this file's own header describes: a query keyed for one read and fetching
	 * another leaves records under the wrong label (the public builder's
	 * `invalidatePublicAgentLists` finding no query was the same class).
	 */
	const queryKey = tenantId
		? orgAgentKeys.list(tenantId, filters)
		: publicAgentKeys.list(filters);

	const query = useQuery<
		RadientApiResponse<PaginatedAgentList>,
		Error,
		PaginatedAgentList
	>({
		queryKey,
		queryFn: async () => {
			const params: Record<string, string> = {};
			if (categories && categories.length > 0) {
				params.categories = categories.join(",");
			}
			if (name) params.name = name;
			if (description) params.description = description;
			params.sort = sort;
			params.order = order;

			const response = tenantId
				? await listOrgAgents(tenantId, page, perPage, params)
				: await listAgents(page, perPage, params);
			return response;
		},
		select: (data) => data.result,
		enabled: enabled,
		/*
		 * The house retry policy for a read that goes through this transport: one
		 * more attempt for a server that answered, and none for one that never
		 * answered at all. The default would spend three on a backend that is not
		 * running, which is the state where "try again" is known to be futile.
		 */
		retry: retryDesktopQuery,
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		refetchOnWindowFocus: false,
		placeholderData: keepPreviousData,
	});

	return {
		...query,
		agents: query.data?.records,
		/** True while a NEW page or filter is in flight over data already shown. */
		isRefreshing: query.isFetching && query.data !== undefined,
		pagination: query.data
			? {
					page: query.data.page,
					perPage: query.data.per_page,
					totalPages: query.data.total_pages,
					totalRecords: query.data.total_records,
				}
			: undefined,
	};
};
