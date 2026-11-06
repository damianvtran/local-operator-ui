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
 * 4. The sidebar's render-only capacity cap keeps the chat floor and the 44px
 *    rail inside the app's 800px minimum window, even when the stored sidebar
 *    preference is wider. The stored preference itself is not rewritten.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const CONTENT = "src/renderer/src/features/chat/components/chat-content.tsx";
const LAYOUT = "src/renderer/src/features/chat/chat-sidebar-layout.ts";
// The run pane's floor DECLARATION, which lives in the store since the
// #677 review (D2): the slot's resolver holds the shared width to it and
// cannot import the component that consumes it.
const PREFS = "src/renderer/src/shared/store/ui-preferences-store.ts";
const DIVIDER =
	"src/renderer/src/shared/components/common/resizable-divider.tsx";
const SCROLLBARS =
	"src/renderer/src/shared/components/common/global-scrollbar-styles.tsx";

const read = (file) => readFileSync(file, "utf8");

/*
 * A pane clamping the shared width ITSELF, outside `rightSlotPaneWidth` (review
 * round 1, MINOR-2). Top-level so the pattern is compiled once for the file.
 */
const HAND_ROLLED_CLAMP = /Math\.max\([^)]*rightSlotWidth/;

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
	CHAT_SEAM_INSET_PX,
	CHAT_PANE_WITH_DOCK_MIN_PX,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_DEFAULT_WIDTH,
	PANEL_RAIL_WIDTH_PX,
	CANVAS_PANE_MIN_PX,
	RIGHT_SLOT_MAX_PX,
	canvasDockWidth,
	canvasPaneMode,
	rightSlotDividerContract,
	sidebarDockCapacity,
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
	const prefs = read(PREFS);
	/*
	 * The measurement itself, pinned as a SHAPE: the floor is read back from the
	 * element's computed style (with the constant as the unparseable fallback), and
	 * the capacity is the row's width minus it. `canvasDockWidth`, and every pane's
	 * capacity, is this subtraction under the slot's one ceiling.
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
	 * docked pane is possible at all: §I's third rule (the run panel has no overlay
	 * mode to enter - "it obeys the same 480 floor and closes itself rather than
	 * squeezing the chat below it") is a decision about `capacity < this`.
	 */
	/*
	 * The floor's DECLARATION is read from the store since the #677 review
	 * (D2) - the resolver compares against it - and `chat-content.tsx` keeps
	 * the use the rule below argues from (the run separator's contract call,
	 * `min: RUN_PANEL_MIN_PX`).
	 */
	const panelFloor = /export const RUN_PANEL_MIN_PX = (\d+);/.exec(prefs);
	assert.ok(
		panelFloor,
		"`RUN_PANEL_MIN_PX` is gone: §I's third rule is a comparison against it",
	);
	assert.ok(
		Number(panelFloor[1]) >= 320,
		`the right pane's contract floor dropped to ${panelFloor[1]}; below 320 a docked pane cannot render its own content`,
	);
});

/*
 * D4: THE SEPARATOR'S CONTRACT, the browser and console half - and the run
 * panel's, extracted so all three read one function rather than three spellings.
 * The defect it fixes: the browser and console separators were handed the
 * PREFERENCE with `minWidth={480} maxWidth={1200}`, so at rows that cannot host
 * the pane's floor (windows ~800-1024 once the rail takes its 44px) the separator
 * announced aria-valuenow=640 while the pane was drawn at 220 - the round-2 U6
 * class the run panel had already fixed for itself. The contract hands over the
 * DRAWN width and a range the row can honour, and the call sites refuse a write
 * where it cannot.
 */
test("the separator contract collapses onto the drawn width where the row cannot host the floor (D4)", () => {
	// 800x600 with the rail: row 700, capacity 220, the pane drawn at 220.
	assert.deepEqual(
		rightSlotDividerContract({
			capacity: 220,
			min: 480,
			max: 1200,
			drawn: 220,
		}),
		{ resizable: false, value: 220, minWidth: 220, maxWidth: 220 },
	);
	// 1380 with the rail: row 1076, capacity 596 - under the pane's own 1200
	// ceiling, so the announced maximum is the capacity, not 1200.
	assert.deepEqual(
		rightSlotDividerContract({
			capacity: 596,
			min: 480,
			max: 1200,
			drawn: 596,
		}),
		{ resizable: true, value: 596, minWidth: 480, maxWidth: 596 },
	);
	// A capacity above the pane's own ceiling leaves the ceiling in place.
	assert.deepEqual(
		rightSlotDividerContract({
			capacity: 2000,
			min: 480,
			max: 1200,
			drawn: 1000,
		}),
		{ resizable: true, value: 1000, minWidth: 480, maxWidth: 1200 },
	);
	// The floor is inclusive: capacity === min is still resizable.
	assert.equal(
		rightSlotDividerContract({ capacity: 480, min: 480, max: 1200, drawn: 480 })
			.resizable,
		true,
	);
});

