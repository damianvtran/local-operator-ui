/**
 * Hook for updating credentials
 */

import {
	type CredentialListResult,
	type CredentialUpdate,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { credentialsQueryKey } from "./use-credentials";

/**
 * Hook for updating a credential
 *
 * `announce` is the caller's switch for the shared toasts: with it off, a
 * success or failure raises no toast, and the caller owes the user its own
 * receipt for the write (the onboarding search step renders a per-row Saved
 * badge and an inline refusal register instead of one env-var-named toast per
 * field, review round 1 U2/U4). It defaults to ON - the behaviour every future
 * caller inherits is the announced one.
 *
 * @returns Mutation for updating a credential
 */
export const useUpdateCredential = (options?: { announce?: boolean }) => {
	const announce = options?.announce ?? true;
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

				if (announce) showErrorToast(errorMessage);
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

			if (announce)
				showSuccessToast(`Credential "${variables.key}" updated successfully`);
		},
		onError: (error) => {
			console.error("Error updating credential:", error);
		},
	});
};
