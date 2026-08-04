import type { Agent } from "@shared/api/radient/types";
import { Button, Skeleton, Tooltip } from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatDistanceToNowStrict } from "date-fns";
import { Download, Heart, Star } from "lucide-react";
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
		<div className="flex h-full flex-col overflow-hidden rounded-lg border border-hairline bg-surface transition-colors duration-fast ease-out-quart hover:border-control">
			<button
				type="button"
				onClick={() => navigate(`/agent-hub/${agent.id}`)}
				className="flex min-h-0 flex-1 cursor-pointer flex-col gap-2 p-4 text-left"
				aria-label={`View details for ${agent.name}`}
			>
				<h3 className="truncate font-medium text-heading text-ink">
					{agent.name}
				</h3>
				{/*
				 * A fixed three-line description. Clamping rather than truncating
				 * at a character count keeps every card's footer on the same
				 * baseline, which is the difference between a grid and eight
				 * boxes of different heights.
				 */}
				{isTruncated ? (
					<Tooltip content={description}>
						<span className="line-clamp-3 min-h-0 text-body-sm text-ink-muted">
							{truncatedDescription}
						</span>
					</Tooltip>
				) : (
					<p className="line-clamp-3 min-h-0 text-body-sm text-ink-muted">
						{truncatedDescription}
					</p>
				)}

				<div className="mt-auto flex flex-col gap-2 pt-2">
					<AgentTagsAndCategories
						tags={agent.tags}
						categories={agent.categories}
					/>
					{/*
					 * One line of provenance instead of three labelled ones. Nobody
					 * browsing a marketplace needs the author's email address or the
					 * date the agent was first published; they need to know who made
					 * it and whether it is still being looked after.
					 */}
					<p className="truncate text-ink-dim text-meta">
						{agent.account_metadata?.name ?? "Unknown author"}
						<span aria-hidden="true" className="mx-1.5">
							·
						</span>
						updated {formatDistanceToNowStrict(new Date(agent.updated_at))} ago
					</p>
				</div>
			</button>

			{/*
			 * The footer.
			 *
			 * Download is the reason the card exists, so it is the only labelled
			 * control and the count sits next to it as plain text — the bordered
			 * pill it used to wear was clipped at "1840 Downl…" in a four-column
			 * grid. Like and favourite are reactions, not the job, and they read
			 * as two quiet counters.
			 */}
			<div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-2">
				<div className="flex items-center gap-0.5">
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
									fill={isLiked ? LIKE_ACTIVE_COLOR : "none"}
									color={isLiked ? LIKE_ACTIVE_COLOR : undefined}
									data-testid="agent-like-heart"
								/>
								<span className="inline-flex h-4 min-w-4 items-center font-mono text-mono-sm text-ink-muted">
									{isLoadingLikes ? (
										<Skeleton className="h-3 w-4" />
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
									fill={isFavourited ? FAVOURITE_ACTIVE_COLOR : "none"}
									color={isFavourited ? FAVOURITE_ACTIVE_COLOR : undefined}
									data-testid="agent-favourite-star"
								/>
								<span className="inline-flex h-4 min-w-4 items-center font-mono text-mono-sm text-ink-muted">
									{isLoadingFavourites ? (
										<Skeleton className="h-3 w-4" />
									) : (
										(favouriteCount ?? 0)
									)}
								</span>
							</Button>
						</span>
					</Tooltip>
					<Tooltip content="Downloads">
						<span className="ml-1 inline-flex items-center gap-1 pr-1 text-ink-dim">
							<Download aria-hidden="true" className="size-3.5" />
							<span className="inline-flex h-4 min-w-4 items-center font-mono text-mono-sm">
								{isLoadingDownloads || downloadMutation.isPending ? (
									<Skeleton className="h-3 w-6" />
								) : (
									(downloadCount ?? 0).toLocaleString()
								)}
							</span>
						</span>
					</Tooltip>
				</div>
				<div className="flex shrink-0 items-center">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							if (!downloadMutation.isPending) {
								downloadMutation.mutate({
									agentId: agent.id,
									agentName: agent.name,
								});
							}
						}}
						disabled={downloadMutation.isPending}
						aria-label={`Download ${agent.name}`}
						data-tour-tag="agent-hub-download-button"
					>
						<Download data-testid="agent-download" />
						Get
					</Button>
				</div>
			</div>
		</div>
	);
};
