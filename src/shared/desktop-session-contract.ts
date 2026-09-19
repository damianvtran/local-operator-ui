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
	/**
	 * Whether this conversation is pinned, as the BACKEND's pin store holds it.
	 *
	 * ALWAYS PRESENT, both values, on EVERY row - the one field on this shape that
	 * may not be omitted. `replaceSessionRows` -> `mergeRow` in
	 * `canonical-sessions-store.ts` is `{...current, ...incoming}` under the rule
	 * "an absent key is not a claim", so a backend that omitted `pinned` on an
	 * unpinned row would leave a stale optimistic `true` immortal: the row would
	 * keep its glyph and its section membership after a successful unpin
	 * somewhere else. Sending both values is what makes a list read settle the
	 * field.
	 *
	 * The store behind it is shared with the terminal: it is the TUI's
	 * `sidebar-pins.json` in the backend's own config root
	 * (`local_operator/tui/sidebar_pins.py`), which is why `pinned` is the
	 * backend's answer rather than this client's - a pin made with `f10` in a
	 * terminal and a pin made here are the same pin.
	 */
	pinned: boolean;
	status: SessionCatalogueStatus;
	binding: SessionBinding;
	attention?: CompletionAttention;
	/**
	 * The feed's stamp for `status`, when the backend served this row knows it.
	 *
	 * `status_revision` counts what the feed process published for THIS session
	 * and `status_epoch` names that process, so a `session_status` frame and this
	 * list row can be ordered against each other instead of the newer of the two
	 * being whichever arrived last. Both are omitted together on a backend that
	 * has no status channel (or has published nothing for this session yet), and
	 * absent means exactly that: no stamp, so the row cannot win an ordering
	 * argument it has no evidence for.
	 */
	status_revision?: number;
	status_epoch?: string;
};
/**
 * One hit from `sessions.search`, returned by the `session_search` capability
 * version 1.
 *
 * A hit rather than a `SessionCatalogueRow`: it carries the two facts only the
 * search can know. `rank` is the relevance tier the row matched in (0 name,
 * 1 id, 2 body, 3 soft — see the backend's `session.session_search`), and
 * `body_match` says the CONVERSATION is why the row surfaced, so the sidebar
 * can mark it instead of showing a highlighted row with no visible reason for
 * being there. `name`/`mtime` ride along so a hit for a session this client has
 * never listed can still be rendered and opened — which is the difference
 * between a search over the whole store and one silently capped at the
 * client's page.
 *
 * `forked` mirrors the catalogue's own field for clients that draw a fork mark.
 * The sidebar does NOT consume it — it renders the marker from `body_match` and
 * the row's binding — so it is carried because the wire is the backend's
 * (`SessionSearchRow` in `server/models/desktop_sessions.py`), and a client that
 * wanted it should not have to ask for a second route. The earlier version of
 * this comment listed it among the fields "we need to render a hit", which was
 * a claim the renderer contradicted (review round 2, R15).
 */
export type SessionSearchHit = {
	id: CanonicalSessionId;
	name: string;
	mtime: number;
	forked: boolean;
	rank: number;
	body_match: boolean;
	/**
	 * The row's pin STATE, and OPTIONAL on purpose - which is the exception on this
	 * shape rather than an oversight, because here the absence is the information.
	 *
	 * On a catalogue row `pinned` is always present (both values) so a list read
	 * settles the client's optimistic flag; a search hit is a different question -
	 * it is asked of the WHOLE store, so a pinned conversation the client's capped
	 * page cannot hold arrives as a hit with no local row to compare against. A
	 * backend that describes the pin state answers it here, and the synthesized row
	 * carries it, so the conversation lands in `Pinned chats` with a filled glyph
	 * (QA round 1, Q1). A backend that does NOT describe it leaves the field absent,
	 * and the row then offers no pin control at all: the row is rebuilt from the wire
	 * hit on every render, so a control there could not repair it, and an affordance
	 * that silently does nothing is worse than none (review round 1, m1).
	 */
	pinned?: boolean;
};
/**
 * The search answer. `query` is ECHOED rather than assumed: keystrokes are
 * debounced and their requests can complete out of order, so the only thing
 * that says which question a set of hits answers is the response itself.
 */
