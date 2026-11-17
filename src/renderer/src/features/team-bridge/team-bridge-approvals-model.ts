/**
 * Team Bridge approvals: the pure rules behind the Requests panel, the nav
 * badge and the Touch ID prompt notice.
 *
 * WHY THIS EXISTS. A teammate's agent can send this operator an approval
 * request. Before this surface the only way to answer one was its ask card, so
 * a pile of them could not be decided together and nobody could see what had
 * been decided (the production audit found approvals never used). The daemon
 * side shipped in local-operator #4099; this module holds the decisions the UI
 * makes on top of it, kept free of React so `scripts/team-bridge-approvals.test.mjs`
 * can run them from the shipped source.
 *
 * THE CONSTRAINTS IT ENCODES, each from #4099's "For the UI slice":
 * - A selection is the person's EXPLICIT list, at most 50 items (the route's
 *   `BATCH_MAX`); there is no "all" on the wire, only "every row I can see and
 *   may decide", capped.
 * - A row whose earlier signed decision the hub never confirmed
 *   (`unsent_decision`) is LOCKED to that word: offering the other one would be
 *   refused whole with `earlier_decision_unconfirmed`, and silently flipping a
 *   signed answer is exactly what that refusal prevents.
 * - The Touch ID prompt is raised by the daemon, and any local process holding
 *   the bearer can ask for one. The daemon publishes what each prompt would sign
 *   on the feed; this renderer labels a prompt whose `client_ref` it did not
 *   generate "not started by you". That label is the security control
 *   (security S-6), so the set of refs is module state in THIS renderer only and
 *   is never persisted or shared.
 * - No message body or screening rationale is ever shown: rows carry only the
 *   already-screened card `excerpt`, and refusals map to fixed copy rather than
 *   the daemon's sentence.
 */
import { t } from "../../../../i18n/messages";
import { TEAM_BRIDGE_APPROVAL_BATCH_MAX } from "../../../../shared/desktop-contract";
import type { TeamBridgeAuthorizeFramePayload } from "../../../../shared/desktop-session-contract";

export { TEAM_BRIDGE_APPROVAL_BATCH_MAX };

export type ApprovalWord = "approve" | "deny";

export type ApprovalRequestRow = {
	message_id: string;
	thread_id: string | null;
	created_at: string | null;
	excerpt: string | null;
	request: { state: string | null; expires_at: string | null };
	sender: {
		account_id: string | null;
		endpoint_id: string | null;
		name: string | null;
		email: string | null;
	};
	ask: { session_id: string; ask_id: string; status: string } | null;
	decidable: boolean;
	unsent_decision: ApprovalWord | null;
};

export type ApprovalRequestsPage = {
	tenant_id: string;
	items: ApprovalRequestRow[];
	pending_count: number;
	next_cursor: string | null;
	has_more: boolean;
};

export type ApprovalDecisionRow = {
	request_id: string;
	thread_id: string | null;
	decision: string | null;
	decided_at: string | null;
	requested_by: Person;
	decided_by: Person;
	decided_via_claimed: string | null;
	ask_id: string | null;
};

type Person = {
	account_id: string | null;
	name: string | null;
	email: string | null;
};

export type ApprovalDecideResult = {
	message_id: string;
	decision: ApprovalWord;
	sent: boolean;
	ask_settled: boolean;
	status?: string;
	error?: string;
};

export type ApprovalSelectionItem = {
	message_id: string;
	decision: ApprovalWord;
};

// -- the nav badge ------------------------------------------------------------

/**
 * "1 request waiting" / "N requests waiting" (agent-server docs/TEAM-BRIDGE.md
 * §2.5 `request.badge`: "waiting", not "pending approvals"; singular and plural
 * from ONE label function, D33). Zero has no label: a quiet row shows nothing.
 */
export function requestsWaitingLabel(count: number): string | null {
	if (!Number.isFinite(count) || count <= 0) return null;
	return t("ui.teamBridge.approvals.waiting", { count });
}

// -- what a row allows --------------------------------------------------------

