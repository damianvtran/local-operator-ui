import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
	boardProgressText,
	sessionsTriggerLabel,
	linkStateMeta,
	subagentChipLabel,
	todoChipLabel,
	listRowMeta,
	PROJECT_DAY_FIELD_PATTERN,
	projectDisplayName,
	managedByLine,
	sessionLabel,
	updatesNewestFirst,
	updatesCountLabel,
	updateDayKey,
	updateDayLabel,
	updateAgePhrase,
	updateMetaTokens,
	groupUpdatesByDay,
	attachmentSizeText,
	milestoneSummaryLabel,
	todosAggregate,
	todosCountLabel,
	defaultSendTarget,
	startSessionPrompt,
	sessionTargetLabel,
	refusalCopy,
	NO_TEAM_LABEL,
	projectTeamName,
	groupByTeam,
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

test("the board's columns are the five lifecycle phases, then the non-empty side states, then the unknowns", () => {
	/*
	 * THE FIXED SET IS THE PIPELINE (planning -> active -> qa -> validation ->
	 * done); `paused` and `archived` are SIDE states that join when they hold
	 * rows, in that order, and an out-of-vocabulary status keeps its own
	 * column after them so a newer backend's row is never dropped.
	 */
	const columns = model.boardColumns([
		row("a", { status: "archived" }),
		row("b", { status: "review" }),
		row("c", { status: "active" }),
		row("d", { status: "active" }),
		row("e", { status: "planning" }),
		row("f", { status: "qa" }),
		row("g", { status: "validation" }),
		row("h", { status: "paused" }),
	]);
	assert.deepEqual(
		columns.map((column) => column.status),
		[
			"planning",
			"active",
			"qa",
			"validation",
			"done",
			"paused",
			"archived",
			"review",
		],
	);
	assert.deepEqual(
		columns.map((column) => column.projects.length),
		[1, 2, 1, 1, 0, 1, 1, 1],
	);
	// Empty side columns are omitted (the design's rule) while every phase shows.
	assert.deepEqual(
		model.boardColumns([row("a")]).map((column) => column.status),
		["planning", "active", "qa", "validation", "done"],
	);
});

test("a stored column order ranks the columns present, and the rest append by the derivation's own rules", () => {
	const rows = [
		row("a", { status: "archived" }),
		row("b", { status: "review" }),
		row("c", { status: "active" }),
		row("d", { status: "paused" }),
	];
	/*
	 * THE MERGE RULE: ranked columns first in their stored order, everything
	 * else after them in the derivation's own order (phases -> populated side
	 * states -> unknowns). Present here: the five phases, paused, archived,
	 * review.
	 */
	assert.deepEqual(
		model
			.boardColumns(rows, ["done", "validation", "qa", "active", "planning"])
			.map((column) => column.status),
		[
			"done",
			"validation",
			"qa",
			"active",
			"planning",
			"paused",
			"archived",
			"review",
		],
	);
	/* A partial order is honoured where it speaks and appends where it does not. */
	assert.deepEqual(
		model.boardColumns(rows, ["qa", "planning"]).map((column) => column.status),
		[
			"qa",
			"planning",
			"active",
			"validation",
			"done",
			"paused",
			"archived",
			"review",
		],
	);
	/* `[]` and the identity order both mean the lifecycle default. */
	assert.deepEqual(
		model.boardColumns(rows).map((column) => column.status),
		model.boardColumns(rows, []).map((column) => column.status),
	);
	assert.deepEqual(
		model
			.boardColumns(rows, ["planning", "active", "qa", "validation", "done"])
			.map((column) => column.status),
		[
			"planning",
			"active",
			"qa",
			"validation",
			"done",
			"paused",
			"archived",
			"review",
		],
	);
});

test("a stored status that holds no column ranks nothing and resurrects nothing", () => {
	/*
	 * `archived` is IN the stored order but has no rows this session: it keeps
	 * no rank and no column, and the ranks that do speak still apply. The slot
	 * is not forgotten — the next reorder writes the order of the columns the
	 * user actually saw.
	 */
	assert.deepEqual(
		model
			.boardColumns([row("a")], ["archived", "done", "planning"])
			.map((column) => column.status),
		["done", "planning", "active", "qa", "validation"],
	);
});

