/**
 * Hook for updating credentials
 */

import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type {
	CredentialListResult,
	CredentialUpdate,
} from "@renderer/api/local-operator/types";
import { apiConfig } from "@renderer/config";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { credentialsQueryKey } from "./use-credentials";

/**
 * Hook for updating a credential
 *
 * @returns Mutation for updating a credential
 */
export const useUpdateCredential = () => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (credentialUpdate: CredentialUpdate) => {
			try {
				const response =
					await client.credentials.updateCredential(credentialUpdate);

				if (response.status >= 400) {
					throw new Error(response.message || "Failed to update credential");
				}

				return response;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while updating credential";

				toast.error(errorMessage);
				throw error;
			}
		},
		onSuccess: async (_data, variables) => {
			// Use a single batch update to prevent multiple UI refreshes
			await queryClient.invalidateQueries({
				queryKey: credentialsQueryKey,
				refetchType: "none", // Don't automatically refetch
			});

			// Manually update the cache for the credentials list
			queryClient.setQueryData<CredentialListResult | null>(
				credentialsQueryKey,
				(oldData) => {
					if (!oldData) return oldData;

					// If the key doesn't exist in the list, add it
					if (!oldData.keys.includes(variables.key)) {
						return {
							...oldData,
							keys: [...oldData.keys, variables.key],
						};
					}

					return oldData;
				},
			);

			// Then do a single refetch to update any stale data
			await queryClient.refetchQueries({
				queryKey: credentialsQueryKey,
				type: "all", // Refetch all related queries at once
			});

			toast.success(`Credential "${variables.key}" updated successfully`);
		},
		onError: (error) => {
			console.error("Error updating credential:", error);
		},
	});
};
