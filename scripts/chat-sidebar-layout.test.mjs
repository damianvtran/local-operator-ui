/**
 * The one sidebar's geometry, driven against the SHIPPED module.
 *
 * The reason the module exists is stated on it: a layout decision written as a
 * JSX condition is a decision no test in this suite can reach, because
 * `pnpm test:desktop` bundles the shipped TypeScript in memory rather than
 * rendering components. So the three window modes, the resize clamp and the
 * chord are all asserted here against `chat-sidebar-layout.ts` itself.
 *
 * WHAT THIS CANNOT SAY. That the sidebar LOOKS right at those widths - the
 * frames do that, and the AFTER capture in the redesign's evidence set is where
 * the claim is checked. This file says the decision is right.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const layoutBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-sidebar-layout";',
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
const {
	CHAT_PANE_WITH_DOCK_MIN_PX,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_DOCK_MIN_PX,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_SHEET_WIDTH,
	CANVAS_PANE_MIN_PX,
	CHAT_PANE_MIN_PX,
	canvasDockWidth,
	canvasPaneMode,
	clampSidebarWidth,
	isSidebarTogglePress,
	resolveSidebarLayout,
	sidebarToggleCap,
	sidebarYieldsToCanvas,
} = await import(
	`data:text/javascript;base64,${Buffer.from(layoutBundle.outputFiles[0].text).toString("base64")}`
);

test("the dock threshold is where the arithmetic crosses, not a round number", () => {
	assert.equal(SIDEBAR_DOCK_MIN_PX, 1024);
	/*
	 * 1024 - 260 leaves 764 for the chat pane, and the reading measure plus its
	 * two 24px gutters needs 688: the dock is free at this width with 76px over,
	 * and the width below it is the first that would take the dock's cost out of
	 * the column.
	 */
	assert.equal(
		SIDEBAR_DOCK_MIN_PX - SIDEBAR_DEFAULT_WIDTH - (640 + 2 * 24),
		76,
	);
	/*
	 * The pane's own floor is a second, independent fact - and the two are not the
	 * same number, which is why the strip/overlay boundary is recorded rather than
	 * derived from the dock's width.
	 */
	assert.equal(CHAT_PANE_WITH_DOCK_MIN_PX, 880);
	assert.ok(CHAT_PANE_WITH_DOCK_MIN_PX > SIDEBAR_DEFAULT_WIDTH + 480);
});

test("the resize range is the one the message list already occupied", () => {
	assert.equal(SIDEBAR_MIN_WIDTH, 220);
	assert.equal(SIDEBAR_MAX_WIDTH, 320);
	assert.equal(SIDEBAR_DEFAULT_WIDTH, 260);
	assert.equal(SIDEBAR_COLLAPSED_WIDTH, 56);
	assert.equal(SIDEBAR_SHEET_WIDTH, SIDEBAR_DEFAULT_WIDTH);
});

test("a stored width is clamped at the render boundary, not refused", () => {
	assert.equal(clampSidebarWidth(260), 260);
	assert.equal(clampSidebarWidth(120), 220);
	assert.equal(clampSidebarWidth(9_000), 320);
	/* `localStorage` can hand back anything at all, including these. */
	assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_DEFAULT_WIDTH);
	assert.equal(clampSidebarWidth(Number.POSITIVE_INFINITY), 320);
});

test("docked: the dock owns the width and offers the divider", () => {
	const layout = resolveSidebarLayout(1380, false, false, 300);
	assert.equal(layout.mode, "docked");
	assert.equal(layout.width, 300);
	assert.equal(layout.collapsed, false);
	assert.equal(layout.resizable, true);
	assert.equal(layout.sheetOpen, false);
});

test("docked and collapsed is the strip, and the divider goes with the dock", () => {
	const layout = resolveSidebarLayout(1024, true, false, 300);
	assert.equal(layout.mode, "strip");
	assert.equal(layout.width, SIDEBAR_COLLAPSED_WIDTH);
	assert.equal(layout.collapsed, true);
	assert.equal(layout.resizable, false);
});

