/**
 * The projects detail's field editors: every field the retired sheet could
 * edit, as an individually editable surface built on the shared inline-edit
 * machine (`@shared/components/inline-edit`).
 *
 * WHY ONE FILE FOR THE FIELDS: they share three things that must not drift —
 * the wire vocabulary (which key each commit sends, and which `""` clears), the
 * refusal mapping (`projectWriteErrorCopy`), and the layout conventions of a
 * field (display, editor, slot, feedback). The tab's one-writer rule is
 * structural here: each field commits ONLY its own key(s) through
 * `useUpdateProject`, so a save can never rewrite a neighbour, and an
 * operation the wire cannot express is refused by omission rather than faked
 * (the estimate's clear, below).
 *
 * THE TITLE/KEY LAYOUT (operator's brief, 2026-09-30; flagged for the design
 * round): with a title set, the h1 edits the TITLE and the mono row under it
 * edits the KEY; with no title, the h1 edits the KEY and a small "Add a title"
 * affordance under it edits the title (placeholder = the key). Both fields are
 * editable in every state, the h1's precedence (`title ?? name`) is untouched,
 * and the same string is never stacked twice.
 *
 * THE ABSENCES: properties rows omit absent facts (the spec-sheet rule
 * `project-properties.tsx` states), so every addable field can be BORN inline:
 * a row mounts on demand from the section's "+ Add" menu, opens focused, and
 * retires itself if the user leaves without a value; one that DID get a value
 * stays, because the record then carries it. The title is the same mechanism
 * with its own affordance under the h1.
 *
 * THE SELECT'S SHAPE, stated because it is the one field that does not follow
 * "check to accept": picking a status COMMITS on the pick (the menu closing on
 * a choice IS the accept, the way Linear behaves for a state), and the check/x
 * appear for the error state, where the check re-attempts and the x reverts.
 * The status also begins on a single CLICK of the badge - a badge is already
 * a button to a reader, and it is the field's only mouse door besides its
 * pencil. Both are flagged for the design round.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	INLINE_EDIT_GROUP,
	InlineEditControls,
	InlineEditFeedback,
	type InlineEditFeedbackHandle,
	type InlineEditLabels,
	type InlineEditSlotHandle,
	useInlineEdit,
} from "@shared/components/inline-edit";
import {
	Badge,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { showSuccessToast } from "@shared/utils/toast-manager";
import type { FC, KeyboardEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import {
	PROJECT_DESCRIPTION_MAX_CHARS,
	projectNameRule,
} from "../../../../../shared/desktop-contract";
import type {
	DesktopProjectStatus,
	DesktopProjectView,
} from "../../../../../shared/desktop-control-contract";
import type { ProjectEditFields } from "../hooks/use-projects-queries";
import {
	PROJECT_ATTRIBUTION_MAX_CHARS,
	PROJECT_KEY_MAX_CHARS,
	PROJECT_TITLE_MAX_CHARS,
	type ProjectEstimateDraft,
	estimateChangedFields,
	estimateDraftEquals,
	parseProjectTags,
	projectAttributionRule,
	projectDateFieldRule,
	projectDateOrderRule,
	projectDescriptionRule,
	projectEstimateNumberRule,
	projectRefusalCopy,
	projectTagsFieldRule,
	projectTitleRule,
	tagsDraftEquals,
} from "../project-edit-model";
import { ProjectMarkdown } from "../project-markdown";
import {
	type DoneGateRefusal,
	PROJECT_NOT_MOVED_COPY,
	PROJECT_STATUS_OPTIONS,
	doneGateRefusal,
	estimateLabel,
	forcedCloseToastText,
	formatProjectDay,
	projectDisplayName,
	projectStatusMeta,
} from "../project-model";
import { pasteMarkdownIntoDescription } from "../project-sheet-model";
import { ProjectDoneAnywayDialog } from "./project-done-anyway-dialog";
import { ProjectStatusBadge } from "./project-status-badge";

/** The one write door every field here commits through. */
export type CommitProjectFields = (
	fields: ProjectEditFields,
	/**
	 * `forceDone` is the status field's deliberate close over open milestones
	 * (the confirm dialog's `Mark done anyway`). No other field passes options,
	 * so every other commit is the one-argument call it always was. The result
	 * is the daemon's PATCH answer; only the forced close reads it (for the
	 * "closed with N open" sentence), everything else ignores it.
	 */
	options?: { forceDone?: boolean },
) => Promise<unknown>;

/**
 * A refused write, as the sentence beside the field.
 *
 * `DesktopControlError` carries the machine code (`project_name_exists`, a 422
 * sentence, the done-gate tail); anything else is an ordinary error whose
 * message is the most honest thing available. The mapping itself is pure and
 * pinned by `scripts/projects-inline-edit.test.mjs`; this is only the narrowing.
 */
export function projectWriteErrorCopy(error: unknown): string {
	if (error instanceof DesktopControlError) {
		return projectRefusalCopy({ code: error.code, message: error.message });
	}
	return projectRefusalCopy({
		message: error instanceof Error ? error.message : "",
	});
}

/**
 * A refused status MOVE, as a sentence for the board's toast and the confirm
 * dialog's error line: the same re-spoken refusal copy the inline editors use,
 * but an empty message falls back to a move-shaped sentence ("not moved")
 * rather than the editors' "not saved", because the board has no field.
 */
