/**
 * The run partition's CLOSURE TEST, and the reader's own first message (case 3
 * of the completion-visibility design: "my initial message ended up condensed,
 * which is unexpected").
 *
 * WHAT THIS PINS, and why at the pure-model level. `walkTurns`
 * (`transcript-rows.ts`) is the ONE place that decides where a run of rows ends,
 * and every consumer of a turn - the caption, the foot line, the collapse plan,
 * the `TurnRun.key` a bar is remembered by - is keyed by that decision. So the
 * fixtures here are record lists in, partition/plan out: no DOM, no React, no
 * clock. A shape is written as a sequence of kinds (`I U T T A`), the same
 * vocabulary `turn-segments.test.mjs` uses, and every id is `<token><index>` so a
 * failure names the row it is about.
 *
 * THE DEFECT. The closure test used to be `sawMarker || settledTail()`, where
 * `sawMarker` was set by `isCompletionMarker` - a NARROW LOCAL COPY of the
 * boundary vocabulary (`notice && complete === true` only). The vocabulary the
 * rest of the transcript reads is `isTerminalMarker`/`boundaryKindOf`
 * (`turn-segments.ts`), which also calls an error-level `custom` a terminal
 * marker. And a fresh conversation OPENS with a harness prefix row
 * (`system_prefix`, `selected_model`, `session_mcp_unavailable`) that paints but
 * is not a `user` row, so the prefix opened the run with `openingUserIndex: null`
 * and the reader's own first message - arriving while `closed()` was false - was
 * absorbed as a STEER: hidden inside the very first bar and labelled "Steered".
 *
 * WHICH CLAUSE EACH SHAPE PINS, stated as measured rather than as intended
 * (agent review round 1, R2 - the earlier version of this paragraph claimed the
 * two prefix shapes covered both clauses, and the round showed they do not):
 *
 * - shape (b) `Q U T T A` (`Q` = `session_mcp_unavailable`, level `info`) pins
 *   `nothingHasRunYet` on its own. The prefix is NOT a boundary at all
 *   (`boundaryKindOf` is null for an info custom), so no vocabulary change can fix
 *   it: a run that has done no WORK of its own (no tool row, no assistant row) is
 *   not a turn in flight, so a following user message OPENS its own run instead of
 *   steering into it. A steer is a message to an agent that is working; an empty
 *   preamble is not working;
 * - shape (a) `I U T T A` (`I` = `session_incident`, level `error`) pins the
 *   VOCABULARY arm only in combination with the one below - on its own it is
 *   head-cut AND empty, so `nothingHasRunYet` closes it before the vocabulary
 *   clause is asked (measured: reverting the vocabulary arm alone left this suite
 *   9/9 green, which is the hole R2 named);
 * - shape (c) `U T I U T A`, pinned in its own section below, is the shape that
 *   isolates the vocabulary arm: a turn that has already painted work, killed by an
 *   error-level `session_incident`, then retried. `nothingHasRunYet` cannot reach
 *   it (`sawWork` is true), so the narrow local copy leaves ONE run and hides the
 *   reader's retry behind a "Steered" bar. Reverting the arm is what proves that
 *   rather than asserting it - it is the one mutation in this file the suite can
 *   see.
 *
 * THE INVARIANT, for every shape here: the reader's own message is never inside a
 * hidden span. That is NOT a claim that no user row is ever hidden, and the class
 * is stated rather than narrowed (agent review round 1, R4): a run that has
 * painted work and was not closed by an answer or a terminal marker still hides
 * the user row inside it. Measured on this head, three shapes do:
 *
 *   `U T U T A` (a genuine mid-work steer)      hides the SECOND message
 *   `U U`       (two messages, no work between) hides the SECOND message - the
 *                                                turn is in flight either way
 *   `T U T A`   (a HEAD-CUT run that had already painted) hides the reader's
 *                                                message, the shape the round
 *                                                found beside the one this PR
 *                                                disclosed
 *
 * Making those rows visible is the sibling completion-visibility change (V3 in the
 * design note, PR #737), not this predicate fix, so this file pins today's
 * behaviour there instead of claiming a wider invariant. A future reader adding a
 * shape above must know which side of that line it is on: the helper below asserts
 * the strict invariant, so a shape that legitimately hides a user row belongs in
 * its own case with the reason spelled out, not in `FRESH_SHAPES`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/turn-segments";',
			'export { paintsSomething, isStatementRow, runsOf, closingAnswerIds, buildRows } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
			'export { collapsePlan, staysVisibleWhileCollapsed } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
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
	buildRows,
	collapsePlan,
	partitionRun,
	paintsSomething,
	runsOf,
	isStatementRow,
	staysVisibleWhileCollapsed,
	violationsOf,
} = await import(moduleUrl);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

/**
 * Tokens: U user, T tool, A a settled answer, I the operator's error-level
 * `session_incident`, Q the harness's `session_mcp_unavailable` (info level -
 * the row in the operator's screenshot), M a completion notice, K a `closed`
 * receipt.
 */