test("below the dock width the preference is OVERRIDDEN but not rewritten", () => {
	/*
	 * The state the user chose is still in the store - this function is handed it
	 * and returns a strip anyway - which is what makes widening the window put the
	 * sidebar back exactly as they left it.
	 */
	const narrow = resolveSidebarLayout(1024 - 1, false, false, 300);
	assert.equal(narrow.mode, "strip");
	assert.equal(narrow.collapsed, true);
	assert.equal(narrow.width, SIDEBAR_COLLAPSED_WIDTH);
	assert.equal(narrow.resizable, false);

	/* And the same preference at the dock width is the dock. */
	const wide = resolveSidebarLayout(SIDEBAR_DOCK_MIN_PX, false, false, 300);
	assert.equal(wide.mode, "docked");
	assert.equal(wide.width, 300);
});

test("the sheet opens below the dock width, and never beside a dock", () => {
	const sheet = resolveSidebarLayout(800, false, true, 300);
	assert.equal(sheet.mode, "overlay");
	assert.equal(sheet.sheetOpen, true);
	assert.equal(sheet.width, SIDEBAR_SHEET_WIDTH);
	/*
	 * The user's own width is not the sheet's: the sheet is a fixed 260px panel
	 * over the pane, and a 320px stored width would have it cover the column it
	 * exists to leave visible.
	 */
	assert.notEqual(sheet.width, 320);

	const dockedRequest = resolveSidebarLayout(1380, false, true, 300);
	assert.equal(dockedRequest.sheetOpen, false);
	assert.equal(dockedRequest.mode, "docked");
});

test("both breakpoints are inclusive at their own width", () => {
	assert.equal(
		resolveSidebarLayout(SIDEBAR_DOCK_MIN_PX, false, false).mode,
		"docked",
	);
	assert.equal(resolveSidebarLayout(1023, false, false).mode, "strip");
	assert.equal(
		resolveSidebarLayout(CHAT_PANE_WITH_DOCK_MIN_PX, false, false).mode,
		"strip",
	);
	assert.equal(resolveSidebarLayout(879, false, true).mode, "overlay");
});

test("the chord is ⌘B / Ctrl+B, and no near miss answers it", () => {
	const press = (over = {}) => ({
		key: "b",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...over,
	});
	assert.equal(isSidebarTogglePress(press({ metaKey: true })), true);
	assert.equal(isSidebarTogglePress(press({ ctrlKey: true })), true);
	/* A bare `b` is a character the composer owns, not a chord. */
	assert.equal(isSidebarTogglePress(press()), false);
	/* Both near misses belong to whoever binds them next. */
	assert.equal(
		isSidebarTogglePress(press({ metaKey: true, shiftKey: true })),
		false,
	);
	assert.equal(
		isSidebarTogglePress(press({ metaKey: true, altKey: true })),
		false,
	);
	assert.equal(isSidebarTogglePress(press({ metaKey: true, key: "n" })), false);
	/* Layouts that do not split the two spellings still answer the chord. */
	assert.equal(isSidebarTogglePress(press({ metaKey: true, key: "B" })), true);

	assert.equal(sidebarToggleCap(true), "⌘B");
	assert.equal(sidebarToggleCap(false), "Ctrl+B");
});

/* ---- §I's first yielding step, which is the sidebar's (design round 2, D24) ---- */

/**
 * §I orders the yielding, and the implementation used to stop at step 2: "the
 * sidebar collapses to the 56px strip (it yields first, because it is re-openable
 * over the pane)" was applied only by the window's own width, so a docked 260px
 * sidebar with the canvas open at 1024 went straight to "the canvas overlays the
 * chat pane instead of docking" - the pane covering the whole conversation, with
 * no scrim and no edge, which is round 1's D2 impression on the other pane.
 *
 * The arithmetic is the whole argument, so the test states it rather than the
 * outcome alone, and it pins BOTH directions: a strip that does not help must
 * not collapse the sidebar for nothing.
 */
