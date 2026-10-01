/**
 * The turn-ending response and the segments around it (issue #665), asked of the
 * shipped module (`turn-segments.ts`) and of the operator's own journal shape.
 *
 * WHAT THIS PINS. Which row of a run is its ANSWER (the last RESPONSE cycle's
 * close, not the last message emitted), how the rest of the run's hidden rows
 * partition into ordered disjoint SEGMENTS around the rows that must stay on
 * screen, and what each segment is called. The plan/render halves are
 * `turn-collapse-model.test.mjs` and `turn-collapse-behaviour.test.mjs`.
 *
 * FIXTURES ARE A SEQUENCE OF KINDS, not hand-rolled objects, because the
 * classifier is structural: a fixture is a shape, and a shape is best read as one
 * line (`U T A W T A`). `seq()` mints the records with ids `<token><index>` so a
 * failure names the row it is about.
 *
 * THE INVARIANT CHECK IS ITSELF TESTED (`an empty plan is not a sound plan`).
 * A validator that an empty plan satisfies is worthless for a model whose failure
 * mode is "hid nothing", so the negative cases here prove `violationsOf` fails on
 * exactly the plans a broken partition would produce.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import {
	FakeJournal,
	Reader,
	kindOf,
	loadModules,
	operatorKinds,
	shape,
	tokenOf,
} from "./loader-journal-fixture.mjs";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/turn-segments";',
			'export { paintsSomething, isStatementRow, runsOf, closingAnswerIds, buildRows } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
			'export { collapsePlan, staysVisibleWhileCollapsed } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
			'export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
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
	applyHistoryPage,
	boundaryKindOf,
	buildRows,
	closingAnswerIds,
	collapsePlan,
	cyclesOf,
	EMPTY_TRANSCRIPT,
	isCompletionMarker,
	isStatementRow,
	labelOfSegment,
	partitionRun,
	paintsSomething,
	runsOf,
	segmentIsCompleted,
	staysVisibleWhileCollapsed,
	triggerOf,
	violationsOf,
} = await import(moduleUrl);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

/**
 * Tokens: U user, T tool, N narration (settled assistant text), A the same
 * (spelled differently so a fixture reads as "the answer is here"), S a STREAMING
 * assistant, E an assistant that paints nothing (tool calls only), W wake, P peer,
 * J job_result, H hub_message, X monitor_prompt, M terminal notice (Stopped with an
 * error), K closed receipt (complete notice, info), I session_incident, C
 * compaction, O an info notice (no completion), Q a quiet custom (mcp).
 */
const RECORDS = {
	U: (id, i) => ({ kind: "user", id, ts: TS + i, text: "hi" }),
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
	N: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: false,
	}),
	S: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: true,
	}),
	E: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "",
		streaming: false,
	}),
	W: (id, i) => ({ kind: "wake", id, ts: TS + i, text: "wake" }),
	P: (id, i) => ({
		kind: "peer",
		id,
		ts: TS + i,
		body: "peer",
		sender: {},
	}),
	J: (id, i) => custom(id, i, "job_result"),
	H: (id, i) => custom(id, i, "hub_message"),
	X: (id, i) => custom(id, i, "monitor_prompt"),
	Q: (id, i) => custom(id, i, "session_mcp_unavailable"),
	I: (id, i) => custom(id, i, "session_incident", "error"),
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
	O: (id, i) => ({ kind: "notice", id, ts: TS + i, text: "n", level: "info" }),
	C: (id, i) => ({ kind: "compaction", id, ts: TS + i, text: "Context" }),
};
RECORDS.A = RECORDS.N;

function custom(id, i, customType, level = "info") {
	return { kind: "custom", id, ts: TS + i, customType, level, text: "t" };
}

/** `seq("U T A")` -> records with ids `U0 T1 A2`. */
const seq = (spec) =>
	spec
		.trim()
		.split(/\s+/)
		.map((token, index) => RECORDS[token](`${token}${index}`, index));

const OPTS = { paints: paintsSomething, isStatement: isStatementRow };
const PINNED = staysVisibleWhileCollapsed;

/** Partition a run that OPENS with its user row (span starts at 1). */
const partition = (spec, from = 1) => {
	const records = seq(spec);
	const result = partitionRun(records, {
		...OPTS,
		from,
		pinned: PINNED,
	});
	return { records, result };
};

const hiddenIds = ({ records, result }) =>
	result.segments.map((span) =>
		records.slice(span.from, span.to + 1).map((r) => r.id),
	);

const answerId = ({ records, result }) =>
	result.answer === null ? null : records[result.answer.closeIndex].id;

/** The one assertion every fixture runs: the partition is sound. */
const sound = (p, from = 1) => {
	assert.deepEqual(
		violationsOf(p.records, p.result, { from, pinned: PINNED }),
		[],
		"the partition must satisfy every invariant",
	);
};

