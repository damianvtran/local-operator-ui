/**
 * The Projects tab's filter model: which rows a facet selection admits, how the
 * popover's options and their counts are derived, and the copy for both.
 *
 * PURE, over the wire DTOs and nothing else — the same argument
 * `project-model.ts` states for itself: a rule written as a function over the
 * listing is executed by `scripts/projects-filters.test.mjs` in Node, so the
 * copy a reader sees and the boundary a count draws are pinned by a test rather
 * than by a reviewer's eye on a frame.
 *
 * COMBO SEMANTICS, stated once for the whole surface: OR within a facet, AND
 * across facets. The search query is ANDed on top by the caller — the caller
 * runs the search join and hands this module the SURVIVORS as its `rows`. It
 * deliberately does not live in `FilterState`, because "what the facets select"
 * and "what the query matched" are two derivations a page composes.
 *
 * THE QUERY IS NO LONGER RE-DERIVED HERE, and that is the point of the shape.
 * The count population below still accounts for the query — a count must answer
 * "how many rows would I see if I picked this?", not a question about a listing
 * the reader cannot see — but it takes the query's ADMITTED ROWS as its input
 * instead of re-running a matcher over them. Two engines can serve that
 * admission (the backend's index and `project-search.ts`), and a module that
 * re-derived membership with one of them would let the popover's counts and the
 * list beside it disagree about which rows exist.
 */

import type { DesktopProject } from "../../../../shared/desktop-control-contract";
import {
	DAY_MS,
	PROJECT_STATUS_ORDER,
	parseIsoDay,
	projectOverdue,
	projectStatusMeta,
	projectTeamName,
} from "./project-model";

/**
 * The facet keys, in the order the popover renders them (the design's own
 * table). The array is the single source of that order: the popover iterates
 * it, and the tests assert against it, so a facet cannot be added in one place
 * and forgotten in the other.
 */
export const FACET_ORDER = [
	"status",
	"team",
	"owner",
	"tags",
	"progress",
	"target",
	"estimate",
	"milestones",
	"live",
] as const;

export type FilterFacetKey = (typeof FACET_ORDER)[number];

/** The Progress facet's three states, exactly the predicates the brief fixes. */
export type ProgressFilterValue = "stale" | "up-to-date" | "not-reported";
/** Target windows. `within-30` INCLUDES `within-7` — "within 30 days" is true of a job due in 3. */
export type TargetFilterValue = "none" | "overdue" | "within-7" | "within-30";
export type EstimateFilterValue = "none" | "points" | "days";
export type MilestonesFilterValue = "none" | "incomplete" | "complete";
export type LiveFilterValue = "has-live" | "no-live";

/**
 * One selected option's value. Strings carry their own meaning; `null` is the
 * "No team"/"No owner" BUCKET, a real selectable value that no string can
 * collide with (the alternative — a sentinel string like `"__none__"` — is a
 * value a user's team could legitimately be named).
 */
export type FilterOptionValue = string | null;

/** Which value type each facet selects; the popover and the toggles are typed through it. */
export type FilterValueByFacet = {
	status: string;
	team: FilterOptionValue;
	owner: FilterOptionValue;
	tags: string;
	progress: ProgressFilterValue;
	target: TargetFilterValue;
	estimate: EstimateFilterValue;
	milestones: MilestonesFilterValue;
	live: LiveFilterValue;
};

export type FilterState = {
	status: string[];
	team: FilterOptionValue[];
	owner: FilterOptionValue[];
	tags: string[];
	progress: ProgressFilterValue[];
	target: TargetFilterValue[];
	estimate: EstimateFilterValue[];
	milestones: MilestonesFilterValue[];
	live: LiveFilterValue[];
};

/** No facet selected. The page reads this shape for "the list as it arrives". */
export const NO_FILTERS: FilterState = {
	status: [],
	team: [],
	owner: [],
	tags: [],
	progress: [],
	target: [],
	estimate: [],
	milestones: [],
	live: [],
};

/** The facet headings, in sentence case — the popover's labels and the chips' prefix. */
export const FACET_LABELS: Record<FilterFacetKey, string> = {
	status: "Status",
	team: "Team",
	owner: "Owner",
	tags: "Tags",
	progress: "Progress",
	target: "Target date",
	estimate: "Estimate",
	milestones: "Milestones",
	live: "Live sessions",
};

