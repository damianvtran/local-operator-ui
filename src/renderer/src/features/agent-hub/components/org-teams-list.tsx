import {
	PUBLICATION_ACTION_LABEL,
	type PublicationAction,
	publicationTreatment,
} from "@features/agents/utils/publication-failure";
import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import { isPublicationError } from "@shared/api/local-operator/publication-errors";
import type { HubTeam } from "@shared/api/radient/types";
import { RadientAuthButtons } from "@shared/components/auth/radient-auth-buttons";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Skeleton,
	Tooltip,
} from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { TEXT_SURFACE_PROPS } from "@shared/components/ui/text-surface";
import { cn } from "@shared/lib/utils";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { hubDisplayName } from "../display-name";
import { useOrgTeamsQuery } from "../hooks/use-org-teams-query";
import { useTeamPullMutation } from "../hooks/use-team-pull-mutation";
import { orgRefusalFromError } from "../org-access";
import {
	type TeamRecency,
	announcedDescription,
	kindLabel,
	memberCount,
	slotList,
	teamAuthor,
	teamDates,
	teamDescription,
	teamRecency,
	teamVersion,
} from "./org-team-summary";

/**
 * The treatment actions this surface can HONOUR, and nothing else.
 *
 * A control that does something other than its label is worse than no control
 * (copy review round 2's C8, and the agent review's R-2): the table's actions were
 * authored against the publish dialog, where `sign-in` opens a credential panel
 * and `retry` resubmits the same publication. A pull is not a publication, so each
 * action is mapped to the act this roster can actually perform:
 *
 * - `refresh-hub` re-reads the roster, which is what the sentence beside it means;
 * - `retry` re-pulls the SAME team, which is what "Try again" means here;
 * - `sign-in` reveals the shared `RadientAuthButtons` panel — the same control the
 *   dialog uses, because the hub refused a credential and re-running the Radient
 *   sign-in is the one thing that replaces it.
 *
 * Anything else (a publish-only remedy) is not rendered: the body still names the
 * step in words, and a button that lied about it would not.
 */
const ROSTER_ACTIONS: readonly PublicationAction[] = [
	"refresh-hub",
	"retry",
	"sign-in",
];

/**
 * The org scope's team roster - the hub's Teams view - with the one action v1 gives it (design §8.4:
 * "v1 renders org teams as a list on the hub page (pull action); no new
 * top-level navigation").
 *
 * ## Why it is not a page
 *
 * A team hub would need its own navigation, its own empty, its own moderation
 * story — and the desktop owns presentation only (§8.4): every semantic here
 * comes from `org_teams.list` and `org_team.get`. So the roster is a view of
 * the surface the user is already on (a tab beside Agents), and the action is the one the route
 * family actually supports: pull the published document into this machine's
 * local registry, which is what `GET /v1/teams/pull/{team_id}` does.
 *
 * ## The pull reports what was STORED
 *
 * The local import can rename (a local id or name clash) and the hook's toast
 * names the stored team rather than the requested one — the agent pull's rule,
 * one document family over. A FAILED pull is rendered here, beside the row that
 * produced it, rather than as a toast: the hub keeps one error language, and the
 * surface is it.
 *
 * ## Called only with a tenant
 *
 * The component is mounted by the hub page only while an organization is the
 * scope, so `tenantId` is required here even though the hook's own type allows
 * `undefined` (its disabled-read case). A roster with no organization to read is
 * not a state this surface has.
 */
