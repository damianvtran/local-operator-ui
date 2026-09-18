import { agentActionFailureMessage } from "@features/agents/utils/publication-failure";
import type { Agent, AgentViewerStatus } from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import type React from "react";
import { useState } from "react";
import { useAgentFavouriteMutation } from "../hooks/use-agent-favourite-mutation";
import { useAgentLikeMutation } from "../hooks/use-agent-like-mutation";
import { useDownloadAgentMutation } from "../hooks/use-download-agent-mutation";
import { AgentCard } from "./agent-card";

type AgentCardContainerProps = {
	agent: Agent;
	/**
	 * The viewer's relationship to this agent, read once for the whole page by
	 * `useAgentStatusesQuery` and passed down.
	 */
	status?: AgentViewerStatus;
	/**
	 * Whether that read actually ANSWERED this agent's state.
	 *
	 * False when the viewer is signed out, when the batched read failed, and when
	 * it answered without an entry for this id — three different causes with one
	 * consequence here: the card has no viewer state to show, and says so rather
	 * than rendering an unfilled heart, which would state "you have not liked
	 * this" about every card on the page from one failed request. The card's
	 * COUNTS are unaffected: they come from the list record, not from this read.
	 */
	viewerStateKnown?: boolean;
};

/**
 * Container for AgentCard: owns this card's mutations and the sentence for
 * whichever of them last failed.
 *
 * It no longer reads status or counts per card. Both came from one query per
 * card per viewer, which is what made a twelve-card page cost sixty requests
 * when signed in; the page reads them once and hands them down.
 */
export const AgentCardContainer: React.FC<AgentCardContainerProps> = ({
	agent,
	status,
	viewerStateKnown = true,
}) => {
	const { isAuthenticated } = useRadientAuth();
	const [failedAction, setFailedAction] = useState<
		"like" | "favourite" | "download" | null
	>(null);

	const isLiked = status?.liked ?? false;
	const isFavourited = status?.favourited ?? false;

	const likeMutation = useAgentLikeMutation();
	const favouriteMutation = useAgentFavouriteMutation();
	const downloadMutation = useDownloadAgentMutation();

	const handleLikeToggle = () => {
		if (!isAuthenticated || likeMutation.isPending) return;
		setFailedAction(null);
		likeMutation.mutate(
			{ agentId: agent.id, isCurrentlyLiked: isLiked },
			{ onError: () => setFailedAction("like") },
		);
	};

	const handleFavouriteToggle = () => {
		if (!isAuthenticated || favouriteMutation.isPending) return;
		setFailedAction(null);
		favouriteMutation.mutate(
			{ agentId: agent.id, isCurrentlyFavourited: isFavourited },
			{ onError: () => setFailedAction("favourite") },
		);
	};

	const handleDownload = () => {
		if (downloadMutation.isPending) return;
		setFailedAction(null);
		downloadMutation.mutate(
			{ agentId: agent.id, agentName: agent.name },
			{ onError: () => setFailedAction("download") },
		);
	};

	// The failure belongs to the control that produced it, so the message is
	// looked up by which action is showing it rather than kept alongside it —
	// one place that can be stale instead of three. The SENTENCE follows the same
	// rule: `agentActionFailureMessage` is the one home of "which vocabulary does
	// this failure speak", because the pull is answered by the hub and the other
	// three by the local server.
	const failure = !failedAction
		? null
		: failedAction === "like"
			? {
					action: "like" as const,
					error: likeMutation.error,
					retry: handleLikeToggle,
				}
			: failedAction === "favourite"
				? {
						action: "favourite" as const,
						error: favouriteMutation.error,
						retry: handleFavouriteToggle,
					}
				: {
						action: "download" as const,
						error: downloadMutation.error,
						retry: handleDownload,
					};

	return (
		<AgentCard
			agent={agent}
			isLiked={isAuthenticated && isLiked}
			isFavourited={isAuthenticated && isFavourited}
			onLikeToggle={handleLikeToggle}
			onFavouriteToggle={handleFavouriteToggle}
			onDownload={handleDownload}
			isLikeActionLoading={likeMutation.isPending}
			isFavouriteActionLoading={favouriteMutation.isPending}
			isDownloading={downloadMutation.isPending}
			viewerStateKnown={viewerStateKnown}
			actionError={
				failure
					? agentActionFailureMessage(failure.action, failure.error, agent.name)
					: null
			}
			onRetryAction={failure?.retry}
		/>
	);
};
