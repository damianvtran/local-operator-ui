/**
 * §E2's aggregation tier, asked of the shipped model.
 *
 * WHY A UNIT TEST AND NOT A FRAME. The frames say the folded and expanded states
 * look right; they cannot say that a run of two does NOT fold, that folding never
 * reorders a row, or that the copy is generated from the counts rather than from
 * whichever call happened to arrive first. Those are the properties a reader
 * depends on and the ones an edit breaks silently, so they are asserted here
 * against `trace-fold-model.ts` itself, bundled the way the rest of this suite
 * bundles shipped TypeScript (`scripts/chat-sidebar-layout.test.mjs` states the
 * reason the memory bundle exists).
 *
 * WHAT THIS CANNOT SAY. That the fold LOOKS like the ledger's own row, that its
 * chevron is the app's disclosure, or that the foot line's failure button lands
 * on the failed row - the frames and the QA pass do that. This file says the
 * arithmetic is right.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/trace-fold-model";',
			'export { isInternalReceipt, receiptFamilyOf } from "./src/renderer/src/features/chat/components/trace/receipt-row-model";',
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
	FOLD_COUNT_LIMIT,
	FOLD_MEDIA_LIMIT,
	FOLD_MIN_ACTIONS,
	FOLD_MIN_RECEIPTS,
	actionClass,
	foldCountSegments,
	foldCounts,
	foldCountUnits,
	foldImages,
	foldLive,
	foldMediaClause,
	foldMediaRows,
	foldMediaSlots,
	foldRuns,
	foldSpan,
	latchFoldedRuns,
	foldSummary,
	foldSummarySpec,
	foldSummaryUnits,
	isInternalReceipt,
	receiptFamilyOf,
	receiptFoldUnits,
	turnFeet,
} = await import(moduleUrl);

/** A row the model can read: an id, a kind, a gap tier and the closure flag. */
const row = (id, gap = "trace", extra = {}) => ({
	record: { id, kind: "tool", ...extra },
	gap,
	closesTurn: false,
});

const opening = (id, gap = "turn") => ({
	record: { id, kind: "tool" },
	gap,
	closesTurn: false,
});

/* ------------------------------- the fold ------------------------------- */

test("incoming receipts bridge actions without impersonating actions", () => {
	const hub = {
		record: { id: "h", kind: "custom", customType: "hub_message" },
		gap: "trace",
		closesTurn: false,
	};
	const options = {
		nameOf: () => "read",
		failedOf: () => false,
		durationOf: () => 1,
		isFoldable: (r) => r.record.kind === "tool",
		isReceipt: (r) => r.record.customType === "hub_message",
		receiptSummaryOf: receiptFoldUnits,
	};
	const groups = foldRuns([row("a"), hub, row("b"), row("c")], options);
	assert.equal(groups.length, 1);
	assert.deepEqual(
		groups[0].rows.map((r) => r.record.id),
		["a", "h", "b", "c"],
	);
	assert.equal(groups[0].actions.length, 3);
	assert.equal(groups[0].failedCount, 0);
	/*
	 * A MIXED LINE IS COUNT UNITS, never a sentence glued to a noun inventory:
	 * three `read` actions compose to `3 files`, and the receipt states its own
	 * family - it does not inflate the action count.
	 */
	assert.deepEqual(groups[0].summary.units, ["3 files", "1 incoming message"]);
	assert.equal(
		foldRuns([row("a"), hub, row("b")], options).length,
		3,
		"two tools plus a LONE receipt stay ordinary rows",
	);
	const receiptOnly = foldRuns(
		[hub, { ...hub, record: { ...hub.record, id: "h2" } }],
		options,
	);
	assert.equal(
		receiptOnly.length,
		1,
		"two consecutive receipts fold under one header with no actions",
	);
	assert.deepEqual(
		receiptOnly[0].rows.map((r) => r.record.id),
		["h", "h2"],
	);
	assert.deepEqual(receiptOnly[0].actions, [], "receipts are never actions");
	assert.deepEqual(receiptOnly[0].summary.units, ["2 incoming messages"]);
	const boundary = {
		record: { id: "u", kind: "user" },
		gap: "trace",
		closesTurn: false,
	};
	assert.equal(
		foldRuns([row("a"), hub, boundary, row("b"), row("c")], options).length,
		5,
	);
});

/** A receipt row by custom type, and the two record kinds that are receipts. */
const custom = (id, customType, extra = {}) => ({
	record: { id, kind: "custom", customType, ...extra },
	gap: "trace",
	closesTurn: false,
});
const peerReceipt = (id) => ({
	record: { id, kind: "peer" },
	gap: "trace",
	closesTurn: false,
});
const wakeReceipt = (id) => ({
	record: { id, kind: "wake" },
	gap: "trace",
	closesTurn: false,
});

const receiptOptions = {
	nameOf: () => "bash",
	failedOf: () => false,
	isFoldable: (r) => r.record.kind === "tool",
	isReceipt: (r) => isInternalReceipt(r.record),
	receiptSummaryOf: receiptFoldUnits,
};

test("the operator's job-result wall folds into ONE run", () => {
	/*
	 * The shape reproduced from session 8c2ff1914f44: a bash call, a job result,
	 * a bash call, a job result, ... as separate rows, each receipt owning a
	 * chevron. `job_result` used to be a BOUNDARY, so every segment restarted the
	 * action count and the wall never folded. It is internal traffic now, and the
	 * run is one group whose header states both what the turn did and what it was
	 * told.
	 */
	const rows = [
		row("a"),
		custom("j1", "job_result"),
		row("b"),
		custom("j2", "job_result"),
		row("c"),
		custom("j3", "job_result"),
	];
	const groups = foldRuns(rows, receiptOptions);
	assert.equal(groups.length, 1, "one run, not six rows");
	assert.equal(groups[0].kind, "run");
	assert.deepEqual(
		groups[0].rows.map((r) => r.record.id),
		["a", "j1", "b", "j2", "c", "j3"],
		"the fold holds every row in arrival order",
	);
	assert.equal(groups[0].actions.length, 3, "three actions, never six");
	assert.deepEqual(groups[0].summary.units, ["3 shell", "3 job results"]);
	assert.equal(
		groups[0].failedCount,
		0,
		"a receipt never contributes a failure",
	);
	assert.equal(groups[0].span, null, "a receipt never contributes a duration");
	assert.equal(groups[0].live, null, "a receipt is never the live clause");
});