/* ---------------------------- the decision table ------------------------- */

test("single response: one cycle, nothing to hide", () => {
	const p = partition("U A");
	assert.equal(p.result.cycles.length, 1);
	assert.equal(p.result.cycles[0].class, "response");
	assert.equal(p.result.cycles[0].why, "user");
	assert.equal(answerId(p), "A1");
	assert.deepEqual(p.result.segments, [], "nothing to hide, so no bar");
	sound(p);
});

test("response-actions-response: the LAST response cycle is the answer, the first is one segment", () => {
	// A steer (`U` inside the run) starts a second user-driven response cycle, so
	// the later close wins and the first cycle is the one segment.
	const p = partition("U T A U T A");
	assert.equal(p.result.cycles.length, 2);
	assert.deepEqual(
		p.result.cycles.map((c) => [c.class, c.why]),
		[
			["response", "user"],
			["response", "user"],
		],
	);
	assert.equal(answerId(p), "A5");
	assert.deepEqual(hiddenIds(p), [["T1", "A2", "U3", "T4"]]);
	sound(p);
});

test("narration is not a close: text followed by a step belongs to the cycle it works in", () => {
	const p = partition("U N T N T A");
	assert.equal(p.result.cycles.length, 1, "three texts, one close");
	assert.equal(answerId(p), "A5");
	assert.deepEqual(hiddenIds(p), [["N1", "T2", "N3", "T4"]]);
	sound(p);
});

test("three-cycle: E is the last close and every earlier cycle hides in one span", () => {
	const p = partition("U A T A T A");
	assert.equal(answerId(p), "A5");
	assert.equal(p.result.segments.length, 1, "no visible row splits them");
	assert.deepEqual(hiddenIds(p), [["A1", "T2", "A3", "T4"]]);
	sound(p);
});

test("wake-minor-then-answer: a wake cycle with no terminal marker INHERITS the response class", () => {
	// user -> wake -> short close -> tools -> long close. Both are responses; the
	// later close is the answer, the first is hidden work.
	const p = partition("U W N T A");
	assert.deepEqual(
		p.result.cycles.map((c) => [c.class, c.why]),
		[
			["response", "user"],
			["response", "continuation"],
		].slice(0, p.result.cycles.length),
	);
	assert.equal(answerId(p), "A4");
	sound(p);
});

test("wake-only turn: a single cycle, no bar", () => {
	const p = partition("U A");
	assert.deepEqual(p.result.segments, []);
	assert.equal(answerId(p), "A1");
});

test("wake-after-answer WITHOUT a terminal marker is a continuation: the later close is the answer", () => {
	// The wake carried the answer: no marker says the turn was over.
	const p = partition("U T A W T A");
	assert.equal(p.result.cycles[1].class, "response");
	assert.equal(p.result.cycles[1].why, "continuation");
	assert.equal(answerId(p), "A5");
	sound(p);
});

test("wake-after-answer WITH a terminal marker is post-terminal commentary: the FIRST close stays the answer", () => {
	const p = partition("U T A M W T A");
	assert.deepEqual(
		p.result.cycles.map((c) => [c.class, c.why]),
		[
			["response", "user"],
			["commentary", "post-terminal"],
		],
	);
	assert.equal(answerId(p), "A2", "the answer is the one before the marker");
	// The marker stays where it happened; the follow-up is its own segment AFTER
	// the answer.
	assert.deepEqual(hiddenIds(p), [["T1"], ["W4", "T5", "A6"]]);
	sound(p);
});

test("an incident is a terminal marker too, and so is a neutral `closed` receipt", () => {
	for (const marker of ["I", "K", "M"]) {
		const p = partition(`U T A ${marker} P T A`);
		assert.equal(answerId(p), "A2", `${marker} ends the turn`);
		assert.equal(p.result.cycles[1].why, "post-terminal", marker);
	}
});

test("a peer note after a terminal marker is commentary; before one it continues the turn", () => {
	assert.equal(answerId(partition("U T A M P T A")), "A2");
	assert.equal(answerId(partition("U T A P T A")), "A5");
});

test("job_result / hub_message / monitor_prompt inherit even after a marker (the agent finishing what it owns)", () => {
	for (const trigger of ["J", "H", "X"]) {
		const p = partition(`U T A M ${trigger} T A`);
		assert.equal(p.result.cycles[1].class, "response", trigger);
		assert.equal(p.result.cycles[1].why, "continuation", trigger);
		assert.equal(answerId(p), "A6", trigger);
	}
});

test("a user row in a cycle always wins, even after a marker", () => {
	// A peer note that carried the reader's own request is not the reader's own
	// row; but a real USER row after the marker is a new request in the same run
	// (a steer that arrived while the run was still open).
	const p = partition("U T A M U T A");
	assert.equal(p.result.cycles[1].class, "response");
	assert.equal(p.result.cycles[1].why, "user");
	assert.equal(answerId(p), "A6");
});

