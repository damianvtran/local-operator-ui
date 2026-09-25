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
 *   backend cannot yet offer it in `actions` (U3);
 * - `needsSignIn` - a read that said this row needs a sign-in, held until the
 *   row is connected. Cancelling a sign-in is a no-op, so the row must not fall
 *   back to the idle word on the strength of the attempt the user abandoned,
 *   and the backend's probe verdict ages out of the payload long before the
 *   user's intent does (U14);
 * - `disconnectedAt` - the moment the USER pressed Disconnect. A live overlay is
 *   optional by contract and degrades to the config answer on identical
 *   back-to-back reads, so one config-only read must not contradict an act the
 *   user just performed (Q2);
 * - `lastDecisive` - the newest settled operation this page has seen for the
 *   row. Operations are scoped to a folder, global rows are not, so a scoped
 *   document must not erase what a global row already recorded (U17).
 *
 * THE STRUCTURE IS SERIALISABLE AND PERSISTED, and that is a constraint, not a
 * detail: the backend publishes no observation time on a `stored` row, so a
 * reading that lives only in this component's ref dies with the reload and the
 * row decays to "Ready" (U10/Q1). The storage layer is in
 * `use-integrations.ts`; what it writes is this shape and nothing else.
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
	needsSignIn: boolean;
	/** Milliseconds since the epoch, from the Disconnect the user pressed. */
	disconnectedAt: number | null;
	/**
	 * Until when the user's OWN control verb outranks a read that contradicts it.
	 *
	 * WHY THIS EXISTS (Q1, round 4, measured live): the page re-reads the list
	 * after a control and the overlay FLAPS - 12 `live` and 8 `config` answers
	 * across 20 identical back-to-back reads, each under half a second - so the
	 * one read that follows a Disconnect can legitimately be the stale one that
	 * still says `connected`. That read used to clear the Disconnect's own mark
	 * and stamp a fresh `connectedAt`, which is how a row the user had just
	 * disconnected read "Worked just now · 2 tools" under Connected with no
	 * Connect offered for the whole 20 s sample - twice out of three runs, and
	 * the third run is why a single read must not decide.
	 *
	 * So the user's act is authoritative until this deadline: inside it, a
	 * contradicting read is not a contradiction, and the row stops claiming any
	 * time-based reading at all. Past it, the newest read wins and this is null
	 * again - the app never holds a claim the backend has stopped supporting.
	 */
	holdUntil: number | null;
	/** The newest settled operation seen here, pruned to what the rules read. */
	lastDecisive: McpCatalogOperation | null;
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
	needsSignIn: false,
	disconnectedAt: null,
	holdUntil: null,
	lastDecisive: null,
};

/**
 * The backend's `last_seen_at` as MILLISECONDS this page may use, or null.
 *
 * The field is epoch SECONDS and set iff `tool_count_basis === "last_seen"`
 * (local-operator#1536). It is the ONE place a second-valued stamp enters this
 * page, and it enters through a named conversion because the same trap has cost
 * this branch twice: a real six-minute-old check once rendered "Worked 20700 d
 * ago" from a second-valued stamp read as milliseconds (M-1), and the parity
 * payload is where the unit is now visible at all.
 *
 * Refused rather than guessed, in both directions: anything at or above
 * `MS_FLOOR` is already milliseconds (some future relay may normalise it, and
 * multiplying it again would be the same bug one field over), and anything below
 * `SECONDS_FLOOR` is not a time in this epoch at all - 2001 in seconds or 1970
 * in milliseconds - so it is dropped rather than rendered as an age.
 */
const MS_FLOOR = 1_000_000_000_000; // 2001-09-09 in milliseconds
const SECONDS_FLOOR = 1_000_000_000; // 2001-09-09 in seconds

/**
 * How far ahead of this machine a stamp may be before it is refused.
 *
 * A minute, for the ordinary skew between two hosts' clocks. The case this
 * exists for is not skew though: a value in the accepted band that is really
 * something else - 999 999 999 999 reads as year 33658 - and `relativeTime`
 * clamps a negative delta to "just now", so an implausible or future stamp
 * rendered `Worked just now` in the success tone, the same words a genuinely
 * fresh count gets (R5-4). "Refused rather than guessed at in either direction"
 * is only true with this bound.
 */
const CLOCK_SKEW_MS = 60_000;

export const lastSeenMillis = (
	value: unknown,
	now: number = Date.now(),
): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	const ms =
		value >= MS_FLOOR ? value : value < SECONDS_FLOOR ? null : value * 1000;
	if (ms === null || ms > now + CLOCK_SKEW_MS) return null;
	return ms;
};

/** The row's memory, or the empty one, so callers never branch on undefined. */
export const memoryFor = (
	memories: RowMemories | undefined,
	name: string,
): RowMemory => memories?.[name] ?? NO_MEMORY;

