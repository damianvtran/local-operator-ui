/**
 * PHONE PAIRING BY APPROVAL - the renderer's model of core's pairing card
 * (local-operator #3949, `features.phone_pairing`; pairing design v2 §1-§2, §4.2).
 *
 * A phone that wants to approve actions on this computer files a `pair_phone`
 * approval. Core serves it as an ordinary `GET /v1/desktop/approvals` row that
 * carries an extra, keyless `pairing` block (`pair_op.row_pairing`): the mode,
 * the sanitised name, the six digits in confirm mode ONLY, the live progress,
 * both digests to echo and the gesture sentence. Everything in this file is pure
 * so the popup, its stories and its tests share one reading of that block.
 *
 * ## The two modes, and the rule that makes the typed one mean anything
 *
 * - `confirm`: the request reached this computer through the owner's Radient
 *   account and the edge attested it. Both screens show the same six digits;
 *   the person compares them and presses "Codes match - Approve".
 * - `code`: anything else (a custom tunnel, a password cookie). The desktop
 *   NEVER renders the digits - core sends `sas: null` in this mode, and
 *   {@link parsePairingRow} drops any digits a code-mode row carries anyway -
 *   because typing a number already on this screen proves nothing about the phone.
 *
 * ## The name is the attacker's
 *
 * Whoever files the request chooses `phone_name`. Core strips bidi overrides and
 * invisible characters and clamps it to 40 display characters; this file does the
 * same again ({@link displayPhoneName}) so a backend bug is not a spoofing hole,
 * and the popup renders it as plain text inside a `<bdi>`, never as markup.
 */

/** Core's `pair_op.MODE_*`. */
export type PairingMode = "confirm" | "code";

/**
 * Core's closed `reason` vocabulary (`pair_op.REASON_*`, design v2 §2.2). A value
 * outside it is a contract break, so the row is treated as undescribable.
 */
export const PAIRING_REASONS = [
	"waiting",
	"signing",
	"admin_prompt_open",
	"failed_retryable",
	"strikes_exhausted",
	"denied_by_user",
	"withdrawn",
	"expired",
	"paired",
] as const;
export type PairingReason = (typeof PAIRING_REASONS)[number];

/** The three reasons a LIVE card can show (`pair_op.LIVE_PROGRESS`). */
export const LIVE_PAIRING_REASONS: ReadonlySet<PairingReason> = new Set([
	"waiting",
	"signing",
	"admin_prompt_open",
]);

/** Core's display clamp (`pair_op.PHONE_NAME_DISPLAY_CHARS`). */
export const PHONE_NAME_DISPLAY_CHARS = 40;
/** Core's clamp for the full name (`display_name(..., limit=64)`). */
export const PHONE_NAME_FULL_CHARS = 64;

/** What one `pair_phone` row means to the popup. */
export type PairingCard = {
	approvalId: string;
	mode: PairingMode;
	/** The clamped name; render as text only. */
	phoneName: string;
	/** The same name with the longer clamp, for the hover title / expansion. */
	phoneNameFull: string;
	/** `ios` | `android` | `web` | "" - what the phone said it is. */
	platform: string;
	/** Six digits, CONFIRM MODE ONLY. Always null in code mode. */
	sas: string | null;
	/** Unix seconds, or null when the row carried none. */
	expiresAt: number | null;
	reason: PairingReason;
	triesLeft: number;
	/** The attested Radient account id (confirm mode only). */
	account: string | null;
	requestDigest: string;
	disclosureDigest: string;
	/**
	 * Core's assurance for this host's operator anchor; null means nothing may be
	 * signed here yet (phone approvals are not turned on), so Approve cannot work.
	 */
	assurance: string | null;
	/** Core's gesture sentence (D13), already in the person's language. */
	gesture: string;
};

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SIX_DIGITS = /^\d{6}$/;
/** Core's device-id rule (`devices_revoke._DEVICE_ID`). */
const DEVICE_ID = /^[A-Za-z0-9]{1,64}$/;
const APPROVAL_ID = /^ap_[0-9a-hjkmnp-tv-z]{1,64}$/;

