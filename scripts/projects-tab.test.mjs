import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Projects tab's pure model, executed in Node.
 *
 * `project-model.ts` states every label, tone and derivation the tab reads as a
 * function of the wire DTOs — the `scheduled-task-model.ts` pattern — and this
 * file is what makes those functions FALSIFIABLE rather than merely commented:
 * the copy a reviewer reads in a screenshot and the copy pinned here are the
 * same code. The module under test is the REAL one; nothing is re-implemented.
 *
 * BUNDLED RATHER THAN IMPORTED (the `at-mentions.test.mjs` pattern): these are
 * TypeScript modules in the renderer tree, and the app's tsconfig does not run
 * here. The module imports its DTOs with `import type` only, so nothing of the
 * renderer or Electron crosses into the bundle.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as model from "./src/renderer/src/features/projects/project-model";',
			'export * as timeline from "./src/renderer/src/features/projects/timeline-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { model, timeline } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const {
	projectStatusMeta,
	milestoneStatusMeta,
	formatProjectDay,
	progressAge,
	progressReporterLabel,
	progressLine,
	estimateLabel,
	milestoneCountLabel,
	liveSessionsLabel,
	sessionsCountLabel,
	linkStateMeta,
	subagentChipLabel,
	todoChipLabel,
	listRowMeta,
	PROJECT_DAY_FIELD_PATTERN,
} = model;

/* ----------------------------------------------------------------- chips -- */

test("the four statuses read as the design names them", () => {
	assert.deepEqual(projectStatusMeta("active"), {
		label: "Active",
		variant: "accent",
	});
	assert.deepEqual(projectStatusMeta("paused"), {
		label: "Paused",
		variant: "neutral",
	});
	assert.deepEqual(projectStatusMeta("done"), {
		label: "Done",
		variant: "success",
	});
	assert.deepEqual(projectStatusMeta("archived"), {
		label: "Archived",
		variant: "outline",
	});
});

test("a status this build has never heard of keeps its own word, neutrally", () => {
	// A row written by a newer backend: the honest rendering is the word itself
	// — not a guessed chip, not a crash.
	assert.deepEqual(projectStatusMeta("blocked"), {
		label: "blocked",
		variant: "neutral",
	});
	assert.deepEqual(projectStatusMeta(""), {
		label: "Unknown",
		variant: "neutral",
	});
});

test("milestone chips name the server's three derived statuses", () => {
	assert.deepEqual(milestoneStatusMeta("completed"), {
		label: "Completed",
		variant: "success",
	});
	assert.deepEqual(milestoneStatusMeta("overdue"), {
		label: "Overdue",
		variant: "warning",
	});
	assert.deepEqual(milestoneStatusMeta("upcoming"), {
		label: "Upcoming",
		variant: "neutral",
	});
});

/* ------------------------------------------------------------------ dates -- */

test("an ISO day renders as a local calendar date, never a UTC-shifted one", () => {
	const now = new Date(2026, 8, 26); // 2026-09-26, local
	assert.equal(formatProjectDay("2026-09-20", "en-US", now), "Sep 20");
	// The year appears only when it is not the reader's current year.
	assert.equal(formatProjectDay("2027-01-02", "en-US", now), "Jan 2, 2027");
	// Absent and malformed values degrade to the empty string / the input.
	assert.equal(formatProjectDay(null, "en-US", now), "");
	assert.equal(formatProjectDay("", "en-US", now), "");
	assert.equal(formatProjectDay("not-a-day", "en-US", now), "not-a-day");
});

test("the date field's rule accepts a day or its own empty", () => {
	// The rule the form dialog and the milestone add row share (review round 1's
	// nit): a day, or the empty string a field carries when unset. SHAPE ONLY —
	// a calendar the month cannot name (`2026-13-01`) passes this and is refused
	// by the store, which is the division of labour the wire already states.
	assert.ok(PROJECT_DAY_FIELD_PATTERN.test("2026-10-01"));
	assert.ok(PROJECT_DAY_FIELD_PATTERN.test(""));
	assert.ok(!PROJECT_DAY_FIELD_PATTERN.test("10/01/2026"));
	assert.ok(!PROJECT_DAY_FIELD_PATTERN.test("2026-1-1"));
	assert.ok(!PROJECT_DAY_FIELD_PATTERN.test("2026-10-1"));
	assert.ok(!PROJECT_DAY_FIELD_PATTERN.test(" 2026-10-01 "));
});

