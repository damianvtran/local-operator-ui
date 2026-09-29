/**
 * The one create/edit SHEET for a project, used by the tab's `New project`,
 * every row's `Edit` and the detail's `Edit` — the Linear-style replacement for
 * the small two-column dialog.
 *
 * WHY ONE SHEET FOR BOTH MODES, and why the field sets differ inside it: the
 * create route's body is the backend's frozen contract (`name`, `description`,
 * `status`, `tags`) — the display title, the owner/team attributions, the
 * dates and the estimate are set afterwards via PATCH. The sheet renders the
 * FULL set in both modes (the operator's brief: one properties strip, one
 * editor), and the page performs create-then-patch for the fields the create
 * route cannot carry: `followUp` on the payload below is that patch, applied
 * only after the create landed, so a create refusal is still the dialog's own
 * sentence and a follow-up refusal — the project EXISTS at that point — is the
 * page's error toast rather than an in-place sentence that would read as "the
 * create failed".
 *
 * A REFUSAL STAYS IN THE DIALOG. The backend's own 409/422 sentence renders
 * under the fields (the `delete-conversation-dialog.tsx` rule) instead of a
 * toast over a closed dialog, which would read as "it saved and something else
 * went wrong". The one exception is the follow-up patch above, and it is
 * named where it is implemented (`projects-page.tsx`).
 *
 * TITLE-FIRST, KEY SECONDARY. The author writes a title; the project's KEY —
 * the `name` every route addresses the project by — is derived from the title
 * by `projectKeyFromTitle` until the author touches the key field, after which
 * it is theirs (the classic slug rule: editing the title must never overwrite
 * a key someone chose). Edit mode never derives: the key is a field, prefilled.
 *
 * WHAT EDIT MODE SENDS, precisely: every field the form shows, including the
 * unchanged ones. That is safe because the store's update is per-field
 * last-writer-wins and PROVES a no-op by equality (`candidate == current`
 * returns without a write), so an unchanged field neither bumps `updated_at`
 * nor races a concurrent editor of another field. The one asymmetry named
 * here rather than hidden: an EMPTIED estimate is not sent, because the
 * backend's edit model cannot clear one (`estimate` merging is
 * `if fields.estimate is not None`), and inventing a client-side clearing path
 * the route would ignore is worse than the field keeping its old value.
 */

import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import {
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { ClipboardEvent, FC } from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
	PROJECT_DESCRIPTION_MAX_CHARS,
	projectNameRule,
	projectTagRule,
} from "../../../../../shared/desktop-contract";
import type { DesktopProjectStatus } from "../../../../../shared/desktop-control-contract";
import type {
	ProjectCreateFields,
	ProjectEditFields,
} from "../hooks/use-projects-queries";
import { ProjectMarkdown } from "../project-markdown";
import { PROJECT_DAY_FIELD_PATTERN, refusalCopy } from "../project-model";
import {
	PROJECT_DESCRIPTION_TEMPLATE,
	markdownFromClipboardHtml,
	projectKeyFromTitle,
} from "../project-sheet-model";

/**
 * The status words, in the lifecycle's own order (the wire enum's order, which
 * `PROJECT_STATUSES` writes once): planning -> active -> qa -> validation ->
 * done, then the two side states. The menu reads in that order because the
 * phases are a sequence — a menu that shuffled them would make the pipeline
 * unreadable at the one place a user moves a project along it.
 */
const STATUS_OPTIONS: { value: DesktopProjectStatus; label: string }[] = [
	{ value: "planning", label: "Planning" },
	{ value: "active", label: "Active" },
	{ value: "qa", label: "QA" },
	{ value: "validation", label: "Validation" },
	{ value: "done", label: "Done" },
	{ value: "paused", label: "Paused" },
	{ value: "archived", label: "Archived" },
];

/** What the page hands back when the form is submitted. */
export type ProjectFormSubmit =
	| {
			mode: "create";
			fields: ProjectCreateFields;
			/*
			 * The PATCH the create route cannot carry (title, owner, team, dates,
			 * estimate), applied by the page after the create lands. Absent when
			 * the author filled none of them.
			 */
			followUp?: ProjectEditFields;
	  }
	| { mode: "edit"; key: string; fields: ProjectEditFields };

