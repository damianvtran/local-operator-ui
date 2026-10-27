import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import type {
	TeamBridgeConversation,
	TeamBridgeConversationList,
	TeamBridgeDirectoryMember,
	TeamBridgeMemberInput,
	TeamBridgeMessage,
	TeamBridgeNotify,
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

/** A member's stored name; an agent's never repeats its owner ("X (X)"). */
function memberStoredName(member: {
	kind: "human" | "agent";
	display_label: string;
}): string | null {
	return member.kind === "agent"
		? storedAgentName(member.display_label, null)
		: storedLabel(member.display_label);
}

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
		return other ? memberStoredName(other) : null;
	}
	const labels = others
		.filter((member) => member.state === "active")
		.map(memberStoredName)
		.filter((label): label is string => label !== null);
	if (labels.length === 0) return null;
	if (labels.length <= 3) return labels.join(", ");
	return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
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
	tenantId?: string,
): TeamBridgeConversationList {
	return {
		...page,
		conversations: page.conversations.map((row) =>
			row.id === conversationId && (!tenantId || row.tenant_id === tenantId)
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
 *
 * Invitees are still VISIBLE: `conversationMembershipCounts` states them
 * separately for the header badge, so counting them here would state the same
 * fact twice in two different totals.
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

/**
 * The known membership states, kept separate so the header never presents
 * invited agents as active. A preview has no participant rows, so it cannot
 * claim either breakdown from its aggregate count alone.
 */
export function conversationMembershipCounts(
	conversation: Pick<TeamBridgeConversation, "members">,
): { active: number; invited: number } {
	let active = 0;
	let invited = 0;
	for (const member of conversation.members) {
		if (member.state === "active") active += 1;
		if (member.state === "invited") invited += 1;
	}
	return { active, invited };
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
	messages: readonly TeamBridgeMessage[],
): TeamBridgeMessage[] {
	return [...messages].sort((a, b) => a.seq - b.seq);
}

/**
 * The organizations the page may scope to and label rows with, joined with the
 * account aggregate's per-org counts.
 *
 * THE HUB'S TENANT LIST IS AUTHORITATIVE when the status payload carries one
 * (`hubTenants`, the bridge status `status.tenants[]`). It is the bridge's own
 * answer to "which tenants does this account's Team Bridge span", and the
 * conversations page is drawn from that same server. Radient memberships are a
 * separate read with its own lag and its own failures; filtering by them
 * silently dropped every row of a tenant the hub listed but the memberships
 * read lacked, emptying the merged rail (F6 on #1314). So with a hub list:
 * every hub tenant is an organization, in hub order; memberships contribute a
 * name or role only; a membership the hub does not list is not an organization
 * (the bridge has no conversations there to show). Names prefer the hub's
 * `tenant_name`, then the membership's, then the tenant id — a neutral,
 * distinct label, never "Unknown organization" for a tenant the hub vouches for.
 *
 * Without a hub list (status not answered yet, or a backend that predates it)
 * the ACTIVE memberships stay the source, as before.
 *
 * Counts are keyed by tenant id. An organization the aggregate did not mention
 * (a read that raced a membership change, or an ineligible org) renders with a
 * zero rather than disappearing: the switcher is a place to choose a scope, and
 * hiding an org because its count is unknown would make the menu disagree with
 * the list it is built from.
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
	hubTenants?: ReadonlyArray<{
		tenant_id: string;
		tenant_name?: string;
	}> | null,
): TeamBridgeOrganization[] {
	const counts = new Map(
		unreadOrganizations.map((row) => [row.tenant_id, row.unread]),
	);
	const active = memberships.filter(
		(membership) => membership.status === "active",
	);
	if (!hubTenants) {
		return active.map((membership) => ({
			tenantId: asTeamBridgeTenantId(membership.tenant_id),
			name: membership.tenant_name,
			role: membership.role,
			unread: counts.get(membership.tenant_id) ?? 0,
		}));
	}
	const byTenant = new Map(
		active.map((membership) => [membership.tenant_id, membership]),
	);
	const seen = new Set<string>();
	const organizations: TeamBridgeOrganization[] = [];
	for (const tenant of hubTenants) {
		// One switcher row per tenant even if a payload repeats one.
		if (seen.has(tenant.tenant_id)) continue;
		seen.add(tenant.tenant_id);
		const membership = byTenant.get(tenant.tenant_id);
		organizations.push({
			tenantId: asTeamBridgeTenantId(tenant.tenant_id),
			name:
				tenant.tenant_name?.trim() ||
				// The memberships read is cast, not parsed: tolerate a missing name.
				membership?.tenant_name?.trim() ||
				tenant.tenant_id,
			role: membership?.role ?? "",
			unread: counts.get(tenant.tenant_id) ?? 0,
		});
	}
	return organizations;
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
 * The hub's tenant list from the bridge status payload, or null when the
 * status has not answered or carries none (an older backend, a signed-out
 * account). Null is what makes `organizationOptions` fall back to memberships,
 * so an absent list must never be coerced to `[]`.
 */
export function hubTenantList(
	status: Pick<AgentMessagesStatus, "status"> | null | undefined,
): NonNullable<AgentMessagesStatus["status"]>["tenants"] | null {
	return status?.status?.tenants ?? null;
}

/**
 * Whether the organization list the merged rail filters by is still loading or
 * has failed.
 *
 * With a hub tenant list the list is complete without memberships, so their
 * loading or failure must not hold or fail the rail; that is what left F6's
 * rail stuck or erroring on a read it no longer depends on. Without one the
 * memberships ARE the list, so their state is the list's state.
 */
export function organizationsReadState(
	hubTenants: readonly unknown[] | null,
	memberships: { isLoading: boolean; isError: boolean },
): { pending: boolean; failed: boolean } {
	if (hubTenants !== null) return { pending: false, failed: false };
	return { pending: memberships.isLoading, failed: memberships.isError };
}

/**
 * The organization name a conversation row wears in the merged view.
 *
 * `null` means the conversation's tenant is not among `organizations` (the
 * hub's tenant list, or the active memberships when the hub sent none — see
 * `organizationOptions`). The page treats that as "unknown org" and refuses to
 * render its thread: a message shown under the wrong organization would be
 * worse than a row that waits for the organization list to name it.
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
 * newest-first and DROPS rows whose organization is not in `organizations`:
 * every merged row is labelled with its org, and a row that cannot be labelled
 * is a row whose thread must not open. The container and the view both call
 * this, so the selection can never land on a row the rail is hiding.
 *
 * `organizations` must come from the hub's tenant list whenever the status
 * payload has one (`organizationOptions(..., hubTenants)`), NOT from Radient
 * memberships alone: the memberships read can lack a tenant the hub serves,
 * and filtering by it emptied the merged rail silently (F6 on #1314). A tenant
 * the hub does not list still stays hidden here.
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
		// HUMAN members only: an agent member carries its OWNER's account id, so
		// without the kind check a DM with Ben's chief of staff would be opened
		// by Ben's own person row.
		const hasTarget = conversation.members.some(
			(member) =>
				member.kind === "human" &&
				member.account_id === accountId &&
				member.state !== "removed",
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

/** The avatar initial for a person row (first character, uppercased). */
export function personInitial(displayLabel: string): string {
	return displayLabel.trim().charAt(0).toUpperCase() || "?";
}

/**
 * A chief of staff the rail can open: a person's primary agent in this org.
 *
 * WHERE THE IDENTITY COMES FROM. The directory publishes each person's agent
 * (`agent.endpoint_id`, `agent.name`) beside the person, so the row needs no
 * second identity source and never hardcodes "Aida": `name` is whatever the
 * owner currently calls their chief of staff. The label is composed by the
 * caller through the `chief.label` catalogue key ("{agent} ({person})"), so a
 * locale may reorder or re-punctuate it.
 *
 * WHO IS LISTED. Every OTHER person whose agent is enrolled and not disabled.
 * Endpoint presence/state is the gate, never a display name.
 *
 * WHY THE READER'S OWN AGENT IS WITHHELD (review R1-2 on #1441). A bridge DM
 * with your own chief of staff never reaches it today:
 * - the hub's create-time admission skips a creator's own agent
 *   (`admitDirectAgent`: `agent.AccountID == creatorID`), so it stays
 *   `invited`;
 * - the owner's consent route would activate it, but leaves the agent's
 *   default `notify: mute`, and the hub's delivery rule
 *   (`BridgeConversationFeedRecipients`) wakes a muted agent only on a
 *   structured mention, which this composer never sends;
 * - lifting the mute is the endpoint-addressed notify route, which the runtime
 *   does not proxy, and auto-unmuting would break the default-mute rule.
 * Offering the row would therefore create a conversation whose messages post
 * and are silently never delivered. Restore it only once the hub admits the
 * creator's own agent active with `notify: all` (or the UI can consent AND opt
 * it in through a supported route).
 */
export type TeamBridgeChiefOfStaff = {
	person: TeamBridgeDirectoryMember;
	endpointId: string;
	agentName: string;
	paused: boolean;
};

export function chiefsOfStaff(
	people: readonly TeamBridgeDirectoryMember[],
	selfAccountId?: string,
): TeamBridgeChiefOfStaff[] {
	const chiefs: TeamBridgeChiefOfStaff[] = [];
	for (const person of people) {
		if (selfAccountId && person.account_id === selfAccountId) continue;
		const agent = person.agent;
		if (!agent || agent.state === "disabled") continue;
		chiefs.push({
			person,
			endpointId: agent.endpoint_id,
			agentName: agent.name.trim(),
			paused: agent.state === "paused",
		});
	}
	return chiefs;
}

/**
 * The open DM between the reader and one person's AGENT, if it exists.
 *
 * The participant view deliberately withholds other members' endpoint ids, so
 * the match is on the agent member's `account_id` (its owner). That is exact
 * because an organization member has exactly one chief-of-staff endpoint, and
 * it keeps a person DM and that person's agent DM distinct: the person row
 * matches only a HUMAN member (`dmWithPerson`), this only an AGENT member.
 */
export function dmWithAgent(
	conversations: readonly TeamBridgeConversation[],
	ownerAccountId: string,
	selfAccountId?: string,
): TeamBridgeConversation | null {
	const candidates = conversations.filter(
		(conversation) =>
			conversation.kind === "dm" &&
			conversation.status !== "archived" &&
			conversation.members.some(
				(member) =>
					member.kind === "agent" &&
					member.account_id === ownerAccountId &&
					member.state !== "removed",
			) &&
			/*
			 * THE READER MUST BE THE OTHER END (review round 1, R1-5). An
			 * agent-to-agent DM (the reader's own chief of staff talking to Ben's)
			 * also carries Ben's agent; without this check Ben's chief row would
			 * claim it, and the reader's "DM with Aida (Ben)" would open a
			 * conversation between two agents.
			 */
			(!selfAccountId ||
				conversation.members.some(
					(member) =>
						member.kind === "human" &&
						member.account_id === selfAccountId &&
						member.state !== "removed",
				)),
	);
	if (candidates.length === 0) return null;
	return mergedConversationOrder(candidates)[0] ?? null;
}

/** Built-in channels first, in this order; everything else after. */
const BUILTIN_ORDER = ["humans", "agents"];

/**
 * The rail's sections, Slack-style: channels, groups and direct messages.
 *
 * BUILT-INS LEAD THE CHANNELS. #humans and #agents exist in every organization
 * and are the rail's fixed landmarks, so they sit above user channels in a
 * stable order rather than moving with activity. Every other row keeps the
 * order the caller passed in (the server's / merged activity order).
 *
 * DMs are returned separately: a single-org rail folds them into the People
 * and Chiefs of staff rows (the person IS the DM), while the merged view, which
 * has no directory, lists them under their own header.
 */
export function railSections(rows: readonly TeamBridgeConversation[]): {
	channels: TeamBridgeConversation[];
	groups: TeamBridgeConversation[];
	directs: TeamBridgeConversation[];
} {
	const builtins: TeamBridgeConversation[] = [];
	const channels: TeamBridgeConversation[] = [];
	const groups: TeamBridgeConversation[] = [];
	const directs: TeamBridgeConversation[] = [];
	for (const row of rows) {
		if (row.kind === "channel") {
			if (row.builtin && BUILTIN_ORDER.includes(row.builtin))
				builtins.push(row);
			else channels.push(row);
		} else if (row.kind === "group") groups.push(row);
		else directs.push(row);
	}
	builtins.sort(
		(a, b) =>
			BUILTIN_ORDER.indexOf(a.builtin as string) -
			BUILTIN_ORDER.indexOf(b.builtin as string),
	);
	return { channels: [...builtins, ...channels], groups, directs };
}

/**
 * DMs no directory row will paint, so the single-org rail lists them as plain
 * conversation rows instead of dropping them: a person who left the org, or an
 * agent DM whose owner unenrolled, still has a history the reader may open.
 */
export function unmatchedDirects(
	directs: readonly TeamBridgeConversation[],
	people: readonly TeamBridgeDirectoryMember[],
	chiefs: readonly TeamBridgeChiefOfStaff[],
	selfAccountId?: string,
): TeamBridgeConversation[] {
	const painted = new Set<string>();
	for (const person of people) {
		/*
		 * THE READER'S OWN ROW PAINTS NOTHING (review round 1, R1-1). It is not a
		 * control, and `dmWithPerson(self, self)` matches EVERY DM the reader is
		 * in, so counting it marked the newest DM as shown while no row showed
		 * it: a DM with someone who had left the org vanished from the rail.
		 */
		if (selfAccountId !== undefined && person.account_id === selfAccountId)
			continue;
		const dm = dmWithPerson(directs, person.account_id, selfAccountId);
		if (dm) painted.add(dm.id);
	}
	for (const chief of chiefs) {
		const dm = dmWithAgent(directs, chief.person.account_id, selfAccountId);
		if (dm) painted.add(dm.id);
	}
	return directs.filter((conversation) => !painted.has(conversation.id));
}

/**
 * What the reader has chosen in the rail, before or after a conversation exists.
 *
 * WHY A TARGET AND NOT A CONVERSATION ID (operator review, 2026-10-21). Slack's
 * model: clicking a person selects THAT PERSON'S ROW and shows the thread with
 * them; when no thread exists yet the pane is an empty draft addressed to
 * them, and the conversation is created by the first send. Creating on click
 * made a stray conversation per curious click and painted a second "@ Ben"
 * row beside Ben's People row. The target keeps the person as the selection,
 * so there is exactly one row per person and nothing is written until the
 * reader actually says something.
 *
 * - `conversation`: a channel/group (or a DM no directory row paints).
 * - `person` / `chief`: a People or Chiefs-of-staff row; the DM is resolved
 *   from the list each render, so it appears in place once created.
 * - `compose`: the "To:" draft for a new group, seeded from a row's menu.
 */
export type TeamBridgeTarget =
	| { type: "conversation"; id: string }
	| { type: "person"; accountId: string }
	| { type: "chief"; accountId: string }
	| { type: "compose"; recipients: TeamBridgeRecipient[] };

/** One addressee of a draft: a person, or a person's chief of staff. */
export type TeamBridgeRecipient =
	| { kind: "human"; accountId: string; label: string }
	| {
			kind: "agent";
			accountId: string;
			endpointId: string;
			/** What the picker and rail show (composed; never stored). */
			label: string;
			/**
			 * The agent's own name (empty when it has none) and its owner's name,
			 * so the create payload stores a NAME, not the composed display label
			 * (`recipientMemberInput`). Absent on a hand-built recipient.
			 */
			agentName?: string;
			ownerLabel?: string;
	  };

export function recipientKey(recipient: TeamBridgeRecipient): string {
	return `${recipient.kind}:${recipient.accountId}`;
}

/** The conversation a target currently shows, if one exists yet. */
export function targetConversation(
	target: TeamBridgeTarget | null,
	conversations: readonly TeamBridgeConversation[],
	selfAccountId?: string,
): TeamBridgeConversation | null {
	if (target === null) return null;
	switch (target.type) {
		case "conversation":
			return conversations.find((row) => row.id === target.id) ?? null;
		case "person":
			return dmWithPerson(conversations, target.accountId, selfAccountId);
		case "chief":
			return dmWithAgent(conversations, target.accountId, selfAccountId);
		case "compose": {
			/*
			 * A draft to exactly ONE recipient who already has a thread with the
			 * reader IS that thread (Slack shows it under the To: bar), so the
			 * history loads and the first send goes to it rather than through a
			 * create. Two or more recipients are always a new group: groups are
			 * not find-or-create, so there is nothing to resolve.
			 */
			if (target.recipients.length !== 1) return null;
			const [only] = target.recipients;
			return only.kind === "agent"
				? dmWithAgent(conversations, only.accountId, selfAccountId)
				: dmWithPerson(conversations, only.accountId, selfAccountId);
		}
	}
}

/** "X (X)" collapses to "X"; any other label is returned unchanged. */
function dedupedAgentLabel(label: string): string {
	const twice = COMPOSED_LABEL.exec(label.trim());
	return twice && nameKey(twice[1]) === nameKey(twice[2])
		? twice[1].trim()
		: label;
}

/**
 * What an agent member's `display_label` is stored as.
 *
 * THE SERVER STORES THIS VERBATIM and every client reads it back, so it must be
 * a NAME, never the composed display label: storing "Ben Tran's chief of
 * staff" made the read path compose it AGAIN ("Ben Tran's chief of staff (Ben
 * Tran)", review R1-1 on #1334). So: the agent's own name when it has one;
 * otherwise the OWNER's name, which every reader already treats as "no agent
 * name" (`storedAgentName`) and resolves from the directory, in the reader's
 * own language. A recipient without those fields (hand-built) falls back to
 * its label with a doubled "X (X)" collapsed.
 */
function storedAgentLabel(
	recipient: Extract<TeamBridgeRecipient, { kind: "agent" }>,
): string {
	const owner = recipient.ownerLabel?.trim();
	if (recipient.agentName !== undefined && owner) {
		const agent = recipient.agentName.trim();
		return agent !== "" && nameKey(agent) !== nameKey(owner) ? agent : owner;
	}
	return dedupedAgentLabel(recipient.label);
}

/**
 * One addressed recipient as the create op's STRICT member shape: exactly the
 * wire keys, never a UI field (the `rowId` that refused every dialog create is
 * why this is one function both create paths share). The label is capped at
 * the schema's 64.
 */
export function recipientMemberInput(
	recipient: TeamBridgeRecipient,
): TeamBridgeMemberInput {
	return recipient.kind === "agent"
		? {
				account_id: recipient.accountId,
				kind: "agent",
				endpoint_id: recipient.endpointId,
				display_label: storedAgentLabel(recipient).slice(0, 64),
			}
		: {
				account_id: recipient.accountId,
				kind: "human",
				display_label: recipient.label.slice(0, 64),
			};
}

/**
 * Who a To: picker (the compose bar, the channel form) may address: every
 * reachable person except the reader, then every chief of staff, labelled the
 * way the rail labels them. A bridge-off person is not offered, because a
 * conversation with them would hold messages they cannot receive; they stay
 * visible on the rail with the reason. `chiefLabel` is injected because the
 * "{agent} ({person})" composition is a catalogue string.
 */
export function recipientCandidates(
	people: readonly TeamBridgeDirectoryMember[],
	selfAccountId: string | undefined,
	chiefLabels: ChiefLabels,
): TeamBridgeRecipient[] {
	const humans: TeamBridgeRecipient[] = people
		.filter((member) => {
			const state = personRowState(member, selfAccountId);
			return state === "openable" || state === "paused";
		})
		.map((member) => ({
			kind: "human",
			accountId: member.account_id,
			label: personDisplayLabel(member),
		}));
	const agents: TeamBridgeRecipient[] = chiefsOfStaff(
		people,
		selfAccountId,
	).map((chief) => ({
		kind: "agent",
		accountId: chief.person.account_id,
		endpointId: chief.endpointId,
		agentName: chief.agentName,
		ownerLabel: personDisplayLabel(chief.person),
		label: composeChiefLabel(
			chief.agentName,
			personDisplayLabel(chief.person),
			chiefLabels,
		),
	}));
	return [...humans, ...agents];
}

/**
 * The create request a draft's first send makes.
 *
 * One recipient is a DM (find-or-create on the server, so a retry or a race
 * with another window lands on the same row); two or more is a private group,
 * agent-capable exactly when a chief of staff is among them. Returns null for
 * an empty draft: there is no one to send to.
 */
export function draftCreateInput(recipients: readonly TeamBridgeRecipient[]): {
	kind: "dm" | "group";
	visibility: "private";
	agentCapable: boolean;
	members: TeamBridgeMemberInput[];
} | null {
	if (recipients.length === 0) return null;
	const members = recipients.map(recipientMemberInput);
	return {
		kind: recipients.length === 1 ? "dm" : "group",
		visibility: "private",
		agentCapable: recipients.some((recipient) => recipient.kind === "agent"),
		members,
	};
}

/**
 * The placeholder the hub stored as a member's label before it knew a name.
 *
 * WHY IT IS TREATED AS NO LABEL. agent-server's bridge membership writer used
 * the literal "Member" as its fallback `display_label` for a conversation's
 * creator and for self-joins (fixed for NEW rows by agent-server #166). Rows
 * written before that fix are still in production, and rendered as-is they put
 * "Member" — and an "M" avatar — on every message whose sender the directory
 * does not resolve, the reader's own messages included (operator report,
 * 2026-10-22). It reads as a real name, so it is worse than no name.
 *
 * Exact and case-sensitive on purpose: it matches the server's one fallback
 * string, never a label somebody chose ("member", "Members' rep").
 */
export const LEGACY_PLACEHOLDER_LABEL = "Member";

/** A stored label, or null when it is blank or the legacy placeholder. */
export function storedLabel(label: string): string | null {
	const trimmed = label.trim();
	return trimmed === "" || trimmed === LEGACY_PLACEHOLDER_LABEL
		? null
		: trimmed;
}

/**
 * The two catalogue strings a chief-of-staff label is composed from. Injected
 * because both are translatable ("{agent} ({person})" and "{person}'s chief of
 * staff" reorder and re-punctuate per locale).
 */
export type ChiefLabels = {
	/** "Aida (Ben Tran)": the agent's own name, the person as context. */
	named: (agent: string, person: string) => string;
	/** "Ben Tran's chief of staff": used when the agent has no name of its own. */
	unnamed: (person: string) => string;
};

/**
 * "Agent (Owner)": the composed display form. Older clients stored it as the
 * agent member's `display_label`, so the read path must recognise it (and "X
 * (X)") in existing rows; this client now stores a bare name (`storedAgentLabel`).
 */
const COMPOSED_LABEL = /^(.+?)\s*\((.+)\)$/;

/**
 * The stored tails of an unnamed agent's label. The ASCII form is the only
 * one the hub writes (`chiefOfStaffSuffix`). The typographic form is the
 * English catalogue's; no released client stored it, and it is matched
 * defensively so a client that ever stores the catalogue string verbatim is
 * not composed twice. Wire shapes, never rendered; see `storedAgentName`.
 */
const CHIEF_OF_STAFF_SUFFIXES = ["'s chief of staff", "’s chief of staff"];

/**
 * The hub's byte bound on a stored member label
 * (`bridgeConversationLabelMax`).
 */
const HUB_LABEL_MAX_BYTES = 64;

/**
 * The person half of the hub's unnamed-agent label, as the hub writes it
 * (review R2-1 on #1441). `agentMemberLabel` does three things, in order:
 * - normalises the name (`NormalizeAgentName`: whitespace runs to one
 *   space, ends trimmed);
 * - cuts it to 64 − len("'s chief of staff") = 47 UTF-8 bytes, backing off
 *   to a rune boundary (`truncateConversationLabelTo`);
 * - trims again, then appends the suffix.
 * A Cyrillic or Devanagari full name passes 47 bytes well before 47
 * characters, so without this mirror the read path saw a name that is not
 * the owner's and composed "Пет's chief of staff (… Петров)". Must stay
 * byte-for-byte with the hub's rule; it is matched, never rendered.
 */
function hubTruncatedPerson(personName: string): string {
	// `\s` plus NEL (U+0085): Go's `unicode.IsSpace` set, which JS `\s` lacks.
	const person = personName.replace(/[\s\u0085]+/gu, " ").trim();
	const bytes = new TextEncoder().encode(person);
	let cut = HUB_LABEL_MAX_BYTES - CHIEF_OF_STAFF_SUFFIXES[0].length;
	if (bytes.length <= cut) return person;
	while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut -= 1;
	return new TextDecoder().decode(bytes.subarray(0, cut)).trim();
}

/** Case-, space- and accent-insensitive form for "is this the same name". */
function nameKey(name: string): string {
	return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * THE ONE PLACE a chief-of-staff label is composed (operator report,
 * 2026-10-22: "Ben Tran (Ben Tran)" on the rail, the thread header and the
 * composer placeholder, and persisted by the server verbatim as the agent
 * member's `display_label`).
 *
 * WHY IT HAPPENED. The directory's `agent.name` is the endpoint's agent name,
 * else its label, and an endpoint enrolled without an agent name was labelled
 * with its OWNER's name. Composing "{agent} ({person})" from that repeated the
 * person. So an agent name that is empty, or the same as the person's
 * (normalised), is no name at all: the label is then "{person}'s chief of
 * staff", and the person's name never appears twice.
 */
export function composeChiefLabel(
	agentName: string,
	personName: string,
	labels: ChiefLabels,
): string {
	const agent = agentName.trim();
	const person = personName.trim();
	return agent === "" || nameKey(agent) === nameKey(person)
		? labels.unnamed(person)
		: labels.named(agent, person);
}

/**
 * The agent half of a STORED agent `display_label`, or null when the row holds
 * no agent name.
 *
 * Rows written before the composition fix hold "X (X)", the person's own name,
 * or an already composed "Aida (Ben Tran)". The first two are no name; the
 * third is stripped back to "Aida" so it is not composed a second time.
 *
 * "X's chief of staff" is ALSO no name (review R1-1 on #1441). The hub
 * rewrites a degenerate agent label (empty, the owner's bare name, "X (X)")
 * to exactly that English string on write (`agentMemberLabel`) and returns
 * it as stored, so a client that stores the owner's bare name reads back
 * this form. Taking it as an agent name composed "Ben Tran's chief of staff
 * (Ben Tran)", and left non-English readers with the hub's English. The
 * typographic apostrophe is accepted too: it is the English catalogue's shape,
 * which older clients stored verbatim.
 * `personName` must match by `nameKey`, mirroring the hub's
 * `agentLabelDegenerate`; an unlisted owner keeps the stored string.
 * The hub's suffix and the catalogue's English copy are matched literally
 * because they are the wire shapes, not display copy.
 * `personName` is null when the directory does not list the owner; a label of
 * the form "X (X)" is still recognised then.
 */
export function storedAgentName(
	label: string,
	personName: string | null,
): string | null {
	const stored = storedLabel(label);
	if (stored === null) return null;
	if (personName !== null && nameKey(stored) === nameKey(personName)) {
		return null;
	}
	if (
		personName !== null &&
		[personName, hubTruncatedPerson(personName)].some((person) =>
			CHIEF_OF_STAFF_SUFFIXES.some(
				(suffix) => nameKey(stored) === nameKey(`${person}${suffix}`),
			),
		)
	) {
		return null;
	}
	const composed = COMPOSED_LABEL.exec(stored);
	if (composed) {
		const [, agent, owner] = composed;
		if (nameKey(agent) === nameKey(owner)) return null;
		if (personName !== null && nameKey(owner) === nameKey(personName)) {
			return agent.trim();
		}
	}
	return stored;
}

/** The signed-in reader, when the account read has answered with a name. */
export type TeamBridgeSelf = { accountId: string; name: string };

/**
 * The name to paint for a participant or message sender, or null when none is
 * known.
 *
 * ORDER. The directory first: it is the live account name, and a conversation
 * stores each member's label only at add time. Then, for the reader's own human
 * messages, the signed-in identity (`self`): the directory may not list the
 * reader, and the merged view may have no directory for the thread's
 * organization yet, but the reader's own name is always known locally. The
 * stored label last, for someone no longer in the directory, unless it is the
 * legacy placeholder (`storedLabel`). An agent is named "{agent} ({person})"
 * with its CURRENT name when the directory publishes one; the reader's own
 * agent is not the reader, so `self` never names an agent.
 *
 * NULL IS THE CALLER'S TO PAINT. The caller renders an "Unknown person" /
 * "Unknown agent" placeholder that is visibly not a name: inventing one here
 * is how "Member" reached the screen. `chiefLabel` is injected because the
 * composition is a catalogue string.
 */
export function participantLabel(
	participant: {
		account_id: string;
		kind: "human" | "agent";
		display_label: string;
	},
	people: readonly TeamBridgeDirectoryMember[],
	chiefLabels: ChiefLabels,
	self?: TeamBridgeSelf | null,
): string | null {
	const person = people.find(
		(row) => row.account_id === participant.account_id,
	);
	const personName = person ? personDisplayLabel(person) : null;
	if (participant.kind === "human") {
		const stored = storedLabel(participant.display_label);
		const selfName =
			self && self.accountId === participant.account_id
				? self.name.trim() || null
				: null;
		return personName ?? selfName ?? stored;
	}
	// An agent name equal to the owner's is the server defaulting the label to
	// the person (see `composeChiefLabel`): it is no name, so fall through to
	// the stored label and then to "{person}'s chief of staff".
	const directoryName = person?.agent?.name.trim() ?? "";
	const agentName =
		directoryName !== "" &&
		(personName === null || nameKey(directoryName) !== nameKey(personName))
			? directoryName
			: storedAgentName(participant.display_label, personName);
	if (personName)
		return composeChiefLabel(agentName ?? "", personName, chiefLabels);
	return agentName;
}

export type ThreadItem =
	| {
			type: "day";
			key: string;
			date: Date;
			relative: "today" | "yesterday" | null;
	  }
	| { type: "message"; message: TeamBridgeMessage; continuation: boolean };

/** Slack's run window: a same-sender follow-up within it skips the header. */
const RUN_WINDOW_MS = 5 * 60_000;

function dayKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * The thread as rows: a divider per calendar day, and same-sender runs.
 *
 * Input is any order; output is oldest first. A message is a CONTINUATION when
 * the previous row is the same sender (same account AND kind: a person and
 * their own agent are different speakers), on the same day, within five
 * minutes. A message with an unparseable time never continues a run and gets
 * no divider, so a bad timestamp cannot glue two speakers together.
 */
export function threadItems(
	messages: readonly TeamBridgeMessage[],
	now: Date,
): ThreadItem[] {
	const today = dayKey(now);
	const yesterday = dayKey(
		new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
	);
	const items: ThreadItem[] = [];
	let previous: TeamBridgeMessage | null = null;
	let previousDay: string | null = null;
	for (const message of chronological(messages)) {
		const at = new Date(message.created_at);
		const valid = !Number.isNaN(at.getTime());
		const day = valid ? dayKey(at) : null;
		if (day !== null && day !== previousDay) {
			items.push({
				type: "day",
				key: day,
				date: at,
				relative:
					day === today ? "today" : day === yesterday ? "yesterday" : null,
			});
		}
		const continuation =
			previous !== null &&
			valid &&
			day === previousDay &&
			previous.sender.account_id === message.sender.account_id &&
			previous.sender.kind === message.sender.kind &&
			at.getTime() - Date.parse(previous.created_at) < RUN_WINDOW_MS;
		items.push({ type: "message", message, continuation });
		previous = message;
		if (day !== null) previousDay = day;
	}
	return items;
}

/**
 * A draft's FIRST SEND: create the conversation, then post into it.
 *
 * WHY A PURE FUNCTION (review round 1, R1-8). The two writes, and what a
 * retry does after one of them fails, are the riskiest path on the page and
 * the one R1-2 found broken. Kept here, with its effects injected, it is
 * tested directly rather than through a rendered container.
 *
 * THE RULES IT ENFORCES:
 * - A retry after "create landed, post failed" REUSES the created id (the
 *   `remembered` map, keyed by the draft): a group is not find-or-create, so a
 *   second create would be a second group with the message in both.
 * - The post carries the caller's `clientRef` every time, so the hub dedupes
 *   a post that landed but whose response was lost.
 * - The memory is cleared only after a successful post, so a later, different
 *   message from the same recipients after success is a fresh draft only if
 *   the target is still a draft (in practice it is the conversation by then).
 */
export async function sendFirstMessage(args: {
	draftKey: string;
	input: NonNullable<ReturnType<typeof draftCreateInput>>;
	body: string;
	clientRef: string;
	tenantId: string | undefined;
	remembered: Map<string, { id: string; tenantId: string | undefined }>;
	create: (
		input: NonNullable<ReturnType<typeof draftCreateInput>>,
	) => Promise<{ id?: string; tenant_id?: string }>;
	post: (
		conversationId: string,
		message: { clientRef: string; body: string; tenantId: string | undefined },
	) => Promise<unknown>;
}): Promise<{ id: string; tenantId: string | undefined }> {
	let created = args.remembered.get(args.draftKey);
	if (created === undefined) {
		const response = await args.create(args.input);
		if (!response.id) throw new Error("create returned no conversation id");
		created = {
			id: response.id,
			tenantId: response.tenant_id ?? args.tenantId,
		};
		args.remembered.set(args.draftKey, created);
	}
	await args.post(created.id, {
		clientRef: args.clientRef,
		body: args.body,
		tenantId: created.tenantId,
	});
	args.remembered.delete(args.draftKey);
	return created;
}
