/**
 * Add Agent Step Component
 *
 * Sixth step in the onboarding process that allows the user to add recommended
 * AI agents from a curated list.
 */

import { AgentCard } from "@features/agent-hub/components/agent-card";
import { useDownloadAgentMutation } from "@features/agent-hub/hooks/use-download-agent-mutation";
import { usePublicAgentsQuery } from "@features/agent-hub/hooks/use-public-agents-query";
import type { Agent } from "@shared/api/radient/types";
import { Spinner } from "@shared/components/common/spinner";
import { Badge, Button } from "@shared/components/ui";
import { useAgents } from "@shared/hooks/use-agents";
import { cn } from "@shared/lib/utils";
import { CircleCheck, Download } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";

/*
 * Four, not eight.
 *
 * This is the last decision of first run and it was the only screen in the
 * flow that scrolled: eight cards in a 560px dialog is a marketplace, and the
 * step's own copy already points at the Agent Hub for the rest. Four fits
 * without scrolling, which is what makes "pick one and continue" read as the
 * small ask it is.
 */
const RECOMMENDED_AGENT_COUNT = 4;

type CreateAgentStepProps = {
	/** Callback to inform the parent modal about the step's validity */
	onValidityChange: (isValid: boolean) => void;
};

/**
 * Add agent step in the onboarding process. Displays recommended agents to add.
 */
