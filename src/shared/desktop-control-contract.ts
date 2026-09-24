/** Backend control DTOs. A native action requests presentation, never claims it ran. */
export type NativeDesktopAction = {
	kind: "native_action";
	destination: string;
	session_id: string;
	args: string;
	fields: {
		name: string;
		kind: "text" | "secret" | "choice" | "sessions" | "boolean";
		value: unknown;
		required: boolean;
		choices: string[];
	}[];
	data: Record<string, unknown>;
};
export type DesktopCommandMetadata = {
	name: string;
	description: string;
	aliases: string[];
	arguments: "none" | "optional" | "required";
	echo: boolean;
	consumes_prompt: boolean;
	/*
	 * THE ENDPOINT'S OWN ADMISSION RULE, and the reason the composer can stop
	 * approximating it. All three are ADDITIVE: a renderer that reads none of them
	 * keeps its own derivation (the booleans above plus the inline argument lists),
	 * and one that reads them answers a draft the way the endpoint will.
	 *
	 * `prefixes_text` is the free-text half as the SERVER computes it;
	 * `argument_shape` is the third source of "text after this word is the
	 * command's argument", which neither boolean expresses; `argument_words` is the
	 * vocabulary that argument's first token must come from (empty = any). They are
	 * the fields `command_argument_is_used` is written against, so reading them is
	 * integrating with released backend behaviour rather than a new contract.
	 */
	prefixes_text?: boolean;
	argument_shape?: "none" | "word" | "provider" | "subcommand" | "any";
	argument_words?: string[];
	destination: string;
	execution: "owner" | "native";
};
export type DesktopLoopState = {
	status:
		| "idle"
		| "running"
		| "judging"
		| "achieved"
		| "completed"
		| "cancelled"
		| "interrupted"
		| "failed";
	completed: number;
	goal?: string;
	iterations?: number | null;
	reason?: string;
};
export type DesktopModelCatalogue = {
	models: {
		provider: string;
		model_id: string;
		selector: string;
		label: string;
		/**
		 * The source listing's own human name (`Grok 4.7` for
		 * `openrouter/x-ai/grok-4.7`), carried past `label`'s honesty rule for a
		 * consumer that disambiguates the route some other way. It is a MATCH INPUT
		 * for the desktop picker's search box (`model-picker-match.ts`), not a
		 * displayed string: the operator types the human name, so a filter that
		 * never reads it is the defect where `grok 4.7` matched nothing. Optional
		 * because a catalogue served by an older backend simply omits it.
		 */
		listing_name?: string;
		connected: boolean;
		context_window: number;
		input_price: number;
		output_price: number;
		default_context_window: number | null;
		max_context_window: number | null;
		aggregated: boolean;
		[key: string]: unknown;
	}[];
	source: "initial" | "live";
	errors: Record<string, string>;
	/**
	 * Whether the credential store could be read at all. When false, every
	 * row's `connected` is the listing default ("show everything rather than
	 * claim the user owns no models"), NOT a statement about auth -- so it must
	 * not be turned into a badge or a grouping heading.
	 */
	credentials_known?: boolean;
};
export type DesktopMcpOperation = {
	id: string;
	name: string;
	action: "login" | "logout" | "reauth";
	status: "running" | "complete" | "cancelled" | "failed";
	created_at: number;
	message?: string;
	credential_removed: boolean;
};
export type DesktopMcpState = {
	servers: {
		name: string;
		source: string | null;
		owned_scope: "global" | "project" | null;
		status: string;
		transport?: "stdio" | "http";
		transport_oauth_supported?: boolean | null;
		/** MCP transport health does not establish downstream Workspace consent. */
		downstream_authorization?: "unknown";
		/**
		 * The credential field NAMES a server's config declares — a stdio child's `env`
		 * and an HTTP server's `headers` — and never a value.
		 *
		 * `public_server_config` (`mcp/desktop.py:92-116`) publishes the names of the
		 * secrets a config references; the values live in the owner credential store.
		 * They are declared here because the route sends them and the type omitted
		 * them — the asymmetry this file's own header warns about — and they are
		 * informational only: the run panel seeds its key-entry form from
		 * `secret_refs[].bindings`, NOT from these, because a map key names the
		 * destination a value is bound INTO (`Authorization`) while the resolver looks
		 * the reference up by ID, so a form seeded from the map keys saved an
		 * unresolved binding under a name the resolver never looked up (round 2, R2-2).
		 */
		environment_keys?: string[];
		header_keys?: string[];
		/** Actual encrypted-store IDs. Map keys above are informational only. */
		secret_refs?: {
			id: string;
			bindings: { field: "env" | "headers"; key: string }[];
		}[];
		tool_count?: number;
		setup?: { kind: "session_prompt"; text: string };
	}[];
	operations: DesktopMcpOperation[];
	cold?: boolean;
};
/**
 * One grant/probe operation on the SESSIONLESS catalog route.
 *
 * The session route's shape plus three optional fields the sign-in dialog reads
 * to stay truthful. They are optional because the backend PR that introduces
 * the catalog may ship without them, and the dialog's copy has a branch for
 * each absence rather than a guess: without `browser_opened` it never claims a
 * browser opened (UX walk N2), and without a failure `message` it says the
 * server gave no reason rather than printing a bare "Sign-in failed." (N4).
 */
