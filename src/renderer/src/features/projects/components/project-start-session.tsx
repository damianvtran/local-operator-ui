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
		const rows: SearchableOption[] = [
			{
				id: PLAIN_OPTION_ID,
				name: "Nothing in particular",
				description: "A plain session; assign a team or agent later.",
				group: "Plain",
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
				description: `Team · manager: ${team.manager}`,
				group: "Teams",
			});
		}
		for (const profile of (profiles.data ?? []).filter(
			(row) => row.source !== "builtin",
		)) {
			rows.push({
				id: agentOptionId(profile.name),
				name: profile.name,
				description: profile.description || profile.kind,
				group: "Agents",
			});
		}
		return rows;
	}, [teams.data, profiles.data]);

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
					: "The session could not be started.",
			);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title="Start a session"
			maxWidth="sm"
			dataTourTag="project-start-session-dialog"
			actions={
				<>
					<SecondaryButton onClick={onClose} disabled={submitting}>
						Cancel
					</SecondaryButton>
					<PrimaryButton onClick={() => void submit()} disabled={submitting}>
						{submitting && <Spinner size="xs" />}
						Start session
					</PrimaryButton>
				</>
			}
		>
			<div className="flex flex-col gap-4 px-1 py-1">
				<SearchableSelect
					label="Work with"
					placeholder="Search teams and agents"
					options={options}
					selected={selectedOption}
					onSelect={(option) => setSelection(selectionFromOptionId(option.id))}
					busy={busy}
					busyLabel="Loading teams and agents"
				/>
				<p className="text-meta text-ink-muted">
					The session starts now, links itself to this project, and opens with a
					prompt you can edit before sending.
				</p>
				{registriesMissing && (
					<p className="text-meta text-ink-muted">
						This server does not offer the team or agent catalogues yet, so only
						a plain session can be started.
					</p>
				)}
				{refusal && <p className="text-body-sm text-danger">{refusal}</p>}
			</div>
		</BaseDialog>
	);
};
