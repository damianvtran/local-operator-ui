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
 * `successToasts` is the caller's switch for the shared SUCCESS toast - and
 * only for it. The onboarding search step turns it off because the row's own
 * `Saved` badge is the receipt and one env-var-named toast per field is noise
 * there (review round 1, U4). FAILURES ARE NOT SWITCHABLE: the shared error
 * toast is deduped by the manager and is the only report that survives the
 * step unmounting, which is exactly the hole leaving Finish with a failed
 * save in flight used to fall through (UX round 2, U5 - the row's inline
 * register unmounts with the step, and with every toast silenced the failure
 * ended up reported nowhere). It defaults to ON, the behaviour every future
 * caller inherits.
 *
 * @returns Mutation for updating a credential
 */
export const useUpdateCredential = (options?: { successToasts?: boolean }) => {
	const successToasts = options?.successToasts ?? true;
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

				// Not gated by `successToasts`: the deduped toast is the failure's
				// backstop once the row's own register unmounts with the step (U5).
				showErrorToast(errorMessage);
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

			if (successToasts)
				showSuccessToast(`Credential "${variables.key}" updated successfully`);
		},
		onError: (error) => {
			console.error("Error updating credential:", error);
		},
	});
};
