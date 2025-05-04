import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { AgentsApi } from "@shared/api/local-operator/agents-api";
import type { AgentDetails, CRUDResponse } from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config"; // Import apiConfig for the base URL

/**
 * React Query mutation hook for downloading an agent from Radient via the Local Operator.
 *
 * @returns Mutation result object for downloading an agent.
 */
export const useDownloadAgentMutation = () => {
	const queryClient = useQueryClient();

	const mutation = useMutation<
		CRUDResponse<AgentDetails>, // Type of data returned by mutationFn
		Error, // Type of error
		{ agentId: string; agentName?: string } // Type of variables passed to mutate
	>({
		mutationFn: async ({ agentId }) => {
			if (!apiConfig.baseUrl) {
				throw new Error("Local Operator API URL is not configured.");
			}
			// Call the API method from local-operator/agents-api using the static config
			return AgentsApi.downloadAgentFromRadient(apiConfig.baseUrl, agentId);
		},
		onSuccess: (data, variables) => {
			const agentName = data.result?.name ?? variables.agentName ?? "Agent";
			toast.success(`Agent "${agentName}" downloaded successfully!`);
			// Invalidate local agents list to reflect the newly downloaded agent
			queryClient.invalidateQueries({ queryKey: ["agents"] });
			// Optionally invalidate agent download counts if needed elsewhere
			queryClient.invalidateQueries({ queryKey: ["agent-download-count", variables.agentId] });
		},
		onError: (error) => {
			toast.error(`Failed to download agent: ${error.message}`);
			console.error("Download agent error:", error);
		},
	});

	return mutation;
};