test("a docked sidebar yields to the canvas where the yield is what lets it dock", () => {
	/*
	 * The frame's own numbers: at 1024 with the user's 260px, the docked row is
	 * 764 and `canvasDockWidth(764)` is `min(560, 284)` = 284, below the pane's
	 * 400px floor - so the canvas would overlay. With the strip (56) the row is
	 * 968 and the dock is 488, so the chat keeps its 480 floor beside it.
	 */
	assert.equal(
		sidebarYieldsToCanvas(SIDEBAR_DOCK_MIN_PX, SIDEBAR_DEFAULT_WIDTH),
		true,
	);
	assert.equal(canvasDockWidth(1024 - SIDEBAR_DEFAULT_WIDTH), 284);
	assert.ok(
		canvasDockWidth(1024 - SIDEBAR_DEFAULT_WIDTH) < CANVAS_PANE_MIN_PX,
		"the docked row is short of the pane's own floor, which is what forces the overlay",
	);
	assert.equal(canvasDockWidth(1024 - SIDEBAR_COLLAPSED_WIDTH), 488);
	assert.ok(
		canvasDockWidth(1024 - SIDEBAR_COLLAPSED_WIDTH) >= CANVAS_PANE_MIN_PX,
		"with the strip the same window docks the canvas, with the chat's 480 floor intact",
	);
	assert.equal(
		1024 -
			SIDEBAR_COLLAPSED_WIDTH -
			canvasDockWidth(1024 - SIDEBAR_COLLAPSED_WIDTH),
		CHAT_PANE_MIN_PX,
	);
	assert.equal(canvasPaneMode(1024 - SIDEBAR_DEFAULT_WIDTH), "overlay");
	assert.equal(canvasPaneMode(1024 - SIDEBAR_COLLAPSED_WIDTH), "docked");

	const yielded = resolveSidebarLayout(
		1024,
		false,
		false,
		SIDEBAR_DEFAULT_WIDTH,
		true,
	);
	assert.equal(yielded.mode, "strip");
	assert.equal(yielded.width, SIDEBAR_COLLAPSED_WIDTH);
	assert.equal(yielded.collapsed, true);
	assert.equal(
		yielded.resizable,
		false,
		"a yielded strip has nothing to resize: the divider is the dock's control",
	);

	/* Reversible, and the preference is not rewritten: closing the canvas restores it. */
	assert.equal(
		resolveSidebarLayout(1024, false, false, SIDEBAR_DEFAULT_WIDTH, false).mode,
		"docked",
	);

	/* Where the docked sidebar already leaves the canvas its floor, nothing yields. */
	assert.equal(sidebarYieldsToCanvas(1380, SIDEBAR_DEFAULT_WIDTH), false);
	assert.equal(sidebarYieldsToCanvas(1140, SIDEBAR_DEFAULT_WIDTH), false);
	assert.equal(canvasPaneMode(1380 - SIDEBAR_DEFAULT_WIDTH), "docked");

	/* The user's own narrower sidebar still yields - it is the mode that is short, not 260. */
	assert.equal(sidebarYieldsToCanvas(1024, SIDEBAR_MIN_WIDTH), true);

	/*
	 * AND A STRIP THAT WOULD NOT HELP DOES NOT COLLAPSE ANYTHING. Below the dock
	 * threshold the sidebar is a strip for its own reasons, and the canvas still
	 * cannot hold its floor: yielding there would take the panel away for nothing.
	 */
	assert.equal(sidebarYieldsToCanvas(900, SIDEBAR_DEFAULT_WIDTH), false);
	assert.equal(canvasPaneMode(900 - SIDEBAR_COLLAPSED_WIDTH), "overlay");

	/* An already-collapsed sidebar is a strip whatever the canvas does. */
	assert.equal(
		resolveSidebarLayout(1024, true, false, SIDEBAR_DEFAULT_WIDTH, true).mode,
		"strip",
	);
});
