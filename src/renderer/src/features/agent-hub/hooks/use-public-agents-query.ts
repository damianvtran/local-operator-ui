import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { listAgents } from "@shared/api/radient/agents-api";
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
 * Parameters for usePublicAgentsQuery.
 *
 * @property enabled - Whether the query should be enabled (default: true)
 * @property categories - Filter by categories (array of category keys, snake_case)
 */
export type UsePublicAgentsQueryParams = Partial<PublicAgentFilters> & {
	enabled?: boolean;
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

	const query = useQuery<
		RadientApiResponse<PaginatedAgentList>,
		Error,
		PaginatedAgentList
	>({
		queryKey: publicAgentKeys.list(filters),
		queryFn: async () => {
			const params: Record<string, string> = {};
			if (categories && categories.length > 0) {
				params.categories = categories.join(",");
			}
			if (name) params.name = name;
			if (description) params.description = description;
			params.sort = sort;
			params.order = order;

			const response = await listAgents(page, perPage, params);
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
