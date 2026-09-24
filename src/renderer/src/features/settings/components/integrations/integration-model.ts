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
 * The statuses this page knows how to word, as a RUNTIME value.
 *
 * A type alone cannot be compared to anything at run time, and the thing that
 * has to be compared is a BACKEND's vocabulary: the catalog's `status` is the
 * backend's to extend, and a value this renderer has never seen used to fall
 * through a `default:` branch to "Ready" - a health claim about a row whose
 * state nobody read. So the list is a value, `integrationStatus` refuses
 * anything outside it in words, and `scripts/mcp-catalog-parity.test.mjs`
 * asserts the backend's own pinned payload is inside it.
 */
export const INTEGRATION_STATUSES = [
	"connected",
	"needs_sign_in",
	"not_started",
	"connecting",
	"error",
] as const;

export type IntegrationStatusValue = (typeof INTEGRATION_STATUSES)[number];

/** Whether a word off the wire is one this page can describe. */
export const isKnownIntegrationStatus = (
	status: string,
): status is IntegrationStatusValue =>
	(INTEGRATION_STATUSES as readonly string[]).includes(status);

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
 * What this renderer REMEMBERS about a row between reads.
 *
 * WHY THE PAGE HAS MEMORY AT ALL. Three of round 1's findings are the same
 * defect seen from three sides: the payload describes a row's state, and a
 * state word alone is not enough to be true about it. An expired probe and a
 * never-tested server both arrive as `not_started`/`stored`; a server that just
 * signed out and one that was just added arrive the same way; and a re-test and
 * a first test both arrive as `connecting`. The backend cannot distinguish them
 * in a single reading without inventing state of its own, and the page CAN,
 * because it watched the transitions happen:
 *
 * - `connectedAt` / `connectedToolCount` - the last read that said this row was
 *   working, so an expired check can keep its last RESULT ("Worked 6 min ago ·
 *   1 tool", U1) instead of decaying into the idle word;
 * - `settledGroup` / `pinnedGroup` - where the row was at the last quiet read,
 *   so a failed row being re-tested does not jump to Ready under the pointer
 *   (F5). The PIN is what makes the claim in `integrationGroupOf` true: the
 *   group is read from the row BEFORE its operation started, because the moment
 *   the operation appears the backend has already rewritten the row's status to
 *   `connecting` and the previous group is no longer in the payload;
 * - `needsKey` - a sign-in that failed because the server publishes no OAuth
 *   metadata, which is when the page must offer the key route even though the
 *   backend cannot yet offer it in `actions` (U3).
 *
 * Nothing here is invented: each field records something the backend DID say,
 * or an action the user DID take, and every one of them is dropped as soon as a
 * read contradicts it.
 */
export type RowMemory = {
	/** Milliseconds since the epoch, from the read that last saw it working. */
	connectedAt: number | null;
	connectedToolCount: number | null;
	/**
	 * The group this row occupied at the last read where NOTHING was in flight.
	 * This is the only honest answer to "where was it before the press".
	 */
	settledGroup: IntegrationGroupId | null;
	/** Where a running operation's row is pinned, and which operation pinned it. */
	pinnedGroup: IntegrationGroupId | null;
	pinnedOperationId: string | null;
	needsKey: boolean;
};

export type RowMemories = Record<string, RowMemory | undefined>;

/** No prior readings: every rule that needs memory stands down. */
export const NO_MEMORY: RowMemory = {
	connectedAt: null,
	connectedToolCount: null,
	settledGroup: null,
	pinnedGroup: null,
	pinnedOperationId: null,
	needsKey: false,
};

/** The row's memory, or the empty one, so callers never branch on undefined. */
export const memoryFor = (
	memories: RowMemories | undefined,
	name: string,
): RowMemory => memories?.[name] ?? NO_MEMORY;

/**
 * The newest operation recorded for a row, running or settled.
 *
 * `runningOperationFor` answers "is something in flight"; this answers "what
 * happened last", which is what the sign-out and failed-sign-in wordings need.
 */
export const latestOperationFor = (
	name: string,
	operations: readonly McpCatalogOperation[],
): McpCatalogOperation | null =>
	[...operations]
		.filter((op) => op.name === name)
		.sort((a, b) => b.created_at - a.created_at)[0] ?? null;

/** Which of the two names the backend uses for "collect a key for this row". */
export const offersKey = (row: Pick<IntegrationRow, "actions">): boolean =>
	row.actions.includes("set_key") || row.actions.includes("add_key");

/**
 * How long ago, in words a row can carry: "just now", "6 min ago", "2 h ago".
 *
 * Coarse on purpose. The claim being made is "this worked recently", and a
 * second-accurate figure would be both unreadable and false precision about a
 * check the backend re-runs on its own schedule.
 */
export function relativeTime(now: number, then: number): string {
	const seconds = Math.max(0, Math.round((now - then) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return `${Math.round(hours / 24)} d ago`;
}

/**
 * The backend's reason as this page may show it.
 *
 * Two things are removed, both found by the walks:
 * - a TRANSPORT PREFIX ("Connection closed: Error: NOTION_TOKEN is not set"),
 *   which names a hop the user cannot act on and buries the server's own
 *   sentence (U7);
 * - a TERMINAL COMMAND ("/mcp login linear to authorize"), which tells a
 *   Settings user to type a slash command into a chat, directly beside a
 *   working Sign in button (U7, Q4). A reason that is ONLY that command is
 *   dropped rather than reworded: the row's own action already says what to do.
 */
export function publicRowReason(
	reason: string | null | undefined,
): string | null {
	if (!reason) return null;
	const trimmed = reason.trim();
	if (!trimmed) return null;
	if (/^\/\w/.test(trimmed) || /\/mcp\s+\w+/.test(trimmed)) return null;
	let text = trimmed;
	for (let i = 0; i < 3; i += 1) {
		const next = text
			.replace(
				/^(?:connection (?:closed|error|refused)|error|closed|failed)\s*:\s*/i,
				"",
			)
			.trim();
		if (next === text) break;
		text = next;
	}
	return text || null;
}

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
	memories?: RowMemories,
	now: number = Date.now(),
): IntegrationStatusView {
	const memory = memoryFor(memories, row.name);
	const running = runningOperationFor(row.name, operations);
	/*
	 * An operation in flight is a fact this renderer HOLDS, whatever the status
	 * word says, so it is reported first - and each operation is named for what
	 * it is doing. A sign-out that reads "Connecting…" is the app describing a
	 * disconnect as a connection (U2); a sign-in that reads "Needs sign-in"
	 * beside an open dialog reads as the press having done nothing.
	 */
	if (running) {
		if (running.action === "login" || running.action === "reauth")
			return { label: "Signing in…", tone: "info", detail: null, busy: true };
		if (running.action === "logout")
			return { label: "Signing out…", tone: "info", detail: null, busy: true };
	}
	/*
	 * A status this build cannot word is stated as such: rendering it as "Ready"
	 * would be the app claiming a row is fine on the strength of not
	 * recognising the word, and a new backend state is exactly how that happens
	 * (see `INTEGRATION_STATUSES`).
	 */
	if (!isKnownIntegrationStatus(row.status))
		return {
			label: "Status unavailable",
			tone: "neutral",
			detail: null,
			busy: false,
		};
	/*
	 * What the row's last operation was, for the two states the payload alone
	 * cannot word: a sign-out the user just performed, and a sign-in that
	 * failed. Both are the backend's own records, not this page's guess.
	 */
	const lastOperation = latestOperationFor(row.name, operations);
	const signedOut =
		lastOperation?.action === "logout" &&
		lastOperation.status !== "running" &&
		row.status !== "connected";
	const lastSignInFailed =
		(lastOperation?.action === "login" || lastOperation?.action === "reauth") &&
		lastOperation.status === "failed";

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
				/*
				 * "Needs a key" whenever a key is the credential this row is
				 * short of: either the config declares one (`api_key`), or the
				 * backend's own failure record says it publishes no authorization
				 * server - in which case "Needs sign-in" is a claim the row can
				 * contradict with the button next to it (U3).
				 */
				label:
					row.auth.kind === "api_key" || needsKeyFor(row, operations, memory)
						? "Needs a key"
						: "Needs sign-in",
				tone: "warning",
				// Only the backend's own reason, and only when it says something
				// the row's own action does not (see `publicRowReason`).
				detail: publicRowReason(row.status_reason),
				busy: false,
			};
		case "error":
			return {
				label: "Couldn't start",
				tone: "danger",
				// The reason is the whole point of the state (N4, U5): a failure with no
				// cause is a dead end. When the backend sent none, or sent only a
				// terminal command, say so rather than leaving the line out and implying
				// there was nothing to say.
				detail: publicRowReason(row.status_reason) ?? "No reason was given.",
				busy: false,
			};
		default:
			/*
			 * `not_started`, which is four different situations wearing one word.
			 * Each branch below is a fact this renderer holds about how the row
			 * got here, and "Ready" is left for the one case it can honestly
			 * mean: added, and not checked since.
			 */
			if (signedOut)
				return {
					label: "Signed out",
					tone: "warning",
					detail: null,
					busy: false,
				};
			/*
			 * A sign-in that failed for want of OAuth metadata leaves the row as
			 * the backend's `not_started`, but the user's next step is a key -
			 * and nobody discovers that by pressing Sign in again (U3).
			 */
			/*
			 * The same rule the row's action uses (`needsKeyFor`), so the words
			 * and the button can never disagree: the discovery comes either from
			 * the code a refused sign-in crossed with, or from the message a
			 * FAILED sign-in recorded.
			 */
			if (needsKeyFor(row, operations, memory))
				return {
					label: "Needs a key",
					tone: "warning",
					detail: null,
					busy: false,
				};
			if (lastSignInFailed)
				return {
					label: "Sign-in didn't finish",
					tone: "warning",
					detail: null,
					busy: false,
				};
			/*
			 * An expired check keeps its last RESULT rather than decaying into
			 * the idle word: the row worked, and how long ago is the useful part
			 * (U1). It needs a remembered reading, plus a count the backend still
			 * stands behind - and it must not outrank a sign-out, which is
			 * handled above.
			 */
			if (memory.connectedAt !== null && typeof row.tool_count === "number")
				return {
					label: `Worked ${relativeTime(now, memory.connectedAt)} · ${toolCountLabel(row.tool_count)}`,
					tone: "success",
					detail: null,
					busy: false,
				};
			/*
			 * A LIVE runtime saying `not_started` is a chat that has this server
			 * configured and is not connected to it. "Ready" would claim nothing
			 * is wrong and that it starts when a chat uses it - while a chat is
			 * using it and it is not starting (F3).
			 */
			if (row.status_basis === "live")
				return {
					label: "Not connected",
					tone: "neutral",
					detail: null,
					busy: false,
				};
			// No detail line: "Ready" on every idle row followed by the same sentence
			// would be the loudest thing on a page of healthy servers. The sentence
			// is the status's tooltip instead (`READY_EXPLANATION`).
			return { label: "Ready", tone: "neutral", detail: null, busy: false };
	}
}

