import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import type {
	TeamBridgeConversation,
	TeamBridgeConversationList,
	TeamBridgeDirectoryMember,
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

/**
 * Why the page cannot be used, or null when it can.
 *
 * The order is the server's own ladder, read from ONE status payload: a signed
 * out account is told to sign in even if the platform is also old, because
 * signing in is the step that can be taken now; an outdated app is told to
 * update before anything else is attempted; an unavailable service is named as
 * such; and a READY account whose surface state is A is the plan gate — the
 * caller is signed in and current, the organization simply has no Team Bridge.
 * Every other shape (including a null payload, which is "no answer yet") is
 * eligible: this function may only withhold the page when the server says so.
 */
export type TeamBridgeEligibility =
	| "signed_out"
	| "update_required"
	| "unavailable"
	| "plan_required";

export function teamBridgeEligibility(
	status:
		| Pick<AgentMessagesStatus, "state" | "surface_state" | "update_required">
		| null
		| undefined,
): TeamBridgeEligibility | null {
	if (!status) return null;
	if (status.state === "signed_out") return "signed_out";
	if (status.state === "update_required" || status.update_required) {
		return "update_required";
	}
	if (status.state === "unavailable") return "unavailable";
	if (status.surface_state === "A") return "plan_required";
	return null;
}

/**
 * How one directory row behaves.
 *
 * `self` is the signed-in account: shown as "You" and never a control (mailing
 * yourself is not a thing the rail offers). `unavailable` is a person whose
 * bridge is off or gone — the row is visible so the reader can see who is
 * potentially reachable, but it is inert. `paused` is still OPENABLE: a paused
 * bridge keeps its history, so the reader can read and message. Only an
 * explicitly enabled bridge with an active or paused state is openable; an
 * enabled bit beside `none`/`disabled` is an inconsistent pair and fails closed.
 */
export type TeamBridgePersonRowState =
	| "self"
	| "openable"
	| "paused"
	| "unavailable";

/**
 * The label a People row paints.
 *
 * The directory may carry an empty label for an account that was deleted between
 * the membership and account reads (the hub keeps the membership row on purpose).
 * An empty row is still a member the reader can recognize by the stable account
 * id, so fall back to that rather than painting a blank row or rejecting the
 * whole directory in the schema.
 */
export function personDisplayLabel(
	member: Pick<TeamBridgeDirectoryMember, "account_id" | "display_label">,
): string {
	return member.display_label.trim() || member.account_id;
}

/**
 * Classify a failed directory read so the People section can name the cause.
 *
 * The desktop transport reports the HTTP status separately from the backend's
 * code. The four cases people actually hit are: signed out (401), not entitled
 * or not a member of this organization (403 / bridge_not_available), the backend
 * never answered (status null), and a server that answered with an error. The
 * old single string made all four look like a retryable load failure, which is
 * how a signed-out user ends up pressing Try again forever.
 */
export type DirectoryFailureKind =
	| "sign_in"
	| "plan"
	| "invalid"
	| "outdated"
	| "refused"
	| "unreachable"
	| "server";

export function directoryFailureKind(error: unknown): DirectoryFailureKind {
	const candidate = error as { status?: unknown; code?: unknown } | null;
	const status =
		typeof candidate?.status === "number" ? candidate.status : null;
	const code = typeof candidate?.code === "string" ? candidate.code : null;
	if (status === 401) return "sign_in";
	if (status === 403 && code === "bridge_not_available") return "plan";
	if (status === 403) return "refused";
	// A 422 from the LOCAL route is a client-side grammar refusal, not an old
	// server. Before this branch it was classified as `outdated`, so a current
	// client told the user to update Radient to fix its own rejected value.
	if (status === 422 || code === "invalid_request") return "invalid";
	// A route this daemon predates (404), a request it rejects (400), or a
	// payload this client cannot parse (ZodError) are not transient. Retrying
	// them is deterministic and reads as a broken button. A 422 is handled above
	// as a local validation refusal.
	if (
		status === 400 ||
		status === 404 ||
		(candidate as { name?: unknown } | null)?.name === "ZodError"
	)
		return "outdated";
	if (status === null) return "unreachable";
	return "server";
}

export function personRowState(
	member: Pick<
		TeamBridgeDirectoryMember,
		"account_id" | "bridge_enabled" | "bridge_state"
	>,
	selfAccountId?: string,
): TeamBridgePersonRowState {
	if (selfAccountId && member.account_id === selfAccountId) return "self";
	const reachable =
		member.bridge_enabled &&
		(member.bridge_state === "active" || member.bridge_state === "paused");
	if (!reachable) return "unavailable";
	return member.bridge_state === "paused" ? "paused" : "openable";
}

/**
 * The one conversation a person row opens, if it already exists.
 *
 * A DM is a two-party conversation: the target must be a non-removed human
 * member and — when the signed-in account is known — the reader must be one
 * too, so a conversation that merely mentions the same account id in another
 * organization can never be opened from this row. Archived DMs are skipped:
 * they are history the reader has put away, not the live thread a click
 * promises. Several matches are possible if a previous DM was left and a new
 * one started; the most recently active wins, matching the rail's own order.
 */
export function dmWithPerson(
	conversations: readonly TeamBridgeConversation[],
	accountId: string,
	selfAccountId?: string,
): TeamBridgeConversation | null {
	const candidates = conversations.filter((conversation) => {
		if (conversation.kind !== "dm" || conversation.status === "archived") {
			return false;
		}
		const hasTarget = conversation.members.some(
			(member) => member.account_id === accountId && member.state !== "removed",
		);
		if (!hasTarget) return false;
		if (!selfAccountId) return true;
		return conversation.members.some(
			(member) =>
				member.kind === "human" &&
				member.account_id === selfAccountId &&
				member.state !== "removed",
		);
	});
	if (candidates.length === 0) return null;
	return mergedConversationOrder(candidates)[0] ?? null;
}

/**
 * Whether a row's role earns a badge.
 *
 * "Member" is the default every row already says by being in the directory,
 * so a badge for it would be noise repeated down the rail. Only a role that
 * changes what the reader may expect of that person (owner, admin) is drawn.
 */
export function showsPersonRole(role: string): boolean {
	return role === "owner" || role === "admin";
}

/** The avatar initial for a person row (first character, uppercased). */
export function personInitial(displayLabel: string): string {
	return displayLabel.trim().charAt(0).toUpperCase() || "?";
}

/**
 * The agent members this reader already has a DM with, labelled for the rail.
 *
 * An agent member's `account_id` is its owner's account (the server validates
 * the named endpoint against that account), so the owner label can be joined
 * from the same People directory without a second identity source. Only DMs are
 * returned: an agent seen in a channel is a participant there, not a direct
 * destination. If the label already carries the owner, it is left alone.
 */
export type TeamBridgeAgentContact = {
	accountId: string;
	label: string;
	conversationId: string;
};

export function agentDmContacts(
	conversations: readonly TeamBridgeConversation[],
	people: readonly TeamBridgeDirectoryMember[],
): TeamBridgeAgentContact[] {
	const ownerLabels = new Map(
		people.map((person) => [person.account_id, person.display_label]),
	);
	const seen = new Set<string>();
	const contacts: TeamBridgeAgentContact[] = [];
	for (const conversation of conversations) {
		if (conversation.kind !== "dm") continue;
		for (const member of conversation.members) {
			if (member.kind !== "agent" || member.state !== "active") continue;
			const key = `${member.account_id}:${member.display_label}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const owner = ownerLabels.get(member.account_id);
			const label =
				owner && !member.display_label.includes(`(${owner})`)
					? `${member.display_label} (${owner})`
					: member.display_label;
			contacts.push({
				accountId: member.account_id,
				label,
				conversationId: conversation.id,
			});
		}
	}
	return contacts;
}
