import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE CHECKPOINT RAIL'S PURE RULES — fallback text, and which
 * requested ids a manifest still shows as pending.
 *
 * The rendered half lives in `scripts/checkpoint-rail.test.mjs`; this file
 * drives the DECISION, which is where the review risks sit:
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

test("the state ladder's classes are the shipped table (the unloaded floor is measured)", () => {
	/*
	 * The table IS the contract: the four arms are what a mark can wear, and
	 * the unloaded arm's 75% is the measured floor (at 60% the light themes
	 * fell to 2.42:1 - rosePineDawn - under the 3:1 non-text floor; at 75%
	 * every theme clears it). A repaint that changes one of these lines has to
	 * change this case with it.
	 */
	assert.deepEqual(model.CHECKPOINT_MARK_CLASS, {
		rest: "scale-x-60 bg-ink-dim",
		preview: "scale-x-90 bg-ink-muted",
		active: "scale-x-100 bg-ink",
		unloaded: "scale-x-40 bg-ink-dim opacity-75",
	});
});

test("checkpointMarkState's precedence is active > preview > unloaded > rest", () => {
	/*
	 * Precedence is the module's own stated contract (`checkpoint-model.ts`): a
	 * hovered mark beside the active turn must not take the primacy the
	 * reader's eye is parked on, a previewed mark whose turn is not resident
	 * still previews (the pointer's question is answered with its shape while
	 * the fill stays the quiet one), and unloaded beats rest - it is the state
	 * that tells a reader a jump will have to load first.
	 */
	assert.equal(
		model.checkpointMarkState({
			id: "u5",
			previewId: "u5",
			activeId: "u5",
			loaded: false,
		}),
		"active",
		"the reading position outranks a preview and the resident window",
	);
	assert.equal(
		model.checkpointMarkState({
			id: "u5",
			previewId: "u5",
			activeId: null,
			loaded: false,
		}),
		"preview",
		"a previewed mark previews even when its turn is unloaded",
	);
	assert.equal(
		model.checkpointMarkState({
			id: "u5",
			previewId: null,
			activeId: null,
			loaded: false,
		}),
		"unloaded",
		"unloaded outranks rest",
	);
	assert.equal(
		model.checkpointMarkState({ id: "u5", previewId: null, activeId: null }),
		"rest",
		"rest is the default; loaded defaults to true",
	);
});

test("the accessible name is the two frozen forms, with a real clock", () => {
	/* 2026-09-28 14:32 LOCAL, the unit the journal itself carries. */
	const ts = new Date(2026, 8, 28, 14, 32).getTime() / 1000;
	assert.equal(
		model.checkpointAriaLabel(checkpoint({ ts }), 2),
		"Jump to your message in turn 1 of 2, 2:32 PM",
	);
	assert.equal(
		model.checkpointAriaLabel(
			checkpoint({
				kind: "completion",
				turn: 3,
				naming: { state: "ready", name: "Fix the build", summary: "s" },
			}),
			7,
		),
		"Jump to turn 3 of 7, Fix the build",
	);
	assert.equal(
		model.checkpointAriaLabel(
			checkpoint({
				kind: "completion",
				turn: 3,
				naming: { state: "pending", name: null, summary: null },
			}),
			7,
		),
		"Jump to turn 3 of 7",
	);
	/* No naming field at all is the same fallback, not a blank. */
	assert.equal(
		model.checkpointAriaLabel(checkpoint({ kind: "completion", turn: 3 }), 7),
		"Jump to turn 3 of 7",
	);
	/* A zero/garbage ts drops the time half rather than printing 12:00 AM. */
	assert.equal(
		model.checkpointAriaLabel(checkpoint({ ts: 0 }), 4),
		"Jump to your message in turn 1 of 4",
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
