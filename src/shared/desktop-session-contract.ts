// These are the canonical backend wire shapes, not legacy agent/job identities.
// Owner state revisions and HTTP semantic receipt cursors are independent. See
// docs/desktop-controls.md before implementing replay or notifications.
export type CanonicalSessionId = string;
/** Returned by session_catalogue version 2. The backend owns status precedence,
 * active/previous partition and order; clients must not infer them from read state. */
export type SessionCatalogueStatus = { code: string; label: string };
export type SessionBinding = { agent: string | null; team: string | null };
export type SessionCatalogueRow = {
	id: CanonicalSessionId;
	name: string;
	mtime: number;
	preview: string;
	live_state: string;
	pending: string | null;
	active: boolean;
	status: SessionCatalogueStatus;
	binding: SessionBinding;
	attention?: CompletionAttention;
};
export type CompletionAttention = {
	conversation_id: string;
	completion_token: string | null;
	anchor_id: string | null;
	kind: "complete" | "error" | "interrupted" | null;
	unseen: boolean;
	revision: [number, number];
	/** False for a live owner that has not negotiated completion receipts. */
	supported?: boolean;
};
export function mergeCompletionAttention(
	current: CompletionAttention | undefined,
	incoming: CompletionAttention | undefined,
	sessionId: string,
): CompletionAttention | undefined {
	if (
		!incoming ||
		incoming.conversation_id !== `session/${sessionId}` ||
		!Array.isArray(incoming.revision) ||
		incoming.revision.length !== 2 ||
		!incoming.revision.every((n) => Number.isSafeInteger(n) && n >= 0)
	)
		return current;
	// These clocks survive owner/server epochs; an old snapshot or delayed ACK
	// can never make a newer completion, or an already-observed read, disappear.
	if (
		current?.conversation_id === incoming.conversation_id &&
		(incoming.revision[0] < current.revision[0] ||
			incoming.revision[1] < current.revision[1])
	)
		return current;
	return incoming;
}

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
	/**
	 * The session's display name, for the notification banner only.
	 *
	 * ADDITIVE and OPTIONAL: absent on any backend older than the composed
	 * notification contract, and empty when the
	 * `session_names_in_notifications()` privacy flag is off. The backend owns
	 * that decision because it is the only side that can read the flag, so a
	 * surface rendering this must use the field as sent and must never resolve
	 * the name from a snapshot as a fallback — that would leak a name the user
	 * opted out of. Absent and empty are the same case here: no name.
	 */
	session_name?: string | null;
};
/**
 * One composed notification, as the backend rendered it.
 *
 * The strings are authoritative: the backend owns wording parity across the
 * TUI, the detached-runtime fallback and this app, and it is the only place
 * that can read the `display.notification_session_name` privacy flag. A UI
 * that composed locally would either re-read that config over HTTP on every
 * toast or ship a banner the user opted out of — and an old signed binary
 * would keep leaking the name forever, because the opt-out is a backend
 * setting it has never heard of.
 *
 * The structured fields travel BESIDE the strings so a future surface can
 * re-render (localisation, a narrower budget) without this app re-deriving a
 * rule it cannot see. Missing fields degrade honestly rather than throwing:
 * `contract` versions the payload SHAPE, additive fields do not bump it, and
 * an unknown future `kind` must render as text rather than crash a toast.
 *
 * See docs/design/descriptive-notifications.md 4.1 and 8.1 — these names are
 * the wire contract, not a local convenience.
 */
export type DesktopNotification = {
	/** Payload shape version. 1 today; additive fields do not bump it. */
	contract: number;
	kind: "complete" | "error" | "interrupted" | "ask" | "approval";
	title: string;
	/** Short state category ("Complete", "Needs attention"). */
	status: string;
	body: string;
	/** True when `body` is model-written text rather than a house constant. */
	body_is_snippet: boolean;
	/**
	 * True when `body` is the session's own recorded failure text rather than a
	 * house constant — a provider envelope such as
	 * `anthropic: 429 rate_limit_error - credit balance too low`.
	 *
	 * A separate flag from `body_is_snippet` because the two are never both
	 * true and a surface has to tell them apart: both carry untrusted,
	 * non-house text, but only the failure text is the reason the user has to
	 * act. The backend is the only side that can read it, so a surface that
	 * ignores it renders the state-naming status for a snippet and drops it for
	 * the one banner that demands action.
	 *
	 * OPTIONAL because it is additive: the backend added it after the first
	 * contract-1 payloads shipped and additive fields do not bump `contract`. A
	 * backend old enough to emit a failure summary without the flag degrades to
	 * the bare body, which is exactly what it rendered before the flag existed.
	 */
	body_is_failure?: boolean;
	/** False when the privacy flag is off or the session has no stored name. */
	title_is_session_name: boolean;
	/**
	 * Opaque; key the dedupe map on this and NOTHING else. In particular not on
	 * `session:epoch:seq`: `acquire()` mints a new bridge epoch and resets the
	 * sequence to 0, so the same completion re-delivered after a detached
	 * interval would get a different key and toast twice.
	 */
	dedupe_key: string;
	/** Durable completion identity; the argument to `sessions.notified`. */
	completion_token: string | null;
	session_name: string | null;
	/** `when_unfocused` for completions; `always` for a gate. */
	focus_policy: "when_unfocused" | "always";
};
export type CanonicalFrontendState = {
	attention?: CompletionAttention;
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
	loop?: import("./desktop-control-contract").DesktopLoopState | null;
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
/**
 * One block of a canonical message's `content`, on either wire shape.
 *
 * The two shapes differ because the two producers dump differently. A LIVE
 * event is `model_dump()`ed whole, so it carries `type` and the full base64. A
 * DURABLE row is dumped with `exclude_defaults=True`, and `type` IS the pydantic
 * default on both content models, so the discriminant is ABSENT from every row
 * on disk; on top of that the transcript externalises any image over 1 KiB of
 * base64 into `<config>/attachments/<digest>.bin` and replaces `data` with
 * `attachment`.
 *
 * So a durable image is `{attachment, mime_type}` or (under the floor)
 * `{data}`, a durable text block is `{text}`, and nothing on the durable path
 * can be identified by `type`. Modelled here rather than cast at the reducer so
 * the next reader of this wire does not have to rediscover it.
 */
export type CanonicalContentBlock = {
	/** Absent on durable rows: the encoder drops pydantic defaults. */
	type?: "text" | "image";
	text?: string;
	/** Inline base64. Live events always; durable rows only under 1 KiB. */
	data?: string;
	/** Attachment-store digest. Durable rows over 1 KiB. */
	attachment?: string;
	mime_type?: string;
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
	| Receipt<"attention", CompletionAttention>
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
	// Additive and replay-exempt: an older renderer falls through every branch
	// of the frame loop, advances its receipt cursor on `seq`, and paints
	// nothing. Deliberately NOT an `event`, which is a typed canonical
	// AgentEvent the transcript reducer paints, nor a `frontend.update`, which
	// is a field delta of persistent state — a notification is a one-shot edge.
	| Receipt<"notification", DesktopNotification>
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
	result:
		| import("./desktop-control-contract").NativeDesktopAction
		| {
				kind: string;
				text: string;
				style: string;
				data: Record<string, unknown>;
				admission?: Omit<DesktopAdmission, "command_id"> | null;
		  };
	replayed?: boolean;
};