test("receipt families fold alone, and boundaries still split", () => {
	assert.equal(
		FOLD_MIN_RECEIPTS,
		2,
		"two receipts are the smallest wall worth a header",
	);
	const pair = foldRuns(
		[peerReceipt("p1"), custom("h1", "hub_message")],
		receiptOptions,
	);
	assert.equal(pair.length, 1, "two receipts with no actions fold");
	assert.deepEqual(pair[0].actions, []);
	assert.deepEqual(pair[0].summary.units, ["2 incoming messages"]);
	assert.equal(
		foldRuns([peerReceipt("p1"), row("a")], receiptOptions).length,
		2,
		"a lone receipt beside one action stays two rows",
	);
	assert.equal(
		foldRuns([peerReceipt("p1"), row("a"), peerReceipt("p2")], receiptOptions)
			.length,
		3,
		"two receipts AROUND a sub-threshold action stay ordinary rows: the receipt threshold is for pure receipt stretches",
	);
	const mixed = foldRuns(
		[
			peerReceipt("p1"),
			custom("h1", "hub_message"),
			custom("j1", "job_result"),
			wakeReceipt("w1"),
			custom("m1", "monitor_prompt"),
		],
		receiptOptions,
	);
	assert.equal(mixed.length, 1);
	assert.deepEqual(mixed[0].summary.units, [
		"2 incoming messages",
		"1 job result",
		"1 wake receipt",
		"1 monitor prompt",
	]);
	/*
	 * ARBITRARY CUSTOM NOTICES ARE BOUNDARIES, even an error-level one: folding an
	 * incident under a count would hide the sentence that changed the plan.
	 */
	const incident = custom("n1", "session_incident", { level: "error" });
	const split = foldRuns(
		[
			row("a"),
			custom("j1", "job_result"),
			row("b"),
			custom("j2", "job_result"),
			row("c"),
			incident,
		],
		receiptOptions,
	);
	assert.deepEqual(
		split.map((g) => g.kind),
		["run", "row"],
	);
	assert.equal(split[1].row.record.id, "n1", "the notice is its own row");
	/* A supplement and the agent's answer stay out of the run, exactly as #1190
	 * requires: they are what the turn PRODUCED, not traffic it received. */
	const supplement = {
		record: { id: "s1", kind: "supplement" },
		gap: "trace",
		closesTurn: false,
	};
	const answer = {
		record: { id: "ans", kind: "assistant" },
		gap: "item",
		closesTurn: true,
	};
	for (const boundaryRow of [supplement, answer]) {
		const groups = foldRuns(
			[
				row("a"),
				custom("j1", "job_result"),
				row("b"),
				custom("j2", "job_result"),
				row("c"),
				boundaryRow,
			],
			receiptOptions,
		);
		assert.deepEqual(
			groups.map((g) => g.kind),
			["run", "row"],
			`${boundaryRow.record.kind} stays outside the fold`,
		);
		assert.equal(groups[1].row.record.id, boundaryRow.record.id);
		assert.ok(
			!groups[0].rows.some((r) => r.record.id === boundaryRow.record.id),
			"the boundary row is not inside the run",
		);
	}
});

test("the live latch survives a window shrink and still forgets a row the store dropped (review round 1, F1)", () => {
	/*
	 * THE WINDOW IS NOT THE CONVERSATION. A snap, a widened page or a filter can
	 * paint a frame whose slice omits a run the pane has already shown folded;
	 * rebuilding the latch from that slice dropped its ids, the rows came back on
	 * the next full pass and re-folded - the same open/close pair through another
	 * door. The union retains across the shrink and prunes against the STORE.
	 */
	const foldedRun = foldRuns(
		[row("t1"), custom("j1", "job_result"), custom("j2", "job_result")],
		receiptOptions,
	)[0];
	assert.equal(foldedRun.kind, "run");

	// The shrink: this pass paints no group at all, and the store still holds t1.
	const shrunk = latchFoldedRuns(
		new Set(["t1", "j1", "j2"]),
		new Set(["t1", "j1", "j2", "elsewhere"]),
		[],
	);
	assert.deepEqual(
		[...shrunk].sort(),
		["j1", "j2", "t1"],
		"a pass with no run on screen does not forget the run it painted",
	);

	// The record leaves the store: the latch forgets it.
	const dropped = latchFoldedRuns(new Set(["t1", "j1"]), new Set(["t1"]), []);
	assert.deepEqual(
		[...dropped],
		["t1"],
		"only ids the store still holds survive",
	);

	// And a fresh fold joins the set.
	const joined = latchFoldedRuns(
		new Set(["t1"]),
		new Set(["t1", "x1", "x2", "x3"]),
		foldRuns([row("x1"), row("x2"), row("x3")], receiptOptions),
	);
	assert.deepEqual(
		[...joined].sort(),
		["t1", "x1", "x2", "x3"],
		"what this pass folded is added, not substituted",
	);
});

test("a live run keeps the fold it has painted: a job response cannot reopen it (operator report, 2026-10-21)", () => {
	/*
	 * THE OSCILLATION. The licensing rule is positional ("the run's TRAILING
	 * receipt stretch"), and a positional rule is not monotonic under append, so
	 * one continuous run used to change shape on every job response:
	 *
	 *   [t1, j1, j2]                    -> fold        (bar over 3 rows)
	 *   [t1, j1, j2, t2]                -> ordinary rows (the call ended the stretch)
	 *   [t1, j1, j2, t2, j3, j4]        -> fold again
	 *
	 * The operator sees the group force itself open and close back, repeatedly,
	 * with no reader action. While the turn is live, a run this pane has already
	 * painted folded keeps folding; the latch records that fact and nothing else.
	 */
	const tools = (n, prefix = "t") =>
		Array.from({ length: n }, (_, index) => row(`${prefix}${index}`));
	const jobs = (n, prefix = "j") =>
		Array.from({ length: n }, (_, index) =>
			custom(`${prefix}${index}`, "job_result"),
		);

	const liveOptions = (latchedFoldIds) => ({
		...receiptOptions,
		liveTurn: true,
		latchedFoldIds,
	});

	const first = foldRuns([...tools(1), ...jobs(2)], liveOptions(new Set()));
	assert.equal(first.length, 1, "the wall folds on its trailing stretch");
	assert.equal(first[0].kind, "run");
	const latched = new Set(first[0].rows.map((row) => row.record.id));

	const grew = [...tools(1), ...jobs(2), ...tools(1, "t2")];
	const afterCall = foldRuns(grew, liveOptions(latched));
	assert.equal(
		afterCall.length,
		1,
		"the call that ends the receipt stretch does not dissolve the fold",
	);
	assert.equal(
		afterCall[0].rows.length,
		4,
		"the fold grew to hold the new call instead of opening",
	);
	assert.deepEqual(
		afterCall[0].summary.units,
		["2 shell", "2 job results"],
		"and its header counts the new call",
	);

	const withMore = [...grew, ...jobs(2, "j3")];
	assert.equal(
		foldRuns(withMore, liveOptions(latched)).length,
		1,
		"a further pair of job responses does not refold from scratch",
	);

	/*
	 * THE LATCH IS LIVE-ONLY. On a settled list no latch is read, so the final
	 * rows alone decide - including the head-pair negatives below, which must
	 * stay ordinary rows.
	 */
	assert.deepEqual(
		foldRuns(grew, receiptOptions).map((group) => group.kind),
		["row", "row", "row", "row"],
		"a settled run with one trailing-free call stays ordinary rows",
	);

	/*
	 * AND THE HEAD-PAIR NEGATIVES HOLD LIVE TOO (agent review round 1, F2). The
	 * change's only new input is live-only, so the pin has to be asked of a LIVE
	 * pass with an empty latch: two receipts at the head still license nothing,
	 * which is what keeps a call mountable for the turn bar. The latch can only
	 * hold a shape this pane has ALREADY painted folded - it never licenses a
	 * first fold - so these are unreachable from it on a fresh pass.
	 */
	for (const [label, rows] of [
		["peer, peer, tool", [peerReceipt("p1"), peerReceipt("p2"), row("a")]],
		["peer, tool, wake", [peerReceipt("p1"), row("a"), wakeReceipt("w1")]],
		["peer, tool, peer", [peerReceipt("p1"), row("a"), peerReceipt("p2")]],
	]) {
		assert.deepEqual(
			foldRuns(rows, liveOptions(new Set())).map((group) => group.kind),
			rows.map(() => "row"),
			`${label} stays ordinary rows on a live pass with no latch`,
		);
	}
});