export function projectMoveErrorCopy(error: unknown): string {
	if (!(error instanceof Error) || !error.message)
		return PROJECT_NOT_MOVED_COPY;
	/*
	 * A project deleted (or renamed away) under an open card/dialog: the route's
	 * own sentence is `no project with id or name '<32-hex id>'`, which names an
	 * identifier the reader never saw. The detail page already says this state in
	 * the app's words (`project-detail.tsx`); the move paths say the same.
	 */
	if (
		error instanceof DesktopControlError &&
		(error.code === "project_not_found" || error.status === 404)
	)
		return "This project could not be found. It may have been deleted.";
	return projectWriteErrorCopy(error);
}

/**
 * The done-gate refusal an error carries, or null. Adapter between the
 * transport error class and the pure classifier in `project-model.ts`.
 */
export function doneGateRefusalOf(error: unknown): DoneGateRefusal | null {
	if (!(error instanceof Error)) return null;
	const typed = error instanceof DesktopControlError ? error : null;
	return doneGateRefusal({
		code: typed?.code ?? null,
		message: error.message,
		detail: typed?.detail,
	});
}

/** The per-field chrome words; `display` reads inside the acknowledgement. */
function editLabels(field: string, display: string): InlineEditLabels {
	return {
		name: display,
		begin: `Edit ${field}`,
		accept: `Save ${field}`,
		cancel: `Discard the ${field} edit`,
		busy: `Saving the ${field}`,
		saved: `${display} saved`,
		retry: `Retry saving the ${field}`,
	};
}

/* ------------------------------------------------------------------------ *
 * The shared field shell: wrapper, display/editor swap, slot and feedback.
 * ------------------------------------------------------------------------ */

type FieldShellProps = {
	/** The `data-project-field` marker, in the tab's own hook family. */
	field: string;
	fieldRef: RefObject<HTMLDivElement>;
	fieldProps: {
		onKeyDown: (event: KeyboardEvent) => void;
		onBlur: (event: { relatedTarget: EventTarget | null }) => void;
		"aria-busy": true | undefined;
	};
	editing: boolean;
	/** The label column for a property row; absent for header fields. */
	label?: string;
	/** Leave the group class off when an ancestor already carries it. */
	bare?: boolean;
	display: ReactNode;
	editor: ReactNode;
	slot: InlineEditSlotHandle;
	feedback: InlineEditFeedbackHandle;
	controlsIdle?: "affordance" | "none";
	/**
	 * A field that lives INSIDE a wrapping row rather than on its own grid
	 * line (the status cluster beside the title): the slot hugs its control -
	 * value box and check/x adjacent, sized by content - instead of letting
	 * a flexible value column push the controls to the row's far edge. The
	 * feedback is capped so a long refusal sentence wraps under the cluster
	 * rather than stretching it into the header's next line (design round 1,
	 * D1: the escaped select moved the whole header and everything below).
	 */
	hug?: boolean;
	/**
	 * A control that belongs to the feedback line but is not the machine's own
	 * (today: the status field's `Mark done anyway`, offered beside a done-gate
	 * refusal). Rendered under the feedback row so the sentence and its way out
	 * read as one unit; absent for every other field.
	 */
	feedbackExtra?: ReactNode;
	className?: string;
	controlsClassName?: string;
};

/**
 * One field's geometry: the hover/focus group, the display-or-editor slot, the
 * control column and the feedback row. Deliberately NOT generic over the
 * draft: it receives rendered nodes, so the estimate's two-control editor and
 * the title's single input share one layout without sharing a type.
 *
 * The `dt` mark is only rendered when a label is given, because these shells
 * are also mounted outside the properties `<dl>` (the h1 and the key row).
 */
const FieldShell: FC<FieldShellProps> = ({
	field,
	fieldRef,
	fieldProps,
	editing,
	label,
	bare = false,
	display,
	editor,
	slot,
	feedback,
	controlsIdle = "affordance",
	hug = false,
	feedbackExtra,
	className,
	controlsClassName,
}) => (
	<div
		ref={fieldRef}
		{...fieldProps}
		data-project-field={field}
		className={cn(
			!bare && INLINE_EDIT_GROUP,
			"min-w-0",
			label !== undefined && "flex items-start gap-3",
			className,
		)}
	>
		{label !== undefined && (
			/* `dt`/`dd` are the properties `<dl>`'s own children grammar; the
			 * shell only renders them when it IS a row (a label was given). */
			<dt className="w-24 shrink-0 pt-0.5 text-body-sm text-ink-muted">
				{label}
			</dt>
		)}
		<div
			className={cn(
				"flex min-w-0 flex-col gap-1",
				/* Hugging: the column shrinks to its children so the row can
				 * size to content instead of to a stretched parent. */
				hug && "items-start",
				label !== undefined && "flex-1",
			)}
		>
			<div className="flex min-w-0 items-center gap-1.5">
				{/*
				 * The value's own gesture is a DOUBLE click; the pencil is the
				 * single-click and keyboard door. A single click on the value
				 * deliberately does nothing here: the status badge briefly took one
				 * (review round 1: an `onClick` on a plain `div` is not a control,
				 * and the operator never asked for it), and the field's one tab
				 * stop stays the pencil.
				 */}
				<div
					className={cn(
						"min-w-0",
						hug ? "w-fit" : "flex-1",
						/* The value is the double-click door, so it reads as
						 * text a pointer can work in (UX round 1, U4); the
						 * pencil beside it keeps the pointer. */
						!editing && "cursor-text",
					)}
					onDoubleClick={editing ? undefined : slot.begin}
				>
					{editing ? editor : display}
				</div>
				<InlineEditControls
					api={slot}
					idle={controlsIdle}
					className={cn("shrink-0", controlsClassName)}
				/>
			</div>
			{/*
			 * THE FEEDBACK LINE IS A FIXED-HEIGHT SLOT, PRESENT WHETHER OR NOT
			 * SOMETHING IS SHOWING (design round 1, D3, verbatim): the transient
			 * "saved" caption used to be a child that came and went, so every
			 * commit pushed the reader's content down and pulled it back. The
			 * slot is part of every field's rhythm now, so the acknowledgement
			 * lands INSIDE a line that already existed at rest - and one `lh`
			 * is exactly the caption's own line box (`text-meta`, 1.45).
			 */}
			<div className={cn("min-h-[1lh] text-meta", hug && "max-w-96")}>
				<InlineEditFeedback api={feedback} />
				{feedbackExtra}
			</div>
		</div>
	</div>
);

