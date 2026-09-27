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
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { model } = await import(
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
