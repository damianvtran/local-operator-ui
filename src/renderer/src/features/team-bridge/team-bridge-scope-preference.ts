import type { TeamBridgeConversation } from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeCommunity,
	type TeamBridgeCommunityId,
	type TeamBridgeOrganization,
	type TeamBridgeScope,
	asTeamBridgeTenantId,
	preferredScope,
} from "./team-bridge-model";

/**
 * THE READER'S LAST SCOPE CHOICE, PER ACCOUNT (operator ask: "several orgs →
 * the last-used choice").
 *
 * WHY NOT `ui-preferences-storage`. That store is one unscoped blob shared by
 * every feature (the page's own note at `team-bridge-page.tsx` records the
 * hazard), so a key added there is a key every feature can overwrite; and a
 * two-word preference does not earn a store migration. A namespaced key of its
 * own keeps the blast radius at this feature and needs no migration path: the
 * `.v1` suffix is the only versioning mechanism, and it is bumped by rewriting
 * the key when the shape ever changes.
 *
 * WHAT IS STORED: one JSON object per origin, `{ "<accountId>": "<tenantId>" |
 * "all" }`. Scope is per ACCOUNT because membership sets differ per account -
 * an entry read for somebody else's account would name a tenant this reader
 * cannot act in. Nothing is erased on sign-out: a stale entry is inert (rule 4
 * of `resolveOpeningScope` only honours a stored org that is still a
 * membership), and the next switcher pick overwrites it.
 *
 * WHY THE STORAGE IS A PARAMETER. Same shape as `team-bridge-drafts.ts`: the
 * module never touches a global, so `node:test` drives it with a fake store and
 * no renderer is involved.
 */
export const SCOPE_PREFERENCE_KEY = "lo.teamBridge.scope.v1";

/** Tenant ids are server-issued ids; anything longer is a corrupt entry. */
const MAX_TENANT_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The whole map, tolerantly: a corrupt value is `{}`, never a throw. A
 * preference that cannot be read must not be able to break the page, and it
 * must never surface as a prompt - it is a convenience, not state the reader
 * owns.
 */
function readEntries(
	storage: Pick<Storage, "getItem">,
	key: string = SCOPE_PREFERENCE_KEY,
): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(storage.getItem(key) ?? "{}");
		return isRecord(value) ? value : {};
	} catch {
		return {};
	}
}

/**
 * The scope this account last chose in the switcher, or `undefined` when it has
 * never chosen (or the stored value is not a shape this build can act on).
 *
 * Unknown accounts are ignored rather than copied across: the answer describes
 * the reader of THIS account only.
 */
export function readScopePreference(
	storage: Pick<Storage, "getItem">,
	accountId: string,
): TeamBridgeScope | undefined {
	const entry = readEntries(storage)[accountId];
	if (typeof entry !== "string") return undefined;
	if (entry === TEAM_BRIDGE_ALL_SCOPE) return TEAM_BRIDGE_ALL_SCOPE;
	const tenantId = entry.trim();
	if (!tenantId || tenantId.length > MAX_TENANT_ID_LENGTH) return undefined;
	return asTeamBridgeTenantId(tenantId);
}

/**
 * Record one explicit switcher pick for this account.
 *
 * Silent on failure: storage can be full or disabled, and losing a convenience
 * must never turn a scope change into an error the reader has to handle. The
 * merge is a read-modify-write of the whole map so a pick for one account can
 * never drop another account's entry on a shared machine.
 */
export function writeScopePreference(
	storage: Storage,
	accountId: string,
	scope: TeamBridgeScope,
): void {
	try {
		const entries = readEntries(storage);
		storage.setItem(
			SCOPE_PREFERENCE_KEY,
			JSON.stringify({ ...entries, [accountId]: scope }),
		);
	} catch {
		/* Not persisted; the reader's choice still holds for this session. */
	}
}

/**
 * THE SCOPE THE READER WAS IN, THIS APP SESSION ONLY (RFC v2.4 Amendment A §3).
 *
 * Amendment A splits "where Team Bridge opens" in two: within a running app the
 * reader's current scope survives leaving and re-entering Team Bridge (the route
 * unmounts on every tab switch), but a RESTART reapplies the opening rule -
 * pending private invitation, then the default private org - so a community, or
 * another org, picked yesterday never becomes today's launch view.
 *
 * WHY `sessionStorage`. Its lifetime IS the app session: it survives a renderer
 * reload and a route unmount, and the browser drops it when the window's
 * session ends (app quit). The `localStorage` records beside it
 * (`SCOPE_PREFERENCE_KEY`, the view memory's last scope) outlive a restart, so
 * they cannot answer "this session" and now rank BELOW the default org. Same
 * per-account JSON map, separate key, so a session value can never be mistaken
 * for the durable one.
 */
