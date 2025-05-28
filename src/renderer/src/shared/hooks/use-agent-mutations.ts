/**
 * Hooks for agent mutations (create, delete, import, export)
 */

import { createLocalOperatorClient } from "@shared/api/local-operator";
import type { AgentCreate } from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { agentsQueryKey } from "./use-agents";

/**
 * Hook for creating a new agent
 *
 * @returns Mutation for creating a new agent
 */
export const useCreateAgent = () => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (newAgent: AgentCreate) => {
			try {
				const response = await client.agents.createAgent(newAgent);

				if (response.status >= 400) {
					throw new Error(response.message || "Failed to create agent");
				}

				return response.result;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while creating the agent";

				showErrorToast(errorMessage);
				throw error;
			}
		},
		onSuccess: () => {
			// Invalidate agents query to refetch the list
			queryClient.invalidateQueries({ queryKey: agentsQueryKey });
			showSuccessToast("Agent created successfully");
		},
		onError: (error) => {
			console.error("Error creating agent:", error);
		},
	});
};

/**
 * Hook for uploading an agent to Radient marketplace via Local Operator
 *
 * @returns Mutation for uploading an agent
 */
export const useUploadAgentToRadientMutation = () => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (agentId: string) => {
			try {
				const response = await client.agents.uploadAgentToRadient(agentId);

				if (response.status >= 400) {
					throw new Error(
						response.message || `Failed to upload agent ${agentId} to Radient`,
					);
				}

				return response.result; // Contains { agent_id: string }
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: `An unknown error occurred while uploading agent ${agentId}`;

				showErrorToast(errorMessage);
				throw error;
			}
		},
		onSuccess: (data) => {
			showSuccessToast(
				`Agent successfully uploaded to Radient with ID: ${data?.agent_id}`,
			);
			// Invalidate the local agents list query to trigger a refetch
			queryClient.invalidateQueries({ queryKey: agentsQueryKey });
		},
		onError: (error, agentId) => {
			console.error(`Error uploading agent ${agentId} to Radient:`, error);
		},
	});
};

/**
 * Hook for deleting an agent
 *
 * @returns Mutation for deleting an agent
 */
export const useDeleteAgent = () => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (agentId: string) => {
			try {
				const response = await client.agents.deleteAgent(agentId);

				if (response.status >= 400) {
					throw new Error(
						response.message || `Failed to delete agent ${agentId}`,
					);
				}

				return response;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: `An unknown error occurred while deleting agent ${agentId}`;

				showErrorToast(errorMessage);
				throw error;
			}
		},
		onSuccess: (_data, agentId) => {
			// Remove cached agent details to clear state before refetch
			queryClient.removeQueries({
				queryKey: [...agentsQueryKey, agentId] as QueryKey,
				exact: true,
			});
			// Invalidate agents query to refetch the list
			queryClient.invalidateQueries({ queryKey: agentsQueryKey });
			showSuccessToast("Agent deleted successfully");
		},
		onError: (error) => {
			console.error("Error deleting agent:", error);
		},
	});
};

/**
 * Hook for importing an agent from a ZIP file
 *
 * @returns Mutation for importing an agent
 */
export const useImportAgent = () => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (file: File) => {
			try {
				const response = await client.agents.importAgent(file);

				if (response.status >= 400) {
					throw new Error(response.message || "Failed to import agent");
				}

				return response.result;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while importing the agent";

				showErrorToast(errorMessage);
				throw error;
			}
		},
		onSuccess: (data) => {
			// Invalidate agents query to refetch the list
			queryClient.invalidateQueries({ queryKey: agentsQueryKey });
			showSuccessToast("Agent imported successfully");
			return data;
		},
		onError: (error) => {
			console.error("Error importing agent:", error);
		},
	});
};

/**
 * Hook for exporting an agent as a ZIP file
 *
 * @returns Mutation for exporting an agent
 */
export const useExportAgent = () => {
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (agentId: string) => {
			try {
				return await client.agents.exportAgent(agentId);
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: `An unknown error occurred while exporting agent ${agentId}`;

				showErrorToast(errorMessage);
				throw error;
			}
		},
		onSuccess: () => {
			showSuccessToast("Agent exported successfully");
		},
		onError: (error) => {
			console.error("Error exporting agent:", error);
		},
	});
};
