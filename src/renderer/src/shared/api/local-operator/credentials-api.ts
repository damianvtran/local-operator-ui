/**
 * Local Operator API - Credentials Endpoints
 */
import { desktopControlResponse } from "./desktop-api";
import type {
	CRUDResponse,
	CredentialListResult,
	CredentialUpdate,
} from "./types";

async function readOpenCredentialList(
	baseUrl: string,
): Promise<CRUDResponse<CredentialListResult>> {
	// Unmanaged / old backends serve GET /v1/credentials without a bearer.
	// The desktop transport 503s every non-capabilities op when this app
	// has no token, so the first-run decision cannot go through it -- it
	// would hang in `pending` forever. Health already talks to the backend
	// this way; this is the same open surface, not a second auth path.
	const response = await fetch(`${baseUrl}/v1/credentials`, {
		method: "GET",
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(
			`List credentials request failed: ${response.status} ${response.statusText}`,
		);
	}
	return response.json() as Promise<CRUDResponse<CredentialListResult>>;
}

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
	 * List credential keys from the open (unauthenticated) route.
	 *
	 * Only for the first-run decision on a backend that has not advertised
	 * desktop auth. Settings and every other caller keep using the bearer
	 * transport above: this must not become a silent downgrade.
	 */
	async listOpenCredentials(baseUrl: string): Promise<CredentialListResult> {
		const response = await readOpenCredentialList(baseUrl);
		if (response.status >= 400 || !response.result) {
			throw new Error(response.message || "Failed to fetch credentials");
		}
		return response.result;
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
