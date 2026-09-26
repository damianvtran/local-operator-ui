/**
 * The shell's pane floors, executable — and the numbers they are argued from.
 *
 *     node --test scripts/chat-pane-floors.test.mjs
 *
 * WHY THIS FILE EXISTS (chat redesign §I, §B1; the manager's finding). A commit on
 * 2026-09-24 halved the chat column and moved it to the right-hand third of the
 * window in EVERY state (`x 260 w 1120` -> `x 900 w 480`: a `min-width` added to
 * the wrapper that carries `grow` in the shell's flex ROW), and the capture meter
 * said nothing, because it asserted the header, the transcript, the composer and
 * the reading measure and never the PANE COLUMN's own box. The runtime half of that
 * gap is fixed in the meter; this file is the half that runs in CI, where the next
 * PR can be stopped without anyone remembering to take a frame.
 *
 * WHAT IT CAN AND CANNOT SEE, stated rather than implied:
 *
 * - it CAN pin the numbers and their relations from the shipped source, and it can
 *   pin that the two spellings of the chat column's floor — the Tailwind class on
 *   the element and the constant the capacity arithmetic falls back to — still say
 *   the same thing. The source calls that constant "the fallback for a computed
 *   style that cannot be parsed, NOT a second source"; two numbers that drift
 *   silently re-open the divider divergence that fix closed.
 * - it CANNOT see a box move at runtime. That is the driver's job (`node
 *   scripts/renderer-driver.mjs`), and the meter's over a full capture set. This
 *   file is the cheap gate in front of both.
 *
 * THE INVARIANTS:
 *
 * 1. The chat column's floor is declared in exactly one place, twice (`w-0
 *    min-w-[Npx] flex-1` on the element, `CHAT_COLUMN_MIN_PX` beside it), and the
 *    two agree.
 * 2. §B1's floor is 480. It is RECORDED in `chat-sidebar-layout.ts` and NOT yet
 *    applied — the tree is at 220 — and §I's own commit raises it as the first of
 *    three yielding steps. The assertions below check the applied floor sits in
 *    `(0, 480]`: at 0 the column has no floor and the pane's capacity arithmetic
 *    divides the row against nothing, and above the spec's number the layout
 *    promises more than §I's yielding order can give back. When the floor moves,
 *    this file fails and the mover tightens it.
 * 3. The right pane's capacity is the row MINUS that floor, measured from the
 *    element (not assumed in the component), and the pane has a contract floor of
 *    its own that decides whether a docked pane is possible at all.
 * 4. The sidebar's bands keep their relations at BOTH floors: the strip plus the
 *    chat floor fits inside the width the pane is said to hold its floor at, and
 *    the docked sidebar plus the chat floor fits inside the dock threshold. §I's
 *    ordering rule (chat floor, then the sidebar to the strip, then the canvas
 *    overlaying) is only coherent while both sums hold.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const CONTENT = "src/renderer/src/features/chat/components/chat-content.tsx";
const LAYOUT = "src/renderer/src/features/chat/chat-sidebar-layout.ts";

const read = (file) => readFileSync(file, "utf8");

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-sidebar-layout";',
		resolveDir: ROOT,
		loader: "ts",
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

const {
	CHAT_PANE_MIN_PX,
	CHAT_PANE_WITH_DOCK_MIN_PX,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_DOCK_MIN_PX,
	CANVAS_PANE_MIN_PX,
	CANVAS_PANE_MAX_PX,
	canvasDockWidth,
	canvasPaneMode,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The chat column's floor as the element declares it, in pixels. */
const appliedChatFloor = () => {
	/*
	 * The ref and the class attribute of ONE element. The `[\s\S]` window is bounded and
	 * may not cross a `>` - the element's own tag close - so an attribute added between
	 * them (the `data-tour-tag` the geometry probe reads, and anything after it) keeps
	 * matching while a className that has MOVED to a later element does not. That
	 * distinction is the whole point: the floor must be on the column the capacity is
	 * measured from, not on some wrapper beside it.
	 */
	const column = read(CONTENT).match(
		/ref=\{chatColumnRef\}([\s\S]{0,240}?)className="([^"]+)"/,
	);
	assert.ok(
		column && !column[1].includes(">"),
		"the chat column lost its ref+className pair, so nothing declares the floor the right pane's capacity is measured against",
	);
	const floor = /min-w-\[(\d+)px\]/.exec(column[2]);
	assert.ok(
		floor,
		`the chat column declares no pixel floor (${column[2]}); the capacity is row MINUS this floor, so without it the pane measures against its own content`,
	);
	return { classes: column[2], declared: Number(floor[1]) };
};

