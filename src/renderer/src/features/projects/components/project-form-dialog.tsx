/**
 * The one create/edit form for a project, used by the tab's `New project` and
 * by every row's `Edit`.
 *
 * WHY ONE DIALOG FOR BOTH MODES, and why the field sets differ inside it: the
 * create route's body is the backend's frozen contract (`name`, `description`,
 * `status`, `tags`) — the display title, the owner/team attributions, dates,
 * the estimate and milestones are set afterwards via PATCH — so the create
 * mode does not RENDER controls the route cannot carry, rather than rendering
 * them disabled or letting them silently drop. Edit mode carries every
 * editable field the PATCH route accepts, attributions included, and an
 * emptied attribution CLEARS it there (the wire reads `""` as unset, unlike
 * the estimate below).
 *
 * A REFUSAL STAYS IN THE DIALOG. The backend's own 409/422 sentence renders
 * under the fields (the `delete-conversation-dialog.tsx` rule) instead of a
 * toast over a closed dialog, which would read as "it saved and something else
 * went wrong".
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
import type { FC } from "react";
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
import { PROJECT_DAY_FIELD_PATTERN, refusalCopy } from "../project-model";

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
	| { mode: "create"; fields: ProjectCreateFields }
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

type ProjectFormDialogProps = {
	open: boolean;
	mode: "create" | "edit";
	/** Present in edit mode; `null`/absent in create mode. */
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
	const fieldId = useId();

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
		setForm(formFromInitial(initial));
		setErrors({});
		setRefusal(null);
		setSubmitting(false);
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

	/** Local validation, the same rules the wire will enforce. */
	const validate = (
		values: FormState,
	): Partial<Record<keyof FormState, string>> => {
		const next: Partial<Record<keyof FormState, string>> = {};
		const nameError = projectNameRule(values.name.trim());
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
		if (mode === "edit") {
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
		}
		return next;
	};

	const handleSubmit = async () => {
		const issues = validate(form);
		setErrors(issues);
		if (Object.keys(issues).length > 0) return;
		setSubmitting(true);
		setRefusal(null);
		const tags = parseProjectTags(form.tags);
		try {
			if (mode === "create") {
				await onSubmit({
					mode: "create",
					fields: {
						name: form.name.trim(),
						...(form.description.trim()
							? { description: form.description.trim() }
							: {}),
						status: form.status as DesktopProjectStatus,
						...(tags.length > 0 ? { tags } : {}),
					},
				});
			} else {
				await onSubmit({
					mode: "edit",
					key: initial?.key ?? "",
					fields: {
						name: form.name.trim(),
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

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={title}
			maxWidth="sm"
			dataTourTag={
				mode === "create" ? "project-create-dialog" : "project-edit-dialog"
			}
			actions={
				<>
					<SecondaryButton onClick={onClose} disabled={submitting}>
						Cancel
					</SecondaryButton>
					<PrimaryButton
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
				className="flex flex-col gap-4 px-1 py-1"
				onSubmit={(event) => {
					event.preventDefault();
					void handleSubmit();
				}}
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${fieldId}-name`}>Name</Label>
					<Input
						id={`${fieldId}-name`}
						value={form.name}
						onChange={(event) => set("name", event.target.value)}
						placeholder="payments-migration"
						autoFocus
						aria-invalid={Boolean(errors.name)}
					/>
					{errors.name ? (
						<p className="text-meta text-danger">{errors.name}</p>
					) : (
						<p className="text-meta text-ink-muted">
							Letters, digits, dot, underscore or dash; no spaces.
						</p>
					)}
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${fieldId}-description`}>Description</Label>
					<Textarea
						id={`${fieldId}-description`}
						value={form.description}
						onChange={(event) => set("description", event.target.value)}
						rows={2}
						aria-invalid={Boolean(errors.description)}
					/>
					<div className="flex items-center justify-between gap-2">
						{errors.description ? (
							<p className="text-meta text-danger">{errors.description}</p>
						) : (
							<span />
						)}
						<p className="text-meta text-ink-muted tabular-nums">
							{form.description.length}/{PROJECT_DESCRIPTION_MAX_CHARS}
						</p>
					</div>
				</div>

				{mode === "edit" && (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${fieldId}-title`}>Display title</Label>
						<Input
							id={`${fieldId}-title`}
							value={form.title}
							onChange={(event) => set("title", event.target.value)}
							placeholder="Payments migration"
							aria-invalid={Boolean(errors.title)}
						/>
						{errors.title ? (
							<p className="text-meta text-danger">{errors.title}</p>
						) : (
							<p className="text-meta text-ink-muted">
								Shown instead of the name; the name stays the key everything is
								addressed by.
							</p>
						)}
					</div>
				)}

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
							Comma-separated, up to 8. Lowercase letters, digits, underscore or
							dash.
						</p>
					)}
				</div>

				{mode === "edit" && (
					<>
						<div className="grid grid-cols-2 gap-3">
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
								<Label htmlFor={`${fieldId}-target`}>Target date</Label>
								<Input
									id={`${fieldId}-target`}
									value={form.targetDate}
									onChange={(event) => set("targetDate", event.target.value)}
									placeholder="YYYY-MM-DD"
									aria-invalid={Boolean(errors.targetDate)}
								/>
								{errors.targetDate && (
									<p className="text-meta text-danger">{errors.targetDate}</p>
								)}
							</div>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor={`${fieldId}-owner`}>Owner</Label>
								<Input
									id={`${fieldId}-owner`}
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
									<SelectTrigger
										aria-label="Estimate unit"
										className="max-w-32"
									>
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
					</>
				)}

				{refusal && (
					<p ref={refusalRef} className="text-body-sm text-danger">
						{refusal}
					</p>
				)}
			</form>
		</BaseDialog>
	);
};