/* -------------------------------------------------------------------- age -- */

test("progress age is bounded by the unit it reads best in", () => {
	const now = 1_700_000_000_000; // ms
	const at = (seconds) => now / 1000 - seconds;
	assert.equal(progressAge(at(5), now), "just now");
	assert.equal(progressAge(at(30 * 60), now), "30m");
	assert.equal(progressAge(at(2 * 3600), now), "2h");
	assert.equal(progressAge(at(3 * 86400), now), "3d");
	// Unknown is not "0m ago": an absent stamp has no age.
	assert.equal(progressAge(null, now), "");
	assert.equal(progressAge(undefined, now), "");
	// A clock that went backwards clamps rather than printing a negative age.
	assert.equal(progressAge(now / 1000 + 60, now), "just now");
});

test("the reporter half names what the value is", () => {
	assert.equal(progressReporterLabel("operator"), "the operator");
	assert.equal(progressReporterLabel("4e92693767fa"), "session 4e92693767fa");
	assert.equal(progressReporterLabel(""), "");
});

test("the progress line tells 'never reported' apart from 'stale'", () => {
	assert.equal(
		progressLine(
			{ progress: "", progress_updated_at: null, progress_reported_by: "" },
			0,
		),
		"not reported yet",
	);
	assert.equal(
		progressLine(
			{
				progress: "cutover done",
				progress_updated_at: 1_700_000_000 - 7200,
				progress_reported_by: "4e92693767fa",
			},
			1_700_000_000_000,
		),
		"reported 2h ago by session 4e92693767fa",
	);
	/*
	 * QA round 1's Q-1, read live as "reported just now ago by the operator":
	 * `progressAge` returns a complete phrase at the <60s mark, and the line
	 * appended " ago" to it unconditionally while the list cell special-cased
	 * the phrase. Both surfaces go through `progressAgePhrase` now, so this pin
	 * is the sentence a reader actually sees in the first minute.
	 */
	assert.equal(
		progressLine(
			{
				progress: "started the cutover",
				progress_updated_at: 1_700_000_000 - 5,
				progress_reported_by: "operator",
			},
			1_700_000_000_000,
		),
		"reported just now by the operator",
	);
});

/* --------------------------------------------------------------- numbers -- */

test("an estimate takes its unit's short form", () => {
	assert.equal(estimateLabel(13, "points"), "13 pt");
	assert.equal(estimateLabel(4, "days"), "4d");
	assert.equal(estimateLabel(2.5, "points"), "2.5 pt");
	assert.equal(estimateLabel(null, "points"), "");
	// A unit this build does not know gets the number alone, not an invented word.
	assert.equal(estimateLabel(7, "beans"), "7");
});

test("counts say nothing at zero and say the noun at one", () => {
	assert.equal(milestoneCountLabel(2, 5), "2/5");
	assert.equal(milestoneCountLabel(0, 0), "");
	assert.equal(liveSessionsLabel(2), "2 live");
	assert.equal(liveSessionsLabel(0), "");
	assert.equal(sessionsCountLabel(1), "1 session");
	assert.equal(sessionsCountLabel(3), "3 sessions");
	assert.equal(sessionsCountLabel(0), "");
});

/* ---------------------------------------------------------------- links -- */

