/**
 * The collapsed-turn model's arithmetic (the frozen design's §4-§5), asked of
 * the shipped module rather than of a rendering.
 *
 * WHY A UNIT TEST AND NOT A FRAME. The frames say the collapsed and expanded
 * states look right; they cannot say that a steer folds into the run it
 * interrupted, that a window-cut run never collapses, that `Took` is the wall
 * span and not the foot's summed tool seconds, or that an aborted call is not a
 * failure. Those are the decisions an edit breaks silently, so they are
 * asserted here over the rows the transcript actually builds, with the exact
 * shapes §5's matrix names.
 *
 * WHAT THIS CANNOT SAY. That the bar looks like the ledger's own row, that its
 * chevron is the app's disclosure, or that the failure control lands on the
 * failed row — the frames and `scripts/turn-collapse-behaviour.test.mjs` do
 * that. This file says the plan is right.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { FakeJournal } from "./loader-journal-fixture.mjs";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export { captureInternalEpisodeIdentity, retainInternalEpisodeKeys, expandedRunsOf, writeRunExpanded, forgetTurnCollapseOpen, __resetTurnCollapseOpen } from "./src/renderer/src/shared/store/turn-collapse-open";',
			'export * from "./src/renderer/src/features/chat/canonical/open-frame";',
			'export * from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
			'export { runsOf, closingAnswerIds, buildRows } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
			'export { applyEvent, applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
			'export { visibleRecords } from "./src/renderer/src/features/chat/canonical/cross-session-visibility";',
		].join("\n"),
		resolveDir: ROOT,
	},
	alias: {
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared": `${ROOT}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const {
	captureInternalEpisodeIdentity,
	retainInternalEpisodeKeys: retainInternalEpisodeKeysV2,
	expandedRunsOf,
	writeRunExpanded,
	forgetTurnCollapseOpen,
	__resetTurnCollapseOpen,
	ALIGN_WALK_MAX_PAGES,
	WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	alignWalkDecision,
	alignWalkRunFromPlan,
	alignWalkRunKey,
	alignWalkRunKeyConfirmed,
	alignWalkStateFor,
	initialAlignWalkState,
	collapsePlan,
	collapsePlanOptionsKey,
	olderRowsThanWindow,
	isFailedCall,
	paintedRows,
	runsOf,
	snapWindowToRunBoundary,
	staysVisibleWhileCollapsed,
	widenTarget,
	windowTopRun,
	windowTopRunIsHeadCut,
	runIsCondensed,
	closingAnswerIds,
	buildRows,
	applyHistoryPage,
	applyEvent,
	EMPTY_TRANSCRIPT,
	visibleRecords,
	quietGroupClauseFacts,
	quietGroupsOf,
	quietGroupOfSegment,
	openFrameFacts,
	openFrameAttestedStart,
	openFrameCoversHeld,
} = await import(moduleUrl);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

/**
 * A row the model reads: the record's own fields plus the gap tier `buildRows`
 * would have given it. Gaps follow the real rule (the row after a user row is
 * `turn`, adjacent trace-tier rows are `trace`, everything else `item`), because
 * the bar's margin is the FIRST HIDDEN row's gap and a fixture that invented one
 * would test a tier the app never emits.
 */
const row = (id, kind, extra = {}, gap = "item") => ({
	record: { kind, id, ts: TS, ...extra },
	gap,
	closesTurn: false,
});

const user = (id, extra = {}) =>
	row(id, "user", { text: "hi", ...extra }, "turn");
const tool = (id, extra = {}, gap = "turn") =>
	row(
		id,
		"tool",
		{
			toolName: "bash",
			isError: false,
			stopped: false,
			neverSent: false,
			notRunReason: null,
			endedAt: null,
			...extra,
		},
		gap,
	);
const answer = (id, extra = {}) =>
	row(id, "assistant", { text: "done", streaming: false, ...extra }, "item");

const planOf = (rows, live = false) => collapsePlan(rows, { live });

/**
 * Every bar's expansion key, as the reader's store would hold it. A segment key
 * is derived from the span's own anchor row (\`SegmentPlan.key\`), NOT from the
 * run's key, so a fixture that opens a bar names the bar's key rather than the run's.
 */
const segmentKeysOf = (rows) =>
	collapsePlan(rows, { live: false }).runs.flatMap((run) =>
		run.segments.map((segment) => segment.key),
	);

/* ------------------------- the run partition (F2) ------------------------ */

test("a steer folds into the run it interrupted; a settled turn opens the next", () => {
	/*
	 * The partition is STRUCTURAL. Steering is not marked on the durable wire —
	 * the harness stores a steer as an ordinary user message and the live
	 * steering event is consumed by the stream, not the transcript — so the only
	 * facts available are the closure ones: a settled assistant as the last
	 * content row, or a `complete === true` marker.
	 */
	const steered = runsOf([
		user("u1"),
		tool("t1"),
		user("s1"),
		tool("t2", {}, "trace"),
		answer("a1"),
	]);
	assert.equal(steered.length, 1, "one turn, not two");
	assert.equal(
		steered[0].key,
		"a1",
		"the run is keyed by its closing answer (the head-independent identity)",
	);
	assert.equal(
		steered[0].closingAnswerId,
		"a1",
		"the answer after the steer closes the one turn",
	);

	const twoTurns = runsOf([
		user("u1"),
		tool("t1"),
		answer("a1"),
		user("u2"),
		tool("t2", {}, "trace"),
		answer("a2"),
	]);
	assert.deepEqual(
		twoTurns.map((run) => run.key),
		["a1", "a2"],
		"a settled answer makes the next user message a new turn, keyed on its answer",
	);
	assert.equal(twoTurns[0].boundary, "answer");
	assert.equal(twoTurns[0].closingAnswerId, "a1");
	assert.equal(twoTurns[1].boundary, "end");

	const marked = runsOf([
		user("u1"),
		tool("t1"),
		{
			record: {
				kind: "notice",
				id: "m1",
				ts: TS,
				text: "Interrupted",
				level: "info",
				complete: true,
			},
			gap: "item",
			closesTurn: false,
		},
		user("u2"),
		answer("a2"),
	]);
	assert.deepEqual(
		marked.map((run) => run.key),
		["m1", "a2"],
		"a completion marker ends the turn even with no answer painted",
	);
	assert.equal(marked[0].boundary, "marker");
});

test("a head-cut run's identity survives the head arriving later", () => {
	/*
	 * The key is what the reader's expansion and the bar's React key hang on,
	 * and a head-cut run's first row is NOT stable: the day a page brings the
	 * opening user row in, that row is no longer first. The closing answer (or,
	 * with none to key on, the run's last row) is the same row in both lists —
	 * rows only ever arrive ABOVE a run's head.
	 */
	const cut = runsOf([tool("t1"), tool("t2", {}, "trace"), answer("a1")]);
	assert.equal(cut.length, 1);
	assert.equal(cut[0].opensWithUserRow, false);
	assert.equal(cut[0].key, "a1", "the closing answer keys the cut run");
	const whole = runsOf([
		user("u1"),
		tool("t1"),
		tool("t2", {}, "trace"),
		answer("a1"),
	]);
	assert.equal(whole[0].key, cut[0].key, "the head landing does not move it");
	assert.equal(
		runsOf([tool("t3")])[0].key,
		"t3",
		"with no answer to key on, the run's last row is the stable half",
	);
	assert.equal(
		runsOf([user("u2"), tool("t3")])[0].key,
		"t3",
		"and it is the same row before and after the head lands",
	);
});

/* --------------------------- the case matrix (§5) ------------------------ */

test("a run with nothing in between does not collapse", () => {
	// §5 case 1: `[user][answer]` renders exactly as today, foot included.
	const plan = planOf([user("u1"), answer("a1")]);
	assert.equal(plan.runs[0].collapses, false);
	assert.deepEqual(plan.runs[0].hidden, []);
});

test("a completed run collapses over its in-between rows, bar at the first hidden row's gap", () => {
	// §5 case 2, and the gap rule from §4.5: the bar takes the FIRST hidden
	// row's tier — the tool after a user row carries the turn's own 32px.
	const plan = planOf([user("u1"), tool("t1"), answer("a1")]);
	const run = plan.runs[0];
	assert.equal(run.collapses, true);
	assert.deepEqual(
		run.hidden.map((hidden) => hidden.record.id),
		["t1"],
	);
	assert.equal(run.gap, "turn", "the bar takes the first hidden row's gap");
	assert.equal(run.facts.actions, 1);
	assert.equal(run.facts.title, "Ran 1 command");
});

test("narration-only in-betweens collapse and state no duration: no call measured any work", () => {
	/*
	 * §5 case 3: a span whose hidden rows are PROSE states no action clause. The
	 * span has to be one the visibility invariant still folds - prose a lead-in to
	 * the call that follows it, or a COMMENTARY close that is not the run's last
	 * (V1 keeps every response close, V2 the last close of all) - so this fixture
	 * is the second shape: the disposal, then a wake whose narration closed a
	 * commentary cycle, then one more close.
	 */
	const plan = planOf([
		user("u1"),
		answer("a1", { ts: TS + 4_000, settledAt: TS + 4_000 }),
		row("mark", "notice", {
			text: "Completed",
			level: "info",
			complete: true,
		}),
		row("w1", "wake", { text: "wake" }),
		row("p1", "assistant", { text: "Checking the ledger.", streaming: false }),
		answer("a2"),
	]);
	const run = plan.runs[0];
	assert.equal(run.collapses, true);
	assert.deepEqual(
		run.hidden.map((hidden) => hidden.record.id),
		["w1", "p1"],
		"the wake's own span: the receipt and a commentary close",
	);
	assert.equal(run.facts.actions, 0);
	assert.equal(run.facts.title, null, "no actions, no hover sentence");
	assert.equal(
		run.facts.durationS,
		null,
		"the duration is WORKED time (the foot's quantity): no call, nothing to state",
	);
});

test("a steer's rows count in the run's totals, and the steer itself stays on screen (V3)", () => {
	// §5 case 5, the one whose numbers move: the foot used to reset at the steer.
	// The steer's ROW is no longer inside the collapse (V3), so the run has a bar
	// on either side of the reader's own message.
	const plan = planOf([
		user("u1"),
		tool("t1"),
		user("s1"),
		tool("t2", {}, "trace"),
		answer("a1"),
	]);
	assert.equal(plan.runs.length, 1);
	const run = plan.runs[0];
	assert.equal(run.collapses, true);
	assert.deepEqual(
		run.hidden.map((hidden) => hidden.record.id),
		["t1", "t2"],
		"the steer message is between the two bars, not inside one",
	);
	assert.equal(
		run.segments.length,
		2,
		"one bar per hidden span: the steer splits the run's work",
	);
	assert.equal(
		run.facts.actions,
		2,
		"both calls count, the one before the steer included",
	);
});

test("an interrupted run keeps its marker and its answer in place", () => {
	// §5 cases 6-7. With an answer: the bar hides the work and the aborted
	// answer carries its own `Stopped before finishing` caption (the row's
	// business, not the bar's); the bar carries no interrupt word in v1.
	const withAnswer = planOf([
		user("u1"),
		tool("t1"),
		answer("a1", { stopReason: "aborted" }),
	]);
	assert.equal(withAnswer.runs[0].collapses, true);
	assert.equal(
		withAnswer.runs[0].stampTs,
		TS,
		"the closing answer still stamps",
	);

	const markerOnly = planOf([
		user("u1"),
		tool("t1"),
		{
			record: {
				kind: "notice",
				id: "m1",
				ts: TS,
				text: "Interrupted",
				level: "info",
				complete: true,
			},
			gap: "item",
			closesTurn: false,
		},
	]);
	const run = markerOnly.runs[0];
	assert.equal(run.collapses, true);
	assert.deepEqual(
		run.hidden.map((hidden) => hidden.record.id),
		["t1"],
		"the marker is pinned, the work hides",
	);
	assert.equal(run.stampTs, null, "no answer, no stamp — the foot's own rule");
});

/*
 * ------------------- on-load window alignment (operator report) ------------
 *
 * The operator's report (2026-09-28): opening a long conversation showed
 * in-between rows on completed turns, and the bars only appeared after
 * scrolling the run's head into view. The window's top edge is the cause: a
 * raw row count lands mid-run, and a cut run cannot collapse. These tests pin
 * the two halves of the fix — the snap that moves the edge onto a boundary it
 * can see, and the head-cut predicate the load path fetches against.
 */

const LONG = [
	user("u1"),
	tool("t1"),
	tool("t2"),
	answer("a1"),
	user("u2"),
	tool("t3"),
	tool("t4"),
	tool("t5"),
	answer("a2"),
	user("u3"),
	tool("t6"),
	answer("a3"),
];

test("the window edge snaps up to the run boundary it lands in", () => {
	// Size 5 lands the top at index 7, inside run 2 (which opens at 4): the
	// snap adds the three rows that close the run, so the list starts whole.
	assert.equal(snapWindowToRunBoundary(LONG, 5, 300), 8);
	const windowed = LONG.slice(LONG.length - 8);
	assert.deepEqual(
		runsOf(windowed).map((run) => run.opensWithUserRow),
		[true, true],
	);
});

test("a snap beyond the bound stands down, and the edge already on a boundary does not move", () => {
	assert.equal(snapWindowToRunBoundary(LONG, 5, 2), 5);
	// Size 3 lands the top exactly on `u2` — a boundary already.
	assert.equal(snapWindowToRunBoundary(LONG, 3, 300), 3);
	// A window wider than the transcript has no edge to move.
	assert.equal(snapWindowToRunBoundary(LONG, 60, 300), 60);
});

test("an edge inside a head-cut run cannot snap — that is the load path's case", () => {
	// The fetched list starts mid-run: no opening row exists to snap to.
	const cut = [
		tool("t0"),
		tool("t1"),
		answer("a1"),
		user("u2"),
		tool("t2"),
		answer("a2"),
	];
	assert.equal(snapWindowToRunBoundary(cut, 4, 300), 4);
	assert.equal(windowTopRunIsHeadCut(cut, 4), true);
	// Once the head is loaded the same window snaps and stops asking.
	const whole = [user("u1"), ...cut];
	assert.equal(windowTopRunIsHeadCut(whole, 4), false);
	assert.equal(snapWindowToRunBoundary(whole, 4, 300), 7);
});

test("the head-cut predicate is false when the edge lands in a whole run", () => {
	assert.equal(windowTopRunIsHeadCut(LONG, 5), false);
	assert.equal(windowTopRunIsHeadCut(LONG, 9), false);
	assert.equal(windowTopRunIsHeadCut(LONG, 60), false);
});

test("a dead run with no settled row collapses to the bar alone", () => {
	// §5 case 8 (the residual edge F2 names): nothing settled, no marker, so
	// there is no tail — and a following user message folds in as a steer.
	const plan = planOf([user("u1"), tool("t1")]);
	assert.equal(plan.runs[0].collapses, true);
	assert.deepEqual(
		plan.runs[0].hidden.map((hidden) => hidden.record.id),
		["t1"],
	);

	const withSteer = planOf([user("u1"), tool("t1"), user("s1")]);
	assert.deepEqual(
		withSteer.runs.map((run) => run.key),
		["s1"],
		"the following message is a steer, however unideal that is (R2)",
	);
});

test("a head-cut run with its closing answer loaded condenses from the loaded span, with no fabricated duration", () => {
	/*
	 * END-LOADED ELIGIBILITY (operator report, 2026-09-29; adopted from the dsh
	 * comparison). The fetched list starts mid-run — the operator's "the
	 * previous message is a few chunk loads up" — and the run used to render
	 * its raw rows until the reader pulled the head in. The bar may only ever
	 * describe rows on hand, and that is exactly what this plans: the loaded
	 * calls, and NO `Took` (the span would have to start at the first loaded
	 * row, a number the turn never had).
	 */
	const plan = planOf([
		tool("t1"),
		tool("t2", {}, "trace"),
		answer("a1", { ts: TS + 5_000 }),
	]);
	const run = plan.runs[0];
	assert.equal(
		run.collapses,
		true,
		"the closing answer is on hand, so it folds",
	);
	assert.deepEqual(
		run.hidden.map((hidden) => hidden.record.id),
		["t1", "t2"],
		"the loaded rows are what it hides",
	);
	assert.equal(
		run.facts.durationS,
		null,
		"never fabricated from the first loaded row",
	);
	assert.equal(run.facts.actions, 2, "counted over the loaded rows only");
	assert.equal(
		run.stampTs,
		TS + 5_000,
		"the closing answer still stamps the turn",
	);
});

test("a head-cut run with no closing answer stays unfolded — no answer, no bar", () => {
	// The honesty property in its true form: the bar's tail is the closing
	// answer, and a cut run that never handed one has no tail to keep.
	const plan = planOf([tool("t1"), tool("t2", {}, "trace")]);
	assert.equal(plan.runs[0].collapses, false);
	assert.equal(
		plan.runs[0].hidden.length,
		2,
		"the plan still says what it would hide; the flag is what refuses",
	);
});

test("the focus hold keeps a run open while the reader's focus sits in a row it would hide", () => {
	const rows = [user("u1"), tool("t1"), answer("a1")];
	assert.equal(
		collapsePlan(rows, { live: false }).runs[0].collapses,
		true,
		"the baseline: the completed run folds",
	);
	const held = collapsePlan(rows, { live: false, focusHold: "t1" });
	assert.equal(
		held.runs[0].collapses,
		false,
		"the run that would unmount the focused row stands open",
	);
	assert.deepEqual(
		held.runs[0].hidden.map((hidden) => hidden.record.id),
		["t1"],
		"the plan still states what it would hide",
	);
	assert.equal(
		collapsePlan(rows, { live: false, focusHold: "u1" }).runs[0].collapses,
		true,
		"a focused row OUTSIDE the hidden span does not hold it",
	);
	const two = collapsePlan(
		[
			user("u1"),
			tool("t1"),
			answer("a1"),
			user("u2"),
			tool("t2", {}, "trace"),
			answer("a2"),
		],
		{ live: false, focusHold: "t2" },
	);
	assert.equal(
		two.runs[0].collapses,
		true,
		"a bar over a run the reader is not in cannot disturb them",
	);
	assert.equal(two.runs[1].collapses, false, "the focused run stands open");
	assert.equal(
		collapsePlan(rows, {
			live: false,
			focusHold: "t1",
			openRuns: new Set(segmentKeysOf(rows)),
		}).runs[0].collapses,
		true,
		"an OPEN run already renders its rows, so nothing is mid-transition",
	);
});

test("the live run does not collapse; finished runs above it still do", () => {
	// §5 case 10, and the fold's own rule: a run in an older turn must not wait
	// on a later turn's liveness.
	const rows = [
		user("u1"),
		tool("t1"),
		answer("a1"),
		user("u2"),
		tool("t2", {}, "trace"),
	];
	const plan = planOf(rows, true);
	assert.equal(plan.runs[0].collapses, true, "the finished turn condenses");
	assert.equal(
		plan.runs[1].collapses,
		false,
		"the run being written in renders as today",
	);
	const idle = planOf(rows, false);
	assert.equal(
		idle.runs[1].collapses,
		true,
		"an idle newest run with nothing settled and no marker is the residual edge (R2): a bar rather than a row that would claim the turn is over",
	);
});

/*
 * THE SETTLE LATCH (operator report, 2026-10-16): "when I send a steering
 * message, it alternates between condensing the messages before it and
 * expanding them".
 *
 * WHY A LATCH AND NOT ANOTHER STATELESS ARM. The pane's `live` flag dips at
 * tool-segment boundaries (`frontend.streaming`, sampled through a real steer
 * send: `scripts/stt-dictation-proof.mjs`, "the snapshot's `streaming` flag was
 * dipping at a tool-segment boundary"). Every flip used to re-decide the newest
 * run's in-flight spans: the dip read as "the turn is over" and condensed them
 * (`liveFrom = -1`), the re-entry handed them back - a fold/unfold pair per
 * flip, no reader action, the reported alternation. The 2026-10-01 settled-close
 * rule (`de9575328`) fixes the steady-live case; a dip bypasses it entirely.
 *
 * The distinction a dip needs is "will this turn resume?" - which the rows
 * cannot state (a first-cycle dip and a genuinely dead run are the SAME rows:
 * no close, no marker). So the pane LATCHES the run it has watched live
 * (`watchedRunId`: the newest run's opening row id), and a watched run's plan
 * stops reading `live` at all: its hide set is a function of the rows alone.
 * That makes it idempotent under any number of liveness transitions, which is
 * the property these tests pin.
 */
const latchRows = () => [
	user("u1"),
	tool("t1", { ts: TS + 1_000, durationS: 3 }),
	answer("a1", { ts: TS + 3_000, settledAt: TS + 3_000, stopReason: "stop" }),
	tool("t2", { ts: TS + 4_000, durationS: 4 }),
	user("s1", { ts: TS + 5_000, text: "steer" }),
	tool("t3", { ts: TS + 6_000, durationS: 5 }),
];

/** The rows behind CLOSED bars - the operator-visible unmount set. */
const hidesOf = (plan) =>
	plan.runs.flatMap((run) =>
		run.segments
			.filter((segment) => segment.collapsed)
			.flatMap((segment) => segment.rows.map((r) => r.record.id)),
	);

test("the settle latch: a liveness flip cannot move a watched run's hide set (operator report, 2026-10-16)", () => {
	const rows = latchRows();
	const live = planOf(rows, true);
	/*
	 * The steer folds into the run (its tail is mid-work), so the newest run is
	 * `u1..t3`; `settledCloseOf` reads `a1` as the settled close, so `t1` keeps
	 * its bar and the rows after the close - the work before AND after the steer
	 * - draw in place. THIS is the hide set the reader has on screen.
	 */
	assert.deepEqual(hidesOf(live), ["t1"]);
	const dip = collapsePlan(rows, { live: false, watchedRunId: "u1" });
	assert.deepEqual(
		hidesOf(dip),
		hidesOf(live),
		"the dip (a liveness flip) does not move the watch run's hide set",
	);
	// Repeated transitions reach the same plan: idempotent, not just stable once.
	assert.deepEqual(
		hidesOf(collapsePlan(rows, { live: true, watchedRunId: "u1" })),
		hidesOf(live),
		"the re-entry hands back the same hide set",
	);
	assert.deepEqual(
		hidesOf(collapsePlan(rows, watchedOptions())),
		hidesOf(dip),
		"a second dip stays put",
	);
	// And the per-segment shapes, so a change to the bars' own arithmetic is seen.
	const run = live.runs.at(-1);
	assert.deepEqual(
		run?.segments.map((segment) => segment.collapsed),
		[true, false, false],
		"t1 barred; t2 and t3 (the work around the steer) drawn in place",
	);
});

/** The same options object twice, because the idempotence claim is about a
 * second pass over the SAME inputs rather than a new shape. */
const watchedOptions = () => ({ live: false, watchedRunId: "u1" });

test("the latch names ONE run: an unwatched newest run keeps the idle shape (the residual edge)", () => {
	const rows = [user("u2"), tool("t4")];
	const unwatched = collapsePlan(rows, { live: false, watchedRunId: "u1" });
	assert.equal(
		unwatched.runs[0].collapses,
		true,
		"a run this pane never watched still folds when the pane reads not-live (R2's residual edge)",
	);
	const watched = collapsePlan(rows, { live: false, watchedRunId: "u2" });
	assert.equal(
		watched.runs[0].collapses,
		false,
		"the watched run draws in place: a flip cannot fold rows the reader is watching",
	);
	assert.deepEqual(
		hidesOf(watched),
		[],
		"and hands nothing to a bar it did not ask for",
	);
	// The settle still folds it, ladder-free: the rows are the decider once more.
	const settled = collapsePlan(
		[
			...rows,
			answer("a2", {
				ts: TS + 7_000,
				settledAt: TS + 7_000,
				stopReason: "stop",
			}),
		],
		{ live: false, watchedRunId: "u2" },
	);
	assert.equal(
		settled.runs[0].collapses,
		true,
		"the run's own answer condenses it",
	);
});