test("head-cut: a run with no opening user row still elects an answer and states no duration", () => {
	const p = partition("T T A", 0);
	assert.equal(p.result.cycles[0].why, "head-cut");
	assert.equal(answerId(p), "A2");
	assert.deepEqual(hiddenIds(p), [["T0", "T1"]]);
	sound(p, 0);
});

/* ------------------------------ negative cases --------------------------- */

test("no closer: a run that ends on a tool row elects nothing and hides the work", () => {
	const p = partition("U T T");
	assert.equal(p.result.answer, null);
	assert.deepEqual(hiddenIds(p), [["T1", "T2"]]);
	sound(p);
});

test("a streaming tail elects nothing: the answer is still being written", () => {
	const p = partition("U T N T S");
	assert.equal(
		p.result.answer,
		null,
		"electing an earlier close would demote at the next token",
	);
	sound(p);
});

test("a commentary-only tail (a follow-up that DIED before it closed) keeps the earlier answer", () => {
	// U T A M W T   - the wake's work was cut by the disposal: no close, a marker
	// after the last close. The answer handed over before it is still the answer.
	const p = partition("U T A M W T");
	assert.equal(answerId(p), "A2");
	sound(p);
});

test("two closers with no work between: the later one wins (identical text is not deduplicated)", () => {
	const p = partition("U A A");
	assert.equal(p.result.cycles.length, 2);
	assert.equal(answerId(p), "A2");
	assert.deepEqual(hiddenIds(p), [["A1"]]);
	sound(p);
});

test("structural-only boundaries: a run of pinned rows has no segments and no answer", () => {
	const p = partition("U C M I");
	assert.equal(p.result.answer, null);
	assert.deepEqual(p.result.segments, []);
	sound(p);
});

test("incident-cut: work, an incident, no close -> no answer, the incident stays, the work hides", () => {
	const p = partition("U T T I");
	assert.equal(p.result.answer, null);
	assert.deepEqual(hiddenIds(p), [["T1", "T2"]]);
	assert.ok(p.result.visible.has(3), "the incident is pinned");
	sound(p);
});

test("error-cut: a marker between work and the close pins the marker and splits the span", () => {
	const p = partition("U T M T A");
	assert.equal(answerId(p), "A4");
	assert.deepEqual(hiddenIds(p), [["T1"], ["T3"]]);
	sound(p);
});

test("an assistant that paints nothing is never a close", () => {
	const p = partition("U T E");
	assert.equal(p.result.answer, null);
	assert.equal(p.result.cycles.length, 0);
});

/* --------------------------- segments and pinned rows -------------------- */

test("pinned-between-hidden: the compaction sits BETWEEN two segments, in order", () => {
	const p = partition("U T C T A");
	assert.deepEqual(hiddenIds(p), [["T1"], ["T3"]]);
	assert.deepEqual(
		[...p.result.visible].sort((a, b) => a - b),
		[2, 4],
		"the compaction and the answer stay",
	);
	sound(p);
});

test("peak-nested: three segments + an answer + a follow-up, ordered and disjoint", () => {
	const p = partition("U T M T I T A M W T A");
	assert.equal(answerId(p), "A6");
	const spans = p.result.segments;
	for (let i = 1; i < spans.length; i += 1) {
		assert.ok(spans[i].from > spans[i - 1].to + 0, "ordered and disjoint");
	}
	assert.deepEqual(hiddenIds(p)[0], ["T1"]);
	assert.deepEqual(hiddenIds(p)[1], ["T3"]);
	assert.deepEqual(hiddenIds(p)[2], ["T5"]);
	sound(p);
});

test("receipts-in-span: wake and peer receipts hide inside the segment; the pin list is unchanged", () => {
	const p = partition("U W P T A");
	assert.deepEqual(hiddenIds(p), [["W1", "P2", "T3"]]);
	assert.equal(staysVisibleWhileCollapsed(p.records[1]), false);
	assert.equal(staysVisibleWhileCollapsed(p.records[2]), false);
});

test("trailing statements after the last close stay visible (the shipped `[answer][notice]` rule)", () => {
	const p = partition("U T A O Q");
	assert.deepEqual(hiddenIds(p), [["T1"]]);
	assert.ok(p.result.visible.has(3) && p.result.visible.has(4));
	sound(p);
});

test("very long single message: no segment, no bar, the answer stays", () => {
	const p = partition("U A");
	assert.deepEqual(p.result.segments, []);
	assert.ok(p.result.visible.has(1));
});

/* ---------------------------------- labels ------------------------------- */

const labelsOf = (spec) => {
	const p = partition(spec);
	return p.result.segments.map((span) =>
		labelOfSegment(p.records, p.result.cycles, span),
	);
};

