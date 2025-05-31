import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import type { CRUDResponse, ExecutionVariablesResponse } from "@shared/api/local-operator/types";

/**
 * Custom hook to fetch agent execution variables.
 * @param agentId - The ID of the agent.
 * @returns The react-query query result for agent execution variables.
 */
export const useAgentExecutionVariables = (agentId: string | undefined) => {
	const client = useMemo(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);

	return useQuery<CRUDResponse<ExecutionVariablesResponse>, Error>({
		queryKey: ["agentExecutionVariables", agentId],
		queryFn: async () => {
			if (!agentId) {
				// This should ideally not be reached if `enabled` is false,
				// but as a safeguard:
				throw new Error("Agent ID is required to fetch execution variables.");
			}
			return client.agents.listAgentExecutionVariables(agentId);
		},
		enabled: !!agentId, // Only run the query if agentId is provided
	});
};
