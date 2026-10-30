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
	TEAM_BRIDGE_OWNER_GUARD_UNAVAILABLE,
	type TeamBridgeAttachment,
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
	teamBridgeAttachmentUploadSchema,
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
import { desktopMedia, desktopResult } from "./desktop-api";

/*
 * A refused attachment upload or fetch, carrying only the HTTP status and the
 * hub's declared code - never the bytes, the id or a filename (D9). The chip
 * maps the status onto its own sentence (`attachmentFailureCopy`), so a
 * machine detail string never reaches the screen.
 */
export class TeamBridgeAttachmentError extends Error {
	readonly status: number | null;
	readonly code?: string;
	constructor(status: number | null, code?: string) {
		super("team bridge attachment request failed");
		this.name = "TeamBridgeAttachmentError";
		this.status = status;
		this.code = code;
	}
}

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
		// A plain Error, as before, so existing callers read it unchanged; the
		// code lets a caller say "update the app" instead of offering a retry.
		throw Object.assign(
			new Error("Team Bridge runtime owner guard unavailable"),
			{
				code: TEAM_BRIDGE_OWNER_GUARD_UNAVAILABLE,
			},
		);
	return { expected_account_id: accountId, tenant_id: tenantId };
}

/**
 * The captured account a send must carry, or a loud refusal.
 *
 * `send` requires `expectedAccountId` because every send is owner-guarded: a
 * top-level one is checked by `teamBridgeWriteOwner` and a threaded reply is
 * refused by `desktopRequestSchema` without it. A caller holding a possibly
 * unresolved account therefore fails here, before any request exists, instead
 * of posting as whoever signs in next. Renderer call sites reach this through
 * `useBridgeOwner`/`accountId`, both of which are optional until the account
 * read answers.
 */
