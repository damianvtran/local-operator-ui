/**
 * Local Operator API - Health Endpoints
 */
import type { HealthCheckResponse } from "./types";

/**
 * Health API client for the Local Operator API
 */
export const HealthApi = {
	/**
	 * Health Check
	 * Returns the health status of the API server.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @returns Promise resolving to the health check response
	 */
	async healthCheck(baseUrl: string): Promise<HealthCheckResponse> {
		const response = await fetch(`${baseUrl}/health`, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Health check failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<HealthCheckResponse>;
	},

	/**
	 * Get the server version from the health check response
	 * Handles backward compatibility with older server versions
	 *
	 * @param healthResponse - The health check response
	 * @returns The server version or "Unknown (update required)" if not available
	 */
	getServerVersion(healthResponse: HealthCheckResponse): string {
		// Check if the response has the result field with version information
		if (healthResponse.result?.version) {
			return healthResponse.result.version;
		}

		// For older server versions that don't have the version information
		return "Unknown (update required)";
	},
};
