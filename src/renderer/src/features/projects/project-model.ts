/**
 * The Projects tab's pure model: every label, tone and derivation the list and
 * the detail read, as functions of the wire DTOs and nothing else.
 *
 * WHY A MODULE RATHER THAN CLOSURES INSIDE THE COMPONENTS, the same reason
 * `scheduled-task-model.ts` is one: a rule stated as a pure function over the
 * DTOs can be bundled and executed by `scripts/projects-tab.test.mjs` in Node,
 * so the copy a user reads (a status chip's label, an age, a count) is pinned
 * by a test rather than by a reviewer's eye on a screenshot. 6b's board and
 * 6c's timeline are meant to CONSUME this module — the status vocabulary and
 * the derived-formatting rules live here so the three views cannot disagree
 * about what `paused` is called or how `13` `points` is spelled.
 *
 * WHAT THIS MODULE MUST NOT DO, because the backend owns it: derive a
 * milestone's status (the route computes it once, from `completed_at` and
 * `target_date`, so the chip and the timeline marker cannot contradict each
 * other), decide staleness (`progress_stale` is computed server-side from the
 * one 30-minute constant), or sort the listing (the backend sorts by status
 * rank then recency). Every one of those arriving here precomputed is the
 * contract working, not a gap to fill in.
 *
 * LOCALE-INDEPENDENT BY PARAMETER: `formatProjectDay` takes the locale rather
 * than reading `navigator.language` at call time, so the Node test can pin one
 * output. In the app the caller passes `navigator.language`, matching the rule
 * the shared date utils state (the platform's own formatter, never hardcoded
 * English).
 */

import type {
	DesktopLinkedSession,
	DesktopMilestoneStatus,
	DesktopProject,
	DesktopProjectView,
} from "../../../../shared/desktop-control-contract";

/** A `Badge` variant name, kept structural to avoid importing the component. */
export type ChipVariant =
	| "neutral"
	| "accent"
	| "success"
	| "warning"
	| "danger"
	| "info"
	| "outline"
	| "attention";

export type ChipMeta = { label: string; variant: ChipVariant };

/**
 * The status vocabulary, one row per value the store's enum declares.
 *
 * `active` takes `accent` because it is the state that means "work is moving";
 * `done` is `success`; `paused` is deliberately NOT a warning — a paused
 * project is a choice the operator made, not a condition to fix — so it reads
 * neutral, and `archived` takes the quiet outline.
 *
 * An UNKNOWN status (a row written by a backend newer than this app) keeps its
 * raw word with neutral treatment: the honest rendering of a state this build
 * has never heard of is the word itself, not a guessed chip or a crash.
 */
const PROJECT_STATUS_META: Record<string, ChipMeta> = {
	active: { label: "Active", variant: "accent" },
	paused: { label: "Paused", variant: "neutral" },
	done: { label: "Done", variant: "success" },
	archived: { label: "Archived", variant: "outline" },
};

export function projectStatusMeta(status: string): ChipMeta {
	return (
		PROJECT_STATUS_META[status] ?? {
			label: status || "Unknown",
			variant: "neutral",
		}
	);
}

/**
 * The milestone vocabulary. These three are the SERVER's derived statuses
 * (`completed` when `completed_at` is set, else `overdue` when the target date
 * has passed, else `upcoming`) — this map only names them and gives the overdue
 * case the warning tone the design asks for.
 */
const MILESTONE_STATUS_META: Record<DesktopMilestoneStatus, ChipMeta> = {
	completed: { label: "Completed", variant: "success" },
	overdue: { label: "Overdue", variant: "warning" },
	upcoming: { label: "Upcoming", variant: "neutral" },
};

export function milestoneStatusMeta(status: DesktopMilestoneStatus): ChipMeta {
	return (
		MILESTONE_STATUS_META[status] ?? {
			label: String(status),
			variant: "neutral",
		}
	);
}

/** The stale badge's one label. Its presence is `progress_stale`, not a derivation here. */
export const PROGRESS_STALE_LABEL = "Stale";

