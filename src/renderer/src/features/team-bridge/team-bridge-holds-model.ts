/**
 * Team Bridge held messages: the pure rules behind the "Held messages" section
 * of Approvals and its share of the nav badge.
 *
 * WHY THIS EXISTS. Since local-operator B4b (operator decision a-3f46) this
 * machine's screener can HOLD a teammate's conversation message for its owner
 * instead of delivering it to their agent, and core serves the list plus a
 * signed Deliver / Discard at `/v1/desktop/team-bridge/holds`. The desktop app
 * had no client for it, so held messages accumulated where nobody could see
 * them (the operator found twelve, the oldest about 18 days old). This module
 * holds the decisions the UI makes on top of that wire, kept free of React so
 * `scripts/team-bridge-holds.test.mjs` runs them from the shipped source.
 *
 * THE CONSTRAINTS IT ENCODES:
 * - The hold list is METADATA ONLY (ids, times, a coarse `kind`, a closed
 *   `hold_code`, `releasable` / `can_deliver` / `can_discard`). Who sent it and
 *   what it says come from the owner-audit read the person can already open, so
 *   this surface never shows more of a held message than owner-audit does.
 * - Deliver is offered ONLY when `can_deliver` is true and Discard only when
 *   `can_discard` is true. The daemon is the authority on both (window, class
 *   setting, trusted screener); the renderer never infers a button.
 * - Codes are an open set on this side: core adds codes (`screening_failed`,
 *   #4212) and may add more, so an unknown code or kind reads as a generic
 *   reason rather than failing the row. `unscreened` is optional for the same
 *   reason: absent means "not flagged".
 * - Refusals map to fixed copy keyed by the route's closed codes, never the
 *   daemon's sentence; an unknown code gets the generic line.
 * - No OS biometric prompt is raised from here (decision a-856f). The daemon's
 *   operator key signs the record; whatever presence policy that key carries
 *   is the daemon's, not this window's.
 */
import { t } from "../../../../i18n/messages";

export type HoldDecisionView = {
	word: string | null;
	decided_at: string | null;
	outcome: string;
	key_id: string | null;
};

export type HoldItem = {
	message_id: string;
	conversation_id: string;
	seq: number | null;
	held_at: string | null;
	kind: string;
	hold_code: string;
	releasable: boolean;
	can_deliver: boolean;
	can_discard: boolean;
	deliver_until: string | null;
	decision: HoldDecisionView | null;
	/** local-operator #4212: nothing could screen this message. Optional. */
	unscreened?: boolean;
};

export type HoldsPage = {
	enabled: boolean;
	key_protection: string | null;
	items: HoldItem[];
};

export type HoldWord = "deliver" | "discard";

export type HoldReceipt = {
	message_id: string | null;
	state: string;
	decided_at: string | null;
};

// -- why it was held ----------------------------------------------------------

/**
 * One plain reason per family of hold codes. The families follow core's own
 * grouping (`desktop_team_bridge_holds._kind`, `hold_release.REVIEW_HOLD_CODES`,
 * the infra codes in `screening.HOLD_CODES`) so the person reads what the
 * screener actually did, not the machine word.
 */
export type HoldReason =
	| "new_work"
	| "review"
	| "unclear"
	| "not_screened"
	| "no_screener"
	| "records"
	| "unreadable"
	| "waiting"
	| "other";

const REASON_BY_CODE: Readonly<Record<string, HoldReason>> = {
	// Hold-release class: the screener says the message asks for new work.
	work_scope_hold: "new_work",
	// The screener held it for the owner (cached model answer, review class).
	model_hold: "review",
	// The screener answered, but not with a usable verdict.
	model_refused: "unclear",
	reply_truncated: "unclear",
	parse_failed: "unclear",
	empty_reply: "unclear",
	bounce_without_category: "unclear",
	batch_unresolved: "unclear",
	// #4212: every screening attempt failed; Discard-only.
	screening_failed: "not_screened",
	// Nothing could screen right now; the connector retries on its own.
	screening_model_unavailable: "no_screener",
	runner_unavailable: "no_screener",
	provider_error: "no_screener",
	breaker_open: "no_screener",
	budget_exhausted: "no_screener",
	retry_later: "no_screener",
	// This machine's own records disagree or could not be trusted.
	write_once_conflict: "records",
	schema_damaged: "records",
	proof_corrupt: "records",
	policy_stale: "records",
	owner_mismatch: "records",
	owner_changed: "records",
	template_mismatch: "records",
	model_identity_unknown: "records",
	model_identity_mismatch: "records",
	// The message itself could not be checked as sent.
	body_hash_mismatch: "unreadable",
	envelope_unbound: "unreadable",
	envelope_malformed: "unreadable",
	invalid_content: "unreadable",
	invalid_content_type: "unreadable",
	size_exceeded: "unreadable",
};

export function holdReason(item: Pick<HoldItem, "hold_code" | "kind">) {
	const byCode = REASON_BY_CODE[item.hold_code];
	if (byCode) return byCode;
	// An unlisted code falls back on the daemon's coarse kind, then generic.
	if (item.kind === "owner_decision") return "review";
	if (item.kind === "screening") return "unclear";
	if (item.kind === "waiting") return "waiting";
	return "other";
}

