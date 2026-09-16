import {
	favouriteAgent,
	unfavouriteAgent,
} from "@shared/api/radient/agents-api";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchPublicAgentCount } from "./use-public-agent-counts";
import { patchAgentStatus } from "./use-agent-statuses-query";

type UseAgentFavouriteMutationParams = {
	agentId: string;
	isCurrentlyFavourited: boolean;
};

/**
 * Favourite or unfavourite one agent.
 *
 * Patches the batched status map and the list record's count instead of
 * invalidating per-card queries, which is the other half of the fan-out this
 * change removes; see `use-agent-like-mutation` for why `already_favourited` is
 * read rather than assumed.
 */
export const useAgentFavouriteMutation = () => {
	const queryClient = useQueryClient();
	const { isAuthenticated } = useRadientAuth();

	const mutation = useMutation<
		{ favourited: boolean; changed: boolean },
		Error,
		UseAgentFavouriteMutationParams
	>({
		mutationFn: async ({ agentId, isCurrentlyFavourited }) => {
			if (!isAuthenticated) {
				throw new Error(
					"Authentication required to favourite/unfavourite an agent.",
				);
			}
			if (!agentId) {
				throw new Error("Agent ID is required.");
			}

			if (isCurrentlyFavourited) {
				await unfavouriteAgent(agentId);
				return { favourited: false, changed: true };
			}
			const response = await favouriteAgent(agentId);
			const result = response.result as
				| { already_favourited?: boolean }
				| undefined;
			return { favourited: true, changed: !result?.already_favourited };
		},
		onSuccess: ({ favourited, changed }, variables) => {
			patchAgentStatus(queryClient, variables.agentId, { favourited });
			if (changed) {
				patchPublicAgentCount(queryClient, {
					agentId: variables.agentId,
					field: "favourite_count",
					delta: favourited ? 1 : -1,
				});
			}
		},
	});

	return mutation;
};
