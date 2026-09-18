import { agentActionFailureMessage } from "@features/agents/utils/publication-failure";
import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	AlertDescription,
	AlertTitle,
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
import { useAgentFavouriteMutation } from "./hooks/use-agent-favourite-mutation";
import { useAgentLikeMutation } from "./hooks/use-agent-like-mutation";
import {
	isAgentStatusKnown,
	useAgentStatusesQuery,
} from "./hooks/use-agent-statuses-query";
import { useDelistAgentMutation } from "./hooks/use-delist-agent-mutation";
import { useDownloadAgentMutation } from "./hooks/use-download-agent-mutation";

/*
 * Like and favourite carry the `danger` and `warning` hues when active.
 * Neither is a warning about anything — the palette has no "liked" role to
 * spend, and those two families are where the red and the amber a person
 * expects behind a heart and a star live. They replace the MUI-era `#e53935`
 * and `#ffb300`, which ignored the user's own palette and put the favourited
 * star at 1.62:1 on `iceberg`, under half the 3:1 floor a meaningful graphic
 * owes its ground. `agent-card` renders the same pair the same way.
 */

/**
 * The headline for each failed action, so the sentence names what did not
 * happen rather than that "something" did not.
 */
const FAILURE_TITLES = {
	like: "The like did not go through",
	favourite: "The favourite did not go through",
	download: "The download did not start",
	delist: "The agent was not delisted",
} as const;

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
		isFetching,
		error,
		refetch,
	} = useAgentDetailsQuery({
		agentId: agentId ?? "",
		enabled: !!agentId,
	});
	/*
	 * One batched read for this one agent's viewer state, rather than the two
	 * per-agent reads it used to make. Same op as the grid's, so the two surfaces
	 * cannot disagree about what the viewer has liked; its ids are just a list of
	 * one here.
	 */
	const {
		statuses,
		isKnown: viewerStateIsKnown,
		isError: viewerStateFailed,
		isFetching: viewerStateIsFetching,
		refetch: refetchViewerState,
	} = useAgentStatusesQuery({
		agentIds: agentId ? [agentId] : [],
	});
	/*
	 * The same unknown state the grid renders, for the same reason: this read is
	 * the batched op and it fails as a whole, so an absent entry here is "no
	 * answer" about THIS agent, not "not liked". The entry-level check is the
	 * one that matters for a list of one, and a 200 carrying no entry for this id
	 * is a case the request count does not distinguish from a failure.
	 */
	const viewerStateKnown = isAgentStatusKnown(
		viewerStateIsKnown,
		statuses,
		agentId,
	);
	const isLiked = viewerStateKnown && statuses[agentId ?? ""]?.liked === true;
	const isFavourited =
		viewerStateKnown && statuses[agentId ?? ""]?.favourited === true;
	/*
	 * The three counts come from the document this page already fetched. Each
	 * used to be a separate request for a number that arrived with the agent.
	 */
	const likeCount = agent?.like_count ?? 0;
	const favouriteCount = agent?.favourite_count ?? 0;
	const downloadCount = agent?.download_count ?? 0;

	const likeMutation = useAgentLikeMutation();
	const favouriteMutation = useAgentFavouriteMutation();
	const downloadMutation = useDownloadAgentMutation();
	const delistMutation = useDelistAgentMutation();

	// State for the confirmation dialog
	const [isDelistDialogOpen, setIsDelistDialogOpen] = useState(false);
	/*
	 * Which action failed, so its sentence can sit where the control is. The
	 * three card actions and the delist each report into this one slot: the hub's
	 * mutations used to fail into toasts while its reads failed into the surface,
	 * and this page had both.
	 */
	const [failedAction, setFailedAction] = useState<
		"like" | "favourite" | "download" | "delist" | null
	>(null);

	// Determine if the current user is the owner
	const isOwner =
		!!user && !!agent && user.radientUser?.account?.id === agent.account_id;

	const handleLikeToggle = () => {
		if (!agentId || !isAuthenticated || likeMutation.isPending) return;
		setFailedAction(null);
		likeMutation.mutate(
			{ agentId, isCurrentlyLiked: isLiked },
			{ onError: () => setFailedAction("like") },
		);
	};

	const handleFavouriteToggle = () => {
		if (!agentId || !isAuthenticated || favouriteMutation.isPending) return;
		setFailedAction(null);
		favouriteMutation.mutate(
			{ agentId, isCurrentlyFavourited: isFavourited },
			{ onError: () => setFailedAction("favourite") },
		);
	};

	const handleDownload = () => {
		if (!agentId || !agent || downloadMutation.isPending) return;
		setFailedAction(null);
		downloadMutation.mutate(
			{ agentId: agent.id, agentName: agent.name },
			{ onError: () => setFailedAction("download") },
		);
	};

	const handleDelist = () => {
		if (!agentId || !isOwner || delistMutation.isPending) return;
		setFailedAction(null);
		delistMutation.mutate(
			{ agentId },
			{ onError: () => setFailedAction("delist") },
		);
		setIsDelistDialogOpen(false);
	};

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
				: failedAction === "download"
					? {
							action: "download" as const,
							error: downloadMutation.error,
							retry: handleDownload,
						}
					: // Delisting is confirmed through the dialog, so the failed attempt is
						// reported and not silently repeated from here.
						{
							action: "delist" as const,
							error: delistMutation.error,
							retry: undefined,
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
			<div className="flex h-full items-center justify-center p-6">
				<Alert variant="danger" className="max-w-2xl">
					<AlertTitle>This agent could not be loaded</AlertTitle>
					<AlertDescription>
						{backendLoadErrorMessage(
							"The Radient agent catalogue did not answer.",
							error,
						)}
					</AlertDescription>
					<div className="mt-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => void refetch()}
							disabled={isFetching}
							aria-busy={isFetching}
						>
							{isFetching ? "Trying…" : "Try again"}
						</Button>
					</div>
				</Alert>
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
								disabled={
									!isAuthenticated ||
									likeMutation.isPending ||
									!viewerStateKnown
								}
								aria-label={
									!viewerStateKnown
										? "Like state unavailable"
										: isLiked
											? "Unlike agent"
											: "Like agent"
								}
								className={cn(isLiked && "text-danger")}
							>
								<Heart fill={isLiked ? "currentColor" : "none"} />
								<CountDisplay>{likeCount}</CountDisplay>
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
								disabled={
									!isAuthenticated ||
									favouriteMutation.isPending ||
									!viewerStateKnown
								}
								aria-label={
									!viewerStateKnown
										? "Favourite state unavailable"
										: isFavourited
											? "Unfavourite agent"
											: "Favourite agent"
								}
								className={cn(isFavourited && "text-warning")}
							>
								<Star fill={isFavourited ? "currentColor" : "none"} />
								<CountDisplay>{favouriteCount}</CountDisplay>
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
									{downloadMutation.isPending ? (
										<Skeleton className="h-3.5 w-5" />
									) : (
										downloadCount
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

			{/*
			 * The viewer's own state failed to read, which is the one thing that can
			 * make these two controls look unfilled for a reason that is not the
			 * viewer's: they render "unavailable" rather than "not liked", and this
			 * line says why once, with the retry the hook deliberately does not run on
			 * its own. It stands down while an ACTION's failure is on screen, so the
			 * two sentences never stack.
			 */}
			{isAuthenticated && viewerStateFailed && !failedAction && (
				/*
				 * `<output>` rather than a `div` with `role="status"`: the element
				 * carries that role itself, which is why a measurement of the `role`
				 * attribute reads null on a region that is in fact announced.
				 */
				<output
					className="mb-6 flex flex-wrap items-center gap-2 text-meta text-warning"
					data-testid="agent-details-status-unknown"
				>
					<span>
						Your likes and favourites could not be read, so this agent's viewer
						state is not shown.
					</span>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void refetchViewerState()}
						disabled={viewerStateIsFetching}
						aria-busy={viewerStateIsFetching}
					>
						{viewerStateIsFetching ? "Trying…" : "Try again"}
					</Button>
				</output>
			)}

			{failure && failedAction && (
				/*
				 * The failure sits under the controls that produced it and names which
				 * one, rather than arriving as a toast over a page the user is still
				 * reading. Same voice, same place, for every action on this surface.
				 */
				<Alert
					variant="danger"
					className="mb-6"
					data-testid="agent-details-error"
				>
					<AlertTitle>{FAILURE_TITLES[failedAction]}</AlertTitle>
					<AlertDescription>
						{agentActionFailureMessage(
							failure.action,
							failure.error,
							agent.name,
						)}
					</AlertDescription>
					{/* A sibling, never a child: `AlertDescription` is a `<p>`. */}
					{failure.retry && (
						<div className="mt-2">
							<Button variant="outline" size="sm" onClick={failure.retry}>
								Try again
							</Button>
						</div>
					)}
				</Alert>
			)}

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

			{/*
			 * Not `ConfirmationModal`, because the confirm button here carries a
			 * pending state the shared component has no prop for - but the same
			 * shape as it, since a user meets both and should not have to work
			 * out whether they are looking at the same kind of question.
			 * `maxWidth="xs"` and `text-body` are that component's values.
			 *
			 * No alarm treatment: no `TriangleAlert`, and the confirm is a
			 * primary rather than a danger button. The other six confirmations
			 * guard something irreversible; this one is undone by uploading
			 * again, which the copy now says. Painting it red as well would
			 * tell the user two different things about how bad it is.
			 */}
			<BaseDialog
				open={isDelistDialogOpen}
				onClose={() => setIsDelistDialogOpen(false)}
				title="Delist this agent?"
				maxWidth="xs"
				actions={
					<>
						<SecondaryButton onClick={() => setIsDelistDialogOpen(false)}>
							Cancel
						</SecondaryButton>
						<PrimaryButton
							onClick={() => {
								if (!agentId || !isOwner || delistMutation.isPending) return;
								handleDelist();
							}}
							disabled={delistMutation.isPending}
						>
							{delistMutation.isPending ? (
								<Spinner size="sm" label="Delisting agent" />
							) : (
								"Delist"
							)}
						</PrimaryButton>
					</>
				}
				dialogProps={{
					"aria-describedby": "delist-dialog-description",
					/*
					 * No `onOpenAutoFocus` override. It used to steer initial focus
					 * onto the destructive button, on the belief that Radix would
					 * otherwise land on the close X - measured against this
					 * dialog's own DOM, Radix's tabbable order is [Cancel, Delist,
					 * close], so the default is Cancel. The override existed only
					 * to move Enter onto the dangerous control, which is the exact
					 * hazard removed from the other six confirmation dialogs in
					 * this release.
					 */
				}}
			>
				<div
					id="delist-dialog-description"
					className="text-body text-ink-muted"
				>
					{/* Not "cannot be undone" followed by "you can re-upload it
					    later" - a reader cannot tell from that how bad this is,
					    and telling them exactly that is the dialog's whole job. */}
					This takes "{agent.name}" off the hub straight away, and nobody will
					be able to download it. You can upload it again later.
				</div>
			</BaseDialog>
		</div>
	);
};
