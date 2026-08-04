import type { Agent } from "@shared/api/radient/types";
import {
	Avatar,
	AvatarFallback,
	Badge,
	Button,
	Skeleton,
	Tooltip,
} from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatDistanceToNowStrict } from "date-fns";
import { Bot, Download, Heart, Star } from "lucide-react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { useAgentDownloadCountQuery } from "../hooks/use-agent-download-count-query";
import { useAgentFavouriteCountQuery } from "../hooks/use-agent-favourite-count-query";
import { useAgentLikeCountQuery } from "../hooks/use-agent-like-count-query";
import { useDownloadAgentMutation } from "../hooks/use-download-agent-mutation";
import { AgentTagsAndCategories } from "./agent-tags-and-categories";

type AgentCardProps = {
	agent: Agent;
	isLiked: boolean;
	isFavourited: boolean;
	onLikeToggle: (agentId: string) => void;
	onFavouriteToggle: (agentId: string) => void;
	isLikeActionLoading?: boolean;
	isFavouriteActionLoading?: boolean;
	showActions?: boolean;
};

/*
 * The two semantic hues the heart and star carry when active. They were
 * hardcoded in the MUI version too (`#e53935`, `#ffb300`) and have no role
 * in the palette contract — there is no "liked" role to spend a semantic
 * triple on — so they stay as named values at their two call sites.
 */
const LIKE_ACTIVE_COLOR = "#e53935";
const FAVOURITE_ACTIVE_COLOR = "#ffb300";

/**
 * Renders a card displaying information about a public agent.
 *
 * One boundary per card: a `bg-surface` panel with a hairline edge, rounded
 * `lg`. Hover is a colour step on the border only — nothing lifts.
 *
 * Structure note: the info half is one native `<button>` (the card is the
 * "open details" affordance), and like/favourite/download live in their own
 * bar beside it. A card-wide click target with nested buttons would need
 * `stopPropagation` hacks and focus traps; two adjacent targets need neither.
 */