export type SessionSearchResult = {
	sessions: SessionSearchHit[];
	query: string;
	limit: number;
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

/**
 * The verdict of a BULK acknowledgement (`attention.seen`), one bucket per
 * outcome.
 *
 * Three buckets rather than a count, because a bulk ack is not a promise that
 * everything asked for was read: the backend decides per item inside one
 * transaction, and a caller that only knew "cleared N" would have to claim the
 * rest cleared too (DESIGN.md § 2's no-silent-partial-success contract). So:
 *
 * - `read` — the receipt moved, carrying the conversation's own post-write state
 *   (the same shape the catalogue publishes as a row's `attention`);
 * - `superseded` — a real completion of that conversation, no longer the current
 *   one while the conversation is still unseen. Nothing was written, and the
 *   caller must NOT clear that row: the token it holds is stale and the state
 *   that supersedes it arrives by the feed;
 * - `unknown` — no such completion for that conversation (or no store row at
 *   all). Nothing was written.
 *
 * `superseded` and `unknown` carry BARE session ids rather than states, because
 * neither produced one: a refusal has no state to return, and inventing a
 * `CompletionAttention` for a row that was not written would be a second source
 * of truth about a mark that is still unread.
 */
export type CompletionAttentionAckReceipt = {
	read: CompletionAttention[];
	superseded: string[];
	unknown: string[];
};

/**
 * The backend's machine code for "your token is no longer the current one".
 *
 * The string is the BACKEND's, and the backend is its source of truth:
 * `SUPERSEDED_TOKEN_CODE` in `local_operator/session/attention.py`, documented
 * for clients in `docs/DESKTOP_API.md`. This copy exists because a renderer
 * cannot import Python, and a copy cannot be bound automatically across two
 * repositories -- each side's tests pin its own literal, so a change on one side
 * lands green on the other. What makes that a maintenance step rather than a
 * silent break is that this literal is asserted against the documented wire value
 * in `scripts/completion-view-ack.test.mjs`: a change here fails a test that
 * names the backend's value.
 *
 * Nothing in the renderer FORKS on this code, and that is deliberate rather than
 * an omission: `use-completion-view.ts` sends every rejection -- this 409
 * included -- to the one shared retry ladder, so a superseded token costs its
 * attempt like any other failure and the re-arm comes from the projection naming
 * a NEW token, not from a special case here. It is kept because it is part of
 * the canonical wire shape documented for clients in `docs/DESKTOP_API.md`, and
 * a client that does need to tell the refusal apart must not have to spell the
 * string itself.
 */
export const SUPERSEDED_COMPLETION_TOKEN_CODE = "superseded_completion_token";

/**
 * Whether an acknowledgement may be taken as marking this conversation READ.
 *
 * `sessions.seen` answers with the resulting attention state, and `unseen` is the
 * whole verdict: a 2xx is NOT a read. A backend that had already moved past the
 * token answered with a 200 whose body still said `unseen: true`, and a client
 * that latched on the resolved call stopped retrying -- leaving the completion's
 * mark on forever, over a result the operator was looking at (the reported
 * defect). Identity is part of the test rather than assumed: only a state about
 * THIS conversation can settle this attempt.
 */
export function receiptSettled(
	state: unknown,
	sessionId: string,
	token: string,
): boolean {
	if (!state || typeof state !== "object") return false;
	const attention = state as Partial<CompletionAttention>;
	return (
		attention.unseen === false &&
		attention.conversation_id === `session/${sessionId}` &&
		attention.completion_token === token
	);
}

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
	// `supported` is OPTIONAL and its ABSENCE is not a value.
	//
	// Two producers reach this merge with different attention payloads. A
	// session stream's attention comes from the live owner and carries
	// `supported` (false = "this owner has not negotiated completion receipts");
	// the catalogue's comes from `state_many`, which builds the state from the
	// durable store alone and therefore never sets it. Replacing wholesale —
	// which is what this merge is for, so a newer revision always wins — then
	// DELETED the flag, and `useCompletionView` requires
	// `attention.supported === true` before it will acknowledge a read. A
	// catalogue refetch arriving after a snapshot silently disabled the read
	// receipt for the conversation on screen, and nothing repainted the flag
	// until the next snapshot: a completion stayed unread no matter how long
	// the user looked at it.
	//
	// So an omitted flag INHERITS the last one we were actually told, and a
	// present one is the producer's own answer and always wins — including an
	// explicit `false`, which is the whole point of sending it.
	if (incoming.supported === undefined && current?.supported !== undefined) {
		return { ...incoming, supported: current.supported };
	}
	return incoming;
}

