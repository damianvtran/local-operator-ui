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
 *    Two things about that signature are pinned here as well, both added in
 *    agent review round 1: it is computed ONCE PER RECORD OBJECT (so a token,
 *    which replaces one record, pays for one record - M1), and it carries
 *    NEITHER the record's payload NOR the bytes of an inline image (M1b: an
 *    inline screenshot is base64 on the live path, and hashing it made the key
 *    scale with the picture).
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
			'export { collapsePlan, collapsePlanInputKey, collapsePlanOptionsKey, collapseRowsKey, dbgCollapsePlanCalls, widenTarget, paintedRows, WIDEN_MAX_STEPS, WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
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
	paintedRows,
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
			/*
			 * THE TWO PAYLOAD FIELDS A TOOL ROW CARRIES IN PRACTICE, present in the
			 * fixtures so the completeness sweep actually reaches their exclusions
			 * (agent review round 1, M2: without them the sweep asserted "every own
			 * field", over records that never carried four of the six paths).
			 */
			intent: "list the invoices",
			diff: ["--- a/t.ts", "+++ b/t.ts", "-one", "+two"],
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
			/*
			 * The assistant row's own two payload paths (agent review round 1, M2),
			 * for the same reason `intent`/`diff` are on the tool fixture: `frame` is
			 * the transport cursor and `truncated` names what the row's text is NOT,
			 * and the plan reads neither.
			 */
			frame: { epoch: "e1", seq: 7 },
			truncated: "prefix",
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
			const entry = rows[at];
			const record = entry.record;
			for (const field of Object.keys(record)) {
				/*
				 * REPLACED, NEVER MUTATED - the reducer's own rule
				 * (`transcript-reducer.ts`: "a delta that changes nothing returns the
				 * SAME record object", and a changed row is replaced by `upsert`),
				 * and the rule the signature's memo rests on: a record object's fields
				 * are immutable for its lifetime, so a signature computed once stays
				 * true. Mutating a fixture in place would sweep a shape the app cannot
				 * produce - and, since the memo caches on identity, would test the
				 * cache rather than the signature.
				 */
				rows[at] = {
					...entry,
					record: { ...record, [field]: mutate(record[field]) },
				};
				const keyMoved = collapseRowsKey(rows) !== beforeKey;
				const projection = planProjection(collapsePlan(rows, options));
				rows[at] = entry;
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
				rows[at] = { ...entry, [field]: mutate(entry[field]) };
				const keyMoved = collapseRowsKey(rows) !== beforeKey;
				const projection = planProjection(collapsePlan(rows, options));
				rows[at] = entry;
				mutations += 1;
				assert.ok(
					keyMoved || projection === before,
					`${name}: ${record.id}.${field} moved the plan but not its signature`,
				);
			}
		}
	}
	assert.ok(mutations > 100, `the sweep really ran (${mutations} mutations)`);
	/*
	 * AND IT REACHES EVERY PAYLOAD PATH. The sweep's assertion is vacuous for a
	 * field no fixture carries, which is how four of the six exclusions went
	 * unexercised until agent review round 1 (M2). This is the coverage claim
	 * stated as a fact about the fixtures rather than left to the reader.
	 */
	const carried = new Set(
		Object.values(fixtures).flatMap((rows) =>
			rows.flatMap((entry) => Object.keys(entry.record)),
		),
	);
	for (const path of ["output", "args", "intent", "diff", "frame", "truncated"])
		assert.ok(
			carried.has(path),
			`the fixtures carry ${path}, so its exclusion is swept`,
		);
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
	/*
	 * The whole key is its two halves, and it moves with either of them. Asserted
	 * as a property rather than by re-spelling the join: the component now calls
	 * this helper (`canonical-transcript.tsx`), so a second spelling here would
	 * be a test of a join nobody runs (agent review round 1, M3).
	 */
	const rowsKey = collapseRowsKey(fixtures.settled);
	const whole = collapsePlanInputKey(rowsKey, options);
	assert.ok(whole.startsWith(rowsKey), "the whole key carries the rows half");
	assert.ok(
		whole.endsWith(collapsePlanOptionsKey(options)),
		"the whole key carries the options half",
	);
	assert.notEqual(
		collapsePlanInputKey("another rows half", options),
		whole,
		"the rows half is an input",
	);
	assert.notEqual(
		collapsePlanInputKey(rowsKey, { ...options, live: true }),
		whole,
		"the options half is an input",
	);
});