/* ------------------------------------------------------------------------ *
 * The single-line text field: title, key, owner, team, both dates.
 * ------------------------------------------------------------------------ */

type TextFieldProps = {
	field: string;
	value: string;
	display: ReactNode;
	/** The wire fields one save of this field carries. */
	commitFields: (next: string) => ProjectEditFields;
	validate: (next: string) => string | null;
	labels: InlineEditLabels;
	commit: CommitProjectFields;
	placeholder?: string;
	mono?: boolean;
	/** The editor's type ramp; the h1 variants pass the display ramp. */
	ramp?: string;
	label?: string;
	bare?: boolean;
	autoBegin?: boolean;
	/**
	 * The wire's own hard cap, enforced as the value is TYPED (UX round 1,
	 * U3: the title took 100 characters and was only refused at submit).
	 * Omitted where the field has no hard cap (a date's rule explains
	 * itself better than a silent stop).
	 */
	maxLength?: number;
	/**
	 * Why the row stopped being born: `cancelled` (Esc/x, the value kept out)
	 * or `filled` (the committed value arrived). The consumer uses the reason
	 * to hand focus back to its own trigger only on the cancel - a filled row
	 * keeps the pencil's refocus (§ 2.6; review round 1, m2).
	 */
	onRetire?: (outcome: "cancelled" | "filled") => void;
	className?: string;
	controlsClassName?: string;
};

/**
 * The one text field every string-shaped field reuses.
 *
 * THE `open` STATE is what makes a field addable (`+ Add`, "Add a title"):
 * mounted with `autoBegin`, it opens focused; it RETIRES itself (and tells the
 * parent) when the user leaves without a value, and it closes itself when the
 * committed value arrives from the record - which is also why the parent's
 * "+ Add" pick is a mount, not a mode. A field that already has a value never
 * uses it: `open` starts false and the pencil is the door.
 */
const TextField: FC<TextFieldProps> = ({
	field,
	value,
	display,
	commitFields,
	validate,
	labels,
	commit,
	placeholder,
	mono = false,
	ramp = "text-body-sm",
	label,
	bare = false,
	autoBegin = false,
	maxLength,
	onRetire,
	className,
	controlsClassName,
}) => {
	const [open, setOpen] = useState(autoBegin);
	useEffect(() => {
		if (open && value !== "") {
			setOpen(false);
			onRetire?.("filled");
		}
	}, [open, value, onRetire]);
	const api = useInlineEdit<string>({
		value,
		commit: async (next) => {
			await commit(commitFields(next));
		},
		/*
		 * TRIMMED (review round 1, m1): every consumer's `commitFields` trims
		 * before sending, so `atlas` -> `atlas ` was dirty under `Object.is`,
		 * sent an identical value and showed "saved" - a PATCH nobody asked
		 * for, in a feature whose promise is changed-fields-only. Comparing
		 * what the wire would RECEIVE is the same rule `tagsDraftEquals`
		 * applies to tags.
		 */
		equals: (a, b) => a.trim() === b.trim(),
		validate,
		labels,
		selectAllOnBegin: true,
		beginOnMount: autoBegin,
		errorCopy: projectWriteErrorCopy,
		onSettle: (outcome) => {
			if (outcome === "cancelled") {
				setOpen(false);
				onRetire?.("cancelled");
			}
		},
	});
	if (!open && value === "") return null;
	return (
		<FieldShell
			field={field}
			fieldRef={api.fieldRef}
			fieldProps={api.fieldProps}
			editing={api.editing}
			label={label}
			bare={bare}
			display={display}
			slot={api}
			feedback={api}
			className={className}
			controlsClassName={controlsClassName}
			editor={
				<Input
					ref={api.editorRef as RefObject<HTMLInputElement>}
					{...api.editorAria}
					value={api.draft}
					readOnly={api.phase === "saving"}
					maxLength={maxLength}
					placeholder={placeholder}
					aria-label={labels.name}
					onChange={(event) => api.setDraft(event.target.value)}
					spellCheck={false}
					autoComplete="off"
					className={cn("h-8", mono ? "font-mono text-mono-sm" : ramp)}
				/>
			}
		/>
	);
};

/* ------------------------------------------------------------------------ *
 * The header: title / key, the key row, and the add-a-title affordance.
 * ------------------------------------------------------------------------ */

/**
 * The header identity block: the h1 slot, the key row under it when a title
 * exists, and the add-a-title affordance under it when none does.
 *
 * ONE GROUP, TWO FIELDS: the block carries `group/inline-edit`, and the two
 * fields inside it render `bare` (no group of their own) so hovering the
 * header reveals BOTH doors at once - they are one composite area to a reader.
 * The key row (title-exists case) keeps its own group, because it is a
 * separate line with its own hover.
 */
