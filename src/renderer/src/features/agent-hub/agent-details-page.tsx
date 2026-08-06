import {
	BaseDialog,
	DangerButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import {
	Avatar,
	AvatarFallback,
	Button,
	Separator,
	Skeleton,
	Tooltip,
} from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { cn } from "@shared/lib/utils";
import { formatCalendarDate } from "@shared/utils/date-utils";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowLeft, Bot, Download, Heart, Star, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AgentTagsAndCategories } from "./components/agent-tags-and-categories";
import { CommentsSection } from "./components/comments-section";
import { useAgentDetailsQuery } from "./hooks/use-agent-details-query";
import { useAgentDownloadCountQuery } from "./hooks/use-agent-download-count-query";
import { useAgentFavouriteCountQuery } from "./hooks/use-agent-favourite-count-query";
import { useAgentFavouriteMutation } from "./hooks/use-agent-favourite-mutation";
import { useAgentFavouriteQuery } from "./hooks/use-agent-favourite-query";
import { useAgentLikeCountQuery } from "./hooks/use-agent-like-count-query";
import { useAgentLikeMutation } from "./hooks/use-agent-like-mutation";
import { useAgentLikeQuery } from "./hooks/use-agent-like-query";
import { useDelistAgentMutation } from "./hooks/use-delist-agent-mutation";
import { useDownloadAgentMutation } from "./hooks/use-download-agent-mutation";

/*
 * Like and favourite carry the `danger` and `warning` hues when active.
 * Neither is a warning about anything — the palette has no
 * "liked" role to spend, and those two families are where the red and the
 * amber a person expects behind a heart and a star live. They replace the
 * MUI-era `#e53935` and `#ffb300`, which ignored all twelve palettes and put
 * the favourited star at 1.62:1 on `iceberg`, under half the 3:1 floor a
 * meaningful graphic owes its ground. `agent-card` renders the same pair the
 * same way.
 */

const CountDisplay: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => (
	<span className="inline-flex h-4 min-w-5 items-center text-meta text-ink-muted">
		{children}
	</span>
);

/**
 * Renders the detailed view for a specific public agent.
 */
