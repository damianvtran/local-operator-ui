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
	tenant_id: string;
	/**
	 * User email
	 */
	email: string;
	/**
	 * User name
	 */
	name: string;
	/**
	 * Role of the user within the tenant
	 */
	role: Role;
	/**
	 * Optional metadata associated with the account
	 */
	metadata?: Record<string, string>;
	/**
	 * Account status (assuming this is still relevant, though not in Go struct)
	 */
	status?: "active" | "pending" | "suspended";
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
 * The author a hub row carries.
 *
 * `email` is OPTIONAL because the hub does not always send one: the PUBLIC team
 * listing's rows carry a name and nothing else (measured against the live hub,
 * 2026-10-05), and a type that demanded an address would have every reader of
 * these rows either invent one or cast around the type. `Agent`'s own rows are
 * read through `account_metadata?.email` on the details page for the same
 * reason — present is not the same as promised.
 */
export type AccountMetadata = {
	name: string;
	email?: string;
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
 * The signup-grant verification state Radient reports for the account.
 *
 * OPTIONAL wherever it is consumed, on purpose: an older backend does not send
 * it at all, and every consumer reads its absence as "cannot say" rather than
 * as "not verified" - a callout that prompts a user whose backend simply
 * predates the field would be misdirection, not a reminder.
 */
export type AccountVerification = {
	/**
	 * Radient's OWN Turnstile-gated claim state
	 * (`billing_accounts.email_verified_at`), never inferred from the OAuth
	 * identity's `email_verified` claim: a Google or Microsoft address being
	 * verified does not claim the grant, so treating it as though it did would
	 * hide the one step the user still has to take.
	 */
	email_verified: boolean;
	/** Where the grant stands in its lifecycle. */
	signup_grant: "claimed" | "pending" | "expired" | "none";
	/**
	 * The grant as captured when it was issued, so a later change to the
	 * backend's constant cannot alter what this screen promises.
	 */
	grant_amount?: number;
	/** Where the claim happens, when the backend names it. */
	claim_url?: string;
	/**
	 * The registration bonus on a FIRST card top-up, when the backend reports it.
	 *
	 * ADDITIVE and optional for the same reason the block around it is: an older
	 * backend does not send it, and its absence means "cannot say", never "no
	 * bonus is on offer" - the out-of-credits guidance in the chat then shows the
	 * top-up link without the bonus line rather than inventing either answer.
	 */
	first_topup?: FirstTopUp;
};

/**
 * The first-top-up offer, as `GET /v1/me` reports it under `verification`.
 *
 * Every field is the backend's own: the amounts are the constants the account
 * would actually be granted, so a screen quoting them cannot drift from what the
 * billing flow does. `bonus_received` is the backend's answer to "is this still
 * a first purchase" (the same predicate the Stripe flow uses to decide whether
 * to grant the bonus), which is why the client never infers it from a balance.
 */
export type FirstTopUp = {
	/** Credits granted on the first qualifying top-up. */
	bonus_amount: number;
	/** The smallest card top-up that earns the bonus. */
	minimum_purchase: number;
	/** True once the bonus was granted or a prior purchase exists. */
	bonus_received: boolean;
	/** The console's billing page, where the top-up happens. */
	topup_url: string;
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
	/**
	 * The signup-grant verification state, when the backend reports one.
	 *
	 * ADDITIVE and optional: the desktop proxy forwards the upstream body
	 * verbatim, and a backend that predates the field must not break any
	 * consumer - which is why nothing here derives a value for its absence.
	 */
	verification?: AccountVerification;
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
	total_requests: number;
	/**
	 * Total tokens processed during the period.
	 */
	total_tokens: number;
	/**
	 * Total prompt tokens used during the period.
	 */
	prompt_tokens: number;
	/**
	 * Total completion tokens generated during the period.
	 */
	completion_tokens: number;
	/**
	 * Usage units (interpretation might depend on context, potentially credits).
	 */
	units: number;
	/**
	 * Total cost incurred during the period.
	 */
	total_cost: number;
	/**
	 * Number of successful requests.
	 */
	success_count: number;
	/**
	 * Number of failed requests.
	 */
	failure_count: number;
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
	data_points: UsageDataPoint[];
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
	/**
	 * The smallest card top-up that earns the first-top-up bonus (the same
	 * constant as `FirstTopUp.minimum_purchase`). Optional: an older backend does
	 * not send it, and nothing may fall back to a number it did not report.
	 */
	min_top_up?: number;
};

/* =========================
   Agent API Types
   ========================= */

/**
 * Agent categories (snake_case).
 */
export type AgentCategory =
	| "investment"
	| "accounting"
	| "healthcare"
	| "legal"
	| "software"
	| "security"
	| "role_play"
	| "personal_assistance"
	| "education"
	| "marketing"
	| "sales"
	| "research"
	| "other";

/**
 * Agent object returned by the API.
 */
export type Agent = {
	id: string;
	account_id: string;
	tenant_id: string;
	account_metadata: AccountMetadata;
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
	/**
	 * Free text tags associated with the agent.
	 */
	tags?: string[];
	/**
	 * Categories assigned to the agent (enum values, snake_case).
	 */
	categories?: AgentCategory[];
	like_count: number;
	favourite_count: number;
	download_count: number;
	/**
	 * Where this row lives: the public hub or one organization's private
	 * workspace (design §1.5).
	 *
	 * The hub OMITS this for a public row (`AgentResponse.Visibility` is
	 * `json:"visibility,omitempty"` and is set only for `org`), so the absence is
	 * the public reading rather than a missing field — every consumer must treat
	 * `undefined` as "public", and only the literal `"org"` may narrow a surface
	 * to organization behaviour. Declared as the one value the wire carries
	 * rather than `"public" | "org"` so a client cannot write `=== "public"`
	 * against a field that is never `"public"`.
	 */
	visibility?: "org";
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
	content?: string;
	file_path?: string;
	replacements?: string;
	agent?: string;
	learnings?: string;
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

export type PaginatedResponse<T> = {
	page: number;
	per_page: number;
	records: T[];
	total_pages: number;
	total_records: number;
};

/**
 * Paginated response for agent list.
 */
export type PaginatedAgentList = PaginatedResponse<Agent>;

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
	/**
	 * Free text tags for the agent.
	 */
	tags?: string[];
	/**
	 * Categories for the agent (enum values, snake_case).
	 */
	categories?: AgentCategory[];
};

/**
 * Request body for updating an agent.
 */
export type UpdateAgentRequest = {
	name?: string;
	version?: string;
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
	/**
	 * Free text tags for the agent.
	 */
	tags?: string[];
	/**
	 * Categories for the agent (enum values, snake_case).
	 */
	categories?: AgentCategory[];
};

/**
 * Comment object for agent comments.
 */
export type AgentComment = {
	id: string;
	account_id: string;
	tenant_id: string;
	account_metadata: AccountMetadata;
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
 * Like object for agent like endpoints.
 */
export type AgentLike = {
	id: string;
	account_id: string;
	tenant_id: string;
	subject_id: string;
	subject_type: string;
	created_at: string;
	updated_at: string;
};

/**
 * Favourite object for agent favourite endpoints.
 */
export type AgentFavourite = {
	id: string;
	account_id: string;
	tenant_id: string;
	subject_id: string;
	subject_type: string;
	created_at: string;
	updated_at: string;
};

/**
 * One viewer's relationship to one agent, as the batched read reports it.
 *
 * Both halves are answered by the same op so a hub page can ask once for the
 * whole grid instead of twice per card. An absent entry is NOT `false`: the
 * read can fail as a whole (500, 401/403/429, a 422 for the op a backend does
 * not know, a dead transport) and a 200 can carry fewer entries than ids, and
 * both leave the ids they do not answer with no state at all. "Unknown" is
 * therefore carried by the QUERY (`useAgentStatusesQuery`'s `isKnown`, plus the
 * entry-level `isAgentStatusKnown`), never by this type: a card that rendered
 * an absent entry as `liked: false` would state "you have not liked this" about
 * every agent on the page on one failed request. See
 * `hooks/use-agent-statuses-query.ts` for why the failure is safe as long as it
 * is not stated as a fact.
 */
export type AgentViewerStatus = {
	liked: boolean;
	favourited: boolean;
};

/**
 * What the like and favourite endpoints put in `APIResponse.result`.
 *
 * ADDITIVE and optional, the same shape of contract as `agents.statuses` and
 * `profiles.install`'s `already_installed`: the upstream answers 200 with
 * `already_liked: true` when the like was already there rather than 409, and a
 * backend older than the flag answers 200 with no `result` at all. Absent
 * reads as a like that landed — the reading the count delta beside the control
 * is built on — and it is declared here rather than cast off `unknown` at the
 * mutation, so a rename upstream fails a type check instead of silently
 * re-enabling the delta on a no-op.
 */
export type AgentReactionResult = {
	already_liked?: boolean;
	already_favourited?: boolean;
};

/**
 * API response for generic success/failure.
 */
export type APIResponse = {
	msg: string;
	result?: unknown;
	error?: string;
};

/**
 * The plan half of a membership summary (design §4.1).
 *
 * `status` is the tenant plan's own state and `seats` is the current
 * subscription quantity; `seats` is null until a plan row exists. `past_due`
 * is NOT a failure state on the wire: §3.1 gives it full entitlements during
 * dunning (with a payment-issue banner), so a surface that treated it as
 * unentitled would hide an org the hub would still answer for.
 */
export type TeamPlanSummary = {
	status: "none" | "active" | "past_due" | "canceled";
	seats: number | null;
};

/**
 * One row of `GET /v1/me/memberships` (design §4.1), and the additive
 * `memberships` field of `GET /v1/me`.
 *
 * Rows are the caller's OWN memberships, in every state: `status` can be
 * `active`, `pending` (accepted before the tenant had a plan) or `disabled`
 * (a downgrade disabled it), and only `active` entitles org features (§3.2).
 *
 * `is_home` marks the account's HOME tenant — the one it belongs to by default —
 * and it does NOT mean "personal, therefore not an organization": every user's
 * tenant IS their organization, any tenant (including a home one) may carry a
 * Team plan, and §10.2(b) renames a user's own tenant into a shared one (Minerva
 * is its owner's home tenant). So a home row is offered on exactly the same terms
 * as any other: an active membership whose plan entitles org features (§8.4's
 * "each org from `memberships.list` where plan is active"). Nothing filters on
 * `is_home`, and the filter is the PLAN — which is what keeps a plan-less
 * personal workspace out of the scope selector and out of the picker's selectable
 * targets, where it is shown DISABLED with its upgrade reason rather than offered
 * (manager ruling on agent review round 1's M1; the pinned cases live in
 * `scripts/agent-hub-org-sharing.test.mjs`).
 *
 * The console's team page labels its home row "Personal" to explain the row, not
 * to exclude it; this app has no such label because the same row can be a real
 * shared organization.
 */
export type MembershipSummary = {
	tenant_id: string;
	tenant_name: string;
	role: string;
	status: "active" | "pending" | "disabled";
	is_home: boolean;
	plan: TeamPlanSummary;
};

export type MembershipsResult = {
	memberships: MembershipSummary[];
};

/**
 * One roster slot of a published hub team (design §1.6/§4.5).
 *
 * A team's members are named by their roster HANDLES plus how many of that
 * slot the team declares — the published document does not carry the local
 * agent rows, so a pull resolves each name against the local registry. Roster
 * references are deliberately not validated server-side in v1 (§11 O-6).
 */
export type HubTeamMember = {
	role: string;
	kind: string;
	count: number;
};

/**
 * A published team document (design §1.6/§4.5).
 *
 * The LIST form omits `instructions` — the brief is detail-only, so a list page
 * does not carry 8 KB per row — which is why it is optional here rather than
 * required with a default.
 */
export type HubTeam = {
	id: string;
	tenant_id: string;
	account_id: string;
	account_metadata?: AccountMetadata;
	name: string;
	description: string;
	manager: string;
	members: HubTeamMember[];
	instructions?: string;
	project: string;
	version: string;
	document_version?: number;
	created_date: string;
	updated_at: string;
};

export type HubTeamsResult = {
	teams: HubTeam[];
};

/**
 * `GET /v1/teams/:teamid` — the org-agnostic pull path (§4.5).
 *
 * THE DOCUMENT ITSELF, not a `{team: ...}` wrapper. Measured against the live
 * hub on 2026-10-05: the route answers
 * `{"msg": "Team retrieved successfully", "result": {id, tenant_id, name,
 * instructions, ...}}`. The wrapper this type used to declare was never
 * exercised — no caller read an `org_team.get` result — which is how it
 * survived, and the public detail read is the caller that found it: against the
 * live hub the brief opened EMPTY, because `result.team` is `undefined` and the
 * query resolves as a success with no data.
 */
export type HubTeamResult = HubTeam;

/**
 * One row of the PUBLIC team listing (`GET /v1/teams`).
 *
 * The public route is the same document family as the org one, with the brief
 * omitted from the LIST form, which is what `HubTeam.instructions`' optionality
 * already said — this names the omission so a list row cannot be handed to a
 * surface that expects the brief to be there (the detail read is what carries
 * it). The wire row also carries `moderation`, which this app never renders and
 * therefore does not type.
 */
export type HubTeamRow = Omit<HubTeam, "instructions">;

/**
 * The public listing's envelope: the hub's paginated shape rather than the org
 * list's bare `{teams: []}` (that route serves a whole unpaginated roster).
 */
export type PaginatedTeamList = PaginatedResponse<HubTeamRow>;
