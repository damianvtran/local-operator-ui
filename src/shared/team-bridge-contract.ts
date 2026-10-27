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

/**
 * How loudly one conversation may notify its reader.
 *
 * `mention` is Slack's middle register: the row may still show its unread
 * count, but only a mention earns the interrupting badge. `mute` is the
 * existing `muted` flag in its newer spelling — the server keeps both on the
 * wire for a page so the two eras parse alike.
 */
export const teamBridgeNotifySchema = z.enum(["all", "mention", "mute"]);
export type TeamBridgeNotify = z.infer<typeof teamBridgeNotifySchema>;

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
		/*
		 * The discoverable-channel slice (agent-server #148) is additive: a server
		 * older than it sends none of these, and every one is optional so that
		 * page still parses. `member` absent means "this server cannot say", not
		 * "the caller is not a member" — the model reads only an explicit false
		 * beside an explicit discoverable true as a preview.
		 */
		discoverable: z.boolean().optional(),
		member: z.boolean().optional(),
		member_count: z.number().int().nonnegative().optional(),
		notify: teamBridgeNotifySchema.optional(),
		/*
		 * The sender label the list row already shows, for a notification body.
		 * Metadata only: no message body is read or stored for a banner, and a
		 * server that does not publish this label falls back to "New message".
		 */
		last_sender_label: z.string().min(1).max(64).optional(),
		/* Latest activity root, for reply notification clicks; absent on a channel post. */
		last_thread_root_id: id.optional(),
		/*
		 * A BUILT-IN CHANNEL'S IDENTITY (agent-server, built-in channels slice).
		 * Every eligible organization has two server-provisioned channels whose
		 * membership the server DERIVES: `humans` is every active person and
		 * `agents` is every enrolled chief of staff. The client never creates,
		 * renames or fills them; it only orders them first and explains them.
		 *
		 * A plain string, not an enum: a third built-in added server-side must
		 * still parse (and render as an ordinary channel) on this client rather
		 * than failing the whole conversation list. Absent on older servers.
		 */
		builtin: z.string().min(1).max(32).optional(),
		/*
		 * ARCHIVE / PERMANENT DELETE (agent-server radient-ml/agent-server#219).
		 * All additive: a server older than it sends none of these, and every one is
		 * optional so that page still parses.
		 *
		 * `can_administer` is THE CALLER'S authority, computed by the same function the
		 * archive/delete routes enforce (conversation owner, or an organization
		 * owner/admin on a channel). The client never infers it from a role or from
		 * `created_by`; absent means "this server cannot say", and the menus then
		 * offer nothing rather than a button that may be refused.
		 *
		 * `archived_by_label` is best effort and the banner degrades without it.
		 */
		can_administer: z.boolean().optional(),
		archived_at: z.string().optional(),
		archived_by: id.optional(),
		archived_by_label: z.string().min(1).max(64).optional(),
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
		/* The lossless compound position (both scopes); `next_before` is legacy and can drop ties. */
		next_cursor: z.string().optional(),
	})
	.passthrough();
export type TeamBridgeConversationList = z.infer<
	typeof teamBridgeConversationListSchema
>;

/** Additive reaction summary: no reactor IDs or message bodies are persisted here. */
export const teamBridgeReactionSchema = z
	.object({
		emoji: z.string().min(1),
		count: z.number().int().positive(),
		reacted_by_me: z.boolean(),
		sample_labels: z.array(z.string()).max(3),
	})
	.passthrough();
export type TeamBridgeReaction = z.infer<typeof teamBridgeReactionSchema>;
export const teamBridgeReactionsSchema = z
	.object({
		message_id: id,
		reactions: z.array(teamBridgeReactionSchema).max(50),
	})
	.passthrough();

// History is a forward-compatible read: future server caps must not make a whole page unreadable.
// Retain today's display bounds by trimming only optional reaction metadata; toggle writes keep
// their strict response schema above so incompatible mutation responses remain visible failures.
const historyReactionSchema = teamBridgeReactionSchema.extend({
	sample_labels: z.array(z.string()).transform((labels) => labels.slice(0, 3)),
});
const historyReactionsSchema = z
	.array(historyReactionSchema)
	.transform((rows) => rows.slice(0, 50));

/*
 * IMAGE ATTACHMENTS (Team Bridge image-attachments contract §3). A message
 * carries a STRUCTURED list of descriptors; bytes are never inline and never
 * a URL. The renderer fetches each picture through main's bearer relay
 * (`team_bridge.attachment` in `main/desktop-media.ts`), so nothing here is
 * a fetchable address and a hostile body cannot point the app anywhere: the
 * Markdown `img` renderer stays alt-only (`team-bridge-markdown.tsx`).
 *
 * `state` is optional because a hub that binds attachments only ever shows
 * bound ones to a human; `expired`/`deleted` are the retention sweeper's
 * terminal states (manager decision D2: the descriptor survives so the bubble
 * can say "Image expired" instead of silently shrinking). Any OTHER state is
 * treated as withheld by the renderer - fail closed, never fetched - so an
 * additive server state cannot accidentally become a fetch.
 */
