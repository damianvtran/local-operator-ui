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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
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
import { LogIn, MoreHorizontal } from "lucide-react";
import {
	type FormEvent,
	type Ref,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
	type ActionClass,
	BUILTIN_SWITCH_DISCLOSURE,
	CLASS_LABEL,
	CLASS_MEANING,
	CLASS_SWITCH_EFFECT,
	ClassSwitchError,
	classOf,
	classSwitchFailure,
	switchAgentClass,
} from "../utils/agent-class";
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
	TITLE_LINE_HEIGHT,
	consumeHeadingFocus,
	requestHeadingFocus,
	sourceLabel,
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

/**
 * The agent's one meta line: facts, as words (design spec s4, D8).
 *
 * It was a row of bordered badges (source, Modified, Specialist, Delegates, N
 * tools), which put four or five boxes under the title that looked like controls
 * and cost a second line of height. The facts are the same, minus the tool
 * count (the Tools section directly below lists the tools, so a number here said
 * the same thing in a worse place); they are now dot-separated text in the muted
 * ink, and only a state that needs attention
 * keeps a badge - `Modified` (the definition has diverged from its packaged
 * copy, which is what a hub pull would overwrite) is the one such state here.
 *
 * "Proactive" is the roster's word for the class (`CLASS_LABEL`), not a second
 * spelling; reactive is the default and is not said.
 */
function AgentMeta({ profile }: { profile: ReusableProfile }) {
	const facts = [
		sourceLabel(profile.source),
		classOf(profile) === "proactive" ? CLASS_LABEL.proactive : null,
		profile.delegate ? "Delegates" : null,
		profile.kind === "specialist" ? "Specialist" : null,
	].filter(Boolean);
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
			<p className="text-body-sm text-ink-muted">{facts.join(" · ")}</p>
			{profile.divergent_fields?.length ? (
				<Badge variant="warning">Modified</Badge>
			) : null}
		</div>
	);
}

/**
 * The class control: what the agent's class means, and the one press that
 * changes it.
 *
 * WHY IT IS NOT PART OF THE EDIT FORM. Everything else on this pane is a FIELD
 * of the definition — read it, change it, save it. The class is not: it is a
 * platform switch that takes effect on a running session at its next decision
 * point, it is the one thing on this pane whose wrong value, by the time you read
 * it, is an agent already messaging you, and it has a consequence the operator
 * needs BEFORE the press rather than in a diff afterwards. Burying it behind Edit
 * and Save would put a bounded delay between the intent and the outcome for no
 * gain, so it writes on the press, through the same profile route the rest of the
 * pane uses.
 *
 * THE PAYLOAD IS THE AUTHORITY, and the optimistic value is only ever a bridge to
 * it. The switch paints the class the operator asked for immediately — a switch
 * that waits for a round trip reads as broken — and then defers to the READ the
 * moment the two agree, so an out-of-band change (another window, a
 * configuration run, `/agent class` in the terminal) is never masked by a value
 * this component once painted. A refused write CLEARS the optimistic value, which
 * is what makes the displayed state revert rather than sit on a lie, and the
 * refusal is stated beside the switch.
 */
/**
 * WHETHER A PRESS STILL OWES FOCUS TO THE SWITCH, and why it cannot live in the
 * component's state.
 *
 * The page keys `AgentDetail` on the fetched record, so the re-read that follows
 * every switch REMOUNTS this control: the instance that was pressed is gone by
 * the time the write settles, and any `useState` in it goes with the mount. A
 * module-scope intent is what survives the remount, and the first mount whose
 * record matches CONSUMES it and clears it.
 *
 * IT CARRIES THE TIME IT WAS SET, because an intent nobody consumed must not
 * lie in wait: a press whose pane is navigated away from would otherwise pull
 * focus to a switch the next time that agent's definition is opened, minutes
 * later, for a press the reader has long forgotten.
 */
const CLASS_FOCUS_INTENT_MS = 5_000;
let classSwitchFocusIntent: { name: string; at: number } | null = null;