export const OrgTeamsList: React.FC<{
	tenantId: string;
	orgName: string | null;
}> = ({ tenantId, orgName }) => {
	const { teams, isLoading, isFetching, isError, error, refetch } =
		useOrgTeamsQuery({ tenantId });
	/* The refusal the read is answered with, when it is one (§2.2). */
	const refusal = orgRefusalFromError(error);
	const pull = useTeamPullMutation();
	const [failedTeamId, setFailedTeamId] = useState<string | null>(null);
	/** The row whose pull is in flight, so only that row reports it. */
	const [pullingTeamId, setPullingTeamId] = useState<string | null>(null);
	/**
	 * The row whose Pull must take focus back once its request settles (UX round 1,
	 * U4). Every Pull is `disabled` while one is in flight, so the pressed button
	 * loses focus to `<body>` and stays there after the toast; the effect below
	 * restores it AFTER the re-render that re-enables the button, because focus()
	 * on a disabled element is a no-op.
	 */
	const pullButtons = useRef(new Map<string, HTMLButtonElement>());
	const refocusTeamId = useRef<string | null>(null);
	useEffect(() => {
		if (pull.isPending || refocusTeamId.current === null) return;
		pullButtons.current.get(refocusTeamId.current)?.focus();
		refocusTeamId.current = null;
	}, [pull.isPending]);
	/** Whether the shared re-sign-in panel is open in place of the action row. */
	const [reauthenticating, setReauthenticating] = useState(false);
	/**
	 * The rows that are open, by team id. A SET, not one id: comparing two rosters
	 * is a real use of this list, so opening a row never closes another. Expanding
	 * is client-only - it reveals fields `org_teams.list` already returned - so it
	 * costs no read; the brief (`instructions`) is detail-only and deliberately NOT
	 * fetched here.
	 */
	const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const setExpanded = (teamId: string, open: boolean) =>
		setExpandedIds((current) => {
			const next = new Set(current);
			if (open) next.add(teamId);
			else next.delete(teamId);
			return next;
		});
	/**
	 * Escape closes an open row and leaves focus ON ITS TRIGGER, wherever inside
	 * the row it was pressed (the trigger or Pull). Focus never moves into the
	 * revealed region on open either, so the trigger is the one stable place a
	 * keyboard user is in. A key that came from the pull-failure block (its retry
	 * and the re-sign-in panel) is not the row's to take.
	 */
	const closeOnEscape = (
		event: ReactKeyboardEvent<HTMLLIElement>,
		teamId: string,
	) => {
		if (event.key !== "Escape" || !expandedIds.has(teamId)) return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('[data-testid="org-team-pull-error"]')) return;
		setExpanded(teamId, false);
		event.currentTarget
			.querySelector<HTMLButtonElement>("button[aria-expanded]")
			?.focus();
		event.preventDefault();
	};

	/*
	 * A CODED pull refusal renders through the same treatment table the publish
	 * dialog uses (agent review round 1, n1). `team_not_found` is the arm that made
	 * this necessary: it carries a `refresh-hub` action whose only sensible home is
	 * this roster's own refetch, and before this it was a row no surface could
	 * reach — a treatment pinned by a test and rendered by nobody. The name in the
	 * context is the failed row's, because the sentence is about that document.
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
			// `surface: "pull"`: the table is shared with the publish dialog, and its
			// verb-bearing bodies must name the act this surface performed (C7).
			{ name: failed?.name ?? "this team", hubAgentId: null, surface: "pull" },
		);
	}, [pull.error, failedTeamId, teams]);

	/*
	 * One action, one act. `default` renders nothing at all (see ROSTER_ACTIONS):
	 * the refusal's own sentence is the instruction, and a publish-only remedy
	 * pressed here would refetch a list instead of doing what it says.
	 */
	const runTreatmentAction = (action: PublicationAction, team: HubTeam) => {
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

	const handlePull = (team: HubTeam) => {
		if (pull.isPending) return;
		refocusTeamId.current = team.id;
		setFailedTeamId(null);
		setPullingTeamId(team.id);
		pull.mutate(
			{ teamId: team.id, tenantId, name: team.name },
			{
				onSettled: () => setPullingTeamId(null),
				onError: () => setFailedTeamId(team.id),
			},
		);
	};

	return (
		<section
			/*
			 * `max-w-4xl` (design round 1, D3): the roster used to span the whole
			 * column, 1232px at 1280, which put "Pull" a thousand pixels from the name
			 * it acts on - a two-row list read as two cells of a table. 56rem keeps
			 * the name-to-action distance scannable and is still wider than the public
			 * notice's 42rem, because a row carries a summary line as well as a name.
			 */
			className="mb-6 max-w-4xl rounded-md bg-surface"
			aria-label={`Teams shared with ${orgName ?? "this organization"}`}
			data-testid="org-teams"
		>
			{/*
			 * NO HEADING OR COUNT LINE OF ITS OWN. Both belonged to the roster when it
			 * sat under the agent grid and had to introduce itself; it is the Teams
			 * view now, under a tab that says "Teams" and a status sentence that says
			 * "2 teams shared with Minerva" (`agent-hub-page.tsx`), so a second heading
			 * and a second count over the same rows would say one thing twice. The
			 * section keeps its landmark name for assistive tech.
			 */}

			{isLoading && (
				/*
				 * The skeletons are `aria-hidden`, and there is NO `sr-only` sentence
				 * beside them (design round 1's N3). The copy review that added one
				 * (C6) was right that a pair of bare skeletons is silent; it is not right
				 * any more, because the page's own `aria-live` status line says
				 * "Loading teams…" one line above - so a screen reader heard the same
				 * sentence twice from two elements, and only one of them is the region
				 * that goes on to report the count.
				 */
				<div
					aria-hidden="true"
					className="flex flex-col divide-y divide-hairline"
					data-testid="org-teams-loading"
				>
					<TeamRowSkeleton />
					<TeamRowSkeleton />
					<TeamRowSkeleton />
				</div>
			)}

			{/*
			 * A REFUSAL IS CLASSIFIED BEFORE IT IS DESCRIBED. `org_teams.list` is gated on
			 * the same membership and plan the workspace is, so this read can be refused
			 * with exactly the codes the agent list is (§2.2) — and the generic arm's own
			 * classifier reads a 403 as a credential problem, which it printed as "This
			 * app cannot authenticate to the running Local Operator server" under a
			 * lapsed-plan refusal: a sentence that sends the user to sign in again for a
			 * subscription only an owner can fix (measured in the `OrgPlanLapsed` frame,
			 * which is what that frame is for).
			 *
			 * The retry is offered wherever it is not empty: a plan can be activated and
			 * a page with a cached query comes back to it, while a revoked membership is
			 * nothing this user can press to change.
			 */}
			{!isLoading && isError && (
				/*
				 * The SEVERITY follows the state (design round 1, D2): a refusal is a state
				 * of this surface — §8.4's "render as 'no access' per plan status, not as
				 * errors" — so the two refusal arms are `warning`, the same treatment the
				 * agents section gives them. Measured before this: the same code rendered
				 * amber on one section and red on the next, in one viewport.
				 *
				 * `danger` stays for the GENERIC arm, which is a real failure, and "the
				 * teams could not be read" is the one case here where an alarm is honest.
				 *
				 * The retry is `primary`, not `outline` (D1): an outlined control's only
				 * boundary is its edge against the alert's wash, below the repo's 3:1
				 * non-text floor in 7 (`warningWash`) and 2 (`dangerWash`) of the 59
				 * palettes — the measurement that moved `update-error-alert`'s retry onto
				 * `primary` (`contrast-contract.mjs`).
				 */
				<Alert
					variant={refusal ? "warning" : "danger"}
					/*
					 * `w-auto`: `Alert` is `w-full`, so a 16px margin on it made the box
					 * 100% + 32px wide and the panel's `overflow-hidden` clipped its right
					 * border (design round 1, D1; UX round 1, U5; measured 1272 in a 1256
					 * panel). Auto width lets the margin be the inset it was meant to be.
					 */
					className="m-4 w-auto"
					data-testid="org-teams-error"
				>
					<AlertTitle>
						{refusal === "plan"
							? "That organization needs an active Team plan"
							: refusal === "no_access"
								? "You do not have access to that organization"
								: "Teams could not be loaded"}
					</AlertTitle>
					<AlertDescription>
						{refusal === "plan"
							? `Reading an organization's teams is part of the Team plan. An owner of ${orgName ?? "this organization"} can activate it in the Radient console, and then its teams will be listed here.`
							: refusal === "no_access"
								? `You are not a member of ${orgName ?? "that organization"}, so its teams are not listed here. An owner can invite you again.`
								: backendLoadErrorMessage(
										"The teams shared with this organization could not be read.",
										error,
									)}
					</AlertDescription>
					{refusal !== "no_access" && (
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
					)}
				</Alert>
			)}

			{!isLoading && !isError && teams.length === 0 && (
				<p
					className="p-4 text-body-sm text-ink-muted"
					data-testid="org-teams-empty"
				>
					{`Teams shared into ${orgName ?? "this organization"} appear here for its members.`}
				</p>
			)}

			{!isLoading && !isError && teams.length > 0 && (
				<ul className="flex flex-col divide-y divide-hairline">
					{teams.map((team) => (
						<li
							key={team.id}
							className={cn(
								ROW_BOX,
								/*
								 * Hover is a colour step, the agent card's own (nothing lifts). The
								 * radii follow the section's 10px corner on the first and last row so
								 * the ground does not square off the panel - and that is why the
								 * section carries no `overflow-hidden`: it would clip the trigger's
								 * focus outline, which is `outline`, not `box-shadow`, for exactly
								 * this reason.
								 */
								"transition-colors duration-fast ease-out-quart hover:bg-elevated first:rounded-t-md last:rounded-b-md",
							)}
							onKeyDown={(event) => closeOnEscape(event, team.id)}
						>
							<Disclosure
								className="min-w-0"
								open={expandedIds.has(team.id)}
								onOpenChange={(open) => setExpanded(team.id, open)}
								summaryAlign="firstLine"
								/*
								 * `min-w-0`: the trigger is a flex item beside Pull, and a button's
								 * automatic minimum width is its content, so without it a long
								 * unbroken description would widen the row instead of truncating.
								 */
								triggerClassName="min-w-0"
								/*
								 * The chevron is the row's only expand affordance, so it is painted
								 * `ink-dim` (the primitive's `ink-disabled` is exempt from every
								 * contrast floor). It is never `disabled`: the body always adds the
								 * member kinds and exact dates, so the list has no mixed
								 * expandable/static rows and no height alternation.
								 */
								/*
								 * `mt-1`, not the primitive's `FIRST_LINE_MARK` `mt-0.5`: a 14px
								 * chevron beside a 21.7px name line sat 1.8px above the name's
								 * centre with 2px of lead, and 4px puts it +0.2px. Passed through
								 * `chevronClassName` - the prop the primitive exists for - so no
								 * other caller's mark moves.
								 */
								chevronClassName="text-ink-dim mt-1"
								/* The li owns the padding; the primitive's row is `min-h-6 py-0.5`. */
								rowClassName="py-0"
								/*
								 * NO `triggerLabel`: the trigger's accessible name is the row's own
								 * text, so a screen reader hears the description. (The agent card's
								 * "View details for X" label silences it.)
								 */
								summary={
									<TeamSummary
										team={team}
										expanded={expandedIds.has(team.id)}
									/>
								}
								/*
								 * Pull is the disclosure's `trailing`, a SIBLING of the trigger: a
								 * button nested in the trigger's `<button>` is invalid, and the
								 * primitive exists to make that unnecessary. `self-start -mt-1`
								 * lines the 28px button's centre up with the 21.7px name line
								 * (measured delta in the PR) instead of floating it to the middle of
								 * a four-line row.
								 */
								trailing={
									<div className="-mt-1 ml-3 shrink-0 self-start">
										<Button
											ref={(node) => {
												if (node) pullButtons.current.set(team.id, node);
												else pullButtons.current.delete(team.id);
											}}
											variant="secondary"
											size="sm"
											onClick={() => handlePull(team)}
											disabled={pull.isPending}
											aria-label={`Pull team ${team.name}`}
										>
											{pullingTeamId === team.id ? "Pulling…" : "Pull"}
										</Button>
									</div>
								}
							>
								<TeamDetails team={team} />
							</Disclosure>
							{failedTeamId === team.id && (
								/*
								 * `<output>` rather than a `div` with `role="status"`: the element carries
								 * the role itself. The sentence is the treatment's when the refusal was
								 * CODED — which is what gives `team_not_found` its body and its refresh
								 * control — and the transport's own otherwise.
								 */
								<div
									className="mt-1 flex flex-col items-start gap-1 pl-5"
									data-testid="org-team-pull-error"
								>
									<output className="text-meta text-danger">
										{pullTreatment?.body ??
											pull.error?.message ??
											`"${team.name}" could not be pulled.`}
									</output>
									{pullTreatment?.actions
										.filter((action) => ROSTER_ACTIONS.includes(action))
										.map((action) => (
											<Button
												key={action}
												variant="primary"
												size="sm"
												onClick={() => runTreatmentAction(action, team)}
											>
												{PUBLICATION_ACTION_LABEL[action]}
											</Button>
										))}
									{reauthenticating && (
										/*
										 * The `hub_unauthorized` remedy, and the same control the publish
										 * dialog reveals for it: the credential the hub refused is replaced
										 * by re-running the Radient sign-in, and the roster has no other
										 * surface that can do it.
										 */
										<div className="mt-1" data-testid="org-team-pull-reauth">
											<RadientAuthButtons
												titleText="Sign in again"
												descriptionText=""
												onSignInSuccess={() => {
													setReauthenticating(false);
													setFailedTeamId(null);
													void refetch();
												}}
											/>
										</div>
									)}
								</div>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
};

/**
 * The row box, shared by the settled row and its skeleton.
 *
 * `py-3` is the between-component step of the spacing ramp (12); the row used to
 * be `py-2.5`, which is off it. It is a constant because the skeleton has to be
 * the same box as the row it stands in for or the first paint moves a second time
 * when the list lands - the `agent-hub-pager-placeholder` / `min-h-13` rule, and
 * `scripts/org-teams-summary.test.mjs` pins the pair. Change one, change both.
 */
const ROW_BOX = "px-4 py-3";

/**
 * One provenance / composition separator.
 *
 * The dot is decorative, so it is hidden from the accessible name - and the
 * name then ran the segments together ("lead-screener4 members", "Ana
 * Perezupdated"), which a screen reader speaks as one word. The sr-only comma is
 * the pause the dot stood for; it is taken out of flow, so it cannot change the
 * line's width or its truncation.
 */
const Dot = () => (
	<>
		<span aria-hidden="true" className="mx-1.5">
			·
		</span>
		<span className="sr-only">, </span>
	</>
);

/**
 * The composition line: `Manager: {manager} · {N} member(s): {slots}`.
 *
 * The manager and the count come first so they survive the ellipsis; the slot
 * list is the elastic tail, and the whole list is one click away. The manager is
 * NOT counted in N and a member whose role equals the manager string is NOT
 * deduplicated: the hub does not validate references (design §11 O-6), and
 * guessing is worse than showing. Labels are `ink-dim`, values `ink-muted`.
 */
const TeamComposition = ({ team }: { team: HubTeam }) => {
	const manager = team.manager?.trim();
	const count = memberCount(team);
	return (
		<span className="block truncate text-meta">
			{manager ? (
				<>
					<span className="text-ink-dim">Manager:</span>{" "}
					<span className="text-ink-muted">{manager}</span>
				</>
			) : null}
			{manager ? <Dot /> : null}
			{team.members.length === 0 ? (
				<span className="text-ink-dim">No members</span>
			) : (
				<>
					<span className="text-ink-dim">
						{count} {count === 1 ? "member" : "members"}:
					</span>{" "}
					<span className="text-ink-muted">{slotList(team)}</span>
				</>
			)}
		</span>
	);
};

/**
 * `{project} · {author} · updated {relative}`, the quietest line: context, not
 * content. Every segment is omitted when it is missing (never a placeholder, never
 * an email), and a line with nothing left is not rendered at all.
 */
const TeamProvenance = ({ team }: { team: HubTeam }) => {
	const project = team.project?.trim();
	const author = teamAuthor(team);
	const recency: TeamRecency | null = teamRecency(team);
	const segments: { key: string; node: ReactNode }[] = [];
	if (project) segments.push({ key: "project", node: project });
	if (author) segments.push({ key: "author", node: author });
	if (recency) {
		segments.push({
			key: "recency",
			node: (
				<>
					{recency.label} {/*
					 * The exact date is a POINTER-only convenience; the expanded body is
					 * the keyboard-reachable path to the same fact. `<time>` carries the
					 * machine value for assistive tech and for a copy.
					 */}
					<Tooltip content={recency.exact}>
						<time dateTime={recency.iso}>{recency.when}</time>
					</Tooltip>
				</>
			),
		});
	}
	if (segments.length === 0) return null;
	return (
		<span className="block truncate text-ink-dim text-meta">
			{segments.map((segment, index) => (
				<span key={segment.key}>
					{index > 0 ? <Dot /> : null}
					{segment.node}
				</span>
			))}
		</span>
	);
};

/**
 * The always-visible summary: identity, what it does, who leads it, who made it.
 *
 * It lives inside the disclosure's `<button>`, so it is phrasing content only
 * (spans) and nothing focusable: a scroll region in here would be an interactive
 * element nested in a button, which is why the expanded description is bounded by
 * a line clamp rather than a scroller.
 *
 * The description is the one thing that grows. At rest it is clamped to two lines
 * (about 220 characters at the roster's measure); open, the SAME element loses the
 * two-line clamp and takes `line-clamp-[12]` + `whitespace-pre-line`, so the name
 * does not move and L3/L4 keep their order. A description past the ceiling still
 * ends in an ellipsis: the pull decision does not need more, and the hub has no
 * detail surface to send it to. `break-words` holds in both states so an unbroken
 * token (a URL, a hash) wraps inside the column instead of widening the row. It is
 * rendered as plain text: it is untrusted author text, no markdown, no links.
 *
 * The description is also the row's one SELECTABLE text (`TEXT_SURFACE_PROPS` +
 * `select-text`, the marker the primitive's drag guard reads): without it a drag
 * across a sentence to copy it toggled the row instead, because the trigger owns
 * the press (UX round 1, U5). The rest of the summary stays chrome, so a press on
 * the name is still a row action.
 */
const TeamSummary = ({
	team,
	expanded,
}: { team: HubTeam; expanded: boolean }) => {
	const description = teamDescription(team);
	const version = teamVersion(team);
	return (
		<span className="flex min-w-0 flex-col">
			<span className="flex min-w-0 items-baseline">
				<span className="truncate font-medium text-body text-ink">
					{/*
					 * The display name rule, shared with the public catalogue and the agent
					 * cards: a published team's `name` is a lowercase KEY, and painting the
					 * raw key here while the public view paints its display form would let
					 * one team read two ways a tab apart.
					 */}
					{hubDisplayName(team.name)}
				</span>
				{version ? (
					<span className="ml-2 shrink-0 text-ink-dim text-meta">
						v{version}
					</span>
				) : null}
			</span>
			{description ? (
				<>
					{/*
					 * The visible description is `aria-hidden` and its text is announced
					 * from the bounded copy below: the element carries the WHOLE string
					 * even when two clamped lines are what is on screen, so the trigger's
					 * name ran to 3,095 characters on the long row (UX round 1, U6). The
					 * copy is sr-only, so it changes no pixel and no truncation.
					 */}
					<span
						{...TEXT_SURFACE_PROPS}
						aria-hidden="true"
						className={cn(
							"mt-1 select-text break-words text-body-sm text-ink-muted",
							expanded ? "line-clamp-[12] whitespace-pre-line" : "line-clamp-2",
						)}
					>
						{description}
					</span>
					{/*
					 * Q2 (QA round 2): `innerText` for this row now carries the description
					 * TWICE - once from the visible `aria-hidden` element and once from this
					 * copy - so an assertion written against `innerText` measures the
					 * duplication rather than the announcement. Target the accessible name
					 * (the text with `aria-hidden` subtrees removed, as
					 * `scripts/org-teams-summary.test.mjs` does) or this element itself.
					 */}
					<span className="sr-only">
						{announcedDescription(description, expanded)}
					</span>
				</>
			) : (
				<span className="mt-1 text-body-sm text-ink-dim">No description</span>
			)}
			<span className="mt-1 flex min-w-0 flex-col">
				<TeamComposition team={team} />
				<TeamProvenance team={team} />
			</span>
		</span>
	);
};

/**
 * What opening a row adds: the whole roster with each slot's kind, and the exact
 * dates the relative time was rounded from. Nothing else - in particular NOT the
 * `instructions` brief, which is detail-only (one `org_team.get` per team), the
 * wrong thing to skim before a pull, and would give every row a loading and an
 * error state of its own.
 *
 * ## Why it carries a label and its own air
 *
 * Without them the block read as a fifth summary line: the slot list repeated L3
 * in the same grammar, 8px under it (UX round 1, U8/U9). The `Members` label makes
 * it a block with a statement of its own, and the two `mt-1` steps - this block's
 * and the primitive's content wrapper's - open the gap: MEASURED 8.0px box-to-box
 * from L4, 9.4px text-to-text (an earlier draft of this comment said "12px", the
 * ramp step that was intended rather than the number on screen, and a later one
 * credited the primitive's `gap-2`, which is not in that distance at all: `gap-2`
 * sits BETWEEN the blocks this body renders, the roster and the dates line, and
 * there is no gap between the trigger box and the roster block; design round 2,
 * D6, corrected in the scoped confirm). No rule was added: § 2's boundary test
 * says one would earn nothing here.
 *
 * ## The one repeat, and why it survives
 *
 * `No members` is stated by L3 already, so the body omits it whenever it has
 * something else to carry (the dates line, or a manager to list). It is kept only
 * for the row that has no manager, no members AND no dates: there the disclosure
 * would otherwise open onto nothing at all, and a chevron that reveals an empty
 * box is worse than the repetition. The label makes it the block's own statement
 * rather than a fifth summary line.
 */
const TeamDetails = ({ team }: { team: HubTeam }) => {
	const manager = team.manager?.trim();
	const dates = teamDates(team);
	const dateParts = [
		dates.created ? `Created ${dates.created}` : null,
		dates.updated ? `Updated ${dates.updated}` : null,
	].filter((part) => part !== null);
	const hasRoster = Boolean(manager) || team.members.length > 0;
	return (
		<div className="mt-1 flex flex-col gap-2">
			{hasRoster || dateParts.length === 0 ? (
				<div className="flex flex-col gap-1">
					<p className="text-ink-dim text-meta">Members</p>
					<ul className="flex flex-col gap-0.5">
						{manager ? (
							<li className="flex items-baseline gap-1.5">
								{/* `ink-muted`, not `ink`: a member outshouted the description it belongs to (design round 1, D1). */}
								<span className="text-body-sm text-ink-muted">{manager}</span>
								<span className="text-ink-dim text-meta">Manager</span>
							</li>
						) : null}
						{team.members.map((slot) => (
							<li
								key={`${slot.kind}:${slot.role}`}
								className="flex items-baseline gap-1.5"
							>
								<span className="text-body-sm text-ink-muted">{slot.role}</span>
								<span className="text-ink-dim text-meta">
									{kindLabel(slot.kind)}
								</span>
								{slot.count > 1 ? (
									<span className="text-ink-dim text-meta tabular-nums">
										×{slot.count}
									</span>
								) : null}
							</li>
						))}
						{!hasRoster ? (
							<li className="text-ink-dim text-meta">No members</li>
						) : null}
					</ul>
				</div>
			) : null}
			{dateParts.length > 0 ? (
				<p className="text-ink-dim text-meta">{dateParts.join(" · ")}</p>
			) : null}
		</div>
	);
};

/**
 * One skeleton row, the row above box for box: the same `ROW_BOX`, the chevron
 * gutter (`pl-5`, 14px glyph + 6px gap) and lines whose heights are the settled
 * lines' own (`h-[1lh]` on the same type-size token, so the line box is the real
 * one and not a number kept in step by hand). Description is two bars, the meta
 * line one; the provenance line the settled row also has is the second meta bar.
 */
const TeamRowSkeleton = () => (
	<div className={cn(ROW_BOX, "pl-9")} data-testid="org-team-skeleton-row">
		<div className="flex h-[1lh] items-center text-body">
			<Skeleton className="h-4.5 w-40" />
		</div>
		<div className="mt-1 flex h-[2lh] flex-col justify-evenly text-body-sm">
			<Skeleton className="h-3.5 w-full" />
			<Skeleton className="h-3.5 w-2/3" />
		</div>
		<div className="mt-1 flex h-[1lh] items-center text-meta">
			<Skeleton className="h-3 w-64" />
		</div>
		<div className="flex h-[1lh] items-center text-meta">
			<Skeleton className="h-3 w-48" />
		</div>
	</div>
);