/**
 * WHICH FACETS ENUMERATE A FIXED VOCABULARY, set once for both surfaces (D5,
 * adjudicated): Status, Progress, Target, Estimate, Milestones and Live ALWAYS
 * render their FULL option set — counts included, zeros included — because the
 * vocabulary is the model's, and a reader must be able to discover an option
 * the current data happens to have none of ("Overdue" is a thing one can ask
 * for even in a week where nothing is). The present-derived facets (Team,
 * Owner, Tags) stay present-only: their options ARE the data, and an option
 * with nothing behind it is noise rather than vocabulary. The design note is
 * amended to this rule; `facetOptions` is the one place it is applied.
 */
export const FIXED_VOCABULARY_FACETS: ReadonlySet<FilterFacetKey> = new Set([
	"status",
	"progress",
	"target",
	"estimate",
	"milestones",
	"live",
]);

/**
 * The token facets' option order. These are FIXED vocabularies, so the option
 * list is the vocabulary itself in the canonical order (D5), never derived
 * from the data's own order — a popover whose Progress section reorders
 * itself as rows change is unreadable.
 */
const TOKEN_OPTION_ORDER: {
	progress: ProgressFilterValue[];
	target: TargetFilterValue[];
	estimate: EstimateFilterValue[];
	milestones: MilestonesFilterValue[];
	live: LiveFilterValue[];
} = {
	progress: ["stale", "up-to-date", "not-reported"],
	target: ["none", "overdue", "within-7", "within-30"],
	estimate: ["none", "points", "days"],
	milestones: ["none", "incomplete", "complete"],
	live: ["has-live", "no-live"],
};

/** Every token option's copy, in the design's exact words. */
const TOKEN_LABELS: Record<string, string> = {
	stale: "Stale",
	"up-to-date": "Up to date",
	"not-reported": "Not reported",
	none: "No target date",
	overdue: "Overdue",
	"within-7": "Due within 7 days",
	"within-30": "Due within 30 days",
	points: "Points",
	days: "Days",
	incomplete: "Incomplete",
	complete: "Complete",
	"has-live": "Has live sessions",
	"no-live": "No live sessions",
};

/**
 * "No estimate" and "None set" share the token `none` with "No target date" in
 * the popover's internal vocabulary, so the label lookup is per FACET rather
 * than one merged map — one map would print "No target date" on the Estimate
 * facet and read as a bug.
 */
export function filterOptionLabel(
	facet: FilterFacetKey,
	value: FilterOptionValue,
): string {
	switch (facet) {
		case "status":
			// The model's own label rule (unknown values keep their raw word).
			return projectStatusMeta(value as string).label;
		case "team":
			return value === null ? "No team" : value;
		case "owner":
			return value === null ? "No owner" : value;
		case "tags":
			return value ?? "";
		case "estimate":
			if (value === "none") return "No estimate";
			break;
		case "milestones":
			if (value === "none") return "None set";
			break;
		case "target":
			if (value === "none") return "No target date";
			break;
		default:
			break;
	}
	return TOKEN_LABELS[value as string] ?? value ?? "";
}

/** Whether this facet has at least one selection. */
export function isFilterFacetActive(
	state: FilterState,
	facet: FilterFacetKey,
): boolean {
	return state[facet].length > 0;
}

/** Whether any facet carries a selection. */
export function isFilterEmpty(state: FilterState): boolean {
	return FACET_ORDER.every((facet) => !isFilterFacetActive(state, facet));
}

/**
 * How many OPTIONS are selected across every facet; the Filters badge shows
 * it (U9: counting FACETS read "1" with two options on — `Status · Active +1`
 * beside a badge of 1 says nothing about which one narrows).
 */
export function activeSelectionCount(state: FilterState): number {
	return FACET_ORDER.reduce((total, facet) => total + state[facet].length, 0);
}

/** The state with one facet's selection emptied. Others are untouched. */
export function clearFilterFacet(
	state: FilterState,
	facet: FilterFacetKey,
): FilterState {
	return { ...state, [facet]: [] };
}

/**
 * Toggle one option of one facet, immutably. `value`'s type follows the facet,
 * so a caller cannot push a Progress token into the Status facet.
 */
export function toggleFilterValue<F extends FilterFacetKey>(
	state: FilterState,
	facet: F,
	value: FilterValueByFacet[F],
): FilterState {
	const current = state[facet] as FilterValueByFacet[F][];
	const next = current.includes(value)
		? current.filter((entry) => entry !== value)
		: [...current, value];
	return { ...state, [facet]: next } as FilterState;
}