export const SESSION_SCOPE_KEY = "lo.teamBridge.sessionScope.v1";

/** `window.sessionStorage`, or null where there is none or policy denies it. */
export function browserSessionStorage(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.sessionStorage;
	} catch {
		return null;
	}
}

/** The scope this account was in earlier in this app session, if any. */
export function readSessionScope(
	storage: Pick<Storage, "getItem">,
	accountId: string,
): TeamBridgeScope | undefined {
	const entry = readEntries(storage, SESSION_SCOPE_KEY)[accountId];
	if (typeof entry !== "string") return undefined;
	if (entry === TEAM_BRIDGE_ALL_SCOPE) return TEAM_BRIDGE_ALL_SCOPE;
	const tenantId = entry.trim();
	if (!tenantId || tenantId.length > MAX_TENANT_ID_LENGTH) return undefined;
	return asTeamBridgeTenantId(tenantId);
}

/** Record the scope the reader is in now; silent on failure, like the rest. */
export function writeSessionScope(
	storage: Storage,
	accountId: string,
	scope: TeamBridgeScope,
): void {
	try {
		const entries = readEntries(storage, SESSION_SCOPE_KEY);
		if (entries[accountId] === scope) return;
		storage.setItem(
			SESSION_SCOPE_KEY,
			JSON.stringify({ ...entries, [accountId]: scope }),
		);
	} catch {
		/* Not persisted; the next open applies the launch rule instead. */
	}
}

/**
 * Where Team Bridge lands: a private scope, or one community. Communities are
 * a separate variant (never a `TeamBridgeScope`) so no code that reads a
 * private scope can be handed one.
 */
export type TeamBridgeSelection =
	| { kind: "private"; scope: TeamBridgeScope }
	| { kind: "community"; communityId: TeamBridgeCommunityId };

/**
 * Amendment A's opening rule, for everything that is not a deep link or a pick
 * made on this mounted page. First match wins:
 *
 * 1. **This app session's scope** - a private scope still valid (a current
 *    organization, or "all" with several), or a community still joined. The
 *    reader's own position outranks every default, so leaving Team Bridge and
 *    coming back never moves them (Amendment A: a community switch "lasts until
 *    you switch back or restart the app"). It ranks above the invitation too:
 *    a reader who saw the invitation and moved on has answered "not now".
 * 2. **A pending invitation to a private org** (frame D22), even with a
 *    community joined.
 * 3. **The default private org** - the Radient account's home tenant
 *    (`MembershipSummary.is_home`; Minerva for its owner), honoured only when it
 *    is one of the reader's Team Bridge organizations: a plan-less personal home
 *    tenant is not a row, and must not hide the rules below.
 * 4. **Exactly one private org** - that org (the shipped rule).
 * 5. **The durable last-used private scope** (`readScopePreference` / view
 *    memory) when still valid - the pre-Amendment behaviour, kept for accounts
 *    whose home tenant is not a Team org. Private only by type: a community
 *    from an earlier run can never come back through here.
 * 6. **Several private orgs** - "All organizations" (private orgs only).
 * 7. **No private org and no invitation** - the first joined community. This
 *    is the ONLY way a community is a launch default.
 *
 * `null` means nothing is known yet (memberships in flight): the caller keeps
 * its own interim answer.
 */
export function resolveDefaultSelection({
	organizations,
	communities = [],
	defaultTenantId,
	session,
	stored,
}: {
	organizations: readonly TeamBridgeOrganization[];
	communities?: readonly TeamBridgeCommunity[];
	/** The account's Radient home tenant id, when the memberships read has one. */
	defaultTenantId?: string | null;
	session?: TeamBridgeSelection;
	stored?: TeamBridgeScope;
}): TeamBridgeSelection | null {
	const isOrganization = (tenantId: string) =>
		organizations.some((organization) => organization.tenantId === tenantId);
	const validPrivate = (scope: TeamBridgeScope) =>
		scope === TEAM_BRIDGE_ALL_SCOPE
			? organizations.length > 1
			: isOrganization(scope);
	if (session?.kind === "private" && validPrivate(session.scope))
		return session;
	if (
		session?.kind === "community" &&
		communities.some(
			(community) => community.communityId === session.communityId,
		)
	)
		return session;
	const invited = organizations.find((organization) => organization.invited);
	if (invited) return { kind: "private", scope: invited.tenantId };
	if (defaultTenantId && isOrganization(defaultTenantId))
		return { kind: "private", scope: asTeamBridgeTenantId(defaultTenantId) };
	if (organizations.length === 1)
		return { kind: "private", scope: organizations[0].tenantId };
	if (stored !== undefined && validPrivate(stored))
		return { kind: "private", scope: stored };
	if (organizations.length > 1)
		return { kind: "private", scope: TEAM_BRIDGE_ALL_SCOPE };
	if (communities.length > 0)
		return { kind: "community", communityId: communities[0].communityId };
	return null;
}