/** Why a listed request cannot be decided here; `null` when it can. */
export type NotDecidableReason = "no_card" | "not_open";

export function notDecidableReason(
	row: ApprovalRequestRow,
): NotDecidableReason | null {
	if (row.decidable) return null;
	// No local ask: the request reached the hub but no card was raised on THIS
	// machine (another device holds it, or it was screened out). Otherwise the
	// card exists but is not open (snoozed, expired, cancelled).
	return row.ask === null ? "no_card" : "not_open";
}

/**
 * The words a row may be decided with. A locked row (`unsent_decision`) offers
 * ONLY its signed word; a non-decidable row offers none.
 */
export function allowedWords(row: ApprovalRequestRow): ApprovalWord[] {
	if (!row.decidable) return [];
	if (row.unsent_decision) return [row.unsent_decision];
	return ["approve", "deny"];
}

export function rowAllows(
	row: ApprovalRequestRow,
	word: ApprovalWord,
): boolean {
	return allowedWords(row).includes(word);
}

/** Rows a checkbox may be drawn for: decidable ones only. */
export function selectableRows(rows: readonly ApprovalRequestRow[]) {
	return rows.filter((row) => row.decidable);
}

/**
 * Toggle one id in a selection, refusing to grow it past the batch cap. The
 * cap is enforced HERE, at the moment of selection, so the person never builds
 * a selection the route would refuse by size; `capped` tells the panel to say
 * why the click did nothing.
 */
export function toggleSelected(
	selected: ReadonlySet<string>,
	messageId: string,
): { next: Set<string>; capped: boolean } {
	const next = new Set(selected);
	if (next.has(messageId)) {
		next.delete(messageId);
		return { next, capped: false };
	}
	if (next.size >= TEAM_BRIDGE_APPROVAL_BATCH_MAX)
		return { next, capped: true };
	next.add(messageId);
	return { next, capped: false };
}

/**
 * "Select all" over what is listed: the first 50 decidable rows in list order,
 * never more. `capped` says some decidable rows were left out.
 */
export function selectAllDecidable(rows: readonly ApprovalRequestRow[]): {
	next: Set<string>;
	capped: boolean;
} {
	const decidable = selectableRows(rows);
	return {
		next: new Set(
			decidable
				.slice(0, TEAM_BRIDGE_APPROVAL_BATCH_MAX)
				.map((row) => row.message_id),
		),
		capped: decidable.length > TEAM_BRIDGE_APPROVAL_BATCH_MAX,
	};
}

/**
 * Build the wire selection for "Approve selected" / "Deny selected".
 *
 * Items whose row does not allow `word` (locked to the other word, or no
 * longer decidable after a refresh) are LEFT OUT and returned in `excluded`,
 * never re-worded: a batch must only ever carry the word the person pressed.
 * Rows that vanished from the list are dropped too. The result is capped at 50
 * even if a caller hands in more ids.
 */
export function buildSelection(
	rows: readonly ApprovalRequestRow[],
	selected: ReadonlySet<string>,
	word: ApprovalWord,
): { items: ApprovalSelectionItem[]; excluded: ApprovalRequestRow[] } {
	const items: ApprovalSelectionItem[] = [];
	const excluded: ApprovalRequestRow[] = [];
	for (const row of rows) {
		if (!selected.has(row.message_id)) continue;
		if (!rowAllows(row, word)) {
			excluded.push(row);
			continue;
		}
		if (items.length >= TEAM_BRIDGE_APPROVAL_BATCH_MAX) break;
		items.push({ message_id: row.message_id, decision: word });
	}
	return { items, excluded };
}

// -- client_ref: which prompts THIS renderer started --------------------------

/*
 * Refs this renderer generated, newest last. Bounded so a long session cannot
 * grow it without limit; 32 outstanding prompts is far beyond the daemon's own
 * one-at-a-time gate, so an evicted ref is long settled.
 */
const OWN_REF_LIMIT = 32;
const ownRefs: string[] = [];

