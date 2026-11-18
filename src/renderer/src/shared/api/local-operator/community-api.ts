import { z } from "zod";
/**
 * The Local Operator Community client for the renderer (RFC v2.4 §7.2).
 *
 * WHERE THE TRUTH LIVES. The desktop renderer never talks to the community hub
 * itself: every call goes IPC -> main -> the local daemon's
 * `/v1/desktop/community/*` routes (local-operator PR #4214), which hold the
 * Radient credential, enforce the member-operation allowlist and map every hub
 * answer onto a closed `code`. This file is the typed seam over those thirteen
 * ops and nothing more; it adds no policy of its own.
 *
 * WHY THE RESPONSES ARE PARSED HERE. The daemon already validates the hub's
 * shapes (`community/models.py`, `extra="ignore"` with closed enums). Parsing
 * again at this boundary is what turns a malformed answer into the surface's own
 * error state rather than an `undefined` deep inside a row. Objects are
 * `passthrough` so an additive daemon field never breaks an older app, while
 * the enums the copy keys on (refusal category, submission state, event type)
 * stay closed: an unknown category must never be shown as some other one.
 *
 * REFUSALS ARE FACTS, NOT SENTENCES. The daemon answers
 * `{"detail": {"code": ..., <facts>}}` and authors no English; the transport
 * surfaces that body on `DesktopControlError.detail`. `communityFailure` reads
 * the code and its facts (category + reference, retry_after + scope, the new
 * guidelines version) into a closed union the composer renders with its own
 * localized copy. Nothing from a hub `message` is ever displayed.
 */
import {
	COMMUNITY_IDEMPOTENCY_KEY_PATTERN,
	type DesktopRequest,
} from "../../../../../shared/desktop-contract";
import { DesktopControlError, desktopResult } from "./desktop-api";

/* ------------------------------------------------------------------ shapes */

export const communityStateSchema = z.enum(["active", "read_only"]);

export const communitySchema = z
	.object({
		id: z.string(),
		slug: z.string(),
		name: z.string(),
		state: communityStateSchema,
		avatar_asset_id: z.string().nullable().optional(),
	})
	.passthrough();
export type CommunityRecord = z.infer<typeof communitySchema>;

export const communityListSchema = z
	.object({
		joined: z.array(communitySchema),
		featured: z.array(communitySchema),
	})
	.passthrough();
export type CommunityList = z.infer<typeof communityListSchema>;

export const communityBootstrapSchema = z
	.object({
		community_id: z.string(),
		community: communitySchema,
		guidelines: z
			.object({ version: z.string(), text: z.string() })
			.passthrough(),
		membership: z
			.object({
				status: z.literal("active"),
				guidelines_version: z.string(),
				accepted_at: z.string(),
			})
			.passthrough()
			.nullable(),
	})
	.passthrough();
export type CommunityBootstrap = z.infer<typeof communityBootstrapSchema>;

export const communityChannelSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		visibility: z.enum(["public", "private"]),
		purpose: z.string().nullable().optional(),
		/** Members cannot post (staff and moderators can): #welcome-and-rules. */
		locked: z.boolean().nullable().optional(),
		archived: z.boolean().nullable().optional(),
		member: z.boolean().nullable().optional(),
		unread: z.number().int().min(0).nullable().optional(),
		/*
		 * Not in contract 1.0.0-draft; read when a later hub adds it (Browse's
		 * member counts, frame D5). Absent, the row shows no count rather than
		 * a guessed one.
		 */
		member_count: z.number().int().min(0).nullable().optional(),
	})
	.passthrough();
export type CommunityChannel = z.infer<typeof communityChannelSchema>;

export const communityChannelPageSchema = z
	.object({
		items: z.array(communityChannelSchema),
		next_cursor: z.string().nullable(),
	})
	.passthrough();
export type CommunityChannelPage = z.infer<typeof communityChannelPageSchema>;

export const communityAuthorSchema = z
	.object({
		kind: z.enum(["human", "agent", "system", "former_member"]),
		display_name: z.string(),
		public_id: z.string().nullable().optional(),
		agent_handle: z.string().nullable().optional(),
		/*
		 * Not in contract 1.0.0-draft (planned per RFC §5.3 badges). Read when
		 * present so a staff or moderator badge appears without a client change.
		 */
		role: z
			.enum(["member", "moderator", "community_admin", "staff"])
			.nullable()
			.optional(),
	})
	.passthrough();
