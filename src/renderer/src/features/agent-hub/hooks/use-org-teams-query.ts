/**
 * The teams published into one organization's workspace (design §4.5/§8.4).
 *
 * The list form of the hub team document omits each team's brief, so this is
 * what the hub page's roster line renders from — a name, the project it belongs
 * to, and the member slots it declares. The brief itself arrives with the pull,
 * through `org_team.get`.
 *
 * `tenantId` is REQUIRED rather than optional: `org_teams.list` is the org
 * workspace's route, and there is no "all teams" read on the wire. A caller with
 * no tenant has nothing to ask for, which is why the query is disabled rather
 * than issued without one.
 */

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { listOrgTeams } from "@shared/api/radient/agents-api";
import type { HubTeam, HubTeamsResult } from "@shared/api/radient/types";
import { useQuery } from "@tanstack/react-query";

export const orgTeamKeys = {
	all: ["org-teams"] as const,
	list: (tenantId: string) => [...orgTeamKeys.all, "list", tenantId] as const,
};

export const useOrgTeamsQuery = ({
	tenantId,
	enabled = true,
}: {
	tenantId: string | undefined;
	enabled?: boolean;
}) => {
	const query = useQuery<HubTeamsResult, Error>({
		queryKey: orgTeamKeys.list(tenantId ?? ""),
		queryFn: async () => {
			const response = await listOrgTeams(tenantId as string);
			return response.result ?? { teams: [] };
		},
		enabled: enabled && !!tenantId,
		// The hub list's own courtesy window, and its deliberately-off focus
		// refetch: this read sits on the same page as the agent list, so a focus
		// refetch here would be the second wave that change removed.
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		refetchOnWindowFocus: false,
		/*
		 * A REFUSED OR FAILED READ IS NOT RE-ISSUED BY A REMOUNT (QA round 1, Q1).
		 * The page observes this key for the tab's count and the roster observes it
		 * again when the Teams tab opens; an errored query holds no data, so React
		 * Query treats the second mount as a reason to refetch, and - because it has
		 * no data to keep on screen - flips the query back to `pending` while it
		 * does. That cost two reads (the second being `retryDesktopQuery`'s retry)
		 * per Teams open on an org already known to refuse, AND flashed the roster's
		 * skeleton over the refusal it had just shown (the plan-lapsed frame was
		 * photographed mid-flash). The refusal is a state the viewer sits in until an
		 * owner acts, and "Try again" refetches explicitly, so the remount does not.
		 */
		retryOnMount: false,
		retry: retryDesktopQuery,
	});

	return {
		...query,
		teams: (query.data?.teams ?? []) as HubTeam[],
	};
};