test("a run folds on its TRAILING receipt stretch, never a head pair", () => {
	/*
	 * The operator's wall leaves `[call, receipt, receipt…]`: the work first,
	 * then what it was told. Two adjacent receipts at the TAIL license the fold
	 * below §E2's action threshold, while a receipt at the HEAD licenses
	 * nothing - the 129-owner shape in `turn-collapse-behaviour.test.mjs` is
	 * exactly `[peer, peer, tool]`, and folding that would hide the call the
	 * reader's opened turn bar is pinned to mount.
	 */
	const tools = (n, prefix = "t") =>
		Array.from({ length: n }, (_, index) => row(`${prefix}${index}`));
	const jobs = (n, prefix = "j") =>
		Array.from({ length: n }, (_, index) =>
			custom(`${prefix}${index}`, "job_result"),
		);

	// The action threshold is already met here; the receipts join the same run.
	const wall = foldRuns([...tools(2), ...jobs(5)], receiptOptions);
	assert.equal(wall.length, 1, "two tools and five job results are one group");
	assert.equal(wall[0].actions.length, 2, "five receipts are never actions");
	assert.deepEqual(wall[0].summary.units, ["2 shell", "5 job results"]);

	// Below the action threshold, the trailing stretch alone licenses the fold.
	const tail = foldRuns([...tools(1), ...jobs(2)], receiptOptions);
	assert.equal(tail.length, 1, "one call followed by two receipts folds");
	assert.deepEqual(tail[0].summary.units, ["1 shell", "2 job results"]);
	assert.deepEqual(
		foldRuns(jobs(2), receiptOptions)[0].summary.units,
		["2 job results"],
		"a whole-run receipt wall is the same rule with no action side",
	);

	// Negatives: only the RUN'S TAIL licenses the fold.
	for (const [label, rows] of [
		["peer, tool, wake", [peerReceipt("p1"), row("a"), wakeReceipt("w1")]],
		["peer, peer, tool", [peerReceipt("p1"), peerReceipt("p2"), row("a")]],
		["peer, tool, peer", [peerReceipt("p1"), row("a"), peerReceipt("p2")]],
	]) {
		assert.deepEqual(
			foldRuns(rows, receiptOptions).map((group) => group.kind),
			rows.map(() => "row"),
			`${label} stays ordinary rows: only a trailing stretch licenses the fold`,
		);
	}

	const lone = foldRuns(
		[...tools(2), custom("j1", "job_result")],
		receiptOptions,
	);
	assert.deepEqual(
		lone.map((group) => group.kind),
		["row", "row", "row"],
		"one trailing receipt beside two actions is still three ordinary rows",
	);
});

test("every receipt in a mixed run is counted exactly once", () => {
	const rows = [
		peerReceipt("p1"),
		custom("h1", "hub_message"),
		custom("j1", "job_result"),
		custom("j2", "job_result"),
		wakeReceipt("w1"),
		custom("m1", "monitor_prompt"),
		row("a"),
		row("b"),
		row("c"),
	];
	const groups = foldRuns(rows, receiptOptions);
	assert.equal(groups.length, 1);
	const units = groups[0].summary.units;
	const counted = units
		.filter((unit) =>
			/^\d+ (incoming|job result|wake|monitor prompt)/.test(unit),
		)
		.reduce((total, unit) => total + Number(unit.split(" ")[0]), 0);
	const receipts = rows.filter((r) => isInternalReceipt(r.record)).length;
	assert.equal(
		counted,
		receipts,
		"the header's numbers equal the number of receipt rows behind the fold",
	);
	assert.deepEqual(units, [
		"3 shell",
		"2 incoming messages",
		"2 job results",
		"1 wake receipt",
		"1 monitor prompt",
	]);
});

test("an unknown receipt family is counted as `other receipts`, never dropped", () => {
	/*
	 * `receiptFoldUnits` and `receiptFamilyOf` are separate tables: a future
	 * receipt kind classified but not yet given a unit would make the header's
	 * numbers stop summing to the rows behind the fold. The fallback is the
	 * count of rows no known family claimed, placed before the intent markers.
	 */
	assert.deepEqual(receiptFoldUnits([custom("f1", "future_receipt")]), [
		"1 other receipt",
	]);
	assert.deepEqual(
		receiptFoldUnits([
			custom("f1", "future_receipt"),
			custom("f2", "future_receipt"),
			custom("j1", "job_result"),
		]),
		["1 job result", "2 other receipts"],
		"known families keep their units and the remainder is stated",
	);
	assert.deepEqual(
		receiptFoldUnits([
			custom("f1", "future_receipt", { receipt: { expectsReply: true } }),
		]),
		["1 other receipt", "Reply requested"],
		"the fallback sits with the family units, before the intent markers",
	);
});

test("internal receipt classification is structural, and stays narrow", () => {
	for (const record of [
		{ kind: "peer" },
		{ kind: "wake" },
		{ kind: "custom", customType: "hub_message" },
		{ kind: "custom", customType: "job_result" },
		{ kind: "custom", customType: "monitor_prompt" },
	]) {
		assert.equal(
			isInternalReceipt(record),
			true,
			`${JSON.stringify(record)} is internal traffic`,
		);
	}
	for (const record of [
		{ kind: "custom", customType: "session_incident" },
		{ kind: "custom", customType: "session_mcp_unavailable" },
		{ kind: "custom", customType: "code_request_event.v1" },
		{ kind: "notice" },
		{ kind: "assistant" },
		{ kind: "supplement" },
	]) {
		assert.equal(
			isInternalReceipt(record),
			false,
			`${JSON.stringify(record)} remains a boundary`,
		);
	}
	assert.equal(receiptFamilyOf({ kind: "wake" }), "wake");
	assert.equal(
		receiptFamilyOf({ kind: "custom", customType: "job_result" }),
		"job_result",
	);
	assert.equal(
		receiptFamilyOf({ kind: "custom", customType: "monitor_prompt" }),
		"monitor_prompt",
	);
});

