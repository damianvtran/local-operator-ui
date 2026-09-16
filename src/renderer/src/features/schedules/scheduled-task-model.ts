import {
	type WakeRow,
	deriveWakes,
	formatWakeCadence,
	formatWakeDue,
} from "@features/chat/components/run-details/run-detail-model";
import type { ScheduleResponse } from "@shared/api/local-operator";
/**
 * The Schedules page's own model: what a row is, what it says, and what the
 * create dialog offers.
 *
 * Pure by construction, like the run pane's `run-detail-model.ts` and for the
 * same reason: the labels a page draws are the thing review argues about, so
 * they are derived in one place that a story or a test can drive without a
 * renderer, and the components only place them.
 *
 * ## One vocabulary, borrowed rather than re-invented
 *
 * `formatWakeDue`, `formatWakeDuration` and `formatWakeCadence` come from
 * `features/chat/components/run-details/run-detail-model.ts` - the module the
 * run pane's Wakes section already draws with. The page and the pane are on
 * screen together (the pane is one press away in the same window), and
 * `docs/composer-wakes.md` section 3 refuses two words for one object across
 * two surfaces that can be seen at once. A second formatter here would be that
 * defect with a shorter name, so the page feeds the same deriver the same
 * field names and renders its answer.
 */
import type {
	DesktopWakeEntry,
	DesktopWakeScheduleRow,
} from "../../../../shared/desktop-contract";

/**
 * Wake lines one conversation shows before its `Show N more wakes` control.
 *
 * Three, not the pane's sixteen: a row here is a conversation whose height
 * compounds (a 16-wake conversation would be a 300px block in a list of
 * conversations), and unlike the pane this surface CAN put a shed line back
 * with a control of its own. The cap is per conversation and the panel scrolls,
 * so nothing is unreachable.
 */
export const WAKE_LINE_CAP = 3;

/**
 * The most wakes one conversation may hold, from the backend's own bound
 * (`MAX_WAKE_SCHEDULES = 16`).
 *
 * Stated here because the dialog turns it into a user-facing fact: at the
 * ceiling the create is refused INLINE with the reason, rather than by a 422
 * after the press. The agent-tool path enforces the bound and the CLI does not,
 * so a session can legitimately hold more than this - the CEILING is quoted for
 * what the dialog may create, and the page renders whatever the listing sends.
 */
export const MAX_WAKE_SCHEDULES = 16;

/** The smallest repeat, from `MIN_WAKE_INTERVAL_MS`: a wake starts a full turn. */
export const MIN_WAKE_INTERVAL_MS = 60_000;

const UNIT_MS: Record<ScheduleResponse["unit"], number> = {
	minutes: 60_000,
	hours: 3_600_000,
	days: 86_400_000,
};

/** One wake line, plus the two facts the PAGE adds to the pane's row. */
export type WakeLine = WakeRow & {
	/**
	 * `Ran 3 times` for a wake that has fired, or "" for one that has not.
	 *
	 * The page's own clause, and this surface is why it exists: the pane watches
	 * a session mid-turn, where a fired one-shot has left a delivery row in the
	 * transcript right below. A page about what is ARMED, read days later, has
	 * no such neighbour - without this, a recurring wake that has fired every
	 * morning for a week reads exactly like one that was created a minute ago.
	 */
	ranLabel: string;
};

/**
 * One conversation with wakes, as the page renders it.
 *
 * The row's IDENTITY is the conversation, which is the change this page exists
 * for: the old row was a rule plus an agent name, and there was nowhere on the
 * page to go and see what the rule did. `sessionId` is what the row opens.
 */
export type ScheduledTaskRow = {
	sessionId: string;
	/** Never empty: a nameless session falls back to its id and directory. */
	name: string;
	cwd: string;
	/**
	 * `dormant` (the session was stopped) or `ghost` (its transcript is gone).
	 *
	 * Both mean the same thing to a reader - the stored instant will not fire -
	 * and both are why the row drops its due label and states the fact instead.
	 */
	parked: boolean;
	ghost: boolean;
	/** The soonest due instant across the wakes, or `null` when none is knowable. */
	nextDueAt: number | null;
	wakes: WakeLine[];
	/** The slice the row draws, and how many lines it hid. */
	visibleWakes: WakeLine[];
	hiddenWakes: number;
	/** The row head's trailing clause: the count, the next fire, or parked. */
	meta: string;
};

