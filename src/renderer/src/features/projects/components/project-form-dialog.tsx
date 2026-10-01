/**
 * The CREATE sheet for a project, used by the tab's `New project` — the
 * Linear-style replacement for the small two-column dialog.
 *
 * CREATE-ONLY SINCE THE INLINE-EDIT SLICE (operator, 2026-09-30): the sheet
 * used to carry an edit mode, and every field it edited is now edited in place
 * on the project's own page (`project-editors.tsx`), so the mode was retired
 * rather than kept as a second way to edit the same record — the “one writer”
 * rule this tab states elsewhere. What survives is the create path and its own
 * asymmetry: the create route's body is the backend's frozen contract
 * (`name`, `description`, `status`, `tags`), so the display title, the
 * owner/team attributions, the dates and the estimate ride a follow-up PATCH
 * (`followUp` below) applied by the page only after the create landed. A
 * create refusal is still the dialog's own sentence; a follow-up refusal — the
 * project EXISTS at that point — is the page's error toast rather than an
 * in-place sentence that would read as “the create failed”.
 *
 * A REFUSAL STAYS IN THE DIALOG. The backend's own 409/422 sentence renders
 * under the fields (the `delete-conversation-dialog.tsx` rule) instead of a
 * toast over a closed dialog, which would read as “it saved and something else
 * went wrong”.
 *
 * TITLE-FIRST, KEY SECONDARY. The author writes a title; the project's KEY —
 * the `name` every route addresses the project by — is derived from the title
 * by `projectKeyFromTitle` until the author touches the key field, after which
 * it is theirs (the classic slug rule: editing the title must never overwrite
 * a key someone chose).
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
} from "../../../../../shared/desktop-contract";
import type { DesktopProjectStatus } from "../../../../../shared/desktop-control-contract";
import type {
	ProjectCreateFields,
	ProjectEditFields,
} from "../hooks/use-projects-queries";
import {
	parseProjectTags,
	projectAttributionRule,
	projectDateFieldRule,
	projectDateOrderRule,
	projectDescriptionRule,
	projectEstimateNumberRule,
	projectTagsFieldRule,
	projectTitleRule,
} from "../project-edit-model";
import { ProjectMarkdown } from "../project-markdown";
import { PROJECT_STATUS_OPTIONS, refusalCopy } from "../project-model";
import {
	PROJECT_DESCRIPTION_TEMPLATE,
	pasteMarkdownIntoDescription,
	projectKeyFromTitle,
} from "../project-sheet-model";

/**
 * What the page hands back when the create sheet is submitted.
 *
 * The fields the CREATE route carries, plus the PATCH it cannot (title,
 * owner, team, dates, estimate) — applied by the page after the create lands.
 * Absent when the author filled none of them.
 */
export type ProjectFormSubmit = {
	fields: ProjectCreateFields;
	followUp?: ProjectEditFields;
};

export type ProjectFormDialogProps = {
	open: boolean;
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

export const ProjectFormDialog: FC<ProjectFormDialogProps> = ({
	open,
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
	 * Whether the key field is the author's. False until they type in it (so
	 * the derivation may fill it) — the key is never pre-filled now that the
	 * sheet is create-only.
	 */
	const [keyTouched, setKeyTouched] = useState(false);
	const [preview, setPreview] = useState(false);
	const fieldId = useId();
	const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

	/*
	 * The form is rebuilt whenever the dialog OPENS: a create sheet is only
	 * ever opened deliberately, and a form that kept yesterday's half-typed
	 * fields on the next open would drop the user into a draft they did not
	 * ask to resume. `open` is the trigger that means "the user asked for this
	 * form".
	 */
	useEffect(() => {
		if (!open) return;
		setForm({ ...EMPTY_FORM, description: PROJECT_DESCRIPTION_TEMPLATE });
		setErrors({});
		setRefusal(null);
		setSubmitting(false);
		setKeyTouched(false);
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
	 * The key the submit will carry: the derivation while untouched, the field
	 * itself once the author types in it.
	 */
	const resolvedKey = keyTouched ? form.name : projectKeyFromTitle(form.title);

	/**
	 * The description's paste path, shared with the detail's inline editor
	 * (`pasteMarkdownIntoDescription`): rich clipboard HTML becomes markdown. A
	 * plain-text paste is deliberately NOT intercepted — markdown pasted as
	 * text is already markdown, and eating it to round-trip would only risk
	 * changing it.
	 */
	const handleDescriptionPaste = (event: ClipboardEvent<HTMLTextAreaElement>) =>
		pasteMarkdownIntoDescription(event, descriptionRef, (next) =>
			set("description", next),
		);

	/** Local validation, the same rules the wire will enforce. */
	const validate = (
		values: FormState,
		keyValue: string,
	): Partial<Record<keyof FormState, string>> => {
		const next: Partial<Record<keyof FormState, string>> = {};
		const nameError = projectNameRule(keyValue);
		if (nameError) next.name = nameError;
		const descriptionError = projectDescriptionRule(values.description);
		if (descriptionError) next.description = descriptionError;
		const tagsError = projectTagsFieldRule(values.tags).error;
		if (tagsError) next.tags = tagsError;
		const startError = projectDateFieldRule(values.startDate);
		if (startError) next.startDate = startError;
		const targetError = projectDateFieldRule(values.targetDate);
		if (targetError) next.targetDate = targetError;
		else if (!startError) {
			const orderError = projectDateOrderRule(
				values.startDate,
				values.targetDate,
			);
			if (orderError) next.targetDate = orderError;
		}
		/*
		 * The estimate rides the follow-up patch when present. An EMPTIED field is
		 * not an error: there is nothing to send, and the patch simply omits the
		 * key (the backend's edit model cannot clear one — the same honesty
		 * `project-editors.tsx` states for the detail's row).
		 */
		if (values.estimate.trim()) {
			const estimateError = projectEstimateNumberRule(values.estimate);
			if (estimateError) next.estimate = estimateError;
		}
		/*
		 * The attributions' one local rule: the same 80-character ceiling the
		 * wire enforces, said in the field rather than after a round trip.
		 * Newlines are not checked — the wire trims and accepts short
		 * single-line labels, and a stray newline in a label is a refusal the
		 * backend's own sentence explains better than one invented here.
		 */
		const titleError = projectTitleRule(values.title);
		if (titleError) next.title = titleError;
		const ownerError = projectAttributionRule(values.owner, "owner");
		if (ownerError) next.owner = ownerError;
		const teamError = projectAttributionRule(values.team, "team");
		if (teamError) next.team = teamError;
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
			/*
			 * The follow-up carries only what the author actually filled: the
			 * store's update is per-field last-writer-wins, and sending a field
			 * the author left alone would be a write nobody asked for (worst of
			 * all an emptied attribution, which the wire reads as "clear").
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
			onClose();
		} catch (error) {
			const message =
				error instanceof Error && error.message ? error.message : "";
			setRefusal(refusalCopy(message) || "The project was not saved.");
		} finally {
			setSubmitting(false);
		}
	};

	const title = "New project";

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
			dataTourTag="project-create-dialog"
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
						Create project
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
							{keyTouched
								? "Letters, digits, dot, underscore or dash; no spaces."
								: "Derived from the title until you edit it."}
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
								{PROJECT_STATUS_OPTIONS.map((option) => (
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