/*
 * Bidi embeddings/overrides/isolates, zero-width and other invisible format
 * characters, the BOM, and C0/C1 controls. U+200D (zero-width joiner) is kept, as
 * core keeps it (`_KEPT_FORMAT_CHARS`): it is what holds an emoji sequence together.
 */
const UNSAFE_NAME_CHARS =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
	/[\u0000-\u001f\u007f-\u009f\u061c\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/g;

/** Split into user-perceived characters where the platform can, else code points. */
function graphemes(text: string): string[] {
	const Segmenter = (
		Intl as unknown as {
			Segmenter?: new (
				locale?: string,
				options?: { granularity: "grapheme" },
			) => { segment(input: string): Iterable<{ segment: string }> };
		}
	).Segmenter;
	if (Segmenter) {
		return Array.from(
			new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
			(part) => part.segment,
		);
	}
	return Array.from(text);
}

/**
 * The requester's name, made safe to show: invisible and direction-changing
 * characters removed, whitespace collapsed, and clamped to `limit` graphemes
 * with an ellipsis. Defence in depth: core already did this, and doing it again
 * costs nothing while a missed character would let a name reorder the sentence
 * around it.
 */
export function displayPhoneName(
	raw: unknown,
	limit = PHONE_NAME_DISPLAY_CHARS,
): string {
	const text = String(raw ?? "")
		.replace(UNSAFE_NAME_CHARS, "")
		.replace(/\s+/g, " ")
		.trim();
	const parts = graphemes(text);
	if (parts.length <= limit) return text;
	return `${parts.slice(0, Math.max(1, limit - 1)).join("")}…`;
}

/** `482913` → `482 913`, the grouping every pairing surface uses (D11). */
export function groupPairingCode(code: string): string {
	return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** `482913` → `4 8 2 9 1 3`: read digit by digit, never as one number (D11). */
export function sasAriaDigits(code: string): string {
	return code.split("").join(" ");
}

/** Digits only, at most six: what a typed or pasted code becomes. */
export function normalizeTypedCode(input: string): string {
	return input.replace(/\D/g, "").slice(0, 6);
}

/** "Expires in m:ss" for a positive remainder; `0:00` once it has passed. */
export function formatCountdown(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(whole / 60);
	const rest = whole % 60;
	return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One approvals row → a {@link PairingCard}, or null for any row that is not a
 * describable phone pairing. Strict on purpose: the digests are echoed to core
 * byte for byte, so a malformed one means a card that could never be approved,
 * and a reason outside core's closed set is a contract this build does not know.
 */
export function parsePairingRow(row: unknown): PairingCard | null {
	if (!isRecord(row)) return null;
	const approvalId = row.approval_id;
	const block = row.pairing;
	if (typeof approvalId !== "string" || !APPROVAL_ID.test(approvalId))
		return null;
	if (!isRecord(block)) return null;
	const mode = block.mode;
	if (mode !== "confirm" && mode !== "code") return null;
	const reason = block.reason;
	if (
		typeof reason !== "string" ||
		!(PAIRING_REASONS as readonly string[]).includes(reason)
	)
		return null;
	const requestDigest = block.request_digest;
	const disclosureDigest = block.disclosure_digest;
	if (
		typeof requestDigest !== "string" ||
		!DIGEST.test(requestDigest) ||
		typeof disclosureDigest !== "string" ||
		!DIGEST.test(disclosureDigest)
	)
		return null;
	const sas =
		// THE TYPED-MODE RULE, enforced here as well as by core: a code-mode card
		// never carries digits into the renderer, whatever the row says.
		mode === "confirm" &&
		typeof block.sas === "string" &&
		SIX_DIGITS.test(block.sas)
			? block.sas
			: null;
	const phoneName = displayPhoneName(block.phone_name);
	const full = displayPhoneName(
		block.phone_name_full ?? block.phone_name,
		PHONE_NAME_FULL_CHARS,
	);
	const tries = block.tries_left;
	return {
		approvalId,
		mode,
		phoneName,
		phoneNameFull: full || phoneName,
		platform: typeof block.platform === "string" ? block.platform : "",
		sas,
		expiresAt:
			typeof block.expires_at === "number" && Number.isFinite(block.expires_at)
				? block.expires_at
				: null,
		reason: reason as PairingReason,
		triesLeft:
			typeof tries === "number" && Number.isInteger(tries) && tries >= 0
				? tries
				: 0,
		account:
			mode === "confirm" && typeof block.account === "string" && block.account
				? block.account
				: null,
		requestDigest,
		disclosureDigest,
		assurance:
			typeof block.assurance === "string" && block.assurance
				? block.assurance
				: null,
		gesture: typeof block.gesture === "string" ? block.gesture : "",
	};
}

/** Every describable pairing card in an approvals list, in list order. */
export function pairingCards(result: unknown): PairingCard[] {
	// Core answers `{approvals: [...]}` (`ApprovalList`); a bare array is accepted
	// as the Mesh tray's reader accepts it.
	const rows = Array.isArray(result)
		? result
		: isRecord(result)
			? result.approvals
			: undefined;
	if (!Array.isArray(rows)) return [];
	return rows.flatMap((row) => {
		const card = parsePairingRow(row);
		return card ? [card] : [];
	});
}

/**
 * The card the popup should raise. Core files at most one live pairing, and the
 * feed names it (`pair_request`); when the feed has said nothing yet (a renderer
 * that launched mid-request, an older feed) the newest LIVE card in the list is
 * that same one. `failed_retryable` counts as live here: its window is still open
 * and the person can try again.
 */
export function livePairingCard(
	cards: readonly PairingCard[],
	feedPairRequest: string | null | undefined,
): PairingCard | null {
	const live = (card: PairingCard) =>
		LIVE_PAIRING_REASONS.has(card.reason) || card.reason === "failed_retryable";
	if (feedPairRequest) {
		const named = cards.find((card) => card.approvalId === feedPairRequest);
		if (named && live(named)) return named;
	}
	for (let index = cards.length - 1; index >= 0; index--) {
		if (live(cards[index])) return cards[index];
	}
	return null;
}

/** Core's Paired-phones row states (`devices_revoke.STATE_*`). */
export type PairedPhoneState =
	| "paired"
	| "unconfirmed"
	| "removing"
	| "revoked";

export type PairedPhone = {
	deviceId: string;
	name: string;
	platform: string;
	/** Unix seconds, or null. */
	pairedAt: number | null;
	/** Unix seconds, or null. */
	lastSeen: number | null;
	state: PairedPhoneState;
};

const PAIRED_PHONE_STATES: ReadonlySet<string> = new Set([
	"paired",
	"unconfirmed",
	"removing",
	"revoked",
]);

/**
 * `GET /v1/desktop/devices` → the rows Settings lists. A `revoked` phone is gone
 * as far as the person is concerned (core keeps its id on the revoked list
 * forever, which is why it still lists), so it is not shown; `removing` is, with
 * its Finish removing action, because one step of the removal still needs the
 * admin prompt.
 */
export function pairedPhones(result: unknown): PairedPhone[] {
	const devices = isRecord(result) ? result.devices : undefined;
	if (!Array.isArray(devices)) return [];
	return devices.flatMap((row): PairedPhone[] => {
		if (!isRecord(row)) return [];
		const deviceId = row.device_id;
		const state = row.state;
		if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) return [];
		if (typeof state !== "string" || !PAIRED_PHONE_STATES.has(state)) return [];
		if (state === "revoked") return [];
		const seconds = (value: unknown) =>
			typeof value === "number" && Number.isFinite(value) && value > 0
				? value
				: null;
		return [
			{
				deviceId,
				name: displayPhoneName(row.name, PHONE_NAME_FULL_CHARS),
				platform: typeof row.platform === "string" ? row.platform : "",
				pairedAt: seconds(row.paired_at),
				lastSeen: seconds(row.last_seen),
				state: state as PairedPhoneState,
			},
		];
	});
}
