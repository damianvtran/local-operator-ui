/**
 * One agent's detail pane: read first, an explicit Edit mode, and the actions
 * that belong to the definition rather than to a form.
 *
 * WHAT THIS REPLACES AND WHY EACH PART CHANGED (design consult D1–D6, UX
 * exploration U3–U10). The old pane was a `<fieldset disabled>` around the same
 * seven inputs for every agent — built-in, installed and custom — so a read-only
 * view painted exactly like an editable one (measured: identical ink, fill and
 * border; only `cursor` differed) and the instructions, as a disabled textarea,
 * could not be read or even scrolled by keyboard. Editing had no Cancel, Escape
 * did nothing, and leaving the pane dropped the typed draft silently. A failed
 * save dead-locked the form until the window was reloaded (U1, the blocker), the
 * save sent EVERY field so it silently reverted an out-of-band write (U5), and
 * Extend carried the on-screen draft and the stale error across (U9) while
 * succeeding under the built-in's own name as a custom shadow copy (U10).
 *
 * The shape here is the remedy for each of those, in the same order: a read view
 * that is prose rather than disabled inputs; an Edit mode with its own Save and
 * Cancel; a footer that confirms before discarding; a save that mints a FRESH
 * request id per attempt, so no refusal can lock the form; a save
 * that sends the changed fields alone, with a banner when the record moved under
 * the draft; and a Duplicate that takes the FETCHED record, clears the error,
 * focuses the name, and suggests a name that cannot collide.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type {
	ReusableProfile,
	ReusableTeam,
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
import { Switch } from "@shared/components/ui/switch";
import { Textarea } from "@shared/components/ui/textarea";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { LogIn } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	type FieldTarget,
	duplicateNameCandidates,
	refusalCopy,
} from "../utils/backend-copy";
import {
	EditFooter,
	FieldLabel,
	ReadBlock,
	Section,
	SourceChip,
	consumeHeadingFocus,
	requestHeadingFocus,
	useEscapeToCancel,
} from "./detail-parts";

/** The fields this pane can write. Deliberately not `name`/`kind`: the tool
 *  cannot rename or re-kind an existing profile (`agent_tool.py`), so offering
 *  a field the save would ignore is how a form lies. Both are set at creation,
 *  where they are real. */
type Draft = {
	description: string;
	instructions: string;
	/** `null` = every tool (the wire's "inherit"); a list = an allow-list. */
	tools: string[] | null;
	effort: string;
	delegate: boolean;
};

const TOOL_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

function draftOf(profile: ReusableProfile): Draft {
	return {
		description: profile.description ?? "",
		instructions: profile.instructions ?? "",
		/*
		 * `tools: null` and an empty list BOTH mean "all tools" on the wire —
		 * `agent_tool.py` writes `tuple(params.tools) or None` — so the draft
		 * models the distinction the operator can actually make, and the read view
		 * says "All tools" rather than showing an empty chip row.
		 */
		tools:
			profile.tools && profile.tools.length > 0 ? [...profile.tools] : null,
		effort: profile.effort ?? "inherit",
		delegate: profile.delegate ?? false,
	};
}

/** What a save would actually change, as the wire's own field names. */
function changedFields(base: Draft, draft: Draft): Record<string, unknown> {
	const changed: Record<string, unknown> = {};
	if (draft.description !== base.description)
		changed.description = draft.description;
	if (draft.instructions !== base.instructions)
		changed.instructions = draft.instructions;
	/*
	 * `[]` rather than `null` for "every tool", the same wire reading the create
	 * path uses: an OMITTED `tools` means "unchanged" on an update (the backend
	 * merges with `exclude_unset`), so clearing an allow-list has to be said with
	 * the empty list, which `write_profile` turns back into `None`.
	 */
	if (JSON.stringify(draft.tools) !== JSON.stringify(base.tools))
		changed.tools = draft.tools ?? [];
	if (draft.effort !== base.effort) changed.effort = draft.effort;
	if (draft.delegate !== base.delegate) changed.delegate = draft.delegate;
	return changed;
}

/** Chips for a profile, only where a value is worth saying (design D3). */
function AgentChips({ profile }: { profile: ReusableProfile }) {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<SourceChip source={profile.source} />
			{profile.divergent_fields?.length ? (
				<Badge variant="warning">Modified</Badge>
			) : null}
			{profile.kind === "specialist" ? (
				<Badge variant="neutral">Specialist</Badge>
			) : null}
			{profile.delegate ? <Badge variant="neutral">Delegates</Badge> : null}
			{profile.tools && profile.tools.length > 0 ? (
				<Badge variant="neutral">
					{profile.tools.length === 1
						? "1 tool"
						: `${profile.tools.length} tools`}
				</Badge>
			) : null}
		</div>
	);
}