/**
 * Whether one row matches one facet VALUE — the OR arm of the combo rule.
 *
 * The TEAM predicate runs through `projectTeamName`, the same derivation the
 * List's sections, the Board's columns and the Timeline's bands group by: a
 * "Team · platform" filter that disagreed with the section named platform would
 * hide rows the section shows, which reads as a missing project rather than as
 * a filter working. OWNER is the raw field (trimmed), its own facet.
 */
export function matchesFacetValue(
	facet: FilterFacetKey,
	project: DesktopProject,
	value: FilterOptionValue,
	todayMs: number,
): boolean {
	switch (facet) {
		case "status":
			return project.status === value;
		case "team":
			return projectTeamName(project) === value;
		case "owner":
			return (project.owner?.trim() || null) === value;
		case "tags":
			return project.tags.includes(value ?? "");
		case "progress":
			/*
			 * The three predicates the brief fixes, taken literally: a record
			 * with no report is `progress_updated_at === null`, and the stale
			 * flag stays the server's own computation (this module never
			 * re-derives it from a threshold — the contract forbids that
			 * everywhere, and a second threshold here would be a second
			 * opinion).
			 */
			if (value === "stale") return project.progress_stale === true;
			if (value === "up-to-date") return project.progress_stale === false;
			return project.progress_updated_at === null;
		case "target": {
			if (value === "none") return parseIsoDay(project.target_date) === null;
			if (value === "overdue") return projectOverdue(project, todayMs);
			const target = parseIsoDay(project.target_date);
			if (target === null) return false;
			const days = (target - todayMs) / DAY_MS;
			// Nested on purpose: "due within 30 days" is true of a job due in 3.
			if (value === "within-7") return days >= 0 && days <= 7;
			return days >= 0 && days <= 30;
		}
		case "estimate":
			if (value === "none") return project.estimate === null;
			if (project.estimate === null) return false;
			if (value === "points") return project.estimate_unit === "points";
			return project.estimate_unit === "days";
		case "milestones":
			if (value === "none") return project.milestones_total === 0;
			if (project.milestones_total === 0) return false;
			if (value === "complete")
				return project.milestones_completed >= project.milestones_total;
			return project.milestones_completed < project.milestones_total;
		case "live":
			return value === "has-live"
				? project.live_sessions > 0
				: project.live_sessions === 0;
	}
}

/** Whether one row survives one facet's selection (OR within the facet). */
function matchesFacet(
	state: FilterState,
	facet: FilterFacetKey,
	project: DesktopProject,
	todayMs: number,
): boolean {
	const values = state[facet] as FilterOptionValue[];
	if (values.length === 0) return true;
	return values.some((value) =>
		matchesFacetValue(facet, project, value, todayMs),
	);
}

/**
 * The rows a filter state admits: AND across facets, OR within each.
 *
 * Identity when nothing is selected: the SAME array comes back, so a page's
 * memo can key on the reference and "no filters" costs one predicate pass
 * rather than a copy of every row.
 */
export function applyFilters(
	rows: DesktopProject[],
	state: FilterState,
	todayMs: number,
): DesktopProject[] {
	if (isFilterEmpty(state)) return rows;
	return rows.filter((project) =>
		FACET_ORDER.every((facet) => matchesFacet(state, facet, project, todayMs)),
	);
}

/** One selectable option in the popover, with the count a click would yield. */
export type ProjectFacetOption = {
	value: FilterOptionValue;
	label: string;
	count: number;
	selected: boolean;
};

/** One facet section of the popover. */
export type ProjectFacetSection = {
	facet: FilterFacetKey;
	label: string;
	options: ProjectFacetOption[];
};

/**
 * The rows a facet option's count is taken over: everything the reader could
 * still see if they picked it — every OTHER facet applied, over the rows the
 * search admitted.
 *
 * A facet's own selection is excluded because its options are alternatives and
 * a count that includes them shows 0 on every option not yet picked. The
 * QUERY is accounted for by construction rather than by a second matcher here:
 * `rows` IS the query's admitted set (whichever engine admitted it), so a count
 * that ignores the query is not expressible — which is the shape that keeps the
 * popover and the list beside it from disagreeing about which rows exist.
 */
function facetPopulation(
	facet: FilterFacetKey,
	rows: DesktopProject[],
	state: FilterState,
	todayMs: number,
): DesktopProject[] {
	return rows.filter((project) =>
		FACET_ORDER.every(
			(other) =>
				other === facet || matchesFacet(state, other, project, todayMs),
		),
	);
}