test("the chat column's floor is declared once, in two spellings that agree", () => {
	const { classes, declared } = appliedChatFloor();
	/*
	 * `w-0 ... flex-1` is the shape the row needs: `flex-1` grows from a zero basis
	 * so the CONTENT does not vote on the width, and the floor is what the pane's
	 * divider reads back. A `min-w-` that moved off this element — or a `w-[Npx]`,
	 * which would PIN the column instead of flooring it, the shape that relocated
	 * the pane on 2026-09-24 — is the regression this pins.
	 */
	assert.match(
		classes,
		/\bw-0\b/,
		"the column must keep a zero basis (`w-0`) so its content cannot vote on the width; a width class here pins it instead",
	);
	assert.match(
		classes,
		/\bflex-1\b/,
		"the column must still grow from that basis",
	);

	const source = read(CONTENT);
	/*
	 * The fallback is the MODULE's constant now rather than a literal, and that is the
	 * stronger form of the same assertion: `CHAT_COLUMN_MIN_PX = CHAT_PANE_MIN_PX`
	 * cannot drift from the number §B1's bands are argued from, while a literal 480
	 * here could. The class above is compared against the module's value in its own
	 * test, so the two spellings are still pinned to each other - through the one
	 * source, which is what "declared once" is supposed to mean.
	 */
	assert.match(
		source,
		/const CHAT_COLUMN_MIN_PX = CHAT_PANE_MIN_PX;/,
		"`CHAT_COLUMN_MIN_PX` no longer takes its value from `CHAT_PANE_MIN_PX` (`chat-sidebar-layout.ts`): a literal here is the second source this test exists to stop",
	);
	assert.equal(
		declared,
		CHAT_PANE_MIN_PX,
		`the column declares min-w-[${declared}px] and §B1's floor is ${CHAT_PANE_MIN_PX}: the two spellings of one floor have drifted`,
	);
});

test("§B1's floor is APPLIED, and the test no longer allows otherwise", () => {
	const { declared } = appliedChatFloor();
	assert.equal(
		CHAT_PANE_MIN_PX,
		480,
		"§B1's chat-pane minimum is 480; the bands below are argued from this constant, and `chat-sidebar-layout.ts`'s own 880 comment already does the sum with it",
	);
	/*
	 * EXACTLY, since §I applied it. The assertion this replaces allowed the applied
	 * floor to sit anywhere in `(0, 480]` while the tree was still at 220 and the
	 * layout commit was outstanding - that allowance is what §I spent, and leaving it
	 * here would let the next commit quietly halve the pane again with the gate green
	 * (the 2026-09-24 defect exactly: 220 is a legal value under the allowance).
	 */
	assert.equal(
		declared,
		CHAT_PANE_MIN_PX,
		`the column declares min-w-[${declared}px] but §B1's floor is ${CHAT_PANE_MIN_PX}: the two spellings of one floor have drifted apart`,
	);
});

test("the right pane's capacity is the row minus the column's floor, measured", () => {
	const source = read(CONTENT);
	/*
	 * The measurement itself, pinned as a SHAPE: the floor is read back from the
	 * element's computed style (with the constant as the unparseable fallback), and
	 * the capacity is the row's width minus it. §I's `min(560, available - 480)` is
	 * this subtraction with the floor at its spec value.
	 */
	assert.match(
		source,
		/Number\.parseFloat\(getComputedStyle\(column\)\.minWidth\)/,
		"the capacity no longer reads the column's floor from the element: a number assumed in the component is how the floor and the arithmetic drift apart",
	);
	assert.match(
		source,
		/const capacity = row\.getBoundingClientRect\(\)\.width - columnFloor/,
		"the capacity is no longer (row - floor): §I's `available - 480` is exactly this subtraction",
	);
	/*
	 * And the pane's own contract floor, which is the number that decides whether a
	 * docked pane is possible at all: §I's third rule ("the run panel is never an
	 * overlay ... it obeys the same 480 floor and closes itself rather than squeezing
	 * the chat below it") is a decision about `capacity < this`.
	 */
	const panelFloor = /const RUN_PANEL_MIN_PX = (\d+);/.exec(source);
	assert.ok(
		panelFloor,
		"`RUN_PANEL_MIN_PX` is gone: §I's third rule is a comparison against it",
	);
	assert.ok(
		Number(panelFloor[1]) >= 320,
		`the right pane's contract floor dropped to ${panelFloor[1]}; below 320 a docked pane cannot render its own content`,
	);
});