const RECORDS = {
	U: (id, i) => ({
		kind: "user",
		id,
		ts: TS + i,
		text: "Why are there so many actions in this bar?",
	}),
	T: (id, i) => ({
		kind: "tool",
		id,
		ts: TS + i,
		toolName: "bash",
		isError: false,
		stopped: false,
		neverSent: false,
		notRunReason: null,
		endedAt: null,
		phase: "done",
	}),
	A: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "Because the harness retried the call.",
		streaming: false,
	}),
	I: (id, i) => custom(id, i, "session_incident", "error"),
	// The screenshot's exact row: a harness custom the reducer levels at `info`
	// (`transcript-reducer.ts` `customRow`), so it is NOT a boundary.
	Q: (id, i) => custom(id, i, "session_mcp_unavailable", "info"),
	M: (id, i) => ({
		kind: "notice",
		id,
		ts: TS + i,
		text: "Stopped with an error",
		level: "error",
		complete: true,
	}),
	K: (id, i) => ({
		kind: "notice",
		id,
		ts: TS + i,
		text: "Completed",
		level: "info",
		complete: true,
	}),
};

function custom(id, i, customType, level = "info") {
	return { kind: "custom", id, ts: TS + i, customType, level, text: "t" };
}

/** `seq("I U T T A")` -> records with ids `I0 U1 T2 T3 A4`. */
const seq = (spec) =>
	spec
		.trim()
		.split(/\s+/)
		.map((token, index) => RECORDS[token](`${token}${index}`, index));

const rowsOf = (spec) => buildRows(seq(spec), []);

/** The index of the reader's own row, given to the run partition. */
const userRowIndex = (rows) =>
	rows.findIndex((row) => row.record.kind === "user");

/** The partition of the row list, as the reader's own message sees it. */
const partitionOf = (spec) => {
	const rows = rowsOf(spec);
	const runs = runsOf(rows);
	const plan = collapsePlan(rows, { live: false });
	return { rows, runs, plan };
};

/**
 * The one invariant every fresh-conversation shape runs: no user row is inside a
 * hidden span, and no bar is labelled for a steer that never happened.
 */
function assertUserRowsStayVisible({ rows, plan }, shape) {
	const hiddenIds = new Set(
		plan.runs.flatMap((run) => run.hidden.map((row) => row.record.id)),
	);
	for (const row of rows) {
		if (row.record.kind !== "user") continue;
		assert.ok(
			!hiddenIds.has(row.record.id),
			`${shape}: the reader's own row ${row.record.id} must not be hidden`,
		);
	}
	for (const run of plan.runs) {
		for (const segment of run.segments) {
			assert.ok(
				!segment.rows.some((row) => row.record.kind === "user"),
				`${shape}: a hidden span must never contain a user row`,
			);
			/*
			 * A fresh shape's bars are UNNAMED, and that is the bound the label
			 * vocabulary actually lives at: `labelOfSegment` (`turn-segments.ts`) names
			 * a span that holds one of the reader's own rows, or one a trigger opened,
			 * and these shapes have neither. Stated as "no label" rather than "not the
			 * word Steered" - the literal is a copy test that stops checking anything
			 * the day the word is reworded (review round 1, R7), while the structural
			 * claim beside it is the invariant either way.
			 */
			assert.equal(
				segment.label,
				null,
				`${shape}: a bar over ${segment.segmentIds.join(",")} must not be named`,
			);
		}
	}
}

