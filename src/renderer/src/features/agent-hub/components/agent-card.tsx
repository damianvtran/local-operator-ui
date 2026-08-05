import type { Agent } from "@shared/api/radient/types";
import { Button, Skeleton, Tooltip } from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { cn } from "@shared/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { Download, Heart, Star } from "lucide-react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
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

	/*
	 * Whether the three-line clamp is actually cutting anything. This used to
	 * be `description.length > 140`, which is a different question: how many
	 * lines a description takes depends on the column width, so a 100-character
	 * description in a narrow card clamped with no tooltip to read it in, and a
	 * 150-character one in a wide card offered a tooltip repeating what was
	 * already on screen. `scrollHeight` against `clientHeight` asks the clamp
	 * itself, re-asked whenever the card is resized.
	 */
	const [isClipped, setIsClipped] = useState(false);
	const clampObserver = useRef<ResizeObserver | null>(null);

	// A ref callback rather than an effect: toggling the tooltip on remounts
	// the element it wraps, and the observer has to follow the live node or it
	// keeps measuring a detached one — which reads 0 and flaps the flag back.
	const measureClamp = useCallback((node: HTMLSpanElement | null) => {
		clampObserver.current?.disconnect();
		clampObserver.current = null;
		if (!node) return;
		// 1px: the two heights are rounded independently.
		const measure = () =>
			setIsClipped(node.scrollHeight - node.clientHeight > 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		clampObserver.current = observer;
	}, []);

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
				 * boxes of different heights. The text is no longer pre-cut at 139
				 * characters either — the clamp already ends the line with an
				 * ellipsis, and cutting first meant a card wide enough to show the
				 * whole description still showed a truncated one.
				 *
				 * `Tooltip` renders its child bare when `content` is empty, so
				 * there is one element here and it only gains a tooltip once the
				 * clamp is measurably cutting text.
				 */}
				<Tooltip content={isClipped ? description : ""}>
					<span
						ref={measureClamp}
						className="line-clamp-3 min-h-0 text-body-sm text-ink-muted"
					>
						{description}
					</span>
				</Tooltip>

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
			 *
			 * Active, those two borrow the `danger` and `warning` hues. Neither is
			 * a warning about anything — the palette has no "liked" role to spend,
			 * and those families are where the red and the amber a person expects
			 * behind a heart and a star actually live. What they replace is the
			 * MUI-era `#e53935` and `#ffb300`, which ignored all twelve palettes
			 * and put the favourited star at 1.62:1 on `iceberg`, under half the
			 * 3:1 floor a meaningful graphic owes its ground.
			 * `agent-details-page` renders the same pair the same way.
			 *
			 * The counter group carries `min-w-0` and the row wraps, because a
			 * flex item defaults to `min-width: auto` and so refuses to shrink
			 * below its min-content width. Three counters that will not yield
			 * pushed the action past the card's `overflow-hidden` edge, and
			 * `shrink-0` on the action cannot rescue what is already outside the
			 * box. `min-w-0` lets the group give way; `flex-wrap` makes the
			 * action drop to a second line rather than off the card, whatever
			 * the counts turn out to be.
			 */}
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-hairline px-3 py-2">
				<div className="flex min-w-0 items-center gap-0.5">
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
								className={cn(isLiked && "text-danger")}
							>
								<Heart
									fill={isLiked ? "currentColor" : "none"}
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
								className={cn(isFavourited && "text-warning")}
							>
								<Star
									fill={isFavourited ? "currentColor" : "none"}
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
				{/* `ml-auto` rather than `justify-between`: it holds the action at the
				    right edge on the wrapped line too, where a lone flex item would
				    otherwise sit at the start. */}
				<div className="ml-auto flex shrink-0 items-center">
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
