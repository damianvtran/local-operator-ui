import { deleteAgent } from "@shared/api/radient/agents-api";
import { apiConfig } from "@shared/config";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { agentDetailsKeys } from "./use-agent-details-query";
import { publicAgentKeys } from "./use-public-agents-query"; // Corrected import name

type DelistAgentVariables = {
	agentId: string;
};

/**
 * React Query mutation hook for delisting (deleting) a public agent.
 * Handles API call, success/error notifications, and navigation.
 */
export const useDelistAgentMutation = () => {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { sessionToken } = useRadientAuth(); // Use sessionToken
	// Removed enqueueSnackbar

	const mutation = useMutation<
		unknown, // Type of data returned by mutationFn on success (deleteAgent returns APIResponse or void)
		Error, // Type of error
		DelistAgentVariables // Type of variables passed to mutate
	>({
		mutationFn: async ({ agentId }: DelistAgentVariables) => {
			if (!sessionToken) {
				// Check sessionToken
				throw new Error("Authentication required to delist an agent.");
			}
			if (!agentId) {
				throw new Error("Agent ID is required to delist.");
			}
			// Call the API function to delete the agent
			return deleteAgent(apiConfig.radientBaseUrl, agentId, sessionToken); // Use sessionToken
		},
		onSuccess: (_, variables) => {
			showSuccessToast("Agent successfully delisted."); // Use toast.success

			// Invalidate queries related to the specific agent and the list of public agents
			queryClient.invalidateQueries({
				queryKey: agentDetailsKeys.detail(variables.agentId),
			});
			queryClient.invalidateQueries({ queryKey: publicAgentKeys.list(1, 20) }); // Invalidate a specific list query or use a broader invalidation if needed

			// Navigate back to the agent hub page after successful deletion
			navigate("/agent-hub");
		},
		onError: (error) => {
			// @ts-ignore TODO: Improve error typing
			showErrorToast(`Failed to delist agent: ${error.message}`); // Use toast.error
			console.error("Delist agent error:", error);
		},
	});

	return mutation;
};