test("three or more consecutive actions fold; two do not", () => {
	// The threshold is §E2's, and it is asserted as a number so the component and
	// this test cannot disagree about what "a run" means.
	assert.equal(FOLD_MIN_ACTIONS, 3);

	const options = {
		nameOf: (r) => r.record.name ?? "bash",
		failedOf: () => false,
		isFoldable: (r) => r.record.kind === "tool",
	};
	const three = foldRuns(
		[opening("t0"), row("t1"), row("t2"), row("t3")],
		options,
	);
	/*
	 * THE TURN'S OPENING ACTION IS IN THE RUN (design round 1, D8). It used to be
	 * left outside, so the transcript drew a standalone `read` above `7 actions`
	 * while the turn's foot said `8 actions`: two counts for one turn.
	 */
	assert.deepEqual(
		three.map((group) => group.kind),
		["run"],
		"the opening action and the three after it fold into one summary line",
	);
	assert.equal(three[0].rows.length, 4, "the fold holds the whole run");
	assert.equal(three[0].id, "t0", "the fold is keyed by its FIRST row");
	assert.equal(
		three[0].gap,
		"turn",
		"the fold carries the gap its first row arrived with",
	);

	const two = foldRuns([opening("t0"), row("t1")], options);
	assert.deepEqual(
		two.map((group) => group.kind),
		["row", "row"],
		"two actions are two rows: a summary line for two hides more than it says",
	);
});

test("the fold is a view, never a reorder", () => {
	/*
	 * The rows come back in the order they arrived, always. Branding §7's placement
	 * rule is the reason, and the transcript's own `applyLiveSeed`/`withTimeOrder`
	 * guard depends on it: a fold that sorted its rows would reorder the transcript
	 * while leaving every record id in place, which is the kind of change no
	 * ordering assertion downstream can see.
	 */
	const options = {
		nameOf: () => "read",
		failedOf: () => false,
		isFoldable: (r) => r.record.kind === "tool",
	};
	const rows = [
		opening("t0"),
		row("t1"),
		row("t2"),
		row("t3"),
		row("t4"),
		opening("u1"),
		row("t5"),
		row("t6"),
		row("t7"),
	];
	const groups = foldRuns(rows, options);
	const flattened = groups.flatMap((group) =>
		group.kind === "run"
			? group.rows.map((r) => r.record.id)
			: [group.row.record.id],
	);
	assert.deepEqual(
		flattened,
		rows.map((r) => r.record.id),
		"every row keeps its position, folded or not",
	);
	assert.deepEqual(
		groups.filter((group) => group.kind === "run").map((group) => group.id),
		["t0", "u1"],
		"a new turn opens a new run rather than joining the one above it",
	);
});

test("a receipt, a statement or an unknown row breaks a run", () => {
	/*
	 * Folding is for ACTIONS (§E2). A receipt inside a fold would be a message the
	 * reader never saw, and a statement (prose, a notice) between two calls is the
	 * agent talking - summarising across it would hide the sentence behind a count
	 * of the calls around it.
	 */
	const options = {
		nameOf: () => "bash",
		failedOf: () => false,
		isFoldable: (r) => r.record.kind === "tool",
	};
	const rows = [
		opening("t0"),
		row("t1"),
		row("t2"),
		row("r1"),
		row("t3"),
		row("t4"),
	];
	// `r1` is not a tool, so it is not foldable and it splits the run in two.
	rows[3] = {
		record: { id: "r1", kind: "peer" },
		gap: "trace",
		closesTurn: false,
	};
	const groups = foldRuns(rows, options);
	assert.deepEqual(
		groups.map((group) => group.kind),
		["run", "row", "row", "row"],
		"the three actions before the receipt fold; the receipt and the two after it do not",
	);
	assert.equal(groups[1].row.record.id, "r1", "the receipt is its own row");
});

/* ------------------------------ the copy -------------------------------- */

test("the summary is generated from the counts by class", () => {
	const files = (n) =>
		Array.from({ length: n }, () => ({ name: "read", failed: false }));
	const searches = (n) =>
		Array.from({ length: n }, () => ({ name: "web_fetch", failed: false }));
	const commands = (n) =>
		Array.from({ length: n }, () => ({ name: "bash", failed: false }));
	const edits = (n) =>
		Array.from({ length: n }, () => ({ name: "write", failed: false }));
	const web = (n) =>
		Array.from({ length: n }, () => ({
			name: "search_the_web",
			failed: false,
		}));
	const evals = (n) =>
		Array.from({ length: n }, () => ({ name: "eval", failed: false }));
	const agentViews = (n) =>
		Array.from({ length: n }, () => ({ name: "agent", failed: false }));

	assert.equal(foldSummary(files(4)), "Explored 4 files");
	assert.equal(
		foldSummary(files(1)),
		"Explored 1 file",
		"singular, not `1 files`",
	);
	assert.equal(foldSummary(searches(1)), "1 search");
	assert.equal(foldSummary(searches(3)), "3 searches");
	assert.equal(foldSummary(commands(8)), "Ran 8 commands");
	assert.equal(foldSummary(edits(2)), "Edited 2 files");
	assert.equal(foldSummary(web(2)), "Searched the web 2 times");
	// §E2's own example, and the shape a reader can act on.
	assert.equal(
		foldSummary([...files(4), ...searches(1)]),
		"Explored 4 files, 1 search",
		"two phraseable classes join into one sentence",
	);
	// Three classes have no honest sentence: the run falls to the per-KIND
	// counts instead of a bare total (operator report, 2026-09-26: `4 actions`
	// told a reader nothing - "3 shell · 1 python" is what the run looked like).
	assert.equal(
		foldSummary([...files(1), ...commands(1), ...edits(1)]),
		"1 file · 1 shell · 1 edit",
	);
	assert.equal(
		foldSummary([...commands(3), ...evals(1)]),
		"3 shell · 1 python",
		"the command kinds split by runtime - the operator's own example",
	);
	assert.equal(
		foldSummary([...evals(1), ...commands(3)]),
		"3 shell · 1 python",
		"the counts do not depend on which call came first",
	);
	assert.equal(
		foldSummary([...files(2), ...commands(3), ...evals(1)]),
		"2 files · 3 shell · 1 python",
	);
	assert.equal(
		foldSummary([
			{ name: "mcp__linear_create_issue", failed: false },
			{ name: "read", failed: false },
			{ name: "read", failed: false },
		]),
		"2 files · 1 create_issue",
		"an unclassified action counts under its own name, never another class's",
	);
	// The order of the sentence is the table's, not the calls': the same three
	// actions in a different arrival order say the same thing.
	assert.equal(
		foldSummary([...searches(1), ...files(4)]),
		"Explored 4 files, 1 search",
		"the copy does not depend on which call came first",
	);
	/*
	 * THE OPERATOR'S OWN SHAPE (2026-09-27): four file reads and three agent
	 * profile READS. `agent` used to be filed with `task` as delegation, so
	 * this exact run read `Explored 4 files, delegated 3 tasks`; with the op
	 * tier no class sentence is claimed for it, and the run falls to the counts
	 * by kind under the noun the calls touched - the same fallback an unknown
	 * name takes, with a plural (`3 agent` was never a sentence).
	 */
	assert.equal(
		foldSummary([...files(4), ...agentViews(3)]),
		"4 files · 3 agents",
	);
	assert.equal(foldSummary(agentViews(3)), "3 agents");
	assert.equal(
		foldSummary(agentViews(1)),
		"1 agent",
		"singular, not `1 agents`",
	);
});

