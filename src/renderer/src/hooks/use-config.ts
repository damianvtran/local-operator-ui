/**
 * Hook for fetching configuration from the Local Operator API
 */

import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { ConfigResponse } from "@renderer/api/local-operator/types";
import { apiConfig } from "@renderer/config";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";

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
