/**
 * One team's detail pane — the manager and the members first, because they are
 * what a team IS (design consult § 5), then the briefs.
 *
 * The findings this answers, in order: names were free text so a typo'd member
 * saved silently and was shown as an ordinary row with no warning (U7, D2); the
 * member's "Nested team" option was the wire's `kind` leaking into the UI
 * (branding § 5); the count was a bare number input with no bounds offered; and
 * every action carried the same outline weight so nothing was primary (D5).
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not invent a `teams.*` delete: no
 * desktop op deletes a team (`desktop_profiles.py` registers get/list/create/
 * update and nothing else — design consult § 1), so there is no Delete control
 * at all rather than one that cannot work. It also does not rename an existing
 * team: chats and schedules address a team by name, and the wire's rename path
 * is unverified from this side, so the name is a read-only fact in edit mode and
 * only a create can choose one.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type {
	ReusableProfile,
	ReusableTeam,
	TeamMember,
} from "@shared/api/local-operator/profile-hooks";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@shared/components/ui/alert";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Disclosure } from "@shared/components/ui/disclosure";
import { Input } from "@shared/components/ui/input";
import { SearchableSelect } from "@shared/components/ui/searchable-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui/select";
import { Textarea } from "@shared/components/ui/textarea";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { Minus, Plus } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type FieldTarget, refusalCopy } from "../utils/backend-copy";
import {
	EditFooter,
	FieldLabel,
	ReadBlock,
	Section,
	consumeHeadingFocus,
	requestHeadingFocus,
	useEscapeToCancel,
} from "./detail-parts";

type MemberRow = TeamMember & { key: string };

type Draft = {
	description: string;
	manager: string;
	members: MemberRow[];
	instructions: string;
	project: string;
};

function draftOf(team?: ReusableTeam): Draft {
	return {
		description: team?.description ?? "",
		manager: team?.manager ?? "manager",
		members: (team?.members ?? []).map((member) => ({
			...member,
			key: crypto.randomUUID(),
		})),
		instructions: team?.instructions ?? "",
		project: team?.project ?? "",
	};
}

function changedFields(base: Draft, draft: Draft): Record<string, unknown> {
	const changed: Record<string, unknown> = {};
	if (draft.description !== base.description)
		changed.description = draft.description;
	if (draft.manager !== base.manager) changed.manager = draft.manager;
	if (
		JSON.stringify(draft.members.map(({ key: _k, ...rest }) => rest)) !==
		JSON.stringify(base.members.map(({ key: _k, ...rest }) => rest))
	) {
		changed.members = draft.members.map(({ key: _k, ...rest }) => rest);
	}
	if (draft.instructions !== base.instructions)
		changed.instructions = draft.instructions;
	if (draft.project !== base.project) changed.project = draft.project;
	return changed;
}

/**
 * Whether a member row's name resolves to something on this machine.
 *
 * THE CHECK IS THE POINT OF THE FEATURE, not decoration: `no-such-agent` used to
 * save and render as an ordinary row (U7), so the page could not tell the
 * operator about a member that will never start. The backend refuses unresolved
 * member names on WRITE (`validate_target`), which means this can only ever be
 * shown for a row that already exists on disk — a name someone else removed, or
 * one written by an older build — and that is exactly the case a warning chip is
 * for.
 */
function memberResolution(
	member: TeamMember,
	agents: readonly ReusableProfile[] | undefined,
	teams: readonly ReusableTeam[] | undefined,
): boolean {
	const pool =
		member.kind === "agent"
			? (agents ?? []).map((row) => row.name)
			: (teams ?? []).map((row) => row.name);
	return pool.includes(member.role);
}

