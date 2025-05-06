import { useQuery } from "@tanstack/react-query";
import { listAgentComments } from "@shared/api/radient/agents-api";
import type {
	AgentComment,
	PaginatedResponse,
} from "@shared/api/radient/types";
import { apiConfig } from "@shared/config";

// Query keys for agent comments
export const agentCommentsKeys = {
	all: ["agent-comments"] as const,
	list: (agentId: string) =>
		[...agentCommentsKeys.all, "list", agentId] as const,
};

type UseAgentCommentsQueryParams = {
	agentId: string;
	enabled?: boolean;
};

/**
 * React Query hook for fetching comments for a specific agent.
 *
 * @param agentId - The ID of the agent whose comments to fetch.
 * @param enabled - Whether the query should be enabled (default: true).
 * @returns Query result object for the agent comments.
 */
export const useAgentCommentsQuery = ({
	agentId,
	enabled = true,
}: UseAgentCommentsQueryParams) => {
	return useQuery<
		PaginatedResponse<AgentComment>, // Raw API response type
		Error, // Type of error
		PaginatedResponse<AgentComment> // Type of data selected/returned
	>({
		queryKey: agentCommentsKeys.list(agentId || "invalid"),
		queryFn: async () => {
			if (!agentId) {
				throw new Error("Agent ID is required to fetch comments.");
			}
			const response = await listAgentComments(
				apiConfig.radientBaseUrl,
				agentId,
			);
			return response.result;
		},
		enabled: !!agentId && enabled,
		staleTime: 2 * 60 * 1000, // 2 minutes
		gcTime: 5 * 60 * 1000, // 5 minutes garbage collection time
		refetchOnWindowFocus: true, // Refetch comments if window regains focus
	});
};
