/**
 * The Projects tab's sort model: one key at a time, the direction toggling,
 * nulls ALWAYS last, and the words a screen reader hears about it.
 *
 * WHY SINGLE-KEY: the app's only sortable-table contract is single-key
 * (`data-table.tsx`'s `DataTableSort`), and the ux round's U2 adjudication
 * settled the design/architecture disagreement the same way — no shift-click
 * multi-key in v1. `SortSpec` therefore carries exactly one key and a
 * direction; a future multi-key is an explicit change to this type, not a
 * side-effect of some comparator growing a second argument.
 *
 * WHY NULLS LAST IN BOTH DIRECTIONS: "descending" means reversing the order of
 * rows that HAVE a value; a row with no estimate has not earned a position
 * ahead of every row with one just because the arrow flipped. The null rank is
 * compared OUTSIDE the direction negation for exactly that reason, and the
 * tests pin both directions.
 *
 * THE TOTAL-ORDER FALLBACK (`updated_at` desc, then name asc, then the raw
 * name and id) is what makes `sortProjects` identity-stable: the same input
 * produces the identical order on every call, and re-sorting an already-
 * sorted list cannot shuffle its equal rows.
 */

import type { DesktopProject } from "../../../../shared/desktop-control-contract";
import {
	PROJECT_STATUS_ORDER,
	parseIsoDay,
	projectDisplayName,
} from "./project-model";

export type SortKey =
	| "name"
	| "status"
	| "target"
	| "estimate"
	| "milestones"
	| "live"
	| "progress";

export type SortDirection = "asc" | "desc";

export type SortSpec = { key: SortKey; direction: SortDirection };

/** The storage key, in the app's layout-choice style (`projects-view`). */
export const PROJECTS_SORT_STORAGE_KEY = "projects-sort";

/** The "no explicit sort" radio item's exact copy (the ux round keeps it). */
export const DEFAULT_SORT_LABEL = "Default (as listed)";

/** Whether a stored/unknown string is a sort key this build knows. */
export function isSortKey(value: string): value is SortKey {
	return (SORT_KEYS as readonly string[]).includes(value);
}

const SORT_KEYS = [
	"name",
	"status",
	"target",
	"estimate",
	"milestones",
	"live",
	"progress",
] as const;

/**
 * The stored sort, or `null` for anything else — a missing key, a locked
 * store, a token another build wrote. The guarded-read idiom every layout
 * choice on this tab uses.
 */
export function readProjectsSort(): SortSpec | null {
	try {
		const stored = localStorage.getItem(PROJECTS_SORT_STORAGE_KEY);
		if (stored === null) return null;
		/* Exactly `key:direction`: a longer token was written by something
		 * else, and half-reading it would be a sort nobody chose. */
		const [key, direction, ...rest] = stored.split(":");
		if (rest.length > 0) return null;
		if (key && isSortKey(key) && (direction === "asc" || direction === "desc"))
			return { key, direction };
	} catch {
		/* storage unavailable: no sort is the honest answer */
	}
	return null;
}

/** Persist the sort; `null` clears it. A failed write must not fail the change. */
export function writeProjectsSort(spec: SortSpec | null): void {
	try {
		if (spec === null) localStorage.removeItem(PROJECTS_SORT_STORAGE_KEY);
		else
			localStorage.setItem(
				PROJECTS_SORT_STORAGE_KEY,
				`${spec.key}:${spec.direction}`,
			);
	} catch {
		/* storage unavailable: the change stands for this session */
	}
}

/** The column label a sort chip and an announcement name. */
export function sortColumnLabel(key: SortKey): string {
	switch (key) {
		case "name":
			return "Project";
		case "status":
			return "Status";
		case "target":
			return "Target";
		case "estimate":
			return "Estimate";
		case "milestones":
			return "Milestones";
		case "live":
			return "Live";
		case "progress":
			return "Progress";
	}
}

/**
 * The direction a column takes on its FIRST activation, when the reader has
 * not chosen one: ascending for the label-like columns, descending for the
 * date columns — the ux round's folded NIT ("asc except Progress/dates =
 * desc (most recent first)").
 */
export function firstSortDirection(key: SortKey): SortDirection {
	return key === "target" || key === "progress" ? "desc" : "asc";
}

/**
 * The words the direction reads as, per column — one vocabulary shared by the
 * column menu, the sort chip's glyph and the announcement, so the three can
 * never spell one state two ways.
 */
export function sortDirectionWords(
	key: SortKey,
	direction: SortDirection,
): string {
	const desc = direction === "desc";
	switch (key) {
		case "name":
			return desc ? "Z to A" : "A to Z";
		case "status":
			return desc ? "Archived first" : "Planning first";
		case "target":
			return desc ? "latest first" : "soonest first";
		case "estimate":
			return desc ? "days first" : "points first";
		case "milestones":
			return desc ? "most complete first" : "least complete first";
		case "live":
			return desc ? "most first" : "fewest first";
		case "progress":
			return desc ? "most recent first" : "most stale first";
	}
}

