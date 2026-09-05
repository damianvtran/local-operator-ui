// These are the canonical backend wire shapes, not legacy agent/job identities.
// Owner state revisions and HTTP semantic receipt cursors are independent. See
// docs/desktop-controls.md before implementing replay or notifications.
export type CanonicalSessionId = string;
export type CanonicalModel = {
	provider: string;
	model_id: string;
	reasoning_effort?: string | null;
	context_window?: number | null;
	[key: string]: unknown;
};
export type PendingDesktopGate = {
	request_id: string;
	kind: "approval" | "ask";
	title: string;
	detail: string;
	options: Array<{
		label: string;
		description?: string;
		[key: string]: unknown;
	}>;
	secret: boolean;
	question_index: number;
	question_total: number;
};
export type CanonicalFrontendState = {
	state_version: number;
	session_id: CanonicalSessionId;
	epoch: string;
	sequence: number;
	cwd: string;
	conversation_title: string;
	conversation_title_user_set: boolean;
	conversation_title_forked: boolean;
	goal: string;
	active_agent: string;
	active_team: string;
	selected_model: CanonicalModel | null;
	effective_model: CanonicalModel | null;
	streaming: boolean;
	generation: number;
	pending_gate: PendingDesktopGate | null;
	history_cursor: string | null;
	live_events: Array<Record<string, unknown>>;
	queued_steering: Array<Record<string, unknown>>;
	jobs: Array<Record<string, unknown>>;
	todos: Array<Record<string, unknown>>;
	wakes: Array<Record<string, unknown>>;
	mcp_servers: Array<{
		name: string;
		status: string;
		error?: string | null;
		tool_count?: number | null;
	}>;
	model_catalogue: Array<Record<string, unknown>>;
	context_tokens: number | null;
	context_is_estimate: boolean | null;
	context_window: number | null;
	context_breakdown: Record<string, number> | null;
	cumulative_parent_cost: number | null;
	subagent_cost: number | null;
	cost_knowledge: "unknown" | "exact" | "partial" | "floor";
	// Canonical runtime fields are additive; preserve unknown fields rather
	// than throwing away newer owner's accounting/roster data on reconnect.
	[key: string]: unknown;
};
export type CanonicalFrontendSync = {
	state_version: number;
	epoch: string;
	sequence: number;
	snapshot: CanonicalFrontendState;
	live_cursor: string | null;
};
export type DesktopHistoryPage = {
	entries: Array<{
		id: string;
		ts: number;
		type: string;
		payload: Record<string, unknown>;
	}>;
	has_more: boolean;
	cursor_missing: boolean;
};
export type DesktopSnapshot = {
	frontend: CanonicalFrontendSync;
	history: DesktopHistoryPage;
	cold: boolean;
};
type Receipt<T extends string, P> = {
	session_id: CanonicalSessionId;
	epoch: string;
	seq: number;
	type: T;
	payload: P;
};
export type DesktopSessionFrame =
	| Receipt<
			"open",
			{
				subscription_id: string;
				gap: boolean;
				watch_ttl_seconds: number;
			}
	  >
	| Receipt<"snapshot", DesktopSnapshot>
	| Receipt<
			"frontend.update",
			{
				epoch: string;
				sequence: number;
				changes: Partial<CanonicalFrontendState>;
				job_trajectory_appends: Record<string, never>;
				job_trajectory_replacements: never[];
			}
	  >
	| Receipt<"event", { type: string; [key: string]: unknown }>
	| { session_id: CanonicalSessionId; type: "heartbeat" | "gap" };
export type DesktopAdmission = {
	status: "admitted";
	command_id: string;
	duplicate: boolean;
	detail: string;
	replayed?: boolean;
};
export type DesktopCommandReceipt = {
	command: string;
	result: {
		kind: string;
		text: string;
		style: string;
		data: Record<string, unknown>;
		admission?: Omit<DesktopAdmission, "command_id"> | null;
	};
	replayed?: boolean;
};
