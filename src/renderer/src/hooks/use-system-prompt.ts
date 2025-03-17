/**
 * Hook for fetching system prompt from the Local Operator API
 *
 * This hook is gated by connectivity checks to ensure the server is online
 * and the user has internet connectivity if required by the hosting provider.
 */

import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { SystemPromptResponse } from "@renderer/api/local-operator/types";
import { apiConfig } from "@renderer/config";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";
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
	const { shouldEnableQuery } = useConnectivityGate();

	return useQuery({
		// Only enable the query if connectivity checks pass
		enabled: shouldEnableQuery(),
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

				toast.error(errorMessage);
				throw error;
			}
		},
		// Prevent automatic refetches on window focus
		refetchOnWindowFocus: false,
		// Prevent stale time to avoid unnecessary refetches
		staleTime: 5000,
	});
};