test("the run panel's contract is unchanged by the extraction (U6's numbers)", () => {
	// The 1024x673 case the run panel's own docblock records: capacity 44 < 320,
	// so the value and the range collapse onto the drawn width.
	assert.deepEqual(
		rightSlotDividerContract({
			capacity: 44,
			min: 320,
			max: 640,
			drawn: 44,
		}),
		{ resizable: false, value: 44, minWidth: 44, maxWidth: 44 },
	);
	// A row that can host it: 320..min(RIGHT_SLOT_MAX_PX, capacity), value the
	// drawn width.
	assert.deepEqual(
		rightSlotDividerContract({
			capacity: 596,
			min: 320,
			max: RIGHT_SLOT_MAX_PX,
			drawn: 320,
		}),
		{ resizable: true, value: 320, minWidth: 320, maxWidth: 596 },
	);
});

test("one ceiling means the run pane's 1600px/stored-1000 case announces value === max (D4's found-not-fixed class, closed)", () => {
	/*
	 * It used to be: at a 1600px window with a stored 1000 the run pane drew 816
	 * (row 1296 minus the conversation's 480 floor) while its own ceiling was 640,
	 * so the contract's value sat above its maxWidth and the PR recorded it as
	 * found-not-fixed. With the slot's ONE ceiling the announced maximum is 1200
	 * held to the same capacity, so value and max are one number.
	 */
	assert.deepEqual(
		rightSlotDividerContract({
			capacity: 816,
			min: 320,
			max: RIGHT_SLOT_MAX_PX,
			drawn: 816,
		}),
		{ resizable: true, value: 816, minWidth: 320, maxWidth: 816 },
	);
	/*
	 * THE FUNCTION STILL REFUSES TO CLAMP A DRAWN VALUE ABOVE `max`: called
	 * directly with a narrower ceiling, value stays the drawn width (clamping it
	 * would announce a width the pane is not drawn at) and maxWidth stays the
	 * ceiling. That is a property of the contract, not a state the app produces -
	 * `rightSlotPaneWidth` holds every caller's width to the one ceiling.
	 */
	assert.deepEqual(
		rightSlotDividerContract({
			capacity: 816,
			min: 320,
			max: 640,
			drawn: 816,
		}),
		{ resizable: true, value: 816, minWidth: 320, maxWidth: 640 },
	);
});

test("the browser and console separators read the contract, and a write the row cannot host is refused on all three (D4)", () => {
	const content = read(CONTENT);
	for (const pane of ["browser", "console"]) {
		assert.ok(
			content.includes(`sidebarWidth={${pane}Divider.value}`),
			`the ${pane} separator is no longer handed the DRAWN width from the contract`,
		);
		assert.ok(
			!content.includes(
				`sidebarWidth={effective${pane === "browser" ? "Browser" : "Console"}PanelWidth}`,
			),
			`the ${pane} separator is handed the preference again`,
		);
		assert.ok(
			content.includes(`if (!${pane}Divider.resizable) return;`),
			`the ${pane} separator no longer refuses a write the row cannot host`,
		);
	}
	assert.ok(
		content.includes("if (!runDivider.resizable) return;"),
		"the run separator no longer refuses a write the row cannot host",
	);
	// The capacity each of the two derives is the row minus the conversation's
	// floor - the same subtraction the run panel measures from its elements.
	assert.ok(
		content.includes("Math.max(0, paneRowWidth - CHAT_PANE_MIN_PX)"),
		"the browser/console capacity no longer derives from the measured row",
	);
});

