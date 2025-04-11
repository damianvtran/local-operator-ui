/**
 * Radient API Types
 *
 * Type definitions for the Radient API client
 */

/**
 * Authentication provider type
 */
export type AuthProvider = "google" | "microsoft";

/**
 * Request to exchange an ID token for a backend JWT
 */
export type AuthTokenExchangeRequest = {
	/**
	 * The ID token from the authentication provider
	 */
	id_token: string;
};

/**
 * Response from the token exchange endpoint
 */
export type AuthTokenExchangeResponse = {
	/**
	 * The backend JWT token
	 */
	token: string;
};

/**
 * User information returned by the /me endpoint
 */
export type UserInfoResponse = {
	/**
	 * User ID
	 */
	id: string;
	/**
	 * User email
	 */
	email: string;
	/**
	 * User name
	 */
	name?: string;
	/**
	 * Account status
	 */
	status: "active" | "pending" | "suspended";
	/**
	 * Account creation timestamp
	 */
	created_at: string;
	/**
	 * Account update timestamp
	 */
	updated_at: string;
};

/**
 * Response from the /provision endpoint
 */
export type ProvisionResponse = {
	/**
	 * The API key for the provisioned account
	 */
	api_key: string;
	/**
	 * User ID
	 */
	user_id: string;
	/**
	 * Account status
	 */
	status: "active";
	/**
	 * Account creation timestamp
	 */
	created_at: string;
};

/**
 * Error response from the API
 */
export type ErrorResponse = {
	/**
	 * Error message
	 */
	message: string;
	/**
	 * Error code
	 */
	code?: string;
	/**
	 * HTTP status code
	 */
	status?: number;
};