test("the count line names the kinds in the app's own vocabulary", () => {
	// Directly, so the vocabulary is pinned rather than only its callers: shell
	// for the command runners, python for `eval` (the noun its row verb
	// already carries), the class nouns otherwise, the known builtins' own
	// counted nouns (`KIND_NOUNS`, added for the 2026-09-27 report), and display
	// names for what the tables cannot classify.
	assert.equal(
		foldCounts([
			{ name: "bash", failed: false },
			{ name: "bash", failed: false },
			{ name: "eval", failed: false },
			{ name: "web_fetch", failed: false },
			{ name: "task", failed: false },
		]),
		"1 search · 2 shell · 1 python · 1 task",
	);
	// The kinds the report named, with their plurals.
	assert.equal(
		foldCounts([
			{ name: "agent", failed: false },
			{ name: "agent", failed: false },
			{ name: "hub", failed: false },
			{ name: "send", failed: false },
		]),
		"2 agents · 1 subagent · 1 message",
	);
	assert.equal(
		foldCounts([{ name: "team", failed: false }]),
		"1 team",
		"a known kind singularizes through its noun",
	);
	assert.equal(
		foldCounts([{ name: "team_delete", failed: false }]),
		"1 team deletion",
		"a delete counts under its own noun, never a bare wire name",
	);
	// A run of `sessions` calls counts under its own noun, singular and
	// plural (the trace-sessions lane): without the entry the pluralized
	// fallback printed `1 sessions`, which is not a sentence either.
	assert.equal(
		foldCounts([
			{ name: "sessions", failed: false },
			{ name: "sessions", failed: false },
		]),
		"2 sessions",
	);
	assert.equal(
		foldCounts([{ name: "sessions", failed: false }]),
		"1 session",
		"a session singularizes through its noun",
	);
	/* A `jobs` poll is a CHECK on a background job, never the result itself: the
	 * receipt family now prints `N job results`, and a poll that counted as
	 * `1 job` would read as the same unit one row above. */
	assert.equal(
		foldCounts([
			{ name: "jobs", failed: false },
			{ name: "jobs", failed: false },
		]),
		"2 job checks",
	);
	assert.equal(foldCounts([{ name: "jobs", failed: false }]), "1 job check");
	assert.equal(
		foldCounts([
			{ name: "jobs", op: "list", failed: false },
			{ name: "jobs", op: "peek", failed: false },
		]),
		"2 job checks",
		"list and peek are checks on a job",
	);
	// `jobs cancel` stopped a job; the row verb is a cancellation and the fold
	// says so (review round 1, R1-1), rather than claiming the run looked at it.
	assert.equal(
		foldCounts([{ name: "jobs", op: "cancel", failed: false }]),
		"1 job cancellation",
	);
	assert.equal(
		foldCounts([
			{ name: "jobs", op: "CANCEL", failed: false },
			{ name: "jobs", op: "cancel", failed: false },
		]),
		"2 job cancellations",
		"the op is case-folded like every other wire token",
	);
	// `todo view` is a READ; counting it as an update was the false claim
	// review round 1 closed (R1-6), so the family splits by op.
	assert.equal(
		foldCounts([
			{ name: "todo", failed: false, op: "view" },
			{ name: "todo", failed: false, op: "done" },
			{ name: "todo", failed: false, op: "done" },
		]),
		"2 todo updates · 1 todo read",
		"a view is not an update",
	);
	assert.equal(
		foldCounts([
			{ name: "todo", failed: false, op: "VIEW" },
			{ name: "todo", failed: false, op: "add" },
		]),
		"1 todo read · 1 todo update",
		"the op is case-folded like every other wire token",
	);
	assert.equal(
		foldCounts([{ name: "todo", failed: false }]),
		"1 todo update",
		"an op-less call keeps the family's write noun",
	);
	assert.equal(
		foldCounts([{ name: "read", failed: false }]),
		"1 file",
		"the class nouns are untouched",
	);
	assert.equal(foldCounts([]), "0 actions", "only reachable for an empty run");
});

