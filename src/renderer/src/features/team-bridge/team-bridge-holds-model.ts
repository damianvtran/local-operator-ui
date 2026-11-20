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
	/**
	 * local-operator #4358: core's own "the person owes this an answer". When
	 * present it is the ONLY input to the badge and the nav count (see
	 * `isActionableHold`); absent means an older core.
	 */
	actionable?: boolean;
	/**
	 * local-operator #4358: binds this ONE local hold record for a Discard when
	 * the body cannot be shown. Discard only, never Deliver. Null or absent
	 * means no receipt Discard is offered.
	 */
	discard_receipt?: string | null;
};

export type HoldsPage = {
	enabled: boolean;
	key_protection: string | null;
	items: HoldItem[];
};

export type HoldWord = "deliver" | "discard";

/**
 * What a decide binds: the hash of the body on screen, or (Discard only) the
 * list's `discard_receipt`. Exactly one, as the route requires.
 */
export type HoldProof = { body_sha256: string } | { hold_receipt: string };

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
 * Whether the person owes this hold an answer: the one predicate the badge,
 * the nav count and the section's "waiting" all read, so they cannot disagree.
 *
 * WHY CORE DECIDES IT (local-operator #4358, operator report 2026-11-20). The
 * renderer used to re-derive this from `can_deliver` / `can_discard`, and
 * counted an expired hold whose body could no longer load: the badge said 1
 * while the row offered nothing. Core now serves `actionable` (undecided, has a
 * conversation, and Deliver or Discard open), so when it is present it wins
 * outright: a recorded decision (pending, applied or refused) is `false` there
 * and never counts again, and a valid new hold is `true` beside it.
 *
 * LEGACY FALLBACK (older core, no `actionable`): the previous rule, kept as
 * is so an older daemon's badge does not change under it. It can still
 * over-count a row whose body cannot load; that is the bug #4358 fixes at the
 * source, not one this side can resolve.
 */
export function isActionableHold(
	item: HoldItem,
	now: number = Date.now(),
): boolean {
	if (typeof item.actionable === "boolean") return item.actionable;
	// No conversation id: the owner-audit join cannot find the message, so
	// it can never be decided here and must not hold the badge on (QA Q1).
	if (!item.conversation_id) return false;
	const a = holdAffordance(item, now);
	return a.state === "open" || a.state === "deliver_expired";
}

/**
 * Holds the person can act on now (`isActionableHold`). This is the number
 * added to the Approvals badge; a hold that only waits on the machine, or one
 * already decided, is listed but never counted.
 */
export function actionableHoldCount(
	page: Pick<HoldsPage, "items"> | null | undefined,
	now: number = Date.now(),
): number {
	if (!page) return 0;
	return page.items.filter((item) => isActionableHold(item, now)).length;
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
		/* S-9: a selector is presentation only directly after a visible base,
		   and one per base. A run of them (or one after a format character)
		   renders at zero width and can carry a covert bit channel, so it
		   counts as hidden. */
		if (VARIATION_SELECTOR.test(char)) {
			const previous = index > 0 ? chars[index - 1] : undefined;
			if (previous !== undefined && !INVISIBLE.test(previous)) continue;
			return true;
		}
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
 * nothing to decide, then decided ones.
 *
 * Inside a group: oldest `held_at` first, the message id breaking ties. The
 * order reads only list metadata, never the body or its loading state, so a
 * body arriving, a refresh or an expansion never moves a row under the
 * person's pointer; and it does not depend on the order the daemon happened
 * to serve (#4358 added the same id tie-break on its side).
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
	const heldAt = (item: HoldItem) => {
		const value = item.held_at ? Date.parse(item.held_at) : Number.NaN;
		// An unknown hold time sorts last in its group, not first.
		return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
	};
	const byHeld = (a: HoldItem, b: HoldItem) => {
		const left = heldAt(a);
		const right = heldAt(b);
		if (left !== right) return left < right ? -1 : 1;
		if (a.message_id === b.message_id) return 0;
		return a.message_id < b.message_id ? -1 : 1;
	};
	return [...items].sort(
		(a, b) =>
			rank(a) - rank(b) ||
			(rank(a) === 0 ? deadline(a) - deadline(b) : 0) ||
			byHeld(a, b),
	);
}

// -- the receipt Discard (local-operator #4358) ----------------------------------

/**
 * Whether this hold's Discard may bind its `discard_receipt` instead of a body.
 *
 * ONLY when the body cannot be shown: the owner-audit join answered
 * `unavailable` (expired at the hub, conversation gone, no audit here) or it
 * loaded with no usable hash at all. NOT while it is still loading (a body
 * about to arrive must not be skipped, and nothing acts on load), NOT when a
 * body is on screen or withheld with a hash (that path binds the hash, as
 * before), and NOT on a `mismatch` (the view disagrees with what was
 * screened; it keeps its "cannot verify" line and arms nothing, as QA Q2
 * decided). Deliver never takes this path.
 *
 * ONLY WHEN DELIVER IS CLOSED (PR #2017 round 1: code M1, security S-1, QA
 * Q-1, copy C1). `unavailable` also covers a transient failure (a 429, a
 * network error, a machine without owner-audit support) on a hold that is
 * still deliverable. Arming there would offer an irreversible unread Discard
 * of a message a retry could show and Deliver, under copy saying it can no
 * longer be delivered. So the fallback is for a hold whose Deliver window has
 * passed or that was never deliverable (`!affordance.deliver`); a fresh hold
 * that fails to load keeps "Try again" and arms nothing.
 *
 * ONLY WHEN CORE SAYS THE ROW IS ACTIONABLE (review m1). Core mints a receipt
 * without checking the conversation, yet the decide contract refuses an empty
 * `conversation_id` before IPC, and core serves `actionable: false` there. A
 * button that can only be refused is a dead end, so neither arms it.
 */
export function receiptDiscardArmed(
	item: Pick<
		HoldItem,
		| "discard_receipt"
		| "message_id"
		| "conversation_id"
		| "actionable"
		| "decision"
	>,
	affordance: HoldAffordance,
	detail: "loading" | "unavailable" | "ready",
	binding: BodyBinding | null,
): boolean {
	if (affordance.state !== "open" && affordance.state !== "deliver_expired")
		return false;
	if (affordance.deliver || !affordance.discard) return false;
	if (item.decision) return false;
	if (item.actionable === false) return false;
	if (typeof item.conversation_id !== "string" || !item.conversation_id)
		return false;
	const receipt = item.discard_receipt;
	if (typeof receipt !== "string" || !SHA256_HEX.test(receipt)) return false;
	if (detail === "unavailable") return true;
	return detail === "ready" && binding?.state === "none";
}

/**
 * The proof a press may send, or null when that word is not armed. Deliver
 * binds only a shown body (`armed.deliver` already requires it seen in full,
 * nothing hidden); Discard binds the body's hash when there is one, else the
 * receipt when `receiptDiscardArmed`. Pure so the "Deliver never carries a
 * receipt" rule is tested from the shipped source.
 */
export function holdDecideProof(
	word: HoldWord,
	input: {
		armed: { deliver: boolean; discard: boolean };
		binding: BodyBinding | null;
		receipt: string | null;
	},
): HoldProof | null {
	const hash =
		input.binding &&
		(input.binding.state === "shown" || input.binding.state === "withheld")
			? input.binding.hash
			: null;
	if (word === "deliver")
		return input.armed.deliver && input.binding?.state === "shown" && hash
			? { body_sha256: hash }
			: null;
	if (!input.armed.discard) return null;
	if (hash) return { body_sha256: hash };
	return input.receipt ? { hold_receipt: input.receipt } : null;
}

const MESSAGE_ID_PREFIX = /^(?:bcmsg|bmsg)_/;

/**
 * A short, stable reference for a row whose sender and text cannot load: the
 * only identity such a row has, so the confirm step can name WHICH message.
 *
 * The FIRST 8 characters of the bare id (copy C4): `lop team-bridge holds`
 * prints the full id start-first and people name a message by its start
 * ("5ac4b3e8…"), so the reference must match what they see elsewhere.
 * Display only: the decide still binds the full id and the receipt.
 */
export function holdReference(messageId: string): string {
	const bare = messageId.replace(MESSAGE_ID_PREFIX, "");
	return bare.length > 8 ? bare.slice(0, 8) : bare;
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