export type CommunityAuthor = z.infer<typeof communityAuthorSchema>;

export const communityMessageSchema = z
	.object({
		id: z.string(),
		conversation_id: z.string(),
		seq: z.number().int(),
		author: communityAuthorSchema,
		created_at: z.string(),
		revision: z.number().int().nullable().optional(),
		text: z.string().nullable().optional(),
		asset_ids: z.array(z.string()).nullable().optional(),
		thread_root_id: z.string().nullable().optional(),
		reply_count: z.number().int().nullable().optional(),
		reactions: z
			.array(
				z
					.object({
						emoji: z.string(),
						count: z.number().int(),
						mine: z.boolean().nullable().optional(),
					})
					.passthrough(),
			)
			.nullable()
			.optional(),
		edited: z.boolean().nullable().optional(),
		/*
		 * Whether the viewer may edit/delete this message. Not in contract
		 * 1.0.0-draft; the client falls back to "authored by me" by public id.
		 */
		mine: z.boolean().nullable().optional(),
	})
	.passthrough();
export type CommunityMessage = z.infer<typeof communityMessageSchema>;

export const communityMessagePageSchema = z
	.object({
		items: z.array(communityMessageSchema),
		next_cursor: z.string().nullable(),
	})
	.passthrough();
export type CommunityMessagePage = z.infer<typeof communityMessagePageSchema>;

export const communityRefusalCategorySchema = z.enum([
	"unsafe_or_illegal",
	"harassment_or_abuse",
	"spam_or_promotion",
	"private_information",
]);
export type CommunityRefusalCategory = z.infer<
	typeof communityRefusalCategorySchema
>;

/** The contract's reference format; only the sender ever sees it. */
const REFERENCE_PATTERN = /^MOD-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export const communitySubmissionSchema = z
	.object({
		idempotency_key: z.string().regex(COMMUNITY_IDEMPOTENCY_KEY_PATTERN),
		state: z.enum(["checking", "published", "refused", "cancelled", "expired"]),
		message_id: z.string().nullable().optional(),
		refusal: z
			.object({
				status: z.literal("refused"),
				category: communityRefusalCategorySchema,
				reference: z.string().regex(REFERENCE_PATTERN),
			})
			.passthrough()
			.nullable()
			.optional(),
	})
	.passthrough();
export type CommunitySubmission = z.infer<typeof communitySubmissionSchema>;

export const communityEventTypeSchema = z.enum([
	"conversation_changed",
	"unread_changed",
	"request_changed",
	"membership_changed",
	"approval_changed",
	"community_changed",
]);

export const communityEventBatchSchema = z
	.object({
		events: z.array(
			z
				.object({
					type: communityEventTypeSchema,
					conversation_id: z.string().nullable().optional(),
				})
				.passthrough(),
		),
		next: z.string(),
	})
	.passthrough();
export type CommunityEventBatch = z.infer<typeof communityEventBatchSchema>;

export type CommunityImageInput = {
	content_type: "image/png" | "image/jpeg" | "image/webp";
	data_base64: string;
};

/* ---------------------------------------------------------------- failures */

/**
 * Every way a community call can fail that a surface draws differently.
 *
 * Closed on purpose: the composer's sender-only outcomes (frame D7) key on the
 * `kind`, and a new daemon code lands on `error` (a retryable "something went
 * wrong") rather than on a sentence that claims more than the app knows.
 */
export type CommunityFailure =
	| {
			kind: "refused";
			category: CommunityRefusalCategory;
			reference: string;
			idempotencyKey?: string;
	  }
	| { kind: "rate_limited"; retryAfterS: number; scope: string | null }
	| { kind: "moderation_unavailable"; retryAfterS: number | null }
	| { kind: "images_unavailable" }
	| { kind: "guidelines_changed"; guidelinesVersion: string | null }
	| { kind: "payload_too_large" }
	| { kind: "signin_required" }
	| { kind: "account_mismatch" }
	| { kind: "disabled" }
	| { kind: "not_found" }
	| { kind: "forbidden" }
	/** Nothing answered: offline, daemon down, or the transport timed out. */
	| { kind: "unreachable" }
	| { kind: "error"; code: string | null };

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * Read a thrown community call into a `CommunityFailure`.
 *
 * The code comes from the transport (`DesktopControlError.code`, the daemon's
 * `detail.code`), the facts from the body object it carried. A refusal whose
 * facts do not match the contract (an unknown category, a malformed reference)
 * is an `error`, never a refusal with a made-up label.
 */
