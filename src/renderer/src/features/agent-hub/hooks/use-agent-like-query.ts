import { getAgentLike } from "@shared/api/radient/agents-api";
import type { AgentLike } from "@shared/api/radient/types";
import { apiConfig } from "@shared/config";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useQuery } from "@tanstack/react-query";

// Query keys for agent like status
export const agentLikeKeys = {
	all: ["agent-like"] as const,
	detail: (agentId: string) => [...agentLikeKeys.all, agentId] as const,
};

type UseAgentLikeQueryParams = {
	agentId: string;
	enabled?: boolean;
};

/**
 * React Query hook for fetching the like status of a specific agent for the current user.
 *
 * @param agentId - The ID of the agent.
 * @param enabled - Whether the query should be enabled (default: true).
 * @returns Query result object containing the like details or an empty object if not liked.
 */
export const useAgentLikeQuery = ({
	agentId,
	enabled = true,
}: UseAgentLikeQueryParams) => {
	const { sessionToken, isAuthenticated } = useRadientAuth(); // Get auth token and status

	const query = useQuery<
		AgentLike | Record<string, never>, // Type of data returned by queryFn
		Error // Type of error
	>({
		queryKey: agentLikeKeys.detail(agentId || "invalid"),
		queryFn: async () => {
			if (!agentId) {
				throw new Error("Agent ID is required to fetch like status.");
			}
			if (!sessionToken) {
				throw new Error("Authentication required to fetch like status.");
			}
			const response = await getAgentLike(
				apiConfig.radientBaseUrl,
				agentId,
				sessionToken,
			);
			return response.result;
		},
		enabled: !!agentId && enabled && isAuthenticated, // Use isAuthenticated status
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes garbage collection time
		refetchOnWindowFocus: true, // Refetch on focus to get latest status
	});

	// Determine boolean liked status from the data
	const isLiked = !!query.data && Object.keys(query.data).length > 0;

	return { ...query, isLiked }; // Return the raw query object plus the boolean status
};
