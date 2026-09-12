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
	deriveRunDetails,
	hasRunDetails,
	hasUnseenFailure,
	runDetailTriggerLabel,
	subagentTally,
	todoTally,
	unseenFailures,
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

test("a pause still landing reads as running, a landed pause as paused", () => {
	// The flag is set before the cancel it awaits; painting a stopped child while
	// it is demonstrably still going is the window `status_glyph` guards.
	const landing = derive([job({ status: "running", paused: true })]);
	assert.equal(landing.subagents[0].status, "running");

	const landed = derive([job({ status: "cancelled", paused: true })]);
	assert.equal(landed.subagents[0].status, "paused");
});

test("starting and pausing stay open, and take a mark that says so", () => {
	const starting = derive([job({ status: "starting" })]);
	assert.equal(starting.subagents[0].status, "queued");
	assert.equal(starting.openChildren, 1);

	const pausing = derive([job({ status: "pausing" })]);
	assert.equal(pausing.subagents[0].status, "running");
	assert.equal(pausing.openChildren, 1);
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
	// Only running, queued and paused are open: a cancelled child the user
	// stopped and a run the process ended are both settled.
	assert.equal(derive([job({ status: "interrupted" })]).openChildren, 0);
});

test("an unknown status folds to done, which is the TUI's own default", () => {
	// The cost of the parity call, asserted rather than hidden: a status this
	// renderer has not been taught reads as finished.
	assert.equal(derive([job({ status: "reticulating" })]).subagents[0].status, "done");
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
		job({ id: "done-1", status: "done" }),
		job({ id: "done-2", status: "done" }),
		job({ id: "failed", status: "failed" }),
		job({ id: "running", status: "running" }),
		job({ id: "interrupted", status: "interrupted" }),
		job({ id: "done-3", status: "done" }),
		job({ id: "queued", status: "running", queued: true }),
		job({ id: "paused", status: "cancelled", paused: true }),
	]).subagents;
	// running/queued, failed, paused/interrupted, settled.
	const visible = visibleSubagents(rows);
	assert.deepEqual(
		visible.rows.map((row) => row.id),
		["queued", "running", "failed", "paused", "interrupted", "done-3"],
	);
	assert.equal(visible.hidden, 2);

	// Within a rank the newest wins, which is the rule the slice had before it
	// ranked at all.
	const settledOnly = derive([
		job({ id: "oldest", status: "done" }),
		job({ id: "middle", status: "done" }),
		job({ id: "newest", status: "done" }),
	]).subagents;
	assert.deepEqual(
		visibleSubagents(settledOnly).rows.map((row) => row.id),
		["newest", "middle", "oldest"],
	);
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
	assert.equal(hasRunDetails(derive([job({ status: "cancelled", paused: true })])), true);
	assert.equal(hasRunDetails(derive([], plan(["blocked"]))), true);
	assert.equal(hasRunDetails(null), false);
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
	for (const state of [
		"running",
		"queued",
		"paused",
		"interrupted",
		"done",
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
