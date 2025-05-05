import { getAgent } from "@shared/api/radient/agents-api";
import type { Agent, RadientApiResponse } from "@shared/api/radient/types";
import { apiConfig } from "@shared/config";
import { useQuery } from "@tanstack/react-query";

// Query keys for agent details
export const agentDetailsKeys = {
	all: ["agent-details"] as const,
	detail: (agentId: string) => [...agentDetailsKeys.all, agentId] as const,
};

type UseAgentDetailsQueryParams = {
	agentId: string;
	enabled?: boolean; // Allow disabling the query
};

/**
 * React Query hook for fetching details of a specific public agent.
 *
 * @param agentId - The ID of the agent to fetch.
 * @param enabled - Whether the query should be enabled (default: true).
 * @returns Query result object for the agent details.
 */
export const useAgentDetailsQuery = ({
	agentId,
	enabled = true,
}: UseAgentDetailsQueryParams) => {
	const query = useQuery<
		RadientApiResponse<Agent>, // Type of data returned by queryFn
		Error, // Type of error
		Agent // Type of data returned by select
	>({
		// Ensure queryKey is valid even if agentId is temporarily undefined/empty during render cycles
		queryKey: agentDetailsKeys.detail(agentId || "invalid"),
		queryFn: async () => {
			if (!agentId) {
				throw new Error("Agent ID is required to fetch details.");
			}
			// Fetch agent details using the API client function
			const response = await getAgent(apiConfig.radientBaseUrl, agentId);
			// The API client already handles basic error checking (non-2xx status)
			return response;
		},
		select: (data) => data.result, // Select the 'result' part of the API response
		// Enable the query only if agentId is provided and the enabled prop is true
		enabled: !!agentId && enabled,
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes garbage collection time
		refetchOnWindowFocus: false, // Optional: prevent refetch on window focus
	});

	return query; // Return the raw query object
};
