/**
 * @file publication-errors.ts
 * @description The refusal vocabulary of instruction-set publication, in one place.
 *
 * Publishing an agent can fail for reasons that need DIFFERENT next steps from
 * the user: a name somebody else holds (choose another), a name the built-ins
 * reserve (choose another, or install that built-in), instructions the reviewer
 * refused (edit the instructions — a content decision, not a transient fault),
 * a review that could not run at all (retry; nothing was rejected), a document
 * that is too large, a listing that belongs to another account. The local
 * backend answers each with a structure — `detail: {code, message, details}` —
 * and this module is where that vocabulary is typed, so the renderer switches on
 * a union rather than on prose.
 *
 * The prose half is deliberately NOT in here. `message` is the sentence the
 * local backend or the hub composed and is rendered unchanged, and the
 * per-code headlines, bodies and actions — which are this app's copy, not the
 * transport's — live in `features/agents/utils/publication-failure.ts`. What is
 * here is only what both sides must agree on: the code set, the details keys,
 * the moderation taxonomy, and the fallback that keeps an OLDER backend a
 * supported state.
 */

import { DesktopControlError } from "./desktop-api";

/**
 * Every code the publication path can be refused with (agent-hub contract §2.4
 * plus the proxy's own two).
 *
 * A closed set rather than `string`: the renderer's switch over it must be
 * exhaustive, so a code added to the backend without a treatment here is
 * visible as a type error rather than as a refusal that falls through to a
 * generic sentence.
 */
export const PUBLICATION_ERROR_CODES = [
	/** The document broke a rule: a cap, a name rule, an unknown field, a bad kind. */
	"invalid_instruction_set",
	/** The document is larger than the hub's 64 KiB body bound. */
	"payload_too_large",
	/** Another account has published this name. Agent names are unique on the hub. */
	"name_taken",
	"name_claim_in_flight",
	/** The name belongs to a built-in agent, which the hub reserves. */
	"name_reserved_builtin",
	/** The reviewer refused the instruction body. A content decision, not a fault. */
	"moderation_rejected",
	/** The review could not run. NOTHING was published and nothing was rejected. */
	"moderation_unavailable",
	/** The listing being updated belongs to another account. */
	"not_owner",
	/** The listing being updated does not exist (it may have been delisted). */
	"agent_not_found",
	/** The hub could not be reached, or answered something unrecognisable. */
	"hub_unavailable",
	/** This machine failed before the hub was asked anything. */
	"local_failure",
] as const;

export type PublicationErrorCode = (typeof PUBLICATION_ERROR_CODES)[number];

/**
 * The moderation taxonomy (contract §4.7), a closed set in the reviewer.
 *
 * Deliberately NOT the hub's browse categories: one is a review taxonomy and the
 * other is a browse taxonomy, and folding them together would make a rejection
 * reason look like a filter. An unrecognised value is treated as
 * `other_harmful`, which is what the reviewer itself does with model output it
 * cannot place.
 */
export const MODERATION_CATEGORIES = [
	"malware_or_exploitation",
	"credential_theft",
	"fraud_or_deception",
	"harassment_or_hate",
	"sexual_content_minors",
	"sexual_content",
	"violence_or_weapons",
	"drugs_or_controlled_substances",
	"self_harm",
	"mass_surveillance_or_privacy_abuse",
	"evasion_or_abuse_tooling",
	"prompt_injection",
	"unclear_dual_use",
	"other_harmful",
] as const;

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

/**
 * The machine-readable half of a refusal, per code.
 *
 * Every key optional: `details` holds no prose (anything a user reads is in
 * `message`), it is the part a client switches on, and a code arrives with only
 * the keys its trigger knows. Typed as one object rather than a union per code
 * because a handler may hold a refusal whose code it has not narrowed yet, and
 * because an unknown-but-present key must not be a type error at a call site
 * that only reads `reason`.
 */
