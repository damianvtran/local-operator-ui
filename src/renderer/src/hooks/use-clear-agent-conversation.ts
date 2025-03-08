/**
 * Hook for clearing an agent's conversation history
 */
import { createLocalOperatorClient } from "@renderer/api/local-operator";
import { apiConfig } from "@renderer/config";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";

/**
 * Hook that provides a mutation for clearing an agent's conversation history
 *
 * @returns Mutation object for clearing an agent's conversation
 */
export const useClearAgentConversation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ agentId }: { agentId: string }) => {
			const client = createLocalOperatorClient(apiConfig.baseUrl);
			return client.agents.clearAgentConversation(agentId);
		},
		onSuccess: (_, variables) => {
			// Invalidate the agent conversation query to refresh the data
			queryClient.invalidateQueries({
				queryKey: ["agent", variables.agentId, "conversation"],
			});

			// Show success toast
			toast.success("Conversation cleared successfully");
		},
		onError: (error) => {
			console.error("Error clearing agent conversation:", error);
			toast.error(
				`Failed to clear conversation: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		},
	});
};
