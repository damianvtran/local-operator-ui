/**
 * Hook for updating configuration
 */

import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type {
	ConfigResponse,
	ConfigUpdate,
} from "@renderer/api/local-operator/types";
import { apiConfig } from "@renderer/config";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { configQueryKey } from "./use-config";

/**
 * Hook for updating configuration
 *
 * @returns Mutation for updating configuration
 */
export const useUpdateConfig = () => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (update: ConfigUpdate) => {
			try {
				const response = await client.config.updateConfig(update);

				if (response.status >= 400) {
					throw new Error(response.message || "Failed to update configuration");
				}

				return response.result;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while updating configuration";

				toast.error(errorMessage);
				throw error;
			}
		},
		onSuccess: async (_data) => {
			// Use a single batch update to prevent multiple UI refreshes
			await queryClient.invalidateQueries({
				queryKey: configQueryKey,
				refetchType: "none", // Don't automatically refetch
			});

			// Manually update the cache for the config
			queryClient.setQueryData<ConfigResponse | null>(
				configQueryKey,
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
				queryKey: configQueryKey,
				type: "all", // Refetch all related queries at once
			});

			toast.success("Configuration updated successfully");
		},
		onError: (error) => {
			console.error("Error updating configuration:", error);
		},
	});
};