const attachmentId = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9_-]+$/);
export const teamBridgeAttachmentSchema = z
	.object({
		id: attachmentId,
		mime: z.string().max(64),
		size: z.number().int().nonnegative(),
		width: z.number().int().nonnegative(),
		height: z.number().int().nonnegative(),
		sha256: z.string().max(128).optional(),
		state: z.string().max(32).optional(),
		expires_at: z.string().optional(),
	})
	.passthrough();
export type TeamBridgeAttachment = z.infer<typeof teamBridgeAttachmentSchema>;

/** The upload answer: `201 {attachment}` - a STAGED id the send then binds. */
export const teamBridgeAttachmentUploadSchema = z
	.object({ attachment: teamBridgeAttachmentSchema })
	.passthrough();

/*
 * The capability block on the hub's status (`status.attachments`). Present only
 * when the server has the store wired (D6: no deploy flag), so ABSENCE is the
 * old-server signal: the composer hides every attach affordance, because an old
 * hub answers an unknown `attachment_ids` field with a 400 (strict decoding).
 */
export const teamBridgeAttachmentCapabilitySchema = z
	.object({
		enabled: z.boolean(),
		max_count: z.number().int().positive().max(16),
		max_bytes: z.number().int().positive(),
		max_pixels: z.number().int().positive().optional(),
		mime_types: z.array(z.string()),
	})
	.passthrough();
export type TeamBridgeAttachmentCapability = z.infer<
	typeof teamBridgeAttachmentCapabilitySchema
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
		reactions: historyReactionsSchema.optional(),
		/*
		 * Threads (agent-server #164). All optional: a hub older than threads
		 * sends none of them, and a root with no replies omits its rollup, so a
		 * message parses whether or not the server knows about threads.
		 * `thread_root_id` marks a REPLY (it never appears on the timeline page,
		 * which excludes replies); the rollup sits on a ROOT.
		 */
		thread_root_id: id.optional(),
		reply_count: z.number().int().nonnegative().optional(),
		last_reply_at: z.string().optional(),
		/* Up to three distinct repliers' display labels — a facepile, not a roster. */
		reply_participants: z.array(z.string()).optional(),
		/* Image attachments, send order. Absent on text-only messages and old hubs. */
		attachments: z.array(teamBridgeAttachmentSchema).max(16).optional(),
	})
	.passthrough();
export type TeamBridgeMessage = z.infer<typeof teamBridgeMessageSchema>;

/*
 * One thread: the root (with its rollup) and its replies OLDEST-first — a
 * thread reads top-down, unlike the newest-first timeline page.
 * `next_after_seq` is the inclusive cursor for the next page.
 */
export const teamBridgeThreadPageSchema = z
	.object({
		root: teamBridgeMessageSchema,
		replies: z.array(teamBridgeMessageSchema),
		next_after_seq: z.number().int().nonnegative().optional(),
		has_more: z.boolean().optional(),
	})
	.passthrough();
export type TeamBridgeThreadPage = z.infer<typeof teamBridgeThreadPageSchema>;

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

/**
 * One person in an organization's Team Bridge directory.
 *
 * WHY `role` IS A STRING, NOT THE PARTICIPANT UNION. A conversation's member
 * roles are the conversation's own (owner/member); the directory publishes the
 * ORGANIZATION role, which the hub adds to over time (owner, admin, member,
 * auditor, …). Parsing it as an enum would fail closed on the first role this
 * client has not learned, and a directory row is exactly the surface where an
 * unknown role must still render.
 *
 * `bridge_state` is the person's bridge eligibility: `active` and `paused` are
 * reachable (the row opens their DM; a paused person still has history),
 * `none`/`disabled` mean no bridge is on for them. `bridge_enabled` is a
 * separate bit because the server gives it separately; the renderer reads both
 * so an inconsistent pair fails closed rather than painting a dead row as live.
 */
export const teamBridgePersonBridgeStateSchema = z.enum([
	"active",
	"paused",
	"disabled",
	"none",
]);
export type TeamBridgePersonBridgeState = z.infer<
	typeof teamBridgePersonBridgeStateSchema
>;

/**
 * A person's chief of staff, as the directory publishes it.
 *
 * WHY THE DIRECTORY CARRIES IT. Clicking a chief of staff must open a DM with
 * that person's primary agent, and a DM with an agent names the agent's
 * endpoint. The endpoint id is only ever published to co-members of the same
 * organization, and `name` is the agent's CURRENT display name (renaming Aida
 * on the owner's machine re-syncs it), which is why the rail never hardcodes a
 * name. Absent when the person has no enrolled agent, or on an older server.
 */