/**
 * The count clause on a row head: `1 wake` / `2 wakes`.
 *
 * Deliberately not the composer's `wakeClause` (`1 wake armed`): that one is a
 * TALLY among counts of live work on the composer (`3 to-dos open`, `2
 * subagents running`), where the condition is the point. Here the count is a
 * row's subtitle over the lines that ARE the wakes, so `armed` would restate
 * what the list below it shows.
 */
export const wakeCountClause = (count: number): string =>
	count === 1 ? "1 wake" : `${count} wakes`;

/** The parked clause, which replaces BOTH the due label and the count. */
export const PARKED_CLAUSE = "Parked — wakes resume when you open it";

/**
 * The prompt, flattened to one clause for a toast or a confirm.
 *
 * The designer asked the toast to name the conversation (`Scheduled task
 * created — Read my unread email`) so the auto-derived title is not a surprise
 * later, and the cancel confirm to quote what will not fire again. Both need the
 * SAME head - a user who reads one and then the other is comparing them - so it
 * is derived once, here.
 *
 * Clipped at a word boundary rather than mid-word, and the clipped form drops
 * its own sentence punctuation: `Clean up the invoices sheet…` reads as a label,
 * `Clean up the invoices sheet.…` reads as a mistake.
 */
export const wakePromptHead = (message: string, max = 48): string => {
	const flat = message.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat.replace(/[.!?…]+$/g, "").trimEnd();
	const cut = flat.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	return `${cut.slice(0, lastSpace > 24 ? lastSpace : max).trimEnd()}…`;
};

/**
 * A conversation's display name, never empty.
 *
 * The wake index carries no name (it is a derived projection of the
 * transcript), so the backend resolves one through `resume.session_name` - a
 * bounded read that can legitimately come back empty. The fallback is the id
 * plus the directory's own name, so a nameless row is still addressable and
 * still tells the reader where it runs.
 */
export const wakeRowName = (
	name: string,
	sessionId: string,
	cwd: string,
): string => {
	const trimmed = name.trim();
	if (trimmed) return trimmed;
	const directory = cwd.split("/").filter(Boolean).pop() ?? cwd;
	return directory
		? `${sessionId.slice(0, 8)} · ${directory}`
		: sessionId.slice(0, 8);
};

/** One listing row's wakes as the pane's own row type, soonest first. */
const wakeLines = (
	schedules: DesktopWakeScheduleRow[],
	nowMs: number,
): WakeLine[] =>
	deriveWakes(schedules, nowMs).map((row) => {
		/*
		 * `Ran N times` is derived from `fired_count`, which this wire carries and
		 * the pane's does not. A ONE-SHOT that has fired is absent from the
		 * listing altogether (the scheduler retires it), so a fired count here
		 * always belongs to a recurrence - which is what makes the clause honest
		 * without a second condition.
		 */
		const fired = schedules.find(
			(schedule) => schedule.id === row.id,
		)?.fired_count;
		return {
			...row,
			ranLabel:
				typeof fired === "number" && fired > 0
					? `Ran ${fired} time${fired === 1 ? "" : "s"}`
					: "",
		};
	});

/**
 * One listing entry as a page row, with its head clause already decided.
 *
 * Ordering is the pane's rule lifted from the schedule to the conversation:
 * soonest `next_due_at` first, rows with no future instant last, ties by name.
 * The page's first row is therefore the same answer the pane's first row gives,
 * which is what lets the two surfaces be read together.
 */
