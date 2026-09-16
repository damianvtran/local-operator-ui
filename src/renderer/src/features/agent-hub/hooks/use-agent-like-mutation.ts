import { likeAgent, unlikeAgent } from "@shared/api/radient/agents-api";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchAgentStatus } from "./use-agent-statuses-query";
import { patchPublicAgentCount } from "./use-public-agent-counts";

type UseAgentLikeMutationParams = {
	agentId: string;
	isCurrentlyLiked: boolean;
};

/**
 * Like or unlike one agent.
 *
 * Two things follow from the batched reads this pairs with:
 *
 *  - the viewer's new state is patched into the status cache from this
 *    response rather than invalidated, so a toggle costs zero further
 *    requests — the page's status map was ONE call, and refetching it to learn
 *    a boolean we just learned would give the batching back;
 *  - the count beside the heart lives on the list record, so it is moved by the
 *    delta this toggle implies. `already_liked` is read rather than assumed:
 *    the upstream answers 200 with that flag when the agent was already liked,
 *    where nothing changed and a bump would be a lie. (`unlike` is the
 *    asymmetric half — it answers 403 when there is no like to remove, so it
 *    never reports a no-op success.)
 */
export const useAgentLikeMutation = () => {
	const queryClient = useQueryClient();
	const { isAuthenticated } = useRadientAuth();

	const mutation = useMutation<
		{ liked: boolean; changed: boolean },
		Error,
		UseAgentLikeMutationParams
	>({
		mutationFn: async ({ agentId, isCurrentlyLiked }) => {
			if (!isAuthenticated) {
				throw new Error("Authentication required to like/unlike an agent.");
			}
			if (!agentId) {
				throw new Error("Agent ID is required.");
			}

			if (isCurrentlyLiked) {
				await unlikeAgent(agentId);
				return { liked: false, changed: true };
			}
			const response = await likeAgent(agentId);
			const result = response.result as { already_liked?: boolean } | undefined;
			return { liked: true, changed: !result?.already_liked };
		},
		onSuccess: ({ liked, changed }, variables) => {
			patchAgentStatus(queryClient, variables.agentId, { liked });
			if (changed) {
				patchPublicAgentCount(queryClient, {
					agentId: variables.agentId,
					field: "like_count",
					delta: liked ? 1 : -1,
				});
			}
		},
	});

	return mutation;
};