test("the count line caps its segments and folds the tail into `and N other actions`", () => {
	/*
	 * THE OPERATOR'S OWN LINE (2026-10-01, relayed by Aida), as the FIRST case:
	 * the run whose header read `6 searches · 1 task · 2 browser actions · 1
	 * ai_search · 1 get_tool_access · 1 query_data_sources · 1 todo update · 1
	 * wait · 1 workspace_get_gmail_thread_content` - nine unique action types,
	 * wider than the column at every realistic window. Six fetches carry the
	 * `searches` class; the rest are one task, two browser calls and the four
	 * singletons the operator named.
	 */
	const many = [
		...Array.from({ length: 6 }, () => ({ name: "web_fetch", failed: false })),
		{ name: "task", failed: false },
		...Array.from({ length: 2 }, () => ({
			name: "browser",
			failed: false,
		})),
		{ name: "ai_search", failed: false },
		{ name: "get_tool_access", failed: false },
		{ name: "query_data_sources", failed: false },
		{ name: "todo", op: "add", failed: false },
		{ name: "wait", failed: false },
		{ name: "workspace_get_gmail_thread_content", failed: false },
	];
	assert.equal(
		foldSummary(many),
		"6 searches · 1 task · 2 browser actions · 1 ai_search · 1 get_tool_access · and 4 other actions",
		"five segments are kept in the line's own order; the four hidden CALLS make the tail",
	);
	/*
	 * THE CAP IS `FOLD_COUNT_LIMIT` SEGMENTS SHOWN, and every shorter shape is
	 * byte-identical to what it was before the cap - which is what the rest of
	 * this file's expectations already witness (none of them exceeds five
	 * segments, and all of them still pass unedited).
	 */
	assert.equal(FOLD_COUNT_LIMIT, 5, "the cap is pinned as a number");

	const files = (n) =>
		Array.from({ length: n }, () => ({ name: "read", failed: false }));
	const searches = (n) =>
		Array.from({ length: n }, () => ({ name: "web_fetch", failed: false }));
	const web = (n) =>
		Array.from({ length: n }, () => ({
			name: "search_the_web",
			failed: false,
		}));
	const commands = (n) =>
		Array.from({ length: n }, () => ({ name: "bash", failed: false }));
	const evals = (n) =>
		Array.from({ length: n }, () => ({ name: "eval", failed: false }));
	const edits = (n) =>
		Array.from({ length: n }, () => ({ name: "write", failed: false }));

	// AT the cap: five segments is still every segment, no tail.
	assert.equal(
		foldCounts([
			...files(1),
			...searches(1),
			...web(1),
			...commands(1),
			...evals(1),
		]),
		"1 file · 1 search · 1 web search · 1 shell · 1 python",
	);
	// ONE past the cap: the sixth segment folds, and the tail singularises.
	assert.equal(
		foldCounts([
			...files(1),
			...searches(1),
			...web(1),
			...commands(1),
			...evals(1),
			...edits(1),
		]),
		"1 file · 1 search · 1 web search · 1 shell · 1 python · and 1 other action",
	);
	/*
	 * THE TAIL COUNTS CALLS, NOT TYPES: three edits hide behind one segment, and
	 * the tail states three - the same unit the bar's `N actions` and the foot's
	 * `N actions` count, so a reader who sums the kept segments and the tail
	 * still reaches the turn's action count.
	 */
	assert.equal(
		foldCounts([
			...files(1),
			...searches(1),
			...web(1),
			...commands(1),
			...evals(1),
			...edits(3),
		]),
		"1 file · 1 search · 1 web search · 1 shell · 1 python · and 3 other actions",
	);
	/*
	 * THE UNITS ARE THE MODEL'S, NOT THE RENDERER'S (design round 1, D1). The
	 * header paints one unbreakable span per unit so a wrap can only fall at a
	 * ` · ` - which means the line's composition has to be stated here, where the
	 * cap is applied, rather than recovered by splitting a display string. The
	 * tail is ONE unit: `and 4 other actions` is a single fact and the frame that
	 * broke it between the numeral and its noun is the defect these assert against.
	 */
	const capped = [
		...files(1),
		...searches(1),
		...web(1),
		...commands(1),
		...evals(1),
		...edits(3),
	];
	assert.deepEqual(
		foldCountUnits([
			{ label: "1 file", count: 1 },
			{ label: "1 search", count: 1 },
			{ label: "1 web search", count: 1 },
			{ label: "1 shell", count: 1 },
			{ label: "1 python", count: 1 },
		]),
		["1 file", "1 search", "1 web search", "1 shell", "1 python"],
		"at the cap the units ARE the segments' labels",
	);
	assert.deepEqual(
		foldCountUnits([
			{ label: "1 file", count: 1 },
			{ label: "1 search", count: 1 },
			{ label: "1 web search", count: 1 },
			{ label: "1 shell", count: 1 },
			{ label: "1 python", count: 1 },
			{ label: "3 edits", count: 3 },
		]),
		[
			"1 file",
			"1 search",
			"1 web search",
			"1 shell",
			"1 python",
			"and 3 other actions",
		],
		"past the cap the tail is ONE unit, and it counts CALLS",
	);
	assert.equal(
		foldSummaryUnits(capped).at(-1),
		"and 3 other actions",
		"the tail is ONE unit, so it cannot break inside itself",
	);
	assert.equal(
		foldSummaryUnits(capped).join(" · "),
		foldCounts(capped),
		"the string consumers read is the units joined, so the two cannot drift",
	);
	assert.deepEqual(
		foldSummaryUnits(files(4)),
		["Explored 4 files"],
		"and a SENTENCE is one unit",
	);
	/*
	 * THE SHAPE IS PART OF THE CONTRACT (agent review round 2, R2-1): the header
	 * cannot infer it from the unit count, because a one-segment count line
	 * (`6 searches`) is ALSO one unit and MUST stay whole, while the sentence's
	 * clause must break at its own spaces. So the model states which it is, and
	 * these assertions are what keep the renderer honest about it.
	 */
	assert.equal(
		foldSummarySpec(files(4)).prose,
		true,
		"a class sentence is prose: its own spaces are the right breaks",
	);
	assert.equal(
		foldSummarySpec([...commands(3), ...evals(1)]).prose,
		false,
		"a one-class-of-kind count line is NOT prose: it must hold together",
	);
	assert.equal(
		foldSummarySpec(capped).prose,
		false,
		"nor is the capped line, whose tail phrase may never split",
	);
	assert.equal(
		foldSummarySpec(capped).units.join(" · "),
		foldSummary(capped),
		"and the joined string consumers read is still these units",
	);
});

test("the action classes are the ledgers' own names, case-folded", () => {
	// `Web_Fetch` is a real wire name; a case-sensitive table classified it as
	// unknown and the summary silently degraded to a count.
	assert.equal(actionClass("Web_Fetch"), "searches");
	assert.equal(actionClass("read"), "files");
	assert.equal(actionClass("search_the_web"), "web");
	assert.equal(actionClass("bash"), "commands");
	assert.equal(actionClass("write"), "edits");
	// ONLY the calls that hand work off are delegation (`task`, `delegate`).
	assert.equal(actionClass("task"), "delegated");
	// `agent` was filed here too and every profile READ was reported as a
	// delegated task (operator report, 2026-09-27); it is no class now, which
	// is what sends it to the counts by kind (`4 files · 3 agents`).
	assert.equal(actionClass("agent"), null);
	assert.equal(actionClass("hub"), null);
	assert.equal(actionClass("team"), null);
	assert.equal(actionClass("mcp__linear_create_issue"), null);
});

/* ------------------------- the run's own clock -------------------------- */

test("the span is last completion minus first start, gaps included", () => {
	/*
	 * The operator's definition (2026-09-26), and the right one: a SUM of the
	 * rows' durations ignored the gaps between calls (the model ran `0s` beside
	 * a run of fast ones while the rows showed real tenths), while the span is
	 * what "how long was spent in that action group" means.
	 *
	 * A settled action's start is reconstructed as `endedAtMs - durationS *
	 * 1000`, which is the same span the record's own fields document; the test
	 * states both ends so the arithmetic is readable.
	 */
	assert.deepEqual(
		foldSpan([
			{ name: "read", failed: false, durationS: 2, endedAtMs: 10_000 },
			{ name: "read", failed: false, durationS: 3, endedAtMs: 30_000 },
		]),
		{ startedAtMs: 8_000, endedAtMs: 30_000, running: false },
		"22s across a 19s gap between calls: the gap is spent in the section too",
	);
});

test("a live run keeps its span end open for the caller's clock", () => {
	const settled = [
		{ name: "read", failed: false, durationS: 2, endedAtMs: 10_000 },
		{ name: "read", failed: false, durationS: 3, endedAtMs: 30_000 },
	];
	const span = foldSpan([
		...settled,
		{ name: "bash", failed: false, running: true, startedAtMs: 40_000 },
	]);
	assert.deepEqual(
		span,
		{ startedAtMs: 8_000, endedAtMs: 30_000, running: true },
		"running: the caller renders against now; the last completion is kept for the settle",
	);
	// The first call alone, still in flight: it dates the run from its own start.
	assert.deepEqual(
		foldSpan([
			{ name: "bash", failed: false, running: true, startedAtMs: 5_000 },
		]),
		{ startedAtMs: 5_000, endedAtMs: null, running: true },
	);
});

test("a run that cannot date itself reports null, never zero", () => {
	// A row restored from history: it carries the duration and NO stamps (the
	// durable tool payload persists `duration_s` and no times), so the run has
	// no span - and `0s` would be a claim nothing supports.
	assert.equal(
		foldSpan([{ name: "read", failed: false, durationS: 0.4 }]),
		null,
	);
	// A settled run whose rows carry neither endpoint.
	assert.equal(foldSpan([{ name: "bash", failed: false }]), null);
	// A running row with no start stamp cannot date the run either.
	assert.equal(
		foldSpan([{ name: "bash", failed: false, running: true }]),
		null,
	);
});

/* --------------------------- the live clause ---------------------------- */

