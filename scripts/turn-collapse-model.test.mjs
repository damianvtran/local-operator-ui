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
		"u1",
		"the run is keyed by its opening user row",
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
		["u1", "u2"],
		"a settled answer makes the next user message a new turn",
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
		["u1", "u2"],
		"a completion marker ends the turn even with no answer painted",
	);
	assert.equal(marked[0].boundary, "marker");
});

test("a run whose head the window cut off says so, and keys on its first row", () => {
	const cut = runsOf([tool("t1"), tool("t2", {}, "trace"), answer("a1")]);
	assert.equal(cut.length, 1);
	assert.equal(cut[0].opensWithUserRow, false);
	assert.equal(cut[0].key, "t1", "the fallback key is the first row's id");
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
		["u1"],
		"the following message is a steer, however unideal that is (R2)",
	);
});

test("a window-cut run never collapses, whatever it hides", () => {
	// §5 case 12: a summary may only ever describe rows that are on hand.
	const plan = planOf([tool("t1"), tool("t2", {}, "trace"), answer("a1")]);
	assert.equal(plan.runs[0].collapses, false);
	assert.equal(
		plan.runs[0].hidden.length,
		2,
		"the plan still says what it would hide; the flag is what refuses",
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
	assert.equal(runs[0].key, "u1");
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
		["u1", "u2"],
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