/*
 * A DIP CANNOT FOLD ROWS THAT STATE THEY ARE STILL BEING WRITTEN (operator
 * report, 2026-10-21: the conversation "briefly flickers some different text on
 * for a frame or two" while a turn is in progress).
 *
 * THE 2026-10-16 LATCH IS THE WRONG TOOL FOR THIS HALF. It was built on the
 * premise that "will this turn resume?" is not a fact the rows carry - true of
 * the INTER-CYCLE gap, where a finished call and a dead run are the same rows.
 * But for most of a live turn the rows state it exactly: an assistant row still
 * `streaming`, or a tool row whose `phase` is not `done`, cannot be a finished
 * turn's last word. When the pane's `live` flag dipped (a tool-segment
 * boundary) or blanked (the reconnect arm sets `frontend: null`, which drops
 * `working` AND the latch's own store key), those rows were folded behind a bar
 * and handed straight back: the reported one-to-two-frame flicker, with no
 * reader action and no change to any row.
 *
 * The residual case the latch still owns is pinned by the test above: a run
 * whose rows are all settled and whose turn has not resumed reads as finished,
 * and nothing in the rows can say otherwise.
 */
test("a liveness dip cannot fold a run whose own rows say it is still being written", () => {
	const rows = [
		user("u1"),
		tool("t1", { ts: TS + 1_000, durationS: 3 }),
		answer("a1", { ts: TS + 3_000, settledAt: TS + 3_000, stopReason: "stop" }),
		tool("t2", { ts: TS + 4_000, phase: "running" }),
		row("a2", "assistant", {
			ts: TS + 5_000,
			text: "writing",
			streaming: true,
		}),
	];
	const live = planOf(rows, true);
	const dip = planOf(rows, false);
	assert.deepEqual(
		hidesOf(live),
		["t1"],
		"only the settled span before the answer is barred",
	);
	assert.deepEqual(
		hidesOf(dip),
		hidesOf(live),
		"a dip moves no row: the run's own rows still say it is in flight",
	);
	// The same rows with the flight settled ARE a finished turn: the anchor reads
	// the rows, so it releases them the moment they stop claiming to be live.
	const settled = rows.map((entry, index) =>
		index === rows.length - 1
			? row("a2", "assistant", { ts: TS + 5_000, text: "writing" })
			: entry,
	);
	assert.notDeepEqual(
		hidesOf(planOf(settled, false)),
		hidesOf(live),
		"once the rows settle, the turn condenses as a finished turn does",
	);
});

/*
 * A LEAD-IN IS NOT THE TURN'S HANDOVER (operator report, 2026-10-21: steering
 * "alternates between condensing the messages before it and expanding them").
 *
 * `settledTail` closed a run on any settled assistant row. But an assistant row
 * that CARRIES TOOL CALLS is narration - "Reading the ledger first." followed by
 * the call it announces - and its calls are still owed, so a user row arriving
 * between the narration and the call's tool row is a STEER into this turn. Read
 * as a close it flushed the run, made the steer a new turn, withdrew `live` from
 * everything before it and condensed it: one bar where the reader had just been
 * reading rows, replaced a pass later by the rows again when the tool row landed
 * and the tail was no longer an "answer". The transcript already states this
 * rule once, for the answer rail (`turn-segments.ts::isFinalResponse`); the run
 * closure now reads the same fact instead of contradicting it.
 */
test("a lead-in's user row steers into the turn instead of opening the next one", () => {
	const leadIn = {
		streaming: false,
		callsTools: true,
		stopReason: "toolUse",
	};
	const rows = [
		user("u1"),
		tool("t1"),
		answer("a1", leadIn),
		user("s1", { text: "also check the ledger" }),
		tool("t2", {}, "trace"),
		answer("a2", { text: "done" }),
	];
	const runs = runsOf(rows);
	assert.equal(runs.length, 1, "the steer did not split the turn in two");
	assert.equal(
		runs[0].closingAnswerId,
		"a2",
		"the turn closes on its answer, not on its narration",
	);
	// The control: the same rows with a real handover DO open the next turn.
	const handedOver = rows.map((entry) =>
		entry.record.id === "a1"
			? answer("a1", { streaming: false, callsTools: false })
			: entry,
	);
	assert.equal(
		runsOf(handedOver).length,
		2,
		"a settled answer with no calls still ends the turn",
	);
	/*
	 * THE RESIDUE, PINNED (agent review round 1, F2): the rows genuinely cannot
	 * tell a steer from a user message after a turn whose declared calls never
	 * landed. A terminal marker can, and still closes the run - so the merge costs
	 * a mis-grouped bar only when the turn died invisibly, never when it said so.
	 */
	const withMarker = rows.flatMap((entry, index) =>
		index === 2
			? [
					entry,
					row("m1", "custom", {
						text: "the turn died",
						level: "error",
						customType: "session_incident",
					}),
				]
			: [entry],
	);
	assert.equal(
		runsOf(withMarker).length,
		2,
		"a terminal marker after the lead-in closes it: the next user row opens a turn",
	);
});

/*
 * THE RELEASE THE FIX RELIES ON, DRIVEN THROUGH THE REDUCER (ux round 1, U2;
 * review round 2, M2). `runStatesItsOwnLiveness` keeps a run open while its rows
 * claim to be live; `agent_end` is what makes them stop, and this pins that the
 * turn then condenses - for a clean end and for an abort, which is the one
 * settle that happens without a `message_end` (the reducer's own sweep).
 */
const liveTurn = () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", "Which invoices?") },
		TS,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "t1",
			tool_name: "bash",
			args: { command: "pnpm test" },
		},
		TS + 500,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "t1",
			tool_name: "bash",
			result: { content: [{ type: "text", text: "ok\n" }] },
			is_error: false,
			duration_s: 2,
		},
		TS + 1_500,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 2_000,
	);
	return state;
};

for (const aborted of [false, true]) {
	test(`agent_end (${aborted ? "aborted" : "clean"}) settles the rows and condenses the turn`, () => {
		const state = applyEvent(
			liveTurn(),
			{ type: "agent_end", aborted },
			TS + 3_000,
		);
		const rows = buildRows(state.records, []);
		const answer = state.records.find((record) => record.id === "a1");
		assert.equal(
			answer?.kind === "assistant" && answer.streaming,
			false,
			"the turn end settled the streaming row",
		);
		const plan = collapsePlan(rows, { live: false });
		assert.equal(plan.runs.length, 1, "one turn, not a split");
		assert.equal(
			plan.runs[0].collapses,
			true,
			"and it condenses: nothing is left claiming to be live",
		);
	});
}

/*
 * THE WINDOW SNAP MOVES THE SLICE ON THE DIP FRAME (agent review round 1,
 * R1-1). `openingIndex` is slice-relative: for a run whose head the window
 * cuts it names the run's first VISIBLE row, and the snap grows the window to
 * the run's true head exactly when the pane reads not-live (the completed-run
 * allowance in `snapWindowToRunBoundary` opens from 300 to 720) - so an
 * equality test at the opening index reads a DIFFERENT row on the one frame
 * the latch exists for, folds the tail (the reviewer measured: 60 rows painted
 * -> 3, the 59 post-steer work rows behind bars), and the re-entry unfolds it:
 * the reported alternation survives for tall newest runs. Containment over the
 * run's own rows is the invariant both moves preserve.
 */
const BAND_WINDOW = 60;
/* The component's own `WINDOW_ALIGN_MAX_EXTRA` (canonical-transcript.tsx); the
 * completed-run allowance is the model's exported 720. Named for the band,
 * because `SNAP_MAX_EXTRA` already belongs to the align tests below. */
const BAND_MAX_EXTRA = 300;

/** The reviewer's failing shape: one 644-row newest run, head-cut at a 60-row window. */
const tallRunRows = () => {
	const rows = [user("u1")];
	for (let i = 1; i <= 12; i += 1)
		rows.push(tool(`t${i}`, { ts: TS + i * 1_000 }));
	rows.push(
		answer("a1", {
			ts: TS + 20_000,
			settledAt: TS + 20_000,
			stopReason: "stop",
		}),
	);
	for (let i = 13; i <= 582; i += 1)
		rows.push(tool(`t${i}`, { ts: TS + 30_000 + i * 1_000 }));
	rows.push(user("s1", { ts: TS + 900_000, text: "also check the ledger" }));
	for (let i = 0; i < 59; i += 1)
		rows.push(tool(`w${i}`, { ts: TS + 950_000 + i * 1_000 }));
	return rows;
};

/** One component frame: the snap at `live`, the slice it hands the plan, and the plan. */
const snapFrame = (rows, live, watchedRunId) => {
	const align = snapWindowToRunBoundary(
		rows,
		BAND_WINDOW,
		BAND_MAX_EXTRA,
		WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
		live,
		windowTopRun(rows, BAND_WINDOW),
	);
	const visible = rows.slice(rows.length - align);
	return {
		align,
		visible,
		plan: collapsePlan(visible, { live, watchedRunId }),
	};
};

/** The rows a frame PAINTS - visible minus everything behind a closed bar. */
const paintedOf = (frame) => {
	const hidden = new Set(hidesOf(frame.plan));
	return new Set(
		frame.visible
			.filter((row) => !hidden.has(row.record.id))
			.map((row) => row.record.id),
	);
};

test("a head-cut window whose snap grows on the dip frame cannot fold a watched run (R1-1)", () => {
	const rows = tallRunRows();
	assert.equal(
		rows.length,
		644,
		"the reviewer's shape: one 644-row newest run",
	);
	const live = snapFrame(rows, true, null);
	/*
	 * WHILE LIVE THE SNAP STAYS AT THE ORDINARY BOUND: the run extends past it,
	 * the window cuts its head, and the id the write side latches is the run's
	 * first VISIBLE row - `s1`, not the true opening `u1`.
	 */
	assert.equal(live.align, BAND_WINDOW, "the live frame keeps the raw window");
	const newest = live.plan.runs.at(-1);
	assert.equal(
		live.visible[newest.run.openingIndex]?.record.id,
		"s1",
		"a head-cut run's opening AS THE SLICE SEES IT is its first visible row",
	);
	/*
	 * THE DIP: the snap's completed-run allowance opens and the slice grows to the
	 * run's true head - and the latch's id must still be found, because it is one
	 * of the run's own rows. The hides are then the pre-close span alone, and no
	 * row the live frame painted may be lost (the reviewer's own metric; under the
	 * opening-index equality this frame hid 641 rows and lost the 59 `w*` rows).
	 */
	const latchId = "s1";
	const dip = snapFrame(rows, false, latchId);
	assert.equal(dip.align, 644, "the dip frame's snap reaches the true opening");
	assert.deepEqual(
		hidesOf(dip.plan),
		Array.from({ length: 12 }, (_, i) => `t${i + 1}`),
		"the dip folds only the settled pre-close span, never the post-steer work",
	);
	const paintedLive = paintedOf(live);
	const paintedDip = paintedOf(dip);
	const lost = [...paintedLive].filter((id) => !paintedDip.has(id));
	assert.deepEqual(
		lost,
		[],
		"no row the live frame painted is lost to the dip",
	);
	assert.ok(
		paintedDip.has("s1"),
		"the steer row stays on screen through the dip",
	);
	// The re-entry: back to the raw window; the same latch, nothing handed back.
	const again = snapFrame(rows, true, latchId);
	const paintedAgain = paintedOf(again);
	assert.deepEqual(
		[...paintedAgain].filter((id) => !paintedDip.has(id)),
		[],
		"the re-entry paints what the dip painted; the fold/unfold pair is gone",
	);
});

/*
 * THE BAR'S `+` READS THE ANCHORED LIVENESS TOO (agent review round 1, R1-2):
 * `partial` spent raw `live`, so a watched run whose fact was corrected by rows
 * that arrived after the page (the B2 shape) dropped the `+` for a frame at
 * every dip while the hide set held still - a transient leaking into a visual.
 */
test("the latch's partial `+` does not flicker with `live` (R1-2)", () => {
	const page = { ids: new Set(["tool:t1", "tool:t2", "a0"]), newestKey: "a0" };
	const rows = [
		tool("tool:t1", { ts: TS, durationS: 20 }),
		tool("tool:t2", { ts: TS + 1, durationS: 20 }),
		answer("a0", { ts: TS + 2 }),
		tool("tool:w1", { ts: TS + 3, durationS: 1 }),
		tool("tool:w2", { ts: TS + 4, durationS: 1 }),
		tool("tool:w3", { ts: TS + 5, durationS: 1 }),
		answer("a1", { ts: TS + 6 }),
	];
	const options = (live) => ({
		live,
		watchedRunId: "tool:t1",
		runFacts: new Map([
			[
				"a0",
				{
					actions: 30,
					workedSeconds: 60,
					failed: 0,
					complete: true,
					closingAnswerId: "a1",
				},
			],
		]),
		factPage: page,
	});
	let hides = null;
	for (const live of [true, false, true, false]) {
		const run = collapsePlan(rows, options(live)).runs[0];
		assert.equal(
			run.segments[0].facts.partial,
			true,
			`the watched run's corrected fact keeps its floor reading on live=${live}`,
		);
		const next = hidesOf(collapsePlan(rows, options(live)));
		if (hides !== null) {
			assert.deepEqual(next, hides, `the hide set holds still on live=${live}`);
		} else {
			hides = next;
		}
	}
});

test("in-turn receipts hide with the work; the pinned kinds keep their place", () => {
	// §5 case 15, NARROWED for the operator's feedback (2026-09-29, issue #5):
	// peer and wake receipts collapse with the work, and the rows that remain
	// pinned are the ones a collapsed turn cannot be read without.
	const plan = planOf([
		user("u1"),
		{
			record: {
				kind: "peer",
				id: "r1",
				ts: TS,
				body: "from a peer",
				/* The full sender shape the reducer guarantees (see `peerFields`):
				 * the quiet group's sender summary reads it, and `{}` used to throw. */
				sender: {
					pid: "",
					conversationName: "",
					cwd: "",
					sessionId: "",
					modelLabel: "",
				},
			},
			gap: "turn",
			closesTurn: false,
		},
		{
			record: { kind: "wake", id: "r2", ts: TS + 1, text: "a wake delivery" },
			gap: "item",
			closesTurn: false,
		},
		tool("t1", {}, "trace"),
		answer("a1"),
	]);
	assert.deepEqual(
		plan.runs[0].hidden.map((hidden) => hidden.record.id),
		["r1", "r2", "t1"],
		"the receipts hide with the work",
	);
	const withMemory = planOf([
		user("u1"),
		{
			record: { kind: "compaction", id: "c9", ts: TS + 2, text: "compacted" },
			gap: "turn",
			closesTurn: false,
		},
		tool("t1", {}, "trace"),
		answer("a1"),
	]);
	assert.deepEqual(
		withMemory.runs[0].hidden.map((hidden) => hidden.record.id),
		["t1"],
		"the memory statement stays on screen",
	);
});

test("a receipt after the answer is not part of the collapsed span", () => {
	// The collapse summarises the PREFIX of the turn; what arrived after the
	// hand-over (a job result, an incident) stays where it landed.
	const receipt = {
		record: {
			kind: "custom",
			id: "c1",
			ts: TS + 1_000,
			customType: "job_result",
			level: "info",
			category: null,
			provider: null,
			headline: "Job done.",
			detail: null,
			text: "Job done.",
		},
		gap: "item",
		closesTurn: false,
	};
	const after = planOf([user("u1"), tool("t1"), answer("a1"), receipt]);
	assert.deepEqual(
		after.runs[0].hidden.map((hidden) => hidden.record.id),
		["t1"],
		"the receipt after the answer is not hidden",
	);
	const before = planOf([
		user("u1"),
		{ ...receipt, gap: "turn" },
		tool("t1", {}, "trace"),
		answer("a1"),
	]);
	assert.deepEqual(
		before.runs[0].hidden.map((hidden) => hidden.record.id),
		["c1", "t1"],
		"inside the span the same receipt is the noise the collapse exists for",
	);
});

/* -------------------------------- pins ---------------------------------- */

test("the pin list is one predicate, and every kind is decided by it", () => {
	for (const kind of ["compaction"]) {
		assert.equal(
			staysVisibleWhileCollapsed({ kind, id: "x", ts: TS }),
			true,
			kind,
		);
	}
	/*
	 * ISSUE #5 (operator feedback, 2026-09-29): the receipts collapse with the
	 * work. The v1 pins argued "a message the reader never saw"; real turns
	 * showed they are in-turn evidence and the visual weight the collapse
	 * exists for.
	 */
	for (const kind of ["peer", "wake"]) {
		assert.equal(
			staysVisibleWhileCollapsed({ kind, id: "x", ts: TS }),
			false,
			`${kind} receipts collapse with the work`,
		);
	}
	assert.equal(
		staysVisibleWhileCollapsed({
			kind: "notice",
			id: "x",
			ts: TS,
			text: "Interrupted",
			level: "info",
			complete: true,
		}),
		true,
		"a completion marker",
	);
	assert.equal(
		staysVisibleWhileCollapsed({
			kind: "notice",
			id: "x",
			ts: TS,
			text: "note",
			level: "info",
		}),
		false,
		"an info notice is the noise",
	);
	assert.equal(
		staysVisibleWhileCollapsed({
			kind: "custom",
			id: "x",
			ts: TS,
			customType: "session_incident",
			level: "error",
			category: null,
			provider: null,
			headline: "The session died.",
			detail: null,
			text: "The session died.",
		}),
		true,
		"the incident that says why the turn stopped",
	);
	assert.equal(
		staysVisibleWhileCollapsed({
			kind: "custom",
			id: "x",
			ts: TS,
			customType: "job_result",
			level: "info",
			category: null,
			provider: null,
			headline: "Job done.",
			detail: null,
			text: "Job done.",
		}),
		false,
		"a job receipt hides",
	);
	assert.equal(
		staysVisibleWhileCollapsed({ kind: "tool", id: "x", ts: TS }),
		false,
	);
	assert.equal(
		staysVisibleWhileCollapsed({
			kind: "assistant",
			id: "x",
			ts: TS,
			text: "in between",
			streaming: false,
		}),
		false,
	);
	/*
	 * THE SUPPLEMENT BLOCK (turn-supplements memo §2.11/§3.3 U3): it is NOT a
	 * pin, deliberately. The pin list is the boundary vocabulary
	 * (`boundaryKindOf`), and the block is a STATEMENT that terminates the
	 * turn's span instead of living inside it — the trailing-statement walk
	 * keeps it visible from outside. Adding it here would put it inside the
	 * span's keep list and hide the fact that the span ends at it.
	 */
	assert.equal(
		staysVisibleWhileCollapsed({
			kind: "supplement",
			id: "x",
			ts: TS,
			anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
			job: "3f9c1a7e5b20",
			version: 1,
			state: "done",
			files: [],
			filesMore: 0,
			more: [],
			components: [],
			error: "",
			dismissed: false,
			live: false,
		}),
		false,
		"a supplement block is a statement, not a pin inside the span",
	);
});

/* ---------------------- the supplement block's seat (U-b) ---------------- */

test("a supplement row sits outside the condensed span it follows", () => {
	/*
	 * The memo's fold requirement (turn-supplements §2.11, lane U-b), pinned as
	 * the reader-visible consequence rather than as the predicate: the block is
	 * placed AFTER the answer it belongs to, and the condensed span may not
	 * swallow it — it reports what the turn PRODUCED. With the block last in the
	 * turn, the collapse hides the turn's calls and nothing else.
	 */
	const block = row("s1", "supplement", {
		anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		job: "3f9c1a7e5b20",
		version: 1,
		state: "done",
		files: [],
		filesMore: 0,
		more: [],
		components: [],
		error: "",
		dismissed: false,
		live: false,
	});
	const plan = planOf([
		user("u1"),
		tool("t1", {}, "trace"),
		answer("a1"),
		block,
	]);
	assert.deepEqual(
		plan.runs[0].hidden.map((hidden) => hidden.record.id),
		["t1"],
		"the calls condense; the supplement block stays on screen",
	);
});

test("the block's condensed read flips exactly with the bar (design D1.1)", () => {
	/*
	 * `runIsCondensed` is the ONE reading of the collapse plan the supplement
	 * block's one-line form may come from: a bar that RENDERS closed condenses
	 * it, the reader's own expansion (the same `openRuns` set the bar's `open`
	 * prop reads) restores it in the same pass, and a plan with no bars never
	 * condenses anything.
	 */
	const block = row("s1", "supplement", {
		anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		job: "3f9c1a7e5b20",
		version: 1,
		state: "done",
		files: [],
		filesMore: 0,
		more: [],
		components: [],
		error: "",
		dismissed: false,
		live: false,
	});
	const plan = planOf([
		user("u1"),
		tool("t1", {}, "trace"),
		answer("a1"),
		block,
	]);
	const run = plan.runs[0];
	assert.ok(
		run.segments.length > 0,
		"the fixture must produce a bar for this case to mean anything",
	);
	assert.equal(
		runIsCondensed(run, undefined),
		true,
		"a closed bar condenses the block",
	);
	assert.equal(
		runIsCondensed(run, new Set(run.segments.map((segment) => segment.key))),
		false,
		"the reader's open bar restores it",
	);
	assert.equal(
		runIsCondensed({ segments: [] }, undefined),
		false,
		"no bars, no condensation",
	);
});

/* ----------------------------- the duration ------------------------------ */

test("Took is the WORKED time: the seconds the span's own calls reported, summed (D1)", () => {
	/*
	 * One quantity on both sides of the answer (design review round 1 on #708,
	 * D1): the bar states what the foot states, `workedSeconds`. Model time, queue
	 * time and the answer's own settle instant are not in it - the wall span the
	 * first cut stated was 16.7x the foot's figure on the operator-shaped journal.
	 */
	const plan = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 1_100, endedAt: 3_500, durationS: 2.5 }, "turn"),
		tool("t2", { ts: 4_000, endedAt: 90_000, durationS: 1 }, "item"),
		answer("a1", { ts: 2_000, settledAt: 4_500_000 }),
	]);
	assert.equal(
		plan.runs[0].facts.durationS,
		3.5,
		"2.5s + 1s reported by the calls; the answer settling hours later adds nothing",
	);
});

test("a span whose calls reported under a second, or nothing, states no duration", () => {
	const under = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 1_100, durationS: 0.999 }, "turn"),
		answer("a1", { ts: 1_999 }),
	]);
	assert.equal(under.runs[0].facts.durationS, null, "0.999s is not `1s`");

	const exact = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 1_100, durationS: 1 }, "turn"),
		answer("a1", { ts: 2_000 }),
	]);
	assert.equal(exact.runs[0].facts.durationS, 1, "a full second is shown");

	const unreported = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 1_100, durationS: null }, "turn"),
		answer("a1", { ts: 9_000 }),
	]);
	assert.equal(
		unreported.runs[0].facts.durationS,
		null,
		"a call that reported no figure contributes none, and a span of them states none",
	);
});

