/**
 * The detail page's properties block: the planning dates, the estimate, the
 * tags, the attributions and when the record last moved — each editable fact
 * on its own labelled row.
 *
 * A SPEC SHEET, not a paragraph: the values are scanned rather than read, and
 * the rows are the same `dl` the read-only block drew. What changed with the
 * inline-edit slice: every editable fact's value is now a per-field editor
 * (`project-editors.tsx`), Owner and Team MOVED here from the header's
 * "Managed by" line (the operator's brief for this slice — a spec-sheet row
 * each, individually editable, and the header line retired), and a "+ Add"
 * menu by the section title can birth any absent row — the absence rule
 * ("absent facts are OMITTED, because `null` means unknown") is kept, with a
 * door for the reader who wants the fact recorded.
 *
 * THE ONE-AT-A-TIME RULE: `adding` names the single row currently being born.
 * Choosing another field from the menu while one is open switches the target;
 * the first row, still empty, retires with it. That is a deliberate
 * simplification over stacking several half-created rows — an empty row is a
 * prompt to fill it, and two prompts would race for the same attention.
 */

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Plus } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useRef, useState } from "react";
import type { DesktopProjectView } from "../../../../../shared/desktop-control-contract";
import {
	formatProjectDay,
	progressAge,
	progressAgePhrase,
} from "../project-model";
import {
	type CommitProjectFields,
	ProjectDateField,
	ProjectEstimateField,
	ProjectOwnerField,
	ProjectTagsField,
	ProjectTeamField,
} from "./project-editors";

export type ProjectPropertiesProps = {
	project: DesktopProjectView;
	nowMs: number;
	commit: CommitProjectFields;
	/**
	 * The team slug's human label, resolved by the page through the team
	 * catalogue (`useTeamLabelFor`, the team-labels lane): the row DISPLAYS
	 * this while editing still edits the slug. `null` when the record has no
	 * team; the row falls back to the slug when the catalogue cannot resolve
	 * one (the hook's own contract).
	 */
	teamLabel?: string | null;
};

/** The rows the + Add menu can birth, in the order the menu lists them. */
const ADDABLE_FIELDS = [
	{ field: "owner", label: "Owner" },
	{ field: "team", label: "Team" },
	{ field: "start", label: "Start date" },
	{ field: "target", label: "Target date" },
	{ field: "estimate", label: "Estimate" },
	{ field: "tags", label: "Tags" },
] as const;

type AddableField = (typeof ADDABLE_FIELDS)[number]["field"];

/** One read-only fact, drawn in the same row plan as the editable ones. */
const ReadRow: FC<{ label: string; children: ReactNode }> = ({
	label,
	children,
}) => (
	<div className="flex items-start gap-3">
		<dt className="w-24 shrink-0 pt-0.5 text-body-sm text-ink-muted">
			{label}
		</dt>
		<dd className="min-w-0 flex-1 text-body-sm text-ink">{children}</dd>
	</div>
);