/** The completed flag exactly as the plan computes it (label decides the arm). */
const completedOf = (spec) => {
	const p = partition(spec);
	const at = p.result.answer?.closeIndex ?? null;
	return p.result.segments.map((span) =>
		segmentIsCompleted(
			p.records,
			p.result.cycles,
			span,
			at,
			labelOfSegment(p.records, p.result.cycles, span) !== null,
		),
	);
};

test("labels: one noun per trigger, whatever side of the answer it lands on (D2/D3)", () => {
	assert.deepEqual(labelsOf("U T A"), [null]);
	/*
	 * A follow-up the reader opened is NOT labelled: their own message is visible
	 * above the bar (only hidden spans get bars), so a word would restate it. A
	 * wake or a peer cycle after the answer says what opened it, in the same word
	 * it would carry before the answer.
	 */
	assert.deepEqual(labelsOf("U T A M W T A"), [null, "Wake"]);
	assert.deepEqual(labelsOf("U T A M P T A"), [null, "Peer message"]);
	assert.deepEqual(
		labelsOf("U T A M J T A"),
		[null, "Job result"],
		"a job result inherits, so it is the answer",
	);
	assert.deepEqual(labelsOf("U T A M H T A"), [null, "Peer message"]);
	assert.deepEqual(labelsOf("U T A M X T A"), [null, "Wake"]);
});

test("labels: a wake or peer cycle BEFORE the answer carries the same word", () => {
	// `W` opens the second cycle and inherits its class, so the segment spans both
	// cycles and is named by the LAST one it ends in - the wake.
	assert.deepEqual(labelsOf("U T A W T A"), ["Wake"]);
	assert.deepEqual(labelsOf("U T A P T A"), ["Peer message"]);
	assert.deepEqual(labelsOf("U T A J T A"), ["Job result"]);
	// A hidden cycle opened by a wake:
	const p = partition("U W T N P T A");
	assert.equal(
		p.result.segments.map((span) =>
			labelOfSegment(p.records, p.result.cycles, span),
		).length,
		1,
	);
});

test("labels: a follow-up that never closed is named by what opened it", () => {
	// `W T` after the answer, no close: the cycle is not in `cycles`, so the
	// opener is read from the triggers ahead of its first step.
	assert.deepEqual(labelsOf("U T A M W T"), [null, "Wake"]);
	assert.deepEqual(labelsOf("U T A M P T"), [null, "Peer message"]);
	assert.deepEqual(labelsOf("U T A M W T M"), [null, "Wake"]);
});

test("labels: the five old words are gone (Noted, Woken, Followed up, Peer note)", () => {
	const all = new Set(
		[
			"U T A M W T A",
			"U T A M P T A",
			"U T A W T A",
			"U T A P T A",
			"U T A M J T A",
			"U T A M X T A",
			"U T A M H T A",
			"U T A U T A",
		].flatMap((spec) => labelsOf(spec)),
	);
	for (const word of ["Noted", "Woken", "Followed up", "Peer note"]) {
		assert.equal(all.has(word), false, `${word} is retired`);
	}
});

test("a receipt in the middle of user-opened work does not name the bar", () => {
	// The old draft labelled this whole bar `Job result`: a receipt lying inside
	// the span is not what the cycle was opened by.
	assert.deepEqual(labelsOf("U T J T J T A"), [null]);
});

test("R1-2: a mid-turn steer hidden inside a span makes the bar SAY so", () => {
	/*
	 * `U T A U T A`: the second user row is a steer inside the run. The partition
	 * still hides it (pinning it would split every steered turn in two - the
	 * decision was to label, not to reshape), so the bar that holds it must name
	 * it or the reader's own message vanishes behind an unlabelled bar.
	 */
	const p = partition("U T A U T A");
	assert.deepEqual(
		p.result.segments.map((span) =>
			p.records.slice(span.from, span.to + 1).map((r) => r.id),
		),
		[["T1", "A2", "U3", "T4"]],
		"the steer is inside the span",
	);
	assert.deepEqual(labelsOf("U T A U T A"), ["Steered"]);
	// It outranks the trigger word: the steer is the one row in the span the
	// reader wrote.
	assert.deepEqual(labelsOf("U T A U T A M W T A"), ["Steered", "Wake"]);
	// No user row inside, no word.
	assert.deepEqual(labelsOf("U T T A"), [null]);
});

test("completed: a real closer, on a section of the turn, that was not cut off", () => {
	// A follow-up after the answer that settled: marked.
	assert.deepEqual(completedOf("U T A M W T A"), [false, true]);
	// The ordinary unlabelled bar directly under the answer: never (the answer
	// says it finished, and a constant mark carries nothing).
	assert.deepEqual(completedOf("U T A"), [false]);
	// D4 symmetry: a LABELLED bar before the answer is a section too.
	assert.deepEqual(completedOf("U T A W T A"), [true]);
	assert.deepEqual(completedOf("U T A P T A"), [true]);
});