export function requireBridgeWriteAccount(
	accountId: string | undefined,
): string {
	if (!accountId) throw new Error("Team Bridge write account required");
	return accountId;
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
		/* Staged ids the schedule RESERVES until delivery (D2: send_at + 7 d). */
		attachment_ids?: string[];
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
		patch: {
			body?: string;
			send_at?: string;
			attachment_ids?: string[];
			expected_version?: number;
		},
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
		tenantId: string,
		accountId: string,
	) {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.reactions.toggle",
			conversation_id: conversationId,
			message_id: messageId,
			emoji,
			active,
			tenant_id: tenantId,
			expected_account_id: accountId,
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
		status?: "archived",
		/** The previous page's `next_cursor`: how the archived view pages ("Load more"). */
		cursor?: string,
	): Promise<TeamBridgeConversationList> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.list",
			...(scope === "account"
				? { scope: "account" }
				: { tenant_id: scope.tenantId }),
			// Sent only when asked: the live list's request stays byte-identical.
			...(status ? { status } : {}),
			...(cursor ? { cursor } : {}),
		});
		const page = teamBridgeConversationListSchema.parse(answer);
		/*
		 * A server older than the `status` parameter ignores it and answers the LIVE
		 * list. Filter here so such a server shows an empty archive instead of every
		 * open channel under the "Archived channels" heading.
		 */
		return status
			? {
					...page,
					conversations: page.conversations.filter(
						(row) => row.status === status,
					),
				}
			: page;
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

	/**
	 * Invite people and agents into an existing group or channel.
	 *
	 * This route creates INVITATIONS, not active access. Humans join themselves;
	 * an agent stays `invited` and muted until its owner accepts through the
	 * separate consent route. The returned conversation is therefore authoritative
	 * about who is active, and this action never follows with a consent write.
	 */
	async addMembers(input: {
		conversationId: string;
		tenantId: string;
		expectedAccountId?: string;
		members: TeamBridgeMemberInput[];
	}): Promise<TeamBridgeConversation> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.members.add",
			...(await teamBridgeWriteOwner(input.expectedAccountId, input.tenantId)),
			conversation_id: input.conversationId,
			members: input.members,
		});
		return teamBridgeConversationSchema.parse(answer);
	},

	/** Remove one member; the hub owns administrator and owner-succession rules. */
	async removeMember(input: {
		conversationId: string;
		tenantId: string;
		expectedAccountId?: string;
		accountId: string;
	}): Promise<TeamBridgeConversation> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.members.remove",
			...(await teamBridgeWriteOwner(input.expectedAccountId, input.tenantId)),
			conversation_id: input.conversationId,
			account_id: input.accountId,
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
		options: {
			tenantId: string;
			accountId: string;
			limit?: number;
			afterSeq?: number;
		},
	): Promise<TeamBridgeThreadPage> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.messages.replies",
			conversation_id: conversationId,
			message_id: rootId,
			tenant_id: options.tenantId,
			expected_account_id: options.accountId,
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
			/* REQUIRED, not optional. Every send is owner-guarded now, and a
			 * threaded reply is refused by the request schema without it, so a
			 * caller that dropped the receipt would ship a path that 422s. Making
			 * it required at this boundary means deleting it fails `check-types`
			 * instead of failing at runtime on the reply the user just typed. */
			expectedAccountId: string;
			tenantId?: string;
			/* Set to reply in that root's thread; omitted for a channel-level post. */
			threadRootId?: string;
			/* Staged uploads this message binds. Omitted (never `[]`) when text-only,
			   so a text-only send stays byte-identical for an older hub. */
			attachmentIds?: readonly string[];
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
			/* A threaded reply REQUIRES the captured owner: `desktopRequestSchema`
			 * refuses `thread_root_id` without `expected_account_id`, so a caller
			 * that forgets it fails before main opens a socket rather than posting
			 * the reply as whoever signs in next. A top-level send reaches the same
			 * field through `teamBridgeWriteOwner` above. */
			...(input.expectedAccountId
				? { expected_account_id: input.expectedAccountId }
				: {}),
			...(input.tenantId ? { tenant_id: input.tenantId } : {}),
			...(input.threadRootId ? { thread_root_id: input.threadRootId } : {}),
			...(input.attachmentIds?.length
				? { attachment_ids: [...input.attachmentIds] }
				: {}),
		});
	},

	/**
	 * Stage one already-bounded image in a conversation. The bytes go through
	 * main's bearer relay as a raw body; the answer is a STAGED descriptor that
	 * a send or schedule binds. The hub dedupes identical bytes to the same id,
	 * so retrying a chip after a lost answer cannot stage twice.
	 */
	async uploadAttachment(
		tenantId: string,
		conversationId: string,
		bytes: Uint8Array,
		expectedAccountId: string,
	): Promise<TeamBridgeAttachment> {
		const answer = await desktopMedia(
			{
				op: "team_bridge.attachment.upload",
				tenantId,
				conversationId,
				expectedAccountId,
			},
			bytes,
		);
		if (answer.kind !== "json")
			throw new TeamBridgeAttachmentError(
				answer.kind === "error" ? answer.status : null,
				answer.kind === "error" ? answer.code : undefined,
			);
		// The runtime wraps the hub's `{attachment}` in its house CRUD envelope
		// (`{status, message, result}`), like every other relay JSON answer.
		const body = answer.body as { result?: unknown } | null;
		return teamBridgeAttachmentUploadSchema.parse(
			body && typeof body === "object" && "result" in body ? body.result : body,
		).attachment;
	},

	/** Discard a staged upload the author removed. Idempotent on the hub. */
	async deleteAttachment(
		tenantId: string,
		conversationId: string,
		attachmentId: string,
		expectedAccountId: string,
	): Promise<unknown> {
		return desktopResult<unknown>({
			op: "team_bridge.attachments.delete",
			tenant_id: tenantId,
			expected_account_id: expectedAccountId,
			conversation_id: conversationId,
			attachment_id: attachmentId,
		});
	},

	/**
	 * One bound attachment's bytes, member-gated on the hub. Main refuses any
	 * answer that is not png/jpeg, so the blob built from this is a picture.
	 */
	async attachmentBytes(input: {
		tenantId: string;
		conversationId: string;
		messageId: string;
		attachmentId: string;
		expectedAccountId: string;
	}): Promise<{ data: Uint8Array; mimeType: string }> {
		const answer = await desktopMedia(
			{ op: "team_bridge.attachment", ...input },
			null,
		);
		if (answer.kind !== "bytes")
			throw new TeamBridgeAttachmentError(
				answer.kind === "error" ? answer.status : null,
				answer.kind === "error" ? answer.code : undefined,
			);
		return { data: answer.data, mimeType: answer.mimeType };
	},

	/**
	 * Typed seam for private avatar derivatives through core's binary hub relay;
	 * never use the local desktop bearer on the directory's hub URL. The receipt
	 * captures the commissioning viewer. Old-runtime 404s remain safe fallbacks.
	 */
	async avatarBytes(input: {
		expectedAccountId: string;
		accountId: string;
		hash: string;
		size: 64 | 256;
	}): Promise<{ data: Uint8Array; mimeType: string }> {
		const answer = await desktopMedia(
			{ op: "team_bridge.avatar", ...input },
			null,
		);
		if (answer.kind !== "bytes")
			throw new TeamBridgeAttachmentError(
				answer.kind === "error" ? answer.status : null,
				answer.kind === "error" ? answer.code : undefined,
			);
		return { data: answer.data, mimeType: answer.mimeType };
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
		// Nullable: a denied or absent storage must not fail the identity read.
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
		// Nullable: a denied or absent storage must not fail the status read.
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

	/**
	 * PERMANENTLY delete an ARCHIVED conversation. Irreversible.
	 *
	 * Carries the captured-owner receipt like every conversation write, so the call
	 * is refused before dispatch if the signed-in account changed since the person
	 * confirmed. The server decides who may delete and refuses an open or built-in
	 * conversation; a repeat after completion answers `conversation_not_found`.
	 */
	async deleteConversation(
		conversationId: string,
		tenantId?: string,
		expectedAccountId?: string,
	): Promise<unknown> {
		return desktopResult<unknown>({
			op: "team_bridge.conversations.delete",
			conversation_id: conversationId,
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
	 * Answer an invitation for the caller's OWN agent (agent-server `Consent`).
	 *
	 * An agent added to a channel or group stays `invited` until its owner
	 * answers; this is the only transition that makes it `active`, and the agent
	 * can never take it for itself. `accountId` is the owner's account (the hub
	 * refuses any other with `agent_not_permitted`), and the owner guard rides
	 * along so a request started under one account cannot land under another.
	 * The answer is the conversation's post-state; accepting changes only the
	 * member's state, never its notification register, so it still joins muted.
	 */
	async answerAgentInvitation(input: {
		conversationId: string;
		accountId: string;
		tenantId: string;
		decision: "accept" | "decline";
		consentVersion: string;
	}): Promise<TeamBridgeConversation> {
		const answer = await desktopResult<unknown>({
			op: "team_bridge.conversations.consent",
			...(await teamBridgeWriteOwner(input.accountId, input.tenantId)),
			conversation_id: input.conversationId,
			account_id: input.accountId,
			decision: input.decision,
			consent_version: input.consentVersion,
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
