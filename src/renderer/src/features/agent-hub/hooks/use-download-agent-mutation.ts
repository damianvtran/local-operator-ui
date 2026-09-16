import { localNameCollision } from "@features/agents/utils/publication-validation";
import { AgentsApi } from "@shared/api/local-operator/agents-api";
import type {
	AgentDetails,
	AgentListResult,
	CRUDResponse,
} from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config"; // Import apiConfig for the base URL
import { agentsQueryKey } from "@shared/hooks/use-agents";
import {
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import {
	type QueryClient,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { patchPublicAgentCount } from "./use-public-agent-counts";

/**
 * A pulled agent as the import path reports it.
 *
 * `renamed_from` is the backend's own note about a name it had to change on the
 * way in (contract §3.6): the pulled agent landed as `<name>-2` because the local
 * registry already held `<name>` under the same `name_key`. It is optional
 * because a backend older than that fix sends nothing, and this hook must be
 * honest in BOTH states rather than assume the better one — which is what the
 * cache-based arm below is for.
 */
type PulledAgent = AgentDetails & {
	renamed_from?: string;
};

/**
 * The names of the agents already on this machine, from the query cache.
 *
 * From the cache rather than from a fresh request on purpose. The pull is on the
 * click path and the local list is already loaded by every surface that shows
 * one; a request here would add a round trip to a download for a warning, and the
 * warning is a courtesy either way — the rename that removes the ambiguity is the
 * backend's (§3.6, PR-1). What this buys is that a duplicate is not reported as a
 * clean success: the user is told the name is now held twice, which is the
 * silent-shadowing state the local lookup's case-sensitivity creates.
 */
const cachedLocalNames = (
	queryClient: QueryClient,
	excludeAgentId: string | undefined,
): string[] => {
	const names: string[] = [];
	for (const [, data] of queryClient.getQueriesData<AgentListResult>({
		queryKey: agentsQueryKey,
	})) {
		for (const agent of data?.agents ?? []) {
			if (agent.id !== excludeAgentId) names.push(agent.name);
		}
	}
	return names;
};

/**
 * React Query mutation hook for downloading an agent from the hub.
 *
 * Navigates to the chat for the downloaded agent on success, and every message
 * it shows names what was actually created:
 *
 * - **downloaded** — the returned name, not the requested one, so an agent the
 *   backend had to rename is reported under the name it now has;
 * - **downloaded under an adjusted name** — when the backend says so
 *   (`renamed_from`), with the name it collided with quoted;
 * - **downloaded beside a name already held** — when it does NOT say so but this
 *   machine's own list shows the name is now held twice, said plainly as the
 *   duplicate it is, because the profile resolver picks between rows with one
 *   name by nothing the user can see;
 * - **refused** — left on `mutation.error` for the caller to render, carrying the
 *   backend's own sentence; see below.
 *
 * THE FAILURE IS THE CALLER'S. This hook used to raise an error toast and
 * nothing else, which made the hub the only feature that spoke two error
 * languages: reads failed into the surface, mutations failed into a toast that
 * floated over whatever was next. The card and the details page now render
 * `mutation.error` inline beside the control that failed, so this hook reports
 * and does not announce — the component that owns the button owns the sentence.
 *
 * @returns Mutation result object for downloading an agent.
 */
export const useDownloadAgentMutation = () => {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const mutation = useMutation<
		CRUDResponse<AgentDetails>, // Type of data returned by mutationFn
		Error, // Type of error
		{ agentId: string; agentName?: string } // Type of variables passed to mutate
	>({
		mutationFn: async ({ agentId }) => {
			if (!apiConfig.baseUrl) {
				throw new Error("Local Operator API URL is not configured.");
			}
			// Call the API method from local-operator/agents-api using the static config
			return AgentsApi.downloadAgentFromRadient(apiConfig.baseUrl, agentId);
		},
		onSuccess: (data, variables) => {
			const installed = data.result as PulledAgent | undefined;
			const installedName =
				installed?.name?.trim() || variables.agentName?.trim() || "Agent";
			const renamedFrom = installed?.renamed_from?.trim() || null;
			const collision = installed?.id
				? localNameCollision(
						installedName,
						cachedLocalNames(queryClient, installed.id),
					)
				: null;

			if (renamedFrom) {
				showSuccessToast(
					`Downloaded "${installedName}" — you already have an agent called "${renamedFrom}".`,
				);
			} else if (collision) {
				showWarningToast(
					`Downloaded "${installedName}". You already have an agent called "${collision}", so two agents now answer to that name and either may be picked. Rename one of them.`,
				);
			} else {
				showSuccessToast(`Downloaded "${installedName}" from the hub.`);
			}

			// Invalidate local agents list to reflect the newly downloaded agent
queryClient.invalidateQueries({ queryKey: agentsQueryKey });
			// The hub record's own count, moved by the delta the server just
			// applied; there is no per-card count query left to invalidate.
			patchPublicAgentCount(queryClient, {
				agentId: variables.agentId,
				field: "download_count",
				delta: 1,
			});

			const agentResult = data.result; // Capture result

			if (agentResult?.id) {
				// The created row's own id, so the chat that opens is the agent that
				// was created — under whatever name it actually has.
				navigate(`/chat/${agentResult.id}`);
			} else {
				console.warn(
					"Downloaded agent ID not found in response, cannot navigate to chat.",
				);
			}
		},
	});

	return mutation;
};
