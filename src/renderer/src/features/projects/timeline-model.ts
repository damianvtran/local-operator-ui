/**
 * The Timeline view's model: the axis, the project bars and the milestone
 * marks — PURE, no React, no DOM, no chart library.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `project-model.ts`: the design's own
 * split (§V2.B.1) — the list's and board's copy is `project-model.ts`, and the
 * schedule arithmetic is here, so the axis math is node-tested against plain
 * numbers rather than guessed from a rendered frame. The component above it is
 * a painter.
 *
 * PORTED FROM THE TUI'S PROJECTION, NOT RE-DERIVED (operator: "one derivation,
 * one surface difference"). `local_operator/tui/projects_render.py` is the
 * reference: `timeline_span` (today always included, so the today marker
 * exists on every timeline), the dated/undated split (a project with no dates
 * lands in the trailing "no dates" section rather than on a fabricated
 * schedule), the bar rule (begin = `start_date` or the end day; end =
 * `completed_at` for a done project with one, else `target_date`), and the
 * auto-tier rule ("the finest tier that fits, else the coarsest"). What
 * differs is the UNIT: the TUI paints character cells at three tiers; this
 * renders a pixel axis at four (day/week/month/quarter, the desktop spec), so
 * the arithmetic below states the same facts in days and pixels.
 *
 * THE DAY BASIS IS UTC, and that is a correctness rule rather than a taste:
 * the store derives every milestone's `overdue` from `_utc_today`, so an
 * `overdue` mark drawn against a LOCAL day would disagree with the server's
 * own status for the hours the two dates differ. The TUI's `today_iso` states
 * the same basis for the same reason.
 *
 * HONEST DEGRADATION: a missing or unparseable date reads as absent, never as
 * "today"; a project with nothing dated is reported as undated rather than
 * drawn at a default position.
 */

import type {
	DesktopMilestoneStatus,
	DesktopProject,
	DesktopProjectMilestone,
} from "../../../../shared/desktop-control-contract";
import { DAY_MS, parseIsoDay } from "./project-model";

export type TimelineTier = "day" | "week" | "month" | "quarter";

/**
 * The four tiers, finest first. The auto-fit walks this list and takes the
 * first that fits; `+` moves toward `day`, `-` toward `quarter` (zoom is level
 * of detail, the org-chart rule applied to time).
 */
export const TIMELINE_TIERS: readonly TimelineTier[] = [
	"day",
	"week",
	"month",
	"quarter",
];

/**
 * px per day at each tier. Measured off the rendered axis rather than guessed:
 * at `day`, one day's column needs room for a two-digit label and its tick
 * (24px); `week` keeps a legible seven-day step at 9px/day; `month` holds
 * month labels apart at 3px/day; `quarter` compresses a year into ~365px so a
 * two-year planning span still fits a pane.
 */
export const TIMELINE_TIER_PX_PER_DAY: Record<TimelineTier, number> = {
	day: 24,
	week: 9,
	month: 3,
	quarter: 1,
};