export const teamBridgeDirectoryAgentSchema = z
	.object({
		endpoint_id: id,
		name: z.string().max(128),
		state: z.string().min(1).max(32),
	})
	.passthrough();
export type TeamBridgeDirectoryAgent = z.infer<
	typeof teamBridgeDirectoryAgentSchema
>;

/*
 * A person's public presentation, carried on the directory row so message and
 * member hover cards need no second read. The server has already normalized
 * and bounded these values; absent profile data stays absent, rather than
 * turning into empty UI. `avatar_url` is relative and hash-pinned, never a
 * provider URL: the renderer hands its path to main's authenticated relay.
 */
export const teamBridgeProfileSchema = z
	.object({
		display_name: z
			.string()
			.refine((value) => Array.from(value).length <= 64)
			.catch(""),
		title: z
			.string()
			.refine((value) => Array.from(value).length <= 80)
			.catch(""),
		description: z
			.string()
			.refine((value) => Array.from(value).length <= 500)
			.catch(""),
		pronouns: z
			.string()
			.refine((value) => Array.from(value).length <= 32)
			.catch(""),
		timezone: z
			.string()
			.refine((value) => Array.from(value).length <= 64)
			.catch(""),
		avatar: z
			.object({
				source: z.enum(["uploaded", "google", "microsoft", "none"]),
				hash: z.string().regex(/^[0-9a-f]{16}$/),
				updated_at: z.string(),
			})
			.passthrough()
			.optional()
			.catch(undefined),
	})
	.passthrough();
export type TeamBridgeProfile = z.infer<typeof teamBridgeProfileSchema>;

// The hub uses UUIDs; legacy accounts use acc_. Keep the transport-safe
// subset rather than accepting arbitrary escaped path segments from old rows.
export const teamBridgeAvatarUrlSchema = z
	.string()
	.max(512)
	.regex(
		/^\/v1\/accounts\/(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|acc_[a-zA-Z0-9_-]{1,64})\/avatar\?v=[0-9a-f]{16}$/,
	)
	.optional()
	.catch(undefined);

export const teamBridgeDirectoryMemberSchema = z
	.object({
		account_id: id,
		/*
		 * THE DIRECTORY DOES NOT PROMISE A NON-EMPTY LABEL. The hub keeps a
		 * membership row when the account behind it was deleted between the two
		 * reads (bridge_read_service.go: "keeps its row with an empty label"), and
		 * an account may have neither a name nor an email. `min(1)` here made ONE
		 * such row fail the whole `members` array and the People section rendered
		 * "People could not be loaded." with no cause. The cap is likewise the
		 * server's to enforce, not a render-time parser's: display names and email
		 * fallbacks routinely exceed the old 64 characters. The row renderer
		 * supplies a stable fallback label.
		 */
		display_label: z.string(),
		role: z.string().min(1).max(32),
		bridge_enabled: z.boolean(),
		bridge_state: teamBridgePersonBridgeStateSchema,
		/*
		 * `.catch(undefined)`: a malformed agent object costs the person their
		 * chief-of-staff row, never their People row. The person is still a
		 * colleague; only the agent shortcut is withheld.
		 */
		agent: teamBridgeDirectoryAgentSchema.optional().catch(undefined),
		profile: teamBridgeProfileSchema.optional().catch(undefined),
		avatar_url: teamBridgeAvatarUrlSchema,
	})
	.passthrough();
export type TeamBridgeDirectoryMember = z.infer<
	typeof teamBridgeDirectoryMemberSchema
>;

/**
 * The tenant's active human members, ordered server-side.
 *
 * NO CLIENT SORT. The order is the server's (it knows activity and role
 * weight); re-sorting here would make the rail disagree with every other
 * directory the hub serves. The array is the whole answer this read returns.
 */
function salvageDirectoryMember(
	row: unknown,
): TeamBridgeDirectoryMember | null {
	if (row === null || typeof row !== "object") return null;
	const candidate = row as Record<string, unknown>;
	const accountId = candidate.account_id;
	if (typeof accountId !== "string" || accountId.length === 0) return null;
	const label =
		typeof candidate.display_label === "string" ? candidate.display_label : "";
	const role =
		typeof candidate.role === "string" && candidate.role.length > 0
			? candidate.role
			: "member";
	const bridgeEnabled = candidate.bridge_enabled === true;
	const state = teamBridgePersonBridgeStateSchema.safeParse(
		candidate.bridge_state,
	);
	const agent = teamBridgeDirectoryAgentSchema.safeParse(candidate.agent);
	return {
		account_id: accountId,
		display_label: label,
		role,
		bridge_enabled: bridgeEnabled,
		bridge_state: state.success ? state.data : "none",
		...(agent.success ? { agent: agent.data } : {}),
		profile: teamBridgeProfileSchema.safeParse(candidate.profile).success
			? teamBridgeProfileSchema.parse(candidate.profile)
			: undefined,
		avatar_url: teamBridgeAvatarUrlSchema.safeParse(candidate.avatar_url)
			.success
			? teamBridgeAvatarUrlSchema.parse(candidate.avatar_url)
			: undefined,
	};
}