export function TeamDetail({
	team,
	agents,
	teams,
	askEnabled,
	onSaved,
	onCancelCreate,
	onOpenAgent,
	onAskAgent,
	onDirtyChange,
}: {
	/** Absent = creating a new team. */
	team?: ReusableTeam;
	agents: readonly ReusableProfile[] | undefined;
	teams: readonly ReusableTeam[] | undefined;
	askEnabled: boolean;
	onSaved: (name: string) => void;
	onCancelCreate?: () => void;
	onOpenAgent: (name: string) => void;
	onAskAgent: (prompt: string) => void;
	/** Reports an open edit with unsaved typing, so the page can hold the composer. */
	onDirtyChange?: (dirty: boolean) => void;
}) {
	const creating = !team;
	const [editing, setEditing] = useState(creating);
	const [name, setName] = useState(team?.name ?? "");
	const [base, setBase] = useState<Draft>(() => draftOf(team));
	const [draft, setDraft] = useState<Draft>(() => draftOf(team));
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<FieldTarget>(null);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	/** The collaboration field, so a refused create puts the caret in it (D14). */
	const teamInstructionsRef = useRef<HTMLTextAreaElement>(null);
	/**
	 * The create form's name field, so a refusal can put the caret in it (U3).
	 *
	 * WHY A REF WHEN THE INPUT IS ALREADY `autoFocus`. `autoFocus` only fires
	 * when the form MOUNTS; every refusal below happens with focus already on the
	 * Create button, so the field the sentence is about was left behind the
	 * operator's eye and hand.
	 */
	const teamNameRef = useRef<HTMLInputElement>(null);

	/* A pane opened by a Create takes the caret itself (QA Q7) — see the note on
	 * the handoff in `detail-parts`.
	 */
	useEffect(() => {
		if (!consumeHeadingFocus()) return;
		requestAnimationFrame(() => headingRef.current?.focus());
	}, []);
	const navigate = useNavigate();

	const dirty = creating
		? Boolean(name.trim() || draft.description || draft.members.length)
		: JSON.stringify(draft) !== JSON.stringify(base);

	// The same upward report as the agent pane's: an open unsaved edit holds the
	// composer, so a configuration run cannot write over typing.
	useEffect(() => {
		onDirtyChange?.((creating || editing) && dirty);
		/*
		 * AND WITHDRAWN ON THE WAY OUT — see the agent pane's note (review round 1,
		 * M1): a stale `true` locks the composer with no editor open.
		 */
		return () => onDirtyChange?.(false);
	}, [onDirtyChange, creating, editing, dirty]);

	useEffect(() => {
		if (editing && dirty) return;
		const next = draftOf(team);
		setBase(next);
		setDraft(next);
	}, [team, editing, dirty]);

	const cancel = () => {
		if (creating) {
			onCancelCreate?.();
			return;
		}
		setEditing(false);
		setError(null);
		setErrorField(null);
		setConfirmDiscard(false);
		const next = draftOf(team);
		setBase(next);
		setDraft(next);
	};

	// Escape asks what Cancel asks - see the agent pane's note (UX U3).
	const requestCancel = () => {
		if (confirmDiscard) {
			setConfirmDiscard(false);
			return;
		}
		if (dirty) setConfirmDiscard(true);
		else cancel();
	};
	useEscapeToCancel(requestCancel, editing);

	const save = async (event?: FormEvent) => {
		event?.preventDefault();
		if (pending) return;
		/*
		 * THE REFUSALS THE FORM CAN ANSWER ITSELF (QA round 1, Q3; design D5).
		 * A bare "New team" with nothing filled reached the wire and came back as
		 * the contract's own "Invalid desktop operation." — the same class of
		 * developer-voiced refusal the agent form used to answer, and the most
		 * likely first failure here.
		 */
		if (creating && !name.trim()) {
			setError("Give the team a name.");
			setErrorField("name");
			teamNameRef.current?.focus();
			return;
		}
		if (creating && /[\\/\s]/.test(name.trim())) {
			setError("Names cannot contain spaces or slashes.");
			setErrorField("name");
			teamNameRef.current?.focus();
			return;
		}
		if (creating && (teams ?? []).some((row) => row.name === name.trim())) {
			setError(
				`A team called “${name.trim()}” already exists. Open it to change it, or choose another name.`,
			);
			setErrorField("name");
			teamNameRef.current?.focus();
			return;
		}
		if (creating && !draft.instructions.trim()) {
			setError("Give the team instructions.");
			setErrorField("instructions");
			teamInstructionsRef.current?.focus();
			return;
		}
		setPending(true);
		setError(null);
		setErrorField(null);
		try {
			const result = team
				? await desktopResult<ReusableTeam>({
						op: "teams.update",
						name: team.name,
						requestId: crypto.randomUUID(),
						fields: changedFields(base, draft),
					})
				: await desktopResult<ReusableTeam>({
						op: "teams.create",
						requestId: crypto.randomUUID(),
						fields: {
							name,
							description: draft.description,
							manager: draft.manager,
							members: draft.members.map(({ key: _k, ...rest }) => rest),
							instructions: draft.instructions,
							project: draft.project,
						},
					});
			const next = draftOf(result);
			setBase(next);
			setDraft(next);
			setEditing(false);
			onSaved(result.name);
			/*
			 * "CREATED" FOR A CREATE, "SAVED" FOR AN EDIT (review round 1, UX nit):
			 * the agent form already said Created, so the same act had two names.
			 */
			showSuccessToast(`${creating ? "Created" : "Saved"} ${result.name}.`);
			if (creating) requestHeadingFocus();
			requestAnimationFrame(() => headingRef.current?.focus());
		} catch (caught) {
			const copy = refusalCopy(
				caught instanceof Error
					? caught.message
					: "The team could not be saved.",
			);
			setError(copy.message);
			setErrorField(copy.field);
			showErrorToast(copy.message);
		} finally {
			setPending(false);
		}
	};

	const updateMember = (index: number, patch: Partial<TeamMember>) =>
		setDraft((current) => ({
			...current,
			members: current.members.map((row, position) =>
				position === index ? { ...row, ...patch } : row,
			),
		}));

	const memberCount = (
		draft.members.length ? draft.members : (team?.members ?? [])
	).reduce((total, member) => total + (member.count || 1), 0);

	return (
		<div className="max-w-3xl space-y-6">
			<header className="space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
					<div className="min-w-0 space-y-2">
						<h2
							ref={headingRef}
							tabIndex={-1}
							className="text-title focus:outline-none"
						>
							{team ? team.name : "New team"}
						</h2>
						<div className="flex flex-wrap items-center gap-1.5">
							<Badge variant="neutral">
								{memberCount === 1 ? "1 agent" : `${memberCount} agents`}
							</Badge>
							{draft.members.some((member) => member.kind === "team") ? (
								<Badge variant="neutral">Includes a team</Badge>
							) : null}
						</div>
					</div>
					{team ? (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="primary"
								onClick={() => {
									useCanonicalSessionsStore
										.getState()
										.stageDraft({ kind: "team", name: team.name });
									navigate("/chat");
								}}
							>
								New team chat
							</Button>
							{!editing ? (
								<Button variant="secondary" onClick={() => setEditing(true)}>
									Edit
								</Button>
							) : null}
							{askEnabled ? (
								<Button
									variant="ghost"
									onClick={() => onAskAgent(`Change the team ${team.name}: `)}
								>
									Ask for a change
								</Button>
							) : null}
						</div>
					) : null}
				</div>
				{/*
				 * THE BANNER IS FOR ERRORS THAT HAVE NO FIELD (design review round 3,
				 * D16; UX U3). A missing required field is answered beside that field,
				 * where the operator is already looking — and the banner made one
				 * mistake read twice, titled "That did not save", which is a
				 * save/transport framing for what was a blank box. The agent form in
				 * this same delta already splits it this way; this is that shape.
				 */}
				{error && !errorField ? (
					<Alert variant="danger" role="alert" data-testid="team-save-error">
						<AlertTitle>That did not save</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
			</header>

			{/* noValidate — the team form validates in `save()` (D14). */}
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void save(event);
				}}
				className="space-y-6"
			>
				{creating || editing ? (
					<>
						{creating ? (
							<Section
								title="Name"
								description="How you and your chats will refer to this team."
							>
								<FieldLabel
									label="Team name"
									htmlFor="team-name"
									error={errorField === "name" ? error : null}
								/>
								<Input
									ref={teamNameRef}
									id="team-name"
									data-testid="team-name-input"
									value={name}
									required
									maxLength={64}
									autoFocus
									aria-invalid={errorField === "name"}
									onChange={(event) => setName(event.target.value)}
								/>
							</Section>
						) : null}
						<Section
							title="Manager"
							description="The agent that leads the chat and decides who works on what."
						>
							<div className="max-w-md space-y-2">
								<FieldLabel
									label="Manager agent"
									htmlFor="team-manager"
									error={errorField === "manager" ? error : null}
								/>
								<SearchableSelect
									ariaLabel="Manager agent"
									showLabel={false}
									placeholder="Choose a manager"
									busyLabel="Loading agents"
									options={managerOptions(agents, teams)}
									selected={
										managerOptions(agents, teams).find(
											(option) => option.id === draft.manager,
										) ?? null
									}
									onSelect={(option) =>
										setDraft((current) => ({ ...current, manager: option.id }))
									}
									onCustomSubmit={(text) =>
										setDraft((current) => ({ ...current, manager: text }))
									}
									listNotice="Agents and teams on this machine"
								/>
								{!managerOptions(agents, teams).some(
									(option) => option.id === draft.manager,
								) ? (
									<Badge variant="warning" data-testid="team-manager-missing">
										Not found: {draft.manager}
									</Badge>
								) : null}
							</div>
						</Section>
						<Section
							title="Members"
							description="Who the manager can delegate to, and how many of each."
						>
							<div className="space-y-2">
								{draft.members.map((member, index) => {
									const missing = !memberResolution(member, agents, teams);
									return (
										<div
											key={member.key}
											className="flex flex-wrap items-center gap-2"
										>
											<div className="w-56">
												<SearchableSelect
													ariaLabel={`Member ${index + 1}`}
													showLabel={false}
													placeholder="Choose an agent or team"
													busyLabel="Loading agents"
													options={[
														...managerOptions(agents, teams).filter((option) =>
															member.kind === "team"
																? option.group === "Teams"
																: option.group === "Agents",
														),
													]}
													selected={
														managerOptions(agents, teams).find(
															(option) => option.id === member.role,
														) ?? null
													}
													onSelect={(option) =>
														updateMember(index, {
															role: option.id,
															kind: option.group === "Teams" ? "team" : "agent",
														})
													}
													onCustomSubmit={(text) =>
														updateMember(index, { role: text })
													}
												/>
											</div>
											<Select
												value={member.kind}
												onValueChange={(value) =>
													updateMember(index, {
														kind: value as "agent" | "team",
													})
												}
											>
												<SelectTrigger
													aria-label={`Member ${index + 1} kind`}
													className="w-32"
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="agent">Agent</SelectItem>
													<SelectItem value="team">Team</SelectItem>
												</SelectContent>
											</Select>
											{/*
											 * A stepper rather than a bare number input: the wire bounds
											 * the count at 1..16 and the old control offered no bound at
											 * all, so the only way to learn one was to be refused.
											 */}
											<div className="flex items-center gap-1">
												<Button
													variant="secondary"
													size="icon-sm"
													aria-label={`One fewer ${member.role}`}
													disabled={member.count <= 1}
													onClick={() =>
														updateMember(index, { count: member.count - 1 })
													}
												>
													<Minus aria-hidden="true" />
												</Button>
												<span
													className="min-w-6 text-center text-body-sm tabular-nums"
													aria-label={`${member.count} of ${member.role}`}
												>
													{member.count}
												</span>
												<Button
													variant="secondary"
													size="icon-sm"
													aria-label={`One more ${member.role}`}
													disabled={member.count >= 16}
													onClick={() =>
														updateMember(index, { count: member.count + 1 })
													}
												>
													<Plus aria-hidden="true" />
												</Button>
											</div>
											<Button
												variant="ghost"
												onClick={() =>
													setDraft((current) => ({
														...current,
														members: current.members.filter(
															(_, position) => position !== index,
														),
													}))
												}
											>
												Remove
											</Button>
											{missing ? (
												<Badge variant="warning">
													Not found: {member.role}
												</Badge>
											) : null}
										</div>
									);
								})}
								<Button
									variant="secondary"
									onClick={() =>
										setDraft((current) => ({
											...current,
											members: [
												...current.members,
												{
													role: "",
													count: 1,
													kind: "agent",
													key: crypto.randomUUID(),
												},
											],
										}))
									}
								>
									Add member
								</Button>
							</div>
						</Section>
						<Section title="Description">
							<FieldLabel
								label="What this team is for"
								htmlFor="team-description"
								error={errorField === "description" ? error : null}
							/>
							<Input
								id="team-description"
								value={draft.description}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										description: event.target.value,
									}))
								}
							/>
						</Section>
						<Section title="Collaboration instructions">
							{/*
							 * THE REFUSAL LANDS ON THE FIELD (design review round 3, D16).
							 * The sentence used to live only in the top banner, 300-plus px
							 * ABOVE this textarea, measured off-screen at the moment of the
							 * refusal — so the operator saw a focused empty box and no
							 * explanation. Same register as `FieldLabel`'s own error line.
							 */}
							{errorField === "instructions" ? (
								<p
									className="text-meta text-danger"
									role="alert"
									data-testid="team-instructions-error"
								>
									{error}
								</p>
							) : null}
							<Textarea
								ref={teamInstructionsRef}
								aria-label="Collaboration instructions"
								aria-invalid={errorField === "instructions"}
								className="min-h-36"
								maxLength={8000}
								value={draft.instructions}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										instructions: event.target.value,
									}))
								}
							/>
						</Section>
						<Section title="Project brief">
							<Textarea
								aria-label="Project brief"
								className="min-h-36"
								maxLength={8000}
								value={draft.project}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										project: event.target.value,
									}))
								}
							/>
						</Section>
						<EditFooter
							submit
							confirming={confirmDiscard}
							onConfirmingChange={setConfirmDiscard}
							dirty={dirty}
							pending={pending}
							saveLabel={creating ? "Create team" : "Save changes"}
							pendingLabel={creating ? "Creating…" : "Saving…"}
							dirtyHint="Discard this team?"
							onSave={() => void save()}
							onCancel={cancel}
						/>
					</>
				) : (
					<>
						<Section
							title="Manager"
							description="The agent that leads the chat."
						>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									variant="link"
									onClick={() => onOpenAgent(draft.manager)}
								>
									{draft.manager}
								</Button>
								{/*
								 * THE MANAGER GETS THE SAME "Not found" CHIP THE MEMBERS DO (QA round
								 * 1, Q6). The edit view already marked a dangling manager, so the read
								 * view was the one place a missing manager still read as a working
								 * link that navigates nowhere.
								 */}
								{!managerOptions(agents, teams).some(
									(option) => option.id === draft.manager,
								) ? (
									<Badge variant="warning" data-testid="team-manager-missing">
										Not found
									</Badge>
								) : null}
							</div>
						</Section>
						<Section title="Members">
							<ul className="space-y-1">
								{(team?.members ?? []).map((member) => (
									<li
										key={`${member.kind}:${member.role}`}
										className="flex flex-wrap items-center gap-2 text-body-sm"
									>
										<span className="text-ink">{member.role}</span>
										<Badge variant="neutral">
											{member.kind === "team" ? "Team" : "Agent"}
										</Badge>
										<span className="text-ink-muted">
											{member.count === 1 ? "×1" : `×${member.count}`}
										</span>
										{!memberResolution(member, agents, teams) ? (
											<Badge
												variant="warning"
												data-testid="team-member-missing"
											>
												Not found
											</Badge>
										) : null}
									</li>
								))}
							</ul>
						</Section>
						<Section title="What it is for">
							<ReadBlock
								text={team?.description ?? ""}
								empty="No description yet."
							/>
						</Section>
						{team?.instructions ? (
							<Section title="Collaboration instructions">
								<ReadBlock text={team.instructions} />
							</Section>
						) : null}
						{team?.project ? (
							<Disclosure summary="Project brief">
								<ReadBlock text={team.project} />
							</Disclosure>
						) : null}
					</>
				)}
			</form>
		</div>
	);
}

/** Agents and teams on this machine, grouped, as `SearchableOption`s. */
function managerOptions(
	agents: readonly ReusableProfile[] | undefined,
	teams: readonly ReusableTeam[] | undefined,
) {
	return [
		...(agents ?? []).map((agent) => ({
			id: agent.name,
			name: agent.name,
			description: agent.description,
			group: "Agents",
		})),
		...(teams ?? []).map((row) => ({
			id: row.name,
			name: row.name,
			description: row.description,
			group: "Teams",
		})),
	];
}