test("the live clause names the call being watched, in the row's words", () => {
	assert.equal(
		foldLive([
			{ name: "read", failed: false, durationS: 1, endedAtMs: 10_000 },
		]),
		null,
		"nothing in flight, nothing to name",
	);
	assert.deepEqual(
		foldLive([
			{ name: "read", failed: false, summary: "src/a.ts" },
			{
				name: "bash",
				failed: false,
				running: true,
				executing: true,
				summary: "pnpm vitest run",
			},
		]),
		{ verb: "Running", object: "pnpm vitest run" },
	);
	/*
	 * COMPOSING AND QUEUED NAME NOTHING (UX round 1, U2): they are `running`
	 * (unsettled - the condense guard still honours them) but not `executing`,
	 * and the first cut painted `Running composing` then `Running queued · 22 B`
	 * in the sub-second windows before a call's name resolves - a claim nothing
	 * is running yet, about the wire's byte count, in the window the operator
	 * reads the header for.
	 */
	assert.equal(
		foldLive([
			{ name: "bash", failed: false, running: true, summary: "composing" },
		]),
		null,
		"a call still being dictated is not named",
	);
	assert.equal(
		foldLive([
			{
				name: "bash",
				failed: false,
				running: true,
				summary: "queued · 22 B",
			},
		]),
		null,
		"nor is one waiting to start, whose object is a byte count",
	);
	// A sibling still composing does not displace the call being watched: the
	// LAST EXECUTING call is the one named.
	assert.deepEqual(
		foldLive([
			{
				name: "bash",
				failed: false,
				running: true,
				executing: true,
				summary: "pnpm vitest run",
			},
			{ name: "bash", failed: false, running: true, summary: "composing" },
		]),
		{ verb: "Running", object: "pnpm vitest run" },
	);
	// `wait` names its own subject since the audit added it to the table:
	// `Waiting for jobs`, with the job id as the object - the long block a
	// collapsed header exists to surface.
	assert.deepEqual(
		foldLive([
			{
				name: "wait",
				failed: false,
				running: true,
				executing: true,
				summary: "3600000",
			},
		]),
		{ verb: "Waiting for jobs", object: "3600000" },
	);
	/*
	 * An op-aware call is named in its own row's words: the clause lifts the
	 * row's composition (`toolRowLabel`), and that reads the operation now -
	 * `Viewing agent designer`, never the family's old `Delegating`, which is
	 * the same fix the row itself got (operator report, 2026-09-27).
	 */
	assert.deepEqual(
		foldLive([
			{
				name: "agent",
				failed: false,
				running: true,
				executing: true,
				summary: "designer",
				op: "show",
			},
		]),
		{ verb: "Viewing agent", object: "designer" },
	);
	// `eval` carries its own noun: `Ran Python` settled, `Running Python` live.
	assert.deepEqual(
		foldLive([
			{
				name: "eval",
				failed: false,
				running: true,
				executing: true,
				summary: "build.py",
			},
		]),
		{ verb: "Running Python", object: "build.py" },
	);
});

/* ----------------------------- the foot line ---------------------------- */

test("a turn's foot counts its own actions, and names its first failure", () => {
	const rows = [
		{ record: { id: "u1", kind: "user" }, gap: "turn", closesTurn: false },
		{ record: { id: "t1", kind: "tool" }, gap: "trace", closesTurn: false },
		{ record: { id: "t2", kind: "tool" }, gap: "trace", closesTurn: false },
		{ record: { id: "t3", kind: "tool" }, gap: "trace", closesTurn: false },
		{ record: { id: "a1", kind: "assistant" }, gap: "item", closesTurn: true },
		{ record: { id: "u2", kind: "user" }, gap: "turn", closesTurn: false },
		{ record: { id: "t4", kind: "tool" }, gap: "trace", closesTurn: false },
		{ record: { id: "a2", kind: "assistant" }, gap: "item", closesTurn: true },
	];
	const feet = turnFeet(rows, {
		failedOf: () => false,
		durationOf: (r) =>
			r.record.id === "t1" ? 72 : r.record.id === "t2" ? 12 : null,
		isAction: (r) => r.record.kind === "tool",
	});
	assert.deepEqual(
		feet.get("a1"),
		{ actions: 3, failed: 0, durationS: 84, firstFailedId: null },
		"the first turn reports the three actions above it, not the whole conversation",
	);
	assert.deepEqual(
		feet.get("a2"),
		{ actions: 1, failed: 0, durationS: null, firstFailedId: null },
		"the second turn starts its own tally",
	);

	const withFailure = turnFeet(rows, {
		failedOf: (r) => r.record.id === "t2" || r.record.id === "t3",
		durationOf: () => null,
		isAction: (r) => r.record.kind === "tool",
	});
	assert.deepEqual(
		withFailure.get("a1"),
		{ actions: 3, failed: 2, durationS: null, firstFailedId: "t2" },
		"the jump names the FIRST failure, which is the row a reader wants opened",
	);
});

/* --------------------------- the run's pictures --------------------------- */

/**
 * A row as `foldImages` reads it: the record's kind is what decides, and the
 * image list is the record's own.
 */
test("receipt-owned image refs survive a mixed fold in source order", () => {
	const receipt = {
		record: {
			id: "h",
			kind: "custom",
			customType: "hub_message",
			images: [picture("h:0")],
		},
		gap: "trace",
		closesTurn: false,
	};
	assert.deepEqual(
		foldImages([
			imageRow("a", [picture("a:0")]),
			receipt,
			imageRow("b", [picture("b:0")]),
		]).map((image) => image.id),
		["a:0", "h:0", "b:0"],
	);
});

const imageRow = (id, images) => ({
	record: { id, kind: "tool", images },
	gap: "trace",
	closesTurn: false,
});

const picture = (id) => ({
	id,
	data: null,
	attachment: `digest-${id}`,
	mimeType: "image/png",
});

test("a run's images are its actions' images, in row order", () => {
	/*
	 * The condensed group carries these because it unmounts the rows that would
	 * draw them, so the order is a claim about the group and not an accident of
	 * iteration: a run that wrote two screenshots shows them in the order they
	 * were written, which is the order the expanded rows show.
	 */
	const rows = [
		imageRow("t1", [picture("t1:0")]),
		{ record: { id: "n1", kind: "notice" }, gap: "trace", closesTurn: false },
		imageRow("t2", [picture("t2:0"), picture("t2:1")]),
	];
	assert.deepEqual(
		foldImages(rows).map((image) => image.id),
		["t1:0", "t2:0", "t2:1"],
	);
});

test("a run with no pictures yields none, and a user row never contributes", () => {
	/*
	 * `images` is a field on user records too — attachments the reader pasted
	 * into their prompt are not the agent's output, and a run that happened to
	 * sit below one must not adopt them.
	 */
	const rows = [
		imageRow("t1", []),
		{
			record: { id: "u1", kind: "user", images: [picture("u1:0")] },
			gap: "turn",
			closesTurn: false,
		},
		imageRow("t2", []),
	];
	assert.deepEqual(foldImages(rows), []);
});

