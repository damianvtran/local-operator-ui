/**
 * Radient Prices API Client
 *
 * Functions for interacting with the Radient prices endpoint.
 */
// No external HTTP client needed, using native fetch
import type { PricesResponse, RadientApiResponse } from "./types";

/**
 * Joins base URL and path ensuring exactly one slash between them.
 *
 * @param baseUrl - The base URL
 * @param path - The endpoint path
 * @returns The joined URL
 */
function joinUrl(baseUrl: string, path: string): string {
	const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
	return normalizedBaseUrl + normalizedPath;
}

/**
 * Fetches the default credit prices from the Radient API.
 * This is a public endpoint and does not require authentication.
 *
 * @param baseUrl - The base URL of the Radient API.
 * @returns A promise that resolves with the prices data.
 * @throws Throws an error if the API request fails.
 */
export const fetchPrices = async (
	baseUrl: string,
): Promise<PricesResponse> => {
	const url = joinUrl(baseUrl, "/v1/prices"); // Construct the full URL

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				// No Authorization needed for this public endpoint
				"Content-Type": "application/json",
			},
			credentials: "same-origin", // Match credentials policy from auth-api
		});

		if (!response.ok) {
			// Attempt to read error message, fallback to status
			const errorText = await response.text();
			console.error(
				`Error fetching Radient prices: ${response.status} ${errorText}`,
			);
			throw new Error(
				errorText || `Failed to fetch Radient prices: ${response.status}`,
			);
		}

		// Parse the JSON response which includes the RadientApiResponse wrapper
		const apiResponse: RadientApiResponse<PricesResponse> =
			await response.json();

		// Return the actual data nested within the 'result' field
		return apiResponse.result;
	} catch (error) {
		// Log and re-throw if fetch itself or JSON parsing fails
		console.error("Error during fetchPrices execution:", error);
		// Ensure the error is an instance of Error for consistent handling
		if (error instanceof Error) {
			throw error;
		}
		// If it's not an Error instance, wrap it
		throw new Error("An unknown error occurred while fetching prices");
	}
};
