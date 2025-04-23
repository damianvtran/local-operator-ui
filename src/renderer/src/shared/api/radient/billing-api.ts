/**
 * Radient Billing API
 *
 * Functions for interacting with the Radient billing endpoints.
 */
import type { CreditBalanceResult, RadientApiResponse } from "./types";

/**
 * Fetches the credit balance for a given tenant.
 *
 * @param baseUrl - The base URL of the Radient API.
 * @param tenantId - The ID of the tenant whose credits to fetch.
 * @param accessToken - The user's access token for authorization.
 * @returns A promise that resolves to the API response containing the credit balance.
 */
export const getCreditBalance = async (
	baseUrl: string,
	tenantId: string,
	accessToken: string,
): Promise<RadientApiResponse<CreditBalanceResult>> => {
	const url = `${baseUrl}/v1/tenants/${tenantId}/billing/credits`;

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
	const data: RadientApiResponse<CreditBalanceResult> = await response.json();
	return data;
};