/** One ISO day, `YYYY-MM-DD`, as the wire carries it. */
const PROJECT_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * One ISO day (`2026-09-20`), as a reader's calendar date.
 *
 * PARSED AS A LOCAL DAY rather than through `new Date("2026-09-20")`, which
 * ECMAScript reads as UTC midnight — one day behind for every reader west of
 * Greenwich, which is the classic off-by-one this function exists to avoid.
 * The year appears only when it is not the reader's current year, the same
 * rule `formatTurnTimestamp` states: a planning date's year is noise inside
 * the frame the reader is already in.
 */
export function formatProjectDay(
	day: string | null | undefined,
	locale?: string,
	now: Date = new Date(),
): string {
	if (!day) return "";
	const match = PROJECT_DAY_PATTERN.exec(day);
	if (!match) return day;
	const date = new Date(
		Number(match[1]),
		Number(match[2]) - 1,
		Number(match[3]),
	);
	if (Number.isNaN(date.getTime())) return day;
	const monthDay = date.toLocaleDateString(locale, {
		month: "short",
		day: "numeric",
	});
	return date.getFullYear() === now.getFullYear()
		? monthDay
		: `${monthDay}, ${date.getFullYear()}`;
}

/**
 * How long ago a progress snippet was reported, as a compact token.
 *
 * `progress_updated_at` is an epoch FLOAT in seconds (the store's machine
 * instant), and `nowMs` is the caller's clock in milliseconds — the caller
 * reads `Date.now()` once per render, the same rule `schedules-page.tsx`
 * states for its due labels. `""` for a record with no stamp: unknown is not
 * "0m ago", and a sentence built from this drops the age rather than inventing
 * one.
 */