test("the bars and the foot state ONE quantity: the pre-answer bars sum to the turn's figure (D1)", () => {
	/*
	 * The reconciliation the reader is invited to make: with a pinned row
	 * splitting the work, the action counts of the bars add up to the turn's, and
	 * so must the durations. Three bars of 60s, 30s and 10s of reported work.
	 */
	const plan = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 2_000, durationS: 60 }, "turn"),
		row("c1", "compaction", { text: "Context compacted", ts: 3_000 }, "item"),
		tool("t2", { ts: 4_000, durationS: 30 }, "item"),
		row("c2", "compaction", { text: "Context compacted", ts: 5_000 }, "item"),
		tool("t3", { ts: 6_000, durationS: 10 }, "item"),
		answer("a1", { ts: 99_999_000, settledAt: 99_999_000 }),
	]);
	const run = plan.runs[0];
	const bars = run.segments.filter((segment) => !segment.afterAnswer);
	assert.deepEqual(
		bars.map((segment) => segment.facts.durationS),
		[60, 30, 10],
	);
	assert.equal(
		bars.reduce((sum, segment) => sum + (segment.facts.durationS ?? 0), 0),
		run.facts.durationS,
		"bars sum to the turn's figure",
	);
	assert.equal(run.facts.durationS, 100);
	assert.equal(
		bars.reduce((sum, segment) => sum + segment.facts.actions, 0),
		run.facts.actions,
		"and so do the counts",
	);
});

/* ------- the completion walk's bound and gates (1b, spec section 7) ------- */

test("the completion walk's decision is the whole bound and its whole gate, by construction", () => {
	/*
	 * LOADER-CONTINUITY 1b, design spec section 7. The open-time alignment used
	 * to spend a FLAT two pages (`ALIGN_FETCH_MAX`), which is what left the
	 * operator's bar stating "97 actions" against a run of 423 calls: a turn
	 * whose head lay further up the journal than two pages could never complete
	 * its own condensation. It is now a bounded WALK, and this is the table the
	 * walk consults -- decided by construction, so the bound cannot be observed
	 * only by re-mounting a component (a strict-mode remount once made a
	 * per-instance cap of two read as three).
	 */
	assert.equal(ALIGN_WALK_MAX_PAGES, 12, "one act's worth of pages");
	const step = (spent, over = {}) =>
		alignWalkDecision(spent, {
			hasMore: true,
			loadingOlder: false,
			headCut: true,
			mayWalk: true,
			halted: false,
			...over,
		});
	assert.deepEqual(step(0), { fetch: true, spent: 1 });
	assert.deepEqual(
		step(ALIGN_WALK_MAX_PAGES - 1),
		{ fetch: true, spent: ALIGN_WALK_MAX_PAGES },
		"the last page inside the bound is spent",
	);
	assert.deepEqual(
		step(ALIGN_WALK_MAX_PAGES),
		{ fetch: false, spent: ALIGN_WALK_MAX_PAGES },
		"and the next one is not: the bound holds",
	);
	for (const [reason, over] of [
		["nothing left on the backend", { hasMore: false }],
		["a page is already in flight", { loadingOlder: true }],
		["no cut to complete", { headCut: false }],
		[
			"the reader is not following the tail, or has just given input",
			{ mayWalk: false },
		],
		["a page did not apply", { halted: true }],
	]) {
		assert.deepEqual(
			step(3, over),
			{ fetch: false, spent: 3 },
			`no page while ${reason}`,
		);
	}
});

/* --------------------------- the failed count (F4) ----------------------- */

test("failed counts genuine errors only: not aborts, not never-sent, not skips", () => {
	for (const [name, extra, expected] of [
		["a genuine error", { isError: true }, true],
		["an aborted call", { isError: false, stopped: true }, false],
		[
			"an abort whose raw flag still says error",
			{ isError: true, stopped: true },
			false,
		],
		["a call no tool received", { neverSent: true }, false],
		[
			"a call parked with a verdict",
			{ notRunReason: "invalid arguments" },
			false,
		],
		/*
		 * The class arm (the sibling's landed `not_run_kind` reading): a row that
		 * states an interrupted class is an interrupt even if a producer set
		 * neither `stopped` nor the reason pair - the same reading their reducer
		 * and row ladder make, consumed here through `isInterruptedFault`.
		 */
		[
			"a skipped call by class alone",
			{ isError: true, notRunKind: "skipped" },
			false,
		],
		[
			"an aborted call by class alone",
			{ isError: true, notRunKind: "aborted" },
			false,
		],
		["a success", {}, false],
	]) {
		assert.equal(
			isFailedCall({ kind: "tool", id: "t", ts: TS, ...extra }),
			expected,
			name,
		);
	}
	assert.equal(isFailedCall({ kind: "assistant", id: "a", ts: TS }), false);

	const plan = planOf([
		user("u1"),
		tool("t1", { isError: true }, "turn"),
		tool("t2", { isError: false, stopped: true }, "trace"),
		tool("t3", { isError: true }, "trace"),
		answer("a1"),
	]);
	assert.equal(plan.runs[0].facts.failed, 2, "t1 and t3");
	assert.equal(
		plan.runs[0].facts.firstFailedId,
		"t1",
		"the jump names the first failure, which is the row a reader wants opened",
	);
	assert.equal(
		plan.runs[0].facts.actions,
		3,
		"the aborted call is still an action",
	);
});

test("the hover sentence is the fold's own, phrased from the run's calls", () => {
	const plan = planOf([
		user("u1"),
		tool("t1", { toolName: "read" }, "turn"),
		tool("t2", { toolName: "read" }, "trace"),
		answer("a1"),
	]);
	assert.equal(plan.runs[0].facts.title, "Explored 2 files");
});

/* ------------------------------ the labels ------------------------------- */

test("every plan carries the run's ids and the closing answer's instant", () => {
	const plan = planOf([user("u1"), tool("t1"), answer("a1", { ts: TS + 7 })]);
	assert.deepEqual(plan.runs[0].recordIds, ["u1", "t1", "a1"]);
	assert.equal(plan.runs[0].stampTs, TS + 7);
});

test("closingAnswerIds still adds one answer per turn and nothing else", () => {
	/*
	 * The re-expression is behaviour-preserving for this function — the caption
	 * rule and the foot gate on it, and the unification must not move a single
	 * caption. The shapes here are the ones where the partition could drift:
	 * a steer, a settled steer, a headless prefix.
	 */
	const records = [
		user("u1"),
		answer("a1"),
		user("u2"),
		tool("t1"),
		user("s1"),
		tool("t2"),
		answer("a2"),
		user("u3"),
	];
	const closing = closingAnswerIds(records.map((wrapped) => wrapped.record));
	assert.deepEqual([...closing].sort(), ["a1", "a2"].sort());
});

/* ------------------ the partition's two edge shapes (R1-3) --------------- */

/*
 * Both shapes below run the REAL reducer and the REAL row builder — the
 * accepted-trigger edge lives in the space between them (a settled assistant
 * that paints nothing), which hand-built rows cannot express. Agent review
 * round 1, R1-3.
 */

const userMessage = (id, text) => ({
	id,
	role: "user",
	content: [{ type: "text", text }],
	tool_calls: [],
});
const assistantMessage = (id, text) => ({
	id,
	role: "assistant",
	content: text ? [{ type: "text", text }] : [],
	tool_calls: [],
});

test("R1-3(a): a prose-free settled answer does not close the run — the next message folds in", () => {
	/*
	 * R2's "worse" direction, pinned as accepted: a turn whose final assistant
	 * is tool-call-only is a real kept shape, invisible in row space, so the
	 * partition's closure test cannot see it — the next user message folds in
	 * as a steer. The design round states the accepted trigger set for this
	 * fold-in; the test exists so the behaviour is a decision, not a surprise.
	 */
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", "Which invoices?") },
		TS,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "t1",
			tool_name: "bash",
			args: { command: "pnpm test" },
		},
		TS + 500,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "t1",
			tool_name: "bash",
			result: { content: [{ type: "text", text: "ok\n" }] },
			is_error: false,
			duration_s: 1,
		},
		TS + 1_500,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 2_000,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", "") },
		TS + 2_500,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: userMessage("u2", "And the credits?") },
		TS + 3_000,
	);
	const settled = state.records.find((record) => record.id === "a1");
	assert.equal(
		settled?.kind === "assistant" && settled.streaming,
		false,
		"the tool-call-only answer IS settled on the record list",
	);
	const rows = buildRows(state.records, []);
	assert.equal(
		rows.some((row) => row.record.id === "a1"),
		false,
		"but it paints no row — the partition cannot see the closure it made",
	);
	const runs = runsOf(rows);
	assert.equal(runs.length, 1, "so u2 folds into u1's run as a steer");
	assert.equal(
		runs[0].key,
		"u2",
		"keyed on its last row: the closure `a1` paints no row to key on",
	);
});

test("R1-3(b): a steer landing after settled mid-turn prose opens its own run", () => {
	/*
	 * R2's "stray bubble" direction: the closure test reads the SETTLED prose
	 * as an ending, so the steer opens a run of its own and the reader's
	 * second message stands alone. Letter of the frozen predicate; pinned so a
	 * future change to the closure must face this too.
	 */
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", "Which invoices?") },
		TS,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("n1", "") },
		TS + 1_000,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "Checking",
			message: assistantMessage("n1", ""),
		},
		TS + 1_500,
	);
	state = applyEvent(
		state,
		{
			type: "message_end",
			message: assistantMessage("n1", "Checking the ledger."),
		},
		TS + 2_000,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: userMessage("u2", "And the credits?") },
		TS + 2_500,
	);
	const rows = buildRows(state.records, []);
	const runs = runsOf(rows);
	assert.deepEqual(
		runs.map((run) => run.key),
		["n1", "u2"],
		"the steer opens a run: the settled prose counted as the ending",
	);
});

/* --------------- the cross-session filter, upstream of the plan ----------- */

test("hidden cross-session rows never reach the bar: counts equal the visible span", () => {
	/*
	 * The filter's seam (`canonical-transcript.tsx`'s `shownRecords`) sits
	 * UPSTREAM of this model - the plan is handed
	 * `collapsePlan(buildRows(visibleRecords(records, hide)))` - so the assertions
	 * worth making are compositional: a hidden `send` must not be in the
	 * partition, must not be counted among the bar's actions, and the model's
	 * own pin list must be what decides the receipt's fate with the option off.
	 *
	 * The unfiltered plan is computed too, because "no count leak" is only
	 * pinned by showing the raw count WOULD have included the send: the defect
	 * this guards is a filter applied to paint but not to the accounting.
	 */
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", "go") },
		TS,
	);
	for (const [callId, name, at] of [
		["c-send", "send", 100],
		["c-bash", "bash", 300],
	]) {
		state = applyEvent(
			state,
			{
				type: "tool_execution_start",
				tool_call_id: callId,
				tool_name: name,
				args: {},
			},
			TS + at,
		);
		state = applyEvent(
			state,
			{
				type: "tool_execution_end",
				tool_call_id: callId,
				tool_name: name,
				result: { content: [{ type: "text", text: "ok" }] },
				is_error: false,
				duration_s: 1,
			},
			TS + at + 50,
		);
	}
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "done") },
		TS + 500,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", "done") },
		TS + 600,
	);
	const [opening, ...rest] = state.records;
	/* The peer receipt inside the span, in the pinned-row test's own shape. */
	const records = [
		opening,
		{
			kind: "peer",
			id: "p1",
			ts: TS + 50,
			body: "from a peer",
			sender: {
				pid: "",
				conversationName: "",
				cwd: "",
				sessionId: "",
				modelLabel: "",
			},
		},
		...rest,
	];
	const sendId = records.find(
		(record) => record.kind === "tool" && record.toolName === "send",
	).id;

	/* Off: the bare reference, the same plan, the model's own pin list. */
	assert.equal(visibleRecords(records, false), records);
	const planOff = planOf(buildRows(visibleRecords(records, false), []));
	assert.deepEqual(planOff, planOf(buildRows(records, [])));
	assert.ok(
		planOff.runs[0].recordIds.includes(sendId),
		"with the option off the send row is part of the run",
	);
	/*
	 * The receipt follows the MODEL's pin list rather than this test's memory
	 * of it: #634 dropped `peer`/`wake` from the pins (issue #5 - inside a
	 * completed turn the delivery receipts are the bulk of the visual weight),
	 * so with the option off the peer sits in the run and among the collapsed
	 * rows. What the filter owns is the list it hands over - the bare reference
	 * above - and the on-half below pins that it cannot leave a count or an id
	 * behind for either row.
	 */
	assert.ok(
		planOff.runs[0].recordIds.includes("p1") &&
			planOff.runs[0].hidden.some((row) => row.record.id === "p1"),
		"with the option off the peer receipt is in the run and collapses with the work",
	);

	/* On: neither row reaches the partition, and the count drops by the send. */
	const planOn = planOf(buildRows(visibleRecords(records, true), []));
	assert.equal(
		planOn.runs[0].facts.actions,
		1,
		"only the bash row is counted - no residual count for the hidden send",
	);
	assert.equal(
		planOf(buildRows(records, [])).runs[0].facts.actions,
		2,
		"unfiltered the send WOULD be counted, so the filter is what removed it",
	);
	assert.ok(
		!planOn.runs[0].recordIds.includes(sendId) &&
			!planOn.runs[0].recordIds.includes("p1"),
		"neither hidden row is in the bar's ids",
	);
	assert.ok(
		!String(planOn.runs[0].facts.title).toLowerCase().includes("send"),
		"the bar's sentence names no hidden tool",
	);
});

/* ---------- the window widen, measured in the reader's currency (1b) ---------- */

/*
 * WHAT THESE PIN. The render window is a RAW row count, but a completed run
 * folds into one bar, so a raw step over a transcript of finished turns paints
 * almost nothing new (measured against the operator's real-shape journal: a
 * 618-row run painted 4..7 rows across window 60..300 - every widen step
 * invisible, ten gestures of nothing). `widenTarget` picks the next window
 * size by what the reader SEES. The painted-row count below is computed HERE
 * from `collapsePlan` on purpose, independent of the shipped `paintedRows`, so
 * the assertion cannot agree with the code by construction.
 */
const SNAP_MAX_EXTRA = 300;
/*
 * THE RENDER'S OWN DERIVATION, restated (agent review round 1, R1-1/R1-4). It is
 * `canonical-transcript.tsx`'s two calls with the SAME two bounds — `alignSize`
 * from the snap, then the plan over the mounted slice — so the assertions below
 * are against the window the component mounts rather than a replica that stops
 * at the ordinary allowance. The first cut passed only `SNAP_MAX_EXTRA`, which is
 * exactly why the completed-run case was invisible to this file.
 */
const paintedAt = (
	rows,
	size,
	{
		live = false,
		openRuns,
		mode,
		completedRunMaxExtra = WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	} = {},
) => {
	const total = rows.length;
	const align = snapWindowToRunBoundary(
		rows,
		size,
		SNAP_MAX_EXTRA,
		completedRunMaxExtra,
	);
	const visible = total > align ? rows.slice(total - align) : rows;
	const plan = collapsePlan(visible, { live, openRuns, mode });
	return (
		visible.length -
		plan.runs.reduce(
			(sum, run) =>
				sum +
				run.segments
					.filter((s) => s.collapsed && !openRuns?.has(s.key))
					.reduce((n, s) => n + s.rows.length, 0),
			0,
		)
	);
};

/** `turns` finished turns of `toolsPerTurn` calls each: user, tools, answer. */
const finishedTurns = (turns, toolsPerTurn) => {
	const rows = [];
	for (let turn = 0; turn < turns; turn += 1) {
		rows.push(user(`u${turn}`, { ts: TS + turn * 100_000 }));
		for (let index = 0; index < toolsPerTurn; index += 1) {
			rows.push(
				tool(
					`t${turn}-${index}`,
					{ ts: TS + turn * 100_000 + 1_000 + index },
					"trace",
				),
			);
		}
		rows.push(answer(`a${turn}`, { ts: TS + turn * 100_000 + 90_000 }));
	}
	return rows;
};

/**
 * A fetched set that STARTS mid-run, with the window edge inside that head-cut
 * run: the journal's own shape (`read_transcript_page` returns 100 entries and
 * the conversation's long turn continues above them). 105 rows, so a 60-row
 * window's top edge (index 45) lands inside the first, head-cut run.
 */
const headCutRows = () => [
	...Array.from({ length: 100 }, (_, i) =>
		tool(`hc${i}`, { ts: TS + i, durationS: 2 }, "trace"),
	),
	user("u2", { ts: TS + 10_000 }),
	answer("a2", { ts: TS + 11_000 }),
	user("u3", { ts: TS + 12_000 }),
	tool("t3", { ts: TS + 13_000 }, "trace"),
	answer("a3", { ts: TS + 14_000 }),
];

test("widenTarget: a plain +step over finished turns paints fewer than 8 new rows, the target does not", () => {
	assert.equal(
		typeof widenTarget,
		"function",
		"widenTarget must be exported by the turn-collapse model",
	);
	const rows = finishedTurns(30, 24);
	const window = 60;
	const base = paintedAt(rows, window);
	const plain = paintedAt(rows, window + 60);
	assert.ok(
		plain - base < 8,
		`the defect this fixes: a raw +60 paints ${plain - base} new rows (base ${base}, plain ${plain})`,
	);
	const target = widenTarget(rows, window, {
		step: 60,
		maxRows: window + 12 * 60,
		live: false,
		snapMaxExtra: SNAP_MAX_EXTRA,
		completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	});
	assert.ok(target > window + 60, `the target keeps stepping (got ${target})`);
	assert.ok(
		paintedAt(rows, target) - base >= 8,
		`and lands where the reader sees at least 8 new rows (painted ${paintedAt(rows, target)} vs base ${base})`,
	);
	assert.ok(
		target <= window + 12 * 60 && target <= rows.length,
		"never past maxRows or the transcript",
	);
});

test("widenTarget: a completed tall run is mounted whole, so a gesture reaches PAST it (R1-1)", () => {
	/*
	 * ONE tall run whose opening row IS loaded (so the completed-run allowance
	 * mounts it whole — the state the completion walk produces at open), with
	 * finished turns above it. Two halves are pinned here, and they are the pair
	 * agent review round 1 found disagreeing:
	 *
	 *   - the metric describes the MOUNT (the run's own span, not the raw 60-row
	 *     window), so `paintedRows(rows, mount)` is the count the render paints;
	 *   - the widen, measured from that mount, steps past the run it already shows
	 *     in full and lands where a gesture can actually paint something — the
	 *     older turns above it.
	 *
	 * Before this round the replica in this file stopped at the ordinary snap
	 * bound, so the run was never mounted at window 60 and the case could not be
	 * expressed at all.
	 */
	const older = [];
	for (let turn = 0; turn < 5; turn += 1) {
		older.push(user(`ou${turn}`, { ts: TS + turn * 300_000 }));
		for (let index = 0; index < 20; index += 1) {
			older.push(
				tool(
					`ot${turn}-${index}`,
					{ ts: TS + turn * 300_000 + 1_000 + index },
					"trace",
				),
			);
		}
		older.push(answer(`oa${turn}`, { ts: TS + turn * 300_000 + 90_000 }));
	}
	const tall = [
		user("u1", { ts: TS + 2_000_000 }),
		...Array.from({ length: 616 }, (_, index) =>
			tool(`t${index}`, { ts: TS + 2_000_000 + index }, "trace"),
		),
		answer("a1", { ts: TS + 3_000_000 }),
	];
	assert.equal(tall.length, 618, "fixture: the operator's one long run");
	const rows = [...older, ...tall];
	const options = {
		step: 60,
		live: false,
		snapMaxExtra: SNAP_MAX_EXTRA,
		completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	};
	const mount = snapWindowToRunBoundary(
		rows,
		60,
		SNAP_MAX_EXTRA,
		WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	);
	assert.equal(
		mount,
		tall.length,
		"the allowance mounts the completed run whole",
	);
	assert.equal(
		paintedRows(rows, mount, options),
		paintedAt(rows, mount),
		"and the metric agrees with the render about that mount",
	);
	const before = paintedRows(rows, mount, options);
	const target = widenTarget(rows, mount, {
		...options,
		maxRows: mount + 12 * 60,
	});
	assert.ok(
		target > mount,
		`the search steps past the mounted run rather than inside it (${target} > ${mount})`,
	);
	assert.ok(
		paintedRows(rows, target, options) - before >= 8,
		`and paints at least the minimum a reader can be said to have been shown (${before} -> ${paintedRows(rows, target, options)})`,
	);
});

test("widenTarget: nothing to collapse behaves as a plain +step, and never overshoots the transcript", () => {
	const chat = [];
	for (let turn = 0; turn < 100; turn += 1) {
		chat.push(user(`cu${turn}`), answer(`ca${turn}`));
	}
	const options = {
		step: 60,
		maxRows: 60 + 12 * 60,
		live: false,
		snapMaxExtra: SNAP_MAX_EXTRA,
		completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	};
	assert.equal(widenTarget(chat, 60, options), 120);
	assert.equal(widenTarget(chat, 180, options), 200, "clamped to the total");
	assert.equal(widenTarget(chat, 200, options), 200, "already everything");
	/*
	 * A LIVE newest run does not collapse, so its rows all paint and the first
	 * step is already a visible reveal: a plain +step. (The run is longer than
	 * the snap's own reach on purpose - a short one would be pulled whole into
	 * the window by `snapWindowToRunBoundary`, and the case would be about the
	 * snap rather than about liveness.)
	 */
	const running = [
		user("ru"),
		...Array.from({ length: 699 }, (_, i) => tool(`rt${i}`, {}, "trace")),
	];
	assert.equal(widenTarget(running, 60, { ...options, live: true }), 120);
});

test("widenTarget: an open run counts as painted, exactly as the render pass does", () => {
	const rows = finishedTurns(30, 24);
	const options = {
		step: 60,
		maxRows: 60 + 12 * 60,
		live: false,
		snapMaxExtra: SNAP_MAX_EXTRA,
		completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	};
	const allOpen = new Set(segmentKeysOf(rows));
	const openTarget = widenTarget(rows, 60, { ...options, openRuns: allOpen });
	assert.equal(openTarget, 120, "one step is already a visible reveal");
	assert.ok(
		paintedAt(rows, openTarget, { openRuns: allOpen }) -
			paintedAt(rows, 60, { openRuns: allOpen }) >=
			8,
		"and the rows it reveals really do paint",
	);
	assert.ok(
		openTarget < widenTarget(rows, 60, options),
		`an open run reaches the reader sooner than a collapsed one (${openTarget} < ${widenTarget(rows, 60, options)})`,
	);
});

/* ------------- the paint count's own mode (M1 / Q1, issue #756) ------------- */

/*
 * WHAT THESE PIN. `paintedRows` is the widen's currency - the step keeps walking
 * while the window has not PAINTED `minVisibleRows` more rows - and it reads the
 * same `collapsePlan` the render paints from. The plan's mode is an OPTIONAL
 * field, so leaving it off means `by-turn`; a render in `by-response` whose
 * metric was built without one therefore counted the narration rows as hidden
 * while the reader was looking at them, and the search could step past the size
 * that actually painted a reveal (agent review round 1 M1, QA round 1 Q1). The
 * two cases below are the two halves of the fix: the metric must read the
 * reader's mode, and its absence must still be exactly the shipped arithmetic.
 *
 * The fixture is the reviewer's own shape - a settled turn that NARRATED
 * mid-turn, 30 rows a turn, so the window really cuts: by-turn hides the
 * narration inside the bar, by-response keeps it on screen.
 */