/**
 * A fresh random `client_ref`: 16 random bytes as 32 lowercase hex, the route's
 * own grammar (`^[0-9a-f]{1,32}$`). Random rather than a counter so another
 * local process cannot predict the next one and claim a prompt as ours.
 */
export function newClientRef(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	const ref = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	ownRefs.push(ref);
	if (ownRefs.length > OWN_REF_LIMIT) ownRefs.shift();
	return ref;
}

/** Whether a prompt frame's `client_ref` is one this renderer generated. */
export function isOwnClientRef(ref: string | null | undefined): boolean {
	return typeof ref === "string" && ownRefs.includes(ref);
}

/** Test seam: forget every generated ref. */
export function resetClientRefsForTests(): void {
	ownRefs.length = 0;
}

// -- the prompt notice: live `team_bridge_authorize` frames -------------------

export type AuthorizePromptNotice = {
	authorizeId: string;
	/** True when THIS renderer did not start the prompt: the security label. */
	foreign: boolean;
	approveCount: number;
	denyCount: number;
	items: TeamBridgeAuthorizeFramePayload["items"];
};

const prompting = new Map<string, AuthorizePromptNotice>();
let snapshot: AuthorizePromptNotice[] = [];
const listeners = new Set<() => void>();
let lastFrameKey: string | null = null;

export function noticeFromFrame(
	payload: TeamBridgeAuthorizeFramePayload,
): AuthorizePromptNotice {
	const items = Array.isArray(payload.items) ? payload.items : [];
	return {
		authorizeId: payload.authorize_id,
		foreign: !isOwnClientRef(payload.client_ref),
		approveCount: items.filter((item) => item.word === "approve").length,
		denyCount: items.filter((item) => item.word === "deny").length,
		items,
	};
}

/**
 * Apply one feed frame. `prompting` shows a notice; every other state clears
 * the notice for that `authorize_id`. `frameKey` (`epoch:seq`) collapses the
 * one delivery per mounted feed hook into a single application, the way the
 * avatar frame is applied.
 */
export function applyAuthorizeFrame(
	payload: TeamBridgeAuthorizeFramePayload,
	frameKey?: string,
): void {
	if (frameKey !== undefined) {
		if (frameKey === lastFrameKey) return;
		lastFrameKey = frameKey;
	}
	if (!payload || typeof payload.authorize_id !== "string") return;
	if (payload.state === "prompting") {
		prompting.set(payload.authorize_id, noticeFromFrame(payload));
	} else if (!prompting.delete(payload.authorize_id)) {
		return;
	}
	snapshot = Array.from(prompting.values());
	for (const listener of listeners) listener();
}

/**
 * Feed reconnect: the feed is live-only and a prompt lasts seconds, so a
 * notice whose closing frame was lost would otherwise stand forever. The
 * caller clears on a dropped transport.
 */
export function clearAuthorizeNotices(): void {
	if (prompting.size === 0) return;
	prompting.clear();
	snapshot = [];
	for (const listener of listeners) listener();
}