test("a linked session's state has a precedence: missing, archived, runtime", () => {
	// Gone session: the one state that needs an operator decision.
	assert.deepEqual(
		linkStateMeta({
			exists: false,
			archived: false,
			runtime: { state: "live" },
		}),
		{ label: "Missing", variant: "outline" },
	);
	// Archived wins over the runtime record.
	assert.deepEqual(
		linkStateMeta({
			exists: true,
			archived: true,
			runtime: { state: "stopped" },
		}),
		{ label: "Archived", variant: "neutral" },
	);
	assert.deepEqual(
		linkStateMeta({
			exists: true,
			archived: false,
			runtime: { state: "live" },
		}),
		{ label: "Live", variant: "success" },
	);
	assert.deepEqual(
		linkStateMeta({
			exists: true,
			archived: false,
			runtime: { state: "wedged" },
		}),
		{ label: "Wedged", variant: "warning" },
	);
	assert.deepEqual(
		linkStateMeta({
			exists: true,
			archived: false,
			runtime: { state: "stopped" },
		}),
		{ label: "Stopped", variant: "neutral" },
	);
});

test("unknown subagent and todo counts render nothing, never zero", () => {
	assert.equal(subagentChipLabel(null), "");
	assert.equal(subagentChipLabel(undefined), "");
	assert.equal(todoChipLabel(null), "");
	assert.equal(
		subagentChipLabel({ running: 2, settled: 3, names: [] }),
		"2 subagents running",
	);
	// The singular, which the story fixture itself renders (design round 1,
	// D4: the detail frame read "1 subagents running").
	assert.equal(
		subagentChipLabel({ running: 1, settled: 2, names: [] }),
		"1 subagent running",
	);
	assert.equal(
		subagentChipLabel({ running: 0, settled: 1, names: [] }),
		"1 subagent",
	);
	assert.equal(
		subagentChipLabel({ running: 0, settled: 0, names: [] }),
		"0 subagents",
	);
	assert.equal(todoChipLabel({ open: 1, total: 4 }), "4 todos");
	assert.equal(todoChipLabel({ open: 0, total: 1 }), "1 todo");
});

/* ------------------------------------------------------------ list meta -- */

test("the list's meta tokens follow the row's own facts", () => {
	const base = {
		target_date: "2026-10-15",
		completed_at: null,
		estimate: 13,
		estimate_unit: "points",
		milestones_completed: 2,
		milestones_total: 5,
		live_sessions: 1,
	};
	assert.deepEqual(listRowMeta(base, "en-US"), [
		{ key: "target", text: "due Oct 15" },
		{ key: "estimate", text: "13 pt" },
		{ key: "milestones", text: "milestones 2/5" },
		{ key: "live", text: "1 live" },
	]);
	// A completed project dates itself from completion, not the target.
	assert.deepEqual(
		listRowMeta({ ...base, completed_at: "2026-10-01" }, "en-US")[0],
		{ key: "completed", text: "completed Oct 1" },
	);
	// Everything absent: no tokens rather than empty ones.
	assert.deepEqual(
		listRowMeta(
			{
				target_date: null,
				completed_at: null,
				estimate: null,
				estimate_unit: "points",
				milestones_completed: 0,
				milestones_total: 0,
				live_sessions: 0,
			},
			"en-US",
		),
		[],
	);
});

/* ------------------------------------------------------- board + timeline -- */

/*
 * The board's grouping and the timeline's arithmetic — the derivations the
 * two new views read instead of computing anything inline. These are the
 * pins for what the PR's frames show: the columns' order and membership, the
 * overdue rule and its day basis, the axis span, the bar rule, the tier
 * choice, the labels and the milestone marks.
 */

/** One listing row, with every field the derivations below read. */
const row = (id, extra = {}) => ({
	id,
	name: id,
	description: "",
	status: "active",
	tags: [],
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	milestones_completed: 0,
	milestones_total: 0,
	sessions: 0,
	live_sessions: 0,
	progress_stale: true,
	progress_updated_at: null,
	updated_at: 0,
	...extra,
});

/** One timeline item: a row plus its (detail-fetched) milestones. */
const item = (extra = {}, milestones = []) => ({
	project: row("p", extra),
	milestones,
});

/** Sunday 20 September 2026, UTC — the day every derivation is pinned to. */
const TODAY = model.parseIsoDay("2026-09-20");
const DAY = (year, month, day) => Date.UTC(year, month - 1, day);

