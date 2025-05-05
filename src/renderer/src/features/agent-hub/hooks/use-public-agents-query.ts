import { listAgents } from "@shared/api/radient/agents-api";
import type {
	PaginatedAgentList,
	RadientApiResponse,
} from "@shared/api/radient/types";
import { apiConfig } from "@shared/config";
import { useQuery } from "@tanstack/react-query";

// Query keys for public agents
export const publicAgentKeys = {
	all: ["public-agents"] as const,
	list: (page: number, perPage: number) =>
		[...publicAgentKeys.all, "list", { page, perPage }] as const,
};

/**
 * Parameters for usePublicAgentsQuery.
 *
 * @property page - The page number to fetch (default: 1)
 * @property perPage - The number of agents per page (default: 20)
 * @property enabled - Whether the query should be enabled (default: true)
 * @property categories - Filter by categories (array of category keys, snake_case)
 * @property sort - Sort key (allowed: "name", "created_at", "updated_at", "like_count", "favourite_count", "download_count")
 * @property order - Sort order ("asc" or "desc")
 */
export type UsePublicAgentsQueryParams = {
	page?: number;
	perPage?: number;
	enabled?: boolean;
	categories?: string[];
	/**
	 * Sort key (allowed: "name", "created_at", "updated_at", "like_count", "favourite_count", "download_count").
	 * Defaults to "download_count" if not specified.
	 */
	sort?: "name" | "created_at" | "updated_at" | "like_count" | "favourite_count" | "download_count";
	/**
	 * Sort order ("asc" or "desc"). Defaults to "desc" if not specified.
	 */
	order?: "asc" | "desc";
};

/**
 * React Query hook for fetching a paginated list of public agents.
 *
 * @param page - The page number to fetch (default: 1)
 * @param perPage - The number of agents per page (default: 20)
 * @param enabled - Whether the query should be enabled (default: true)
 * @returns Query result object for the list of public agents
 */
/**
 * React Query hook for fetching a paginated list of public agents.
 *
 * @param page - The page number to fetch (default: 1)
 * @param perPage - The number of agents per page (default: 20)
 * @param enabled - Whether the query should be enabled (default: true)
 * @param categories - Array of category keys to filter by (snake_case)
 * @returns Query result object for the list of public agents
 */
export const usePublicAgentsQuery = ({
	page = 1,
	perPage = 20,
	enabled = true,
	categories,
	sort,
	order,
}: UsePublicAgentsQueryParams = {}) => {
	// Allowed sort fields and orders
	const allowedSortFields = [
		"name",
		"created_at",
		"updated_at",
		"like_count",
		"favourite_count",
		"download_count",
	] as const;
	const allowedOrder = ["asc", "desc"] as const;

	// Default to download_count/desc if not specified or invalid
	const validatedSort =
		sort && allowedSortFields.includes(sort)
			? sort
			: "download_count";
	const validatedOrder =
		order && allowedOrder.includes(order)
			? order
			: "desc";

	const query = useQuery<
		RadientApiResponse<PaginatedAgentList>,
		Error,
		PaginatedAgentList
	>({
		queryKey: [
			"public-agents",
			"list",
			{
				page,
				perPage,
				categories: categories?.join(",") ?? undefined,
				sort: validatedSort,
				order: validatedOrder,
			},
		],
		queryFn: async () => {
			const params: Record<string, string> = {};
			if (categories && categories.length > 0) {
				params.categories = categories.join(",");
			}
			params.sort = validatedSort;
			params.order = validatedOrder;

			const response = await listAgents(
				apiConfig.radientBaseUrl,
				page,
				perPage,
				params,
			);
			return response;
		},
		select: (data) => data.result,
		enabled: enabled,
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		refetchOnWindowFocus: false,
	});

	return {
		...query,
		agents: query.data?.records,
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
