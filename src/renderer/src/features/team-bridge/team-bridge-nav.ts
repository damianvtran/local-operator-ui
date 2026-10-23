import { t } from "@shared/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { MessagesSquare } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import { TEAM_BRIDGE_ALL_SCOPE, badgeTotal } from "./team-bridge-model";
import {
	teamBridgeKeys,
	useTeamBridgeStatus,
	useTeamBridgeUnread,
} from "./use-team-bridge";

/**
 * The sidebar descriptor for the Team Bridge row.
 *
 * WHY IT LIVES HERE, NOT IN `sidebar-navigation.tsx`. The Library lane is
 * adding the sidebar's overflow group in that file, and two lanes editing one
 * 1000-line destination list is how a row is lost in a rebase. This module
 * exposes exactly the fields that list already knows how to render
 * (`label`, `path`, `attention`, `attentionName`, `attentionTag`), so the
 * overflow group can spread it in one line and the badge keeps its single
 * source.
 *
 * THE BADGE IS THE OVERFLOW ROW'S, NOT A NEW ROW'S. `attention` is the unmuted
 * unread total (`badgeTotal`); the sidebar's own renderer draws it with the
 * `attention` badge primitive at the row's trailing edge, inside the 30px row,
 * so the More group's collapsed state shows the count without expanding the
 * group and without spending another row. The mark is deliberately the quiet
 * register: a person scanning the rail should see that something is waiting,
 * not a second accent competing with approvals.
 *
 * `enabled` is the capability gate. A backend that does not publish
 * `team_bridge_conversations` is not polled and gets no row at all: a
 * destination whose every call 404s is worse than no destination.
 */
export const TEAM_BRIDGE_PATH = "/team-bridge";
export const TEAM_BRIDGE_TOUR_TAG = "nav-team-bridge";
export const TEAM_BRIDGE_BADGE_TAG = "nav-team-bridge-badge";

export type TeamBridgeNavItem = {
	icon: typeof MessagesSquare;
	label: string;
	path: string;
	tourTag: string;
	attention: number;
	attentionTag: string;
	attentionName: (count: number) => string;
};

export function useTeamBridgeNavItem(
	enabled: boolean,
): TeamBridgeNavItem | null {
	// The badge is the ACCOUNT aggregate, never one org's count: the sidebar
	// asks for "is anything waiting anywhere", which is exactly the single
	// `scope=account` read. The page reads the same cache for its per-org
	// counts, so mounting both costs one request.
	useTeamBridgeStatus(enabled);
	const client = useQueryClient();
	// Bind the read to the OBSERVED status owner, not a separate auth identity.
	// Query observers notify asynchronously: the external-store consistency
	// check also prevents a warm A badge committing after status switched to B.
	const subscribe = useCallback(
		(listener: () => void) =>
			client.getQueryCache().subscribe((event) => {
				// Adding an unread observer can emit during render. Only status data
				// updates change this snapshot; unrelated cache bookkeeping must not
				// synchronously schedule a second Nav render from inside the first.
				if (
					(event.type === "updated" || event.type === "removed") &&
					event.query.queryKey.length === teamBridgeKeys.status.length &&
					event.query.queryKey.every(
						(part: unknown, index: number) =>
							part === teamBridgeKeys.status[index],
					)
				)
					listener();
			}),
		[client],
	);
	const ownerSnapshot = () =>
		client.getQueryData<AgentMessagesStatus>(teamBridgeKeys.status)
			?.account_id ?? undefined;
	const accountId = useSyncExternalStore(
		subscribe,
		ownerSnapshot,
		ownerSnapshot,
	);
	const unread = useTeamBridgeUnread(
		enabled && Boolean(accountId),
		TEAM_BRIDGE_ALL_SCOPE,
		{ accountId },
	);
	if (!enabled) return null;
	// Disabled queries may still expose old cached data. An unresolved identity
	// must never render an old unowned aggregate as an ownership fallback.
	const attention = accountId && unread.data ? badgeTotal(unread.data) : 0;
	return {
		icon: MessagesSquare,
		label: t("ui.teamBridge.nav.label"),
		path: TEAM_BRIDGE_PATH,
		tourTag: TEAM_BRIDGE_TOUR_TAG,
		attention,
		attentionTag: TEAM_BRIDGE_BADGE_TAG,
		attentionName: (count: number) => t("ui.teamBridge.nav.unread", { count }),
	};
}
