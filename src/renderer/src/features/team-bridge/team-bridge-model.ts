import type {
	TeamBridgeConversation,
	TeamBridgeConversationList,
	TeamBridgeMessage,
	TeamBridgeNotify,
	TeamBridgeParticipant,
	TeamBridgeTenantId,
} from "../../../../shared/team-bridge-contract";

/**
 * The Team Bridge list's scope: one organization's tenant id, or every
 * organization the signed-in account belongs to.
 *
 * "all" is a sentinel, never a tenant id: the server's account read is the
 * only place the merged view comes from, and no write ever accepts it.
 */
export const TEAM_BRIDGE_ALL_SCOPE = "all";
export type TeamBridgeScope = typeof TEAM_BRIDGE_ALL_SCOPE | TeamBridgeTenantId;

/**
 * Brand a tenant id read from a membership row.
 *
 * The one caller that needs this at an untyped boundary is the menu: Radix
 * hands `onValueChange` a plain string built from our own radio values.
 */
export function asTeamBridgeTenantId(value: string): TeamBridgeTenantId {
	return value as TeamBridgeTenantId;
}

/** A menu/radio value back into the scope union, sentinel first. */
export function teamBridgeScopeFromValue(value: string): TeamBridgeScope {
	return value === TEAM_BRIDGE_ALL_SCOPE
		? TEAM_BRIDGE_ALL_SCOPE
		: asTeamBridgeTenantId(value);
}

/** One row of the organization switcher, after memberships and counts are joined. */
export type TeamBridgeOrganization = {
	tenantId: TeamBridgeTenantId;
	name: string;
	role: string;
	unread: number;
};

/**
 * Pure render decisions for the Team Bridge page.
 *
 * Kept out of the components for the same reason the chat transcript's helpers
 * are: a title rule, a member sort or an unread total is testable without a
 * DOM, and a component that re-derives one is how the list row and the thread
 * header come to disagree about what a conversation is called.
 */

/**
 * The name to render for a conversation.
 *
 * - a named group/channel uses its name;
 * - a DM is named for the OTHER person (and, when that person is an agent, the
 *   agent's own label), because "Direct message" as a title tells the reader
 *   nothing about who they are talking to;
 * - an unnamed group/channel lists its members, capped so a 40-person channel
 *   does not turn the row into a paragraph.
 *
 * Returns `null` when nothing can be named; the caller renders its untitled
 * copy rather than an empty string.
 */
