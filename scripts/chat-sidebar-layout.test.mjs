/**
 * The one sidebar's geometry, driven against the SHIPPED module.
 *
 * The reason the module exists is stated on it: a layout decision written as a
 * JSX condition is a decision no test in this suite can reach, because
 * `pnpm test:desktop` bundles the shipped TypeScript in memory rather than
 * rendering components. So both sidebar modes, the render-only width cap and
 * the chord are all asserted here against `chat-sidebar-layout.ts` itself.
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
const ON_COLLAPSE = /onCollapse: toggleSidebar/;
const ON_TOGGLE = /const onToggle = useCallback\(([\s\S]*?)\n\t\);/;
const TOGGLE_SIDEBAR = /toggleSidebar\(\);/;
const VIEWPORT_WIDTH = /viewportWidth/;

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
	PANEL_RAIL_WIDTH_PX,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	CANVAS_PANE_MIN_PX,
	CHAT_PANE_MIN_PX,
	canvasDockWidth,
	canvasPaneMode,
	clampSidebarWidth,
	isSidebarTogglePress,
	resolveSidebarLayout,
	sidebarDockCapacity,
	sidebarToggleCap,
	sidebarYieldsToCanvas,
} = await import(
	`data:text/javascript;base64,${Buffer.from(layoutBundle.outputFiles[0].text).toString("base64")}`
);

test("the canvas fit floor stays independent of the sidebar preference", () => {
	/*
	 * The 880px canvas fit rule is a separate contract from docking preference:
	 * chat 480 + canvas 400. Keeping it pinned prevents the #1077 change from
	 * silently rewriting the canvas/ask yield that must remain unchanged.
	 */
	assert.equal(CHAT_PANE_WITH_DOCK_MIN_PX, 880);
	assert.equal(
		CHAT_PANE_WITH_DOCK_MIN_PX,
		CHAT_PANE_MIN_PX + CANVAS_PANE_MIN_PX,
	);
});

test("the resize range is the one the message list already occupied", () => {
	assert.equal(SIDEBAR_MIN_WIDTH, 220);
	assert.equal(SIDEBAR_MAX_WIDTH, 320);
	assert.equal(SIDEBAR_DEFAULT_WIDTH, 260);
	assert.equal(SIDEBAR_COLLAPSED_WIDTH, 56);
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
	const layout = resolveSidebarLayout(1380, false, 300);
	assert.equal(layout.mode, "docked");
	assert.equal(layout.width, 300);
	assert.equal(layout.collapsed, false);
	assert.equal(layout.resizable, true);
});

test("docked and collapsed is the strip, and the divider goes with the dock", () => {
	const layout = resolveSidebarLayout(1024, true, 300);
	assert.equal(layout.mode, "strip");
	assert.equal(layout.width, SIDEBAR_COLLAPSED_WIDTH);
	assert.equal(layout.collapsed, true);
	assert.equal(layout.resizable, false);
});

test("the expanded preference stays docked at every window width", () => {
	for (const viewportWidth of [1380, 1024, 1023, 800]) {
		const layout = resolveSidebarLayout(viewportWidth, false, 300);
		assert.equal(
			layout.mode,
			"docked",
			`${viewportWidth}px must honour expanded`,
		);
		assert.equal(layout.collapsed, false);
		assert.equal(layout.resizable, true);
		/*
		 * At 800 the 44px rail and the chat's 480px floor leave 276px. Cap only
		 * the drawn width: the stored 300px preference survives for a wider window.
		 */
		assert.equal(
			layout.width,
			Math.min(300, viewportWidth - 480 - PANEL_RAIL_WIDTH_PX),
		);
	}
});

test("the collapsed preference stays a strip at every window width", () => {
	for (const viewportWidth of [1380, 1023, 800]) {
		const layout = resolveSidebarLayout(viewportWidth, true, 300);
		assert.equal(
			layout.mode,
			"strip",
			`${viewportWidth}px must honour collapsed`,
		);
		assert.equal(layout.collapsed, true);
		assert.equal(layout.width, SIDEBAR_COLLAPSED_WIDTH);
		assert.equal(layout.resizable, false);
	}
});