export const toScheduledTaskRow = (
	entry: DesktopWakeEntry,
	nowMs: number,
): ScheduledTaskRow => {
	const parked = entry.dormant === true || entry.ghost === true;
	/*
	 * A parked row drops the INSTANT everywhere on itself, including on its wake
	 * lines: the stored `next_due_at` will not fire (the supervisor skips a
	 * stopped session) and it is not even the instant that will fire later, since
	 * opening the conversation re-arms anything overdue to `now + LOAD_GRACE_MS`.
	 * Printing it would be wrong twice over, in the one state where the reader is
	 * deciding whether the schedule is still real. The prompt and the cadence stay
	 * - they are what the work IS, and they are still true.
	 */
	const wakes = wakeLines(entry.schedules ?? [], nowMs).map((row) =>
		parked ? { ...row, dueLabel: "" } : row,
	);
	const visible = wakes.slice(0, WAKE_LINE_CAP);
	const nextDueAt =
		entry.next_due_at ?? wakes.find((row) => row.nextDueAt)?.nextDueAt ?? null;
	const head = parked
		? PARKED_CLAUSE
		: wakes.length === 0
			? ""
			: wakes[0].dueLabel
				? `${wakeCountClause(wakes.length)} · next ${wakes[0].dueLabel}`
				: wakeCountClause(wakes.length);
	return {
		sessionId: entry.session_id,
		name: wakeRowName(entry.name, entry.session_id, entry.cwd),
		cwd: entry.cwd,
		parked,
		ghost: entry.ghost === true,
		nextDueAt,
		wakes,
		visibleWakes: visible,
		hiddenWakes: wakes.length - visible.length,
		meta: head,
	};
};

/** Every row the page draws, in the order it draws them. */
export const scheduledTaskRows = (
	entries: DesktopWakeEntry[] | undefined,
	nowMs: number,
): ScheduledTaskRow[] =>
	(entries ?? [])
		.map((entry) => toScheduledTaskRow(entry, nowMs))
		/*
		 * An entry with no wakes is not a row: the listing is built from the wake
		 * index, so this is a store whose last wake just retired, and the page
		 * must drop it in the same frame it learns (the pane's "absence is not a
		 * state" rule, one surface over).
		 */
		.filter((row) => row.wakes.length > 0)
		.sort(
			(a, b) =>
				(a.nextDueAt ?? Number.POSITIVE_INFINITY) -
					(b.nextDueAt ?? Number.POSITIVE_INFINITY) ||
				a.name.localeCompare(b.name),
		);

/**
 * One legacy schedule's cadence, through the wake vocabulary.
 *
 * The fenced group renders on the page beside the wake rows, and two cadence
 * grammars in one panel is how a page reads as two products: `every 15 minutes
 * at 7 minutes past, from Sunday, March 15` beside `every 15m` is a second
 * product's sentence. So the same `every <duration>` / `once` vocabulary is
 * used, and the bounds a legacy row has and a wake does not are named as
 * clauses in the same voice rather than folded into the recurrence sentence.
 *
 * `unit` is `minutes | hours | days` (the legacy model has no weeks), and
 * `one_time` means the row fires once at `start_time_utc`.
 */
export const legacyScheduleCadence = (
	schedule: ScheduleResponse,
	nowMs: number,
): string => {
	/* `Date.parse` answers NaN for an unparseable stamp, and a NaN instant would
	   render as `Invalid Date` in the label: both bounds are therefore read once,
	   as `number | null`, and a bound that cannot be read reads as ABSENT rather
	   than as a broken label. */
	const readBound = (value: string | null | undefined): number | null => {
		const parsed = value ? Date.parse(value) : Number.NaN;
		return Number.isFinite(parsed) ? parsed : null;
	};
	const start = readBound(schedule.start_time_utc);
	const end = readBound(schedule.end_time_utc);
	if (schedule.one_time) {
		return start === null ? "once" : `once · ${formatWakeDue(start, nowMs)}`;
	}
	const cadence = formatWakeCadence(
		schedule.interval * UNIT_MS[schedule.unit],
		null,
	);
	if (end !== null) return `${cadence} · until ${formatWakeDue(end, nowMs)}`;
	if (start !== null) return `${cadence} · from ${formatWakeDue(start, nowMs)}`;
	return cadence;
};

/** A repeat the dialog built, as the tool's own duration string (`2h`, `1w`). */
export const repeatEveryString = (
	count: number,
	unit: "minutes" | "hours" | "days" | "weeks",
): string => `${count}${unit.charAt(0)}`;