export function progressAge(
	updatedAtSeconds: number | null | undefined,
	nowMs: number,
): string {
	if (updatedAtSeconds === null || updatedAtSeconds === undefined) return "";
	const seconds = Math.max(0, Math.floor(nowMs / 1000 - updatedAtSeconds));
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86400)}d`;
}

/**
 * An age token as a sentence fragment: `just now`, or `<age> ago`.
 *
 * ONE RULE, TWO READERS. `progressAge` returns "just now" as a complete
 * phrase, and appending " ago" to it is the copy defect QA round 1's Q-1 read
 * live ("reported just now ago by the operator"): the list cell special-cased
 * the phrase and the detail's `progressLine` did not, so the two surfaces
 * spelled one fact two ways. This is the one place the rule lives now, and both
 * callers go through it.
 */
export function progressAgePhrase(age: string): string {
	return age === "just now" ? "just now" : `${age} ago`;
}

/**
 * The date FIELD rule: an ISO `YYYY-MM-DD` day, or the empty string (a field's
 * own "unset").
 *
 * Distinct from the parsing pattern above, which needs capture groups and
 * refuses empty because it is reading a stored date; this one is what an input
 * accepts. Exported so the form dialog's date fields and the milestone add row
 * refuse malformed input in the same words rather than one of them leaving it
 * to the wire (the reviewer's round-1 nit).
 */
export const PROJECT_DAY_FIELD_PATTERN = /^$|^\d{4}-\d{2}-\d{2}$/;

/**
 * The progress line's reporter half: who wrote the snippet.
 *
 * `""` means the row does not say; `"operator"` is the route's own word for a
 * change made by the app; anything else is a session id and is prefixed, so a
 * bare hex string never appears without saying what it is.
 */
export function progressReporterLabel(reportedBy: string): string {
	if (!reportedBy) return "";
	if (reportedBy === "operator") return "the operator";
	return `session ${reportedBy}`;
}

/**
 * The one progress sentence, as the detail renders it.
 *
 *   reported 2h ago by session 4e92693767fa
 *   reported just now by the operator
 *   not reported yet
 *
 * "not reported yet" is a distinct fact from a stale report: nothing has ever
 * been written, and the stale badge beside it says the first honest line is
 * still owed. Both are `progress_stale`, and the sentence is what tells the
 * two apart.
 */
export function progressLine(
	view: Pick<
		DesktopProjectView,
		"progress" | "progress_updated_at" | "progress_reported_by"
	>,
	nowMs: number,
): string {
	if (!view.progress) return "not reported yet";
	const age = progressAge(view.progress_updated_at, nowMs);
	const reporter = progressReporterLabel(view.progress_reported_by);
	const parts = [age ? `reported ${progressAgePhrase(age)}` : "reported"];
	if (reporter) parts.push(`by ${reporter}`);
	return parts.join(" ");
}

/**
 * An estimate, in its unit's own short form: `13 pt`, `4d`, `2.5 pt`.
 *
 * The unit words are the design's own ("13 pt", "4d") rather than "points" /
 * "days" spelled out: the value lives in a chip beside a date and a count, and
 * a column of full words is three times the width for the same fact. An
 * unknown unit (a newer backend's) falls back to the number alone — naming a
 * unit this build does not know would be inventing one.
 */
export function estimateLabel(
	estimate: number | null | undefined,
	unit: string,
): string {
	if (estimate === null || estimate === undefined) return "";
	const value = String(estimate);
	if (unit === "points") return `${value} pt`;
	if (unit === "days") return `${value}d`;
	return value;
}

/** `2/5`, or `""` when the project declares no milestones (nothing to count). */
export function milestoneCountLabel(completed: number, total: number): string {
	if (total <= 0) return "";
	return `${completed}/${total}`;
}

/** `2 live`, or `""` for zero — a chip that says nothing is not drawn. */
export function liveSessionsLabel(live: number): string {
	if (live <= 0) return "";
	return `${live} live`;
}

/** `1 session` / `3 sessions`, or `""` for zero. */
export function sessionsCountLabel(count: number): string {
	if (count <= 0) return "";
	return count === 1 ? "1 session" : `${count} sessions`;
}

/**
 * A linked session's row state, from the three facts that can describe it.
 *
 * Precedence is deliberate and matches what the reader must not miss: a
 * session whose directory is GONE (`exists: false`) is the one state that
 * needs an operator decision (unlink, or the row is a ghost), an ARCHIVED one
 * is a finished conversation the operator chose to keep, and only then does
 * the runtime record's state read out. `busy` refines a live row rather than
 * replacing it — the dot's label stays `Live`, and the busy mark is drawn
 * beside it by the component.
 */
export function linkStateMeta(link: {
	exists: boolean;
	archived: boolean;
	runtime: { state?: string };
}): ChipMeta {
	if (!link.exists) return { label: "Missing", variant: "outline" };
	if (link.archived) return { label: "Archived", variant: "neutral" };
	switch (link.runtime?.state) {
		case "live":
			return { label: "Live", variant: "success" };
		case "wedged":
			return { label: "Wedged", variant: "warning" };
		case "stale":
			return { label: "Stale", variant: "warning" };
		case "stopped":
			return { label: "Stopped", variant: "neutral" };
		default:
			return {
				label: String(link.runtime?.state ?? "Unknown"),
				variant: "neutral",
			};
	}
}

/**
 * The subagents and todos chips of one linked-session row.
 *
 * `null` means UNKNOWN and is not rendered at all — never as `0` (the store's
 * own rule: a session that never launched a child has no roster sidecar, and a
 * 0/0 summary would claim an empty roster it cannot prove). The components
 * render these strings only when non-empty.
 */
export function subagentChipLabel(
	summary: DesktopLinkedSession["subagents"],
): string {
	if (!summary) return "";
	if (summary.running > 0)
		return summary.running === 1
			? "1 subagent running"
			: `${summary.running} subagents running`;
	return summary.settled === 1 ? "1 subagent" : `${summary.settled} subagents`;
}

export function todoChipLabel(summary: DesktopLinkedSession["todos"]): string {
	if (!summary) return "";
	return summary.total === 1 ? "1 todo" : `${summary.total} todos`;
}

/**
 * The row's meta line for the list view, as a list of tokens rather than a
 * joined string: the component keeps them as separate spans (each can be
 * omitted, each gets its own ink), and a joined string would make the
 * omission rules the joiner's problem.
 */
export function listRowMeta(
	project: Pick<
		DesktopProject,
		| "target_date"
		| "completed_at"
		| "estimate"
		| "estimate_unit"
		| "milestones_completed"
		| "milestones_total"
		| "live_sessions"
	>,
	locale?: string,
): { key: string; text: string }[] {
	const rows: { key: string; text: string }[] = [];
	const day = formatProjectDay(
		project.completed_at ?? project.target_date,
		locale,
	);
	if (day) {
		rows.push({
			key: project.completed_at ? "completed" : "target",
			text: project.completed_at ? `completed ${day}` : `due ${day}`,
		});
	}
	const estimate = estimateLabel(project.estimate, project.estimate_unit);
	if (estimate) rows.push({ key: "estimate", text: estimate });
	const milestones = milestoneCountLabel(
		project.milestones_completed,
		project.milestones_total,
	);
	if (milestones)
		rows.push({ key: "milestones", text: `milestones ${milestones}` });
	const live = liveSessionsLabel(project.live_sessions);
	if (live) rows.push({ key: "live", text: live });
	return rows;
}

/* ------------------------------------------------------------- day values -- */

/** One day, in ms. Day arithmetic in this feature is on whole UTC days. */
export const DAY_MS = 86_400_000;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * One ISO day (`YYYY-MM-DD`) as UTC midnight ms, or `null`.
 *
 * SHAPE *AND* CALENDAR, unlike `PROJECT_DAY_FIELD_PATTERN` above: that pattern
 * is the form dialog's accept rule (a day, or the empty a field carries), while
 * this one also refuses a calendar the month cannot name — `2026-13-01` rolls
 * into January in `Date.UTC`, so the round trip is what refuses it. The axis
 * and the overdue check both read days through here.
 *
 * UTC, because the store's own day (`_utc_today`) is UTC: a milestone's
 * server-derived `overdue` and this feature's own target-date emphasis must not
 * disagree about which day it is for the hours the two dates differ.
 */
export function parseIsoDay(value: string | null | undefined): number | null {
	if (!value) return null;
	const match = ISO_DAY.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const ms = Date.UTC(year, month - 1, day);
	const check = new Date(ms);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day
	)
		return null;
	return ms;
}

/* ----------------------------------------------------------------- board -- */

/**
 * Board columns in their fixed order; `archived` joins only when non-empty
 * (the design's rule, kept identical to the TUI board so the two agree).
 */
export const BOARD_COLUMNS = ["active", "paused", "done"] as const;
export const BOARD_EXTRA_COLUMN = "archived";

/**
 * The board's columns: the fixed three, `archived` when it holds rows, then
 * one column per status outside the vocabulary.
 *
 * THE UNKNOWN-STATUS COLUMN IS A DELIBERATE DELTA FROM THE TUI, and the delta
 * is a fix rather than a fork: `projects_render.py`'s `_columns_of` builds its
 * map from every row but returns only the fixed names, so a row written by a
 * newer build (the DTO's own docstring names that case: "the raw value with
 * neutral treatment") would silently vanish from the board. Here it gets its
 * own column after the fixed ones, in first-seen order, so nothing is dropped.
 */
export function boardColumns(
	projects: DesktopProject[],
): { status: string; projects: DesktopProject[] }[] {
	const byStatus = new Map<string, DesktopProject[]>();
	for (const project of projects) {
		const rows = byStatus.get(project.status) ?? [];
		rows.push(project);
		byStatus.set(project.status, rows);
	}
	const columns = BOARD_COLUMNS.map((status) => ({
		status: status as string,
		projects: byStatus.get(status) ?? [],
	}));
	const archived = byStatus.get(BOARD_EXTRA_COLUMN) ?? [];
	if (archived.length > 0) {
		columns.push({ status: BOARD_EXTRA_COLUMN, projects: archived });
	}
	for (const [status, rows] of byStatus) {
		if (
			status !== BOARD_EXTRA_COLUMN &&
			!BOARD_COLUMNS.includes(status as (typeof BOARD_COLUMNS)[number])
		) {
			columns.push({ status, projects: rows });
		}
	}
	return columns;
}

/**
 * Whether a project's target day has passed with the work unfinished — the
 * board's overdue emphasis.
 *
 * The three facts it reads are the ones the list already carries (there is no
 * server flag for project-level lateness; the store derives per-MILESTONE
 * status only), and the day basis is UTC for the reason `parseIsoDay` states.
 * A done or archived row is never overdue, completed or not: the target day
 * stopped being a promise when the work landed.
 */
export function projectOverdue(
	project: Pick<DesktopProject, "target_date" | "completed_at" | "status">,
	todayMs: number,
): boolean {
	if (project.status === "done" || project.status === "archived") return false;
	if (project.completed_at) return false;
	const target = parseIsoDay(project.target_date);
	if (target === null) return false;
	return target < todayMs;
}
