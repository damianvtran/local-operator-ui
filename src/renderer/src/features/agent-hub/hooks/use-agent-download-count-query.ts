import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { getAgentDownloadCount } from "@shared/api/radient/agents-api";
import { apiConfig } from "@shared/config";
import type { CountResponse } from "@shared/api/radient/types";

// Query keys for agent download count
export const agentDownloadCountKeys = {
  all: ["agent-download-count"] as const,
  count: (agentId: string) => [...agentDownloadCountKeys.all, agentId] as const,
};

type UseAgentDownloadCountQueryParams = {
  agentId: string;
  enabled?: boolean; // Allow disabling the query
};

/**
 * React Query hook for fetching the download count for a specific agent.
 * This endpoint is public and does not require authentication.
 *
 * @param agentId - The ID of the agent whose download count to fetch.
 * @param enabled - Whether the query should be enabled (default: true).
 * @returns Query result object for the agent download count.
 */
export const useAgentDownloadCountQuery = ({
  agentId,
  enabled = true,
}: UseAgentDownloadCountQueryParams): UseQueryResult<number, Error> => {
  const query = useQuery<
    CountResponse, // Raw API response type
    Error, // Type of error
    number // Type of data returned by select
  >({
    queryKey: agentDownloadCountKeys.count(agentId || "invalid"),
    queryFn: async () => {
      if (!agentId) {
        throw new Error("Agent ID is required to fetch download count.");
      }
      // No longer requires authentication
      const response = await getAgentDownloadCount(
        apiConfig.radientBaseUrl,
        agentId,
      );
      // The queryFn should return the raw API response
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
