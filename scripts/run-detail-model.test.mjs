import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The run-details view model, asserted against the rules it ports.
 *
 * `run-detail-model.ts` is pure TypeScript with no React and no DOM, so it
 * bundles the same way `tool-row-model.ts` does and runs under `node --test`.
 *
 * Three things are checked, and the first is the reason the file exists:
 *
 * 1. The rules that have a RIGHT ANSWER are asserted rather than eyeballed in a
 *    story — which child the roster drops first, which figure disappears when
 *    the wire did not report it, what the tooltip says when there is room for
 *    one clause and not two. A port whose rules are only checked by looking at a
 *    frame drifts from its source the first time either side is edited.
 * 2. The failure paths: `deriveRunDetails` reads `Array<Record<string,
 *    unknown>>`, so a runtime older or newer than this renderer is normal and
 *    every missing field has to degrade to an omitted segment rather than to a
 *    zero or a crash.
 * 3. The story fixtures themselves, derived — the states the design frames
 *    claim to cover are covered, so a frame cannot be the only evidence that a
 *    state was ever rendered.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/components/run-details/run-detail-model";',
			'export * as fixtures from "./src/renderer/src/features/chat/components/run-details/run-details.fixtures";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	NOTHING_SEEN,
	acknowledgedOnClose,
	acknowledgedOnOpen,
	childStateLabel,
	deriveRunDetails,
	hasLiveChildClock,
	hasRunDetails,
	hasUnseenFailure,
	retimeRunDetails,
	runDetailTriggerLabel,
	subagentTally,
	todoTally,
	unseenFailures,
	visibleFailures,
	visibleSubagents,
	visibleTodoPhases,
	fixtures,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** One wire job, with only the fields a test cares about. */
const job = (over) => ({
	id: "job-1",
	type: "task",
	status: "running",
	queued: false,
	label: "Do the thing",
	start_time: 1_000,
	settled_at: null,
	...over,
});

const NOW_MS = 1_060_000;

const derive = (jobs, todos = []) =>
	deriveRunDetails({ jobs, todos, nowMs: NOW_MS });

/* ------------------------------------------------------------------ */
/* Status folding                                                      */
/* ------------------------------------------------------------------ */

test("a queued child is queued, not running", () => {
	// The wire keeps `status: running` for a child parked behind the capacity
	// gate, so the flag has to be read before the word.
	const { subagents } = derive([job({ queued: true })]);
	assert.equal(subagents[0].status, "queued");
	assert.equal(subagents[0].activity, null);
});

test("the pause FLAG is not a field this wire has, and it does not make a state", () => {
	// `frontend.jobs` rows are `JobState`, which has no `paused` field at all: the
	// pause intent lives on `harness.comms._ChildRecord.paused` and reaches a view
	// only where something injects it (`tui/app.py:22215` does that for its OWN
	// frontend). Nothing does here, so an extra `paused` key is data from a runtime
	// this renderer has not been taught, and the WORD is what the row folds by.
	const paused = derive([job({ status: "cancelled", paused: true })]);
	assert.equal(paused.subagents[0].status, "cancelled");
	// The consequence `§3.3` states rather than hides: a LIVE pause arrives as a
	// cancel, so a pause that leaves nothing else in flight does not raise the
	// trigger, and the transcript's own notice is the fallback.
	assert.equal(paused.openChildren, 0);
	assert.equal(hasRunDetails(paused), false);
	assert.deepEqual(
		paused.subagents.map((row) => row.activity || null),
		[null],
	);
});

test("a RESTORED pause is on this wire, and it is open work", () => {
	/*
	 * The word, not the flag. `frontend_state._jobs` appends one row per node of
	 * the durable graph — the cold-restart case, where nested execution ledgers
	 * are gone and the shared graph still exists — with `status=getattr(node,
	 * "status", "gone")`, and `SubagentNode.status` is `_describe`'s. `_describe`
	 * returns `paused` AHEAD of the recorded outcome, and `record_outcome`
	 * deliberately keeps the flag set across the child's exit, so a parked child
	 * comes back carrying that word. A nested child is exactly one whose job row
	 * never reaches the root's sidecar, which is why that branch exists at all.
	 *
	 * Without the fold the row rendered a settled green check and left
	 * `openChildren`, so it could leave `hasRunDetails` false: a child the user
	 * parked to come back to, drawn as finished, with no trigger to reach the
	 * roster through.
	 */
	const restored = derive([
		job({ id: "parked", status: "paused", start_time: 0, settled_at: null }),
	]);
	assert.equal(restored.subagents[0].status, "paused");
	assert.equal(restored.subagents[0].stateWord, "paused");
	assert.equal(restored.openChildren, 1);
	assert.equal(hasRunDetails(restored), true);
	// A restored row is a reader row: the graph carries no clock for it, so the
	// panel shows it without one rather than measuring it against now.
	assert.equal(hasLiveChildClock(restored.subagents), false);
});

