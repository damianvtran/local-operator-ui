import { useQuery } from "@tanstack/react-query";
import { listAgentComments } from "@shared/api/radient/agents-api";
import { apiConfig } from "@shared/config";
import type { AgentComment } from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";

// Query keys for agent comments
export const agentCommentsKeys = {
  all: ["agent-comments"] as const,
  list: (agentId: string) => [...agentCommentsKeys.all, "list", agentId] as const,
};

type UseAgentCommentsQueryParams = {
  agentId: string;
  enabled?: boolean; // Allow disabling the query
};

/**
 * React Query hook for fetching comments for a specific agent.
 * Requires authentication.
 *
 * @param agentId - The ID of the agent whose comments to fetch.
 * @param enabled - Whether the query should be enabled (default: true).
 * @returns Query result object for the agent comments.
 */
export const useAgentCommentsQuery = ({
  agentId,
  enabled = true,
}: UseAgentCommentsQueryParams) => {
  const { isAuthenticated, sessionToken } = useRadientAuth();

  const query = useQuery<
    AgentComment[], // Type of data returned by queryFn
    Error // Type of error
  >({
    // Ensure queryKey is valid even if agentId is temporarily undefined/empty
    queryKey: agentCommentsKeys.list(agentId || "invalid"),
    queryFn: async () => {
      if (!agentId) {
        throw new Error("Agent ID is required to fetch comments.");
      }
      if (!sessionToken) {
        // This should ideally not happen if enabled is true and isAuthenticated is true,
        // but added as a safeguard.
        throw new Error("Authentication token is required to fetch comments.");
      }
      // Fetch comments using the API client function
      const comments = await listAgentComments(
        apiConfig.radientBaseUrl,
        agentId,
        sessionToken,
      );
      return comments;
    },
    // Enable the query only if agentId is provided, user is authenticated, and the enabled prop is true
    enabled: !!agentId && isAuthenticated && !!sessionToken && enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes garbage collection time
    refetchOnWindowFocus: true, // Refetch comments if window regains focus
  });

  return query; // Return the raw query object
};