/** What "Ready" means, for the status's tooltip. */
export const READY_EXPLANATION =
	"Nothing is wrong. It starts when a chat uses it.";

/** What "Not connected" means, for a row a live chat is not using. */
export const NOT_CONNECTED_EXPLANATION =
	"Not running in this chat. Connect to start it.";

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
		parts.push(`${toolCountLabel(row.tool_count)} when last checked`);
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
	/**
	 * How the button is drawn, when the action is one the row does not need
	 * fixed. Only a FIRST Test - a row added and not yet checked - is a ghost,
	 * so the outlined secondary weight is spent on the rows that are actually
	 * asking for something (D1).
	 */
	variant?: "secondary" | "ghost";
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
	memories?: RowMemories,
): PrimaryAction | null {
	const memory = memoryFor(memories, row.name);
	const running = runningOperationFor(row.name, operations);
	if (running) {
		/*
		 * A sign-in in flight keeps its link reachable (U4): dismissing the
		 * dialog used to leave a "Signing in…" row with no action at all, so the
		 * only way back to the authorization link was Cancel. The row leads with
		 * the control that reopens the dialog, and Cancel stays in the overflow
		 * beside it.
		 */
		if (running.action === "login" || running.action === "reauth")
			return { kind: "sign_in", label: "Continue sign-in" };
		return null;
	}
	const has = (action: IntegrationAction) => row.actions.includes(action);
	const key = offersKey(row);
	const maybeNeedsKey = needsKeyFor(row, operations, memory);
	// An unreadable status still gets the one control that can answer it: ask
	// the backend again. The audit's own table gives this row "Check again".
	if (!isKnownIntegrationStatus(row.status))
		return has("test") ? { kind: "test", label: "Check again" } : null;
	const lastOperation = latestOperationFor(row.name, operations);
	const signInFailed =
		lastOperation?.status === "failed" && isSignInAction(lastOperation);
	switch (row.status) {
		case "connected":
		case "connecting":
			return null;
		case "needs_sign_in":
			// The key route is the one that works when the server publishes no
			// OAuth metadata, so it leads over a Sign in that cannot (U3).
			if (maybeNeedsKey && key) return { kind: "set_key", label: "Add key" };
			if (has("sign_in")) return { kind: "sign_in", label: "Sign in" };
			if (key) return { kind: "set_key", label: "Add key" };
			if (has("reauth")) return { kind: "reauth", label: "Sign in again" };
			return { kind: "fix", label: "Fix" };
		case "error":
			if (has("connect")) return { kind: "connect", label: "Reconnect" };
			if (has("test")) return { kind: "test", label: "Retry" };
			return { kind: "fix", label: "Fix" };
		default: {
			// Signed out: the user just removed the credential, so signing in
			// again is the next step, not an idle "Ready" (U2).
			if (isSignedOut(lastOperation) && has("sign_in"))
				return { kind: "sign_in", label: "Sign in" };
			if (maybeNeedsKey && key) return { kind: "set_key", label: "Add key" };
			if (signInFailed && has("sign_in"))
				return { kind: "sign_in", label: "Try again" };
			/*
			 * A row that HAS been checked leads with nothing (D1): its Test is in
			 * the overflow, exactly where a connected row's Test already is, so a
			 * page of ten idle servers is not a column of ten identical buttons
			 * (audit D8, one button per row instead of four).
			 */
			if (
				memory.connectedAt !== null &&
				typeof row.tool_count === "number" &&
				!has("connect")
			)
				return null;
			/*
			 * Starting it is NOT a re-test, so the demotion above does not apply:
			 * `connect` is offered by a live runtime (the catalog route offers it
			 * only with facts in hand) and by the session route, where it is the
			 * only verb that can start a server at all.
			 */
			if (has("connect")) return { kind: "connect", label: "Connect" };
			/*
			 * A row that has never been checked keeps its Test findable, and
			 * ghost so it ranks below the secondary buttons on the rows that need
			 * something (D1).
			 */
			if (
				has("test") &&
				row.tool_count === null &&
				row.tool_count_basis === null
			)
				return { kind: "test", label: "Test", variant: "ghost" };
			return null;
		}
	}
}