const narratedTurns = (turns) => {
	const rows = [];
	for (let turn = 0; turn < turns; turn += 1) {
		const at = TS + turn * 100_000;
		rows.push(user(`nu${turn}`, { ts: at }));
		for (let i = 0; i < 13; i += 1)
			rows.push(tool(`nt${turn}-${i}`, { ts: at + 1_000 + i }, "trace"));
		/*
		 * The narration: settled assistant text that CARRIES its own calls (the wire
		 * fact `isFinalResponse` reads) and has a call after it, so `cyclesOf` reads
		 * it as narration rather than a close - hidden by `by-turn`, kept by
		 * `by-response`. That difference is the whole fixture; omitting `callsTools`
		 * let V5 pin the row in by-turn and erase it (review round 3, finding 3).
		 */
		rows.push(
			answer(`nn${turn}`, {
				ts: at + 50_000,
				text: "still working",
				callsTools: true,
			}),
		);
		for (let i = 0; i < 14; i += 1)
			rows.push(tool(`nb${turn}-${i}`, { ts: at + 60_000 + i }, "trace"));
		rows.push(answer(`na${turn}`, { ts: at + 90_000 }));
	}
	return rows;
};

const MODE_OPTIONS = {
	step: 20,
	live: false,
	snapMaxExtra: SNAP_MAX_EXTRA,
	completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
};

/*
 * THE PRE-MODE ARITHMETIC, verbatim: `paintedRows` exactly as it shipped before
 * the mode existed, calling `collapsePlan` with no mode field at all. The
 * default-untouched proof compares the threaded function against THIS rather
 * than against its own by-turn branch, so "absent means the shipped behaviour"
 * is pinned as a property of the code and not restated in prose.
 */
const paintedRowsBeforeModes = (rows, windowSize, options) => {
	const total = rows.length;
	const alignSize = snapWindowToRunBoundary(
		rows,
		windowSize,
		options.snapMaxExtra,
		options.completedRunMaxExtra,
		options.live ?? false,
	);
	const visible = total > alignSize ? rows.slice(total - alignSize) : rows;
	const plan = collapsePlan(visible, {
		live: options.live ?? false,
		openRuns: options.openRuns,
	});
	let hidden = 0;
	for (const run of plan.runs) {
		for (const segment of run.segments) {
			if (segment.collapsed && !options.openRuns?.has(segment.key)) {
				hidden += segment.rows.length;
			}
		}
	}
	return visible.length - hidden;
};

/** The shipped `widenTarget`, verbatim, over the pre-mode count. */
const widenTargetBeforeModes = (rows, mountedSize, options) => {
	const total = rows.length;
	const minVisibleRows = options.minVisibleRows ?? 8;
	const maxRows = Math.min(total, options.maxRows ?? total);
	const { step } = options;
	const before = paintedRowsBeforeModes(rows, mountedSize, options);
	let size = Math.min(maxRows, mountedSize + step);
	while (
		size < maxRows &&
		paintedRowsBeforeModes(rows, size, options) - before < minVisibleRows
	) {
		size = Math.min(maxRows, size + step);
	}
	return size;
};

/**
 * The smallest candidate a mode's own paint count calls a reveal: the definition
 * `widenTarget` states, written here over `paintedAt` so the assertion is
 * against the reader's paint rather than against the function's own arithmetic.
 */
const smallestReveal = (rows, mountedSize, options, mode) => {
	const minVisibleRows = options.minVisibleRows ?? 8;
	const maxRows = Math.min(rows.length, options.maxRows ?? rows.length);
	const before = paintedAt(rows, mountedSize, { mode });
	let size = Math.min(maxRows, mountedSize + options.step);
	while (
		size < maxRows &&
		paintedAt(rows, size, { mode }) - before < minVisibleRows
	) {
		size = Math.min(maxRows, size + options.step);
	}
	return size;
};

test("paintedRows: the count is the READER's mode, so by-response matches the by-response paint (M1/Q1)", () => {
	const rows = narratedTurns(30);
	for (const size of [20, 40, 60, 120, 200, 320]) {
		const before = paintedRowsBeforeModes(rows, size, MODE_OPTIONS);
		const byTurn = paintedRows(rows, size, {
			...MODE_OPTIONS,
			mode: "by-turn",
		});
		const byResponse = paintedRows(rows, size, {
			...MODE_OPTIONS,
			mode: "by-response",
		});
		assert.equal(
			byTurn,
			before,
			`an explicit by-turn is the pre-mode arithmetic at window ${size}`,
		);
		assert.equal(
			byResponse,
			paintedAt(rows, size, { mode: "by-response" }),
			`the metric must match the by-response paint at window ${size}`,
		);
		assert.ok(
			byResponse > byTurn,
			`${size}: the narration by-response keeps on screen is not counted as hidden (${byTurn} -> ${byResponse})`,
		);
	}
});

test("widenTarget: the step's stop is measured in the reader's mode, not a by-turn opinion (M1/Q1)", () => {
	const rows = narratedTurns(30);
	const mounted = 60;
	const byTurnTarget = widenTarget(rows, mounted, MODE_OPTIONS);
	const byResponseTarget = widenTarget(rows, mounted, {
		...MODE_OPTIONS,
		mode: "by-response",
	});
	assert.equal(
		byTurnTarget,
		smallestReveal(rows, mounted, MODE_OPTIONS, "by-turn"),
	);
	assert.equal(
		byResponseTarget,
		smallestReveal(rows, mounted, MODE_OPTIONS, "by-response"),
		"the by-response step must stop on the size that paints eight more by-response rows",
	);
	assert.ok(
		paintedAt(rows, byResponseTarget, { mode: "by-response" }) -
			paintedAt(rows, mounted, { mode: "by-response" }) >=
			8,
		"and that size really is a reveal in the reader's own currency",
	);
	assert.ok(
		byResponseTarget < byTurnTarget,
		`by-response reaches a reveal sooner than the by-turn opinion does (${byResponseTarget} < ${byTurnTarget})`,
	);
});

test("paintedRows/widenTarget: absent, and explicit by-turn, are the shipped arithmetic byte for byte (M1 default-untouched proof)", () => {
	const rows = narratedTurns(30);
	for (const size of [20, 60, 120, 320]) {
		assert.equal(
			paintedRows(rows, size, MODE_OPTIONS),
			paintedRowsBeforeModes(rows, size, MODE_OPTIONS),
			`no mode is the pre-mode count at window ${size}`,
		);
		assert.equal(
			paintedRows(rows, size, { ...MODE_OPTIONS, mode: "by-turn" }),
			paintedRowsBeforeModes(rows, size, MODE_OPTIONS),
			`an explicit by-turn is the pre-mode count at window ${size}`,
		);
	}
	assert.equal(
		widenTarget(rows, 60, MODE_OPTIONS),
		widenTargetBeforeModes(rows, 60, MODE_OPTIONS),
		"no mode is the pre-mode step",
	);
	assert.equal(
		widenTarget(rows, 60, { ...MODE_OPTIONS, mode: "by-turn" }),
		widenTargetBeforeModes(rows, 60, MODE_OPTIONS),
		"an explicit by-turn is the pre-mode step",
	);
});

/* ---- the completed-run snap: the open frame the operator asked for (1b/A) ---- */

/*
 * WHAT THESE PIN. The bar's facts are computed over the MOUNTED window, so a run taller than the snap's
 * general bound states a partial count with no `Took` at open — the operator's symptom 1 ("the full set of
 * condensed messages don't load") with no gesture available to fix it, because a reader following the tail
 * is never widened (1a's guard, correctly). The rule: once the run's own opening row is IN THE STORE (rows
 * load tail-first and contiguously, so that row's presence is proof the whole run is loaded — and it is
 * what the completion walk now fetches), the snap may extend all the way to that row, up to a named cap.
 */
test("a run proven complete may be snapped to its own opening row, past the general bound", () => {
	const rows = finishedTurns(30, 24); // 780 rows, 26 per turn
	// Window 60 lands inside run 27 (rows 702..727), whose opening is 18 rows above the edge.
	assert.equal(
		snapWindowToRunBoundary(rows, 60, 300),
		78,
		"the general snap covers it: 18 <= the ordinary bound",
	);
	// A run taller than the general bound: one long run whose opening is far above the window edge.
	const tall = [
		user("tu", { ts: TS }),
		...Array.from({ length: 500 }, (_, i) =>
			tool(`tt${i}`, { ts: TS + 1_000 + i }, "trace"),
		),
		answer("ta", { ts: TS + 900_000 }),
	];
	assert.equal(
		snapWindowToRunBoundary(tall, 60, 300),
		60,
		"beyond the ordinary bound the snap refuses (the shipped behaviour)",
	);
	const completed = snapWindowToRunBoundary(
		tall,
		60,
		300,
		WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	);
	assert.ok(
		completed > 60,
		`a PROVEN-COMPLETE run must be reachable (got ${completed})`,
	);
	assert.equal(
		snapWindowToRunBoundary(
			tall,
			60,
			300,
			WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
		),
		completed,
	);
	// The completed run's opening row is in the list, and the snapped window therefore shows it.
	assert.equal(
		runsOf(tall.slice(tall.length - completed))[0].opensWithUserRow,
		true,
		"the snapped window opens on the run's own first row",
	);
	assert.equal(completed, tall.length, "and it covers the whole run");
});

test("the completed-run allowance is capped, and never applies to a head-cut run", () => {
	assert.equal(WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA, 720);
	const huge = [
		...Array.from({ length: 60 }, (_, i) =>
			tool(`ht${i}`, { ts: TS + i, durationS: 2 }, "trace"),
		),
		// 900 rows of one run AFTER the head-cut request: the enclosing run's extra exceeds the cap.
		user("hu", { ts: TS + 1_000 }),
		...Array.from({ length: 900 }, (_, i) =>
			tool(`hn${i}`, { ts: TS + 2_000 + i }, "trace"),
		),
		answer("ha", { ts: TS + 900_000 }),
	];
	// Window 60 with total 961: top = 901, inside the head-cut... no: build the cut case explicitly.
	const cut = [
		...Array.from({ length: 740 }, (_, i) =>
			tool(`ct${i}`, { ts: TS + i }, "trace"),
		),
		answer("ca", { ts: TS + 900_000 }),
	];
	assert.equal(
		windowTopRunIsHeadCut(cut, 60),
		true,
		"the fixture really is head-cut, or the case proves nothing",
	);
	assert.equal(
		snapWindowToRunBoundary(cut, 60, 300, WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA),
		60,
		"a head-cut run has no boundary to snap to, however large the allowance",
	);
	assert.ok(
		snapWindowToRunBoundary(
			huge,
			60,
			300,
			WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
		) <=
			60 + 720,
		"and the cap holds for a run taller than it",
	);
});

/* ------------- the walk's memory, per head-cut run (1b/B) ------------- */

test("the walk's budget belongs to a RUN: a second cut run gets its own, strictly once each", () => {
	/*
	 * The operator runs long-lived sessions: a conversation that outlives its first walk must still
	 * complete the bars of turns that settle LATER. The budget is therefore keyed by the run under the
	 * window's edge (its stable `runsOf` key), not by a counter that only resets on a session change.
	 */
	assert.equal(typeof alignWalkStateFor, "function");
	assert.equal(typeof alignWalkRunKey, "function");
	/*
	 * The fixture is the journal's own shape: the fetched set STARTS mid-run (no
	 * opening user row for the first run), and the window edge lands inside that
	 * first run — which is the state a completion walk exists for. A fully headed
	 * list has no head-cut run at all, so it cannot express this case.
	 */
	const rows = headCutRows();
	const keyA = alignWalkRunKey(rows, { live: false });
	assert.ok(keyA !== null, "this fixture opens on a condensed, head-cut bar");
	// Walk A to its bound.
	let state = initialAlignWalkState();
	state = alignWalkStateFor(state, keyA);
	let spentA = 0;
	for (let i = 0; i < ALIGN_WALK_MAX_PAGES + 3; i += 1) {
		const decision = alignWalkDecision(state.spent, {
			hasMore: true,
			loadingOlder: false,
			headCut: true,
			mayWalk: true,
			halted: state.halted,
		});
		state = { ...state, spent: decision.spent };
		if (decision.fetch) spentA += 1;
	}
	assert.equal(
		spentA,
		ALIGN_WALK_MAX_PAGES,
		"run A spends the bound, and only the bound",
	);
	// The SAME run again: no more work, however many effect runs pass.
	assert.equal(
		alignWalkStateFor(state, keyA).spent,
		ALIGN_WALK_MAX_PAGES,
		"the same run is never retried for the same content",
	);
	// A DIFFERENT head-cut run: its own budget.
	const stateB = alignWalkStateFor(state, "another-run-key");
	assert.equal(stateB.key, "another-run-key");
	assert.equal(stateB.spent, 0, "a later settled run gets its own walk");
	assert.equal(stateB.halted, false);
	assert.equal(
		alignWalkDecision(stateB.spent, {
			hasMore: true,
			loadingOlder: false,
			headCut: true,
			mayWalk: true,
			halted: stateB.halted,
		}).fetch,
		true,
		"and it starts spending immediately",
	);
	// `halted` is per run too: run A's failure does not silence run B.
	const haltedA = { ...state, halted: true };
	assert.equal(alignWalkStateFor(haltedA, "another-run-key").halted, false);
	assert.equal(
		alignWalkStateFor(haltedA, keyA).halted,
		true,
		"run A's own halt survives its own key",
	);
});

test("the walk is armed by the BAR, not by the window edge (QA round 1, Q-2)", () => {
	/*
	 * THE REGRESSION THIS PINS. The trigger used to be
	 * `windowTopRunIsHeadCut(rows, windowSize)`, which answers FALSE for a list
	 * SHORTER than the window — `windowTopRun` needs an edge to land in, and a list
	 * of 55 rows inside a 60-row window has none. That is the operator's restored
	 * journal: the first page lands 55 rows, the bar reads `30 actions` of 423, and
	 * the walk never fired at all (measured: 0 asks over 40 s of no input). The
	 * question the bar itself answers is the one that must arm it.
	 */
	const short = [
		...Array.from({ length: 50 }, (_, i) =>
			tool(`sh${i}`, { ts: TS + i }, "trace"),
		),
		answer("sha", { ts: TS + 900_000 }),
	];
	assert.equal(short.length, 51, "fixture: fewer rows than the window");
	assert.equal(
		windowTopRunIsHeadCut(short, 60),
		false,
		"the old trigger is blind here — that IS the defect",
	);
	assert.equal(
		collapsePlan(short, { live: false }).runs[0].collapses,
		true,
		"…while the run paints a condensed bar, which is what owes a walk",
	);
	assert.equal(
		alignWalkRunKey(short, { live: false }),
		runsOf(short)[0].key,
		"the key is the bar's own run, whatever the window edge does",
	);
});

test("alignWalkRunKey: null for a headed run, a live run, and a bar the reader has open", () => {
	const headed = [
		user("hu", { ts: TS }),
		...Array.from({ length: 100 }, (_, i) =>
			tool(`ht${i}`, { ts: TS + i, durationS: 2 }, "trace"),
		),
		answer("ha", { ts: TS + 900_000 }),
	];
	assert.equal(
		alignWalkRunKey(headed, { live: false }),
		null,
		"a run whose opening row is loaded owes no walk",
	);
	const cut = headCutRows();
	const key = alignWalkRunKey(cut, { live: false });
	assert.equal(key, runsOf(cut)[0].key, "the cut run's own key");
	assert.equal(
		alignWalkRunKey(cut, {
			live: false,
			openRuns: new Set(segmentKeysOf(cut)),
		}),
		null,
		"a bar the reader has OPEN paints its rows: there is no partial statement to complete",
	);
	/*
	 * The live case: a turn still being written never collapses (`live`), so even a
	 * head-cut newest run owes no walk — the walk is for a SETTLED turn's bar.
	 */
	const liveRun = Array.from({ length: 50 }, (_, i) =>
		tool(`lv${i}`, { ts: TS + i }, "trace"),
	);
	assert.equal(
		collapsePlan(liveRun, { live: true }).runs[0].collapses,
		false,
		"fixture: the live run paints no bar",
	);
	assert.equal(alignWalkRunKey(liveRun, { live: true }), null);
});

/* ------------- the store confirmation (agent review round 1, R1) ------------- */

test("alignWalkRunKeyConfirmed: a window-cut run the STORE holds whole is not a cut (round 1, R1)", () => {
	const WINDOW = 60;
	/*
	 * R1's counterexample: ONE settled run taller than the snap's completed
	 * allowance, its opening user row LOADED. The ordinary snap (720 here) cannot
	 * reach that opening row, so the raw edge sits inside the run — and the plan,
	 * built over `visible`, reads `opensWithUserRow: false` while nothing in the
	 * store is cut.
	 */
	const tall = [
		user("r1u0", { ts: TS }),
		...Array.from({ length: 1000 }, (_, i) =>
			tool(`r1t${i}`, { ts: TS + i, durationS: 2 }, "trace"),
		),
		answer("r1a0", { ts: TS + 2_000_000 }),
	];
	const alignSize = snapWindowToRunBoundary(
		tall,
		WINDOW,
		SNAP_MAX_EXTRA,
		WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
		false,
	);
	assert.ok(
		alignSize < tall.length,
		"fixture: the window really cuts the store",
	);
	const visible = tall.slice(tall.length - alignSize);
	const plan = collapsePlan(visible, { live: false });
	assert.equal(
		windowTopRunIsHeadCut(tall, alignSize),
		false,
		"the store's run under the same edge IS headed — its opening row is loaded",
	);
	assert.equal(
		alignWalkRunFromPlan(plan),
		runsOf(tall)[0].key,
		"the plan alone calls it cut: the R1 defect, on the same rows",
	);
	assert.equal(
		alignWalkRunKeyConfirmed(plan, windowTopRun(tall, alignSize)),
		null,
		"the store says otherwise, so the walk stands down without fetching",
	);
	/*
	 * The other direction: a store whose head really IS mid-run still yields the
	 * run's key, so the confirmation suppresses only the false cut.
	 */
	const cut = headCutRows();
	const cutSize = snapWindowToRunBoundary(
		cut,
		WINDOW,
		SNAP_MAX_EXTRA,
		WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
		false,
	);
	const cutVisible = cut.slice(cut.length - cutSize);
	const cutKey = runsOf(cut)[0].key;
	assert.equal(
		windowTopRunIsHeadCut(cut, cutSize),
		true,
		"fixture: the store's head is genuinely missing",
	);
	assert.equal(
		alignWalkRunKeyConfirmed(
			collapsePlan(cutVisible, { live: false }),
			windowTopRun(cut, cutSize),
		),
		cutKey,
		"a real cut still yields the key",
	);
	/*
	 * And when the window covers the whole list the plan IS the store's own view —
	 * the journal's first page (55 rows into a 60-row window) — so no second
	 * opinion is needed and the cut still fires.
	 */
	const short = [
		...Array.from({ length: 50 }, (_, i) =>
			tool(`r1sh${i}`, { ts: TS + i }, "trace"),
		),
		answer("r1sha", { ts: TS + 900_000 }),
	];
	assert.ok(short.length <= WINDOW, "fixture: the window covers the list");
	assert.equal(
		alignWalkRunKeyConfirmed(
			collapsePlan(short, { live: false }),
			windowTopRun(short, WINDOW),
		),
		runsOf(short)[0].key,
		"a cut the plan can already see the whole of is the store's own answer",
	);
});

/* ------------- the metric in the render's currency (agent review R1-1) ------------- */

test("paintedRows agrees with the render on a COMPLETE run past the ordinary snap bound (R1-1)", () => {
	/*
	 * The shape the allowance was added for, and the one the metric could not see:
	 * ONE run of 501 rows whose opening row IS loaded (proven complete), a window of
	 * 60. The ordinary snap (300) cannot reach its opening row; the completed-run
	 * allowance mounts all 501. Before the allowance was threaded through
	 * `paintedRows`, the metric described the raw 60-row window while the component
	 * mounted 501 — so the widen searched its whole bound for a painted delta of 0
	 * (agent review round 1, R1-1).
	 */
	const rows = [
		user("cu", { ts: TS }),
		...Array.from({ length: 499 }, (_, i) =>
			tool(`ct${i}`, { ts: TS + i }, "trace"),
		),
		answer("ca", { ts: TS + 900_000 }),
	];
	assert.equal(rows.length, 501);
	assert.equal(
		snapWindowToRunBoundary(rows, 60, SNAP_MAX_EXTRA),
		60,
		"the ordinary snap cannot reach the run's opening row",
	);
	assert.equal(
		snapWindowToRunBoundary(
			rows,
			60,
			SNAP_MAX_EXTRA,
			WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
		),
		rows.length,
		"the completed-run allowance mounts the whole run",
	);
	const options = {
		step: 60,
		snapMaxExtra: SNAP_MAX_EXTRA,
		completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	};
	assert.equal(
		paintedRows(rows, 60, options),
		paintedAt(rows, 60),
		"the metric and the render's own derivation agree about the same window",
	);
	assert.notEqual(
		paintedRows(rows, 60, options),
		paintedRows(rows, 60, { ...options, completedRunMaxExtra: 0 }),
		"and the allowance is load-bearing: without it the count describes a window nobody mounts",
	);
});

/* ------------- the bar's own honesty marker (design round 1, D1) ------------- */

test("the facts carry `partial` exactly while the run's head is cut (design D1)", () => {
	const cut = collapsePlan(headCutRows(), { live: false }).runs[0];
	assert.equal(
		cut.facts.partial,
		true,
		"a head-cut run states a MINIMUM: `N+ actions`, and no `Took`",
	);
	assert.equal(cut.facts.durationS, null, "and no duration to state either");
	const headed = [
		user("hu", { ts: TS }),
		...Array.from({ length: 100 }, (_, i) =>
			tool(`ht${i}`, { ts: TS + i, durationS: 2 }, "trace"),
		),
		answer("ha", { ts: TS + 900_000 }),
	];
	const complete = collapsePlan(headed, { live: false }).runs[0];
	assert.equal(
		complete.facts.partial,
		false,
		"a complete run states its count",
	);
	assert.ok(
		complete.facts.durationS !== null,
		"and its span, which is the pair the marker is the absence of",
	);
});

/* ------- the turn-ending response (issue #665), on the operator's journal ------ */

/**
 * These four use ONLY the exports that predate the segments change (`runsOf`,
 * `closingAnswerIds`, `buildRows`, `collapsePlan`, `.hidden`, `.facts`), on
 * purpose: they must FAIL on the tree before it, for the behaviour and not for a
 * missing import - the fail-before proof the regressions owe.
 */
function operatorRun() {
	const journal = FakeJournal.operator();
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		{ entries: journal.entries, has_more: false, cursor_missing: false },
		{ replace: true },
	);
	const rows = buildRows(state.records, []);
	const at = new Map(journal.entries.map((e, i) => [e.id, i]));
	return {
		journal,
		state,
		rows,
		at,
		plan: collapsePlan(rows, { live: false }),
	};
}

test("#665: the turn's answer is row 1196, not the post-dispose reply at 1229", () => {
	const { state, rows, at } = operatorRun();
	const closing = [...closingAnswerIds(state.records)].map((id) => at.get(id));
	assert.deepEqual(closing, [1196], "the caption belongs to the real answer");
	assert.deepEqual(
		rows.filter((r) => r.closesTurn).map((r) => at.get(r.record.id)),
		[1196],
	);
	assert.equal(at.get(runsOf(rows)[0].closingAnswerId), 1196);
});

