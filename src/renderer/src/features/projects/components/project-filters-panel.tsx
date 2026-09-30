/**
 * The Filters popover's body, shared by its two entry points (U2/§2.4): the
 * toolbar's Filters button opens it complete, and a column header opens it
 * pre-scoped to that column's facet with the column's sort actions above it.
 *
 * ONE PANEL, TWO ENTRY POINTS is the design's own structure, and it is why
 * this component takes `scope` and `sort` rather than the page building two
 * panel variants: the facet rows are literally the same rows, so the toolbar
 * and a column can never disagree about what "Status · Active" means or how
 * many rows it would admit.
 *
 * THE OPTIONS AND THEIR COUNTS ARE DERIVED, NOT STORED: `facetOptions` runs
 * against the live listing filtered by every OTHER facet (and the query), so a
 * count always answers "how many rows would I see if I picked this?" —
 * including the count on the option the reader is about to pick. The
 * derivation happens only while the panel is OPEN (Radix mounts the content
 * lazily), which is what keeps typing in the search field from paying for
 * nine facets on every keystroke.
 */

import { Button, Checkbox, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { useId, useMemo } from "react";
import type { DesktopProject } from "../../../../../shared/desktop-control-contract";
import {
	FACET_LABELS,
	type FilterFacetKey,
	type FilterOptionValue,
	type FilterState,
	facetOptions,
	facetSections,
	isFilterEmpty,
} from "../project-filters";
import {
	DEFAULT_SORT_LABEL,
	type SortKey,
	type SortSpec,
	firstSortDirection,
	sortColumnLabel,
	sortDirectionWords,
} from "../project-sort";

export type ProjectFiltersPanelProps = {
	/** The whole listing: the population every count is derived from. */
	projects: DesktopProject[];
	state: FilterState;
	query: string;
	todayMs: number;
	/** One option toggled; the caller owns the state so both entry points share it. */
	onToggle: (facet: FilterFacetKey, value: FilterOptionValue) => void;
	/** The header's Clear all (query and every facet; the sort is not a facet). */
	onClearAll: () => void;
	/**
	 * The scoped entry points: `undefined` renders the COMPLETE popover (the
	 * toolbar's), a facet renders that column's view, and `null` is the name
	 * column, which has no facet of its own (the search field is its filter)
	 * and therefore renders sort actions only.
	 */
	scope?: FilterFacetKey | null;
	/** When set, the column's sort actions render above the options. */
	sort?: {
		key: SortKey;
		spec: SortSpec | null;
		onChange: (spec: SortSpec | null) => void;
	};
};

/** One checkbox row: the control, its label and the count it would admit. */
const FacetOptionRow: FC<{
	label: string;
	count: number;
	selected: boolean;
	onToggle: () => void;
}> = ({ label, count, selected, onToggle }) => {
	/* Local to the row: two panels (the toolbar's and a column's) can each
	 * render the SAME facet, and a document-wide id collision would break the
	 * label-to-control pairing on one of them. */
	const id = useId();
	return (
		<div className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-sunken">
			<Checkbox id={id} checked={selected} onCheckedChange={() => onToggle()} />
			<Label
				htmlFor={id}
				className="min-w-0 flex-1 cursor-pointer truncate font-normal text-body-sm text-ink"
			>
				{label}
			</Label>
			<span className="text-meta text-ink-dim tabular-nums">{count}</span>
		</div>
	);
};

/**
 * The column's sort actions, as a radio group.
 *
 * TWO RADIOS, AND WHY THE SECOND ONE FLIPS: the design's sort rules say "one
 * column at a time; direction toggles" and the ux round's folded NIT fixes the
 * direction a column takes on first activation ("asc except Progress/dates =
 * desc"). A three-item group (asc / desc / default) would never need a
 * first-activation direction at all — the reader picks one — so the model the
 * specs describe is the one built here: `Default (as listed)` plus the
 * column's own sort item, whose label names the direction a press applies and
 * which is the v1 way to reach the opposite direction. Reproduced on the
 * shipped component: the group's `onChange` handles the unchecked→checked
 * press, and the checked item's own press flips it (a radio that is already
 * checked fires no change event).
 */
const ColumnSortGroup: FC<{
	column: SortKey;
	spec: SortSpec | null;
	onChange: (spec: SortSpec | null) => void;
}> = ({ column, spec, onChange }) => {
	const name = useId();
	const sorted = spec !== null && spec.key === column;
	const currentDirection = sorted ? spec.direction : firstSortDirection(column);
	const flipDirection = currentDirection === "asc" ? "desc" : "asc";
	const apply = () =>
		onChange({
			key: column,
			direction: sorted ? flipDirection : firstSortDirection(column),
		});
	const radioValue = spec === null ? "default" : sorted ? "sorted" : "other";
	return (
		<fieldset className="m-0 flex flex-col gap-0.5 border-0 p-0">
			<legend className="sr-only">{`Sort by ${sortColumnLabel(column)}`}</legend>
			<label className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-body-sm hover:bg-sunken">
				<input
					type="radio"
					name={name}
					checked={radioValue === "default"}
					onChange={() => onChange(null)}
					className="m-0 size-3.5 shrink-0 accent-[var(--color-accent)]"
				/>
				<span
					className={cn(
						"min-w-0 flex-1 truncate",
						radioValue === "default" ? "text-ink" : "text-ink-muted",
					)}
				>
					{DEFAULT_SORT_LABEL}
				</span>
			</label>
			<label className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-body-sm hover:bg-sunken">
				<input
					type="radio"
					name={name}
					checked={radioValue === "sorted"}
					onChange={apply}
					/* The checked item's own press flips the direction; the first
					 * press (unchecked) reaches `onChange` instead, so the two paths
					 * cannot both fire for one press — measured on the shipped
					 * component, not assumed. */
					onClick={() => {
						if (radioValue === "sorted") apply();
					}}
					className="m-0 size-3.5 shrink-0 accent-[var(--color-accent)]"
				/>
				<span
					className={cn(
						"min-w-0 flex-1 truncate",
						radioValue === "sorted" ? "text-ink" : "text-ink-muted",
					)}
				>{`Sort by ${sortColumnLabel(column)}, ${sortDirectionWords(column, sorted ? currentDirection : firstSortDirection(column))}`}</span>
			</label>
		</fieldset>
	);
};

/** One facet's section: its name and its option rows. */
const FacetSection: FC<{
	facet: FilterFacetKey;
	options: {
		value: FilterOptionValue;
		label: string;
		count: number;
		selected: boolean;
	}[];
	onToggle: (facet: FilterFacetKey, value: FilterOptionValue) => void;
}> = ({ facet, options, onToggle }) => (
	<div className="flex flex-col gap-0.5 border-b border-hairline px-3 py-2 last:border-b-0">
		<span className="px-1 text-meta text-ink-muted">{FACET_LABELS[facet]}</span>
		{options.map((option) => (
			<FacetOptionRow
				key={`${facet}:${option.value ?? "none"}`}
				label={option.label}
				count={option.count}
				selected={option.selected}
				onToggle={() => onToggle(facet, option.value)}
			/>
		))}
	</div>
);

export const ProjectFiltersPanel: FC<ProjectFiltersPanelProps> = ({
	projects,
	state,
	query,
	todayMs,
	onToggle,
	onClearAll,
	scope,
	sort,
}) => {
	/*
	 * Nine sections over an 800-row listing are recomputed only while this
	 * panel is mounted (i.e. while it is open) and only when its own inputs
	 * change — the memo keys are the exact inputs `facetOptions` reads.
	 */
	const sections = useMemo(
		() =>
			scope === undefined
				? facetSections(projects, state, todayMs, query)
				: scope === null
					? []
					: [facetOptions(scope, projects, state, todayMs, query)],
		[scope, projects, state, todayMs, query],
	);
	const anythingActive = !isFilterEmpty(state) || query.trim() !== "";
	return (
		<div className="flex flex-col">
			{scope === undefined && (
				<div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2">
					<span className="text-body-sm text-ink-muted">Filters</span>
					{anythingActive && (
						<Button variant="link" size="sm" onClick={onClearAll}>
							Clear all
						</Button>
					)}
				</div>
			)}
			{sort && (
				<div className="flex flex-col gap-0.5 border-b border-hairline px-3 py-2">
					<span className="px-1 text-meta text-ink-muted">
						{`Sort by ${sortColumnLabel(sort.key)}`}
					</span>
					<ColumnSortGroup
						column={sort.key}
						spec={sort.spec}
						onChange={sort.onChange}
					/>
				</div>
			)}
			{sections.map((section) => (
				<FacetSection
					key={section.facet}
					facet={section.facet}
					options={section.options}
					onToggle={onToggle}
				/>
			))}
		</div>
	);
};
