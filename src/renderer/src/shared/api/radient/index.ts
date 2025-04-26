/**
 * Radient API Client
 *
 * Main client for the Radient API
 */
import * as AuthApiImpl from "./auth-api";
import * as BillingApiImpl from "./billing-api";
import * as PricesApiImpl from "./prices-api";
import type {
	AuthTokenExchangeResult,
	CreateApplicationRequest,
	CreateApplicationResult,
	ProvisionResult,
	RadientApiResponse,
	TokenResponse,
	UserInfoResult,
} from "./types";
import * as UsageApiImpl from "./usage-api";

// Export all API modules
export {
	exchangeToken,
	createApplication,
	exchangeGoogleToken,
	exchangeMicrosoftToken,
	getUserInfo,
	provisionAccount,
	refreshToken,
	revokeToken,
} from "./auth-api";
export { getCreditBalance } from "./billing-api";
export { fetchPrices } from "./prices-api";
export { getUsageRollup } from "./usage-api";

// Export all types
export type {
	AuthProvider,
	AuthTokenExchangeRequest,
	RadientApiResponse,
	TokenResponse,
	AuthTokenExchangeResult,
	TokenRefreshRequest,
	AccountInfo,
	IdentityInfo,
	UserInfoResult,
	ProvisionResult,
	CreateApplicationRequest,
	CreateApplicationResult,
	ErrorResponse,
	PricesResponse,
} from "./types";

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
	private clientId: string;

	/**
	 * Create a new Radient API client
	 *
	 * @param baseUrl - The base URL of the Radient API
	 * @param clientId - The OAuth client ID to use for auth requests
	 */
	constructor(baseUrl: string, clientId: string) {
		// Ensure the base URL doesn't end with a slash
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
		this.clientId = clientId;
	}

	/**
	 * Get the Auth API client with methods bound to the base URL
	 */
	get auth(): BoundApi<ApiWithBaseUrl<typeof AuthApiImpl>> & {
		clientId: string;
	} {
		const api = this.bindBaseUrlToApi(AuthApiImpl);
		return { ...api, clientId: this.clientId };
	}

	/**
	 * Get the Billing API client with methods bound to the base URL
	 */
	get billing(): BoundApi<ApiWithBaseUrl<typeof BillingApiImpl>> {
		return this.bindBaseUrlToApi(BillingApiImpl);
	}

	/**
	 * Get the Usage API client with methods bound to the base URL
	 */
	get usage(): BoundApi<ApiWithBaseUrl<typeof UsageApiImpl>> {
		return this.bindBaseUrlToApi(UsageApiImpl);
	}

	/**
	 * Get the Prices API client with methods bound to the base URL
	 */
	get prices(): BoundApi<ApiWithBaseUrl<typeof PricesApiImpl>> {
		return this.bindBaseUrlToApi(PricesApiImpl);
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
		return this.auth.exchangeGoogleToken(tokens, this.clientId);
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
		return this.auth.exchangeMicrosoftToken(tokens, this.clientId);
	}

	/**
	 * Get the current user's information
	 *
	 * @param accessToken - The access token
	 * @returns The user information (standard response format)
	 */
	async getUserInfo(
		accessToken: string,
	): Promise<RadientApiResponse<UserInfoResult>> {
		return this.auth.getUserInfo(accessToken);
	}

	/**
	 * Provision a new account
	 *
	 * @param accessToken - The access token
	 * @returns The provisioned account information (standard response format)
	 */
	async provisionAccount(
		accessToken: string,
	): Promise<RadientApiResponse<ProvisionResult>> {
		return this.auth.provisionAccount(accessToken);
	}

	/**
	 * Create a new application for a given account
	 *
	 * @param tenantId - The ID of the tenant to create the application for
	 * @param accessToken - The access token
	 * @param applicationData - Data for the new application
	 * @returns The created application information (standard response format)
	 */
	async createApplication(
		tenantId: string,
		accessToken: string,
		applicationData: CreateApplicationRequest,
	): Promise<RadientApiResponse<CreateApplicationResult>> {
		return this.auth.createApplication(tenantId, accessToken, applicationData);
	}

	/**
	 * Refresh an access token using a refresh token
	 *
	 * @param refreshToken - The refresh token
	 * @returns A new token response with a fresh access token
	 */
	async refreshToken(
		refreshToken: string,
	): Promise<RadientApiResponse<TokenResponse>> {
		return this.auth.refreshToken(refreshToken, this.clientId);
	}

	/**
	 * Revoke a token
	 *
	 * @param token - The token to revoke
	 * @param tokenType - The type of token to revoke (access_token or refresh_token)
	 * @returns Success response
	 */
	async revokeToken(
		token: string,
		tokenType: "access_token" | "refresh_token",
	): Promise<RadientApiResponse<{ success: boolean }>> {
		return this.auth.revokeToken(token, tokenType);
	}
}

/**
 * Create a new Radient API client
 *
 * @param baseUrl - The base URL of the Radient API
 * @returns A new Radient API client instance
 */
/**
 * Create a new Radient API client
 *
 * @param baseUrl - The base URL of the Radient API
 * @param clientId - The OAuth client ID to use for auth requests
 * @returns A new Radient API client instance
 */
export const createRadientClient = (
	baseUrl: string,
	clientId: string,
): RadientClient => {
	return new RadientClient(baseUrl, clientId);
};
