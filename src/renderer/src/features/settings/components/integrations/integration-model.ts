/**
 * Settings > Integrations, as pure decisions: what a row SAYS, which ONE action
 * it leads with, what goes in its overflow, which group it sits in, and when the
 * list is worth asking again.
 *
 * ## Why this is a module of its own
 *
 * The section used to decide all of this inline, from the wire's own words: the
 * badge printed `server.status` verbatim ("auth-required", "cold"), the row
 * printed `server.transport` ("stdio", "http"), and every row drew Connect or
 * Disconnect, Reload, Sign in and Remove whatever the server needed (design audit
 * D8, UX walk U6). Each of those is a mapping from a state to copy or to a
 * control, and a mapping is testable without React - so it lives here, the
 * section renders what this returns, and `scripts/integration-model.test.mjs`
 * pins the table.
 *
 * ## Whose decision it is
 *
 * The backend's (`local_operator/mcp/catalog.py`): it sends `status` in a
 * plain-language enum and `actions` naming what this row may do. This module
 * only CHOOSES AMONG the offered actions and words them. It never adds one the
 * backend did not offer - a "Sign in" on a local command with no secret
 * references was exactly the dead end this replaces.
 *
 * ## Two sources, one row shape
 *
 * A backend without the `mcp_catalog` capability still has the session route,
 * and the Settings page must keep working against it (architect's rollout risk:
 * "must not show 'update the backend' for a feature that still works").
 * `catalogFromSessionState` adapts that older document into the same row shape,
 * deriving `actions` from the fields the old route does send, so there is one
 * renderer and the fallback cannot drift into a second vocabulary.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type {
	DesktopMcpState,
	McpCatalog,
	McpCatalogOperation,
	McpCatalogRow,
} from "../../../../../../shared/desktop-control-contract";
import { foreignMcpConfigOrigin } from "../../../../../../shared/mcp-foreign-config-origin";
import {
	MCP_FAILURE_LEAD,
	type McpFailurePhase,
	mcpFailure,
} from "../../../chat/components/run-details/mcp-failure";

/** Every action a row can carry: the catalog's own, plus two only the session route has. */
export type IntegrationAction =
	| McpCatalogRow["actions"][number]
	| "reload"
	| "copy_setup";

/** Where a row came from, which decides which route its controls go to. */
export type IntegrationSource = "catalog" | "session";

/**
 * A row as this page renders it: the catalog row, widened by the two
 * session-only affordances the fallback still carries.
 *
 * `setup_prompt` is the old route's `setup.text` ("Help me set up access for
 * MCP server X..."), offered as a copyable prompt on the fallback only; the
 * catalog has no equivalent because its `actions` already say what the row can
 * do.
 */
export type IntegrationRow = Omit<McpCatalogRow, "actions"> & {
	actions: IntegrationAction[];
	setup_prompt?: string | null;
};

export type IntegrationDocument = Omit<McpCatalog, "servers"> & {
	servers: IntegrationRow[];
};

/* ------------------------------------------------------------------ copy */

/** "1 tool", "12 tools" - the walk's "1 tools available" (N1) was this. */
export const toolCountLabel = (count: number): string =>
	`${count} ${count === 1 ? "tool" : "tools"}`;

/** "1 integration", "3 integrations", for group headings and the search box. */
export const integrationCountLabel = (count: number): string =>
	`${count} ${count === 1 ? "integration" : "integrations"}`;

/**
 * The tone a status is drawn in. Always paired with words, so the dot never
 * carries meaning by colour alone.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export type IntegrationStatusView = {
	/** The short status, right-aligned on the row. */
	label: string;
	tone: StatusTone;
	/** The line under the name when the status has more to say, or null. */
	detail: string | null;
	/** Whether a spinner, not a dot, marks the row. */
	busy: boolean;
};

/**
 * The operation currently running for a row, if any.
 *
 * Newest first, because a finished test followed by a new one leaves both in
 * the list and only the newer one describes the row now.
 */