export type McpCatalogOperation = Omit<
	DesktopMcpOperation,
	"action" | "message"
> & {
	action: "login" | "logout" | "reauth" | "test";
	/** `true` once the backend's browser launcher reported success. */
	browser_opened?: boolean | null;
	/** The URL the user can open by hand when the launcher could not. */
	authorization_url?: string | null;
	/** Sanitized failure reason, present only on a `failed` operation. */
	message?: string | null;
};

/**
 * One row of the sessionless MCP catalog (`GET /v1/desktop/mcp`).
 *
 * Hand-written from the backend decision doc's contract (architect, § 5) and
 * pinned by the backend's JSON fixture once that lands. Every derivation - the
 * status precedence, which actions are allowed, which scope a row applies in -
 * is the BACKEND's, so this renderer decides nothing a row does not already say:
 * a control is drawn only when `actions` names it, which is what removes the
 * dead-end "Sign in" on a local command with no secret references (U6).
 */
export type McpCatalogRow = {
	id: string;
	name: string;
	scope: "global" | "project";
	/** The project DIRECTORY when `scope === "project"`, else null. */
	project_path: string | null;
	source: {
		kind:
			| "local-operator"
			| "project-mcp-json"
			| "claude-code"
			| "cursor"
			| "vscode"
			| "codex";
		path: string;
		editable: boolean;
		owned_scope: "global" | "project" | null;
	};
	transport: "local_command" | "remote_url";
	endpoint: {
		command: string | null;
		url: string | null;
		endpoint_redacted: boolean;
	};
	status:
		| "connected"
		| "needs_sign_in"
		| "not_started"
		| "connecting"
		| "error";
	/** Sanitized, one line; set for `error` and for `needs_sign_in` when known. */
	status_reason: string | null;
	status_observed_at: number | null;
	status_basis: "live" | "probe" | "stored";
	auth: {
		kind: "none" | "oauth" | "api_key" | "unknown";
		signed_in: boolean | null;
		secret_refs: {
			id: string;
			state: "encrypted" | "missing" | "unavailable";
		}[];
	};
	tool_count: number | null;
	tool_count_basis: "live" | "probe" | "last_seen" | null;
	actions: (
		| "test"
		| "sign_in"
		| "set_key"
		| "reauth"
		| "sign_out"
		| "remove"
		| "connect"
		| "disconnect"
	)[];
};

/** The whole catalog document, as both the GET and a mutating POST answer it. */
export type McpCatalog = {
	cwd: string;
	/** False when the cwd's project file IS the global file (cwd = `~`). */
	project_scope_available: boolean;
	global_path: string;
	/** The project mcp.json FILE, null when there is no separate project file. */
	project_path: string | null;
	status_source: "config" | "live";
	session_id: string | null;
	servers: McpCatalogRow[];
	operations: McpCatalogOperation[];
	/** On a POST answer only: the operation that request started or named. */
	operation?: McpCatalogOperation | null;
};

/** `POST /v1/desktop/mcp/credentials`: what was saved, and the doc after it. */
export type McpCatalogCredentialsResult = {
	name: string;
	saved_ids: string[];
	failed_ids: string[];
	code: string | null;
	catalog: McpCatalog;
};
export type DesktopControlResult<T = Record<string, unknown>> = {
	data: T;
	replayed?: boolean;
};