/**
 * The candidate options for a facet, before the count filter: the values
 * PRESENT in the population, in the facet's canonical order, plus anything
 * already selected.
 *
 * Selected values are unioned in for a stated reason: a selected option must
 * stay visible even when the other facets have narrowed the population to zero
 * of its rows — otherwise the only way to unselect it is to clear everything.
 */
function candidateValues(
	facet: FilterFacetKey,
	population: DesktopProject[],
	state: FilterState,
): FilterOptionValue[] {
	const selected = state[facet] as FilterOptionValue[];
	switch (facet) {
		case "status": {
			/*
			 * The FULL model vocabulary always (D5), then any status a newer
			 * backend wrote that this build has never heard of, then any selected
			 * value the population no longer carries. Known statuses keep the
			 * model's order; unknown words sort after them (the vocabulary's tail
			 * is open).
			 */
			const present = new Set(population.map((project) => project.status));
			const unknown = [...present]
				.filter((status) => !PROJECT_STATUS_ORDER.includes(status))
				.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
			const extra = selected.filter(
				(status): status is string =>
					typeof status === "string" &&
					!PROJECT_STATUS_ORDER.includes(status) &&
					!unknown.includes(status),
			);
			return [...PROJECT_STATUS_ORDER, ...unknown, ...extra];
		}
		case "team": {
			const named = new Set<string>();
			let bucket = false;
			for (const project of population) {
				const team = projectTeamName(project);
				if (team === null) bucket = true;
				else named.add(team);
			}
			for (const value of selected) {
				if (value === null) bucket = true;
				else named.add(value);
			}
			const sorted = [...named].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base" }),
			);
			return bucket ? [...sorted, null] : sorted;
		}
		case "owner": {
			const named = new Set<string>();
			let bucket = false;
			for (const project of population) {
				const owner = project.owner?.trim();
				if (owner) named.add(owner);
				else bucket = true;
			}
			for (const value of selected) {
				if (value === null) bucket = true;
				else named.add(value);
			}
			const sorted = [...named].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base" }),
			);
			return bucket ? [...sorted, null] : sorted;
		}
		case "tags": {
			const present = new Set<string>();
			for (const project of population) {
				for (const tag of project.tags) present.add(tag);
			}
			for (const value of selected) present.add(value ?? "");
			return [...present].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base" }),
			);
		}
		case "progress":
		case "target":
		case "estimate":
		case "milestones":
		case "live":
			// The fixed vocabularies: enumerate everything; the count pass below
			// keeps every one of them (D5), zero counts included.
			return TOKEN_OPTION_ORDER[facet] as FilterOptionValue[];
	}
}

/**
 * One facet's section: its options in canonical order, each with the count it
 * would admit and whether it is currently selected.
 *
 * THE ZERO-COUNT RULE (D5, adjudicated, and the one place it lives): a
 * FIXED-VOCABULARY facet renders every option its model knows, zero counts
 * included — the vocabulary must not depend on the current data. A
 * PRESENT-DERIVED facet drops what nothing matches, unless it is selected: a
 * selected value stays visible (and removable) even when the population no
 * longer contains it (see `candidateValues`).
 */
export function facetOptions(
	facet: FilterFacetKey,
	rows: DesktopProject[],
	state: FilterState,
	todayMs: number,
): ProjectFacetSection {
	const population = facetPopulation(facet, rows, state, todayMs);
	const fixedVocabulary = FIXED_VOCABULARY_FACETS.has(facet);
	const options: ProjectFacetOption[] = [];
	for (const value of candidateValues(facet, population, state)) {
		const selected = (state[facet] as FilterOptionValue[]).includes(value);
		const count = population.reduce(
			(total, project) =>
				total + (matchesFacetValue(facet, project, value, todayMs) ? 1 : 0),
			0,
		);
		if (!fixedVocabulary && count === 0 && !selected) continue;
		options.push({
			value,
			label: filterOptionLabel(facet, value),
			count,
			selected,
		});
	}
	return { facet, label: FACET_LABELS[facet], options };
}

/**
 * Every facet's section, in popover order — the toolbar's complete popover.
 * The column menus call `facetOptions` directly for the one facet they scope.
 */
export function facetSections(
	rows: DesktopProject[],
	state: FilterState,
	todayMs: number,
): ProjectFacetSection[] {
	return FACET_ORDER.map((facet) => facetOptions(facet, rows, state, todayMs));
}