export const runningOperationFor = (
	name: string,
	operations: readonly McpCatalogOperation[],
): McpCatalogOperation | null =>
	[...operations]
		.filter((op) => op.name === name && op.status === "running")
		.sort((a, b) => b.created_at - a.created_at)[0] ?? null;

/**
 * What a row's status reads as.
 *
 * `Ready` rather than "Not started" or "Off": nothing is wrong with a server no
 * conversation has used yet, and `status_basis: "stored"` is never claimed as
 * `Connected` (architect § 8) - only a live runtime or a fresh probe can say
 * that. A sign-in that is running is stated as such even though the backend
 * keeps the row at `needs_sign_in` until it completes, because "Needs sign-in"
 * beside an open sign-in dialog reads as the press having done nothing.
 */
export function integrationStatus(
	row: IntegrationRow,
	operations: readonly McpCatalogOperation[] = [],
): IntegrationStatusView {
	const running = runningOperationFor(row.name, operations);
	if (running && (running.action === "login" || running.action === "reauth"))
		return { label: "Signing in…", tone: "info", detail: null, busy: true };
	switch (row.status) {
		case "connected":
			return {
				label:
					typeof row.tool_count === "number"
						? `Connected · ${toolCountLabel(row.tool_count)}`
						: "Connected",
				tone: "success",
				detail: null,
				busy: false,
			};
		case "connecting":
			return { label: "Connecting…", tone: "info", detail: null, busy: true };
		case "needs_sign_in":
			return {
				label: row.auth.kind === "api_key" ? "Needs a key" : "Needs sign-in",
				tone: "warning",
				// Only the backend's own reason: the row's action button already says
				// what to do, and a sentence repeating it on every such row is noise.
				detail: row.status_reason,
				busy: false,
			};
		case "error":
			return {
				label: "Couldn't start",
				tone: "danger",
				// The reason is the whole point of the state (N4, U5): a failure with no
				// cause is a dead end. When the backend sent none, say so rather than
				// leaving the line out and implying there was nothing to say.
				detail: row.status_reason ?? "No reason was given.",
				busy: false,
			};
		default:
			// No detail line: "Ready" on every idle row followed by the same sentence
			// would be the loudest thing on a page of healthy servers. The sentence
			// is the status's tooltip instead (`READY_EXPLANATION`).
			return { label: "Ready", tone: "neutral", detail: null, busy: false };
	}
}

/** What "Ready" means, for the status's tooltip. */
export const READY_EXPLANATION =
	"Nothing is wrong. It starts when a chat uses it.";

/** "Local command" / "Remote URL": quiet meta, never the primary text. */
export const transportLabel = (row: Pick<IntegrationRow, "transport">) =>
	row.transport === "local_command" ? "Local command" : "Remote URL";

/**
 * The tool that owns a foreign row's config, or null for this app's own.
 *
 * Read from `source.kind` first (the backend's authority), and from the path
 * only for a kind this build does not know, so a new foreign config added on the
 * backend still gets named when its file name is in the local table.
 */
export function foreignOrigin(row: IntegrationRow): string | null {
	switch (row.source.kind) {
		case "local-operator":
		case "project-mcp-json":
			return null;
		case "claude-code":
			return "Claude Code";
		case "cursor":
			return "Cursor";
		case "vscode":
			return "VS Code";
		case "codex":
			return "Codex CLI";
		default:
			return foreignMcpConfigOrigin(row.source.path);
	}
}

/**
 * The row's de-emphasised meta: how it runs, where it applies, where it came
 * from. Scope is only worth a word when there IS a separate project file -
 * with the desktop's default cwd of `~` there is not, and "Global" beside every
 * row would be a distinction with nothing on the other side of it.
 */
