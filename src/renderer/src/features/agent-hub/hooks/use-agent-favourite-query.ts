import { useQuery } from "@tanstack/react-query";
import { getAgentFavourite } from "@shared/api/radient/agents-api";
import { apiConfig } from "@shared/config";
import type { AgentFavourite } from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";

// Query keys for agent favourite status
export const agentFavouriteKeys = {
  all: ["agent-favourite"] as const,
  detail: (agentId: string) => [...agentFavouriteKeys.all, agentId] as const,
};

type UseAgentFavouriteQueryParams = {
  agentId: string;
  enabled?: boolean; // Allow disabling the query
};

/**
 * React Query hook for fetching the favourite status of a specific agent for the current user.
 *
 * @param agentId - The ID of the agent.
 * @param enabled - Whether the query should be enabled (default: true).
 * @returns Query result object containing the favourite details or an empty object if not favourited.
 */
export const useAgentFavouriteQuery = ({
  agentId,
  enabled = true,
}: UseAgentFavouriteQueryParams) => {
  const { sessionToken, isAuthenticated } = useRadientAuth(); // Get auth token and status

  const query = useQuery<
    AgentFavourite | Record<string, never>, // Type of data returned by queryFn
    Error // Type of error
  >({
    queryKey: agentFavouriteKeys.detail(agentId || "invalid"),
    queryFn: async () => {
      if (!agentId) {
        throw new Error("Agent ID is required to fetch favourite status.");
      }
      if (!sessionToken) {
        // This case should ideally be prevented by the 'enabled' check, but good for safety
        throw new Error("Authentication required to fetch favourite status.");
      }
      // Fetch favourite status using the API client function
      const response = await getAgentFavourite(
        apiConfig.radientBaseUrl,
        agentId,
        sessionToken,
      );
      // API returns empty object {} if not favourited, or AgentFavourite object if favourited
      return response.result;
    },
    // Enable the query only if agentId is provided, enabled prop is true, and user is authenticated
    enabled: !!agentId && enabled && isAuthenticated, // Use isAuthenticated status
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection time
    refetchOnWindowFocus: true, // Refetch on focus to get latest status
  });

  // Determine boolean favourited status from the data
  const isFavourited = !!query.data && Object.keys(query.data).length > 0;

  return { ...query, isFavourited }; // Return the raw query object plus the boolean status
};
