/**
 * Hook for fetching system prompt from the Local Operator API
 *
 * This hook is gated by connectivity checks to ensure the server is online
 * and the user has internet connectivity if required by the hosting provider.
 */

import {
	type SystemPromptResponse,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQuery } from "@tanstack/react-query";
import { useConnectivityGate } from "./use-connectivity-gate";

/**
 * Query key for system prompt
 */
export const systemPromptQueryKey = ["system-prompt"];

/**
 * Hook for fetching system prompt from the Local Operator API
 *
 * @returns Query result with system prompt data, loading state, error state, and refetch function
 */
export const useSystemPrompt = () => {
	// Use the connectivity gate to check if the query should be enabled
	// Bypass internet check for system prompt queries as they only need local server connectivity
	const { shouldEnableQuery } = useConnectivityGate();

	return useQuery({
		// Only enable the query if server is online (bypass internet check)
		enabled: shouldEnableQuery({ bypassInternetCheck: true }),
		queryKey: systemPromptQueryKey,
		queryFn: async (): Promise<SystemPromptResponse | null> => {
			try {
				// Use the properly typed client
				const client = createLocalOperatorClient(apiConfig.baseUrl);
				const response = await client.config.getSystemPrompt();

				// Handle case where there is no system prompt (204 response)
				if (response === null) {
					return null;
				}

				if (response.status >= 400) {
					throw new Error(response.message || "Failed to fetch system prompt");
				}

				return response.result as SystemPromptResponse;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while fetching system prompt";

				showErrorToast(errorMessage);
				throw error;
			}
		},
		// Prevent automatic refetches on window focus
		refetchOnWindowFocus: false,
		// Prevent stale time to avoid unnecessary refetches
		staleTime: 5000,
	});
};