export function integrationMeta(
	row: IntegrationRow,
	projectScopeAvailable: boolean,
): string[] {
	const parts = [transportLabel(row)];
	// The last count the tool cache saw, for a row that is not connected now. A
	// connected row says its count in the status instead, and a live count beside
	// a remembered one would be two answers to one question.
	if (
		row.status !== "connected" &&
		row.tool_count_basis === "last_seen" &&
		typeof row.tool_count === "number"
	)
		parts.push(`${toolCountLabel(row.tool_count)} last time`);
	if (projectScopeAvailable)
		parts.push(row.scope === "project" ? "This project" : "Global");
	const origin = foreignOrigin(row);
	if (origin) parts.push(`Imported from ${origin}`);
	else if (!row.source.editable) parts.push("Imported from a project file");
	return parts;
}

/* --------------------------------------------------------------- actions */

export type PrimaryAction = {
	kind: "sign_in" | "set_key" | "reauth" | "test" | "connect" | "fix";
	label: string;
};

/**
 * The ONE action a row leads with, chosen by its state from what it offers.
 *
 * - Connected, or already connecting: nothing - the row is fine, or busy.
 * - Needs sign-in: sign in, else add a key, else sign in again.
 * - Couldn't start: reconnect under a live runtime, else test again, else `Fix`,
 *   which opens the config file - a row that cannot even be tested has an
 *   invalid config, and the file is the only place that is fixed.
 * - Ready: connect under a live runtime, else test.
 *
 * A needs-sign-in row that offers neither route (an api-key reference the
 * backend cannot collect here) also falls through to `Fix`.
 */
export function primaryAction(
	row: IntegrationRow,
	operations: readonly McpCatalogOperation[] = [],
): PrimaryAction | null {
	if (runningOperationFor(row.name, operations)) return null;
	const has = (action: IntegrationAction) => row.actions.includes(action);
	switch (row.status) {
		case "connected":
		case "connecting":
			return null;
		case "needs_sign_in":
			if (has("sign_in")) return { kind: "sign_in", label: "Sign in" };
			if (has("set_key")) return { kind: "set_key", label: "Add key" };
			if (has("reauth")) return { kind: "reauth", label: "Sign in again" };
			return { kind: "fix", label: "Fix" };
		case "error":
			if (has("connect")) return { kind: "connect", label: "Reconnect" };
			if (has("test")) return { kind: "test", label: "Retry" };
			return { kind: "fix", label: "Fix" };
		default:
			if (has("connect")) return { kind: "connect", label: "Connect" };
			if (has("test")) return { kind: "test", label: "Test" };
			return null;
	}
}

export type OverflowItem =
	| {
			kind:
				| "test"
				| "connect"
				| "reauth"
				| "set_key"
				| "sign_out"
				| "disconnect"
				| "reload"
				| "copy_setup"
				| "open_config"
				| "cancel"
				| "remove";
			label: string;
			destructive?: boolean;
	  }
	| {
			/** A foreign row's Remove, disabled, with where to remove it instead. */
			kind: "remove_elsewhere";
			label: string;
			hint: string;
	  };

/**
 * The row's secondary actions, in a stable order, minus the one it leads with.
 *
 * `Open config file` is on every row, because the file is the ground truth for
 * every one of them. Remove is last and destructive (D9 - it used to be a
 * danger-ink button on every row). A row this app may not write gets a
 * DISABLED remove that says where to remove it, rather than no item: the
 * question "how do I get rid of this" still has an answer.
 */