/* ----------------------- P3: the widen search's plans --------------------- */

/**
 * THE SHAPE THE SEARCH IS FOR. One 600-call turn, already condensed, whose bar
 * hides everything the window can add: every candidate snaps back to the same
 * window (the snap's completed-run allowance mounts the whole run), so the
 * search walks its bound and the reader sees a bar that already says its
 * totals. Both tests below measure THE SAME ROWS with THE SAME OPTIONS - the
 * after arm through the shipped `widenTarget`, the before arm through the loop
 * the pre-fix tree ran.
 */
const condensedTurn = () => [
	user("u1"),
	...Array.from({ length: 600 }, (_, i) => tool(`t${i}`, {}, "trace")),
	answer("a1"),
];
const WIDEN_OPTIONS = {
	step: 60,
	live: false,
	openRuns: new Set(),
	mode: "by-turn",
	snapMaxExtra: SNAP_MAX_EXTRA,
	completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
};
const WIDEN_MOUNTED_SIZE = 60;

/**
 * WHAT THE PRE-FIX TREE PAID, reconstructed over the SHIPPED `paintedRows`.
 *
 * The plan count is what moved; the search itself is unchanged, so the old loop
 * can be run against the new primitives. This is the before-column of the body's
 * count table, and the reason it is a test rather than a sentence is QA round 1's
 * Q1: QA's reconstruction read 11 and the body said 10, and a number nothing
 * measures is a number that drifts.
 *
 * IT IS 10, and the arithmetic is: the baseline call, plus one call per `while`
 * CONDITION - nine of them, at sizes 120..600. The tenth step is not a call:
 * `size < maxRows` short-circuits it, because the ninth body sets
 * `size = min(maxRows, 600 + 60) = 602`. A reconstruction that counts the loop's
 * exit test measures a loop the pre-fix tree never ran.
 */
const preFixWidenPlans = () => {
	const rows = condensedTurn();
	dbgCollapsePlanCalls.count = 0;
	const before = paintedRows(rows, WIDEN_MOUNTED_SIZE, WIDEN_OPTIONS);
	let size = Math.min(rows.length, WIDEN_MOUNTED_SIZE + WIDEN_OPTIONS.step);
	while (
		size < rows.length &&
		paintedRows(rows, size, WIDEN_OPTIONS) - before < 8
	) {
		size = Math.min(rows.length, size + WIDEN_OPTIONS.step);
	}
	return { plans: dbgCollapsePlanCalls.count, size };
};

test("a widen paid one plan per candidate size before this change", () => {
	const before = preFixWidenPlans();
	assert.equal(
		before.plans,
		10,
		`the pre-fix loop paid 10 plans on this shape (got ${before.plans})`,
	);
	assert.equal(before.size, 602, "and it landed on the whole list");
});

test("a widen pays one plan per DISTINCT window it considers", () => {
	const rows = condensedTurn();
	dbgCollapsePlanCalls.count = 0;
	const size = widenTarget(rows, WIDEN_MOUNTED_SIZE, WIDEN_OPTIONS);
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
	 * And the point of the fix: the candidates all resolved to ONE window, so the
	 * gesture pays the two windows it visited (the mounted baseline and the
	 * size it lands on), not one plan per step.
	 *
	 * EXACTLY ONE, not "at most two" (agent review round 1, N1): the count table
	 * says 1, and `<= 2` would pass a regression back to one plan per candidate
	 * size. The looseness was the assertion disagreeing with the claim it guards.
	 */
	assert.equal(plans, 1, `one plan per distinct window (${plans} plans)`);
});

/* ------------- M1b: an inline payload must not reach the key ------------- */

/** One inline base64 picture, the shape the LIVE path hands a tool row
 * (`transcript-reducer.ts`: "Base64 payload when the event carried it inline"). */
const inlineImage = (bytes) => ({
	id: "n1:0",
	data: "A".repeat(bytes),
	attachment: null,
	mimeType: "image/png",
});

/** A window whose one tool row carries an inline picture of `bytes` base64. */
const windowWithImage = (bytes) => [
	user("u1"),
	tool("n1", { images: [inlineImage(bytes)] }),
	answer("a1"),
];