/** The UTC day `nowMs` sits in — the store's own basis (see the header). */
export function todayUtcMs(nowMs: number): number {
	const at = new Date(nowMs);
	return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/** Day offset of `dayMs` from the axis origin. Negative is left of the axis. */
export function dayOffset(startMs: number, dayMs: number): number {
	return Math.round((dayMs - startMs) / DAY_MS);
}

/** Whole days a span covers, both ends inclusive. */
export function spanDays(startMs: number, endMs: number): number {
	return dayOffset(startMs, endMs) + 1;
}

/**
 * The finest tier whose whole axis fits `budgetPx`, else the coarsest.
 *
 * "Auto tier zoom-out to fit" (the design; the TUI's `auto_timeline_tier` in
 * pixels): starting from `day` and coarsening until the axis fits means a
 * short span is drawn at day resolution and a multi-year one falls to
 * quarters, and a budget no tier can meet still returns the coarsest — the
 * pane then scrolls horizontally rather than dropping below the vocabulary.
 */
export function autoTimelineTier(
	dayCount: number,
	budgetPx: number,
): TimelineTier {
	for (const tier of TIMELINE_TIERS) {
		if (dayCount * TIMELINE_TIER_PX_PER_DAY[tier] <= budgetPx) return tier;
	}
	return TIMELINE_TIERS[TIMELINE_TIERS.length - 1];
}

/**
 * One timeline row's inputs: the listing row plus the project's milestones.
 *
 * The milestones come from `projects.get` (the listing carries only their
 * counts), fetched per project when the timeline has dates to place them on;
 * an empty array is the honest "not loaded yet" state — no marks, no invented
 * ones.
 */
export type TimelineItem = {
	project: DesktopProject;
	milestones: DesktopProjectMilestone[];
};

/** Whether this item has anything the axis can place. */
export function isDated(item: TimelineItem): boolean {
	const { project } = item;
	if (project.start_date || project.target_date || project.completed_at)
		return true;
	return item.milestones.some((milestone) => Boolean(milestone.target_date));
}

/**
 * The axis range over the dated items, or `null` when none is dated.
 *
 * Today is always included (the TUI's rule): a schedule whose entire point is
 * "where you are in time" must show now, and a span that ended last month
 * still ends at today's marker rather than off-screen.
 */
export function timelineSpan(
	items: TimelineItem[],
	todayMs: number,
): { startMs: number; endMs: number } | null {
	const days: number[] = [todayMs];
	for (const item of items) {
		for (const value of [
			item.project.start_date,
			item.project.target_date,
			item.project.completed_at,
		]) {
			const day = parseIsoDay(value);
			if (day !== null) days.push(day);
		}
		for (const milestone of item.milestones) {
			const day = parseIsoDay(milestone.target_date);
			if (day !== null) days.push(day);
		}
	}
	if (days.length === 1) return null;
	return { startMs: Math.min(...days), endMs: Math.max(...days) };
}

/**
 * The dated/undated split the renderer draws — the "no dates" section's own
 * derivation, shared with the header counts so the two cannot disagree.
 */
export function timelineSections(items: TimelineItem[]): {
	dated: TimelineItem[];
	undated: TimelineItem[];
} {
	const dated: TimelineItem[] = [];
	const undated: TimelineItem[] = [];
	for (const item of items) (isDated(item) ? dated : undated).push(item);
	return { dated, undated };
}

/**
 * A project's bar, or `null` when there is nothing to span.
 *
 * THE RULE IS THE TUI'S, character for character: `begin` is `start_date` or
 * the end day, `finish` is the end day or `start_date` — and the end day is
 * `completed_at` for a DONE project that carries one, else `target_date`. A
 * done project with no completion date falls back to its target rather than
 * drawing to today, which would claim work the store never recorded.
 */
export function timelineBar(
	item: TimelineItem,
): { fromMs: number; toMs: number } | null {
	const { project } = item;
	const startDay = parseIsoDay(project.start_date);
	const targetDay = parseIsoDay(project.target_date);
	const completedDay = parseIsoDay(project.completed_at);
	const endDay =
		project.status === "done" && completedDay !== null
			? completedDay
			: targetDay;
	const begin = startDay ?? endDay;
	const finish = endDay ?? startDay;
	if (begin === null || finish === null) return null;
	return { fromMs: Math.min(begin, finish), toMs: Math.max(begin, finish) };
}

/**
 * The milestone marks, at their `target_date`, in the store's own states.
 *
 * The state is NOT re-derived: `status` arrives from the server (the store's
 * `milestone_state`, UTC-based), and the UI's failure mode would be a mark
 * disagreeing with the milestone list beside it.
 */
export function timelineMarks(
	item: TimelineItem,
): { name: string; dayMs: number; status: DesktopMilestoneStatus }[] {
	const marks: {
		name: string;
		dayMs: number;
		status: DesktopMilestoneStatus;
	}[] = [];
	for (const milestone of item.milestones) {
		const day = parseIsoDay(milestone.target_date);
		if (day === null) continue;
		marks.push({
			name: milestone.name,
			dayMs: day,
			status: milestone.status,
		});
	}
	return marks;
}

/** One axis tick: where it sits, and what it says. */
export type TimelineTick = {
	dayMs: number;
	label: string;
	/** A coarser label (a month over its days), drawn as the major tick. */
	major: boolean;
};

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function utcParts(ms: number) {
	const at = new Date(ms);
	return {
		year: at.getUTCFullYear(),
		month: at.getUTCMonth() + 1,
		day: at.getUTCDate(),
		weekday: at.getUTCDay(),
	};
}

/** The first day of the month containing `ms`. */
function monthStart(ms: number): number {
	const { year, month } = utcParts(ms);
	return Date.UTC(year, month - 1, 1);
}

/** The next month's first day. */
function nextMonth(ms: number): number {
	const { year, month } = utcParts(ms);
	return month === 12 ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, month, 1);
}

/** The first day of the quarter containing `ms`. */
function quarterStart(ms: number): number {
	const { year, month } = utcParts(ms);
	return Date.UTC(year, Math.floor((month - 1) / 3) * 3, 1);
}

/** The next quarter's first day. */
function nextQuarter(ms: number): number {
	const { year, month } = utcParts(ms);
	const quarter = Math.floor((month - 1) / 3);
	return quarter === 3
		? Date.UTC(year + 1, 0, 1)
		: Date.UTC(year, quarter * 3 + 3, 1);
}

/** The Monday of the week containing `ms` (the TUI's week alignment). */
function weekStart(ms: number): number {
	const { weekday } = utcParts(ms);
	return ms - ((weekday + 6) % 7) * DAY_MS;
}