/* --------------------- the two fresh-conversation shapes ---------------- */

const FRESH_SHAPES = [
	["(a) error-level session_incident prefix", "I U T T A"],
	["(b) info-level session_mcp_unavailable prefix", "Q U T T A"],
];

for (const [name, shape] of FRESH_SHAPES) {
	test(`the reader's first message opens its own run: ${name}`, () => {
		const { rows, runs } = partitionOf(shape);
		const at = userRowIndex(rows);
		assert.ok(at >= 0, `${shape}: the fixture must contain a user row`);
		assert.equal(
			rows[at].record.kind,
			"user",
			"the row the assertion names is the reader's own",
		);

		const opened = runs.find((run) => run.openingIndex === at);
		assert.ok(
			opened,
			`${shape}: the user row at ${at} must open a run of its own, but runsOf gave ${JSON.stringify(
				runs.map((run) => ({
					openingIndex: run.openingIndex,
					opensWithUserRow: run.opensWithUserRow,
					endIndex: run.endIndex,
				})),
			)}`,
		);
		assert.equal(
			opened.opensWithUserRow,
			true,
			`${shape}: the run the reader's message opens is anchored on that row`,
		);
		assert.ok(
			rows[opened.openingIndex].record.kind === "user" &&
				rows[opened.openingIndex].record.id === rows[at].record.id,
			`${shape}: openingIndex names the reader's own row`,
		);
	});

	test(`no bar is named and no user row is hidden: ${name}`, () => {
		const partition = partitionOf(shape);
		assertUserRowsStayVisible(partition, shape);
	});
}

/* ------------------- the vocabulary arm's own shape --------------------- */

test("a killed turn's retry opens its own run (the vocabulary arm)", () => {
	/*
	 * `U T I U T A`: a turn that has already painted work, killed by an error-level
	 * `session_incident`, then retried by the reader - the operator's defect one
	 * turn later, in its more damaging form.
	 *
	 * WHY THIS SHAPE EXISTS (agent review round 1, R2). The two prefix shapes above
	 * are head-cut AND empty, so `nothingHasRunYet` closes them before the
	 * vocabulary clause is asked; with the vocabulary arm reverted to the old
	 * `notice && complete === true` copy this suite stayed 9/9 green. Here the run
	 * has painted, so the empty-preamble clause cannot fire, and `I2` being a
	 * terminal marker is the ONLY thing that closes the killed turn. The mutation is
	 * captured on the PR beside this test's green run: without the arm the retry is
	 * absorbed as a steer, one run, and the reader's own row is hidden inside a
	 * "Steered" bar.
	 */
	const { rows, runs, plan } = partitionOf("U T I U T A");
	const users = rows.filter((row) => row.record.kind === "user");
	assert.equal(users.length, 2, "the fixture holds the reader's two messages");
	const retry = users[1].record.id;
	assert.equal(retry, "U3", "the retry is the row every id below names");
	const retryAt = rows.findIndex((row) => row.record.id === retry);
	assert.ok(retryAt >= 0, "the retry row is in the list");
	const retryRun = runs.find((run) => run.openingIndex === retryAt);
	assert.ok(
		retryRun,
		`the retry must open its own run, but runsOf gave ${JSON.stringify(
			runs.map((run) => ({
				openingIndex: run.openingIndex,
				opensWithUserRow: run.opensWithUserRow,
				endIndex: run.endIndex,
			})),
		)}`,
	);
	assert.equal(retryRun.opensWithUserRow, true);
	assert.equal(runs.length, 2, "the incident is the only thing that closed it");
	assert.equal(
		runs[0].boundary,
		"marker",
		"the killed turn closed on the marker, not on an answer",
	);
	assertUserRowsStayVisible({ rows, plan }, "U T I U T A");
});

