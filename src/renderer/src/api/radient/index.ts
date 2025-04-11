/**
 * Radient API Client
 *
 * Main client for the Radient API
 */

import * as AuthApiImpl from "./auth-api";
import type {
	RadientApiResponse,
	AuthTokenExchangeResult,
	UserInfoResult,
	ProvisionResult,
} from "./types";

// Export all API modules
export * from "./auth-api";

// Export all types
export * from "./types";

/**
 * Type for a function that takes a base URL as its first parameter
 * T represents the original function type without the baseUrl parameter
 */
type WithBaseUrl<T extends (...args: unknown[]) => unknown> = (
	baseUrl: string,
	...args: Parameters<T>
) => ReturnType<T>;

/**
 * Type for an API module with methods that take a base URL as their first parameter
 */
type ApiWithBaseUrl<T> = {
	[K in keyof T]: T[K] extends (...args: unknown[]) => unknown
		? WithBaseUrl<T[K]>
		: T[K];
};

/**
 * Type for a bound API module where the base URL is already provided
 */
type BoundApi<T> = {
	[K in keyof T]: T[K] extends (baseUrl: string, ...args: infer P) => infer R
		? (...args: P) => R
		: T[K];
};

/**
 * RadientClient - Main client for the Radient API
 * Provides a unified interface to all API endpoints with proper typing
 */
export class RadientClient {
	private baseUrl: string;

	/**
	 * Create a new Radient API client
	 *
	 * @param baseUrl - The base URL of the Radient API
	 */
	constructor(baseUrl: string) {
		// Ensure the base URL doesn't end with a slash
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	}

	/**
	 * Get the Auth API client with methods bound to the base URL
	 */
	get auth(): BoundApi<ApiWithBaseUrl<typeof AuthApiImpl>> {
		return this.bindBaseUrlToApi(AuthApiImpl);
	}

	/**
	 * Bind the base URL to all methods of an API module
	 *
	 * @param api - The API module to bind the base URL to
	 * @returns A new API module with all methods bound to the base URL
	 */
	private bindBaseUrlToApi<T extends object>(
		api: T,
	): BoundApi<ApiWithBaseUrl<T>> {
		const boundApi = {} as BoundApi<ApiWithBaseUrl<T>>;

		for (const key of Object.keys(api)) {
			const typedKey = key as keyof T;
			const method = api[typedKey];

			if (typeof method === "function") {
				// Create a new function that calls the original with the base URL
				boundApi[typedKey] = ((...args: unknown[]) =>
					(method as (...params: unknown[]) => unknown)(
						this.baseUrl,
						...args,
					)) as BoundApi<ApiWithBaseUrl<T>>[keyof T];
			} else {
				// Copy non-function properties as-is
				boundApi[typedKey] = method as BoundApi<ApiWithBaseUrl<T>>[keyof T];
			}
		}

		return boundApi;
	}

	/**
	 * Exchange a Google ID token for a backend JWT
	 *
	 * @param idToken - The Google ID token
	 * @returns The backend JWT
	 */
	/**
	 * Exchange a Google ID token for a backend JWT
	 *
	 * @param idToken - The Google ID token
	 * @returns The backend JWT (standard response format)
	 */
	async exchangeGoogleToken(tokens: {
		idToken?: string;
		accessToken?: string;
	}): Promise<RadientApiResponse<AuthTokenExchangeResult>> {
		return this.auth.exchangeGoogleToken(tokens);
	}

	/**
	 * Exchange a Microsoft ID token for a backend JWT
	 *
	 * @param idToken - The Microsoft ID token
	 * @returns The backend JWT (standard response format)
	 */
	async exchangeMicrosoftToken(tokens: {
		idToken?: string;
		accessToken?: string;
	}): Promise<RadientApiResponse<AuthTokenExchangeResult>> {
		return this.auth.exchangeMicrosoftToken(tokens);
	}

	/**
	 * Get the current user's information
	 *
	 * @param jwt - The backend JWT
	 * @returns The user information (standard response format)
	 */
	async getUserInfo(jwt: string): Promise<RadientApiResponse<UserInfoResult>> {
		return this.auth.getUserInfo(jwt);
	}

	/**
	 * Provision a new account
	 *
	 * @param jwt - The backend JWT
	 * @returns The provisioned account information (standard response format)
	 */
	async provisionAccount(
		jwt: string,
	): Promise<RadientApiResponse<ProvisionResult>> {
		return this.auth.provisionAccount(jwt);
	}
}

/**
 * Create a new Radient API client
 *
 * @param baseUrl - The base URL of the Radient API
 * @returns A new Radient API client instance
 */
export const createRadientClient = (baseUrl: string): RadientClient => {
	return new RadientClient(baseUrl);
};