test("one column's move re-inserts it at the index it lands on", () => {
	const order = ["planning", "active", "qa", "validation", "done"];
	/* One place LEFT is `from - 1`; one place RIGHT is `from + 1` (not a swap). */
	assert.deepEqual(model.reorderColumnOrder(order, "qa", 1), [
		"planning",
		"qa",
		"active",
		"validation",
		"done",
	]);
	assert.deepEqual(model.reorderColumnOrder(order, "active", 2), [
		"planning",
		"qa",
		"active",
		"validation",
		"done",
	]);
	assert.deepEqual(model.reorderColumnOrder(order, "qa", 0), [
		"qa",
		"planning",
		"active",
		"validation",
		"done",
	]);
	assert.deepEqual(model.reorderColumnOrder(order, "planning", 4), [
		"active",
		"qa",
		"validation",
		"done",
		"planning",
	]);
	/* The ends clamp rather than inventing positions. */
	assert.deepEqual(model.reorderColumnOrder(order, "done", 99), order);
	assert.deepEqual(model.reorderColumnOrder(order, "planning", -3), order);
	/* The input is not the output's costume: it is not mutated. */
	const before = [...order];
	model.reorderColumnOrder(order, "qa", 0);
	assert.deepEqual(order, before);
});

test("the column order's store is guarded, validated and deduped", () => {
	const key = model.PROJECTS_BOARD_ORDER_STORAGE_KEY;
	const original = globalThis.localStorage;
	const store = new Map();
	globalThis.localStorage = {
		getItem: (name) => store.get(name) ?? null,
		setItem: (name, value) => store.set(name, value),
		removeItem: (name) => store.delete(name),
	};
	try {
		/*
		 * THE STORE'S OWN PARSING, asked before anything writes: with no session
		 * copy in play a read is the store's answer alone. (Once a write lands,
		 * the session copy leads the read - the case the next test pins - so
		 * these assertions have to come first, which is also the order a fresh
		 * session meets them in.)
		 */
		assert.deepEqual(model.readBoardColumnOrder(), []);
		/* Anything unusable reads as ABSENT, never half-applied. */
		store.set(key, "not json");
		assert.deepEqual(model.readBoardColumnOrder(), []);
		store.set(key, JSON.stringify({ order: ["done"] }));
		assert.deepEqual(model.readBoardColumnOrder(), []);
		store.set(key, JSON.stringify(["a", 2]));
		assert.deepEqual(model.readBoardColumnOrder(), []);
		store.set(key, JSON.stringify(["a", "", "b"]));
		assert.deepEqual(model.readBoardColumnOrder(), []);
		/* One status must not rank twice: first position wins. */
		store.set(key, JSON.stringify(["a", "a", "b"]));
		assert.deepEqual(model.readBoardColumnOrder(), ["a", "b"]);
		/* A write lands in the store. */
		model.writeBoardColumnOrder(["done", "planning"]);
		assert.equal(store.get(key), JSON.stringify(["done", "planning"]));
	} finally {
		globalThis.localStorage = original;
	}
});

/* ----------------------------------------------------------- team sections -- */

test("a row files under its team, its owner as the fallback, or the bucket", () => {
	/* Team wins when both are set; the section is one name, not two. */
	assert.equal(
		projectTeamName({ team: "platform", owner: "atlas" }),
		"platform",
	);
	assert.equal(projectTeamName({ owner: "atlas", team: null }), "atlas");
	assert.equal(projectTeamName({ team: null, owner: null }), null);
	assert.equal(projectTeamName({}), null);
	/* Trimmed blanks are absences, not sections; a padded value trims. */
	assert.equal(projectTeamName({ team: "   ", owner: "\t" }), null);
	assert.equal(projectTeamName({ team: "  platform  " }), "platform");
	/* The bucket has one spelling. */
	assert.equal(NO_TEAM_LABEL, "No team");
});

test("groups sort by name case-insensitively, the bucket last, input order inside", () => {
	const rows = [
		{ id: "m0", team: "platform" },
		{ id: "m1", owner: "atlas" },
		{ id: "m2", team: null, owner: null },
		{ id: "m3", team: "Platform" },
		{ id: "m4", team: "atlas" },
	];
	const groups = groupByTeam(rows, projectTeamName);
	assert.deepEqual(
		groups.map((group) => group.team),
		["atlas", "platform", "Platform", null],
	);
	assert.deepEqual(
		groups.map((group) => group.items.map((row) => row.id)),
		[["m1", "m4"], ["m0"], ["m3"], ["m2"]],
	);
	/* The bucket is a group only when it holds rows, and empty groups never
	 * render — a header with nothing under it is a broken promise. */
	assert.deepEqual(groupByTeam([], projectTeamName), []);
	const all = [{ id: "a" }, { id: "b" }];
	assert.deepEqual(groupByTeam(all, projectTeamName), [
		{ team: null, items: all },
	]);
});

