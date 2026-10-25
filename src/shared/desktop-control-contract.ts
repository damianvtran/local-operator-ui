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
		/** Optional native detail facts; absent means unknown on older hosts. */
		max_output_tokens?: number;
		supports_tools?: boolean | null;
		supports_images?: boolean | null;
		supports_audio_input?: boolean | null;
		reasoning?: boolean | null;
		reasoning_efforts?: string[] | null;
		reasoning_default_effort?: string | null;
		family?: string | null;
		release_date?: string | null;
		modalities?: { input?: string[]; output?: string[] } | null;
		variants?: Record<string, Record<string, unknown>> | null;
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
	 * Which view of the catalogue this document answers: `usable` — the rows the
	 * credential store says this machine can run, with the session's current
	 * model kept whatever its state — or `all`, every row the providers list.
	 *
	 * OPTIONAL, and the absent case is load-bearing: a backend that predates the
	 * `scope` request parameter answers without this field, and because such a
	 * backend cannot have filtered anything, a reader must treat absence as
	 * `all` and apply the `usable` filter itself — see `scopeCatalogue`, the one
	 * place that rule lives.
	 */
	scope?: "usable" | "all";
	/**
	 * How many rows a `usable` answer left out (`all` minus `usable`), for the
	 * picker's "Show all supported models (N need sign-in)" control.
	 *
	 * ABSENT on an `all` answer and on any older backend's. Deliberately a
	 * number a reader SHOWS rather than one it derives: a count a client could
	 * compute from an unfiltered listing is a mirror of the server's access
	 * predicate, not the predicate itself, and a mirror that drifts would print
	 * a number the rows below it contradict. With no number on the wire, the
	 * control reads without one.
	 */
	hidden?: number;
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
	/**
	 * The project DIRECTORY when `scope === "project"`, else null.
	 *
	 * A DIRECTORY, not the file: the catalog's own `project_path` is the file,
	 * and one word for two things is how a renderer ends up showing a path the
	 * user cannot act on. Renamed from `project_path` when the backend split them
	 * (local-operator#1511 `a1ebde44d`).
	 */
	project_cwd: string | null;
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
	/**
	 * How this row's status is known.
	 *
	 * `live` is a runtime's own view, `probe` a Test that answered, `stored` the
	 * config and the durable stores, and `operation` an operation that is RUNNING
	 * - a basis of its own because no probe result exists yet, and reusing
	 * `probe` for it made one word mean both "a Test answered this" and "a Test
	 * is running" (local-operator#1511 `a1ebde44d`).
	 */
	status_basis: "live" | "probe" | "stored" | "operation";
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
	/**
	 * When the `last_seen` count was taken, or null.
	 *
	 * EPOCH SECONDS, and set iff `tool_count_basis === "last_seen"` -
	 * local-operator#1536's contract, which says so in the backend's own words
	 * precisely because this page's clocks are milliseconds: read as
	 * milliseconds it renders a date in 1970, which is the same unit trap that
	 * made an expired check read "Worked 20700 d ago" (M-1). It is what lets a
	 * row say WHEN it last worked instead of only that it did.
	 */
	last_seen_at: number | null;
	actions: (
		| "test"
		| "sign_in"
		/**
		 * Collect a key for this row.
		 *
		 * `add_key` is accepted as a SYNONYM: the backend has not settled whether
		 * the verb that adds a credential for a server with no OAuth discovery is
		 * `set_key` (the name it ships today, offered when the config declares
		 * secret references) or a new `add_key`, so this renderer handles both and
		 * treats them as one control. A row that offers only one of them gets the
		 * same button either way.
		 */
		| "set_key"
		| "add_key"
		| "reauth"
		| "sign_out"
		| "remove"
		| "connect"
		| "disconnect"
	)[];
};

