/**
 * @file use-publish-agent.ts
 * @description The publish and republish mutation for one local agent.
 *
 * Two operations, one hook, because they are one user decision: publish this
 * instruction set, either as a new listing or over the one this agent was
 * published as. Which of the two runs is decided by whether the caller knows the
 * hub listing id — and the caller only knows it from
 * `published-listings-store`, which is written here on the way back from an
 * accepted publication.
 *
 * No toast, deliberately. Every outcome is rendered where the decision was made:
 * a refusal in the dialog, with the field and the next step §6.2 assigns it, and
 * a success as the dialog's own confirmation. A toast for a refusal that is
 * already on screen in the dialog says the same thing twice, and — worse — the
 * toast manager collapses two identical messages inside a five-second cooldown,
 * so two DIFFERENT refusals that happened to share a sentence would arrive as one
 * and read as a single problem.
 */

import type { PublicationDocumentOverride } from "@shared/api/local-operator/agents-api";
import { AgentsApi } from "@shared/api/local-operator/agents-api";
import { apiConfig } from "@shared/config";
import { usePublishedListingsStore } from "@shared/store/published-listings-store";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export type PublishAgentRequest = {
	/** The local agent whose instruction set is being published. */
	agentId: string;
	/**
	 * The content fields the dialog is overriding.
	 *
	 * Omitted fields are read from the local row, which is where the instruction
	 * body lives. The name travels here when the user changed it, which is the
	 * recovery for every refusal about the name.
	 */
	document?: PublicationDocumentOverride;
	/**
	 * The hub listing to update, when this agent has been published before.
	 *
	 * Present means "republish"; absent means "publish a new listing". The backend
	 * requires it on the update path precisely so a caller cannot overwrite a row
	 * by guessing, so this hook never invents one.
	 */
	hubAgentId?: string | null;
};

export const usePublishAgent = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			agentId,
			document,
			hubAgentId,
		}: PublishAgentRequest) => {
			if (!apiConfig.baseUrl) {
				throw new Error("Local Operator API URL is not configured.");
			}
			return hubAgentId
				? AgentsApi.republishAgentInstructionSet(
						apiConfig.baseUrl,
						agentId,
						hubAgentId,
						document,
					)
				: AgentsApi.publishAgentInstructionSet(
						apiConfig.baseUrl,
						agentId,
						document,
					);
		},
		onSuccess: (response, variables) => {
			const listing = response.result;
			if (listing?.agent_id) {
				// The only place the local-row-to-listing link is ever established.
				usePublishedListingsStore.getState().remember(variables.agentId, {
					hubAgentId: listing.agent_id,
					name: listing.name,
					publishedAt: new Date().toISOString(),
				});
			}
			/*
			 * The hub's own list is cached for five minutes, so without this the agent
			 * the user just published is invisible until the tab is reloaded — which
			 * reads as a publish that silently failed.
			 */
			queryClient.invalidateQueries({
				queryKey: ["public-agents"],
			});
		},
		onError: (error) => {
			// Logged, not toasted: the dialog renders the refusal, and the message it
			// renders is the same one this records for whoever reads the console.
			console.error("Publishing an agent to the hub failed:", error);
		},
	});
};
