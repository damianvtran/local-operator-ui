import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE CHECKPOINT RAIL'S PURE RULES — placement, fallback text, and which
 * requested ids a manifest still shows as pending.
 *
 * The rendered half lives in `scripts/checkpoint-rail.test.mjs`; this file
 * drives the DECISION, which is where the review risks sit: a rail that
 * misrepresents the conversation (ordinal-uniform spacing reading as progress),
 * fallback text that invents a name or a clock the manifest never gave, and a
 * poll stop-condition that keeps waiting on something nothing will answer.
 *
 * The wire fields here are the backend's own (design D9): `ts` is epoch
 * SECONDS — a fixture built in milliseconds would sail through every label
 * assertion wrongly, so the clock cases construct their instant and divide.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/checkpoint-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** One checkpoint, with the fields a case is not about filled in plausibly. */
const checkpoint = (over = {}) => ({
	id: "u1",
	kind: "user",
	turn: 1,
	ts: 1780000000,
	seq: 10,
	text: "a message",
	...over,
});

/** A manifest around a checkpoint list. */
const manifest = (checkpoints) => ({
	session_id: "s1",
	index: { state: "ready" },
	checkpoints,
});

test("ticks are placed by seq, proportionally across the whole conversation", () => {
	const placements = model.checkpointTickPlacement([
		checkpoint({ id: "a", seq: 100 }),
		checkpoint({ id: "b", seq: 150 }),
		checkpoint({ id: "c", seq: 200 }),
	]);
	assert.deepEqual(placements, [
		{ id: "a", fraction: 0 },
		{ id: "b", fraction: 0.5 },
		{ id: "c", fraction: 1 },
	]);
	/*
	 * NOT ordinal-uniform: the distance between a and b (50 seq) and b and c
	 * (50 seq) is equal here on purpose, so a uniform implementation would ALSO
	 * pass this case - it is the next one that discriminates.
	 */
	const skewed = model.checkpointTickPlacement([
		checkpoint({ id: "a", seq: 0 }),
		checkpoint({ id: "b", seq: 90 }),
		checkpoint({ id: "c", seq: 100 }),
	]);
	assert.ok(
		skewed[1].fraction > 0.85,
		`the busy tail must compress toward the bottom (got ${skewed[1].fraction})`,
	);
});

test("a manifest without a span centres its ticks instead of dividing by zero", () => {
	assert.deepEqual(model.checkpointTickPlacement([]), []);
	assert.deepEqual(
		model.checkpointTickPlacement([checkpoint({ id: "only", seq: 42 })]),
		[{ id: "only", fraction: 0.5 }],
	);
	/* Two rows sharing one ordinal is degenerate but legal; neither may NaN. */
	assert.deepEqual(
		model.checkpointTickPlacement([
			checkpoint({ id: "a", seq: 7 }),
			checkpoint({ id: "b", seq: 7 }),
		]),
		[
			{ id: "a", fraction: 0.5 },
			{ id: "b", fraction: 0.5 },
		],
	);
});

test("the accessible name is the two frozen forms, with a real clock", () => {
	/* 2026-09-28 14:32 LOCAL, the unit the journal itself carries. */
	const ts = new Date(2026, 8, 28, 14, 32).getTime() / 1000;
	assert.equal(
		model.checkpointAriaLabel(checkpoint({ ts })),
		"Jump to your message, 2:32 PM",
	);
	assert.equal(
		model.checkpointAriaLabel(
			checkpoint({
				kind: "completion",
				turn: 3,
				naming: { state: "ready", name: "Fix the build", summary: "s" },
			}),
		),
		"Jump to completion: Fix the build",
	);
	assert.equal(
		model.checkpointAriaLabel(
			checkpoint({
				kind: "completion",
				turn: 3,
				naming: { state: "pending", name: null, summary: null },
			}),
		),
		"Jump to completion: Turn 3",
	);
	/* No naming field at all is the same fallback, not a blank. */
	assert.equal(
		model.checkpointAriaLabel(checkpoint({ kind: "completion", turn: 3 })),
		"Jump to completion: Turn 3",
	);
	/* A zero/garbage ts drops the time half rather than printing 12:00 AM. */
	assert.equal(
		model.checkpointAriaLabel(checkpoint({ ts: 0 })),
		"Jump to your message",
	);
});