test("every word the wire can produce is folded explicitly", () => {
	/*
	 * The union is enumerated from the two producers: `JobStatus`
	 * (`harness/jobs.py:215`) plus the `queued` flag, and the roster vocabulary
	 * `_describe` returns (`comms.py`), which the durable-graph branch copies onto
	 * the row verbatim. Pinned word by word so a status added to the wire cannot
	 * land on this model's fall-through unnoticed.
	 */
	const folded = (status, queued = false) =>
		derive([job({ status, queued })]).subagents[0];
	assert.equal(folded("running").status, "running");
	// The flag is read before the word: a queued child's status is still
	// `running` on the wire, and half the roster would otherwise read as work
	// spending tokens.
	assert.equal(folded("running", true).status, "queued");
	// Admitted by the capacity gate but not yet in its runner: the `queued` mark
	// ("has not started"), and still OPEN, which is the fact `§3.3` needs.
	assert.equal(folded("starting").status, "queued");
	assert.equal(derive([job({ status: "starting" })]).openChildren, 1);
	// Pause asked for and still landing: `status_glyph` keeps its running mark
	// for that window, so the fold does too.
	assert.equal(folded("pausing").status, "running");
	assert.equal(folded("paused").status, "paused");
	assert.equal(folded("completed").status, "done");
	assert.equal(folded("done").status, "done");
	assert.equal(folded("failed").status, "failed");
	assert.equal(folded("cancelled").status, "cancelled");
	assert.equal(folded("canceled").status, "cancelled");
	assert.equal(folded("interrupted").status, "interrupted");
	assert.equal(folded("gone").status, "gone");
	// The OPEN set is exactly the states `§3.3`'s visibility rule counts.
	assert.deepEqual(
		[
			"running",
			"queued",
			"starting",
			"pausing",
			"paused",
			"completed",
			"done",
			"failed",
			"cancelled",
			"interrupted",
			"gone",
		].filter((word) => derive([job({ status: word })]).openChildren > 0),
		["running", "starting", "pausing", "paused"],
	);
});

test("an unrecognised status is its own quiet state, never done", () => {
	/*
	 * The rule, and the one place this port refuses the TUI: `status_glyph` ends
	 * `GLYPH_DONE, status or "completed"`, so an unknown status painted the
	 * completed check with its own word. Promoting a state to "finished" is how a
	 * row the user is waiting on disappears — it stops counting as open work, it
	 * ranks with the settled tail in the slice, and it renders as a green check.
	 * The word it carries is the WIRE's, announced verbatim, so a reader can act
	 * on a state this renderer has not been taught.
	 */
	const row = derive([job({ status: "reticulating" })]).subagents[0];
	assert.equal(row.status, "unknown");
	assert.notEqual(row.status, "done");
	assert.equal(childStateLabel(row), "reticulating");
	// Settled and quiet, and not a count the reader acts on: an unknown word must
	// not raise the trigger on its own any more than `done` does.
	assert.equal(hasRunDetails(derive([job({ status: "reticulating" })])), false);
	// `gone` — the graph's word for a row swept without a recorded outcome — is
	// its own state for the same reason, from the same branch.
	const gone = derive([job({ status: "gone" })]).subagents[0];
	assert.equal(gone.status, "gone");
	assert.equal(childStateLabel(gone), "gone");
	// Both count in the tally under their own word, in the quietest segments.
	assert.equal(
		subagentTally(
			derive([
				job({ id: "a", status: "running" }),
				job({ id: "b", status: "gone" }),
				job({ id: "c", status: "reticulating" }),
			]).subagents,
		),
		"1 running · 1 gone · 1 reticulating",
	);
});

test("failure, cancellation and interruption keep their own words", () => {
	const rows = derive([
		job({ id: "a", status: "failed" }),
		job({ id: "b", status: "cancelled" }),
		job({ id: "c", status: "interrupted" }),
		job({ id: "d", status: "completed" }),
	]).subagents;
	assert.deepEqual(
		rows.map((row) => row.status),
		["failed", "cancelled", "interrupted", "done"],
	);
	// None of these is open: a cancelled child the user stopped and a run the
	// process ended are both settled.
	assert.equal(derive([job({ status: "interrupted" })]).openChildren, 0);
});

/* ------------------------------------------------------------------ */
/* Numbers are omitted, never zeroed                                   */
/* ------------------------------------------------------------------ */

test("a figure the wire did not report is absent, not zero", () => {
	const [row] = derive([
		job({ start_time: 0, usage: null, context_window: null, direct_cost: null }),
	]).subagents;
	assert.equal(row.elapsedLabel, null); // epoch zero is not a launch time
	assert.equal(row.contextLabel, null);
	assert.equal(row.costLabel, null);
});

test("context is a percentage of the window, in the TUI's short spelling", () => {
	const percent = derive([
		job({ usage: { context_tokens: 92_000 }, context_window: 200_000 }),
	]).subagents[0];
	assert.equal(percent.contextLabel, "46%");

	// A non-zero reading below one percent is refused a rounded "0%": a child
	// holding a thousand tokens is not holding none.
	const tiny = derive([
		job({ usage: { context_tokens: 1_000 }, context_window: 200_000 }),
	]).subagents[0];
	assert.equal(tiny.contextLabel, "<1%");

	// Nothing reported, or no denominator to report it against: absent rather
	// than invented.
	assert.equal(
		derive([job({ usage: { context_tokens: 0 }, context_window: 200_000 })])
			.subagents[0].contextLabel,
		null,
	);
	assert.equal(
		derive([job({ usage: { context_tokens: 92_000 }, context_window: 0 })])
			.subagents[0].contextLabel,
		null,
	);
	// `input_tokens` is the fallback for a provider that reports what it billed
	// for but no occupancy.
	assert.equal(
		derive([job({ usage: { input_tokens: 40_000 }, context_window: 200_000 })])
			.subagents[0].contextLabel,
		"20%",
	);
});

test("cost uses the TUI's compact dollar grammar", () => {
	const costs = derive([
		job({ id: "a", direct_cost: 0.31 }),
		job({ id: "b", direct_cost: 0.0021 }),
		job({ id: "c", direct_cost: 2.5 }),
		job({ id: "d", direct_cost: 0 }),
	]).subagents;
	assert.deepEqual(
		costs.map((row) => row.costLabel),
		["$0.31", "$0.0021", "$2.50", "$0.0000"],
	);
});

test("elapsed measures a settled child against its own settle time", () => {
	const [running, settled] = derive([
		job({ id: "a", start_time: 1_000, settled_at: null }),
		job({ id: "b", start_time: 1_000, settled_at: 1_072 }),
	]).subagents;
	// `nowMs` is 1_060_000 ms = 1060 s, so the running child is 60 s in and the
	// settled one reports its own 72 s rather than its age.
	assert.equal(running.elapsedLabel, "1m");
	assert.equal(settled.elapsedLabel, "1m12s");
});

