import { t } from "@shared/i18n";
import { MessagesSquare } from "lucide-react";
import { requestsWaitingLabel } from "./team-bridge-approvals-model";
import { TEAM_BRIDGE_ALL_SCOPE } from "./team-bridge-model";
import { useTeamBridgeAccount } from "./team-bridge-owner";
import { useTeamBridgeUnreadView } from "./team-bridge-unread-sync";
import { useTeamBridgeStatus, useTeamBridgeUnread } from "./use-team-bridge";
import { useApprovalRequests } from "./use-team-bridge-approvals";

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
 * unread total (the shared view's `total`); the sidebar's own renderer draws it with the
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

/** The query parameter that opens the Team Bridge page on its Requests view. */
export const TEAM_BRIDGE_REQUESTS_VIEW_PARAM = "view";
export const TEAM_BRIDGE_REQUESTS_PATH = `${TEAM_BRIDGE_PATH}?${new URLSearchParams({ [TEAM_BRIDGE_REQUESTS_VIEW_PARAM]: "requests" })}`;
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
	const { accountId } = useTeamBridgeAccount();
	const status = useTeamBridgeStatus(enabled);
	const ready =
		enabled && Boolean(accountId) && status.data?.account_id === accountId;
	const unread = useTeamBridgeUnread(ready, TEAM_BRIDGE_ALL_SCOPE, {
		accountId,
	});
	/*
	 * THE SAME NUMBER THE RAIL SHOWS. The aggregate read above keeps the badge
	 * polled; the count itself is the shared unread view, which merges that
	 * aggregate with the per-conversation rows the rail renders, so the badge
	 * cannot claim unread that no row shows (see `team-bridge-unread-sync.ts`).
	 */
	const view = useTeamBridgeUnreadView(ready ? accountId : undefined);
	/*
	 * APPROVAL REQUESTS OUTRANK UNREAD IN THE ONE BADGE SLOT. A request is a
	 * teammate's agent blocked on this person's answer; an unread message is
	 * not blocked on anything. The row has one trailing badge (the sidebar's
	 * one-fact-per-slot rule), so while any request waits the badge counts
	 * requests and the row's name says "N requests waiting" (spec
	 * request.badge); with none it falls back to the unread total as before.
	 * `pending_count` is the DECIDABLE rows only, the ones a person can act on.
	 */
	const requests = useApprovalRequests(ready);
	if (!enabled) return null;
	const waiting = ready ? (requests.data?.pending_count ?? 0) : 0;
	// Disabled observers can still expose cached data: unresolved auth is zero.
	const unreadTotal = ready && unread.data ? view.total : 0;
	return {
		icon: MessagesSquare,
		label: t("ui.teamBridge.nav.label"),
		/*
		 * The badge and the landing agree (UX review U1): while the badge counts
		 * requests, the row opens Requests -> Waiting, not the conversations a
		 * person would have to leave to find them. The page consumes `view` once
		 * and clears it (`TEAM_BRIDGE_REQUESTS_VIEW_PARAM`).
		 */
		path: waiting > 0 ? TEAM_BRIDGE_REQUESTS_PATH : TEAM_BRIDGE_PATH,
		tourTag: TEAM_BRIDGE_TOUR_TAG,
		attention: waiting > 0 ? waiting : unreadTotal,
		attentionTag: TEAM_BRIDGE_BADGE_TAG,
		attentionName: (count: number) => {
			const label = waiting > 0 ? requestsWaitingLabel(count) : null;
			return label
				? t("ui.teamBridge.approvals.nav_name", { label })
				: t("ui.teamBridge.nav.unread", { count });
		},
	};
}