test("the canvas docks at min(560, available - 480), or overlays below 400 (§I)", () => {
	assert.equal(CANVAS_PANE_MIN_PX, 400);
	assert.equal(CANVAS_PANE_MAX_PX, 560);
	/*
	 * THE FOUR ROWS THE SCENE IS RUN AT, as arithmetic instead of a frame: the dock
	 * threshold's row (a 260px sidebar in a 1024 window), the strip's rows at 960 and
	 * 800, and the app's own default. Two dock and two overlay, which is what makes
	 * this a test of §I's ORDER rather than of one width.
	 */
	const cases = [
		{
			row: 1120,
			dock: 560,
			mode: "docked",
			why: "1380 with the sidebar docked: capped at §I's 560",
		},
		{
			row: 764,
			dock: 284,
			mode: "overlay",
			why: "1024 with the sidebar docked: 284 is under the pane's own floor, so it overlays",
		},
		{
			row: 904,
			dock: 424,
			mode: "docked",
			why: "960 with the strip: 424 still fits the pane's floor",
		},
		{
			row: 744,
			dock: 264,
			mode: "overlay",
			why: "800 with the strip: 264 over the chat",
		},
	];
	for (const { row, dock, mode, why } of cases) {
		assert.equal(canvasDockWidth(row), dock, `${why}: canvasDockWidth(${row})`);
		assert.equal(canvasPaneMode(row), mode, `${why}: canvasPaneMode(${row})`);
	}
	/*
	 * THE TWO EDGES. Exactly 560 is still docked (the ceiling is a width the pane may
	 * hold, not one it may not exceed), exactly 400 is still docked (the floor is
	 * inclusive), and a row narrower than the chat floor itself gives a ZERO dock
	 * width rather than a negative one - the caller reads the mode, and a negative
	 * width would render a pane with a divider and no pixels.
	 */
	assert.equal(
		canvasPaneMode(CHAT_PANE_MIN_PX + CANVAS_PANE_MIN_PX + CANVAS_PANE_MAX_PX),
		"docked",
	);
	assert.equal(canvasPaneMode(CHAT_PANE_MIN_PX + CANVAS_PANE_MIN_PX), "docked");
	assert.equal(
		canvasPaneMode(CHAT_PANE_MIN_PX + CANVAS_PANE_MIN_PX - 1),
		"overlay",
	);
	assert.equal(canvasDockWidth(400), 0);
	assert.equal(canvasPaneMode(400), "overlay");
});

test("the sidebar's bands keep their relations at both floors", () => {
	assert.equal(SIDEBAR_DOCK_MIN_PX, 1024);
	assert.equal(SIDEBAR_COLLAPSED_WIDTH, 56);
	assert.equal(SIDEBAR_DEFAULT_WIDTH, 260);
	for (const floor of [appliedChatFloor().declared, CHAT_PANE_MIN_PX]) {
		assert.ok(
			SIDEBAR_COLLAPSED_WIDTH + floor <= CHAT_PANE_WITH_DOCK_MIN_PX,
			`the icon strip (${SIDEBAR_COLLAPSED_WIDTH}) plus a ${floor}px chat floor does not fit inside \`CHAT_PANE_WITH_DOCK_MIN_PX\` (${CHAT_PANE_WITH_DOCK_MIN_PX})`,
		);
		assert.ok(
			SIDEBAR_DEFAULT_WIDTH + floor <= SIDEBAR_DOCK_MIN_PX,
			`the docked sidebar (${SIDEBAR_DEFAULT_WIDTH}) plus a ${floor}px chat floor does not fit inside the dock threshold (${SIDEBAR_DOCK_MIN_PX})`,
		);
	}
});

test("the layout module owns the bands the shell reads", () => {
	const layout = read(LAYOUT);
	for (const name of [
		"CHAT_PANE_MIN_PX",
		"CANVAS_PANE_MIN_PX",
		"CANVAS_PANE_MAX_PX",
		"CHAT_PANE_WITH_DOCK_MIN_PX",
		"SIDEBAR_DOCK_MIN_PX",
		"SIDEBAR_COLLAPSED_WIDTH",
		"SIDEBAR_DEFAULT_WIDTH",
		"SIDEBAR_SHEET_WIDTH",
	])
		assert.match(
			layout,
			new RegExp(`export const ${name}\\b`),
			`${name} is no longer exported from \`chat-sidebar-layout.ts\`; the bands and this test read it from there`,
		);
});