test("the activity line belongs to live work only", () => {
	const running = derive([
		job({ status: "running", latest_details: { progress: "Running pytest -q" } }),
	]).subagents[0];
	assert.equal(running.activity, "Running pytest -q");

	// A settled child has no second line, matching the TUI's blanked activity —
	// which is what keeps the settled tail of the list quiet.
	const done = derive([
		job({ status: "done", latest_details: { progress: "Running pytest -q" } }),
	]).subagents[0];
	assert.equal(done.activity, null);
});

test("a model-written activity is flattened to one line", () => {
	// A row that grows to three lines because the model wrote three would break
	// the pitch of every row around it.
	const [row] = derive([
		job({ latest_details: { progress: "Reading rows\n  1-412\u0007  now" } }),
	]).subagents;
	assert.equal(row.activity, "Reading rows 1-412 now");
});

test("a failure's first line is its summary, and only its first line", () => {
	const [row] = derive([
		job({
			status: "failed",
			error_text: "FileNotFoundError: 'ledger/q1.csv'\n  raised while reading",
		}),
	]).subagents;
	assert.equal(row.errorLine, "FileNotFoundError: 'ledger/q1.csv'");
});

/* ------------------------------------------------------------------ */
/* Role suppression                                                    */
/* ------------------------------------------------------------------ */

test("the default role is suppressed, a real one is carried", () => {
	const rows = derive([
		job({ id: "a", agent_role: "task" }),
		job({ id: "b", agent_role: "reviewer" }),
		job({ id: "c" }),
	]).subagents;
	assert.deepEqual(
		rows.map((row) => row.role),
		[null, "reviewer", null],
	);
});

/* ------------------------------------------------------------------ */
/* Priority slice and overflow                                         */
/* ------------------------------------------------------------------ */

test("the roster orders by what needs attention, ties to the newest", () => {
	const rows = derive([
		job({ id: "done-1", status: "done", start_time: 100, settled_at: 200 }),
		job({ id: "done-2", status: "done", start_time: 300, settled_at: 400 }),
		job({ id: "failed", status: "failed", start_time: 500, settled_at: 600 }),
		job({ id: "running", status: "running", start_time: 1_000 }),
		job({ id: "interrupted", status: "interrupted", start_time: 700, settled_at: 800 }),
		job({ id: "done-3", status: "done", start_time: 900, settled_at: 950 }),
		job({ id: "queued", status: "running", queued: true, start_time: 990 }),
		job({ id: "cancelled", status: "cancelled", start_time: 810, settled_at: 820 }),
	]).subagents;
	// running/queued, failed, interrupted, then settled — and within the last rank
	// the newest settled child, not the last one in the array.
	const visible = visibleSubagents(rows);
	assert.deepEqual(
		visible.rows.map((row) => row.id),
		[
			"running",
			"queued",
			"failed",
			"interrupted",
			"done-3",
			"cancelled",
		],
	);
	assert.equal(visible.hidden, 2);
});

test("a rank's ties fall to the child's own clock, not to its array index", () => {
	/*
	 * The regression this pins: QA measured a live nine-child roster in an order
	 * with no time meaning (`Hold, Canvas failure, Role, Slow, ...`), because
	 * `frontend.jobs` is not append-ordered. Tying by index selected an arbitrary
	 * subset — the two MOST RECENT completions behind `+3 more` while the two
	 * oldest stayed on screen — and made the displayed order change between
	 * frames, which is the reflow §6.3 exists to prevent.
	 *
	 * `settled_at` for a settled row and `start_time` otherwise, both in epoch
	 * seconds. The three cases below are the rule from every side: array order
	 * that agrees with the clocks, array order that INVERTS them, and clocks that
	 * are equal.
	 */
	const settled = (id, start, settledAt) =>
		job({ id, status: "done", start_time: start, settled_at: settledAt });
	const ids = (jobs) =>
		visibleSubagents(derive(jobs).subagents).rows.map((row) => row.id);

	// Chronological, which the index rule happens to get right.
	assert.deepEqual(ids([settled("oldest", 100, 150), settled("middle", 200, 250), settled("newest", 300, 350)]), [
		"newest",
		"middle",
		"oldest",
	]);
	// The same three rows in the OPPOSITE array order. The index rule returns
	// `oldest, middle, newest` here — the oldest completion on screen and the
	// newest one hidden — and this is the assertion that fails on it.
	assert.deepEqual(ids([settled("newest", 300, 350), settled("oldest", 100, 150), settled("middle", 200, 250)]), [
		"newest",
		"middle",
		"oldest",
	]);
	// A settled row is ranked by when it SETTLED, so a child that started last
	// but finished first is the older completion.
	assert.deepEqual(ids([settled("late-start", 900, 950), settled("early-start", 100, 990)]), [
		"early-start",
		"late-start",
	]);
	// Simultaneous rows have no “newest” to fall to, so they keep the wire's
	// order: any rule here would be a claim the timestamps do not support.
	assert.deepEqual(ids([settled("first", 100, 150), settled("second", 100, 150)]), [
		"first",
		"second",
	]);
	// And a row with no clock at all — a child that never launched, so
	// `start_time` is epoch zero — has nothing to be newest BY and sorts after
	// every row that does.
	assert.deepEqual(
		ids([
			job({ id: "never-started", status: "done", start_time: 0 }),
			settled("ran", 100, 150),
		]),
		["ran", "never-started"],
	);
});

