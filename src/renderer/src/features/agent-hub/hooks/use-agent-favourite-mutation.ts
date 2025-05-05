import {
	favouriteAgent,
	unfavouriteAgent,
} from "@shared/api/radient/agents-api";
import { apiConfig } from "@shared/config";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentFavouriteCountKeys } from "./use-agent-favourite-count-query";
import { agentFavouriteKeys } from "./use-agent-favourite-query";

type UseAgentFavouriteMutationParams = {
	agentId: string;
	isCurrentlyFavourited: boolean;
};

/**
 * React Query hook for favouriting or unfavouriting an agent.
 * Handles invalidating relevant queries on success.
 *
 * @returns Mutation object for favouriting/unfavouriting an agent.
 */
export const useAgentFavouriteMutation = () => {
	const queryClient = useQueryClient();
	const { sessionToken, isAuthenticated } = useRadientAuth();

	const mutation = useMutation<
		unknown, // Type of data returned by mutationFn
		Error, // Type of error
		UseAgentFavouriteMutationParams // Type of variables passed to mutationFn
	>({
		mutationFn: async ({ agentId, isCurrentlyFavourited }) => {
			if (!isAuthenticated || !sessionToken) {
				throw new Error(
					"Authentication required to favourite/unfavourite an agent.",
				);
			}
			if (!agentId) {
				throw new Error("Agent ID is required.");
			}

			if (isCurrentlyFavourited) {
				// If currently favourited, perform unfavourite action
				return unfavouriteAgent(
					apiConfig.radientBaseUrl,
					agentId,
					sessionToken,
				);
			}
			// If not currently favourited, perform favourite action
			return favouriteAgent(apiConfig.radientBaseUrl, agentId, sessionToken);
		},
		onSuccess: (_, variables) => {
			// Invalidate the specific agent's favourite status query
			queryClient.invalidateQueries({
				queryKey: agentFavouriteKeys.detail(variables.agentId),
			});
			// Invalidate the agent's favourite count query
			queryClient.invalidateQueries({
				queryKey: agentFavouriteCountKeys.count(variables.agentId), // Use 'count' key
			});
			// Optionally, could invalidate the list of favourited agents if such a query exists
		},
		onError: (error) => {
			// Handle or log error
			console.error("Failed to toggle favourite status:", error);
			// Consider adding user feedback here
		},
	});

	return mutation;
};