export const AgentCard: React.FC<AgentCardProps> = ({
	agent,
	isLiked,
	isFavourited,
	onLikeToggle,
	onFavouriteToggle,
	isLikeActionLoading = false,
	isFavouriteActionLoading = false,
}) => {
	const navigate = useNavigate();
	const downloadMutation = useDownloadAgentMutation();
	const { isAuthenticated } = useRadientAuth();

	const { data: likeCount, isLoading: isLoadingLikes } = useAgentLikeCountQuery(
		{
			agentId: agent.id,
		},
	);
	const { data: favouriteCount, isLoading: isLoadingFavourites } =
		useAgentFavouriteCountQuery({
			agentId: agent.id,
		});
	const { data: downloadCount, isLoading: isLoadingDownloads } =
		useAgentDownloadCountQuery({
			agentId: agent.id,
		});

	const description = agent.description ?? "";
	// Long descriptions are clamped at 140 characters; the tooltip carries the
	// full text exactly when something was cut.
	const isTruncated = description.length > 140;
	const truncatedDescription = isTruncated
		? `${description.slice(0, 139)}…`
		: description;

	const likeTooltip = isAuthenticated
		? isLiked
			? "Unlike agent"
			: "Like agent"
		: "Log in to Radient to like agents";
	const favouriteTooltip = isAuthenticated
		? isFavourited
			? "Unfavourite agent"
			: "Favourite agent"
		: "Log in to Radient to favourite agents";

	return (
		<div className="flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface transition-colors duration-fast ease-out-quart hover:border-control">
			<button
				type="button"
				onClick={() => navigate(`/agent-hub/${agent.id}`)}
				className="flex min-h-0 flex-1 cursor-pointer flex-col gap-3 p-4 text-left"
				aria-label={`View details for ${agent.name}`}
			>
				<Avatar className="size-11 self-start">
					<AvatarFallback>
						<Bot size={22} aria-hidden="true" />
					</AvatarFallback>
				</Avatar>

				<div className="flex min-h-0 flex-1 flex-col gap-2">
					<h3 className="truncate font-medium text-heading text-ink">
						{agent.name}
					</h3>
					{isTruncated ? (
						<Tooltip content={description}>
							<span className="min-h-0 text-body-sm text-ink-muted">
								{truncatedDescription}
							</span>
						</Tooltip>
					) : (
						<p className="min-h-0 text-body-sm text-ink-muted">
							{truncatedDescription}
						</p>
					)}
				</div>

				<div className="flex flex-col gap-2">
					<AgentTagsAndCategories
						tags={agent.tags}
						categories={agent.categories}
					/>
					<div className="flex flex-col gap-0.5 text-ink-muted text-meta">
						<p>
							Creator: {agent.account_metadata?.name ?? "Unknown"} (
							{agent.account_metadata?.email ?? "No email"})
						</p>
						<p>
							Created: {formatDistanceToNowStrict(new Date(agent.created_at))}{" "}
							ago
						</p>
						<p>
							Updated: {formatDistanceToNowStrict(new Date(agent.updated_at))}{" "}
							ago
						</p>
					</div>
				</div>
			</button>

			<div className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-2">
				<div className="flex items-center gap-1">
					<Tooltip content={likeTooltip}>
						<span>
							<Button
								variant="ghost"
								size="sm"
								onClick={
									isAuthenticated ? () => onLikeToggle(agent.id) : undefined
								}
								disabled={isLikeActionLoading || !isAuthenticated}
								aria-label={isLiked ? "Unlike agent" : "Like agent"}
							>
								<Heart
									size={18}
									strokeWidth={2}
									fill={isLiked ? LIKE_ACTIVE_COLOR : "none"}
									color={isLiked ? LIKE_ACTIVE_COLOR : undefined}
									data-testid="agent-like-heart"
								/>
								<span className="inline-flex h-4 min-w-5 items-center text-meta text-ink-muted">
									{isLoadingLikes ? (
										<Skeleton className="h-3.5 w-5" />
									) : (
										(likeCount ?? 0)
									)}
								</span>
							</Button>
						</span>
					</Tooltip>
					<Tooltip content={favouriteTooltip}>
						<span>
							<Button
								variant="ghost"
								size="sm"
								onClick={
									isAuthenticated
										? () => onFavouriteToggle(agent.id)
										: undefined
								}
								disabled={isFavouriteActionLoading || !isAuthenticated}
								aria-label={
									isFavourited ? "Unfavourite agent" : "Favourite agent"
								}
							>
								<Star
									size={18}
									strokeWidth={2}
									fill={isFavourited ? FAVOURITE_ACTIVE_COLOR : "none"}
									color={isFavourited ? FAVOURITE_ACTIVE_COLOR : undefined}
									data-testid="agent-favourite-star"
								/>
								<span className="inline-flex h-4 min-w-5 items-center text-meta text-ink-muted">
									{isLoadingFavourites ? (
										<Skeleton className="h-3.5 w-5" />
									) : (
										(favouriteCount ?? 0)
									)}
								</span>
							</Button>
						</span>
					</Tooltip>
				</div>
				<div className="flex items-center gap-2">
					<Tooltip content="Download agent to your computer">
						<span>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => {
									if (!downloadMutation.isPending) {
										downloadMutation.mutate({
											agentId: agent.id,
											agentName: agent.name,
										});
									}
								}}
								disabled={downloadMutation.isPending}
								aria-label="Download agent"
								data-tour-tag="agent-hub-download-button"
							>
								<Download data-testid="agent-download" />
							</Button>
						</span>
					</Tooltip>
					{isLoadingDownloads || downloadMutation.isPending ? (
						<Skeleton className="h-5 w-24 rounded-full" />
					) : (
						<Badge variant="outline" shape="pill">
							{downloadCount ?? 0} Download{downloadCount !== 1 ? "s" : ""}
						</Badge>
					)}
				</div>
			</div>
		</div>
	);
};
