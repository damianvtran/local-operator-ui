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
 * Request to exchange an ID token or access token for a backend JWT.
 *
 * The backend will accept either an ID token or an access token, or both.
 * At least one of these should be provided.
 */
export type AuthTokenExchangeRequest = {
	/**
	 * The ID token from the authentication provider (Google or Microsoft)
	 */
	id_token?: string;
	/**
	 * The access token from the authentication provider (Google or Microsoft)
	 */
	access_token?: string;
};

/**
 * Standard Radient API response format
 * All API responses are wrapped in this structure.
 */
export type RadientApiResponse<T> = {
	/**
	 * Human-readable message from the API
	 */
	msg: string;
	/**
	 * The actual data payload
	 */
	result: T;
};

/**
 * Response from the token exchange endpoint
 */
export type AuthTokenExchangeResult = {
	/**
	 * The backend JWT token
	 */
	token: string;
};

export type AccountInfo = {
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

export type IdentityInfo = {
	/**
	 * The user email
	 */
	email: string;
	/**
	 * The provider of the identity
	 */
	provider: AuthProvider;
	/**
	 * The provider ID
	 */
	provider_id: string;
};

/**
 * User information returned by the /me endpoint
 */
export type UserInfoResult = {
	/**
	 * The account information
	 */
	account: AccountInfo;
	/**
	 * The identity information
	 */
	identity: IdentityInfo;
};

/**
 * Response from the /provision endpoint
 */
export type ProvisionResult = {
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
 * CreateApplicationRequest defines the input for creating a new application.
 */
export type CreateApplicationRequest = {
	/**
	 * Name for the new application
	 */
	name: string;
	/**
	 * Optional description for the application
	 */
	description?: string;
};

/**
 * Response from the application creation endpoint
 */
export type CreateApplicationResult = {
	/**
	 * ID of the newly created application
	 */
	id: string;
	/**
	 * Name of the application
	 */
	name: string;
	/**
	 * Description of the application
	 */
	description: string;
	/**
	 * ID of the account it belongs to
	 */
	account_id: string;
	/**
	 * The raw, unhashed API key (only shown on creation)
	 */
	api_key: string;
	/**
	 * Timestamp of creation
	 */
	created_at: string;
	/**
	 * Timestamp of last update
	 */
	updated_at: string;
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
