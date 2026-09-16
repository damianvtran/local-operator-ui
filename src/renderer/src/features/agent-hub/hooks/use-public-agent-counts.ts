import type {
	PaginatedAgentList,
	RadientApiResponse,
} from "@shared/api/radient/types";
import type { QueryClient } from "@tanstack/react-query";
import { publicAgentKeys } from "./use-public-agents-query";

/**
 * Move one count on every cached page of the public list.
 *
 * The three counts a hub card prints ride the list record, so they are only as
 * fresh as the list. When the viewer likes, favourites or downloads an agent,
 * that number is the one thing on the card the viewer just changed, and
 * letting it sit still until the five-minute `staleTime` expires reads as the
 * click having failed. Patching the delta is what makes the count move without
 * a second list request; the next real fetch of the list replaces it with the
 * server's own number.
 *
 * A record the delta does not belong to is left alone, and a count never goes
 * below zero: both are cases a page fetched between the action and here can
 * produce, and a negative download count on a card is a worse answer than a
 * stale one.
 */
export const patchPublicAgentCount = (
	queryClient: QueryClient,
	{
		agentId,
		field,
		delta,
	}: {
		agentId: string;
		field: "like_count" | "favourite_count" | "download_count";
		delta: number;
	},
) => {
	queryClient.setQueriesData<RadientApiResponse<PaginatedAgentList>>(
		{ queryKey: publicAgentKeys.all },
		(previous) => {
			if (!previous) return previous;
			const records = previous.result?.records ?? [];
			if (!records.some((record) => record.id === agentId)) return previous;
			return {
				...previous,
				result: {
					...previous.result,
					records: records.map((record) =>
						record.id === agentId
							? { ...record, [field]: Math.max(0, (record[field] ?? 0) + delta) }
							: record,
					),
				},
			};
		},
	);
};