export const ProjectHeaderIdentity: FC<{
	project: DesktopProjectView;
	commit: CommitProjectFields;
}> = ({ project, commit }) => {
	const title = project.title ?? "";
	const [addingTitle, setAddingTitle] = useState(false);
	/*
	 * The born title's own focus target (review round 1, m2): a cancelled
	 * "Add a title" row has no pencil to return to (it never had a value),
	 * so focus goes back to the affordance that opened it - the same rule the
	 * properties block's "+ Add" applies to its rows.
	 */
	const addTitleRef = useRef<HTMLButtonElement | null>(null);
	const retireTitle = (outcome: "cancelled" | "filled") => {
		setAddingTitle(false);
		if (outcome === "cancelled")
			setTimeout(() => addTitleRef.current?.focus(), 0);
	};
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<div className={cn(INLINE_EDIT_GROUP, "flex min-w-0 flex-col gap-0.5")}>
				{title ? (
					<TextField
						field="title"
						value={title}
						display={
							<h1
								data-project-title={project.name}
								className="min-w-0 break-words text-display text-ink"
							>
								{title}
							</h1>
						}
						commitFields={(next) => ({ title: next.trim() })}
						validate={(next) => projectTitleRule(next)}
						labels={editLabels("title", "Title")}
						commit={commit}
						maxLength={PROJECT_TITLE_MAX_CHARS}
						placeholder="A short name for the workstream"
						ramp="text-body"
						bare
						controlsClassName="self-center"
					/>
				) : (
					<TextField
						field="key"
						value={project.name}
						display={
							/* The no-title h1 IS the key, so its display keeps the
							 * header's own marker: the rig and the stories address the
							 * heading by the project's key in both states. */
							<h1
								data-project-title={project.name}
								className="min-w-0 break-words text-display text-ink"
							>
								{project.name}
							</h1>
						}
						commitFields={(next) => ({ name: next.trim() })}
						validate={(next) => projectNameRule(next.trim())}
						labels={editLabels("key", "Key")}
						commit={commit}
						maxLength={PROJECT_KEY_MAX_CHARS}
						placeholder="project-key"
						ramp="text-body"
						bare
						controlsClassName="self-center"
					/>
				)}
				{!title &&
					(addingTitle ? (
						<TextField
							field="title"
							value=""
							display={null}
							commitFields={(next) => ({ title: next.trim() })}
							validate={(next) => projectTitleRule(next)}
							labels={editLabels("title", "Title")}
							commit={commit}
							maxLength={PROJECT_TITLE_MAX_CHARS}
							placeholder={project.name}
							ramp="text-body-sm"
							bare
							autoBegin
							onRetire={retireTitle}
						/>
					) : (
						<button
							ref={addTitleRef}
							type="button"
							data-project-add-title=""
							onClick={() => setAddingTitle(true)}
							className={cn(
								"w-fit cursor-pointer text-meta text-ink-dim",
								"opacity-0 transition-opacity duration-base ease-out-quart",
								"group-hover/inline-edit:opacity-100 group-hover/inline-edit:duration-fast",
								"group-focus-within/inline-edit:opacity-100 group-focus-within/inline-edit:duration-fast",
								"hover:text-ink",
							)}
						>
							Add a title
						</button>
					))}
			</div>
			{title && (
				<TextField
					field="key"
					value={project.name}
					display={
						<span className="font-mono text-mono-sm text-ink-muted">
							{project.name}
						</span>
					}
					commitFields={(next) => ({ name: next.trim() })}
					validate={(next) => projectNameRule(next.trim())}
					labels={editLabels("key", "Key")}
					commit={commit}
					maxLength={PROJECT_KEY_MAX_CHARS}
					placeholder="project-key"
					mono
				/>
			)}
		</div>
	);
};

/* ------------------------------------------------------------------------ *
 * Status: the header badge, edited through the seven-status select.
 * ------------------------------------------------------------------------ */

/**
 * The status field. See this file's header for why a pick commits directly.
 *
 * THE MENU OPENS WITH THE EDIT: the pencil is pressed (or the badge is
 * double-clicked - the value's own gesture everywhere in this file), the
 * machine begins, and the select's menu opens on the same gesture (the
 * `onBegin` hook option), so "edit the status" is one press rather than
 * click-open-select. A single click on the badge deliberately does NOT begin
 * it (review round 1: that was an `onClick` on a plain div, not a control -
 * the field's one tab stop is the pencil). The menu state is owned here, not
 * by the machine: it is chrome over the draft, and a closed menu with an open
 * field (Escape once) is a real, harmless state the user can leave by picking
 * again or pressing x.
 */
