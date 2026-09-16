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
	/**
	 * Whether text typed AFTER this command's word is an argument the command
	 * owns on the desktop: `/model gpt-5` is the model command with its value,
	 * while `/mcp logout seems to be broken` is a message that merely opens with
	 * a command word.
	 *
	 * The union of the two things a composer can complete after the word — the
	 * free-text prompt (`consumes_prompt`) and a value chosen from a list. One
	 * fact, sent on every row so the renderer does not derive a second vocabulary
	 * of its own, and read by the messages endpoint's admission test for the same
	 * reason (`whole_draft_command` in `slash_commands.py`).
	 *
	 * OPTIONAL because a backend older than this field sends no such key: absence
	 * means "this row predates the field", not "false", and the renderer falls
	 * back to its own derivation (see `prefixingVocabulary` in
	 * `features/chat/components/slash-commands.tsx`).
	 */
	prefixes_text?: boolean;
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
export type DesktopControlResult<T = Record<string, unknown>> = {
	data: T;
	replayed?: boolean;
};
