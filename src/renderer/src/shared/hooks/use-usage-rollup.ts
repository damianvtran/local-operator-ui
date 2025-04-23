import { type RadientClient, createRadientClient } from "@shared/api/radient";
import type {
	UsageRollupRequestParams,
	UsageRollupResponse,
} from "@shared/api/radient/types";
import { apiConfig } from "@shared/config";
/**
 * React Query hook for fetching Radient usage rollup data.
 */
import { useQuery } from "@tanstack/react-query";
import { useRadientUserQuery } from "./use-radient-user-query";

const QUERY_KEY_BASE = ["radient", "usageRollup"];

/**
 * Fetches usage rollup data using the Radient API client.
 *
 * @param radientClient - The initialized Radient API client.
 * @param tenantId - The tenant ID (user account ID).
 * @param accessToken - The user's access token.
 * @param params - Query parameters for the usage rollup request.
 * @returns A promise resolving to the usage rollup response.
 */
const fetchUsageRollup = async (
	radientClient: RadientClient,
	tenantId: string,
	accessToken: string,
	params: UsageRollupRequestParams,
): Promise<UsageRollupResponse> => {
	// The RadientClient class handles binding the baseUrl automatically
	const response = await radientClient.usage.getUsageRollup(
		tenantId,
		accessToken,
		params,
	);
	// Assuming the API response structure includes the result directly
	if (!response || !response.result) {
		throw new Error("Invalid usage rollup response format");
	}
	return response.result;
};

/**
 * Hook to fetch Radient usage rollup data for the current user.
 *
 * Automatically handles fetching the client, tenant ID, and access token.
 * Returns the query result for the usage data based on the provided parameters.
 *
 * @param params - Parameters for the usage rollup request (e.g., rollup period).
 * @param options - Optional React Query options.
 */
export const useUsageRollup = (
	params: UsageRollupRequestParams,
	options?: { enabled?: boolean },
) => {
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

	// Include params in the query key for unique caching based on request parameters
	const queryKey = [...QUERY_KEY_BASE, tenantId, params];

	return useQuery<UsageRollupResponse, Error>({
		queryKey: queryKey,
		queryFn: () => {
			// Guard clause ensures parameters are non-null when query is enabled
			if (!radientClient || !tenantId || !accessToken) {
				return Promise.reject(
					new Error("Radient client, tenant ID, or access token not available"),
				);
			}
			return fetchUsageRollup(radientClient, tenantId, accessToken, params);
		},
		enabled: isEnabled,
		staleTime: 5 * 60 * 1000, // Cache for 5 minutes
		refetchOnWindowFocus: true, // Refetch on window focus
	});
};
