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
	| "action"
	| "unscreened"
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
	// Waits core documents as ones only the owner can clear (screening.py
	// "only they can fix"); its coarse `kind` says `waiting`, which would read
	// "will move on automatically" (review m2).
	sign_in_required: "action",
	consent_required: "action",
	owner_ineligible: "action",
	screener_required: "action",
	open_chief_of_staff: "action",
};

export function holdReason(
	item: Pick<HoldItem, "hold_code" | "kind" | "unscreened">,
): HoldReason {
	const byCode = REASON_BY_CODE[item.hold_code];
	/* `unscreened` (#4212): no model read it, so a family reason such as
	   "Screening held it for you to review" would contradict the badge (copy
	   C1). `not_screened` keeps its own Discard-only line. */
	if (item.unscreened === true && byCode !== "not_screened")
		return "unscreened";
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
		case "action":
			return t("ui.teamBridge.holds.reason.action");
		case "unscreened":
			return t("ui.teamBridge.holds.reason.unscreened");
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

/** Codes core offers Discard for and never Deliver (#4212). */
const DISCARD_ONLY_CODES: ReadonlySet<string> = new Set(["screening_failed"]);

/**
 * Whether a recorded decision failed to apply. Core writes `rejected` for a
 * COMPLETED Discard (connector/conversation.py: admitted for deliver, rejected
 * for discard), so only `refused` means it did not take (review m1).
 */
export function decisionNotApplied(outcome: string): boolean {
	return outcome === "refused";
}

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
	// A Discard-only code was never deliverable, so it is never "too old" (m4).
	if (
		!deliver &&
		item.releasable &&
		!DISCARD_ONLY_CODES.has(item.hold_code) &&
		Number.isFinite(until) &&
		until <= now
	) {
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
		// No conversation id: the owner-audit join cannot find the message, so
		// it can never be decided here and must not hold the badge on (QA Q1).
		if (!item.conversation_id) return false;
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
 * What the decide may bind, from the body the person was SHOWN. The daemon
 * compares `body_sha256` with the bytes its screener read and refuses
 * `snapshot_stale` on any difference (S-11), so the hash is the record of what
 * the owner consented to.
 *
 * - `shown`: the body is on screen; hashed here as UTF-8, as core's
 *   `_body_sha256_bytes` does. Deliver and Discard may bind it.
 * - `withheld`: the audit withheld the body (`body: null`). Nobody saw it, so
 *   Deliver is NEVER armed (security S-2); Discard, the safe direction, may
 *   bind the served hash.
 * - `mismatch`: the served hash disagrees with the shown text, so the view
 *   cannot be trusted and nothing is armed (QA Q2 gives it a reason line).
 * - `none`: no usable hash at all.
 */
export type BodyBinding =
	| { state: "shown"; hash: string }
	| { state: "withheld"; hash: string }
	| { state: "mismatch" }
	| { state: "none" };

export async function bindShownBody(
	body: string | null | undefined,
	bodyHash: string | null | undefined,
): Promise<BodyBinding> {
	const served = typeof bodyHash === "string" && SHA256_HEX.test(bodyHash);
	if (typeof body !== "string")
		return served
			? { state: "withheld", hash: bodyHash as string }
			: { state: "none" };
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(body),
	);
	const hex = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	if (typeof bodyHash === "string" && bodyHash !== "" && bodyHash !== hex)
		return { state: "mismatch" };
	return { state: "shown", hash: hex };
}

/*
 * WHEN A BODY IS SHOWN IN FULL. A row clamps a long body to three lines, and a
 * clamped body or one with attachments has NOT been seen in full: three benign
 * lines can sit above the payload screening exists to stop (security S-1, UX
 * U3). A body under this size with no attachments renders unclamped, so it is
 * seen whole on arrival; anything else needs the owner to expand it, which
 * shows the whole text and the attachment group, before Deliver arms.
 */
const SHORT_BODY_CHARS = 280;
const SHORT_BODY_LINES = 3;

export function needsExpand(
	body: string | null | undefined,
	attachments: number,
): boolean {
	if (attachments > 0) return true;
	if (typeof body !== "string") return false;
	return (
		body.length > SHORT_BODY_CHARS || body.split("\n").length > SHORT_BODY_LINES
	);
}

/*
 * HIDDEN CHARACTERS (security S-6). Unicode tag characters (U+E0000-E007F),
 * bidi controls and other format / default-ignorable code points take no
 * visible space, but a model reads them: the "ASCII smuggling" carrier. The
 * hash covers them, so a body that LOOKS like one benign line can bind a
 * payload nobody saw, and no expand step can reveal it. Core already treats
 * the class as hostile: `hold_release.strict_release_reason` refuses any
 * `unicodedata.category == "Cf"` character. This mirrors that set (`\p{Cf}`)
 * plus `\p{Default_Ignorable_Code_Point}`, which adds the invisible non-Cf
 * fillers (e.g. U+034F, U+115F, U+3164).
 *
 * The one exception is what ordinary emoji need: U+200D ZERO WIDTH JOINER
 * between two pictographs (family, profession sequences) and the variation
 * selectors U+FE0E/U+FE0F after a character. Everything else, tag runs
 * included, makes the body Discard-only.
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const VARIATION_SELECTOR = /^[\uFE0E\uFE0F]$/u;
const EMOJI_MODIFIER = /^\p{Emoji_Modifier}$/u;

export function hasHiddenCharacters(body: string | null | undefined): boolean {
	if (typeof body !== "string" || !INVISIBLE.test(body)) return false;
	const chars = Array.from(body);
	for (let index = 0; index < chars.length; index += 1) {
		const char = chars[index];
		if (!INVISIBLE.test(char)) continue;
		if (VARIATION_SELECTOR.test(char) && index > 0) continue;
		if (char === "\u200D") {
			// Walk back over selectors and skin-tone modifiers to the base.
			let back = index - 1;
			while (
				back >= 0 &&
				(VARIATION_SELECTOR.test(chars[back]) ||
					EMOJI_MODIFIER.test(chars[back]))
			)
				back -= 1;
			const next = chars[index + 1];
			if (
				back >= 0 &&
				PICTOGRAPH.test(chars[back]) &&
				next !== undefined &&
				PICTOGRAPH.test(next)
			)
				continue;
		}
		return true;
	}
	return false;
}

/**
 * Which buttons may be pressed now: the daemon's affordance, narrowed by what
 * the person has actually seen. Deliver needs a `shown` body seen in full
 * with nothing hidden in it (S-6); Discard needs any bindable hash.
 */
export function armedWords(
	affordance: HoldAffordance,
	binding: BodyBinding,
	seenInFull: boolean,
	hidden = false,
): { deliver: boolean; discard: boolean } {
	if (affordance.state !== "open" && affordance.state !== "deliver_expired")
		return { deliver: false, discard: false };
	return {
		deliver:
			affordance.deliver && binding.state === "shown" && seenInFull && !hidden,
		discard:
			affordance.discard &&
			(binding.state === "shown" || binding.state === "withheld"),
	};
}

/**
 * The order the owner works the list in (UX U5). Core lists oldest first, so
 * expired rows would bury the ones still deliverable: deliverable rows come
 * first, soonest deadline first, then Discard-only rows, then rows with
 * nothing to decide, then decided ones. Stable inside each group.
 */
export function sortHolds(
	items: readonly HoldItem[],
	now: number = Date.now(),
): HoldItem[] {
	const rank = (item: HoldItem) => {
		const a = holdAffordance(item, now);
		if (a.state === "open" && a.deliver) return 0;
		if (a.state === "open" || a.state === "deliver_expired") return 1;
		if (a.state === "not_releasable") return 2;
		return 3;
	};
	const deadline = (item: HoldItem) => {
		const value = item.deliver_until
			? Date.parse(item.deliver_until)
			: Number.NaN;
		return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
	};
	return items
		.map((item, index) => ({ item, index }))
		.sort(
			(a, b) =>
				rank(a.item) - rank(b.item) ||
				(rank(a.item) === 0 ? deadline(a.item) - deadline(b.item) : 0) ||
				a.index - b.index,
		)
		.map((entry) => entry.item);
}

/**
 * The join's answer for one hold, kept pure so the "never spins forever" rule
 * is testable (QA Q1): a hold with no conversation id has no lookup to wait
 * for, so it is `unavailable` at once, never `loading`.
 */
export type JoinedDetail<M> =
	| { state: "loading" }
	| { state: "unavailable" }
	| { state: "ready"; message: M; tenantId: string; binding: BodyBinding };

export function resolveHoldDetail<M extends { id: string }>(
	item: Pick<HoldItem, "message_id" | "conversation_id">,
	input: {
		auditSupported: boolean;
		lookup?: {
			pending: boolean;
			found?: { message: M; tenantId: string } | null;
		};
		binding?: { pending: boolean; value?: BodyBinding };
	},
): JoinedDetail<M> {
	if (!input.auditSupported || !item.conversation_id)
		return { state: "unavailable" };
	if (!input.lookup || input.lookup.pending) return { state: "loading" };
	const found = input.lookup.found;
	if (!found || found.message.id !== item.message_id)
		return { state: "unavailable" };
	if (!input.binding || input.binding.pending || !input.binding.value)
		return { state: "loading" };
	return {
		state: "ready",
		message: found.message,
		tenantId: found.tenantId,
		binding: input.binding.value,
	};
}
