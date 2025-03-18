/**
 * Hook for fetching credentials from the Local Operator API
 *
 * This hook is gated by connectivity checks to ensure the server is online
 * and the user has internet connectivity if required by the hosting provider.
 */

import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { CredentialListResult } from "@renderer/api/local-operator/types";
import { apiConfig } from "@renderer/config";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { showErrorToast } from "@renderer/utils/toast-manager";
import { useConnectivityGate } from "./use-connectivity-gate";

/**
 * Query key for credentials
 */
export const credentialsQueryKey = ["credentials"];

/**
 * Hook for fetching credentials from the Local Operator API
 *
 * @returns Query result with credentials data, loading state, error state, and refetch function
 */
export const useCredentials = () => {
	// Use the connectivity gate to check if the query should be enabled
	// Bypass internet check for credential queries as they only need local server connectivity
	const { shouldEnableQuery, getConnectivityError } = useConnectivityGate();

	// Get the connectivity error if any
	const connectivityError = getConnectivityError();

	// Log connectivity error if present
	useEffect(() => {
		if (connectivityError) {
			console.error(
				"Credentials connectivity error:",
				connectivityError.message,
			);
		}
	}, [connectivityError]);

	return useQuery({
		// Only enable the query if server is online (bypass internet check)
		enabled: shouldEnableQuery({ bypassInternetCheck: true }),
		queryKey: credentialsQueryKey,
		queryFn: async (): Promise<CredentialListResult | null> => {
			try {
				// Use the properly typed client
				const client = createLocalOperatorClient(apiConfig.baseUrl);
				const response = await client.credentials.listCredentials();

				if (response.status >= 400) {
					throw new Error(response.message || "Failed to fetch credentials");
				}

				return response.result as CredentialListResult;
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while fetching credentials";

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