/** Whether an operation is one of the two that establish a grant. */
export const isSignInAction = (operation: McpCatalogOperation): boolean =>
	operation.action === "login" || operation.action === "reauth";

/** Whether an operation is a completed sign-out. */
export const isSignedOut = (operation: McpCatalogOperation | null): boolean =>
	Boolean(
		operation &&
			operation.action === "logout" &&
			operation.status !== "running",
	);

/**
 * Whether this row's credential route is a key rather than a browser grant.
 *
 * Two sources, both the backend's: the code a refused sign-in crossed HTTP with
 * (`oauth_unsupported`), remembered here because no operation exists for a
 * refusal; and the message a FAILED sign-in recorded, which is where the
 * backend says in its own words that it found no authorization server. The
 * second is checked against the operation record rather than against a sentence
 * this page wrote, so a backend that rewords it only removes the fallback, and
 * never invents a "Needs a key" for a server that would have signed in.
 */
export const NO_OAUTH_METADATA = /no oauth authorization server/i;

export function needsKeyFor(
	row: IntegrationRow,
	operations: readonly McpCatalogOperation[],
	memory: RowMemory,
): boolean {
	if (!offersKey(row)) return false;
	const lastOperation = latestOperationFor(row.name, operations);
	if (
		lastOperation &&
		isSignInAction(lastOperation) &&
		lastOperation.status === "failed" &&
		NO_OAUTH_METADATA.test(lastOperation.message ?? "")
	)
		return true;
	return memory.needsKey;
}

