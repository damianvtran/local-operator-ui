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
 * client_id is required to identify the OAuth client application.
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
	/**
	 * The OAuth client ID (required)
	 */
	client_id: string;
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
 * Standard OAuth 2.0 token response
 */
export type TokenResponse = {
	/**
	 * The access token
	 */
	access_token: string;
	/**
	 * The token type, typically "Bearer"
	 */
	token_type: string;
	/**
	 * The lifetime in seconds of the access token
	 */
	expires_in: number;
	/**
	 * The refresh token
	 */
	refresh_token?: string;
	/**
	 * The ID token (OpenID Connect)
	 */
	id_token?: string;
	/**
	 * The scope of the access token
	 */
	scope?: string;
};

/**
 * Response from the token exchange endpoint
 */
export type AuthTokenExchangeResult = {
	/**
	 * Whether the account was newly created during this authentication
	 */
	account_created: boolean;
	/**
	 * Full OAuth 2.0 token response
	 */
	token_response: TokenResponse;
};

/**
 * Request to refresh an access token
 */
export type TokenRefreshRequest = {
	/**
	 * The refresh token
	 */
	refresh_token: string;
	/**
	 * Must be "refresh_token"
	 */
	grant_type: string;
	/**
	 * The OAuth client ID (required)
	 */
	client_id: string;
};

// Define Role type (assuming string union based on common patterns)
export type Role = "admin" | "member" | "owner" | string; // Allow string for flexibility

