import { deleteAgent } from "@shared/api/radient/agents-api";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { agentDetailsKeys } from "./use-agent-details-query";
import { invalidatePublicAgentLists } from "./use-public-agents-query";

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
	const { isAuthenticated } = useRadientAuth();
	// Removed enqueueSnackbar

	const mutation = useMutation<
		unknown, // Type of data returned by mutationFn on success (deleteAgent returns APIResponse or void)
		Error, // Type of error
		DelistAgentVariables // Type of variables passed to mutate
	>({
		mutationFn: async ({ agentId }: DelistAgentVariables) => {
			if (!isAuthenticated) {
				// Check the account is signed in
				throw new Error("Authentication required to delist an agent.");
			}
			if (!agentId) {
				throw new Error("Agent ID is required to delist.");
			}
			// Call the API function to delete the agent
			return deleteAgent(agentId);
		},
		onSuccess: (_, variables) => {
			showSuccessToast("Agent delisted"); // Use toast.success

			// Invalidate queries related to the specific agent and the list of public agents
			queryClient.invalidateQueries({
				queryKey: agentDetailsKeys.detail(variables.agentId),
			});
			/*
			 * The whole list prefix, not one page's key. This call used to name
			 * `publicAgentKeys.list(1, 20)` while the list query keyed itself from its
			 * own inline array carrying page, perPage, categories, sort and order —
			 * so the invalidation matched no registered query, and a delisted agent
			 * stayed on the grid until its five-minute `staleTime` ran out. The
			 * visible page is the one that has to change and the pages after it shift
			 * by one record, so the prefix is the correct scope, and one shape is the
			 * fix: `publicAgentKeys.list` is now what the query itself uses.
			 */
			invalidatePublicAgentLists(queryClient);

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