export function conversationTitle(
	conversation: TeamBridgeConversation,
	selfAccountId?: string,
): string | null {
	const name = conversation.name?.trim();
	if (name) return name;
	const others = conversation.members.filter(
		(member) =>
			member.state !== "removed" &&
			!(member.kind === "human" && member.account_id === selfAccountId),
	);
	if (conversation.kind === "dm") {
		const other =
			others.find((member) => member.state === "active") ?? others[0];
		return other?.display_label ?? null;
	}
	const labels = others
		.filter((member) => member.state === "active")
		.map((member) => member.display_label);
	if (labels.length === 0) return null;
	if (labels.length <= 3) return labels.join(", ");
	return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

/** The icon/glyph family a conversation row uses, before Lucide picks one. */
export function conversationGlyph(
	conversation: TeamBridgeConversation,
): "hash" | "users" | "at" {
	if (conversation.kind === "channel") return "hash";
	if (conversation.kind === "group") return "users";
	return "at";
}

/**
 * Whether the caller is looking at a discoverable channel they have not joined.
 *
 * An EXPLICIT pair is required: `discoverable: true` beside `member: false`.
 * A server older than the discoverable slice omits both, and a page that read
 * an absent `member` as false would turn every row into a preview and stop
 * fetching its history. Absence therefore means "cannot say", never "not a
 * member".
 *
 * A preview row is readable metadata only: the rail may show its name and
 * count, but the thread must not request or render bodies — the server answers
 * `not_a_member` for exactly that read.
 */
export function isPreviewConversation(
	conversation: Pick<TeamBridgeConversation, "discoverable" | "member">,
): boolean {
	return conversation.discoverable === true && conversation.member === false;
}

/**
 * The notification register a conversation row carries.
 *
 * `notify` is the newer field; `muted` predates it and every page still carries
 * it. Reading the pair here — one place — is what keeps the row's bell glyph,
 * the menu's checked row and the optimistic write from disagreeing about what
 * "muted" means while servers roll forward at different speeds.
 */
export function notificationPreference(
	conversation: Pick<TeamBridgeConversation, "notify" | "muted">,
): TeamBridgeNotify {
	return conversation.notify ?? (conversation.muted ? "mute" : "all");
}

/** True exactly when the row's quiet bell should be drawn. */
export function showsMutedGlyph(
	conversation: Pick<TeamBridgeConversation, "notify" | "muted">,
): boolean {
	return notificationPreference(conversation) === "mute";
}

/**
 * The immediate Mute/Unmute item's next value.
 *
 * Unmute returns to `all`, Slack's behaviour: the item is a toggle, not a
 * restore of whatever level preceded the mute. A reader who wants `mention`
 * back picks it from the radio rows, which are the explicit statement of the
 * preference.
 */
export function toggledMuteNotify(notify: TeamBridgeNotify): TeamBridgeNotify {
	return notify === "mute" ? "all" : "mute";
}

/** The three notification values, in the menu's order (loudest first). */
export const TEAM_BRIDGE_NOTIFY_OPTIONS: ReadonlyArray<{
	value: TeamBridgeNotify;
	labelKey:
		| "ui.teamBridge.notify.all"
		| "ui.teamBridge.notify.mention"
		| "ui.teamBridge.notify.mute";
}> = [
	{ value: "all", labelKey: "ui.teamBridge.notify.all" },
	{ value: "mention", labelKey: "ui.teamBridge.notify.mention" },
	{ value: "mute", labelKey: "ui.teamBridge.notify.mute" },
];

/**
 * A radio value back into the notify union.
 *
 * Radix hands `onValueChange` a plain string built from our own radio values;
 * this is the one boundary that needs the narrowing, and an unknown value
 * falls back to the loudest register rather than muting by accident.
 */
export function asTeamBridgeNotify(value: string): TeamBridgeNotify {
	return value === "mention" || value === "mute" ? value : "all";
}

/**
 * The optimistic patch for one conversation's notification preference.
 *
 * A conversation list page is scope-keyed, and the same row can live in the
 * merged page and its organization's page; the caller patches every cached
 * page with this function. The pair moves together (`notify` and the legacy
 * `muted`) so no render can read one without the other, and every other row
 * and the page's own paging fields are preserved — an optimistic write must
 * not drop `has_more`/`next_before` and strand the rail's paging.
 */
export function withNotificationPreference(
	page: TeamBridgeConversationList,
	conversationId: string,
	notify: TeamBridgeNotify,
): TeamBridgeConversationList {
	return {
		...page,
		conversations: page.conversations.map((row) =>
			row.id === conversationId
				? { ...row, notify, muted: notify === "mute" }
				: row,
		),
	};
}

/**
 * Whether a refused notification write belongs to the visible conversation.
 *
 * A write settles against the hook instance that started it, and the reader may
 * have selected another conversation while it was in flight. The mutation's
 * variables name the conversation the write belonged to, so comparing them
 * with the current selection keeps A's late refusal from appearing under B.
 */
export function notifyFailureIsVisible(
	failure: {
		isError: boolean;
		variables?: { conversationId: string };
	},
	selectedId: string | null,
): boolean {
	return failure.isError && failure.variables?.conversationId === selectedId;
}

/**
 * The count the thread header states.
 *
 * Insiders keep the live member array and count its ACTIVE rows: the server's
 * `member_count` also includes invitees (agent-server counts active + invited),
 * so preferring it for an insider would make the header disagree with both the
 * avatars beside it and the previous UI's number. A discoverable non-member has
 * no `members` rows at all — membership is the fact the preview withholds — so
 * `member_count` is the only metadata there, and its invited-inclusive total is
 * the honest number the preview can state.
 */
export function conversationMemberCount(
	conversation: Pick<TeamBridgeConversation, "member_count" | "members">,
): number {
	if (conversation.members.length > 0) {
		return conversation.members.filter((member) => member.state === "active")
			.length;
	}
	return conversation.member_count ?? 0;
}

/** True when at least one ACTIVE member is an agent. Badges read this. */
export function hasAgentParticipant(
	conversation: TeamBridgeConversation,
): boolean {
	return conversation.members.some(
		(member) => member.kind === "agent" && member.state === "active",
	);
}

/**
 * The members a reader sees, in a stable order.
 *
 * Active people first, then agents, then invited people: the header's badges
 * and the create dialog's summary both read this order, so "who is in this
 * conversation" answers the same way wherever it is asked.
 */
export function orderedMembers(
	conversation: TeamBridgeConversation,
): TeamBridgeParticipant[] {
	const rank = (member: TeamBridgeParticipant): number => {
		if (member.state === "active" && member.kind === "human") return 0;
		if (member.state === "active" && member.kind === "agent") return 1;
		if (member.state === "invited") return 2;
		return 3;
	};
	return [...conversation.members].sort((a, b) => rank(a) - rank(b));
}

/**
 * The badge'able total: unmuted unread, exactly the server's `total`.
 *
 * A muted conversation still shows its count on its own row (the user may want
 * to look), but it does not raise the sidebar badge — that is the one place a
 * mute has to be honoured, because the badge is what interrupts.
 *
 * The account aggregate carries no `conversations` rows (see the contract);
 * `total` is authoritative there. The row sum is only the race-safe fallback
 * for the tenant-scoped read.
 */
export function badgeTotal(unread: {
	total: number;
	conversations?: Array<{ muted: boolean; unread_count: number }>;
	organizations?: Array<{ unread: number }>;
}): number {
	const summedConversations = (unread.conversations ?? [])
		.filter((row) => !row.muted)
		.reduce((sum, row) => sum + row.unread_count, 0);
	const summedOrganizations = (unread.organizations ?? []).reduce(
		(sum, row) => sum + row.unread,
		0,
	);
	const summed = Math.max(summedConversations, summedOrganizations);
	// The server's total is authoritative when it says something is waiting. A
	// zero total beside non-zero rows means the two reads raced (a message
	// arrived between them), and falling back to the rows is the answer that
	// cannot undercount.
	if (Number.isFinite(unread.total) && unread.total > 0) {
		return Math.max(0, unread.total);
	}
	return summed;
}

/**
 * Whether the page should claim the attention it is showing.
 *
 * A visible window is already showing the conversation list; a notification on
 * top of it would be noise. The caller passes `document.visibilityState` so a
 * test does not need a DOM.
 */
export function shouldNotify(
	visibility: "visible" | "hidden" | "prerender",
): boolean {
	return visibility === "hidden";
}

/** The messages in display order: oldest first, gaps allowed (purged history). */
export function chronological(
	messages: TeamBridgeMessage[],
): TeamBridgeMessage[] {
	return [...messages].sort((a, b) => a.seq - b.seq);
}

/**
 * Join the caller's ACTIVE memberships with the account aggregate's per-org
 * counts.
 *
 * Memberships remain the source of names and roles; the aggregate only supplies
 * numbers keyed by tenant id. An organization the aggregate did not mention (a
 * read that raced a membership change, or an ineligible org) renders with a
 * zero rather than disappearing: the switcher is a place to choose a scope, and
 * hiding an org because its count is unknown would make the menu disagree with
 * the memberships it is built from.
 */
export function organizationOptions(
	memberships: ReadonlyArray<{
		tenant_id: string;
		tenant_name: string;
		role: string;
		status: "active" | "pending" | "disabled";
	}>,
	unreadOrganizations: ReadonlyArray<{
		tenant_id: string;
		unread: number;
	}> = [],
): TeamBridgeOrganization[] {
	const counts = new Map(
		unreadOrganizations.map((row) => [row.tenant_id, row.unread]),
	);
	return memberships
		.filter((membership) => membership.status === "active")
		.map((membership) => ({
			tenantId: asTeamBridgeTenantId(membership.tenant_id),
			name: membership.tenant_name,
			role: membership.role,
			unread: counts.get(membership.tenant_id) ?? 0,
		}));
}

/**
 * The scope a fresh page should use once memberships are known.
 *
 * A single-membership account starts in its only organization: All
 * organizations is a multi-org affordance, and starting there would disable
 * create until the reader picked the one org they belong to. `chosen` is true
 * once the reader has used the switcher, so their explicit All is never
 * overridden by a later refresh.
 */
export function preferredScope(
	organizations: readonly TeamBridgeOrganization[],
	current: TeamBridgeScope,
	chosen: boolean,
): TeamBridgeScope {
	if (chosen || organizations.length !== 1) return current;
	return organizations[0].tenantId;
}

/** The organization a scope names, or null for the account-wide scope. */
export function organizationForScope(
	organizations: readonly TeamBridgeOrganization[],
	scope: TeamBridgeScope,
): TeamBridgeOrganization | null {
	return (
		organizations.find((organization) => organization.tenantId === scope) ??
		null
	);
}

/**
 * The merged view's order: newest activity across organizations first.
 *
 * The server already orders an account-scoped page this way; sorting again in
 * the renderer is the cheap guarantee that a per-org page cached beside it can
 * never leak its own grouping into the merged list. An unparseable timestamp
 * sorts after every real one, and the id breaks ties so two conversations with
 * the same instant do not swap between renders.
 */
export function mergedConversationOrder(
	conversations: readonly TeamBridgeConversation[],
): TeamBridgeConversation[] {
	const instant = (value: string): number => {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
	};
	return [...conversations].sort((a, b) => {
		const delta = instant(b.last_message_at) - instant(a.last_message_at);
		if (delta !== 0) return delta;
		return a.id.localeCompare(b.id);
	});
}

/**
 * The organization name a conversation row wears in the merged view.
 *
 * `null` means the conversation's tenant is not in the caller's active
 * memberships. The page treats that as "unknown org" and refuses to render its
 * thread: a message shown under the wrong organization would be worse than a
 * row that waits for the membership read.
 */
export function conversationOrganizationName(
	conversation: Pick<TeamBridgeConversation, "tenant_id">,
	organizations: readonly TeamBridgeOrganization[],
): string | null {
	return (
		organizations.find(
			(organization) => organization.tenantId === conversation.tenant_id,
		)?.name ?? null
	);
}

/**
 * The rows a scope actually renders.
 *
 * A single-org scope keeps the server's order as-is. The merged scope orders
 * newest-first and DROPS rows whose organization is not in the active
 * memberships: every merged row is labelled with its org, and a row that cannot
 * be labelled is a row whose thread must not open. The container and the view
 * both call this, so the selection can never land on a row the rail is hiding.
 */
export function visibleConversationRows(
	conversations: readonly TeamBridgeConversation[],
	scope: TeamBridgeScope,
	organizations: readonly TeamBridgeOrganization[],
): TeamBridgeConversation[] {
	if (scope !== TEAM_BRIDGE_ALL_SCOPE) return [...conversations];
	return mergedConversationOrder(conversations).filter(
		(conversation) =>
			conversationOrganizationName(conversation, organizations) !== null,
	);
}