export const teamBridgeDirectorySchema = z
	.object({ members: z.array(z.unknown()) })
	.passthrough()
	.transform((payload) => {
		/*
		 * PER-ROW TOLERANCE, NOT PER-ARRAY. One unrecognized member row used to
		 * throw the whole parse and blank every member the hub did send. A row is
		 * now dropped on its own and counted, so a schema assumption that goes
		 * stale for one account costs that account's row and a visible count,
		 * never the directory. `unavailable_count` is derived here, not sent by
		 * the hub.
		 */
		const members: TeamBridgeDirectoryMember[] = [];
		let unavailableCount = 0;
		for (const row of payload.members) {
			const parsed = teamBridgeDirectoryMemberSchema.safeParse(row);
			if (parsed.success) {
				members.push(parsed.data);
				continue;
			}
			/*
			 * A row WITH a stable account id is salvaged into the inert state
			 * rather than hidden: one future role/state value must not remove a
			 * person from the directory. Only a row with no usable account id is
			 * genuinely unrenderable, and only that increments the count.
			 */
			const salvaged = salvageDirectoryMember(row);
			if (salvaged) members.push(salvaged);
			else unavailableCount += 1;
		}
		return { ...payload, members, unavailable_count: unavailableCount };
	});
export type TeamBridgeDirectory = z.infer<typeof teamBridgeDirectorySchema>;

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
		notify: teamBridgeNotifySchema.optional(),
	})
	.passthrough();
export type TeamBridgeReadState = z.infer<typeof teamBridgeReadStateSchema>;

declare const teamBridgeTenantIdBrand: unique symbol;

/**
 * A tenant id that came from a membership row.
 *
 * The brand is what keeps `"all"` out of a tenant slot: `TeamBridgeScope` is
 * `"all" | TeamBridgeTenantId`, so a branch that checks the sentinel narrows to
 * a real tenant id, and `{ tenantId: "all" }` no longer type-checks. It is a
 * compile-time distinction only; the wire still carries the string.
 */
export type TeamBridgeTenantId = string & {
	readonly [teamBridgeTenantIdBrand]: true;
};

/** The two read scopes the desktop route forwards. Writes never accept this. */
export type TeamBridgeReadScope = { tenantId: TeamBridgeTenantId } | "account";

/** One member as the create/add request states it (the wire is snake_case). */
export type TeamBridgeMemberInput = {
	account_id: string;
	kind: "human" | "agent";
	endpoint_id?: string;
	display_label: string;
};

/** Server-owned delivery intent; bodies here are explicit user-authored work,
 * never a desktop inbound-body cache. Terminal rows are absent from list. */
export const teamBridgeScheduledMessageSchema = z
	.object({
		id: id,
		tenant_id: id,
		conversation_id: id,
		body: z.string(),
		send_at: z.string().datetime({ offset: true }),
		status: z.enum(["scheduled", "sending"]),
		created_at: z.string().datetime({ offset: true }),
		/* Reserved images; descriptors only (not bound to a message, so no bytes). */
		attachments: z.array(teamBridgeAttachmentSchema).max(16).optional(),
		/*
		 * The S2 hub's first shape: reserved ids only. A newer hub sends
		 * `attachments` descriptors beside them (manager decision, round 1); the
		 * descriptors win when present, otherwise each id becomes an id-only
		 * descriptor (no size/geometry), which the scheduled tile draws as
		 * "Preview unavailable" or as this session's in-memory preview. Edits keep
		 * and remove by id either way, so both hub versions behave the same.
		 */
		attachment_ids: z.array(attachmentId).max(16).optional(),
	})
	.transform(({ attachment_ids, ...row }) =>
		row.attachments !== undefined || !attachment_ids?.length
			? row
			: {
					...row,
					attachments: attachment_ids.map((attachmentRef) => ({
						id: attachmentRef,
						mime: "",
						size: 0,
						width: 0,
						height: 0,
						state: "reserved",
					})),
				},
	);
export type TeamBridgeScheduledMessage = z.output<
	typeof teamBridgeScheduledMessageSchema
>;
export const teamBridgeScheduledListSchema = z.object({
	scheduled: z.array(teamBridgeScheduledMessageSchema),
});
