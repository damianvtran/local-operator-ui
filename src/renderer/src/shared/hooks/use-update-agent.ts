/**
 * Hook for updating agent details
 */

import {
	type AgentDetails,
	type AgentUpdate,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsQueryKey } from "./use-agents";

/**
 * Hook for updating an existing agent
 *
 * @returns Mutation for updating an agent
 */
export const useUpdateAgent = () => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async ({
			agentId,
			update,
		}: { agentId: string; update: AgentUpdate }) => {
			try {
				const response = await client.agents.updateAgent(agentId, update);

				if (response.status >= 400) {
					throw new Error(
						response.message || `Failed to update agent ${agentId}`,
					);
				}

				return response.result;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: `An unknown error occurred while updating agent ${agentId}`;

				showErrorToast(errorMessage);
				throw error;
			}
		},
		onSuccess: async (_data, { agentId }) => {
			// Use a single batch update to prevent multiple UI refreshes
			await queryClient.invalidateQueries({
				queryKey: agentsQueryKey,
				refetchType: "none", // Don't automatically refetch
			});

			// Manually update the cache for the specific agent
			queryClient.setQueryData<AgentDetails | null>(
				[...agentsQueryKey, agentId],
				(oldData) => {
					if (!oldData) return oldData;
					return {
						...oldData,
						..._data,
					};
				},
			);

			// Then do a single refetch to update any stale data
			await queryClient.refetchQueries({
				queryKey: agentsQueryKey,
				type: "all", // Refetch all related queries at once
			});

			showSuccessToast("Agent updated successfully");
		},
		onError: (error) => {
			console.error("Error updating agent:", error);
		},
	});
};