export function holdReasonLabel(reason: HoldReason): string {
	switch (reason) {
		case "new_work":
			return t("ui.teamBridge.holds.reason.new_work");
		case "review":
			return t("ui.teamBridge.holds.reason.review");
		case "unclear":
			return t("ui.teamBridge.holds.reason.unclear");
		case "not_screened":
			return t("ui.teamBridge.holds.reason.not_screened");
		case "no_screener":
			return t("ui.teamBridge.holds.reason.no_screener");
		case "records":
			return t("ui.teamBridge.holds.reason.records");
		case "unreadable":
			return t("ui.teamBridge.holds.reason.unreadable");
		case "waiting":
			return t("ui.teamBridge.holds.reason.waiting");
		default:
			return t("ui.teamBridge.holds.reason.other");
	}
}

// -- what a row allows ----------------------------------------------------------

/**
 * The state a row is in, which decides its buttons and its one status line.
 * - `decided`: a Deliver/Discard is already recorded; no buttons.
 * - `open`: releasable; `deliver` / `discard` say which buttons exist.
 * - `deliver_expired`: releasable but past the Deliver window; Discard only.
 * - `not_releasable`: nothing to decide here (it clears or retries on its own,
 *   or this machine cannot release this kind).
 */
export type HoldAffordance =
	| { state: "decided"; word: HoldWord | null; outcome: string }
	| {
			state: "open" | "deliver_expired";
			deliver: boolean;
			discard: boolean;
	  }
	| { state: "not_releasable" };

export function holdAffordance(
	item: HoldItem,
	now: number = Date.now(),
): HoldAffordance {
	if (item.decision) {
		const word = item.decision.word;
		return {
			state: "decided",
			word: word === "deliver" || word === "discard" ? word : null,
			outcome: item.decision.outcome,
		};
	}
	const deliver = item.can_deliver === true;
	const discard = item.can_discard === true;
	if (!deliver && !discard) return { state: "not_releasable" };
	/* "Too old to deliver" only when the window is PAST. A Discard-only hold
	   for any other reason (#4212's `screening_failed`) stays `open` with no
	   Deliver, and its reason line says why. */
	const until = item.deliver_until
		? Date.parse(item.deliver_until)
		: Number.NaN;
	if (!deliver && item.releasable && Number.isFinite(until) && until <= now) {
		return { state: "deliver_expired", deliver: false, discard };
	}
	return { state: "open", deliver, discard };
}

/**
 * Holds the person can act on now: one that offers a button and has no
 * recorded answer. This is the number added to the Approvals badge; a hold that
 * only waits on the machine is listed but never counted.
 */
export function actionableHoldCount(
	page: Pick<HoldsPage, "items"> | null | undefined,
): number {
	if (!page) return 0;
	return page.items.filter((item) => {
		const a = holdAffordance(item);
		return a.state === "open" || a.state === "deliver_expired";
	}).length;
}

// -- refusals -----------------------------------------------------------------

/** The route's closed refusal codes (`desktop_team_bridge._HOLD_REFUSALS`). */
export function holdRefusalLabel(code: string | null | undefined): string {
	switch (code) {
		case "hold_release_off":
			return t("ui.teamBridge.holds.refusal.release_off");
		case "hold_not_releasable":
			return t("ui.teamBridge.holds.refusal.not_releasable");
		case "snapshot_stale":
			return t("ui.teamBridge.holds.refusal.stale");
		case "already_decided":
			return t("ui.teamBridge.holds.refusal.already_decided");
		case "deliver_expired":
			return t("ui.teamBridge.holds.refusal.deliver_expired");
		case "release_signing_unavailable":
			return t("ui.teamBridge.holds.refusal.signing_unavailable");
		default:
			return t("ui.teamBridge.holds.refusal.generic");
	}
}

// -- the body hash the decide binds ---------------------------------------------

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The `body_sha256` a Deliver/Discard carries: the hash of the body the person
 * was SHOWN. The daemon compares it with the bytes its screener read and
 * refuses `snapshot_stale` on any difference (S-11), so a body edited between
 * the screen and this card can never be released on a stale view.
 *
 * Hashed here from the shown text (UTF-8, as core's `_body_sha256_bytes`
 * does). When a server-sent `body_hash` exists and disagrees, the view is not
 * trustworthy and no hash is returned, so no button can be armed with it. With
 * no body shown, the server hash is used only if it is well-formed.
 */
export async function shownBodySha256(
	body: string | null | undefined,
	bodyHash: string | null | undefined,
): Promise<string | null> {
	const served = typeof bodyHash === "string" && SHA256_HEX.test(bodyHash);
	if (typeof body !== "string") return served ? (bodyHash as string) : null;
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(body),
	);
	const hex = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	if (typeof bodyHash === "string" && bodyHash !== "" && bodyHash !== hex)
		return null;
	return hex;
}
