import { createLocalOperatorClient } from "@shared/api/local-operator";
import type {
	CRUDResponse,
	ExecutionVariable,
	ExecutionVariablesResponse,
} from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

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

/**
 * Custom hook to create an agent execution variable.
 * @returns The react-query mutation result for creating an agent execution variable.
 */
export const useCreateAgentExecutionVariable = () => {
	const queryClient = useQueryClient();
	const client = useMemo(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);

	return useMutation<
		CRUDResponse<ExecutionVariable>,
		Error,
		{ agentId: string; variableData: ExecutionVariable }
	>({
		mutationFn: async ({ agentId, variableData }) =>
			client.agents.createAgentExecutionVariable(agentId, variableData),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: ["agentExecutionVariables", variables.agentId],
			});
			showSuccessToast("Variable created successfully.");
		},
		onError: (error) => {
			showErrorToast(`Failed to create variable: ${error.message}`);
		},
	});
};

/**
 * Custom hook to update an agent execution variable.
 * @returns The react-query mutation result for updating an agent execution variable.
 */
export const useUpdateAgentExecutionVariable = () => {
	const queryClient = useQueryClient();
	const client = useMemo(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);

	return useMutation<
		CRUDResponse<ExecutionVariable>,
		Error,
		{
			agentId: string;
			variableKey: string;
			variableData: ExecutionVariable;
		}
	>({
		mutationFn: async ({ agentId, variableKey, variableData }) =>
			client.agents.updateAgentExecutionVariable(
				agentId,
				variableKey,
				variableData,
			),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: ["agentExecutionVariables", variables.agentId],
			});
			showSuccessToast("Variable updated successfully.");
		},
		onError: (error) => {
			showErrorToast(`Failed to update variable: ${error.message}`);
		},
	});
};

/**
 * Custom hook to delete an agent execution variable.
 * @returns The react-query mutation result for deleting an agent execution variable.
 */
export const useDeleteAgentExecutionVariable = () => {
	const queryClient = useQueryClient();
	const client = useMemo(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);

	return useMutation<
		CRUDResponse,
		Error,
		{ agentId: string; variableKey: string }
	>({
		mutationFn: async ({ agentId, variableKey }) =>
			client.agents.deleteAgentExecutionVariable(agentId, variableKey),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: ["agentExecutionVariables", variables.agentId],
			});
			showSuccessToast("Variable deleted successfully.");
		},
		onError: (error) => {
			showErrorToast(`Failed to delete variable: ${error.message}`);
		},
	});
};
