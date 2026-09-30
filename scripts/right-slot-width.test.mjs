import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The right slot's one width (issue #677). The reporter's observation: each
 * surface persisted its own width, so switching surfaces snapped the panel to
 * that surface's own stored number — every switch a resize event for the whole
 * workspace. These cells pin the two halves of the fix at the pure level: the
 * RESOLVER now reads one shared width (falling back to per-pane seeds only
 * while it is unset), and the MIGRATION folds v0's four slots into it without
 * either losing a width the user dragged or freezing a default onto panes that
 * were never touched.
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

const bundle = await build({
	stdin: {
		contents: [
			'export { useUiPreferencesStore, persistedUiPreferences, migrateUiPreferences, resolveRightSlotWidth, DEFAULT_CANVAS_WIDTH, DEFAULT_RUN_PANEL_WIDTH, DEFAULT_BROWSER_PANEL_WIDTH, DEFAULT_CONSOLE_PANEL_WIDTH, RUN_PANEL_MIN_PX, BROWSER_PANEL_MIN_PX, CONSOLE_PANEL_MIN_PX } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { CHAT_PANE_MIN_PX, CANVAS_PANE_MIN_PX, canvasDockWidth } from "./src/renderer/src/features/chat/chat-sidebar-layout";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		// The renderer's own path aliases, restated because esbuild reads the ROOT
		// tsconfig by default and the renderer's mapping lives in `tsconfig.app.json`.
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
	},
	logLevel: "silent",
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	useUiPreferencesStore,
	persistedUiPreferences,
	migrateUiPreferences,
	resolveRightSlotWidth,
	DEFAULT_CANVAS_WIDTH,
	DEFAULT_RUN_PANEL_WIDTH,
	DEFAULT_BROWSER_PANEL_WIDTH,
	DEFAULT_CONSOLE_PANEL_WIDTH,
	RUN_PANEL_MIN_PX,
	BROWSER_PANEL_MIN_PX,
	CONSOLE_PANEL_MIN_PX,
	CHAT_PANE_MIN_PX,
	CANVAS_PANE_MIN_PX,
	canvasDockWidth,
} = mod;

/** The store's state with the shared width set to `width` and one pane open. */
const withPane = (pane, width) => ({
	...useUiPreferencesStore.getState(),
	rightSlotWidth: width,
	isCanvasOpen: pane === "canvas",
	isRunPanelOpen: pane === "run",
	isBrowserPaneOpen: pane === "browser",
	isConsolePaneOpen: pane === "console",
});

const ROW = 1400;

test("a dragged width is what every pane renders: switching surfaces stops resizing (#677)", () => {
	// The reporter's repro, at the resolver: the same row, the same shared 700,
	// whichever of the three right-slot panes is up.
	const width = 700;
	const values = ["run", "browser", "console"].map((pane) =>
		resolveRightSlotWidth(ROW, withPane(pane, width)),
	);
	assert.deepEqual(values, [width, width, width]);
	// The canvas keeps its own dock cap on top of the shared width — its cap is
	// the pane's maximum, not a fifth memory (see `resolveRightSlotWidth`).
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("canvas", width)),
		Math.min(width, canvasDockWidth(ROW)),
	);
});

test("unset opens each pane at its own seed, so a fresh profile is unchanged", () => {
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("run", 0)),
		DEFAULT_RUN_PANEL_WIDTH,
	);
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("browser", 0)),
		DEFAULT_BROWSER_PANEL_WIDTH,
	);
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("console", 0)),
		DEFAULT_CONSOLE_PANEL_WIDTH,
	);
	// The canvas's old 450 zero-read is retired with the four slots: unset is the
	// fresh-profile 800, capped by the dock like any dragged width.
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("canvas", 0)),
		Math.min(DEFAULT_CANVAS_WIDTH, canvasDockWidth(ROW)),
	);
});

test("no pane resolves below its own floor, whatever it was shared from (#677 round 1, D2)", () => {
	// The reviewer's repro: a shared 320 is legal from the run pane's own 320
	// floor, and used to resolve canvas/run/browser/console ALL to 320 — a page
	// drawn under its own 480 while its separator announced the same 320. The
	// resolver holds each pane to its floor, and the separators' minWidths are
	// the same constants, so the range a control reports and the width its pane
	// draws cannot disagree.
	const shared = RUN_PANEL_MIN_PX;
	assert.equal(resolveRightSlotWidth(ROW, withPane("run", shared)), shared);
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("browser", shared)),
		BROWSER_PANEL_MIN_PX,
	);
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("console", shared)),
		CONSOLE_PANEL_MIN_PX,
	);
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("canvas", shared)),
		Math.min(CANVAS_PANE_MIN_PX, canvasDockWidth(ROW)),
	);
});

