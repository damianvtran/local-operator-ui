/**
 * Hook for clearing an agent's conversation history
 */
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@renderer/config";
import { useChatStore } from "@shared/store/chat-store";
import { useMessageHistoryStore } from "@shared/store/message-history-store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";

/**
 * Hook that provides a mutation for clearing an agent's conversation history
 *
 * @returns Mutation object for clearing an agent's conversation
 */
export const useClearAgentConversation = () => {
	const queryClient = useQueryClient();
	const clearChatMessages = useChatStore((state) => state.clearConversation);
	const clearMessageHistory = useMessageHistoryStore(
		(state) => state.clearConversationHistory,
	);

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

			// Invalidate the conversation messages query to ensure it's refetched
			queryClient.invalidateQueries({
				queryKey: ["conversation-messages", variables.agentId],
			});

			// Clear messages from the chat store
			clearChatMessages(variables.agentId);

			// Clear message history for the conversation
			clearMessageHistory(variables.agentId);

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
