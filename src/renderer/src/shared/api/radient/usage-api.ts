/**
 * Radient Usage API
 *
 * Functions for interacting with the Radient usage endpoints.
 */
import type {
	RadientApiResponse,
	UsageRollupRequestParams,
	UsageRollupResponse,
} from "./types";

/**
 * Fetches rolled-up usage data for a given tenant based on specified parameters.
 *
 * @param baseUrl - The base URL of the Radient API.
 * @param tenantId - The ID of the tenant whose usage to fetch.
 * @param accessToken - The user's access token for authorization.
 * @param params - Query parameters for filtering and rolling up usage data.
 * @returns A promise that resolves to the API response containing the usage rollup data.
 */
export const getUsageRollup = async (
	baseUrl: string,
	tenantId: string,
	accessToken: string,
	params: UsageRollupRequestParams,
): Promise<RadientApiResponse<UsageRollupResponse>> => {
	// Base URL for the endpoint
	const endpointUrl = `${baseUrl}/v1/tenants/${tenantId}/usage/rollup`;

	// Build query parameters, filtering out undefined values
	const queryParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			queryParams.append(key, String(value));
		}
	}

	const url = `${endpointUrl}?${queryParams.toString()}`;

	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		// Attempt to parse error response, otherwise throw generic error
		try {
			const errorData = await response.json();
			throw new Error(
				`API Error: ${response.status} ${response.statusText} - ${
					errorData?.msg || "Unknown error"
				}`,
			);
		} catch (_) {
			throw new Error(
				`API Error: ${response.status} ${response.statusText}. Failed to parse error response.`,
			);
		}
	}

	// Assuming the API returns the standard RadientApiResponse structure
	const data: RadientApiResponse<UsageRollupResponse> = await response.json();
	return data;
};