export type OverflowItem =
	| {
			kind:
				| "test"
				| "connect"
				| "sign_in"
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
	memories?: RowMemories,
): OverflowItem[] {
	const primary = primaryAction(row, operations, memories)?.kind;
	const has = (action: IntegrationAction) => row.actions.includes(action);
	const items: OverflowItem[] = [];
	const running = runningOperationFor(row.name, operations);
	if (running) items.push({ kind: "cancel", label: "Cancel" });
	if (!running && has("test") && primary !== "test")
		items.push({ kind: "test", label: "Test connection" });
	if (has("connect") && primary !== "connect" && row.status !== "connected")
		items.push({ kind: "connect", label: "Reconnect" });
	/*
	 * A plain Sign in belongs in the menu as well as on the button: a row can
	 * offer it without leading with it (an imported remote row the app has never
	 * checked), and an action offered only as a primary is unreachable once the
	 * primary changes.
	 */
	if (
		!running &&
		has("sign_in") &&
		primary !== "sign_in" &&
		row.status !== "connected"
	)
		items.push({ kind: "sign_in", label: "Sign in" });
	if (has("reload")) items.push({ kind: "reload", label: "Reload" });
	if (!running && has("reauth") && primary !== "reauth")
		items.push({ kind: "reauth", label: "Sign in again" });
	if (offersKey(row) && primary !== "set_key")
		items.push({
			kind: "set_key",
			// "Add key" when there is no key yet, "Update key" when the config
			// declares one: the same control, named for what pressing it does.
			label: row.auth.secret_refs.length > 0 ? "Update key" : "Add key",
		});
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
	/*
	 * "Available", not "Ready": the group holds every row that is fine and not
	 * doing anything right now, and a live runtime's row reads "Not connected"
	 * inside it (F3) - a heading of "Ready" over a row saying "Not connected" is
	 * two words disagreeing on screen.
	 */
	ready: "Available",
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
	memories?: RowMemories,
): IntegrationGroupId {
	const memory = memoryFor(memories, row.name);
	const running = runningOperationFor(row.name, operations);
	/*
	 * A row with an operation in flight STAYS in the group it was in when the
	 * press happened (F5). The backend rewrites the row to `connecting` the
	 * moment an operation starts, so the previous group is not in the payload
	 * any more - which is why it is remembered rather than re-derived: pressing
	 * Retry on a failed row used to move it from Needs attention to Ready under
	 * the pointer and move it back if the test failed.
	 */
	if (running && memory.pinnedGroup && memory.pinnedOperationId === running.id)
		return memory.pinnedGroup;
	// An unreadable status is NOT put under Needs attention: nothing has been
	// observed to be wrong with it, and the row's own words already say the
	// status could not be read. It sits with the idle rows and offers "Check
	// again".
	if (row.status === "needs_sign_in" || row.status === "error")
		return "attention";
	const lastOperation = latestOperationFor(row.name, operations);
	// A sign-out and a failed sign-in are the user's own last acts on the row,
	// and both leave it needing a credential (U2, U3).
	if (isSignedOut(lastOperation) && row.status !== "connected")
		return "attention";
	if (needsKeyFor(row, operations, memory)) return "attention";
	if (
		lastOperation?.status === "failed" &&
		isSignInAction(lastOperation) &&
		row.status !== "connected"
	)
		return "attention";
	if (row.status === "connected") return "connected";
	// A check that expired keeps its last RESULT and its group (U1): the row
	// worked recently and moves only when something actually changed.
	if (memory.connectedAt !== null && typeof row.tool_count === "number")
		return "connected";
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
	memories?: RowMemories,
): IntegrationGroup[] {
	const order: IntegrationGroupId[] = ["attention", "connected", "ready"];
	return order
		.map((id) => ({
			id,
			title: GROUP_TITLES[id],
			rows: rows.filter(
				(row) => integrationGroupOf(row, operations, memories) === id,
			),
		}))
		.filter((group) => group.rows.length > 0);
}