/**
 * The air a unit label needs before the next one: its own text plus a blank
 * gap, in px. `Jul` measures 16.5px at `text-meta` (read off the QA round 1
 * frame), so ~26px keeps two labels off each other at every size the sweep
 * captures; below that the two read as one token (`JuAug`).
 */
const UNIT_LABEL_MIN_GAP_PX = 26;

/**
 * The axis row: one label per unit start, per tier.
 *
 * A YEAR CHANGE CARRIES A TWO-DIGIT CUE (`Jan '27`) — an 18-month span reads
 * `Jan … Jan` with nothing to tell them apart, the TUI's own D6 fix. Labels
 * are emitted at unit starts (weeks aligned to Monday), and `major` marks the
 * coarser boundary (a month start inside the day and week tiers), which the
 * renderer treats as a stronger tick.
 */
export function timelineTicks(
	startMs: number,
	endMs: number,
	tier: TimelineTier,
): TimelineTick[] {
	const ticks: TimelineTick[] = [];
	const push = (dayMs: number, label: string, major: boolean) => {
		if (dayMs < startMs || dayMs > endMs) return;
		ticks.push({ dayMs, label, major });
	};
	if (tier === "day") {
		let afterMonthStart = false;
		for (let day = startMs; day <= endMs; day += DAY_MS) {
			const { day: dayOfMonth, month } = utcParts(day);
			if (dayOfMonth === 1) {
				// The month's own name, NOT "Sep 1": at 24px/day the longer form
				// runs into the next day's label (measured in the first capture).
				push(day, MONTHS[month - 1], true);
				afterMonthStart = true;
			} else if (afterMonthStart) {
				// AND THE DAY BESIDE IT STANDS DOWN - the TUI's rule for a label
				// that would collide ("a label is placed only when it fits with a
				// blank cell beside it"): "Sep" + "2" at 24px/day reads as one
				// token, measured in the second capture's overdue frame.
				push(day, "", false);
				afterMonthStart = false;
			} else {
				push(day, String(dayOfMonth), false);
			}
		}
		return ticks;
	}
	if (tier === "week") {
		// A label per WEEK: its Monday's day-of-month, and a month start is the
		// major tick (the week tier's labels would collide with per-day text).
		for (let day = weekStart(startMs); day <= endMs; day += 7 * DAY_MS) {
			if (day < startMs) continue;
			const { day: dayOfMonth, month } = utcParts(day);
			// The month turns over inside this week exactly when the PREVIOUS
			// Monday sat in a different month (the TUI's rule); labelling by the
			// bare day number only would leave a months-long axis with nothing
			// naming a month at all (measured in the first capture).
			const monthTurn = utcParts(day - 7 * DAY_MS).month !== month;
			if (monthTurn) {
				push(day, `${MONTHS[month - 1]} ${dayOfMonth}`, true);
			} else {
				push(day, String(dayOfMonth), false);
			}
		}
		return ticks;
	}
	/*
	 * The month and quarter tiers label the UNIT CONTAINING THE SPAN START at
	 * offset 0 (the TUI's `labels[0] = unit_label(start)`): a span that begins
	 * mid-month still opens with its month named, which a loop over month
	 * starts alone would drop as "before the axis".
	 */
	const unitStart = tier === "month" ? monthStart : quarterStart;
	const nextUnit = tier === "month" ? nextMonth : nextQuarter;
	const unitLabel = (day: number) => {
		const { year, month } = utcParts(day);
		if (tier === "month") {
			return month === 1 && year !== utcParts(startMs).year
				? `${MONTHS[0]} '${String(year % 100).padStart(2, "0")}`
				: MONTHS[month - 1];
		}
		const quarter = Math.floor((month - 1) / 3) + 1;
		return quarter === 1 && year !== utcParts(startMs).year
			? `Q1 '${String(year % 100).padStart(2, "0")}`
			: `Q${quarter}`;
	};
	push(startMs, unitLabel(unitStart(startMs)), true);
	/*
	 * AND THE NEXT UNIT'S LABEL STANDS DOWN WHEN IT WOULD COLLIDE - the day
	 * tier's own rule, at unit scale: a span that starts within ~4 days of a
	 * month boundary put `Jul` and `Aug` 9px apart (3px/day x 3 days) and the
	 * axis read `JuAug` (QA round 1, Q-1). The walk keeps emitting labels and
	 * tests each against the last one that was ACTUALLY PLACED, so a long
	 * stretch of crowded boundaries drops labels rather than stacking them,
	 * and every emitted label is still a unit start.
	 */
	const minGapDays = Math.ceil(
		UNIT_LABEL_MIN_GAP_PX / TIMELINE_TIER_PX_PER_DAY[tier],
	);
	let lastEmitted = startMs;
	for (
		let day = nextUnit(unitStart(startMs));
		day <= endMs;
		day = nextUnit(day)
	) {
		if (dayOffset(lastEmitted, day) < minGapDays) continue;
		push(day, unitLabel(day), true);
		lastEmitted = day;
	}
	return ticks;
}
