/**
 * Local Operator API - Configuration Endpoints
 */
import { desktopControlResponse } from "./desktop-api";
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
	async getConfig(_baseUrl: string): Promise<CRUDResponse<ConfigResponse>> {
		const response = await desktopControlResponse({ op: "config.get" });

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
		_baseUrl: string,
		configUpdate: ConfigUpdate,
	): Promise<CRUDResponse<ConfigResponse>> {
		const response = await desktopControlResponse({
			op: "config.update",
			value: configUpdate,
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
		_baseUrl: string,
	): Promise<CRUDResponse<SystemPromptResponse> | null> {
		const response = await desktopControlResponse({ op: "instructions.get" });

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
		_baseUrl: string,
		systemPromptUpdate: SystemPromptUpdate,
	): Promise<CRUDResponse<SystemPromptResponse>> {
		const response = await desktopControlResponse({
			op: "instructions.update",
			content: systemPromptUpdate.content,
		});

		if (!response.ok) {
			throw new Error(
				`Update system prompt request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<SystemPromptResponse>>;
	},
};