/* ------------------------------ invariant ------------------------------- */

test("the segment partition hides no user row, and satisfies every invariant", () => {
	/*
	 * The collapse reads `partitionRun`'s spans, so the invariant is stated there
	 * too, over the ROWS OF EACH RUN the plan produced. Before the fix the whole
	 * list was ONE head-cut run whose span covered the reader's own message.
	 */
	const { rows, plan } = partitionOf("Q U T T A");
	assert.ok(
		plan.runs.length >= 2,
		"the prefix and the reader's turn are two runs",
	);
	for (const run of plan.runs) {
		const runRows = rows.slice(run.run.openingIndex, run.run.endIndex + 1);
		const from = run.run.opensWithUserRow ? 1 : 0;
		const result = partitionRun(
			runRows.map((row) => row.record),
			{
				from,
				paints: paintsSomething,
				isStatement: isStatementRow,
				pinned: staysVisibleWhileCollapsed,
			},
		);
		assert.deepEqual(
			violationsOf(
				runRows.map((row) => row.record),
				result,
				{
					from,
					pinned: staysVisibleWhileCollapsed,
				},
			),
			[],
			`the partition of the run at ${run.run.openingIndex} must satisfy every invariant`,
		);
		for (const span of result.segments) {
			assert.ok(
				!runRows
					.slice(span.from, span.to + 1)
					.some((row) => row.record.kind === "user"),
				`the run at ${run.run.openingIndex} hides its reader's own row`,
			);
		}
	}
});

/* ---------------------------- migration note ---------------------------- */

test("a stale openRuns key is inert: the bar simply renders collapsed", () => {
	/*
	 * A moved run boundary changes `TurnRun.key` (the closing answer's id) and so
	 * the segment keys derived from it, which means an expansion the reader made
	 * before the fix names a key that no longer exists. The renderer reads
	 * `openRuns.has(segment.key)`, so a stale key matches nothing and the bar is
	 * drawn collapsed - it must not throw and must not force anything open.
	 *
	 * WHY THIS FIXTURE CARRIES A FOCUS HOLD (agent review round 1, R3). `planRun`
	 * consults `openRuns` ONLY inside the `focusHold` branch, so at the default
	 * `focusHold: null` the set is dead code and the equality below held for the
	 * real key, for a bogus key and for no set alike - a tautology wearing a
	 * migration test's name, which is what the round measured. The hold is what
	 * makes the argument live, and the three readings then separate:
	 *
	 *   no set       -> the span the hold points into does NOT collapse: the plan
	 *                   declines to hide the row the keyboard focus is in
	 *   a STALE set  -> identical to no set - the key names no bar, so it neither
	 *                   holds anything open nor protects anything
	 *   the REAL key -> the span DOES collapse: the reader holds that bar open, so
	 *                   its rows are already on screen and the hold protects nothing
	 *
	 * The last one is the CONTROL, and without it "a stale key changes nothing"
	 * would be true of an argument nobody reads.
	 */
	const rows = rowsOf("Q U T T A");
	const userAt = userRowIndex(rows);
	const hold = "T2";
	const staleOpen = new Set(["entry-that-no-longer-exists", "U1#T3"]);
	const collapsedOf = (plan) =>
		plan.runs.flatMap((run) =>
			run.segments.map((seg) => [seg.key, seg.collapsed]),
		);
	const fresh = collapsePlan(rows, { live: false, focusHold: hold });
	const stale = collapsePlan(rows, {
		live: false,
		focusHold: hold,
		openRuns: staleOpen,
	});
	assert.deepEqual(
		collapsedOf(stale),
		collapsedOf(fresh),
		"a key that matches no bar changes nothing",
	);
	/*
	 * The renderer's own expression, over the same set - `open={openRuns.has(
	 * entry.segment.key)}` in `canonical-transcript.tsx` - so the claim is stated
	 * where the migration concern actually lives rather than only through the plan.
	 */
	const keys = fresh.runs.flatMap((run) => run.segments.map((seg) => seg.key));
	assert.ok(keys.length > 0, "the fixture plans at least one bar");
	for (const key of keys) {
		assert.equal(
			staleOpen.has(key),
			false,
			`the stale set must not name the bar ${key}`,
		);
	}
	const heldKey = fresh.runs
		.flatMap((run) => run.segments)
		.find((seg) => seg.segmentIds.includes(hold)).key;
	assert.notDeepEqual(
		collapsedOf(
			collapsePlan(rows, {
				live: false,
				focusHold: hold,
				openRuns: new Set([heldKey]),
			}),
		),
		collapsedOf(fresh),
		"the control: the real key DOES change the plan, so the equality above is not vacuous",
	);
	/*
	 * And the default reading - no hold, no expansions - is the one a stale key has
	 * to leave alone: the reader's own run renders collapsed, bar and all.
	 */
	const plain = collapsePlan(rows, { live: false });
	const plainRun = plain.runs.find(
		(candidate) => candidate.run.openingIndex === userAt,
	);
	assert.ok(plainRun, "the reader's run is planned");
	assert.ok(
		plainRun.segments.every((segment) => segment.collapsed),
		"and with no expansion of its own, every bar of it renders collapsed",
	);
});