test("#665: the answer is never hidden behind the bar", () => {
	const { plan, at } = operatorRun();
	const hidden = new Set(plan.runs[0].hidden.map((r) => at.get(r.record.id)));
	assert.equal(
		hidden.has(1196),
		false,
		"the answer stays mounted while collapsed",
	);
	assert.equal(
		hidden.has(1229),
		false,
		"and so does the run's LAST close (V2): the post-dispose reply is the last word",
	);
	/*
	 * THE BAR'S CONTENTS, not only its existence (agent review round 1, finding 4):
	 * `hidden.length > 0` keeps passing if a later widening of the visible set eats
	 * the follow-up's own bar down to one row. The follow-up's span is the run's
	 * LAST segment, and its `segmentIds` are exactly the rows that bar stands in
	 * for - the post-answer receipts and the calls they prompted.
	 */
	const followUp = plan.runs[0].segments.at(-1);
	assert.equal(followUp?.afterAnswer, true, "the last bar is the follow-up's");
	/*
	 * THE FOLLOW-UP BAR IS ITS OWN WORK ONLY, by the sanctioned contract:
	 * the two post-answer peer receipts (entry-001203, entry-001204) form
	 * their own compact internal episode - measured as the segment
	 * [entry-001203,entry-001204], collapsed, carrying internal facts - and
	 * entry-001206 (`message:session_mcp_unavailable`) is a notice boundary,
	 * NOT an internal origin, so it stays painted inline for the reader. Both
	 * facts are why those three rows are absent here rather than folded in.
	 * The episode condenses AT SETTLEMENT (this plan runs live:false), never
	 * while the turn is thinking - the one-bar gate owns that half.
	 *
	 * The invariants above are unchanged and are not negotiable: the answer
	 * (1196) stays mounted, and so does the run's last close (1229).
	 */
	assert.deepEqual(
		followUp?.segmentIds,
		[
			"entry-001208",
			"tool:call-1208-0",
			"entry-001211",
			"tool:call-1211-0",
			"entry-001214",
			"tool:call-1214-0",
			"tool:call-1217-0",
			"tool:call-1220-0",
			"entry-001223",
			"tool:call-1223-0",
			"entry-001226",
			"tool:call-1226-0",
			"tool:call-1226-1",
		],
		"the follow-up's own work still condenses into its bar, row for row",
	);
});

test("#665: the turn's action count is the turn's own, not the reply's work folded in", () => {
	const { plan } = operatorRun();
	assert.equal(
		plan.runs[0].facts.actions,
		415,
		"415 through the answer; 8 more are the follow-up's",
	);
});

test("#665: a pinned row between two hidden spans does not sit after a bar that precedes it", () => {
	const { plan, rows, at } = operatorRun();
	const order = [];
	const hidden = new Set(plan.runs[0].hidden.map((r) => r.record.id));
	// The slots a bar-per-span walk produces, from the model's hidden rows and the
	// rows that stay: the first hidden row of each contiguous span names its bar.
	let previousHidden = false;
	for (const row of rows) {
		const isHidden = hidden.has(row.record.id);
		if (isHidden && !previousHidden) order.push(`bar@${at.get(row.record.id)}`);
		if (!isHidden && row.record.kind === "compaction")
			order.push(`compaction@${at.get(row.record.id)}`);
		previousHidden = isHidden;
	}
	const bars = plan.runs[0].segments?.length ?? 1;
	assert.equal(
		order.filter((o) => o.startsWith("bar")).length,
		bars,
		"one bar per contiguous hidden span: the model must emit as many segments as there are spans",
	);
});

/* -------------- the quiet turn: the close, the gate, the group (S2) ------------- */

/*
 * THE QUIET CLOSE (design §5, rev 2). Core persists `no_reply` as two ordinary
 * tool rows; this side's job is structural: the settled call CLOSES its cycle
 * (the tail settles, the span condenses), it never becomes the elected answer
 * (nothing may caption, stamp or foot a message the reader was never handed),
 * and the row itself paints nothing. The group fold rides the same rows - see
 * `QuietGroup` for the shape and the shared parity fixture below for the
 * cross-client contract.
 */

const quiet = (id, extra = {}) =>
	tool(id, { toolName: "no_reply", phase: "done", ...extra }, "trace");
const peerRow = (id, extra = {}) =>
	row(
		id,
		"peer",
		{
			body: "peer",
			sender: {
				pid: "",
				conversationName: "",
				cwd: "",
				sessionId: "",
				modelLabel: "",
			},
			...extra,
		},
		"trace",
	);

test("the R1 pin: a settled quiet close anchors the bar, and the bar carries the turn - no answer, no stamp, no foot", () => {
	const rows = [
		user("u1"),
		peerRow("p1"),
		tool("t1", { durationS: 3 }, "trace"),
		quiet("q1"),
	];
	const [plan] = planOf(rows).runs;
	assert.equal(
		plan.run.quietCloseId,
		"q1",
		"the run carries the quiet close as its own anchor",
	);
	assert.equal(
		plan.run.closingAnswerId,
		null,
		"and carries it nowhere near the answer: no caption, no stamp, no foot",
	);
	assert.equal(plan.answerId, null, "nothing is elected");
	const [seg] = plan.segments;
	assert.equal(seg.collapsed, true, "the bar is present");
	assert.deepEqual(
		seg.segmentIds,
		["p1", "t1", "q1"],
		"the quiet row hides inside its own bar",
	);
	assert.equal(seg.completed, true, "the completed mark is the bar's");
	assert.equal(
		seg.facts.actions,
		1,
		"actions=1: only the work tool - the quiet call is excluded",
	);
	assert.equal(seg.facts.durationS, 3);
	assert.equal(seg.stampTs, null, "no stamp");
	assert.equal(
		seg.label,
		"Peer message",
		"below the group minimum the opener's own label survives",
	);
	const built = buildRows(
		rows.map((r) => r.record),
		[],
	);
	assert.equal(
		built.some((r) => r.closesTurn),
		false,
		"no row carries closesTurn, so no caption and no foot exist anywhere",
	);
});

test("the gate's third anchor: a head-cut quiet run still condenses, on quietCloseId and not on a fake answer", () => {
	const rows = [peerRow("p1"), tool("t1", {}, "trace"), quiet("q1")];
	const [plan] = planOf(rows, true).runs;
	assert.equal(plan.run.opensWithUserRow, false, "the head is cut");
	assert.equal(plan.run.closingAnswerId, null);
	assert.equal(plan.run.quietCloseId, "q1");
	assert.equal(
		plan.collapses,
		true,
		"without the third anchor this run would refuse to build a bar",
	);
	const [seg] = plan.segments;
	assert.equal(seg.collapsed, true);
	assert.equal(seg.completed, true);
	assert.equal(
		seg.facts.partial,
		true,
		"head-cut: the count is a minimum and the bar says so",
	);
	assert.equal(seg.facts.durationS, null, "and no duration is fabricated");
});

test("a quiet close settles the tail; the earlier answer is neither swallowed nor re-elected", () => {
	/*
	 * `U A1(stop) P T Q`: the first close was already handed over, so the quiet
	 * tail must elect NOTHING - re-electing A1 would label the run's end with an
	 * earlier answer (the same shape a textless tail has always had).
	 */
	const rows = [
		user("u1"),
		answer("a1"),
		peerRow("p1"),
		tool("t1", {}, "trace"),
		quiet("q1"),
	];
	const [plan] = planOf(rows).runs;
	assert.equal(plan.answerId, null, "no answer is elected for the run");
	assert.deepEqual(
		plan.segments.map((s) => s.segmentIds),
		[["p1", "t1", "q1"]],
		"the peer span condenses as one bar",
	);
	assert.equal(plan.segments[0].collapsed, true);
	assert.equal(
		plan.hidden.some((r) => r.record.id === "a1"),
		false,
		"the earlier answer stays visible; the bar never takes it",
	);
});

test("a receipt appended after a quiet close keeps the settled span a bar (the group override), and the count is the only thing that grows", () => {
	const settled = [
		user("u1"),
		peerRow("p1"),
		tool("t1", {}, "trace"),
		quiet("q1"),
	];
	const before = planOf(settled, true).runs[0];
	assert.equal(before.segments[0].collapsed, true, "settled: the bar draws");
	const after = planOf([...settled, peerRow("p2")], true).runs[0];
	/*
	 * A second receipt makes the span a GROUP (two triggers, nothing visible
	 * between them), and a group keeps its bar while it grows. Without the
	 * exemption the extended span would cross `liveFrom` and un-condense every
	 * receipt the reader had already seen settle - the jitter the group exists
	 * to remove, measured on the operator's own report.
	 */
	assert.equal(after.segments.length, 1);
	assert.equal(after.segments[0].collapsed, true, "the group bar stays");
	assert.equal(
		after.segments[0].key,
		"qg:p1",
		"the group speaks with its own stable key",
	);
	assert.equal(after.segments[0].facts.group?.count, 2);
	assert.equal(after.segments[0].label, "Peer messages");
	const grown = planOf(
		[...settled, peerRow("p2"), quiet("q2"), peerRow("p3")],
		true,
	).runs[0];
	assert.equal(grown.segments.length, 1, "still one bar");
	assert.equal(grown.segments[0].key, "qg:p1", "the key never moves");
	assert.equal(grown.segments[0].collapsed, true, "and it stays a bar");
	assert.equal(
		grown.segments[0].facts.group?.count,
		3,
		"the count is the only thing that grew",
	);
	assert.equal(grown.segments[0].label, "Peer messages");
});

test("a receipt-origin live group compacts before settlement without changing shared group facts", () => {
	/* Live receipt presentation is origin-based; QuietGroup still counts >=2. */
	const opening = [user("u1"), answer("a1", { stopReason: "stop" })];
	const live = [
		row("w1", "wake", { text: "a wake delivery" }, "trace"),
		peerRow("p1"),
		tool("t1", {}, "trace"),
		tool("t2", {}, "trace"),
	];
	const running = planOf([...opening, ...live], true).runs[0];
	assert.equal(
		running.segments.length,
		1,
		"one span over the receipts and their calls",
	);
	assert.equal(
		running.segments[0].collapsed,
		true,
		"positive internal origin: settlement is not needed for compact presentation",
	);
	assert.equal(
		running.segments[0].facts.group?.count,
		2,
		"and it is already a group on paper",
	);
	const settled = planOf([...opening, ...live, quiet("q1")], true).runs[0];
	assert.equal(
		settled.segments[0].collapsed,
		true,
		"a close inside: the bar takes over",
	);
	const grown = planOf([...opening, ...live, quiet("q1"), peerRow("p2")], true)
		.runs[0];
	assert.equal(
		grown.segments[0].collapsed,
		true,
		"and stays one line while it grows",
	);
});

test("F3: the below-minimum span and the group it grows into carry the SAME key", () => {
	/*
	 * The operator's no-re-jitter requirement, at the transition the design round
	 * flagged: `[peer][tool][quiet]` is a bar long before it is a group, and the
	 * second receipt must not rename it - a key jump (`seg:` -> `qg:`) would drop
	 * the reader's stored expansion (the bar re-collapses under them) and re-fire
	 * the settle announcement for the same bar.
	 */
	const settled = [
		user("u1"),
		peerRow("p1"),
		tool("t1", {}, "trace"),
		quiet("q1"),
	];
	const single = planOf(settled).runs[0];
	const group = planOf([...settled, peerRow("p2")], false).runs[0];
	assert.equal(
		single.segments[0].key,
		"qg:p1",
		"the pre-group span is already named for its first receipt",
	);
	assert.equal(group.segments[0].key, "qg:p1", "and the group keeps that name");
	assert.equal(single.segments[0].collapsed, true);
	assert.equal(group.segments[0].collapsed, true);
	assert.equal(group.segments[0].facts.group?.count, 2);
	// The scanner entry names the same key from the same row:
	const scanned = quietGroupsOf(
		[...settled, peerRow("p2")].map((r) => r.record),
	);
	assert.equal(scanned[0].key, group.segments[0].key);
});

test("F1: a pinned compaction statement splits on BOTH entry points, row for row", () => {
	/*
	 * The design-round disagreement: `quietGroupsOf` scanned across the pinned
	 * memory statement while `planRun` could never render a span containing it
	 * (the pin list keeps it on screen). The splitter now IS the pin list
	 * (`staysVisibleWhileCollapsed`), so the two entry points state the same
	 * groups by construction rather than by a second copy of the vocabulary.
	 */
	const rows = [
		user("u1"),
		peerRow("p1"),
		peerRow("p2"),
		row("c1", "compaction", { text: "Context compacted", before: 41_000 }),
		peerRow("p3"),
		peerRow("p4"),
	];
	const plan = planOf(rows).runs[0];
	assert.deepEqual(
		plan.segments.map((s) => s.key),
		["seg:c1", "qg:p3"],
		"two groups around the pinned statement: the tail span carries the group key, the mid-run one the visible anchor",
	);
	assert.deepEqual(
		plan.segments.map((s) => s.collapsed),
		[true, true],
	);
	const scanned = quietGroupsOf(rows.map((r) => r.record));
	assert.deepEqual(
		scanned.map((g) => g.key),
		["qg:p1", "qg:p3"],
		"the scanner states the groups' own keys",
	);
	assert.deepEqual(
		scanned.map((g) => g.rowIds),
		[
			["p1", "p2"],
			["p3", "p4"],
		],
		"membership agrees, row for row - the compaction splits on both entry points",
	);
	assert.equal(
		plan.segments[1].key,
		scanned[1].key,
		"the tail group's segment key IS the group key (the appendable span rule)",
	);
});

test("facts freeze when the group closes, and the open tail may grow (the latch, design §5)", () => {
	const closedBefore = quietGroupsOf(
		[peerRow("p1"), peerRow("p2"), user("u1")].map((r) => r.record),
	);
	assert.equal(closedBefore[0].open, false, "a later visible row closes it");
	const closedAfter = quietGroupsOf(
		[
			peerRow("p1"),
			peerRow("p2"),
			user("u1"),
			peerRow("p3"),
			peerRow("p4"),
		].map((r) => r.record),
	);
	assert.equal(closedAfter.length, 2, "the new receipts form their own group");
	assert.deepEqual(
		closedAfter[0],
		closedBefore[0],
		"the closed group is byte-identical after the append",
	);
	const openBefore = quietGroupsOf(
		[peerRow("p3"), peerRow("p4")].map((r) => r.record),
	);
	assert.equal(openBefore[0].open, true, "the tail group is open");
	const openAfter = quietGroupsOf(
		[peerRow("p3"), peerRow("p4"), peerRow("p5")].map((r) => r.record),
	);
	assert.equal(openAfter[0].key, "qg:p3", "the key never moves while it grows");
	assert.equal(
		openAfter[0].count,
		3,
		"the open tail group may increase its count",
	);
});

/* ------------------- the shared parity fixture (design §5) ------------------- */

/*
 * The fixture is the CROSS-CLIENT contract (see its own header): the native,
 * relay-web and TUI slices copy it and check their derivation against the same
 * cases. Here it is checked against the UI's own entry points - the whole-list
 * scanner for the definition, and the segment-level lookup for the span cases
 * (head-cut times and the "a bar states a whole group, never a fragment" rule).
 */
const QUIET_GROUPS_PARITY = JSON.parse(
	readFileSync(
		new URL("./fixtures/quiet-groups.parity.json", import.meta.url),
		"utf8",
	),
);

/** A fixture row, expanded to the fields the group vocabulary reads. */
const fixtureRecord = (row) => {
	switch (row.kind) {
		case "user":
			return { kind: "user", id: row.id, ts: row.ts, text: row.text ?? "hi" };
		case "peer":
			return {
				kind: "peer",
				id: row.id,
				ts: row.ts,
				body: row.body ?? "peer",
				sender: {
					pid: "",
					conversationName: "",
					cwd: "",
					sessionId: "",
					modelLabel: "",
					...(row.sender ?? {}),
				},
			};
		case "wake":
			return { kind: "wake", id: row.id, ts: row.ts, text: row.text ?? "wake" };
		case "custom":
			return {
				kind: "custom",
				id: row.id,
				ts: row.ts,
				customType: row.customType,
				text: row.text ?? "",
				level: row.level ?? "info",
				/*
				 * A CUSTOM ROW'S durable hub shape: a fixture case that means a
				 * reply-requesting or steered delivery states it the way the reducer
				 * holds it (`receipt: {expectsReply, steer}`), which is the fact
				 * `quietGroupClauseFacts` reads.
				 */
				...(row.receipt ? { receipt: row.receipt } : {}),
			};
		case "tool":
			return {
				kind: "tool",
				id: row.id,
				ts: row.ts,
				toolName: row.toolName,
				phase: row.phase ?? "done",
				isError: row.isError ?? false,
				stopped: false,
				neverSent: false,
				notRunReason: null,
				durationS: row.durationS ?? null,
			};
		case "assistant":
			return {
				kind: "assistant",
				id: row.id,
				ts: row.ts,
				text: row.text ?? "text",
				streaming: false,
				stopReason: row.stopReason ?? "stop",
			};
		case "notice":
			return {
				kind: "notice",
				id: row.id,
				ts: row.ts,
				text: row.text ?? "notice",
				level: row.level ?? "info",
				complete: row.complete ?? false,
			};
		case "compaction":
			return {
				kind: "compaction",
				id: row.id,
				ts: row.ts,
				text: row.text ?? "Context compacted",
				before: row.before ?? 41_000,
			};
		default:
			throw new Error(`unhandled fixture row kind: ${row.kind}`);
	}
};

test("the quiet-group derivation matches the shared parity fixture, case by case", () => {
	for (const entry of QUIET_GROUPS_PARITY.cases) {
		const records = entry.rows.map(fixtureRecord);
		const actual = entry.span
			? quietGroupOfSegment(
					records,
					{ from: entry.span[0], to: entry.span[1] },
					{
						spanHeadLoaded: entry.spanHeadLoaded ?? true,
						open: entry.open,
					},
				)
			: quietGroupsOf(records);
		/*
		 * THE CLAUSE FACTS ARE COMPARED SEPARATELY, and the group comparison
		 * projects them out. `expected` embeds `clauseFacts` because the fixture is
		 * one file for every client, while the derivation returns a group; comparing
		 * the two objects whole would mean the derivation minting a field no
		 * renderer reads. Pinning the facts on their own is what catches the drift
		 * that started this file: the counts matched while one client stated the
		 * work clause and the other did not.
		 */
		const withoutClauses = (value) => {
			if (Array.isArray(value)) return value.map(withoutClauses);
			if (typeof value !== "object" || value === null) return value;
			const { clauseFacts: _clauseFacts, ...rest } = value;
			return rest;
		};
		assert.deepEqual(
			withoutClauses(actual),
			withoutClauses(entry.expected),
			entry.name,
		);
		const groups = Array.isArray(actual)
			? actual
			: actual === null
				? []
				: [actual];
		const wants = Array.isArray(entry.expected)
			? entry.expected.map((group) => group.clauseFacts)
			: entry.expected === null
				? []
				: [entry.expected.clauseFacts];
		/*
		 * `partial` is the head-cut read, which the fixture states with
		 * `spanHeadLoaded: false` - the same clause the bar's count label makes
		 * (`N+`) - so the facts pin the minimum marker too.
		 */
		assert.deepEqual(
			groups.map((group) =>
				quietGroupClauseFacts(group, {
					partial: entry.spanHeadLoaded === false,
				}),
			),
			wants,
			`${entry.name} (clause facts)`,
		);
	}
});

/* ------------- the open frame's facts (C1, lane U1) ------------- */

/*
 * WHAT THESE PIN. The operator's headline complaint is that a long turn's bar
 * paints a fragment and then re-condenses as the align walk pulls the head in -
 * `30 actions` at open, `Took 2h23m · 423 actions` thirteen pages later (PR
 * #702's body). The server's per-run facts make the bar exact on the frame it
 * is first seen. Three properties have to hold for that to be a fix rather than
 * a second opinion about the same turn:
 *
 *  1. the facts reach the HEAD-CUT span, and only it - a run whose head is
 *     loaded is already exact, and the server's total covers rows the turn's
 *     own figures deliberately exclude (a follow-up after the answer);
 *  2. the ladder still sums (design D1): bars over a run that a pinned row
 *     splits must still add up to the turn's figure, which is why the cut span
 *     takes the run's total MINUS its siblings' own work;
 *  3. `complete: false` keeps the `+`, because a count the index could not
 *     compute exactly must never read as exact.
 *
 * The adapter's own rules (`runs_state`, `settled`, the attested start) are
 * pinned beside them, because they are what decides whether ANY of this
 * happens: `building`, `unsupported` and an absent `runs` are one fact, and a
 * peer's conversation must be indistinguishable from an old backend here.
 */

/** A fact as the model takes it, so a fixture states only what it is about. */
const fact = (actions, workedSeconds, extra = {}) => ({
	actions,
	workedSeconds,
	failed: 0,
	complete: true,
	/*
	 * NULL BY DEFAULT, and that is the honest default for these fixtures: a run
	 * whose opening user row the wire did not name is a fragment to the model the
	 * moment its span opens at a user row (see `headLoadedIsTheRunsOwn`). A test
	 * about a HEADED run therefore has to name the opener it means.
	 */
	openingUserId: null,
	/*
	 * The re-key identity and the cross-session split (agent review round 1, F2
	 * and F3). NULL is "the wire said nothing": the model refuses a fact it cannot
	 * split when the reader hides cross-session rows, and treats an un-named
	 * closing answer as "no stable identity to find this run by".
	 */
	closingAnswerId: null,
	crossSessionActions: null,
	crossSessionWorkedSeconds: null,
	...extra,
});