test("every effective*PanelWidth in the slot is the shared width held by rightSlotPaneWidth", () => {
	const content = read(CONTENT);
	/*
	 * THE WIRING HALF OF THE ONE-BAND RULE (review round 1, MINOR-2). The resolver
	 * tests drive `resolveRightSlotWidth`, and this file greps `chat-content.tsx`
	 * elsewhere, but nothing pinned that the four panes this component DRAWS take
	 * their width from `rightSlotPaneWidth`. Reverting one of them to a hand-rolled
	 * clamp (`Math.max(floor, rightSlotWidth || DEFAULT)`) leaves the slot's
	 * separator announcing one width and that pane drawing another - the exact drift
	 * the one band removes - and every other assertion here still passes.
	 */
	for (const [name, floor] of [
		["effectiveRunPanelWidth", "RUN_PANEL_MIN_PX"],
		["effectiveBrowserPanelWidth", "BROWSER_PANEL_MIN_PX"],
		["effectiveConsolePanelWidth", "CONSOLE_PANEL_MIN_PX"],
		["effectiveCodePanelWidth", "RUN_PANEL_MIN_PX"],
	])
		assert.match(
			content,
			new RegExp(
				`const ${name} = rightSlotPaneWidth\\(\\s*${floor},\\s*rightSlotWidth,?\\s*\\);`,
			),
			`\`${name}\` no longer comes from \`rightSlotPaneWidth(${floor}, rightSlotWidth)\`: the pane would draw a width the slot's separator does not announce`,
		);
	/*
	 * Exactly four, and no pane clamped beside them: a fifth call or a bare
	 * `Math.max(...rightSlotWidth...)` is the second way this file exists to stop.
	 */
	assert.equal(
		content.split("rightSlotPaneWidth(").length - 1,
		4,
		"the slot draws from exactly the four `rightSlotPaneWidth` calls above",
	);
	assert.ok(
		!HAND_ROLLED_CLAMP.test(content),
		"a pane clamps `rightSlotWidth` itself again; the slot's floor and ceiling belong to `rightSlotPaneWidth`",
	);
});