export const ProjectProperties: FC<ProjectPropertiesProps> = ({
	project,
	nowMs,
	commit,
	teamLabel = null,
}) => {
	/* The reader's locale for the metadata grid: device before a backend
	 * answers, the backend's resolved language after (the i18n store). */
	const locale = useI18nLocale();
	const now = new Date(nowMs);
	const [adding, setAdding] = useState<AddableField | null>(null);
	/**
	 * The `Add` trigger, and the reason it needs a ref (review round 1, m2): a
	 * born row cancelled with Esc/x unmounts entirely - there is no pencil to
	 * hand focus to - so the focus returns to the door that opened it. A row
	 * that got its value keeps the pencil's own refocus and this stays quiet.
	 */
	const addButtonRef = useRef<HTMLButtonElement | null>(null);
	/**
	 * Whether the menu's close is the START of an add (M4). Radix's
	 * `DropdownMenuContent` focuses its trigger back on close, which blurs the
	 * just-focused input of the born row and cancels it before it can be
	 * typed into; the repo's own precedent skips that return the same way
	 * (`chat-header-identity-menu.tsx`).
	 */
	const addStartedRef = useRef(false);

	/**
	 * What the record already holds, read once: the menu's offers, the rows'
	 * visibility and the retire-focus rule all derive from these.
	 */
	const has = {
		owner: project.owner !== null,
		team: project.team !== null,
		start: project.start_date !== null,
		target: project.target_date !== null,
		estimate: project.estimate !== null,
		tags: project.tags.length > 0,
	} as const;

	/** Retire a born row; a no-op if the target already moved on. */
	const retire = (field: AddableField, outcome: "cancelled" | "filled") => {
		setAdding((current) => (current === field ? null : current));
		if (outcome === "cancelled" && !has[field])
			setTimeout(() => addButtonRef.current?.focus(), 0);
	};

	/*
	 * The menu offers what is missing AND not already being born: a field the
	 * user just opened is no longer "missing" to the reader who opened it, and
	 * a second copy of it would be the duplicate the one-at-a-time rule
	 * exists to prevent.
	 */
	const missing = ADDABLE_FIELDS.filter(
		({ field }) => !has[field] && adding !== field,
	);

	const completed = formatProjectDay(project.completed_at, locale, now);
	const updatedAge =
		project.updated_at > 0
			? progressAgePhrase(progressAge(project.updated_at, nowMs))
			: "";
	const absoluteUpdated =
		project.updated_at > 0
			? new Date(project.updated_at * 1000).toLocaleString(locale)
			: "";

	/* One predicate for the `dl`, derived from the same reads the rows use. */
	const showOwner = has.owner || adding === "owner";
	const showTeam = has.team || adding === "team";
	const showStart = has.start || adding === "start";
	const showTarget = has.target || adding === "target";
	const showEstimate = has.estimate || adding === "estimate";
	const showTags = has.tags || adding === "tags";
	const anyRow =
		showOwner ||
		showTeam ||
		showStart ||
		showTarget ||
		Boolean(completed) ||
		showEstimate ||
		showTags ||
		project.updated_at > 0;

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-title text-ink">Properties</h2>
				{missing.length > 0 && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								ref={addButtonRef}
								type="button"
								data-project-add-field=""
								className={cn(
									"flex shrink-0 cursor-pointer items-center gap-1 rounded-xs text-meta text-ink-dim",
									"transition-colors duration-fast ease-out-quart hover:text-ink",
								)}
							>
								<Plus className="size-3" aria-hidden="true" />
								Add
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							onCloseAutoFocus={(event) => {
								if (!addStartedRef.current) return;
								addStartedRef.current = false;
								event.preventDefault();
							}}
						>
							{missing.map(({ field, label }) => (
								<DropdownMenuItem
									key={field}
									data-project-add-option={field}
									onSelect={() => {
										addStartedRef.current = true;
										setAdding(field);
									}}
								>
									{label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
			{anyRow ? (
				<dl className="flex flex-col gap-2">
					{showOwner && (
						<ProjectOwnerField
							project={project}
							commit={commit}
							autoBegin={adding === "owner"}
							onRetire={(outcome) => retire("owner", outcome)}
						/>
					)}
					{showTeam && (
						<ProjectTeamField
							project={project}
							commit={commit}
							label={teamLabel}
							autoBegin={adding === "team"}
							onRetire={(outcome) => retire("team", outcome)}
						/>
					)}
					{showStart && (
						<ProjectDateField
							project={project}
							commit={commit}
							which="start"
							nowMs={nowMs}
							autoBegin={adding === "start"}
							onRetire={(outcome) => retire("start", outcome)}
						/>
					)}
					{showTarget && (
						<ProjectDateField
							project={project}
							commit={commit}
							which="target"
							nowMs={nowMs}
							autoBegin={adding === "target"}
							onRetire={(outcome) => retire("target", outcome)}
						/>
					)}
					{completed && <ReadRow label="Completed">{completed}</ReadRow>}
					{showEstimate && (
						<ProjectEstimateField
							project={project}
							commit={commit}
							autoBegin={adding === "estimate"}
							onRetire={(outcome) => retire("estimate", outcome)}
						/>
					)}
					{showTags && (
						<ProjectTagsField
							project={project}
							commit={commit}
							autoBegin={adding === "tags"}
							onRetire={(outcome) => retire("tags", outcome)}
						/>
					)}
					{project.updated_at > 0 && (
						<ReadRow label="Updated">
							{/* Two readings of one fact, the read block's own split:
							 * the phrase is scanned, the instant is the title. */}
							<time
								dateTime={new Date(project.updated_at * 1000).toISOString()}
								title={absoluteUpdated}
							>
								{updatedAge}
							</time>
						</ReadRow>
					)}
				</dl>
			) : (
				<p className="text-body-sm text-ink-muted">
					No dates, estimate, tags, owner or team yet.
				</p>
			)}
		</section>
	);
};