test("a blocked store cannot take the session's order away", () => {
	/*
	 * UX ROUND 1, U4. The promise was "the move stands for this session"
	 * while a view switch re-ran the read; with only localStorage behind it,
	 * a locked store made that false. The session copy leads the read, so the
	 * two things a remount does - read again, write nothing - keep the order.
	 *
	 * Ordering note: this test runs after the store test above, and that one's
	 * assertions do not depend on a missing session copy once it has written.
	 */
	const original = globalThis.localStorage;
	globalThis.localStorage = {
		getItem: () => {
			throw new Error("locked");
		},
		setItem: () => {
			throw new Error("locked");
		},
	};
	try {
		/* A failed write never throws, and the move is still the session's. */
		model.writeBoardColumnOrder(["qa", "planning"]);
		assert.deepEqual(model.readBoardColumnOrder(), ["qa", "planning"]);
		/* The remount read (what a view switch performs) sees the same order. */
		assert.deepEqual(model.readBoardColumnOrder(), ["qa", "planning"]);
		/* The returned array is a copy: a caller cannot edit the session's. */
		const copy = model.readBoardColumnOrder();
		copy.push("done");
		assert.deepEqual(model.readBoardColumnOrder(), ["qa", "planning"]);
	} finally {
		globalThis.localStorage = original;
	}
});

test("every status the lifecycle names has a chip, and an unknown one keeps its word", () => {
	const labels = [
		"planning",
		"active",
		"qa",
		"validation",
		"done",
		"paused",
		"archived",
	].map((status) => model.projectStatusMeta(status).label);
	assert.deepEqual(labels, [
		"Planning",
		"Active",
		"QA",
		"Validation",
		"Done",
		"Paused",
		"Archived",
	]);
	/*
	 * The vocabulary is OPEN: a word this build has never heard of renders
	 * itself with neutral treatment rather than a guessed chip.
	 */
	assert.deepEqual(model.projectStatusMeta("shadowed"), {
		label: "shadowed",
		variant: "neutral",
	});
});

/*
 * THE NON-COLOUR HALF OF THE DONE CHIP (design round 1, D1): `active` is
 * accent and `done` is success, and in the brand palettes those read as all
 * but one chip (ΔE00 2.22 light / 5.07 dark) while the Status column draws
 * them side by side - so `done` carries a check beside its label and the
 * difference survives any palette and any monochrome reading. The rule is the
 * model's so this lane can hold it; only `done` gets the mark, and an unknown
 * word (which renders itself neutrally) never guesses one.
 */
