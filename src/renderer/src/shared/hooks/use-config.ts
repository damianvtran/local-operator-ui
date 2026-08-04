/**
 * Hook for fetching configuration from the Local Operator API
 *
 * This hook is special and does not use the connectivity gate
 * since it's used by the connectivity gate itself to determine the hosting provider.
 */

import {
	type ConfigResponse,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
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
			// No toast on failure, for the same reason as `use-credentials`: this
			// is the probe the connectivity gate itself runs, so it fires on mount
			// from every surface at once and its failure is a standing condition,
			// not an event. Raising a toast per caller quoting the raw exception
			// ("Failed to fetch") put a browser string on top of the conversation
			// while the persistent connectivity banner was already saying the true
			// thing once. The error still propagates to callers.
			const client = createLocalOperatorClient(apiConfig.baseUrl);
			const response = await client.config.getConfig();

			if (response.status >= 400) {
				throw new Error(response.message || "Failed to fetch configuration");
			}

			return response.result as ConfigResponse;
		},
		// Prevent automatic refetches on window focus
		refetchOnWindowFocus: false,
		// Prevent stale time to avoid unnecessary refetches
		staleTime: 5000,
	});
};
