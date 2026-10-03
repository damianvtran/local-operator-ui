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
 * against the QUERY-ADMITTED rows, filtered by every OTHER facet, so a count
 * always answers "how many rows would I see if I picked this?" — including the
 * count on the option the reader is about to pick. The derivation happens only
 * while the panel is OPEN (Radix mounts the content lazily), which is what keeps
 * typing in the search field from paying for nine facets on every keystroke.
 *
 * THE POPULATION ARRIVES ALREADY NARROWED BY THE QUERY. `projects` is the row
 * set the search admitted — the backend index's answer when it served, the
 * client matcher's otherwise — and this panel never re-derives that membership,
 * so a count cannot be computed over one engine's rows while the list beside it
 * draws another's. `query` is still passed, and is used for exactly one thing:
 * the header's "is a search on" predicate. It is deliberately not fed back into
 * the counts (it would run a second, disagreeing matcher over rows the engine
 * already admitted).
 */

import { Button, Checkbox, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
	/**
	 * The population every count is derived from: the rows the CURRENT query
	 * admits (the page hands the search's own row set), never the whole listing
	 * when a query is on. See the header for why the query is not re-applied.
	 */
	projects: DesktopProject[];
	state: FilterState;
	/** The box's value. Drives the header's "is a search on" predicate only. */
	query: string;
	todayMs: number;
	/** One option toggled; the caller owns the state so both entry points share it. */
	onToggle: (facet: FilterFacetKey, value: FilterOptionValue) => void;
	/** The header's Clear all: the query, every facet and the sort (→ Default; D7). */
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

/**
 * The scrollable sheet both popover entry points put inside their
 * `PopoverContent`, with the app's own "there is more below" mark.
 *
 * WHY A FADE AND NOT A CAP TUNED TO THE ROW RHYTHM (design round 1, D3): the
 * cap cannot land in a padding band for every content — the option sets are
 * data-dependent — and a row cut through its checkbox reads as a rendering
 * defect rather than as "scroll for more". So the last visible row dissolves
 * instead: the same 20px bottom mask the `/` picker's panel body carries
 * (`picker-host.tsx`, whose comment states the rule — pinned on a row edge is
 * not available where heights vary), applied only while there IS more below,
 * so the LAST row at the scroll's end is never dimmed for nothing.
 *
 * THE FADE'S DEPTH IS A MEASURED CHOICE (design round 2, N2): the 20px mask
 * first shipped here washed the section heading at the edge to ~27% of an
 * unmasked label's ink and read as a disabled row rather than as "more
 * below". At 12px the cut row keeps its upper half at full ink while the
 * edge still dissolves — the affordance stays, the label stays legible.
 *
 * THE CAP IS STATED HERE, once, for both callers: `min(70vh, 32rem)`. It is
 * taller than the option-list family (`max-h-72`/`max-h-96`) on purpose —
 * nine facets over an 800px listing, and the cap exists to keep the panel
 * inside the viewport, not to make nine sections scroll by default. The mask
 * is measured on scroll (and on mount, and whenever the panel re-renders —
 * toggling a facet changes no row height, but a refetch can), because
 * `scrollHeight` is not a state CSS can read.
 */
export const FilterPopoverScroll: FC<{ children: ReactNode }> = ({
	children,
}) => {
	const ref = useRef<HTMLDivElement>(null);
	const [moreBelow, setMoreBelow] = useState(false);
	const measure = () => {
		const node = ref.current;
		if (!node) return;
		setMoreBelow(node.scrollTop + node.clientHeight < node.scrollHeight - 1);
	};
	/* Re-measured after every render of the panel: cheap (two reads) and the
	 * only thing that catches a content change (a refetch's option rows). */
	useEffect(measure);
	return (
		<div
			ref={ref}
			onScroll={measure}
			className={cn(
				"max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain",
				moreBelow &&
					"[mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent)]",
			)}
		>
			{children}
		</div>
	);
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
 * checked fires no change event) — on the mouse through `onClick` and on the
 * keys through the checked radio's `onKeyDown` (U11), because the two fire
 * nothing for each other.
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
					/* THE SAME FLIP ON THE KEY PATH (ux round 2, U11): Space and Enter
					 * on an ALREADY-CHECKED radio fire no click and no change event —
					 * calibrated in the round's rig against a bare radio — so the
					 * opposite direction was mouse-only until this handler stated the
					 * keys. Space on an UNCHECKED radio is left to the native change
					 * path; only the flip needs a key spelling. */
					onKeyDown={(event) => {
						if (radioValue !== "sorted") return;
						if (event.key !== " " && event.key !== "Enter") return;
						event.preventDefault();
						apply();
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
				? facetSections(projects, state, todayMs)
				: scope === null
					? []
					: [facetOptions(scope, projects, state, todayMs)],
		[scope, projects, state, todayMs],
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
