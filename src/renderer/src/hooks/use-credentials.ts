/**
 * Hook for fetching credentials from the Local Operator API
 */

import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { CredentialListResult } from "@renderer/api/local-operator/types";
import { apiConfig } from "@renderer/config";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";

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
	return useQuery({
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
