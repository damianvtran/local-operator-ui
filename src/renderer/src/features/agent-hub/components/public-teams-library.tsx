import {
	PUBLICATION_ACTION_LABEL,
	type PublicationAction,
	publicationTreatment,
} from "@features/agents/utils/publication-failure";
import { backendErrorKind } from "@shared/api/local-operator/backend-error";
import { isPublicationError } from "@shared/api/local-operator/publication-errors";
import type { HubTeamRow } from "@shared/api/radient/types";
import { RadientAuthButtons } from "@shared/components/auth/radient-auth-buttons";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Input,
	Skeleton,
	Tooltip,
} from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { TEXT_SURFACE_PROPS } from "@shared/components/ui/text-surface";
import { cn } from "@shared/lib/utils";
import { Search } from "lucide-react";
import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { hubDisplayName, normalizeHubKey } from "../display-name";
import {
	PUBLIC_TEAMS_PER_PAGE,
	usePublicTeamQuery,
	usePublicTeamsQuery,
} from "../hooks/use-public-teams-query";
import { useTeamPullMutation } from "../hooks/use-team-pull-mutation";
import { publicHubFailureMessage } from "../public-hub-failure";
import { HubPager } from "./hub-pager";
import {
	memberCount,
	slotList,
	teamAuthor,
	teamVersion,
} from "./org-team-summary";

/**
 * The treatment actions a PULL can honour, and nothing else.
 *
 * The same restriction the org roster applies, for the same reason: the table is
 * authored for the publish dialog, where `refresh-hub` re-reads and `retry`
 * resubmits a publication. Here `refresh-hub` re-reads this catalogue and
 * `retry` re-pulls the same document, which is what their labels mean; a
 * publish-only remedy is not rendered and the sentence still names the step.
 */
const PULL_ACTIONS: readonly PublicationAction[] = [
	"refresh-hub",
	"retry",
	"sign-in",
];

/**
 * The PUBLIC team catalogue — the hub's Teams view outside an organization.
 *
 * ## Why this exists
 *
 * The hub serves a public team listing (design §11 O-7 recorded the opposite,
 * and the surface said so: "the public hub lists agents only"). It is back: the
 * listing is anonymous, the document is the same one the org workspace serves,
 * and a public team pulls through the same local route the org roster's pull
 * uses. The copy below states that rather than the old organization-only frame.
 *
 * ## Every fact is the row's own
 *
 * Name, description, manager and roster come from the LIST row; the author from
 * its `account_metadata`. The BRIEF is the one field the list form omits, so it
 * is the one thing this surface fetches — on open, one `getPublicTeam` for the
 * row the reader asked about, which is why the pull decision and the brief read
 * are separate acts.
 *
 * ## Search is client-side, and the copy says so
 *
 * The public listing ignores `name`, `description`, `search` and `sort`
 * server-side (measured against the live hub, 2026-10-05: all four return the
 * same page), so the box filters the rows this app has already fetched — the
 * whole catalogue while it fits one page, and the fetched page once it does not.
 * The count line names the bound rather than implying a catalogue-wide search.
 */

