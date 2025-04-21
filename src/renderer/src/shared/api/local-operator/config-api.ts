/**
 * Local Operator API - Configuration Endpoints
 */
import type {
	CRUDResponse,
	ConfigResponse,
	ConfigUpdate,
	SystemPromptResponse,
	SystemPromptUpdate,
} from "./types";

/**
 * Config API client for the Local Operator API
 */
export const ConfigApi = {
	/**
	 * Get configuration
	 * Retrieve the current configuration settings.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @returns Promise resolving to the configuration response
	 */
	async getConfig(baseUrl: string): Promise<CRUDResponse<ConfigResponse>> {
		const response = await fetch(`${baseUrl}/v1/config`, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Get config request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ConfigResponse>>;
	},

	/**
	 * Update configuration
	 * Update the configuration settings with new values.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param configUpdate - The configuration values to update
	 * @returns Promise resolving to the updated configuration response
	 */
	async updateConfig(
		baseUrl: string,
		configUpdate: ConfigUpdate,
	): Promise<CRUDResponse<ConfigResponse>> {
		const response = await fetch(`${baseUrl}/v1/config`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(configUpdate),
		});

		if (!response.ok) {
			throw new Error(
				`Update config request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ConfigResponse>>;
	},

	/**
	 * Get system prompt
	 * Retrieve the current system prompt content.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @returns Promise resolving to the system prompt response or null if no prompt exists
	 */
	async getSystemPrompt(
		baseUrl: string,
	): Promise<CRUDResponse<SystemPromptResponse> | null> {
		const response = await fetch(`${baseUrl}/v1/config/system-prompt`, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		// Handle 204 No Content response (system prompt doesn't exist)
		if (response.status === 204) {
			return null;
		}

		if (!response.ok) {
			throw new Error(
				`Get system prompt request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<SystemPromptResponse>>;
	},

	/**
	 * Update system prompt
	 * Update the system prompt content.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param systemPromptUpdate - The new system prompt content
	 * @returns Promise resolving to the updated system prompt response
	 */
	async updateSystemPrompt(
		baseUrl: string,
		systemPromptUpdate: SystemPromptUpdate,
	): Promise<CRUDResponse<SystemPromptResponse>> {
		const response = await fetch(`${baseUrl}/v1/config/system-prompt`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(systemPromptUpdate),
		});

		if (!response.ok) {
			throw new Error(
				`Update system prompt request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<SystemPromptResponse>>;
	},
};
