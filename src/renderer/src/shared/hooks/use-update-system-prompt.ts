import { t } from "../../../../i18n/messages";
/**
 * Hook for updating system prompt
 */

import {
	type SystemPromptResponse,
	type SystemPromptUpdate,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { systemPromptQueryKey } from "./use-system-prompt";

/**
 * Hook for updating system prompt
 *
 * @returns Mutation for updating system prompt
 */
export const useUpdateSystemPrompt = () => {
	const queryClient = useQueryClient();
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	return useMutation({
		mutationFn: async (update: SystemPromptUpdate) => {
			try {
				const response = await client.config.updateSystemPrompt(update);

				if (response.status >= 400) {
					throw new Error(
						response.message || t("ui.common.errors.system_prompt_update"),
					);
				}

				return response.result;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: t("ui.common.errors.system_prompt_update_unknown");

				showErrorToast(errorMessage);
				throw error;
			}
		},
		onSuccess: async (_data) => {
			// Use a single batch update to prevent multiple UI refreshes
			await queryClient.invalidateQueries({
				queryKey: systemPromptQueryKey,
				refetchType: "none", // Don't automatically refetch
			});

			// Manually update the cache for the system prompt
			queryClient.setQueryData<SystemPromptResponse | null>(
				systemPromptQueryKey,
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
				queryKey: systemPromptQueryKey,
				type: "all", // Refetch all related queries at once
			});

			showSuccessToast(t("ui.common.actions.system_prompt_updated"));
		},
		onError: (error) => {
			console.error("Error updating system prompt:", error);
		},
	});
};