export function overflowItems(
	row: IntegrationRow,
	operations: readonly McpCatalogOperation[] = [],
): OverflowItem[] {
	const primary = primaryAction(row, operations)?.kind;
	const has = (action: IntegrationAction) => row.actions.includes(action);
	const items: OverflowItem[] = [];
	const running = runningOperationFor(row.name, operations);
	if (running) items.push({ kind: "cancel", label: "Cancel" });
	if (!running && has("test") && primary !== "test")
		items.push({ kind: "test", label: "Test connection" });
	if (has("connect") && primary !== "connect" && row.status !== "connected")
		items.push({ kind: "connect", label: "Reconnect" });
	if (has("reload")) items.push({ kind: "reload", label: "Reload" });
	if (!running && has("reauth") && primary !== "reauth")
		items.push({ kind: "reauth", label: "Sign in again" });
	if (has("set_key") && primary !== "set_key")
		items.push({ kind: "set_key", label: "Update key" });
	if (has("sign_out")) items.push({ kind: "sign_out", label: "Sign out" });
	if (has("disconnect") && row.status === "connected")
		items.push({ kind: "disconnect", label: "Disconnect" });
	if (has("copy_setup") && row.setup_prompt)
		items.push({ kind: "copy_setup", label: "Copy setup prompt" });
	if (primary !== "fix")
		items.push({ kind: "open_config", label: "Open config file" });
	if (has("remove"))
		items.push({ kind: "remove", label: "Remove", destructive: true });
	else if (!row.source.editable) {
		const origin = foreignOrigin(row);
		items.push({
			kind: "remove_elsewhere",
			label: origin ? `Remove in ${origin}` : "Remove in its own file",
			hint: origin
				? `Defined in ${origin}'s config. Remove it there.`
				: "Defined in a file this app doesn't write. Remove it there.",
		});
	}
	return items;
}

/* ---------------------------------------------------------------- groups */

export type IntegrationGroupId = "attention" | "connected" | "ready";

export type IntegrationGroup = {
	id: IntegrationGroupId;
	title: string;
	rows: IntegrationRow[];
};

const GROUP_TITLES: Record<IntegrationGroupId, string> = {
	attention: "Needs attention",
	connected: "Connected",
	ready: "Ready",
};

/**
 * Which group a row sits in.
 *
 * `connecting` stays in `ready`: a test is run from a Ready or failed row, and
 * a row that jumped groups the moment it was pressed would move out from under
 * the pointer. A failed row being RE-tested stays where it was for the same
 * reason - it is still the one needing attention until the test says otherwise.
 */
export function integrationGroupOf(
	row: IntegrationRow,
	operations: readonly McpCatalogOperation[] = [],
): IntegrationGroupId {
	if (row.status === "needs_sign_in" || row.status === "error")
		return "attention";
	if (row.status === "connected") return "connected";
	const running = runningOperationFor(row.name, operations);
	if (running && running.action !== "test") return "attention";
	return "ready";
}

/**
 * Rows grouped for display: needs attention first (the rows to act on), then
 * connected, then ready. Rows keep the backend's order inside a group, and an
 * empty group is not rendered at all.
 */
export function groupIntegrations(
	rows: readonly IntegrationRow[],
	operations: readonly McpCatalogOperation[] = [],
): IntegrationGroup[] {
	const order: IntegrationGroupId[] = ["attention", "connected", "ready"];
	return order
		.map((id) => ({
			id,
			title: GROUP_TITLES[id],
			rows: rows.filter((row) => integrationGroupOf(row, operations) === id),
		}))
		.filter((group) => group.rows.length > 0);
}

/* --------------------------------------------------------------- polling */

/** How often the list is re-read while something on it is still moving. */
export const INTEGRATIONS_POLL_MS = 2_000;

/**
 * The list's refetch interval: every 2 s while a row is connecting or an
 * operation is running, and never otherwise.
 *
 * The staleness the walk found ("connecting" for 26 s while the backend said
 * connected, U6) was a list that never asked again; a list that always asked
 * would spawn nothing but still cost a read every tick on a page usually
 * sitting idle. Asking only while something is in flight is both.
 */
export function integrationsPollInterval(
	document: Pick<IntegrationDocument, "servers" | "operations"> | undefined,
): number | false {
	if (!document) return false;
	const moving =
		document.servers.some((row) => row.status === "connecting") ||
		document.operations.some((op) => op.status === "running");
	return moving ? INTEGRATIONS_POLL_MS : false;
}