test("the crowded frame's slice follows the clocks, not the array's order", () => {
	// The fixture is deliberately stored out of chronological order — that is its
	// subject — so this asserts the six rows the FRAME shows. Under an
	// index tie-break the visible set is `job-b, job-a, job-c, job-d, job-f,
	// job-h`, which is a different six rows: a done child is shown and the newest
	// settled child is not.
	const { subagents } = deriveRunDetails(fixtures.crowded());
	const visible = visibleSubagents(subagents);
	assert.deepEqual(
		visible.rows.map((row) => row.id),
		["job-c", "job-b", "job-a", "job-d", "job-f", "job-e"],
	);
	assert.equal(visible.hidden, 3);
});

test("a failed child is never shed, however many are running", () => {
	/*
	 * Six concurrent children is ordinary (`DEFAULT_MAX_RUNNING_JOBS` is 15), and
	 * failure ranks BELOW running: at a cap of six the ranked slice pushed the
	 * failed row out, so the `danger` dot said “a child failed and you have not
	 * looked” while the panel it opened could not show which child or print its
	 * exception — and opening the panel cleared the dot.
	 */
	const rows = derive([
		job({ id: "failed", status: "failed", start_time: 100, settled_at: 200 }),
		...Array.from({ length: 6 }, (_, index) =>
			job({ id: `running-${index}`, status: "running", start_time: 900 + index }),
		),
	]).subagents;
	const visible = visibleSubagents(rows);
	assert.equal(rows.length, 7);
	assert.equal(visible.rows.length, 6);
	assert.ok(visible.rows.some((row) => row.id === "failed"));
	// The reservation evicts the QUIETEST visible row — the oldest running child
	// — and the disclosure count reports that, so `+1 more` is one child and not
	// the failure the dot promised.
	assert.equal(visible.hidden, 1);
	assert.ok(!visible.rows.some((row) => row.id === "running-0"));
	// The displayed order is still the rank order: the failure did not jump to
	// the top of the list to be reserved.
	assert.deepEqual(
		visible.rows.map((row) => row.id),
		["running-5", "running-4", "running-3", "running-2", "running-1", "failed"],
	);
});

test("more failures than the cap keep the failures, and say what they cost", () => {
	// The extreme of the reservation rule, stated rather than left to be
	// discovered: a failure outranks a running child for a slot, because the dot's
	// promise is about failure specifically. The count stays honest either way.
	const rows = derive([
		...Array.from({ length: 6 }, (_, index) =>
			job({
				id: `failed-${index}`,
				status: "failed",
				start_time: 100,
				settled_at: 200 + index,
			}),
		),
		...Array.from({ length: 3 }, (_, index) =>
			job({ id: `running-${index}`, status: "running", start_time: 900 }),
		),
	]).subagents;
	const visible = visibleSubagents(rows);
	assert.equal(visible.rows.length, 6);
	assert.equal(visible.rows.filter((row) => row.status === "failed").length, 6);
	assert.equal(visible.hidden, 3);
});

test("failures BEYOND the cap are shed like anything else, and the panel says so", () => {
	/*
	 * The reservation's own limit, and the reason its wording is "while the
	 * failures fit the cap" rather than "never": once every kept row is already
	 * a failure the walk has no victim left, so it stops. Eight failures at a cap
	 * of six show six and hide the two OLDEST behind `+N more` — the arithmetic
	 * maximum a six-row cap allows, and the same rule that sheds any other
	 * over-cap row.
	 *
	 * Live QA reproduced this on the real panel (eight failing children, a trigger
	 * reading `7 subagents failed`, and one announced failure behind the
	 * disclosure), so the assertion is pinned at the same size rather than one
	 * short of it.
	 */
	const rows = derive([
		...Array.from({ length: 8 }, (_, index) =>
			job({
				id: `failed-${index}`,
				status: "failed",
				start_time: 100,
				settled_at: 200 + index,
			}),
		),
		...Array.from({ length: 3 }, (_, index) =>
			job({ id: `running-${index}`, status: "running", start_time: 900 }),
		),
	]).subagents;
	const visible = visibleSubagents(rows);
	assert.equal(visible.rows.length, 6);
	assert.equal(visible.rows.filter((row) => row.status === "failed").length, 6);
	// The two oldest failures are the ones behind the disclosure — the same
	// "oldest goes" rule every other over-cap row follows.
	assert.deepEqual(
		visible.rows.map((row) => row.id),
		["failed-7", "failed-6", "failed-5", "failed-4", "failed-3", "failed-2"],
	);
	// The disclosure count stays honest: eleven rows, six shown, five hidden.
	assert.equal(visible.hidden, 5);
	// And the dot's own ledger agrees with what the slice showed: the two rows the
	// panel could NOT display are not acknowledged by opening or closing it.
	assert.deepEqual(visibleFailures(rows), [
		"failed-7",
		"failed-6",
		"failed-5",
		"failed-4",
		"failed-3",
		"failed-2",
	]);
	assert.equal(visibleFailures(rows).includes("failed-0"), false);
});

test("six rows are shown and the rest are disclosed, never dropped", () => {
	const rows = derive(
		Array.from({ length: 9 }, (_, index) =>
			job({ id: `job-${index}`, status: "done", label: `Child ${index}` }),
		),
	).subagents;
	const visible = visibleSubagents(rows);
	assert.equal(visible.rows.length, 6);
	assert.equal(visible.hidden, 3);
});

/* ------------------------------------------------------------------ */
/* Section tallies                                                     */
/* ------------------------------------------------------------------ */

test("the subagents tally sheds whole segments", () => {
	const rows = derive([
		job({ id: "a", status: "running" }),
		job({ id: "b", status: "running" }),
		job({ id: "c", status: "done" }),
	]).subagents;
	assert.equal(subagentTally(rows), "2 running · 1 done");
	assert.equal(subagentTally(rows, 10), "2 running");
	assert.equal(subagentTally(rows, 24), "2 running · 1 done");
	// The first segment always survives: dropping it would leave the tally
	// saying nothing, which is worse than one count over budget.
	assert.equal(subagentTally(rows, 1), "2 running");
});

