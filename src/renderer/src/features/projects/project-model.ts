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
 * than reading the store at call time, so the Node test can pin one output.
 * In the app the caller passes the i18n locale (the `useI18nLocale()` hook —
 * device before a backend answers, the backend's resolved language after),
 * and the formatter itself is the shared layer, never hardcoded English.
 */

import { formatDate, formatTime } from "@shared/i18n";

import type {
	DesktopLinkedSession,
	DesktopMilestoneStatus,
	DesktopProject,
	DesktopProjectUpdate,
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
 * THE PIPELINE TAKES THE COLOUR STEPS and the two side states stay quiet:
 * `planning` is `info` (a phase of writing and research, not yet work in
 * motion), `active` is `accent` (the state that means "work is moving"), `qa`
 * is `attention` (the phase that waits on reviewers and designers rather than
 * on the machine), `validation` is `warning` (deployed and watched — a state
 * that asks to be looked at, not one that is wrong), and `done` is `success`.
 * `paused` is deliberately NOT a warning — a paused project is a choice the
 * operator made, not a condition to fix — so it reads neutral, and `archived`
 * takes the quiet outline.
 *
 * An UNKNOWN status (a row written by a backend newer than this app) keeps its
 * raw word with neutral treatment: the honest rendering of a state this build
 * has never heard of is the word itself, not a guessed chip or a crash.
 */
const PROJECT_STATUS_META: Record<string, ChipMeta> = {
	planning: { label: "Planning", variant: "info" },
	active: { label: "Active", variant: "accent" },
	qa: { label: "QA", variant: "attention" },
	validation: { label: "Validation", variant: "warning" },
	done: { label: "Done", variant: "success" },
	paused: { label: "Paused", variant: "neutral" },
	archived: { label: "Archived", variant: "outline" },
};

/**
 * The status vocabulary in the pipeline's own order — Planning through
 * Archived, the order the table above is declared in.
 *
 * Exported because MORE THAN ONE surface has to agree on it: the Filters
 * popover renders its Status options in this order, and the List's Status sort
 * orders rows by it (`project-sort.ts`). A second hand-written list is how
 * "archived before active" reaches a sort that looks alphabetical and a
 * popover that disagrees with it — both defects the design names.
 */
export const PROJECT_STATUS_ORDER: string[] = Object.keys(PROJECT_STATUS_META);

export function projectStatusMeta(status: string): ChipMeta {
	return (
		PROJECT_STATUS_META[status] ?? {
			label: status || "Unknown",
			variant: "neutral",
		}
	);
}

/**
 * The status vocabulary in its one order, as options for the two surfaces that
 * offer a choice of status (the create form's select and the detail's inline
 * select): labels come from `PROJECT_STATUS_META` so a menu and a chip cannot
 * spell a state differently. The sequence is the lifecycle order `PROJECT_STATUSES`
 * declares in the wire contract - planning -> active -> qa -> validation ->
 * done, then the two side states - written once here rather than per list.
 */
export const PROJECT_STATUS_OPTIONS: ReadonlyArray<{
	value: string;
	label: string;
}> = [
	"planning",
	"active",
	"qa",
	"validation",
	"done",
	"paused",
	"archived",
].map((value) => ({ value, label: projectStatusMeta(value).label }));

/**
 * Whether the status's chip carries a check BESIDE its colour.
 *
 * WHY `done` AND ONLY `done` (design round 1, D1): active maps to `accent` and
 * done to `success`, and in the brand palettes those are all but one chip
 * (ΔE00 2.22 light / 5.07 dark, washes byte-identical on dark) while the
 * Status column draws them SIDE BY SIDE - so the difference has to be a shape
 * as well as a hue. The rule lives here rather than inside the component so
 * this tab's own lane can hold it (the component and the test consume the
 * same function, which is the property every other label in this model has).
 */
export function statusCarriesCheck(status: string): boolean {
	return status === "done";
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
	const monthDay = formatDate(
		date,
		{
			month: "short",
			day: "numeric",
		},
		locale,
	);
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
 * The board card's progress line: `reported 2h ago`, `reported just now`, or
 * `no progress`.
 *
 * The card used to append its own `" ago"` to `progressAgePhrase`'s answer,
 * so every card carrying an age read "reported 2h ago ago" (design review
 * round 1, D1 — measured in the committed board frames). The sentence is
 * derived HERE for the same reason the phrase is: one rule, one place, and a
 * test can hold it.
 */
export function boardProgressText(age: string): string {
	return age ? `reported ${progressAgePhrase(age)}` : "no progress";
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
 * The section band's tally, NAMED: `1 project` / `8 projects`.
 *
 * The band prints the bare number - the app's terse register, and the same
 * terse form `boardLinkCount`'s callers use - so this exists for the ACCESSIBLE
 * NAME only (UX review round 1, U1): the count span sits outside the `<h3>`, so
 * a screen reader in reading order announced `platform, 8`, and "8" carries no
 * noun to say what it tallies.
 *
 * NO ZERO CLAUSE, unlike `sessionsCountLabel`: that clause exists for chips that
 * are not drawn at zero, while this number is always drawn and always needs the
 * noun. The plural rule is that helper's own - `1 project`, `n projects` - so
 * the two cannot drift into two vocabularies for one idea.
 */
export function projectsCountLabel(count: number): string {
	return count === 1 ? "1 project" : `${count} projects`;
}

/**
 * The board card's popover trigger: the DOOR's name, with liveness folded in.
 *
 * The trigger used to print liveness alone (`0 live` on a project whose links
 * are merely stopped), which names a state and never the action (UX round 1,
 * U1) and whose number disagreed with the popover's own contents (design
 * round 1, D5). It now names what opens — the linked sessions — and keeps the
 * live count while there is one: `3 sessions · 2 live`, `1 session`. Zero
 * live reads as the plain count, because a plain count is exactly what the
 * popover lists.
 */
export function sessionsTriggerLabel(project: {
	sessions: number;
	live_sessions: number;
}): string {
	const count = sessionsCountLabel(project.sessions);
	if (!count) return "";
	const live = liveSessionsLabel(project.live_sessions);
	return live ? `${count} · ${live}` : count;
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
 * Board columns in their fixed order: the LIFECYCLE, fixed so an empty phase
 * still reads as a phase; `paused` and `archived` are the SIDE states, which
 * join only when they hold rows (a board of nothing but side states would
 * read as a board of nothing). The backend's vocabulary lands with the same
 * five-phase pipeline; the TUI board's fixed list moves with it.
 */
export const BOARD_COLUMNS = [
	"planning",
	"active",
	"qa",
	"validation",
	"done",
] as const;
export const BOARD_SIDE_COLUMNS = ["paused", "archived"] as const;

/**
 * The board's time window: the recency a card must carry to be drawn.
 *
 * ONE TABLE OWNS THE LADDER. Every form the window takes lives on its row -
 * the stored token (`value`), the control's own words (`label`), the phrase
 * the empty-window sentence embeds (`phrase`), and the arithmetic (`seconds`)
 * - so the control, the filter and the copy cannot drift apart about what
 * "last 30 days" is called or how far back it reaches.
 *
 * ROLLING WINDOWS, NOT CALENDAR ONES: `seconds` is a lookback from the
 * reader's own clock (the page hands in its one `nowMs`, the same instant the
 * age labels run on), not a day boundary - a "last 24 hours" that reset at
 * midnight would sit empty at 00:01 and read as a broken board.
 *
 * The predicate is INCLUSIVE at the boundary, and `all` carries no arithmetic
 * at all (`seconds: null`): it is the absence of a predicate, which is also
 * why the value an unreadable token falls back to is `7d` and never `all` - a
 * window nothing can vouch for must not silently widen to everything.
 *
 * `updated_at` is epoch SECONDS (the wire's units), so the comparison divides
 * the clock once (`nowMs / 1000`) rather than multiplying every row's stamp.
 * A card's PRINTED progress age is a different stamp (`progress_updated_at`),
 * deliberately not what this filters on.
 */
export const BOARD_WINDOWS = [
	{
		value: "24h",
		label: "Last 24 hours",
		phrase: "the last 24 hours",
		seconds: 86_400,
	},
	{
		value: "7d",
		label: "Last 7 days",
		phrase: "the last 7 days",
		seconds: 604_800,
	},
	{
		value: "30d",
		label: "Last 30 days",
		phrase: "the last 30 days",
		seconds: 2_592_000,
	},
	{
		value: "90d",
		label: "Last 90 days",
		phrase: "the last 90 days",
		seconds: 7_776_000,
	},
	{ value: "all", label: "All time", phrase: null, seconds: null },
] as const;

export type BoardWindow = (typeof BOARD_WINDOWS)[number]["value"];

/** The window a fresh session - or an unrecognised stored value - reads. */
export const DEFAULT_BOARD_WINDOW: BoardWindow = "7d";

/**
 * The default's own row, resolved once. `find` cannot miss for a typed caller
 * - `BoardWindow` IS this table's value union - so the cast is the compiler
 * being told what the union already proves; the fallback keeps
 * `boardWindowMeta`'s return type total instead of widening it with
 * `undefined` at every call site.
 */
const DEFAULT_BOARD_WINDOW_ENTRY = BOARD_WINDOWS.find(
	(entry) => entry.value === DEFAULT_BOARD_WINDOW,
) as (typeof BOARD_WINDOWS)[number];

/**
 * The ladder row behind a window token. An unrecognised value reads as the
 * default's row rather than as `all`: a window nothing can vouch for narrows
 * the board (7d), it never opens it.
 */
export function boardWindowMeta(value: string): (typeof BOARD_WINDOWS)[number] {
	return (
		BOARD_WINDOWS.find((entry) => entry.value === value) ??
		DEFAULT_BOARD_WINDOW_ENTRY
	);
}

/** Whether a stored token is one of the ladder's values. */
export function isBoardWindow(value: string): value is BoardWindow {
	return BOARD_WINDOWS.some((entry) => entry.value === value);
}

/**
 * The board's rows for a window: the listing narrowed to the ones whose
 * `updated_at` is inside the lookback, or the listing itself at `all`.
 *
 * A SEPARATE derivation rather than a filter in place, because the listing
 * feeds three surfaces: `projects` stays whole for the List view and the
 * timeline's fan-out (deliberately - the window is the BOARD's preference),
 * and only the board reads this. `all` returns the input by reference, which
 * is the "no predicate" the design states rather than a no-op filter.
 */
export function boardWindowProjects(
	projects: DesktopProject[],
	window: BoardWindow,
	nowMs: number,
): DesktopProject[] {
	const entry = boardWindowMeta(window);
	if (entry.seconds === null) return projects;
	return projects.filter(
		(project) => nowMs / 1000 - project.updated_at <= entry.seconds,
	);
}

/**
 * The empty-window state's heading - `Nothing changed in the last 7 days.` -
 * or `null` at `all`.
 *
 * The null is the state's own unreachability stated in code: `all` is no
 * predicate, so a non-empty listing cannot narrow to nothing under it, and
 * the one value whose heading could not be true never gets one.
 */
export function boardWindowEmptyHeading(window: BoardWindow): string | null {
	const entry = boardWindowMeta(window);
	if (entry.seconds === null) return null;
	return `Nothing changed in ${entry.phrase}.`;
}

/**
 * Where the user's board window is stored, in the same layout-choice key
 * style as the column order below (`projects-board-window`): a preference
 * kept between sessions, read with a guarded fallback so a locked store reads
 * as the default rather than as a broken board.
 */
export const PROJECTS_BOARD_WINDOW_STORAGE_KEY = "projects-board-window";

/**
 * The stored window, or the default for anything else - a missing key, a
 * locked store, a token another build wrote. The same rule `readProjectsView`
 * applies: an unrecognised value reads as the default, never as "show
 * everything".
 */
export function readBoardWindow(): BoardWindow {
	try {
		const stored = localStorage.getItem(PROJECTS_BOARD_WINDOW_STORAGE_KEY);
		if (stored !== null && isBoardWindow(stored)) return stored;
	} catch {
		/* storage unavailable: the default is the honest answer */
	}
	return DEFAULT_BOARD_WINDOW;
}

/**
 * Persist the window; a failed write must not fail the change. The session
 * keeps the switch either way - the page holds it in state, and only a
 * remount re-reads the store (the guarded-read rule above then decides what
 * that remount sees).
 */
export function writeBoardWindow(window: BoardWindow): void {
	try {
		localStorage.setItem(PROJECTS_BOARD_WINDOW_STORAGE_KEY, window);
	} catch {
		/* storage unavailable: the change stands for this session */
	}
}

/**
 * Where the user's own column order is stored, in the app's layout-choice key
 * style (`projects-view`, `chat-sidebar-disclosures`): a preference kept
 * between sessions, read with guarded fallbacks so a locked store reads as the
 * default order rather than a broken board.
 */
export const PROJECTS_BOARD_ORDER_STORAGE_KEY = "projects-board-column-order";

/**
 * THE SESSION'S OWN COPY OF THE ORDER, ahead of the store (UX round 1, U4).
 *
 * WHY IT EXISTS. The write path was best-effort by design - a failed write
 * must not fail the move - but the read path had only `localStorage` to go
 * on, so with the store blocked a move survived until the board remounted
 * (a view switch re-runs `readBoardColumnOrder`) and then silently reverted,
 * which is not what "the move stands for this session" promised. The memory
 * below is that promise made true: every write records the order here as
 * well, and a read prefers it over the store, so the session's own choice
 * survives remounts whether or not the store accepted it. It is deliberately
 * module-scoped rather than component state: the point is that it outlives
 * the mount.
 */
let sessionOrder: string[] | null = null;

/**
 * The column order for this board: the session's own choice when it has one,
 * else the stored order, else `[]` (the lifecycle default).
 *
 * VALIDATED, NOT TRUSTED: the stored value crosses sessions and app versions,
 * so a hand-edited array is read as ABSENT rather than half-applied — every
 * entry must be a non-empty string or the whole order is dropped. Duplicates
 * keep their first position (one status must not rank twice), and an empty
 * list means the same as no list at all.
 */
export function readBoardColumnOrder(): string[] {
	if (sessionOrder) return [...sessionOrder];
	try {
		const raw = localStorage.getItem(PROJECTS_BOARD_ORDER_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const order: string[] = [];
		for (const entry of parsed) {
			if (typeof entry !== "string" || entry.length === 0) return [];
			if (!order.includes(entry)) order.push(entry);
		}
		return order;
	} catch {
		/* storage unavailable or the value not JSON: the default is the answer */
		return [];
	}
}

/** Persist the order; a failed write must not fail the move (see above). */
export function writeBoardColumnOrder(order: string[]): void {
	/* The session copy lands first and unconditionally: it is what keeps a
	 * move alive when the store refuses it, and a stored value that later
	 * fails to read still cannot lose the session its own choice. */
	sessionOrder = [...order];
	try {
		localStorage.setItem(
			PROJECTS_BOARD_ORDER_STORAGE_KEY,
			JSON.stringify(order),
		);
	} catch {
		/* storage unavailable: the session copy above is what keeps the move */
	}
}

/**
 * The order after ONE column moves: `status` re-inserted so it lands at index
 * `to` of the full list, clamped to the ends.
 *
 * `to` is the column's NEW POSITION among all columns — the number a drag's
 * drop index and the keyboard's ±1 both speak — so the arithmetic is "take
 * the column out, put it back at that index", which is also why moving a
 * column two places LEFT is `to = from - 1` and not a swap.
 */
export function reorderColumnOrder(
	order: string[],
	status: string,
	to: number,
): string[] {
	const others = order.filter((entry) => entry !== status);
	const clamped = Math.max(0, Math.min(to, others.length));
	others.splice(clamped, 0, status);
	return others;
}

/**
 * The board's columns: the five fixed pipeline phases, the side states
 * (`paused`, `archived`) when they hold rows, then one column per status
 * outside the vocabulary.
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
	order: string[] = [],
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
	for (const side of BOARD_SIDE_COLUMNS) {
		const rows = byStatus.get(side) ?? [];
		if (rows.length > 0) columns.push({ status: side, projects: rows });
	}
	for (const [status, rows] of byStatus) {
		if (
			!BOARD_SIDE_COLUMNS.includes(
				status as (typeof BOARD_SIDE_COLUMNS)[number],
			) &&
			!BOARD_COLUMNS.includes(status as (typeof BOARD_COLUMNS)[number])
		) {
			columns.push({ status, projects: rows });
		}
	}
	if (order.length === 0) return columns;
	/*
	 * THE STORED ORDER APPLIES TO THE COLUMNS PRESENT, and this is the whole
	 * merge rule: the columns the stored order names come first, sorted by their
	 * stored rank; every other column keeps the derivation's own order and
	 * appends after them (side states when populated, unknowns last). A stored
	 * status that holds no column — a side state with no rows this session, a
	 * status another build wrote — ranks nothing and is NOT resurrected; it is
	 * only forgotten when the user reorders again, which writes the order of the
	 * columns they actually saw.
	 */
	const rank = new Map(order.map((status, index) => [status, index]));
	const ranked = columns.filter((column) => rank.has(column.status));
	ranked.sort((a, b) => (rank.get(a.status) ?? 0) - (rank.get(b.status) ?? 0));
	const rest = columns.filter((column) => !rank.has(column.status));
	return [...ranked, ...rest];
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
	/*
	 * `validation` IS still overdue-eligible on purpose: a deployed build under
	 * observation with a passed target is exactly the row the emphasis is for.
	 */
	if (project.completed_at) return false;
	const target = parseIsoDay(project.target_date);
	if (target === null) return false;
	return target < todayMs;
}

/* ------------------------------------------------- slice 2: display naming -- */

/**
 * The name a reader sees: the display `title` when set, else the addressing
 * `name`.
 *
 * THE BACKEND'S OWN PRECEDENCE (`local_operator.projects.display_name`),
 * mirrored rather than re-decided: `name` stays the key every route and verb
 * addresses a project by, while this decides only what is SEEN. A component
 * that reads `title` alone would blank the heading on every row written before
 * the field existed, which is the common case.
 */
export function projectDisplayName(project: {
	title?: string | null;
	name: string;
}): string {
	return project.title || project.name;
}

/**
 * The "Managed by" value: the owner and the team, de-duplicated, joined with
 * a middle dot (`atlas · platform`).
 *
 * `""` when neither is set — absent means UNKNOWN, and the component renders
 * no line rather than "Managed by nobody". The two fields are separate facts
 * (who owns the stream, which team manages it) that are often the same word;
 * printing it twice would read as two different things.
 */
export function managedByLine(
	owner: string | null | undefined,
	team: string | null | undefined,
): string {
	const parts: string[] = [];
	for (const value of [owner, team]) {
		const text = value?.trim();
		if (text && !parts.includes(text)) parts.push(text);
	}
	return parts.join(" · ");
}

/* --------------------------------------------- slice 3: team grouping -- */

/** The bucket a project with no team or owner files under. */
export const NO_TEAM_LABEL = "No team";

/**
 * The team a project groups under: `team` first, `owner` as the fallback, and
 * `null` for the bucket.
 *
 * WHY OWNER FALLS IN: both fields name who carries the stream, and rows in
 * the store routinely carry one or the other rather than both — a row with
 * only an owner would land in "No team" beside its own team's section, which
 * reads as a missing project rather than as a different fact. Trimmed blanks
 * count as absent: the fields have accepted `""` since they existed, and an
 * empty section header is not a section.
 */
export function projectTeamName(project: {
	team?: string | null;
	owner?: string | null;
}): string | null {
	const team = project.team?.trim();
	if (team) return team;
	const owner = project.owner?.trim();
	if (owner) return owner;
	return null;
}

/** One group of items under a team header; `team: null` is the `No team` bucket. */
export type TeamGroup<T> = {
	team: string | null;
	items: T[];
};

/**
 * Group items under their teams by the same rule for the list, the timeline
 * and every board column — one helper so the three surfaces cannot drift.
 *
 * ORDER IS A RULE, NOT AN ACCIDENT: named teams sort case-insensitively, and
 * the `No team` bucket always renders LAST — a bucket is not a team, and a
 * section that moves with the alphabet would read as one. Within a group the
 * input order is kept (the store's own; the views do not re-sort what they
 * were handed). Empty groups are omitted: a header with nothing under it is a
 * promise the surface does not keep.
 */
export function groupByTeam<T>(
	items: T[],
	teamOf: (item: T) => string | null,
): TeamGroup<T>[] {
	const named = new Map<string, T[]>();
	const bucket: T[] = [];
	for (const item of items) {
		const team = teamOf(item);
		if (team === null) {
			bucket.push(item);
			continue;
		}
		const list = named.get(team);
		if (list) list.push(item);
		else named.set(team, [item]);
	}
	const groups: TeamGroup<T>[] = [...named.entries()]
		.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
		.map(([team, list]) => ({ team, items: list }));
	if (bucket.length > 0) groups.push({ team: null, items: bucket });
	return groups;
}

/**
 * A linked session's row name: its title, or the id in the machine voice.
 *
 * ONE RULE, THREE READERS (the links list, the to-dos rows and the quick-send
 * target) — extracted so the fallback cannot drift between them, the same
 * argument `progressAgePhrase` states for its own phrase.
 */
export function sessionLabel(
	link: Pick<DesktopLinkedSession, "title" | "session_id">,
): string {
	return link.title || link.session_id;
}

/* ------------------------------------------------ slice 2: the updates log -- */

/** The history, newest first: the wire keeps it newest-LAST (the log's order). */
export function updatesNewestFirst(
	updates: DesktopProjectUpdate[],
): DesktopProjectUpdate[] {
	return [...updates].reverse();
}

/** `1 update` / `12 updates`, or `""` for none — a count that says nothing is not drawn. */
export function updatesCountLabel(count: number): string {
	if (count <= 0) return "";
	return count === 1 ? "1 update" : `${count} updates`;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** One LOCAL calendar day key, `YYYY-MM-DD`, from a Date. */
function localDayKey(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * One update's day-group key: the LOCAL calendar day of its `at` instant.
 *
 * LOCAL rather than UTC deliberately: the feed is read as a diary of the
 * reader's own days, and an entry written at 23:30 groups under the day it was
 * written in, not the UTC date that had hours yet to run. `at` carries its own
 * `Z`, so this is a conversion, never a guess about the zone.
 *
 * `""` for an unparsable stamp — the empty string the wire defaults to — which
 * groups such entries together at the oldest end rather than dropping them.
 */
export function updateDayKey(at: string): string {
	const ms = Date.parse(at);
	if (Number.isNaN(ms)) return "";
	return localDayKey(new Date(ms));
}

/**
 * A day key as a reader's heading: `Today`, `Yesterday`, or the date
 * (`Sep 20`, with the year only outside the reader's own — the
 * `formatProjectDay` rule, reused rather than restated).
 *
 * `""` in, `""` out: a group of unparsable stamps gets no heading rather than
 * a made-up one.
 */
export function updateDayLabel(
	dayKey: string,
	locale?: string,
	now: Date = new Date(),
): string {
	if (!dayKey) return "";
	if (dayKey === localDayKey(now)) return "Today";
	const yesterday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - 1,
	);
	if (dayKey === localDayKey(yesterday)) return "Yesterday";
	return formatProjectDay(dayKey, locale, now);
}

/** One update's absolute clock time (`2:14 PM`), or `""` for an unparsable stamp. */
export function updateTimeLabel(at: string, locale?: string): string {
	const ms = Date.parse(at);
	if (Number.isNaN(ms)) return "";
	return formatTime(
		new Date(ms),
		{
			hour: "numeric",
			minute: "2-digit",
		},
		locale,
	);
}

/**
 * How long ago one update was written, as a phrase (`2h ago`, `just now`).
 *
 * The token arithmetic is `progressAge`'s — one rule for every age this
 * feature prints — with the ISO stamp converted to the epoch seconds that
 * function reads (`at` is ISO-8601 UTC with a `Z`, so `Date.parse` is exact).
 */
export function updateAgePhrase(at: string, nowMs: number): string {
	const ms = Date.parse(at);
	if (Number.isNaN(ms)) return "";
	return progressAgePhrase(progressAge(ms / 1000, nowMs));
}

/**
 * One entry's meta line, as tokens the component joins: who wrote it, when,
 * and how long ago.
 *
 * The `listRowMeta` shape, for the same reason: each token can be individually
 * absent (an unstamped or anonymous entry loses one fact, never the line) and
 * each renders in its own ink. The author uses `progressReporterLabel`, so a
 * raw session id is never printed bare and `"operator"` reads as the
 * operator, exactly as the stale-progress line already spells it.
 */
export function updateMetaTokens(
	update: Pick<DesktopProjectUpdate, "at" | "by">,
	locale?: string,
	nowMs: number = Date.now(),
): { key: string; text: string }[] {
	const rows: { key: string; text: string }[] = [];
	const author = progressReporterLabel(update.by);
	if (author) rows.push({ key: "author", text: author });
	const time = updateTimeLabel(update.at, locale);
	if (time) rows.push({ key: "time", text: time });
	const age = updateAgePhrase(update.at, nowMs);
	if (age) rows.push({ key: "age", text: age });
	return rows;
}

/** One day group of the feed: the heading and its entries, newest first. */
export type ProjectUpdateGroup = {
	key: string;
	label: string;
	entries: DesktopProjectUpdate[];
};

/**
 * The feed's day groups, in render order: newest entry first, consecutive
 * entries of one local day under one heading.
 *
 * Consecutive grouping (not a map) because the log is already chronological:
 * one pass both reverses it and slices it, and a day can never appear twice
 * with a stale heading in between.
 */
export function groupUpdatesByDay(
	updates: DesktopProjectUpdate[],
	locale?: string,
	now: Date = new Date(),
): ProjectUpdateGroup[] {
	const groups: ProjectUpdateGroup[] = [];
	for (const update of updatesNewestFirst(updates)) {
		const key = updateDayKey(update.at);
		const last = groups[groups.length - 1];
		if (last && last.key === key) {
			last.entries.push(update);
			continue;
		}
		groups.push({
			key,
			label: updateDayLabel(key, locale, now),
			entries: [update],
		});
	}
	return groups;
}

/**
 * One attachment's size, as the backend prints it: `12 B`, `4.0 KB`, `5.2 MB`.
 *
 * ONE decimal for both scaled units, mirroring `file_size_text` rather than
 * re-deciding the format: a file named in a toast by the tool and in a feed
 * row here must not read as two different sizes for the same file. `""` for a
 * nonsense value (a hand-edited row), so a card drops the size instead of
 * printing `NaN B`.
 */
export function attachmentSizeText(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "";
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${bytes} B`;
}

/* -------------------------------------------- slice 2: detail summaries ---- */

/** The milestones header's count: `2 of 5 complete`, or `""` for none to count. */
export function milestoneSummaryLabel(
	completed: number,
	total: number,
): string {
	if (total <= 0) return "";
	return `${completed} of ${total} complete`;
}

/** The to-dos a linked session reported, or `null` when it never did. */
export type TodosSummary = { open: number; total: number };

/**
 * The linked sessions' to-dos, summed.
 *
 * `null` for the aggregate of nothing KNOWN — a session with no persisted
 * snapshot contributes no counts and is not a zero (the store's own rule for
 * `todos`, restated by `subagentChipLabel`), so a project whose links are all
 * unknown says so rather than reporting `0 open`. Sessions the summariser
 * cannot see are simply absent from the figure, which is why the component
 * renders the per-row counts beside it: the aggregate states its own coverage.
 */
export function todosAggregate(
	links: Pick<DesktopLinkedSession, "todos">[],
): TodosSummary | null {
	let open = 0;
	let total = 0;
	let seen = false;
	for (const link of links) {
		if (!link.todos) continue;
		seen = true;
		open += link.todos.open;
		total += link.todos.total;
	}
	return seen ? { open, total } : null;
}

/** `3 open of 7`, the one spelling for a row's and the aggregate's counts. */
export function todosCountLabel(summary: TodosSummary): string {
	return `${summary.open} open of ${summary.total}`;
}

/* ------------------------------------------------ slice 2: session actions -- */

/**
 * The quick-send target the composer strip starts on: the first LIVE linked
 * session when there is one, else the first whose directory still exists.
 *
 * `null` when nothing is sendable — a project whose links are all gone — which
 * is what disables the strip rather than aiming it at a ghost. The row-level
 * "message this session" action writes the same selection, so the rule for
 * "where does a message go by default" lives once.
 */
export function defaultSendTarget(
	links: Pick<DesktopLinkedSession, "exists" | "session_id" | "runtime">[],
): string | null {
	const usable = links.filter((link) => link.exists);
	const live = usable.find((link) => link.runtime?.state === "live");
	return (live ?? usable[0])?.session_id ?? null;
}

/**
 * The quick-send composer's default text for a start-session: the project's
 * key and display name, its latest progress, and the ask.
 *
 * PRE-FILLED AND EDITABLE — the prompt is a draft in the new session's
 * composer, never sent by the button that created the session, so the operator
 * reads and adjusts what the agent will be told before anything runs. The
 * three facts are the ones a reader of the current screen has: what this is
 * (name + title), where it stands (the progress snippet, which IS the latest
 * history entry's text server-side), and what happens next.
 */
export function startSessionPrompt(project: {
	name: string;
	title?: string | null;
	progress: string;
}): string {
	const display = projectDisplayName(project);
	const progress = project.progress.trim() || "not reported yet";
	return [
		`Continue work on project "${display}" (${project.name}).`,
		`Latest progress: ${progress}`,
		"Review the project details and continue or complete the work.",
	].join("\n");
}

/** `team atlas` / `agent reviewer` / `""` for a plain session — toast copy for the starter. */
export function sessionTargetLabel(
	target: { kind: "agent" | "team"; name: string } | null,
): string {
	if (!target) return "";
	return target.kind === "team"
		? `team ${target.name}`
		: `agent ${target.name}`;
}

/* ------------------------------------------ refusals, re-spoken for here ---- */

/**
 * Python `repr()` of each name in the daemon's sentence: `'a', "it's b"`.
 * Quote style flips when the name itself holds a single quote, so both are read.
 */
const REPR_STRING = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;

function namesFromGateSentence(list: string): string[] {
	const names: string[] = [];
	for (const match of list.matchAll(REPR_STRING)) {
		names.push((match[1] ?? match[2] ?? "").replace(/\\(.)/g, "$1"));
	}
	return names;
}

/** How many names a sentence spells out before "and N more". */
export const DONE_GATE_NAMES_SHOWN = 3;

/**
 * The names as one clause: `a, b, c and 4 more`, `a and b`, or `a`.
 *
 * Truncated because the real case is a long, all-overdue plan (seven
 * milestones): a sentence that recites all of them buries the count and the
 * remedy, and the dialog offers the full list one press away instead.
 *
 * ONE MORE IS LISTED, NOT SUMMARISED (design round 1, D6): the fold used to
 * fire at four names too, reading `a, b, c and 1 more` - one character
 * shorter than the four names it hid, while the dialog beside it offered to
 * show those same four. Only a fold of two or more names is worth a press.
 */
export function doneGateNamesClause(names: string[]): string {
	if (names.length <= DONE_GATE_NAMES_SHOWN + 1) {
		if (names.length <= 1) return names.join("");
		return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
	}
	const hidden = names.length - DONE_GATE_NAMES_SHOWN;
	return `${names.slice(0, DONE_GATE_NAMES_SHOWN).join(", ")} and ${hidden} more`;
}

/** `1 milestone is` / `7 milestones are`: the count agrees with its verb. */
function milestonesAre(count: number): string {
	return `${count} milestone${count === 1 ? " is" : "s are"}`;
}

/**
 * The daemon's done-gate sentence, re-spoken for the desktop surfaces.
 *
 * WHY (UX round 2, U4; design round 1, D4): the backend's refusal reads
 * "cannot set status 'done': 1 milestone still incomplete ('x') - complete
 * them, or pass force_done=true to close with them open", and BOTH halves
 * needed the app's voice once it reached a reader: `force_done` is a
 * tool-call field the desktop update body does not carry (the dialog cannot
 * send it, so the tail offered a door this surface has no key to), and the
 * head is the daemon's log register, not prose.
 *
 * THE NAMES ARE CAPPED AND UNQUOTED (UX round 1, U4; design round 1, D8):
 * the daemon prints them as Python reprs in one 62-word line whose action
 * clause is last, so a reader met seven quoted names before the sentence
 * said what to do. The sentence now counts, names at most three and folds
 * the rest, exactly as the dialog does - one rendering of one list on the
 * toast, the detail line and the dialog. Any other refusal passes through
 * untouched, so a message this function has never seen is shown as written
 * rather than silently reworded.
 */
const DONE_GATE_TAIL =
	"complete them, or pass force_done=true to close with them open";
const DONE_GATE_TAIL_COPY =
	"complete or remove the incomplete milestones, then mark it done";
/** The daemon's head, in the shape the gate raises it: count, plural, names. */
const DONE_GATE_HEAD =
	/^cannot set status 'done': (\d+) milestones? still incomplete \((.+)\) — /;

export function refusalCopy(message: string): string {
	const gate = message.match(DONE_GATE_HEAD);
	if (gate) {
		const count = Number(gate[1]);
		const names = namesFromGateSentence(gate[2]);
		const clause = names.length > 0 ? doneGateNamesClause(names) : gate[2];
		return `This can't be marked done yet: ${milestonesAre(count)} still incomplete (${clause}). Complete or remove the incomplete milestones, then mark it done.`;
	}
	if (!message.includes(DONE_GATE_TAIL)) return message;
	return message.replace(DONE_GATE_TAIL, DONE_GATE_TAIL_COPY);
}

/* ------------------------- the done-gate refusal, as a choice to make ---- */

/**
 * The daemon's machine code for "done refused: milestones still open"
 * (`detail.code` on the 422). It is its own code rather than the generic
 * `project_invalid` because the remedy is a deliberate choice - resend with
 * `force_done` - and a client can only offer that if it can tell this refusal
 * from a malformed value without reading prose.
 */
export const PROJECT_DONE_INCOMPLETE_CODE = "project_done_incomplete";

/**
 * A refused `status: done`, narrowed to what the confirm dialog needs.
 *
 * `coded` is the load-bearing field: it is true ONLY when the daemon declared
 * `project_done_incomplete`, i.e. it is new enough to accept `force_done`. A
 * refusal recognised from the sentence alone (`coded: false`) comes from an
 * older daemon that says `project_invalid`; that daemon would 422 a forced
 * retry as an unknown body key, so the caller must NOT offer the force door
 * for it - the refusal is spoken, nothing more.
 */
export type DoneGateRefusal = {
	/** How many milestones are open (the names' count, or the sentence's own). */
	count: number;
	/** The open milestones' names, store order; may be empty if none were readable. */
	names: string[];
	coded: boolean;
	/**
	 * The route's own sentence, kept for the one case where NOTHING else was
	 * readable: a coded refusal with no `incomplete` list and a message this
	 * build does not recognise. The dialog falls back to what the daemon said
	 * rather than asserting a count it does not know (agent review F4).
	 */
	message: string;
};

/**
 * Classify a failed status write as the done-gate refusal, or `null`.
 *
 * Takes the error's parts structurally (`DesktopControlError` carries `code`,
 * `message` and the body object as `detail`) so this stays a pure function the
 * node tests can execute without the transport. The CODE is the classifier;
 * the sentence is only a fallback that lets an older daemon's refusal still
 * be recognised - and still be spoken - without ever being offered a force
 * (see {@link DoneGateRefusal.coded}).
 */
export function doneGateRefusal(input: {
	code?: string | null;
	message: string;
	detail?: unknown;
}): DoneGateRefusal | null {
	const sentence = input.message.match(DONE_GATE_HEAD);
	const coded = input.code === PROJECT_DONE_INCOMPLETE_CODE;
	if (!coded && !sentence) return null;
	const declared =
		typeof input.detail === "object" &&
		input.detail !== null &&
		Array.isArray((input.detail as { incomplete?: unknown }).incomplete)
			? ((input.detail as { incomplete: unknown[] }).incomplete.filter(
					(name) => typeof name === "string",
				) as string[])
			: null;
	const names =
		declared && declared.length > 0
			? declared
			: sentence
				? namesFromGateSentence(sentence[2])
				: [];
	const count =
		names.length > 0 ? names.length : sentence ? Number(sentence[1]) : 0;
	return { count, names, coded, message: input.message };
}

/**
 * The dialog's statement of what is open.
 *
 * THE QUESTION IS THE TITLE, so this is a statement and stops at a full stop:
 * the body used to end with "Mark done anyway?" as well, asking the same thing
 * three times - title, body and button (design round 1, D6).
 *
 * A coded refusal whose list could not be read must not claim a count it does
 * not know: the daemon's own sentence stands in, and if even that is empty the
 * sentence is generic rather than the false "0 milestones are still open"
 * (agent review F4; design round 1, D6).
 */
export function doneGateSentence(refusal: DoneGateRefusal): string {
	if (refusal.count > 0) {
		const clause = doneGateNamesClause(refusal.names);
		return `${milestonesAre(refusal.count)} still open${clause ? ` (${clause})` : ""}.`;
	}
	return refusalCopy(refusal.message) || "Some milestones are still open.";
}

/**
 * The refusal as a TOAST sentence: the count-and-cap convention the dialog
 * speaks, because the daemon's own line is one 62-word sentence whose action
 * clause comes last (UX round 1, U4). Used wherever no dialog can be offered -
 * an older daemon without `projects_force_done`, or a question already on
 * screen - so the reader still gets the count, at most three names and the
 * remedy.
 */
export function doneGateToastCopy(refusal: DoneGateRefusal): string {
	if (refusal.count > 0 && refusal.names.length > 0)
		return `This can't be marked done yet: ${milestonesAre(refusal.count)} still incomplete (${doneGateNamesClause(refusal.names)}). Complete or remove the incomplete milestones, then mark it done.`;
	return (
		refusalCopy(refusal.message) ||
		"Milestones are still open on this project. Complete or remove them, then mark it done."
	);
}

/**
 * The success toast for a forced close - it SAYS the close left work open, so
 * the board's quiet "Moved to Done" is never a claim the plan was finished.
 *
 * The count comes from the PATCH answer's own row (`total - completed`), the
 * state the daemon actually wrote; `fallbackCount` (what the dialog showed) is
 * used only if the row is unreadable. `forced_done` false means nothing was
 * left open by the time the write landed (the milestones were completed
 * elsewhere meanwhile), which is an ordinary move.
 */
export function forcedCloseToastText(
	result: {
		forced_done?: boolean;
		milestones_total?: number;
		milestones_completed?: number;
	} | null,
	fallbackCount: number,
	statusLabel: string,
): string {
	if (!result || result.forced_done !== true) return `Moved to ${statusLabel}`;
	const fromRow =
		typeof result.milestones_total === "number" &&
		typeof result.milestones_completed === "number"
			? result.milestones_total - result.milestones_completed
			: fallbackCount;
	const open = fromRow > 0 ? fromRow : fallbackCount;
	return `Moved to ${statusLabel} with ${open} milestone${open === 1 ? "" : "s"} still open`;
}

/** The sentence shown when a refused move arrives with no message at all. */
export const PROJECT_NOT_MOVED_COPY =
	"The project was not moved. Try again, or open it to change its status.";