/** Min-of-rounds `process.cpuUsage` for one iteration of `fn`, in
 * microseconds. CPU and never wall time, so the ~25 sibling sessions on this
 * host shift nothing (AGENTS.md, "If you must measure, measure CPU, not wall
 * time"); min-of-rounds per the reviewer's own shape. */
const cpuPerCall = (fn, iterations, rounds) => {
	let best = Number.POSITIVE_INFINITY;
	for (let round = 0; round < rounds; round += 1) {
		const start = process.cpuUsage();
		for (let i = 0; i < iterations; i += 1) fn(i);
		const used = process.cpuUsage(start);
		best = Math.min(best, (used.user + used.system) / iterations);
	}
	return best;
};

test("the key's cost does not scale with an inline image's bytes", () => {
	/*
	 * THE HAZARD THIS PINS (agent review round 1, M1b): `images[].data` is
	 * inline base64 on the live path and a browser capture is a first-class row
	 * here, so hashing the picture made every call that re-signed the window pay
	 * for it - measured at 60 rows + one 512 KB screenshot, 453 us against the
	 * plan's 11 us (40x), and at 602 rows + 2 MB, 2199 us against 141 us. The key
	 * carries the picture's IDENTITY instead (`imageStamp`), so its work is the
	 * same whether the row holds a thumbnail or a full-resolution capture.
	 *
	 * TWO ASSERTIONS, because they fail for different reasons and either alone
	 * leaves a door open:
	 *  - the KEY'S LENGTH is bounded, which fails the day the bytes are carried;
	 *  - the KEY'S COST does not grow with the payload, which fails the day the
	 *    bytes are hashed instead of carried (a hash is constant-length, so the
	 *    length bound cannot see that one).
	 * The failure mode is a live path that gets slower as pictures get bigger,
	 * which is exactly what this must never quietly become again.
	 */
	const small = windowWithImage(1024);
	const big = windowWithImage(2 * 1024 * 1024);

	assert.ok(
		collapseRowsKey(big).length < 1024,
		`the key does not carry the bytes (${collapseRowsKey(big).length} chars for a 2 MB picture)`,
	);

	/*
	 * COLD EVERY CALL: the records are cloned on each iteration, which is the
	 * shape a flush that hands back fresh objects produces - and the only shape
	 * where a hash of the payload would show up at all, since a memoised
	 * signature is not recomputed. Both arms pay the same clone.
	 */
	const cloneAndKey = (rows) => {
		const cloned = rows.map((entry) => ({
			...entry,
			record: { ...entry.record },
		}));
		return collapseRowsKey(cloned);
	};
	const smallUs = cpuPerCall(() => cloneAndKey(small), 25, 5);
	const bigUs = cpuPerCall(() => cloneAndKey(big), 25, 5);
	assert.ok(
		bigUs < smallUs * 4,
		`a 2 MB inline picture must not make the key scale with it (1 KB ${smallUs.toFixed(1)} us, 2 MB ${bigUs.toFixed(1)} us per call)`,
	);
});

test("a changed payload still moves the key, and an unchanged one does not", () => {
	/*
	 * THE OTHER HALF OF THE BOUND. Dropping the bytes is only safe because
	 * something else moves when they change; if a future change dropped
	 * `images` outright, the plan would keep pointing at the old record objects
	 * and the condensed strip would paint a picture the reader already replaced.
	 * The reducer's records are immutable values, so the ARRAY is that
	 * something: a new array means an array whose content changed.
	 */
	const rows = windowWithImage(1024);
	const before = collapseRowsKey(rows);
	/* A re-signed window with the SAME array: nothing a plan reads has moved. */
	const reSigned = rows.map((entry) => ({
		...entry,
		record: { ...entry.record },
	}));
	assert.equal(
		collapseRowsKey(reSigned),
		before,
		"an unchanged array keeps the signature where it was",
	);
	/* Two different payloads are two different arrays, and two different keys. */
	assert.notEqual(
		collapseRowsKey(windowWithImage(2048)),
		before,
		"other bytes are another window",
	);
	/* And so is the same bytes in a rebuilt array (a live re-extraction). */
	const rebuilt = rows.map((entry) =>
		entry.record.kind === "tool"
			? {
					...entry,
					record: { ...entry.record, images: [...entry.record.images] },
				}
			: entry,
	);
	assert.notEqual(
		collapseRowsKey(rebuilt),
		before,
		"a rebuilt array is a rebuilt window",
	);
});
