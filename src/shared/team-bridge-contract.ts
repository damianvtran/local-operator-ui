import { z } from "zod";

/**
 * The Team Bridge conversation wire shapes (docs/TEAM-BRIDGE-CONVERSATIONS.md).
 *
 * WHY A LOCAL SCHEMA. The desktop route is a pass-through of the hub's answer,
 * so the renderer is the second consumer of a shape it did not produce. Parsing
 * here does two things a cast cannot: an unfamiliar REQUIRED field fails closed
 * (the page shows its error state instead of rendering `undefined`), and an
 * ADDITIVE field survives (`.passthrough()`), which is the contract's own rule
 * for the hub. Participant labels are the only names on the wire; a schema that
 * demanded an email would be demanding something the server never sends.
 *
 * The body is deliberately optional: a human member's history carries it, an
 * agent member's history carries `null` until that agent admitted the message.
 * Rendering must treat "no body" as a state, not a crash.
 */

const id = z.string().min(1).max(128);

export const teamBridgeParticipantSchema = z
	.object({
		account_id: id,
		kind: z.enum(["human", "agent"]),
		display_label: z.string().min(1).max(64),
		role: z.enum(["owner", "member"]),
		state: z.enum(["invited", "active", "left", "removed"]),
		joined_seq: z.number().int().nonnegative().optional(),
	})
	.passthrough();
export type TeamBridgeParticipant = z.infer<typeof teamBridgeParticipantSchema>;

export const teamBridgeConversationSchema = z
	.object({
		id,
		tenant_id: id,
		kind: z.enum(["dm", "group", "channel"]),
		name: z.string().optional(),
		topic: z.string().optional(),
		visibility: z.enum(["private", "tenant"]),
		agent_capable: z.boolean(),
		status: z.enum(["open", "archived"]),
		created_by: id,
		last_message_at: z.string(),
		latest_seq: z.number().int().nonnegative(),
		members: z.array(teamBridgeParticipantSchema),
		last_read_seq: z.number().int().nonnegative(),
		unread_count: z.number().int().nonnegative(),
		muted: z.boolean(),
	})
	.passthrough();
export type TeamBridgeConversation = z.infer<
	typeof teamBridgeConversationSchema
>;

export const teamBridgeConversationListSchema = z
	.object({
		conversations: z.array(teamBridgeConversationSchema),
		has_more: z.boolean().optional(),
		next_before: z.string().optional(),
	})
	.passthrough();
export type TeamBridgeConversationList = z.infer<
	typeof teamBridgeConversationListSchema
>;

export const teamBridgeMessageSchema = z
	.object({
		id,
		conversation_id: id,
		seq: z.number().int().nonnegative(),
		sender: z
			.object({
				account_id: id,
				kind: z.enum(["human", "agent"]),
				display_label: z.string().min(1).max(64),
			})
			.passthrough(),
		body: z.string().nullable(),
		body_hash: z.string().optional(),
		origin: z.enum(["human", "agent", "system"]),
		agent_label: z.string().optional(),
		created_at: z.string(),
	})
	.passthrough();
export type TeamBridgeMessage = z.infer<typeof teamBridgeMessageSchema>;

export const teamBridgeMessagePageSchema = z
	.object({
		messages: z.array(teamBridgeMessageSchema),
		next_before_seq: z.number().int().nonnegative().optional(),
		has_more: z.boolean().optional(),
	})
	.passthrough();
export type TeamBridgeMessagePage = z.infer<typeof teamBridgeMessagePageSchema>;

export const teamBridgeUnreadOrganizationSchema = z
	.object({
		tenant_id: id,
		tenant_name: z.string(),
		unread: z.number().int().nonnegative(),
		eligible: z.boolean(),
	})
	.passthrough();
export type TeamBridgeUnreadOrganization = z.infer<
	typeof teamBridgeUnreadOrganizationSchema
>;

/**
 * The unread answer, in either of its two scopes.
 *
 * A TENANT read carries `conversations` and no `organizations`; an ACCOUNT read
 * (`scope=account`) carries `organizations` and no `conversations` — the server
 * deliberately never sends both, because the account aggregate is one authorized
 * read rather than a client-side sum of per-conversation rows. Both list fields
 * are optional here for exactly that reason: requiring `conversations` would
 * make every account read fail to parse, which is the opposite of the additive
 * rule this contract follows. `total` stays required in both scopes and is the
 * badge's number; the UI never derives the account badge from the per-org rows.
 */
export const teamBridgeUnreadSchema = z
	.object({
		total: z.number().int().nonnegative(),
		conversations: z
			.array(
				z
					.object({
						conversation_id: id,
						unread_count: z.number().int().nonnegative(),
						last_read_seq: z.number().int().nonnegative(),
						latest_seq: z.number().int().nonnegative(),
						muted: z.boolean(),
					})
					.passthrough(),
			)
			.optional(),
		organizations: z.array(teamBridgeUnreadOrganizationSchema).optional(),
	})
	.passthrough();
export type TeamBridgeUnread = z.infer<typeof teamBridgeUnreadSchema>;

/** The status read's identity slice: the signed-in hub account, or null. */
export const teamBridgeIdentitySchema = z
	.object({ account_id: z.string().min(1).nullable().optional() })
	.passthrough();
export type TeamBridgeIdentity = z.infer<typeof teamBridgeIdentitySchema>;

export const teamBridgeReadStateSchema = z
	.object({
		conversation_id: id,
		last_read_seq: z.number().int().nonnegative(),
		unread_count: z.number().int().nonnegative(),
		muted: z.boolean(),
	})
	.passthrough();
export type TeamBridgeReadState = z.infer<typeof teamBridgeReadStateSchema>;

/** The two read scopes the desktop route forwards. Writes never accept this. */
export type TeamBridgeReadScope = { tenantId: string } | "account";

/** One member as the create/add request states it (the wire is snake_case). */
export type TeamBridgeMemberInput = {
	account_id: string;
	kind: "human" | "agent";
	endpoint_id?: string;
	display_label: string;
};
