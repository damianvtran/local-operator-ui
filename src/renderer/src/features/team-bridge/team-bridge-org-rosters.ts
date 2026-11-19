import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeTenantId,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeChiefOfStaff,
	type TeamBridgeOrganization,
	chiefsOfStaff,
	unmatchedDirects,
} from "./team-bridge-model";

/**
 * One organization's slice of the union view: its roster read, the rows that
 * roster paints, and the DMs no row of that organization paints.
 *
 * WHY THIS EXISTS AT ALL. People, Chiefs of staff and the union's loose DMs are
 * three sections fed by ONE account-wide conversation list plus N per-org
 * roster reads (`useTeamBridgeDirectories`). Before this module the merged view
 * had no roster at all: People said "choose an organization", Chiefs was empty
 * and every DM was listed flat under Direct messages. Computing the slice per
 * organization is what makes the union view's rows act in the row's own org -
 * an account id is only meaningful inside its tenant, so a person present in
 * two organizations is two rows with two ids and two DMs.
 *
 * SETTLED: this is pure, so the view stays a renderer of decisions and
 * `scripts/team-bridge-org-rosters.test.mjs` drives it without a renderer.
 */
export type TeamBridgeOrgRoster = {
	tenantId: TeamBridgeTenantId;
	/** The organization's switcher name, the group header's text. */
	name: string;
	state: "loading" | "error" | "ready";
	members: readonly TeamBridgeDirectoryMember[];
	chiefs: TeamBridgeChiefOfStaff[];
	/**
	 * Every DM row this organization holds. A person or chief row resolves ITS DM
	 * from this list (`dmWithPerson` / `dmWithAgent`), which is what keeps the
	 * single-org invariant in the union: a person's row IS their DM, and a row's
	 * unread count is that organization's count.
	 */
	directs: TeamBridgeConversation[];
	/**
	 * That organization's DMs that no person or chief row paints - a person who
	 * left, an agent DM whose owner unenrolled. The union's Direct messages
	 * section is the concatenation of these, so one DM is one row.
	 */
	looseDirects: TeamBridgeConversation[];
};

/**
 * Grouping is conditional, and the predicate is stated ONCE here so the rail's
 * three sections cannot disagree: a union spanning more than one organization
 * gets org subheaders; a single organization is byte-identical to the shipped
 * single-org view. A one-org account that manually picked "All organizations"
 * also gets no headers, which is correct - there is nothing to disambiguate.
 */
export function orgGroupsVisible(
	mergedView: boolean,
	organizationCount: number,
): boolean {
	return mergedView && organizationCount > 1;
}

/**
 * The union's per-organization slices, in the switcher's order.
 *
 * ORDER: `organizations` as the container built it (`organizationOptions`), not
 * re-sorted and not ordered by unread or activity. A reader who sees an
 * organization third in the switcher must find it third under People, Chiefs
 * and the audit; a header that moves out from under the pointer as messages
 * arrive is motion with no informational gain.
 *
 * A roster whose read has not answered is absent from `directories`, so its
 * slice is empty and its state says why: `loading` for a read still in flight,
 * `error` for one that failed, and the view draws the header plus that state's
 * body. `unmatchedDirects` over an empty roster returns that organization's DMs
 * unchanged, which is the same answer the theoretical "no roster, so nothing is
 * painted" rule gives - a failed roster must never hide a DM that still has
 * history to open.
 */
export function orgRosters({
	organizations,
	directories,
	directoryStates,
	directs,
	selfAccountId,
}: {
	organizations: readonly TeamBridgeOrganization[];
	directories?: Readonly<Record<string, readonly TeamBridgeDirectoryMember[]>>;
	directoryStates?: Readonly<Record<string, "loading" | "error" | "ready">>;
	/** The account-wide direct conversations, as the merged list returned them. */
	directs: readonly TeamBridgeConversation[];
	selfAccountId?: string;
}): TeamBridgeOrgRoster[] {
	return organizations.map((organization) => {
		const tenantId = organization.tenantId;
		const members = directories?.[tenantId] ?? [];
		const chiefs = chiefsOfStaff(members, selfAccountId);
		const orgDirects = directs.filter(
			(conversation) => conversation.tenant_id === tenantId,
		);
		return {
			tenantId,
			name: organization.name,
			/*
			 * A MISSING STATE IS NOT EVIDENCE OF AN EMPTY ROSTER (design round 1,
			 * D4). An absent state with rows stays `ready`, because a painted roster
			 * must never turn into a spinner; an absent state with NO members is a
			 * read that has not answered, so it is `loading` rather than a false
			 * claim that nobody has joined.
			 */
			state:
				directoryStates?.[tenantId] ??
				(members.length > 0 ? "ready" : "loading"),
			members,
			chiefs,
			directs: orgDirects,
			looseDirects: unmatchedDirects(
				orgDirects,
				members,
				chiefs,
				selfAccountId,
			),
		};
	});
}

/** The union's Direct messages rows: every organization's leftovers, in order. */
export function looseDirectsFor(
	rosters: readonly TeamBridgeOrgRoster[],
): TeamBridgeConversation[] {
	return rosters.flatMap((roster) => roster.looseDirects);
}

/**
 * One row identity inside the union: `tenant:account`.
 *
 * Account ids repeat across organizations (the same person in two orgs is two
 * rows with two ids), so the tenant is part of the key or React reuses one row
 * for the other and the wrong DM's unread count lands on it.
 */
export function orgRowKey(
	tenantId: TeamBridgeTenantId,
	accountId: string,
): string {
	return `${tenantId}:${accountId}`;
}

/** The DOM id a group's `<ul>` is labelled by, and the header's own id. */
export function orgGroupHeadingId(
	prefix: string,
	tenantId: TeamBridgeTenantId,
): string {
	return `team-bridge-org-${prefix}-${tenantId}`;
}