test("the strip's slots are one row, and past the cap the last of them is the count", () => {
	/*
	 * Design review round 1, D3: height grew with the count and had no cap, so
	 * 25-30 pictures put a CONDENSED group past the height of the expanded one it
	 * replaces. The cap is the row the strip can hold at the narrowest column it
	 * renders in - the rig measured that column at 576px in a 640px window (556px of
	 * strip after the indent), and on the 117px tile four tiles, four 8px gutters
	 * and a count of at most 41.4px are 541.4px - and past it the last slot is `+N`.
	 */
	assert.deepEqual(foldMediaSlots(0), { shown: 0, more: 0 });
	assert.deepEqual(foldMediaSlots(1), { shown: 1, more: 0 });
	// The last count that fits as tiles: FOUR, because the 117px tile makes five
	// (617px) wider than the 556px column.
	assert.deepEqual(foldMediaSlots(FOLD_MEDIA_LIMIT - 1), {
		shown: FOLD_MEDIA_LIMIT - 1,
		more: 0,
	});
	// The boundary: the first count that needs the count slot is the LIMIT itself
	// (five pictures draw four tiles and a `+1`).
	assert.deepEqual(foldMediaSlots(FOLD_MEDIA_LIMIT), {
		shown: FOLD_MEDIA_LIMIT - 1,
		more: 1,
	});
	assert.deepEqual(foldMediaSlots(FOLD_MEDIA_LIMIT + 1), {
		shown: FOLD_MEDIA_LIMIT - 1,
		more: 2,
	});
	assert.deepEqual(foldMediaSlots(8), { shown: 4, more: 4 });
	assert.deepEqual(foldMediaSlots(30), { shown: 4, more: 26 });
	/*
	 * U8's uncapped case: the spanning bar's sole image-bearing group shows ALL
	 * of its set (the reader's press on the bar's count asked for it), and the
	 * slot arithmetic must then report every picture and no count slot.
	 */
	assert.deepEqual(foldMediaSlots(8, { uncapped: true }), {
		shown: 8,
		more: 0,
	});
	assert.deepEqual(foldMediaSlots(30, { uncapped: true }), {
		shown: 30,
		more: 0,
	});
	assert.deepEqual(foldMediaSlots(0, { uncapped: true }), {
		shown: 0,
		more: 0,
	});
	// Whatever the count, the slots never exceed the row.
	for (const count of [0, 1, 6, 7, 8, 30]) {
		const { shown, more } = foldMediaSlots(count);
		assert.ok(
			shown <= FOLD_MEDIA_LIMIT,
			`${count} pictures must not draw more than one row of slots`,
		);
		assert.equal(shown + more, count, "and no picture is lost from the count");
	}
});

test("the uncapped strip never strands a single tile, and every row is at most one capped row wide (D5)", () => {
	const perRow = FOLD_MEDIA_LIMIT - 1;
	assert.deepEqual(foldMediaRows(0), []);
	assert.deepEqual(
		foldMediaRows(1),
		[1],
		"a lone picture is a row of one: nothing to rebalance",
	);
	assert.deepEqual(foldMediaRows(4), [4]);
	assert.deepEqual(
		foldMediaRows(5),
		[3, 2],
		"a plain 4+1 is the orphan this rule exists to prevent",
	);
	assert.deepEqual(
		foldMediaRows(8),
		[4, 4],
		"eight: the operator's own case, 4+4 (it was 7+1 at 1280px)",
	);
	assert.deepEqual(foldMediaRows(9), [4, 3, 2]);
	for (let count = 2; count <= 60; count += 1) {
		const rows = foldMediaRows(count);
		assert.equal(
			rows.reduce((a, b) => a + b, 0),
			count,
			`${count}: no picture is lost`,
		);
		assert.ok(
			rows.every((n) => n <= perRow),
			`${count}: no row is wider than the capped row`,
		);
		assert.ok(
			rows.every((n) => n >= 2),
			`${count}: no row of one (${rows.join("+")})`,
		);
	}
});

test("the header's image clause names the count, and a run with none has no clause", () => {
	/*
	 * D3's other half: the strip's accessible name carried the number while the
	 * visible header said nothing, so a sighted reader got less than a
	 * screen-reader user. A run with no pictures gets `null` rather than an empty
	 * clause, which is what keeps that header byte-identical.
	 */
	assert.equal(foldMediaClause(0), null, "no pictures, no clause");
	assert.equal(
		foldMediaClause(-1),
		null,
		"and a nonsense count is not a claim",
	);
	assert.equal(
		foldMediaClause(1),
		"1 image",
		'one is an image, not "1 images"',
	);
	assert.equal(foldMediaClause(2), "2 images");
	assert.equal(foldMediaClause(30), "30 images");
});

/* ---------------------------- Team Bridge rows --------------------------- */

/*
 * `bridge` counts like `jobs cancel`: a call that WROTE something a person
 * reads is a `team message` (`kind:bridge:post`), every other op a `team action`
 * (`kind:bridge`). The keys are the cross-surface contract the condense parity
 * fixture pins; the words are this app's own.
 */
test("bridge calls count as team messages or team actions, by op", () => {
	const segments = foldCountSegments([
		{ name: "bridge", op: "channel_post", failed: false },
		{ name: "bridge", op: "dm", failed: false },
		{ name: "bridge", op: "send", failed: false },
		{ name: "bridge", op: "reply", failed: false },
		{ name: "bridge", op: "channel_history", failed: false },
		{ name: "bridge", op: "react-remove", failed: false },
		{ name: "bridge", failed: false },
	]);
	assert.deepEqual(
		segments.map(({ key, count, label }) => [key, count, label]),
		[
			["kind:bridge:post", 4, "4 team messages"],
			["kind:bridge", 3, "3 team actions"],
		],
	);
	assert.equal(
		foldCounts([{ name: "bridge", op: "dm", failed: false }]),
		"1 team message",
	);
	assert.equal(
		foldCounts([{ name: "bridge", op: "directory", failed: false }]),
		"1 team action",
	);
	assert.equal(
		foldCounts([
			{ name: "bridge", op: "channel_post", failed: false },
			{ name: "send", failed: false },
		]),
		// Unlisted kinds sort by count, then noun - `message` before `team message`.
		"1 message · 1 team message",
		"bridge and send stay separate nouns inside one condensed run",
	);
});

test("bridge rows join a tool group and a bridge+send run condenses", () => {
	const tool = (id, name, op) =>
		row(id, "trace", { toolName: name, args: op ? { op } : {} });
	const options = {
		nameOf: (r) => r.record.toolName,
		opOf: (r) => r.record.args?.op ?? "",
		failedOf: () => false,
		durationOf: () => 1,
		isFoldable: (r) => r.record.kind === "tool",
	};
	const groups = foldRuns(
		[
			tool("a", "read"),
			tool("b", "bridge", "channel_post"),
			tool("c", "send"),
			tool("d", "bridge", "channel_history"),
			tool("e", "bridge", "dm"),
		],
		options,
	);
	assert.equal(groups.length, 1, "a bridge row never breaks the group");
	assert.deepEqual(
		groups[0].rows.map((r) => r.record.id),
		["a", "b", "c", "d", "e"],
	);
	assert.deepEqual(
		groups[0].summary.countUnits.map(({ key, count }) => [key, count]),
		[
			["class:files", 1],
			["kind:bridge:post", 2],
			["kind:send", 1],
			["kind:bridge", 1],
		],
	);
});