export const PublicTeamsLibrary: FC<{
	/** Whether this machine holds a Radient credential (pulling needs one). */
	signedIn: boolean;
	onOpenSettings: () => void;
}> = ({ signedIn, onOpenSettings }) => {
	const [page, setPage] = useState(1);
	const [searchText, setSearchText] = useState("");

	const { teams, isLoading, isFetching, isError, error, refetch, pagination } =
		usePublicTeamsQuery({ page, perPage: PUBLIC_TEAMS_PER_PAGE });

	const pull = useTeamPullMutation();
	const [failedTeamId, setFailedTeamId] = useState<string | null>(null);
	const [pullingTeamId, setPullingTeamId] = useState<string | null>(null);
	/**
	 * The published row whose Pull must take focus back once its request settles
	 * (UX round 1, U4, on the roster this mirrors). Every Pull disables while one
	 * is in flight, so the pressed button loses focus to `<body>` and stays there
	 * after the toast; the effect below restores it AFTER the re-render that
	 * re-enables the button, because `focus()` on a disabled element is a no-op.
	 */
	const pullButtons = useRef(new Map<string, HTMLButtonElement>());
	const refocusTeamId = useRef<string | null>(null);
	useEffect(() => {
		if (pull.isPending || refocusTeamId.current === null) return;
		pullButtons.current.get(refocusTeamId.current)?.focus();
		refocusTeamId.current = null;
	}, [pull.isPending]);

	const query = normalizeHubKey(searchText.trim());
	const visibleTeams = useMemo(
		() =>
			query
				? teams.filter(
						(team) =>
							/*
							 * ONE term for the name. The display form and the key differ only in
							 * case AND separators, so matching the display form alone would miss a
							 * reader who pastes the hub's own `data-quality` — which is why the QUERY
							 * is normalised to that same shape above rather than the filter carrying a
							 * second term per spelling (agent review round 1, n2).
							 */
							hubDisplayName(team.name).toLowerCase().includes(query) ||
							(team.description ?? "").toLowerCase().includes(query),
					)
				: teams,
		[teams, query],
	);

	const handlePull = (team: HubTeamRow) => {
		if (pull.isPending) return;
		setFailedTeamId(null);
		setPullingTeamId(team.id);
		refocusTeamId.current = team.id;
		pull.mutate(
			// No `tenantId`: this document's owner is not the caller's business
			// here, and the route verifies a declared tenant rather than trusting
			// it — declaring one from a public row would be an invented claim.
			{ teamId: team.id, name: team.name },
			{
				onSettled: () => setPullingTeamId(null),
				onError: () => setFailedTeamId(team.id),
			},
		);
	};

	/*
	 * A coded pull refusal renders through the table the publish dialog shares,
	 * exactly as the org roster's does: `team_not_found` names a re-read, a
	 * credential refusal names the sign-in, and the body's verb comes from the
	 * `pull` surface rather than the publish dialog's.
	 */
	const pullTreatment = useMemo(() => {
		if (!isPublicationError(pull.error)) return null;
		const failed = teams.find((team) => team.id === failedTeamId);
		return publicationTreatment(
			{
				code: pull.error.code,
				message: pull.error.message,
				details: pull.error.details,
			},
			{ name: failed?.name ?? "this team", hubAgentId: null, surface: "pull" },
		);
	}, [pull.error, failedTeamId, teams]);

	/*
	 * WHAT A FAILED PULL SAYS.
	 *
	 * The coded treatment comes first: it names the step and carries the control
	 * that repairs it. A CREDENTIAL REFUSAL has no coded treatment on this route —
	 * the local server answers a prose 401 when it holds no Radient credential, so
	 * `isPublicationError` is false and the surface used to render a dead-end
	 * sentence with no remedy at all, while this component's own docstring claimed
	 * it named the sign-in (QA round 1, Q2). The act belongs to the surface, which
	 * is why the shared remedy table leaves `unauthorized` empty; the sentence here
	 * supplies it, and the page's own "Sign in to Radient" line above is the
	 * affordance it points at. The bare sentence is the last resort, for a failure
	 * this surface cannot classify.
	 */
	const pullFailureBody =
		pullTreatment?.body ??
		(backendErrorKind(pull.error) === "unauthorized"
			? "The team could not be pulled: the hub refused this machine's sign-in. Sign in on the settings page, then pull again."
			: "The team could not be pulled.");

	const [reauthenticating, setReauthenticating] = useState(false);
	const runTreatmentAction = (action: PublicationAction, team: HubTeamRow) => {
		switch (action) {
			case "refresh-hub":
				void refetch();
				break;
			case "retry":
				handlePull(team);
				break;
			case "sign-in":
				setReauthenticating(true);
				break;
			default:
				break;
		}
	};

	const coldLoading = isLoading && teams.length === 0;
	const totalRecords = pagination?.totalRecords ?? teams.length;

	/*
	 * The search box, and the one focus hand-off this surface owes it: clearing the
	 * box returns the caret to it. The platform's own clear control takes focus with
	 * it when it is pressed, so a reader who clears a query and keeps typing would
	 * otherwise be typing at nothing. The agents grid's search does the same, for
	 * the same reason (agent review round 1, m3).
	 */
	const searchRef = useRef<HTMLInputElement>(null);
	const handleSearchChange = (value: string) => {
		const wasSearching = searchText !== "";
		setSearchText(value);
		if (wasSearching && value === "") searchRef.current?.focus();
	};

	return (
		<section className="flex flex-col" data-testid="agent-hub-public-teams">
			{/*
			 * A HEADING, so the card titles inside have a level above them: every team
			 * name is an `<h3>` and the section carried only an `aria-label`, which is a
			 * landmark name rather than an outline (design round 1, D4 — `h1 -> h3 skips a
			 * level` on every state). Visually hidden because the section is already
			 * introduced by the paragraph below it and the page's own heading is two
			 * levels up; the label moved into this element so the region is not named
			 * twice.
			 */}
			<h2 className="sr-only">Public teams</h2>
			{/*
			 * WHAT THE PUBLIC LIBRARY IS, in the app's own voice: published teams
			 * anyone can read, and the one act this surface owns. It replaces the
			 * organization-only notice, whose premise (there are no public teams) is
			 * the thing that stopped being true.
			 */}
			<p className="mb-3 max-w-3xl text-body-sm text-ink-muted">
				Public teams are published to the hub by anyone and can be read here
				without signing in. Pulling one copies it into this machine's local team
				registry.
			</p>

			{signedIn ? null : (
				<div
					className="mb-3 flex flex-wrap items-center gap-2"
					data-testid="agent-hub-public-teams-signed-out"
				>
					<span className="text-meta text-ink-dim">
						Sign in to Radient to pull a team into this machine.
					</span>
					<Button variant="secondary" size="sm" onClick={onOpenSettings}>
						Open settings to sign in
					</Button>
				</div>
			)}

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div
					className={cn(
						"flex min-w-56 max-w-md flex-1 items-center rounded-sm border border-control bg-surface",
						"transition-colors duration-fast ease-out-quart",
						"has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2",
						"has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2",
					)}
				>
					<Search aria-hidden="true" className="ml-2 shrink-0 text-ink-dim" />
					<Input
						ref={searchRef}
						type="search"
						value={searchText}
						onChange={(event) => handleSearchChange(event.target.value)}
						placeholder="Search teams"
						aria-label="Search teams"
						className="h-8 min-w-0 flex-1 border-0 bg-transparent outline-none"
						data-testid="agent-hub-public-teams-search"
					/>
				</div>
			</div>

			{coldLoading && (
				<div
					aria-hidden="true"
					className="flex max-w-4xl flex-col gap-3"
					data-testid="agent-hub-public-teams-loading"
				>
					<TeamCardSkeleton />
					<TeamCardSkeleton />
					<TeamCardSkeleton />
				</div>
			)}

			{!coldLoading && isError && (
				<Alert
					variant="danger"
					className="w-auto max-w-2xl"
					data-testid="agent-hub-public-teams-error"
				>
					<AlertTitle>Public teams could not be loaded</AlertTitle>
					<AlertDescription>
						{publicHubFailureMessage(
							"The public team catalogue could not be read.",
							error,
						)}
					</AlertDescription>
					<div className="mt-2">
						<Button
							variant="primary"
							size="sm"
							onClick={() => void refetch()}
							disabled={isFetching}
							aria-busy={isFetching}
						>
							{isFetching ? "Trying…" : "Try again"}
						</Button>
					</div>
				</Alert>
			)}

			{!coldLoading && !isError && teams.length === 0 && (
				<p
					className="max-w-2xl text-body-sm text-ink-muted"
					data-testid="agent-hub-public-teams-empty"
				>
					No teams have been published to the public hub yet.
				</p>
			)}

			{!coldLoading && !isError && teams.length > 0 && (
				<>
					{/*
					 * THE COUNT LINE STANDS DOWN IN THE MISS STATE (design round 1, D3).
					 * `0 of 9 teams on this page match "x"` immediately followed by `No team
					 * on this page matches "x".` says one fact twice, which reads as a glitch
					 * rather than emphasis; the miss paragraph is the empty state, so it keeps
					 * the sentence and the count goes. It still carries the filtered figure
					 * whenever there IS one, which is what it exists for.
					 */}
					{!query || visibleTeams.length > 0 ? (
						<p
							className="mb-3 text-meta text-ink-dim"
							data-testid="agent-hub-public-teams-status"
						>
							{query
								? `${visibleTeams.length} of ${teams.length} teams on this page match "${searchText.trim()}"`
								: `${totalRecords} ${totalRecords === 1 ? "team" : "teams"} in the public hub`}
							{query ? (
								<span className="text-ink-dim">
									{" "}
									· search covers the teams loaded here
								</span>
							) : null}
						</p>
					) : null}
					{visibleTeams.length === 0 ? (
						<p
							className="max-w-2xl text-body-sm text-ink-muted"
							data-testid="agent-hub-public-teams-search-miss"
						>
							{`No team on this page matches "${searchText.trim()}".`}
						</p>
					) : (
						<ul className="flex max-w-4xl flex-col gap-3">
							{visibleTeams.map((team) => (
								<PublicTeamCard
									key={team.id}
									team={team}
									pulling={pullingTeamId === team.id}
									pullPending={pull.isPending}
									onPull={handlePull}
									pullButtonRef={(element) => {
										if (element) pullButtons.current.set(team.id, element);
										else pullButtons.current.delete(team.id);
									}}
									failed={failedTeamId === team.id}
									failureBody={pullFailureBody}
									treatment={pullTreatment}
									onTreatmentAction={runTreatmentAction}
									reauthenticating={reauthenticating}
									onReauthenticated={() => {
										setReauthenticating(false);
										setFailedTeamId(null);
										void refetch();
									}}
								/>
							))}
						</ul>
					)}
					{!query && pagination && pagination.totalPages > 1 && (
						<HubPager
							count={pagination.totalPages}
							page={pagination.page}
							onChange={(next) => {
								setPage(next);
								searchRef.current?.scrollIntoView({ block: "nearest" });
							}}
						/>
					)}
				</>
			)}
		</section>
	);
};

