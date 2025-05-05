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
 */
export type UsePublicAgentsQueryParams = {
	page?: number;
	perPage?: number;
	enabled?: boolean; // Allow disabling the query
	/**
	 * Filter by categories (array of category keys, snake_case).
	 * If provided, only agents in these categories will be returned.
	 */
	categories?: string[];
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
}: UsePublicAgentsQueryParams = {}) => {
	const query = useQuery<
		RadientApiResponse<PaginatedAgentList>, // Type of data returned by queryFn
		Error, // Type of error
		PaginatedAgentList // Type of data returned by select
	>({
		queryKey: [
			"public-agents",
			"list",
			{ page, perPage, categories: categories?.join(",") ?? undefined },
		],
		queryFn: async () => {
			// Fetch agents using the API client function
			const response = await listAgents(
				apiConfig.radientBaseUrl,
				page,
				perPage,
				categories && categories.length > 0
					? { categories: categories.join(",") }
					: undefined,
			);
			// The API client already handles basic error checking (non-2xx status)
			return response;
		},
		select: (data) => data.result, // Select the 'result' part of the API response
		enabled: enabled, // Control whether the query runs
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes garbage collection time
		refetchOnWindowFocus: false, // Optional: prevent refetch on window focus
	});

	return {
		...query,
		// Expose agents and pagination info directly for convenience
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