test("the render-only capacity cap preserves the chat floor and rail", () => {
	assert.equal(sidebarDockCapacity(800), 276);
	assert.equal(sidebarDockCapacity(800, 0), 320);
	assert.equal(sidebarDockCapacity(1023), SIDEBAR_MAX_WIDTH);
	assert.equal(sidebarDockCapacity(1380), SIDEBAR_MAX_WIDTH);
});

test("a stored 320px width fits an 800px chat window without being rewritten", () => {
	const narrow = resolveSidebarLayout(800, false, 320);
	assert.equal(narrow.mode, "docked");
	assert.equal(narrow.width, 800 - CHAT_PANE_MIN_PX - PANEL_RAIL_WIDTH_PX);
	assert.equal(narrow.width, 276);
	assert.equal(narrow.width + CHAT_PANE_MIN_PX + PANEL_RAIL_WIDTH_PX, 800);
	/* The same stored preference is restored whole when the window has room. */
	assert.equal(resolveSidebarLayout(1380, false, 320).width, 320);
});

test("both shell controls write the preference, with no narrow overlay branch", () => {
	/*
	 * The shipped-module cases above prove the geometry; this source guard keeps
	 * the two DOM controls wired to that same contract. The built-Electron scene
	 * supplies the real keyboard/pointer and no-sheet evidence.
	 */
	const shell = readFileSync(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
		"utf8",
	);
	assert.ok(!shell.includes("SIDEBAR_DOCK_MIN_PX"));
	assert.ok(!shell.includes("sheetRequested"));
	assert.ok(!shell.includes("SheetContent"));
	assert.match(shell, ON_COLLAPSE);
	const chord = ON_TOGGLE.exec(shell);
	assert.ok(chord, "the sidebar keyboard handler is missing");
	assert.match(chord[1], TOGGLE_SIDEBAR);
	assert.doesNotMatch(chord[1], VIEWPORT_WIDTH);
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
 * chat pane instead of docking" - the pane floating over the conversation, with
 * no scrim and no edge, which is round 1's D2 impression on the other pane.
 *
 * The arithmetic is the whole argument, so the test states it rather than the
 * outcome alone, and it pins BOTH directions: a strip that does not help must
 * not collapse the sidebar for nothing.
 */
test("a docked sidebar yields to the canvas where the yield is what lets it dock", () => {
	/*
	 * The frame's own numbers: at 1024 with the user's 260px, the docked row is
	 * 764 and `canvasDockWidth(764)` is `min(1200, 284)` = 284, below the pane's
	 * 400px floor - so the canvas would stop docking. With the strip (56) the row is
	 * 968 and the dock is 488, so the chat keeps its 480 floor beside it.
	 */
	assert.equal(sidebarYieldsToCanvas(1024, SIDEBAR_DEFAULT_WIDTH), true);
	assert.equal(canvasDockWidth(1024 - SIDEBAR_DEFAULT_WIDTH), 284);
	assert.ok(
		canvasDockWidth(1024 - SIDEBAR_DEFAULT_WIDTH) < CANVAS_PANE_MIN_PX,
		"the docked row is short of the pane's own floor, which is what stops the dock",
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
		resolveSidebarLayout(1024, false, SIDEBAR_DEFAULT_WIDTH, false).mode,
		"docked",
	);

	/* Where the docked sidebar already leaves the canvas its floor, nothing yields. */
	assert.equal(sidebarYieldsToCanvas(1380, SIDEBAR_DEFAULT_WIDTH), false);
	assert.equal(sidebarYieldsToCanvas(1184, SIDEBAR_DEFAULT_WIDTH), false);
	assert.equal(canvasPaneMode(1380 - SIDEBAR_DEFAULT_WIDTH), "docked");

	/* The user's own narrower sidebar still yields - it is the mode that is short, not 260. */
	assert.equal(sidebarYieldsToCanvas(1024, SIDEBAR_MIN_WIDTH), true);

	/*
	 * AND A STRIP THAT WOULD NOT HELP DOES NOT COLLAPSE ANYTHING. At 900 even
	 * the strip cannot let the canvas dock, so the fit-yield is false and the
	 * user's expanded preference keeps the dock; the canvas overlays instead.
	 */
	assert.equal(sidebarYieldsToCanvas(900, SIDEBAR_DEFAULT_WIDTH), false);
	assert.equal(canvasPaneMode(900 - SIDEBAR_COLLAPSED_WIDTH), "overlay");
	assert.equal(
		resolveSidebarLayout(900, false, SIDEBAR_DEFAULT_WIDTH, true).mode,
		"docked",
	);

	/* An already-collapsed sidebar is a strip whatever the canvas does. */
	assert.equal(
		resolveSidebarLayout(1024, true, SIDEBAR_DEFAULT_WIDTH, true).mode,
		"strip",
	);
});

/*
 * #872: THE PANEL RAIL IS PART OF THE ROW'S DEFICIT, so the yield's band moved up by
 * the rail's 44px. The measured row the canvas docks in is window - sidebar - rail
 * (the rail is a sibling after the measured column), and `sidebarYieldsToCanvas`
 * predicts that row from the window alone. Without the subtraction the band
 * 1140-1183 at the default 260 is the D24 defect again: the sidebar stays docked, the
 * real row is 44px short of the canvas's floor, and the canvas stops docking.
 */
test("the yield counts the 44px panel rail: the band is 980-1183 at the default sidebar", () => {
	assert.equal(PANEL_RAIL_WIDTH_PX, 44);
	/* 979 is below the band: even the strip leaves only 879 for chat + canvas. */
	assert.equal(sidebarYieldsToCanvas(979, SIDEBAR_DEFAULT_WIDTH), false);
	assert.equal(
		resolveSidebarLayout(979, false, SIDEBAR_DEFAULT_WIDTH, true).mode,
		"docked",
	);
	for (const width of [980, 1023, 1024, 1100, 1139, 1140, 1160, 1183]) {
		const row = width - SIDEBAR_DEFAULT_WIDTH - PANEL_RAIL_WIDTH_PX;
		assert.equal(
			canvasPaneMode(row),
			"overlay",
			`${width}: the docked row (${row}) is short of the canvas floor`,
		);
		assert.equal(
			canvasPaneMode(width - SIDEBAR_COLLAPSED_WIDTH - PANEL_RAIL_WIDTH_PX),
			"docked",
			`${width}: the strip would let it dock`,
		);
		assert.equal(
			sidebarYieldsToCanvas(width, SIDEBAR_DEFAULT_WIDTH),
			true,
			`${width} must yield: the rail is taken out of the row`,
		);
		assert.equal(
			resolveSidebarLayout(width, false, SIDEBAR_DEFAULT_WIDTH, true).mode,
			"strip",
		);
	}
	/* 1184 is the first width where the docked row (880) holds 400 + 480. */
	assert.equal(
		canvasDockWidth(1184 - SIDEBAR_DEFAULT_WIDTH - PANEL_RAIL_WIDTH_PX),
		CANVAS_PANE_MIN_PX,
	);
	assert.equal(sidebarYieldsToCanvas(1184, SIDEBAR_DEFAULT_WIDTH), false);
	assert.equal(
		resolveSidebarLayout(1184, false, SIDEBAR_DEFAULT_WIDTH, true).mode,
		"docked",
	);
	/*
	 * NO RAIL, NO DEDUCTION: settings and agents mount no rail, and the fleet asks
	 * pane still docks there. The shell passes 0, which restores the rail-less band
	 * exactly, so the sidebar does not collapse for 44px nobody took.
	 */
	assert.equal(sidebarYieldsToCanvas(1140, SIDEBAR_DEFAULT_WIDTH, 0), false);
	assert.equal(sidebarYieldsToCanvas(1139, SIDEBAR_DEFAULT_WIDTH, 0), true);
	assert.equal(
		resolveSidebarLayout(1140, false, SIDEBAR_DEFAULT_WIDTH, true, 0).mode,
		"docked",
	);
});