/**
 * One public team, as a card.
 *
 * The card keeps the roster row's information order (identity, what it does,
 * who leads it, who published it) but is its own block rather than a divided
 * row: a public catalogue is a grid of independent documents, and each carries
 * the one action this surface owns. The BRIEF is behind the disclosure, because
 * the list form does not carry it — opening one is the fetch.
 */
const PublicTeamCard: FC<{
	team: HubTeamRow;
	pulling: boolean;
	pullPending: boolean;
	onPull: (team: HubTeamRow) => void;
	failed: boolean;
	treatment: ReturnType<typeof publicationTreatment> | null;
	onTreatmentAction: (action: PublicationAction, team: HubTeamRow) => void;
	reauthenticating: boolean;
	onReauthenticated: () => void;
	/** The sentence to render when this row's pull failed (the caller's fallback chain). */
	failureBody: string;
	/** Registers this row's Pull control, so the caller can hand focus back to it. */
	pullButtonRef: (element: HTMLButtonElement | null) => void;
}> = ({
	team,
	pulling,
	pullPending,
	onPull,
	failed,
	failureBody,
	treatment,
	onTreatmentAction,
	reauthenticating,
	onReauthenticated,
	pullButtonRef,
}) => {
	const [open, setOpen] = useState(false);
	const detail = usePublicTeamQuery({ teamId: open ? team.id : undefined });
	const displayName = hubDisplayName(team.name);
	const version = teamVersion(team);
	const author = teamAuthor(team);
	const manager = team.manager?.trim();
	const count = memberCount(team);
	const description = (team.description ?? "").trim();

	return (
		<li
			className="rounded-md bg-surface p-4"
			data-testid="agent-hub-public-team"
			data-team-name={team.name}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline">
						<h3 className="truncate font-medium text-heading text-ink">
							{displayName}
						</h3>
						{version ? (
							<span className="ml-2 shrink-0 text-ink-dim text-meta">
								v{version}
							</span>
						) : null}
					</div>
					{description ? (
						<p
							{...TEXT_SURFACE_PROPS}
							/*
							 * THE MEASURE IS CAPPED (design round 1, D6). Uncapped, the description ran
							 * 812px at 13px — about 110-125 characters a line, against the brief body's
							 * `max-w-3xl` — which is a wall to read rather than a paragraph.
							 */
							className="mt-1 line-clamp-3 max-w-3xl select-text text-body-sm text-ink-muted"
						>
							{description}
						</p>
					) : (
						<p className="mt-1 text-body-sm text-ink-dim">No description</p>
					)}
					<p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-meta">
						{manager ? (
							<>
								<span className="text-ink-dim">Manager:</span>
								<span className="text-ink-muted">{manager}</span>
							</>
						) : null}
						{team.members.length === 0 ? (
							<span className="text-ink-dim">No members</span>
						) : (
							<>
								<span className="text-ink-dim">
									{count} {count === 1 ? "member" : "members"}:
								</span>
								{/* The elastic tail: one clipped line, and the whole roster is one press away. */}
								<Tooltip content={slotList(team)}>
									<span className="truncate text-ink-muted">
										{slotList(team)}
									</span>
								</Tooltip>
							</>
						)}
					</p>
					{author ? (
						<p className="mt-1 text-ink-dim text-meta">
							Published by <span className="text-ink-muted">{author}</span>
						</p>
					) : null}
				</div>
				<div className="flex shrink-0 flex-col items-end gap-2">
					{/*
					 * THE CONTROL AND ITS OUTCOME, ADJACENT.
					 *
					 * The failure used to be the card's LAST child, below the brief, so
					 * pressing Pull with a brief open pushed the message — and any control that
					 * repairs it — under the fold: the reader pressed and saw nothing (design
					 * round 1, D2; agent review round 1, M1, whose pixel scan found no danger
					 * pixels at all in the frame that claimed to show the refusal). It renders
					 * in the header column, under the button that produced it, as the org
					 * roster's own row does.
					 *
					 * BOTH CONTROLS are under the 44px touch advisory (Pull 28px, the brief
					 * trigger 26px) and comfortably over the 24px hard floor. This is a desktop
					 * pointer surface, so the sizes stand and the advisory is recorded here
					 * rather than paid for with a row rhythm the design round judged (design
					 * round 1, D7).
					 */}
					<Button
						ref={pullButtonRef}
						variant="secondary"
						size="sm"
						onClick={() => onPull(team)}
						disabled={pullPending}
						aria-label={`Pull team ${displayName}`}
					>
						{pulling ? "Pulling…" : "Pull"}
					</Button>
					{failed && (
						<div
							className="flex max-w-56 flex-col items-end gap-1"
							data-testid="agent-hub-public-team-pull-error"
						>
							<output className="text-right text-meta text-danger">
								{failureBody}
							</output>
							{treatment?.actions
								.filter((action) => PULL_ACTIONS.includes(action))
								.map((action) => (
									<Button
										key={action}
										variant="primary"
										size="sm"
										onClick={() => onTreatmentAction(action, team)}
									>
										{PUBLICATION_ACTION_LABEL[action]}
									</Button>
								))}
							{reauthenticating && (
								<div data-testid="agent-hub-public-team-pull-reauth">
									<RadientAuthButtons
										titleText="Sign in again"
										descriptionText=""
										onSignInSuccess={onReauthenticated}
									/>
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			<div className="mt-2">
				{/*
				 * The app's one disclosure idiom (branding §9). The trigger's visible text is
				 * the word the reader is choosing; the accessible name says which team's.
				 */}
				<Disclosure
					summary="Brief"
					open={open}
					onOpenChange={setOpen}
					className="w-full"
					triggerClassName="w-full"
					triggerLabel={`View the brief for ${displayName}`}
					chevronClassName="text-ink-dim"
				>
					<TeamBrief detail={detail} />
				</Disclosure>
			</div>
		</li>
	);
};

/**
 * The brief the LIST form omits: one `getPublicTeam` for the row that was
 * opened, with its own loading, failure and retry — the states the org roster
 * deliberately does not carry, because there the brief is never fetched.
 */
const TeamBrief: FC<{
	detail: ReturnType<typeof usePublicTeamQuery>;
}> = ({ detail }) => {
	if (detail.isLoading) {
		return (
			<div
				className="flex flex-col gap-1"
				data-testid="agent-hub-public-team-brief-loading"
			>
				<Skeleton className="h-[1lh] w-2/3" />
				<Skeleton className="h-[2lh] w-full" />
			</div>
		);
	}
	if (detail.isError) {
		return (
			<div className="flex flex-col items-start gap-1">
				<output className="text-meta text-danger">
					{publicHubFailureMessage(
						"This team's brief could not be read.",
						detail.error,
					)}
				</output>
				<Button
					variant="primary"
					size="sm"
					onClick={() => void detail.refetch()}
					disabled={detail.isFetching}
					aria-busy={detail.isFetching}
				>
					{detail.isFetching ? "Trying…" : "Try again"}
				</Button>
			</div>
		);
	}
	const team = detail.team;
	if (!team) return null;
	const brief = (team.instructions ?? "").trim();
	const project = (team.project ?? "").trim();
	return (
		<div
			className="flex max-w-3xl flex-col gap-3 text-body-sm"
			data-testid="agent-hub-public-team-brief"
		>
			<div className="flex flex-col gap-1">
				<p className="text-ink-dim text-meta">Collaboration brief</p>
				{brief ? (
					<p
						{...TEXT_SURFACE_PROPS}
						className="whitespace-pre-line select-text text-ink-muted"
					>
						{brief}
					</p>
				) : (
					<p className="text-ink-dim">This team has no collaboration brief.</p>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<p className="text-ink-dim text-meta">Project brief</p>
				{project ? (
					<p
						{...TEXT_SURFACE_PROPS}
						className="whitespace-pre-line select-text text-ink-muted"
					>
						{project}
					</p>
				) : (
					<p className="text-ink-dim">This team has no project brief.</p>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<p className="text-ink-dim text-meta">Roster</p>
				<ul className="flex flex-col gap-0.5">
					{team.manager?.trim() ? (
						<li className="flex items-baseline gap-1.5">
							<span className="text-body-sm text-ink-muted">
								{team.manager.trim()}
							</span>
							<span className="text-ink-dim text-meta">Manager</span>
						</li>
					) : null}
					{team.members.length === 0 ? (
						<li className="text-ink-dim">No members</li>
					) : (
						team.members.map((slot) => (
							<li
								key={`${slot.kind}:${slot.role}`}
								className="flex items-baseline gap-1.5"
							>
								<span className="text-body-sm text-ink-muted">
									{slot.count > 1 ? `${slot.role} ×${slot.count}` : slot.role}
								</span>
								<span className="text-ink-dim text-meta">{slot.kind}</span>
							</li>
						))
					)}
				</ul>
			</div>
		</div>
	);
};

/** The card's own box, at the settled card's height, so the first paint does not move. */
const TeamCardSkeleton = () => (
	<div className="rounded-md bg-surface p-4">
		<Skeleton className="h-[1lh] w-1/3" />
		<Skeleton className="mt-1 flex h-[3lh] w-full" />
		<Skeleton className="mt-2 h-[1lh] w-2/3" />
	</div>
);