test("completed: a bar the disposal cut off carries no false receipt (D4)", () => {
	/*
	 * The wake's work (`W T`) is followed by the stop marker: it ended in that
	 * state, not in success. Two bars (the work under the answer, then the wake's
	 * section), and the one the marker interrupted must not wear the green check
	 * the surrounding sections earn.
	 */
	assert.deepEqual(completedOf("U T A W T M"), [false, false]);
	assert.deepEqual(labelsOf("U T A W T M"), [null, "Wake"]);
	assert.deepEqual(completedOf("U T A M W T M"), [false, false]);
	const incident = seq("U T A M W T I");
	const incidentCycles = cyclesOf(incident, paintsSomething);
	assert.equal(
		segmentIsCompleted(incident, incidentCycles, { from: 4, to: 5 }, 2, true),
		false,
		"an incident right after the span is a terminal boundary too",
	);
});

test("R1-3: a span holding only a bare receipt is not completed", () => {
	/*
	 * The reviewer's repros: the wake / peer row alone between two pinned rows
	 * used to fall through to `return true`, so its bar read `Wake ✓` over
	 * nothing. Nothing in it finished.
	 */
	assert.deepEqual(completedOf("U T A M W C T A"), [false, false, true]);
	assert.deepEqual(completedOf("U T A M P C T A"), [false, false, true]);
	// The receipt-only span's own verdict, isolated.
	const p = partition("U T A M W C T A");
	const span = p.result.segments[1];
	assert.equal(p.records[span.from].kind, "wake");
	assert.equal(span.from, span.to, "the span is the wake row alone");
	assert.equal(
		segmentIsCompleted(p.records, p.result.cycles, span, 2, true),
		false,
	);
});

test("completed: a follow-up still being written is not over", () => {
	const streaming = seq("U T A M W T S");
	assert.equal(
		segmentIsCompleted(
			streaming,
			cyclesOf(streaming, paintsSomething),
			{ from: 4, to: 6 },
			2,
			true,
		),
		false,
	);
});

test("MINOR-2: a section that never closed wears no check, whatever its last row is", () => {
	/*
	 * The reviewer's repro: `U T A M W T` ends on a FINISHED TOOL CALL, so the
	 * last-row test alone said "settled" and the bar read `Wake ✓` over a section
	 * that only ever started. A cycle exists only around a close row, so a span
	 * ending outside every cycle never handed anything over.
	 */
	assert.deepEqual(completedOf("U T A M W T"), [false, false]);
	assert.deepEqual(completedOf("U T A M P T"), [false, false]);
	// And the negative control: the SAME shape with a closer still earns it, so
	// the rule is "did this section close", not "was there a tool at the end".
	assert.deepEqual(completedOf("U T A M W T A"), [false, true]);
	/*
	 * The positive control on the same axis: the same wake-and-work shape with a
	 * closer after it IS a closed section, so its bar keeps the check.
	 */
	assert.deepEqual(completedOf("U W T A"), [true]);
});

/* --------------------------- the invariant check ------------------------- */

test("an empty plan is not a sound plan: hiding nothing over a span with work fails", () => {
	const { records, result } = partition("U T T A");
	const empty = { ...result, segments: [] };
	const problems = violationsOf(records, empty, { from: 1, pinned: PINNED });
	assert.ok(
		problems.length >= 2,
		`the two tool rows are neither visible nor in a segment; got ${JSON.stringify(problems)}`,
	);
	assert.match(problems[0], /neither visible nor in a segment/);
});

test("the invariant check catches overlap, a hidden answer and a hidden pinned row", () => {
	const { records, result } = partition("U T C T A");
	const overlapping = {
		...result,
		segments: [
			{ from: 1, to: 1 },
			{ from: 1, to: 3 },
		],
	};
	const found = violationsOf(records, overlapping, {
		from: 1,
		pinned: PINNED,
	}).join("; ");
	assert.match(found, /in two segments|overlaps/);
	assert.match(found, /pinned/);

	const coversAnswer = { ...result, segments: [{ from: 1, to: 4 }] };
	assert.match(
		violationsOf(records, coversAnswer, { from: 1, pinned: PINNED }).join("; "),
		/answer row is hidden/,
	);
});

test("R1-1: the check catches a segment over the opening user row and a split contiguous span", () => {
	const { records, result } = partition("U T T A");
	// A segment that swallows the run's OPENING user row (index 0 < from).
	const overOpener = { ...result, segments: [{ from: 0, to: 2 }] };
	assert.match(
		violationsOf(records, overOpener, { from: 1, pinned: PINNED }).join("; "),
		/above the span's first row/,
	);
	// One contiguous hidden run reported as two adjacent bars.
	const split = {
		...result,
		segments: [
			{ from: 1, to: 1 },
			{ from: 2, to: 2 },
		],
	};
	assert.match(
		violationsOf(records, split, { from: 1, pinned: PINNED }).join("; "),
		/not maximal/,
	);
	// And the honest plan for the same rows is clean (the two rules are not a
	// blanket refusal).
	assert.deepEqual(
		violationsOf(records, result, { from: 1, pinned: PINNED }),
		[],
	);
});

