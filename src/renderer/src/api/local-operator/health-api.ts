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
};