/* ----------------------------------------------------------- add form */

export const INTEGRATION_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;
const SCHEME_IN_PATH = /:\/\//;

/**
 * Why a name cannot be added, or null. Checked here first so the form says it
 * in words next to the field instead of relaying a 422 from the schema.
 */
export function integrationNameProblem(
	name: string,
	existing: readonly string[],
): string | null {
	const trimmed = name.trim();
	if (!trimmed) return "Give it a name.";
	if (!INTEGRATION_NAME_PATTERN.test(trimmed))
		return "Use letters, numbers, dots, dashes, underscores or colons, with no spaces.";
	if (existing.includes(trimmed))
		return `An integration named ${trimmed} already exists.`;
	return null;
}

/**
 * Why a remote URL cannot be added, or null.
 *
 * The walk's rig saved `https://a/…https://b/…` and the backend took it (N3), so
 * the shape is checked here: an absolute http(s) URL, with no inline
 * credentials, query or fragment (the backend redacts those as possible
 * secrets, which would leave a row pointing nowhere the user can see), and no
 * second scheme pasted into the path.
 */
export function integrationUrlProblem(raw: string): string | null {
	const value = raw.trim();
	if (!value) return "Enter the server's URL.";
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return "Enter a full URL, like https://mcp.example.com/mcp.";
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
		return "The URL must start with https:// or http://.";
	if (!parsed.hostname) return "The URL needs a host name.";
	if (parsed.username || parsed.password)
		return "Remove the username or password from the URL. Keys are added after it's saved.";
	if (parsed.search || parsed.hash)
		return "Remove the ? or # part of the URL. Keys are added after it's saved.";
	if (SCHEME_IN_PATH.test(value.slice(parsed.protocol.length + 2)))
		return "This looks like two URLs pasted together. Enter just one.";
	return null;
}

/** The arguments field, one per line, as the array the wire takes. */
export const parseIntegrationArgs = (raw: string): string[] =>
	raw
		.split("\n")
		.map((arg) => arg.trim())
		.filter(Boolean);

/* ------------------------------------------------ session-route fallback */

/**
 * The older backend's `mcp.list` document, adapted to this page's row shape.
 *
 * Everything derived here is derived from fields that route really sends
 * (`owned_scope`, `transport`, `transport_oauth_supported`, `secret_refs`,
 * `setup`), and nothing is offered the old route cannot do:
 *
 * - `sign_in` only for a remote URL whose transport has not ruled OAuth out,
 *   and `set_key` only when the config declares secret references - which is
 *   what removes the "Sign in" dead end on a plain local command here too;
 * - `connect` (the old route's awaited reconnect) stands in for `test`, because
 *   the session route has no probe-only verb;
 * - the transitional `cold` facade becomes `Ready`, and `disconnected` in a
 *   live runtime becomes `Ready` with a Connect action.
 *
 * `project_scope_available` is inferred: true only when some row really is
 * project-owned. The old route cannot say whether a separate project file
 * exists, and assuming one would print "Global" on every row of the common
 * cwd = `~` case, where there is nothing on the other side of the distinction.
 * The scope collision this route hides (U8) is fixed on the catalog route.
 */