test("every fixture is sound AND non-vacuous: literal hidden-row counts, not derived ones", () => {
	/*
	 * The expectation is WRITTEN DOWN per shape, never computed from the result: a
	 * count derived from `result.visible` agrees with any partition, including one
	 * that hid nothing, which is the failure the invariant check exists for.
	 * [spec, rows hidden, segments].
	 */
	const table = [
		["U T A", 1, 1],
		["U T C T A", 2, 2],
		// T1 | (answer A2, marker M3 stay) | W4 T5 A6 - the follow-up is its own span.
		["U T A M W T A", 4, 2],
		["U N T N T A", 4, 1],
		["U T M T A", 2, 2],
		["U T T", 2, 1],
		["U A", 0, 0],
		["U T A O", 1, 1],
	];
	for (const [spec, rows, segments] of table) {
		const p = partition(spec);
		sound(p);
		const hidden = p.result.segments.reduce(
			(n, span) => n + (span.to - span.from + 1),
			0,
		);
		assert.equal(hidden, rows, `${spec}: rows hidden`);
		assert.equal(p.result.segments.length, segments, `${spec}: segments`);
	}
});

test("the boundary vocabulary is one function: pin list and terminal test cannot disagree", () => {
	for (const spec of "C M K I O Q T N W P".split(" ")) {
		const record = RECORDS[spec]("x", 0);
		assert.equal(
			staysVisibleWhileCollapsed(record),
			boundaryKindOf(record) !== null,
			spec,
		);
	}
	assert.equal(boundaryKindOf(RECORDS.C("c", 0)), "compaction");
	assert.equal(boundaryKindOf(RECORDS.K("k", 0)), "terminal", "closed receipt");
	assert.equal(
		boundaryKindOf(RECORDS.O("o", 0)),
		null,
		"an info notice is not a boundary",
	);
	assert.equal(triggerOf(RECORDS.J("j", 0)), "job_result");
	assert.equal(triggerOf(RECORDS.Q("q", 0)), null);
});

/* ----------------------- the operator's journal, for real ---------------- */

/**
 * The journal behind the operator's screenshot: 1233 entries of the committed
 * kind sequence, minted with the disposal marker painted, applied through the
 * REAL reducer and read through the real row/plan pipeline. Nothing is stubbed:
 * what is asserted is what the app computes for that conversation.
 */
function operatorPlan() {
	const journal = FakeJournal.operator();
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		{ entries: journal.entries, has_more: false, cursor_missing: false },
		{ replace: true },
	);
	const rows = buildRows(state.records, []);
	const plan = collapsePlan(rows, { live: false });
	const indexOfId = new Map(journal.entries.map((e, i) => [e.id, i]));
	return { journal, state, rows, plan, indexOfId };
}

test("the operator's journal: the elector picks row 1196 and classifies the reply at 1229 as post-terminal commentary", () => {
	const { journal, plan, indexOfId, state } = operatorPlan();
	assert.equal(plan.runs.length, 1, "one user row, one run");
	const run = plan.runs[0];
	assert.equal(
		indexOfId.get(run.answerId),
		1196,
		`the answer is row 1196 (the last settled assistant is ${indexOfId.get(state.records.findLast((r) => r.kind === "assistant").id)})`,
	);
	assert.equal(kindOf(journal.entries[1196]), "assistant");

	// Every assistant row that is a close AFTER the marker is commentary. Count them
	// through the classifier itself (records of the run, cycles by class).
	const records = state.records;
	const cycles = cyclesOf(records, paintsSomething);
	const commentary = cycles.filter((c) => c.class === "commentary");
	assert.ok(commentary.length >= 1, "the follow-up cycle is classified out");
	assert.equal(
		indexOfId.get(records[commentary.at(-1).closeIndex].id),
		1229,
		"and the last commentary row is 1229",
	);
	assert.equal(commentary.at(-1).why, "post-terminal");
});

