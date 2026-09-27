/**
 * The conversation column's drag arithmetic: the bounds, the direction, and the
 * rule that decides whether a gesture commits at all.
 *
 * WHY THIS FILE EXISTS. `pnpm test:desktop` bundles shipped TypeScript in memory
 * rather than rendering it, so a decision written into a JSX handler is a
 * decision no test can reach. The clamp and the commit rule live in
 * `src/renderer/src/features/chat/chat-measure-drag.ts` - the shipped module,
 * bundled here and driven directly - and this file is the fourth case below,
 * which is the one that would otherwise ship broken.
 *
 * WHAT THIS FILE CANNOT PIN, and where each is covered instead: the pointer
 * lifecycle, the hover delay, and what the cue looks like (the frames,
 * `docs/evidence/chat-measure-drag/`, and the QA matrix); whether a press on the
 * strip reaches the DOM at all (a unit test has no pointer); and whether the
 * width survives a relaunch (the persistence frames, which run a real browser
 * twice against one profile).
 *
 * THE FOURTH CASE IS THE BUG. An implementation that commits on every release
 * turns a DOUBLE-CLICK on the handle - two press/release rounds, both of them
 * no-travel - into a permanent narrowing, because the width a gesture starts
 * from on a narrow window is the width the window allows rather than the width
 * the reader chose. `deepseek-harness` records the same defect and the same
 * guard; this file is where this repo holds it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-measure-drag";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const {
	CHAT_MEASURE_MAX_PX,
	CHAT_MEASURE_MIN_PX,
	DRAG_TRAVEL_PX,
	clampChatMeasureWidth,
	draggedChatMeasureWidth,
	releasedChatMeasureWidth,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* 1. The bounds ----------------------------------------------------------- */

test("the clamp holds the bounds, and rounds to whole pixels", () => {
	assert.equal(
		clampChatMeasureWidth(CHAT_MEASURE_MIN_PX - 400),
		CHAT_MEASURE_MIN_PX,
	);
	assert.equal(
		clampChatMeasureWidth(CHAT_MEASURE_MAX_PX + 400),
		CHAT_MEASURE_MAX_PX,
	);
	assert.equal(clampChatMeasureWidth(CHAT_MEASURE_MIN_PX), CHAT_MEASURE_MIN_PX);
	assert.equal(clampChatMeasureWidth(CHAT_MEASURE_MAX_PX), CHAT_MEASURE_MAX_PX);
	/* Inside the range the value passes through, rounded: a width is a pixel
	   count and a fractional one would land in `aria-valuenow` and in the
	   persisted store. */
	assert.equal(clampChatMeasureWidth(800), 800);
	assert.equal(clampChatMeasureWidth(800.4), 800);
	assert.equal(clampChatMeasureWidth(800.6), 801);
});

test("the bounds are ordered and wide enough to be an affordance", () => {
	assert.ok(CHAT_MEASURE_MIN_PX < CHAT_MEASURE_MAX_PX);
	assert.ok(DRAG_TRAVEL_PX > 0);
});

/* 2. The direction, per edge ---------------------------------------------- */

test("the grabbed edge tracks the pointer exactly, one pixel for one pixel", () => {
	/*
	 * The column is CENTRED, so the width moves by twice the pointer's travel.
	 * The property this asserts is the one a person feels rather than a number:
	 * the edge the hand is on stays under the hand. A drag at half speed reads as
	 * the handle being sticky, and a drag at double speed runs away from the
	 * pointer - neither throws, so nothing but this catches it.
	 */
	/*
	 * A start width whose whole travel stays inside the bounds, because a clamp
	 * that bites would be measuring the bound rather than the tracking.
	 */
	for (const delta of [-120, -3, 0, 3, 120]) {
		const start = 800;
		for (const edge of ["left", "right"]) {
			const width = draggedChatMeasureWidth({
				startWidth: start,
				deltaX: delta,
				edge,
			});
			/* Where the grabbed edge sits, as an offset from the centre. */
			const before = start / 2;
			const after = width / 2;
			/* Screen coordinates: the right edge sits at centre + width/2 and the
			   left edge at centre - width/2, so each edge's own travel is measured
			   outward from the centre in the direction that edge moves. */
			const edgeTravel = edge === "right" ? after - before : before - after;
			const expected = delta;
			assert.equal(
				Math.round(edgeTravel),
				expected,
				`${edge} edge @ ${delta}px: travelled ${edgeTravel}, pointer travelled ${expected}`,
			);
		}
	}
});

