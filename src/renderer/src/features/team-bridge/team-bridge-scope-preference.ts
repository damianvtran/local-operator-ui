import type { TeamBridgeConversation } from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_ALL_SCOPE,
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
): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(
			storage.getItem(SCOPE_PREFERENCE_KEY) ?? "{}",
		);
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
 * The scope a page should open in, given everything known at that moment.
 * First match wins; the order is the contract:
 *
 * 1. **A `?tenant=` deep link** (and its "recent conversations" sibling that
 *    seeds the same parameter). It is a request to look at one organization -
 *    someone sent it - so it outranks every stored preference, and it is never
 *    written back (`writeScopePreference` has exactly one caller: the explicit
 *    switcher pick).
 * 2. **A scope the reader has already used the switcher for this session.**
 *    Their explicit choice outranks a stored default, so a later unread poll
 *    that re-renders the organization array cannot yank the rail back.
 * 3. **Exactly one organization** - that organization. A one-org account is not
 *    offered a union in the first place ("All organizations" there only
 *    disables create), and a stored value is deliberately ignored: a value
 *    written in an account that later lost memberships must not park a single-
 *    org reader in the union.
 * 4. **A stored value that is still a membership** (or `"all"`). This is the
 *    operator's "last-used choice", and it is only honoured for an organization
 *    the reader is currently in, so a revoked membership corrects itself.
 * 5. **Otherwise the union.** Several organizations with nothing stored, or a
 *    stored organization that is no longer a membership. Never "the first
 *    organization": the reader's second-favourite is not their favourite, and
 *    the union view is now a good place to land - which is what makes that
 *    refusal safe.
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
	requestedTenant,
	chosen,
	current,
	snapshotRows,
}: {
	organizations: readonly TeamBridgeOrganization[];
	stored?: TeamBridgeScope;
	/** The `?tenant=` parameter, already validated by the caller's router. */
	requestedTenant?: string | null;
	chosen: boolean;
	current: TeamBridgeScope;
	snapshotRows?: readonly TeamBridgeConversation[];
}): TeamBridgeScope {
	if (requestedTenant) return asTeamBridgeTenantId(requestedTenant);
	if (chosen) return current;
	if (organizations.length === 1) return organizations[0].tenantId;
	if (
		stored !== undefined &&
		(stored === TEAM_BRIDGE_ALL_SCOPE ||
			organizations.some((organization) => organization.tenantId === stored))
	)
		return stored;
	if (organizations.length > 1) return TEAM_BRIDGE_ALL_SCOPE;
	return preferredScope(organizations, current, chosen, snapshotRows);
}
