import { useQuery } from "@tanstack/react-query";
import { getAgentFavouriteCount } from "@shared/api/radient/agents-api";
import { apiConfig } from "@shared/config";
import type { CountResponse } from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";

// Query keys for agent favourite count
export const agentFavouriteCountKeys = {
  all: ["agent-favourite-count"] as const,
  count: (agentId: string) => [...agentFavouriteCountKeys.all, agentId] as const,
};

type UseAgentFavouriteCountQueryParams = {
  agentId: string;
  enabled?: boolean; // Allow disabling the query
};

/**
 * React Query hook for fetching the favourite count for a specific agent.
 * Requires authentication.
 *
 * @param agentId - The ID of the agent whose favourite count to fetch.
 * @param enabled - Whether the query should be enabled (default: true).
 * @returns Query result object for the agent favourite count.
 */
export const useAgentFavouriteCountQuery = ({
  agentId,
  enabled = true,
}: UseAgentFavouriteCountQueryParams) => {
  const { isAuthenticated, sessionToken } = useRadientAuth();

  const query = useQuery<
    CountResponse, // Type of data returned by queryFn
    Error, // Type of error
    number // Type of data returned by select
  >({
    queryKey: agentFavouriteCountKeys.count(agentId || "invalid"),
    queryFn: async () => {
      if (!agentId) {
        throw new Error("Agent ID is required to fetch favourite count.");
      }
      if (!sessionToken) {
        throw new Error("Authentication token is required to fetch favourite count.");
      }
      const response = await getAgentFavouriteCount(
        apiConfig.radientBaseUrl,
        agentId,
        sessionToken,
      );
      return response;
    },
    select: (data) => data.count, // Select the 'count' part of the API response
    // Enable the query only if agentId is provided, user is authenticated, and the enabled prop is true
    enabled: !!agentId && isAuthenticated && !!sessionToken && enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection time
    refetchOnWindowFocus: false,
  });

  return query;
};
