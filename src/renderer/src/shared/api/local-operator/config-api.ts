/**
 * Local Operator API - Configuration Endpoints
 */
import { DesktopControlError, desktopControlResponse } from "./desktop-api";
import type {
	CRUDResponse,
	ConfigResponse,
	ConfigUpdate,
	SystemPromptResponse,
	SystemPromptUpdate,
} from "./types";

/**
 * Fail with the HTTP status preserved, so callers can classify the failure.
 *
 * These calls used to throw a plain `Error`, which discards the status. Every
 * consumer that classified one therefore fell to `backendErrorKind`'s
 * `status: null` default and concluded "nothing answered" -- so Settings told a
 * user whose server was running and refusing its bearer (401) that the server
 * "may not be running", and offered no restart. That is the same wrong-remedy
 * defect this change set removes from the providers grid, on the page issue 89
 * is named after. `DesktopControlError` is the type the shared classifier
 * reads, and it is the only thing that makes the classification real rather
 * than defaulted.
 *
 * The message stays technical on purpose: it is the debugging detail behind
 * the failure and reaches logs and `error.message`, never a rendered sentence.
 * Surfaces render `backendLoadErrorMessage`, which speaks in the user's terms.
 */
function desktopConfigFailure(
	operation: string,
	response: { status: number; statusText: string },
): DesktopControlError {
	return new DesktopControlError(
		response.status,
		`${operation} request failed: ${response.status} ${response.statusText}`,
	);
}

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
			throw desktopConfigFailure("Get config", response);
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
			throw desktopConfigFailure("Update config", response);
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
			throw desktopConfigFailure("Get system prompt", response);
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
			throw desktopConfigFailure("Update system prompt", response);
		}

		return response.json() as Promise<CRUDResponse<SystemPromptResponse>>;
	},
};