export const CreateAgentStep: FC<CreateAgentStepProps> = ({
	onValidityChange,
}) => {
	const { data: localAgentsData } = useAgents(); // Get local agents to check if added
	const downloadAgentMutation = useDownloadAgentMutation();

	// State to track agents added during this session
	const [addedAgentIds, setAddedAgentIds] = useState<Set<string>>(new Set());
	const [isAddingAll, setIsAddingAll] = useState(false);

	// Fetch recommended public agents (top 8 by download count)
	const {
		data: agentsData,
		isLoading: isLoadingAgents,
		error: agentsError,
	} = usePublicAgentsQuery({
		page: 1,
		perPage: RECOMMENDED_AGENT_COUNT,
		sort: "download_count",
		order: "desc",
	});

	const recommendedAgents: Agent[] = useMemo(
		() => agentsData?.records ?? [],
		[agentsData],
	);

	// Update addedAgentIds based on localAgentsData changes
	useEffect(() => {
		// Ensure localAgentsData and its 'agents' property exist
		if (localAgentsData?.agents) {
			const localIds = new Set(localAgentsData.agents.map((agent) => agent.id));
			// Filter recommended agents to find those already present locally
			const newlyAdded = recommendedAgents
				.filter((agent) => localIds.has(agent.id))
				.map((agent) => agent.id);

			// Update state, preserving any agents added *during this step*
			// that might not yet be reflected in localAgentsData if query hasn't refetched
			setAddedAgentIds((prev) => new Set([...prev, ...newlyAdded]));
		}

		// Add agent ID to state upon successful download
		if (
			downloadAgentMutation.isSuccess &&
			downloadAgentMutation.variables?.agentId
		) {
			setAddedAgentIds((prev) =>
				new Set(prev).add(downloadAgentMutation.variables.agentId),
			);
		}
	}, [
		localAgentsData,
		recommendedAgents,
		downloadAgentMutation.isSuccess,
		downloadAgentMutation.variables?.agentId, // Depend on the specific agentId from variables
	]);

	const handleAddRecommended = async () => {
		if (isAddingAll || downloadAgentMutation.isPending) return;
		setIsAddingAll(true);
		// Filter agents that are not already added locally or in the process of being added
		const agentsToAdd = recommendedAgents.filter(
			(agent) => !addedAgentIds.has(agent.id),
		);

		// Downloads run one at a time: the backend writes each agent to disk, and a
		// parallel burst here produced interleaved writes rather than faster setup.
		try {
			for (const agent of agentsToAdd) {
				// Check again inside the loop in case it was added individually
				if (
					!addedAgentIds.has(agent.id) &&
					downloadAgentMutation.variables?.agentId !== agent.id // Ensure not currently adding this one
				) {
					try {
						// Use the mutation from AgentCard's hook, passing the correct object
						await downloadAgentMutation.mutateAsync({
							agentId: agent.id,
							agentName: agent.name, // Pass name for potential use by mutation
						});
						// Update state immediately after successful mutation for this agent
						setAddedAgentIds((prev) => new Set(prev).add(agent.id));
					} catch (agentErr) {
						console.error(`Failed to download agent ${agent.name}:`, agentErr);
						// One failed agent does not stop the rest
					}
				}
			}
		} catch (err) {
			// This catch block might be less likely to be hit with individual try/catches
			console.error("Failed to add all recommended agents:", err);
		} finally {
			setIsAddingAll(false);
		}
	};

	const hasAddedAgents = addedAgentIds.size > 0;

	// Effect to notify parent about validity change
	useEffect(() => {
		onValidityChange(hasAddedAgents);
	}, [hasAddedAgents, onValidityChange]);

	const allAdded =
		recommendedAgents.length > 0 &&
		recommendedAgents.every((agent) => addedAgentIds.has(agent.id));

	return (
		<div className="flex flex-col gap-5">
			{/* Description and the bulk action on one row: the button is an
			    alternative to reading the list, so it belongs beside the sentence
			    that offers it rather than centred on a line of its own. */}
			<div className="flex flex-wrap items-start justify-between gap-3">
				<p className="min-w-60 flex-1 text-body text-ink-muted">
					Pick an agent to start with, or add the popular ones as a set. More
					are in the Agent hub whenever you want them.
				</p>
				<Button
					variant="secondary"
					onClick={handleAddRecommended}
					disabled={isLoadingAgents || isAddingAll || allAdded}
				>
					{isAddingAll ? (
						<Spinner size="sm" />
					) : (
						<Download aria-hidden="true" />
					)}
					{isAddingAll ? "Adding" : allAdded ? "All added" : "Add all four"}
				</Button>
			</div>

			{isLoadingAgents && (
				<div className="flex h-60 items-center justify-center">
					<Spinner size="lg" label="Loading recommended agents" />
				</div>
			)}

			{agentsError && (
				<div className="flex h-60 flex-col items-center justify-center gap-1 text-center">
					<p className="text-body-sm text-ink">
						The recommended agents could not be loaded.
					</p>
					<p className="text-ink-dim text-meta">
						Continue without one and add agents later from the Agent hub.
					</p>
				</div>
			)}

			{!isLoadingAgents && !agentsError && (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{recommendedAgents.length === 0 ? (
						<p className="text-center text-body-sm text-ink-muted sm:col-span-2">
							No recommended agents right now. Continue, and add agents later
							from the Agent hub.
						</p>
					) : (
						recommendedAgents.map((agent) => {
							const isAdded = addedAgentIds.has(agent.id);
							const isDownloading =
								downloadAgentMutation.isPending &&
								downloadAgentMutation.variables?.agentId === agent.id;

							return (
								<div
									key={agent.id}
									className={cn(
										"relative transition-colors duration-base ease-out-quart",
										/* An added agent is done, not faded out: it keeps full
										   contrast and says so with the badge. Dimming it with
										   opacity would drag the card's ground with it. */
										isAdded && "pointer-events-none",
									)}
								>
									<AgentCard
										agent={agent}
										isLiked={false}
										isFavourited={false}
										onLikeToggle={() => {}}
										onFavouriteToggle={() => {}}
										showActions={false}
									/>
									{isDownloading && (
										<div className="absolute inset-0 flex items-center justify-center">
											<Spinner size="md" label={`Adding ${agent.name}`} />
										</div>
									)}
									{isAdded && (
										<Badge variant="success" className="absolute top-3 right-3">
											<CircleCheck aria-hidden="true" />
											Added
										</Badge>
									)}
								</div>
							);
						})
					)}
				</div>
			)}
		</div>
	);
};
