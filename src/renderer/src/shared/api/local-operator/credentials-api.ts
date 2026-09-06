/**
 * Local Operator API - Credentials Endpoints
 */
import { desktopControlResponse } from "./desktop-api";
import type {
	CRUDResponse,
	CredentialListResult,
	CredentialUpdate,
} from "./types";

/**
 * Credentials API client for the Local Operator API
 */
export const CredentialsApi = {
	/**
	 * List credentials
	 * Retrieve a list of credential keys (without their values).
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @returns Promise resolving to the credentials list response
	 */
	async listCredentials(
		_baseUrl: string,
	): Promise<CRUDResponse<CredentialListResult>> {
		const response = await desktopControlResponse({ op: "credentials.list" });

		if (!response.ok) {
			throw new Error(
				`List credentials request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<CredentialListResult>>;
	},

	/**
	 * Update a credential
	 * Update an existing credential or create a new one with the provided key and value.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param credentialUpdate - The credential key and value to update
	 * @returns Promise resolving to the update response
	 */
	async updateCredential(
		_baseUrl: string,
		credentialUpdate: CredentialUpdate,
	): Promise<CRUDResponse> {
		const response = await desktopControlResponse({
			op: "credentials.update",
			key: credentialUpdate.key,
			value: credentialUpdate.value,
		});

		if (!response.ok) {
			throw new Error(
				`Update credential request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},
};