function AgentClassControl({
	profile,
	displayedName,
	notice,
	onNotice,
	onChanged,
}: {
	profile: ReusableProfile;
	/** The name to PRINT (her configured name for the seat; the registry name otherwise). */
	displayedName: string;
	/**
	 * What the last failed press said, or null. OWNED BY THE PAGE, and that is
	 * load-bearing rather than tidy: the re-read that every failure now performs
	 * remounts this pane (the page keys `AgentDetail` on the record), so a
	 * `useState` here would be erased by the very re-read that corrects the
	 * switch - the failure sentence would flash and vanish on exactly the
	 * ambiguous case it exists for. The page is the level that survives its own
	 * refresh, so the sentence lives there.
	 */
	notice: string | null;
	onNotice: (copy: string | null) => void;
	/** The record may have moved; re-read it. The same contract `Install` uses. */
	onChanged: (name: string) => void;
}) {
	const current = classOf(profile);
	const [optimistic, setOptimistic] = useState<ActionClass | null>(null);
	const [pending, setPending] = useState(false);
	const switchRef = useRef<HTMLButtonElement>(null);
	const labelId = useId();

	useEffect(() => {
		if (optimistic !== null && current === optimistic) setOptimistic(null);
	}, [current, optimistic]);

	/*
	 * FOCUS SURVIVES THE PRESS (UX round 2, U4). Two things used to lose it: the
	 * switch was `disabled` while the write was open - and Chrome blurs a button
	 * the moment `disabled` lands, the rule the sidebar's mark-all-read control
	 * already states - and the re-read then remounted the pane. The intent above
	 * answers the second; `aria-disabled` below answers the first, with the press
	 * ignored while the promise is open instead of prevented.
	 */
	useEffect(() => {
		const intent = classSwitchFocusIntent;
		if (!intent || intent.name !== profile.name) return;
		classSwitchFocusIntent = null;
		if (Date.now() - intent.at > CLASS_FOCUS_INTENT_MS) return;
		switchRef.current?.focus();
	}, [profile.name]);

	const shown = optimistic ?? current;

	const flip = async (next: ActionClass) => {
		if (pending || next === shown) return;
		classSwitchFocusIntent = { name: profile.name, at: Date.now() };
		/* A new press replaces the old sentence rather than stacking on it. */
		onNotice(null);
		setOptimistic(next);
		setPending(true);
		try {
			await switchAgentClass(profile, next, (step, requestId) =>
				step.op === "profiles.install"
					? desktopResult<ReusableProfile>({
							op: "profiles.install",
							name: step.name,
							requestId,
						})
					: desktopResult<ReusableProfile>({
							op: "profiles.update",
							name: step.name,
							requestId,
							fields: step.fields ?? {},
						}),
			);
			onChanged(profile.name);
			showSuccessToast(
				next === "proactive"
					? `${displayedName} is now proactive — it may message you on its own.`
					: `${displayedName} is now reactive — proactive messaging stopped.`,
			);
		} catch (caught) {
			/*
			 * REVERT FIRST, then RE-READ, then say what happened - in that order and on
			 * EVERY failure, which is the fix UX round 2 asked for (U1, the code-side
			 * half of the same finding): the re-read used to be conditional on an
			 * install having completed, so a write that failed AFTER the backend
			 * committed (a timeout, a dropped response) left the control painting the
			 * old value with nothing on screen to correct it. Someone who had just
			 * turned proactive messaging ON could read "the class was not changed" and
			 * believe the agent was silent while it was in fact nudging them.
			 *
			 * The re-read is the only reader of the truth in that case, and it is
			 * unconditional now: whatever the backend holds is what the switch shows,
			 * including nothing having changed.
			 */
			setOptimistic(null);
			const completed =
				caught instanceof ClassSwitchError ? caught.completed : [];
			const copy = classSwitchFailure(caught, completed);
			onNotice(copy);
			showErrorToast(copy);
			onChanged(profile.name);
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			{/*
			 * ONE CONTROL, AND THE WHOLE ROW ANSWERS THE PRESS (design round 2, D5).
			 * The label was a `span` beside a 36x20 track, so the words read as part of
			 * the row and behaved like nothing - and the ways to fix that are narrower
			 * than they look: a `label`/`htmlFor` pair associates with nothing here (the
			 * switch is a `button`, which does not take a label association - the same
			 * reason `ToggleSetting` uses `aria-labelledby`), a `<div onClick>` fails the
			 * a11y lint the repo keeps on, and a button nested in a button shares one hit
			 * area (the sidebar's rule). So the track carries an invisible overlay: the
			 * pseudo-element is part of the SWITCH, which means a press anywhere in the
			 * row activates the one control, keeps one tab stop, and leaves the
			 * accessible name on the words a reader can see.
			 */}
			<div className="relative flex items-center gap-2 text-body-sm">
				<Switch
					ref={switchRef}
					checked={shown === "proactive"}
					/*
					 * `aria-disabled` and NOT `disabled`: see the focus effect above. The
					 * press is ignored while the promise is open rather than refused, and the
					 * row says `Switching…` while that is true.
					 */
					aria-disabled={pending}
					aria-labelledby={labelId}
					data-testid="agent-class-switch"
					className="after:absolute after:inset-0 after:content-['']"
					onCheckedChange={(checked) =>
						void flip(checked ? "proactive" : "reactive")
					}
				/>
				{/*
				 * THE SWITCH, SAID IN THE READER'S WORDS (D5). "Proactive" was the third
				 * time the row said the same word (the label, the live value, and the
				 * sentence below it - D4), and it named the mechanism rather than the
				 * consequence. The value is now On/Off, which is what a switch shows, and
				 * the sentence below carries what the state means.
				 */}
				<span id={labelId} className="text-ink">
					Can message me on its own
				</span>
				<span aria-live="polite" className="text-ink-muted">
					{pending ? "Switching…" : shown === "proactive" ? "On" : "Off"}
				</span>
			</div>
			<p className="text-body-sm text-ink">{CLASS_MEANING[shown]}</p>
			<p className="text-meta text-ink-muted">{CLASS_SWITCH_EFFECT[shown]}</p>
			{profile.source === "builtin" ? (
				<p className="text-meta text-ink-muted">{BUILTIN_SWITCH_DISCLOSURE}</p>
			) : null}
			{notice ? (
				<Alert variant="danger" role="alert" data-testid="agent-class-error">
					{/*
					 * THE TITLE SAYS WHAT IS KNOWN AND THE BODY SAYS WHY (UX round 2, U1 and
					 * U5/D3). "The class was not changed" asserted an outcome nobody had
					 * verified - a failed write may have landed - and the body was a lowercase
					 * restatement of it. What this pair knows is that the press did not
					 * complete, and the read above has since put the switch in whatever
					 * position the backend actually holds.
					 */}
					<AlertTitle>The switch did not go through</AlertTitle>
					<AlertDescription>{notice}</AlertDescription>
				</Alert>
			) : null}
		</>
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
	displayedName,
	classNotice,
	onClassNotice,
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
	/**
	 * The name to PRINT for this definition: her configured name when the record
	 * is the seat, the registry name otherwise. The registry name still addresses
	 * every route and test id under this pane - this is what a reader reads.
	 */
	displayedName: string;
	/** The class switch's failure sentence, held by the page (see the control). */
	classNotice: string | null;
	onClassNotice: (copy: string | null) => void;
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
		/*
		 * NO WIDTH OR PADDING HERE: the page wraps every pane in the chat column's
		 * container and measure (see the team pane), so this pane's edges ARE the
		 * docked box's.
		 */
		<div className="space-y-8">
			<header className="space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
					<div className="min-w-0 flex-[1_1_16rem] space-y-1">
						{/* The page's only h1 is the page title; a definition's name is a
						    second-level heading (design D9). */}
						<h2
							ref={headingRef}
							tabIndex={-1}
							// A long name truncates instead of wrapping under the actions.
							title={displayedName}
							className="truncate text-title focus:outline-none"
						>
							{displayedName}
						</h2>
						{/*
						 * THE DESCRIPTION IS SAID ONCE. It sat here AND in the "When to use it"
						 * box ~130 px below, which is the same sentence twice on one screen
						 * (design review round 1, D10). The box keeps it, because the box is
						 * titled by the question the sentence answers.
						 */}
						<AgentMeta profile={profile} />
					</div>
					{/*
					 * ONE PRIMARY, ONE SECONDARY, ONE QUIET - and none while the form is open
					 * (design D5; spec D8). The primary while editing is Save changes in the
					 * footer, and a second accent fill in the same frame split the decision.
					 * `TITLE_LINE_HEIGHT` is the title's own line box (derived from the type
					 * token, not copied), so the 32 px buttons centre on the TITLE line and
					 * not on the title-plus-meta block.
					 *
					 * THE TRAILING GLYPH SITS ON THE COLUMN EDGE (design review round 1 D1):
					 * the last control is the ghost "More actions" icon button, 32 px wide
					 * around a 16 px glyph, so `-mr-2` (the 8 px of box on each side of the
					 * glyph) moves the glyph's edge onto the column edge into the 24 px
					 * gutter, where only its hover ground reaches.
					 */}
					{editing ? null : (
						<div
							className={cn(
								"flex shrink-0 items-center gap-2",
								TITLE_LINE_HEIGHT,
							)}
						>
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
								<Button
									variant="secondary"
									onClick={install}
									disabled={pending}
								>
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
							{askEnabled ? (
								<Button
									variant="ghost"
									onClick={() =>
										onAskAgent(`Change the agent ${profile.name}: `)
									}
								>
									Ask for a change
								</Button>
							) : null}
							{/*
							 * DUPLICATE MOVED INTO AN OVERFLOW MENU (spec s4): four text
							 * buttons spanned 452 px of a 688 px column, and the fourth is the
							 * rarest. Named for what it does, not "Extend" (UX NIT 1): it makes
							 * a copy, takes the FETCHED record (U9), and the create pane
							 * suggests a name that cannot collide (U10), so it never silently
							 * shadows a built-in.
							 */}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										aria-label="More actions"
										className="-mr-2"
									>
										<MoreHorizontal aria-hidden="true" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onSelect={() => onDuplicate(profile)}>
										Duplicate as new agent
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					)}
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

			{/* noValidate — the edit form validates in `save()` (D14). */}
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void save(event);
				}}
				className="space-y-8"
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
								<div className="space-y-1">
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
						{/*
						 * The class sits with the other BEHAVIOUR facts — what this agent does
						 * between your messages is the same kind of statement as whether it
						 * delegates and how hard it works — and above "Used by", which is a
						 * footnote about where the definition is referenced.
						 */}
						<Section
							/*
							 * "MESSAGING", NOT "CLASS" (design round 2, D5). The word the backend
							 * uses is the word this UI's own badge and receipts use, but as a SECTION
							 * TITLE it named the mechanism to a reader who came for the consequence;
							 * the description carries both vocabulary words once, so the badge the
							 * roster shows and the switch below stay one idea.
							 */
							title="Messaging"
							description="Reactive agents only reply. Proactive agents may also message you first."
						>
							<AgentClassControl
								profile={profile}
								displayedName={displayedName}
								notice={classNotice}
								onNotice={onClassNotice}
								onChanged={onSaved}
							/>
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
	fieldRef,
}: {
	title: string;
	description?: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	rows?: number;
	required?: boolean;
	error?: string | null;
	/**
	 * The field itself, for the caller's own focus move.
	 *
	 * A REF RATHER THAN AN ID LOOKUP: `useId`'s generated ids contain colons
	 * (`:r1e:`), which no CSS selector can name — the round-1 blocker rig found
	 * that the hard way — and the caller that reports "give this field something"
	 * owns the only reason to reach for it.
	 */
	fieldRef?: Ref<HTMLTextAreaElement>;
}) {
	const id = useId();
	return (
		<Section title={title} description={description}>
			<FieldLabel label={label} htmlFor={id} error={error} />
			{rows ? (
				<Textarea
					id={id}
					ref={fieldRef}
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
		<div className="space-y-8">
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
			{/*
			 * `noValidate`, AND OUR OWN MESSAGE INSTEAD (design review round 2, D14).
			 * The Instructions textarea is `required`, so the browser refused the
			 * submit and showed its own "Please fill out this field." bubble for an
			 * EMPTY field, while the in-app sentence appeared only for whitespace-only
			 * input — two different UIs for one mistake, and neither was the
			 * field-level copy this form is built on. `required` stays on the field
			 * for assistive technology; `noValidate` hands the verdict to `save()`,
			 * which marks the field and moves the caret to it.
			 */}
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void save(event);
				}}
				className="space-y-8"
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
					fieldRef={instructionsRef}
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
						<div className="space-y-1">
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
