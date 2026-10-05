import type { Agent } from "@shared/api/radient/types";
import { Button, Skeleton, Tooltip } from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { cn } from "@shared/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { Download, Heart, Star } from "lucide-react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { hubDisplayName } from "../display-name";
import { AgentTagsAndCategories } from "./agent-tags-and-categories";
import { OrgOriginBadge } from "./org-origin-badge";

type AgentCardProps = {
	agent: Agent;
	isLiked: boolean;
	isFavourited: boolean;
	/**
	 * Whether the viewer's like/favourite state is actually KNOWN for this card.
	 *
	 * The batched status read fails as a whole (and a 200 can omit an id), so
	 * "unfilled heart" would otherwise mean "the hub could not read your likes"
	 * stated as "you have not liked this" — on every card at once. False renders
	 * both controls unavailable with a sentence that says so instead of
	 * asserting a state, and the counts (which come from the record, not from
	 * that read) are unaffected.
	 *
	 * Defaults true, because the caller that has no batched read at all
	 * (onboarding renders cards with no viewer state by construction) is not in
	 * the same position as one whose read failed.
	 */
	viewerStateKnown?: boolean;
	onLikeToggle: (agentId: string) => void;
	onFavouriteToggle: (agentId: string) => void;
	/** Omit to render the card without a download action (onboarding does). */
	onDownload?: (agent: Agent) => void;
	isLikeActionLoading?: boolean;
	isFavouriteActionLoading?: boolean;
	isDownloading?: boolean;
	/**
	 * The sentence for the last action that failed on THIS card, and how to try
	 * it again. The hub used to answer a failed card action with a toast and
	 * nothing else while a failed read rendered into the surface, so the same
	 * feature spoke two error languages; the card is now where a card's failure
	 * is read, beside the control that produced it.
	 */
	actionError?: string | null;
	onRetryAction?: () => void;
	/**
	 * Whether the card's own action row renders. This prop existed and did
	 * nothing: the onboarding step that passes `false` still showed a Get button
	 * it did not want, and the hub passed `isAuthenticated` while downloads need
	 * no account. It is honoured now, and the caller's own flow is what decides.
	 */
	showActions?: boolean;
	/**
	 * The organization this row came from, when it is an org row (§8.4).
	 *
	 * Named by the origin badge. It does NOT decide that the row is org-private —
	 * `agent.visibility` does — so a caller that has no name to hand still gets the
	 * badge, saying less.
	 */
	orgName?: string | null;
};

/**
 * Renders a card displaying information about a public agent.
 *
 * No boundary at rest: a `bg-surface` card, rounded `md`, separating from the
 * canvas by its ground step. A grid of twelve hairline boxes is eight boxes'
 * worth of chrome — the shared `Card`'s `plain` variant doc states the rule —
 * and this pass applies it here. Hover is a colour step on the ground
 * (`elevated`) rather than on a border that only existed to carry it; nothing
 * lifts.
 *
 * Structure note: the info half is one native `<button>` (the card is the
 * "open details" affordance), and like/favourite/download live in their own
 * bar beside it. A card-wide click target with nested buttons would need
 * `stopPropagation` hacks and focus traps; two adjacent targets need neither.
 *
 * THE COUNTS COME FROM THE RECORD. `like_count`, `favourite_count` and
 * `download_count` are on every record the list returns, so this card prints
 * what it was handed: it used to run three count queries of its own, which is
 * thirty-six requests for a twelve-card page that had already been told the
 * same three numbers.
 */
