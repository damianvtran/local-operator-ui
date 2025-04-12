/**
 * Radient Auth API
 *
 * API client for authentication-related endpoints
 */

import type {
	AuthProvider,
	AuthTokenExchangeRequest,
	AuthTokenExchangeResult,
	CreateApplicationRequest,
	CreateApplicationResult,
	ProvisionResult,
	RadientApiResponse,
	UserInfoResult,
} from "./types";

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
 * Exchange an ID token or access token for a backend JWT.
 *
 * The backend will accept either an ID token or an access token, or both.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param provider - The authentication provider
 * @param tokens - An object containing either or both tokens
 * @returns The backend JWT
 */
export async function exchangeToken(
	baseUrl: string,
	provider: AuthProvider,
	tokens: { idToken?: string; accessToken?: string },
): Promise<RadientApiResponse<AuthTokenExchangeResult>> {
	const endpoint =
		provider === "google" ? "/v1/auth/google" : "/v1/auth/microsoft";
	const url = joinUrl(baseUrl, endpoint);

	const body: AuthTokenExchangeRequest = {
		id_token: tokens.idToken,
		access_token: tokens.accessToken,
	};

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Create a new application for a given account
 *
 * @param baseUrl - The base URL of the Radient API
 * @param accountId - The ID of the account to create the application for
 * @param jwt - The backend JWT
 * @param applicationData - Data for the new application
 * @returns The created application information
 */
export async function createApplication(
	baseUrl: string,
	accountId: string,
	jwt: string,
	applicationData: CreateApplicationRequest,
): Promise<RadientApiResponse<CreateApplicationResult>> {
	const url = joinUrl(baseUrl, `/v1/accounts/${accountId}/applications`);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${jwt}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(applicationData),
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Exchange Google tokens for a backend JWT.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param tokens - An object containing either or both tokens
 * @returns The backend JWT
 */
export async function exchangeGoogleToken(
	baseUrl: string,
	tokens: { idToken?: string; accessToken?: string },
): Promise<RadientApiResponse<AuthTokenExchangeResult>> {
	return exchangeToken(baseUrl, "google", tokens);
}

/**
 * Exchange Microsoft tokens for a backend JWT.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param tokens - An object containing either or both tokens
 * @returns The backend JWT
 */
export async function exchangeMicrosoftToken(
	baseUrl: string,
	tokens: { idToken?: string; accessToken?: string },
): Promise<RadientApiResponse<AuthTokenExchangeResult>> {
	return exchangeToken(baseUrl, "microsoft", tokens);
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
): Promise<RadientApiResponse<UserInfoResult>> {
	const url = joinUrl(baseUrl, "/v1/me");

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
): Promise<RadientApiResponse<ProvisionResult>> {
	const url = joinUrl(baseUrl, "/v1/provision");

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