test("a day parses in both shape and calendar", () => {
	assert.equal(model.parseIsoDay("2026-09-20"), DAY(2026, 9, 20));
	assert.equal(model.parseIsoDay(""), null);
	assert.equal(model.parseIsoDay("2026/09/20"), null);
	assert.equal(model.parseIsoDay("2026-9-20"), null);
	// A day the month cannot name is refused, not rolled over.
	assert.equal(model.parseIsoDay("2026-13-01"), null);
	assert.equal(model.parseIsoDay("2026-02-30"), null);
	assert.equal(model.parseIsoDay(null), null);
});

test("the board's columns are the fixed three, then archived when non-empty, then the unknowns", () => {
	const columns = model.boardColumns([
		row("a", { status: "archived" }),
		row("b", { status: "review" }),
		row("c", { status: "active" }),
		row("d", { status: "active" }),
	]);
	assert.deepEqual(
		columns.map((column) => column.status),
		["active", "paused", "done", "archived", "review"],
	);
	assert.deepEqual(
		columns.map((column) => column.projects.length),
		[2, 0, 0, 1, 1],
	);
	// An empty archived column is omitted (the design's rule).
	assert.deepEqual(
		model.boardColumns([row("a")]).map((column) => column.status),
		["active", "paused", "done"],
	);
});

test("overdue is a passed target on unfinished work, on the store's UTC day", () => {
	const at = (extra) =>
		model.projectOverdue(
			{ target_date: null, completed_at: null, status: "active", ...extra },
			TODAY,
		);
	assert.equal(at({ target_date: "2026-09-19" }), true);
	// The target day itself is not late, and neither is a future one.
	assert.equal(at({ target_date: "2026-09-20" }), false);
	assert.equal(at({ target_date: "2026-10-01" }), false);
	// Finished or archived work is never overdue; a completion clears it.
	assert.equal(at({ target_date: "2026-09-19", status: "done" }), false);
	assert.equal(at({ target_date: "2026-09-19", status: "archived" }), false);
	assert.equal(
		at({ target_date: "2026-09-19", completed_at: "2026-09-18" }),
		false,
	);
	// No target, or one the calendar refuses: nothing to be late about.
	assert.equal(at({}), false);
	assert.equal(at({ target_date: "soon" }), false);
});

test("the axis spans every date the items carry and always includes today", () => {
	const span = timeline.timelineSpan(
		[
			item({ start_date: "2026-09-01", target_date: "2026-10-15" }),
			item({}, [
				{
					name: "m",
					target_date: "2026-11-01",
					completed_at: null,
					status: "upcoming",
				},
			]),
		],
		TODAY,
	);
	assert.deepEqual(span, {
		startMs: DAY(2026, 9, 1),
		endMs: DAY(2026, 11, 1),
	});
	// Today extends a span that would otherwise end in the past.
	assert.deepEqual(
		timeline.timelineSpan([item({ target_date: "2026-08-01" })], TODAY),
		{ startMs: DAY(2026, 8, 1), endMs: TODAY },
	);
	// Nothing dated at all: no axis, and the no-dates section is the answer.
	assert.equal(timeline.timelineSpan([item()], TODAY), null);
});

test("a milestone date alone dates a project; nothing dated goes to the trailing section", () => {
	const dated = {
		project: row("dated"),
		milestones: [
			{
				name: "m",
				target_date: "2026-10-01",
				completed_at: null,
				status: "upcoming",
			},
		],
	};
	const undated = { project: row("undated"), milestones: [] };
	const sections = timeline.timelineSections([dated, undated]);
	assert.deepEqual(
		sections.dated.map((entry) => entry.project.id),
		["dated"],
	);
	assert.deepEqual(
		sections.undated.map((entry) => entry.project.id),
		["undated"],
	);
});

