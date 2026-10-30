import { z } from "zod";

/** Human-only wire shapes from core's desktop_team_bridge_owner_audit models.
 * Keep these separate from member history: auditing never produces read state,
 * notifications, or agent context. Hub vocabularies are additive, so unfamiliar
 * statuses must reach a conservative UI fallback rather than reject the page.
 * Optional nullable fields mirror the proxy's exclude_unset projection. */
const id = z.string().min(1);
const nullableText = z.string().nullish();
const nullableSeq = z.number().int().nullish();

export const ownerAuditMemberSchema = z
	.object({
		account_id: id,
		kind: z.string(),
		display_label: z.string().default(""),
		role: z.string().default(""),
		state: z.string().default(""),
		joined_seq: nullableSeq,
		notify: nullableText,
	})
	.passthrough();

export const ownerAuditViewerSchema = z
	.object({
		account_id: id,
		display_label: z.string().default(""),
		reason: z.string().default("agent_owner"),
		agent_member_key: z.string().default(""),
	})
	.passthrough();

export const ownerAuditConversationSchema = z
	.object({
		id,
		tenant_id: id,
		kind: z.string(),
		name: nullableText,
		topic: nullableText,
		visibility: z.string().default(""),
		status: z.string().default(""),
		builtin: nullableText,
		last_message_at: nullableText,
		latest_seq: z.number().int().default(0),
		last_thread_root_id: nullableText,
		members: z.array(ownerAuditMemberSchema).default([]),
		member_count: z.number().int().default(0),
		viewers: z.array(ownerAuditViewerSchema).nullish(),
		agent: z
			.object({
				account_id: id,
				display_label: z.string().default(""),
				state: z.string(),
				joined_seq: z.number().int(),
				left_seq: nullableSeq,
			})
			.passthrough(),
	})
	.passthrough();
export type OwnerAuditConversation = z.infer<
	typeof ownerAuditConversationSchema
>;

export const ownerAuditConversationPageSchema = z
	.object({
		conversations: z.array(ownerAuditConversationSchema),
		next_cursor: nullableText,
		has_more: z.boolean().default(false),
	})
	.passthrough();

export const ownerAuditAttachmentSchema = z
	.object({
		id,
		mime: z.string().default(""),
		size: z.number().int().default(0),
		width: nullableSeq,
		height: nullableSeq,
		sha256: z.string().default(""),
		state: z.string().default(""),
		expires_at: nullableText,
	})
	.passthrough();

export const ownerAuditMessageSchema = z
	.object({
		id,
		conversation_id: id,
		seq: z.number().int(),
		sender: z
			.object({
				account_id: id,
				kind: z.string(),
				display_label: z.string().default(""),
			})
			.passthrough(),
		body: nullableText,
		body_hash: nullableText,
		origin: z.string().default(""),
		agent_label: nullableText,
		created_at: z.string(),
		thread_root_id: nullableText,
		reply_count: nullableSeq,
		last_reply_at: nullableText,
		reply_participants: z.array(z.string()).nullish(),
		attachments: z.array(ownerAuditAttachmentSchema).nullish(),
		attachment_count: nullableSeq,
		agent_delivery_status: nullableText,
		agent_verdict_at: nullableText,
	})
	.passthrough();
export type OwnerAuditMessage = z.infer<typeof ownerAuditMessageSchema>;

export const ownerAuditMessagePageSchema = z
	.object({
		messages: z.array(ownerAuditMessageSchema),
		next_before_seq: nullableSeq,
		has_more: z.boolean().default(false),
	})
	.passthrough();

export const ownerAuditThreadSchema = z
	.object({
		root: ownerAuditMessageSchema,
		replies: z.array(ownerAuditMessageSchema),
		next_after_seq: nullableSeq,
		has_more: z.boolean().default(false),
	})
	.passthrough();