export function communityFailure(error: unknown): CommunityFailure {
	if (!(error instanceof DesktopControlError))
		return { kind: "error", code: null };
	if (error.status === null) return { kind: "unreachable" };
	const detail = record(error.detail);
	const code =
		typeof detail.code === "string" ? detail.code : (error.code ?? null);
	switch (code) {
		case "refused": {
			const category = communityRefusalCategorySchema.safeParse(
				detail.category,
			);
			const reference =
				typeof detail.reference === "string" &&
				REFERENCE_PATTERN.test(detail.reference)
					? detail.reference
					: null;
			if (!category.success || !reference) return { kind: "error", code };
			return {
				kind: "refused",
				category: category.data,
				reference,
				...(typeof detail.idempotency_key === "string"
					? { idempotencyKey: detail.idempotency_key }
					: {}),
			};
		}
		case "rate_limited": {
			const retry = Number(detail.retry_after);
			return {
				kind: "rate_limited",
				// A missing or garbled wait still blocks the send: a minute is the
				// burst window (RFC §6.3: 10 a minute), never zero.
				retryAfterS:
					Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60,
				scope: typeof detail.scope === "string" ? detail.scope : null,
			};
		}
		case "moderation_unavailable": {
			const retry = Number(detail.retry_after);
			return {
				kind: "moderation_unavailable",
				retryAfterS:
					detail.retry_after != null && Number.isFinite(retry) && retry > 0
						? Math.ceil(retry)
						: null,
			};
		}
		case "images_unavailable":
			return { kind: "images_unavailable" };
		case "guidelines_changed":
			return {
				kind: "guidelines_changed",
				guidelinesVersion:
					typeof detail.guidelines_version === "string"
						? detail.guidelines_version
						: null,
			};
		case "payload_too_large":
			return { kind: "payload_too_large" };
		case "community_signin_required":
			return { kind: "signin_required" };
		case "account_mismatch":
			return { kind: "account_mismatch" };
		case "community_disabled":
			return { kind: "disabled" };
		case "community_not_found":
			return { kind: "not_found" };
		case "forbidden":
			return { kind: "forbidden" };
		case "community_unreachable":
			return { kind: "unreachable" };
		default:
			return { kind: "error", code };
	}
}

/* -------------------------------------------------------------- idempotency */

/**
 * A fresh idempotency key for ONE submission attempt.
 *
 * Minted here rather than by the daemon so the composer knows the key while the
 * submit is still in flight: that is what lets Cancel name the attempt it means
 * (`submission.cancel`) and lets a lost answer be recovered by
 * `submission.status`. A key is reused ONLY to ask about the same attempt; the
 * hub answers a reused key with the FIRST attempt's stored outcome whatever the
 * body (contract: reused keys always return the first outcome, never 409), so a
 * retry after a refusal, a limit or a moderation outage mints a new one.
 */
export function newCommunityIdempotencyKey(): string {
	const bytes = new Uint8Array(18);
	crypto.getRandomValues(bytes);
	let out = "";
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
	return `lo_${out}`; // i18n: ignore machine idempotency key, never shown
}

/* --------------------------------------------------------------------- api */

type Owner = { expectedAccountId?: string };

const owner = (input: Owner) =>
	input.expectedAccountId
		? { expected_account_id: input.expectedAccountId }
		: {};

async function call<T>(request: DesktopRequest, schema: z.ZodType<T>) {
	return schema.parse(await desktopResult<unknown>(request));
}

/**
 * The thirteen member operations, one method each, in the daemon's order.
 * Every method carries the owner receipt when the caller has one.
 */
