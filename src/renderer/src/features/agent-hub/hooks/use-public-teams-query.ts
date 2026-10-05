/**
 * The public hub's team catalogue: the list, and one team's brief.
 *
 * ## Two reads, two keys, one prefix
 *
 * `publicTeamKeys.list` and `publicTeamKeys.detail` hang off one `all` prefix so
 * a caller can reach every cache entry this surface owns — the roster is what a
 * pull changes nothing about (a pull writes the LOCAL registry, not the hub), so
 * nothing here invalidates on it, but the prefix is what keeps a future
 * invalidator from guessing a page's shape.
 *
 * ## The filters the hub does not have
 *
 * The public listing implements page and page size ONLY: `name`, `description`,
 * `search` and `sort` are all ignored server-side (measured against the live hub
 * on 2026-10-05 — every one of them returns the same page). So this hook takes
 * no filter arguments: the search box filters the rows the query has already
 * fetched, in the component, and the copy names the bound rather than implying a
 * catalogue-wide search. When the hub grows a server-side search, the filter
 * belongs in the key AND the request, decided by the same expression.
 *
 * ## The retry policy, for a transport the desktop does not own
 *
 * `retryDesktopQuery` is about `DesktopControlError` (a status of `null` means
 * the desktop server never answered, and the hub's own answer is worth one more
 * attempt). This read goes straight to the hub, so the same rule is restated
 * over {@link PublicHubError}: one more attempt for a server that answered with
 * a failure, and none for a refusal the caller cannot fix by asking again.
 */

import {
	PublicHubError,
	getPublicTeam,
	listPublicTeams,
} from "@shared/api/radient/agents-api";
import type {
	HubTeam,
	HubTeamResult,
	HubTeamRow,
	PaginatedTeamList,
	RadientApiResponse,
} from "@shared/api/radient/types";
import { apiConfig } from "@shared/config";
import { useQuery } from "@tanstack/react-query";

/** The hub's own page size for this surface, the agent grid's number. */
export const PUBLIC_TEAMS_PER_PAGE = 12;

export const publicTeamKeys = {
	all: ["public-teams"] as const,
	list: (page: number, perPage: number) =>
		[...publicTeamKeys.all, "list", { page, perPage }] as const,
	detail: (teamId: string) =>
		[...publicTeamKeys.all, "detail", teamId] as const,
};

/**
 * One more attempt for an answer, none for a read that never got one.
 *
 * The hub's failure is worth a second ask; a transport failure is not (that is
 * the desktop policy's own reading, applied to this transport), and neither is a
 * 4xx, which the same request will be refused with again.
 */
export const retryPublicHubQuery = (
	failureCount: number,
	error: Error,
): boolean => {
	if (error instanceof PublicHubError && error.status !== null) {
		return error.status >= 500 && failureCount < 1;
	}
	return failureCount < 1;
};

export const usePublicTeamsQuery = ({
	page = 1,
	perPage = PUBLIC_TEAMS_PER_PAGE,
	enabled = true,
}: {
	page?: number;
	perPage?: number;
	enabled?: boolean;
} = {}) => {
	const query = useQuery<
		RadientApiResponse<PaginatedTeamList>,
		Error,
		PaginatedTeamList
	>({
		queryKey: publicTeamKeys.list(page, perPage),
		queryFn: () => listPublicTeams(apiConfig.radientBaseUrl, page, perPage),
		select: (data) => data.result,
		enabled,
		retry: retryPublicHubQuery,
		// The hub list's own courtesy window, and the deliberately-off focus
		// refetch the agent list keeps: both lists sit on one page, so a focus
		// refetch here would be the second wave that change removed.
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		refetchOnWindowFocus: false,
		/*
		 * The previous page stays on screen while the next one loads, so a page
		 * change does not empty the roster to a spinner. `keepPreviousData`'s own
		 * rule — never carry records across a scope — has no second scope here:
		 * this key is the one read, and both halves of it move together.
		 */
		placeholderData: (previousData) => previousData,
	});

	return {
		...query,
		teams: (query.data?.records ?? []) as HubTeamRow[],
		/** True while a NEW page is in flight over data already shown. */
		isRefreshing: query.isFetching && query.data !== undefined,
		pagination: query.data
			? {
					page: query.data.page,
					perPage: query.data.per_page,
					totalPages: query.data.total_pages,
					totalRecords: query.data.total_records,
				}
			: undefined,
	};
};

/**
 * One public team's full document — the brief the LIST form omits.
 *
 * Disabled until a row is opened (`teamId` undefined), because the list row
 * already carries everything the roster line paints and this read exists for the
 * collaboration and project briefs.
 */
export const usePublicTeamQuery = ({
	teamId,
	enabled = true,
}: {
	teamId: string | undefined;
	enabled?: boolean;
}) => {
	const query = useQuery<RadientApiResponse<HubTeamResult>, Error, HubTeam>({
		queryKey: publicTeamKeys.detail(teamId ?? ""),
		queryFn: () => getPublicTeam(apiConfig.radientBaseUrl, teamId as string),
		select: (data) => data.result.team,
		enabled: enabled && !!teamId,
		retry: retryPublicHubQuery,
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		refetchOnWindowFocus: false,
		// A refused or failed detail read is not re-issued by a remount: the row
		// stays open with its own retry, and `retryOnMount` would re-ask the same
		// question every time a reader re-opened it.
		retryOnMount: false,
	});

	return { ...query, team: query.data };
};