export const ProjectStatusField: FC<{
	project: DesktopProjectView;
	commit: CommitProjectFields;
}> = ({ project, commit }) => {
	const [menuOpen, setMenuOpen] = useState(false);
	const capabilities = useDesktopCapabilities();
	const forceDoneOffered = desktopFeatureEnabled(
		capabilities.data,
		"projects_force_done",
	);
	/*
	 * THE DONE-GATE'S REFUSAL, kept beside the machine's own error sentence.
	 * The machine only keeps the sentence (that is all it needs), so the
	 * structured refusal - the names, and whether the daemon coded it - is
	 * captured here as the commit rejects. It is cleared at the start of every
	 * commit, so it can only describe the LATEST refusal.
	 */
	const [refusal, setRefusal] = useState<DoneGateRefusal | null>(null);
	/*
	 * The refusal the OPEN dialog is answering, snapshotted when it opens. The
	 * live `refusal` above is replaced by every commit, and a forced retry that
	 * itself fails (a different error, say a deleted row) clears it - the dialog
	 * must keep showing the question it asked, with the new failure under it,
	 * not collapse because its premise was overwritten.
	 */
	const [asked, setAsked] = useState<DoneGateRefusal | null>(null);
	/* The next commit is the confirmed, forced one (read once, then reset). */
	const forceNext = useRef(false);
	/*
	 * The dialog's pending promise. The forced retry runs THROUGH the machine
	 * (`api.accept`), not beside it, so the field gets its real saving/saved
	 * states, announcement and stale-snapshot handling for free; the dialog just
	 * needs to know how that attempt ended, and this is how the commit below
	 * tells it.
	 */
	const outcome = useRef<{
		resolve: () => void;
		reject: (reason: unknown) => void;
	} | null>(null);
	const api = useInlineEdit<string>({
		value: project.status,
		commit: async (next) => {
			const forced = forceNext.current;
			forceNext.current = false;
			setRefusal(null);
			try {
				const result = (await commit(
					{ status: next as DesktopProjectStatus },
					forced ? { forceDone: true } : undefined,
				)) as Parameters<typeof forcedCloseToastText>[0];
				if (forced) {
					/* A forced close says so: the caption alone ("Status saved")
					 * would read as an ordinary finish. */
					showSuccessToast(
						forcedCloseToastText(
							result,
							refusal?.count ?? 0,
							projectStatusMeta(next).label,
						),
					);
				}
				outcome.current?.resolve();
			} catch (error) {
				setRefusal(doneGateRefusalOf(error));
				outcome.current?.reject(error);
				throw error;
			} finally {
				outcome.current = null;
			}
		},
		labels: editLabels("status", "Status"),
		keyboardCommit: false,
		errorCopy: projectWriteErrorCopy,
		onBegin: () => setMenuOpen(true),
	});
	/*
	 * THE FORCE DOOR exists only while the field is holding a CODED done-gate
	 * refusal and this daemon advertises `projects_force_done`. A refusal
	 * recognised from its sentence alone (an older daemon) gets no door: that
	 * daemon would 422 the extra body key, turning a choice into a second error.
	 */
	const canForce =
		forceDoneOffered &&
		api.phase === "error" &&
		refusal !== null &&
		refusal.coded;
	const confirmForce = () =>
		new Promise<void>((resolve, reject) => {
			if (api.phase !== "error" || api.conflict !== null) {
				reject(new Error(""));
				return;
			}
			forceNext.current = true;
			outcome.current = { resolve, reject };
			api.accept(api.draft, true);
		});
	return (
		<FieldShell
			field="status"
			fieldRef={api.fieldRef}
			fieldProps={api.fieldProps}
			editing={api.editing}
			display={<ProjectStatusBadge status={project.status} />}
			slot={api}
			feedback={api}
			/*
			 * HUGGING (design round 1, D1): the editor replaces the chip in the
			 * CHIP'S OWN SLOT, with x/✓ adjacent, instead of a stretched value
			 * column flinging the controls to the row's far edge and the header
			 * re-wrapping around them.
			 */
			hug
			feedbackExtra={
				<>
					{canForce && (
						<button
							type="button"
							data-project-force-done-door=""
							onClick={() => setAsked(refusal)}
							className="cursor-pointer text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink"
						>
							Mark done anyway
						</button>
					)}
					<ProjectDoneAnywayDialog
						open={asked !== null}
						refusal={asked}
						projectLabel={projectDisplayName(project)}
						onClose={() => setAsked(null)}
						onConfirm={confirmForce}
						secondaryLabel="Review milestones"
						onSecondary={() => {
							/* The milestones are on this page: drop the held edit and put the
							 * reader on the list they would complete. */
							setAsked(null);
							api.cancel();
							const list = document.querySelector<HTMLElement>(
								"[data-project-milestones]",
							);
							list?.scrollIntoView({ block: "start" });
							list
								?.querySelector<HTMLElement>('input[type="checkbox"], button')
								?.focus({ preventScroll: true });
						}}
					/>
				</>
			}
			editor={
				<Select
					open={menuOpen}
					onOpenChange={setMenuOpen}
					value={api.draft}
					onValueChange={(value) => {
						setMenuOpen(false);
						/* The pick IS the accept; the menu's close is the gesture's
						 * own end. `accept(value)` carries the value explicitly so
						 * the machine does not depend on a re-render ordering. */
						api.accept(value);
					}}
				>
					<SelectTrigger
						ref={api.editorRef as RefObject<HTMLButtonElement>}
						{...api.editorAria}
						aria-label="Status"
						data-project-status=""
						className="h-7 w-fit min-w-36"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PROJECT_STATUS_OPTIONS.map((option) => (
							<SelectItem
								key={option.value}
								value={option.value}
								data-project-status-option={option.value}
							>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
		/>
	);
};

/* ------------------------------------------------------------------------ *
 * Description: the markdown block, edited through the sheet's own editor.
 * ------------------------------------------------------------------------ */

/**
 * The description block.
 *
 * PARITY WITH THE SHEET, deliberately: the same Write|Preview toggle, the same
 * clipboard-HTML paste path, the same `n/240` counter whose tone warns before
 * the save does (design round 1, D1 - the sheet's own findings), and the same
 * `h-40` fixed height in both panes so toggling moves nothing around them. The
 * one difference is the contract's keyboard rule: the sheet used
 * Cmd/Ctrl+Enter because its form could not commit on Enter; a multiline field
 * here does the same (Enter is a newline) while single-line fields accept on
 * Enter.
 *
 * The empty state is the block's own door - "Add description" - so the field
 * can be born inline; once it has content, the pencil and the double-click are
 * the doors and the button retires.
 */
export const ProjectDescriptionBlock: FC<{
	project: DesktopProjectView;
	commit: CommitProjectFields;
}> = ({ project, commit }) => {
	const [preview, setPreview] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const addDescriptionRef = useRef<HTMLButtonElement | null>(null);
	const api = useInlineEdit<string>({
		value: project.description,
		commit: async (next) => {
			await commit({ description: next.trim() });
		},
		/* TRIMMED, the same m1 rule the single-line fields carry: the commit
		 * sends `next.trim()`, so a trailing space is not a change. */
		equals: (a, b) => a.trim() === b.trim(),
		validate: (next) => projectDescriptionRule(next),
		multiline: true,
		labels: editLabels("description", "Description"),
		errorCopy: projectWriteErrorCopy,
		/*
		 * The textarea the hook focuses on begin and compares `event.target`
		 * against for Enter: without it, the paste helper's own ref was the
		 * only one attached, the hook's ref pointed at nothing, and Cmd+Enter
		 * from the editor read as a key from OUTSIDE it (refused).
		 */
		editorRef: textareaRef,
		onSettle: (outcome) => {
			/*
			 * m2: a cancelled EMPTY description has no pencil to hand focus to
			 * (its resting affordance is the "Add description" button), so the
			 * focus returns to the door that opened it - the same rule the
			 * properties block's "+ Add" applies to its rows. A non-empty
			 * description keeps the pencil's own refocus.
			 */
			if (outcome === "cancelled" && !project.description.trim())
				setTimeout(() => addDescriptionRef.current?.focus(), 0);
		},
	});
	/*
	 * Returning from Preview puts the caret back in the textarea: the toggle
	 * is a view of the same draft, and a reader who switched over to check
	 * their markdown and back expects to keep typing. The hook focuses only
	 * when the field OPENS, so this side of the toggle belongs to this file.
	 */
	useEffect(() => {
		if (preview || !api.editing) return undefined;
		const timer = setTimeout(() => textareaRef.current?.focus(), 0);
		return () => clearTimeout(timer);
	}, [preview, api.editing]);
	/* The counter reads the DRAFT while editing and the record otherwise, like
	 * every other read of this field reads `displayValue`. */
	const shown = api.editing ? api.draft : api.displayValue;
	const over = shown.length > PROJECT_DESCRIPTION_MAX_CHARS;
	return (
		<div
			ref={api.fieldRef}
			{...api.fieldProps}
			data-project-field="description"
			className={cn(INLINE_EDIT_GROUP, "min-w-0")}
		>
			{api.editing ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3">
						{/* The mesh page's segmented pattern, the sheet's own
						 * control: a second spelling of a two-choice toggle beside
						 * an existing one is the defect this repo names. */}
						<fieldset className="m-0 w-fit border-0 p-0">
							<legend className="sr-only">Description mode</legend>
							<div className="flex gap-0.5 rounded-md bg-sunken p-0.5">
								{(["write", "preview"] as const).map((option) => (
									<button
										key={option}
										type="button"
										data-project-description-mode={option}
										aria-pressed={preview === (option === "preview")}
										onClick={() => setPreview(option === "preview")}
										className={cn(
											"h-6 rounded-sm px-3 text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart",
											"hover:text-ink",
											preview === (option === "preview") &&
												"bg-surface text-ink",
										)}
									>
										{option === "write" ? "Write" : "Preview"}
									</button>
								))}
							</div>
						</fieldset>
						<InlineEditControls api={{ ...api, acceptBlocked: over }} />
					</div>
					{preview ? (
						<div
							data-project-description-preview=""
							className="h-40 overflow-y-auto rounded-md border border-hairline bg-sunken px-3 py-2"
						>
							{api.draft.trim() ? (
								<ProjectMarkdown className="text-body-sm">
									{api.draft}
								</ProjectMarkdown>
							) : (
								<p className="text-body-sm text-ink-muted">
									Nothing to preview yet.
								</p>
							)}
						</div>
					) : (
						<Textarea
							ref={textareaRef}
							{...api.editorAria}
							data-project-description=""
							value={api.draft}
							readOnly={api.phase === "saving"}
							rows={8}
							placeholder="Markdown — headings, lists, code."
							aria-label={api.labels.name}
							onChange={(event) => api.setDraft(event.target.value)}
							onPaste={(event) =>
								pasteMarkdownIntoDescription(event, textareaRef, (next) =>
									api.setDraft(next),
								)
							}
							className="h-40 resize-none"
						/>
					)}
					<div className="flex items-center justify-between gap-3">
						<InlineEditFeedback api={api} />
						<p
							className={cn(
								"shrink-0 text-meta tabular-nums",
								over ? "text-danger" : "text-ink-muted",
							)}
						>
							{api.draft.length}/{PROJECT_DESCRIPTION_MAX_CHARS}
						</p>
					</div>
				</div>
			) : (
				<div className="flex min-w-0 flex-col gap-1">
					{(project.description ?? "").trim() ? (
						<div className="flex min-w-0 items-start gap-1.5">
							<div
								className="min-w-0 flex-1 cursor-text"
								onDoubleClick={api.begin}
							>
								<ProjectMarkdown className="text-body">
									{project.description ?? ""}
								</ProjectMarkdown>
							</div>
							<InlineEditControls api={api} />
						</div>
					) : (
						<button
							ref={addDescriptionRef}
							type="button"
							data-project-add-description=""
							onClick={api.begin}
							className="w-fit cursor-pointer text-body-sm text-ink-dim transition-colors duration-fast ease-out-quart hover:text-ink"
						>
							Add description
						</button>
					)}
					{/*
					 * The fixed-height slot, present whether or not something is
					 * showing (design round 1, D3): the saved caption lands inside a
					 * line that already existed at rest, so the commit never reflows
					 * the rows below. One `lh` is the caption's own line box.
					 */}
					<div className="min-h-[1lh] text-meta">
						<InlineEditFeedback api={api} />
					</div>
				</div>
			)}
		</div>
	);
};

/* ------------------------------------------------------------------------ *
 * The properties rows: owner, team, both dates, estimate, tags.
 * ------------------------------------------------------------------------ */

/** Owner row; `""` clears (the wire's own spelling for "unknown"). */
export const ProjectOwnerField: FC<{
	project: DesktopProjectView;
	commit: CommitProjectFields;
	autoBegin?: boolean;
	onRetire?: (outcome: "cancelled" | "filled") => void;
}> = ({ project, commit, autoBegin = false, onRetire }) => (
	<TextField
		field="owner"
		value={project.owner ?? ""}
		label="Owner"
		display={<span className="text-body-sm text-ink">{project.owner}</span>}
		commitFields={(next) => ({ owner: next.trim() })}
		validate={(next) => projectAttributionRule(next, "owner")}
		labels={editLabels("owner", "Owner")}
		commit={commit}
		maxLength={PROJECT_ATTRIBUTION_MAX_CHARS}
		placeholder="atlas"
		autoBegin={autoBegin}
		onRetire={onRetire}
	/>
);

/** Team row; same shape as Owner, its own 80-character copy. */
export const ProjectTeamField: FC<{
	project: DesktopProjectView;
	commit: CommitProjectFields;
	/**
	 * The catalogue's label for the slug the row EDITS (resolved by the page,
	 * `useTeamLabelFor`). Display-only: the editor still edits the slug, and
	 * `null`/absent falls back to it - a slug with no resolvable row renders as
	 * itself, the hook's own contract.
	 */
	label?: string | null;
	autoBegin?: boolean;
	onRetire?: (outcome: "cancelled" | "filled") => void;
}> = ({ project, commit, label = null, autoBegin = false, onRetire }) => (
	<TextField
		field="team"
		value={project.team ?? ""}
		label="Team"
		display={
			<span className="text-body-sm text-ink">{label ?? project.team}</span>
		}
		commitFields={(next) => ({ team: next.trim() })}
		validate={(next) => projectAttributionRule(next, "team")}
		labels={editLabels("team", "Team")}
		commit={commit}
		maxLength={PROJECT_ATTRIBUTION_MAX_CHARS}
		placeholder="platform"
		autoBegin={autoBegin}
		onRetire={onRetire}
	/>
);

/**
 * One planning date row (Start or Target).
 *
 * THE PAIR RULE is checked from either side before the request, because the
 * backend refuses a backwards range and the field that moved is where the
 * sentence belongs; the OTHER date is read from the record, which is correct
 * even while the neighbour is being edited (only one field holds a draft).
 */
export const ProjectDateField: FC<{
	project: DesktopProjectView;
	commit: CommitProjectFields;
	which: "start" | "target";
	nowMs: number;
	autoBegin?: boolean;
	onRetire?: (outcome: "cancelled" | "filled") => void;
}> = ({ project, commit, which, nowMs, autoBegin = false, onRetire }) => {
	const raw =
		which === "start"
			? (project.start_date ?? "")
			: (project.target_date ?? "");
	const locale =
		typeof navigator === "undefined" ? undefined : navigator.language;
	const display = formatProjectDay(raw, locale, new Date(nowMs));
	const label = which === "start" ? "Start" : "Target";
	return (
		<TextField
			field={which === "start" ? "start-date" : "target-date"}
			value={raw}
			label={label}
			display={<span className="text-body-sm text-ink">{display}</span>}
			commitFields={(next) =>
				which === "start" ? { start_date: next } : { target_date: next }
			}
			validate={(next) => {
				const issue = projectDateFieldRule(next);
				if (issue) return issue;
				return which === "start"
					? projectDateOrderRule(next, project.target_date ?? "")
					: projectDateOrderRule(project.start_date ?? "", next);
			}}
			labels={editLabels(`${label.toLowerCase()} date`, label)}
			commit={commit}
			placeholder="YYYY-MM-DD"
			autoBegin={autoBegin}
			onRetire={onRetire}
		/>
	);
};

/**
 * The estimate row: a number and its unit, one wire edit.
 *
 * THE NUMBER IS THE FIELD; THE UNIT RIDES IT. Both controls live in one
 * editor, and the save sends only what moved (`estimateChangedFields`): a unit
 * alone is a legal wire change and travels alone; an emptied number travels as
 * nothing, because the wire cannot clear an estimate - the editor says so
 * instead of pretending (the sheet's review-round-1 finding, kept verbatim).
 */
export const ProjectEstimateField: FC<{
	project: DesktopProjectView;
	commit: CommitProjectFields;
	autoBegin?: boolean;
	onRetire?: (outcome: "cancelled" | "filled") => void;
}> = ({ project, commit, autoBegin = false, onRetire }) => {
	const base = {
		estimate: project.estimate,
		unit: (project.estimate_unit === "days" ? "days" : "points") as
			| "points"
			| "days",
	};
	const [open, setOpen] = useState(autoBegin);
	useEffect(() => {
		if (open && project.estimate !== null) {
			setOpen(false);
			onRetire?.("filled");
		}
	}, [open, project.estimate, onRetire]);
	const api = useInlineEdit<ProjectEstimateDraft>({
		value: {
			number: project.estimate === null ? "" : String(project.estimate),
			unit: base.unit,
		},
		equals: estimateDraftEquals,
		commit: async (draft) => {
			const fields = estimateChangedFields(base, draft);
			if (fields) await commit(fields);
		},
		validate: (draft) => projectEstimateNumberRule(draft.number),
		labels: editLabels("estimate", "Estimate"),
		selectAllOnBegin: true,
		beginOnMount: autoBegin,
		errorCopy: projectWriteErrorCopy,
		onSettle: (outcome) => {
			if (outcome === "cancelled") {
				setOpen(false);
				onRetire?.("cancelled");
			}
		},
	});
	if (!open && project.estimate === null) return null;
	const display = estimateLabel(project.estimate, project.estimate_unit) || "—";
	return (
		<FieldShell
			field="estimate"
			fieldRef={api.fieldRef}
			fieldProps={api.fieldProps}
			editing={api.editing}
			label="Estimate"
			display={<span className="text-body-sm text-ink">{display}</span>}
			slot={api}
			feedback={api}
			editor={
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-2">
						<Input
							ref={api.editorRef as RefObject<HTMLInputElement>}
							{...api.editorAria}
							data-project-estimate=""
							value={api.draft.number}
							readOnly={api.phase === "saving"}
							placeholder="13"
							inputMode="decimal"
							aria-label={api.labels.name}
							onChange={(event) =>
								api.setDraft({ ...api.draft, number: event.target.value })
							}
							className="h-8 max-w-24"
						/>
						<Select
							value={api.draft.unit}
							onValueChange={(value) =>
								api.setDraft({
									...api.draft,
									unit: value as "points" | "days",
								})
							}
						>
							<SelectTrigger
								data-project-estimate-unit=""
								aria-label="Estimate unit"
								aria-invalid={api.editorAria["aria-invalid"]}
								className="h-8 w-fit min-w-28"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="points">Points</SelectItem>
								<SelectItem value="days">Days</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{api.draft.number.trim() === "" && base.estimate !== null && (
						<p className="text-meta text-ink-muted">
							Clearing an estimate is not supported yet — saving keeps its
							current value.
						</p>
					)}
				</div>
			}
		/>
	);
};

/**
 * The tags row: chips at rest, a comma-separated input while editing.
 *
 * The draft's identity is the parsed LIST (`tagsDraftEquals`), so spacing
 * alone is not a change; the save carries the parsed array, and an empty field
 * clears (the wire's `[]`). While editing, the chips under the input preview
 * the same parse, so what a reader sees is what a save will send.
 */
export const ProjectTagsField: FC<{
	project: DesktopProjectView;
	commit: CommitProjectFields;
	autoBegin?: boolean;
	onRetire?: (outcome: "cancelled" | "filled") => void;
}> = ({ project, commit, autoBegin = false, onRetire }) => {
	const [open, setOpen] = useState(autoBegin);
	useEffect(() => {
		if (open && project.tags.length > 0) {
			setOpen(false);
			onRetire?.("filled");
		}
	}, [open, project.tags, onRetire]);
	const api = useInlineEdit<string>({
		value: project.tags.join(", "),
		/*
		 * THE COMPARATOR COMPARES ITS TWO ARGUMENTS (review round 1, M2). It
		 * used to close over the live `project.tags` (`(_base, draft) =>
		 * tagsDraftEquals(project.tags, draft)`), which made `equals(base,
		 * fresh)` vacuously true: the never-clobber rule could not fire for
		 * tags, and a CLEAN draft whose spacing differed from a moved record
		 * read as dirty against the record - a blur could revert an
		 * out-of-band write. Both sides are parsed now, so only a real,
		 * whitespace-insensitive change is a change.
		 */
		equals: (a, b) => tagsDraftEquals(parseProjectTags(a), b),
		commit: async (next) => {
			const { tags } = projectTagsFieldRule(next);
			await commit({ tags });
		},
		validate: (next) => projectTagsFieldRule(next).error,
		labels: editLabels("tags", "Tags"),
		selectAllOnBegin: true,
		beginOnMount: autoBegin,
		errorCopy: projectWriteErrorCopy,
		onSettle: (outcome) => {
			if (outcome === "cancelled") {
				setOpen(false);
				onRetire?.("cancelled");
			}
		},
	});
	if (!open && project.tags.length === 0) return null;
	const shownTags = api.editing ? parseProjectTags(api.draft) : project.tags;
	return (
		<FieldShell
			field="tags"
			fieldRef={api.fieldRef}
			fieldProps={api.fieldProps}
			editing={api.editing}
			label="Tags"
			display={
				<span className="flex flex-wrap items-center gap-1.5">
					{project.tags.map((tag) => (
						<Badge key={tag} variant="outline">
							{tag}
						</Badge>
					))}
				</span>
			}
			slot={api}
			feedback={api}
			editor={
				<div className="flex flex-col gap-1">
					<Input
						ref={api.editorRef as RefObject<HTMLInputElement>}
						{...api.editorAria}
						data-project-tags=""
						value={api.draft}
						readOnly={api.phase === "saving"}
						placeholder="q4, payments"
						aria-label={api.labels.name}
						onChange={(event) => api.setDraft(event.target.value)}
						className="h-8 max-w-72"
					/>
					<span className="flex flex-wrap items-center gap-1.5">
						{shownTags.map((tag) => (
							<Badge key={tag} variant="outline">
								{tag}
							</Badge>
						))}
					</span>
				</div>
			}
		/>
	);
};
