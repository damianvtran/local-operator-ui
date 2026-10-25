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
	type AgentMessagesBoundary,
	type AgentMessagesStatus,
	agentMessagesStatusSchema,
} from "../../../../../shared/agent-messages-contract";
import {
	type TeamBridgeConversation,
	type TeamBridgeConversationList,
	type TeamBridgeDirectory,
	type TeamBridgeMemberInput,
	type TeamBridgeMessagePage,
	type TeamBridgeNotify,
	type TeamBridgeReadScope,
	type TeamBridgeReadState,
	type TeamBridgeThreadPage,
	type TeamBridgeUnread,
	teamBridgeConversationListSchema,
	teamBridgeConversationSchema,
	teamBridgeDirectorySchema,
	teamBridgeIdentitySchema,
	teamBridgeMessagePageSchema,
	teamBridgeReactionsSchema,
	teamBridgeReadStateSchema,
	teamBridgeScheduledListSchema,
	teamBridgeScheduledMessageSchema,
	teamBridgeThreadPageSchema,
	teamBridgeUnreadSchema,
} from "../../../../../shared/team-bridge-contract";
import {
	browserDraftStorage,
	reconcileDraftAccount,
} from "../../store/team-bridge-draft-account";
import { desktopResult } from "./desktop-api";

/** An old runtime cannot atomically bind a private write to its captured author.
 * Fail closed, rather than claiming a renderer status check closes that race.
 * Target tenant is explicit and may differ from the OAuth token's default org. */
export async function teamBridgeWriteOwner(
	accountId: string | undefined,
	tenantId: string | undefined,
) {
	if (!accountId || !tenantId)
		throw new Error("Team Bridge write owner and tenant required");
	const capabilities = await desktopResult<{
		features?: Record<string, number>;
	}>({ op: "capabilities" });
	if ((capabilities.features?.team_bridge_conversation_owner_guard ?? 0) < 1)
		throw new Error("Team Bridge runtime owner guard unavailable");
	return { expected_account_id: accountId, tenant_id: tenantId };
}

