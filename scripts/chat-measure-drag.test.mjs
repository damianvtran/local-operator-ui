/**
 * The conversation column's drag arithmetic: the bounds, the direction, and the
 * rule that decides whether a gesture commits at all.
 *
 * WHY THIS FILE EXISTS. `pnpm test:desktop` bundles shipped TypeScript in memory
 * rather than rendering it, so a decision written into a JSX handler is a
 * decision no test can reach. The clamp and the commit rule live in
 * `src/renderer/src/features/chat/chat-measure-drag.ts` - the shipped module,
 * bundled here and driven directly - and this file is the fourth case below,
 * which is the one that would otherwise ship broken. The commit rule grew the
 * RENDER CONSULTATION in round 2 (UX's U4): a release now asks what the pane
 * can show before it writes, and the two measured seats of that question are
 * pinned at the end of the commit-rule section.
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
	renderedChatMeasureWidth,
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
	 *
	 * The pane is deliberately one that could show anything: the travel guard
	 * must answer before the render consultation is even asked, so only the
	 * guard can be what these three readings are about.
	 */
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: 0,
			edge: "right",
			panePx: 1100,
		}),
		null,
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: 1,
			edge: "right",
			panePx: 1100,
		}),
		null,
		"a one-pixel trackpad wobble is not an instruction",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -(DRAG_TRAVEL_PX - 1),
			edge: "right",
			panePx: 1100,
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
			/*
			 * The window the narration above describes: too narrow to draw the
			 * preference. Irrelevant to this arm either way - no travel answers
			 * before the pane is consulted - but passed because the release
			 * contract now requires one.
			 */
			panePx: 900,
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
	 *
	 * RE-DECIDED FOR THE RENDER CONSULTATION (round 2, U4) - this test used to
	 * assert its commits with no pane stated, because the release rule did not
	 * ask, and one of those commits falls on the invisible-write class the round
	 * refused. The claims are read apart now:
	 *
	 *  - On the pane U4 measured (a 1000px pane, rendering 968) the 60px drag
	 *    points at 980, still above what the pane can show, so the commit is
	 *    suppressed - the same refusal the seat below pins with a 20px drag.
	 *  - The intent this test exists for - the commit is pref-relative, never
	 *    the display value - is PRESERVED at a pane that can show 980: the same
	 *    drag commits 980, not the 968 that was on screen.
	 */
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -60,
			edge: "right",
			/* The measured pane: 1000px with the story host's 32px insets. */
			panePx: 968,
		}),
		null,
		"a commit the render cannot show is refused even though the hand travelled",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -60,
			edge: "right",
			panePx: 1100,
		}),
		980,
		"a pane that can show the width gets the pref-relative commit, not the display",
	);
	/*
	 * Outward at the ceiling: the candidate IS the width already stored, so the
	 * render cannot change either - the same "no visible change" refusal,
	 * reached through the clamp instead of through the pane. The clamp
	 * arithmetic stays pinned by "a drag stops at the bounds" above; what these
	 * two lines pin is that the ceiling means an outward release stores nothing
	 * rather than re-sending the number it already holds.
	 */
	assert.equal(
		draggedChatMeasureWidth({ startWidth: 1100, deltaX: 60, edge: "right" }),
		CHAT_MEASURE_MAX_PX,
		"the ceiling still clamps the candidate",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: 60,
			edge: "right",
			panePx: 1300,
		}),
		null,
		"a release at the ceiling stores nothing, because it changes nothing",
	);
});

test("a travelled drag the pane is already showing commits NOTHING (U4's seat)", () => {
	/*
	 * THE FIRST MEASURED SEAT, pinned as the regression it is (UX round 2, U4):
	 * stored 1100 at a 1000px pane - rendering 968 in the story host - and a
	 * 20px travelled drag inward points at 1060. Every pixel of that gesture was
	 * frozen (the render clamped 1100 and 1060 both to 968), yet the release used
	 * to store 1060 with `aria-valuenow` and `max-width` following: the store
	 * changed while nothing on screen did. The release asks the render now, and
	 * this gesture must write NOTHING.
	 *
	 * The window between the pane and the column is host-dependent (32px with
	 * overlay scrollbars, 48px with classic ones), so the seat passes the pane's
	 * remaining width - 968 - directly; the handle reads that same quantity from
	 * the scroller at the release.
	 */
	assert.equal(
		renderedChatMeasureWidth(1060, 968),
		968,
		"the render clamps the candidate to what the pane can show",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -20,
			edge: "right",
			panePx: 968,
		}),
		null,
		"a narrowing drag the render cannot show must commit nothing",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: 20,
			edge: "left",
			panePx: 968,
		}),
		null,
		"the left edge's mirror of the same drag is refused the same way",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1000,
			deltaX: 20,
			edge: "right",
			panePx: 968,
		}),
		null,
		"and a widening drag under the clamp is dead for the same reason",
	);
	/*
	 * The exact edge of the dead zone: a candidate that lands ON the pane's
	 * remaining width still paints the column already there, and one pixel
	 * further is a visible narrowing - so the refusal stops exactly at the
	 * boundary rather than one pixel early or late.
	 */
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -66,
			edge: "right",
			panePx: 968,
		}),
		null,
		"a candidate at 968, exactly the pane, is still the frozen width",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -67,
			edge: "right",
			panePx: 968,
		}),
		966,
		"one pixel past the pane is a visible narrowing, and commits the 966 asked for",
	);
});

test("the same drag commits when the pane can show it (the pair's second seat)", () => {
	/*
	 * THE SECOND MEASURED SEAT: the identical 20px drag, on a pane that can draw
	 * the width it points at. 1060 moves pixels here, so the release commits -
	 * and what commits is still the width the hand asked for (1060,
	 * pref-relative), never the pane and never a display value.
	 *
	 * The pane must be STRICTLY wider than the candidate for the commit to be a
	 * change: at exactly 1060 the clamped 1100 was already painting 1060, so
	 * that case is refused like the seat above.
	 */
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -20,
			edge: "right",
			panePx: 1400,
		}),
		1060,
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -20,
			edge: "right",
			panePx: 1061,
		}),
		1060,
		"one pixel of room above the candidate is enough for the commit",
	);
	assert.equal(
		releasedChatMeasureWidth({
			startWidth: 1100,
			deltaX: -20,
			edge: "right",
			panePx: 1060,
		}),
		null,
		"a pane exactly at the candidate was already painting it - refused",
	);
});