test("the to-dos tally says resolved, and names dropped work inside it", () => {
	const details = derive([], [
		{
			name: "Plan",
			items: [
				{ text: "a", status: "done" },
				{ text: "b", status: "done" },
				{ text: "c", status: "pending" },
				{ text: "d", status: "dropped" },
			],
		},
	]);
	// `resolved` is closure — done OR dropped — and it is the same notion the
	// phase headers count. `2 of 4 done` above a header reading `3/4` was two
	// notions of closure under two spellings, with nothing saying which was which.
	assert.equal(todoTally(details), "3 of 4 resolved · 1 dropped");
	assert.equal(todoTally(details, 14), "3 of 4 resolved");
});

/* ------------------------------------------------------------------ */
/* The to-do row budget                                                */
/* ------------------------------------------------------------------ */

const plan = (statuses) => [
	{ name: "Plan", items: statuses.map((status, index) => ({ text: `item ${index}`, status })) },
];

test("ten item rows are shown, the OLDEST closed rows go first, open ones never do", () => {
	// Fourteen items: nine closed, five open. Five open plus five closed is ten,
	// so four closed rows are disclosed — and they are the FIRST four closed rows
	// in plan order, because the plan sheds its oldest settled work and keeps its
	// recent end (`§6.3`). Shedding the newest instead reads as a plan that stopped
	// recording, which is the defect this pins.
	const statuses = [
		"done", // shed
		"done", // shed
		"done", // shed
		"done", // shed
		"pending", // open, never hidden
		"done", // kept
		"blocked", // open, never hidden
		"done", // kept
		"done", // kept
		"done", // kept
		"pending", // open, never hidden
		"dropped", // kept
		"pending", // open, never hidden
		"pending", // open, never hidden
	];
	const details = derive([], plan(statuses));
	const visible = visibleTodoPhases(details.todos);
	const shown = visible.phases.flatMap((phase) => phase.items);
	assert.equal(shown.length, 10);
	assert.equal(visible.hidden, 4);
	assert.equal(visible.phases[0].hidden, 4, "the phase's own hidden count is not attributed");
	// The tail survives whole: indices 4..13 are exactly the ten rows on screen.
	assert.deepEqual(
		shown.map((item) => item.text),
		[4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((index) => `item ${index}`),
	);
	// Never dropping an open or blocked item is the rule the cap is subordinate
	// to, so it is asserted item by item rather than by count: no open item may
	// be missing from what is shown.
	const hiddenOpen = statuses.filter(
		(status, index) =>
			(status === "pending" || status === "blocked") &&
			!shown.some((item) => item.text === `item ${index}`),
	);
	assert.deepEqual(hiddenOpen, []);
});

test("a phase whose rows were all shed keeps its header and discloses them itself", () => {
	// The oldest closed rows fall off the FRONT, so the earliest phase can lose
	// every row it has — and the fixture makes that happen rather than asserting
	// the shape in the abstract: `Reconcile` is wholly closed, so all five of its
	// rows are shed and nothing of the phase is left but its header and its own
	// `+N more`. It keeps them rather than silently vanishing: a plan that appears
	// to start at phase two is a plan lying about its own size, and the header
	// above the gap is then accountable to nothing. This is the state `§6.3`
	// describes and no earlier fixture reached.
	const visible = visibleTodoPhases(deriveRunDetails(fixtures.todosOnly()).todos);
	assert.deepEqual(
		visible.phases.map((phase) => [phase.name, phase.hidden]),
		[
			["Reconcile", 5],
			["Verify", 0],
			["Publish", 0],
		],
	);
	// Five closed rows out, five rows of disclosure in — and the phase that lost
	// them is still rendered, with NO rows under its header at all.
	assert.deepEqual(visible.phases[0].items, []);
	assert.equal(visible.hidden, 5);
});

test("more open items than the cap shows every one of them", () => {
	const details = derive(
		[],
		plan(Array.from({ length: 12 }, () => "pending")),
	);
	const visible = visibleTodoPhases(details.todos);
	assert.equal(
		visible.phases.flatMap((phase) => phase.items).length,
		12,
		"a plan with twelve open items shows twelve rows",
	);
	assert.equal(visible.hidden, 0);
});

/* ------------------------------------------------------------------ */
/* Visibility                                                          */
/* ------------------------------------------------------------------ */

test("a flat plan renders headerless, a phased one keeps its headers", () => {
	// The flat case is ONE phase carrying no name of its own, which is what a
	// bare `init` produces.
	const flat = derive([], plan(["pending"]).map((phase) => ({ ...phase, name: "" })));
	assert.equal(flat.todos[0].name, null);

	const phased = derive(
		[],
		plan(["pending"]).map((phase) => ({ ...phase, name: "Reconcile" })),
	);
	assert.equal(phased.todos[0].name, "Reconcile");

	// A single phase deliberately NAMED "Todos" is the implicit default, so it
	// is the flat case rather than a plan someone named.
	const implicit = derive([], plan(["pending"]).map((phase) => ({ ...phase, name: "Todos" })));
	assert.equal(implicit.todos[0].name, null);

	// Two phases: the second keeps its name whatever the first is called.
	const two = derive(
		[],
		[
			{ name: "Todos", items: [{ text: "a", status: "pending" }] },
			{ name: "Publish", items: [{ text: "b", status: "pending" }] },
		],
	);
	assert.deepEqual(
		two.todos.map((phase) => phase.name),
		["Todos", "Publish"],
	);
});

test("settled work alone does not raise the trigger", () => {
	assert.equal(
		hasRunDetails(
			derive(
				[job({ status: "done" }), job({ id: "b", status: "cancelled" })],
				plan(["done", "dropped"]),
			),
		),
		false,
	);
});

test("open work, and an unseen failure, both raise it", () => {
	assert.equal(hasRunDetails(derive([job({ status: "running" })])), true);
	assert.equal(hasRunDetails(derive([], plan(["blocked"]))), true);
	assert.equal(hasRunDetails(null), false);
	// A cancelled child — which is what a paused one looks like here — is settled
	// work: on its own it is not a reason to raise the trigger (`§3.3`).
	assert.equal(hasRunDetails(derive([job({ status: "cancelled" })])), false);
});

test("a failure raises the trigger until it has been seen", () => {
	const details = derive([job({ id: "failed-1", status: "failed" })]);
	assert.equal(hasRunDetails(details), true);
	assert.equal(hasRunDetails(details, NOTHING_SEEN), true);
	assert.equal(hasUnseenFailure(details), true);
	assert.deepEqual(unseenFailures(details), ["failed-1"]);

	const seen = new Set(["failed-1"]);
	assert.equal(hasUnseenFailure(details, seen), false);
	assert.equal(hasRunDetails(details, seen), false);

	// A SECOND failure after the first was acknowledged raises it again: the
	// acknowledgement is per child, not a boolean about the turn.
	const two = derive([
		job({ id: "failed-1", status: "failed" }),
		job({ id: "failed-2", status: "failed" }),
	]);
	assert.equal(hasRunDetails(two, seen), true);
	assert.deepEqual(unseenFailures(two, seen), ["failed-2"]);
});

test("opening acknowledges the failures that were on screen, and only those", () => {
	/*
	 * The rule the dot's promise rests on (`§3.3`). What this replaces bound the
	 * acknowledgement to a `[open, details]` effect: every failure the roster
	 * gained while the panel was open was re-recorded as seen, so a child that
	 * failed while the reader was scrolled down in the plan was marked read
	 * without ever having been displayed, and the trigger's failure clause was
	 * gone when they closed the panel.
	 */
	const opened = acknowledgedOnOpen(["failed-1"], NOTHING_SEEN);
	assert.deepEqual([...opened], ["failed-1"]);
	// A failure that arrives WHILE the panel is open is not acknowledged: the
	// snapshot is the only thing consulted, and it was taken at the open.
	const whileOpen = acknowledgedOnOpen(["failed-1"], opened);
	assert.equal(whileOpen, opened, "an unchanged snapshot must not churn state");
	assert.equal(hasUnseenFailure(derive([job({ id: "failed-2", status: "failed" })]), whileOpen), true);
	// A failure acknowledged BEFORE stays acknowledged, so a roster that sheds a
	// row for a frame and republishes it cannot re-light a dot already read.
	const later = acknowledgedOnOpen(["failed-2"], opened);
	assert.deepEqual([...later].sort(), ["failed-1", "failed-2"]);
});

test("closing acknowledges the failures the panel showed, and not the ones it hid", () => {
	/*
	 * The other half of the dot's promise (`§3.3`, UX round 2 U2). The open
	 * snapshot alone left the dot lit for a failure whose row the reader watched
	 * arrive INSIDE the visible slice: the trigger went on saying "a child failed
	 * and you have not looked" about something they had just read, and clearing it
	 * cost an extra open/close cycle.
	 */
	const details = derive([
		job({ id: "seen-onscreen", status: "failed", start_time: 100, settled_at: 200 }),
		job({ id: "arrived-later", status: "failed", start_time: 100, settled_at: 300 }),
	]);
	// Opened with one failure on screen, the second arriving while it was open:
	// both rows were in the slice at some point during the open period, which is
	// the set the close acknowledges (accumulated, not read at the close).
	const shown = new Set([
		...visibleFailures(details.subagents.slice(0, 1)),
		...visibleFailures(details.subagents),
	]);
	assert.deepEqual([...shown].sort(), ["arrived-later", "seen-onscreen"]);
	const afterClose = acknowledgedOnClose(
		[...shown],
		acknowledgedOnOpen(["seen-onscreen"], NOTHING_SEEN),
	);
	assert.deepEqual([...afterClose].sort(), ["arrived-later", "seen-onscreen"]);
	assert.equal(hasUnseenFailure(details, afterClose), false);

	/*
	 * And a failure the panel could NOT display keeps its dot. Eight failures at
	 * a cap of six is where the reservation runs out of victims, so the two oldest
	 * sit behind `+N more` — the reader has been told a number, not shown a row,
	 * and the clause has to survive the close for exactly that case.
	 */
	const many = derive(
		Array.from({ length: 8 }, (_, index) =>
			job({
				id: `failed-${index}`,
				status: "failed",
				start_time: 100,
				settled_at: 200 + index,
			}),
		),
	);
	const hidden = visibleFailures(many.subagents);
	assert.equal(hidden.length, 6);
	const kept = acknowledgedOnClose(hidden, NOTHING_SEEN);
	assert.equal(kept.has("failed-7"), true);
	assert.equal(kept.has("failed-0"), false);
	assert.deepEqual(unseenFailures(many, kept).sort(), ["failed-0", "failed-1"]);
	// Same identity guarantee as the open side: a close that adds nothing must not
	// churn the seen set.
	assert.equal(acknowledgedOnClose(hidden, kept), kept);
});

test("the clock ticks only for a child that has a running clock", () => {
	// The predicate that justifies the 1Hz timer, extracted from the hook so the
	// claim is asserted rather than described: a settled child is measured
	// against its own `settled_at` and a child with no launch time shows no
	// duration, so neither can go stale and neither can pay for a timer.
	assert.equal(hasLiveChildClock(derive([job({ status: "running" })]).subagents), true);
	assert.equal(hasLiveChildClock(derive([job({ status: "running", queued: true })]).subagents), true);
	assert.equal(
		hasLiveChildClock(derive([job({ status: "done", settled_at: 1_050 })]).subagents),
		false,
	);
	assert.equal(
		hasLiveChildClock(
			derive([job({ status: "failed", settled_at: 1_050 })]).subagents,
		),
		false,
		"a failed child has settled",
	);
	// Epoch zero is not a launch time, so it is not a clock to tick.
	assert.equal(
		hasLiveChildClock(derive([job({ status: "running", start_time: 0 })]).subagents),
		false,
	);
	assert.equal(hasLiveChildClock([]), false);
});

/* ------------------------------------------------------------------ */
/* Trigger copy                                                        */
/* ------------------------------------------------------------------ */

test("the tooltip carries counts, pluralised honestly", () => {
	const both = derive(
		[job({ id: "a" }), job({ id: "b" })],
		plan(["pending", "pending", "pending", "pending"]),
	);
	assert.equal(
		runDetailTriggerLabel(both),
		"Run details — 2 subagents running, 4 to-dos open",
	);

	const one = derive([job({ id: "a" })], plan(["pending"]));
	assert.equal(runDetailTriggerLabel(one), "Run details — 1 subagent running, 1 to-do open");

	const children = derive([job({ id: "a" }), job({ id: "b" })]);
	assert.equal(runDetailTriggerLabel(children), "Run details — 2 subagents running");

	const todos = derive([], plan(["pending", "pending", "pending"]));
	assert.equal(runDetailTriggerLabel(todos), "Run details — 3 to-dos open");

	const failed = derive([job({ id: "a", status: "failed" })]);
	assert.equal(runDetailTriggerLabel(failed), "Run details — 1 subagent failed");
});

test("the tooltip sheds whole clauses, never half of one", () => {
	const details = derive(
		[job({ id: "a" }), job({ id: "b" })],
		plan(["pending", "pending", "pending", "pending"]),
	);
	assert.equal(
		runDetailTriggerLabel(details, NOTHING_SEEN, 40),
		"Run details — 2 subagents running",
	);
	assert.equal(
		runDetailTriggerLabel(details, NOTHING_SEEN, 60),
		"Run details — 2 subagents running, 4 to-dos open",
	);
	// Below the first clause's own width the label stays whole rather than
	// truncating: a clause cut mid-sentence states a count and hides its noun.
	assert.equal(
		runDetailTriggerLabel(details, NOTHING_SEEN, 5),
		"Run details — 2 subagents running",
	);
});

test("a seen failure is dropped from the label", () => {
	const details = derive([job({ id: "failed-1", status: "failed" })]);
	assert.equal(
		runDetailTriggerLabel(details, new Set(["failed-1"])),
		"Run details",
	);
});

/* ------------------------------------------------------------------ */
/* The story fixtures, derived                                         */
/* ------------------------------------------------------------------ */

test("every child state the design asks for is in the fixture set", () => {
	const states = new Set(
		[
			fixtures.bothInFlight(),
			fixtures.subagentsOnly(),
			fixtures.failure(),
			fixtures.crowded(),
			fixtures.settled(),
			fixtures.headerTriggerFailed(),
		].flatMap((input) =>
			deriveRunDetails(input).subagents.map((row) => row.status),
		),
	);
	/*
	 * The six states a fixture CAN carry. `paused`, `gone` and an unrecognised
	 * word are deliberately not required here, and it is not an omission: the
	 * fixtures model a live session's `frontend.jobs` (`docs/run-details.md` § 8),
	 * where `paused` and `gone` cannot appear — they arrive on the durable
	 * graph's rows after a restart, which no story reproduces and no frame should
	 * pretend to have photographed. They are covered by the word-level tests
	 * above instead, which is the honest division: a fixture that rendered one
	 * would be asserting a wire shape `JobState` does not have.
	 */
	for (const state of [
		"running",
		"queued",
		"interrupted",
		"done",
		"cancelled",
		"failed",
	]) {
		assert.ok(states.has(state), `no fixture renders a ${state} child`);
	}
});

test("the fixtures cover the omission, suppression and truncation cases", () => {
	const only = deriveRunDetails(fixtures.subagentsOnly());
	const gated = only.subagents.find((row) => row.id === "job-gated");
	// A child that has reported nothing: no cost, no context, no clock.
	assert.equal(gated.costLabel, null);
	assert.equal(gated.contextLabel, null);
	assert.equal(gated.elapsedLabel, null);

	// The default role, suppressed.
	assert.equal(
		only.subagents.find((row) => row.id === "job-readme").role,
		null,
	);

	// A label long enough that a 384px row has to truncate it.
	const long = deriveRunDetails(fixtures.bothInFlight()).subagents[0];
	assert.ok(long.label.length > 40, "no fixture carries a long label");
	// And the numbers run the design's own example uses.
	assert.equal(long.contextLabel, "46%");
	assert.equal(long.costLabel, "$0.31");
	assert.equal(long.elapsedLabel, "1m12s");
});

test("the fixtures cover the flat plan, the failure line and both overflows", () => {
	// A flat plan renders headerless; a phased one keeps its headers.
	assert.equal(deriveRunDetails(fixtures.failure()).todos[0].name, null);
	assert.ok(
		deriveRunDetails(fixtures.todosOnly()).todos.every((phase) => phase.name),
		"the phased fixture lost a phase header",
	);
	// Every item state is in one plan.
	const statuses = new Set(
		deriveRunDetails(fixtures.todosOnly()).todos.flatMap((phase) =>
			phase.items.map((item) => item.status),
		),
	);
	assert.deepEqual(
		[...statuses].sort(),
		["blocked", "done", "dropped", "pending"],
	);
	// The failure's first line survives derivation.
	const failed = deriveRunDetails(fixtures.failure()).subagents.find(
		(row) => row.status === "failed",
	);
	assert.match(failed.errorLine, /^FileNotFoundError:/);

	// Both overflow disclosures, each in the frame that can show it: the roster's
	// in `crowded`, the plan's in `todos-only`, because in the crowded state the
	// plan starts below a six-row roster and its disclosure falls past the panel's
	// own ceiling.
	const crowded = deriveRunDetails(fixtures.crowded());
	assert.equal(visibleSubagents(crowded.subagents).hidden, 3);
	assert.equal(visibleTodoPhases(crowded.todos).hidden, 5);
	assert.equal(
		visibleTodoPhases(deriveRunDetails(fixtures.todosOnly()).todos).hidden,
		5,
	);

	// And the stories that photograph the trigger rather than the panel.
	assert.equal(hasRunDetails(deriveRunDetails(fixtures.settled())), false);
	assert.equal(hasRunDetails(deriveRunDetails(fixtures.headerTrigger())), true);
	assert.equal(
		hasUnseenFailure(deriveRunDetails(fixtures.headerTriggerFailed())),
		true,
	);
});

test("the unseen-failure fixture is a run whose only open fact is a failure", () => {
	const details = deriveRunDetails(fixtures.failureUnseen());
	// Everything settled: no open child, no open to-do. That is the point of the
	// fixture — the trigger stays on screen for the failure clause and nothing
	// else, so the frame is the acknowledgement path D1 broke.
	assert.equal(details.openChildren, 0);
	assert.equal(details.openTodos, 0);
	assert.equal(hasRunDetails(details, NOTHING_SEEN), true);
	assert.equal(
		hasRunDetails(details, new Set(details.failedChildIds)),
		false,
		"the fixture keeps a second reason for the trigger alive",
	);
	// And the run is the all-settled panel `§6.3` describes: no activity line on
	// any row, one exception line verbatim on the failed one.
	assert.deepEqual(
		details.subagents.map((row) => row.activity),
		[null, null],
	);
	assert.equal(
		details.subagents[0].errorLine,
		"FileNotFoundError: [Errno 2] No such file or directory: 'ledger/q1.csv'",
	);
	// The failure's identifier is the datum the mono second line exists to keep,
	// so the fixture must carry one long enough to need the second line.
	assert.ok(details.subagents[0].errorLine.length > 60);
	// A flat, closed plan on top: headerless, and `resolved` reaching the tally.
	assert.equal(details.todos[0].name, null);
	assert.equal(todoTally(details), "3 of 3 resolved · 1 dropped");
});

/* ------------------------------------------------------------------ */
/* The clock                                                           */
/* ------------------------------------------------------------------ */

/*
 * `retimeRunDetails` is the panel's 1Hz tick, and it is the ONE part of this
 * model whose answer depends on when it is asked. The wire gives it nothing to
 * do — `frontend.update` arrives only when the runtime has a delta, and the
 * stream's only periodic frame is a heartbeat the renderer drops — so a running
 * child's clock would otherwise freeze the moment the backend went quiet.
 *
 * What is asserted here is exactly that, and no more: an open child's label
 * moves, a settled one's does not, nothing else in the model moves with it, and
 * a re-measure that changes nothing returns the SAME object — because the tick
 * runs once a second inside the open panel and a fresh object each second would
 * re-render rows that have nothing to say.
 */

test("an open child's clock is re-measured, a settled child's is not", () => {
	const details = derive([
		job({ id: "open", start_time: 1_000 }),
		job({ id: "settled", start_time: 1_000, settled_at: 1_010 }),
	]);
	assert.deepEqual(
		details.subagents.map((row) => row.elapsedLabel),
		["1m", "10s"],
	);
	// Two minutes later, in the model's own clock.
	const later = retimeRunDetails(details, NOW_MS + 120_000);
	assert.deepEqual(
		later.subagents.map((row) => row.elapsedLabel),
		["3m", "10s"],
		"the settled child keeps the duration it settled at",
	);
	// And nothing else about the run moved with the clock: same statuses, same
	// counts, same plan — the tick is a re-measure, not a re-derivation.
	assert.deepEqual(
		later.subagents.map((row) => row.status),
		details.subagents.map((row) => row.status),
	);
	assert.equal(later.openChildren, details.openChildren);
	assert.equal(later.todos, details.todos);
});

test("a child with no launch clock is never given one by a re-measure", () => {
	const details = derive([job({ start_time: 0, settled_at: null })]);
	assert.equal(details.subagents[0].elapsedLabel, null);
	const later = retimeRunDetails(details, NOW_MS + 600_000);
	assert.equal(later.subagents[0].elapsedLabel, null);
	// Nothing moved, so nothing was copied: the panel's rows keep their identity.
	assert.equal(later, details);
});

test("a re-measure that moves no label hands back the same model", () => {
	const settledOnly = derive([
		job({ id: "a", start_time: 1_000, settled_at: 1_010 }),
	]);
	assert.equal(retimeRunDetails(settledOnly, NOW_MS + 60_000), settledOnly);

	// The same holds inside the second: the label carries whole seconds, so a
	// tick that lands 400ms after the model was derived has nothing to say.
	const running = derive([job({ start_time: 1_000 })]);
	assert.equal(retimeRunDetails(running, NOW_MS + 400), running);
});

test("the model records the instant it was measured at, and the real one", () => {
	const pinned = derive([job({})]);
	assert.equal(pinned.measuredAtMs, NOW_MS);
	// The second stamp is a real wall-clock reading, whatever instant the first
	// one names. That is what lets a story pin a fixture's clock and still have
	// its running rows count up while the frame is open — and what keeps the
	// clock off the months between a March fixture and now.
	assert.ok(Math.abs(pinned.measuredAtRealMs - Date.now()) < 5_000);
	const live = deriveRunDetails({ jobs: [], todos: [] });
	assert.ok(Math.abs(live.measuredAtMs - Date.now()) < 5_000);
});
