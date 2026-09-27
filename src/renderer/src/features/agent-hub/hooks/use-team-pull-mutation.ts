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
 *
 * ## The wire shape is a CONTRACT, not a guess (QA round 1, Q-1)
 *
 * The first revision of this hook read `invalid_name` as the offending NAME and
 * called `.trim()` on it. The route sends a BOOLEAN flag (local-operator
 * `teams.py`'s `TeamImportOutcome`), so every successful pull threw a TypeError
 * inside the success handler, showed the minified message in the roster's error
 * slot and dropped the toast — the pull had landed, and the UI said it had
 * failed. The lesson is recorded here rather than only in the fix: a field's
 * TYPE is part of the wire contract, and the sentence built from it belongs in a
 * pure function that a test can reach without a mounted mutation.
 */

import { AgentsApi } from "@shared/api/local-operator/agents-api";
import { apiConfig } from "@shared/config";
import {
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { describePulledTeam } from "../team-pull-report";

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
			/*
			 * The report comes from the wire's own fields, and the wire shape is the
			 * defect this reads around (Q-1): `invalid_name` is a boolean flag, so it is
			 * read as one and the name to quote comes from `renamed_from`. Every sentence
			 * below is derived locally from those two fields; nothing is inferred from a
			 * field the server does not send.
			 */
			const report = describePulledTeam(data.result, variables.name);
			if (report.level === "warning") {
				showWarningToast(report.message);
			} else {
				showSuccessToast(report.message);
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