/**
 * The tools allow-list, as a chip editor.
 *
 * WHY CHIPS AND NOT THE COMMA STRING (UX U7, D2). The old field was a text input
 * the user comma-separated by hand, and it accepted `read, not_a_tool` on save
 * with nothing said: a tool name is a reference, and a reference typed by hand
 * has no way to be wrong out loud. This editor cannot fix the missing catalogue
 * (design consult Q3 — there is no tool-name list on the wire yet), so it does
 * what can be done without one: it refuses malformed tokens as they are typed,
 * shows each name as a chip that can be removed, and makes the "every tool" state
 * explicit.
 */
function ToolsEditor({
	tools,
	onChange,
	error,
}: {
	tools: string[] | null;
	onChange: (next: string[] | null) => void;
	error?: string | null;
}) {
	const [entry, setEntry] = useState("");
	const [entryError, setEntryError] = useState<string | null>(null);
	const inputId = useId();

	const add = () => {
		const token = entry.trim();
		if (!token) return;
		if (!TOOL_TOKEN.test(token)) {
			setEntryError(
				"Tool names are letters, digits, dot, underscore, dash or colon.",
			);
			return;
		}
		if (tools?.includes(token)) {
			setEntryError("That tool is already listed.");
			return;
		}
		setEntryError(null);
		setEntry("");
		onChange([...(tools ?? []), token]);
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2 text-body-sm">
				<Switch
					checked={tools === null}
					onCheckedChange={(checked) => onChange(checked ? null : [])}
					aria-label="Give this agent every tool"
				/>
				<span>All tools</span>
			</div>
			{tools === null ? (
				<p className="text-meta text-ink-muted">
					This agent may use whatever the session offers.
				</p>
			) : (
				<>
					{tools.length > 0 ? (
						<ul className="flex flex-wrap gap-1.5">
							{tools.map((tool) => (
								<li key={tool}>
									<Badge variant="outline">
										{tool}
										<Button
											variant="ghost"
											size="sm"
											aria-label={`Remove ${tool}`}
											onClick={() =>
												onChange(tools.filter((each) => each !== tool))
											}
											className="ml-1 h-4 px-1"
										>
											×
										</Button>
									</Badge>
								</li>
							))}
						</ul>
					) : (
						<p className="text-meta text-ink-muted">
							No tools yet. Add one below, or turn on All tools.
						</p>
					)}
					<div className="flex items-end gap-2">
						<div className="min-w-0 flex-1">
							<FieldLabel
								label="Add a tool"
								htmlFor={inputId}
								error={entryError ?? error}
							/>
							<Input
								id={inputId}
								value={entry}
								inputSize="md"
								placeholder="Tool name"
								aria-invalid={Boolean(entryError ?? error)}
								onChange={(event) => {
									setEntry(event.target.value);
									setEntryError(null);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										// Enter ADDS A TOOL here rather than submitting the form: the
										// footer is the only control that saves, which is what makes
										// "save only what changed" reviewable.
										event.preventDefault();
										add();
									}
								}}
							/>
						</div>
						<Button variant="secondary" onClick={add} disabled={!entry.trim()}>
							Add
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

export function AgentDetail({
	profile,
	teams,
	effortTiers,
	askEnabled,
	onSaved,
	onDuplicate,
	onOpenTeam,
	onAskAgent,
	onDirtyChange,
}: {
	profile: ReusableProfile;
	teams: readonly ReusableTeam[] | undefined;
	effortTiers: readonly string[];
	/** Whether the conversational path is available on this backend (scope B). */
	askEnabled: boolean;
	/** Reports an open edit with unsaved typing, so the page can hold the composer. */
	onDirtyChange?: (dirty: boolean) => void;
	onSaved: (name: string) => void;
	onDuplicate: (profile: ReusableProfile) => void;
	onOpenTeam: (name: string) => void;
	onAskAgent: (prompt: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [base, setBase] = useState<Draft>(() => draftOf(profile));
	const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<FieldTarget>(null);
	const [unconfirmed, setUnconfirmed] = useState(false);
	const [conflict, setConflict] = useState(false);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const navigate = useNavigate();

	const dirty = JSON.stringify(draft) !== JSON.stringify(base);

	/*
	 * Report the dirty state upward, because the page owes the operator a rule the
	 * pane cannot enforce on its own: a configuration run must not write a
	 * definition while a manual edit of it is open and unsaved (UX brief,
	 * hand-off notes). The composer reads this and says "finish or cancel your edit
	 * first" rather than allowing a race the operator would only see as a lost
	 * edit.
	 */
	useEffect(() => {
		onDirtyChange?.(editing && dirty);
		/*
		 * AND THE REPORT IS WITHDRAWN WHEN THIS PANE GOES AWAY. The page holds the
		 * last report it heard, so a dirty pane that unmounted — cancelling a
		 * create, duplicating from a dirty edit, switching to a tab with nothing
		 * selected — left `editDirty` true with no editor open, and the docked
		 * composer stayed blocked on "Finish or cancel your edit first" until a
		 * reload (review round 1, M1 / D1). A cleanup is the one hook that runs on
		 * the way out.
		 */
		return () => onDirtyChange?.(false);
	}, [onDirtyChange, editing, dirty]);

	/*
	 * A PANE OPENED BY A CREATE TAKES THE FOCUS ITSELF. The create form hands the
	 * caret over deliberately (see `requestHeadingFocus`): after a successful
	 * Create the page navigated and focus fell to `body`, so a keyboard user lost
	 * their place (QA round 1, Q7 / UX U8).
	 */
	useEffect(() => {
		if (!consumeHeadingFocus()) return;
		requestAnimationFrame(() => headingRef.current?.focus());
	}, []);

	/*
	 * A RE-SEED HAPPENS ONLY WHEN THE DRAFT IS CLEAN. An outside write (the
	 * authoring frame, a configuration run, a hand edit on disk) replaces the
	 * `profile` prop; adopting it while the operator has unsaved typing would
	 * discard their text with no warning — which is the silent-overwrite defect
	 * (U5) arriving from the other side.
	 */
	useEffect(() => {
		if (editing && dirty) return;
		const next = draftOf(profile);
		setBase(next);
		setDraft(next);
	}, [profile, editing, dirty]);

	/*
	 * THE CONFLICT BANNER, and when it is honest to show it. It says the RECORD
	 * moved under a draft that is still being typed — the base this edit started
	 * from is no longer what the backend holds — so saving would either revert
	 * somebody else's write or fail on a stale field. It is NOT shown for the
	 * common case of a refetch that returned identical values (the draft's own
	 * `dirty` computation is value-based for the same reason: a new object with
	 * the same fields is not a change).
	 */
	useEffect(() => {
		if (!editing) {
			setConflict(false);
			return;
		}
		const incoming = draftOf(profile);
		setConflict(dirty && JSON.stringify(incoming) !== JSON.stringify(base));
	}, [profile, editing, dirty, base]);

	const cancel = () => {
		setEditing(false);
		setError(null);
		setErrorField(null);
		setUnconfirmed(false);
		setConfirmDiscard(false);
		const next = draftOf(profile);
		setBase(next);
		setDraft(next);
	};

	/*
	 * ESCAPE ASKS THE SAME QUESTION THE CANCEL BUTTON ASKS. It used to call
	 * `cancel` outright, so the keyboard path discarded a dirty draft silently
	 * while the pointer path asked - the asymmetry U3 is about. And while the
	 * question is OPEN, Escape closes it the way it closes every other dismissable
	 * layer: the second press means "keep editing", not "ask me again" (review
	 * round 1, UX nit).
	 */
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
		const changed = changedFields(base, draft);
		if (Object.keys(changed).length === 0) {
			cancel();
			return;
		}
		/*
		 * AN EMPTY INSTRUCTIONS FIELD IS REFUSED HERE, not sent. The backend answers
		 * `profiles.update` with 200 and IGNORES an empty `instructions` (its own
		 * `min_length` is enforced on create), so the write used to be reported as
		 * "Saved." while the read view still showed the old text (review round 1,
		 * UX nit). A field the save will discard is a field the form must not
		 * pretend to save.
		 */
		if (
			typeof changed.instructions === "string" &&
			!changed.instructions.trim()
		) {
			setError("Give the agent instructions.");
			setErrorField("instructions");
			return;
		}
		setPending(true);
		setError(null);
		setErrorField(null);
		try {
			const result = await desktopResult<ReusableProfile>({
				op: "profiles.update",
				name: profile.name,
				requestId: crypto.randomUUID(),
				fields: changed,
			});
			setEditing(false);
			setUnconfirmed(false);
			const next = draftOf(result);
			setBase(next);
			setDraft(next);
			onSaved(result.name);
			showSuccessToast(`Saved ${result.name}.`);
			// Focus lands on the pane's heading rather than `body`: the pressed
			// button unmounts with the edit mode (UX U8).
			requestAnimationFrame(() => headingRef.current?.focus());
		} catch (caught) {
			const copy = refusalCopy(
				caught instanceof Error
					? caught.message
					: "The agent could not be saved.",
			);
			setError(copy.message);
			setErrorField(copy.field);
			/*
			 * THE BLOCKER (UX exploration U1), FIXED HERE.
			 *
			 * The old guard set `request.current` before the call and cleared it
			 * ONLY on success, so after any rejection — including a definitive 4xx
			 * validation refusal — the next attempt compared a corrected body
			 * against the old one and refused to send anything: "retry it unchanged
			 * or reload the profile to reconcile", a form that dead-locks on its own
			 * first error.
			 *
			 * WHAT THIS PANE DOES INSTEAD, stated exactly, because the first draft of
			 * this comment claimed more than the code did (agent review round 1, m3):
			 * every attempt mints a FRESH `requestId`, and no id is ever carried
			 * across attempts. There is therefore nothing for a refusal to lock, and
			 * the receipt journal's "repeat the body byte-for-byte" rule is not used
			 * here — it is the wrong tool for a form a person is editing, where the
			 * next attempt is deliberately DIFFERENT text. The one outcome that is
			 * genuinely ambiguous (a transport failure, where the write may have
			 * landed) is reported as such in words, and the operator is asked what
			 * only they can answer: whether it landed.
			 */
			/*
			 * A 408 IS NOT DEFINITIVE EITHER (review round 1, m3). The request timed
			 * out, which says nothing about whether it was received — the same
			 * ambiguity as a dropped connection, and the same answer.
			 */
			const status = (caught as { status?: unknown })?.status;
			const definitive =
				typeof status === "number" &&
				status !== 408 &&
				status >= 400 &&
				status < 500;
			setUnconfirmed(!definitive);
			if (!definitive) {
				showErrorToast(
					"The save could not be confirmed. Check whether it was applied before retrying.",
				);
			}
		} finally {
			setPending(false);
		}
	};

	const install = async () => {
		if (pending) return;
		setPending(true);
		setError(null);
		try {
			const result = await desktopResult<ReusableProfile>({
				op: "profiles.install",
				name: profile.name,
				requestId: crypto.randomUUID(),
			});
			const next = draftOf(result);
			setBase(next);
			setDraft(next);
			onSaved(result.name);
			showSuccessToast(`Installed ${result.name}. It can be edited now.`);
			requestAnimationFrame(() => headingRef.current?.focus());
		} catch (caught) {
			const copy = refusalCopy(
				caught instanceof Error
					? caught.message
					: "The agent could not be installed.",
			);
			setError(copy.message);
			showErrorToast(copy.message);
		} finally {
			setPending(false);
		}
	};

	const usedBy = (teams ?? []).filter(
		(team) =>
			team.manager === profile.name ||
			(team.members ?? []).some((member) => member.role === profile.name),
	);
	const readOnly = profile.source === "builtin";

	return (
		<div className="max-w-3xl space-y-6">
			<header className="space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
					<div className="min-w-0 space-y-2">
						{/* The page's only h1 is the page title; a definition's name is a
						    second-level heading (design D9). */}
						<h2
							ref={headingRef}
							tabIndex={-1}
							className="text-title focus:outline-none"
						>
							{profile.name}
						</h2>
						{/*
						 * THE DESCRIPTION IS SAID ONCE. It sat here AND in the "When to use it"
						 * box ~130 px below, which is the same sentence twice on one screen
						 * (design review round 1, D10). The box keeps it, because the box is
						 * titled by the question the sentence answers.
						 */}
						<AgentChips profile={profile} />
					</div>
					{/*
					 * ONE PRIMARY ACTION ABOVE THE FOLD (design D5). Every control here
					 * used to carry the same outline weight and Save sat at y=942 in an
					 * 868px viewport, so nothing said what the page was for.
					 */}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="primary"
							onClick={() => {
								useCanonicalSessionsStore
									.getState()
									.stageDraft({ kind: "agent", name: profile.name });
								navigate("/chat");
							}}
						>
							New chat
						</Button>
						{readOnly ? (
							<Button variant="secondary" onClick={install} disabled={pending}>
								<LogIn className="size-4" />
								{pending ? "Installing…" : "Install to edit"}
							</Button>
						) : (
							<Button
								variant="secondary"
								onClick={() => {
									setEditing(true);
									setError(null);
									setErrorField(null);
								}}
							>
								Edit
							</Button>
						)}
						{/*
						 * Duplicate, named for what it does. "Extend" did not say it made a
						 * copy (UX NIT 1) and, worse, it carried the on-screen draft's
						 * invalid values and stale error into the new record (U9) while
						 * keeping the original's name (U10), so it silently shadowed a
						 * built-in. This takes the FETCHED record, and the create pane
						 * suggests a name that cannot collide.
						 */}
						<Button variant="ghost" onClick={() => onDuplicate(profile)}>
							Duplicate as new agent
						</Button>
						{askEnabled ? (
							<Button
								variant="ghost"
								onClick={() => onAskAgent(`Change the agent ${profile.name}: `)}
							>
								Ask for a change
							</Button>
						) : null}
					</div>
				</div>
				{readOnly ? (
					<Alert variant="info">
						<AlertTitle>Built-in agent</AlertTitle>
						<AlertDescription>
							This one ships with the app and cannot be edited in place. Install
							it to get an editable copy, or duplicate it as a new agent.
						</AlertDescription>
					</Alert>
				) : null}
				{conflict ? (
					<Alert variant="warning" data-testid="agent-conflict">
						<AlertTitle>This changed while you were editing</AlertTitle>
						<AlertDescription>
							<span className="block">
								Something else — a configuration run, or another window — wrote
								to this agent after you opened it. Your edits are kept; saving
								writes only the fields you changed.
							</span>
							<Button
								variant="secondary"
								size="sm"
								className="mt-2"
								onClick={cancel}
							>
								Reload the saved version
							</Button>
						</AlertDescription>
					</Alert>
				) : null}
				{unconfirmed ? (
					<Alert variant="danger" data-testid="agent-unconfirmed">
						<AlertTitle>The last save was not confirmed</AlertTitle>
						<AlertDescription>
							The backend did not answer, so the write may or may not have
							landed. Check the agent below, then edit again.
						</AlertDescription>
					</Alert>
				) : null}
				{error && !errorField ? (
					<Alert variant="danger" role="alert" data-testid="agent-save-error">
						<AlertTitle>That did not save</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
			</header>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					void save(event);
				}}
				className="space-y-6"
			>
				{editing ? (
					<>
						<EditSection
							title="When to use it"
							description="One sentence the model reads to decide when this agent is the right one."
							label="When to use this agent"
							value={draft.description}
							error={errorField === "description" ? error : null}
							onChange={(value) =>
								setDraft((current) => ({ ...current, description: value }))
							}
						/>
						<EditSection
							title="Instructions"
							description="What the agent is told to do. This is the agent's whole behaviour."
							label="Instructions"
							value={draft.instructions}
							rows={12}
							required
							error={errorField === "instructions" ? error : null}
							onChange={(value) =>
								setDraft((current) => ({ ...current, instructions: value }))
							}
						/>
						<Section title="Tools">
							<ToolsEditor
								tools={draft.tools}
								error={errorField === "tools" ? error : null}
								onChange={(next) =>
									setDraft((current) => ({ ...current, tools: next }))
								}
							/>
						</Section>
						<Section
							title="Delegation and effort"
							description="Whether this agent may hand work to subagents, and which effort tier it runs at."
						>
							<div className="space-y-4">
								<div className="flex items-center gap-2 text-body-sm">
									<Switch
										checked={draft.delegate}
										onCheckedChange={(checked) =>
											setDraft((current) => ({ ...current, delegate: checked }))
										}
										aria-label="May delegate to subagents"
									/>
									<span>May delegate to subagents</span>
								</div>
								<div className="max-w-sm space-y-1">
									<FieldLabel
										label="Effort tier"
										htmlFor="agent-effort"
										error={errorField === "effort" ? error : null}
									/>
									<SearchableSelect
										ariaLabel="Effort tier"
										showLabel={false}
										placeholder="Choose an effort tier"
										busyLabel="Loading effort tiers"
										options={["inherit", ...effortTiers].map((tier) => ({
											id: tier,
											name: tier,
											description:
												tier === "inherit"
													? "Use the session's own effort"
													: undefined,
										}))}
										selected={{ id: draft.effort, name: draft.effort }}
										onSelect={(option) =>
											setDraft((current) => ({ ...current, effort: option.id }))
										}
										helperText="Tiers come from the backend's subagent model settings."
									/>
								</div>
							</div>
						</Section>
						<EditFooter
							submit
							confirming={confirmDiscard}
							onConfirmingChange={setConfirmDiscard}
							dirty={dirty}
							pending={pending}
							onSave={() => void save()}
							onCancel={cancel}
							saveLabel="Save changes"
							dirtyHint="Discard your unsaved changes to this agent?"
						/>
					</>
				) : (
					<>
						<Section title="When to use it">
							<ReadBlock
								text={profile.description || ""}
								empty="No description yet — add one so a model knows when to pick this agent."
							/>
						</Section>
						<Section title="Instructions">
							<ReadBlock
								text={
									profile.instructions ?? profile.packaged_instructions ?? ""
								}
								empty="No instructions yet."
							/>
						</Section>
						<Section title="Tools">
							{profile.tools && profile.tools.length > 0 ? (
								<ul className="flex flex-wrap gap-1.5">
									{profile.tools.map((tool) => (
										<li key={tool}>
											<Badge variant="outline">{tool}</Badge>
										</li>
									))}
								</ul>
							) : (
								<Badge variant="neutral">All tools</Badge>
							)}
						</Section>
						<Section title="Delegation and effort">
							<p className="text-body-sm text-ink">
								{profile.delegate
									? "May hand work to subagents."
									: "Does its own work; it does not delegate."}
							</p>
							<p className="text-body-sm text-ink-muted">
								Effort tier: {profile.effort ?? "inherit"}
							</p>
						</Section>
						<Section
							title="Used by"
							description="Teams that name this agent as a manager or a member."
						>
							{usedBy.length > 0 ? (
								<ul className="flex flex-wrap gap-x-3 gap-y-1">
									{usedBy.map((team) => (
										<li key={team.id}>
											<Button
												variant="link"
												onClick={() => onOpenTeam(team.name)}
											>
												{team.name}
											</Button>
										</li>
									))}
								</ul>
							) : (
								<p className="text-body-sm text-ink-muted">
									No team uses it yet.
								</p>
							)}
						</Section>
						<Section
							title="Where it came from"
							description={
								profile.source === "builtin"
									? "Shipped with the app."
									: profile.source === "installed"
										? "Installed from a packaged starter."
										: "Created on this machine."
							}
						>
							<dl className="space-y-1 text-body-sm">
								{profile.seed_origin ? (
									<div className="flex gap-2">
										<dt className="text-ink-muted">Source</dt>
										<dd className="text-ink">{profile.seed_origin}</dd>
									</div>
								) : null}
								{profile.divergent_fields?.length ? (
									<div className="flex gap-2">
										<dt className="text-ink-muted">
											Changed from the packaged copy
										</dt>
										<dd className="text-ink">
											{profile.divergent_fields.join(", ")}
										</dd>
									</div>
								) : null}
							</dl>
							{profile.packaged_instructions &&
							profile.divergent_fields?.length ? (
								<Disclosure
									summary="Compare with the packaged instructions"
									className="mt-2"
								>
									<ReadBlock text={profile.packaged_instructions} mono />
								</Disclosure>
							) : null}
						</Section>
					</>
				)}
			</form>
		</div>
	);
}

/**
 * One editable section: a heading, the field, and the refusal beside it.
 *
 * The refusal sits WITH THE FIELD (UX U2) rather than in a banner at the top of
 * a 966px form, where the operator pressed Save at y=942 and the error rendered
 * at y=190.
 */
function EditSection({
	title,
	description,
	label,
	value,
	onChange,
	rows,
	required,
	error,
}: {
	title: string;
	description?: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	rows?: number;
	required?: boolean;
	error?: string | null;
}) {
	const id = useId();
	return (
		<Section title={title} description={description}>
			<FieldLabel label={label} htmlFor={id} error={error} />
			{rows ? (
				<Textarea
					id={id}
					value={value}
					rows={rows}
					required={required}
					aria-invalid={Boolean(error)}
					className={cn("min-h-0")}
					onChange={(event) => onChange(event.target.value)}
				/>
			) : (
				<Input
					id={id}
					value={value}
					aria-invalid={Boolean(error)}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</Section>
	);
}

/**
 * Creating an agent: the same fields as the edit form, on a record that does not
 * exist yet.
 *
 * WHY THIS IS A SEPARATE COMPONENT rather than "the editor with blank fields".
 * Two behaviours only make sense on a create, and folding them into the edit view
 * is how the old page managed to carry a failed edit's invalid values and red
 * banner into a brand-new record (UX U9): the NAME is editable here (it is set
 * once, at creation — the tool cannot rename an existing profile), and the KIND
 * is chosen here (same reason). Everything else — the project's own field
 * components, the request path, the refusal copy — is shared, because two
 * editors for one record type is the "second way of doing things" this repo
 * treats as a defect.
 *
 * DUPLICATION IS A CREATE WITH A PREFILLED BODY, not a mode: `initial` carries
 * the source record's fields and the suggested name is one that cannot collide
 * (U10 — Extend used to succeed under the built-in's own name as a custom shadow
 * copy, quietly replacing a packaged definition).
 */
export function AgentCreate({
	initial,
	takenNames,
	effortTiers,
	onDirtyChange,
	onSaved,
	onCancel,
}: {
	initial?: ReusableProfile | null;
	takenNames: readonly string[];
	effortTiers: readonly string[];
	onDirtyChange?: (dirty: boolean) => void;
	onSaved: (name: string) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(() =>
		initial ? duplicateNameCandidates(initial.name, takenNames) : "",
	);
	const [kind, setKind] = useState<"role" | "specialist">(
		initial?.kind ?? "role",
	);
	const [draft, setDraft] = useState<Draft>(() =>
		initial
			? {
					...draftOf(initial),
					// A copy starts as a copy: the source's own description no longer
					// describes it exactly, so it is carried but not presented as final.
					description: initial.description ?? "",
				}
			: {
					description: "",
					instructions: "",
					tools: null,
					effort: "inherit",
					delegate: false,
				},
	);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<FieldTarget>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const instructionsRef = useRef<HTMLTextAreaElement>(null);

	/*
	 * A HALF-TYPED NEW RECORD IS A DRAFT TOO (UX U9). Leaving it by clicking a
	 * roster row discarded the name and the instructions with no question, which
	 * the edit form has always asked about. The page's navigation guard reads
	 * this, so a create is protected by the same rule as an edit.
	 */
	useEffect(() => {
		onDirtyChange?.(Boolean(name.trim() || draft.instructions.trim()));
		return () => onDirtyChange?.(false);
	}, [onDirtyChange, name, draft.instructions]);

	/*
	 * NAME FOCUS ON MOUNT (UX U9): the old Extend/Create left focus on `body`, so a
	 * keyboard user started a new record with no idea where they were.
	 */
	useEffect(() => {
		nameRef.current?.focus();
		nameRef.current?.select();
	}, []);

	const save = async (event?: FormEvent) => {
		event?.preventDefault();
		if (pending) return;
		if (!name.trim()) {
			setError("Give the agent a name.");
			setErrorField("name");
			nameRef.current?.focus();
			return;
		}
		/*
		 * THE TWO REFUSALS THE FORM CAN ANSWER ITSELF, in the field's own words.
		 *
		 * Name grammar and a taken name were checked for the suggested name only;
		 * a hand-typed `coder` created a second `coder` that SHADOWED the built-in
		 * (QA round 1, Q4). Empty instructions reached the wire and came back as the
		 * contract's own "Invalid desktop operation." — the most likely first
		 * failure on this form, and the only one with no field marked (Q3/U4/D5).
		 */
		if (/[\\/\s]/.test(name.trim())) {
			setError("Names cannot contain spaces or slashes.");
			setErrorField("name");
			nameRef.current?.focus();
			return;
		}
		if (takenNames.includes(name.trim())) {
			setError(
				`An agent called “${name.trim()}” already exists. Choose another name, or open the existing one to change it.`,
			);
			setErrorField("name");
			nameRef.current?.focus();
			return;
		}
		if (!draft.instructions.trim()) {
			setError("Give the agent instructions.");
			setErrorField("instructions");
			instructionsRef.current?.focus();
			return;
		}
		setPending(true);
		setError(null);
		setErrorField(null);
		try {
			const result = await desktopResult<ReusableProfile>({
				op: "profiles.create",
				requestId: crypto.randomUUID(),
				name: name.trim(),
				fields: {
					kind,
					description: draft.description,
					instructions: draft.instructions,
					// `[]` is how this wire says "every tool": `write_profile` writes
					// `tuple(params.tools) or None`, so the empty list and the absent field
					// mean the same thing to the backend — and `null` is not a value the
					// create body accepts at all.
					tools: draft.tools ?? [],
					effort: draft.effort,
					delegate: draft.delegate,
				},
			});
			showSuccessToast(`Created ${result.name}.`);
			/*
			 * The pane the page is about to open takes the caret (QA round 1, Q7): the
			 * create form cannot focus a heading that does not exist yet.
			 */
			requestHeadingFocus();
			onSaved(result.name);
		} catch (caught) {
			const copy = refusalCopy(
				caught instanceof Error
					? caught.message
					: "The agent could not be created.",
			);
			setError(copy.message);
			setErrorField(copy.field);
		} finally {
			setPending(false);
		}
	};

	const title = initial ? "Duplicate as a new agent" : "New agent";

	return (
		<div className="max-w-3xl space-y-6">
			<header className="space-y-2">
				<h2 className="text-title">{title}</h2>
				<p className="text-body-sm text-ink-muted">
					{initial
						? `A copy of ${initial.name}. It is a separate agent: changing it does not change the original.`
						: "Reusable instructions shared by agent commands, subagents and teams. Chats stay separate."}
				</p>
			</header>
			{error && !errorField ? (
				<Alert variant="danger" role="alert" data-testid="agent-create-error">
					<AlertTitle>That did not save</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void save(event);
				}}
				className="space-y-6"
			>
				<Section title="Name and role">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-1">
							<FieldLabel
								label="Name"
								htmlFor="agent-create-name"
								error={errorField === "name" ? error : null}
							/>
							<Input
								id="agent-create-name"
								ref={nameRef}
								value={name}
								required
								aria-invalid={errorField === "name"}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<FieldLabel
								label="How it works with others"
								htmlFor="agent-create-kind"
							/>
							<Select
								value={kind}
								onValueChange={(next) => setKind(next as "role" | "specialist")}
							>
								<SelectTrigger id="agent-create-kind">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{/*
									 * The wire's two values, said in the operator's terms: a
									 * "specialist" is a helper other agents may reach for, and a
									 * "role" is one you can start a chat with. (`Kind: Role /
									 * Specialist` was internal vocabulary — UX NIT 2.)
									 */}
									<SelectItem value="role">
										You can chat with it directly
									</SelectItem>
									<SelectItem value="specialist">
										Other agents can call on it
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</Section>
				<EditSection
					title="When to use it"
					description="One sentence the model reads to decide when this agent is the right one."
					label="When to use this agent"
					value={draft.description}
					error={errorField === "description" ? error : null}
					onChange={(value) =>
						setDraft((current) => ({ ...current, description: value }))
					}
				/>
				<EditSection
					title="Instructions"
					description="What the agent is told to do. This is the agent's whole behaviour."
					label="Instructions"
					value={draft.instructions}
					rows={12}
					required
					error={errorField === "instructions" ? error : null}
					onChange={(value) =>
						setDraft((current) => ({ ...current, instructions: value }))
					}
				/>
				<Section title="Delegation and effort">
					<div className="space-y-4">
						<div className="flex items-center gap-2 text-body-sm">
							<Switch
								checked={draft.delegate}
								onCheckedChange={(checked) =>
									setDraft((current) => ({ ...current, delegate: checked }))
								}
								aria-label="May delegate to subagents"
							/>
							<span>May delegate to subagents</span>
						</div>
						<div className="max-w-sm space-y-1">
							<FieldLabel label="Effort tier" htmlFor="agent-create-effort" />
							<SearchableSelect
								ariaLabel="Effort tier"
								showLabel={false}
								busyLabel="Loading effort tiers"
								placeholder="Choose an effort tier"
								options={["inherit", ...effortTiers].map((tier) => ({
									id: tier,
									name: tier,
									description:
										tier === "inherit"
											? "Use the session's own effort"
											: "A tier configured in Settings",
								}))}
								selected={{
									id: draft.effort,
									name: draft.effort,
								}}
								onSelect={(option) =>
									setDraft((current) => ({ ...current, effort: option.id }))
								}
							/>
						</div>
						<div className="space-y-1">
							<span className="text-body-sm text-ink-muted">Tools</span>
							<ToolsEditor
								tools={draft.tools}
								error={errorField === "tools" ? error : null}
								onChange={(next) =>
									setDraft((current) => ({ ...current, tools: next }))
								}
							/>
						</div>
					</div>
				</Section>
				<EditFooter
					submit
					dirty={Boolean(name.trim() || draft.instructions)}
					pending={pending}
					saveLabel={initial ? "Create the copy" : "Create agent"}
					pendingLabel="Creating…"
					dirtyHint="Discard this new agent?"
					onSave={() => void save()}
					onCancel={onCancel}
				/>
			</form>
		</div>
	);
}
