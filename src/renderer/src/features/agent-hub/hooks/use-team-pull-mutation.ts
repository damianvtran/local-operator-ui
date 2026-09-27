/**
 * Pulling one published organization team into this machine's local registry
 * (design §4.5/§8.4's "list + pull action").
 *
 * The pull is the ONLY action the team surface owns in v1, and it is the agent
 * pull's shape one document family over: the local server reads the published
 * document with the credential the backend already holds and reconstructs it
 * through the registry's own import, which is what reports a rename. So the
 * reporting here follows `use-download-agent-mutation` — the toast names what
 * was actually STORED, never what was requested.
 *
 * ## The failure is the caller's, as it is on the agent pull
 *
 * This hook announces the success and nothing else: `mutation.error` is left for
 * the surface that owns the button to render beside it. The hub has one error
 * language (the surface), and a toast for a refusal that is also on screen says
 * the same thing twice.
 */

import { AgentsApi } from "@shared/api/local-operator/agents-api";
import { apiConfig } from "@shared/config";
import {
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export type TeamPullVariables = {
	/** The HUB document's id — what was published, not a local row's id. */
	teamId: string;
	/** The organization the caller believes owns it, when known (§4.5). */
	tenantId?: string;
	/** The published name, for the one sentence this pull shows before it knows more. */
	name?: string;
};

export const useTeamPullMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ teamId, tenantId }: TeamPullVariables) => {
			if (!apiConfig.baseUrl) {
				throw new Error("Local Operator API URL is not configured.");
			}
			return AgentsApi.pullOrgTeamFromRadient(
				apiConfig.baseUrl,
				teamId,
				tenantId,
			);
		},
		onSuccess: (data, variables) => {
			const stored = data.result;
			const storedName =
				stored?.name?.trim() || variables.name?.trim() || "Team";
			const renamedFrom = stored?.renamed_from?.trim() || null;
			const invalidName = stored?.invalid_name?.trim() || null;

			if (renamedFrom) {
				showSuccessToast(
					`Pulled "${storedName}" — you already have a team called "${renamedFrom}".`,
				);
			} else if (invalidName) {
				/*
				 * The published name broke the LOCAL rules, so the registry replaced
				 * it. Reported as a warning rather than a success: the user asked for a
				 * name and got another, which is the same class of news as a rename.
				 */
				showWarningToast(
					`Pulled "${storedName}". The published name "${invalidName}" is not usable locally, so the team was stored under "${storedName}".`,
				);
			} else {
				showSuccessToast(`Pulled team "${storedName}".`);
			}

			// The local team registry is what the rest of the app reads (`useTeams`,
			// keyed `["desktop", "teams"]`), and a pull changes it — the same
			// invalidation the agent pull performs on its own list. The published roster
			// is unchanged by a pull, so the org team list is deliberately not
			// invalidated.
			queryClient.invalidateQueries({ queryKey: ["desktop", "teams"] });
		},
		onError: (error) => {
			console.error("Pulling an organization team failed:", error);
		},
	});
};