test("the operator's journal: the bar's totals belong to the turn, and the follow-up has its own bar", () => {
	const { plan, journal, indexOfId } = operatorPlan();
	const run = plan.runs[0];
	const toolsThroughAnswer = journal.entries
		.slice(0, 1196)
		.filter((e) => kindOf(e) === "tool").length;
	const toolsAfter = journal.entries
		.slice(1197)
		.filter((e) => kindOf(e) === "tool").length;
	assert.equal(
		run.facts.actions,
		toolsThroughAnswer,
		"415: the turn's own actions",
	);
	assert.equal(toolsAfter, 8, "and 8 more belong to the follow-up");
	const follow = run.segments.filter((s) => s.afterAnswer);
	assert.equal(follow.length, 1);
	assert.equal(follow[0].facts.actions, toolsAfter);
	assert.equal(follow[0].label, "Peer message");
	assert.equal(
		follow[0].completed,
		true,
		"settled after the disposal: the receipt",
	);
	assert.ok(
		indexOfId.get(follow[0].firstId) > 1196,
		"the follow-up bar stands after the answer",
	);
	assert.equal(
		run.segments
			.filter((s) => !s.afterAnswer)
			.reduce((n, s) => n + s.facts.actions, 0),
		toolsThroughAnswer,
		"the pre-answer bars partition the turn's actions",
	);
});

test("the operator's journal: every visible row keeps its chronological order", () => {
	const { plan, rows, indexOfId } = operatorPlan();
	const run = plan.runs[0];
	const at = new Map(rows.map((row, i) => [row.record.id, i]));
	const bars = run.segments.map((s) => at.get(s.firstId));
	const pinned = rows
		.map((row, i) => [row, i])
		.filter(([row]) => row.record.kind === "compaction")
		.map(([, i]) => i);
	assert.equal(pinned.length, 2, "the two compactions at 664 and 964");
	assert.deepEqual(
		pinned.map((i) => indexOfId.get(rows[i].record.id)),
		[664, 964],
	);
	// A bar takes the slot of ITS OWN first hidden row, so the bars and the
	// compactions interleave exactly as the journal does: bar, compaction, bar,
	// compaction, bar.
	assert.ok(
		bars[0] < pinned[0] &&
			pinned[0] < bars[1] &&
			bars[1] < pinned[1] &&
			pinned[1] < bars[2],
		`bars ${bars.join(",")} straddle the compactions ${pinned.join(",")} in order`,
	);
	assert.ok(
		bars[2] < at.get(run.answerId),
		"and the last pre-answer bar is above the answer",
	);
	assert.ok(bars[3] > at.get(run.answerId), "the follow-up bar is below it");
});

test("the operator's journal: every segment survives the invariant check on the real records", () => {
	const { state } = operatorPlan();
	const records = state.records;
	const result = partitionRun(records, {
		...OPTS,
		from: 1,
		pinned: PINNED,
	});
	assert.deepEqual(
		violationsOf(records, result, { from: 1, pinned: PINNED }),
		[],
	);
	assert.ok(
		result.segments.length >= 4,
		`expected the compactions to split the span; got ${result.segments.length}`,
	);
});

test("the fixture's tokenOf reads the REAL durable shape: a text part with no `type`", () => {
	// The committed shape tokenises `assistant:0:1` at 1196 only if the inverse
	// accepts a part the backend writes as `{ text }` (the rig's journal), as well
	// as the fixture's own `{ type: "text", text }`.
	const minted = FakeJournal.operator().entries[1196];
	assert.equal(tokenOf(minted), shape.kinds[1196]);
	const durable = structuredClone(minted);
	durable.payload.content = [{ text: "hello" }];
	assert.equal(tokenOf(durable), "assistant:0:1");
	durable.payload.content = [{ type: "image", data: "x" }];
	assert.equal(tokenOf(durable), "assistant:0:0", "an image is not text");
	assert.equal(operatorKinds()[1200], "custom:completion_attention:error");
});

test("closingAnswerIds and the run key agree with the elector (one authority)", () => {
	const { state, plan, rows } = operatorPlan();
	assert.deepEqual(
		[...closingAnswerIds(state.records)],
		[plan.runs[0].answerId],
	);
	assert.equal(runsOf(rows)[0].closingAnswerId, plan.runs[0].answerId);
	assert.equal(runsOf(rows)[0].key, plan.runs[0].answerId);
	const closing = rows.filter((r) => r.closesTurn).map((r) => r.record.id);
	assert.deepEqual(
		closing,
		[plan.runs[0].answerId],
		"the caption sits on the answer",
	);
});

/* --------- segment keys across a page landing, and the plan's facts -------- */

