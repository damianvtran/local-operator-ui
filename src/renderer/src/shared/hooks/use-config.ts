/**
 * Hook for fetching configuration from the Local Operator API
 *
 * This hook is special and does not use the connectivity gate
 * since it's used by the connectivity gate itself to determine the hosting provider.
 */

import { createLocalOperatorClient, type ConfigResponse } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQuery } from "@tanstack/react-query";

/**
 * Query key for configuration
 */
export const configQueryKey = ["config"];

/**
 * Hook for fetching configuration from the Local Operator API
 *
 * @returns Query result with configuration data, loading state, error state, and refetch function
 */
export const useConfig = () => {
	return useQuery({
		// Always enable this query since it's needed for connectivity checks
		enabled: true,
		queryKey: configQueryKey,
		queryFn: async (): Promise<ConfigResponse | null> => {
			try {
				// Use the properly typed client
				const client = createLocalOperatorClient(apiConfig.baseUrl);
				const response = await client.config.getConfig();

				if (response.status >= 400) {
					throw new Error(response.message || "Failed to fetch configuration");
				}

				return response.result as ConfigResponse;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while fetching configuration";

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