/**
 * The next memories, from the previous ones and this read.
 *
 * A pure function of (what we remembered, what the backend just said), so the
 * behaviour it enables - an expired check keeping its last result (U1), a
 * re-tested row holding its group (F5) - is testable without a component.
 *
 * The three rules, and why each is a rule:
 * - a read that says `connected` on a PROBE or a live runtime stamps the time,
 *   which is the only moment this page is allowed to start saying "worked
 *   recently";
 * - a completed sign-out CLEARS that stamp, because the credential is gone and
 *   "worked 6 min ago" would describe a health that no longer exists;
 * - a running operation is pinned to the group the row held at the last QUIET
 *   read. The pin is dropped the moment that operation settles, so the row is
 *   never stuck in a group its own backend answer contradicts.
 */
export function advanceMemories(
	previous: RowMemories | undefined,
	document: Pick<IntegrationDocument, "servers" | "operations"> | undefined,
	now: number = Date.now(),
): RowMemories {
	if (!document) return previous ?? {};
	const next: RowMemories = {};
	for (const row of document.servers) {
		const before = memoryFor(previous, row.name);
		const running = runningOperationFor(row.name, document.operations);
		const lastOperation = latestOperationFor(row.name, document.operations);
		const signedOut = isSignedOut(lastOperation);
		const connected =
			row.status === "connected" &&
			(row.status_basis === "probe" || row.status_basis === "live");
		const keepResult = !signedOut;
		const failure =
			lastOperation?.status === "failed" &&
			isSignInAction(lastOperation) &&
			NO_OAUTH_METADATA.test(lastOperation.message ?? "");
		const memory: RowMemory = {
			connectedAt: connected ? now : keepResult ? before.connectedAt : null,
			connectedToolCount: connected
				? (row.tool_count ?? before.connectedToolCount)
				: keepResult
					? before.connectedToolCount
					: null,
			settledGroup: before.settledGroup,
			pinnedGroup:
				running && before.pinnedOperationId === running.id
					? before.pinnedGroup
					: running
						? before.settledGroup
						: null,
			pinnedOperationId: running ? running.id : null,
			// Sticky until the row is connected again: the discovery that a
			// server has no authorization server does not expire with the
			// operation that revealed it.
			needsKey: connected ? false : before.needsKey || failure,
		};
		/*
		 * The group the row occupies while nothing is in flight. Read with THIS
		 * read's memory (so a settled check keeps its group) and with no pin (it
		 * is by definition not running).
		 */
		if (!running)
			memory.settledGroup = integrationGroupOf(row, document.operations, {
				...next,
				[row.name]: memory,
			});
		next[row.name] = memory;
	}
	return next;
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
			// The old route cannot say which directory a project row came from,
			// and inventing one would put a wrong "This project" on the row.
			project_cwd: null,
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
	invalid_config:
		"That configuration isn't valid. Check the command or the URL, then try again.",
	operation_unavailable:
		"That sign-in or test isn't running any more. Try again.",
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
	/*
	 * The backend's own catch-all (`REFUSAL_MESSAGES` in `mcp/desktop.py`), and
	 * this file's fallback for a code it does not know: the code set is the
	 * BACKEND's to extend, so a new one must degrade to a true sentence about
	 * what happened rather than to a crash or to silence. `mcp_control_refused`
	 * is named explicitly because it is the code the session route has always
	 * answered with.
	 */
	mcp_control_refused: "The server refused it, so nothing was changed.",
};