test("segment keys are STABLE while pages land above the run's head", async () => {
	/*
	 * The reader's expansion is remembered by the segment key, and a page landing
	 * only ever adds rows ABOVE the loaded head. The key set the reader could have
	 * pressed at the tail page must still be a subset of the set after every older
	 * page: no key may change identity, or an opened bar would snap shut the
	 * moment its neighbour above it loaded. Walked over the operator's journal, one
	 * page at a time, all the way to the start.
	 */
	const { reducer } = await loadModules();
	const journal = FakeJournal.operator();
	const reader = new Reader(reducer, journal).open();
	const keysNow = () => {
		const rows = buildRows(reader.transcript.records, []);
		const plan = collapsePlan(rows, { live: false });
		return new Set(
			plan.runs.flatMap((run) => run.segments.map((seg) => seg.key)),
		);
	};
	let seen = keysNow();
	assert.ok(seen.size > 0, "the tail page already condenses (end-loaded rule)");
	let pages = 0;
	while (reader.transcript.hasMore && pages < 20) {
		pages += 1;
		await reader.loadOlder();
		const next = keysNow();
		// A key may DISAPPEAR only by being MERGED into a longer span when the head
		// arrives; it must never be renamed. The invariant that matters to the
		// reader is that the run's own key (the answer's) survives every page.
		assert.ok(
			next.has("entry-001196"),
			`page ${pages}: the run's own key (the answer) must survive`,
		);
		for (const key of seen) {
			const suffix = key.includes("#") ? key.split("#")[1] : null;
			if (suffix === null) continue;
			assert.ok(
				next.has(key),
				`page ${pages}: segment key ${key} was renamed or lost when older rows landed`,
			);
		}
		seen = new Set([...seen, ...next]);
	}
	assert.equal(reader.transcript.hasMore, false, "walked to the start");
});

test("a head-cut run's cut span keeps the same key once the head lands", () => {
	// One journal, loaded twice: without its head (the rows a first page holds) and
	// whole. The rows are the SAME records, because that is what a page landing is.
	const whole = seq("U T T T C T A");
	const cut = whole.slice(1); // the opening user row has not landed yet
	const keyed = (records) =>
		collapsePlan(buildRows(records, []), { live: false }).runs[0].segments.map(
			(s) => s.key,
		);
	const before = keyed(cut);
	const after = keyed(whole);
	assert.equal(
		before.length,
		2,
		"T T | C | T: the compaction splits the loaded span",
	);
	assert.deepEqual(before, after, "the same two keys, in the same order");
	assert.equal(
		before.at(-1),
		"A6",
		"the span nearest the answer keeps the run's own key",
	);
	assert.equal(
		before[0],
		"A6#T3",
		"an earlier span is keyed by its LAST row, which cannot change",
	);
});

test("the turn's totals stop at the answer; a post-terminal reply's actions are the follow-up bar's own", () => {
	const rows = seq("U T T A M I P T T T A").map((record) => ({
		record,
		gap: "item",
		closesTurn: false,
	}));
	const run = collapsePlan(rows, { live: false }).runs[0];
	assert.equal(run.answerId, "A3");
	assert.equal(
		run.facts.actions,
		2,
		"the turn: the two calls before the answer",
	);
	const follow = run.segments.find((s) => s.afterAnswer);
	assert.equal(follow.facts.actions, 3, "the follow-up's three are its own");
	assert.equal(
		run.stampTs,
		rows[3].record.ts,
		"the stamp is the ANSWER's instant",
	);
});

test("focus hold is per segment: only the span holding the focused row stays open", () => {
	const rows = seq("U T C T A").map((record) => ({
		record,
		gap: "item",
		closesTurn: false,
	}));
	const held = collapsePlan(rows, { live: false, focusHold: "T3" }).runs[0];
	assert.deepEqual(
		held.segments.map((s) => s.collapsed),
		[true, false],
		"the span holding T3 draws in place; the other still condenses",
	);
	const open = collapsePlan(rows, {
		live: false,
		focusHold: "T3",
		openRuns: new Set(["A4"]),
	}).runs[0];
	assert.deepEqual(
		open.segments.map((s) => s.collapsed),
		[true, true],
	);
});

test("a live run never collapses any segment", () => {
	const rows = seq("U T C T A").map((record) => ({
		record,
		gap: "item",
		closesTurn: false,
	}));
	const run = collapsePlan(rows, { live: true }).runs[0];
	assert.equal(run.collapses, false);
	assert.ok(run.segments.every((s) => s.collapsed === false));
});

test("one definition of a completion marker: the partition, the pin list and the classifier agree", () => {
	const marker = RECORDS.M("m", 0);
	const closed = RECORDS.K("k", 0);
	const plain = RECORDS.O("o", 0);
	const incident = RECORDS.I("i", 0);
	assert.equal(isCompletionMarker(marker), true);
	assert.equal(
		isCompletionMarker(closed),
		true,
		"the neutral receipt is a marker too",
	);
	assert.equal(isCompletionMarker(plain), false);
	assert.equal(
		isCompletionMarker(incident),
		false,
		"an incident is terminal but not a completion notice",
	);
	// The run partition closes a run at a marker exactly when this says so.
	const closesRun = (record) =>
		runsOf(
			[RECORDS.U("u", 0), record, RECORDS.U("u2", 2)].map((r) => ({
				record: r,
				gap: "item",
				closesTurn: false,
			})),
		).length === 2;
	assert.equal(closesRun(marker), true);
	assert.equal(closesRun(closed), true);
	assert.equal(closesRun(plain), false);
});