export const communityApi = {
	list: (input: Owner = {}) =>
		call(
			{ op: "community.communities.list", ...owner(input) },
			communityListSchema,
		),

	bootstrap: (communityId: string, input: Owner = {}) =>
		call(
			{ op: "community.bootstrap", community_id: communityId, ...owner(input) },
			communityBootstrapSchema,
		),

	join: (communityId: string, guidelinesVersion: string, input: Owner = {}) =>
		call(
			{
				op: "community.join",
				community_id: communityId,
				guidelines_version: guidelinesVersion,
				accept_guidelines: true,
				...owner(input),
			},
			z.unknown(),
		),

	leave: (communityId: string, input: Owner = {}) =>
		call(
			{ op: "community.leave", community_id: communityId, ...owner(input) },
			z.unknown(),
		),

	channels: (
		communityId: string,
		query: {
			q?: string;
			filter?: "all" | "joined" | "public" | "private";
			cursor?: string;
		} & Owner = {},
	) =>
		call(
			{
				op: "community.channels",
				community_id: communityId,
				...(query.q ? { q: query.q } : {}),
				...(query.filter ? { filter: query.filter } : {}),
				...(query.cursor ? { cursor: query.cursor } : {}),
				...owner(query),
			},
			communityChannelPageSchema,
		),

	history: (
		communityId: string,
		conversationId: string,
		input: { cursor?: string } & Owner = {},
	) =>
		call(
			{
				op: "community.history",
				community_id: communityId,
				conversation_id: conversationId,
				...(input.cursor ? { cursor: input.cursor } : {}),
				...owner(input),
			},
			communityMessagePageSchema,
		),

	submit: (
		communityId: string,
		conversationId: string,
		input: {
			text: string;
			images?: CommunityImageInput[];
			threadRootId?: string;
			guidelinesVersion?: string;
			idempotencyKey: string;
		} & Owner,
	) =>
		call(
			{
				op: "community.submit",
				community_id: communityId,
				conversation_id: conversationId,
				text: input.text,
				...(input.images?.length ? { images: input.images } : {}),
				...(input.threadRootId ? { thread_root_id: input.threadRootId } : {}),
				...(input.guidelinesVersion
					? { guidelines_version: input.guidelinesVersion }
					: {}),
				idempotency_key: input.idempotencyKey,
				...owner(input),
			},
			communitySubmissionSchema,
		),

	submissionStatus: (
		communityId: string,
		idempotencyKey: string,
		input: Owner = {},
	) =>
		call(
			{
				op: "community.submission.status",
				community_id: communityId,
				idempotency_key: idempotencyKey,
				...owner(input),
			},
			communitySubmissionSchema,
		),

	cancelSubmission: (
		communityId: string,
		idempotencyKey: string,
		input: Owner = {},
	) =>
		call(
			{
				op: "community.submission.cancel",
				community_id: communityId,
				idempotency_key: idempotencyKey,
				...owner(input),
			},
			communitySubmissionSchema,
		),

	edit: (
		communityId: string,
		messageId: string,
		input: {
			text: string;
			guidelinesVersion?: string;
			idempotencyKey: string;
		} & Owner,
	) =>
		call(
			{
				op: "community.edit",
				community_id: communityId,
				message_id: messageId,
				text: input.text,
				...(input.guidelinesVersion
					? { guidelines_version: input.guidelinesVersion }
					: {}),
				idempotency_key: input.idempotencyKey,
				...owner(input),
			},
			communitySubmissionSchema,
		),

	remove: (communityId: string, messageId: string, input: Owner = {}) =>
		call(
			{
				op: "community.delete",
				community_id: communityId,
				message_id: messageId,
				...owner(input),
			},
			z.unknown(),
		),

	react: (
		communityId: string,
		messageId: string,
		input: { emoji: string; remove?: boolean } & Owner,
	) =>
		call(
			{
				op: "community.react",
				community_id: communityId,
				message_id: messageId,
				emoji: input.emoji,
				...(input.remove ? { remove: true } : {}),
				...owner(input),
			},
			z.unknown(),
		),

	events: (communityId: string, input: { after?: string } & Owner = {}) =>
		call(
			{
				op: "community.events",
				community_id: communityId,
				...(input.after ? { after: input.after } : {}),
				...owner(input),
			},
			communityEventBatchSchema,
		),
};