export type AccountInfo = {
	/**
	 * Account ID (maps to User ID in some contexts)
	 */
	id: string;
	/**
	 * ID of the tenant the account belongs to
	 */
	tenant_id: string; // Added
	/**
	 * User email
	 */
	email: string;
	/**
	 * User name
	 */
	name: string; // Changed to required based on Go struct
	/**
	 * Role of the user within the tenant
	 */
	role: Role; // Added
	/**
	 * Optional metadata associated with the account
	 */
	metadata?: Record<string, string>; // Added
	/**
	 * Account status (assuming this is still relevant, though not in Go struct)
	 */
	status?: "active" | "pending" | "suspended"; // Kept as optional
	/**
	 * Account creation timestamp
	 */
	created_at: string; // Assuming string representation (time.Time -> string)
	/**
	 * Account update timestamp
	 */
	updated_at: string; // Assuming string representation (time.Time -> string)
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

/**
 * Result structure for the credit balance endpoint.
 * Assuming the balance is returned as a number.
 */
export type CreditBalanceResult = {
	/**
	 * The available credit balance.
	 */
	balance: number;
	// Add other relevant fields if known, e.g., currency
	// currency?: string;
};

/**
 * Query parameters for the usage rollup endpoint.
 */
export type UsageRollupRequestParams = {
	/**
	 * Start date in RFC3339 format (e.g., "2023-01-01T00:00:00Z"). Optional.
	 */
	start_date?: string;
	/**
	 * End date in RFC3339 format (e.g., "2023-01-31T23:59:59Z"). Optional.
	 */
	end_date?: string;
	/**
	 * Filter by application ID. Optional.
	 */
	application_id?: string;
	/**
	 * Filter by usage type (e.g., "inference", "tool"). Optional.
	 */
	usage_type?: string;
	/**
	 * Filter by provider (e.g., "openai", "anthropic"). Optional.
	 */
	provider?: string;
	/**
	 * Rollup granularity (required).
	 */
	rollup: "daily" | "monthly" | "annual";
};

/**
 * Represents a single aggregated usage data point from the API response.
 * Structure matches the fields returned by the /usage/rollup endpoint.
 */
export type UsageDataPoint = {
	// Renamed from UsageRecord
	/**
	 * Timestamp for the data point (RFC3339 format).
	 */
	timestamp: string; // Changed from period_start/period_end
	/**
	 * Total number of requests during the period.
	 */
	total_requests: number; // Added
	/**
	 * Total tokens processed during the period.
	 */
	total_tokens: number; // Added
	/**
	 * Total prompt tokens used during the period.
	 */
	prompt_tokens: number; // Added
	/**
	 * Total completion tokens generated during the period.
	 */
	completion_tokens: number; // Added
	/**
	 * Usage units (interpretation might depend on context, potentially credits).
	 */
	units: number; // Changed from usage_units, assuming this maps to tokens/usage for chart
	/**
	 * Total cost incurred during the period.
	 */
	total_cost: number; // Changed from cost, assuming this maps to credits for chart
	/**
	 * Number of successful requests.
	 */
	success_count: number; // Added
	/**
	 * Number of failed requests.
	 */
	failure_count: number; // Added
	/**
	 * Optional: Application ID if the rollup is per-application.
	 */
	// Fields like application_id, usage_type, provider might be present
	// depending on the rollup parameters, but are not shown in the example log.
	// Add them as optional if needed based on API behavior.
	application_id?: string;
	usage_type?: string;
	provider?: string;
};

/**
 * Response structure for the usage rollup endpoint.
 */
export type UsageRollupResponse = {
	/**
	 * An array of aggregated usage data points.
	 */
	data_points: UsageDataPoint[]; // Changed from usage_records: UsageRecord[]
	/**
	 * The granularity used for the rollup.
	 */
	rollup: "daily" | "monthly" | "annual";
	/**
	 * The start date of the queried period.
	 */
	start_date: string;
	/**
	 * The end date of the queried period.
	 */
	end_date: string;
};

/**
 * Response type for the /v1/prices endpoint.
 */
export type PricesResponse = {
	/**
	 * Default credits granted upon new account creation.
	 */
	default_new_credits: number;
	/**
	 * Default credits granted upon first registration/payment.
	 */
	default_registration_credits: number;
};

/* =========================
   Agent API Types
   ========================= */

/**
 * Agent object returned by the API.
 */
export type Agent = {
	id: string;
	account_id: string;
	tenant_id: string;
	name: string;
	description?: string;
	model?: string;
	version: string;
	created_at: string;
	updated_at: string;
	current_working_directory?: string;
	security_prompt?: string;
	last_message?: string;
	last_message_datetime?: string;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	max_tokens?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	seed?: number;
	hosting?: string;
	state?: AgentState;
};

/**
 * Agent state object (included in detail view).
 */
export type AgentState = {
	agent_system_prompt?: string;
	conversation?: ConversationRecord[];
	current_plan?: string;
	execution_history?: CodeExecutionResult[];
	instruction_details?: string;
	learnings?: string[];
	version?: string;
};

/**
 * Conversation record for agent state.
 */
export type ConversationRecord = {
	content: string;
	ephemeral?: boolean;
	files?: string[];
	is_system_prompt?: boolean;
	role?: string;
	should_cache?: boolean;
	should_summarize?: boolean;
	summarized?: boolean;
	timestamp?: string;
};

/**
 * Code execution result for agent state.
 */
export type CodeExecutionResult = {
	action?: string;
	code?: string;
	execution_type?: string;
	files?: string[];
	formatted_print?: string;
	id?: string;
	is_complete?: boolean;
	is_streamable?: boolean;
	logging?: string;
	message?: string;
	role?: string;
	status?: string;
	stderr?: string;
	stdout?: string;
	task_classification?: string;
	timestamp?: string;
};

/**
 * Paginated response for agent list.
 */
export type PaginatedAgentList = {
	page: number;
	per_page: number;
	records: Agent[];
	total_pages: number;
	total_records: number;
};

/**
 * Request body for creating an agent.
 */
export type CreateAgentRequest = {
	name: string;
	version: string;
	description?: string;
	model?: string;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	max_tokens?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	seed?: number;
	hosting?: string;
	security_prompt?: string;
	current_working_directory?: string;
	stop?: string[];
};

/**
 * Request body for updating an agent.
 */
export type UpdateAgentRequest = Partial<CreateAgentRequest>;

/**
 * Comment object for agent comments.
 */
export type AgentComment = {
	id: string;
	account_id: string;
	tenant_id: string;
	subject_id: string;
	subject_type: string;
	text: string;
	created_at: string;
	updated_at: string;
};

/**
 * Request body for creating a comment.
 */
export type CreateAgentCommentRequest = {
	text: string;
};

/**
 * Request body for updating a comment.
 */
export type UpdateAgentCommentRequest = {
	text: string;
};

/**
 * Like/favourite/download count response.
 */
export type CountResponse = {
	count: number;
};

/**
 * API response for generic success/failure.
 */
export type APIResponse = {
	msg: string;
	result?: unknown;
	error?: string;
};