export const TeamBridgeApi = {
	async scheduledList(tenantId: string) {
		return teamBridgeScheduledListSchema.parse(
			await desktopResult<unknown>({
				op: "team_bridge.scheduled.list",
				tenant_id: tenantId,
			}),
		);
	},
	async scheduledCreate(input: {
		tenant_id: string;
		conversation_id: string;
		client_ref: string;
		body: string;
		send_at: string;
		thread_root_id?: string;
	}) {
		return teamBridgeScheduledMessageSchema.parse(
			await desktopResult<unknown>({
				op: "team_bridge.scheduled.create",
				...input,
			}),
		);
	},
	async scheduledUpdate(
		tenantId: string,
		scheduledId: string,
		patch: { body?: string; send_at?: string },
	) {
		return teamBridgeScheduledMessageSchema.parse(
			await desktopResult<unknown>({
				op: "team_bridge.scheduled.update",
				tenant_id: tenantId,
				scheduled_id: scheduledId,
				...patch,
			}),
		);
	},
	async scheduledCancel(tenantId: string, scheduledId: string) {
		return desktopResult<unknown>({
			op: "team_bridge.scheduled.cancel",
			tenant_id: tenantId,
			scheduled_id: scheduledId,
		});
	},
	async react(
		conversationId: string,
		messageId: string,
		emoji: string,
		active: boolean,
		tenantId?: string,
	) {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.reactions.toggle",
			conversation_id: conversationId,
			message_id: messageId,
			emoji,
			active,
			...(tenantId ? { tenant_id: tenantId } : {}),
		});
		return teamBridgeReactionsSchema.parse(answer);
	},

	/**
	 * The conversation page for one read scope.
	 *
	 * `"account"` is the server's merged read (`scope=account`): active
	 * memberships are derived server-side and every row carries its own
	 * `tenant_id`. A tenant scope names exactly one organization and never sends
	 * a tenant list — no route accepts one.
	 */
	async listConversations(
		scope: TeamBridgeReadScope,
	): Promise<TeamBridgeConversationList> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.list",
			...(scope === "account"
				? { scope: "account" }
				: { tenant_id: scope.tenantId }),
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
		expectedAccountId?: string;
	}): Promise<TeamBridgeConversation> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.create",
			...(await teamBridgeWriteOwner(input.expectedAccountId, input.tenantId)),
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

	/** One thread: the root with its rollup and its replies, oldest-first. */
	async listReplies(
		conversationId: string,
		rootId: string,
		options: { tenantId?: string; limit?: number; afterSeq?: number } = {},
	): Promise<TeamBridgeThreadPage> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.messages.replies",
			conversation_id: conversationId,
			message_id: rootId,
			...(options.tenantId ? { tenant_id: options.tenantId } : {}),
			...(options.limit === undefined ? {} : { limit: options.limit }),
			...(options.afterSeq === undefined
				? {}
				: { after_seq: options.afterSeq }),
		});
		return teamBridgeThreadPageSchema.parse(answer);
	},

	async send(
		conversationId: string,
		input: {
			clientRef: string;
			body: string;
			expectedAccountId?: string;
			tenantId?: string;
			/* Set to reply in that root's thread; omitted for a channel-level post. */
			threadRootId?: string;
		},
	): Promise<unknown> {
		return desktopResult<unknown>({
			op: "team_bridge.messages.send",
			// Threads retain the renderer fence, but are not advertised by the
			// conversation-owner capability until their runtime feature adopts it.
			...(!input.threadRootId
				? await teamBridgeWriteOwner(input.expectedAccountId, input.tenantId)
				: {}),
			conversation_id: conversationId,
			client_ref: input.clientRef,
			body: input.body,
			...(input.tenantId ? { tenant_id: input.tenantId } : {}),
			...(input.threadRootId ? { thread_root_id: input.threadRootId } : {}),
		});
	},

	async markRead(
		conversationId: string,
		input: {
			seq?: number;
			muted?: boolean;
			tenantId?: string;
			expectedAccountId?: string;
		},
	): Promise<TeamBridgeReadState> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.read",
			...(await teamBridgeWriteOwner(input.expectedAccountId, input.tenantId)),
			conversation_id: conversationId,
			...(input.tenantId ? { tenant_id: input.tenantId } : {}),
			...(input.seq === undefined ? {} : { seq: input.seq }),
			...(input.muted === undefined ? {} : { muted: input.muted }),
		});
		return teamBridgeReadStateSchema.parse(answer);
	},

	/**
	 * The signed-in hub account id, from the existing status read. The page
	 * needs it to tell "mine" from "theirs" (own-message alignment and a DM's
	 * title); it is the one identity the bridge surface already publishes, and
	 * this reads it rather than inventing a second notion of self.
	 */
	async identity(): Promise<string | null> {
		const answer = await desktopResult<unknown>({
			op: "agent_messages.status",
			boundary: "surface_open",
		});
		const parsed = teamBridgeIdentitySchema.parse(answer);
		reconcileDraftAccount(browserDraftStorage(), parsed);
		return parsed.account_id ?? null;
	},

	/**
	 * The unread read. `"account"` returns the one aggregate the badge spends
	 * (total plus per-org rows); a tenant scope returns that org's rows. The
	 * desktop route forwards `scope=account` and never invents a client list.
	 */
	async unread(scope: TeamBridgeReadScope): Promise<TeamBridgeUnread> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.unread",
			...(scope === "account"
				? { scope: "account" }
				: { tenant_id: scope.tenantId }),
		});
		return teamBridgeUnreadSchema.parse(answer);
	},

	/**
	 * One organization's active people, with their bridge eligibility.
	 *
	 * The tenant is REQUIRED, not optional: the rail's People section only
	 * exists under a selected organization, and an absent tenant would make the
	 * server resolve its own default — the one way this read could show the
	 * wrong organization's roster. Parsing the answer here means a malformed
	 * directory is the section's own error state, never a crash in a row.
	 */
	async directory(tenantId: string): Promise<TeamBridgeDirectory> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.directory",
			tenant_id: tenantId,
		});
		return teamBridgeDirectorySchema.parse(answer);
	},

	/**
	 * The bridge's platform state, parsed with the SAME schema the settings
	 * surface uses: one status payload, two op spellings. The page reads this
	 * for the plan/sign-in cue; `identity()` still reads the account id through
	 * the settings op because the notification watcher depends on that exact
	 * cache entry.
	 */
	async status(boundary?: AgentMessagesBoundary): Promise<AgentMessagesStatus> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.status",
			...(boundary ? { boundary } : {}),
		});
		const parsed = agentMessagesStatusSchema.parse(answer);
		reconcileDraftAccount(browserDraftStorage(), parsed);
		return parsed;
	},

	async setArchived(
		conversationId: string,
		archive: boolean,
		tenantId?: string,
		expectedAccountId?: string,
	): Promise<unknown> {
		return desktopResult<unknown>({
			op: "team_bridge.conversations.lifecycle",
			conversation_id: conversationId,
			action: archive ? "archive" : "unarchive",
			...(await teamBridgeWriteOwner(expectedAccountId, tenantId)),
		});
	},

	async leave(
		conversationId: string,
		tenantId?: string,
		expectedAccountId?: string,
	): Promise<unknown> {
		return desktopResult<unknown>({
			op: "team_bridge.conversations.lifecycle",
			conversation_id: conversationId,
			action: "leave",
			...(await teamBridgeWriteOwner(expectedAccountId, tenantId)),
		});
	},

	/**
	 * Join a discoverable channel, or accept an invitation.
	 *
	 * `tenantId` is the selected row's own organization, not the rail scope: in
	 * the merged view the scope is "all", and a join without a tenant would be
	 * resolved by whatever the server treats as default — the one way a row
	 * could be joined in the wrong organization. The server answer is the
	 * joined conversation, so the caller can parse it rather than guess.
	 */
	async join(
		conversationId: string,
		tenantId?: string,
		expectedAccountId?: string,
	): Promise<TeamBridgeConversation> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.join",
			...(await teamBridgeWriteOwner(expectedAccountId, tenantId)),
			conversation_id: conversationId,
			...(tenantId ? { tenant_id: tenantId } : {}),
		});
		return teamBridgeConversationSchema.parse(answer);
	},

	/**
	 * Set one conversation's notification register.
	 *
	 * The desktop op rides the read route's `notify` field (agent-server #148)
	 * and deliberately sends no `seq`: choosing a level must not move the read
	 * cursor. The server's answer is the read post-state, which carries the
	 * canonical `muted` flag this client derives from the same value.
	 */
	async setNotify(
		conversationId: string,
		notify: TeamBridgeNotify,
		tenantId?: string,
		expectedAccountId?: string,
	): Promise<TeamBridgeReadState> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.notify",
			...(await teamBridgeWriteOwner(expectedAccountId, tenantId)),
			conversation_id: conversationId,
			...(tenantId ? { tenant_id: tenantId } : {}),
			notify,
		});
		return teamBridgeReadStateSchema.parse(answer);
	},
};
