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
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/trace-fold-model";',
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
	FOLD_MIN_ACTIONS,
	actionClass,
	foldRuns,
	foldSummary,
	runDuration,
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
	// Three classes have no honest sentence, and neither has an action the table
	// cannot classify: both report the only true thing left.
	assert.equal(
		foldSummary([...files(1), ...commands(1), ...edits(1)]),
		"3 actions",
	);
	assert.equal(
		foldSummary([
			{ name: "mcp__linear_create_issue", failed: false },
			{ name: "read", failed: false },
			{ name: "read", failed: false },
		]),
		"3 actions",
		"an unclassified action is not filed into somebody else's class",
	);
	// The order of the sentence is the table's, not the calls': the same three
	// actions in a different arrival order say the same thing.
	assert.equal(
		foldSummary([...searches(1), ...files(4)]),
		"Explored 4 files, 1 search",
		"the copy does not depend on which call came first",
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
	assert.equal(actionClass("task"), "delegated");
	assert.equal(actionClass("mcp__linear_create_issue"), null);
});

/* ------------------------- the run's own clock -------------------------- */

test("a run reports a duration only when its rows reported one", () => {
	assert.equal(runDuration([{ name: "read", failed: false, durationS: 1 }]), 1);
	assert.equal(
		runDuration([
			{ name: "read", failed: false, durationS: 1 },
			{ name: "read", failed: false, durationS: 2.5 },
		]),
		3.5,
	);
	assert.equal(
		runDuration([{ name: "read", failed: false, durationS: null }]),
		null,
		"no clock in, no clock out - never a 0s claim",
	);
	assert.equal(
		runDuration([
			{ name: "read", failed: false, durationS: 2 },
			{ name: "read", failed: false, durationS: null },
		]),
		2,
		"a row that did not report one is not counted as zero",
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
