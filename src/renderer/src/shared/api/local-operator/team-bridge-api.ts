/**
 * The renderer's Team Bridge conversation client.
 *
 * Every call goes through `desktopResult` and therefore through the desktop
 * bearer, the same-origin guard and the shared refusal mapping — never a bare
 * `fetch`. The schemas are parsed at this boundary so the page can rely on the
 * shape it renders; a failure here is the page's error state, not a render
 * crash three components down.
 *
 * Mutations are named for what the user does, not for the HTTP verb: `send`,
 * `startConversation`, `markRead`. The `unread` read is separate and cheap on
 * purpose — it is the one call the sidebar badge makes, and it must never pull
 * a message body.
 */
import {
	type TeamBridgeConversation,
	type TeamBridgeConversationList,
	type TeamBridgeMemberInput,
	type TeamBridgeMessagePage,
	type TeamBridgeReadState,
	type TeamBridgeUnread,
	teamBridgeConversationListSchema,
	teamBridgeConversationSchema,
	teamBridgeMessagePageSchema,
	teamBridgeReadStateSchema,
	teamBridgeUnreadSchema,
} from "../../../../../shared/team-bridge-contract";
import { desktopResult } from "./desktop-api";

export const TeamBridgeApi = {
	async listConversations(
		tenantId?: string,
	): Promise<TeamBridgeConversationList> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.list",
			...(tenantId ? { tenant_id: tenantId } : {}),
		});
		return teamBridgeConversationListSchema.parse(answer);
	},

	async getConversation(
		conversationId: string,
		tenantId?: string,
	): Promise<TeamBridgeConversation> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.get",
			conversation_id: conversationId,
			...(tenantId ? { tenant_id: tenantId } : {}),
		});
		return teamBridgeConversationSchema.parse(answer);
	},

	async startConversation(input: {
		kind: "dm" | "group" | "channel";
		name?: string;
		topic?: string;
		visibility?: "private" | "tenant";
		agentCapable?: boolean;
		members: TeamBridgeMemberInput[];
		tenantId?: string;
	}): Promise<TeamBridgeConversation> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.create",
			kind: input.kind,
			...(input.tenantId ? { tenant_id: input.tenantId } : {}),
			...(input.name ? { name: input.name } : {}),
			...(input.topic ? { topic: input.topic } : {}),
			...(input.visibility ? { visibility: input.visibility } : {}),
			...(input.agentCapable === undefined
				? {}
				: { agent_capable: input.agentCapable }),
			members: input.members,
		});
		return teamBridgeConversationSchema.parse(answer);
	},

	async listMessages(
		conversationId: string,
		options: { tenantId?: string; limit?: number; beforeSeq?: number } = {},
	): Promise<TeamBridgeMessagePage> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.messages.list",
			conversation_id: conversationId,
			...(options.tenantId ? { tenant_id: options.tenantId } : {}),
			...(options.limit === undefined ? {} : { limit: options.limit }),
			...(options.beforeSeq === undefined
				? {}
				: { before_seq: options.beforeSeq }),
		});
		return teamBridgeMessagePageSchema.parse(answer);
	},

	async send(
		conversationId: string,
		input: { clientRef: string; body: string; tenantId?: string },
	): Promise<unknown> {
		return desktopResult<unknown>({
			op: "team_bridge.messages.send",
			conversation_id: conversationId,
			client_ref: input.clientRef,
			body: input.body,
			...(input.tenantId ? { tenant_id: input.tenantId } : {}),
		});
	},

	async markRead(
		conversationId: string,
		input: { seq?: number; muted?: boolean; tenantId?: string },
	): Promise<TeamBridgeReadState> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.read",
			conversation_id: conversationId,
			...(input.tenantId ? { tenant_id: input.tenantId } : {}),
			...(input.seq === undefined ? {} : { seq: input.seq }),
			...(input.muted === undefined ? {} : { muted: input.muted }),
		});
		return teamBridgeReadStateSchema.parse(answer);
	},

	async unread(tenantId?: string): Promise<TeamBridgeUnread> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.unread",
			...(tenantId ? { tenant_id: tenantId } : {}),
		});
		return teamBridgeUnreadSchema.parse(answer);
	},

	async setArchived(
		conversationId: string,
		archive: boolean,
	): Promise<unknown> {
		return desktopResult<unknown>({
			op: "team_bridge.conversations.lifecycle",
			conversation_id: conversationId,
			action: archive ? "archive" : "unarchive",
		});
	},

	async leave(conversationId: string): Promise<unknown> {
		return desktopResult<unknown>({
			op: "team_bridge.conversations.lifecycle",
			conversation_id: conversationId,
			action: "leave",
		});
	},
};