test("v2 contained scope: a head-cut run's bar states the RUN's figures, not the loaded fragment (the operator's `423 actions`)", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [
		tool("t1", { durationS: 20 }),
		tool("t2", { durationS: 30 }),
		answer("a1"),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(423, 8639, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("v2 contained scope: a fact that the index could not compute exactly keeps the bar's `+`", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [tool("t1", { durationS: 4 }), answer("a1")];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(9, 40, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("v2 contained scope: the bars still sum to the turn: a pinned row splitting a head-cut run, with facts (D1)", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [
		tool("t1", { durationS: 20 }),
		row("cmp-v2", "compaction", { text: "Compacted" }),
		tool("t2", { durationS: 30 }),
		tool("t3", { durationS: 40 }),
		answer("a1"),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(423, 1000, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("facts never reach a run whose head is loaded: the rows in hand are already exact", () => {
	/*
	 * THE SCOPE OF THE WHOLE MECHANISM. A fact is the RUN's total, and the
	 * client's run-level figures are the TURN's - through the answer, excluding
	 * whatever followed it (#665 pinned that separation). So a headed run must
	 * keep the figures its own rows give, or a bar would start counting the
	 * follow-up's calls. The fact here is deliberately absurd: nothing about it
	 * may move.
	 */
	const rows = [
		user("u1", { ts: TS }),
		tool("t1", { ts: TS + 1, durationS: 20 }),
		answer("a1", { ts: TS + 5_000 }),
	];
	const plain = planOf(rows).runs[0];
	const withFacts = collapsePlan(rows, {
		live: false,
		runFacts: new Map([["a1", fact(999, 9_999, { openingUserId: "u1" })]]),
	}).runs[0];
	assert.deepEqual(
		withFacts.facts,
		plain.facts,
		"the turn's figures are untouched",
	);
	assert.deepEqual(
		withFacts.segments.map((segment) => segment.facts),
		plain.segments.map((segment) => segment.facts),
		"and so is every bar",
	);
});

test("v2 contained scope: alignWalkRunKeyConfirmed: a run whose bar TOOK the facts retires the walk", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [tool("t1", { durationS: 2 }), answer("a1")];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(99, 90, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("openFrameFacts: only `ready` carries facts, and only a SETTLED run's are readable", () => {
	const page = (extra) => ({
		entries: [{ id: "u1", ts: 100, type: "message", payload: {} }],
		has_more: true,
		cursor_missing: false,
		...extra,
	});
	const settled = {
		run_key: "a1",
		opening_user_id: "u1",
		closing_answer_id: "a1",
		settled: true,
		outcome: "complete",
		action_count: 12,
		failed_count: 1,
		worked_seconds: 90,
		started_ts: 100,
		ended_ts: 190,
		complete: true,
	};
	/*
	 * The ladder of "no facts": every one of these is the SAME behaviour for a
	 * reader (today's page, today's condensation, the align walk included), and
	 * `unsupported` - what a peer's conversation answers - must be treated
	 * exactly like the field being absent.
	 */
	for (const runsState of [
		"building",
		"unavailable",
		"unsupported",
		undefined,
	]) {
		assert.equal(
			openFrameFacts(page({ runs_state: runsState, runs: [settled] })),
			null,
			`${runsState} is not facts`,
		);
	}
	assert.equal(
		openFrameFacts(page({ runs_state: "ready" })),
		null,
		"no runs, no facts",
	);
	assert.equal(
		openFrameFacts(page({ runs_state: "ready", runs: [] })),
		null,
		"an empty list is not facts either",
	);
	const ready = openFrameFacts(
		page({ runs_state: "ready", runs: [settled], head_cut: true }),
	);
	assert.ok(ready, "a settled run on a ready page is readable");
	assert.deepEqual(ready.runs.get("a1"), {
		actions: 12,
		workedSeconds: 90,
		failed: 1,
		complete: true,
		/*
		 * Carried through for the model's own use (clarity 2's rule), and the same
		 * fact answers to all three ids the contract names - which is what the
		 * assertion below the loop is about.
		 */
		openingUserId: "u1",
		closingAnswerId: "a1",
		crossSessionActions: null,
		crossSessionWorkedSeconds: null,
	});
	assert.equal(
		ready.runs.get("u1"),
		ready.runs.get("a1"),
		"and the same fact is reachable by the run's opening user row",
	);
	/*
	 * A live tail carries `settled: false` and no counts: a number taken
	 * mid-turn is one the client would have to correct after the paint, which is
	 * the change this contract exists to remove.
	 */
	const live = {
		run_key: "a2",
		opening_user_id: "u2",
		closing_answer_id: null,
		settled: false,
	};
	assert.equal(
		openFrameFacts(page({ runs_state: "ready", runs: [live] })),
		null,
		"an unsettled run is no facts at all",
	);
	/*
	 * And a fact this build cannot read whole is not a zero: a settled run with
	 * no `action_count` is dropped rather than read as `0 actions`.
	 */
	const noCount = { ...settled, run_key: "a3", action_count: null };
	assert.deepEqual(
		openFrameFacts(page({ runs_state: "ready", runs: [noCount] })),
		null,
		"a missing count is not an exact zero",
	);
	const mixed = openFrameFacts(
		page({ runs_state: "ready", runs: [noCount, live, settled] }),
	);
	assert.deepEqual(
		[...mixed.runs.keys()].sort(),
		["a1", "u1"],
		"the readable run still lands - under its key AND its opening user row (the aliases)",
	);
});

test("openFrameAttestedStart: only a page that BEGINS at a run's opening user row attests a start", () => {
	const entries = [
		{ id: "u1", ts: 100, type: "message", payload: {} },
		{ id: "t1", ts: 101, type: "message", payload: {} },
	];
	const run = (extra = {}) => ({
		run_key: "a1",
		opening_user_id: "u1",
		closing_answer_id: "a1",
		settled: true,
		...extra,
	});
	const page = (extra) => ({
		entries,
		has_more: true,
		cursor_missing: false,
		runs_state: "ready",
		runs: [run()],
		...extra,
	});
	assert.deepEqual(
		openFrameAttestedStart(page()),
		{ id: "u1", tsMs: 100_000 },
		"the page's first row IS the oldest run's opening user row",
	);
	/*
	 * The three ways the attestation is refused, each one a page whose start
	 * says nothing about where its own span begins - and the caller's
	 * reconciliation arm must fall back to the walk on every one of them.
	 */
	assert.equal(
		openFrameAttestedStart(page({ head_cut: true })),
		null,
		"a cap-refused extension: the page is the plain tail",
	);
	assert.equal(
		openFrameAttestedStart(
			page({ runs: [run({ opening_user_id: "somewhere-else" })] }),
		),
		null,
		"a run opening off a row this page does not begin with",
	);
	assert.equal(
		openFrameAttestedStart(page({ runs: [run({ opening_user_id: null })] })),
		null,
		"a run that opens off a non-user row attests nothing",
	);
	assert.equal(
		openFrameAttestedStart(page({ runs_state: "building" })),
		null,
		"no facts, no attestation",
	);
	assert.equal(
		openFrameAttestedStart(
			page({ entries: [{ id: "u1", ts: 0, type: "message", payload: {} }] }),
		),
		null,
		"a page with no instant cannot place anything older than itself",
	);
	assert.equal(
		openFrameAttestedStart(page({ entries: [] })),
		null,
		"and neither can an empty page",
	);
});

test("openFrameCoversHeld: a held row INSIDE an attested span is covered; anything outside it is not", () => {
	/*
	 * THE ARM'S WHOLE SAFETY IS ITS TWO STRICT BOUNDS, so each is asserted in
	 * both directions. The page: rows at 100s..110s, the oldest run's opening
	 * user row first, so the facts attest where the page begins.
	 */
	const entries = [
		{ id: "u1", ts: 100, type: "message", payload: {} },
		{ id: "t1", ts: 105, type: "message", payload: {} },
		{ id: "a1", ts: 110, type: "message", payload: {} },
	];
	const page = (extra = {}) => ({
		entries,
		has_more: true,
		cursor_missing: false,
		runs_state: "ready",
		runs: [
			{
				run_key: "a1",
				opening_user_id: "u1",
				closing_answer_id: "a1",
				settled: true,
			},
		],
		...extra,
	});
	const carried = new Set(["u1", "t1", "a1"]);
	const held = (pairs) => new Map(pairs);
	const ms = (seconds) => seconds * 1000;

	assert.equal(
		openFrameCoversHeld(page(), held([["t9", ms(106)]]), carried),
		true,
		"a row inside the page's span is covered even though the page does not carry its id",
	);
	assert.equal(
		openFrameCoversHeld(page(), held([["t9", ms(100)]]), carried),
		false,
		"a row AT the attested start is the #876 seam - same second, unknowable order",
	);
	assert.equal(
		openFrameCoversHeld(page(), held([["t9", ms(99)]]), carried),
		false,
		"a block behind the page walks: #883's guarantee",
	);
	assert.equal(
		openFrameCoversHeld(page(), held([["t9", ms(110)]]), carried),
		false,
		"a row AT the page's newest entry is a cut-at-a-cursor page's blind spot (#876)",
	);
	assert.equal(
		openFrameCoversHeld(page(), held([["t9", ms(140)]]), carried),
		false,
		"and a row above it is the live tail, where rows journaled in between can be missing",
	);
	assert.equal(
		openFrameCoversHeld(page(), held([["u1", ms(100)]]), carried),
		true,
		"a row the page CARRIES needs no placement at all - the overlap proof",
	);
	assert.equal(
		openFrameCoversHeld(page(), held([["t9", ms(106)]]), new Set()),
		true,
		"the carried set is the caller's mapping and an id it does not name is placed by the clock",
	);
	/*
	 * Every way the page can attest nothing. Each must answer false, because the
	 * caller's alternative is the walk and a page it cannot place must not stand
	 * one down.
	 */
	assert.equal(
		openFrameCoversHeld(
			page({ head_cut: true }),
			held([["t9", ms(106)]]),
			carried,
		),
		false,
	);
	assert.equal(
		openFrameCoversHeld(
			page({ runs_state: "building" }),
			held([["t9", ms(106)]]),
			carried,
		),
		false,
	);
	assert.equal(
		openFrameCoversHeld(page({ runs: [] }), held([["t9", ms(106)]]), carried),
		false,
	);
	assert.equal(
		openFrameCoversHeld(null, held([["t9", ms(106)]]), carried),
		false,
	);
	assert.equal(
		openFrameCoversHeld(
			page({
				runs: [
					{
						run_key: "a1",
						opening_user_id: "u2",
						closing_answer_id: "a1",
						settled: true,
					},
				],
			}),
			held([["t9", ms(106)]]),
			carried,
		),
		false,
		"a start the facts do not attest is no start",
	);
});

/* --------- the two contract clarifications the core lane added ---------- */

/*
 * `docs/DESKTOP_API.md` states two consequences of the cut that a client gets
 * wrong if it reads `head_cut` as "this page is incomplete" and `!head_cut` as
 * "this page is whole". Both are asserted through the shipped adapter, so the
 * rule is exercised by the same reading of the wire the app performs.
 */

test("v2 contained scope: clarity 1: a `head_cut` page whose facts cover the run is the FINAL layout, and the fact answers to any of the three ids", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [
		tool("t1", { durationS: 2 }),
		tool("t2", { durationS: 3 }),
		answer("a1"),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(423, 8639, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("v2 contained scope: clarity 2: a page that begins at a STEER still states the run's whole figures", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [
		user("steer-v2", { role: "steer" }),
		tool("t1", { durationS: 2 }),
		answer("a1"),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(50, 3600, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
/* ===================================================================== *
 * AGENT REVIEW ROUND 1 (`#925`): the three findings the model owns.
 *
 * F2 - the facts count rows the reader HIDES (`send`, peer receipts) when
 *      `hide_cross_session` is on, so a subtraction from the server's total put
 *      them back into the bar. F3 - the fact was looked up by the run's LIVE
 *      key, so a follow-up after the answer re-keyed the run and the bar fell
 *      back to a fragment, arming the post-paint walk. F4 - the attested start
 *      read `runs[0]`, which the core publishes ONE RUN EARLY on purpose.
 * ===================================================================== */

test("v2 contained scope: a fact is corrected by the rows that arrived after its page - and only those (B2)", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [
		tool("t1", { durationS: 2 }),
		tool("tool:appended", { durationS: 3 }),
		answer("a1"),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(33, 60, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("v2 contained scope: a SERVED page with its own facts and identity adds nothing (B3)", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [tool("tool:served", { durationS: 3 }), answer("a1")];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(9, 24, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("v2 contained scope: a fact is split by the hidden cross-session work, or refused (F2)", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [
		tool("t1", { durationS: 20 }),
		tool("t2", { durationS: 30 }),
		answer("a1"),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(3, 70, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("v2 contained scope: a woken run states the wire's own totals, and its re-key keeps the fact (F3, B1)", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [
		tool("t1", { durationS: 10 }),
		answer("a1"),
		row("w1", "wake", { text: "Synthetic wake" }),
		tool("t2", { durationS: 5 }),
		tool("t3", { durationS: 5 }),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(33, 63, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("v2 contained scope: a figure below the rows the bar itself hides keeps its `+` (M2)", () => {
	// The old wire-remainder assertion described absent rows as disclosure
	// children. Keep its upstream stimulus; direct population is authoritative.
	const rows = [
		tool("t1", { durationS: 10 }),
		tool("t2", { durationS: 10 }),
		tool("t3", { durationS: 10 }),
		answer("a1"),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			[
				"a1",
				fact(1, 40, {
					openingUserId: "offpage-user",
					closingAnswerId: "a1",
					crossSessionActions: 1,
					crossSessionWorkedSeconds: 10,
				}),
			],
		]),
	});
	for (const run of plan.runs) {
		assert.equal(
			run.factApplied,
			false,
			"no aggregate was used by a disclosure",
		);
		for (const segment of run.segments) {
			const direct = segment.rows.filter(
				(r) => r.record.kind === "tool" && r.record.toolName !== "no_reply",
			);
			assert.equal(
				segment.facts.actions,
				direct.length,
				"counts only what expansion contains",
			);
			if (segment.facts.partial)
				assert.equal(
					segment.facts.durationS,
					null,
					"no parent duration on a head-cut span",
				);
		}
	}
});
test("openFrameAttestedStart finds the run the page BEGINS in, one run early or not (F4)", () => {
	/*
	 * THE CORE'S OWN SHAPE. `publish_runs` starts one run early on purpose
	 * (`test_publish_runs_starts_one_run_early_so_a_straddle_is_covered`,
	 * `open_frame.py`): `runs[0]` is the run BEFORE the page, because the page's
	 * window can begin inside it and a reader that knew only the runs starting on
	 * the page would have nowhere to hang that straddle. Reading `runs[0]` here
	 * made the reconciliation arm unreachable against the real backend - the
	 * failure is safe, but the arm never fired.
	 */
	const entries = [
		{ id: "u2", ts: 200, type: "message", payload: {} },
		{ id: "t1", ts: 201, type: "tool", payload: {} },
	];
	const runs = [
		{
			run_key: "a0",
			opening_user_id: "u1",
			closing_answer_id: "a0",
			settled: true,
			action_count: 1,
		},
		{
			run_key: "a2",
			opening_user_id: "u2",
			closing_answer_id: "a2",
			settled: true,
			action_count: 1,
		},
	];
	const early = openFrameAttestedStart({
		entries,
		runs,
		runs_state: "ready",
		head_cut: false,
		has_more: true,
		cursor_missing: false,
	});
	assert.deepEqual(
		early,
		{ id: "u2", tsMs: 200_000 },
		"the run whose opening row is the page's first entry, not the one before it",
	);
	/*
	 * The exact-window shape (what the bench's stub served) attests the same
	 * start, so both readings of the wire agree - and a page whose first entry is
	 * NO run's opening row still attests nothing.
	 */
	const exact = openFrameAttestedStart({
		entries,
		runs: [runs[1]],
		runs_state: "ready",
		head_cut: false,
		has_more: true,
		cursor_missing: false,
	});
	assert.deepEqual(exact, { id: "u2", tsMs: 200_000 });
	assert.equal(
		openFrameAttestedStart({
			entries: [{ id: "t1", ts: 201, type: "tool", payload: {} }],
			runs,
			runs_state: "ready",
			head_cut: false,
			has_more: true,
			cursor_missing: false,
		}),
		null,
		"a page that begins inside a run attests no run boundary",
	);
});

// Existing small-array fixtures use the public snapshot API, not a second
// production alias policy. Large/current-authority cases below call it directly.
const retainInternalEpisodeKeys = (previous, current) =>
	retainInternalEpisodeKeysV2(
		captureInternalEpisodeIdentity(
			previous.map((e) => ({ ...e, eligible: true })),
			new Set(previous.map((e) => e.key)),
		),
		current.map((e) => ({ ...e, eligible: true })),
	).episodes;

/* Active internal episodes: SOURCE regressions, never body/code classifiers. */
const internalOpening = () => [
	user("ia-user"),
	answer("ia-final", { stopReason: "stop" }),
];
const internalSpanOf = (plan, id) =>
	plan.runs.flatMap((r) => r.segments).find((s) => s.segmentIds.includes(id));
const allCollapsedIds = (plan) =>
	new Set(
		plan.runs.flatMap((r) =>
			r.segments.filter((s) => s.collapsed).flatMap((s) => s.segmentIds),
		),
	);
function assertAllAnswersVisible(plan, ids) {
	const hidden = allCollapsedIds(plan);
	for (const id of ids)
		assert.equal(
			hidden.has(id),
			false,
			`answer ${id} stays outside EVERY collapsed span`,
		);
}
const jobReceipt = (id, extra = {}) =>
	row(
		id,
		"custom",
		{
			customType: "job_result",
			text: "Synthetic background completion",
			headline: "Synthetic completed result",
			detail: "Full synthetic output",
			level: "info",
			attribution: "system",
			...extra,
		},
		"trace",
	);
const hubReceipt = (id, extra = {}) =>
	row(
		id,
		"custom",
		{
			customType: "hub_message",
			text: "Synthetic typed incoming note",
			level: "info",
			receipt: {
				body: "Typed note",
				envelope: "Raw synthetic source",
				direction: "to_parent",
				label: "Synthetic worker",
				jobId: "synthetic-job",
				sender: {
					pid: "",
					conversationName: "",
					cwd: "",
					sessionId: "",
					modelLabel: "",
				},
				expectsReply: false,
				steer: false,
				...extra,
			},
		},
		"trace",
	);

test("active internal receipt compacts without settlement while ALL material answers stay visible", () => {
	const ordinary = planOf(
		[user("ordinary"), tool("ordinary-call", { phase: "running" })],
		true,
	);
	assert.equal(
		ordinary.runs.some((r) => r.segments.some((s) => s.collapsed)),
		false,
	);
	const rows = [
		...internalOpening(),
		peerRow("ia-peer"),
		tool(
			"ia-eval",
			{
				toolName: "eval",
				phase: "running",
				args: { code: "tool('no_reply')" },
			},
			"trace",
		),
	];
	const before = planOf(internalOpening(), false);
	const during = planOf(rows, true);
	const segment = internalSpanOf(during, "ia-peer");
	assert.equal(segment.collapsed, true);
	assert.equal(segment.completed, false);
	assert.equal(segment.internal.live, true);
	assert.equal(
		segment.facts.group,
		null,
		"a singleton does not redefine QuietGroup >=2",
	);
	assert.equal(segment.key, "qg:ia-peer");
	assert.equal(
		segment.facts.actions,
		1,
		"outer eval remains a real inspectable action",
	);
	assert.deepEqual(segment.segmentIds, ["ia-peer", "ia-eval"]);
	assertAllAnswersVisible(before, ["ia-final"]);
	assertAllAnswersVisible(during, ["ia-final"]);
	const after = planOf([...rows, quiet("ia-close")], false);
	assert.equal(internalSpanOf(after, "ia-peer").key, segment.key);
	assert.equal(internalSpanOf(after, "ia-peer").completed, true);
	assertAllAnswersVisible(after, ["ia-final"]);
});

test("unanswered human work remains live even when one or several receipts arrive", () => {
	for (const prefix of [
		[user("pending")],
		[user("pending"), tool("requested")],
		[user("pending"), answer("lead-in", { stopReason: "toolUse" })],
	]) {
		const plan = planOf(
			[
				...prefix,
				peerRow("pending-p"),
				jobReceipt("pending-j"),
				tool("pending-t", { phase: "running" }, "trace"),
			],
			/* LIVE: unanswered human work is the turn in flight, so the pane is
			 * live and the safety rule is asked of that state. */
			true,
		);
		assert.equal(
			plan.runs.some((r) => r.segments.some((s) => s.collapsed)),
			false,
		);
	}
});

test("completed quiet work never reopens for thinking; single to mixed receipts grow the same key", () => {
	const rows = [
		...internalOpening(),
		peerRow("grow-p"),
		tool("grow-t", {}, "trace"),
		quiet("grow-q"),
	];
	const completed = internalSpanOf(planOf(rows, false), "grow-p");
	const thinking = internalSpanOf(planOf(rows, true), "grow-p");
	assert.equal(thinking.collapsed, true);
	assert.equal(
		thinking.internal.live,
		false,
		"no new tail row means completed work stays completed",
	);
	const grown = internalSpanOf(
		planOf(
			[
				...rows,
				jobReceipt("grow-j"),
				tool("grow-eval", { toolName: "eval", phase: "running" }, "trace"),
			],
			true,
		),
		"grow-p",
	);
	assert.equal(grown.key, completed.key);
	assert.equal(grown.collapsed, true);
	assert.equal(grown.completed, false);
	assert.equal(grown.internal.receipts, 2);
	assert.equal(grown.facts.actions, 2);
	assert.deepEqual(grown.segmentIds, [
		"grow-p",
		"grow-t",
		"grow-q",
		"grow-j",
		"grow-eval",
	]);
});

test("all typed delivery families can open one live episode without a quiet outcome", () => {
	const origins = [
		peerRow("family-p"),
		hubReceipt("family-h"),
		row("family-w", "wake", { text: "Synthetic wake" }),
		jobReceipt("family-j"),
		row("family-m", "custom", {
			customType: "monitor_prompt",
			level: "info",
			text: "Synthetic monitor",
		}),
	];
	for (const origin of origins) {
		const segment = internalSpanOf(
			planOf(
				[
					...internalOpening(),
					origin,
					tool("family-t", { phase: "running" }, "trace"),
				],
				true,
			),
			origin.record.id,
		);
		assert.equal(segment.collapsed, true, origin.record.kind);
		assert.equal(segment.completed, false);
	}
});

test("mixed jobs, stream completion notices and tools roll up without body-label deduplication", () => {
	const ended = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "subagent_end",
			job_id: "synthetic-job",
			label: "Synthetic decision",
			status: "completed",
		},
		TS,
	);
	const completion = ended.records.find(
		(r) => r.id === "subagent:synthetic-job",
	);
	assert.ok(
		completion,
		"actual typed producer creates the reserved completion id",
	);
	const rows = [
		...internalOpening(),
		jobReceipt("physical-job-1"),
		jobReceipt("physical-job-2"),
		tool("job-tool-1", {}, "trace"),
		{ record: completion, gap: "trace", closesTurn: false },
		jobReceipt("physical-job-3"),
		tool("job-tool-2", {}, "trace"),
		jobReceipt("physical-job-4"),
		tool("job-read", { phase: "running" }, "trace"),
	];
	const plan = planOf(rows, true);
	const segment = internalSpanOf(plan, "physical-job-1");
	assert.equal(segment.collapsed, true);
	assert.deepEqual(
		segment.segmentIds,
		rows.slice(2).map((r) => r.record.id),
	);
	assert.equal(
		segment.internal.receipts,
		5,
		"four physical job receipts + typed completion, never labels",
	);
	assert.equal(
		segment.facts.group.count,
		4,
		"shared QuietGroup golden contract still counts its own triggers",
	);
	assertAllAnswersVisible(plan, ["ia-final"]);
});

test("real progress, final, steer, ask, attention, error and ambiguous assistant rows remain boundaries", () => {
	const boundaries = [
		answer("material-progress", {
			text: "Real user progress",
			stopReason: "toolUse",
		}),
		answer("material-final", { stopReason: "stop" }),
		answer("empty-future", {
			text: "",
			streaming: false,
			stopReason: undefined,
		}),
		answer("stream-future", {
			text: "",
			streaming: true,
			stopReason: undefined,
		}),
		user("genuine-steer", { text: "A real user steer" }),
		tool("real-ask", { toolName: "ask", phase: "running" }, "trace"),
		tool("real-error", { isError: true, phase: "done" }, "trace"),
		row("interrupt", "notice", {
			complete: true,
			level: "error",
			text: "Interrupted",
		}),
		hubReceipt("attention", { expectsReply: true }),
		hubReceipt("hub-steer", { steer: true }),
		row("generic-info", "notice", {
			level: "info",
			text: "User-facing status, not a proved internal completion",
		}),
	];
	for (const boundary of boundaries) {
		const rows = [
			...internalOpening(),
			peerRow("bound-p"),
			tool("bound-t", {}, "trace"),
			boundary,
			jobReceipt("bound-j"),
			tool("bound-last", { phase: "running" }, "trace"),
		];
		const plan = planOf(rows, true);
		assert.equal(
			allCollapsedIds(plan).has(boundary.record.id),
			false,
			boundary.record.id,
		);
		assertAllAnswersVisible(plan, [
			"ia-final",
			...(boundary.record.kind === "assistant" ? [boundary.record.id] : []),
		]);
	}
});

test("empty streaming placeholder protects the first actual token and never remounts the prior internal key", () => {
	const rows = [
		...internalOpening(),
		peerRow("token-p"),
		tool("token-t", {}, "trace"),
	];
	const initial = internalSpanOf(planOf(rows, true), "token-p");
	for (const update of [
		{ text: "", streaming: true },
		{ text: "Real progress", streaming: true },
		{ text: "Real answer", streaming: false, stopReason: "stop" },
	]) {
		const plan = planOf([...rows, answer("token-a", update)], true);
		assertAllAnswersVisible(plan, ["ia-final", "token-a"]);
		const current = internalSpanOf(plan, "token-p");
		/* R3 restores default bounded keys to the visible answer. The raw planner
		 * cannot promise qg identity after that boundary arrives; the existing UI
		 * overlap transfer preserves the reader-open key. Pin both halves instead
		 * of requiring every closed/history bar to use a live qg key forever. */
		assert.equal(current.key, "seg:token-a");
		const retained = aliasesV2(
			snapshotV2([epV2(initial.key, initial.segmentIds)], [initial.key]),
			[epV2(current.key, current.segmentIds)],
			{ outsideCurrentIds: ["ia-final", "token-a"] },
		);
		assert.equal(retained.episodes[0].key, initial.key);
	}
});

test("produced image and video rows stay inline outside internal folds", () => {
	for (const kind of ["image", "video"]) {
		const artifact = tool(
			`artifact-${kind}`,
			{
				images: [
					{
						id: `asset-${kind}`,
						attachment: "synthetic-digest",
						data: null,
						mimeType: kind === "image" ? "image/png" : "video/mp4",
						kind,
					},
				],
			},
			"trace",
		);
		for (const where of ["before", "inside"]) {
			const rows =
				where === "before"
					? [
							...internalOpening(),
							artifact,
							jobReceipt("asset-j"),
							tool("asset-read", { phase: "running" }, "trace"),
						]
					: [
							...internalOpening(),
							peerRow("asset-p"),
							artifact,
							jobReceipt("asset-j"),
							tool("asset-read", { phase: "running" }, "trace"),
						];
			const plan = planOf(rows, true);
			assert.equal(
				allCollapsedIds(plan).has(artifact.record.id),
				false,
				`${kind}/${where} is inline`,
			);
			assert.equal(internalSpanOf(plan, "asset-j").collapsed, true);
		}
	}
});

test("old unstamped hub-like users remain human; quiet failures and eval text never prove a quiet close", () => {
	const legacyUser = user("legacy-hub", {
		text: "<parent-message>synthetic literal text</parent-message>",
	});
	const plan = planOf(
		[
			...internalOpening(),
			peerRow("legacy-p"),
			legacyUser,
			tool(
				"legacy-eval",
				{ toolName: "eval", phase: "running", output: "no_reply" },
				"trace",
			),
		],
		true,
	);
	assert.equal(allCollapsedIds(plan).has(legacyUser.record.id), false);
	for (const change of [
		{ isError: true },
		{ stopped: true },
		{ neverSent: true },
	]) {
		const rows = [
			...internalOpening(),
			peerRow("failed-quiet-p"),
			quiet("failed-quiet", change),
		];
		const p = planOf(rows, true);
		assert.equal(allCollapsedIds(p).has("failed-quiet"), false);
	}
	const unanchored = row("attention-ineligible", "custom", {
		customType: "completion_attention",
		text: "",
		level: "info",
		eligible: false,
	});
	const p = planOf(
		[
			...internalOpening(),
			peerRow("eligible-p"),
			tool("eligible-e", { toolName: "eval", phase: "done" }, "trace"),
			unanchored,
		],
		true,
	);
	assert.equal(internalSpanOf(p, "eligible-p").completed, false);
});

test("bounded internal identity and expansion survive prepend/replay but never guess after cache truncation", () => {
	__resetTurnCollapseOpen();
	const previous = [{ key: "qg:loaded", segmentIds: ["loaded", "call"] }];
	const current = [{ key: "qg:head", segmentIds: ["head", "loaded", "call"] }];
	const kept = retainInternalEpisodeKeys(previous, current);
	assert.equal(kept[0].key, "qg:loaded");
	assert.equal(retainInternalEpisodeKeys(kept, current)[0].key, "qg:loaded");
	writeRunExpanded("synthetic-one", "qg:loaded", true);
	assert.equal(expandedRunsOf("synthetic-one").has(kept[0].key), true);
	writeRunExpanded("synthetic-one", kept[0].key, false);
	assert.equal(expandedRunsOf("synthetic-one").has(kept[0].key), false);
	assert.equal(expandedRunsOf("synthetic-two").size, 0);
	forgetTurnCollapseOpen("synthetic-one");
	assert.equal(expandedRunsOf("synthetic-one").size, 0);
	const split = [
		{ key: "qg:a", segmentIds: ["loaded"] },
		{ key: "qg:b", segmentIds: ["call"] },
	];
	assert.deepEqual(
		retainInternalEpisodeKeys(previous, split).map((s) => s.key),
		["qg:a", "qg:b"],
	);
	const large = [
		{
			key: "qg:large",
			segmentIds: Array.from({ length: 4097 }, (_, i) => `id${i}`),
		},
	];
	assert.equal(
		retainInternalEpisodeKeys(large, [
			{ key: "qg:new", segmentIds: ["id0"] },
		])[0].key,
		"qg:new",
		"incomplete cache is not uniqueness proof",
	);
	const many = Array.from({ length: 129 }, (_, i) => ({
		key: `qg:id${i}`,
		segmentIds: [`id${i}`],
	}));
	assert.equal(
		retainInternalEpisodeKeys(many, [{ key: "qg:new", segmentIds: ["id0"] }])[0]
			.key,
		"qg:id0",
		"owner ordinals are not the disclosure key cap",
	);
});

/*
 * THE MINIMUM-ONLY HEAD-CUT FACTS, pinned on a shape the rule still folds.
 *
 * The head-cut IS `span.from === 0` - the loaded page starts inside the run -
 * so it cannot be combined with "an answer precedes the episode": there is
 * nothing before index 0 to precede it. What the folding episode therefore
 * needs here is a SECOND receipt, which is the rule's other arm: a genuine run
 * of exchanges. The single-receipt variant of this same shape now PAINTS (see
 * the test below), which is QA round 1's Q1.
 */
test("head-cut receipt counts are minimum-only, with no invented whole-episode duration", () => {
	const segment = internalSpanOf(
		planOf(
			[
				jobReceipt("cut-job"),
				jobReceipt("cut-job-2"),
				tool("cut-call", { phase: "running" }, "trace"),
			],
			true,
		),
		"cut-job",
	);
	assert.equal(segment.collapsed, true);
	assert.equal(segment.facts.partial, true);
	assert.equal(segment.internal.firstTs, null);
	assert.equal(segment.facts.durationS, null);
});

/*
 * QA round 1, Q1 - the plan-level contract for an episode that OPENS the run
 * with ONE receipt: there is no settled work before it and no run of exchanges
 * to batch, so it paints. Rendering proves the content reaches the reader
 * (`canonical-notice.test.mjs`); this pins the plan.
 */
test("a single receipt opening the run paints: no settled work, no run to batch", () => {
	for (const origin of [
		jobReceipt("open-job"),
		peerRow("open-peer"),
		row("open-wake", "wake", { text: "Synthetic wake" }),
	]) {
		const segment = internalSpanOf(
			planOf([origin, tool("open-call", { phase: "running" }, "trace")], true),
			origin.record.id,
		);
		assert.equal(segment.collapsed, false, origin.record.id);
		assert.equal(segment.internal, null, origin.record.id);
	}
});

test("all material artifact owners stay inline, including generated loading/error and owned files", () => {
	for (const name of ["generate_image", "generate_video"])
		for (const phase of ["running", "done"]) {
			const media = tool(
				"owner",
				{ toolName: name, phase, isError: phase === "done" },
				"trace",
			);
			const p = planOf(
				[
					...internalOpening(),
					peerRow("owner-p"),
					media,
					jobReceipt("owner-j"),
				],
				true,
			);
			assert.equal(allCollapsedIds(p).has("owner"), false);
		}
	for (const state of [
		"decided",
		"queued",
		"running",
		"cancelling",
		"done",
		"failed",
		"cancelled",
		"skipped",
	]) {
		const supplement = row("files-owner", "supplement", {
			anchor: "ia-final",
			job: "synthetic-files",
			state,
			version: 1,
			files: [
				{
					path: "synthetic/report.pdf",
					name: "report.pdf",
					kind: "pdf",
					sizeBytes: 10,
					mtime: TS,
					why: "synthetic output",
				},
			],
			filesMore: 0,
			more: [],
			components: [],
			error: state === "failed" ? "Synthetic failure" : "",
			live: state === "running",
			dismissed: state === "skipped",
		});
		const p = planOf(
			[
				...internalOpening(),
				peerRow("files-p"),
				tool("files-t", {}, "trace"),
				supplement,
				jobReceipt("files-j"),
			],
			true,
		);
		assert.equal(allCollapsedIds(p).has("files-owner"), false);
		assert.equal(
			runIsCondensed(p.runs[0], new Set(), { artifactOwner: "ia-final" }),
			false,
			"an internal bar cannot close its final-owned files",
		);
	}
});

/* Unified v2 count regression. Parent statistics are NOT disclosure children. */
test("head-cut peer + spawn counts one contained action despite huge parent/job stats", () => {
	const rows = [
		peerRow("count-p"),
		tool("count-t", { toolName: "sessions", durationS: 2.6 }),
		answer("count-a"),
	];
	const options = {
		live: false,
		runFacts: new Map([
			[
				"count-a",
				fact(113319, 50340, {
					openingUserId: "offpage",
					closingAnswerId: "count-a",
				}),
			],
		]),
		factPage: { ids: new Set(rows.map((r) => r.record.id)) },
	};
	/*
	 * THE RULE (QA round 1, Q1). `[peer, tool]` opens the run: one receipt and no
	 * settled answer before it, so there is neither settled work to continue nor
	 * a run of exchanges to batch, and the span is NOT an internal episode. That
	 * is the stronger form of this test's original point - with no episode there
	 * is nothing to condense the receipt into, so the parent's 113,319 actions
	 * have nothing to inflate.
	 *
	 * WHY THE ASSERTION IS `internal === null` AND NOT `collapsed === false`:
	 * this shape is the run's TAIL with the answer at the end, and an ordinary
	 * (non-internal) span still condenses here exactly as it did on base. What
	 * the rule governs is the internal-episode classification, not whether an
	 * ordinary span folds - that distinction is the whole point of the gate. The
	 * foldable head-cut shape that still pins minimum-only counts and a collapsed
	 * internal episode is the >=2-receipt case in this file.
	 */
	const before = collapsePlan(rows, options);
	const bar = before.runs
		.flatMap((r) => r.segments)
		.find((s) => s.segmentIds.includes("count-p"));
	assert.equal(bar.internal, null, "the opening receipt is not an episode");
	assert.deepEqual(bar.segmentIds, ["count-p", "count-t"]);
	assert.equal(
		before.runs[0].factApplied,
		false,
		"wire-backed aggregate was not applied to disclosure rows",
	);
	assert.equal(
		before.runs.flatMap((r) => r.segments).some((s) => s.facts.actions > 1),
		false,
		"no bar may state the parent's aggregate as this span's own work",
	);
	for (const segment of before.runs.flatMap((r) => r.segments))
		assert.equal(segment.segmentIds.includes("count-a"), false);
	const after = collapsePlan(rows, {
		...options,
		runFacts: new Map([
			[
				"count-a",
				fact(226638, 100680, {
					openingUserId: "offpage",
					closingAnswerId: "count-a",
				}),
			],
		]),
	});
	const other = after.runs
		.flatMap((r) => r.segments)
		.find((s) => s.segmentIds.includes("count-p"));
	assert.deepEqual(
		[other.key, other.facts.actions, other.segmentIds],
		[bar.key, 1, bar.segmentIds],
	);
	const appended = collapsePlan(
		[rows[0], rows[1], tool("count-second", { durationS: 1 }), rows[2]],
		options,
	);
	assert.equal(appended.runs[0].segments[0].facts.actions, 2);
	const receiptOnly = collapsePlan(
		[
			peerRow("jobs-p"),
			row("jobs-complete", "custom", {
				customType: "job_result",
				text: "Synthetic result",
				level: "info",
				detail: "Synthetic child report",
				untrustedFixtureStats: { action_count: 113319, worked_seconds: 50340 },
			}),
			row("subagent:jobs-info", "notice", {
				text: "Synthetic status",
				level: "info",
				untrustedFixtureStats: { action_count: 113319 },
			}),
			answer("jobs-a"),
		],
		{ live: false },
	);
	assert.equal(
		receiptOnly.runs[0].segments[0].facts.actions,
		0,
		"nested stats do not become inline actions",
	);
});

/* Architect brief twelve discriminating groups: partial bounded evidence ONLY. */
const epV2 = (key, ids, eligible = true) => ({
	key,
	segmentIds: ids,
	eligible,
});
const snapshotV2 = (
	episodes,
	held = episodes.map((e) => e.key),
	focus = null,
	outside = [],
) => captureInternalEpisodeIdentity(episodes, new Set(held), focus, outside);
const aliasesV2 = (prior, current, extra = {}) =>
	retainInternalEpisodeKeysV2(prior, current, extra);
test("v2 alias 1: 129 complete tiny owners no longer evict one held disclosure", () => {
	const old = Array.from({ length: 129 }, (_, i) =>
		epV2(`qg:p${i}`, [`p${i}`]),
	);
	const evidence = snapshotV2(old, ["qg:p0"]);
	assert.equal(evidence.complete, true);
	assert.equal(evidence.owners.size, 129);
	assert.equal(evidence.keys.size, 1);
	const now = old.map((e, i) =>
		i === 0 ? epV2("qg:head", ["head", "p0"]) : e,
	);
	assert.equal(aliasesV2(evidence, now).episodes[0].key, "qg:p0");
});
test("v2 alias 2: huge CURRENT may stream from complete prior; next prior must refuse", () => {
	const current = [
		epV2("qg:new", [
			"new",
			"anchor",
			...Array.from({ length: 5000 }, (_, i) => `n:${i}`),
		]),
	];
	const bounded = snapshotV2([epV2("qg:anchor", ["anchor"])]);
	assert.equal(
		aliasesV2(bounded, current, { currentIdsUnique: true }).episodes[0].key,
		"qg:anchor",
	);
	assert.equal(
		aliasesV2(bounded, current).reason,
		"current-uniqueness-unproved",
	);
	const overflow = snapshotV2(current);
	assert.equal(overflow.complete, false);
	assert.equal(overflow.owners.size, 0);
	/*
	 * `prior-id-limit`, not a generic "previous-incomplete": the projection
	 * propagates the CAPTURE's own reason (`if (!previous.complete) return
	 * refuse(previous.reason ?? "incomplete-prior")`) because the precise cause is
	 * what a reader of a refusal needs - "the prior snapshot overflowed 4096 IDs"
	 * says what to do next, while a blanket "incomplete" does not.
	 */
	assert.equal(
		aliasesV2(overflow, [epV2("qg:later", ["later", "anchor"])]).reason,
		"prior-id-limit",
	);
});
test("v2 alias 3+4: oversized previous and indistinguishable unseen splits cannot be blessed", () => {
	const huge = epV2("qg:a", [
		"a",
		...Array.from({ length: 4095 }, (_, i) => `inside:${i}`),
		"z",
	]);
	assert.equal(
		aliasesV2(snapshotV2([huge]), [
			epV2("qg:head-c", ["head-c", "a", "z"]),
			epV2("qg:inside:2000", ["inside:2000"]),
		]).reason,
		// Same deliberate propagation as alias 2: an oversized PRIOR snapshot is
		// discarded wholesale, and the capture's own reason is what travels.
		"prior-id-limit",
	);
	const now = [
		epV2("qg:head-c", ["head-c", "a", "c", "z"]),
		epV2("qg:b", ["b"]),
	];
	assert.equal(
		aliasesV2(snapshotV2([epV2("qg:a", ["a", "b", "c", "z"])]), now).episodes[0]
			.key,
		"qg:head-c",
	);
	assert.equal(
		aliasesV2(snapshotV2([epV2("qg:a", ["a", "c", "z"])]), now).episodes[0].key,
		"qg:a",
	);
});
test("v2 alias 5: unheld merge, two held merge, split-three and key collisions refuse", () => {
	const a = epV2("qg:a", ["a", "z"]);
	const b = epV2("qg:b", ["b"]);
	const merged = [epV2("qg:head-c", ["head-c", "a", "b", "z"])];
	for (const held of [["qg:a"], ["qg:a", "qg:b"]])
		assert.equal(
			aliasesV2(snapshotV2([a, b], held), merged).episodes[0].key,
			"qg:head-c",
		);
	assert.equal(
		aliasesV2(snapshotV2([epV2("qg:a", ["a", "b", "z"])]), [
			epV2("qg:head-c", ["head-c", "a"]),
			epV2("qg:b", ["b"]),
			epV2("qg:z", ["z"]),
		]).episodes[0].key,
		"qg:head-c",
	);
	// Deliberately MALFORMED unrelated key: a generic caller must not silently
	// alias a candidate onto an already-claimed held key (not canonical input).
	assert.equal(
		aliasesV2(snapshotV2([a]), [
			epV2("qg:head-c", ["head-c", "a", "z"]),
			epV2("qg:a", ["unrelated"]),
		]).reason,
		"key-collision",
	);
});
test("v2 alias 6: loaded prepend, mounted head slice and true head loss remain distinct", () => {
	const evidence = snapshotV2([epV2("qg:a", ["a", "b", "z"])]);
	assert.equal(
		aliasesV2(evidence, [epV2("qg:prefix", ["prefix", "a", "b", "z"])])
			.episodes[0].key,
		"qg:a",
	);
	assert.equal(
		aliasesV2(evidence, [epV2("qg:b", ["b", "z"])]).episodes[0].key,
		"qg:b",
		"missing current anchor cannot prove source head loss or a mounted slice",
	);
	assert.equal(
		aliasesV2(evidence, [epV2("qg:b", ["b", "z"])], {
			outsideCurrentIds: ["a"],
		}).episodes[0].key,
		"qg:b",
		"anchor presence outside candidate is not same-episode proof",
	);
});
test("v2 alias 7: duplicates, malformed keys, opaque colons and ineligible qg spans", () => {
	const old = snapshotV2([epV2("qg:a:b", ["a:b"])]);
	assert.equal(
		aliasesV2(old, [epV2("qg:new", ["new", "a:b"])]).episodes[0].key,
		"qg:a:b",
	);
	for (const now of [
		[epV2("qg:c", ["c", "a:b"]), epV2("qg:d", ["d", "a:b"])],
		[epV2("qg:c", ["c", "a:b", "new", "new"])],
	])
		assert.equal(aliasesV2(old, now).reason, "duplicate-current-id");
	assert.equal(
		aliasesV2(snapshotV2([epV2("not-qg", ["a"])]), [epV2("qg:c", ["c", "a"])])
			.episodes[0].key,
		"qg:c",
	);
	assert.equal(
		aliasesV2(old, [epV2("qg:c", ["c", "a:b"], false)]).episodes[0].key,
		"qg:c",
	);
});
test("v2 alias 8: reorder/split and hydration material boundaries conservative refusal", () => {
	const old = snapshotV2([epV2("qg:a", ["a", "b", "c"])]);
	assert.equal(
		aliasesV2(old, [epV2("qg:head-c", ["head-c", "c", "b", "a"])]).episodes[0]
			.key,
		"qg:head-c",
	);
	assert.equal(
		aliasesV2(old, [epV2("qg:head-c", ["head-c", "a", "c"])], {
			outsideCurrentIds: ["b"],
		}).episodes[0].key,
		"qg:head-c",
	);
	for (const kind of ["artifact", "failed", "ask"])
		assert.equal(
			aliasesV2(old, [epV2(`qg:${kind}`, [kind, "a", "b", "c"], false)])
				.episodes[0].key,
			`qg:${kind}`,
		);
	// Same-ID field changes with unchanged candidate membership are NOT a typed
	// transition certificate. This partial helper does not close that gate.
});
test("v2 alias 9: different-ID adoption and cleared/session-scoped evidence cannot infer text aliases", () => {
	const old = snapshotV2([epV2("qg:a", ["a"])]);
	assert.equal(
		aliasesV2(old, [epV2("qg:new-id", ["new-id"])]).episodes[0].key,
		"qg:new-id",
	);
	const reset = snapshotV2([], []);
	for (const transition of ["session", "draft", "clear", "remount"])
		assert.equal(
			aliasesV2(reset, [epV2(`qg:${transition}`, [transition, "a"])])
				.episodes[0].key,
			`qg:${transition}`,
		);
});
test("v2 alias 10: focus-only candidate has no second disclosure boolean owner", () => {
	const old = snapshotV2([epV2("qg:a", ["a", "focused"])], [], "focused");
	assert.equal(old.keys.size, 1);
	assert.equal(
		aliasesV2(old, [epV2("qg:prefix", ["prefix", "a", "focused"])]).episodes[0]
			.key,
		"qg:a",
	);
	assert.equal(
		aliasesV2(old, [epV2("qg:c", ["c", "a"]), epV2("qg:focused", ["focused"])])
			.episodes[0].key,
		"qg:c",
	);
});
test("v2 alias 11: identity capture never refreshes disclosure open/session LRU", () => {
	__resetTurnCollapseOpen();
	for (let i = 0; i < 129; i++) writeRunExpanded("alias-lru", `qg:${i}`, true);
	const held = expandedRunsOf("alias-lru");
	assert.equal(held.size, 128);
	assert.equal(held.has("qg:0"), false);
	snapshotV2([epV2("qg:1", ["1"])], [...held]);
	assert.deepEqual(expandedRunsOf("alias-lru"), held);
	writeRunExpanded("alias-lru", "qg:1", false);
	assert.equal(expandedRunsOf("alias-lru").has("qg:1"), false);
	for (let i = 0; i < 8; i++)
		writeRunExpanded(`alias-session-${i}`, "qg:s", true);
	assert.equal(expandedRunsOf("alias-lru").size, 0);
	__resetTurnCollapseOpen();
});
test("v2 alias 12: overflow never retains stale partial maps/current arrays", () => {
	const latest = snapshotV2([
		epV2(
			"qg:n0",
			Array.from({ length: 4097 }, (_, i) => `n${i}`),
		),
	]);
	assert.equal(latest.complete, false);
	assert.equal(latest.owners.size, 0);
	assert.equal(latest.keys.size, 0);
	assert.equal(
		Object.hasOwn(latest, "episodes"),
		false,
		"no retained current full array",
	);
});

/*
 * REVIEWER ROUND 1 - F2/F3/F4, each measured against the base snapshot with the
 * same builders before it was fixed.
 */
test("F2: only the episode in the cycle still being written is unsettled", () => {
	/*
	 * The announce effect must silence the UNSETTLED episode while the turn thinks
	 * and nothing else. Keying it on episode membership also silenced every
	 * settled history episode during a live pass, so none was recorded and the
	 * first settle re-announced them all (reviewer replica ['qg:w1','seg:a5']).
	 */
	const rows = [
		user("f2-u"),
		answer("f2-a0"),
		peerRow("f2-w1"),
		tool("f2-t1", {}, "trace"),
		answer("f2-a1"),
		peerRow("f2-w2"),
		tool("f2-t2", { phase: "running" }, "trace"),
	];
	const live = planOf(rows, true);
	assert.equal(internalSpanOf(live, "f2-w1").internal.unsettled, false);
	assert.equal(internalSpanOf(live, "f2-w2").internal.unsettled, true);
	const settledRows = rows.map((entry) =>
		entry.record.id === "f2-t2"
			? tool("f2-t2", { phase: "done" }, "trace")
			: entry,
	);
	const settled = planOf(settledRows, false);
	assert.equal(
		internalSpanOf(settled, "f2-w2").internal.unsettled,
		false,
		"nothing is in flight once the rows settle",
	);
	/*
	 * THE DIP SHAPE (2026-10-21). `live` false while a tool row still says it is
	 * running is exactly what a liveness dip paints, and the row is the better
	 * witness: the episode is still being written whatever the pane's sampled
	 * flag says. See `planRun`'s `runStatesItsOwnLiveness`.
	 */
	const dip = planOf(rows, false);
	assert.equal(
		internalSpanOf(dip, "f2-w2").internal.unsettled,
		true,
		"a running row keeps the episode unsettled through a liveness dip",
	);
});

test("F2: an episode stays unsettled when a streaming answer appends after it", () => {
	/* `internal.live` carries a tail-position condition and flips false on the
	 * append; the announce gate needs the fact that does not. */
	const plan = planOf(
		[
			user("f2s-u"),
			answer("f2s-a0"),
			peerRow("f2s-w1"),
			tool("f2s-t1", {}, "trace"),
			answer("f2s-a1", { streaming: true, complete: false }),
		],
		true,
	);
	const span = internalSpanOf(plan, "f2s-w1");
	assert.equal(span.internal.live, false);
	assert.equal(span.internal.unsettled, true);
});

test("the settle latch: a watched episode's gate cannot move on a liveness flip - the F2 dip", () => {
	/*
	 * THE DIP THE LATCH MISSED (convergence round, 2026-10-17). `liveFrom` is
	 * frozen for a watched run, but the one-bar gate and the episode facts still
	 * read the raw flag: on a dip the episode's suppression paused (a SECOND bar
	 * flashed in) and `live`/`unsettled` flipped - the painted plan of the run
	 * the latch exists to protect moved on a transient. The gate and the facts
	 * now ride the same `anchored` reading `liveFrom` does (see `planRun`).
	 */
	const rows = [
		user("dip-u"),
		tool("dip-t0", { durationS: 3 }),
		answer("dip-a0", { settledAt: TS + 3_000, stopReason: "stop" }),
		peerRow("dip-w1"),
		tool("dip-t1", { phase: "running", output: null }),
	];
	/** Every segment's paint-relevant outcome, in one stable shape. */
	const outcomes = (plan) =>
		plan.runs.flatMap((run) =>
			run.segments.map((segment) => ({
				key: segment.key,
				collapsed: segment.collapsed,
				completed: segment.completed,
				internal:
					segment.internal === null || segment.internal === undefined
						? null
						: {
								live: segment.internal.live,
								unsettled: segment.internal.unsettled,
								receipts: segment.internal.receipts,
							},
			})),
		);
	const live = outcomes(
		collapsePlan(rows, { live: true, watchedRunId: "dip-u" }),
	);
	const dipped = outcomes(
		collapsePlan(rows, { live: false, watchedRunId: "dip-u" }),
	);
	assert.deepEqual(
		dipped,
		live,
		"the dip reaches the SAME plan for the watched run",
	);
	assert.deepEqual(
		outcomes(collapsePlan(rows, { live: true, watchedRunId: "dip-u" })),
		live,
		"and the re-entry reaches it again - idempotent, not stable once",
	);
	/*
	 * THE F2 SHAPE, spelled: the episode is suppressed (paints loose) while the
	 * settled turn's own bar stands - on BOTH sides of the flip.
	 */
	const episodeOf = (plan) => internalSpanOf(plan, "dip-w1");
	assert.equal(
		episodeOf(collapsePlan(rows, { live: true, watchedRunId: "dip-u" }))
			.collapsed,
		false,
		"the live pass suppresses the episode's second bar",
	);
	assert.equal(
		episodeOf(collapsePlan(rows, { live: false, watchedRunId: "dip-u" }))
			.collapsed,
		false,
		"and the dip does not hand it back",
	);
	/*
	 * UNWATCHED CONTROL (the R2 residual): a run whose rows are ALL settled - the
	 * inter-cycle gap the latch was built for, where a resumed turn and a dead run
	 * are the same rows - still folds on a dip. The freeze above is the rows' for
	 * a visibly-live run and the latch's for this one, never a blanket rule.
	 */
	const settledRows = [
		user("dip-u"),
		tool("dip-t0", { durationS: 3 }),
		answer("dip-a0", { settledAt: TS + 3_000, stopReason: "stop" }),
		peerRow("dip-w1"),
		tool("dip-t2", { durationS: 2 }),
	];
	assert.notDeepEqual(
		outcomes(collapsePlan(settledRows, { live: false })),
		outcomes(collapsePlan(settledRows, { live: true })),
		"an unwatched run with no live row is not frozen: its dip still moves the plan",
	);
	assert.equal(
		internalSpanOf(collapsePlan(settledRows, { live: false }), "dip-w1")
			.collapsed,
		true,
		"the unwatched dip folds the episode into its bar",
	);
});

test("the settle latch: the watched episode's bar still arrives when the settle lands - no permanent suppression", () => {
	/*
	 * The anchored reading must not suppress past settlement: once a settled
	 * close lands beyond the episode, `span.to >= liveFrom` reads false for the
	 * watched run too, the gate stops, and the bar is the settle outcome PR-4 #2
	 * expects (the mounted half pins the one announcement).
	 */
	const rows = [
		user("pst-u"),
		tool("pst-t0", { durationS: 3 }),
		answer("pst-a0", { settledAt: TS + 3_000, stopReason: "stop" }),
		peerRow("pst-w1"),
		tool("pst-t1", { durationS: 4 }),
		answer("pst-a1", { settledAt: TS + 15_000, stopReason: "stop" }),
	];
	const settled = collapsePlan(rows, { live: false, watchedRunId: "pst-u" });
	const episode = internalSpanOf(settled, "pst-w1");
	assert.equal(
		episode.collapsed,
		true,
		"the settled episode wears its own bar",
	);
	assert.equal(
		episode.internal.unsettled,
		false,
		"and it is no longer unsettled",
	);
	assert.equal(episode.internal.live, false, "nor live");
});

test("the settle latch: a latch that does not hold the run leaves the plan byte-identical - the scoping control", () => {
	/*
	 * THE SCOPING CONTROL (settle-latch convergence round, 2026-10-17). The
	 * latch spends `watched` on the NEWEST run that HOLDS its row id
	 * (`runHoldsRowId`, containment) and nowhere else; every silence this round
	 * pins is downstream of that spend. Pin the other side here: an id the newest
	 * run does not hold changes nothing - every projection, live or quiet, equals
	 * the no-latch plan, including the dip whose fold the R2 residual keeps for
	 * unwatched runs. The mounted announce-side control is not constructible in
	 * the desktop harness (measured: a live pass re-latches the newest run, a
	 * quiet arrival marshals its receipts into quiet-group bars remembered
	 * without appearing, and a conversation switch resets the bookkeeping), so
	 * this byte-identity carries the "unwatched timing is unchanged" control.
	 */
	const rows = [
		user("scp-u"),
		tool("scp-t0", { durationS: 3 }),
		answer("scp-a0", { settledAt: TS + 3_000, stopReason: "stop" }),
		peerRow("scp-w1"),
		tool("scp-t1", { phase: "running", output: null }),
	];
	const outcomes = (options) =>
		collapsePlan(rows, options).runs.flatMap((run) =>
			run.segments.map((segment) => ({
				key: segment.key,
				collapsed: segment.collapsed,
				completed: segment.completed,
				internal:
					segment.internal === null || segment.internal === undefined
						? null
						: {
								live: segment.internal.live,
								unsettled: segment.internal.unsettled,
								receipts: segment.internal.receipts,
							},
			})),
		);
	for (const live of [true, false]) {
		assert.deepEqual(
			outcomes({ live, watchedRunId: "scp-observer" }),
			outcomes({ live }),
			`a foreign latch id changes nothing (live: ${live})`,
		);
		assert.deepEqual(
			outcomes({ live, watchedRunId: null }),
			outcomes({ live }),
			`an explicit null latch changes nothing (live: ${live})`,
		);
	}
	/*
	 * CONTAINMENT IS PER-NEWEST-RUN: an id REAL in the rows but not in the
	 * newest run is equally inert - the latch cannot freeze a run it never
	 * watched. The close before the second user row is what makes it a second
	 * RUN at all: a user row inside an open turn is a steer and stays in the
	 * same run (measured while authoring this case - the merged run legitimately
	 * held the id).
	 */
	const twoRun = [
		...rows,
		answer("scp-a1", { settledAt: TS + 9_000, stopReason: "stop" }),
		user("scp-u2"),
		tool("scp-t2", { phase: "running", output: null }),
	];
	const brief = (options) =>
		collapsePlan(twoRun, options).runs.flatMap((run) =>
			run.segments.map((segment) => ({
				key: segment.key,
				collapsed: segment.collapsed,
				internal:
					segment.internal === null || segment.internal === undefined
						? null
						: segment.internal.unsettled,
			})),
		);
	for (const live of [true, false]) {
		assert.deepEqual(
			brief({ live, watchedRunId: "scp-u" }),
			brief({ live }),
			`an older run's row id is not the newest run's to hold (live: ${live})`,
		);
	}
});

test("F3: a settled bar's own media keeps that bar when a receipt arrives after it", () => {
	/*
	 * Pinning media run-wide once ANY receipt existed tore the picture out of the
	 * settled bar that owned it: base holds `seg:f3-a1[f3-media]` collapsed and the
	 * pin dropped that bar entirely, painting the media loose.
	 */
	const plan = planOf(
		[
			user("f3-u"),
			tool("f3-media", { toolName: "generate_image", phase: "done" }, "trace"),
			answer("f3-a1"),
			peerRow("f3-p1"),
			tool("f3-t1", {}, "trace"),
		],
		false,
	);
	const bar = internalSpanOf(plan, "f3-media");
	assert.equal(bar.collapsed, true, "the settled bar still holds its media");
	assert.equal(bar.key, "seg:f3-a1");
	assert.equal(bar.internal ?? null, null);
});

test("F3: media owned AFTER the first receipt stays inline", () => {
	const plan = planOf(
		[
			user("f3b-u"),
			answer("f3b-a1"),
			peerRow("f3b-p1"),
			tool("f3b-media", { toolName: "generate_image", phase: "done" }, "trace"),
			tool("f3b-t1", {}, "trace"),
		],
		false,
	);
	assert.equal(
		allCollapsedIds(plan).has("f3b-media"),
		false,
		"a picture produced inside the episode is never hidden by it",
	);
});

test("F4: a reader-opened live episode is not un-collapsed by a landing head", () => {
	/*
	 * The one-bar gate suppresses a live episode when an ordinary bar also stands,
	 * which closes a disclosure the reader opened - silently, because the key is
	 * unchanged and the re-collapse patch never runs. `openRuns` must win.
	 */
	const rows = [
		user("f4-u"),
		tool("f4-t0", {}, "trace"),
		answer("f4-a0"),
		peerRow("f4-w2"),
		tool("f4-t2", { phase: "running" }, "trace"),
	];
	const closed = internalSpanOf(planOf(rows, true), "f4-w2");
	assert.equal(closed.collapsed, false, "without an open key the gate yields");
	const opened = internalSpanOf(
		collapsePlan(rows, { live: true, openRuns: new Set([closed.key]) }),
		"f4-w2",
	);
	assert.equal(opened.collapsed, true, "the reader's open episode survives");
	assert.equal(opened.key, closed.key, "and keeps its identity");
});

test("olderRowsExist: a head-cut episode condenses only when older rows are known to exist", () => {
	/*
	 * The architect's discriminator for the head-cut contradiction. The seed is
	 * `!headLoaded && olderRowsExist`, so it moves ONLY a span at the loaded edge,
	 * and defaults off so every existing caller keeps today's behaviour.
	 */
	const rows = [
		peerRow("oe-peer"),
		tool("oe-tool", { phase: "running" }, "trace"),
	];
	const none = internalSpanOf(
		collapsePlan(rows, { live: true, olderRowsExist: false }),
		"oe-peer",
	);
	assert.equal(none.collapsed, false);
	assert.equal(none.internal, null);
	const unset = internalSpanOf(collapsePlan(rows, { live: true }), "oe-peer");
	assert.equal(unset.collapsed, false, "omitted defaults to today's behaviour");
	const older = internalSpanOf(
		collapsePlan(rows, { live: true, olderRowsExist: true }),
		"oe-peer",
	);
	assert.equal(older.collapsed, true);
	assert.notEqual(older.internal, null);
});

test("olderRowsExist does not widen a run whose own head is loaded", () => {
	/* `[user, peer, tool]` has its opening user row on hand, so nothing older is
	 * missing from THIS run whatever the paging state says: the receipt opens the
	 * run's content and still paints. */
	const rows = [
		user("ow-user"),
		peerRow("ow-peer"),
		tool("ow-tool", { phase: "running" }, "trace"),
	];
	const span = internalSpanOf(
		collapsePlan(rows, { live: true, olderRowsExist: true }),
		"ow-peer",
	);
	assert.equal(span.collapsed, false);
	assert.equal(span.internal, null);
});

test("olderRowsExist is part of the plan's options key", () => {
	/* Without it the caller's plan memo would not re-plan when a page lands. */
	assert.notEqual(
		collapsePlanOptionsKey({ live: true, olderRowsExist: true }),
		collapsePlanOptionsKey({ live: true, olderRowsExist: false }),
	);
	assert.equal(
		collapsePlanOptionsKey({ live: true }),
		collapsePlanOptionsKey({ live: true, olderRowsExist: false }),
		"omitted equals false",
	);
});

test("olderRowsThanWindow: either an unloaded page or a window-hidden head means older rows exist", () => {
	/*
	 * The caller's derivation of `olderRowsExist`, as a pure function so each arm
	 * is pinned in milliseconds. The `hidden > 0` arm is ALSO mount-tested
	 * (`rows hidden by the render window...` in the behaviour file, 362 rows); see
	 * the helper's doc comment for why that fixture has to be that tall.
	 */
	assert.equal(olderRowsThanWindow(true, 0), true, "hasMore alone");
	assert.equal(olderRowsThanWindow(true, 12), true, "hasMore wins over hidden");
	assert.equal(olderRowsThanWindow(false, 0), false, "nothing older anywhere");
	assert.equal(olderRowsThanWindow(false, 1), true, "hidden alone");
	assert.equal(
		olderRowsThanWindow(undefined, 0),
		false,
		"absent hasMore is false",
	);
	assert.equal(
		olderRowsThanWindow(undefined, 3),
		true,
		"absent hasMore, hidden",
	);
});

test("olderRowsExist seeds only the LIVE span: a settled head-cut bar is not an episode (R2-2)", () => {
	/* `[peer, 4 tools, answer]`, settled. It condenses as an ordinary bar whether
	 * or not older rows exist, so the seed must not change what it is: same key,
	 * no episode. Otherwise the head landing re-keys `qg:p` -> `seg:a`. */
	const rows = [
		peerRow("sl-peer"),
		tool("sl-t1"),
		tool("sl-t2"),
		tool("sl-t3"),
		tool("sl-t4"),
		answer("sl-final"),
	];
	const of = (older) =>
		internalSpanOf(
			collapsePlan(rows, { live: false, olderRowsExist: older }),
			"sl-peer",
		);
	const without = of(false);
	const withOlder = of(true);
	assert.equal(withOlder.internal, null, "not an episode");
	assert.equal(withOlder.key, without.key, "the same key either way");
	assert.equal(withOlder.collapsed, without.collapsed);
});

test("a live head-cut episode states minimum-only counts and no invented duration", () => {
	/* Restored from the original head-cut count test (R2-4): the live episode that
	 * the older-rows seed keeps condensed still counts one contained action, one
	 * receipt and no duration - the figures a cut span can honestly state. */
	const rows = [
		peerRow("lc-peer"),
		tool("lc-t", { phase: "running", durationS: 2.6 }),
	];
	const span = internalSpanOf(
		collapsePlan(rows, { live: true, olderRowsExist: true }),
		"lc-peer",
	);
	assert.equal(span.facts.actions, 1);
	assert.equal(span.internal.receipts, 1);
	assert.equal(
		span.facts.durationS,
		null,
		"a cut head cannot state a duration",
	);
});

test("paintedRows and widenTarget measure with the render's older-rows input (R2-3)", () => {
	/* The widen's currency must be the render's. With a run taller than the snap's
	 * reach the window edge lands on the peer, `hidden > 0`, the render condenses
	 * the live episode - so the metric must count it as hidden too. */
	const rows = [user("pw-user"), answer("pw-final")];
	for (let i = 0; i < 300; i += 1) rows.push(tool(`pw-pre-${i}`));
	rows.push(peerRow("pw-peer"));
	for (let i = 0; i < 58; i += 1) rows.push(tool(`pw-post-${i}`));
	rows.push(tool("pw-live", { phase: "running" }, "trace"));
	const opts = {
		step: 60,
		live: true,
		snapMaxExtra: 300,
		completedRunMaxExtra: 720,
	};
	const painted = paintedRows(rows, 60, opts);
	assert.ok(
		painted < 60,
		`the live episode is counted as hidden, got ${painted}`,
	);
});

// R3-2 architect ruling: older rows prove a cut, not an unseen settled answer.
// Keep the live-only seed; a settled fragment must wait for an actual answer
// anchor before a lone receipt can make it an internal episode.
test("R3-2: settled answerless head-cut receipt work paints without a loaded anchor", () => {
	const rows = [
		peerRow("r3-peer"),
		tool("r3-t1"),
		tool("r3-t2"),
		tool("r3-t3"),
	];
	const span = internalSpanOf(
		collapsePlan(rows, { live: false, olderRowsExist: true }),
		"r3-peer",
	);
	assert.equal(
		span.collapsed,
		false,
		"older rows alone do not establish settled work",
	);
	assert.equal(span.internal, null);
});

test("R3-2: settled receipt work folds once its preceding answer actually loads", () => {
	const rows = [
		answer("r3-anchor"),
		peerRow("r3-peer"),
		tool("r3-t1"),
		tool("r3-t2"),
		tool("r3-t3"),
	];
	const span = internalSpanOf(
		collapsePlan(rows, { live: false, olderRowsExist: true }),
		"r3-peer",
	);
	assert.equal(
		span.collapsed,
		true,
		"loaded settled answer establishes the continuation",
	);
	assert.equal(span.internal.receipts, 1);
});

test("R3: announcement ownership aliases only previously known qg episodes, with pinned exclusion and bounded refusals", () => {
	const origin = epV2("qg:ann-p", ["ann-p", "ann-t"]);
	const bounded = epV2("seg:ann-final", ["ann-p", "ann-t", "ann-t2"]);
	const prior = snapshotV2([origin], [origin.key], null, ["ann-final"]);
	assert.equal(
		aliasesV2(prior, [bounded], { outsideCurrentIds: ["ann-final"] })
			.episodes[0].key,
		origin.key,
	);
	// This is the effect's ownership predicate: UNKNOWN live keys never enter
	// knownKeys. Structural eligibility alone cannot burn their future sentence.
	const unannounced = snapshotV2([origin], []);
	assert.equal(unannounced.keys.size, 0);
	assert.equal(aliasesV2(unannounced, [bounded]).episodes[0].key, bounded.key);
	const swallowsPinned = epV2("seg:other", ["ann-p", "ann-t", "ann-final"]);
	assert.equal(
		aliasesV2(prior, [swallowsPinned]).episodes[0].key,
		"seg:other",
		"a prior visible anchor cannot become episode-private work",
	);
	const split = [epV2("seg:one", ["ann-p"]), epV2("seg:two", ["ann-t"])];
	assert.deepEqual(
		aliasesV2(prior, split).episodes.map((e) => e.key),
		["seg:one", "seg:two"],
	);
	const reorder = epV2("seg:order", ["ann-t", "ann-p"]);
	assert.equal(aliasesV2(prior, [reorder]).episodes[0].key, reorder.key);
	const lost = epV2("seg:lost", ["ann-t"]);
	assert.equal(aliasesV2(prior, [lost]).episodes[0].key, lost.key);
	const overflow = snapshotV2([
		epV2(
			"qg:overflow",
			Array.from({ length: 4097 }, (_, i) => `overflow-${i}`),
		),
	]);
	assert.equal(overflow.reason, "prior-id-limit");
	assert.equal(aliasesV2(overflow, [bounded]).reason, "prior-id-limit");
});

test("a peer turn whose only own row is a settled no_reply paints no bar, in either record order", () => {
	/*
	 * `[user][tools][answer][peer][no_reply]` is the reload order; the live path
	 * can land the peer record after the quiet row. Both leave a span with no
	 * label, count or duration, which must stay loose (its rows paint nothing)
	 * instead of becoming an empty check-and-chevron bar.
	 */
	const orders = {
		reload: [peerRow("p1"), quiet("q1")],
		live: [quiet("q1"), peerRow("p1")],
	};
	for (const [name, tail] of Object.entries(orders)) {
		const rows = [
			user("u1"),
			tool("t1", { durationS: 3 }, "trace"),
			answer("a1"),
			...tail,
		];
		const [plan] = planOf(rows).runs;
		for (const seg of plan.segments) {
			const empty =
				seg.label === null &&
				seg.facts.actions === 0 &&
				seg.facts.durationS === null &&
				seg.facts.group === null &&
				seg.internal === null;
			assert.equal(
				seg.collapsed && empty,
				false,
				`${name}: no empty collapsed bar (${seg.segmentIds})`,
			);
		}
		const work = plan.segments.find((seg) => seg.segmentIds.includes("t1"));
		assert.equal(work?.collapsed, true, `${name}: the real work bar remains`);
		assert.equal(work?.facts.actions, 1, `${name}: Took/actions unchanged`);
	}
});

const emptyBarsOf = (rows) =>
	planOf(rows).runs.flatMap((run) =>
		run.segments.filter(
			(seg) => seg.collapsed && seg.label === null && seg.facts.actions === 0,
		),
	);

test("a bare no_reply close after an unlabelled boundary paints no empty bar", () => {
	// Fails on main: a quiet close with no answer after a new user message
	// (and one after an answer) became a collapsed bar with nothing to show.
	assert.equal(
		emptyBarsOf([user("u1"), answer("a1"), user("u2"), quiet("q1")]).length,
		0,
	);
	assert.equal(emptyBarsOf([user("u1"), quiet("q1")]).length, 0);
	assert.equal(emptyBarsOf([user("u1"), answer("a1"), quiet("q1")]).length, 0);
});

test("a lone custom or supplement span stays loose instead of an empty bar", () => {
	// Deliberate widening: the predicate is not specific to no_reply.
	const custom = row(
		"c1",
		"custom",
		{
			customType: "job_result",
			level: "info",
			category: null,
		},
		"trace",
	);
	const supplement = row(
		"s1",
		"supplement",
		{
			anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
			job: "3f9c1a7e5b20",
			version: 1,
		},
		"trace",
	);
	for (const r of [custom, supplement])
		assert.equal(emptyBarsOf([user("u1"), r]).length, 0, r.record.kind);
});
