/**
 * Radient Auth API
 *
 * API client for authentication-related endpoints
 */

import type {
	AuthProvider,
	AuthTokenExchangeRequest,
	AuthTokenExchangeResponse,
	UserInfoResponse,
	ProvisionResponse,
} from "./types";

/**
 * Exchange an ID token for a backend JWT
 *
 * @param baseUrl - The base URL of the Radient API
 * @param provider - The authentication provider
 * @param idToken - The ID token
 * @returns The backend JWT
 */
export async function exchangeToken(
	baseUrl: string,
	provider: AuthProvider,
	idToken: string,
): Promise<AuthTokenExchangeResponse> {
	const endpoint = provider === "google" ? "/auth/google" : "/auth/microsoft";
	const url = `${baseUrl}${endpoint}`;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ id_token: idToken } as AuthTokenExchangeRequest),
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Exchange a Google ID token for a backend JWT
 *
 * @param baseUrl - The base URL of the Radient API
 * @param idToken - The Google ID token
 * @returns The backend JWT
 */
export async function exchangeGoogleToken(
	baseUrl: string,
	idToken: string,
): Promise<AuthTokenExchangeResponse> {
	return exchangeToken(baseUrl, "google", idToken);
}

/**
 * Exchange a Microsoft ID token for a backend JWT
 *
 * @param baseUrl - The base URL of the Radient API
 * @param idToken - The Microsoft ID token
 * @returns The backend JWT
 */
export async function exchangeMicrosoftToken(
	baseUrl: string,
	idToken: string,
): Promise<AuthTokenExchangeResponse> {
	return exchangeToken(baseUrl, "microsoft", idToken);
}

/**
 * Get the current user's information
 *
 * @param baseUrl - The base URL of the Radient API
 * @param jwt - The backend JWT
 * @returns The user information
 */
export async function getUserInfo(
	baseUrl: string,
	jwt: string,
): Promise<UserInfoResponse> {
	const url = `${baseUrl}/me`;

	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${jwt}`,
		},
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Provision a new account
 *
 * @param baseUrl - The base URL of the Radient API
 * @param jwt - The backend JWT
 * @returns The provisioned account information
 */
export async function provisionAccount(
	baseUrl: string,
	jwt: string,
): Promise<ProvisionResponse> {
	const url = `${baseUrl}/provision`;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${jwt}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({}),
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}
