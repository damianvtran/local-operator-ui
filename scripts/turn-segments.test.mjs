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

/*
 * The storage shim the store needs to load in node at all: zustand's `persist`
 * writes through `localStorage` on every `setState`, which node lacks (the same
 * shim `chat-sidebar-view.test.mjs` carries). It is also the instrument for the
 * display-mode persistence case below - the store writes into it, and a fresh
 * parse reads it the way a launch does.
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/turn-segments";',
			'export * from "./src/renderer/src/features/chat/transcript-display-mode";',
			'export { paintsSomething, isStatementRow, runsOf, closingAnswerIds, buildRows } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
			'export { collapsePlan, staysVisibleWhileCollapsed } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
			'export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
			/*
			 * The store joins the bundle for the DISPLAY-MODE PERSISTENCE case, for the
			 * reason `chat-sidebar-view.test.mjs` gives: "this setting survives a
			 * relaunch" is a claim about the store's own round trip, not about the
			 * transcript's markup.
			 */
			'export { useUiPreferencesStore, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
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
	parseTranscriptDisplayMode,
	partitionRun,
	paintsSomething,
	persistedUiPreferences,
	reportsCompletedThought,
	runsOf,
	segmentIsCompleted,
	staysVisibleWhileCollapsed,
	triggerOf,
	useUiPreferencesStore,
	violationsOf,
} = await import(moduleUrl);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

/**
 * Tokens: U user, T tool, N narration (settled assistant text, NO `stopReason`),
 * A a settled assistant the provider DECLARED finished (`stopReason: "stop"`),
 * L the lead-in shape (settled text carried with its own `tool_calls`, so
 * `stopReason: "toolUse"`), S a STREAMING assistant, E an assistant that paints
 * nothing (tool calls only), W wake, P peer, J job_result, H hub_message,
 * X monitor_prompt, M terminal notice (Stopped with an error), K closed receipt
 * (complete notice, info), I session_incident, C compaction, O an info notice (no
 * completion), Q a quiet custom (mcp).
 *
 * `A` AND `L` CARRY THE PROVIDER'S PHASE DECLARATION, because the V4 rule reads it
 * (design note §1 and §2.2): `stop_reason: "stop"` is the model saying it had
 * FINISHED, and the durable reducer keeps exactly that field on a text-bearing row
 * (`transcript-reducer.ts:2264`). `N` deliberately carries no `stopReason` at all,
 * so the compat rule (an unknown phase is treated as absent) is asserted rather
 * than assumed.
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
	A: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: false,
		stopReason: "stop",
	}),
	L: (id, i) => ({
		kind: "assistant",
		id,
		ts: TS + i,
		text: "text",
		streaming: false,
		stopReason: "toolUse",
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

/** The visible rows of a partition, in row order, by id. */
const visibleIds = ({ records, result }) =>
	[...result.visible].sort((a, b) => a - b).map((index) => records[index].id);

/** `repeat("T", 88)` -> "T T T ...": the operator's 90-action span, as a spec. */
const repeat = (token, count) =>
	Array.from({ length: count }, () => token).join(" ");

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

test("response-actions-response: the LAST response cycle is the answer, and BOTH of its closes stay visible", () => {
	// A steer (`U` inside the run) starts a second user-driven response cycle, so
	// the later close wins the answer - and the first cycle's close is visible in
	// its own right (V1), with the steer row between them (V3).
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
	assert.deepEqual(visibleIds(p), ["A2", "U3", "A5"]);
	assert.deepEqual(hiddenIds(p), [["T1"], ["T4"]]);
	sound(p);
});

test("narration is not a close: text followed by a step belongs to the cycle it works in", () => {
	const p = partition("U N T N T A");
	assert.equal(p.result.cycles.length, 1, "three texts, one close");
	assert.equal(answerId(p), "A5");
	assert.deepEqual(hiddenIds(p), [["N1", "T2", "N3", "T4"]]);
	sound(p);
});

