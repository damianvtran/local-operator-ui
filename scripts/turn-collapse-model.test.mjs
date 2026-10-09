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
import { test } from "node:test";
import { build } from "esbuild";
import { FakeJournal } from "./loader-journal-fixture.mjs";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
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
	ALIGN_WALK_MAX_PAGES,
	WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	alignWalkDecision,
	alignWalkRunFromPlan,
	alignWalkRunKey,
	alignWalkRunKeyConfirmed,
	alignWalkStateFor,
	initialAlignWalkState,
	collapsePlan,
	isFailedCall,
	paintedRows,
	runsOf,
	snapWindowToRunBoundary,
	staysVisibleWhileCollapsed,
	widenTarget,
	windowTopRun,
	windowTopRunIsHeadCut,
	closingAnswerIds,
	buildRows,
	applyHistoryPage,
	applyEvent,
	EMPTY_TRANSCRIPT,
	visibleRecords,
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
				sender: {},
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
		{ kind: "peer", id: "p1", ts: TS + 50, body: "from a peer", sender: {} },
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
		 * The narration: settled assistant text with no `stopReason` and a call after
		 * it, so `cyclesOf` reads it as narration rather than a close - hidden by
		 * `by-turn`, kept by `by-response`. That difference is the whole fixture.
		 */
		rows.push(answer(`nn${turn}`, { ts: at + 50_000, text: "still working" }));
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
	assert.deepEqual(
		followUp?.segmentIds,
		[
			"entry-001203",
			"entry-001204",
			"entry-001206",
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

test("a head-cut run's bar states the RUN's figures, not the loaded fragment (the operator's `423 actions`)", () => {
	const rows = [
		tool("t1", { ts: TS, durationS: 20 }),
		tool("t2", { ts: TS + 1, durationS: 30 }, "trace"),
		answer("a1", { ts: TS + 5_000 }),
	];
	/*
	 * The fallback first: identical rows, no facts. This is what the operator
	 * sees today, and the test fails on its own if the facts path is ever
	 * reached by accident.
	 */
	const loaded = planOf(rows).runs[0].segments[0].facts;
	assert.equal(loaded.actions, 2, "the loaded span's count");
	assert.equal(loaded.durationS, null, "no duration off a fragment");
	assert.equal(loaded.partial, true, "and the `+` that says so");
	/*
	 * With the fact: the run's own numbers, on the same rows.
	 */
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([["a1", fact(423, 8_639)]]),
	});
	const bar = plan.runs[0].segments[0].facts;
	assert.equal(bar.actions, 423, "the run's count, not the two rows loaded");
	assert.equal(bar.durationS, 8_639, "and the run's worked time");
	assert.equal(bar.partial, false, "exact, so no `+`");
});

test("a fact that the index could not compute exactly keeps the bar's `+`", () => {
	/*
	 * `complete: false` is the index's own admission that a row body inside the
	 * run was dropped, so its count is a floor. The bar has exactly one way to
	 * say so, and a fact must not retire it.
	 */
	const rows = [
		tool("t1", { ts: TS, durationS: 4 }),
		answer("a1", { ts: TS + 5_000 }),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([["a1", fact(9, 40, { complete: false })]]),
	});
	assert.equal(plan.runs[0].segments[0].facts.actions, 9, "the floor, stated");
	assert.equal(
		plan.runs[0].segments[0].facts.partial,
		true,
		"and marked a floor",
	);
	assert.equal(plan.runs[0].facts.partial, true, "the turn's own figure too");
});

