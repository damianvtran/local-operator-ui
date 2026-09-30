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

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
			'export { runsOf, closingAnswerIds, buildRows } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
			'export { applyEvent, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
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
	alignFetchDecision,
	collapsePlan,
	isFailedCall,
	runsOf,
	snapWindowToRunBoundary,
	staysVisibleWhileCollapsed,
	widenTarget,
	windowTopRunIsHeadCut,
	closingAnswerIds,
	buildRows,
	applyEvent,
	EMPTY_TRANSCRIPT,
	visibleRecords,
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

test("narration-only in-betweens collapse and say only how long they took", () => {
	// §5 case 3: prose between the user row and the answer hides; no action clause.
	const plan = planOf([
		user("u1"),
		row(
			"p1",
			"assistant",
			{ text: "Checking the ledger.", streaming: false },
			"turn",
		),
		answer("a1", { ts: TS + 4_000, settledAt: TS + 4_000 }),
	]);
	const run = plan.runs[0];
	assert.equal(run.collapses, true);
	assert.deepEqual(
		run.hidden.map((hidden) => hidden.record.id),
		["p1"],
	);
	assert.equal(run.facts.actions, 0);
	assert.equal(run.facts.title, null, "no actions, no hover sentence");
	assert.equal(run.facts.durationS, 4, "opening ts to the settled answer");
});

test("a steer stays inside the expansion and its rows count in the run's totals", () => {
	// §5 case 5, the one whose numbers move: the foot used to reset at the steer.
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
		["t1", "s1", "t2"],
		"the steer message itself is inside the collapse",
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
			openRuns: new Set(["a1"]),
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

test("Took is the wall span: opening user row to the latest end instant", () => {
	/*
	 * §4.4's composition, each source exercised: an assistant states when it
	 * SETTLED (the `settledAt` the reducer stamps; `ts` for a durable row,
	 * whose commit instant is its completion), a tool states when it ENDED
	 * (`endedAt`; `ts` when a durable row cannot date itself), everything else
	 * states its `ts`.
	 */
	const plan = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 1_100, endedAt: 3_500 }, "turn"),
		answer("a1", { ts: 2_000, settledAt: 4_500 }),
	]);
	assert.equal(
		plan.runs[0].facts.durationS,
		3.5,
		"the latest end is the answer's settled moment, not its stream start",
	);

	const toolLast = planOf([
		user("u1", { ts: 1_000 }),
		answer("a1", { ts: 2_000, settledAt: 2_500 }),
		tool("t2", { ts: 2_600, endedAt: 9_000 }, "item"),
	]);
	assert.equal(
		toolLast.runs[0].facts.durationS,
		8,
		"a tool ending last takes the end",
	);
});

test("a span under a second, or one the clocks contradict, states nothing", () => {
	const under = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 1_100, endedAt: 1_999 }, "turn"),
		answer("a1", { ts: 1_999, settledAt: 1_999 }),
	]);
	assert.equal(under.runs[0].facts.durationS, null, "999ms is not `1s`");

	const exact = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 1_100, endedAt: 2_000 }, "turn"),
		answer("a1", { ts: 2_000, settledAt: 2_000 }),
	]);
	assert.equal(exact.runs[0].facts.durationS, 1, "a full second is shown");

	const reversed = planOf([
		user("u1", { ts: 2_000 }),
		answer("a1", { ts: 1_000, settledAt: 1_000 }),
	]);
	assert.equal(
		reversed.runs[0].facts.durationS,
		null,
		"an earlier end is not a negative span",
	);
});

test("a durable run still dates itself: ts is the commit, and the span holds", () => {
	// The restored state (§5 case 13): no `settledAt` anywhere, and the number
	// must match the live one — that is the whole reason `settledAt` exists.
	const plan = planOf([
		user("u1", { ts: 1_000 }),
		tool("t1", { ts: 2_000 }, "turn"),
		answer("a1", { ts: 4_000 }),
	]);
	assert.equal(plan.runs[0].facts.durationS, 3);
});

/* ------------------- the alignment fetch's bound (F2) -------------------- */

test("the align fetch's decision is the whole bound, by construction", () => {
	/*
	 * AGENT REVIEW ROUND 1, F2: the window snap's load half. A page may be
	 * spent only while there is more to load, nothing is in flight, and the
	 * cut is real; and never past `max` — the property that keeps an open
	 * from walking an unbounded conversation into memory.
	 */
	const step = (spent, over = {}) =>
		alignFetchDecision(
			spent,
			over.hasMore ?? true,
			over.loadingOlder ?? false,
			over.headCut ?? true,
			over.max ?? 2,
		);
	assert.deepEqual(step(0), { fetch: true, spent: 1 });
	assert.deepEqual(step(1), { fetch: true, spent: 2 });
	assert.deepEqual(step(2), { fetch: false, spent: 2 }, "the bound holds");
	assert.deepEqual(
		step(0, { hasMore: false }),
		{ fetch: false, spent: 0 },
		"nothing to load",
	);
	assert.deepEqual(
		step(0, { loadingOlder: true }),
		{ fetch: false, spent: 0 },
		"a page is already in flight",
	);
	assert.deepEqual(
		step(0, { headCut: false }),
		{ fetch: false, spent: 0 },
		"no cut to fix",
	);
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
const paintedAt = (rows, size, { live = false, openRuns } = {}) => {
	const total = rows.length;
	const align = snapWindowToRunBoundary(rows, size, SNAP_MAX_EXTRA);
	const visible = total > align ? rows.slice(total - align) : rows;
	const plan = collapsePlan(visible, { live, openRuns });
	return (
		visible.length -
		plan.runs.reduce(
			(sum, run) =>
				sum +
				(run.collapses && !openRuns?.has(run.key) ? run.hidden.length : 0),
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

test("widenTarget: the operator's one long run lands on a size that paints MORE than the window it left", () => {
	/* 618 rows in ONE run (the measured shape): the collapse folds every raw
	 * step, so the only visible growth is the run's own head arriving. The
	 * bounded search must reach it rather than stop at window + step. */
	const rows = [
		user("u1", { ts: TS }),
		...Array.from({ length: 616 }, (_, index) =>
			tool(`t${index}`, { ts: TS + 1_000 + index }, "trace"),
		),
		answer("a1", { ts: TS + 900_000 }),
	];
	assert.equal(rows.length, 618);
	const before = paintedAt(rows, 60);
	const target = widenTarget(rows, 60, {
		step: 60,
		maxRows: 60 + 12 * 60,
		live: false,
		snapMaxExtra: SNAP_MAX_EXTRA,
	});
	assert.ok(target > 120, `it did not stop at a single step (got ${target})`);
	assert.ok(
		paintedAt(rows, target) > before,
		`painted rows grew: ${before} -> ${paintedAt(rows, target)} at window ${target}`,
	);
	assert.equal(target, 618, "and it is clamped to the transcript");
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
	};
	const allOpen = new Set(runsOf(rows).map((run) => run.key));
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