/**
 * The sentence a sort change is announced with, in the app's established
 * words (`analytics-session-state.ts`'s "Sorted by Cost, highest first.").
 * `null` is the way back, and it is its own sentence for the same reason
 * "Search cleared." is.
 */
export function sortAnnouncement(spec: SortSpec | null): string {
	if (spec === null) return "Sort cleared.";
	return `Sorted by ${sortColumnLabel(spec.key)}, ${sortDirectionWords(spec.key, spec.direction)}.`;
}

/** Whether the key ranks a row with no value of that kind last (both directions). */
function nullRank(key: SortKey, project: DesktopProject): 0 | 1 {
	switch (key) {
		case "name":
			return 0;
		case "status":
			return PROJECT_STATUS_ORDER.includes(project.status) ? 0 : 1;
		case "target":
			return cellDay(project) === null ? 1 : 0;
		case "estimate":
			return project.estimate === null ? 1 : 0;
		case "milestones":
			return project.milestones_total === 0 ? 1 : 0;
		case "live":
			// 0 is a value, not an absence: a project with no live sessions
			// sorts among the others on its count, not at the end.
			return 0;
		case "progress":
			return project.progress_updated_at === null ? 1 : 0;
	}
}

/**
 * The Target cell's own day: `completed_at` when set (a finished row dates
 * itself from the day it finished), else `target_date` — the same precedence
 * `listRowMeta` prints, so the sort and the cell cannot disagree.
 */
function cellDay(project: DesktopProject): number | null {
	return parseIsoDay(project.completed_at ?? project.target_date);
}

/** The unit rank Estimate sorts by: points before days, an unknown unit after both. */
function unitRank(unit: string): number {
	if (unit === "points") return 0;
	if (unit === "days") return 1;
	return 2;
}

/** Both rows have a value of the compared kind; compare by it, ascending. */
function compareValues(
	key: SortKey,
	a: DesktopProject,
	b: DesktopProject,
): number {
	switch (key) {
		case "name":
			return projectDisplayName(a).localeCompare(
				projectDisplayName(b),
				undefined,
				{
					sensitivity: "base",
				},
			);
		case "status":
			return (
				PROJECT_STATUS_ORDER.indexOf(a.status) -
				PROJECT_STATUS_ORDER.indexOf(b.status)
			);
		case "target": {
			const aDay = cellDay(a) ?? 0;
			const bDay = cellDay(b) ?? 0;
			return aDay - bDay;
		}
		case "estimate": {
			const unit = unitRank(a.estimate_unit) - unitRank(b.estimate_unit);
			if (unit !== 0) return unit;
			return (a.estimate ?? 0) - (b.estimate ?? 0);
		}
		case "milestones": {
			// Ratio via cross-multiplication: 1/3 vs 2/6 are equal, and 2/2
			// sorts above 0/5 without a float's rounding deciding it.
			return (
				a.milestones_completed * b.milestones_total -
				b.milestones_completed * a.milestones_total
			);
		}
		case "live":
			return a.live_sessions - b.live_sessions;
		case "progress":
			return (a.progress_updated_at ?? 0) - (b.progress_updated_at ?? 0);
	}
}

/**
 * The total-order fallback every equal pair falls through to: most recently
 * updated first, then by display name, then the raw name and id (the last two
 * make the order total, so equal rows cannot swap between paints).
 */
function fallbackCompare(a: DesktopProject, b: DesktopProject): number {
	if (a.updated_at !== b.updated_at) return b.updated_at - a.updated_at;
	const name = projectDisplayName(a).localeCompare(
		projectDisplayName(b),
		undefined,
		{ sensitivity: "base" },
	);
	if (name !== 0) return name;
	const raw = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	if (raw !== 0) return raw;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One pair under one spec. Exported so the tests can assert the contract directly. */
export function compareProjects(
	a: DesktopProject,
	b: DesktopProject,
	spec: SortSpec,
): number {
	const aNull = nullRank(spec.key, a);
	const bNull = nullRank(spec.key, b);
	if (aNull !== bNull) return aNull - bNull;
	if (aNull === 1) return fallbackCompare(a, b);
	const value = compareValues(spec.key, a, b);
	if (value !== 0) return spec.direction === "desc" ? -value : value;
	return fallbackCompare(a, b);
}

/**
 * The rows under one spec, as a new array (the caller's array is never
 * re-ordered in place — the page's memo chain depends on the input reference
 * staying the input reference).
 */
export function sortProjects(
	rows: DesktopProject[],
	spec: SortSpec,
): DesktopProject[] {
	return [...rows].sort((a, b) => compareProjects(a, b, spec));
}