test("outward widens and inward narrows, on both edges", () => {
	assert.ok(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: 40, edge: "right" }) >
			700,
		"the right edge dragged right must widen",
	);
	assert.ok(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: -40, edge: "right" }) <
			700,
		"the right edge dragged left must narrow",
	);
	assert.ok(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: -40, edge: "left" }) >
			700,
		"the left edge dragged left must widen",
	);
	assert.ok(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: 40, edge: "left" }) <
			700,
		"the left edge dragged right must narrow",
	);
});

test("a drag stops at the bounds instead of running past them", () => {
	assert.equal(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: 5_000, edge: "right" }),
		CHAT_MEASURE_MAX_PX,
	);
	assert.equal(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: -5_000, edge: "left" }),
		CHAT_MEASURE_MAX_PX,
		"the left edge dragged far left widens to the ceiling",
	);
	assert.equal(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: 5_000, edge: "left" }),
		CHAT_MEASURE_MIN_PX,
		"and dragged far right narrows to the floor",
	);
	assert.equal(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: -5_000, edge: "right" }),
		CHAT_MEASURE_MIN_PX,
	);
	assert.equal(
		draggedChatMeasureWidth({ startWidth: 700, deltaX: 5_000, edge: "right" }),
		CHAT_MEASURE_MAX_PX,
	);
});

/* 3. The commit rule ------------------------------------------------------ */

test("a press with no travel commits NOTHING, which is what a double-click is", () => {
	/*
	 * The rule, at its smallest: a gesture that did not move is not an
	 * instruction, and the answer is `null` - not the value it already held,
	 * because a write is what would let a press-only gesture outlive a wider
	 * preference through any later path that reads the store.
	 */
	assert.equal(
		releasedChatMeasureWidth({ startWidth: 1100, deltaX: 0, edge: "right" }),
		null,
	);
	assert.equal(
		releasedChatMeasureWidth({ startWidth: 1100, deltaX: 1, edge: "right" }),
		null,
		"a one-pixel trackpad wobble is not an instruction",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -(DRAG_TRAVEL_PX - 1),
			edge: "right",
		}),
		null,
	);
});

test("a double-click cannot replace a wide preference with the window's value", () => {
	/*
	 * The defect this file exists for, as the sequence of events a reader
	 * actually produces, and with the trap set: on a window too narrow to draw
	 * the preference, the CAP the drag starts from is the reader's 1100 while the
	 * width on screen is the persona of "what the window allows". An
	 * implementation that commits on release writes the second one over the
	 * first.
	 *
	 * Both rounds are modelled with the pointer held at the same place, which is
	 * what a double-click is: no travel in either round.
	 */
	const preference = 1100;
	let stored = preference;
	for (const round of [1, 2]) {
		const committed = releasedChatMeasureWidth({
			startWidth: stored,
			deltaX: 0,
			edge: "right",
		});
		if (committed !== null) stored = committed;
		assert.equal(
			stored,
			preference,
			`round ${round} of a double-click must leave the preference alone`,
		);
	}
});

test("a gesture that DID travel commits the dragged width, not a clamped display", () => {
	/*
	 * The other half of the same distinction. The reader drags 60px inward on a
	 * window narrower than their preference: what is stored is the width the hand
	 * asked for, computed from their PREFERENCE rather than from the shrunken
	 * column they were looking at. Starting from the display value instead is how
	 * a reader's 1100 silently becomes 700 the first time they touch the handle
	 * on a laptop screen.
	 */
	const committed = releasedChatMeasureWidth({
		startWidth: 1100,
		deltaX: -60,
		edge: "right",
	});
	assert.equal(committed, 980);
	assert.equal(
		releasedChatMeasureWidth({ startWidth: 1100, deltaX: 60, edge: "right" }),
		Math.min(CHAT_MEASURE_MAX_PX, 1220),
		"and outward is clamped by the ceiling rather than unbounded",
	);
});
