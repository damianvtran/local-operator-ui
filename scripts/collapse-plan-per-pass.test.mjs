/**
 * ONE COLLAPSE PLAN PER STRUCTURAL PASS (UI perf audit P1/P3; PR-6).
 *
 * WHAT THIS PINS, AND WHY AS COUNTS. The plan is a pure function of the rows
 * and four options, and the transcript re-derives it several times per reader
 * action and per streamed token. Two of those re-derivations are avoidable and
 * two are pinned here, both as COUNTS (`dbgCollapsePlanCalls`), never as a
 * stopwatch - this host runs ~25 sessions, so a wall-clock assertion measures
 * the neighbours (AGENTS.md, "If you must measure, measure CPU, not wall
 * time").
 *
 * 1. THE INPUT SIGNATURE (`collapseRowsKey`/`collapsePlanOptionsKey`). A memo
 *    keyed on the row ARRAY re-plans the whole window on every streamed token,
 *    including the tokens that only lengthen an answer's text. The signature is
 *    the fix, and the property it must have is that it moves whenever the plan
 *    would: asserted below by mutating every own field of every fixture record
 *    one at a time and requiring that either the signature moves or the plan's
 *    own projection does not. That direction is the one a mistake must not fall;
 *    the opposite (a signature that moves when the plan would not) only buys a
 *    redundant plan.
 *
 * 2. THE WIDEN SEARCH (`widenTarget`). The snap can mount far more than the raw
 *    size it is asked for, so several candidates of one gesture - and the
 *    mounted baseline itself - resolve to the SAME window. Before the fix each
 *    of those paid a fresh plan over the whole window; the count below is the
 *    gesture's whole cost, and `WIDEN_MAX_STEPS` still bounds the search.
 *
 * WHAT THIS CANNOT SAY. That the render actually consults the plan (that is
 * `scripts/transcript-perflush-perf.test.mjs`'s mount, which counts plans and
 * the two rebuild counters across a scripted token stream), or that a bar looks
 * right (the frames do). This file is arithmetic over the shipped module.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export { collapsePlan, collapsePlanInputKey, collapsePlanOptionsKey, collapseRowsKey, dbgCollapsePlanCalls, widenTarget, WIDEN_MAX_STEPS, WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
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

const moduleUrl = `data:text/javascript;base64,${Buffer.from(
	bundle.outputFiles[0].text,
).toString("base64")}`;
const {
	WIDEN_MAX_STEPS,
	WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	collapsePlan,
	collapsePlanInputKey,
	collapsePlanOptionsKey,
	collapseRowsKey,
	dbgCollapsePlanCalls,
	widenTarget,
} = await import(moduleUrl);

/*
 * The transcript's OWN ordinary snap bound (`WINDOW_ALIGN_MAX_EXTRA`,
 * `canonical-transcript.tsx`). Spelled here rather than imported because it is
 * module-private to the component, and a test that pulled the component in for
 * it would drag the whole render stack into an arithmetic check.
 */
const SNAP_MAX_EXTRA = 300;

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

/** The same row shape `buildRows` hands the model: the record, its gap tier and
 * its `closesTurn`. Gaps follow the real rule (the row after a user row is
 * `turn`, adjacent trace-tier rows are `trace`, everything else `item`). */
const row = (id, kind, extra = {}, gap = "item") => ({
	record: { kind, id, ts: TS, ...extra },
	gap,
	closesTurn: false,
});

const user = (id, extra = {}) =>
	row(id, "user", { text: "hi", images: [], ...extra }, "turn");
const tool = (id, extra = {}, gap = "turn") =>
	row(
		id,
		"tool",
		{
			toolName: "bash",
			args: { command: "pnpm test:desktop" },
			output: "tests 40\npass 40\n",
			isError: false,
			delivery: null,
			stopped: false,
			neverSent: false,
			notRunReason: null,
			notRunKind: null,
			durationS: 0.4,
			images: [],
			...extra,
		},
		gap,
	);
const answer = (id, extra = {}) =>
	row(
		id,
		"assistant",
		{
			text: "Four invoices were late.",
			streaming: false,
			stopReason: null,
			error: false,
			...extra,
		},
		"item",
	);

/**
 * The shapes the plan's own decisions read: a settled turn with work it
 * collapses, a live turn, a steered turn, a marked turn, and a custom row at
 * each level (`session_incident` is the error-level one the partition treats as
 * a boundary).
 */