export const AgentDetailsPage: React.FC = () => {
	const { agentId } = useParams<{ agentId: string }>();
	const navigate = useNavigate();
	const { isAuthenticated, user } = useRadientAuth();

	const {
		data: agent,
		isLoading,
		error,
	} = useAgentDetailsQuery({
		agentId: agentId ?? "",
		enabled: !!agentId,
	});
	const { isLiked } = useAgentLikeQuery({
		agentId: agentId ?? "",
		enabled: !!agentId && isAuthenticated,
	});
	const { isFavourited } = useAgentFavouriteQuery({
		agentId: agentId ?? "",
		enabled: !!agentId && isAuthenticated,
	});
	const { data: likeCount, isLoading: isLoadingLikes } = useAgentLikeCountQuery(
		{
			agentId: agentId ?? "",
			enabled: !!agentId,
		},
	);
	const { data: favouriteCount, isLoading: isLoadingFavourites } =
		useAgentFavouriteCountQuery({
			agentId: agentId ?? "",
			enabled: !!agentId,
		});
	const { data: downloadCount, isLoading: isLoadingDownloads } =
		useAgentDownloadCountQuery({
			agentId: agentId ?? "",
			enabled: !!agentId,
		});

	const likeMutation = useAgentLikeMutation();
	const favouriteMutation = useAgentFavouriteMutation();
	const downloadMutation = useDownloadAgentMutation();
	const delistMutation = useDelistAgentMutation();

	// State for the confirmation dialog
	const [isDelistDialogOpen, setIsDelistDialogOpen] = useState(false);

	// Determine if the current user is the owner
	const isOwner =
		!!user && !!agent && user.radientUser?.account?.id === agent.account_id;

	const handleLikeToggle = () => {
		if (!agentId || !isAuthenticated || likeMutation.isPending) return;
		likeMutation.mutate({ agentId, isCurrentlyLiked: isLiked });
	};

	const handleFavouriteToggle = () => {
		if (!agentId || !isAuthenticated || favouriteMutation.isPending) return;
		favouriteMutation.mutate({ agentId, isCurrentlyFavourited: isFavourited });
	};

	const handleDownload = () => {
		if (!agentId || !agent || downloadMutation.isPending) return;
		downloadMutation.mutate({ agentId: agent.id, agentName: agent.name });
	};

	const handleBack = () => {
		navigate("/agent-hub");
	};

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner label="Loading agent details" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-body-sm text-danger">
					Failed to load agent details: {error.message}
				</p>
			</div>
		);
	}

	if (!agent) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-body text-ink">Agent not found.</p>
			</div>
		);
	}

	return (
		<div className="m-6 flex flex-1 flex-col rounded-lg border border-hairline bg-surface p-8">
			<div className="mb-6 flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-4">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleBack}
						aria-label="Back to Agent hub"
					>
						<ArrowLeft />
					</Button>
					<Avatar className="size-11 shrink-0">
						<AvatarFallback>
							<Bot size={22} aria-hidden="true" />
						</AvatarFallback>
					</Avatar>
					{/* Matches the PageHeader title step used on other routes */}
					<h1 className="truncate text-display text-ink">{agent.name}</h1>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Tooltip
						content="Sign in to Radient to use this feature"
						disabled={isAuthenticated}
					>
						<span>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleLikeToggle}
								disabled={!isAuthenticated || likeMutation.isPending}
								aria-label={isLiked ? "Unlike agent" : "Like agent"}
								className={cn(isLiked && "text-danger")}
							>
								<Heart size={18} fill={isLiked ? "currentColor" : "none"} />
								<CountDisplay>
									{isLoadingLikes ? (
										<Skeleton className="h-3.5 w-5" />
									) : (
										(likeCount ?? 0)
									)}
								</CountDisplay>
							</Button>
						</span>
					</Tooltip>
					<Tooltip
						content="Sign in to Radient to use this feature"
						disabled={isAuthenticated}
					>
						<span>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleFavouriteToggle}
								disabled={!isAuthenticated || favouriteMutation.isPending}
								aria-label={
									isFavourited ? "Unfavourite agent" : "Favourite agent"
								}
								className={cn(isFavourited && "text-warning")}
							>
								<Star size={18} fill={isFavourited ? "currentColor" : "none"} />
								<CountDisplay>
									{isLoadingFavourites ? (
										<Skeleton className="h-3.5 w-5" />
									) : (
										(favouriteCount ?? 0)
									)}
								</CountDisplay>
							</Button>
						</span>
					</Tooltip>
					<Tooltip content="Download agent to your computer">
						<span>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleDownload}
								disabled={downloadMutation.isPending}
								aria-label="Download agent"
								className="ml-1"
							>
								<Download />
								<CountDisplay>
									{isLoadingDownloads || downloadMutation.isPending ? (
										<Skeleton className="h-3.5 w-5" />
									) : (
										(downloadCount ?? 0)
									)}
								</CountDisplay>
							</Button>
						</span>
					</Tooltip>

					{isOwner && (
						<Tooltip content="Permanently delist this agent from Agent hub">
							<span>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => setIsDelistDialogOpen(true)}
									disabled={delistMutation.isPending}
									aria-label="Delist agent"
									className="ml-1 text-danger hover:bg-danger-wash hover:text-danger"
								>
									<Trash2 />
								</Button>
							</span>
						</Tooltip>
					)}
				</div>
			</div>

			<AgentTagsAndCategories tags={agent.tags} categories={agent.categories} />
			<div className="mt-4 mb-6 flex flex-col gap-2 text-body-sm text-ink-muted">
				<p>
					Created by: {agent.account_metadata?.name ?? "Unknown"} (
					{agent.account_metadata?.email ?? "No email"})
				</p>
				<p>
					Created: {formatDistanceToNowStrict(new Date(agent.created_at))} ago (
					{formatCalendarDate(agent.created_at)})
				</p>
				<p>
					Last modified: {formatDistanceToNowStrict(new Date(agent.updated_at))}{" "}
					ago ({formatCalendarDate(agent.updated_at)})
				</p>
			</div>

			<div className="mt-2 mb-8 leading-relaxed text-body text-ink">
				{agent.description || "No description provided."}
			</div>

			<Separator className="my-6" />

			<CommentsSection agentId={agent.id} />

			<BaseDialog
				open={isDelistDialogOpen}
				onClose={() => setIsDelistDialogOpen(false)}
				title="Delist this agent?"
				actions={
					<>
						<SecondaryButton onClick={() => setIsDelistDialogOpen(false)}>
							Cancel
						</SecondaryButton>
						<DangerButton
							onClick={() => {
								if (!agentId || !isOwner || delistMutation.isPending) return;
								delistMutation.mutate({ agentId });
								setIsDelistDialogOpen(false);
							}}
							disabled={delistMutation.isPending}
							id="delist-confirm-button"
						>
							{delistMutation.isPending ? (
								<Spinner size="sm" label="Delisting agent" />
							) : (
								"Delist"
							)}
						</DangerButton>
					</>
				}
				dialogProps={{
					"aria-describedby": "delist-dialog-description",
					/*
					 * MUI auto-focused the destructive button; Radix would otherwise
					 * land on the close X. Steer the initial focus explicitly.
					 */
					onOpenAutoFocus: (event: Event) => {
						event.preventDefault();
						document.getElementById("delist-confirm-button")?.focus();
					},
				}}
			>
				<p
					id="delist-dialog-description"
					className="text-body-sm text-ink-muted"
				>
					Are you sure you want to permanently delist "{agent.name}"? This
					action cannot be undone. Nobody will be able to download this agent
					anymore. You can re-upload it later if you choose.
				</p>
			</BaseDialog>
		</div>
	);
};
