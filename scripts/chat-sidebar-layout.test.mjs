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
import { readFileSync } from "node:fs";
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
	CHAT_PANE_MIN_PX,
	CHAT_PANE_WITH_DOCK_MIN_PX,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_DOCK_MIN_PX,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_SHEET_WIDTH,
	clampSidebarWidth,
	isSidebarTogglePress,
	resolveSidebarLayout,
	sidebarToggleCap,
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

test("the chat pane's own floor, and the arithmetic each band is argued from", () => {
	/*
	 * §I / §B1: the pane is 480 minimum, and this asserts the floor's VALUE against
	 * its two arguments rather than restating it - the 640 column plus its 24px
	 * gutters is 688, and 480 is where that column degrades to full-width-minus-24
	 * with prose still past 60 characters. The two sidebar bands are checked against
	 * it in the same test, because a floor that does not fit beside a band is a floor
	 * that band cannot claim: strip 56 + 480 = 536 <= 880 (the width at which the
	 * pane can hold its floor beside the strip), docked 260 + 480 = 740 <= 1024.
	 */
	assert.equal(CHAT_PANE_MIN_PX, 480);
	assert.ok(
		SIDEBAR_COLLAPSED_WIDTH + CHAT_PANE_MIN_PX <= CHAT_PANE_WITH_DOCK_MIN_PX,
		"the icon strip plus the pane's floor does not fit inside the width the pane is said to hold its floor at",
	);
	assert.ok(
		SIDEBAR_DEFAULT_WIDTH + CHAT_PANE_MIN_PX <= SIDEBAR_DOCK_MIN_PX,
		"the docked sidebar plus the pane's floor does not fit inside the dock threshold",
	);
	/*
	 * AND THE PANE APPLIES IT AS `min(480px, 100%)`, not as a flat 480: a window
	 * narrower than the floor itself must give the pane its own width rather than
	 * force a horizontal scrollbar, which is the frame the flat form breaks and the
	 * reason the clamp is spelled out here rather than left to the class surface.
	 */
	const layout = readFileSync(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
		"utf8",
	);
	assert.match(layout, /minWidth: `min\(\$\{CHAT_PANE_MIN_PX\}px, 100%\)`/);
});
