/**
 * The command palette's Team Bridge source: the destination row, and the
 * channels, groups, DMs, people and chiefs of staff the rail lists.
 *
 * ## Which reads, and why they cost nothing per keystroke
 *
 * Every read here is one the rail and the shell already make, under the SAME
 * react-query key, so the palette joins a cache entry rather than adding a
 * request family:
 * - the bridge status (`teamBridgeKeys.statusFor`), mounted by the nav row;
 * - the account-scope live list (`teamBridgeKeys.conversations("all", ...)`),
 *   which the shell's notification watcher polls every 30 s;
 * - one directory per organization (`teamBridgeKeys.directory`), the keys the
 *   rail's People section and the merged view read;
 * - the memberships (organization names when the hub lists none) and the shared
 *   unread view (`useTeamBridgeUnreadView`) the nav badge draws from.
 *
 * None of the keys depends on the query, and every read is enabled by `open`
 * alone, never by the typed terms or the scope: a keystroke changes the text the
 * rows are matched against and nothing else. Opening the palette is the one
 * moment a stale entry is refreshed (react-query's refetch-on-mount), which is
 * the "prefetch on open" a cold palette needs: the first time it opens before
 * the rail ever has, it asks once, and every later open is a cache hit inside
 * the reads' own stale times.
 *
 * ## Failing closed, and quietly
 *
 * The destination row rides the route's own capability
 * (`team_bridge_conversations`), the gate the sidebar row reads. The
 * conversation rows need more, because each is a promise to open a thread: the
 * owner guard the page requires before any read
 * (`team_bridge_conversation_owner_guard`), a signed-in account, and a status
 * answer for THAT account that the page would not turn into a gate panel
 * (`teamBridgeEligibility`). Anything short of that offers no rows. A read that
 * fails offers no rows either, and says nothing: the palette is a search, not a
 * diagnostics surface, and the page itself already explains every one of those
 * states when the reader opens it.
 */

import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useMemo } from "react";
import { t } from "../../../../i18n/messages";
import {
	type ChiefLabels,
	TEAM_BRIDGE_ALL_SCOPE,
	hubTenantList,
	organizationOptions,
	teamBridgeEligibility,
} from "../team-bridge/team-bridge-model";
import { TEAM_BRIDGE_PATH } from "../team-bridge/team-bridge-nav";
import { useTeamBridgeAccount } from "../team-bridge/team-bridge-owner";
import {
	teamBridgeUnreadKey,
	useTeamBridgeUnreadView,
} from "../team-bridge/team-bridge-unread-sync";
import {
	useTeamBridgeConversations,
	useTeamBridgeDirectories,
	useTeamBridgeStatus,
} from "../team-bridge/use-team-bridge";
import type { PaletteItem } from "./palette-search";
import { paletteTeamBridgeItems } from "./palette-team-bridge";

/** The rail's own chief-label forms (`team-bridge-page.tsx`'s `chiefLabelCopy`). */
const chiefLabelCopy = (): ChiefLabels => ({
	named: (agent, person) => t("ui.teamBridge.chief.label", { agent, person }),
	unnamed: (person) => t("ui.teamBridge.chief.unnamed", { person }),
});

/**
 * The destination row. A `bridge` target rather than the `path` every other
 * page row carries, so that choosing it while already on Team Bridge replaces
 * instead of stacking a second entry (see `PaletteTarget`). `order` puts it after
 * the rail's primary destinations, where the sidebar's More group puts it.
 */
export function teamBridgeDestinationItem(order: number): PaletteItem {
	return {
		id: "page-team-bridge",
		kind: "page",
		group: "navigation",
		name: t("ui.teamBridge.nav.label"),
		icon: "conversation",
		/*
		 * The words people use for it. "tb" is the product's own shorthand (and the
		 * scope word); "bridge" and the rest are what someone looking for a channel
		 * list might type before remembering the product's name.
		 */
		keywords: [
			"bridge",
			"tb",
			"channels",
			"direct messages",
			"dm",
			"dms",
			"groups",
			"messages",
			"people",
			"organization",
		],
		target: { type: "bridge", path: TEAM_BRIDGE_PATH },
		order,
		featured: true,
	};
}

export function usePaletteTeamBridge({
	open,
	wantsRows,
	destinationOrder,
}: {
	open: boolean;
	/** Whether the parsed scope admits the Team Bridge group at all. */
	wantsRows: boolean;
	destinationOrder: number;
}): { destination: PaletteItem | null; rows: PaletteItem[] } {
	const capabilities = useDesktopCapabilities();
	const routed = desktopFeatureEnabled(
		capabilities.data,
		"team_bridge_conversations",
	);
	// Read the way the page reads it (`team-bridge-page.tsx`'s `ownerGuard`): the
	// key is not in the `DesktopFeature` union, and a second spelling of the
	// same gate is how the palette and the page would disagree.
	const guarded =
		(capabilities.data?.features?.team_bridge_conversation_owner_guard ?? 0) >=
		1;
	const { accountId } = useTeamBridgeAccount();
	const status = useTeamBridgeStatus(open && routed && guarded);
	const ready =
		open &&
		routed &&
		guarded &&
		Boolean(accountId) &&
		status.data?.account_id === accountId &&
		teamBridgeEligibility(status.data) === null;
	const memberships = useMembershipsQuery({ enabled: ready });
	const hubTenants = hubTenantList(status.data);
	const organizations = useMemo(
		() =>
			ready ? organizationOptions(memberships.memberships, [], hubTenants) : [],
		[ready, memberships.memberships, hubTenants],
	);
	const list = useTeamBridgeConversations(
		TEAM_BRIDGE_ALL_SCOPE,
		ready,
		accountId,
	);
	const tenantIds = useMemo(
		() => organizations.map((organization) => organization.tenantId),
		[organizations],
	);
	const directories = useTeamBridgeDirectories(tenantIds, ready, accountId);
	const unread = useTeamBridgeUnreadView(ready ? accountId : undefined);

	const destination = routed
		? teamBridgeDestinationItem(destinationOrder)
		: null;
	if (!ready || !wantsRows || !accountId || !list.data) {
		return { destination, rows: [] };
	}
	return {
		destination,
		rows: paletteTeamBridgeItems({
			conversations: list.data.conversations,
			directories: directories.members,
			organizations,
			selfAccountId: accountId,
			chiefLabels: chiefLabelCopy(),
			unreadOf: (tenantId, conversationId) =>
				unread.rows.get(teamBridgeUnreadKey(tenantId, conversationId))?.unread,
		}),
	};
}
