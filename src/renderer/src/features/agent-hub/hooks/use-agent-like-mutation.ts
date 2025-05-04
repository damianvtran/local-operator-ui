import { useMutation, useQueryClient } from "@tanstack/react-query";
import { likeAgent, unlikeAgent } from "@shared/api/radient/agents-api";
import { apiConfig } from "@shared/config";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { agentLikeKeys } from "./use-agent-like-query"; 
import { agentLikeCountKeys } from "./use-agent-like-count-query"; 

type UseAgentLikeMutationParams = {
  agentId: string;
  isCurrentlyLiked: boolean;
};

/**
 * React Query hook for liking or unliking an agent.
 * Handles invalidating relevant queries on success.
 *
 * @returns Mutation object for liking/unliking an agent.
 */
export const useAgentLikeMutation = () => {
  const queryClient = useQueryClient();
  const { sessionToken, isAuthenticated } = useRadientAuth();

  const mutation = useMutation<
    unknown, // Type of data returned by mutationFn
    Error, // Type of error
    UseAgentLikeMutationParams // Type of variables passed to mutationFn
  >({
    mutationFn: async ({ agentId, isCurrentlyLiked }) => {
      if (!isAuthenticated || !sessionToken) {
        throw new Error("Authentication required to like/unlike an agent.");
      }
      if (!agentId) {
        throw new Error("Agent ID is required.");
      }

      if (isCurrentlyLiked) {
        // If currently liked, perform unlike action
        return unlikeAgent(apiConfig.radientBaseUrl, agentId, sessionToken);
      }
      // If not currently liked, perform like action
      return likeAgent(apiConfig.radientBaseUrl, agentId, sessionToken);
    },
    onSuccess: (_, variables) => {
      // Invalidate the specific agent's like status query
      queryClient.invalidateQueries({
        queryKey: agentLikeKeys.detail(variables.agentId),
      });
      // Invalidate the agent's like count query
      queryClient.invalidateQueries({
        queryKey: agentLikeCountKeys.count(variables.agentId), // Use 'count' key
      });
      // Optionally, could invalidate the list of liked agents if such a query exists
    },
    onError: (error) => {
      // Handle or log error, e.g., show a notification
      console.error("Failed to toggle like status:", error);
      // Consider adding user feedback here (e.g., toast notification)
    },
  });

  return mutation;
};