export function catalogFromSessionState(
	state: DesktopMcpState | undefined,
	sessionId: string,
): IntegrationDocument {
	const cold = Boolean(state?.cold);
	const servers = (state?.servers ?? []).map((server): IntegrationRow => {
		const remote = server.transport === "http";
		const refs = server.secret_refs ?? [];
		const status: IntegrationRow["status"] =
			server.status === "connected"
				? "connected"
				: server.status === "connecting"
					? "connecting"
					: server.status === "auth-required"
						? "needs_sign_in"
						: "not_started";
		const actions: IntegrationAction[] = [];
		if (status !== "connected") actions.push("connect");
		if (status === "connected") actions.push("disconnect");
		if (!cold) actions.push("reload");
		if (remote && server.transport_oauth_supported !== false)
			actions.push("sign_in");
		if (refs.length > 0) actions.push("set_key");
		if (server.owned_scope) actions.push("remove");
		if (server.setup?.text) actions.push("copy_setup");
		const origin = foreignMcpConfigOrigin(server.source);
		return {
			id: server.name,
			name: server.name,
			scope: server.owned_scope ?? "global",
			project_path: null,
			source: {
				kind: sourceKindFor(server.source, origin, server.owned_scope),
				path: server.source ?? "",
				editable: server.owned_scope !== null,
				owned_scope: server.owned_scope,
			},
			transport: remote ? "remote_url" : "local_command",
			endpoint: { command: null, url: null, endpoint_redacted: false },
			status,
			status_reason: null,
			status_observed_at: null,
			status_basis: cold ? "stored" : "live",
			auth: {
				kind: refs.length ? "api_key" : remote ? "unknown" : "none",
				signed_in: null,
				secret_refs: refs.map((ref) => ({ id: ref.id, state: "missing" })),
			},
			tool_count:
				typeof server.tool_count === "number" ? server.tool_count : null,
			tool_count_basis: typeof server.tool_count === "number" ? "live" : null,
			actions,
			setup_prompt: server.setup?.text ?? null,
		};
	});
	return {
		cwd: "",
		project_scope_available: servers.some(
			(server) => server.source.owned_scope === "project",
		),
		global_path: "",
		project_path: null,
		status_source: cold ? "config" : "live",
		session_id: sessionId,
		servers,
		operations: (state?.operations ?? []).map((op) => ({ ...op })),
	};
}

const sourceKindFor = (
	source: string | null,
	origin: string | null,
	owned: "global" | "project" | null,
): McpCatalogRow["source"]["kind"] => {
	if (origin === "Claude Code") return "claude-code";
	if (origin === "Cursor") return "cursor";
	if (origin === "VS Code") return "vscode";
	if (origin === "Codex CLI") return "codex";
	if (owned) return "local-operator";
	return source ? "project-mcp-json" : "local-operator";
};

/* ------------------------------------------------------- refusal copy */

/**
 * The catalog route's bounded refusal codes (backend § 4.5), in the user's
 * terms. Codes, never the backend's text: config errors can quote credentials,
 * which is why the backend sends a category rather than the exception.
 */
export const CATALOG_REFUSAL_COPY: Record<string, string> = {
	exists: "An integration with this name already exists. Choose another name.",
	not_owned:
		"It's defined in another tool's config, so it can't be changed here. Edit it in that file.",
	project_scope_unavailable:
		"There's no separate project config here, so it can only be added globally.",
	unknown_server: "It no longer exists. The list has been refreshed.",
	oauth_unsupported: "It doesn't use browser sign-in.",
	grant_running:
		"A sign-in or test is already running. Wait for it to finish, or cancel it.",
	too_many_operations:
		"Too many sign-ins and tests are waiting. Try again in a moment.",
	write_failed:
		"The config file couldn't be written. Check that it isn't read-only.",
	mcp_starting: "Integrations are still starting. Try again in a moment.",
};

/**
 * The sentence a failed control shows.
 *
 * A catalog refusal carries a bounded CODE (`detail.code`) and is worded from
 * that; every other failure goes through `mcpFailure`, which already words the
 * session route's refusals, pairing refusals and transport failures - so no
 * surface on this page prints a caught message verbatim.
 */
export function integrationFailureMessage(
	phase: McpFailurePhase,
	cause: unknown,
	grantRunning: boolean,
): string {
	if (
		cause instanceof DesktopControlError &&
		cause.status === 409 &&
		typeof cause.code === "string" &&
		cause.code in CATALOG_REFUSAL_COPY
	)
		return `${MCP_FAILURE_LEAD[phase]}. ${CATALOG_REFUSAL_COPY[cause.code]}`;
	return mcpFailure(phase, cause, grantRunning).message;
}