export const AgentCard: React.FC<AgentCardProps> = ({
	agent,
	isLiked,
	isFavourited,
	onLikeToggle,
	onFavouriteToggle,
	onDownload,
	isLikeActionLoading = false,
	isFavouriteActionLoading = false,
	isDownloading = false,
	actionError = null,
	onRetryAction,
	showActions = true,
	viewerStateKnown = true,
	orgName = null,
}) => {
	const navigate = useNavigate();
	const { isAuthenticated } = useRadientAuth();

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

	const likeTooltip = !isAuthenticated
		? "Log in to Radient to like agents"
		: !viewerStateKnown
			? "Your likes could not be read, so this is not shown as unliked."
			: isLiked
				? "Unlike agent"
				: "Like agent";
	const favouriteTooltip = !isAuthenticated
		? "Log in to Radient to favourite agents"
		: !viewerStateKnown
			? "Your favourites could not be read, so this is not shown as unfavourited."
			: isFavourited
				? "Unfavourite agent"
				: "Favourite agent";
	/*
	 * The unknown state has its own two labels. A screen reader is told the same
	 * thing the tooltip says: not "like this agent", and not "unlike it" either,
	 * because neither is a claim this card can make.
	 */
	const likeLabel = !viewerStateKnown
		? "Like state unavailable"
		: isLiked
			? "Unlike agent"
			: "Like agent";
	const favouriteLabel = !viewerStateKnown
		? "Favourite state unavailable"
		: isFavourited
			? "Unfavourite agent"
			: "Favourite agent";

	/*
	 * Whether this row lives in an organization's private workspace (§1.5).
	 *
	 * The hub omits `visibility` for a public row, so only the literal "org"
	 * narrows the card to org behaviour — testing for "public" would be testing a
	 * value the wire never sends, and every row would read as public.
	 */
	const isOrgRow = agent.visibility === "org";
	/*
	 * The name the card PAINTS (see the helper's docstring): a hub key is a
	 * lowercase slug and carries no label, so `content-writer` reads `Content
	 * Writer` while `mathematician` stays as the hub spelled it.
	 */
	const displayName = hubDisplayName(agent.name);

	return (
		<div className="flex h-full flex-col overflow-hidden rounded-md bg-surface transition-colors duration-fast ease-out-quart hover:bg-elevated">
			<button
				type="button"
				onClick={() => navigate(`/agent-hub/${agent.id}`)}
				className="flex min-h-0 flex-1 cursor-pointer flex-col gap-2 p-4 text-left"
				aria-label={`View details for ${displayName}`}
			>
				<h3 className="truncate font-medium text-heading text-ink">
					{displayName}
				</h3>
				{/*
				 * The org origin badge, inline with the name rather than on a row of its own.
				 * The card's settled height is a pinned number — the placeholder above
				 * reproduces it box for box, and design rounds 1 and 2 both corrected it — so
				 * a badge that took its own line would reflow the whole grid the moment an org
				 * scope was selected. Beside the title it costs nothing: the badge's box fits
				 * inside the heading's own line box.
				 */}
				{isOrgRow && <OrgOriginBadge orgName={orgName} />}
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
			 * Active, those two borrow the `danger` and `warning` hues. Neither is a
			 * warning about anything — the palette has no "liked" role to spend, and
			 * those families are where the red and the amber a person expects behind a
			 * heart and a star actually live. What they replace is the MUI-era
			 * `#e53935` and `#ffb300`, which ignored the user's own palette and put the
			 * favourited star at 1.62:1 on `iceberg`, under half the 3:1 floor a
			 * meaningful graphic owes its ground. `agent-details-page` renders the same
			 * pair the same way.
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
				{/*
				 * `data-viewer-state` so the rendered page can be asked which of the three
				 * states a card is in, rather than inferred from a glyph's fill: the
				 * difference between "not liked" and "not known" is exactly what the
				 * frames cannot show.
				 */}
				<div
					className="flex min-w-0 items-center gap-0.5"
					data-viewer-state={
						isOrgRow
							? "org"
							: !isAuthenticated
								? "signed-out"
								: viewerStateKnown
									? "known"
									: "unknown"
					}
				>
					{/*
					 * LIKE AND FAVOURITE ARE NOT RENDERED FOR AN ORG ROW (§8.4). They are
					 * PUBLIC-ONLY interactions: the hub answers 404 to a like, a favourite or a
					 * comment on an org row (§4.4), so a control here would be one that cannot
					 * work — and a counter beside it would claim a public reaction on a row
					 * whose audience is one organization. `data-viewer-state="org"` is what the
					 * rendered page can be asked, so a frame-less check can tell this state from
					 * "signed out" and from "not known".
					 */}
					{!isOrgRow && (
						<>
							<Tooltip content={likeTooltip}>
								<span>
									<Button
										variant="ghost"
										size="sm"
										onClick={
											isAuthenticated && viewerStateKnown
												? () => onLikeToggle(agent.id)
												: undefined
										}
										disabled={
											isLikeActionLoading ||
											!isAuthenticated ||
											!viewerStateKnown
										}
										aria-label={likeLabel}
										className={cn(isLiked && "text-danger")}
									>
										<Heart
											fill={isLiked ? "currentColor" : "none"}
											data-testid="agent-like-heart"
										/>
										<span
											data-testid="agent-like-count"
											className="inline-flex h-4 min-w-4 items-center font-mono text-mono-sm text-ink-muted"
										>
											{/*
											 * `?? 0`, not a dash. `like_count` (and its two siblings) is a REQUIRED
											 * number on the declared wire type, so the only payload this default
											 * can meet is one that omits a field its own contract says is present
											 * — and 0 is the benign reading of that, where a dash would claim an
											 * "unknown" the type does not have. These three are RECORD data, not
											 * the viewer state the batched read carries, so the
											 * absent-is-unknown rule that governs the heart beside them does not
											 * reach them.
											 */}
											{agent.like_count ?? 0}
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
										disabled={
											isFavouriteActionLoading ||
											!isAuthenticated ||
											!viewerStateKnown
										}
										aria-label={favouriteLabel}
										className={cn(isFavourited && "text-warning")}
									>
										<Star
											fill={isFavourited ? "currentColor" : "none"}
											data-testid="agent-favourite-star"
										/>
										<span
											data-testid="agent-favourite-count"
											className="inline-flex h-4 min-w-4 items-center font-mono text-mono-sm text-ink-muted"
										>
											{agent.favourite_count ?? 0}
										</span>
									</Button>
								</span>
							</Tooltip>
						</>
					)}
					<Tooltip content="Downloads">
						<span className="ml-1 inline-flex items-center gap-1 pr-1 text-ink-dim">
							<Download aria-hidden="true" className="size-3.5" />
							<span className="inline-flex h-4 min-w-6 items-center font-mono text-mono-sm">
								{isDownloading ? (
									<Skeleton className="h-3 w-6" />
								) : (
									(agent.download_count ?? 0).toLocaleString()
								)}
							</span>
						</span>
					</Tooltip>
				</div>
				{/* `ml-auto` rather than `justify-between`: it holds the action at the
				    right edge on the wrapped line too, where a lone flex item would
				    otherwise sit at the start. */}
				{showActions && onDownload && (
					<div className="ml-auto flex shrink-0 items-center">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => onDownload(agent)}
							disabled={isDownloading}
							aria-label={`Download ${displayName}`}
							data-tour-tag="agent-hub-download-button"
						>
							<Download data-testid="agent-download" />
							Get
						</Button>
					</div>
				)}
			</div>
			{actionError && (
				/*
				 * `<output>` rather than a `div` with `role="status"`: the element
				 * carries that role itself (see `transcript-placeholder.tsx` and
				 * `canonical-transcript.tsx`, which say the same for the trace's own
				 * live regions), for the same reason the role is `status` rather than
				 * `alert` — the failure is already the answer to something the user
				 * just pressed, so it is read as the outcome of that action rather
				 * than interrupting with a second announcement. Sentence case, and the
				 * retry is a control rather than a phrase, so the way out is reachable
				 * by keyboard.
				 */
				<output
					data-testid="agent-card-error"
					className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-hairline px-3 py-2 text-body-sm text-danger"
				>
					<span className="min-w-0 flex-1">{actionError}</span>
					{onRetryAction && (
						<Button variant="ghost" size="sm" onClick={onRetryAction}>
							Try again
						</Button>
					)}
				</output>
			)}
		</div>
	);
};