const fixtures = {
	settled: [
		user("u1"),
		tool("t1"),
		tool("t2", {}, "trace"),
		tool("t3", { durationS: 12 }),
		answer("a1"),
	],
	live: [
		user("u1"),
		tool("t1"),
		tool("t2", { output: "still writing\n" }, "trace"),
		answer("a2", { text: "", streaming: true }),
	],
	steered: [
		user("u1"),
		tool("t1"),
		user("s1"),
		tool("t2", {}, "trace"),
		answer("a1"),
	],
	marked: [
		user("u1"),
		tool("t1"),
		row("m1", "notice", { text: "Interrupted", level: "info", complete: true }),
		user("u2"),
		answer("a2"),
	],
	incident: [
		user("u0"),
		tool("t0"),
		row("i1", "custom", {
			customType: "session_incident",
			level: "error",
			text: "the session was disposed",
		}),
		user("u1"),
		tool("t1"),
		answer("a1"),
	],
	failed: [
		user("u1"),
		tool("t1", { isError: true }),
		tool("t2", { stopped: true }, "trace"),
		tool("t3", { notRunReason: "denied", notRunKind: "interrupt" }, "trace"),
		tool("t4", { images: [{ id: "im1", url: "blob:one" }] }, "trace"),
		answer("a1"),
	],
	receipts: [
		user("u1"),
		row("p1", "peer", { text: "a peer said something" }),
		row("w1", "wake", { text: "a wake" }, "trace"),
		user("u1b"),
		tool("t1"),
		answer("a1"),
	],
};

const options = {
	live: false,
	focusHold: null,
	openRuns: new Set(),
	mode: "by-turn",
};

/* --------------------- P1: the input signature's scope -------------------- */

/**
 * The plan, as data: no row objects (the plan re-uses the caller's rows, so
 * their identity is not the model's to promise), only what it DECIDES. This is
 * the projection the sweep below compares.
 */
const planProjection = (plan) =>
	JSON.stringify(
		plan.runs.map((run) => ({
			key: run.key,
			collapses: run.collapses,
			recordIds: run.recordIds,
			boundary: run.run.boundary,
			closingAnswerId: run.run.closingAnswerId,
			opensWithUserRow: run.run.opensWithUserRow,
			openingIndex: run.run.openingIndex,
			endIndex: run.run.endIndex,
			segments: run.segments.map((segment) => ({
				key: segment.key,
				firstId: segment.firstId,
				segmentIds: segment.segmentIds,
				gap: segment.gap,
				afterAnswer: segment.afterAnswer,
				label: segment.label,
				completed: segment.completed,
				collapsed: segment.collapsed,
				stampTs: segment.stampTs,
				facts: segment.facts,
				hiddenIds: segment.rows.map((hidden) => hidden.record.id),
			})),
		})),
	);

/** A value that is different from the one given, per shape the records hold. */
const mutate = (value) => {
	if (typeof value === "number") return value + 1;
	if (typeof value === "boolean") return !value;
	if (typeof value === "string") return value === "" ? "mutated" : `${value}x`;
	if (Array.isArray(value))
		return [...value, { id: "mutant", url: "blob:mutant" }];
	if (value === null) return "mutated";
	if (typeof value === "object") return { ...value, __mutant: true };
	return "mutated";
};

test("the plan's signature moves whenever the plan would", () => {
	/*
	 * THE COMPLETENESS PIN, and the reason the signature may be trusted: it is
	 * asserted field by field, over the fields that actually EXIST on a fixture
	 * record. A record field the model starts reading without the signature
	 * moving shows up here as a projection that changed under a key that did
	 * not - which is a stale plan in the running app, caught in CI instead.
	 */
	let mutations = 0;
	for (const [name, rows] of Object.entries(fixtures)) {
		const before = planProjection(collapsePlan(rows, options));
		const beforeKey = collapseRowsKey(rows);
		for (let at = 0; at < rows.length; at += 1) {
			const record = rows[at].record;
			for (const field of Object.keys(record)) {
				const original = record[field];
				record[field] = mutate(original);
				const keyMoved = collapseRowsKey(rows) !== beforeKey;
				const projection = planProjection(collapsePlan(rows, options));
				record[field] = original;
				mutations += 1;
				assert.ok(
					keyMoved || projection === before,
					`${name}: ${record.id}.${field} moved the plan but not its signature`,
				);
			}
			/*
			 * The two layout facts `buildRows` derives are the model's inputs
			 * too, and they are not record fields - asserted separately rather
			 * than assumed covered.
			 */
			for (const field of ["gap", "closesTurn"]) {
				const original = rows[at][field];
				rows[at][field] = mutate(original);
				const keyMoved = collapseRowsKey(rows) !== beforeKey;
				const projection = planProjection(collapsePlan(rows, options));
				rows[at][field] = original;
				mutations += 1;
				assert.ok(
					keyMoved || projection === before,
					`${name}: ${record.id}.${field} moved the plan but not its signature`,
				);
			}
		}
	}
	assert.ok(mutations > 100, `the sweep really ran (${mutations} mutations)`);
});

