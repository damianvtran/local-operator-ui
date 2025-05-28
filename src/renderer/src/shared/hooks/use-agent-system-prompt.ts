/**
 * Hook for fetching and updating agent system prompt
 */

import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnectivityGate } from "./use-connectivity-gate";

/**
 * Query key factory for agent system prompt
 *
 * @param agentId - The agent ID
 * @returns Query key for the agent system prompt
 */
export const agentSystemPromptQueryKey = (agentId: string) => [
	"agent-system-prompt",
	agentId,
];

/**
 * Hook for fetching agent system prompt from the Local Operator API
 *
 * @param agentId - The agent ID to fetch system prompt for
 * @returns Query result with agent system prompt data, loading state, error state, and refetch function
 */
export const useAgentSystemPrompt = (agentId: string) => {
	// Use the connectivity gate to check if the query should be enabled
	const { shouldEnableQuery } = useConnectivityGate();

	return useQuery({
		// Only enable the query if server is online and agent ID is provided
		enabled: shouldEnableQuery({ bypassInternetCheck: true }) && !!agentId,
		queryKey: agentSystemPromptQueryKey(agentId),
		queryFn: async () => {
			try {
				// Use the properly typed client
				const client = createLocalOperatorClient(apiConfig.baseUrl);
				const response = await client.agents.getAgentSystemPrompt(agentId);

				if (response.status >= 400) {
					throw new Error(
						response.message || "Failed to fetch agent system prompt",
					);
				}

				return response.result?.system_prompt || "";
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while fetching agent system prompt";

				showErrorToast(errorMessage);
				throw error;
			}
		},
		// Prevent automatic refetches on window focus
		refetchOnWindowFocus: false,
		// Prevent stale time to avoid unnecessary refetches
		staleTime: 5000,
	});
};

/**
 * Hook for updating agent system prompt
 *
 * @param agentId - The agent ID to update system prompt for
 * @returns Mutation for updating agent system prompt
 */
export const useUpdateAgentSystemPrompt = (agentId: string) => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (systemPrompt: string) => {
			try {
				const response = await client.agents.updateAgentSystemPrompt(
					agentId,
					systemPrompt,
				);

				if (response.status >= 400) {
					throw new Error(
						response.message || "Failed to update agent system prompt",
					);
				}

				return response;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while updating agent system prompt";

				showErrorToast(errorMessage);
				throw error;
			}
		},
		onSuccess: async () => {
			// Invalidate the query to trigger a refetch
			await queryClient.invalidateQueries({
				queryKey: agentSystemPromptQueryKey(agentId),
			});

			showSuccessToast("Agent system prompt updated successfully");
		},
		onError: (error) => {
			console.error("Error updating agent system prompt:", error);
		},
	});
};