test("three-cycle: the last close is the answer and every close of a RESPONSE cycle stays visible", () => {
	const p = partition("U A T A T A");
	assert.equal(answerId(p), "A5");
	assert.equal(
		p.result.segments.length,
		2,
		"each step span is its own bar, with the closes between them visible",
	);
	assert.deepEqual(hiddenIds(p), [["T2"], ["T4"]]);
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
	// the answer - and the commentary close at A6 is the run's LAST close, so it
	// stays visible too (V2: the reader is owed the last word).
	assert.deepEqual(hiddenIds(p), [["T1"], ["W4", "T5"]]);
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
	assert.deepEqual(
		hiddenIds(p),
		[],
		"both closes are responses, so neither is hidden: no bar, no work",
	);
	assert.deepEqual(visibleIds(p), ["A1", "A2"]);
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

test("labels: a cycle before the answer carries the same word as one after it", () => {
	// `W` opens the second cycle and inherits its class, so the span it opens is
	// named by the LAST initiator of the cycle it ends in - the wake. The earlier
	// close is visible (V1), so the run now has a bar on either side of it.
	assert.deepEqual(labelsOf("U T A W T A"), [null, "Wake"]);
	assert.deepEqual(labelsOf("U T A P T A"), [null, "Peer message"]);
	assert.deepEqual(labelsOf("U T A J T A"), [null, "Job result"]);
	// One hidden span per earlier cycle, each named by what opened it.
	assert.deepEqual(
		labelsOf("U W T N P T A"),
		["Wake", "Peer message"],
		"a wake-opened span and a peer-opened span",
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

test("R1-2: a mid-turn steer is never inside a span, so no bar has to say `Steered` (V3)", () => {
	/*
	 * `U T A U T A`: the second user row is a steer inside the run - the run did
	 * not close, so it is not a new run. The arm this test used to pin (the
	 * partition hides the steer and `labelOfSegment` says `Steered` to admit it)
	 * was the answer to "the reader's own message must not vanish behind an
	 * unlabelled bar"; V3 supersedes it by keeping the message itself, and the
	 * word stays in `labelOfSegment` as the backstop for any span that DOES hold a
	 * user row (asserted below, on a hand-made span).
	 */
	const p = partition("U T A U T A");
	assert.deepEqual(
		p.result.segments.map((span) =>
			p.records.slice(span.from, span.to + 1).map((r) => r.id),
		),
		[["T1"], ["T4"]],
		"the steer is between the two bars, not inside one",
	);
	assert.deepEqual(labelsOf("U T A U T A"), [null, null]);
	assert.deepEqual(labelsOf("U T A U T A M W T A"), [null, null, "Wake"]);
	// No user row inside, no word.
	assert.deepEqual(labelsOf("U T T A"), [null]);
	// The backstop itself: a span a caller hands in that DOES hold a user row is
	// still named, so the promise survives a span this module did not build.
	assert.equal(
		labelOfSegment(p.records, p.result.cycles, { from: 1, to: 3 }),
		"Steered",
	);
});

test("completed: a real closer, on a section of the turn, that was not cut off", () => {
	// A follow-up after the answer that settled: marked.
	assert.deepEqual(completedOf("U T A M W T A"), [false, true]);
	// The ordinary unlabelled bar directly under the answer: never (the answer
	// says it finished, and a constant mark carries nothing).
	assert.deepEqual(completedOf("U T A"), [false]);
	// D4 symmetry: a LABELLED bar before the answer is a section too. The earlier
	// close is visible now (V1), so the turn has a bar on either side of it.
	assert.deepEqual(completedOf("U T A W T A"), [false, true]);
	assert.deepEqual(completedOf("U T A P T A"), [false, true]);
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
		// T1 | (answer A2, marker M3 stay) | W4 T5 | A6 - the last close is visible
		// (V2), so the follow-up's receipt span ends above it.
		["U T A M W T A", 3, 2],
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

/* ------- the never-folded rows: a declared finish, and the reader's own ------ */

/**
 * PR-2 of the completion-visibility lane (design note §0 case 1, §0 case 3, §1,
 * §2.2, §5, §9.1). The invariant, in row-list terms:
 *
 *   A settled, text-bearing assistant row stays VISIBLE unless it is a lead-in to
 *   the call that follows it, and a `user` row is never hidden by a collapsed span.
 *
 * The clauses `partitionRun` now carries beyond the shipped answer/pinned/trailing
 * set: V1 the close of a RESPONSE cycle, V2 the run's LAST close, V3 a `user` row,
 * V4 a settled row whose own provider declaration is `stopReason === "stop"`.
 *
 * V4 IS A PHASE DECLARATION, NOT A LENGTH HEURISTIC. The model said it had
 * finished; the harness then continued past it (the todo guardrail re-enters the
 * loop after a no-tool-call yield), so the row sits above the next call and the old
 * rule folded the substantive report into the bar. `null`/`undefined` keeps the
 * shipped behaviour exactly, which is what makes the change opt-in on positive
 * evidence.
 */
test("F1: a row the provider DECLARED finished stays visible even as a lead-in (V4)", () => {
	// U T A T T T A: A2 is narration (a step follows it), so it is not a close;
	// only its own `stop` declaration keeps the substantive report on screen.
	const p = partition("U T A T T T A");
	assert.equal(p.result.cycles.length, 1, "one close: a step follows A2");
	assert.deepEqual(visibleIds(p), ["A2", "A6"], "the stop row and the answer");
	assert.deepEqual(
		hiddenIds(p),
		[["T1"], ["T3", "T4", "T5"]],
		"the tool spans either side of it are the only hidden rows",
	);
	assert.equal(answerId(p), "A6");
	sound(p);
});

test("F1b: an earlier response close survives a job result (V1), and there is still ONE elected answer", () => {
	// The brief's case 1: user -> work -> answer A -> job result -> answer B.
	const p = partition("U T T A J T A");
	assert.deepEqual(
		p.result.cycles.map((c) => [c.class, c.why]),
		[
			["response", "user"],
			["response", "continuation"],
		],
	);
	assert.deepEqual(visibleIds(p), ["A3", "A6"], "both closes stay");
	assert.deepEqual(hiddenIds(p), [
		["T1", "T2"],
		["J4", "T5"],
	]);
	assert.equal(
		answerId(p),
		"A6",
		"the LAST response cycle is still the answer",
	);
	assert.deepEqual(
		[...closingAnswerIds(p.records)],
		["A6"],
		"one foot and one stamp: `closesTurn` is unchanged, so only B carries them",
	);
	sound(p);
});

test("F1c: the wake shape - a fulsome close before a wake is never folded", () => {
	// The operator's screenshot shape, with the wake directly after the fulsome
	// close: the wake inherits the response class, so BOTH closes are responses and
	// the fulsome one is visible by V1 as well as by V2.
	const p = partition("U T T T A W T A");
	assert.deepEqual(
		p.result.cycles.map((c) => [c.class, c.why]),
		[
			["response", "user"],
			["response", "continuation"],
		],
	);
	assert.equal(answerId(p), "A7", "the short close is the answer, as shipped");
	assert.deepEqual(
		visibleIds(p),
		["A4", "A7"],
		"the fulsome completion must NOT be folded",
	);
	assert.deepEqual(hiddenIds(p), [
		["T1", "T2", "T3"],
		["W5", "T6"],
	]);
	sound(p);
});

test("F2: the operator's 9:50 PM row list - the fulsome close above its own bar, the stamp still on the last close", () => {
	// The journal's own shape (§8): a long turn, a fulsome close, THREE more calls,
	// then the short close. The fulsome row is a lead-in (tools follow it), so only
	// V4 keeps it out of the bar - which is the operator's primary complaint.
	const p = partition("U T T T A T T T A K");
	assert.equal(
		p.result.cycles.length,
		1,
		"A4 is narration: three steps follow it",
	);
	assert.deepEqual(visibleIds(p), ["A4", "A8", "K9"]);
	assert.deepEqual(
		hiddenIds(p),
		[
			["T1", "T2", "T3"],
			["T5", "T6", "T7"],
		],
		"two bars, and the completion between them is no longer swallowed",
	);
	assert.equal(answerId(p), "A8", "the short close is the answer, as shipped");
	assert.deepEqual(
		[...closingAnswerIds(p.records)],
		["A8"],
		"two bars, one stamp: the foot and the stamp stay on the last close",
	);
	sound(p);

	// The same tail from the REAL row list: 88 calls before the fulsome close.
	const long = partition(`U ${repeat("T", 88)} A T T T A K`);
	assert.equal(answerId(long), "A93");
	assert.ok(
		long.result.visible.has(89),
		"the fulsome close at row 89 stays visible above its own bar",
	);
	assert.equal(long.result.segments.length, 2, "T1-T88 | T90-T92");
	sound(long);
});

test("F4: an absent `stopReason` keeps today's behaviour exactly (the compat rule)", () => {
	// `N` carries no phase field at all, and `L` carries the lead-in phase: both
	// hide exactly as they did before this rule existed.
	const p = partition("U T N T A");
	assert.equal(p.result.cycles.length, 1);
	assert.deepEqual(visibleIds(p), ["A4"]);
	assert.deepEqual(hiddenIds(p), [["T1", "N2", "T3"]]);
	sound(p);
	const leadIn = partition("U T L T A");
	assert.deepEqual(
		visibleIds(leadIn),
		["A4"],
		"`toolUse` is the lead-in shape",
	);
	sound(leadIn);
	// Explicit null and undefined are the same absent field.
	for (const value of [null, undefined]) {
		const records = seq("U T L T A");
		records[2] = { ...records[2], stopReason: value };
		const result = partitionRun(records, { ...OPTS, from: 1, pinned: PINNED });
		assert.equal(result.visible.has(2), false, `stopReason: ${String(value)}`);
	}
});

test("F5: no declared-finished row and no reader row ever leaves the visible set as rows arrive", () => {
	/*
	 * Monotonicity, asserted over every prefix of each fixture: the two clauses that
	 * protect a row are index-local, so a row that is visible at one prefix cannot
	 * disappear when the next row lands. The only class that may leave `visible` is a
	 * non-final COMMENTARY close (`cyclesOf` reclassifies it when a later close
	 * arrives), which is the shipped intent, so the guard covers V3 and V4 rows.
	 */
	const specs = [
		"U T A T T T A",
		"U T T A J T A",
		"U T T T A T T T A K",
		"U T T T A W T A",
		"U T T U T A",
	];
	for (const spec of specs) {
		const records = seq(spec);
		for (let n = 1; n <= records.length; n += 1) {
			const slice = records.slice(0, n);
			const result = partitionRun(slice, { ...OPTS, from: 1, pinned: PINNED });
			slice.forEach((record, index) => {
				if (index < 1) return;
				const mustStay =
					record.kind === "user" || reportsCompletedThought(record);
				if (!mustStay) return;
				assert.ok(
					result.visible.has(index),
					`${spec} @${index}: a reader row or a declared-finished row left the visible set`,
				);
			});
		}
	}
});

test("F3c: a genuine mid-work steer stays in place, and `Steered` becomes a backstop", () => {
	// U T T U T A: the second user row is a steer inside the run (nothing that
	// ended, so it is not a new run). V3 keeps the one row the reader wrote out of
	// the hidden span entirely - so the bar under it needs no word.
	const p = partition("U T T U T A");
	assert.deepEqual(
		visibleIds(p),
		["U3", "A5"],
		"the reader's own message stays",
	);
	assert.deepEqual(
		hiddenIds(p),
		[["T1", "T2"], ["T4"]],
		"the steer splits the span: one extra bar, which is the accepted cost",
	);
	assert.equal(
		labelOfSegment(p.records, p.result.cycles, p.result.segments[0]),
		null,
		"a bar under a visible message names itself",
	);
	sound(p);
	// The backstop is now unreachable in practice: no bar over a steer can exist.
	const words = ["U T A U T A", "U T T U T A", "U T A U T A M W T A"].flatMap(
		(spec) => labelsOf(spec),
	);
	assert.equal(
		words.includes("Steered"),
		false,
		"V3 keeps every user row out of every bar",
	);
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
		// A key is its span's own anchor row, so a page landing above the head can
		// neither rename nor lose it.
		for (const key of seen) {
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
	assert.deepEqual(
		before,
		["seg:C4", "seg:A6"],
		"every span is keyed by the VISIBLE row that ends it, which cannot change",
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
		openRuns: new Set(["seg:A4"]),
	}).runs[0];
	assert.deepEqual(
		open.segments.map((s) => s.collapsed),
		[true, true],
	);
});

test("a live run with nothing settled never collapses any segment", () => {
	// Liveness is the in-flight cycle's (PR-4): this run has no settled close yet.
	const rows = seq("U T C T S").map((record) => ({
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

/* ------- liveness is the in-flight CYCLE's, not the whole run's (PR-4) ------- */

/*
 * THE OPERATOR'S JITTER REPORT (2026-10-01): "messages are condensed, and then if
 * a peer message or job completes and the agent goes into thinking, the last
 * condensed sequence suddenly UN-CONDENSES". A wake / peer / job result does not
 * open a run (only a `user` row does), so the event RE-OPENS the run that had just
 * settled, which is now the newest run; the pane's `live` used to be spent on the
 * whole newest run, so a bar the reader had just read vanished while the agent
 * thought and came back when it stopped. `live` now covers only the rows of the
 * cycle still being written.
 */
const planFor = (spec, live, options = {}) =>
	collapsePlan(buildRows(seq(spec), []), { live, ...options }).runs;
const barsOfRun = (run) =>
	run.segments.map((segment) => [
		segment.rows.map((r) => r.record.id).join(","),
		segment.collapsed,
	]);

test("PR-4 F2: the settled sequence stays condensed when a wake starts the next cycle (the operator's shape)", () => {
	// `U T88 A1(stop) W T3 A2(stop) K`, stepped through the states the pane shows.
	const states = [
		[
			"the wake receipt just landed, the agent is thinking",
			`U ${repeat("T", 88)} A W`,
			1,
		],
		["the reply is streaming", `U ${repeat("T", 88)} A W S`, 2],
		["the reply's tool calls are running", `U ${repeat("T", 88)} A W T T T`, 2],
	];
	for (const [name, spec, count] of states) {
		const [run] = planFor(spec, true);
		const first = run.segments[0];
		assert.equal(
			first.collapsed,
			true,
			`${name}: the sequence the reader had condensed stays condensed`,
		);
		assert.equal(first.rows.length, 88, `${name}: it is the 88-action bar`);
		assert.equal(run.segments.length, count, `${name}: span count`);
		// A lone receipt after the answer is a trailing statement: it stays visible
		// and there is no in-flight span yet. Otherwise the tail span is the cycle.
		const tail = count === 2 ? run.segments[1] : null;
		if (tail !== null) {
			assert.equal(
				tail.collapsed,
				false,
				`${name}: only the in-flight cycle draws in place`,
			);
			assert.ok(
				!tail.rows.some((r) => first.segmentIds.includes(r.record.id)),
				`${name}: the two are disjoint spans`,
			);
		}
	}
});

test("PR-4 F2: nothing above the in-flight cycle changes between the wake landing and the cycle settling", () => {
	const head = `U ${repeat("T", 88)} A`;
	const steps = [
		planFor(`${head} W`, true)[0],
		planFor(`${head} W S`, true)[0],
		planFor(`${head} W T T T`, true)[0],
		planFor(`${head} W T T T A`, true)[0],
		planFor(`${head} W T T T A K`, false)[0],
	];
	const aboveOf = (run) => {
		const first = run.segments[0];
		return [first.key, first.collapsed, first.segmentIds.length];
	};
	const baseline = aboveOf(steps[0]);
	for (const [i, run] of steps.entries()) {
		assert.deepEqual(
			aboveOf(run),
			baseline,
			`step ${i}: the first bar is the same bar`,
		);
	}
	// The settle adds exactly one bar, at the tail, and it condenses once the cycle's close exists.
	assert.equal(
		steps[2].segments.length,
		2,
		"the wake cycle is one in-flight span",
	);
	assert.equal(steps[2].segments[1].collapsed, false);
	assert.equal(steps[3].segments.length, 2);
	assert.equal(
		steps[3].segments[1].collapsed,
		true,
		"its close exists: the cycle has settled",
	);
	assert.equal(steps[4].segments[1].collapsed, true);
});

test("PR-4 F2: segment keys do not change when a cycle settles", () => {
	const head = `U ${repeat("T", 4)} A`;
	const keysOf = (spec, live) =>
		planFor(spec, live)[0].segments.map((s) => s.key);
	const streaming = keysOf(`${head} W T T`, true);
	const settled = keysOf(`${head} W T T A`, true);
	const done = keysOf(`${head} W T T A K`, false);
	assert.equal(streaming[0], settled[0]);
	assert.equal(
		settled[0],
		done[0],
		"the first bar's key is the same in every state",
	);
	assert.equal(
		settled[1],
		done[1],
		"and the settled tail bar keeps its key when the turn ends",
	);
});

test("PR-4 control: `U T A U2` - the next message opens its own run, the settled one condenses as it always did", () => {
	const runs = planFor("U T A U T", true);
	assert.equal(runs.length, 2);
	assert.equal(runs[0].collapses, true, "the earlier turn condenses");
	assert.equal(
		runs[1].collapses,
		false,
		"the run being written draws in place",
	);
});

test("PR-4: a first turn with no settled close is live as a whole (shipped behaviour)", () => {
	const run = planFor("U T N T T S", true)[0];
	assert.equal(run.collapses, false);
	assert.ok(run.segments.every((s) => s.collapsed === false));
});

test("PR-4: a lead-in that has not yet been followed by its call is not a settle (stopReason toolUse)", () => {
	/*
	 * The frame that carries text AND tool calls settles its prose a moment before
	 * its tool row paints, and for that moment the lead-in is the last row, which
	 * `cyclesOf` reads as a close. Condensing at that instant and expanding the
	 * moment the call arrived would be the very flip this change removes, so a
	 * close the provider declared `toolUse` is positive evidence the cycle goes on.
	 */
	const before = planFor("U T T L", true)[0];
	const after = planFor("U T T L T", true)[0];
	for (const run of [before, after]) {
		assert.equal(run.collapses, false, "nothing condenses around a lead-in");
	}
	// The same shape with an absent declaration is the design's boundary: a close.
	const unknown = planFor("U T T N", true)[0];
	assert.equal(unknown.segments[0].collapsed, true);
});

test("PR-4: a segment is live only when it lies wholly after the last settled close; a focus hold and an open bar still apply per segment", () => {
	const run = planFor("U T A W T T", true, { focusHold: "T1" })[0];
	assert.deepEqual(barsOfRun(run), [
		["T1", false],
		["W3,T4,T5", false],
	]);
	const open = planFor("U T A W T T", true, {
		openRuns: new Set(["seg:A2"]),
	})[0];
	assert.deepEqual(barsOfRun(open), [
		["T1", true],
		["W3,T4,T5", false],
	]);
});

test("PR-4: a pre-answer span is keyed by the visible row that ends it, so no later span can inherit its key", () => {
	// Today's bare run key went to the span nearest the answer. After a wake the
	// span that used to be nearest is no longer, and a NEW span becomes nearest:
	// under a bare-key rule an expansion stored for the first bar would open the
	// second. Every pre-answer key now names its own last row.
	const before = planFor("U T T A", false)[0];
	const after = planFor("U T T A W T T A", false)[0];
	const beforeKey = before.segments[0].key;
	assert.equal(
		beforeKey,
		"seg:A3",
		"the key is the visible row that ends the span",
	);
	const first = after.segments.find((s) => s.segmentIds.includes("T1"));
	assert.equal(
		first.key,
		beforeKey,
		"the same span keeps its name after the wake",
	);
	const second = after.segments.find((s) => s.segmentIds.includes("T5"));
	assert.notEqual(second.key, beforeKey, "the new span has its own name");
	const all = after.segments.map((s) => s.key);
	assert.equal(new Set(all).size, all.length, "keys are unique within the run");
	// A stale key of the older shape (the bare run key) names nothing.
	const stale = planFor("U T T A W T T A", false, {
		openRuns: new Set(["A7", "A3", "A3#T2", "S1#T2", "seg:", "seg:nope"]),
	})[0];
	assert.ok(
		stale.segments.every((s) => s.collapsed),
		"a stale key renders collapsed and opens no bar",
	);
});

/* ------ what SETTLES a cycle: markers, and a `stop` row followed by more work ------ */

test("PR-4: a turn closed by a terminal or completion marker stays condensed when a wake or peer message re-opens it", () => {
	/*
	 * The operator's report in the shape of an interrupted, failed or receipt-closed
	 * turn: there is NO assistant close, so reading only closes left the whole run
	 * "in flight" the moment a wake landed and the earlier bar un-condensed.
	 * M = `Stopped with an error`, K = the `closed` receipt (both `isTerminalMarker`).
	 */
	for (const spec of [
		"U T T M W T",
		"U T T K W",
		"U T T K W T T",
		"U T T M P T",
		"U T T I W T",
	]) {
		const idle = planFor(spec.split(" ").slice(0, 4).join(" "), false)[0];
		assert.equal(idle.segments[0].collapsed, true, `${spec}: idle, condensed`);
		const run = planFor(spec, true)[0];
		const first = run.segments[0];
		assert.deepEqual(
			first.segmentIds,
			["T1", "T2"],
			`${spec}: the settled span is the same span`,
		);
		assert.equal(first.collapsed, true, `${spec}: and it stays condensed`);
		assert.ok(
			run.segments.slice(1).every((s) => s.collapsed === false),
			`${spec}: only the in-flight cycle draws in place`,
		);
	}
});

test("PR-4: a `stop` row followed by more work with no new trigger (the todo guardrail's re-entry) does not flip the span above it", () => {
	/*
	 * `U T T A T`: cyclesOf reads A as narration (a step follows it), so the close
	 * list alone said nothing had settled and the live plan drew [T1,T2] in place
	 * while the idle plan (`U T T A`) and the idle plan after (`U T T A T`)
	 * condensed it. The pane IS live across that gap (the harness is working), so
	 * the declared `stop` is what says the first span is finished.
	 */
	for (const spec of ["U T T A T", "U T T A T T", "U T T A S"]) {
		const run = planFor(spec, true)[0];
		const first = run.segments[0];
		assert.deepEqual(first.segmentIds, ["T1", "T2"], `${spec}: same span`);
		assert.equal(first.collapsed, true, `${spec}: stays condensed`);
		assert.ok(
			run.segments.slice(1).every((s) => s.collapsed === false),
			`${spec}: only what follows the stop draws in place`,
		);
	}
	// An undeclared row is NOT a settle (unknown is absent): a mid-cycle narration
	// followed by a step is still work in flight.
	const undeclared = planFor("U T N T", true)[0];
	assert.equal(
		undeclared.collapses,
		false,
		"undeclared narration settles nothing",
	);
});

test("PR-4: a pre-answer key is `seg:<the visible row after the span>` - and that row is never hidden, so no span can hold it", () => {
	/*
	 * The key rule's own invariant, asserted rather than stated: the anchor is the
	 * row that ENDS the span, and a span is a maximal HIDDEN stretch, so that row is
	 * visible - it is in no segment, so no two spans share a key and a key never
	 * names a row that hides. It is stable exactly while that row keeps its id and
	 * stays visible; rows inside the span appearing or vanishing do not move it.
	 */
	for (const spec of [
		"U T T A",
		"U T C T A",
		"U T A W T A",
		"U T A W T T A K",
		"U T M W T T A",
	]) {
		const run = planFor(spec, false)[0];
		const hidden = new Set(run.segments.flatMap((s) => s.segmentIds));
		const records = seq(spec);
		for (const segment of run.segments.filter((s) => !s.afterAnswer)) {
			const last = records.findIndex((r) => r.id === segment.segmentIds.at(-1));
			const after = records[last + 1];
			assert.equal(segment.key, `seg:${after.id}`, `${spec}: ${segment.key}`);
			assert.equal(
				hidden.has(after.id),
				false,
				`${spec}: ${after.id} is visible`,
			);
		}
		const keys = run.segments.map((s) => s.key);
		assert.equal(new Set(keys).size, keys.length, `${spec}: keys are unique`);
	}
});

test("RESIDUAL (named): an undeclared answer that a later non-trigger step demotes is absorbed into its span, so that span's key MOVES - and the old key names nothing", () => {
	/*
	 * `U T T N T N2` with `N` carrying NO `stopReason`: N was a close (and the
	 * span's anchor) until a step arrived after it with no trigger between, which
	 * makes it narration INSIDE the span. No visible row survives to anchor on, so
	 * the key moves from the old end to the new one. Real journals never produce it
	 * (every text-bearing assistant row carries its `stop_reason`, and a `stop` row
	 * stays visible so it is a stable anchor - the sibling case below), only
	 * hand-built fixtures and the 0.11 % of rows that declare `length`/`aborted`.
	 * What IS guaranteed is the safe failure: the old key is on no bar.
	 */
	const before = planFor("U T T N", false)[0].segments;
	const after = planFor("U T T N T N", false)[0].segments;
	assert.equal(before[0].key, "seg:N3");
	assert.equal(after.length, 1, "one absorbed span");
	assert.equal(after[0].key, "seg:N5", "the key moved with the span's end");
	assert.ok(
		after.every((s) => s.key !== before[0].key),
		"and no span inherited the old key",
	);
	// The declared sibling is stable: the `stop` row stays visible and anchors.
	const stopBefore = planFor("U T T A", false)[0].segments;
	const stopAfter = planFor("U T T A T A", false)[0].segments;
	assert.equal(
		stopAfter[0].key,
		stopBefore[0].key,
		"a declared answer anchors",
	);
	assert.deepEqual(stopAfter[0].segmentIds, ["T1", "T2"]);
});

/* ------------ case 2: a bar's identity belongs to its span alone ------------ */

/*
 * THE LANE'S CASE-2 REMOUNT. A wake / peer message / job result re-opens the
 * run that had just settled, and its reply re-closes it - moving the elected
 * answer, and with it every key that used to embed the run's own key: each bar
 * of the run was RENAMED, its React element remounted, and the reader's stored
 * expansion dropped. The replacement rule (`SegmentPlan.key`) anchors a span to
 * the row that ends it, which neither of the two places rows can arrive - above
 * the loaded head and at the tail - moves.
 */

test("case 2: a wake's reply moves the ANSWER, not the bar - the first span keeps its key", () => {
	const before = planFor("U T T A", false)[0];
	const after = planFor("U T T A W T T A", false)[0];
	const beforeKey = before.segments[0].key;
	assert.equal(
		beforeKey,
		"seg:A3",
		"the key is the visible row that ends the span",
	);
	const first = after.segments.find((s) => s.segmentIds.includes("T1"));
	assert.equal(
		first.key,
		beforeKey,
		"the same span keeps its name after the wake",
	);
	const second = after.segments.find((s) => s.segmentIds.includes("T5"));
	assert.notEqual(second.key, beforeKey, "the new span has its own name");
	const all = after.segments.map((s) => s.key);
	assert.equal(new Set(all).size, all.length, "keys are unique within the run");
	// A stale key of an older shape names nothing: the bar renders collapsed.
	const stale = planFor("U T T A W T T A", false, {
		openRuns: new Set(["A7", "A3", "A3#T2", "S1#T2", "seg:", "seg:nope"]),
	})[0];
	assert.ok(
		stale.segments.every((s) => s.collapsed),
		"a stale key renders collapsed and opens no bar",
	);
});

test("case 2: the anchor is the VISIBLE row that ends the span, so no two spans can share a key", () => {
	/*
	 * The key rule's own invariant, asserted rather than stated: a span is a
	 * maximal HIDDEN stretch, so the row that ends it is visible and belongs to no
	 * segment - no two spans share a key and a key never names a hidden row. Rows
	 * inside the span appearing or vanishing do not move it.
	 */
	for (const spec of [
		"U T T A",
		"U T C T A",
		"U T A W T A",
		"U T A W T T A K",
		"U T M W T T A",
	]) {
		const run = planFor(spec, false)[0];
		const hidden = new Set(run.segments.flatMap((s) => s.segmentIds));
		const records = seq(spec);
		for (const segment of run.segments.filter((s) => !s.afterAnswer)) {
			const last = records.findIndex((r) => r.id === segment.segmentIds.at(-1));
			const after = records[last + 1];
			assert.equal(segment.key, `seg:${after.id}`, `${spec}: ${segment.key}`);
			assert.equal(
				hidden.has(after.id),
				false,
				`${spec}: ${after.id} is visible`,
			);
		}
		const keys = run.segments.map((s) => s.key);
		assert.equal(new Set(keys).size, keys.length, `${spec}: keys are unique`);
	}
});

test("case 2: hiding a receipt inside a span does not move the bar that hides it", () => {
	/*
	 * The cross-session filter hides a peer/wake receipt the moment its setting
	 * flips - a LOAD-time event. Under the old `<run key>#<its last row>` key the
	 * span's own last row moved with the receipt and the bar was renamed (remount,
	 * expansion lost); the row that ENDS the span is outside it and does not move.
	 */
	const all = seq("U T T P C T A");
	const withoutReceipt = all.filter((record) => record.id !== "P3");
	const keysOf = (records) =>
		collapsePlan(buildRows(records, []), { live: false }).runs[0].segments.map(
			(s) => s.key,
		);
	assert.deepEqual(
		keysOf(all),
		["seg:C4", "seg:A6"],
		"with the receipt on hand (hidden inside the span)",
	);
	assert.deepEqual(
		keysOf(withoutReceipt),
		["seg:C4", "seg:A6"],
		"the same two bars under the same names, once the filter hides it",
	);
});

test("case 2: a cycle settling does not rename the bars around it", () => {
	const head = `U ${repeat("T", 4)} A`;
	const keysOf = (spec, live) =>
		planFor(spec, live)[0].segments.map((s) => s.key);
	const streaming = keysOf(`${head} W T T`, true);
	const settled = keysOf(`${head} W T T A`, true);
	const done = keysOf(`${head} W T T A K`, false);
	assert.equal(streaming[0], settled[0]);
	assert.equal(
		settled[0],
		done[0],
		"the first bar's key is the same in every state",
	);
	assert.equal(
		settled[1],
		done[1],
		"and the settled tail bar keeps its key when the turn ends",
	);
});

test("case 2 RESIDUAL (named): an undeclared answer a later step demotes is absorbed into its span - its key MOVES, and the old key names nothing", () => {
	/*
	 * `U T T N T N2` with `N` carrying NO `stopReason`: N was a close (and the
	 * span's anchor) until a step arrived after it with no trigger between, which
	 * makes it narration INSIDE the span. No visible row survives to anchor on, so
	 * the key moves from the old end to the new one. Real journals never produce it
	 * (every text-bearing assistant row carries its `stop_reason`, and a `stop` row
	 * stays visible so it is a stable anchor - the sibling below), only hand-built
	 * fixtures and the ~0.11 % of rows that declare `length`/`aborted`. What IS
	 * guaranteed is the safe failure: the old key is on no bar.
	 */
	const before = planFor("U T T N", false)[0].segments;
	const after = planFor("U T T N T N", false)[0].segments;
	assert.equal(before[0].key, "seg:N3");
	assert.equal(after.length, 1, "one absorbed span");
	assert.equal(after[0].key, "seg:N5", "the key moved with the span's end");
	assert.ok(
		after.every((s) => s.key !== before[0].key),
		"and no span inherited the old key",
	);
	// The declared sibling is stable: the `stop` row stays visible and anchors.
	const stopBefore = planFor("U T T A", false)[0].segments;
	const stopAfter = planFor("U T T A T A", false)[0].segments;
	assert.equal(
		stopAfter[0].key,
		stopBefore[0].key,
		"a declared answer anchors",
	);
	assert.deepEqual(stopAfter[0].segmentIds, ["T1", "T2"]);
});

/* ---- case 2: the operator's 11:25 turn - two peers between two answers ---- */

/*
 * THE OPERATOR'S OWN TURN, reduced to its skeleton: the reader's message opens a
 * cycle, a `stop` answer closes it, TWO peer receipts land, and a second `stop`
 * answer closes those. The peers are a span of their own, anchored on the row
 * that ENDS it - the second answer - so the bar cannot take the first answer with
 * it: the first answer is neither hidden inside the span nor renamed by the
 * second one arriving. Kept synthetic: the ids come from `seq()`, not a journal.
 */
test("case 2: two peer receipts between two stop answers bar on their own, and the first answer stays visible", () => {
	const [run] = planFor("U A P P A", false);
	assert.deepEqual(
		run.segments.map((s) => [s.key, s.segmentIds, s.collapsed]),
		[["seg:A4", ["P2", "P3"], true]],
		"one span, anchored on the second answer and holding exactly the two peers",
	);
	const hidden = new Set(run.segments.flatMap((s) => s.segmentIds));
	assert.equal(hidden.has("A1"), false, "the first answer is not swallowed");
	assert.equal(
		hidden.has("A4"),
		false,
		"the second answer anchors its own span",
	);
});

/* ---------------- the display modes (#756): by-turn / by-response --------- */

/*
 * ISSUE #756. The transcript had exactly one mode: a settled turn collapses to
 * the rows its visibility invariant requires, so a turn that answered, was
 * continued past and answered again showed only the elected answer (the
 * reporter's case: an answer, then a nine-item addendum as the final message,
 * with only the addendum visible). `by-response` widens the visible set to every
 * settled text-bearing row. These cases pin the three claims the widening must
 * honour: it only ever ADDS, the elected answer does not move (#665's lesson),
 * and `by-turn` is untouched.
 */

/** Partition a run in a named display mode, otherwise exactly `partition`. */
const partitionIn = (spec, mode, from = 1) => {
	const records = seq(spec);
	const result = partitionRun(records, { ...OPTS, from, pinned: PINNED, mode });
	return { records, result };
};

test("the display-mode parser answers the shipped default for every unknown token", () => {
	assert.equal(parseTranscriptDisplayMode("by-response"), "by-response");
	assert.equal(parseTranscriptDisplayMode("by-turn"), "by-turn");
	/*
	 * A token from a build that renamed one, a tampered blob, a missing key, a
	 * number, an array: all the default. `unknown is absent` is the same rule the
	 * completion marker follows for a missing `stopReason`.
	 */
	for (const unknown of [
		"by-minute",
		"",
		null,
		undefined,
		3,
		{},
		["by-turn"],
	]) {
		assert.equal(parseTranscriptDisplayMode(unknown), "by-turn");
	}
});

test("by-response shows every settled text-bearing row; by-turn hides the narration", () => {
	const turn = "U N T N T A";
	const condensed = partition(turn);
	assert.deepEqual(visibleIds(condensed), ["A5"], "by-turn: the answer alone");
	assert.deepEqual(hiddenIds(condensed), [["N1", "T2", "N3", "T4"]]);

	const widened = partitionIn(turn, "by-response");
	assert.deepEqual(
		visibleIds(widened),
		["N1", "N3", "A5"],
		"by-response: both settled responses, in place",
	);
	assert.deepEqual(
		hiddenIds(widened),
		[["T2"], ["T4"]],
		"the work between responses still condenses",
	);
	assert.equal(
		answerId(widened),
		answerId(condensed),
		"the elected answer does not move when the set widens",
	);
	sound(widened);
});

test("by-response widens a commentary close the invariant need not keep, and elects no second answer", () => {
	/*
	 * `U T A M W N W T N`: A2 is the elected answer; the terminal marker M3 makes
	 * every later cycle commentary, so N5 - neither the run's last close nor
	 * `stop`-declared - is hidden in by-turn (the rare but real shape the module's
	 * own doc names; `N` carries no `stopReason`, which is what keeps V4 from
	 * rescuing it). Widening shows it in place without promoting it.
	 */
	const turn = "U T A M W N W T N";
	const condensed = partition(turn);
	assert.equal(
		answerId(condensed),
		"A2",
		"the answer is the one before the marker",
	);
	assert.deepEqual(visibleIds(condensed), ["A2", "M3", "N8"]);
	assert.deepEqual(hiddenIds(condensed), [["T1"], ["W4", "N5", "W6", "T7"]]);

	const widened = partitionIn(turn, "by-response");
	assert.equal(answerId(widened), "A2", "still exactly one elected answer");
	assert.deepEqual(
		visibleIds(widened),
		["A2", "M3", "N5", "N8"],
		"the hidden commentary close joins the visible set, in place",
	);
	assert.deepEqual(hiddenIds(widened), [["T1"], ["W4"], ["W6", "T7"]]);
	sound(widened);
});

test("by-turn is the shipped partition, byte-for-byte, whether the field is named or absent", () => {
	/*
	 * THE LOAD-BEARING CLAIM OF THE CHANGE: the default mode is not "the same
	 * behaviour, roughly", it is the same partition. Every shape the decision table
	 * above pins is compared whole - cycles, answer, visible set, segments and their
	 * keys - between a call that names `by-turn` and one that omits the field.
	 */
	const shapes = [
		"U A",
		"U T A",
		"U N T N T A",
		"U T A U T A",
		"U T A T A T A",
		"U T A M W T A",
		"U T A M W N W T N",
		"U A P P A",
		`U ${repeat("T", 8)} A W T A K`,
	];
	for (const shape of shapes) {
		assert.deepEqual(
			partitionIn(shape, "by-turn").result,
			partition(shape).result,
			`${shape} must partition identically in the default mode`,
		);
	}
});

test("the bars state honest counts in both modes: every hidden call is inside exactly one bar", () => {
	for (const turn of [
		"U N T N T A",
		"U T A M W N W T N",
		`U ${repeat("T", 8)} A W T A`,
	]) {
		for (const mode of ["by-turn", "by-response"]) {
			const [run] = planFor(turn, false, { mode });
			let counted = 0;
			for (const segment of run.segments) {
				counted += segment.facts.actions;
				const tools = segment.rows.filter(
					(row) => row.record.kind === "tool",
				).length;
				assert.equal(
					segment.facts.actions,
					tools,
					`${turn} (${mode}): a bar's count is the calls it hides`,
				);
			}
			const hiddenTools = run.hidden.filter(
				(row) => row.record.kind === "tool",
			).length;
			assert.equal(
				counted,
				hiddenTools,
				`${turn} (${mode}): every hidden call is counted exactly once`,
			);
		}
	}
});

test("by-response keeps the reporter's two-answer turn on screen, with the final answer elected", () => {
	/*
	 * THE REPORTER'S SHAPE at the plan level (the QA lane's own case): a substance
	 * response, the run continued through more work, then a final response. Both
	 * closes stay on screen in both modes (V1 keeps a response close); by-response
	 * is what additionally keeps the NARRATION the turn wrote along the way, and the
	 * run still elects ONE answer - the final response - which is what the caption
	 * and the foot key on.
	 */
	const turn = "U N T A N T A";
	const condensed = planFor(turn, false)[0];
	assert.deepEqual(
		condensed.hidden.map((row) => row.record.id),
		["N1", "T2", "N4", "T5"],
		"by-turn: the narration is inside the bars",
	);
	assert.equal(
		condensed.answerId,
		"A6",
		"the final response is the elected answer",
	);

	const widened = planFor(turn, false, { mode: "by-response" })[0];
	assert.deepEqual(
		widened.hidden.map((row) => row.record.id),
		["T2", "T5"],
		"by-response: only the work is hidden",
	);
	assert.equal(widened.answerId, "A6", "the elected answer does not move");
	const hidden = new Set(widened.hidden.map((row) => row.record.id));
	for (const id of ["N1", "A3", "N4", "A6"]) {
		assert.ok(widened.recordIds.includes(id), `${id} belongs to the run`);
		assert.equal(hidden.has(id), false, `${id} stays on screen`);
	}
});

test("the display mode survives a relaunch, and an unknown stored token comes back as the default", () => {
	memory.clear();
	const store = useUiPreferencesStore;
	store.getState().setTranscriptDisplayMode("by-response");
	/*
	 * The store is the writer and the filter the middleware keeps is the one it
	 * ships: assert the field is IN the persisted blob rather than assuming it.
	 */
	assert.equal(
		persistedUiPreferences(store.getState()).transcriptDisplayMode,
		"by-response",
	);
	const key = [...memory.keys()].find((entry) => {
		try {
			return (
				JSON.parse(memory.get(entry)).state?.transcriptDisplayMode !== undefined
			);
		} catch {
			return false;
		}
	});
	assert.ok(key, "the store wrote a key carrying the display mode");
	// The bytes on disk, read the way the next launch reads them.
	assert.equal(
		parseTranscriptDisplayMode(
			JSON.parse(memory.get(key)).state.transcriptDisplayMode,
		),
		"by-response",
		"the chosen mode came back",
	);
	store.getState().setTranscriptDisplayMode("by-turn");
	assert.equal(
		parseTranscriptDisplayMode(
			JSON.parse(memory.get(key)).state.transcriptDisplayMode,
		),
		"by-turn",
		"and the other mode came back",
	);
});
