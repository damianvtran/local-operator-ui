import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { getAgentLikeCount } from "@shared/api/radient/agents-api";
import { apiConfig } from "@shared/config";
import type { CountResponse } from "@shared/api/radient/types";

// Query keys for agent like count
export const agentLikeCountKeys = {
  all: ["agent-like-count"] as const,
  count: (agentId: string) => [...agentLikeCountKeys.all, agentId] as const,
};

type UseAgentLikeCountQueryParams = {
  agentId: string;
  enabled?: boolean; // Allow disabling the query
};

/**
 * React Query hook for fetching the like count for a specific agent.
 * This endpoint is public and does not require authentication.
 *
 * @param agentId - The ID of the agent whose like count to fetch.
 * @param enabled - Whether the query should be enabled (default: true).
 * @returns Query result object for the agent like count.
 */
export const useAgentLikeCountQuery = ({
  agentId,
  enabled = true,
}: UseAgentLikeCountQueryParams): UseQueryResult<number, Error> => {
  const query = useQuery<
    CountResponse, // Type of data returned by queryFn
    Error, // Type of error
    number // Type of data returned by select
  >({
    queryKey: agentLikeCountKeys.count(agentId || "invalid"),
    queryFn: async () => {
      if (!agentId) {
        throw new Error("Agent ID is required to fetch like count.");
      }
      // No longer requires authentication
      const response = await getAgentLikeCount(apiConfig.radientBaseUrl, agentId);
      return response.result;
    },
    // Select the actual count from the response result
    select: (data) => data.count,
    // Enable the query only if agentId is provided and the enabled prop is true
    enabled: !!agentId && enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection time
    refetchOnWindowFocus: false,
  });

  return query;
};