export function subscribeAuthorizeNotices(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function authorizeNoticesSnapshot(): AuthorizePromptNotice[] {
	return snapshot;
}

// -- refusals -> calm copy -----------------------------------------------------

export type ApprovalRefusal =
	| { kind: "in_flight"; message: string }
	| { kind: "cooldown"; message: string; retryAfterS: number }
	| {
			kind: "locked";
			message: string;
			items: Array<{ message_id: string; unsent_decision: ApprovalWord }>;
	  }
	| { kind: "presence_required"; message: string }
	| { kind: "dismissed"; message: string }
	| { kind: "expired"; message: string }
	| { kind: "other"; message: string };

type RefusalLike = {
	code?: string;
	status?: number | null;
	retryAfterMs?: number;
	detail?: unknown;
};

function refusalDetails(error: RefusalLike): Record<string, unknown> {
	const detail = error.detail;
	if (!detail || typeof detail !== "object") return {};
	const details = (detail as { details?: unknown }).details;
	return details && typeof details === "object"
		? (details as Record<string, unknown>)
		: {};
}

/**
 * Map an authorize/decide refusal to fixed, neutral copy.
 *
 * The daemon's own sentence is NOT shown: it is written for the API, and this
 * surface promises "nothing was decided" in one register. `names` resolves a
 * locked item's id to the sender shown on its row, so the copy can say WHICH
 * requests are locked rather than how many.
 */
export function mapApprovalRefusal(
	error: unknown,
	names: (messageId: string) => string | null = () => null,
): ApprovalRefusal {
	const e = (error ?? {}) as RefusalLike;
	const code = typeof e.code === "string" ? e.code : "";
	const details = refusalDetails(e);
	switch (code) {
		case "operator_prompt_in_flight":
			return {
				kind: "in_flight",
				message: t("ui.teamBridge.approvals.refusal.in_flight"),
			};
		case "operator_prompt_cooldown": {
			const raw = details.retry_after_s;
			const fromMs =
				typeof e.retryAfterMs === "number" ? e.retryAfterMs / 1000 : Number.NaN;
			const seconds = Math.max(
				1,
				Math.ceil(
					typeof raw === "number" && Number.isFinite(raw)
						? raw
						: Number.isFinite(fromMs)
							? fromMs
							: 5,
				),
			);
			return {
				kind: "cooldown",
				retryAfterS: seconds,
				message: t("ui.teamBridge.approvals.refusal.cooldown", { seconds }),
			};
		}
		case "earlier_decision_unconfirmed": {
			const items = (Array.isArray(details.items) ? details.items : [])
				.filter(
					(
						item,
					): item is { message_id: string; unsent_decision: ApprovalWord } =>
						!!item &&
						typeof item.message_id === "string" &&
						(item.unsent_decision === "approve" ||
							item.unsent_decision === "deny"),
				)
				.map((item) => ({
					message_id: item.message_id,
					unsent_decision: item.unsent_decision,
				}));
			const named = items
				.map((item) => names(item.message_id))
				.filter((name): name is string => !!name);
			return {
				kind: "locked",
				items,
				message:
					named.length > 0
						? t("ui.teamBridge.approvals.refusal.locked_named", {
								names: Array.from(new Set(named)).join(", "),
							})
						: t("ui.teamBridge.approvals.refusal.locked"),
			};
		}
		case "operator_presence_required":
			return {
				kind: "presence_required",
				message: t("ui.teamBridge.approvals.refusal.presence_required"),
			};
		case "operator_signature_unavailable":
			return {
				kind: "dismissed",
				message: t("ui.teamBridge.approvals.refusal.dismissed"),
			};
		case "operator_signature_expired":
		case "operator_signature_invalid":
		case "operator_signature_required":
			return {
				kind: "expired",
				message: t("ui.teamBridge.approvals.refusal.expired"),
			};
		default:
			return {
				kind: "other",
				message: t("ui.teamBridge.approvals.refusal.other"),
			};
	}
}

// -- per-item results ---------------------------------------------------------

export type ResultTone = "done" | "not_sent";

/** One decide result as a line the panel can render. */
export function resultLine(result: ApprovalDecideResult): {
	tone: ResultTone;
	label: string;
} {
	if (result.status === "approved")
		return {
			tone: "done",
			label: t("ui.teamBridge.approvals.result.approved"),
		};
	if (result.status === "denied")
		return { tone: "done", label: t("ui.teamBridge.approvals.result.denied") };
	switch (result.error) {
		case "request_already_decided":
		case "answered_on_card":
			return {
				tone: "done",
				label: t("ui.teamBridge.approvals.result.already_answered"),
			};
		case "no_open_ask":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.no_card"),
			};
		case "earlier_decision_unconfirmed":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.locked"),
			};
		case "messaging_unavailable":
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.unconfirmed"),
			};
		default:
			return {
				tone: "not_sent",
				label: t("ui.teamBridge.approvals.result.not_sent"),
			};
	}
}

/** The display name for a row's sender: name, else email, else a fixed word. */
export function senderLabel(sender: {
	name: string | null;
	email: string | null;
}): string {
	return (
		sender.name || sender.email || t("ui.teamBridge.approvals.unknown_sender")
	);
}