/**
 * One row of the catalog document's `verbs` table (`mcp_catalog` v2).
 *
 * The verb slot of `/mcp`'s argument list, derived server-side from ONE table
 * (`MCP_VERB_ROWS` in `mcp/catalog.py`) so the TUI and this composer cannot
 * drift on which verbs exist, what they say, or which of them are destructive —
 * `destructive` is load-bearing safety on both hosts, not colour: the keyboard
 * gate reads it to make a fuzzy single survivor complete instead of run (the
 * row arm of `slashDestructive`).
 *
 * `offers` is the policy the SERVER slot filters by, over each row's `actions`:
 * `all` admits every configured row (`remove`), `oauth` the OAuth-capable set
 * (`login`/`reauth`), `signed_in` the rows a logout can act on, and `null` no
 * rows at all (`list` takes no argument and an added name is new by definition).
 */
export type McpCatalogVerb = {
	verb: "list" | "add" | "remove" | "login" | "logout" | "reauth";
	description: string;
	destructive: boolean;
	offers: "all" | "oauth" | "signed_in" | null;
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
	/**
	 * The verb table (`mcp_catalog` >= 2): what `/mcp <...>` offers before a
	 * server is named. Optional because a pre-v2 document cannot carry it —
	 * every reader is licensed by the capability version, and Settings never
	 * reads it at all.
	 */
	verbs?: McpCatalogVerb[];
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

/*
 * The Projects surface's wire DTOs (`/v1/desktop/projects*`), mirrored from the
 * backend's models (`server/models/desktop_projects.py`) — slice 1 plus the
 * slice-2 additions this tab renders: `title`/`owner`/`team` on both the
 * summary and the view, and the append-only `updates` log (with attachments)
 * on the view. The backend
 * validates with `extra="allow"`, so a field a NEWER backend adds crosses
 * additively and this renderer ignores it; the fields below are the frozen
 * contract the tab codes against.
 *
 * THREE THINGS CARRIED RATHER THAN RE-DERIVED HERE, each for a stated reason:
 *
 * - `progress_stale` is computed by the server from the store's one staleness
 *   constant (four hours, and only `active` records can read stale), so the
 *   list's stale badge and the completion check cannot disagree about a
 *   record. This renderer must never re-derive it from `progress_updated_at`
 *   with its own threshold.
 * - A milestone's `status` is DERIVED on the server (completed when
 *   `completed_at` is set, else overdue when its `target_date` has passed,
 *   else upcoming) — never stored, so a chip can never drift from the date it
 *   contradicts.
 * - `live_sessions` is a count from ONE machine-wide runtime scan per listing
 *   call, not a per-row dial; the list column and the detail dots read the same
 *   number.
 */
export type DesktopProjectStatus =
	| "planning"
	| "active"
	| "qa"
	| "validation"
	| "done"
	| "paused"
	| "archived";
export type DesktopMilestoneStatus = "completed" | "overdue" | "upcoming";

/** One listing/board row (`projects.list`, and every write's answer). */
export type DesktopProject = {
	id: string;
	name: string;
	description: string;
	/**
	 * The optional display `title` and the two attributions. `null` means
	 * UNKNOWN — a row written before these fields existed, or one this build
	 * cleared — and never a placeholder string, so the renderer falls back to
	 * `name` for display (`projectDisplayName`) rather than inventing one.
	 */
	owner: string | null;
	team: string | null;
	title: string | null;
	/**
	 * One of {@link DesktopProjectStatus} on this build.
	 *
	 * A plain `string` on purpose: a row written by a newer build may carry a
	 * status this app has never heard of, and the honest rendering of one is the
	 * raw value with neutral treatment rather than a crash or a guessed chip.
	 */
	status: string;
	tags: string[];
	start_date: string | null;
	target_date: string | null;
	completed_at: string | null;
	estimate: number | null;
	estimate_unit: string;
	milestones_completed: number;
	milestones_total: number;
	sessions: number;
	live_sessions: number;
	progress_stale: boolean;
	progress_updated_at: number | null;
	updated_at: number;
};

/** One milestone, with its server-derived status (see the module comment). */
export type DesktopProjectMilestone = {
	name: string;
	target_date: string | null;
	completed_at: string | null;
	status: DesktopMilestoneStatus;
};

/**
 * One attachment a history entry carries.
 *
 * Attachments are COPIED into the project's store when the update is written
 * (at most 10 files of at most 5 MB each, refused beyond either), and `path`
 * is the stored copy's location on the machine that serves the payload — the
 * handle this renderer reads bytes from (`readFileBytes`) or opens
 * (`openFile`). `kind` is the classification made at copy time: `image` for
 * image formats, `data` otherwise.
 */
export type DesktopProjectAttachment = {
	name: string;
	kind: string;
	path: string;
	bytes: number;
	added_at: string;
};

/**
 * One append-only history entry, newest last (the log's own order — the feed
 * reverses it for display).
 *
 * `at` is ISO-8601 UTC at second granularity (`2026-09-20T14:00:00Z`), `text`
 * is the progress line as markdown, and `by` is the writing session's id or
 * `"operator"` for a surface with no session — free text, never rendered raw
 * (`progressReporterLabel` names it). The log is bounded at 500 entries
 * server-side, oldest evicted first; the LATEST entry is the record's own
 * `progress` summary, which is why the feed can render history and the
 * summary chip the same fact from two places.
 */
export type DesktopProjectUpdate = {
	at: string;
	text: string;
	by: string;
	attachments: DesktopProjectAttachment[];
};

/** The full record — what `projects.get` and every milestone write answer. */
export type DesktopProjectView = {
	id: string;
	name: string;
	description: string;
	owner: string | null;
	team: string | null;
	title: string | null;
	status: string;
	progress: string;
	progress_updated_at: number | null;
	/** A session id, `"operator"`, or `""` — free text, never rendered raw. */
	progress_reported_by: string;
	progress_stale: boolean;
	tags: string[];
	/** Linked session ids, in link order. */
	sessions: string[];
	created_at: number;
	updated_at: number;
	start_date: string | null;
	target_date: string | null;
	completed_at: string | null;
	estimate: number | null;
	estimate_unit: string;
	milestones: DesktopProjectMilestone[];
	/**
	 * The append-only history, newest last. Detail-only on the wire: the
	 * listing (summary) must not carry it, and a renderer that reads it off a
	 * `DesktopProject` row would be reading a field the route never sends.
	 */
	updates: DesktopProjectUpdate[];
};

/** A linked session's runtime record, as the one scan classifies it. */
export type DesktopLinkedSessionRuntime = {
	/** `live` | `wedged` | `stale` | `stopped` (stopped = no record at all). */
	state: string;
	busy: boolean | null;
	heartbeat_age_s: number | null;
	pid: number | null;
};

/**
 * One linked-session row of the composed view.
 *
 * `subagents`/`todos` are `null` for UNKNOWN — a session that never launched a
 * child has no roster sidecar, and one that never persisted a todo snapshot has
 * none — and null is never rendered as 0. `exists: false` marks a session whose
 * directory is gone (deleted or retention-cleaned): shown as missing, never
 * silently unlinked.
 */
export type DesktopLinkedSession = {
	session_id: string;
	exists: boolean;
	title: string | null;
	created_at: number | null;
	archived: boolean;
	runtime: DesktopLinkedSessionRuntime;
	subagents: { running: number; settled: number; names: string[] } | null;
	todos: { open: number; total: number } | null;
};

/** `projects.get`'s answer: the row plus one row per linked session. */
export type DesktopProjectDetail = {
	project: DesktopProjectView;
	links: DesktopLinkedSession[];
};

/**
 * `projects.request_update`'s per-session outcome (the route's three-way
 * vocabulary, frozen):
 *
 * - `delivered` - the mailbox drop landed;
 * - `unconfirmed` - the dial could not be confirmed either way (an
 *   OSError/TimeoutError after the request was written); the message MAY still
 *   have arrived, so no copy about it may assert failure;
 * - `failed` - a refusal with a reason in `detail` ("not started yet",
 *   "stale", "no longer exists", the never-started sentence, or the error's
 *   own words).
 */
export type DesktopProjectRequestUpdateOutcome =
	| "delivered"
	| "unconfirmed"
	| "failed";

/** One linked session's answer to a check-in request. */
export type DesktopProjectRequestUpdateSession = {
	session_id: string;
	title: string | null;
	outcome: DesktopProjectRequestUpdateOutcome;
	detail: string;
};

/**
 * The route's answer (`POST /v1/desktop/projects/{project}/request-update`).
 *
 * `state` is the batch's verdict: `sent` (the per-session list carries the
 * outcomes), `cooldown` (the route's own 60 s window refused the batch - no
 * dials, `cooldown_remaining_s` says how long), or `empty` (no linked
 * sessions to ask). The counts are the server's, not a client-side tally:
 * the client must not recompute them from a list it might truncate.
 *
 * `project.key` is the row's addressing key (its `name`), `title` its display
 * title - the toast composes the display name exactly as the page does
 * (`title`, else key), because the toast appears far from the card that was
 * pressed.
 */
export type DesktopProjectRequestUpdateResult = {
	project: { id: string; key: string; title: string | null };
	state: "sent" | "cooldown" | "empty";
	requested_at: string | null;
	cooldown_remaining_s: number | null;
	counts: {
		total: number;
		delivered: number;
		unconfirmed: number;
		failed: number;
	};
	sessions: DesktopProjectRequestUpdateSession[];
};

/**
 * One ranked row of `GET /v1/desktop/projects/search`.
 *
 * `score` is the server's ranking number and is comparable WITHIN one answer
 * only — never across queries or builds, because the weights are tunable (the
 * backend's own docstring says so) — so this client uses the ORDER the answer
 * arrives in and never re-sorts by `score`. `name` is the display name (title
 * when set, else the addressing name), and `fields` names what matched.
 *
 * The row itself is NOT carried: a hit is an id and a rank over rows the
 * listing already holds, so the client paints its own `DesktopProject` for the
 * id and the answer stays small. An id the listing does not hold is dropped
 * rather than synthesized — this route ranks over that same store, so an id
 * with no row is a store that moved under the answer, not a row to invent.
 */
export type DesktopProjectSearchHit = {
	id: string;
	name: string;
	score: number;
	fields: string[];
};

/**
 * `GET /v1/desktop/projects/search` — the ranked hits plus the echo.
 *
 * `query` echoes what was asked, and it is load-bearing rather than
 * decorative: the client applies an answer only when the echo equals the box
 * (the `hitsAnswerQuery` rule the session search settled on), so a slow
 * answer landing after a fast later one cannot filter the list by the wrong
 * question. `count` is the number of hits in THIS answer, after `limit` —
 * never the store size.
 */
export type DesktopProjectSearchResults = {
	projects: DesktopProjectSearchHit[];
	query: string;
	count: number;
};

/**
 * Aida's control state, as `GET /v1/desktop/aida` answers it (`design.md` § 4).
 *
 * WHY `enabled` IS ON THE READ AND IS NOT READ FROM THE POST. `features.aida`
 * says the backend HAS the surface; this says whether THIS install runs her
 * (`aida.enabled` / `LOCAL_OPERATOR_NO_AIDA`, R17/R18). They are different
 * facts and the rail's row is absent for the second one — a row whose every
 * press would answer `409 aida_disabled` is the dead control fail-closed means
 * to omit. The read is where the UI is TOLD that fact; the POST's answer is a
 * consequence of an op that already had to pass it, and the implemented route
 * carrying `enabled` there too (its `AidaState` serves both verbs; agent review
 * round 1, NIT-1) is extra rather than a second publication this UI reads.
 */
export type DesktopAidaState = {
	enabled: boolean;
	/**
	 * Her display name, when the backend is new enough to carry one (the rename
	 * slice, in flight): a string the user configured, defaulting to "Aida"
	 * server-side. OPTIONAL on purpose - this build reads payloads from backends
	 * that predate the field, and every display site falls back with
	 * `aida.data?.name ?? "Aida"`, so absent, null and an older payload all
	 * render the shipped default rather than an empty row. NOT the command key:
	 * `/aida` stays stable whatever this says.
	 */
	name?: string | null;
	/** Her single long conversation (R7), or null until first ensured. */
	session_id: string | null;
	/** Whether the proactive cadence is paused (R13); flipped by pause/resume. */
	paused: boolean;
	/**
	 * Whether the first-run greeting has been DELIVERED (PR 2's gate).
	 *
	 * It used to mean "armed"; on the ledger's backend it is true only once a
	 * message actually reached the conversation, so a `greeted: false` after a
	 * `greet` no longer means "she has not been asked yet" - `greeting_state` is
	 * the field for that (backend #2071's round-1 addendum). Read it for
	 * settledness, which is the one question it still answers.
	 */
	greeted: boolean;
	/**
	 * The greeting ledger's state word: ``owed`` / ``requested`` / ``armed`` /
	 * ``delivered`` / ``skipped``.
	 *
	 * ON THE READ AS WELL AS THE POST (backend #2071 head ``dbe513397e``). A
	 * surface that has not asked for anything yet - step 3 of the wizard, before
	 * its button is pressed - can only learn it here, and it is what decides
	 * whether this install still owes the user a hello from her: `owed` says she
	 * has never been offered, `delivered`/`skipped` say she will not speak first
	 * again. Absent on a backend that predates the ledger.
	 */
	greeting_state?: string | null;
	/**
	 * Whether a LIVE session on this machine owns her rows, so a call's effect is
	 * carried out by that owner rather than here — the greeting arrives in the
	 * other window. A fact about WHO acts next, never an error: every answer
	 * carrying it is a 200 and the operation is in effect.
	 */
	held?: boolean | null;
};

/**
 * The POST's answer: the freeze's subset of the state — `session_id`, `paused`,
 * `greeted`, and the ledger's two fields, which the READ now carries as well.
 * `enabled` is deliberately not typed here even though the implemented route
 * carries it (agent review round 1, NIT-1): extra fields are ignored at this
 * boundary, and a control that inferred the install's switch from "the call
 * succeeded" would be answering a question nobody asked it — which is why the
 * field is read from the READ wherever the UI needs it.
 *
 * BOTH LEDGER FIELDS ARE OPTIONAL, and that is the contract rather than caution:
 * the route defaulted them (``greeting_state="owed"``, ``held=False``) so a
 * backend older than the ledger answers the same three fields it always did, and
 * this client must render that payload exactly as it did before — the tolerant
 * path every reader of them keeps. Read them off the payload, never out of a
 * refusal's prose — the same rule the error path follows
 * (`aidaControlFailureCopy`).
 */
export type DesktopAidaControlResult = Omit<DesktopAidaState, "enabled">;

/*
 * THE LIBRARY SURFACE'S WIRE DTOs (`/v1/desktop/library*` and
 * `/v1/desktop/librarian`), mirrored from the frozen design contract
 * (`docs/design/library.md` § 4 in the local-operator repository).
 *
 * SHAPES ARE COPIED FROM THE CONTRACT, NOT RE-DERIVED: `kind` and `category`
 * are classified server-side by one pure module, and the desktop renderer must
 * never grow a second opinion about which extension is a presentation. The
 * same applies to `organized`, whose presence says the asset has been through
 * the Librarian (or a user edit) and whose `by` names the actor.
 *
 * A `null` field means UNKNOWN/ABSENT and never a placeholder: `chat: null`
 * says this asset has no linked conversation, `preview.pages: null` says the
 * preview has no pagination (or is unsupported), and `organized: null` says
 * nothing has organized this row yet. Rendering an empty string where one of
 * these is null would make the composer or the tag editor claim a state the
 * catalog never answered.
 */
export type DesktopLibraryKind =
	| "image"
	| "audio"
	| "video"
	| "pdf"
	| "pptx"
	| "docx"
	| "markdown"
	| "html"
	| "spreadsheet"
	| "text"
	| "code"
	| "other";

export type DesktopLibraryCategory =
	| "image"
	| "sound"
	| "document"
	| "presentation"
	| "video"
	| "spreadsheet"
	| "code"
	| "other";

export type DesktopLibraryOriginGroup = "generated" | "created" | "mentioned";

export type DesktopLibrarySort =
	| "recent"
	| "name"
	| "kind"
	| "size"
	| "created"
	| "modified"
	| "organized";

/** One tag row, on the catalog listing and on an asset. `count` rides only listings. */
export type DesktopLibraryTag = {
	id: string;
	name: string;
	category: string;
	count?: number;
};

/**
 * Where an asset's bytes live.
 *
 * `path` is present only on this desktop plane (the relay projects
 * `display_path` with `display=True` and drops the absolute path). `digest`
 * names a content-addressed attachment. Callers on this plane must treat `path`
 * as display-only: content and thumbnail bytes are fetched by asset id, never by
 * a caller-supplied path.
 */
export type DesktopLibraryRef = {
	type: "path" | "artifact";
	path: string | null;
	display_path: string;
	digest: string | null;
	content_type: string;
};

export type DesktopLibraryOccurrence = {
	session_id: string;
	session_title: string;
	origin: string;
	tool: string | null;
	at: number;
	intent: string | null;
	/**
	 * The transcript sequence range the occurrence covers, and the subagent run
	 * it came from when it is one. The desktop chat route does not yet accept a
	 * message anchor, so this release links to the conversation while carrying
	 * the range for the surface that will.
	 */
	first_seq: number;
	last_seq: number;
	child_id: string | null;
	/** A display override the backend may add for a peer/child occurrence. */
	label: string | null;
};

/** One catalog row, as `library.list` and `library.get` answer it. */
export type DesktopLibraryAsset = {
	id: string;
	ref: DesktopLibraryRef;
	name: string;
	/**
	 * The server-derived fallback name (a de-slugged filename). Editable `name`
	 * wins for display; the card's second line is deliberately THIS field so a
	 * row the user has not named still reads as its file rather than as an empty
	 * line.
	 */
	derived_name: string;
	description: string;
	kind: DesktopLibraryKind;
	category: DesktopLibraryCategory;
	origin: string;
	origin_group: DesktopLibraryOriginGroup;
	origins: string[];
	tags: DesktopLibraryTag[];
	primary_tag: string | null;
	size_bytes: number;
	width: number | null;
	height: number | null;
	duration_s: number | null;
	created_at: number;
	modified_at: number;
	last_seen_at: number;
	exists: boolean;
	highlighted: boolean;
	highlight_why: string | null;
	occurrences: DesktopLibraryOccurrence[];
	session_count: number;
	chat: { session_id: string; title: string; updated_at: number } | null;
	preview: {
		state: "ready" | "unsupported";
		mime_type: string | null;
		pages: number | null;
	};
	organized: {
		at: number;
		by: string | null;
		confidence: number | null;
	} | null;
	locked: boolean;
	favorite: boolean;
	archived: boolean;
};

/** The `library.list` answer. */
export type DesktopLibraryList = {
	state: "ready" | "building";
	revision: number;
	total: number;
	counts: {
		category: Record<string, number>;
		origin_group: Record<string, number>;
		kind: Record<string, number>;
	};
	tags: DesktopLibraryTag[];
	rows: DesktopLibraryAsset[];
	next_cursor: string | null;
	cursor_reset: boolean;
	scan: { sessions_total: number; sessions_scanned: number };
	/**
	 * Present once the Librarian package ships; before that the key is absent
	 * or null (`LibraryListing` in the backend models), and the header draws no
	 * status row rather than inventing "never run".
	 */
	librarian: DesktopLibrarianStatus | null;
};

/** The chat routes' answer: the asset id, the link it now holds (or null). */
export type DesktopLibraryChatReceipt = {
	asset_id: string;
	chat: { session_id: string; title: string; updated_at: number } | null;
	cleared: boolean;
};

/** The Librarian's status row, embedded in the listing and read by its own route. */
export type DesktopLibrarianStatus = {
	enabled: boolean;
	session_id: string | null;
	paused: boolean;
	/** The display name the backend pins (defaults to "Librarian"). */
	name?: string;
	/** The structured last-run receipt; null before the first run. */
	last_run?: {
		at: number;
		named: number;
		tagged: number;
		failed: number;
	} | null;
	/** Catalog-wide counts the status route knows; never derived from a page. */
	library?: { total: number; unorganized: number };
	/** Flat aliases the route also carries; read first, structured second. */
	last_run_at: number | null;
	last_summary: string | null;
	unorganized?: number;
};

/**
 * The fields `library.update` may write. Omitted keys leave their field alone.
 *
 * The bounds mirror `LibraryAssetPatch`: name 200 characters, description 2000.
 * The editor enforces them before the write so an over-long paste is refused
 * with copy in the field rather than as an opaque 422.
 */
export type DesktopLibraryUpdateFields = {
	name?: string;
	description?: string;
	favorite?: boolean;
	locked?: boolean;
	archived?: boolean;
};

/** `library.list`'s `session_id`: one session id or a comma list. */
export type DesktopLibrarySessionFilter = string;

/**
 * The sidebar's customisable destination rail (design contract § 1-§ 4).
 *
 * THE IDS ARE WIRE VOCABULARY, which is why they live here rather than being
 * invented in the renderer: the route validates against this allow-list, and a
 * second copy of ten strings in a component tree is exactly the kind of pair
 * that drifts silently - a rename on one side would leave the other accepting a
 * preference the backend refuses, or worse, storing one it silently drops. The
 * renderer's pure model re-exports this tuple, so there is one spelling.
 *
 * ORDER IS THE DEFAULT ORDER, and it is load-bearing: `sanitizeSidebarLayout`
 * re-inserts an id missing from a stored layout at its default position
 * relative to the ids that remain, and that position is derived from this
 * order. Changing the order here changes the default arrangement.
 */
export const SIDEBAR_DESTINATION_IDS = [
	"aida",
	"library",
	"projects",
	"agents",
	"schedules",
	"browser",
	"team-bridge",
	"agent-hub",
	"mesh",
	/*
	 * APPENDED, NEVER INSERTED (notifications decisions D10). The tuple is wire
	 * vocabulary shared with core `server/sidebar_layout.py`, and both sides only
	 * grow it at the end. Where the row LANDS is not decided by this order but by
	 * `DEFAULT_REGION_BY_ID` plus the explicit default rank in
	 * `sidebar-destinations.ts` (`DEFAULT_RANK_BY_ID`), which places it under
	 * Aida. An older core refuses this id on PUT, so the save path strips it
	 * unless `features.notifications` is advertised (`stripUnadvertisedIds`).
	 */
	"notifications",
] as const;

/** The stable spelling of one destination, on the wire and in the store. */
export type SidebarDestinationId = (typeof SIDEBAR_DESTINATION_IDS)[number];

/**
 * One stored arrangement: the ordered rail cut at one fold.
 *
 * `visible ++ more` is the single order a drag operates on; the boundary is
 * `visible.length`, not a second container. All ten ids are stored even when a
 * destination is temporarily unavailable (a capability gate removes it from the
 * render, never from the stored order), so a preference survives an app or
 * backend update that hides a destination and later restores it.
 */
export type DesktopSidebarLayout = {
	visible: SidebarDestinationId[];
	more: SidebarDestinationId[];
};

/** `GET`/`PUT /v1/desktop/sidebar-layout` answer with the normalised layout. */
export type DesktopSidebarLayoutResponse = { layout: DesktopSidebarLayout };

/*
 * THE NOTIFICATIONS REEL (`/v1/desktop/notifications*`, notifications contract
 * § 2.2 and § 5.2). One normalized item shape for both sources: a `notify` row
 * an agent raised, and an OPEN ask projected into the reel (decisions D1:
 * settled asks never appear in the list, only in an item's detail).
 *
 * Fields the backend may add later are tolerated by construction (these are
 * TypeScript types over a JSON answer, not a strict parser). Optional fields
 * are the ones an older L1 build or an ask row legitimately omits, and the
 * renderer treats absence as "cannot say", never as a default value.
 */
export type DesktopNotificationPriority = "high" | "normal" | "low";

/**
 * How an item became read. `explicit` is a gesture; `in_view` is the per-item
 * auto-read (contract § 6.4); `watching` is created-read because the operator
 * was in the conversation when it arrived (contract § 6.2, decisions D3).
 */
export type DesktopNotificationReadVia = "explicit" | "in_view" | "watching";

export type DesktopNotificationItem = {
	/** `n_…` for a notify row, `ask:<session_id>:<ask_id>` for an open ask. */
	id: string;
	source: "notify" | "ask";
	priority: DesktopNotificationPriority;
	title: string;
	/** First 160 characters of the body, or an ask's first question. */
	excerpt: string;
	/** Epoch milliseconds. */
	created_at: number;
	updated_at: number;
	/** Machine-wide monotonic cursor; re-stamped on every write to the row. */
	seq: number;
	/** The ack token: a read or dismiss names the revision the client rendered. */
	revision: number;
	read: boolean;
	read_via: DesktopNotificationReadVia | null;
	dismissed: boolean;
	repeat_count: number;
	/** The notify collapse key, scoped by session. Absent on an ask. */
	key?: string;
	/** The `notify` tool call id: the transcript anchor. Absent on an ask. */
	anchor_id?: string;
	session: {
		id: string;
		title: string;
		agent_id?: string;
		live?: boolean;
	};
	projects?: { key: string; name: string; status?: string }[];
	ask?: {
		status: string;
		deadline_at?: number | null;
		question_count?: number;
		dismissible?: boolean;
	} | null;
	actions?: { dismiss?: boolean; answer?: boolean; read?: boolean };
};

/** `GET /v1/desktop/notifications`. `waiting` is present on the first page only. */
export type DesktopNotificationsList = {
	items: DesktopNotificationItem[];
	waiting?: DesktopNotificationItem[];
	next_cursor?: string | null;
	unread_count: number;
	waiting_count: number;
	/** Max `seq` this answer saw: the `throughSeq` of a mark-all / by-session write. */
	high_water: number;
};

/** `GET /v1/desktop/notifications/count`, and the feed frame's payload. */
export type DesktopNotificationsCount = {
	unread_count: number;
	waiting_count: number;
	high_water: number;
};

export type DesktopNotificationHistoryEntry = {
	revision: number;
	at: number;
	title: string;
	excerpt: string;
};

/** `GET /v1/desktop/notifications/{id}`. */
export type DesktopNotificationDetail = {
	item: DesktopNotificationItem & {
		body_md?: string;
		links?: { label: string; url: string }[];
	};
	history: DesktopNotificationHistoryEntry[];
	session: {
		id: string;
		title: string;
		agent_id?: string;
		live_state?: string;
		cwd?: string;
	};
	/** The transcript entry at `anchor_id`, bounded; absent when unresolvable. */
	anchor: { id: string; excerpt: string } | null;
	projects: { key: string; name: string; status?: string }[];
	/** That conversation's asks, the frozen `PendingAsk` wire rows. */
	asks: Record<string, unknown>[];
};

export type DesktopNotificationsSkipReason =
	| "live_ask"
	| "stale_revision"
	| "unknown"
	| "already";

/** `PATCH /v1/desktop/notifications` and `POST …/seen`. */
export type DesktopNotificationsWriteResult = {
	changed: string[];
	skipped: { id: string; reason: DesktopNotificationsSkipReason }[];
	unread_count: number;
	high_water: number;
};