export type ProjectFormInitial = {
	key: string;
	name: string;
	title: string | null;
	owner: string | null;
	team: string | null;
	description: string;
	status: string;
	tags: string[];
	start_date: string | null;
	target_date: string | null;
	estimate: number | null;
	estimate_unit: string;
};

export type ProjectFormDialogProps = {
	open: boolean;
	mode: "create" | "edit";
	/** The row being edited; null/undefined in create mode. */
	initial?: ProjectFormInitial | null;
	onClose: () => void;
	onSubmit: (payload: ProjectFormSubmit) => Promise<void>;
};

type FormState = {
	name: string;
	title: string;
	owner: string;
	team: string;
	description: string;
	status: string;
	tags: string;
	startDate: string;
	targetDate: string;
	estimate: string;
	estimateUnit: string;
};

const EMPTY_FORM: FormState = {
	name: "",
	title: "",
	owner: "",
	team: "",
	description: "",
	status: "active",
	tags: "",
	startDate: "",
	targetDate: "",
	estimate: "",
	estimateUnit: "points",
};

/** `2026-09-20`, or `""` — the one day shape every date field accepts. */
const ISO_DAY = PROJECT_DAY_FIELD_PATTERN;

/** The comma text a tags field holds, as the wire's list. */
export function parseProjectTags(raw: string): string[] {
	return raw
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

function formFromInitial(
	initial: ProjectFormInitial | null | undefined,
): FormState {
	if (!initial) return EMPTY_FORM;
	return {
		name: initial.name,
		title: initial.title ?? "",
		owner: initial.owner ?? "",
		team: initial.team ?? "",
		description: initial.description,
		status: initial.status,
		tags: initial.tags.join(", "),
		startDate: initial.start_date ?? "",
		targetDate: initial.target_date ?? "",
		estimate:
			initial.estimate === null || initial.estimate === undefined
				? ""
				: String(initial.estimate),
		estimateUnit: initial.estimate_unit || "points",
	};
}

export const ProjectFormDialog: FC<ProjectFormDialogProps> = ({
	open,
	mode,
	initial,
	onClose,
	onSubmit,
}) => {
	const [form, setForm] = useState<FormState>(EMPTY_FORM);
	const [errors, setErrors] = useState<
		Partial<Record<keyof FormState, string>>
	>({});
	/** The backend's own sentence when a submit is refused. */
	const [refusal, setRefusal] = useState<string | null>(null);
	const refusalRef = useRef<HTMLParagraphElement | null>(null);
	const [submitting, setSubmitting] = useState(false);
	/**
	 * Whether the key field is the author's. False in create until they type in
	 * it (so the derivation may fill it), true from the first render in edit
	 * (the key exists; nothing derives).
	 */
	const [keyTouched, setKeyTouched] = useState(mode === "edit");
	const [preview, setPreview] = useState(false);
	const fieldId = useId();
	const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

	/*
	 * The form is rebuilt whenever the dialog OPENS, not on every render of
	 * `initial`: a background refetch (the listing invalidates after a write
	 * elsewhere) hands a new object identity for the same project, and a form
	 * that reset under the user's fingers would drop every keystroke they had
	 * typed. `open` is the trigger that means "the user asked for this form".
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on the open transition, see above.
	useEffect(() => {
		if (!open) return;
		setForm(
			mode === "create"
				? { ...EMPTY_FORM, description: PROJECT_DESCRIPTION_TEMPLATE }
				: formFromInitial(initial),
		);
		setErrors({});
		setRefusal(null);
		setSubmitting(false);
		setKeyTouched(mode === "edit");
		setPreview(false);
	}, [open]);

	/*
	 * A refused save's sentence lands at the END of the dialog's scrolling body
	 * (UX round 2, U3 measured it below the fold at the fresh-open position)
	 * and this path raises no toast, so without this the reason for the refusal
	 * the user just triggered sits off-screen until they scroll by hand.
	 * `nearest` moves the body the minimum needed, and only when the paragraph
	 * is actually out of view.
	 */
	useEffect(() => {
		if (refusal) refusalRef.current?.scrollIntoView({ block: "nearest" });
	}, [refusal]);

	const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	/**
	 * The key the submit will carry: the derivation while untouched in create,
	 * the field itself otherwise (edit, or after a keystroke).
	 */
	const resolvedKey =
		mode === "create" && !keyTouched
			? projectKeyFromTitle(form.title)
			: form.name;

	/**
	 * The description's paste path: rich clipboard HTML becomes markdown
	 * (`markdownFromClipboardHtml`). A plain-text paste is deliberately NOT
	 * intercepted — markdown pasted as text is already markdown, and eating it
	 * to round-trip would only risk changing it.
	 */
	const handleDescriptionPaste = (
		event: ClipboardEvent<HTMLTextAreaElement>,
	) => {
		const html = event.clipboardData?.getData("text/html");
		if (!html) return;
		const markdown = markdownFromClipboardHtml(html);
		if (!markdown) return;
		event.preventDefault();
		const element = event.currentTarget;
		const start = element.selectionStart ?? element.value.length;
		const end = element.selectionEnd ?? start;
		const next =
			element.value.slice(0, start) + markdown + element.value.slice(end);
		set("description", next);
		/*
		 * The caret lands after the pasted run, as a paste's caret does. The
		 * frame is what makes it land at all: React applies the controlled
		 * value after this handler returns, and a selection set before that
		 * would be clamped against the OLD value.
		 */
		requestAnimationFrame(() => {
			const field = descriptionRef.current;
			if (!field) return;
			const caret = start + markdown.length;
			field.setSelectionRange(caret, caret);
		});
	};

	/** Local validation, the same rules the wire will enforce. */
	const validate = (
		values: FormState,
		keyValue: string,
	): Partial<Record<keyof FormState, string>> => {
		const next: Partial<Record<keyof FormState, string>> = {};
		const nameError = projectNameRule(keyValue);
		if (nameError) next.name = nameError;
		if (values.description.length > PROJECT_DESCRIPTION_MAX_CHARS)
			next.description = `Keep the description within ${PROJECT_DESCRIPTION_MAX_CHARS} characters.`;
		const tags = parseProjectTags(values.tags);
		if (tags.length > 8) next.tags = "At most 8 tags.";
		else {
			for (const tag of tags) {
				const tagError = projectTagRule(tag);
				if (tagError) {
					next.tags = tagError;
					break;
				}
			}
		}
		/*
		 * The remaining rules run in BOTH modes: the sheet renders the dates,
		 * the estimate and the attributions in create mode too (they ride the
		 * follow-up patch), so validating them only in edit would let the
		 * create sheet hand the page values the page's patch would refuse.
		 */
		if (!ISO_DAY.test(values.startDate))
			next.startDate = "Dates are YYYY-MM-DD, or empty.";
		if (!ISO_DAY.test(values.targetDate))
			next.targetDate = "Dates are YYYY-MM-DD, or empty.";
		if (
			!next.startDate &&
			!next.targetDate &&
			values.startDate &&
			values.targetDate &&
			values.targetDate < values.startDate
		)
			next.targetDate = "The target date is before the start date.";
		if (values.estimate) {
			const estimate = Number(values.estimate);
			if (!Number.isFinite(estimate) || !(estimate > 0) || estimate > 1000)
				next.estimate = "Estimates are greater than 0 and at most 1000.";
		}
		/*
		 * The attributions' one local rule: the same 80-character ceiling the
		 * wire enforces, said in the field rather than after a round trip.
		 * Newlines are not checked — the wire trims and accepts short
		 * single-line labels, and a stray newline in a label is a refusal the
		 * backend's own sentence explains better than one invented here.
		 */
		for (const key of ["title", "owner", "team"] as const) {
			if (values[key].trim().length > 80)
				next[key] =
					`${key === "title" ? "Titles" : key === "owner" ? "Owners" : "Teams"} are at most 80 characters.`;
		}
		return next;
	};

	const handleSubmit = async () => {
		const keyValue = resolvedKey.trim();
		const issues = validate(form, keyValue);
		setErrors(issues);
		if (Object.keys(issues).length > 0) return;
		setSubmitting(true);
		setRefusal(null);
		const tags = parseProjectTags(form.tags);
		try {
			if (mode === "create") {
				/*
				 * The follow-up carries only what the author actually filled:
				 * the store's update is per-field last-writer-wins, and sending
				 * a field the author left alone would be a write nobody asked
				 * for (worst of all an emptied attribution, which the wire reads
				 * as "clear").
				 */
				const followUp: ProjectEditFields = {};
				if (form.title.trim()) followUp.title = form.title.trim();
				if (form.owner.trim()) followUp.owner = form.owner.trim();
				if (form.team.trim()) followUp.team = form.team.trim();
				if (form.startDate) followUp.start_date = form.startDate;
				if (form.targetDate) followUp.target_date = form.targetDate;
				if (form.estimate) {
					followUp.estimate = Number(form.estimate);
					followUp.estimate_unit = form.estimateUnit as "points" | "days";
				}
				await onSubmit({
					mode: "create",
					fields: {
						name: keyValue,
						/*
						 * THE UNTOUCHED TEMPLATE IS NOT AUTHORED TEXT (UX round 1, U3):
						 * the sheet seeds the section skeleton, and a submit that never
						 * wrote a word must not file the seed as the project's own
						 * description. Equality with the constant is the test — any edit,
						 * however small, ships as authored.
						 */
						...(form.description.trim() &&
						form.description.trim() !== PROJECT_DESCRIPTION_TEMPLATE
							? { description: form.description.trim() }
							: {}),
						status: form.status as DesktopProjectStatus,
						...(tags.length > 0 ? { tags } : {}),
					},
					...(Object.keys(followUp).length > 0 ? { followUp } : {}),
				});
			} else {
				await onSubmit({
					mode: "edit",
					key: initial?.key ?? "",
					fields: {
						name: keyValue,
						description: form.description.trim(),
						/*
						 * The attributions travel as typed, EMPTY INCLUDED: `""` is the
						 * wire's own spelling for "cleared" (`_short_text_or_none` reads it
						 * as unset), which is the one way this dialog can return a field to
						 * its unknown state.
						 */
						title: form.title.trim(),
						owner: form.owner.trim(),
						team: form.team.trim(),
						status: form.status as DesktopProjectStatus,
						tags,
						start_date: form.startDate,
						target_date: form.targetDate,
						// An emptied estimate is NOT sent: the backend's edit model
						// cannot clear one (see this file's docstring), so the field
						// simply keeps its old value.
						...(form.estimate ? { estimate: Number(form.estimate) } : {}),
						estimate_unit: form.estimateUnit as "points" | "days",
					},
				});
			}
			onClose();
		} catch (error) {
			const message =
				error instanceof Error && error.message ? error.message : "";
			setRefusal(refusalCopy(message) || "The project was not saved.");
		} finally {
			setSubmitting(false);
		}
	};

	const title = mode === "create" ? "New project" : "Edit project";

	/**
	 * The live over-limit read the counter's tone and the textarea's
	 * `aria-invalid` share (design round 1, D1): the field warns while the text
	 * is being written, not only when the submit bounces.
	 */
	const descriptionOver =
		form.description.length > PROJECT_DESCRIPTION_MAX_CHARS;

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={title}
			/*
			 * `fullWidth` + `md` = the sheet's size: the panel is `w-auto` by
			 * default, which hugs the form's intrinsic width (~500px) no matter
			 * what `maxWidth` allows — the operator's "much larger sheet" needs
			 * the panel to CLAIM its width and let the cap bound it (896px at the
			 * `md` step). The `integration-sign-in-dialog` precedent.
			 */
			fullWidth
			maxWidth="md"
			/*
			 * THE PENDING WINDOW HAS ONE POLICY (UX round 1 U1; round 2 U7):
			 * Cancel is disabled while a save is in flight, and the other three
			 * close paths obey the same rule — Escape and an outside click are
			 * refused, and the corner X is disabled (it closes through Radix's own
			 * `DialogPrimitive.Close` path, which a caller cannot intercept, so
			 * the primitive takes the state as `closeDisabled`). A close there
			 * would abandon a write whose refusal the author was about to read.
			 */
			dialogProps={{
				closeDisabled: submitting,
				onEscapeKeyDown: (event: KeyboardEvent) => {
					if (submitting) event.preventDefault();
				},
				onInteractOutside: (event: Event) => {
					if (submitting) event.preventDefault();
				},
			}}
			dataTourTag={
				mode === "create" ? "project-create-dialog" : "project-edit-dialog"
			}
			actions={
				<>
					<SecondaryButton onClick={onClose} disabled={submitting}>
						Cancel
					</SecondaryButton>
					<PrimaryButton
						data-project-submit=""
						onClick={() => void handleSubmit()}
						disabled={submitting}
					>
						{submitting && <Spinner size="xs" />}
						{mode === "create" ? "Create project" : "Save changes"}
					</PrimaryButton>
				</>
			}
		>
			<form
				className="flex flex-col gap-6 px-1 py-1"
				onSubmit={(event) => {
					event.preventDefault();
					void handleSubmit();
				}}
			>
				{/*
				 * TITLE-FIRST: the title is the sheet's heading (one step up in
				 * type), the key sits under it in machine voice — secondary, but
				 * addressable and editable.
				 */}
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${fieldId}-title`}>Title</Label>
					<Input
						id={`${fieldId}-title`}
						data-project-title=""
						value={form.title}
						onChange={(event) => set("title", event.target.value)}
						placeholder="Payments migration"
						autoFocus
						className="h-10 text-heading"
						aria-invalid={Boolean(errors.title)}
					/>
					{errors.title && (
						<p className="text-meta text-danger">{errors.title}</p>
					)}
					<div className="flex items-center gap-2">
						<Label
							htmlFor={`${fieldId}-key`}
							className="shrink-0 text-meta text-ink-muted"
						>
							Key
						</Label>
						<Input
							id={`${fieldId}-key`}
							data-project-key=""
							value={resolvedKey}
							onChange={(event) => {
								setKeyTouched(true);
								set("name", event.target.value);
							}}
							placeholder="payments-migration"
							aria-invalid={Boolean(errors.name)}
							className="h-7 max-w-56 font-mono text-mono-sm"
						/>
						<span className="text-meta text-ink-muted">
							{mode === "create" && !keyTouched
								? "Derived from the title until you edit it."
								: "Letters, digits, dot, underscore or dash; no spaces."}
						</span>
					</div>
					{errors.name && (
						<p className="text-meta text-danger">{errors.name}</p>
					)}
				</div>

				<div className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between gap-3">
						<Label htmlFor={`${fieldId}-description`}>Description</Label>
						{/*
						 * The Write|Preview toggle, the mesh page's own segmented
						 * pattern (`aria-pressed` on a `fieldset` track) rather than a
						 * new control: a second way to present a choice beside the one
						 * the app already ships is the defect this repo names.
						 */}
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
											"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
											preview === (option === "preview") &&
												"bg-surface text-ink",
										)}
									>
										{option === "write" ? "Write" : "Preview"}
									</button>
								))}
							</div>
						</fieldset>
					</div>
					{preview ? (
						/*
						 * PARITY WITH THE TEXTAREA (design round 1, D2): the preview box and
						 * the write textarea share `h-44`, so toggling Write|Preview moves
						 * nothing above or below them — the first cut was min-h-40 here
						 * against the textarea's 174px, a re-centre the toggle measured.
						 * The textarea is `resize-none` for the same reason: one pane that
						 * can change height under a fixed-height sibling breaks the parity
						 * it just bought.
						 */
						<div
							data-project-description-preview=""
							className="h-44 overflow-y-auto rounded-md border border-hairline bg-sunken px-3 py-2"
						>
							{form.description.trim() ? (
								<ProjectMarkdown className="text-body-sm">
									{form.description}
								</ProjectMarkdown>
							) : (
								<p className="text-body-sm text-ink-muted">
									Nothing to preview yet.
								</p>
							)}
						</div>
					) : (
						<Textarea
							ref={descriptionRef}
							id={`${fieldId}-description`}
							data-project-description=""
							value={form.description}
							onChange={(event) => set("description", event.target.value)}
							onPaste={handleDescriptionPaste}
							rows={8}
							placeholder="Markdown — headings, lists, code."
							aria-invalid={descriptionOver || Boolean(errors.description)}
							className="h-44 resize-none"
						/>
					)}
					<div className="flex items-center justify-between gap-2">
						{errors.description ? (
							<p className="text-meta text-danger">{errors.description}</p>
						) : (
							<span />
						)}
						<p
							className={cn(
								"text-meta tabular-nums",
								/*
								 * THE COUNTER WARNS BEFORE THE SUBMIT DOES (design round 1, D1):
								 * the first cut went muted past the cap and only the wire's
								 * refusal named it at submit time.
								 */
								descriptionOver ? "text-danger" : "text-ink-muted",
							)}
						>
							{form.description.length}/{PROJECT_DESCRIPTION_MAX_CHARS}
						</p>
					</div>
				</div>

				{/*
				 * The properties strip: the same fields the old dialog had, laid
				 * out as two columns of label-over-control rather than a single
				 * column of full-width inputs — the density the brief asked for.
				 */}
				<div className="grid grid-cols-2 gap-x-4 gap-y-4">
					<div className="flex flex-col gap-1.5">
						<Label>Status</Label>
						<Select
							value={form.status}
							onValueChange={(value) => set("status", value)}
						>
							<SelectTrigger aria-label="Status">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{STATUS_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{form.status === "done" && (
							<p className="text-meta text-ink-muted">
								Moving a project to Done stamps today as its completion date.
							</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${fieldId}-owner`}>Owner</Label>
						<Input
							id={`${fieldId}-owner`}
							data-project-owner=""
							value={form.owner}
							onChange={(event) => set("owner", event.target.value)}
							placeholder="atlas"
							aria-invalid={Boolean(errors.owner)}
						/>
						{errors.owner && (
							<p className="text-meta text-danger">{errors.owner}</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${fieldId}-team`}>Team</Label>
						<Input
							id={`${fieldId}-team`}
							value={form.team}
							onChange={(event) => set("team", event.target.value)}
							placeholder="platform"
							aria-invalid={Boolean(errors.team)}
						/>
						{errors.team && (
							<p className="text-meta text-danger">{errors.team}</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${fieldId}-target`}>Target date</Label>
						<Input
							id={`${fieldId}-target`}
							data-project-target=""
							value={form.targetDate}
							onChange={(event) => set("targetDate", event.target.value)}
							placeholder="YYYY-MM-DD"
							aria-invalid={Boolean(errors.targetDate)}
						/>
						{errors.targetDate && (
							<p className="text-meta text-danger">{errors.targetDate}</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${fieldId}-start`}>Start date</Label>
						<Input
							id={`${fieldId}-start`}
							value={form.startDate}
							onChange={(event) => set("startDate", event.target.value)}
							placeholder="YYYY-MM-DD"
							aria-invalid={Boolean(errors.startDate)}
						/>
						{errors.startDate && (
							<p className="text-meta text-danger">{errors.startDate}</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${fieldId}-estimate`}>Estimate</Label>
						<div className="flex items-center gap-3">
							<Input
								id={`${fieldId}-estimate`}
								value={form.estimate}
								onChange={(event) => set("estimate", event.target.value)}
								placeholder="13"
								inputMode="decimal"
								aria-invalid={Boolean(errors.estimate)}
								className="max-w-28"
							/>
							<Select
								value={form.estimateUnit}
								onValueChange={(value) => set("estimateUnit", value)}
							>
								<SelectTrigger aria-label="Estimate unit" className="max-w-32">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="points">Points</SelectItem>
									<SelectItem value="days">Days</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{errors.estimate && (
							<p className="text-meta text-danger">{errors.estimate}</p>
						)}
						{/*
						 * THE CLEARED-ESTIMATE HINT (review round 1, the emptied-Estimate
						 * finding): the backend's edit model cannot clear one
						 * (`projects.py` merges only when `fields.estimate is not
						 * None`), so an emptied field saved "Project saved" and kept the
						 * old value with no hint at all. Until the wire can clear one,
						 * the hint says what the save will do — shown only when there IS
						 * a value the save would keep, so a create form and an edit of a
						 * project with no estimate stay quiet.
						 */}
						{mode === "edit" &&
							form.estimate.trim() === "" &&
							initial?.estimate !== null &&
							initial?.estimate !== undefined && (
								<p className="text-meta text-ink-muted">
									Clearing an estimate is not supported yet — saving keeps its
									current value.
								</p>
							)}
					</div>

					<div className="col-span-2 flex flex-col gap-1.5">
						<Label htmlFor={`${fieldId}-tags`}>Tags</Label>
						<Input
							id={`${fieldId}-tags`}
							value={form.tags}
							onChange={(event) => set("tags", event.target.value)}
							placeholder="q4, payments"
							aria-invalid={Boolean(errors.tags)}
						/>
						{errors.tags ? (
							<p className="text-meta text-danger">{errors.tags}</p>
						) : (
							<p className="text-meta text-ink-muted">
								Comma-separated, up to 8. Lowercase letters, digits, underscore
								or dash.
							</p>
						)}
					</div>
				</div>

				{refusal && (
					<p ref={refusalRef} className="text-body-sm text-danger">
						{refusal}
					</p>
				)}
			</form>
		</BaseDialog>
	);
};