test("the canvas docks at min(RIGHT_SLOT_MAX_PX, available - 480), or stops docking below 400 (§I)", () => {
	assert.equal(CANVAS_PANE_MIN_PX, 400);
	assert.equal(RIGHT_SLOT_MAX_PX, 1200);
	/*
	 * THE FOUR ROWS THE SCENE IS RUN AT, as arithmetic instead of a frame: the dock
	 * threshold's row (a 260px sidebar in a 1024 window), the strip's rows at 960 and
	 * 800, and the app's own default. Two dock and two overlay, which is what makes
	 * this a test of §I's ORDER rather than of one width.
	 */
	const cases = [
		{
			row: 1120,
			dock: 640,
			mode: "docked",
			why: "1380 with the sidebar docked: the row leaves 640, under both the default and the ceiling",
		},
		{
			row: 764,
			dock: 284,
			mode: "overlay",
			why: "1024 with the sidebar docked: 284 is under the pane's own floor, so it stops docking",
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
			why: "800 with the strip: 264 is under the pane's own floor",
		},
	];
	for (const { row, dock, mode, why } of cases) {
		assert.equal(canvasDockWidth(row), dock, `${why}: canvasDockWidth(${row})`);
		assert.equal(canvasPaneMode(row), mode, `${why}: canvasPaneMode(${row})`);
	}
	/*
	 * THE THREE EDGES. A row wide enough to leave the slot its whole ceiling docks
	 * at the ceiling, not above it (one cap for every pane); exactly 400 is still
	 * docked (the floor is inclusive); and a row narrower than the chat floor itself
	 * gives a ZERO dock width rather than a negative one - the caller reads the
	 * mode, and a negative width would render a pane with a divider and no pixels.
	 */
	assert.equal(
		canvasDockWidth(CHAT_PANE_MIN_PX + RIGHT_SLOT_MAX_PX),
		RIGHT_SLOT_MAX_PX,
	);
	assert.equal(
		canvasDockWidth(CHAT_PANE_MIN_PX + RIGHT_SLOT_MAX_PX + 400),
		RIGHT_SLOT_MAX_PX,
	);
	assert.equal(
		canvasPaneMode(CHAT_PANE_MIN_PX + CANVAS_PANE_MIN_PX + RIGHT_SLOT_MAX_PX),
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

test("the sidebar's render cap preserves the chat floor at the app minimum", () => {
	assert.equal(SIDEBAR_COLLAPSED_WIDTH, 56);
	assert.equal(SIDEBAR_DEFAULT_WIDTH, 260);
	assert.equal(PANEL_RAIL_WIDTH_PX, 44);
	const capacity = sidebarDockCapacity(800);
	assert.equal(capacity, 276);
	assert.equal(capacity + CHAT_PANE_MIN_PX + PANEL_RAIL_WIDTH_PX, 800);
	/* A wide window does not cap the user's 220-320px drag range further. */
	assert.equal(sidebarDockCapacity(1380), 320);
});

test("the layout module owns the bands the shell reads", () => {
	const layout = read(LAYOUT);
	for (const name of [
		"CHAT_PANE_MIN_PX",
		"CANVAS_PANE_MIN_PX",
		"RIGHT_SLOT_MAX_PX",
		"CHAT_PANE_WITH_DOCK_MIN_PX",
		"SIDEBAR_COLLAPSED_WIDTH",
		"SIDEBAR_DEFAULT_WIDTH",
	])
		assert.match(
			layout,
			new RegExp(`export const ${name}\\b`),
			`${name} is no longer exported from \`chat-sidebar-layout.ts\`; the bands and this test read it from there`,
		);
	assert.match(
		layout,
		/export function sidebarDockCapacity\b/,
		"the render-only dock capacity must stay in the shipped layout module",
	);
});

/* --------------------------- the seam's clearance --------------------------- */

/**
 * Tailwind's spacing scale, in pixels: one step is 0.25rem at the 16px root the
 * renderer runs at. The band's classes are the source - there is no constant to
 * import for them - so the parse is what makes them readable by a test at all.
 */
const tailwindPx = (suffix) => Number(suffix) * 4;

/*
 * The patterns the readers below share, named at module scope so each match says
 * what it is FOR at the site that uses it.
 */
const BAND_WIDTH = /"top-0 h-full w-(\d+(?:\.\d+)?) cursor-col-resize"/;
const BAND_LEFT = /"-left-(\d+(?:\.\d+)?)"/;
const BAND_RIGHT = /"-right-(\d+(?:\.\d+)?)"/;
const SCROLLBAR_DECLARATION = /\*::-webkit-scrollbar \{\n\twidth: 8px;/;
const RIGHT_PANE_DOCKED = /const rightPaneDocked =([\s\S]*?);\n/;
/*
 * The chat column's inner surface: from its ref to the close of that element's
 * own opening tag. The slice is the tag rather than a window to `className="`,
 * because the prose above the attribute legitimately NAMES that attribute and a
 * lazy window would stop inside the comment (measured: the first draft did).
 */
const seamSurface = () => {
	const source = read(CONTENT);
	const from = source.indexOf("ref={chatContainerRef}");
	assert.notEqual(from, -1, "the chat column's inner surface lost its ref");
	const close = source.indexOf(">", from);
	assert.notEqual(
		close,
		-1,
		"the chat column's inner surface has no tag close",
	);
	const tag = source.slice(from, close);
	assert.ok(
		tag.includes('className="panel-top-pad'),
		"the chat column's inner surface no longer wears its literal `panel-top-pad` class list; `lane-leading.test.mjs` matches that string to keep every full-height column padded off the lane",
	);
	return tag;
};
/* The inset as the element applies it: a named pixel, conditional on the gate. */
const SEAM_STYLE =
	/rightPaneDocked\s*\?\s*\{ paddingInlineEnd: CHAT_SEAM_INSET_PX \}\s*: undefined/;

/** The separator's vertical hit band: its width and how far it reaches in. */
const verticalBand = () => {
	const source = read(DIVIDER);
	const width = BAND_WIDTH.exec(source);
	assert.ok(
		width,
		"the separator no longer declares its vertical band (`top-0 h-full w-N cursor-col-resize`), so the width the chat column must clear cannot be read",
	);
	const left = BAND_LEFT.exec(source);
	const right = BAND_RIGHT.exec(source);
	assert.ok(
		left && right,
		"the separator no longer declares both vertical offsets (`-left-N`/`-right-N`), so the band is no longer known to be centred and half its width is not its reach",
	);
	/*
	 * The reach is HALF the width only while the band is centred. Asserted rather
	 * than assumed: an asymmetric band (all of it on one side) is a different
	 * geometry and would quietly invalidate the clearance below.
	 */
	assert.equal(
		tailwindPx(left[1]),
		tailwindPx(right[1]),
		`the separator's vertical band is no longer centred (left ${left[1]} vs right ${right[1]}), so half its width is not the reach the seam inset has to clear`,
	);
	return {
		width: tailwindPx(width[1]),
		reach: tailwindPx(left[1]),
	};
};

test("the separator's reach into the chat column is cleared before the scrollbar", () => {
	const band = verticalBand();
	/*
	 * THE INVARIANT, and it is the operator's report as arithmetic: the band
	 * reaches `band.reach` px into the chat column, and the transcript's
	 * scrollbar is 8px wide (`*::-webkit-scrollbar { width: 8px }`) and sits
	 * flush against the seam. Anything at or below `band.reach` puts the band on
	 * top of the bar - a drag that starts on the bar resizes the pane instead of
	 * scrolling - so the clearance must EXCEED the reach, not merely meet it.
	 *
	 * The number is IMPORTED (`CHAT_SEAM_INSET_PX`, beside `CHAT_PANE_MIN_PX` in
	 * the layout module), not parsed: a pixel the band is measured against is a
	 * value, and a value belongs in one place.
	 */
	assert.ok(
		Number.isFinite(CHAT_SEAM_INSET_PX),
		"`CHAT_SEAM_INSET_PX` is no longer exported from `chat-sidebar-layout.ts`; the chat column's seam clearance has no named value, so the band's reach is checked against nothing",
	);
	assert.ok(
		CHAT_SEAM_INSET_PX > band.reach,
		`the separator's band reaches ${band.reach}px into the chat column (${band.width}px wide, centred) but the column only gives back ${CHAT_SEAM_INSET_PX}px: the band covers the transcript's scrollbar again`,
	);
	assert.match(
		read(SCROLLBARS),
		SCROLLBAR_DECLARATION,
		"the app's classic scrollbar is no longer declared as 8px in `global-scrollbar-styles.tsx`; the seam inset above was measured against it",
	);
	const surface = seamSurface();
	/*
	 * The inset is CONDITIONAL on a separator being drawn: with no pane open there
	 * is nothing to clear, and an unconditional inset would move every chat
	 * surface off the seam for no reason. Round 1 shipped the wrong gate
	 * (`canvasDocked` alone) and this case plus the gate's own case below are what
	 * closed it.
	 */
	assert.match(
		surface,
		SEAM_STYLE,
		"the chat column's inner surface no longer applies `CHAT_SEAM_INSET_PX` as `rightPaneDocked ? { paddingInlineEnd: … } : undefined`; applied unconditionally it narrows every chat surface when no pane is open",
	);
});

/*
 * THE GATE'S DEFINITION, not just its name (review round 1, BLOCKER). Round 1
 * shipped `rightPaneDocked = canvasDocked || ...`, and `canvasDocked` only says
 * the row is WIDE ENOUGH to dock a canvas - so the inset applied with every pane
 * closed, on every window wide enough to dock one. The cases below read the
 * definition and require the two canvas families to carry their OPEN flag, the
 * way the divider blocks themselves do (`{isCanvasOpen && (` around
 * `{canvasDocked && <ResizableDivider`), and refuse a bare `canvasDocked`
 * anywhere else (review round 2's MINOR).
 */
test("the seam inset is gated on a separator actually being drawn", () => {
	const definition = read(CONTENT).match(RIGHT_PANE_DOCKED);
	assert.ok(
		definition,
		"`rightPaneDocked` is no longer a named constant in `chat-content.tsx`; the seam inset's gate cannot be read",
	);
	const flattened = definition[1].replace(/\s+/g, " ");
	for (const pair of [
		"isCanvasOpen && canvasDocked",
		"sessionAsksOpen && canvasDocked",
	])
		assert.ok(
			flattened.includes(pair),
			`\`rightPaneDocked\` no longer carries \`${pair}\`: \`canvasDocked\` alone means the row is wide enough to dock, which is true with the canvas closed - the inset then applies to every chat on a wide window (review round 1, BLOCKER)`,
		);
	for (const flag of [
		"isRunPanelOpen",
		"isBrowserPaneOpen",
		"isConsolePaneOpen",
		"isCodeReviewPaneOpen",
	])
		assert.ok(
			definition[1].includes(flag),
			`\`rightPaneDocked\` dropped \`${flag}\`, so a docked pane no longer earns the inset and its scrollbar goes back under the separator's band`,
		);
	const stripped = definition[1]
		.replace(/\(\s*isCanvasOpen && canvasDocked\s*\)/g, "")
		.replace(/\(\s*sessionAsksOpen && canvasDocked\s*\)/g, "");
	assert.ok(
		!/\bcanvasDocked\b/.test(stripped),
		"`rightPaneDocked` still reads `canvasDocked` outside the canvas families' open pairs; a bare `canvasDocked` is true with every pane closed and insets every chat on a wide window",
	);
});