test("a text delta and fresh row identities leave the signature where it was", () => {
	/*
	 * THE TOKEN THE FIX IS FOR. Streaming hands back a fresh copy of the
	 * answer with one more character, and - on a socket flush - fresh copies of
	 * everything. Neither can move a plan decision, so neither may move the key.
	 */
	const rows = [
		user("u1"),
		tool("t1"),
		tool("t2", {}, "trace"),
		answer("a1", { text: "Four", streaming: true }),
	];
	const before = collapseRowsKey(rows);
	const beforePlan = planProjection(collapsePlan(rows, options));

	for (let i = 0; i < 40; i += 1) {
		/* The streaming row grows and every record is handed back fresh. */
		rows[3].record.text += " invoices";
		const flushed = rows.map((entry) => ({
			...entry,
			record: { ...entry.record },
		}));
		assert.equal(
			collapseRowsKey(flushed),
			before,
			"a longer answer text is not a plan input",
		);
	}
	assert.equal(planProjection(collapsePlan(rows, options)), beforePlan);
});

test("the options half covers liveness, mode, focus and the opened bars", () => {
	const base = collapsePlanOptionsKey(options);
	const moved = (next, why) =>
		assert.notEqual(collapsePlanOptionsKey(next), base, why);
	moved({ ...options, live: true }, "liveness is an input");
	moved({ ...options, mode: "by-response" }, "the display mode is an input");
	moved({ ...options, focusHold: "t1" }, "the focus hold is an input");
	moved(
		{ ...options, openRuns: new Set(["seg:a1"]) },
		"an opened bar is an input",
	);
	/* Insertion order is a history, not a decision. */
	assert.equal(
		collapsePlanOptionsKey({
			...options,
			openRuns: new Set(["seg:b", "seg:a"]),
		}),
		collapsePlanOptionsKey({
			...options,
			openRuns: new Set(["seg:a", "seg:b"]),
		}),
		"the same bars in another order are the same key",
	);
	assert.equal(
		collapsePlanInputKey(fixtures.settled, options),
		`${collapseRowsKey(fixtures.settled)}\u0001${collapsePlanOptionsKey(options)}`,
		"the whole key is its two halves",
	);
});

/* ----------------------- P3: the widen search's plans --------------------- */

test("a widen pays one plan per DISTINCT window it considers", () => {
	/*
	 * THE SHAPE THE SEARCH IS FOR. One 600-call turn, already condensed, whose
	 * bar hides everything the window can add: every candidate snaps back to
	 * the same window (the snap's completed-run allowance mounts the whole run),
	 * so the search walks its bound and the reader sees a bar that already says
	 * its totals. Before the fix, each of those candidates built its own plan
	 * over the same 602 rows.
	 */
	const rows = [
		user("u1"),
		...Array.from({ length: 600 }, (_, i) => tool(`t${i}`, {}, "trace")),
		answer("a1"),
	];
	const widen = () =>
		widenTarget(rows, 60, {
			step: 60,
			live: false,
			openRuns: new Set(),
			mode: "by-turn",
			snapMaxExtra: SNAP_MAX_EXTRA,
			completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
		});

	dbgCollapsePlanCalls.count = 0;
	const size = widen();
	const plans = dbgCollapsePlanCalls.count;

	/*
	 * The bound of the search itself is unchanged: the walk still steps at most
	 * `WIDEN_MAX_STEPS` candidates and it still lands on the whole list.
	 */
	assert.equal(size, rows.length, "the search walks to the list's end");
	assert.ok(
		plans <= WIDEN_MAX_STEPS + 2,
		`a gesture is bounded by the search (${plans} plans)`,
	);
	/*
	 * And the point of the fix: the candidates all resolved to ONE window, so
	 * the gesture pays the two windows it visited (the mounted baseline and the
	 * size it lands on), not one plan per step.
	 */
	assert.ok(plans <= 2, `one plan per distinct window (${plans} plans)`);
});
