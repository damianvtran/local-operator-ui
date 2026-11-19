import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
/**
 * The start-session picker: choose who a new session runs with — a team, an
 * agent, or nothing in particular — and start it against this project.
 *
 * WHAT PRESSING START DOES (the detail screen owns the write): creates the
 * session on the app's canonical store, links it to the project, seeds the
 * new session's composer with a pre-filled prompt, and lands on that chat.
 * The prompt is a DRAFT — editable, never auto-sent — which is why the button
 * that starts the session is not a send button.
 *
 * WHERE THE LISTS COME FROM: the same registries the chat feature's own
 * pickers read — `teams.list` and `profiles.list`, each behind its
 * capability (`team_catalogue` / `profile_catalogue`) — and the same rows it
 * offers: every authored team, and the non-builtin profiles (the sidebar's
 * "agents you have" — a packaged profile that is not installed yet cannot
 * answer a session, so offering it would be a control that refuses on press).
 * When the server publishes neither registry, the dialog SAYS so and leaves
 * the plain option, which is the honest degradation rather than an empty
 * picker that reads as a bug.
 */

import { agentDescriptionText } from "@features/agents/utils/agent-description";
import {
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { teamDisplayName } from "@shared/api/local-operator/team-display";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import { type SearchableOption, SearchableSelect } from "@shared/components/ui";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";

/** What the picker hands back: who the session runs with. */
export type StartSessionSelection =
	| { kind: "plain" }
	| { kind: "team"; name: string }
	| { kind: "agent"; name: string };

export type ProjectStartSessionDialogProps = {
	open: boolean;
	onClose: () => void;
	/**
	 * Creates, links, pre-fills and lands on the session. Rejecting rejects the
	 * dialog's own promise: the sentence is shown IN the dialog (the form
	 * dialog's rule) and nothing else on screen changes.
	 */
	onStart: (selection: StartSessionSelection) => Promise<void>;
	/** Whether this server advertises the two registries (capability gates). */
	teamsEnabled: boolean;
	profilesEnabled: boolean;
};

/** The option id shape: `plain`, `team:<name>` or `agent:<name>`. */
const PLAIN_OPTION_ID = "plain";
const teamOptionId = (name: string) => `team:${name}`;
const agentOptionId = (name: string) => `agent:${name}`;

function selectionFromOptionId(id: string): StartSessionSelection {
	if (id.startsWith("team:")) return { kind: "team", name: id.slice(5) };
	if (id.startsWith("agent:")) return { kind: "agent", name: id.slice(6) };
	return { kind: "plain" };
}

function optionIdFor(selection: StartSessionSelection): string {
	if (selection.kind === "team") return teamOptionId(selection.name);
	if (selection.kind === "agent") return agentOptionId(selection.name);
	return PLAIN_OPTION_ID;
}

export const START_SESSION_PLAIN: StartSessionSelection = { kind: "plain" };

export const ProjectStartSessionDialog: FC<ProjectStartSessionDialogProps> = ({
	open,
	onClose,
	onStart,
	teamsEnabled,
	profilesEnabled,
}) => {
	/*
	 * Bound rather than called for its effect: the option list keys shipped seed
	 * copy inside its memo, so the locale has to be one of that memo's deps or a
	 * language switch would leave the dialog printing the previous language.
	 */
	const locale = useI18nLocale();
	const [selection, setSelection] =
		useState<StartSessionSelection>(START_SESSION_PLAIN);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	/*
	 * Lazy on purpose: both reads mount with the dialog's first open and never
	 * before, so a project page that is only being read does not spend two
	 * catalogue queries (the sidebar's own rule for these two lists).
	 */
	const teams = useTeams(open && teamsEnabled);
	const profiles = useProfiles(open && profilesEnabled);

	useEffect(() => {
		if (!open) return;
		setSelection(START_SESSION_PLAIN);
		setRefusal(null);
		setSubmitting(false);
	}, [open]);

	const options = useMemo<SearchableOption[]>(() => {
		/* The dependency the seed copy below is read through - see the binding. */
		void locale;
		const rows: SearchableOption[] = [
			{
				id: PLAIN_OPTION_ID,
				get name() {
					return t("ui.projects.project_start_session.nothing_in_particular");
				},
				get description() {
					return t(
						"ui.projects.project_start_session.a_plain_session_assign_a_team_or_agent_later",
					);
				},
				get group() {
					return t("ui.projects.project_start_session.plain");
				},
			},
		];
		for (const team of teams.data ?? []) {
			rows.push({
				id: teamOptionId(team.name),
				/*
				 * The READABLE name; the id above stays `teamOptionId(team.name)`,
				 * so a pick parses back to the slug `sessions.create` is sent.
				 */
				name: teamDisplayName(team),
				/*
				 * THE SLUG STAYS FINDABLE BESIDE THE LABEL (round 1, R1-1). `name`
				 * is what the filter matches by default, so the moment this option
				 * started showing the label, typing the team's actual key
				 * (`release-crew`) into the field found NOTHING - every sibling
				 * surface keeps the key reachable (the `/team` popup republishes
				 * it as an alias, the sidebar and roster filters match name OR
				 * label), and this dialog now carries the same second term
				 * through the shared control's `keywords` slot.
				 */
				keywords: team.name === teamDisplayName(team) ? undefined : [team.name],
				description: t(
					"ui.projects.project_start_session.team_manager_manager",
					{ manager: String(team.manager) },
				),
				get group() {
					return t("ui.projects.project_start_session.teams");
				},
			});
		}
		/*
		 * THE SHIPPED SENTENCE, NOT THE FIELD (agent review round 1, R1-2). These are
		 * profiles-registry rows, so they carry the `source` the resolution needs, and
		 * an INSTALLED seed serves its routing text in this field - English unless it
		 * resolves to a key. `|| profile.kind` stays: a row with no description still
		 * shows what kind of agent it is rather than an empty line.
		 */
		for (const profile of (profiles.data ?? []).filter(
			(row) => row.source !== "builtin",
		)) {
			rows.push({
				id: agentOptionId(profile.name),
				name: profile.name,
				description: agentDescriptionText(profile) || profile.kind,
				get group() {
					return t("ui.projects.project_start_session.agents");
				},
			});
		}
		return rows;
	}, [teams.data, profiles.data, locale]);

	const selectedOption =
		options.find((option) => option.id === optionIdFor(selection)) ??
		options[0];

	const registriesMissing = !teamsEnabled || !profilesEnabled;
	const busy = teams.isLoading || profiles.isLoading;

	const submit = async () => {
		setSubmitting(true);
		setRefusal(null);
		try {
			await onStart(selection);
			onClose();
		} catch (error) {
			setRefusal(
				error instanceof Error && error.message
					? error.message
					: t(
							"ui.projects.project_start_session.the_session_could_not_be_started",
						),
			);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={t("ui.projects.project_start_session.start_a_session")}
			maxWidth="sm"
			dataTourTag="project-start-session-dialog"
			actions={
				<>
					<SecondaryButton onClick={onClose} disabled={submitting}>
						{t("ui.projects.project_start_session.cancel")}
					</SecondaryButton>
					<PrimaryButton onClick={() => void submit()} disabled={submitting}>
						{submitting && <Spinner size="xs" />}
						{t("ui.projects.project_start_session.start_session")}
					</PrimaryButton>
				</>
			}
		>
			<div className="flex flex-col gap-4 px-1 py-1">
				<SearchableSelect
					label={t("ui.projects.project_start_session.work_with")}
					placeholder={t(
						"ui.projects.project_start_session.search_teams_and_agents",
					)}
					options={options}
					selected={selectedOption}
					onSelect={(option) => setSelection(selectionFromOptionId(option.id))}
					busy={busy}
					busyLabel={t(
						"ui.projects.project_start_session.loading_teams_and_agents",
					)}
				/>
				<p className="text-meta text-ink-muted">
					{t(
						"ui.projects.project_start_session.the_session_starts_now_links_itself_to_this_project_and_opens_wit",
					)}
				</p>
				{registriesMissing && (
					<p className="text-meta text-ink-muted">
						{t(
							"ui.projects.project_start_session.this_server_does_not_offer_the_team_or_agent_catalogues_yet_so_on",
						)}
					</p>
				)}
				{refusal && <p className="text-body-sm text-danger">{refusal}</p>}
			</div>
		</BaseDialog>
	);
};