test("the card's title and summary fall back honestly while naming is pending", () => {
	assert.equal(
		model.checkpointTitle(
			checkpoint({
				kind: "completion",
				turn: 7,
				naming: { state: "pending", name: null, summary: null },
			}),
		),
		"Turn 7",
	);
	assert.equal(
		model.checkpointTitle(
			checkpoint({
				kind: "completion",
				turn: 7,
				naming: { state: "ready", name: "   ", summary: null },
			}),
		),
		"Turn 7",
		"a whitespace name is not a name",
	);
	assert.equal(
		model.checkpointTitle(
			checkpoint({
				kind: "completion",
				turn: 7,
				naming: { state: "ready", name: "Ship the rail", summary: null },
			}),
		),
		"Ship the rail",
	);
	assert.equal(
		model.checkpointNamingPending(
			checkpoint({
				kind: "completion",
				naming: { state: "pending", name: null, summary: null },
			}),
		),
		true,
	);
	assert.equal(
		model.checkpointNamingPending(
			checkpoint({
				kind: "completion",
				naming: { state: "unavailable", name: null, summary: null },
			}),
		),
		false,
		"a failed call is not a pending one - nothing is generating",
	);
	assert.equal(
		model.checkpointSummary(
			checkpoint({
				kind: "completion",
				naming: { state: "ready", name: "n", summary: "" },
			}),
		),
		null,
		"an empty summary renders nothing rather than a blank line",
	);
	assert.equal(
		model.checkpointSummary(
			checkpoint({
				kind: "completion",
				naming: { state: "ready", name: "n", summary: "One sentence." },
			}),
		),
		"One sentence.",
	);
});

test("outcomes map to the four labels the card prints", () => {
	assert.deepEqual(model.CHECKPOINT_OUTCOME_LABELS, {
		complete: "Complete",
		error: "Error",
		interrupted: "Interrupted",
		open: "Open",
	});
});

test("Turn N of M counts turns, not checkpoints", () => {
	const list = [
		checkpoint({ id: "u1", kind: "user", turn: 1 }),
		checkpoint({ id: "c1", kind: "completion", turn: 1 }),
		checkpoint({ id: "u2", kind: "user", turn: 2 }),
		checkpoint({ id: "c2", kind: "completion", turn: 2 }),
	];
	assert.equal(model.checkpointTurnCount(list), 2);
	assert.equal(model.checkpointTurnCount([]), 0);
});

test("a requested id resolves to the naming of its own turn's completion", () => {
	const m = manifest([
		checkpoint({ id: "user-1", kind: "user", turn: 1 }),
		checkpoint({
			id: "comp-1",
			kind: "completion",
			turn: 1,
			naming: { state: "pending", name: null, summary: null },
		}),
		checkpoint({ id: "user-2", kind: "user", turn: 2 }),
	]);
	assert.equal(model.checkpointNamingStateFor(m, "comp-1"), "pending");
	assert.equal(
		model.checkpointNamingStateFor(m, "user-1"),
		"pending",
		"a hovered user tick polls through its turn's completion",
	);
	assert.equal(
		model.checkpointNamingStateFor(m, "user-2"),
		null,
		"an open turn has nothing to name, so nothing may stay pending",
	);
	assert.equal(model.checkpointNamingStateFor(m, "missing"), null);
	assert.deepEqual(
		model.checkpointPendingIds(m, ["comp-1", "user-1", "user-2", "missing"]),
		["comp-1", "user-1"],
	);
});
