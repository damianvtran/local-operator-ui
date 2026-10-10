/**
 * The detail page's milestones block: the list, the complete/uncomplete
 * toggle, the remove control and the add row.
 *
 * THE TOGGLE IS A CHECKBOX, and the choice is structural rather than visual: a
 * milestone's completion is one fact with two states, so the control that
 * carries it has to be operable by keyboard, announced with its checked state,
 * and drawable as checked-or-not — a `Switch` (which announces on/off for
 * settings) would be the wrong noun and an icon button would carry the state in
 * a class name where a screen reader cannot read it.
 *
 * THE ADD ROW IS ALWAYS VISIBLE, including over an empty list: creating the
 * first milestone is the common case for a fresh project, and a control that
 * only appears after one exists is a dead end for exactly that case.
 *
 * WHAT THIS FILE DOES NOT DO: derive a milestone's status (the server computes
 * it once from `completed_at` and `target_date` — see `project-model.ts`) or
 * mutate anything itself — the detail page owns the mutations, so the refusal
 * copy lives in one place and this block stays a pure function of its props.
 */

import { Badge, Button, Checkbox, Input, Label } from "@shared/components/ui";
import { Plus, X } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import type { DesktopProjectMilestone } from "../../../../../shared/desktop-control-contract";
import {
	PROJECT_DAY_FIELD_PATTERN,
	formatProjectDay,
	milestoneStatusMeta,
} from "../project-model";

type ProjectMilestonesProps = {
	milestones: DesktopProjectMilestone[];
	/** The header's count (`2 of 5 complete`), derived by the detail screen. */
	summary?: string;
	/** A write is in flight; every control that would start another is disabled. */
	busy: boolean;
	onToggle: (name: string, completed: boolean) => void;
	onRemove: (name: string) => void;
	onAdd: (name: string, targetDate: string) => void;
};

export const ProjectMilestones: FC<ProjectMilestonesProps> = ({
	milestones,
	summary,
	busy,
	onToggle,
	onRemove,
	onAdd,
}) => {
	const [draftName, setDraftName] = useState("");
	const [draftDate, setDraftDate] = useState("");

	/*
	 * THE DATE IS VALIDATED HERE, in the same words the form dialog uses
	 * (review round 1's nit): the add row used to submit whatever was typed and
	 * let the WIRE refuse it, which turned a typo into a toast after a round
	 * trip while every other date in the feature refuses malformed input
	 * inline. Empty is legal (the field is optional) and the pattern says so.
	 */
	const dateInvalid = !PROJECT_DAY_FIELD_PATTERN.test(draftDate.trim());
	const canAdd = draftName.trim().length > 0 && !dateInvalid && !busy;

	const submitAdd = () => {
		if (!canAdd) return;
		onAdd(draftName.trim(), draftDate.trim());
		setDraftName("");
		setDraftDate("");
	};

	return (
		<section
			/* The status field's "Review milestones" lands the reader here. */
			data-project-milestones=""
			className="flex flex-col gap-3"
		>
			<div className="flex items-baseline justify-between gap-3">
				{/*
				 * A FOCUS TARGET, NOT A TAB STOP: the status field's "Review
				 * milestones" lands the reader here (`tabIndex={-1}`), so the
				 * heading is where the caret goes and where a screen reader
				 * starts reading (design round 1, D2). It stays out of the tab
				 * order - the sections below carry their own controls.
				 */}
				<h2
					className="text-title text-ink"
					tabIndex={-1}
					data-project-milestones-heading=""
				>
					Milestones
				</h2>
				{summary && milestones.length > 0 && (
					<span className="text-meta text-ink-muted tabular-nums">
						{summary}
					</span>
				)}
			</div>
			{milestones.length === 0 ? (
				<p className="text-body-sm text-ink-muted">
					No milestones yet. Add one below to mark the dates this project is
					planned around.
				</p>
			) : (
				/*
				 * Borderless group, main's card restyle (#608): surface ground, stepped
				 * radius, no border.
				 */
				<ul className="flex flex-col divide-y divide-hairline rounded-md bg-surface">
					{milestones.map((milestone) => {
						const meta = milestoneStatusMeta(milestone.status);
						const completed = milestone.completed_at !== null;
						return (
							<li
								key={milestone.name}
								className="flex items-center gap-3 rounded-sm px-2 py-2"
							>
								<Checkbox
									checked={completed}
									disabled={busy}
									onCheckedChange={(next) =>
										onToggle(milestone.name, next === true)
									}
									aria-label={
										completed
											? `Mark ${milestone.name} not complete`
											: `Mark ${milestone.name} complete`
									}
								/>
								<span className="min-w-0 flex-1 truncate text-body-sm text-ink">
									{milestone.name}
								</span>
								{milestone.target_date && (
									<span className="shrink-0 text-meta text-ink-muted">
										{formatProjectDay(
											milestone.target_date,
											typeof navigator === "undefined"
												? undefined
												: navigator.language,
										)}
									</span>
								)}
								<Badge variant={meta.variant}>{meta.label}</Badge>
								<Button
									variant="ghost"
									size="icon-sm"
									disabled={busy}
									aria-label={`Remove ${milestone.name}`}
									onClick={() => onRemove(milestone.name)}
								>
									<X />
								</Button>
							</li>
						);
					})}
				</ul>
			)}

			{/* The add row: name + an optional target date, both typed. */}
			<div className="flex items-end gap-3">
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<Label htmlFor="project-milestone-name">New milestone</Label>
					<Input
						id="project-milestone-name"
						value={draftName}
						onChange={(event) => setDraftName(event.target.value)}
						placeholder="beta cut"
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								submitAdd();
							}
						}}
					/>
				</div>
				<div className="flex w-40 flex-col gap-1.5">
					<Label htmlFor="project-milestone-date">Target date</Label>
					<Input
						id="project-milestone-date"
						value={draftDate}
						onChange={(event) => setDraftDate(event.target.value)}
						placeholder="YYYY-MM-DD"
						aria-invalid={dateInvalid}
					/>
					{dateInvalid && (
						<p className="text-meta text-danger">
							Dates are YYYY-MM-DD, or empty.
						</p>
					)}
				</div>
				<Button
					variant="secondary"
					disabled={!canAdd}
					onClick={submitAdd}
					data-tour-tag="project-milestone-add"
				>
					<Plus />
					Add
				</Button>
			</div>
		</section>
	);
};
