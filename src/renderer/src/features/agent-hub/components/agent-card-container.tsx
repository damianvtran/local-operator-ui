import type { Agent } from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import type React from "react";
import { useAgentFavouriteMutation } from "../hooks/use-agent-favourite-mutation";
import { useAgentFavouriteQuery } from "../hooks/use-agent-favourite-query";
import { useAgentLikeMutation } from "../hooks/use-agent-like-mutation";
import { useAgentLikeQuery } from "../hooks/use-agent-like-query";
import { AgentCard } from "./agent-card";

type AgentCardContainerProps = {
	agent: Agent;
};

/**
 * Container component for AgentCard.
 * Fetches like/favourite status and handles like/favourite mutations for a specific agent.
 */
export const AgentCardContainer: React.FC<AgentCardContainerProps> = ({
	agent,
}) => {
	const { isAuthenticated } = useRadientAuth();

	const { isLiked, isLoading: isLoadingLike } = useAgentLikeQuery({
		agentId: agent.id,
		enabled: isAuthenticated,
	});

	const { isFavourited, isLoading: isLoadingFavourite } =
		useAgentFavouriteQuery({
			agentId: agent.id,
			enabled: isAuthenticated,
		});

	const likeMutation = useAgentLikeMutation();

	const favouriteMutation = useAgentFavouriteMutation();

	const handleLikeToggle = () => {
		if (!isAuthenticated || isLoadingLike || likeMutation.isPending) {
			return;
		}
		likeMutation.mutate({ agentId: agent.id, isCurrentlyLiked: isLiked });
	};

	const handleFavouriteToggle = () => {
		if (!isAuthenticated || isLoadingFavourite || favouriteMutation.isPending) {
			return;
		}
		favouriteMutation.mutate({
			agentId: agent.id,
			isCurrentlyFavourited: isFavourited,
		});
	};

	const isLikeActionLoading = isLoadingLike || likeMutation.isPending;
	const isFavouriteActionLoading =
		isLoadingFavourite || favouriteMutation.isPending;

	return (
		<AgentCard
			agent={agent}
			isLiked={isAuthenticated ? isLiked : false}
			isFavourited={isAuthenticated ? isFavourited : false}
			onLikeToggle={handleLikeToggle}
			onFavouriteToggle={handleFavouriteToggle}
			isLikeActionLoading={isLikeActionLoading}
			isFavouriteActionLoading={isFavouriteActionLoading}
			showActions={isAuthenticated}
		/>
	);
};