/**
 * The newest operation this page knows of for a row: this read's, or the one it
 * recorded earlier.
 *
 * Operations are scoped to the document's cwd while global rows are not, so a
 * project document answers `operations: []` for a global row whose last sign-out
 * this page watched happen. Reading only the document made the row's recorded
 * state depend on which chat was open last (U17); the memory is the same fact
 * one read older, which is what the rules here are already allowed to use.
 */
export const rememberedDecisiveFor = (
	name: string,
	operations: readonly McpCatalogOperation[],
	memory: RowMemory | undefined,
): McpCatalogOperation | null =>
	decisiveOperationFor(name, operations) ?? memory?.lastDecisive ?? null;

/**
 * The slice of an operation worth remembering, and the only part that is stored.
 *
 * `authorization_url` and `browser_opened` are deliberately dropped: nothing in
 * this file reads them, and a consent URL is not a thing to keep in a renderer's
 * store after the dialog that showed it has gone.
 */
export const pruneOperation = (
	operation: McpCatalogOperation,
): McpCatalogOperation => ({
	id: operation.id,
	name: operation.name,
	action: operation.action,
	status: operation.status,
	created_at: operation.created_at,
	credential_removed: operation.credential_removed,
	...(operation.message ? { message: operation.message } : {}),
});

/**
 * Whether a row's reading is one that says it WORKED.
 *
 * Two sources, because the backend guarantees only the second: this page's own
 * stamp from a read that saw the row connected, and a `last_seen` tool count on
 * a `stored` row - a count the backend still stands behind with no time
 * attached. Without this, a reload with no memory left the row on "Ready",
 * which is a row the page knows nothing about (U10/Q1).
 */
export const workedReadingOf = (
	row: Pick<
		IntegrationRow,
		"status" | "status_basis" | "tool_count" | "tool_count_basis"
	>,
	memory: RowMemory,
): boolean =>
	/*
	 * `not_started` ONLY, and this predicate is the ONE place that decides
	 * whether a row may claim it worked.
	 *
	 * Why the status is part of it: "Worked …" answers an IDLE row whose check
	 * expired. Every other status has its own words - `needs_sign_in`, `error`,
	 * `connecting`, or one this build does not know - and answering those with a
	 * success-tone reading contradicts the payload the same read carried. That is
	 * not hypothetical: gating on `stored` alone filed an unreadable status
	 * (`status: signed_out`) under Connected while its own label said "Status
	 * unavailable", which the parity set caught (the shipped payload's stored
	 * rows are the ones this predicate must now be measured on).
	 *
	 * Both callers - the status's words and the group it belongs to - read THIS,
	 * so the two can no longer disagree about the same row.
	 */
	row.status === "not_started" &&
	typeof row.tool_count === "number" &&
	(memory.connectedAt !== null ||
		(row.status_basis === "stored" && row.tool_count_basis === "last_seen"));

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

/**
 * The newest operation whose OUTCOME says something about the credential.
 *
 * A CANCELLED operation is not one of them: the user stopped it, so it did not
 * add or remove a credential and the last operation that DID decide is still
 * the truth about the row. Skipping them is what keeps a cancelled attempt from
 * erasing the state it was trying to clear (U14, round 2): cancelling a sign-in
 * on a row whose credential a completed sign-out had removed used to leave the
 * cancelled `login` as the newest operation, which is not a sign-out, so the
 * row decayed to "Ready" with no route back to a key - beside servers that
 * genuinely work. Everything that judges the CREDENTIAL reads this (`isSignedOut`
 * callers, a failed sign-in's wording, the remembered reading); anything asking
 * what is in flight uses `runningOperationFor`.
 */
