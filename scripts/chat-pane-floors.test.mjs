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
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The chat column's floor as the element declares it, in pixels. */
const appliedChatFloor = () => {
	const column = read(CONTENT).match(
		/ref=\{chatColumnRef\}\s*\n\s*className="([^"]+)"/,
	);
	assert.ok(
		column,
		"the chat column lost its ref+className pair, so nothing declares the floor the right pane's capacity is measured against",
	);
	const floor = /min-w-\[(\d+)px\]/.exec(column[1]);
	assert.ok(
		floor,
		`the chat column declares no pixel floor (${column[1]}); the capacity is row MINUS this floor, so without it the pane measures against its own content`,
	);
	return { classes: column[1], declared: Number(floor[1]) };
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
	const constant = /const CHAT_COLUMN_MIN_PX = (\d+);/.exec(source);
	assert.ok(
		constant,
		"`CHAT_COLUMN_MIN_PX` is gone: the capacity measurement's fallback is a literal now, which is the drift this test exists to stop",
	);
	assert.equal(
		Number(constant[1]),
		declared,
		`the column declares min-w-[${declared}px] and the fallback constant says ${constant[1]}: the two spellings of one floor have drifted`,
	);
});

test("§B1's floor is recorded, and the applied floor sits inside it", () => {
	const { declared } = appliedChatFloor();
	assert.equal(
		CHAT_PANE_MIN_PX,
		480,
		"§B1's chat-pane minimum is 480; the bands below are argued from this constant, and `chat-sidebar-layout.ts`'s own 880 comment already does the sum with it",
	);
	assert.ok(
		declared > 0 && declared <= CHAT_PANE_MIN_PX,
		`the applied chat floor (${declared}) is outside (0, §B1's ${CHAT_PANE_MIN_PX}]: at 0 the pane has no floor to measure against, and above the spec's number the layout promises more than §I's yielding order can give back`,
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
