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
} from "@shared/components/ui";
import { useMemo, useState } from "react";
import { useOrgTeamsQuery } from "../hooks/use-org-teams-query";
import { useTeamPullMutation } from "../hooks/use-team-pull-mutation";
import { orgRefusalFromError } from "../org-access";

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
 * The org scope's team roster, with the one action v1 gives it (design §8.4:
 * "v1 renders org teams as a list on the hub page (pull action); no new
 * top-level navigation").
 *
 * ## Why it is not a page
 *
 * A team hub would need its own navigation, its own empty, its own moderation
 * story — and the desktop owns presentation only (§8.4): every semantic here
 * comes from `org_teams.list` and `org_team.get`. So the roster is a section of
 * the surface the user is already on, and the action is the one the route
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
	/** Whether the shared re-sign-in panel is open in place of the action row. */
	const [reauthenticating, setReauthenticating] = useState(false);

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
			className="mb-6 rounded-lg border border-hairline bg-surface"
			aria-labelledby="org-teams-heading"
			data-testid="org-teams"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 pb-2">
				<h2
					id="org-teams-heading"
					className="font-medium text-heading text-ink"
				>
					Teams
				</h2>
				{/*
				 * A count line in the same voice as the agent grid's own ("30 agents"),
				 * and it says nothing while the read is in flight: the roster below is
				 * what a reader watches.
				 */}
				{!isLoading && !isError && (
					<p className="text-meta text-ink-dim" data-testid="org-teams-count">
						{teams.length} {teams.length === 1 ? "team" : "teams"} shared with{" "}
						{orgName ?? "this organization"}
					</p>
				)}
			</div>

			{isLoading && (
				/*
				 * The skeletons are `aria-hidden` with one `sr-only` line beside them, the
				 * hub's own loading pattern (`Loading agents…`): a pair of bare skeletons is
				 * a silent state to a screen reader, and this roster is the only section on
				 * the page without a loading sentence (copy review round 1, C6).
				 */
				<div
					className="flex flex-col gap-2 px-4 pb-4"
					data-testid="org-teams-loading"
				>
					<span className="sr-only">Loading teams…</span>
					<div aria-hidden="true" className="flex flex-col gap-2">
						<Skeleton className="h-4.5 w-40" />
						<Skeleton className="h-3.5 w-64" />
					</div>
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
					className="mx-4 mb-4"
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
					className="px-4 pb-4 text-body-sm text-ink-muted"
					data-testid="org-teams-empty"
				>
					No teams have been shared with this organization yet.
				</p>
			)}

			{!isLoading && !isError && teams.length > 0 && (
				<ul className="flex flex-col divide-y divide-hairline border-t border-hairline">
					{teams.map((team) => (
						<li
							key={team.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
						>
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="truncate font-medium text-body text-ink">
									{team.name}
								</span>
								<span className="truncate text-meta text-ink-muted">
									{team.project || "No project"}
									<span aria-hidden="true" className="mx-1.5">
										·
									</span>
									{slotSummary(team)}
									{team.version ? (
										<>
											<span aria-hidden="true" className="mx-1.5">
												·
											</span>
											v{team.version}
										</>
									) : null}
								</span>
								{failedTeamId === team.id && (
									/*
									 * `<output>` rather than a `div` with `role="status"`: the element carries
									 * the role itself. The sentence is the treatment's when the refusal was
									 * CODED — which is what gives `team_not_found` its body and its refresh
									 * control — and the transport's own otherwise.
									 */
									<div
										className="mt-1 flex flex-col items-start gap-1"
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
							</div>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => handlePull(team)}
								disabled={pull.isPending}
								aria-label={`Pull team ${team.name}`}
							>
								{pullingTeamId === team.id ? "Pulling…" : "Pull"}
							</Button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
};

/**
 * The roster slots, spelled the way the document stores them.
 *
 * `count` is how many of that slot the team declares, and a slot of one is the
 * common case — which is why `1` is dropped rather than printed: "manager, 2
 * specialists" reads as a roster, "manager ×1, specialist ×2" reads as a
 * spreadsheet. An empty roster says so; a team with no members is a real
 * document (the published brief is not validated against the registry, §11 O-6).
 */
const slotSummary = (team: HubTeam): string => {
	if (team.members.length === 0) return "No members";
	return team.members
		.map((slot) => (slot.count > 1 ? `${slot.role} ×${slot.count}` : slot.role))
		.join(", ");
};