test("the done chip carries a check, and only the done chip", () => {
	assert.equal(model.statusCarriesCheck("done"), true);
	assert.equal(model.statusCarriesCheck("active"), false);
	assert.equal(model.statusCarriesCheck("paused"), false);
	assert.equal(model.statusCarriesCheck("shadowed"), false);
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

test("a unit label that would collide with the one before it stands down", () => {
	/*
	 * THE QA ROUND 1 REPRO, pinned: the span opens three days before a month
	 * boundary, so at the month tier's 3px/day `Aug` sits 9px from `Jul` and
	 * the axis read `JuAug` (measured live at `[513..529.5]` vs `[522..544.1]`).
	 * The month tier now carries the day tier's own rule, at unit scale.
	 */
	const crowded = timeline.timelineTicks(
		DAY(2026, 7, 29),
		DAY(2026, 10, 28),
		"month",
	);
	assert.deepEqual(
		crowded.map((tick) => tick.label),
		["Jul", "Sep", "Oct"],
	);
	// The control: from the boundary itself every label clears the gap.
	const clean = timeline.timelineTicks(
		DAY(2026, 7, 1),
		DAY(2026, 10, 28),
		"month",
	);
	assert.deepEqual(
		clean.map((tick) => tick.label),
		["Jul", "Aug", "Sep", "Oct"],
	);
	// Quarters carry the same rule: at 1px/day a boundary 12 days in is inside
	// the 26px floor, so `Q1 '27` stands down rather than touching `Q4`.
	const quarters = timeline.timelineTicks(
		DAY(2026, 12, 20),
		DAY(2027, 7, 20),
		"quarter",
	);
	assert.deepEqual(
		quarters.map((tick) => tick.label),
		["Q4", "Q2", "Q3"],
	);
});

test("the timeline's alpha steps are the measured floor, not taste", () => {
	/*
	 * DESIGN ROUND 1, D2/D3: at `accent/70` the bar measured 2.97:1
	 * (localOperatorLight) and 2.98:1 (sage) over the surface; the today marker
	 * at `accent/30` measured 1.52–2.57:1 in EVERY theme. Both now sit at
	 * `accent/75` (3.27:1 on the light palettes), and this pin is the decision
	 * itself: a restyle that changes the step has to come back here and bring
	 * a measurement with it.
	 */
	const source = readFileSync(
		"src/renderer/src/features/projects/components/project-timeline.tsx",
		"utf8",
	);
	assert.ok(
		source.includes("bg-accent/75"),
		"the bar and the today marker share the measured step",
	);
	assert.ok(!source.includes("bg-accent/70"), "the 2.97:1 step");
	assert.ok(!source.includes("bg-accent/30"), "the 1.52:1 step");
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

/* ------------------------------------------------------------- board copy -- */

test("the card's progress line carries ONE 'ago'", () => {
	/*
	 * DESIGN ROUND 1, D1: the card appended its own `" ago"` to a phrase that
	 * already ends in one, so every card with an age read "reported 2h ago
	 * ago" (measured in the committed board frames). The sentence is derived in
	 * the model now, and this pin is the same one `progressLine` keeps.
	 */
	assert.equal(boardProgressText("2h"), "reported 2h ago");
	assert.equal(boardProgressText("6d"), "reported 6d ago");
	assert.equal(boardProgressText("just now"), "reported just now");
	assert.equal(boardProgressText(""), "no progress");
});

test("the sessions trigger names the door and keeps liveness beside it", () => {
	/*
	 * UX ROUND 1, U1 and DESIGN ROUND 1, D5: the trigger printed liveness
	 * alone (`0 live` on a project whose links are merely stopped) — a state
	 * where the number should be — so it now names the linked sessions the
	 * popover lists, and folds the live count in while there is one.
	 */
	assert.equal(
		sessionsTriggerLabel({ sessions: 3, live_sessions: 2 }),
		"3 sessions · 2 live",
	);
	assert.equal(
		sessionsTriggerLabel({ sessions: 1, live_sessions: 0 }),
		"1 session",
	);
	assert.equal(
		sessionsTriggerLabel({ sessions: 4, live_sessions: 4 }),
		"4 sessions · 4 live",
	);
	assert.equal(sessionsTriggerLabel({ sessions: 0, live_sessions: 0 }), "");
});

/* --------------------------------------------------- naming the project ----- */

test("the display name is the title when set, and the key otherwise", () => {
	/*
	 * THE BACKEND'S PRECEDENCE, mirrored (`display_name()`): `name` stays the
	 * key every route addresses, and `title` is what a reader sees. An empty
	 * title is UNKNOWN — the wire would not send one — so it falls back rather
	 * than blanking a heading.
	 */
	assert.equal(
		projectDisplayName({
			name: "payments-migration",
			title: "Payments migration",
		}),
		"Payments migration",
	);
	assert.equal(
		projectDisplayName({ name: "payments-migration", title: null }),
		"payments-migration",
	);
	assert.equal(
		projectDisplayName({ name: "payments-migration", title: "" }),
		"payments-migration",
	);
	assert.equal(
		projectDisplayName({ name: "payments-migration" }),
		"payments-migration",
	);
});

test("'Managed by' joins the owner and the team once each", () => {
	assert.equal(managedByLine("atlas", "platform"), "atlas · platform");
	assert.equal(managedByLine("atlas", null), "atlas");
	assert.equal(managedByLine(null, "platform"), "platform");
	/* The two fields are often the same word; it prints once. */
	assert.equal(managedByLine("atlas", "atlas"), "atlas");
	assert.equal(managedByLine(null, null), "");
	assert.equal(managedByLine(undefined, undefined), "");
});

test("a session row is named by its title, or its id in the machine voice", () => {
	assert.equal(
		sessionLabel({ title: "Payments cutover", session_id: "4e92693767fa" }),
		"Payments cutover",
	);
	assert.equal(
		sessionLabel({ title: null, session_id: "4e92693767fa" }),
		"4e92693767fa",
	);
});

/* -------------------------------------------------------------- the feed ---- */

const update = (at, text, extra = {}) => ({
	at,
	text,
	by: "",
	attachments: [],
	...extra,
});

test("the feed is the log reversed, newest first, and leaves the wire's order alone", () => {
	const log = [
		update("2026-09-18T10:00:00Z", "one"),
		update("2026-09-19T10:00:00Z", "two"),
	];
	assert.deepEqual(
		updatesNewestFirst(log).map((entry) => entry.text),
		["two", "one"],
	);
	assert.equal(log[0].text, "one");
	assert.equal(updatesCountLabel(0), "");
	assert.equal(updatesCountLabel(1), "1 update");
	assert.equal(updatesCountLabel(12), "12 updates");
});

test("a day heading is Today, Yesterday, then the reader's calendar date", () => {
	/*
	 * LOCAL instants converted to ISO, so the test states one rule in any zone:
	 * the 20th at 9am local is Today, the 19th at 11pm local is Yesterday, and
	 * a day the reader's year does not contain gets its year (the
	 * `formatProjectDay` rule, reused rather than restated).
	 */
	const now = new Date(2026, 8, 20, 14, 0, 0);
	const dayOf = (y, m, d, h) =>
		updateDayKey(new Date(y, m, d, h).toISOString());
	assert.equal(updateDayLabel(dayOf(2026, 8, 20, 9), "en-US", now), "Today");
	assert.equal(
		updateDayLabel(dayOf(2026, 8, 19, 23), "en-US", now),
		"Yesterday",
	);
	assert.equal(updateDayLabel(dayOf(2026, 8, 18, 12), "en-US", now), "Sep 18");
	assert.equal(
		updateDayLabel(dayOf(2025, 8, 18, 12), "en-US", now),
		"Sep 18, 2025",
	);
	/* An unparsable stamp groups with no heading rather than a made-up one. */
	assert.equal(updateDayKey(""), "");
	assert.equal(updateDayLabel("", "en-US", now), "");
});

test("the feed's day groups are consecutive and in reverse order", () => {
	const now = new Date(2026, 8, 20, 14, 0, 0);
	const at = (y, m, d, h) => new Date(y, m, d, h).toISOString();
	const groups = groupUpdatesByDay(
		[
			update(at(2026, 8, 18, 10), "one"),
			update(at(2026, 8, 19, 9), "two"),
			update(at(2026, 8, 19, 16), "three"),
			update(at(2026, 8, 20, 9), "four"),
		],
		"en-US",
		now,
	);
	assert.deepEqual(
		groups.map((group) => group.label),
		["Today", "Yesterday", "Sep 18"],
	);
	assert.deepEqual(
		groups.map((group) => group.entries.map((entry) => entry.text)),
		[["four"], ["three", "two"], ["one"]],
	);
});

test("an update's meta line names the author, the clock and the age", () => {
	const nowMs = new Date(2026, 8, 20, 14, 0, 0).getTime();
	const at = new Date(nowMs - 15 * 60 * 1000).toISOString();
	const tokens = updateMetaTokens({ at, by: "4e92693767fa" }, "en-US", nowMs);
	assert.deepEqual(
		tokens.map((token) => token.key),
		["author", "time", "age"],
	);
	assert.equal(tokens[0].text, "session 4e92693767fa");
	assert.match(tokens[1].text, /1:45\s?PM/);
	assert.equal(tokens[2].text, "15m ago");
	/* The operator's own writes name the operator — one rule, the stale line's. */
	const operator = updateMetaTokens({ at, by: "operator" }, "en-US", nowMs);
	assert.equal(operator[0].text, "the operator");
	/*
	 * An entry missing a fact DROPS its token rather than printing a separator
	 * around nothing (the `listRowMeta` shape).
	 */
	assert.deepEqual(updateMetaTokens({ at: "", by: "" }, "en-US", nowMs), []);
	assert.equal(updateAgePhrase(at, nowMs), "15m ago");
	assert.equal(
		updateAgePhrase(new Date(nowMs - 30 * 1000).toISOString(), nowMs),
		"just now",
	);
	assert.equal(updateAgePhrase("", nowMs), "");
});

test("an attachment's size reads the way the tool prints it", () => {
	/* The backend's `file_size_text`, mirrored: B / one-decimal KB / one-decimal MB. */
	assert.equal(attachmentSizeText(12), "12 B");
	assert.equal(attachmentSizeText(4096), "4.0 KB");
	assert.equal(attachmentSizeText(182400), "178.1 KB");
	assert.equal(attachmentSizeText(5 * 1024 * 1024), "5.0 MB");
	assert.equal(attachmentSizeText(Number.NaN), "");
	assert.equal(attachmentSizeText(-4), "");
});

/* ------------------------------------------------------- detail summaries -- */

test("the milestones header counts what it can", () => {
	assert.equal(milestoneSummaryLabel(2, 5), "2 of 5 complete");
	assert.equal(milestoneSummaryLabel(0, 0), "");
});

test("the to-dos aggregate counts only what it knows, and rows keep their own", () => {
	const links = [
		{ todos: { open: 3, total: 7 } },
		{ todos: null },
		{ todos: { open: 1, total: 5 } },
	];
	assert.deepEqual(todosAggregate(links), { open: 4, total: 12 });
	/* Unknown is not zero: an all-unknown project says so rather than reporting 0 open. */
	assert.equal(todosAggregate([{ todos: null }]), null);
	assert.equal(todosAggregate([]), null);
	assert.equal(todosCountLabel({ open: 4, total: 12 }), "4 open of 12");
});

/* --------------------------------------------------------- session actions -- */

test("quick-send aims at the first live link, then the first that exists", () => {
	const link = (session_id, exists, state) => ({
		session_id,
		exists,
		runtime: { state, busy: null },
	});
	assert.equal(
		defaultSendTarget([link("a", true, "stopped"), link("b", true, "live")]),
		"b",
	);
	assert.equal(
		defaultSendTarget([
			link("a", false, "stopped"),
			link("b", true, "stopped"),
		]),
		"b",
	);
	assert.equal(defaultSendTarget([link("a", false, "stopped")]), null);
	assert.equal(defaultSendTarget([]), null);
});

test("the start-session prompt carries the title, the key and the latest progress", () => {
	assert.equal(
		startSessionPrompt({
			name: "payments-migration",
			title: "Payments migration",
			progress: "Dashboard cutover is done.",
		}),
		[
			'Continue work on project "Payments migration" (payments-migration).',
			"Latest progress: Dashboard cutover is done.",
			"Review the project details and continue or complete the work.",
		].join("\n"),
	);
	/* No progress yet is a fact the prompt states, not a blank line. */
	assert.equal(
		startSessionPrompt({ name: "fresh-notes", title: null, progress: "" }),
		[
			'Continue work on project "fresh-notes" (fresh-notes).',
			"Latest progress: not reported yet",
			"Review the project details and continue or complete the work.",
		].join("\n"),
	);
});

test("a start-session toast names the target it started with", () => {
	assert.equal(
		sessionTargetLabel({ kind: "team", name: "atlas" }),
		"team atlas",
	);
	assert.equal(
		sessionTargetLabel({ kind: "agent", name: "reviewer" }),
		"agent reviewer",
	);
	assert.equal(sessionTargetLabel(null), "");
});

/* ------------------------------------------------------------- refusals -- */

test("the done-gate refusal is re-spoken as something this dialog can do", () => {
	/*
	 * The daemon's sentence verbatim (project-lifecycle's `_refuse_done_if_
	 * incomplete`): the names and counts are the useful half and must survive
	 * (unquoted since round 1's U4/D8, see `refusalCopy`'s own note);
	 * the `force_done=true` tail is a tool-call field the desktop update body
	 * does not carry, so it must not reach the dialog.
	 */
	const daemon =
		"cannot set status 'done': 2 milestones still incomplete ('alpha', 'beta') — complete them, or pass force_done=true to close with them open";
	const copy = refusalCopy(daemon);
	assert.ok(copy.includes("alpha and beta"), "the incomplete names survive");
	assert.ok(
		!copy.includes("force_done"),
		"the field this dialog cannot send is gone",
	);
	/*
	 * ROUND 1, D4 CHANGED THIS COPY: the old contract kept the daemon's head
	 * verbatim and only swapped the tail, and this assertion compared the
	 * lowercase tail. The sentence now speaks the app's register throughout -
	 * "This can't be marked done yet: … " - with the count and the names kept
	 * (asserted above) and the tail sentence-cased. Pin the exact product
	 * rather than a substring, so the next copy edit has to come here and say
	 * so.
	 */
	assert.equal(
		copy,
		"This can't be marked done yet: 2 milestones are still incomplete (alpha and beta). Complete or remove the incomplete milestones, then mark it done.",
	);
	/* Every other refusal is shown as written, never silently reworded. */
	assert.equal(
		refusalCopy("no project with id or name 'nope'"),
		"no project with id or name 'nope'",
	);
});