export type PublicationDetails = {
	/** `invalid_instruction_set`: the field that broke a rule, and the rule. */
	field?: string;
	rule?: string;
	/** `invalid_instruction_set`: present when a document_version is too new. */
	supported_versions?: number[];
	/** `payload_too_large`: the bound that was exceeded. */
	limit_bytes?: number;
	/** `name_taken`: the row that holds the name, and whether it is the caller's. */
	existing_agent_id?: string;
	owned_by_caller?: boolean;
	/** `name_reserved_builtin`: which built-in reserved it (the name is what the UI shows). */
	builtin_name?: string;
	builtin_source_url?: string;
	manifest_version?: string;
	/** `moderation_rejected`: the categories cited and the reviewer's reason. */
	categories?: string[];
	reason?: string;
	model?: string;
	prompt_version?: string;
	/** `moderation_unavailable`: how many attempts the retry budget spent. */
	attempts?: number;
};

/**
 * A publication the hub or the proxy refused, carrying its own vocabulary.
 *
 * Extends `DesktopControlError` rather than standing beside it because the
 * message here is AUTHORED COPY — the backend's sentence, or the hub's — and
 * `userFacingMessage` decides what may be shown to a user by exactly that class
 * check. A separate error class would make every publish refusal render as
 * "something went wrong", which is the defect that check exists to prevent.
 */
export class PublicationError extends DesktopControlError {
	/** Narrowed from the base's `string`: this family of refusals has a closed set. */
	declare readonly code: PublicationErrorCode;

	readonly details: PublicationDetails;

	constructor(
		status: number | null,
		code: PublicationErrorCode,
		message: string,
		details: PublicationDetails = {},
	) {
		super(status, message, undefined, code);
		this.details = details;
	}
}

export function isPublicationError(error: unknown): error is PublicationError {
	return error instanceof PublicationError;
}

export function isModerationCategory(
	value: string,
): value is ModerationCategory {
	return (MODERATION_CATEGORIES as readonly string[]).includes(value);
}

/** The `detail` object of a refusal, if the envelope carries one. */
function detailObject(body: unknown): {
	code?: unknown;
	message?: unknown;
	details?: unknown;
} | null {
	if (typeof body !== "object" || body === null) return null;
	const detail = (body as { detail?: unknown }).detail;
	if (typeof detail !== "object" || detail === null) return null;
	return detail as { code?: unknown; message?: unknown; details?: unknown };
}

/** The prose sentence in an envelope, whether the `detail` is a string or an object. */
export function publicationProse(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const detail = (body as { detail?: unknown }).detail;
	if (typeof detail === "string" && detail.trim()) return detail;
	const structured = detailObject(body);
	return typeof structured?.message === "string" && structured.message.trim()
		? structured.message
		: null;
}

/**
 * The typed refusal in a failed response body, or `null` when there is none.
 *
 * `null` is a REQUIRED outcome, not a defensive one: an older local backend
 * answers its publication failures with one prose `detail` string (the D-2 shape
 * this whole path exists to retire), and a 404 for an unknown op means the
 * backend predates this app. Those are supported states in this app, so the
 * caller falls back to the prose it was given instead of inventing a code. An
 * UNKNOWN code — a hub newer than this renderer — takes the same path for the
 * same reason: a wrong treatment is worse than a plainer sentence.
 */
export function publicationErrorFromBody(
	status: number,
	body: unknown,
): PublicationError | null {
	const detail = detailObject(body);
	if (!detail) return null;
	const code = detail.code;
	if (typeof code !== "string") return null;
	if (!(PUBLICATION_ERROR_CODES as readonly string[]).includes(code))
		return null;
	const message =
		typeof detail.message === "string" && detail.message.trim()
			? detail.message
			: "The agent could not be published.";
	const details =
		typeof detail.details === "object" && detail.details !== null
			? (detail.details as PublicationDetails)
			: {};
	return new PublicationError(
		status,
		code as PublicationErrorCode,
		message,
		details,
	);
}