test("a genuine mid-work steer keeps today's behaviour (no widening)", () => {
	/*
	 * `U T U T A`: the second message arrives while the run is working, so it IS a
	 * steer and the run stays one run. This is the compatibility case for the
	 * predicate change - widening the closure test must not turn a steer into a new
	 * run. Its row is hidden behind a labelled bar, which is the shipped shape (the
	 * word is `labelOfSegment`'s, and it is deliberately not asserted as a literal
	 * here); V3 in the sibling design note - PR #737's user-row visibility change -
	 * is what makes that row visible, and it is NOT folded into this predicate fix.
	 */
	const { rows, runs, plan } = partitionOf("U T U T A");
	assert.equal(runs.length, 1, "a steer mid-work does not open a second run");
	assert.equal(
		runs[0].opensWithUserRow,
		true,
		"and the run still opens at the reader's first message",
	);
	const steer = rows.filter((row) => row.record.kind === "user")[1].record.id;
	const segments = plan.runs.flatMap((run) => run.segments);
	assert.ok(
		segments.some((segment) => segment.segmentIds.includes(steer)),
		"the steer row is inside a planned span",
	);
	/*
	 * THE CONTRACT IS THAT THE BAR IS NAMED, not the word it is named with (review
	 * round 1, R7). The copy is `labelOfSegment`'s (`turn-segments.ts` names a span
	 * holding one of the reader's own rows), so an assertion on the literal would
	 * stop checking anything the day it is reworded; what must hold is that a span
	 * which hides the reader's OWN message cannot do it silently.
	 */
	for (const segment of segments) {
		if (!segment.rows.some((row) => row.record.kind === "user")) continue;
		assert.notEqual(
			segment.label,
			null,
			`the span over ${segment.segmentIds.join(",")} hides one of the reader's own rows and must be named`,
		);
	}
});

test("an answered run still closes on its answer (no regression)", () => {
	// The compatibility case for the NOTHING-HAS-RUN-YET clause: `sawWork` is true
	// once a tool row is in, so a user row after work-and-an-answer still opens its
	// own run by the ordinary closure, not by the new clause.
	const { runs } = partitionOf("U T A U T A");
	assert.equal(runs.length, 2, "two turns");
	assert.equal(runs[1].opensWithUserRow, true);
	assert.equal(runs[0].boundary, "answer");
});

test("a completion marker still closes a run (the vocabulary clause keeps its old case)", () => {
	// `M` is the error-level completion notice and `K` the info-level closed
	// receipt: both carry `complete === true`, so the OLD narrow predicate matched
	// them too. They stay here as the proof that widening to `isTerminalMarker`
	// added the error-level `custom` rather than swapping one vocabulary for
	// another.
	for (const notice of ["M", "K"]) {
		const { runs } = partitionOf(`U T ${notice} U T A`);
		assert.equal(runs.length, 2, `the ${notice} notice closes the first turn`);
		assert.equal(runs[1].opensWithUserRow, true);
	}
});