/**
 * One `ModelSpec` as the owner dumps it (`local_operator/harness/types.py`
 * `ModelSpec`, serialised at `local_operator/session/frontend_state.py`'s
 * `selected_model`/`effective_model`).
 *
 * Every field below `model_id` is OPTIONAL even though the Python model gives
 * most of them a default, because the wire is the contract and an older owner
 * predates them: `display_name`, `reasoning_efforts` and
 * `reasoning_default_effort` were added to the spec after this app shipped, so
 * a session running against an older backend delivers a dump without them. A
 * required field here would not make them appear; it would only make the
 * renderer read `undefined` off a value TypeScript promised was a string, and
 * the session strip's whole design is that a missing field degrades to an
 * honest unknown rather than throwing.
 */
export type CanonicalModel = {
	provider: string;
	model_id: string;
	/**
	 * The model's human name as metadata resolution found it ("Claude Opus 5").
	 * A RAW name, not a display decision, and `""` means resolution had none —
	 * which is why every reader falls back to `model_id` rather than treating
	 * this as authoritative.
	 */
	display_name?: string | null;
	/** The level selected right now. Null/absent means nothing is chosen. */
	reasoning_effort?: string | null;
	/**
	 * The ladder this model accepts, ASCENDING. EMPTY is the non-reasoning
	 * model, and it is what lets `/effort` say so instead of accepting a level
	 * the request would silently drop.
	 */
	reasoning_efforts?: string[] | null;
	/** What this model runs at when nothing is chosen; what `/effort auto` restores. */
	reasoning_default_effort?: string | null;
	/** Whether the model reasons at all, with or without a ladder. */
	reasoning?: boolean | null;
	/** The active budget. `max_context_window` retains provider provenance. */
	context_window?: number | null;
	max_context_window?: number | null;
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
	 * Index of the option the model recommends, into `options` AS CARRIED.
	 *
	 * ADDITIVE and OPTIONAL: `PendingRequest` has sent it since the ask-picker
	 * contract landed, but a backend older than that omits the key entirely, so
	 * this must be read as "a number or nothing" rather than defaulted to 0 —
	 * defaulting would badge the first option on every ask a legacy backend
	 * sends, which is a recommendation the model never made.
	 *
	 * `AskQuestion._shape` has ALREADY rotated the recommended option to index
	 * 0 and set this to 0 to match, so it indexes the order as transmitted and
	 * not the model's authored order. A consumer that re-sorts `options` must
	 * therefore drop or recompute this value; this app renders the wire order,
	 * so it can use it directly.
	 */
	recommended?: number | null;
	/**
	 * The `AskQuestion.persist` intent for a `secret: true` ask — whether the
	 * answer is meant to be saved to the credential store rather than used
	 * once.
	 *
	 * ADDITIVE and OPTIONAL for the same version-skew reason as `recommended`.
	 * Carried here so the type matches the wire; the secret answer path is the
	 * composer's masked input, which does not branch on this yet.
	 */
	persist?: boolean;
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
/**
 * The notification kinds this app can deliver over the MACHINE-WIDE FEED.
 *
 * Completions only, and it is narrower than `DesktopNotification["kind"]` on
 * purpose: the feed publishes a completed or failed TURN, while a gate
 * (`ask`/`approval`) travels the per-session bridge where it belongs to a
 * conversation the user is already in. This is what the presence claim
 * advertises — the backend's `delivers(kind)` reads it, and a claim that
 * advertises nothing makes every completion someone else's to raise.
 */
export const FEED_NOTIFIABLE_KINDS = ["complete", "error"] as const;

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
	/**
	 * How many completions this frame stands for, when it is a BURST DIGEST.
	 *
	 * The backend caps per-tick banners and publishes one frame for the
	 * remainder of a busy tick rather than one banner per session. Additive and
	 * optional like `body_is_failure`: absent on a single conversation's frame,
	 * and absent from a backend that predates the cap. A surface that ignored it
	 * would still render the frame, but would route its click to whichever
	 * overflow member `session_id` happens to name.
	 */
	burst_count?: number;
	/**
	 * The conversations a digest stands for, in the backend's own order.
	 *
	 * Present so a surface can say WHO finished (a count in a banner is only
	 * half of "what happened") without a second request. Never trusted as a
	 * routing target: a digest's click belongs on the catalogue, which is where
	 * all of them are listed.
	 */
	session_ids?: string[];
	/**
	 * The members a burst digest stands for, as claimable completions.
	 *
	 * THE CROSS-SURFACE CONTRACT (review round 2, R2-5; backend #1116's R8). A
	 * digest has no `completion_token` of its own — no single completion owns it —
	 * so a surface's claim step skips it, and `session_ids` alone is not enough to
	 * claim with: the backend's arbitration is per COMPLETION, not per session.
	 * Without these pairs nothing ever marked a digest's members delivered, and an
	 * individual frame for one of them could raise a second banner for a
	 * completion this digest had already announced.
	 *
	 * The backend does NOT preclaim them: a member is the receiving surface's to
	 * win, at the moment it is about to deliver, through the same
	 * `sessions.notified` call a single frame uses. Additive and optional like
	 * `burst_count`, so a backend that predates the fix degrades to the old
	 * behaviour (the digest still renders, its members are simply not arbitrated)
	 * rather than to an error.
	 */
	member_tokens?: { session_id: string; completion_token: string }[];
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
/**
 * One ARMED wake schedule, as the canonical frontend publishes it.
 *
 * Declared rather than reached through the index signature for the reason
 * `last_usage` below states for itself: it is the field that decides whether a
 * reading renders at all. A wake chip is gated on there being at least one of
 * these, and the pane's Wakes section draws one row per entry — so an `as never`
 * cast at the call site would let a rename on the wire (`WakeState`,
 * `local_operator/session/frontend_state.py`) silently empty both surfaces with
 * nothing to catch it.
 *
 * `next_due_at` is epoch MILLISECONDS, and the unit is spelled out because it is
 * the trap: every other clock on this wire (`start_time`, `settled_at`) is epoch
 * SECONDS and the run model divides those by 1000 before comparing. A wake's due
 * instant is published in milliseconds and is used as milliseconds.
 *
 * `every_ms` is null for a one-shot schedule and `remaining` is null when the
 * recurrence is unbounded; both are optional because a schedule created before
 * either field existed simply does not carry it.
 *
 * `limit` and `fired_count` are the SCHEDULER's own fields riding through
 * `WakeState`'s `extra="allow"` (`WakeState.model_validate(schedule.model_dump())`,
 * `frontend_state.py::_wake_state` and `attached.py::_cold_wakes` — both paths
 * publish the schedule dump, so both carry them). They are declared here because
 * the renderer READS them: `remaining` is declared on `WakeState` and is never
 * populated by either path (measured against a live backend, a schedule created
 * with `--limit 3` publishes `limit: 3, fired_count: 0, remaining: null`), so the
 * cadence's bounded clause takes the backend's own `limit - fired_count` when
 * `remaining` is absent. Declaring them is what keeps that read checkable rather
 * than a field reached for through an index signature.
 */
export type CanonicalWakeState = {
	id: string;
	message: string;
	/** The next fire instant, epoch MILLISECONDS. */
	next_due_at: number;
	created_at?: number;
	/** The recurrence interval in milliseconds, or null for a single shot. */
	every_ms?: number | null;
	/** Deliveries left, or null when the schedule is not limit-bounded. */
	remaining?: number | null;
	/** Deliveries the schedule was created to make, or null when unbounded. */
	limit?: number | null;
	/** Deliveries already made. */
	fired_count?: number;
};

/**
 * The epoch MILLISECONDS a wire stamp states, or `null` when it states none.
 *
 * ONE READER FOR ONE UNIT. The wire states two instants in epoch SECONDS — a
 * tool `_start` frame's `started_at_epoch` and the frontend state's
 * `activity_phase_started_at` — and they reach the UI through two modules that
 * are otherwise unrelated (the transcript reducer and the working-line model).
 * A `* 1000` in each is how the two would eventually disagree about the unit, so
 * the conversion lives here, beside the field declarations that say the unit in
 * the first place.
 *
 * `null` is a real answer rather than a missing value to be defaulted, for the
 * reason the reducer's own reader gives: `> 0` refuses a zeroed field (a producer
 * that has not stamped one, not an instant in 1970), and a non-numeric or
 * non-finite value states nothing. A caller with no stated instant must fall back
 * to its own clock rather than to epoch zero.
 */
export function epochMsFromSeconds(value: unknown): number | null {
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0
		? Math.round(seconds * 1000)
		: null;
}

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
	/**
	 * The session's ARMED wake schedules. Absent or empty means no wakes, which
	 * is the ordinary state: the composer's wake chip and the run pane's Wakes
	 * section both render as ABSENCE at zero, so this list being empty is not a
	 * state either surface draws.
	 */
	wakes: CanonicalWakeState[];
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
	/**
	 * Per-child spend keyed by job id — the COMPATIBILITY ledger, used only
	 * when the owner reports no `subagent_cost_knowledge`. Mirrors
	 * `FrontendSessionState.child_costs`; `session-cost.ts` is the only place
	 * in this app that reads it, and it explains why the two ledgers are never
	 * summed together.
	 */
	child_costs?: Record<string, number> | null;
	subagent_cost: number | null;
	/**
	 * How well the OWNER ledger's `subagent_cost` is known. `null`/absent means
	 * the owner ledger is not in play at all, which is the switch that selects
	 * `child_costs` instead — see `FrontendSessionState.cumulative_cost`.
	 */
	subagent_cost_knowledge?: "unknown" | "exact" | "partial" | "floor" | null;
	cost_knowledge: "unknown" | "exact" | "partial" | "floor";
	/**
	 * The most recent turn's token usage, when the owner reported one.
	 *
	 * Read by `session-cost.ts` to tell "this session has spent nothing" from
	 * "this session has run and nobody could price it" - the difference between
	 * showing no cost segment and showing the honest unknown-price spelling. It
	 * is declared here rather than reached through the index signature because
	 * it is the field that decides whether a reading renders at all, and an
	 * `as never` cast at the call site would let a rename on the wire pass
	 * type-checking silently (review round 1, R4).
	 */
	last_usage?: {
		input_tokens?: number | null;
		output_tokens?: number | null;
	} | null;
	/**
	 * Seconds the agent has spent WORKING in this conversation, banked.
	 *
	 * Mirrors `FrontendSessionState.active_duration_s`: it accrues between
	 * `agent_start` and `agent_end`, so it is neither wall-clock time since the
	 * session opened nor time the user spent reading. Declared rather than
	 * reached through the index signature for the same reason as `last_usage`
	 * above — `active_duration_s === 0` is exactly what decides whether the
	 * duration reading renders at all, and an `as never` cast at the call site
	 * would let a rename on the wire pass type-checking silently.
	 */
	active_duration_s?: number | null;
	/**
	 * When the turn currently in flight began, as an epoch in SECONDS, or
	 * `null` between turns.
	 *
	 * Mirrors `FrontendSessionState.activity_started_at`. The pair is what lets
	 * a reading tick without the stream repainting at 1 Hz: `active_duration_s`
	 * is the banked truth and this is the open edge to add to it. Null means
	 * there is no edge, so the banked figure is the whole answer and no timer
	 * should run.
	 */
	activity_started_at?: number | null;
	/**
	 * The phase the WORKING LINE is in, as the producer folded it from its own
	 * events, or `""` when there is no phase (between turns).
	 *
	 * Mirrors `FrontendSessionState.activity_phase`, which is declared `str` with
	 * an empty-string default and is only ever written from the fold's own phase
	 * names or from `""` at a turn end — so `null` is NOT part of this wire's
	 * shape and is not accepted here. (It was, briefly, while this field was being
	 * declared: a nullable type invites a caller to test for a value the producer
	 * cannot send, and the reader would then carry a branch nothing can reach.)
	 *
	 * Declared rather than reached through the index signature for the reason
	 * `last_usage` gives above: the reader matches this string against the phase
	 * it derived itself and uses the answer to decide whether a clock may run at
	 * all, so a rename on the wire has to be a type error here rather than a
	 * silently never-matching comparison that blanks every resumed clock.
	 */
	activity_phase?: string;
	/**
	 * When `activity_phase` began, as an epoch in SECONDS, or `null`.
	 *
	 * Mirrors `FrontendSessionState.activity_phase_started_at`. This is the
	 * whole of the resumed working line's clock: the phase's zero is the
	 * producer's, so a viewer that attaches mid-turn resumes the true age
	 * instead of counting from its own arrival. Seconds, not milliseconds — the
	 * conversion happens once, in `epochMsFromSeconds` above.
	 */
	activity_phase_started_at?: number | null;
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
/**
 * One page of a SUBAGENT's transcript (`docs/run-sidebar.md` § 10.1).
 *
 * The parent's envelope plus one field, and the field is derived rather than
 * carried: the two ABSENCES are different facts and only the filesystem can tell
 * them apart. `pending` means the child's directory exists but
 * `transcript.jsonl` does not yet — the child has not reached its first append —
 * and it is re-probed; `gone` means the directory itself is missing, so the
 * absence is final. `ready` with an empty `entries` is a legal state of its own.
 *
 * A reader that conflated them would either say "gone" about a child that has
 * not written yet, or promise a transcript that will never appear.
 */
export type DesktopChildTranscriptPage = DesktopHistoryPage & {
	state: "ready" | "pending" | "gone";
};
/**
 * WHY a session's canonical state came back cold, as the wire states it.
 *
 * A TOKEN, not a sentence, and deliberately so: the copy belongs to the surface
 * (the same discipline the error ladder's `code` follows), while the token is the
 * contract. The three cases are the ones a read can actually establish — no pid
 * holds the session's transcript lease (`no-runtime`), one does and did not
 * deliver canonical state (`owner-silent`), or the record is finishing work in
 * flight first (`owner-leaving`) — and they ask different things of a reader, so
 * one sentence for all three would be the conflation these tokens exist to
 * remove. The backend's own model (`SnapshotPayload` in
 * `server/models/desktop_sessions.py`) is the producer.
 */
export type DesktopColdReason = "no-runtime" | "owner-silent" | "owner-leaving";

export type DesktopSnapshot = {
	frontend: CanonicalFrontendSync;
	history: DesktopHistoryPage;
	cold: boolean;
	/**
	 * The reason, when the read came back cold; `null`/absent on a live one.
	 *
	 * ADDITIVE, and optional rather than required for the reason the backend
	 * defaults it: a host that does not track the distinction (an in-process one, a
	 * test's stand-in) still validates, and the documented fallback for a reader
	 * that meets neither field is "cold, and no reason given". The renderer's use
	 * of it is the WAIT STATE — see `transcript-placeholder.tsx` for why the honest
	 * answer to a slow open is this token rather than a spinner.
	 */
	cold_reason?: DesktopColdReason | null;
	/**
	 * An authenticated dial is retained and its canonical state has not arrived.
	 *
	 * Distinct from `cold`: the read answered from disk meanwhile, and the sync
	 * that lands later publishes the rollover the renderer already handles for an
	 * epoch change.
	 */
	attaching?: boolean;
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
	/**
	 * The desktop-only REPLACEMENT of the painted projection (remediation contract
	 * § C), published synchronously by the bridge when an ACCEPTED move installs
	 * local facade state.
	 *
	 * Deliberately not an `event` (a typed canonical AgentEvent the transcript
	 * reducer paints) and deliberately not a `frontend.update`. A move changes the
	 * facade's cwd WITHOUT touching the owner's clock, so a delta would carry the
	 * owner's UNCHANGED epoch and sequence - and the shipped reducer rejects a
	 * same-sequence update as stale, which is the measured defect this frame exists
	 * to fix: a mounted viewer stayed on the old directory while the receipt said
	 * the move had landed (backend review R4).
	 *
	 * It is ordered by the BRIDGE's own outer `seq` instead, and it carries no
	 * `history` field: its job is replacing the frontend PAINT projection, not
	 * resetting the conversation, so it neither creates a history gap nor
	 * invalidates a history cursor. The `frontend` field is the whole bounded
	 * `FrontendSync` (not just its `snapshot`) so the consumer also gets the owner's
	 * true epoch and sequence, and it keeps the same shape as the bootstrap
	 * snapshot's field.
	 *
	 * Additive and replay-exempt for the same reason `notification` is: an older
	 * renderer negotiates no `frontend_replace` (see `acceptFrontendReplace`), the
	 * backend refuses to move while such a viewer is mounted, and a frame that
	 * somehow arrived anyway falls through every branch of an older frame loop and
	 * paints nothing.
	 */
	| Receipt<
			"frontend.replace",
			{
				frontend: CanonicalFrontendSync;
				cold: boolean;
				/**
				 * The cold pair, on the frame that also CLEARS it: this is the rollover the
				 * bridge publishes when an owner comes back (`_publish_frontend_replace`
				 * spreads the same `_cold_fields` the snapshot carries), so a renderer
				 * holding a reason from the opening read learns here that the wait it
				 * described is over. Additive for an older renderer, which ignores both.
				 */
				cold_reason?: DesktopColdReason | null;
				attaching?: boolean;
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

/**
 * The machine-wide feed's frame family (`GET /v1/desktop/events`).
 *
 * It is a SECOND envelope rather than a reuse of `DesktopSessionFrame`, because
 * the two streams answer different questions and the differences are the ones a
 * careless alias would hide:
 *
 * - A feed frame is not scoped to one session. `session_id` is present only on
 *   the types that concern one conversation (`attention`, `notification`), and
 *   absent on `catalogue`, `heartbeat` and `gap` — so the session frame's
 *   `Receipt` (which requires it) cannot describe them.
 * - `open` carries no `gap` flag: there is no replay to gap on. A feed
 *   subscription takes a BASELINE and announces nothing that predates it,
 *   because the notification edge's whole value is timeliness. The feed's
 *   `gap` is therefore an overflow signal on a live connection, not a hole in
 *   a replay.
 * - `attention.payload` is the same `CompletionAttention` the session stream
 *   carries, and `notification.payload` is the SAME payload the bridge composes
 *   — verbatim, including `dedupe_key`. That is what lets main's notifier
 *   observe either source with one code path and one local dedupe map, so a
 *   completion that reaches the app twice produces one banner.
 *
 * `seq` is a receipt cursor exactly as the session stream's is: monotonic per
 * connection, and only meaningful for dedupe — never for deciding what is
 * newer paint state.
 */
export type DesktopFeedFrame =
	| {
			epoch: string;
			seq: number;
			type: "open";
			payload: {
				subscription_id: string;
				/** The backend's own beat cadence, which sizes the silence watchdog. */
				heartbeat_seconds: number;
				/** Presence lease the heartbeat must beat inside. */
				lease_seconds: number;
				watch_ttl_seconds: number;
				catalogue_revision: number;
			};
	  }
	| {
			epoch: string;
			seq: number;
			type: "attention";
			session_id: CanonicalSessionId;
			payload: CompletionAttention;
	  }
	| {
			epoch: string;
			seq: number;
			type: "notification";
			session_id: CanonicalSessionId;
			payload: DesktopNotification;
	  }
	/**
	 * The backend's DERIVED status for one session, as it changes.
	 *
	 * The sidebar's row status is a backend-derived value with a precedence that
	 * lives in exactly one place over there, and the list was the only thing that
	 * could deliver it — so an answered gate or a completed turn could sit unseen
	 * for up to the safety poll. This frame is that same value pushed on the
	 * event, and `payload` deliberately carries the derived pair rather than its
	 * inputs (`live_state`, `unseen`, ...): the contract's own rule is that the
	 * backend owns status precedence and clients must not infer it, so shipping
	 * inputs would invite a second derivation in TypeScript while shipping the
	 * pair makes this a second CALLER of the one implementation.
	 *
	 * `revision` is monotone per session WITHIN the emitting `epoch`, which is
	 * what `status_revision`/`status_epoch` on a catalogue row are compared
	 * against; an epoch the client has not seen before resets those guards,
	 * because the counters they hold belonged to a process that is gone.
	 *
	 * A frame is a LEVEL, not a notification: it is idempotent, it never enters
	 * `DesktopNotifier` (main routes only `notification` frames there), and an
	 * older renderer ignores the type outright.
	 */
	| {
			epoch: string;
			seq: number;
			type: "session_status";
			session_id: CanonicalSessionId;
			payload: { code: string; label: string; revision: number };
	  }
	| {
			epoch: string;
			seq: number;
			type: "catalogue";
			payload: { revision: number };
	  }
	| { epoch: string; seq: number; type: "heartbeat"; payload: { ts: number } }
	| {
			epoch: string;
			seq: number;
			type: "gap";
			payload: { reason: string; subscription_id: string };
	  };

/** The outer bridge cursor a desktop frame carries, as the client records it. */
export type DesktopStreamCursor = { epoch: string; seq: number };

/**
 * Whether a live `frontend.replace` may be applied over the painted projection.
 *
 * Four questions, and every one of them is a way a replacement must NOT land.
 * Exported as a pure predicate rather than left inline in `use-canonical-session`
 * because a predicate that exists only inside a React effect is a predicate no
 * test can falsify, and this one is the whole acceptance rule of a contract seam
 * (remediation contract § C, "Consumer").
 *
 *  - **Identity, on both halves of the wire.** The receipt names the session and
 *    so does the `FrontendSync.snapshot` inside it. A replacement is a full
 *    projection, so a payload belonging to another session would replace this
 *    session's entire paint - the one mutation a mismatched frame must never make.
 *  - **The cursor BEFORE this frame.** `priorCursor` is the outer bridge cursor
 *    as it stood before the generic receipt branch advanced it. Comparing against
 *    the value this very frame just wrote would reject every replacement, which is
 *    why the caller reads it first; comparing it is what makes the frame ordered
 *    against the deltas around it, since both ride one monotonically increasing
 *    bridge cursor.
 *  - **The outer epoch matches the active stream.** An epoch the current
 *    subscription never served is a frame from a stream that has been replaced,
 *    and its sequence says nothing about what this viewer has seen.
 *  - **Strictly newer.** Equal or lower is a duplicate or an out-of-order
 *    replay, and applying one would roll the paint back to an older projection.
 *
 * A replacement that arrives during the pre-snapshot replay needs no rule here:
 * the call site only consults this predicate once the bootstrap snapshot has been
 * applied, so a replayed frame stays subordinate to that snapshot, exactly as
 * every other replayed frame does.
 */
export function acceptFrontendReplace(
	priorCursor: DesktopStreamCursor | null | undefined,
	sessionId: string,
	frame: Extract<DesktopSessionFrame, { type: "frontend.replace" }>,
): boolean {
	if (frame.session_id !== sessionId) return false;
	if (frame.payload.frontend.snapshot.session_id !== sessionId) return false;
	if (!priorCursor) return false;
	return priorCursor.epoch === frame.epoch && frame.seq > priorCursor.seq;
}

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

/**
 * What a working-directory change did, and where it left the session.
 *
 * Mirrors the backend's `MoveReceipt` (`POST
 * /v1/desktop/sessions/{id}/working-directory`). Both `cwd` and `label` are
 * carried because they are different facts: `cwd` is the VALUE to compare
 * against what the canonical `frontend` stream later reports (the chip holds
 * its optimistic value until the two agree - see `useSessionMove`), and `label`
 * is the backend's own home-aware spelling of it, printed rather than
 * reformatted here because only the process that owns the session knows how to
 * spell `~`. A client-side `~/` would print the CLIENT's home for a remote
 * backend, which is a different directory with the same name.
 *
 * `outcome` is the viewer's own vocabulary plus one route-level value:
 * `cold` and `rebound` are `set_working_directory`'s (`cold` = the field moved
 * and nothing was running, `rebound` = the runtime was retired and a successor
 * is owed), and `unchanged` is the already-there no-op.
 *
 * `will_wait` is a pre-call HINT (the TUI's own `move_will_wait`, sampled before
 * the move) and deliberately NOT load-bearing here: a caller learns it after
 * the move has already happened, so it cannot narrate anything with it. It is on
 * the wire so a receipt reader can tell "the session restarted" from "the field
 * moved under an engage that then failed".
 */
export type DesktopMoveReceipt = {
	cwd: string;
	label: string;
	outcome: "cold" | "rebound" | "unchanged";
	will_wait: boolean;
};

/**
 * What an interrupt did, and what it left behind.
 *
 * Mirrors the backend's `InterruptReceipt` (`POST
 * /v1/desktop/sessions/{id}/interrupt`). The route exists because the composer's
 * Stop control used to post `{command: "stop"}` to `sessions.command`, which is
 * a catalogue entry answered with a presentation form - HTTP 200, a
 * `native_action` asking the client to open the session-stop picker, and a turn
 * still streaming.
 *
 * Three facts are deliberately separate rather than folded into one sentence:
 *
 * - `status` is the route's own vocabulary and `"idle"` is a SUCCESS, not a
 *   failure. An interrupt on a session with no turn running - or on a COLD
 *   session, which is never engaged to answer this - changed nothing and says
 *   so. The UI renders nothing for it: telling a user their own press worked is
 *   the notification the transcript's `interrupted` exclusion already refuses.
 * - `children_running` and `background_jobs` are read by the runtime from its
 *   published roster AFTER the interrupt, so the client words its own notice
 *   from NUMBERS rather than by parsing `receipt`, which is prose the runtime
 *   owns and may rephrase. `children_running` counts subagents and team members
 *   the abort did NOT settle - the roster's remainder, read after the interrupt,
 *   which is what `_running_work_counts` filters for and what makes a non-zero
 *   count the thing worth telling the user about; `background_jobs` counts the
 *   session's detached
 *   `bash` jobs, which an interrupt deliberately does NOT touch (they are not
 *   this turn's work) and which therefore need the user to be told.
 * - `receipt` is the runtime's own sentence, carried verbatim and available for
 *   the cases the counts cannot express - it names, for instance, a child that
 *   refused to die. Nothing in the UI requires it to be phrased any particular
 *   way.
 */
export type DesktopInterruptReceipt = {
	status: "interrupted" | "idle";
	receipt: string;
	children_running: number;
	background_jobs: number;
	replayed: boolean;
};
