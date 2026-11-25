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
	/**
	 * local-operator #4546: the thread root when the held message is a REPLY.
	 * The hub keeps replies off the conversation timeline, so the owner-audit
	 * join must read that root's replies page to find it. Null or absent (an
	 * older core, or a top-level message) means "read the timeline".
	 */
	thread_root_id?: string | null;
	/** Renderer-only fingerprint; never supplied by the holds API. */
	localHideRevision?: string;
};

export type HoldsPage = {
	enabled: boolean;
	key_protection: string | null;
	items: HoldItem[];
	/** Signed receipts from newer core; older daemons only report item decisions. */
	history?: HoldItem[];
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
	outcome?: string;
	key_id?: string | null;
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
 * Core calls a completed Discard `rejected`; an operational `refused` is
 * not an owner rejection. Only an outcome consistent with the recorded word
 * can be presented as applied; unknowns must not read as success.
 */
export function holdDecisionStatus(
	word: HoldWord | null,
	outcome: string,
): "applied" | "pending" | "local" | "not_applied" {
	if (word && outcome === "pending") return "pending";
	if (word === "discard" && outcome === "discarded_local_unconfirmed")
		return "local";
	if (
		(word === "deliver" && outcome === "admitted") ||
		(word === "discard" && outcome === "rejected")
	)
		return "applied";
	return "not_applied";
}

/** The POST state is the recorded word, not confirmation it reached the hub. */
export function holdFromReceipt(
	item: HoldItem,
	word: HoldWord,
	receipt: HoldReceipt,
): HoldItem | null {
	if (
		receipt.message_id !== item.message_id ||
		!receipt.decided_at ||
		receipt.state !== (word === "deliver" ? "released" : "discarded")
	)
		return null;
	return {
		...item,
		actionable: false,
		releasable: false,
		can_deliver: false,
		can_discard: false,
		discard_receipt: null,
		decision: {
			word,
			decided_at: receipt.decided_at,
			outcome: receipt.outcome ?? "pending",
			key_id: receipt.key_id ?? null,
		},
	};
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
 * The list's authority on whether the person owes this hold an answer. The
 * badges have only metadata; the inbox additionally knows if the required
 * proof can actually be shown or bound.
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
	// A recorded attempt belongs in History even if a stale list flag says otherwise.
	if (item.decision) return false;
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
export function holdRefusalLabel(
	code: string | null | undefined,
	receipt = false,
): string {
	switch (code) {
		case "hold_release_off":
			return t("ui.teamBridge.holds.refusal.release_off");
		case "hold_not_releasable":
			return t("ui.teamBridge.holds.refusal.not_releasable");
		case "snapshot_stale":
			return receipt
				? t("ui.teamBridge.holdsBatch.stale_receipt")
				: t("ui.teamBridge.holds.refusal.stale");
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

type HoldContent = {
	body?: string | null;
	attachments?: readonly unknown[] | null;
	attachment_count?: number | null;
	files?: readonly unknown[] | null;
	file_count?: number | null;
};

/** A count-only audit receipt is still shown by the attachment disclosure. */
export function holdAttachmentCounts(message: HoldContent | null) {
	return {
		images: message?.attachments?.length || message?.attachment_count || 0,
		files: Math.max(message?.files?.length ?? 0, message?.file_count ?? 0),
	};
}

function hasLocalHoldContent(detail: JoinedDetail<HoldContent>): boolean {
	if (detail.state !== "ready") return false;
	const { images, files } = holdAttachmentCounts(detail.message);
	return Boolean(detail.message.body?.length || images + files > 0);
}

function hasValidReceipt(
	item: Pick<HoldItem, "discard_receipt">,
): item is { discard_receipt: string } {
	return (
		typeof item.discard_receipt === "string" &&
		SHA256_HEX.test(item.discard_receipt)
	);
}

/**
 * Whether the row's metadata alone could ever arm a receipt Discard (the
 * item-level half of `receiptDiscardArmed`, independent of what loaded).
 */
function receiptDiscardPossible(item: HoldItem, a: HoldAffordance): boolean {
	return (
		(a.state === "open" || a.state === "deliver_expired") &&
		a.discard &&
		item.actionable !== false &&
		typeof item.conversation_id === "string" &&
		Boolean(item.conversation_id) &&
		hasValidReceipt(item)
	);
}

/**
 * Which fingerprint a local hide is keyed by, or null when no hide may match.
 *
 * - `receipt`: the #4358 case, an expired receipt row. Keyed by the receipt,
 *   so a re-screen (new receipt) brings the row back. Unchanged, so hides a
 *   person already stored keep matching.
 * - `metadata`: an undecided row that can NEVER be discarded here (no
 *   receipt, a malformed one, core says `actionable: false`, no conversation,
 *   or core offers no Discard). Operator report 2026-11-24: such a row sat in
 *   the list with only "Try again" and no way out. Keyed by its id, code and
 *   hold time; the moment core serves a usable receipt the row stops matching
 *   this kind, so a hide never outlives the chance to really Discard it.
 */
function localHideKind(
	item: HoldItem,
	now?: number,
): "receipt" | "metadata" | null {
	if (item.decision) return null;
	const a = holdAffordance(item, now);
	if (a.state === "deliver_expired" && hasValidReceipt(item)) return "receipt";
	return receiptDiscardPossible(item, a) ? null : "metadata";
}

function canMatchLocalHide(item: HoldItem, now?: number): boolean {
	return localHideKind(item, now) !== null;
}

export function canHideHoldLocally(
	item: HoldItem,
	detail: JoinedDetail<HoldContent>,
	now?: number,
): boolean {
	const kind = localHideKind(item, now);
	if (kind === null || detail.state === "loading") return false;
	if (hasLocalHoldContent(detail)) return false;
	/* A metadata row whose withheld body still carries a hash has a real,
	   body-bound Discard; it is not stuck, so it is not hidden instead. */
	if (
		kind === "metadata" &&
		detail.state === "ready" &&
		(detail.binding.state === "shown" || detail.binding.state === "withheld")
	)
		return false;
	return true;
}

/** Store a separate fingerprint, never the receipt used by a disposition. */
export async function addLocalHoldRevisions(
	accountId: string,
	page: HoldsPage,
): Promise<HoldsPage> {
	const items = await Promise.all(
		page.items.map(async (item) => {
			const kind = accountId ? localHideKind(item) : null;
			if (!kind) return item;
			try {
				const digest = await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(
						JSON.stringify(
							kind === "receipt"
								? [
										"team-bridge-local-hold-hide-v1",
										accountId,
										item.message_id,
										item.discard_receipt,
									]
								: /* Distinct tag: a metadata fingerprint can never
									   collide with a receipt one. */
									[
										"team-bridge-local-hold-hide-meta-v1",
										accountId,
										item.message_id,
										item.conversation_id,
										item.hold_code,
										item.held_at,
									],
						),
					),
				);
				const localHideRevision = Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, "0"),
				).join("");
				return { ...item, localHideRevision };
			} catch {
				// A local presentation feature must not make the server's queue unreadable.
				return item;
			}
		}),
	);
	return { ...page, items };
}

/** Same projection for the queue and both badges. A different receipt never matches. */
export function isHoldHiddenLocally(
	item: HoldItem,
	revisions: ReadonlySet<string>,
): boolean {
	return Boolean(
		item.localHideRevision &&
			canMatchLocalHide(item) &&
			revisions.has(item.localHideRevision),
	);
}

/** Presentation-only: do not use this projection to drive detail queries. */
export function projectHeldMessages(
	items: readonly HoldItem[],
	revisions: ReadonlySet<string>,
	detail: (item: HoldItem) => JoinedDetail<HoldContent>,
	recorded: readonly HoldItem[] = [],
	persisted: readonly HoldItem[] = [],
	now?: number,
) {
	const waiting: HoldItem[] = [];
	const history: HoldItem[] = [];
	const hidden: HoldItem[] = [];
	const recovered: string[] = [];
	const byId = new Map(items.map((item) => [item.message_id, item]));
	// A POST receipt wins over an undecided list row until the next poll.
	// A decision in a subsequent list (including a refusal) is authoritative.
	for (const item of recorded) {
		if (item.decision && !byId.get(item.message_id)?.decision)
			byId.set(item.message_id, item);
	}
	for (const item of persisted) {
		if (item.decision) byId.set(item.message_id, item);
	}
	for (const item of byId.values()) {
		const found = detail(item);
		if (item.localHideRevision && isHoldHiddenLocally(item, revisions)) {
			if (!hasLocalHoldContent(found)) {
				hidden.push(item);
				continue;
			}
			recovered.push(item.localHideRevision);
		}
		// An in-flight join must not flicker into History. Once it finishes, a
		// legacy row without a usable proof belongs beside the local hide/retry
		// actions, not alongside decisions that can actually be made here.
		const proof = holdRowProofs(item, found, now);
		const awaits =
			isActionableHold(item, now) &&
			(found.state === "loading" || proof.armed.deliver || proof.armed.discard);
		(awaits ? waiting : history).push(item);
	}
	return { waiting, history, hidden, recovered };
}

/** Use immutable list/receipt clocks, not the order in which audit joins load. */
export function sortHoldInbox(
	items: readonly HoldItem[],
	tab: "waiting" | "history",
) {
	const time = (item: HoldItem) =>
		Date.parse(
			(tab === "history"
				? (item.decision?.decided_at ?? item.held_at)
				: item.held_at) ?? "",
		);
	return [...items].sort((a, b) => {
		const left = time(a);
		const right = time(b);
		if (Number.isFinite(left) && Number.isFinite(right) && left !== right)
			return tab === "history" ? right - left : left - right;
		if (Number.isFinite(left) !== Number.isFinite(right))
			return Number.isFinite(left) ? -1 : 1;
		return a.message_id < b.message_id
			? -1
			: a.message_id > b.message_id
				? 1
				: 0;
	});
}

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
 * ALSO INSIDE THE DELIVER WINDOW (operator report 2026-11-24; supersedes the
 * PR #2017 round 1 choice M1/S-1/Q-1 to arm only once Deliver had closed).
 * That choice assumed a fresh unloadable hold was transient, but some are
 * not: a held thread REPLY is never on the timeline page the join read, so
 * the row sat with "Try again" as its only action, no Discard, and greyed
 * "Dismiss all". The person must never be stuck with a held message. Discard
 * never delivers anything, so arming it here cannot leak a message to the
 * agent; what it costs is that a retry might have shown the body, which is
 * why "Try again" stays on the row beside it and the confirm step says the
 * message is discarded unread. Deliver is still never armed without a
 * shown body (and core refuses a receipt on Deliver with 422).
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
	if (!affordance.discard) return false;
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
/** Only the simple inline links/images whose full URL the proof renderer
 * prints can skip the literal fallback. Titles, references, escaped/nested
 * links, GFM tasks, HTML and entity decoding could otherwise conceal source.
 */
const SIMPLE_PROOF_LINK =
	/\[[^\[\]\r\n<>\\&]+\]\((?:https?:\/\/|mailto:)(?:[\w.~:/?#@!$+,;=-]|%[0-9a-fA-F]{2})+\)/g;
// A fenced code info string can have arbitrary metadata the fence won't show.
const ELIDING_MARKDOWN = /[\[<&]|(?:`{3,}|~{3,})[\t ]*[^\s`~]/;

export function needsLiteralHoldBody(body: string): boolean {
	return ELIDING_MARKDOWN.test(body.replace(SIMPLE_PROOF_LINK, ""));
}

/** Body/receipt/allowed-action checks shared by the inbox and the actual click. */
export function holdRowProofs(
	item: HoldItem,
	detail: JoinedDetail<HoldContent>,
	now?: number,
) {
	const affordance = holdAffordance(item, now);
	const binding = detail.state === "ready" ? detail.binding : null;
	const hidden =
		detail.state === "ready" && hasHiddenCharacters(detail.message.body);
	const actionable = isActionableHold(item, now);
	const unread =
		actionable && receiptDiscardArmed(item, affordance, detail.state, binding);
	const body =
		actionable && binding
			? armedWords(affordance, binding, true, hidden)
			: null;
	return {
		affordance,
		binding,
		hidden,
		unread,
		armed: {
			deliver: body?.deliver ?? false,
			discard: Boolean(body?.discard || unread),
		},
		receipt: unread ? (item.discard_receipt ?? null) : null,
	};
}

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

/** A human confirms this closed set, never the live list. Copies are essential:
 * a refresh or a new arrival must not replace the record/proof consent covered.
 * This deliberately reuses the single-row Discard gates; it cannot arm Deliver.
 */
export type DiscardSnapshotEntry = { item: HoldItem; proof: HoldProof };

export function captureDiscardSnapshot(
	items: readonly HoldItem[],
	detail: (item: HoldItem) => {
		state: "loading" | "unavailable" | "ready";
		binding?: BodyBinding;
	},
	now?: number,
): DiscardSnapshotEntry[] {
	return sortHolds(items, now).flatMap((item) => {
		if (!isActionableHold(item, now)) return [];
		const found = detail(item);
		const binding = found.state === "ready" ? (found.binding ?? null) : null;
		const affordance = holdAffordance(item, now);
		const unread = receiptDiscardArmed(item, affordance, found.state, binding);
		const discard =
			unread ||
			(binding !== null && armedWords(affordance, binding, false).discard);
		const proof = holdDecideProof("discard", {
			armed: { deliver: false, discard },
			binding,
			receipt: unread ? (item.discard_receipt ?? null) : null,
		});
		return proof ? [{ item: { ...item }, proof: { ...proof } }] : [];
	});
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
/**
 * Which owner-audit read can find this hold's message (operator report
 * 2026-11-24). The hub keeps thread REPLIES off the conversation timeline, so
 * a held reply looked up on the timeline page is never found and the row
 * reads `unavailable` forever. When core names the thread root (#4546), read
 * that root's replies newest-first up to this seq (the thread shares the
 * timeline's seq window); otherwise read the timeline page as before.
 */
export type HoldLookupRead =
	| { read: "timeline"; beforeSeq: number | undefined }
	| { read: "replies"; rootId: string; beforeSeq: number | undefined };

export function holdLookupRead(
	item: Pick<HoldItem, "seq" | "thread_root_id">,
): HoldLookupRead {
	const beforeSeq =
		typeof item.seq === "number" && item.seq >= 0 ? item.seq + 1 : undefined;
	const rootId = item.thread_root_id;
	return typeof rootId === "string" && rootId
		? { read: "replies", rootId, beforeSeq }
		: { read: "timeline", beforeSeq };
}

/** The held message among the rows a lookup read, or null (never a neighbour). */
export function findHeldMessage<M extends { id: string }>(
	item: Pick<HoldItem, "message_id">,
	rows: readonly M[],
): M | null {
	return rows.find((row) => row.id === item.message_id) ?? null;
}

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
