import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
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
	 * `useAgentStatusesQuery` and passed down. An absent entry (the read has not
	 * answered, the viewer is signed out, or the backend predates the batched
	 * op) renders as neither liked nor favourited, which stays correct: the
	 * upstream like and favourite endpoints answer an already-liked agent with
	 * `already_liked` rather than a conflict.
	 */
	status?: AgentViewerStatus;
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
	// one place that can be stale instead of three.
	const failure = !failedAction
		? null
		: failedAction === "like"
			? { error: likeMutation.error, retry: handleLikeToggle }
			: failedAction === "favourite"
				? { error: favouriteMutation.error, retry: handleFavouriteToggle }
				: { error: downloadMutation.error, retry: handleDownload };

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
			actionError={
				failure
					? userFacingMessage(
							failure.error,
							"The action did not complete. Try again.",
						)
					: null
			}
			onRetryAction={failure?.retry}
		/>
	);
};