export const decisiveOperationFor = (
	name: string,
	operations: readonly McpCatalogOperation[],
): McpCatalogOperation | null =>
	latestOperationFor(
		name,
		operations.filter((op) => op.status !== "cancelled"),
	);

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
	/*
	 * An HTTP status in brackets is a number, not an explanation (n4): the row it
	 * sits on already leads with Add key, so "rejected our credentials (401) - set
	 * its API key or headers" told the reader a 401 and "our" while the control
	 * beside it said what to do. The code is stripped and the rest of the
	 * sentence is left as the server's own account of what happened; a number
	 * that is part of a longer token is untouched.
	 */
	text = text
		.replace(/\s*\(\s*\d{3}\s*\)/g, "")
		.replace(/\s+([.,;])/g, "$1")
		.replace(/\s{2,}/g, " ")
		.trim();
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
	const lastOperation = rememberedDecisiveFor(row.name, operations, memory);
	/*
	 * Through the shared predicates, never re-spelled here: this line used to be
	 * its own copy of the rule (`status !== "running"`), so fixing `isSignedOut`
	 * for R2-2 would have left the WORDS still saying "Signed out" on a sign-out
	 * that never happened.
	 */
	const signedOut = isSignedOut(lastOperation) && row.status !== "connected";
	/*
	 * The expired-check reading, resolved once rather than inside the switch: a
	 * declaration directly in a switch clause is a lint error here
	 * (`noSwitchDeclarations`), because another clause can fall into it.
	 */
	/*
	 * THE MEMORY ONLY, NEVER `row.status_observed_at` (M-1). The backend sets that
	 * field on the `live` and `probe` bases alone, so a `stored` row always carries
	 * null there and reading it as a fallback could restore nothing; when a
	 * backend did send it, it is epoch SECONDS while `relativeTime` does
	 * millisecond arithmetic, and a six-minute-old value rendered "Worked 20700 d
	 * ago". `RowMemory.connectedAt` is milliseconds and this page writes it
	 * itself, which is the only unit claim that is safe to make here.
	 */
	const workedBefore = workedReadingOf(row, memory);
	const failedSignOut =
		isFailedSignOut(lastOperation) && row.status !== "connected";
	const lastSignInFailed =
		(lastOperation?.action === "login" || lastOperation?.action === "reauth") &&
		lastOperation.status === "failed";

	/*
	 * A DISCONNECT THE USER PRESSED IS AUTHORITATIVE (Q2, Q1). The backend's live
	 * overlay is optional by contract and is measured degrading to the config
	 * answer on identical back-to-back reads (12 live / 8 config in 20 reads
	 * inside one second), so the read this page makes after a Disconnect can
	 * legitimately be the stale half of that flap - and read as health it made
	 * the row say "Worked just now" with no Connect, while the backend said not
	 * connected. The user just said this server should stop; until a read
	 * CONFIRMS it is connected again, the row says so.
	 *
	 * IT SITS ABOVE THE STATUS SWITCH, which is where the round-4 finding came
	 * from: it used to live inside the `not_started` case, and the case this
	 * exists for - a live read that still says `connected` - had already
	 * returned its success words by then. Nothing the press is newer than
	 * outranks it either: `connecting` and `error` are readings taken before the
	 * press, and the sign-out wordings above are newer facts than it. It EXPIRES
	 * by time rather than being cleared (`RowMemory.holdUntil`), so a row cannot
	 * hold it longer than the window the hook opened.
	 */
	if (memory.disconnectedAt !== null)
		return {
			label: "Not connected",
			tone: "neutral",
			detail: null,
			busy: false,
		};

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
			 * A sign-out that failed or was cancelled is the user's own last act
			 * on the row, and the one thing it did NOT do is take the credential
			 * away. Its own sentence, and the reason it gives if the backend sent
			 * one (R2-2).
			 */
			if (failedSignOut)
				return {
					label: "Sign-out didn't finish",
					tone: "warning",
					/*
					 * PLAIN WORDS, NOT THE BACKEND'S DEVELOPER TEXT (U16). The raw reason
					 * here was a SQLite error on a readonly database and a warning that a
					 * "fresh grant would silently reuse it" - true, alarming, and no help
					 * at all to the person looking at the row. The technical text belongs in
					 * the config/file view, which is where a reader debugging a lock goes;
					 * the row states what did or did not happen and the step that retries.
					 */
					/*
					 * "Try Sign out again." used to follow this sentence, which is
					 * the `Sign out again` button to the row's right read aloud
					 * (D21). The first sentence is the one that earns its place: it
					 * is what tells a failed sign-out apart from a completed one,
					 * and why the row warns rather than claims success.
					 */
					detail: "The sign-in is still saved.",
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
			 * A read that said this row needs a sign-in still stands after an attempt
			 * the user CANCELLED (U14). Cancelling is a no-op, and the backend's own
			 * probe verdict ages out of the payload - what is left is a bare
			 * `not_started`, so the row was filed under Available with no primary
			 * action on the strength of the attempt the user abandoned. Held until a
			 * read says the row is connected.
			 */
			if (memory.needsSignIn)
				return {
					label:
						row.auth.kind === "api_key" || needsKeyFor(row, operations, memory)
							? "Needs a key"
							: "Needs sign-in",
					tone: "warning",
					detail: publicRowReason(row.status_reason),
					busy: false,
				};
			/*
			 * An expired check keeps its last RESULT rather than decaying into
			 * the idle word: the row worked, and how long ago is the useful part
			 * (U1). It needs a remembered reading, plus a count the backend still
			 * stands behind - and it must not outrank a sign-out, which is
			 * handled above.
			 */
			/*
			 * `stored` ONLY. The memory exists for the case where the backend's
			 * own probe result has aged out, so it can restore a reading the
			 * STATUS still stands behind. A LIVE runtime saying `not_started` is
			 * the opposite situation: the chat is telling us the server is not
			 * connected right now, and answering that with "Worked 3 min ago -
			 * 12 tools" in a success tone, under Connected, is the app reporting
			 * a health the same payload just contradicted (R2-3, round 2: a live
			 * Disconnect read exactly that way).
			 */
			if (
				row.status_basis === "stored" &&
				workedBefore &&
				memory.disconnectedAt === null
			) {
				/*
				 * WHICH time, and why the payload may supply it (R4-3): this page's
				 * own memory is the fresher reading when it has one, and otherwise
				 * the backend's `last_seen_at` is the only time there is - epoch
				 * SECONDS, converted once by `lastSeenMillis` and never inline.
				 * `null` still means "no time at all", which is the honest
				 * "Worked earlier": the vaguer of the two readings the payload
				 * supports is the right one only when nothing better is published.
				 */
				const workedAt =
					memory.connectedAt ?? lastSeenMillis(row.last_seen_at, now);
				return {
					label:
						workedAt !== null
							? `Worked ${relativeTime(now, workedAt)} · ${toolCountLabel(row.tool_count as number)}`
							: `Worked earlier · ${toolCountLabel(row.tool_count as number)}`,
					tone: "success",
					detail: null,
					busy: false,
				};
			}
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

/**
 * The label the key dialog's replace checkbox carries, for `count` fields.
 *
 * Shared with `credentialsRefusalMessage` in `use-integrations.ts`: the refusal
 * sentence names this control, so a sentence and a checkbox that derived their
 * wording separately is exactly how the dialog came to name a control it did not
 * draw (U15, n-3).
 */
export const replaceControlLabel = (count: number): string =>
	count === 1 ? "Replace the saved key" : "Replace saved keys";

/**
 * The server's own failure sentence, minus any advice this row cannot take.
 *
 * The backend's `oauth_unsupported` reason ends "...or add its key instead",
 * which is right on a row that offers the key route, and on a row that does not
 * it names a control the surface never draws - the same defect `signInNextStep`
 * was fixed for (D15), one line further up the same dialog (n-1, U11's
 * remaining contradiction). The clause is DROPPED rather than reworded:
 * everything the server said about what happened stands, and this page has no
 * business improving on the rest.
 */
export const SIGN_IN_KEY_ADVICE =
	/[,;]?\s*(?:or|and)?\s*add (?:its|a|the) key instead\.?\s*$/i;

export function publicSignInReason(
	reason: string | null | undefined,
	keyRoute: boolean,
): string | null {
	const trimmed = reason?.trim() ?? "";
	if (!trimmed) return null;
	if (keyRoute) return trimmed;
	const stripped = trimmed.replace(SIGN_IN_KEY_ADVICE, "").trim();
	if (!stripped) return trimmed;
	return /\.$/.test(stripped) ? stripped : `${stripped}.`;
}

/** What "Ready" means, for the status's tooltip. */
export const READY_EXPLANATION =
	"Nothing is wrong. It starts when a chat uses it.";

/** What "Not connected" means, for a row a live chat is not using. */
/**
 * The tooltip on the words "Not connected".
 *
 * It used to end "Connect to start it.", which is the row's own primary read
 * aloud whenever the backend offers one - D21's class of copy, one slot over
 * (R5-6), and it slipped the design sweep because D21 named the `detail`
 * strings and this is a tooltip. It is worse than redundant in one window: when
 * a read comes back on the config arm, which carries no `connect` action by
 * contract, the row reads "Not connected" with only its menu for about two
 * seconds, and the old sentence named a control that was not on screen (D15's
 * rule). What is left says the state and why the row is nonetheless one of the
 * fine ones - each chat runs its own servers - and leaves the control, when
 * there is one, to say itself.
 */
export const NOT_CONNECTED_EXPLANATION = "Not running in this chat.";

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
	kind:
		| "sign_in"
		| "set_key"
		| "reauth"
		| "test"
		| "connect"
		| "fix"
		| "sign_out";
	label: string;
	/**
	 * How the button is drawn, when the action is one the row does not need
	 * fixed. Only a FIRST Test - a row added and not yet checked - and a Connect
	 * on a row with no memory behind it are ghosts, so the outlined secondary
	 * weight is spent on the rows that are actually asking for something (D1,
	 * D13).
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
/**
 * The status the page ACTS on, which is not always the one the read carried.
 *
 * A Disconnect the user pressed is newer than the read that arrived after it
 * (`RowMemory.holdUntil`), so while it stands the row is treated as NOT
 * connected - and this is the single place that substitution is made, so the
 * words, the group and the controls cannot disagree about it.
 *
 * WHY IT HAS TO EXIST SEPARATELY (Q1, round 4): the words said "Not connected"
 * and the controls did not. The payload still reported `connected` - the stale
 * half of the overlay's flap - so `primaryAction` returned null for a connected
 * row, the overflow offered `Disconnect` and no `connect`, and QA measured a row
 * reading "Not connected" with a menu and NOTHING to press, while the backend's
 * own `actions` listed `connect`.
 */
export const effectiveStatus = (
	row: Pick<IntegrationRow, "status">,
	memory: RowMemory,
): IntegrationRow["status"] =>
	memory.disconnectedAt !== null ? "not_started" : row.status;

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
	const lastOperation = rememberedDecisiveFor(row.name, operations, memory);
	const signInFailed =
		lastOperation?.status === "failed" && isSignInAction(lastOperation);
	// The user's own Disconnect is read here as the status it implies, so a row
	// whose payload still says `connected` leads with Connect rather than
	// returning null and leaving the row with nothing to press.
	switch (effectiveStatus(row, memory)) {
		case "connected":
		case "connecting":
			return null;
		case "needs_sign_in":
			/*
			 * THE KEY ROUTE LEADS whenever this page has evidence the server wants
			 * one: it is the route that works when the server publishes no OAuth
			 * metadata (U3), and it is BEFORE the sign-in check so a row offering
			 * both leads with the key (R2-6).
			 *
			 * `key` is NOT required here, and that is deliberate (R2-6): the
			 * credentials write is a page-level capability on the catalog route, so a
			 * row this page has learned wants a key offers Add key even though the
			 * backend's own `actions` list does not name it yet. U11 is the OTHER
			 * half of that rule and is still DEFERRED: with no evidence at all - an
			 * untested server - the page offers Sign in rather than inventing a key
			 * action the backend did not list, because the backend only learns a
			 * server wants a key by watching a Test fail. So this line is not a claim
			 * that the key is always available; it is the page using what it knows.
			 */
			if (maybeNeedsKey) return { kind: "set_key", label: "Add key" };
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
			/*
			 * A sign-out that FAILED leaves the credential exactly where it was and
			 * asks the user to try again (R2-2, m-2): the row's own words already
			 * say "Sign-out didn't finish", and the next step beside them was only
			 * in the overflow. A `sign_out` primary keeps the words and the control
			 * together, which is also why the row sits under Needs attention
			 * (`integrationGroupOf`).
			 */
			if (isFailedSignOut(lastOperation) && has("sign_out"))
				return { kind: "sign_out", label: "Sign out again" };
			/*
			 * A Disconnect leads back the way the user came (Q2): the status reads
			 * "Not connected", so the row must offer the control that connects it -
			 * not the "worked" demotion further down, which would leave a
			 * Not-connected row with no action at all.
			 */
			if (memory.disconnectedAt !== null && has("connect"))
				return { kind: "connect", label: "Connect" };
			/*
			 * A sign-in the user CANCELLED changes nothing, so the row keeps the
			 * route the read that asked for a sign-in offered (U14).
			 */
			if (memory.needsSignIn) {
				if (maybeNeedsKey && key) return { kind: "set_key", label: "Add key" };
				if (has("sign_in")) return { kind: "sign_in", label: "Sign in" };
				// No sign-in in `actions` any more: fall through, so the row leads
				// with a control the backend still offers rather than one it
				// withdrew.
			}
			/*
			 * The key route here only when the backend LISTS one. A cold row is
			 * not asking for credentials - it is asking to be turned on - and
			 * leading with Add key on a `disconnected` row would displace the
			 * Connect that is actually its next step. The key stays reachable in
			 * the overflow (U11's other half is about `needs_sign_in`).
			 */
			if (maybeNeedsKey && key) return { kind: "set_key", label: "Add key" };
			if (signInFailed && has("sign_in"))
				return { kind: "sign_in", label: "Try again" };
			/*
			 * A row that HAS been checked leads with nothing (D1): its Test is in
			 * the overflow, exactly where a connected row's Test already is, so a
			 * page of ten idle servers is not a column of ten identical buttons
			 * (audit D8, one button per row instead of four). The evidence is either
			 * this page's stamp or a `last_seen` count the backend still stands
			 * behind (`workedReadingOf`, Q1), so the same rule covers the row whose
			 * stamp was lost with the reload.
			 */
			if (workedReadingOf(row, memory) && !has("connect")) return null;
			/*
			 * Starting it is NOT a re-test, so the demotion above does not apply:
			 * `connect` is offered by a live runtime (the catalog route offers it
			 * only with facts in hand) and by the session route, where it is the
			 * only verb that can start a server at all.
			 *
			 * GHOST FOR A ROW THAT HAS NEVER BEEN CHECKED (D13, round 2): the
			 * session route's `Ready` rows - `echo`, `gitlab` - carry no memory, so
			 * nothing demoted them and they were drawn as loudly as the `Sign in`
			 * on a row that needs a decision. A row that says nothing is wrong, and
			 * whose Connect only STARTS a server, is an offer rather than a
			 * summons. The live-basis row keeps the outlined weight: `not_started`
			 * from a live runtime is "Not connected", which IS a decision the user
			 * has to make.
			 */
			if (has("connect"))
				return {
					kind: "connect",
					label: "Connect",
					...(memory.connectedAt === null && row.status_basis !== "live"
						? { variant: "ghost" as const }
						: {}),
				};
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

/**
 * Whether an operation is a sign-out the backend COMPLETED.
 *
 * `complete` ONLY. A failed or cancelled sign-out leaves the browser grant
 * exactly where it was, so a row that said "Signed out" on one would be telling
 * the user their account was gone while the credential it never revoked still
 * worked - and it would hide the Sign in they still need (R2-2, round 2).
 */
export const isSignedOut = (operation: McpCatalogOperation | null): boolean =>
	Boolean(
		operation &&
			operation.action === "logout" &&
			operation.status === "complete",
	);

/** Whether an operation is a sign-out that did NOT complete. */
export const isFailedSignOut = (
	operation: McpCatalogOperation | null,
): boolean =>
	Boolean(
		operation &&
			operation.action === "logout" &&
			operation.status !== "running" &&
			operation.status !== "complete",
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
	/*
	 * Gated on the backend's actions list, and that gate is why U11 is still
	 * open: the backend only learns a server wants a key by watching a Test
	 * fail, so an untested key-only server answers "no key route" here and the
	 * page offers a Sign in that cannot work. Widening this to the row's own
	 * `auth.kind` is the fix (see the deferral note on PR #491) - it was written,
	 * and it changes a round-1 assertion about the older session route's Connect
	 * rows, so it is a modelling decision to make deliberately rather than at the
	 * end of a long session.
	 */
	if (!offersKey(row)) return false;
	/*
	 * The remembered operation, not only this document's: `linear`'s failed
	 * sign-in is global while the document may be a project's, and losing the
	 * discovery with the scope is how a row that needs a key read as Ready (U17).
	 */
	const lastOperation = rememberedDecisiveFor(row.name, operations, memory);
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
	// The same substitution the words and the primary make (Q1): a standing
	// Disconnect means the menu offers Connect, not Disconnect.
	const status = effectiveStatus(row, memoryFor(memories, row.name));
	const has = (action: IntegrationAction) => row.actions.includes(action);
	const items: OverflowItem[] = [];
	const running = runningOperationFor(row.name, operations);
	if (running) items.push({ kind: "cancel", label: "Cancel" });
	if (!running && has("test") && primary !== "test")
		items.push({ kind: "test", label: "Test connection" });
	if (has("connect") && primary !== "connect" && status !== "connected")
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
		status !== "connected"
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
	if (has("disconnect") && status === "connected")
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
	 * THE STATUS THIS FUNCTION ACTS ON, through the same substitution the words
	 * and the controls use (R5-3).
	 *
	 * `effectiveStatus` was introduced for Q1 and the round-4 comments called it
	 * the one place the press substitutes the status that the words, the GROUP and
	 * the controls all read - and that was not true of this function. Its own
	 * `disconnectedAt` branch sat BELOW the `needs_sign_in`/`error` branch, so a
	 * held Disconnect whose fresh read said `needs_sign_in` rendered the words
	 * "Not connected" with a `connect` primary while the row sat under Needs
	 * attention: the same words/group disagreement earlier rounds treated as a
	 * defect, inside the very window the fix exists for.
	 */
	const status = effectiveStatus(row, memory);
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
	if (status === "needs_sign_in" || status === "error") return "attention";
	const lastOperation = rememberedDecisiveFor(row.name, operations, memory);
	// A sign-out and a failed sign-in are the user's own last acts on the row,
	// and both leave it needing a credential (U2, U3).
	if (isSignedOut(lastOperation) && status !== "connected") return "attention";
	/*
	 * A sign-out that FAILED belongs where its own words already put it (m-2,
	 * Q3): "Sign-out didn't finish" in a warning tone beside a group of healthy
	 * Ready rows is a row that contradicts its own section - and its group moved
	 * again on a reload, so the two readings disagreed with each other as well as
	 * with the words.
	 */
	if (isFailedSignOut(lastOperation) && status !== "connected")
		return "attention";
	/*
	 * A Disconnect the user pressed takes the row back to the idle group until a
	 * read says it is connected again (Q2), and it is asked BEFORE the credential
	 * questions for the same reason the status asks it there: it is the newest
	 * thing that happened to the row, and the row's words and its group have to
	 * agree.
	 */
	if (memory.disconnectedAt !== null) return "ready";
	if (needsKeyFor(row, operations, memory)) return "attention";
	/*
	 * A read that said this row needs a sign-in keeps it under Needs attention
	 * until something contradicts it (U14): a cancelled attempt is not evidence
	 * about the server, and the backend's own verdict ages out of the payload.
	 */
	if (memory.needsSignIn && status !== "connected") return "attention";
	if (
		lastOperation?.status === "failed" &&
		isSignInAction(lastOperation) &&
		status !== "connected"
	)
		return "attention";
	if (status === "connected") return "connected";
	/*
	 * A check that expired keeps its last RESULT and its group (U1): the row
	 * worked recently and moves only when something actually changed - and only
	 * when the backend's own status still stands behind that reading. A LIVE
	 * runtime reporting `not_started` is not an expired check; it is the chat
	 * saying this server is off, and the group has to follow the payload
	 * (R2-3, round 2: a live Disconnect sat in Connected).
	 *
	 * The evidence is this page's own stamp or a `last_seen` count the backend
	 * still stands behind (`workedReadingOf`), which is what keeps the group
	 * honest across a reload (Q1).
	 */
	if (row.status_basis === "stored" && workedReadingOf(row, memory))
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
		const lastOperation = rememberedDecisiveFor(
			row.name,
			document.operations,
			before,
		);
		const signedOut = isSignedOut(lastOperation);
		const connected =
			row.status === "connected" &&
			(row.status_basis === "probe" || row.status_basis === "live");
		/*
		 * The user's own control verb outranks a contradicting read until its
		 * deadline: see `RowMemory.holdUntil` for the measurement this comes
		 * from. Inside the window the read is the flapping one, so `connected`
		 * is not allowed to clear the Disconnect or stamp a fresh `connectedAt`.
		 */
		const held = before.holdUntil !== null && now < before.holdUntil;
		/*
		 * The backend's own answer to WHEN the count was taken, used only where
		 * this page has nothing better: a `stored` row that still stands behind
		 * a `last_seen` count, with no memory of its own and no user action in
		 * the air. That is the reload case (Q1/U10) - and with it the row says
		 * "Worked 24 hours ago" instead of the vaguer "Worked earlier", which is
		 * what R4-3 asked for.
		 */
		const lastSeenAt =
			!held &&
			!signedOut &&
			before.connectedAt === null &&
			row.status_basis === "stored" &&
			row.tool_count_basis === "last_seen"
				? lastSeenMillis(row.last_seen_at, now)
				: null;
		const keepResult = !signedOut;
		const failure =
			lastOperation?.status === "failed" &&
			isSignInAction(lastOperation) &&
			NO_OAUTH_METADATA.test(lastOperation.message ?? "");
		const memory: RowMemory = {
			connectedAt:
				connected && !held
					? now
					: lastSeenAt !== null
						? lastSeenAt
						: keepResult
							? before.connectedAt
							: null,
			connectedToolCount:
				(connected && !held) || lastSeenAt !== null
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
			/*
			 * A sign-in the user cancelled is a NO-OP, and the backend's probe verdict
			 * does not outlive the operation that ended - so the row kept the
			 * observation where the backend keeps none (U14). Cleared by a completed
			 * sign-out, whose own wording (Signed out | Sign in) is the more specific
			 * truth about the same row.
			 */
			needsSignIn:
				connected || signedOut
					? false
					: before.needsSignIn || row.status === "needs_sign_in",
			/*
			 * Cleared by a read that says the row is working, EXCEPT inside the
			 * user's own hold window: a live runtime that has the server up again
			 * contradicts the Disconnect and its "connected" is the stronger fact,
			 * but a read inside the window is as likely to be the stale arm of the
			 * overlay's flap as a real contradiction - and clearing on it is
			 * exactly the defect this window exists for (Q1).
			 */
			disconnectedAt: connected && !held ? null : before.disconnectedAt,
			// Expires by time rather than being cleared, so a page that stops
			// reading cannot hold the claim forever.
			holdUntil: held ? before.holdUntil : null,
			lastDecisive: lastOperation ? pruneOperation(lastOperation) : null,
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

/**
 * Whether the "only global integrations are shown" banner applies (m-3).
 *
 * The banner says THIS CHAT's folder is gone, so it may only be shown while the
 * folder being read is the one that was refused. Keyed on the refusal alone it
 * stayed true for the whole mount, and switching to a chat whose folder is fine
 * still carried the banner over a project catalog that was reading perfectly.
 */
export const folderUnavailableFor = (
	refusedCwd: string | null,
	resolvedCwd: string | null,
): boolean => refusedCwd !== null && resolvedCwd === refusedCwd;

/* ------------------------------------------------- persisted row memory */

/**
 * Where the settled memories live between reloads, and how each one is keyed.
 *
 * WHY THIS EXISTS AT ALL: the backend publishes no observation time on a
 * `stored` row - `status_observed_at` is set on the `live` and `probe` bases
 * alone - so a reading this page keeps only in a ref is gone the moment the
 * window reloads, and the row decays to "Ready". That was measured twice from a
 * real reload of an expired check (U10/Q1), and the page is the only party that
 * watched the transition, so the page is where it has to be kept.
 *
 * KEYED BY THE CONFIG FILE THAT OWNS THE ROW, then the row's name: the same name
 * can exist in a project catalog and in the global one, and a reading from one is
 * not evidence about the other.
 */
export const ROW_MEMORY_STORAGE_KEY =
	"local-operator.settings.integrations.row-memory";

export const rowMemoryStorageKey = (sourcePath: string, name: string): string =>
	`${sourcePath}#${name}`;

/** The entries to persist for this document's rows, keyed for the store. */
export function memoriesTable(
	memories: RowMemories,
	document: Pick<IntegrationDocument, "servers"> | undefined,
): Record<string, RowMemory> {
	const table: Record<string, RowMemory> = {};
	if (!document) return table;
	for (const row of document.servers) {
		const memory = memories[row.name];
		if (memory) table[rowMemoryStorageKey(row.source.path, row.name)] = memory;
	}
	return table;
}

/**
 * The memories this page did not have, read back from the store.
 *
 * Only rows ABSENT from `memories` are seeded. A row already in the map carries a
 * LATER reading than the store does - including a deliberate clear, such as the
 * `connectedAt` a Disconnect wipes (Q2) - and re-seeding it would resurrect
 * exactly the value the page dropped.
 */
export function seedMemories(
	memories: RowMemories,
	document: Pick<IntegrationDocument, "servers"> | undefined,
	stored: Record<string, unknown>,
): RowMemories {
	if (!document) return memories;
	let next: RowMemories | null = null;
	for (const row of document.servers) {
		if (Object.prototype.hasOwnProperty.call(memories, row.name)) continue;
		const parsed = parseRowMemory(
			stored[rowMemoryStorageKey(row.source.path, row.name)],
		);
		if (!parsed) continue;
		next = next ?? { ...memories };
		next[row.name] = parsed;
	}
	return next ?? memories;
}

const MEMORY_GROUP_IDS: readonly IntegrationGroupId[] = [
	"attention",
	"connected",
	"ready",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const finiteOrNull = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const groupOrNull = (value: unknown): IntegrationGroupId | null =>
	MEMORY_GROUP_IDS.includes(value as IntegrationGroupId)
		? (value as IntegrationGroupId)
		: null;

/**
 * A stamp this page may treat as MILLISECONDS, or null.
 *
 * Refused rather than converted below 10^12: that is the year 2001 in
 * milliseconds, so a number under it is not a millisecond time this store could
 * have written - and the value that rendered a real six-minute-old check as
 * "Worked 20700 d ago" was epoch SECONDS. This page writes milliseconds only, so
 * this fires on a store some other build wrote, which is not a reading to
 * describe a row with.
 */
const millisecondsOrNull = (value: unknown): number | null => {
	const stamp = finiteOrNull(value);
	return stamp !== null && stamp >= 1_000_000_000_000 ? stamp : null;
};

function parseStoredOperation(value: unknown): McpCatalogOperation | null {
	if (!isRecord(value)) return null;
	if (typeof value.id !== "string" || typeof value.name !== "string")
		return null;
	const action = value.action;
	const status = value.status;
	if (
		action !== "login" &&
		action !== "logout" &&
		action !== "reauth" &&
		action !== "test"
	)
		return null;
	if (
		status !== "running" &&
		status !== "complete" &&
		status !== "cancelled" &&
		status !== "failed"
	)
		return null;
	return {
		id: value.id,
		name: value.name,
		action,
		status,
		created_at: finiteOrNull(value.created_at) ?? 0,
		credential_removed: value.credential_removed === true,
		...(typeof value.message === "string" ? { message: value.message } : {}),
	};
}

/**
 * One stored entry, or null when it is not shaped like one this build wrote.
 *
 * `localStorage` is a store the user can edit and an older build can have
 * written, so every field is read for its type and anything unrecognised is
 * dropped rather than trusted. An entry that would restore nothing at all is
 * null, which leaves the row reading exactly as it would on a fresh install.
 */
export function parseRowMemory(value: unknown): RowMemory | null {
	if (!isRecord(value)) return null;
	const connectedAt = millisecondsOrNull(value.connectedAt);
	const disconnectedAt = millisecondsOrNull(value.disconnectedAt);
	const needsKey = value.needsKey === true;
	const needsSignIn = value.needsSignIn === true;
	const lastDecisive = parseStoredOperation(value.lastDecisive);
	if (
		connectedAt === null &&
		disconnectedAt === null &&
		!needsKey &&
		!needsSignIn &&
		!lastDecisive
	)
		return null;
	return {
		connectedAt,
		connectedToolCount: finiteOrNull(value.connectedToolCount),
		settledGroup: groupOrNull(value.settledGroup),
		pinnedGroup: groupOrNull(value.pinnedGroup),
		pinnedOperationId:
			typeof value.pinnedOperationId === "string"
				? value.pinnedOperationId
				: null,
		needsKey,
		needsSignIn,
		disconnectedAt,
		/*
		 * The hold is carried too, and it is deliberately not part of the
		 * "nothing here" test above: a memory that holds only a deadline says
		 * nothing about the row, so it is dropped rather than seeding one - but a
		 * memory that DOES say something and was written inside the window must
		 * keep the window across a reload, or the reload delivers exactly the
		 * single contradicting read the window exists to survive.
		 */
		holdUntil: millisecondsOrNull(value.holdUntil),
		lastDecisive,
	};
}

/* --------------------------------------------------------------- polling */

/** How often the list is re-read while something on it is still moving. */
export const INTEGRATIONS_POLL_MS = 2_000;

/**
 * How long the list keeps re-reading after a control the user pressed (Q2).
 *
 * SHORT, because a live overlay answers or degrades inside the same second when
 * it is up at all, and the window closes early the moment a live read arrives.
 * BOUNDED, because a page that always asks is a read every 2 s forever on a
 * screen that is usually sitting idle - and LONG ENOUGH to cover a runtime that
 * has to start a server before it can answer. The memory the control writes is
 * what makes the row honest in the meantime; this window is how the row gets to
 * hear the confirmation.
 */
export const CONTROL_SETTLE_MS = 8_000;

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
			// The legacy snapshot carries no last-seen time, so the row keeps the
			// vaguer "Worked earlier" wording rather than inventing an age.
			last_seen_at: null,
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