/**
 * The opening snapshot, narrowed to the scope that will paint it.
 *
 * WHY THIS EXISTS (review round 1, M1). `openingRows` is the shell notification
 * watcher's cache entry, and that entry is ACCOUNT-scoped
 * (`teamBridgeKeys.conversations(TEAM_BRIDGE_ALL_SCOPE, accountId)`), so it holds
 * every organization's rows. `visibleConversationRows` returns a single-org list
 * unchanged, so once the first paint could start in a stored organization, an
 * unnarrowed snapshot painted other organizations' channels and DMs under that
 * organization's switcher title — and the one-shot landing effect, which picks
 * `#humans` or else the first row, could select a conversation this page never
 * reads (spending an archived read on open for a selection outside the live
 * list). The narrow belongs here rather than in `visibleConversationRows`,
 * because a snapshot is not the scope's own read: it is a stand-in, and a
 * stand-in may only answer for one scope.
 *
 * The union keeps the whole snapshot: every row in it belongs to an organization
 * the reader is in, and the merged filter is `visibleConversationRows`' job.
 */
export function snapshotForScope(
	rows: readonly TeamBridgeConversation[],
	scope: TeamBridgeScope,
): TeamBridgeConversation[] {
	if (scope === TEAM_BRIDGE_ALL_SCOPE) return [...rows];
	return rows.filter((row) => row.tenant_id === scope);
}

/**
 * The scope a page should open in, given everything known at that moment.
 * First match wins; the order is the contract:
 *
 * 1. **A `?tenant=` deep link** (and its "recent conversations" sibling that
 *    seeds the same parameter). It is a request to look at one organization -
 *    someone sent it - so it outranks every stored preference, and it is never
 *    written back (`writeScopePreference` has exactly one caller: the explicit
 *    switcher pick).
 * 2. **A scope the reader has already used the switcher for on this page.**
 *    Their explicit choice outranks a stored default, so a later unread poll
 *    that re-renders the organization array cannot yank the rail back.
 * 3. **Amendment A's opening rule** (`resolveDefaultSelection`): this app
 *    session's scope, then a pending private invitation, then the default
 *    private org, then exactly one org, then the durable last-used scope (still
 *    a membership, or `"all"` with several), then the union. Before Amendment A
 *    the durable value outranked everything but a single org, which reopened a
 *    restarted app wherever it was last left; the operator's rule now puts the
 *    default private org first on every launch. Never "the first
 *    organization" when several: the union is the neutral landing.
 *
 * This page cannot render a community yet (the community client has not
 * landed), so communities are not passed here and a community answer cannot
 * occur; `resolveDefaultSelection` carries that rule for the client that will.
 *
 * With no organizations known yet (memberships still in flight) the shipped
 * snapshot rule stands: `preferredScope` may adopt the one organization the
 * shell's watcher already saw, and otherwise leaves `current` alone. That is a
 * weaker statement than the organization list and never outranks it, so it only
 * answers while the list cannot.
 */
export function resolveOpeningScope({
	organizations,
	stored,
	session,
	defaultTenantId,
	requestedTenant,
	chosen,
	current,
	snapshotRows,
}: {
	organizations: readonly TeamBridgeOrganization[];
	stored?: TeamBridgeScope;
	/** This app session's scope (`readSessionScope`). */
	session?: TeamBridgeScope;
	/** The Radient home tenant id (`MembershipSummary.is_home`). */
	defaultTenantId?: string | null;
	/** The `?tenant=` parameter, already validated by the caller's router. */
	requestedTenant?: string | null;
	chosen: boolean;
	current: TeamBridgeScope;
	snapshotRows?: readonly TeamBridgeConversation[];
}): TeamBridgeScope {
	if (requestedTenant) return asTeamBridgeTenantId(requestedTenant);
	if (chosen) return current;
	const selection = resolveDefaultSelection({
		organizations,
		defaultTenantId,
		session:
			session === undefined ? undefined : { kind: "private", scope: session },
		stored,
	});
	if (selection?.kind === "private") return selection.scope;
	// Unchanged from before Amendment A: with the list still in flight, a
	// remembered union stays the union rather than adopting a snapshot's org.
	if (
		organizations.length === 0 &&
		(session ?? stored) === TEAM_BRIDGE_ALL_SCOPE
	)
		return TEAM_BRIDGE_ALL_SCOPE;
	return preferredScope(organizations, current, chosen, snapshotRows);
}
