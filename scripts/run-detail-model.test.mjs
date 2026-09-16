import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
	accumulateSeen,
	activityMark,
	activityTally,
	acknowledgeMcpWhileShown,
	acknowledgeWhileOpen,
	busiestClause,
	childClause,
	childStateLabel,
	deriveMcpServers,
	deriveRunDetails,
	foldBrief,
	hasLiveChildClock,
	hasRunDetails,
	hasUnseenFailure,
	hasUnseenMcpProblem,
	isOpenRow,
	jobClause,
	MCP_COLD_LINE,
	mcpErrorTexts,
	mcpGrantInFlight,
	mcpServersAreCold,
	mcpTally,
	onScreenFailures,
	briefIsInTranscript,
	childOpenable,
	reconcileLaunchTurns,
	retimeChildRow,
	retimeRunDetails,
	tallyBudget,
	runDetailTriggerLabel,
	subagentTally,
	todoTally,
	unseenFailures,
	unseenMcpProblems,
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

const ROOT = process.cwd();

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
	// And the same state arriving the OTHER way — as `_describe`'s own word on a
	// restored row. Without its own case this fell to `unknown`, which is the
	// branch this model reserves for words it has not been taught, and it would
	// have been a word `_describe` can emit.
	assert.equal(folded("queued").status, "queued");
	assert.equal(derive([job({ status: "queued" })]).openChildren, 1);
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
		["running", "queued", "starting", "pausing", "paused"],
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
	/*
	 * Verbatim, but not RAW: the word is painted in the visible tally and in the
	 * row's `sr-only` label, so it goes through the same boundary as the activity
	 * and error lines. A word carrying a newline or a control character would
	 * otherwise break both. (The word still reads as the wire wrote it — this is a
	 * strip, not a translation.)
	 */
	const noisy = derive([
		job({ id: "noisy", status: "reticulating\u0007\nsecond line" }),
	]).subagents[0];
	assert.equal(childStateLabel(noisy), "reticulating");
	assert.equal(
		subagentTally([noisy]),
		"1 reticulating",
		"a machine word must not carry a line break into the tally",
	);
	// A word with nothing readable left in it takes the union's own name for the
	// state rather than rendering an empty segment.
	assert.equal(
		childStateLabel(derive([job({ status: "\u0007\u0000" })]).subagents[0]),
		"unknown",
	);
	/*
	 * The word is reconciled with the FOLD, which reads the WHOLE raw string
	 * (round 4, R4-1). A recognised state plus junk therefore folds to `unknown`
	 * while its first line still names that state — and the surviving word is a
	 * confident, wrong `done` on a row drawn as the question mark, with the tally
	 * stating exactly the count `foldStatus` reserves for words it has NOT been
	 * taught. The four shapes below are the reviewer's reproductions; each asserts
	 * all three surfaces at once, because the defect was one word reaching two of
	 * them (`stateWord` -> the `sr-only` label and the tally).
	 */
	for (const raw of [
		"running\u0007",
		"running\nstarting",
		"done\u0000",
		"paused\nresumed",
	]) {
		const foldedAway = derive([job({ status: raw })]).subagents[0];
		assert.equal(
			foldedAway.status,
			"unknown",
			`${JSON.stringify(raw)} folds to unknown, or this asserts nothing`,
		);
		assert.equal(
			childStateLabel(foldedAway),
			"unknown",
			`the sanitised first line of ${JSON.stringify(raw)} is a state the fold KNOWS, so it cannot be this row's word`,
		);
		assert.equal(
			subagentTally([foldedAway]),
			"1 unknown",
			`and the tally may not state a recognised count for ${JSON.stringify(raw)}`,
		);
	}
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
		job({
			start_time: 0,
			usage: null,
			context_window: null,
			direct_cost: null,
		}),
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
		job({
			status: "running",
			latest_details: { progress: "Running pytest -q" },
		}),
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
		job({
			id: "interrupted",
			status: "interrupted",
			start_time: 700,
			settled_at: 800,
		}),
		job({ id: "done-3", status: "done", start_time: 900, settled_at: 950 }),
		job({ id: "queued", status: "running", queued: true, start_time: 990 }),
		job({
			id: "cancelled",
			status: "cancelled",
			start_time: 810,
			settled_at: 820,
		}),
	]).subagents;
	// running/queued, failed, interrupted, then settled — and within the last rank
	// the newest settled child, not the last one in the array.
	const visible = visibleSubagents(rows);
	assert.deepEqual(
		visible.rows.map((row) => row.id),
		["running", "queued", "failed", "interrupted", "done-3", "cancelled"],
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
	assert.deepEqual(
		ids([
			settled("oldest", 100, 150),
			settled("middle", 200, 250),
			settled("newest", 300, 350),
		]),
		["newest", "middle", "oldest"],
	);
	// The same three rows in the OPPOSITE array order. The index rule returns
	// `oldest, middle, newest` here — the oldest completion on screen and the
	// newest one hidden — and this is the assertion that fails on it.
	assert.deepEqual(
		ids([
			settled("newest", 300, 350),
			settled("oldest", 100, 150),
			settled("middle", 200, 250),
		]),
		["newest", "middle", "oldest"],
	);
	// A settled row is ranked by when it SETTLED, so a child that started last
	// but finished first is the older completion.
	assert.deepEqual(
		ids([settled("late-start", 900, 950), settled("early-start", 100, 990)]),
		["early-start", "late-start"],
	);
	// Simultaneous rows have no “newest” to fall to, so they keep the wire's
	// order: any rule here would be a claim the timestamps do not support.
	assert.deepEqual(
		ids([settled("first", 100, 150), settled("second", 100, 150)]),
		["first", "second"],
	);
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
			job({
				id: `running-${index}`,
				status: "running",
				start_time: 900 + index,
			}),
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

test("the to-dos tally says closed, and names dropped work inside it", () => {
	const details = derive(
		[],
		[
			{
				name: "Plan",
				items: [
					{ text: "a", status: "done" },
					{ text: "b", status: "done" },
					{ text: "c", status: "pending" },
					{ text: "d", status: "dropped" },
				],
			},
		],
	);
	// `closed` is closure — done OR dropped — and it is the word the phase model
	// already uses (`TodoPhaseView.closed`). It replaced `resolved`, which was
	// not merely a second spelling: `3 of 3 resolved · 1 dropped` cannot be
	// checked against the three rows under it when one of them is the dropped one
	// (3 + 1 > 3), which breaks the "every claim checkable" rule the tally exists
	// to serve.
	assert.equal(todoTally(details), "3 of 4 closed · 1 dropped");
	assert.equal(todoTally(details, 14), "3 of 4 closed");
});

/*
 * The tally's budget is derived from the PANE's width, and the case that made it
 * a derivation rather than a constant is the PANE'S FLOOR.
 *
 * `TALLY_BUDGET = 48` was pinned to the 420px default. At `§ 8`'s 320px floor the
 * pane gives the tally ~222px, and the 47-character string below fitted the
 * constant while not fitting the pane — so the model shed nothing and the CSS
 * `truncate` cut the last segment mid-word (`… 1 interr…`), which is the failure
 * clause shedding exists to prevent.
 */
test("the tally budget tracks the pane, and sheds the last segment whole at the floor", () => {
	// Monotonic in the pane's width, and the default is wider than the floor.
	assert.ok(tallyBudget(420) > tallyBudget(320));
	assert.ok(tallyBudget(640) > tallyBudget(420));
	// A sane value at every width the pane can take, and a width that is not a
	// usable number falls back to the design's default rather than poisoning the
	// shed comparison with `NaN` (which would silently disable shedding).
	for (const width of [
		320,
		420,
		640,
		0,
		-1000,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	]) {
		assert.ok(tallyBudget(width) >= 1, String(width));
	}
	assert.equal(tallyBudget(Number.NaN), tallyBudget(420));
	assert.equal(tallyBudget(0), tallyBudget(420));

	const rows = derive([
		job({ id: "a", status: "running" }),
		job({ id: "b", status: "running" }),
		job({ id: "c", status: "queued" }),
		job({ id: "d", status: "failed" }),
		job({ id: "e", status: "interrupted" }),
	]).subagents;
	const full = subagentTally(rows);
	assert.equal(full, "2 running · 1 queued · 1 failed · 1 interrupted");

	// At the floor the budget is short of that string, and what it returns is a
	// prefix of WHOLE segments — never a fragment of one.
	const narrow = subagentTally(rows, tallyBudget(320));
	assert.ok(narrow.length < full.length);
	assert.ok(
		full.startsWith(narrow),
		`${narrow} is a whole-segment prefix of ${full}`,
	);
	assert.equal(narrow, "2 running · 1 queued · 1 failed");
	// The measured failure was the word `interrupted` cut at `interr`; assert the
	// property rather than the string, so a future segment change cannot quietly
	// reintroduce it.
	assert.ok(!narrow.endsWith("interr"));
});

/* ------------------------------------------------------------------ */
/* The child reader's two row rules                                    */
/* ------------------------------------------------------------------ */

test("a child with no session id is not an openable row", () => {
	// `session_id` is what the roster row reads into `childSessionId`; the wire
	// omits it for a job the runtime has not given a durable directory.
	const withId = derive([
		job({ id: "a", status: "running", session_id: "a1b2c3d4e5f6" }),
	]).subagents[0];
	assert.equal(childOpenable(withId), true);
	const withoutId = derive([
		job({ id: "b", status: "queued", sessionId: null }),
	]).subagents[0];
	// The reader is addressed by `(session_id, child_id)`; with no session id
	// there is nothing to address, so the row must not be a control — and the
	// reader has its own terminal line for the paths that can still reach it
	// (the breadcrumb and the sibling stepper).
	assert.equal(withoutId.childSessionId, null);
	assert.equal(childOpenable(withoutId), false);
});

test("the brief is suppressed when the transcript already carries it", () => {
	const brief = "Re-check the pending rows against the ledger.";
	const userRecord = (text) => ({
		kind: "user",
		id: "subagent-launch:job-a",
		ts: 1,
		text,
		images: [],
	});
	// A record whose launch row was NOT reconciled: it still carries the wrapper
	// preamble, so the brief says something the transcript does not, and the
	// fallback § 5.1 chooses is to render it.
	assert.equal(
		briefIsInTranscript(
			[userRecord(`ROLE: reviewer\nTEAM: core\nSYSTEM: preamble…\n\n${brief}`)],
			brief,
		),
		false,
	);
	// The reconciled list — which is what the reader paints — carries the concise
	// prompt as its own user turn, so the block would be the same sentence twice
	// in one pane (`reader-resumed` before the fix).
	const reconciled = reconcileLaunchTurns(
		[userRecord(`ROLE: reviewer\nTEAM: core\n\n${brief}`)],
		{ "subagent-launch:job-a": brief },
	);
	assert.equal(briefIsInTranscript(reconciled, brief), true);
	// A child whose record predates `launch_message_id` matches nothing and keeps
	// the brief: the fallback direction, not a silenced block.
	assert.equal(
		briefIsInTranscript(reconciled, "Some other instruction"),
		false,
	);
	// Non-user rows are not the brief, however they read: only a user turn can be
	// the launch.
	assert.equal(
		briefIsInTranscript(
			[
				{
					kind: "assistant",
					id: "c-a1",
					ts: 1,
					text: brief,
					streaming: false,
					stopReason: null,
					error: false,
				},
			],
			brief,
		),
		false,
	);
	// Nothing to say, or nothing to compare against.
	assert.equal(briefIsInTranscript(reconciled, null), false);
	assert.equal(briefIsInTranscript(reconciled, "   "), false);
	// Whitespace is not a difference a reader can see.
	assert.equal(briefIsInTranscript(reconciled, `  ${brief}\n`), true);
	const wrapped = reconcileLaunchTurns(
		[userRecord(`ROLE: reviewer\nTEAM: core\n\n${brief.replace(" ", "\n")}`)],
		{ "subagent-launch:job-a": brief.replace(" ", "\n") },
	);
	assert.equal(briefIsInTranscript(wrapped, brief), true);
});

/*
 * The wire ABBREVIATES `launch_prompts`, and this is the measured case rather
 * than a hypothetical: the live pairing captured for
 * `docs/evidence/chat-run-panel-live/README.md` delivered a 201-character entry
 * ending `…` while the row's own `prompt` carried all 264, so the reader was
 * painted a truncated launch row under a brief holding the instruction in full
 * and showed both — the duplication the design round objected to, through the
 * one path equality does not cover.
 */
test("a truncated launch row is still the brief", () => {
	const brief =
		"Carry out these four steps IN ORDER, one bash tool call each, then give a one-line summary: (1) bash: sleep 150; (2) bash: wc -l /tmp/lo-live/work/notes.txt; (3) bash: sleep 150; (4) bash: tail -2 /tmp/lo-live/work/notes.txt. Never combine two steps into one call.";
	const truncated = `${brief.slice(0, 200)}…`;
	const records = [
		{
			kind: "user",
			id: "subagent-launch:job-a",
			ts: 1,
			text: truncated,
			images: [],
		},
	];
	assert.equal(briefIsInTranscript(records, brief), true);
	// A record that is a DIFFERENT instruction still leaves the brief standing,
	// even when it shares an opening phrase.
	assert.equal(
		briefIsInTranscript(
			[
				{
					kind: "user",
					id: "c-u1",
					ts: 2,
					text: "Carry out these three steps",
					images: [],
				},
			],
			brief,
		),
		false,
	);
	// And a two-word record is a coincidence, not a copy: the floor.
	assert.equal(
		briefIsInTranscript(
			[{ kind: "user", id: "c-u2", ts: 3, text: "Carry out", images: [] }],
			brief,
		),
		false,
	);
});

/* ------------------------------------------------------------------ */
/* The to-do row budget                                                */
/* ------------------------------------------------------------------ */

const plan = (statuses) => [
	{
		name: "Plan",
		items: statuses.map((status, index) => ({ text: `item ${index}`, status })),
	},
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
	assert.equal(
		visible.phases[0].hidden,
		4,
		"the phase's own hidden count is not attributed",
	);
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
	const visible = visibleTodoPhases(
		deriveRunDetails(fixtures.todosOnly()).todos,
	);
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
	const details = derive([], plan(Array.from({ length: 12 }, () => "pending")));
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
	const flat = derive(
		[],
		plan(["pending"]).map((phase) => ({ ...phase, name: "" })),
	);
	assert.equal(flat.todos[0].name, null);

	const phased = derive(
		[],
		plan(["pending"]).map((phase) => ({ ...phase, name: "Reconcile" })),
	);
	assert.equal(phased.todos[0].name, "Reconcile");

	// A single phase deliberately NAMED "Todos" is the implicit default, so it
	// is the flat case rather than a plan someone named.
	const implicit = derive(
		[],
		plan(["pending"]).map((phase) => ({ ...phase, name: "Todos" })),
	);
	assert.equal(implicit.todos[0].name, null);

	/*
	 * The MIXED case, and this is the § 6.1 finding (2) pinned rather than
	 * described (`§ 11`, risk 4: the single-phase half was already asserted here and
	 * the mixed half was not, so the defect returned unnoticed).
	 *
	 * The wire cannot distinguish an implicit phase from one an agent genuinely
	 * named `Todos`, and the backend lazily creates the implicit one when `add` is
	 * called before any phase was named. A plan that ends up holding BOTH used to
	 * render a `To-dos` section directly above a phase headed `Todos` — the same
	 * plan named twice — because the fold was applied to the whole plan and only
	 * when there was exactly one phase. The fold is per PHASE now.
	 */
	const mixed = derive(
		[],
		[
			{ name: "Todos", items: [{ text: "a", status: "pending" }] },
			{ name: "Publish", items: [{ text: "b", status: "pending" }] },
		],
	);
	assert.deepEqual(
		mixed.todos.map((phase) => phase.name),
		[null, "Publish"],
		"the implicit phase folds wherever it appears, and only it",
	);

	// A named phase in the same position keeps its header: the fix folds the
	// implicit NAME, not every phase.
	const two = derive(
		[],
		[
			{ name: "Reconcile", items: [{ text: "a", status: "pending" }] },
			{ name: "Publish", items: [{ text: "b", status: "pending" }] },
		],
	);
	assert.deepEqual(
		two.todos.map((phase) => phase.name),
		["Reconcile", "Publish"],
	);

	// And a plan of ONE implicit phase is still the back-compat path, byte for
	// byte: the case `test_band_panels.py`'s goldens guard in the TUI, and the
	// case `scripts/run-detail-model.test.mjs` has pinned since the flat plan
	// existed.
	assert.deepEqual(
		flat.todos.map((phase) => phase.name),
		[null],
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
	/*
	 * And the tool-job half of the same question (the architect's D10): without this
	 * clause the pane's quiet branch could read "Nothing in flight." over a Jobs
	 * section that renders rows. It is DEFENSIVE at the only call site — the panel
	 * pushes the section whenever `openJobs > 0` and its quiet line needs
	 * `sections.length === 0` (`run-details-panel.tsx`, whose own comment already
	 * calls that arm defensive) — and it is kept precisely because it is the
	 * predicate's contract rather than a picture of one caller (agent review round
	 * 1, n2).
	 */
	assert.equal(
		hasRunDetails(
			derive([job({ id: "shell", type: "bash", status: "running" })]),
		),
		true,
		"an open tool job is something outstanding",
	);
	assert.equal(
		hasRunDetails(
			derive([
				job({ id: "shell", type: "bash", status: "done", settled_at: 1_010 }),
			]),
		),
		false,
		"a settled tool job is not",
	);
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

test("the panel's OPEN STATE is the whole acknowledgement rule, continuously", () => {
	/*
	 * `§ 3.4`, in one sentence: **while the panel is open, every failed child whose
	 * row is in the rendered slice is acknowledged; when it is closed, nothing is.**
	 *
	 * The popover's rule was bound to two INSTANTS (an open and a close) because a
	 * transient surface is opened and closed. A persistent pane is not, so those two
	 * functions are deleted and this one replaces both: the same union they both
	 * performed, asked on the same slice, evaluated whenever the slice or the open
	 * state changes.
	 *
	 * The property the old design protected is preserved rather than dropped: a
	 * failure that arrives while the panel is open and IS in the slice is
	 * acknowledged because it is genuinely on screen, which is what the dot claims.
	 */
	const first = derive([
		job({ id: "failed-1", status: "failed", start_time: 100, settled_at: 200 }),
	]);
	const opened = acknowledgeWhileOpen(onScreenFailures(first), NOTHING_SEEN);
	assert.deepEqual([...opened], ["failed-1"]);

	// A second failure arriving while the panel is open, IN the slice, is
	// acknowledged by the same continuous evaluation — the row is on screen.
	const both = derive([
		job({ id: "failed-1", status: "failed", start_time: 100, settled_at: 200 }),
		job({ id: "failed-2", status: "failed", start_time: 100, settled_at: 300 }),
	]);
	const grown = acknowledgeWhileOpen(onScreenFailures(both), opened);
	assert.deepEqual([...grown].sort(), ["failed-1", "failed-2"]);
	assert.equal(hasUnseenFailure(both, grown), false);

	// A re-evaluation that adds nothing hands back the SAME set, so the ordinary
	// render — no new failures, panel open — does not churn the trigger's state and
	// does not re-render the header.
	assert.equal(acknowledgeWhileOpen(onScreenFailures(both), grown), grown);
	assert.equal(acknowledgeWhileOpen([], NOTHING_SEEN), NOTHING_SEEN);

	// And nothing is acknowledged while the panel is CLOSED: the rule is stated by
	// the wiring (`if (isRunPanelOpen)` in the trigger), which the source-text test
	// below pins, and the model has no way to acknowledge anything by itself.
	assert.equal(hasUnseenFailure(both, NOTHING_SEEN), true);
});

test("a failure behind the disclosure keeps its dot, and a displaced row keeps its read", () => {
	/*
	 * The slice's boundary and the accumulation's identity, both at once.
	 *
	 * Eight failures at a cap of six is where the reservation runs out of victims,
	 * so the two oldest sit behind the disclosure — the reader has been told a
	 * number, not shown a row, and `§ 3.4` says a failure not in the rendered slice
	 * is not acknowledged.
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
	const shown = onScreenFailures(many);
	assert.deepEqual(shown, visibleFailures(many.subagents));
	assert.equal(shown.length, 6);
	assert.equal(many.failedChildIds.length, 8);

	const afterOpen = acknowledgeWhileOpen(shown, NOTHING_SEEN);
	assert.deepEqual(unseenFailures(many, afterOpen).sort(), [
		"failed-0",
		"failed-1",
	]);
	assert.equal(hasUnseenFailure(many, afterOpen), true);
	// `hasRunDetails` still answers "is anything outstanding", which is what the
	// panel's quiet state reads. It no longer decides whether the button exists.
	assert.equal(hasRunDetails(many, afterOpen), true);

	/*
	 * The defect kept as the counter-example: the roster-derived argument
	 * acknowledges failures the panel never rendered.
	 */
	const rosterDerived = acknowledgeWhileOpen(many.failedChildIds, NOTHING_SEEN);
	assert.equal(hasUnseenFailure(many, rosterDerived), false);

	/*
	 * The displaced row, which is why the acknowledgement ACCUMULATES rather than
	 * reading the slice once: a failure that was on screen and was then pushed out
	 * by later arrivals has still been read, and a set read once at the end would
	 * drop it and re-light a dot the reader had already earned.
	 */
	const first = derive([
		job({ id: "in-view", status: "failed", start_time: 100, settled_at: 200 }),
	]);
	const seenOnce = acknowledgeWhileOpen(onScreenFailures(first), NOTHING_SEEN);
	assert.deepEqual([...seenOnce], ["in-view"]);
	const grownRoster = derive([
		job({ id: "in-view", status: "failed", start_time: 100, settled_at: 200 }),
		...Array.from({ length: 6 }, (_, index) =>
			job({
				id: `later-${index}`,
				status: "failed",
				start_time: 100,
				settled_at: 300 + index,
			}),
		),
	]);
	const displaced = onScreenFailures(grownRoster);
	assert.equal(
		displaced.includes("in-view"),
		false,
		"the slice must have dropped it, or this asserts nothing",
	);
	const seenTwice = acknowledgeWhileOpen(displaced, seenOnce);
	assert.equal(
		seenTwice.has("in-view"),
		true,
		"a row that was read stays read",
	);
});

test("the MCP ledger acknowledges a problem row on the same rule, and a different key space", () => {
	/*
	 * The attention dot's second ledger, and the reason it is a second ledger: one
	 * dot, two facts, and a job id and a server name are both strings in the same
	 * shape, so sharing a VALUE would let a server called `job-ledger` acknowledge a
	 * failed child.
	 */
	const servers = deriveMcpServers([
		{ name: "notion", status: "auth-required" },
		{ name: "files", status: "connected", tool_count: 12 },
		{ name: "slack", status: "disconnected" },
	]);
	assert.deepEqual(unseenMcpProblems(servers).sort(), ["notion", "slack"]);
	assert.equal(hasUnseenMcpProblem(servers), true);

	const seen = acknowledgeWhileOpen(unseenMcpProblems(servers), NOTHING_SEEN);
	assert.deepEqual([...seen].sort(), ["notion", "slack"]);
	assert.equal(hasUnseenMcpProblem(servers, seen), false);

	// A server that BREAKS after the acknowledgement lights it again: the ledger
	// accumulates names, it does not latch the whole section into "read".
	const broken = deriveMcpServers([
		{ name: "notion", status: "auth-required" },
		{ name: "slack", status: "disconnected" },
		{ name: "linear", status: "auth-required" },
	]);
	assert.deepEqual(unseenMcpProblems(broken, seen), ["linear"]);

	// Each ledger is consulted with its OWN set, and neither set answers the other
	// ledger's question. That separation is what the two values buy: the trigger
	// holds `seen` and `seenMcp` side by side, and a server named after a job id
	// could not otherwise acknowledge that child's failure.
	const failDetails = derive([job({ id: "failed-1", status: "failed" })]);
	const failSeen = acknowledgeWhileOpen(
		onScreenFailures(failDetails),
		NOTHING_SEEN,
	);
	assert.deepEqual(unseenFailures(failDetails, failSeen), []);
	assert.deepEqual(unseenMcpProblems(servers, seen), []);
	assert.equal(hasUnseenFailure(failDetails, failSeen), false);
	assert.equal(hasUnseenMcpProblem(servers, seen), false);
});

test("the open period accumulates the slices it showed, and keeps the set's identity", () => {
	/*
	 * `accumulateSeen` is the union every acknowledgement performs — both ledgers,
	 * and the trigger's own continuous evaluation — so its two guarantees are
	 * asserted once here rather than three times through three callers.
	 */
	const seenOnce = accumulateSeen(NOTHING_SEEN, ["a", "b"]);
	assert.deepEqual([...seenOnce].sort(), ["a", "b"]);
	assert.equal(accumulateSeen(seenOnce, ["b"]), seenOnce);
	assert.equal(accumulateSeen(seenOnce, []), seenOnce);
	assert.equal(accumulateSeen(NOTHING_SEEN, []), NOTHING_SEEN);
});

test("the trigger's acknowledgement wiring asks the model's predicate", () => {
	/*
	 * The two tests above pin the MODEL, and a model test could not catch the bug
	 * this round exists for: the wiring was passing a different argument, so
	 * reverting `run-details-trigger.tsx`'s one line to `details.failedChildIds`
	 * left every assertion above green. This file's bundle contains only the model
	 * and the fixtures, so the CALL SITE has to be asserted against the source
	 * text — the same shape as the picker-wiring guard in
	 * `scripts/session-status.test.mjs` (round 4, Q6) and `STRUCTURAL_CALL_SITES`
	 * in `contrast-contract.mjs`: the pairing is only real if the component uses
	 * it.
	 *
	 * Both halves are checked, because either one alone restores the defect: the
	 * OPEN instant must ask `onScreenFailures`, and the open period must
	 * ACCUMULATE the slices it showed (`accumulateSeen`) rather than read them
	 * once.
	 */
	const trigger = readFileSync(
		join(
			ROOT,
			"src/renderer/src/features/chat/components/run-details/run-details-trigger.tsx",
		),
		"utf8",
	);
	assert.match(
		trigger,
		/acknowledgeWhileOpen\(onScreenFailures\(details\), seen\)/,
		"the acknowledgement must ask the panel's own slice",
	);
	assert.match(
		trigger,
		/if \(details && listOnScreen\) \{/,
		"the acknowledgement must be gated on the LIST being on screen, not on the pane being open",
	);
	assert.match(
		trigger,
		/if \(readerChildId\) \{/,
		"and a reader acknowledges only the child it is showing",
	);
	assert.doesNotMatch(
		trigger,
		/acknowledgeWhileOpen\(\s*details\?\.failedChildIds/,
		"and never the whole roster, which marks hidden failures read",
	);
	/*
	 * The MCP ledger's own call: `prune, then union` (`§ 7.3`), so a server
	 * acknowledged while broken and then repaired can announce itself again instead
	 * of staying silent forever.
	 */
	assert.match(
		trigger,
		/acknowledgeMcpWhileShown\(mcpServers, seenMcp\)/,
		"the MCP ledger must acknowledge the rows the section renders, on the re-arm rule",
	);
	assert.match(
		trigger,
		/mcpProblems,\s*\}\)/,
		"and the label must be given the problem count it is naming",
	);
	/*
	 * The deleted pair, asserted as absent rather than assumed gone: `§ 3.4`
	 * removes both instants because a persistent pane is not opened or closed, and
	 * a file that still carried them would be two rules for one dot again.
	 */
	assert.doesNotMatch(trigger, /acknowledgedOn(Open|Close)/);
	assert.doesNotMatch(trigger, /viewedRef/);
});

test("the panel renders the slice the acknowledgement predicates count", () => {
	/*
	 * The OTHER end of the pairing the test above pins. The model can only promise
	 * that the dot answers the rows the reader could see if the section renders that
	 * same slice: a panel-side filter or cap restores the divergence with every
	 * model assertion in this file green, because the model is then asked about a
	 * slice the component never rendered.
	 *
	 * The slice has ONE entry point (`panelSlice`), and the disclosure is the only
	 * thing allowed to move its cap: `§ 4` item 3 makes `+N more` a control that
	 * "raises the cap to a stated larger bound", so the expanded call is pinned here
	 * as passing the roster's own length — every row, in the same priority order —
	 * rather than a second constant that could drift from the priority rule.
	 *
	 * What the expanded case does NOT do is widen the dot's slice: `§ 3.4` fixes the
	 * rendered slice as the capped `panelSlice`, so a failure revealed only by
	 * expanding keeps its dot. That is a design decision, not an accident here, and
	 * `panelSlice`'s own parameter comment says so.
	 */
	const panel = readFileSync(
		join(
			ROOT,
			"src/renderer/src/features/chat/components/run-details/run-detail-subagents.tsx",
		),
		"utf8",
	);
	assert.match(
		panel,
		/const \{ rows, hidden \} = panelSlice\(\s*details\.subagents,\s*expanded \? details\.subagents\.length : undefined,\s*\)/,
		"the section must render the model's own slice, not one it narrows itself",
	);
	assert.doesNotMatch(
		panel,
		/visibleSubagents\(/,
		"slicing the roster at the panel is how the two ends drift apart",
	);
});

test("the clock ticks only for a child that has a running clock", () => {
	// The predicate that justifies the 1Hz timer, extracted from the hook so the
	// claim is asserted rather than described: a settled child is measured
	// against its own `settled_at` and a child with no launch time shows no
	// duration, so neither can go stale and neither can pay for a timer.
	assert.equal(
		hasLiveChildClock(derive([job({ status: "running" })]).subagents),
		true,
	);
	assert.equal(
		hasLiveChildClock(
			derive([job({ status: "running", queued: true })]).subagents,
		),
		true,
	);
	assert.equal(
		hasLiveChildClock(
			derive([job({ status: "done", settled_at: 1_050 })]).subagents,
		),
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
		hasLiveChildClock(
			derive([job({ status: "running", start_time: 0 })]).subagents,
		),
		false,
	);
	assert.equal(hasLiveChildClock([]), false);
});

/* ------------------------------------------------------------------ */
/* Trigger copy                                                        */
/* ------------------------------------------------------------------ */

test("the tooltip carries counts, pluralised honestly, and names the ACTION", () => {
	/*
	 * `§ 3.3` fixes the verb and it is the toggle's own state: a control that names
	 * the surface rather than the action tells a reader that pressing it opens
	 * something they are already looking at.
	 */
	const both = derive(
		[job({ id: "a" }), job({ id: "b" })],
		plan(["pending", "pending", "pending", "pending"]),
	);
	assert.equal(
		runDetailTriggerLabel(both),
		"Open run details — 2 subagents running, 4 to-dos open",
	);

	const one = derive([job({ id: "a" })], plan(["pending"]));
	assert.equal(
		runDetailTriggerLabel(one),
		"Open run details — 1 subagent running, 1 to-do open",
	);

	const children = derive([job({ id: "a" }), job({ id: "b" })]);
	assert.equal(
		runDetailTriggerLabel(children),
		"Open run details — 2 subagents running",
	);

	const todos = derive([], plan(["pending", "pending", "pending"]));
	assert.equal(
		runDetailTriggerLabel(todos),
		"Open run details — 3 to-dos open",
	);

	/*
	 * The tool jobs are a clause of their own, between the children and the plan:
	 * one noun per list, never a summed "3 jobs" that would put a delegated child
	 * and a `sleep 150` under one word the app does not use. The order is the
	 * composer's own, so the tooltip and the chips one line below it rank the same
	 * three facts the same way.
	 */
	const jobs = derive(
		[
			job({ id: "shell", type: "bash", status: "running" }),
			job({ id: "shell-2", type: "bash", status: "running" }),
		],
		plan(["pending"]),
	);
	assert.equal(
		runDetailTriggerLabel(jobs),
		"Open run details — 2 jobs running, 1 to-do open",
	);

	const allThree = derive(
		[job({ id: "a" }), job({ id: "shell", type: "bash", status: "running" })],
		plan(["pending"]),
	);
	assert.equal(
		runDetailTriggerLabel(allThree),
		"Open run details — 1 subagent running, 1 job running, 1 to-do open",
	);

	// One job, pluralised by the model and not by the caller.
	assert.equal(
		runDetailTriggerLabel(
			derive([job({ id: "shell", type: "bash", status: "running" })]),
		),
		"Open run details — 1 job running",
	);

	const failed = derive([job({ id: "a", status: "failed" })]);
	assert.equal(
		runDetailTriggerLabel(failed),
		"Open run details — 1 subagent failed",
	);

	// The open pane names the OTHER action, and keeps the counts: the clause list is
	// about the run, and it is as true while the pane is open as while it is shut.
	assert.equal(
		runDetailTriggerLabel(both, NOTHING_SEEN, { open: true }),
		"Close run details — 2 subagents running, 4 to-dos open",
	);
	// With nothing to say the label is the action ALONE, which is the copy § 3.3
	// fixes for the idle state.
	assert.equal(runDetailTriggerLabel(derive([], [])), "Open run details");
	assert.equal(
		runDetailTriggerLabel(derive([], []), NOTHING_SEEN, { open: true }),
		"Close run details",
	);
	/*
	 * A SETTLED plan adds nothing to the trigger, and it stays that way now that
	 * the settled case has its own copy. The trigger answers "is anything asking
	 * for something right now?" (`hasRunDetails`), and a plan that ended is not;
	 * the composer chip states the outcome, the trigger states what is
	 * outstanding. Both settled spellings are pinned so a future reader sees the
	 * decision rather than having to infer it from a guard.
	 */
	assert.equal(
		runDetailTriggerLabel(derive([], plan(["done", "done"]))),
		"Open run details",
	);
	assert.equal(
		runDetailTriggerLabel(derive([], plan(["done", "dropped"]))),
		"Open run details",
	);
});

test("the tooltip sheds whole clauses, never half of one, and keeps what the dot means", () => {
	const details = derive(
		[job({ id: "a" }), job({ id: "b" })],
		plan(["pending", "pending", "pending", "pending"]),
	);
	assert.equal(
		runDetailTriggerLabel(details, NOTHING_SEEN, { maxChars: 40 }),
		"Open run details — 2 subagents running",
	);
	assert.equal(
		runDetailTriggerLabel(details, NOTHING_SEEN, { maxChars: 60 }),
		"Open run details — 2 subagents running, 4 to-dos open",
	);
	/*
	 * Below the first clause's own width the label stays whole rather than
	 * truncating: a clause cut mid-sentence states a count and hides its noun. The
	 * VERB may never be shed either — a control whose name lost its action names
	 * nothing — so the floor is `Open run details` plus its first clause.
	 */
	assert.equal(
		runDetailTriggerLabel(details, NOTHING_SEEN, { maxChars: 5 }),
		"Open run details — 2 subagents running",
	);

	/*
	 * `§ 3.4`: the two ATTENTION clauses — an unseen failure and an MCP problem —
	 * are the LAST the budget may shed, because a lit dot whose accessible name lost
	 * its reason is unreadable to the reader who cannot see the dot. They lead the
	 * clause list and survive a budget that cannot hold the counts.
	 */
	const attention = derive(
		[job({ id: "failed", status: "failed" }), job({ id: "b" })],
		plan(["pending", "pending", "pending", "pending"]),
	);
	assert.equal(
		runDetailTriggerLabel(attention, NOTHING_SEEN, { mcpProblems: 1 }),
		"Open run details — 1 subagent failed, 1 MCP server needs attention, 1 subagent running, 4 to-dos open",
	);
	assert.equal(
		runDetailTriggerLabel(attention, NOTHING_SEEN, { mcpProblems: 2 }),
		"Open run details — 1 subagent failed, 2 MCP servers need attention, 1 subagent running, 4 to-dos open",
	);
	const tight = runDetailTriggerLabel(attention, NOTHING_SEEN, {
		mcpProblems: 1,
		maxChars: 80,
	});
	assert.match(tight, /1 subagent failed/);
	assert.match(tight, /1 MCP server needs attention/);
	assert.doesNotMatch(tight, /4 to-dos open/);

	// No MCP problem and no failure is the ordinary label: the clause appears only
	// when it has something to say.
	assert.equal(
		runDetailTriggerLabel(derive([job({ id: "a" })]), NOTHING_SEEN, {
			mcpProblems: 0,
		}),
		"Open run details — 1 subagent running",
	);
});

test("a seen failure is dropped from the label", () => {
	const details = derive([job({ id: "failed-1", status: "failed" })]);
	assert.equal(
		runDetailTriggerLabel(details, new Set(["failed-1"])),
		"Open run details",
	);
});

/* ------------------------------------------------------------------ */
/* The reader's own rows                                               */
/* ------------------------------------------------------------------ */

test("the reader's fields are read off the row the roster already has", () => {
	/*
	 * `§ 4`: the reader's needs add fields to `SubagentRow`, and every one of them is
	 * read off the job row that ALREADY arrives — no wire change. The test asserts
	 * that rather than the fact that fields exist, because the value of the claim is
	 * that nothing new has to be published for the reader to work.
	 */
	const row = derive([
		job({
			id: "job-child",
			session_id: "a1b2c3d4e5f6",
			parent_job_id: "job-parent",
			model_label: "claude-opus-5",
			prompt: "Investigate the ledger\nand report",
			launch_message_id: "subagent-launch:job-child",
			launch_prompts: { "subagent-launch:job-child": "Check the ledger" },
			result_text: "  done  ",
		}),
	]).subagents[0];
	assert.equal(row.childSessionId, "a1b2c3d4e5f6");
	assert.equal(row.parentJobId, "job-parent");
	assert.equal(row.modelLabel, "claude-opus-5");
	// The brief prefers the CONCISE authored prompt of the current launch, and
	// falls back to the row's own `prompt` (`frontend_state.py:1413`, `:1461-1486`).
	assert.equal(row.brief, "Check the ledger");
	assert.deepEqual(row.launchPrompts, {
		"subagent-launch:job-child": "Check the ledger",
	});
	assert.equal(row.launchMessageId, "subagent-launch:job-child");
	assert.equal(row.resultText, "done");

	// A row from a runtime that predates the launch fields degrades to the prompt,
	// which is the safe direction: the reader keeps its brief and reconciles
	// nothing.
	const old = derive([
		job({
			id: "job-old",
			prompt: "Read the export",
			session_id: "abcdefabcdef",
		}),
	]).subagents[0];
	assert.equal(old.brief, "Read the export");
	assert.deepEqual(old.launchPrompts, {});
	assert.equal(old.launchMessageId, "");

	// `errorLine` stays the roster's one-line summary; `errorText` is the whole
	// thing, for the reader's outcome block.
	const failed = derive([
		job({
			id: "job-fail",
			status: "failed",
			error_text: "ValueError: bad row\n  line 12",
		}),
	]).subagents[0];
	assert.equal(failed.errorLine, "ValueError: bad row");
	assert.equal(failed.errorText, "ValueError: bad row\n  line 12");

	// Nothing reported is absent, never an empty string: the roster's omission rule
	// applies to the reader's fields too.
	const bare = derive([job({ id: "job-bare" })]).subagents[0];
	assert.equal(bare.childSessionId, null);
	assert.equal(bare.parentJobId, null);
	assert.equal(bare.modelLabel, null);
	assert.equal(bare.brief, null);
	assert.equal(bare.resultText, null);
	assert.equal(bare.errorText, null);
});

test("a child's child count comes from the lineage's own edges", () => {
	/*
	 * `childCount` is derived by grouping on `parent_job_id` rather than read from
	 * the wire: a published count would be a second statement of what the lineage
	 * already says, and two statements can disagree.
	 *
	 * Counted over the LINEAGE, and the roster is what makes that visible: this
	 * payload's only top-level child is `parent`, and `parent`'s control must still
	 * be able to say `2 children` about two rows the roster does not list.
	 */
	const details = derive([
		job({ id: "parent", status: "running" }),
		job({ id: "kid-1", status: "running", parent_job_id: "parent" }),
		job({ id: "kid-2", status: "done", parent_job_id: "parent" }),
		job({
			id: "grandchild",
			status: "running",
			parent_job_id: "kid-1",
		}),
	]);
	const byId = new Map(details.lineage.map((row) => [row.id, row]));
	assert.equal(byId.get("parent").childCount, 2);
	assert.equal(byId.get("kid-1").childCount, 1);
	assert.equal(byId.get("kid-2").childCount, 0);
	// A root child's parent is absent rather than an empty string, so the walk up
	// the lineage stops on a real value.
	assert.equal(byId.get("parent").parentJobId, null);
	assert.equal(byId.get("grandchild").parentJobId, "kid-1");
	// The roster is the members alone, and every descendant stays on the lineage —
	// which is what the reader walks (`§ 4`, `§ 5.5`).
	assert.deepEqual(
		details.subagents.map((row) => row.id),
		["parent"],
	);
	assert.deepEqual(
		details.lineage.map((row) => row.id),
		["parent", "kid-1", "kid-2", "grandchild"],
	);
});

test("the launch turn is reconciled, and only the ids the map vouches for", () => {
	/*
	 * `§ 5.1`: without this the reader opens on the full role/team/system preamble,
	 * because the durable launch row carries it and the row's id IS the launch's
	 * message id (`session/transcript.py:656-672`).
	 */
	const records = [
		{
			kind: "user",
			id: "subagent-launch:job-1",
			ts: 1,
			text: "ROLE/TEAM/SYSTEM…",
			images: [],
		},
		{
			kind: "assistant",
			id: "a",
			ts: 2,
			text: "working",
			streaming: false,
			complete: true,
		},
	];
	const reconciled = reconcileLaunchTurns(records, {
		"subagent-launch:job-1": "Check the March ledger",
	});
	assert.equal(reconciled[0].text, "Check the March ledger");
	// Only USER rows are rewritten: the same id on another kind is not a launch turn.
	assert.equal(reconciled[1].text, "working");

	// An id the map does not carry is left exactly as it is — duplicating wrapper
	// text is the TUI's chosen failure mode and it is the safer direction.
	const untouched = reconcileLaunchTurns(records, {
		"subagent-launch:other": "x",
	});
	assert.equal(untouched, records, "an unreconciled list keeps its identity");

	// And a list where nothing changed keeps its identity too, so the reader's
	// memoised transcript does not repaint every row on every pulse.
	assert.equal(
		reconcileLaunchTurns(reconciled, {
			"subagent-launch:job-1": "Check the March ledger",
		}),
		reconciled,
	);
});

test("the brief folds to a summary that states what expanding costs", () => {
	/*
	 * `§ 5.1` ports the TUI's rule: at most a handful of rows, with the hidden count
	 * stated, because `⟨expand⟩` alone cannot distinguish two more lines from fifty
	 * (`subagent_view.py:1053-1073`).
	 */
	const short = foldBrief("one\ntwo");
	assert.deepEqual(short.lines, ["one", "two"]);
	assert.equal(short.hidden, 0);

	const long = foldBrief(
		Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"),
	);
	assert.equal(long.lines.length, 6);
	assert.equal(long.hidden, 4);

	// A child with no brief has nothing to fold, and the block renders as absence.
	assert.deepEqual(foldBrief(null), { lines: [""], hidden: 0 });
});

/* ------------------------------------------------------------------ */
/* MCP servers                                                         */
/* ------------------------------------------------------------------ */

test("every MCP state the wire reports is folded explicitly, and carried verbatim", () => {
	const rows = deriveMcpServers([
		{ name: "notion", status: "auth-required" },
		{ name: "files", status: "connected", tool_count: 12 },
		{ name: "slack", status: "connecting" },
		{ name: "legacy", status: "disconnected" },
		{ name: "odd", status: "reticulating" },
	]);
	const byName = new Map(rows.map((row) => [row.name, row]));

	/*
	 * The predicate is a NEGATIVE (`§ 7.3`): everything that is not `connected`,
	 * `connecting` or `cold` is a problem — including a word this build has never
	 * been taught. The positive two-word list this replaced carries the defect the
	 * TUI band recorded on this same data, where an equality test on
	 * `disconnected` stopped counting an auth-blocked server the moment the
	 * vocabulary grew.
	 */
	assert.deepEqual(
		rows.filter((row) => row.problem).map((row) => row.name),
		["legacy", "notion", "odd"],
	);
	assert.deepEqual(byName.get("notion").remedy, { kind: "grant" });
	assert.deepEqual(byName.get("legacy").remedy, { kind: "reconnect" });

	// `connecting` is not a failure — the same way a queued child is not one — and
	// lighting for it would make a red lamp the normal boot.
	assert.equal(byName.get("slack").problem, false);

	// The unrecognised word takes attention and gets NO remedy: the renderer must
	// not claim a `danger` failure it cannot name, and a fix for a word it cannot
	// name would be a guess. (The quiet INK is the component's, via `MCP_INK`'s
	// fallback.)
	assert.equal(byName.get("odd").status, "reticulating");
	assert.equal(byName.get("odd").remedy, null);

	// The tool count is a connected server's reach, and nothing else's: a
	// disconnected server's last-known count would claim tools it is not serving.
	assert.equal(byName.get("files").toolCount, 12);
	assert.equal(byName.get("notion").toolCount, null);

	// Sorted by name so a refetch cannot reorder the list under a reader.
	assert.deepEqual(
		rows.map((row) => row.name),
		["files", "legacy", "notion", "odd", "slack"],
	);
});

test("the cold payload is the SECTION's state, and lights nothing", () => {
	/*
	 * The route's cold branch stamps `status: "cold"` on every configured server
	 * (`desktop_lifecycle.py:111-134`). `cold` is not a problem — no runtime attached
	 * is a fact about the session, not a fault of the server — and it is not a ROW
	 * state either: the section says it once in place of its tally, because N copies
	 * of one jargon word plus a `0 of N connected` tally would claim three servers
	 * are down when none was asked to be up.
	 */
	const rows = deriveMcpServers([
		{ name: "notion", status: "cold" },
		{ name: "files", status: "cold" },
	]);
	assert.deepEqual(
		rows.map((row) => row.status),
		["cold", "cold"],
	);
	assert.equal(
		rows.some((row) => row.problem),
		false,
		"a cold payload lights no dot",
	);
	assert.equal(
		rows.some((row) => row.toolCount !== null),
		false,
		"and claims no tools, because nothing was checked",
	);
	assert.equal(mcpServersAreCold(rows), true);
	// A MIXED payload is not cold: the section's one line would then be a lie about
	// the rows that WERE checked.
	assert.equal(
		mcpServersAreCold(
			deriveMcpServers([
				{ name: "a", status: "cold" },
				{ name: "b", status: "connected" },
			]),
		),
		false,
	);
	assert.equal(mcpServersAreCold([]), false);
});

test("the MCP ledger prunes to what is still broken, so a healed server can speak again", () => {
	/*
	 * `§ 7.3`'s re-arm rule, and the reason this ledger needs one at all: its key is
	 * a NAME, which outlives the problem. A server acknowledged while
	 * `auth-required`, later repaired, then broken again, would stay silent forever
	 * under a union that never subtracts — and no frame of a correctly-quiet dot can
	 * distinguish "acknowledged" from "never re-armed", which is why the rule is
	 * pinned here rather than hoped for.
	 */
	const broken = deriveMcpServers([
		{ name: "notion", status: "auth-required" },
		{ name: "slack", status: "disconnected" },
	]);
	const seenOnce = acknowledgeMcpWhileShown(broken, NOTHING_SEEN);
	assert.deepEqual([...seenOnce].sort(), ["notion", "slack"]);
	assert.deepEqual(unseenMcpProblems(broken, seenOnce), []);
	// Re-evaluating with the same rows adds nothing and keeps the set's identity.
	assert.equal(acknowledgeMcpWhileShown(broken, seenOnce), seenOnce);

	// `notion` recovers: it leaves the ledger, so its name is no longer held.
	const healed = deriveMcpServers([
		{ name: "notion", status: "connected", tool_count: 3 },
		{ name: "slack", status: "disconnected" },
	]);
	const afterHeal = acknowledgeMcpWhileShown(healed, seenOnce);
	assert.deepEqual([...afterHeal], ["slack"], "the healed server is forgotten");

	// And it breaks AGAIN: the dot must speak. This is the assertion the whole rule
	// exists for — under a union it would be silent, and nothing on screen would say
	// so.
	const brokenAgain = deriveMcpServers([
		{ name: "notion", status: "auth-required" },
		{ name: "slack", status: "disconnected" },
	]);
	assert.deepEqual(unseenMcpProblems(brokenAgain, afterHeal), ["notion"]);
	assert.equal(hasUnseenMcpProblem(brokenAgain, afterHeal), true);

	// The child ledger deliberately has NO such rule: a job id names one episode, so
	// a set that never subtracts is exactly right for it.
	const child = derive([job({ id: "job-x", status: "failed" })]);
	const childSeen = acknowledgeWhileOpen(onScreenFailures(child), NOTHING_SEEN);
	assert.equal(hasUnseenFailure(child, childSeen), false);
});

test("an MCP payload is folded tolerantly, and a nameless row is dropped", () => {
	// The payload is JSON off a backend that may be older or newer than this
	// renderer, so a row missing everything still renders as a named server in an
	// unknown state rather than throwing.
	const [bare] = deriveMcpServers([{ name: "bare" }]);
	assert.equal(bare.status, "cold");
	assert.equal(bare.problem, false);
	assert.equal(bare.scope, null);

	// A nameless row cannot be pointed at, and a nameless "problem" would light a
	// dot no surface could acknowledge.
	assert.deepEqual(
		deriveMcpServers([{ status: "disconnected" }, { name: "" }]),
		[],
	);
	// A payload that is not a list at all is no servers, not a crash.
	assert.deepEqual(deriveMcpServers(null), []);
	assert.deepEqual(deriveMcpServers({ servers: [] }), []);

	// The scope qualifier falls back from the owned scope to the config source.
	const [scoped] = deriveMcpServers([
		{
			name: "s",
			status: "connected",
			owned_scope: "project",
			source: "global",
		},
	]);
	assert.equal(scoped.scope, "project");
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
			/*
			 * The three states a LIVE session's `frontend.jobs` cannot produce: they
			 * arrive on the durable graph's restored rows, or from a runtime this
			 * renderer has not been taught. The fixture carries them the way the wire
			 * does — as the graph's own status WORD on the row
			 * (`getattr(node, "status", "gone")`), not as a `paused` FIELD, which
			 * `JobState` does not have — so the frame that photographs their marks
			 * asserts nothing the wire cannot produce.
			 *
			 * They were covered by the word-level tests ALONE until round 3, which
			 * left three of `§6.4`'s nine marks unphotographed — and `paused` decides
			 * whether the trigger exists at all (a restored pause is open work,
			 * `§3.3`).
			 */
			fixtures.restoredAndUnrecognised(),
		].flatMap((input) =>
			deriveRunDetails(input).subagents.map((row) => row.status),
		),
	);
	/* All nine, because all nine are renderable and `§6.4` claims a mark for each. */
	for (const state of [
		"running",
		"queued",
		"paused",
		"interrupted",
		"done",
		"cancelled",
		"gone",
		"unknown",
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
	assert.deepEqual([...statuses].sort(), [
		"blocked",
		"done",
		"dropped",
		"pending",
	]);
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
	// A flat, closed plan on top: headerless, and `closed` reaching the tally.
	assert.equal(details.todos[0].name, null);
	assert.equal(todoTally(details), "3 of 3 closed · 1 dropped");
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

/* ------------------------------------------------------------------ */
/* The roster's membership (`§ 4`)                                     */
/* ------------------------------------------------------------------ */

test("the roster is the session's sub-agents, not its job ledger", () => {
	/*
	 * `frontend.jobs` is `comms.job_rows()`: the ROOT session's job manager plus
	 * every live child's (`harness/comms.py:799-824`), so the list carries the
	 * children's own tool calls — and the session's own — beside the children
	 * themselves. QA's live capture read
	 * `c1ccfe6839cb bash running "bash: sleep 150 ; echo child-done"` beside the
	 * one real delegated child, and the roster painted both: `2 running`, with the
	 * bash row sorted above the child it belonged to (round 1, Q1/U1-4).
	 *
	 * Membership is a filter on the row's own `type`, which the wire already
	 * stamps: a delegated child is `task`, a tool job carries the tool's NAME.
	 */
	const details = derive([
		job({ id: "child", status: "running", label: "Audit the invoices" }),
		job({
			id: "tool",
			type: "bash",
			status: "running",
			label: "bash: sleep 150 ; echo child-done",
		}),
	]);
	assert.deepEqual(
		details.subagents.map((row) => row.id),
		["child"],
		"a child's own tool call is not a sub-agent",
	);
	assert.equal(
		details.openChildren,
		1,
		"the tally counts members, not rows on the wire",
	);
	assert.equal(subagentTally(details.subagents), "1 running");
	// A row that does not SAY what it is is KEPT: a runtime this renderer has not
	// been taught must not have its children silently dropped, and a lost child is
	// the worse of the two failures (over-reporting is the one this rule stops).
	const untyped = derive([{ id: "child", status: "running", label: "Audit" }]);
	assert.deepEqual(
		untyped.subagents.map((row) => row.id),
		["child"],
	);
});

test("the tool jobs are the partition's other half, and no row lands in both lists", () => {
	/*
	 * `docs/composer-activity-chips.md` § 4: the rows the roster excludes are the
	 * session's own activity, so they are the composer's jobs chip and the pane's
	 * Jobs section — which is why the membership FILTER became a PARTITION. The
	 * assertion is over ids rather than counts, so a row claimed by both lists
	 * fails here instead of being painted twice.
	 */
	const details = derive([
		job({ id: "child", status: "running", label: "Audit the invoices" }),
		job({
			id: "shell",
			type: "bash",
			status: "running",
			label: "bash: sleep 150 ; echo child-done",
		}),
		job({
			id: "shell-done",
			type: "bash",
			status: "succeeded",
			settled_at: 1_010,
		}),
		job({ id: "unknown-type", type: "reticulate", status: "running" }),
	]);
	assert.deepEqual(
		details.subagents.map((row) => row.id),
		["child"],
	);
	assert.deepEqual(
		details.jobs.map((row) => row.id),
		["shell", "shell-done"],
		"a bash row is a tool job, settled or not: the LIST is the whole partition, and the slice is the consumer's",
	);
	assert.equal(details.openChildren, 1);
	assert.equal(details.openJobs, 1, "a settled tool row is not open work");
	/*
	 * The third case: a `type` this renderer has not been taught is claimed by
	 * NEITHER list. It is the other half of the row above's caution — an unknown row
	 * may be a child, and it may not be a shell job — and the failure it prevents is
	 * a row under a heading whose tally does not count it.
	 */
	assert.equal(
		details.subagents.some((row) => row.id === "unknown-type"),
		false,
	);
	assert.equal(
		details.jobs.some((row) => row.id === "unknown-type"),
		false,
	);
	/*
	 * And the derived tool row is the ROSTER's row shape, off the same
	 * `deriveChild`: label, status mark, elapsed. Nothing about it is a second
	 * vocabulary — which is what lets one `SubagentRowBody` draw both lists.
	 */
	assert.equal(details.jobs[0].label, "bash: sleep 150 ; echo child-done");
	assert.equal(details.jobs[0].status, "running");
	/*
	 * The settled row is settled by the model's own predicate, which is the only
	 * property the Jobs section and the chip's count read — and the wire word it was
	 * settled BY does not matter here: `succeeded` is not in `foldStatus`'s
	 * vocabulary, so this row folds to `unknown` (settled, quiet, `CircleHelp`).
	 * That is the fold's business and not this partition's, and it is not reachable
	 * through this change either — the Jobs section draws the OPEN rows only — so it
	 * is recorded in the PR rather than repaired here.
	 */
	assert.equal(isOpenRow(details.jobs[1]), false);
});

test("an activity mark exists exactly when its count is positive", () => {
	/*
	 * The composer's two activity chips gate on their MARK rather than on the number
	 * they print, and the whole justification for that is this equivalence: the mark
	 * and the count are derived from ONE predicate (`isOpenRow`), so "the chip
	 * renders" and "the number is positive" cannot come apart. Pinned over a matrix
	 * of wire shapes, including the ones that are settled — a chip over a session
	 * whose only rows are done would be the `0 subagents running` this design
	 * refuses (`§ 5`).
	 */
	const cases = [
		[],
		[job({ status: "done" })],
		[job({ status: "failed" })],
		[job({ status: "running" })],
		[job({ status: "running", queued: true })],
		[job({ status: "paused" })],
		[job({ type: "bash", status: "running" })],
		[job({ type: "bash", status: "succeeded", settled_at: 1_010 })],
		[
			job({ id: "open", status: "running" }),
			job({ id: "settled", type: "bash", status: "done", settled_at: 1_010 }),
		],
	];
	for (const jobs of cases) {
		const details = derive(jobs);
		assert.equal(
			activityMark(details.subagents) !== null,
			details.openChildren > 0,
		);
		assert.equal(activityMark(details.jobs) !== null, details.openJobs > 0);
	}
});

test("the sentence and the mark are one derivation, for every open state", () => {
	/*
	 * Design review round 1's D1 and UX's U4 are the same defect: the chips printed
	 * "N running" for any unsettled row while the mark beside them drew `Clock` for a
	 * capacity-queued child or `CirclePause` for a parked one, and the mark is
	 * `aria-hidden` — so the WORDS were the only thing assistive tech got, and they
	 * said a parked child was working.
	 *
	 * The fix is that a clause cannot be handed a bare number at all: `childClause`
	 * and `jobClause` take an `ActivityTally`, which is the count and the mark
	 * DERIVED TOGETHER, so there is no way to state a state the glyph denies. This
	 * case drives every open state the ladder can return and asserts the sentence's
	 * last word IS the mark, rather than listing the expected strings in a second
	 * place that could drift from the ladder.
	 */
	const cases = [
		[{ status: "running" }, "running"],
		[{ status: "running", queued: true }, "queued"],
		[{ status: "paused" }, "paused"],
		// A running sibling outranks a parked one, so the CLAUSE follows the mark up
		// the ladder rather than describing whichever row the wire listed first.
		[null, "running"],
	];
	for (const [state, word] of cases) {
		const rows =
			state === null
				? [
						job({ id: "parked", status: "paused" }),
						job({ id: "busy", status: "running" }),
					]
				: [job(state)];
		const tally = activityTally(derive(rows).subagents);
		assert.equal(tally.mark, word);
		/*
		 * WHICH WORD THE SENTENCE ENDS IN DEPENDS ON WHETHER THE SET IS UNIFORM, and
		 * that is design review round 2's D6: with a parked row beside a running one,
		 * the mark's own word beside the OPEN total claimed work that was not
		 * happening (the chip read `40 subagents running` while the pane read
		 * `15 running · 25 queued · 17 interrupted · 5 done`). The state word is the
		 * uniform case's; the family word is the mixed case's, and the busiest state
		 * moves to the strings with room for it.
		 */
		if (tally.markCount === tally.count) {
			assert.ok(
				childClause(tally).endsWith(word),
				`"${childClause(tally)}" must end in the mark's own state`,
			);
			assert.equal(
				busiestClause(tally),
				"",
				"a uniform set has no second state",
			);
		} else {
			assert.ok(
				childClause(tally).endsWith("open"),
				`"${childClause(tally)}" must be the family's word when the set is mixed`,
			);
			assert.ok(
				busiestClause(tally).endsWith(word),
				`"${busiestClause(tally)}" must name the busiest state's own word`,
			);
		}
		// The count is the same predicate the gate and `openChildren` use.
		assert.equal(tally.count, derive(rows).openChildren);
	}
	/*
	 * ...and the shape QA measured live, which is the one that found this: fifteen
	 * running with the rest parked behind the fifteen-job pool
	 * (`DEFAULT_MAX_RUNNING_JOBS = 15`). The open total is whole, the WORD is the
	 * family's, and only the accessible name carries the running count - the numbers
	 * the pane states in its own tally, spelled the one way that cannot contradict
	 * it.
	 */
	const fanOut = derive([
		...Array.from({ length: 15 }, (_, i) =>
			job({ id: `run-${i}`, status: "running" }),
		),
		...Array.from({ length: 25 }, (_, i) =>
			job({ id: `queue-${i}`, status: "running", queued: true }),
		),
		...Array.from({ length: 17 }, (_, i) =>
			job({ id: `stop-${i}`, status: "interrupted" }),
		),
		...Array.from({ length: 5 }, (_, i) =>
			job({ id: `done-${i}`, status: "done" }),
		),
	]).subagents;
	const mixed = activityTally(fanOut);
	assert.equal(mixed.count, 40, "the count is every open row");
	assert.equal(mixed.markCount, 15, "and the mark's share is the running few");
	assert.equal(childClause(mixed), "40 subagents open");
	assert.equal(busiestClause(mixed), ", 15 running");
	// The jobs half takes the same shape, so a tool row of any state is spelled as
	// the mark beside it, and an empty list has no tally at all (the chips' gate).
	assert.equal(
		jobClause(activityTally(derive([job({ type: "bash" })]).jobs)),
		"1 job running",
	);
	assert.equal(activityTally(derive([]).jobs), null);
	assert.equal(activityTally(derive([]).subagents), null);
	assert.equal(
		activityTally(derive([job({ status: "succeeded" })]).subagents),
		null,
		"a settled row is not activity",
	);
});

test("the activity mark is the busiest open row, and a settled row contributes nothing", () => {
	// One open row: the mark is simply that row's own, which is the ordinary case.
	assert.equal(
		activityMark(derive([job({ status: "running" })]).subagents),
		"running",
	);
	assert.equal(
		activityMark(derive([job({ status: "running", queued: true })]).subagents),
		"queued",
	);
	assert.equal(
		activityMark(derive([job({ status: "paused" })]).subagents),
		"paused",
	);
	/*
	 * Several: a running row outranks a parked sibling whatever order the wire
	 * lists them in, because "something here is running" is the true reading and
	 * the first row on the ledger is not.
	 */
	const several = derive([
		job({ id: "parked", status: "paused" }),
		job({ id: "busy", status: "running" }),
	]).subagents;
	assert.equal(activityMark(several), "running");
	/*
	 * A settled row never contributes a mark, including the two states that carry
	 * one of their own: a failed child is DANGER's fact (the trigger's dot), not
	 * activity's, and a done child is not activity at all. Counting either would put
	 * a `failed` mark on a chip that stands for running work.
	 */
	assert.equal(
		activityMark(derive([job({ status: "failed" })]).subagents),
		null,
	);
	assert.equal(
		activityMark(
			derive([
				job({ id: "done", status: "done" }),
				job({ id: "busy", status: "running" }),
			]).subagents,
		),
		"running",
	);
});

test("the tool jobs are re-measured on the roster's own tick", () => {
	/*
	 * The Jobs section draws an elapsed label, so this list has to move with the
	 * clock the pane already runs — otherwise a backgrounded shell's row freezes at
	 * the reading the wire last published while the roster beside it counts up,
	 * which is exactly the defect the reader's own clock was added for (`Q3`).
	 */
	const details = derive([
		job({ id: "shell", type: "bash", status: "running", start_time: 1_000 }),
	]);
	assert.equal(details.jobs[0].elapsedLabel, "1m");
	const later = retimeRunDetails(details, NOW_MS + 120_000);
	assert.equal(later.jobs[0].elapsedLabel, "3m");
	// The tick is a re-measure, not a re-derivation: nothing else about the list moves.
	assert.equal(later.openJobs, details.openJobs);
	assert.deepEqual(
		later.jobs.map((row) => row.status),
		details.jobs.map((row) => row.status),
	);
	// And a tick that moves no label in EITHER list hands back the same object: a row
	// with no launch time at all has no clock to move (`start_time: 0`).
	const still = derive([
		job({ id: "shell", type: "bash", status: "running", start_time: 0 }),
	]);
	assert.equal(still.jobs[0].elapsedLabel, null);
	assert.equal(retimeRunDetails(still, NOW_MS + 60_000), still);
});

test("a running tool job is a reason for the pane to have content", () => {
	/*
	 * `hasRunDetails` decides whether the pane says "Nothing in flight" or "Nothing
	 * to show yet", and the Jobs section is gated on `openJobs > 0` — so without
	 * this clause the quiet line would claim an empty run while the section directly
	 * beneath it drew rows (`docs/composer-activity-chips.md` § 4).
	 */
	assert.equal(
		hasRunDetails(derive([job({ type: "bash", status: "running" })])),
		true,
	);
	assert.equal(
		hasRunDetails(
			derive([job({ type: "bash", status: "succeeded", settled_at: 1_010 })]),
		),
		false,
		"a settled tool row is not run details, and the section it would have drawn is gone too",
	);
});

test("a nested child is a descendant, and its parent's control is the way to it", () => {
	/*
	 * Q2: a grandchild painted as a top-level row double-reports the same work in
	 * the tally and beside its own parent, while the parent's `N children`
	 * control is the documented way to reach it (`§ 5.5`).
	 */
	const details = derive([
		job({ id: "parent", status: "running" }),
		job({ id: "grandchild", status: "running", parent_job_id: "parent" }),
	]);
	assert.deepEqual(
		details.subagents.map((row) => row.id),
		["parent"],
	);
	assert.equal(details.openChildren, 1);
	assert.deepEqual(
		details.lineage.map((row) => row.id),
		["parent", "grandchild"],
		"the reader's path is walked over the lineage, so the descendant stays reachable",
	);
	assert.equal(details.lineage[0].childCount, 1);
	/*
	 * And the opposite case, which is why the rule asks whether the PARENT IS ON
	 * THE LIST rather than whether `parent_job_id` is null: `comms.job_rows()`
	 * returns a child's raw `parent_job_id` when the record it names is gone, and
	 * a row nothing could reach is a member by construction.
	 */
	const orphan = derive([job({ id: "orphan", parent_job_id: "swept-away" })]);
	assert.deepEqual(
		orphan.subagents.map((row) => row.id),
		["orphan"],
	);
});

test("the reader's clock re-measures ONE row, on the roster's own rule", () => {
	/*
	 * Q3: the reader's header sat on the elapsed label the wire last published
	 * while the roster beside it counted up. `retimeChildRow` is the one-row half
	 * of `retimeRunDetails`, so the two surfaces cannot come to different answers
	 * about which rows have a clock that is still running.
	 */
	const [open, settled] = derive([
		job({ id: "open", start_time: 1_000 }),
		job({ id: "settled", start_time: 1_000, settled_at: 1_010 }),
	]).subagents;
	assert.equal(open.elapsedLabel, "1m");
	assert.equal(retimeChildRow(open, NOW_MS + 120_000).elapsedLabel, "3m");
	assert.equal(
		retimeChildRow(settled, NOW_MS + 120_000).elapsedLabel,
		"10s",
		"a settled child's duration is a fact about the job",
	);
	// Identity when nothing moved, so a header whose label is unchanged does not
	// repaint — the same property `retimeRunDetails` keeps for the list.
	assert.equal(retimeChildRow(open, NOW_MS + 400), open);
	// And the model's own re-measure reaches the LINEAGE, not only the roster: a
	// nested child's row is exactly what a reader draws when it is open on one.
	const nested = derive([
		job({ id: "parent", status: "done", settled_at: 1_010 }),
		job({
			id: "kid",
			status: "running",
			start_time: 1_000,
			parent_job_id: "parent",
		}),
	]);
	assert.equal(nested.subagents.length, 1);
	assert.equal(nested.lineage.length, 2);
	assert.equal(
		retimeRunDetails(nested, NOW_MS + 120_000).lineage[1].elapsedLabel,
		"3m",
	);
});

/* ------------------------------------------------------------------ */
/* The MCP section's two copy rules                                    */
/* ------------------------------------------------------------------ */

test("the MCP tally pluralises, and agrees with the trigger's own clause", () => {
	/*
	 * Q7/U1-7: `1 need attention` sat beside the trigger's `1 MCP server needs
	 * attention` — one count, two spellings, one of them ungrammatical, on the two
	 * surfaces a single reader sees together.
	 */
	const one = deriveMcpServers([
		{ name: "files", status: "connected", tool_count: 12 },
		{ name: "notion", status: "auth-required" },
	]);
	assert.equal(mcpTally(one), "1 of 2 connected · 1 needs attention");
	const two = deriveMcpServers([
		{ name: "files", status: "disconnected" },
		{ name: "notion", status: "auth-required" },
	]);
	assert.equal(mcpTally(two), "0 of 2 connected · 2 need attention");
	// No problem is no clause at all, and the trigger's own clause for the same
	// fact is the spelling this one now matches.
	const healthy = deriveMcpServers([
		{ name: "files", status: "connected", tool_count: 12 },
		{ name: "notion", status: "connecting" },
	]);
	assert.equal(mcpTally(healthy), "1 of 2 connected");
	const label = runDetailTriggerLabel(derive([job({})]), NOTHING_SEEN, {
		mcpProblems: 1,
	});
	assert.match(label, /1 MCP server needs attention/);
	// The cold payload has no status to tally at all.
	assert.equal(
		mcpTally(deriveMcpServers([{ name: "files", status: "cold" }])),
		MCP_COLD_LINE,
	);
});

test("an MCP row's diagnosis is the canonical projection's, and only where it applies", () => {
	/*
	 * U1-8: `mcp.list` reports no reason for a server being down, so a row broken
	 * by its own command offered `Reconnect this server in Settings` — a remedy
	 * that cannot fix a command that does not exist — and hid the runtime's own
	 * words. The canonical projection's `error` is the only place they exist.
	 */
	const errors = mcpErrorTexts([
		{
			name: "playwright",
			status: "disconnected",
			error: "[Errno 2] No such file or directory: '/nonexistent/x'",
		},
		// A stale startup failure for a server that came up afterwards.
		{ name: "files", status: "connected", error: "auth probe failed at boot" },
		// A row with no error contributes nothing, and neither does a nameless one.
		{ name: "notion", status: "auth-required", error: "" },
		{ status: "connected", error: "orphaned" },
	]);
	assert.deepEqual(Object.keys(errors).sort(), ["files", "playwright"]);
	const rows = deriveMcpServers(
		[
			{ name: "playwright", status: "disconnected" },
			{ name: "files", status: "connected", tool_count: 12 },
		],
		errors,
	);
	const byName = new Map(rows.map((row) => [row.name, row]));
	assert.equal(
		byName.get("playwright").errorText,
		"[Errno 2] No such file or directory: '/nonexistent/x'",
		"the runtime's words, verbatim",
	);
	assert.deepEqual(
		byName.get("playwright").remedy,
		{ kind: "reconnect" },
		"the remedy is still carried, and now as the kind the row acts on",
	);
	assert.equal(
		byName.get("files").errorText,
		null,
		"a live `connected` word outranks a failure the runtime recorded at boot",
	);
	// No projection at all is the story set's and the legacy path's shape.
	assert.deepEqual(mcpErrorTexts(undefined), {});
	assert.equal(
		deriveMcpServers([{ name: "playwright", status: "disconnected" }])[0]
			.errorText,
		null,
	);
});

/**
 * The remedy decision, from the row's own payload (`§ 3.3`), and the grant state
 * folded from the read's own `operations` (`§ 3.2`).
 */
test("the remedy is the one this surface can carry out, and words where it cannot", () => {
	const remedy = (row) => deriveMcpServers([{ name: "s", ...row }])[0].remedy;

	// `disconnected` is transport-level and `connect` is the shipped control.
	assert.deepEqual(remedy({ status: "disconnected" }), { kind: "reconnect" });

	// An http server with no explicit refusal is the NORMAL case — the backend
	// publishes `False` only for a definite one (`mcp/desktop.py:104-116`) — so
	// "unknown" is offered the grant rather than read as a refusal.
	assert.deepEqual(remedy({ status: "auth-required", transport: "http" }), {
		kind: "grant",
	});
	assert.deepEqual(
		remedy({
			status: "auth-required",
			transport: "http",
			transport_oauth_supported: true,
		}),
		{ kind: "grant" },
	);

	// A stdio child, or a config that declares another `auth.type`, can never
	// complete a browser flow: the row keeps words and points at the surface that
	// owns the credentials.
	for (const row of [
		{ status: "auth-required", transport: "stdio" },
		{
			status: "auth-required",
			transport: "http",
			transport_oauth_supported: false,
		},
	]) {
		assert.deepEqual(remedy(row), {
			kind: "words",
			label: "Manage this server's credentials in Settings",
		});
	}

	// Nothing to offer on a healthy row, an unknown word, or a state this build
	// cannot act on.
	assert.equal(remedy({ status: "connected" }), null);
	assert.equal(remedy({ status: "connecting" }), null);
	assert.equal(remedy({ status: "reticulating" }), null);
	assert.deepEqual(
		remedy({ status: "auth-required", transport: "pipe" }),
		{ kind: "grant" },
		"an unknown transport is not a refusal",
	);
});

test("a row's grant state is the newest operation the read carries", () => {
	const servers = [{ name: "notion", status: "auth-required" }];
	const rowFor = (operations, rows = servers) =>
		deriveMcpServers(rows, {}, operations)[0];

	// The running sign-in, the one state that must never be rendered as complete
	// before the backend says so.
	assert.deepEqual(
		rowFor([
			{
				id: "op-1",
				name: "notion",
				action: "reauth",
				status: "running",
				created_at: 100,
				credential_removed: true,
			},
		]).grant,
		{
			id: "op-1",
			action: "reauth",
			status: "running",
			credentialRemoved: true,
		},
	);

	// Newest by `created_at`, not by position: the backend keeps 64 operations and
	// a name can hold a `failed` op beside a later `complete` one.
	assert.equal(
		rowFor([
			{
				id: "new",
				name: "notion",
				status: "failed",
				created_at: 200,
				credential_removed: false,
			},
			{
				id: "old",
				name: "notion",
				status: "complete",
				created_at: 100,
				credential_removed: false,
			},
		]).grant?.id,
		"new",
	);

	// A TERMINAL operation is only rendered while the row is still a problem: a
	// `failed` op must not sit under a live `connected` row until the backend
	// evicts it.
	const healed = [{ name: "notion", status: "connected", tool_count: 3 }];
	const terminal = [
		{
			id: "op-2",
			name: "notion",
			status: "cancelled",
			created_at: 300,
			credential_removed: true,
		},
	];
	assert.equal(rowFor(terminal, healed).grant, null);
	// ...but a RUNNING one is rendered whatever the row says, because it is a fact
	// about a grant somebody started, not about this row's state.
	assert.equal(
		rowFor([{ ...terminal[0], status: "running" }], healed).grant?.status,
		"running",
	);

	// An operation for another server is another row's, and an operation whose
	// status this build has not been taught is dropped rather than folded to the
	// nearest word.
	assert.equal(rowFor([{ ...terminal[0], name: "elsewhere" }]).grant, null);
	assert.equal(
		rowFor([{ ...terminal[0], status: "reticulating" }]).grant,
		null,
	);
	// No operations at all is no grant state, which is the story set's shape.
	assert.equal(deriveMcpServers(servers)[0].grant, null);
});

test("an operation the backend FINISHED is not a row state, and never deletes a remedy", () => {
	const problem = [
		{ name: "hubspot", status: "auth-required", transport: "http" },
	];
	const settled = [
		{
			id: "op-1",
			name: "hubspot",
			action: "reauth",
			status: "complete",
			created_at: 100,
			credential_removed: false,
		},
	];
	const row = deriveMcpServers(problem, {}, settled)[0];

	// No grant line: the row's own status from the next read is the statement about
	// the server, and the backend holds settled operations for the rest of the
	// session (they are evicted only at 64).
	assert.equal(row.grant, null);
	// And the remedy is still there. That is the whole finding: rendering `complete`
	// deleted the row's control and its sentence for the rest of the session (code
	// review round 1, finding 1).
	assert.deepEqual(row.remedy, { kind: "grant" });

	// The same rule for a transport that dropped after a successful connect.
	const dropped = [
		{ name: "slack", status: "disconnected", transport: "http" },
	];
	const connected = [
		{
			id: "op-2",
			name: "slack",
			action: "connect",
			status: "complete",
			created_at: 200,
			credential_removed: false,
		},
	];
	assert.equal(deriveMcpServers(dropped, {}, connected)[0].grant, null);
	assert.deepEqual(deriveMcpServers(dropped, {}, connected)[0].remedy, {
		kind: "reconnect",
	});

	// A stale `failed` op beside a NEWER `complete` one loses too: the newest
	// statement about the name is the completed sign-in, so neither is rendered —
	// which is why `complete` stays in the parsed vocabulary rather than being
	// dropped before the fold compares timestamps.
	assert.equal(
		deriveMcpServers(problem, {}, [
			settled[0],
			{ ...settled[0], id: "op-3", status: "failed", created_at: 50 },
		])[0].grant,
		null,
	);
});

test("the session's grant lock is read off the document, not off the rows", () => {
	// An operation whose server has NO row still holds the backend's one-grant lock
	// (`mcp/desktop.py`), and a fold over the rows cannot see it — so a press from
	// another row would reach the route's opaque 409 with every control live (code
	// review round 1, finding 5).
	assert.equal(
		mcpGrantInFlight([{ id: "op", name: "gone", status: "running" }]),
		true,
	);
	assert.equal(
		mcpGrantInFlight([{ id: "op", name: "gone", status: "complete" }]),
		false,
	);
	assert.equal(mcpGrantInFlight([]), false);
	assert.equal(mcpGrantInFlight(undefined), false);
	// A word this build was not taught is not running — the same direction the fold
	// refuses in.
	assert.equal(
		mcpGrantInFlight([{ id: "op", name: "x", status: "reticulating" }]),
		false,
	);
});

test("a server that declares credential fields gets the key remedy, and one that declares none keeps the sentence", () => {
	const row = (payload) => deriveMcpServers([{ name: "s", ...payload }])[0];

	// The credential path exists because the config holds a `${NAME}` REFERENCE and
	// the value lives in the owner store — which is the store Settings' API
	// credentials writes. Both spellings of "cannot do OAuth" take it.
	assert.deepEqual(
		row({
			status: "auth-required",
			transport: "stdio",
			environment_keys: ["GOOGLE_CLIENT_SECRET"],
			secret_refs: [
				{
					id: "GOOGLE_CLIENT_SECRET",
					bindings: [{ field: "env", key: "GOOGLE_CLIENT_SECRET" }],
				},
			],
		}).remedy,
		{ kind: "key" },
	);
	assert.deepEqual(
		row({
			status: "auth-required",
			transport: "http",
			transport_oauth_supported: false,
			header_keys: ["Authorization"],
			secret_refs: [
				{
					id: "SERVICE_TOKEN",
					bindings: [{ field: "headers", key: "Authorization" }],
				},
			],
		}).remedy,
		{ kind: "key" },
	);

	// Nothing declared is nothing to ask for: the sentence still names the surface
	// that owns this server's configuration.
	assert.deepEqual(
		row({ status: "auth-required", transport: "stdio" }).remedy,
		{ kind: "words", label: "Manage this server's credentials in Settings" },
	);
	assert.deepEqual(
		row({ status: "auth-required", transport: "stdio", environment_keys: [] })
			.remedy,
		{
			kind: "words",
			label: "Manage this server's credentials in Settings",
		},
	);

	// A server that CAN grant never gets the key remedy: the browser flow is the
	// one that re-consents, and a declared header map does not change that.
	assert.deepEqual(
		row({
			status: "auth-required",
			transport: "http",
			header_keys: ["Authorization"],
		}).remedy,
		{ kind: "grant" },
	);
});

test("a row's key fields are the backend's secret-reference IDs, never config field names", () => {
	const [row] = deriveMcpServers([
		{
			name: "slack",
			status: "auth-required",
			transport: "http",
			// R2-2: these two are the CONFIG MAP KEYS. They are informational only,
			// and writing `Authorization` as a store ID is exactly the defect that
			// left `${HUBSPOT_TOKEN}` unresolved after a "successful" save.
			environment_keys: ["TOKEN", "SHARED"],
			header_keys: ["Authorization", "SHARED"],
			secret_refs: [
				{ id: "TOKEN" },
				{ id: "SHARED" },
				{ id: "TOKEN" },
				{ id: "SERVICE_TOKEN" },
			],
		},
	]);
	// Declared order, deduped by ID: one field per referenced secret, and never a
	// destination field name (`Authorization` is absent).
	assert.deepEqual(row.keyNames, ["TOKEN", "SHARED", "SERVICE_TOKEN"]);

	// A payload that declares no references offers no field at all: a form built
	// from guessed header bindings is the dishonest setup this replaces.
	const [bare] = deriveMcpServers([{ name: "bare", status: "connected" }]);
	assert.deepEqual(bare.keyNames, []);
	const [legacyOnly] = deriveMcpServers([
		{
			name: "legacy",
			status: "auth-required",
			transport: "http",
			// An older backend sends the map keys and NO `secret_refs`. It must not
			// be turned into a form that writes a wrong ID.
			header_keys: ["Authorization"],
		},
	]);
	assert.deepEqual(legacyOnly.keyNames, []);
	const [odd] = deriveMcpServers([
		{
			name: "odd",
			status: "connected",
			secret_refs: [{ id: { name: "nope" } }, { id: "  " }, { id: 7 }, "TOKEN"],
		},
	]);
	assert.deepEqual(odd.keyNames, []);
});

/* ------------------------------------------------------------------ */
/* The plan's unnamed group (`§ 6.2`)                                  */
/* ------------------------------------------------------------------ */

test("a headerless group that does not lead the plan is given a boundary", () => {
	/*
	 * Q9/U1-5: the fold is honest only where it LEADS. An implicit phase the
	 * backend grew after a named one rendered its rows at the previous phase's
	 * indent, with no header and — the per-phase counts having been removed by
	 * this change — no other signal either, so `sweep the build cache` read as a
	 * `Ship it` item.
	 *
	 * A paint rule cannot be asserted from here: this file bundles the model and
	 * the fixtures and has no DOM. The pin is therefore on the SOURCE, in the
	 * shape this file already uses for the two call sites it cannot reach. The
	 * FRAME (`todos-implicit-phase`) is the evidence; this is what stops the rule
	 * being deleted without the frame being re-taken.
	 */
	const todos = readFileSync(
		join(
			ROOT,
			"src/renderer/src/features/chat/components/run-details/run-detail-todos.tsx",
		),
		"utf8",
	);
	assert.match(
		todos,
		/const leadsThePlan = phaseIndex === 0;/,
		"the unnamed group's boundary depends on whether it leads",
	);
	assert.match(
		todos,
		/phase\.name === null && !leadsThePlan && <Separator \/>/,
		"and a non-leading group states the boundary it has no name for",
	);
});