/**
 * What an unrecognised refusal code says.
 *
 * Deliberately not the backend's message: that is the text the app may not
 * quote (a config error can carry a credential), and the code is the fact this
 * renderer is allowed to know. A code this build has never seen is still a
 * refusal, so the reader gets the honest generic sentence and the row keeps its
 * own controls.
 */
export const CATALOG_REFUSAL_FALLBACK =
	"The server refused it, so nothing was changed. Try again.";

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
	if (cause instanceof DesktopControlError && cause.status === 409) {
		// `mcp_control_refused` is the session route's blanket code and carries
		// no more detail than an unknown one, so both get the generic sentence.
		/*
		 * OWN keys, not `in`: `in` walks the prototype, so a code of "toString"
		 * or "constructor" would return a FUNCTION where a sentence belongs (F6).
		 * Written as `hasOwnProperty.call` rather than `Object.hasOwn` because the
		 * renderer's lib target predates ES2022 (TS2550) - same semantics, and the
		 * test pins them.
		 */
		const copy =
			typeof cause.code === "string" &&
			Object.prototype.hasOwnProperty.call(CATALOG_REFUSAL_COPY, cause.code)
				? CATALOG_REFUSAL_COPY[cause.code]
				: CATALOG_REFUSAL_FALLBACK;
		return `${MCP_FAILURE_LEAD[phase]}. ${copy}`;
	}
	return mcpFailure(phase, cause, grantRunning).message;
}