test("a bar runs start→target, and a done project to the day it finished", () => {
	assert.deepEqual(
		timeline.timelineBar(
			item({ start_date: "2026-09-01", target_date: "2026-09-30" }),
		),
		{ fromMs: DAY(2026, 9, 1), toMs: DAY(2026, 9, 30) },
	);
	assert.equal(
		timeline.timelineBar(
			item({
				status: "done",
				start_date: "2026-09-01",
				target_date: "2026-09-30",
				completed_at: "2026-09-12",
			}),
		).toMs,
		DAY(2026, 9, 12),
	);
	// A done project with no completion day falls back to its target.
	assert.equal(
		timeline.timelineBar(
			item({
				status: "done",
				start_date: "2026-09-01",
				target_date: "2026-09-30",
			}),
		).toMs,
		DAY(2026, 9, 30),
	);
	// No start: the target alone is a one-day bar, not a fabricated span.
	assert.deepEqual(timeline.timelineBar(item({ target_date: "2026-09-30" })), {
		fromMs: DAY(2026, 9, 30),
		toMs: DAY(2026, 9, 30),
	});
	// Reversed inputs still read left-to-right.
	assert.equal(
		timeline.timelineBar(
			item({ start_date: "2026-09-30", target_date: "2026-09-01" }),
		).fromMs,
		DAY(2026, 9, 1),
	);
	assert.equal(timeline.timelineBar(item()), null);
});

test("the auto tier is the finest that fits, and never below the vocabulary", () => {
	assert.equal(timeline.autoTimelineTier(10, 1000), "day");
	assert.equal(timeline.autoTimelineTier(60, 1000), "week");
	assert.equal(timeline.autoTimelineTier(200, 1000), "month");
	assert.equal(timeline.autoTimelineTier(400, 1000), "quarter");
	// Even the coarsest overflows: still quarter — the pane scrolls rather than
	// dropping to a tier below the vocabulary.
	assert.equal(timeline.autoTimelineTier(5000, 1000), "quarter");
});

test("axis labels sit at unit starts, with a year cue when the year turns", () => {
	const months = timeline.timelineTicks(
		DAY(2026, 9, 20),
		DAY(2027, 2, 10),
		"month",
	);
	assert.deepEqual(
		months.map((tick) => tick.label),
		["Sep", "Oct", "Nov", "Dec", "Jan '27", "Feb"],
	);
	const quarters = timeline.timelineTicks(
		DAY(2026, 1, 1),
		DAY(2026, 12, 31),
		"quarter",
	);
	assert.deepEqual(
		quarters.map((tick) => tick.label),
		["Q1", "Q2", "Q3", "Q4"],
	);
	const days = timeline.timelineTicks(
		DAY(2026, 9, 28),
		DAY(2026, 10, 2),
		"day",
	);
	assert.deepEqual(
		days.map((tick) => [tick.label, tick.major]),
		[
			["28", false],
			["29", false],
			["30", false],
			// The month's name, not "Oct 1": at 24px/day the day number would
			// collide with the next label (measured in the first capture).
			["Oct", true],
			// And the day beside the month stands down (the TUI's rule for a
			// label that would collide): "Sep" + "2" reads as one token.
			["", false],
		],
	);
	// The week tier names the month the week TURNS OVER, not every Monday.
	const weeks = timeline.timelineTicks(
		DAY(2026, 9, 28),
		DAY(2026, 10, 12),
		"week",
	);
	assert.deepEqual(
		weeks.map((tick) => [tick.label, tick.major]),
		[
			["28", false],
			["Oct 5", true],
			["12", false],
		],
	);
});

test("milestone marks carry the store's state and only dated milestones", () => {
	const marks = timeline.timelineMarks(
		item({}, [
			{
				name: "done",
				target_date: "2026-09-01",
				completed_at: "2026-09-01",
				status: "completed",
			},
			{
				name: "late",
				target_date: "2026-09-15",
				completed_at: null,
				status: "overdue",
			},
			{
				name: "soon",
				target_date: "2026-10-01",
				completed_at: null,
				status: "upcoming",
			},
			{
				name: "undated",
				target_date: null,
				completed_at: null,
				status: "upcoming",
			},
		]),
	);
	assert.deepEqual(
		marks.map((mark) => [mark.name, mark.status]),
		[
			["done", "completed"],
			["late", "overdue"],
			["soon", "upcoming"],
		],
	);
});
