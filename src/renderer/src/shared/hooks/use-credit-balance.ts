import { type RadientClient, createRadientClient } from "@shared/api/radient";
import type { CreditBalanceResult } from "@shared/api/radient/types";
import { apiConfig } from "@shared/config";
/**
 * React Query hook for fetching Radient credit balance.
 */
import { useQuery } from "@tanstack/react-query";
import { useRadientUserQuery } from "./use-radient-user-query";

const QUERY_KEY = ["radient", "creditBalance"];

/**
 * Fetches the credit balance using the Radient API client.
 *
 * @param radientClient - The initialized Radient API client.
 * @param tenantId - The tenant ID (user account ID).
 * @param accessToken - The user's access token.
 * @returns A promise resolving to the credit balance result.
 */
const fetchCreditBalance = async (
	radientClient: RadientClient,
	tenantId: string,
	accessToken: string,
): Promise<CreditBalanceResult> => {
	// Note: The billing API function expects baseUrl as the first argument
	// The RadientClient class handles binding the baseUrl automatically via the getter
	const response = await radientClient.billing.getCreditBalance(
		tenantId,
		accessToken,
	);
	// Assuming the API response structure includes the result directly
	// Adjust if the actual structure is different (e.g., response.result.balance)
	if (!response || typeof response.result?.balance !== "number") {
		throw new Error("Invalid credit balance response format");
	}
	return response.result;
};

/**
 * Hook to fetch the Radient credit balance for the current user.
 *
 * Automatically handles fetching the client, tenant ID, and access token.
 * Returns the query result for the credit balance.
 *
 * @param options - Optional React Query options.
 */
export const useCreditBalance = (options?: { enabled?: boolean }) => {
	// Instantiate the client directly
	const radientClient = createRadientClient(
		apiConfig.radientBaseUrl,
		apiConfig.radientClientId,
	);

	// Get user and session data from useRadientUserQuery
	const { user, session, isAuthenticated } = useRadientUserQuery();
	// Use tenant_id from the account info
	const tenantId = user?.account?.tenant_id;
	const accessToken = session?.accessToken;

	// The query is enabled only if authenticated and we have the necessary data
	const isEnabled =
		isAuthenticated &&
		!!radientClient &&
		!!tenantId &&
		!!accessToken &&
		(options?.enabled ?? true);

	return useQuery<CreditBalanceResult, Error>({
		queryKey: [QUERY_KEY, tenantId], // Include tenantId in query key
		queryFn: () => {
			// Guard clause ensures parameters are non-null when query is enabled
			if (!radientClient || !tenantId || !accessToken) {
				return Promise.reject(
					new Error("Radient client, tenant ID, or access token not available"),
				);
			}
			return fetchCreditBalance(radientClient, tenantId, accessToken);
		},
		enabled: isEnabled,
		staleTime: 5 * 60 * 1000, // Cache for 5 minutes
		refetchOnWindowFocus: true, // Refetch on window focus
	});
};