test("from every floor upwards the one width still holds exactly (#677 round 1, D2)", () => {
	// A lift, not a rewrite: at and above the highest floor every non-canvas
	// pane renders the shared value itself — the switch-equality #677 promised
	// is unchanged there. (The canvas keeps its dock cap on top, as before.)
	for (const width of [480, 700, 900]) {
		const values = ["run", "browser", "console"].map((pane) =>
			resolveRightSlotWidth(ROW, withPane(pane, width)),
		);
		assert.deepEqual(values, [width, width, width]);
	}
});

test("the conversation's floor still wins over the shared width", () => {
	// The leftover arithmetic is untouched by #677: a shared width cannot push
	// the conversation below its floor.
	const width = 900;
	const row = CHAT_PANE_MIN_PX + 300;
	assert.equal(resolveRightSlotWidth(row, withPane("browser", width)), 300);
	assert.equal(
		resolveRightSlotWidth(row, withPane("canvas", width)),
		Math.min(width, canvasDockWidth(row)),
	);
});

test("the store's setter and reset move the one shared value", () => {
	useUiPreferencesStore.getState().setRightSlotWidth(712);
	assert.equal(useUiPreferencesStore.getState().rightSlotWidth, 712);
	useUiPreferencesStore.getState().restoreDefaultRightSlotWidth();
	assert.equal(
		useUiPreferencesStore.getState().rightSlotWidth,
		0,
		"a reset is unset, not some pane's number handed to the others",
	);
	// And the shared value is what the persisted blob carries, because the four
	// per-surface slots no longer exist to carry anything themselves.
	const persisted = persistedUiPreferences(useUiPreferencesStore.getState());
	assert.equal("rightSlotWidth" in persisted, true);
	assert.equal("browserPanelWidth" in persisted, false);
	assert.equal("consolePanelWidth" in persisted, false);
});

test("a v0 blob seeds the shared width from the first dragged slot", () => {
	const migrated = migrateUiPreferences(
		{
			themeName: "dracula",
			canvasWidth: DEFAULT_CANVAS_WIDTH,
			runPanelWidth: DEFAULT_RUN_PANEL_WIDTH,
			browserPanelWidth: 700,
			consolePanelWidth: DEFAULT_CONSOLE_PANEL_WIDTH,
		},
		0,
	);
	assert.equal(migrated.rightSlotWidth, 700);
	assert.equal(migrated.themeName, "dracula", "other fields ride through");
	for (const key of [
		"canvasWidth",
		"runPanelWidth",
		"browserPanelWidth",
		"consolePanelWidth",
	]) {
		assert.equal(key in migrated, false, `${key} is folded, not kept`);
	}
});

test("the seeding order is the slot's own reading order", () => {
	// Two dragged slots: the resolver's precedence (canvas, run, browser,
	// console) decides, so the outcome is deterministic rather than incidental.
	const migrated = migrateUiPreferences(
		{ canvasWidth: 900, runPanelWidth: 500, browserPanelWidth: 700 },
		0,
	);
	assert.equal(migrated.rightSlotWidth, 900);
});

test("a blob with nothing dragged seeds unset, not some default", () => {
	// The fresh-profile experience must survive migration: if no slot differed
	// from its own default, the shared width stays unset so every pane keeps
	// opening at its own seed.
	const migrated = migrateUiPreferences(
		{
			canvasWidth: DEFAULT_CANVAS_WIDTH,
			runPanelWidth: DEFAULT_RUN_PANEL_WIDTH,
			browserPanelWidth: DEFAULT_BROWSER_PANEL_WIDTH,
			consolePanelWidth: DEFAULT_CONSOLE_PANEL_WIDTH,
		},
		0,
	);
	assert.equal(migrated.rightSlotWidth, 0);
	// A blob that never carried any of the four keys seeds the same way — every
	// blob in the field today is version 0, so this is the ordinary upgrade.
	assert.equal(
		migrateUiPreferences({ themeName: "dracula" }, 0).rightSlotWidth,
		0,
	);
});

test("a v1 blob is passed through untouched", () => {
	const blob = { rightSlotWidth: 712, themeName: "dracula" };
	assert.deepEqual(migrateUiPreferences(blob, 1), blob);
});