test("the bars still sum to the turn: a pinned row splitting a head-cut run, with facts (D1)", () => {
	/*
	 * THE ARITHMETIC THE SUBTRACTION EXISTS FOR. Three spans - two loaded tool
	 * rows, a compaction, then the rest of the turn - and the server's total for
	 * the whole run. The FIRST bar must be the run's total minus its siblings'
	 * work, not the run's total: a bar stating `423` beside a sibling stating
	 * its own `2` would not add up, and a reader who adds up the ladder is
	 * exactly the reader D1 was written for.
	 */
	const rows = [
		tool("t1", { ts: TS, durationS: 20 }),
		row("c1", "compaction", { text: "Context compacted", ts: TS + 1 }, "item"),
		tool("t2", { ts: TS + 2, durationS: 30 }),
		tool("t3", { ts: TS + 3, durationS: 40 }, "trace"),
		answer("a1", { ts: TS + 5_000 }),
	];
	const plan = collapsePlan(rows, {
		live: false,
		runFacts: new Map([["a1", fact(100, 1_000)]]),
	});
	const run = plan.runs[0];
	const bars = run.segments.filter((segment) => !segment.afterAnswer);
	assert.equal(bars.length, 2, "the pinned row really splits the hidden work");
	assert.equal(bars[1].facts.actions, 2, "the loaded span keeps its own two");
	assert.equal(
		bars[0].facts.actions,
		98,
		"the cut span is the run's total MINUS its sibling's",
	);
	assert.equal(
		bars[0].facts.durationS,
		930,
		/*
		 * The run's worked 1000 seconds minus the SIBLING span's own 70 (t2's 30
		 * plus t3's 40). t1's own 20 seconds stay inside this bar's figure, because
		 * they are part of the span it hides - which is what makes the two bars add
		 * up to the turn rather than to the loaded rows.
		 */
		"and so is the worked time",
	);
	assert.equal(
		bars.reduce((sum, segment) => sum + segment.facts.actions, 0),
		run.facts.actions,
		"the bars sum to the turn's figure, which is the run's own minus the follow-up",
	);
	assert.equal(
		bars.reduce((sum, segment) => sum + (segment.facts.durationS ?? 0), 0),
		run.facts.durationS,
		"and so do the durations",
	);
	assert.equal(
		run.facts.actions,
		100,
		"no post-answer rows here, so the run's total IS the turn's",
	);
	assert.equal(run.facts.partial, false);
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

test("alignWalkRunKeyConfirmed: a run whose bar TOOK the facts retires the walk", () => {
	/*
	 * The walk is the pane's post-paint fetch, up to `ALIGN_WALK_MAX_PAGES`
	 * serial `/history` reads, and its whole purpose is to make the bar's figure
	 * whole. A fact makes it whole with no read at all, so the walk must stand
	 * down - for that run only, which is why the un-fact'd case below still
	 * yields the key.
	 */
	const rows = [
		tool("t1", { ts: TS, durationS: 20 }),
		tool("t2", { ts: TS + 1, durationS: 30 }, "trace"),
		answer("a1", { ts: TS + 5_000 }),
	];
	const plan = collapsePlan(rows, { live: false });
	assert.equal(
		alignWalkRunKeyConfirmed(plan, null),
		"a1",
		"without facts the walk is armed, exactly as before",
	);
	const withFacts = collapsePlan(rows, {
		live: false,
		runFacts: new Map([["a1", fact(423, 8_639)]]),
	});
	assert.equal(
		alignWalkRunKeyConfirmed(withFacts, null),
		null,
		"with them, no read is owed",
	);
	/*
	 * AND A FACT THE PLAN COULD NOT USE LEAVES IT ARMED (agent review round 1,
	 * F5): the gate reads the plan's own `factApplied`, never the presence of a
	 * map, so the two can never disagree about whether the bar is whole. The
	 * reader below hides cross-session rows and the wire states no split, which
	 * is the refusal the model makes rather than a count that includes rows the
	 * bar does not show.
	 */
	assert.equal(
		alignWalkRunKeyConfirmed(plan, null),
		"a1",
		"a plan that took no facts is not a reason to stand the walk down",
	);
	const refused = collapsePlan(rows, {
		live: false,
		hideCrossSession: true,
		runFacts: new Map([["a1", fact(423, 8_639)]]),
	});
	assert.equal(
		refused.runs[0].factApplied,
		false,
		"the fact is refused, so nothing was applied",
	);
	assert.equal(
		refused.runs[0].segments[0].facts.partial,
		true,
		"so the bar keeps the `+` the walk exists to complete",
	);
	assert.equal(
		alignWalkRunKeyConfirmed(refused, null),
		"a1",
		"and the walk stays armed to complete it",
	);
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

test("clarity 1: a `head_cut` page whose facts cover the run is the FINAL layout, and the fact answers to any of the three ids", () => {
	/*
	 * The S3 fixture's real shape, captured from the core at `105411ca3f`: the
	 * page is EXACTLY `limit` paintable rows - the run's head is hundreds of rows
	 * above and the cut's budget refused to pay for it, so `head_cut: true` - and
	 * `runs` states the 600-row run the page starts inside, in full.
	 *
	 * The contract's rule is that this page plus these facts ARE the final layout:
	 * draw the bar from `action_count` / `worked_seconds` and do NOT walk. The
	 * client's own key for the span it holds is the answer row the LOADED span
	 * elects, which is the wire's `closing_answer_id` only while that answer is on
	 * the page - hence the aliases: the fact is reachable under `run_key`, under
	 * `opening_user_id` (a row the page does not carry at all) and under
	 * `closing_answer_id`.
	 */
	const page = {
		entries: [
			{
				id: "t9",
				ts: 100,
				type: "message",
				payload: { kind: "message", role: "tool", tool_call_id: "c9" },
			},
			{
				id: "a9",
				ts: 101,
				type: "message",
				payload: { kind: "message", role: "assistant", stop_reason: "stop" },
			},
		],
		has_more: true,
		cursor_missing: false,
		runs_state: "ready",
		head_cut: true,
		runs: [
			{
				run_key: "a9",
				opening_user_id: "the-runs-own-opening-user-row",
				closing_answer_id: "a9",
				settled: true,
				action_count: 300,
				failed_count: 4,
				worked_seconds: 5793.695,
				complete: true,
			},
		],
	};
	const facts = openFrameFacts(page);
	assert.ok(facts, "a `ready` page carries facts whatever `head_cut` says");
	/*
	 * `head_cut` is NOT reported on the facts (agent review round 1, F8): the one
	 * reader that needs it reads the PAGE (`openFrameAttestedStart`), because the
	 * question it answers - did the turn-aligned extension run? - is about the
	 * page's own window, not about any run on it. A second copy here would be a
	 * claim nothing checks.
	 */
	assert.equal(
		"headCut" in facts,
		false,
		"the page's `head_cut` is not re-stated on the facts",
	);
	for (const id of ["a9", "the-runs-own-opening-user-row"]) {
		const matched = facts.runs.get(id);
		assert.ok(matched, `the fact is reachable by \`${id}\``);
		assert.equal(matched.actions, 300, "and it is the same fact");
		assert.equal(matched.failed, 4);
		assert.equal(matched.workedSeconds, 5793.695);
	}
	const rows = [
		tool("t9", { ts: 100, durationS: 5 }, "trace"),
		answer("a9", { ts: 101 }),
	];
	const plan = collapsePlan(rows, { live: false, runFacts: facts.runs });
	const run = plan.runs[0];
	assert.equal(
		run.segments[0].facts.actions,
		300,
		"the bar states the run's own count, not the one row the page carries",
	);
	assert.equal(run.segments[0].facts.durationS, 5793.695);
	assert.equal(run.facts.actions, 300, "the turn's own figure moves with it");
	assert.equal(
		alignWalkRunKeyConfirmed(plan, null),
		null,
		"the walk is retired: the page and the facts ARE the final layout",
	);
	const noFacts = collapsePlan(rows, { live: false });
	assert.equal(
		alignWalkRunKeyConfirmed(noFacts, null),
		"a9",
		"and without the facts it is armed, so this test discriminates",
	);
});

test("clarity 2: a page that begins at a STEER still states the run's whole figures", () => {
	/*
	 * A steer is an ordinary user row on the wire, and the client's own partition
	 * folds it into the run it interrupted (`walkTurns`). So a page whose oldest
	 * kept row IS the steer looks to this model exactly like a run that opens with
	 * its own user row - while the run's real head, and every row of work above
	 * the steer, are off-page. `opening_user_id` is how the model is told that the
	 * row it opens at is not the run's opener; `head_cut: false` on such a page is
	 * the contract's own warning that this case exists.
	 */
	const rows = [
		user("the-steer", { ts: TS }),
		tool("t1", { ts: TS + 1, durationS: 20 }),
		tool("t2", { ts: TS + 2, durationS: 30 }, "trace"),
		answer("a2", { ts: TS + 5_000 }),
	];
	const plain = planOf(rows).runs[0];
	assert.equal(
		plain.run.opensWithUserRow,
		true,
		"fixture: the client's own partition says this span opens a run",
	);
	assert.equal(
		plain.segments[0].facts.actions,
		2,
		"and without facts the fragment reads as the whole turn",
	);
	const withFacts = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			["a2", fact(423, 8_639, { openingUserId: "the-runs-real-head" })],
		]),
	}).runs[0];
	assert.equal(
		withFacts.segments[0].facts.actions,
		423,
		"with them the bar states the run's own count, the steer row included",
	);
	assert.equal(withFacts.segments[0].facts.durationS, 8_639);
	assert.equal(
		withFacts.facts.actions,
		423,
		"and the turn's own figure moves with it",
	);
	/*
	 * The discriminating direction: when the fact names the row the span DOES
	 * open at, the span IS the run and its own rows are already exact - the
	 * subtraction must reproduce them rather than double-count.
	 */
	const whole = collapsePlan(rows, {
		live: false,
		runFacts: new Map([
			["a2", fact(423, 8_639, { openingUserId: "the-steer" })],
		]),
	}).runs[0];
	assert.equal(
		whole.segments[0].facts.actions,
		2,
		"a run whose head is on hand keeps its loaded fold",
	);
	assert.deepEqual(
		whole.facts,
		plain.facts,
		"and the turn's figures are untouched",
	);
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

test("a fact is split by the hidden cross-session work, or refused (F2)", () => {
	const rows = [
		tool("t1", { ts: TS, durationS: 20 }),
		/* The `send` row itself is already GONE: the caller filters the plan's rows
		 * (`visibleRecords(records, hide)`), which is exactly why the client cannot
		 * do this subtraction itself - only the server counted the row it never
		 * sent. */
		tool("t2", { ts: TS + 1, durationS: 30 }),
		answer("a1", { ts: TS + 5_000 }),
	];
	/*
	 * Shown, the server's totals ARE the reader's: three rows measured, nothing
	 * hidden, nothing to subtract.
	 */
	const shown = collapsePlan(rows, {
		live: false,
		runFacts: new Map([["a1", fact(3, 55, { crossSessionActions: 1 })]]),
	}).runs[0];
	assert.equal(
		shown.segments[0].facts.actions,
		3,
		"with the setting off, the fact's own count stands",
	);
	/*
	 * Hidden, the same fact must lose the hidden row - and the bar states what is
	 * on screen, which is the invariant `hidden cross-session rows never reach the
	 * bar` pins for the loaded fold.
	 */
	const hidden = collapsePlan(rows, {
		live: false,
		hideCrossSession: true,
		runFacts: new Map([
			[
				"a1",
				fact(3, 55, { crossSessionActions: 1, crossSessionWorkedSeconds: 5 }),
			],
		]),
	}).runs[0];
	assert.equal(
		hidden.segments[0].facts.actions,
		2,
		"the visible span's count, not the server's three",
	);
	assert.equal(
		hidden.segments[0].facts.durationS,
		50,
		"and the visible worked time",
	);
	assert.equal(hidden.factApplied, true, "the fact was applied, split");
	/*
	 * NO SPLIT FROM THE WIRE IS A REFUSAL, not a zero: the count may include rows
	 * this reader never receives, so the loaded fold stands, the `+` stays, and
	 * the walk keeps something to complete.
	 */
	const unsplit = collapsePlan(rows, {
		live: false,
		hideCrossSession: true,
		runFacts: new Map([["a1", fact(3, 55)]]),
	}).runs[0];
	assert.equal(unsplit.factApplied, false, "no split, no fact");
	assert.equal(
		unsplit.segments[0].facts.actions,
		2,
		"the loaded rows' own count",
	);
	assert.equal(unsplit.segments[0].facts.partial, true, "with the `+` intact");
	/*
	 * AND A DURATION THAT CANNOT BE SPLIT IS DROPPED, count kept: the count's
	 * subtrahend is known (one hidden row), the seconds' is not. `hidden === 0`
	 * is the other half - nothing hidden means nothing to split, so the seconds
	 * stand.
	 */
	const halfSplit = collapsePlan(rows, {
		live: false,
		hideCrossSession: true,
		runFacts: new Map([["a1", fact(3, 55, { crossSessionActions: 1 })]]),
	}).runs[0];
	assert.equal(halfSplit.segments[0].facts.actions, 2, "the count splits");
	assert.equal(
		halfSplit.segments[0].facts.durationS,
		null,
		"and the duration refuses rather than including hidden work",
	);
	const noneHidden = collapsePlan(rows, {
		live: false,
		hideCrossSession: true,
		runFacts: new Map([["a1", fact(2, 50, { crossSessionActions: 0 })]]),
	}).runs[0];
	assert.equal(
		noneHidden.segments[0].facts.durationS,
		50,
		"nothing hidden means nothing to split, so the seconds stand",
	);
});

test("a re-keyed run keeps its fact, and the follow-up is added on top (F3)", () => {
	const rows = [
		tool("t1", { ts: TS, durationS: 10 }),
		tool("t2", { ts: TS + 1, durationS: 20 }),
		answer("a1", { ts: TS + 5_000 }),
		/* A wake and its follow-up work: no user row, so the run continues - and it
		 * now ENDS on a tool row, which is the case `electAnswer` refuses to call an
		 * answer (`transcript-rows.ts`), so the run's key moves from `a1` to `t4`. */
		row("w1", "wake", { text: "a wake delivery" }),
		tool("t3", { ts: TS + 6_000, durationS: 5 }),
		tool("t4", { ts: TS + 7_000, durationS: 5 }),
	];
	const facts = new Map([
		[
			"a1",
			fact(2, 30, { closingAnswerId: "a1", openingUserId: "the-run-head" }),
		],
	]);
	const plan = collapsePlan(rows, { live: false, runFacts: facts });
	const run = plan.runs[0];
	assert.equal(
		run.key,
		"t4",
		"the run re-keys to its newest row once it has no closing answer",
	);
	assert.equal(
		run.factApplied,
		true,
		"and the fact is still found, by the run's own rows rather than its key",
	);
	/*
	 * THE FIGURES: the fact's span (2 actions, 30s) PLUS the follow-up's own rows,
	 * which the client holds in full and the server's total does not cover - then
	 * minus every other bar's loaded work, exactly as before. The cut span here is
	 * the first bar, which hides `t1, t2`; the wake splits the run, so the
	 * follow-up's two calls sit in the second bar and are subtracted back out.
	 */
	assert.equal(
		run.segments[0].facts.actions,
		2,
		"the head-cut bar states the run's own pre-answer count",
	);
	assert.equal(
		run.facts.actions,
		4,
		"the turn's figure carries the follow-up: two in the fact's span, two after it",
	);
	assert.equal(
		run.facts.partial,
		false,
		"exact, because the fact and the rows together are the whole run",
	);
	/*
	 * A failed call after the answer is the run's, too (F9): the run-level figure
	 * counts the span its `actions` above count, so the two cannot disagree.
	 */
	const failedRows = [
		tool("t1", { ts: TS, durationS: 10 }),
		answer("a1", { ts: TS + 5_000 }),
		row("w1", "wake", { text: "a wake delivery" }),
		tool("t3", { ts: TS + 6_000, durationS: 5, isError: true }),
	];
	const failedPlan = collapsePlan(failedRows, {
		live: false,
		runFacts: new Map([
			["a1", fact(1, 10, { closingAnswerId: "a1", failed: 0 })],
		]),
	}).runs[0];
	assert.equal(
		failedPlan.facts.failed,
		1,
		"the follow-up's failure is inside the span the run-level count describes",
	);
	/*
	 * AND THE WALK IS RETIRED FOR THAT RE-KEYED RUN: the whole point of keeping the
	 * fact attached is that the bar is exact, so no read is owed - which is what
	 * the base did by WALKING (the walk it retired in this lane).
	 */
	assert.equal(
		alignWalkRunKeyConfirmed(plan, null),
		null,
		"the re-keyed run's bar is whole, so the walk stands down",
	);
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
