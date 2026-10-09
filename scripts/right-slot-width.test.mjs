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
			'export { useUiPreferencesStore, persistedUiPreferences, migrateUiPreferences, UI_PREFERENCES_VERSION, resolveRightSlotWidth, resolveRightSlotOccupied, resolveRightSlotYieldsSidebar, resolveDrawnRightSlotPane, EMPTY_RIGHT_SLOT_ROUTE, DEFAULT_CANVAS_WIDTH, DEFAULT_RUN_PANEL_WIDTH, DEFAULT_BROWSER_PANEL_WIDTH, DEFAULT_CONSOLE_PANEL_WIDTH, RUN_PANEL_MIN_PX, BROWSER_PANEL_MIN_PX, CONSOLE_PANEL_MIN_PX } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { CHAT_PANE_MIN_PX, CANVAS_PANE_MIN_PX, canvasDockWidth, resolveSidebarLayout, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_DOCK_MIN_PX } from "./src/renderer/src/features/chat/chat-sidebar-layout";',
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
	UI_PREFERENCES_VERSION,
	resolveRightSlotWidth,
	resolveRightSlotOccupied,
	resolveRightSlotYieldsSidebar,
	resolveDrawnRightSlotPane,
	EMPTY_RIGHT_SLOT_ROUTE,
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
	resolveSidebarLayout,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_DOCK_MIN_PX,
} = mod;

/** The store's state with the shared width set to `width` and one pane open. */
const withPane = (pane, width) => ({
	...useUiPreferencesStore.getState(),
	rightSlotWidth: width,
	isCanvasOpen: pane === "canvas",
	isRunPanelOpen: pane === "run",
	isBrowserPaneOpen: pane === "browser",
	isConsolePaneOpen: pane === "console",
	isAskDrawerOpen: pane === "ask",
	/*
	 * A route every pane is drawable on: the facts the slot's readers take since
	 * #868. These cells are about the WIDTH arithmetic, so the route is the
	 * drawable one; the route matrix is `claimed`'s subject below.
	 */
	rightSlotRoute: { mounted: true, runDetails: true, session: true },
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

/*
 * #868: THE ROUTE'S HALF OF THE SLOT'S TRUTH.
 *
 * The five pane flags persist across routes ON PURPOSE (what belongs to the
 * window's slot survives a conversation switch), so a claimed pane is not
 * always a pane a route can DRAW: the run panel needs run details, the
 * session-scoped asks drawer needs a conversation, and a route with no chat
 * surface mounts none of the five. The resolver and the header's occupancy
 * boolean have to answer from the route's facts (see `rightSlotRoute`) or a
 * flag that outlived its route reserves an empty column and paints the empty
 * band the operator reported.
 */
const route = (mounted, runDetails, session) => ({
	mounted,
	runDetails,
	session,
});
/** The store's state with `pane` claimed and the route's facts set. */
const claimed = (pane, facts, scope = "session") => ({
	...useUiPreferencesStore.getState(),
	rightSlotWidth: 0,
	isCanvasOpen: pane === "canvas",
	isRunPanelOpen: pane === "run",
	isBrowserPaneOpen: pane === "browser",
	isConsolePaneOpen: pane === "console",
	isAskDrawerOpen: pane === "ask",
	askDrawerScope: scope,
	rightSlotRoute: facts,
});

test("a claimed pane the route cannot draw answers no width (#868)", () => {
	// The captured sequence: the drawer closes and hands the run flag back, then
	// New chat - no run details, nothing to mount.
	assert.equal(
		resolveRightSlotWidth(ROW, claimed("run", route(true, false, false))),
		0,
	);
	// A conversation whose canonical frame has not arrived: same answer, same
	// reason - the run panel's mount gate is runDetails, not the flag.
	assert.equal(
		resolveRightSlotWidth(ROW, claimed("run", route(true, false, true))),
		0,
	);
	// The session-scoped drawer's flag on a draft: no conversation, no home.
	assert.equal(
		resolveRightSlotWidth(ROW, claimed("ask", route(true, false, false))),
		0,
	);
	// A route with no chat surface at all (settings, agents): none of the five
	// mounts, so no flag holds the slot.
	for (const pane of ["canvas", "run", "browser", "console", "ask"]) {
		assert.equal(
			resolveRightSlotWidth(ROW, claimed(pane, route(false, false, false))),
			0,
			`${pane} held the slot on a route with no chat surface`,
		);
	}
	// The occupancy boolean the header reserves from answers the same.
	assert.equal(
		resolveRightSlotOccupied(claimed("run", route(true, false, false))),
		false,
	);
	assert.equal(
		resolveRightSlotOccupied(claimed("ask", route(true, false, false))),
		false,
	);
	assert.equal(
		resolveRightSlotOccupied(claimed("canvas", route(false, false, false))),
		false,
	);
});

test("the drawable half is untouched: a pane the route mounts still holds the slot (#868)", () => {
	// The fix must not release panes a route CAN draw - a second way of leaking
	// the column would be no better than the first.
	assert.equal(
		resolveRightSlotWidth(ROW, claimed("run", route(true, true, true))),
		DEFAULT_RUN_PANEL_WIDTH,
	);
	assert.equal(
		resolveRightSlotWidth(ROW, claimed("canvas", route(true, false, false))),
		Math.min(DEFAULT_CANVAS_WIDTH, canvasDockWidth(ROW)),
	);
	assert.equal(
		resolveRightSlotWidth(ROW, claimed("ask", route(true, false, true))),
		Math.min(DEFAULT_CANVAS_WIDTH, canvasDockWidth(ROW)),
	);
	// The fleet drawer's home is the shell, which every route has - it needs no
	// conversation, and it is drawable even where the chat surface is not.
	assert.equal(
		resolveRightSlotWidth(
			ROW,
			claimed("ask", route(false, false, false), "fleet"),
		),
		Math.min(DEFAULT_CANVAS_WIDTH, canvasDockWidth(ROW)),
	);
	assert.equal(
		resolveRightSlotOccupied(claimed("run", route(true, true, true))),
		true,
	);
	assert.equal(
		resolveRightSlotOccupied(
			claimed("ask", route(false, false, false), "fleet"),
		),
		true,
	);
	// Nothing claimed is nothing occupied, whatever the route could draw.
	assert.equal(
		resolveRightSlotOccupied(claimed("none", route(true, true, true))),
		false,
	);
	// The route facts are not persisted: they describe where the app IS, and the
	// next launch publishes its own.
	assert.equal(
		"rightSlotRoute" in
			persistedUiPreferences(useUiPreferencesStore.getState()),
		false,
	);
});

test("publishing facts that did not move wakes nobody and writes nothing (#868, review R1)", () => {
	/*
	 * The publisher re-runs for its own reasons (a render, a frame of a live
	 * run), so the setter's contract is that an unchanged fact set is invisible:
	 * zustand only skips a set whose updater returns the SAME state object, and
	 * the first spelling of this returned `{}` - five identical publishes were
	 * five notifications and five localStorage writes.
	 */
	const store = useUiPreferencesStore;
	const facts = { mounted: true, runDetails: true, session: true };
	// Start from a known, different answer so the first publish is a real move.
	store.getState().setRightSlotRoute(EMPTY_RIGHT_SLOT_ROUTE);
	let notifications = 0;
	const unsubscribe = store.subscribe(() => {
		notifications += 1;
	});
	// `persist` writes through the storage object's `setItem`, which lands in
	// `memory.set`; counting there sees exactly the blob rewrites.
	let writes = 0;
	const realSet = memory.set.bind(memory);
	memory.set = (key, value) => {
		writes += 1;
		return realSet(key, value);
	};
	try {
		store.getState().setRightSlotRoute(facts);
		assert.equal(notifications, 1, "the first publish is a real move");
		const afterFirst = { notifications, writes };
		const published = store.getState().rightSlotRoute;
		for (let i = 0; i < 5; i += 1) {
			store.getState().setRightSlotRoute({ ...facts });
		}
		assert.equal(
			notifications - afterFirst.notifications,
			0,
			"an identical publish woke a subscriber",
		);
		assert.equal(
			writes - afterFirst.writes,
			0,
			"an identical publish rewrote the persisted blob",
		);
		assert.equal(
			store.getState().rightSlotRoute,
			published,
			"the facts object was replaced by an identical one",
		);
		// And a real move still gets through, so the guard is not a stuck setter.
		store.getState().setRightSlotRoute({ ...facts, runDetails: false });
		assert.equal(notifications - afterFirst.notifications, 1);
		assert.equal(store.getState().rightSlotRoute.runDetails, false);
	} finally {
		memory.set = realSet;
		unsubscribe();
		store.getState().setRightSlotRoute(EMPTY_RIGHT_SLOT_ROUTE);
	}
});

test("a flag that outlived its route does not collapse the docked sidebar (#868, review R2)", () => {
	/*
	 * The reporter's window is 1024 wide, inside the band (1024-1139 at the
	 * default 260px sidebar) where a docked sidebar and a DOCKING canvas cannot
	 * both keep their floors, so a claimed canvas/asks pane steps the sidebar down
	 * to the strip. That step is right for a pane that is drawn and wrong for a
	 * flag with no pane behind it - the 1280px frames cannot show the difference.
	 */
	const layoutFor = (width, state) =>
		resolveSidebarLayout(
			width,
			false,
			false,
			SIDEBAR_DEFAULT_WIDTH,
			resolveRightSlotYieldsSidebar(state),
		);
	// The control: what the bare flag did. If this stops collapsing, the band
	// moved and the cells below no longer discriminate.
	assert.equal(
		resolveSidebarLayout(1024, false, false, SIDEBAR_DEFAULT_WIDTH, true).mode,
		"strip",
	);
	for (const width of [SIDEBAR_DOCK_MIN_PX, 1100, 1139, 1183]) {
		// Stale: the session drawer's flag on a draft, and a canvas flag on a
		// route with no chat surface. Both must leave the sidebar docked.
		for (const stale of [
			claimed("ask", route(true, false, false)),
			claimed("canvas", route(false, false, false)),
		]) {
			const layout = layoutFor(width, stale);
			assert.equal(
				layout.mode,
				"docked",
				`${width}px collapsed on a stale flag`,
			);
			assert.equal(layout.width, SIDEBAR_DEFAULT_WIDTH);
		}
		// Drawn: the same claims on a route that can draw them yield exactly as
		// the bare flag did before.
		for (const drawn of [
			claimed("canvas", route(true, false, false)),
			claimed("ask", route(true, false, true)),
			// the fleet scope's home is the shell: drawn on every route
			claimed("ask", route(false, false, false), "fleet"),
		]) {
			const layout = layoutFor(width, drawn);
			assert.equal(
				layout.mode,
				"strip",
				`${width}px did not yield to a drawn pane`,
			);
			assert.equal(layout.width, SIDEBAR_COLLAPSED_WIDTH);
		}
	}
	// Outside the band nothing yields, drawn or not: 1184 keeps both floors (the
	// band is 1024-1183 since the 44px panel rail joined the row's deficit, #872).
	assert.equal(
		layoutFor(1184, claimed("canvas", route(true, false, false))).mode,
		"docked",
	);
	// The run panel, the browser and the console never yielded the sidebar, and
	// still do not - the answer is the canvas family's, not "any pane".
	for (const pane of ["run", "browser", "console"]) {
		assert.equal(
			resolveRightSlotYieldsSidebar(claimed(pane, route(true, true, true))),
			false,
			`${pane} started yielding the sidebar`,
		);
	}
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

test("a blob already at the current version is passed through untouched", () => {
	const blob = { rightSlotWidth: 712, themeName: "dracula" };
	assert.deepEqual(migrateUiPreferences(blob, UI_PREFERENCES_VERSION), blob);
});

/*
 * v2 (#895): the conversation column's two drag handles and the width they
 * persisted are gone, so `chatMeasureWidth` is dropped from a stored blob. The
 * cells below pin the three things the step has to get right: it drops ONLY the
 * retired key, it runs for a blob that never saw v1 as well (zustand calls the
 * migration once with the STORED version, so an early return after the #677 fold
 * would leave a v0 blob's key behind), and it reaches the live store through a
 * real rehydrate rather than only through the pure function.
 */
test("the persist version is 2, the step that drops chatMeasureWidth (#895)", () => {
	assert.equal(UI_PREFERENCES_VERSION, 2);
});

test("a v1 blob loses only the retired chatMeasureWidth (#895)", () => {
	const migrated = migrateUiPreferences(
		{ chatMeasureWidth: 900, rightSlotWidth: 712, themeName: "dracula" },
		1,
	);
	assert.equal("chatMeasureWidth" in migrated, false);
	assert.deepEqual(migrated, { rightSlotWidth: 712, themeName: "dracula" });
});

test("a v0 blob gets both the #677 fold and the chatMeasureWidth drop (#895)", () => {
	const migrated = migrateUiPreferences(
		{
			themeName: "dracula",
			chatMeasureWidth: 520,
			canvasWidth: DEFAULT_CANVAS_WIDTH,
			runPanelWidth: DEFAULT_RUN_PANEL_WIDTH,
			browserPanelWidth: 700,
			consolePanelWidth: DEFAULT_CONSOLE_PANEL_WIDTH,
		},
		0,
	);
	assert.equal(migrated.rightSlotWidth, 700, "the fold still ran");
	assert.equal("browserPanelWidth" in migrated, false);
	assert.equal("chatMeasureWidth" in migrated, false, "and so did the drop");
	assert.equal(migrated.themeName, "dracula");
});

test("a stored v1 blob with a customised measure rehydrates to a store without it, rewritten at v2 (#895)", async () => {
	/*
	 * `persist.getOptions()` is deliberately not used: the store's own note at its
	 * `partialize` records it failing on CI's node. A seeded blob and a real
	 * `rehydrate()` is the path a relaunch takes.
	 */
	memory.set(
		"ui-preferences-storage",
		JSON.stringify({
			state: {
				chatMeasureWidth: 900,
				themeName: "dracula",
				rightSlotWidth: 640,
			},
			version: 1,
		}),
	);
	await useUiPreferencesStore.persist.rehydrate();
	const state = useUiPreferencesStore.getState();
	assert.equal(
		"chatMeasureWidth" in state,
		false,
		"the stale key must not survive zustand's default merge",
	);
	assert.equal(state.themeName, "dracula", "the rest of the blob is kept");
	assert.equal(state.rightSlotWidth, 640);
	const written = JSON.parse(memory.get("ui-preferences-storage"));
	assert.equal(written.version, UI_PREFERENCES_VERSION);
	assert.equal(
		"chatMeasureWidth" in written.state,
		false,
		"the rewritten blob must not carry it forward",
	);
	assert.equal(written.state.rightSlotWidth, 640);
	memory.delete("ui-preferences-storage");
});

test("the persisted projection of the live store has no chatMeasureWidth (#895)", () => {
	const persisted = persistedUiPreferences(useUiPreferencesStore.getState());
	assert.equal("chatMeasureWidth" in persisted, false);
});

/**
 * THE FIFTH OCCUPANT (design note §2). The asks drawer joined the right slot in
 * the side-canvas change, and both halves of the slot's contract have to cover it
 * or it would be the one pane that escapes the invariant the other four share:
 * one width for the slot, and one pane in it at a time.
 */
test("the asks drawer wears the canvas family's width, and takes the slot alone", () => {
	// GEOMETRY: the drawer's width is the family's arithmetic - the shared value
	// (or the canvas's seed), held to the 400 floor and capped by the dock - which
	// is what the design note means by the width being the CONTAINER's consequence
	// rather than a rule of its own.
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("ask", 700)),
		Math.min(700, canvasDockWidth(ROW)),
	);
	assert.equal(
		resolveRightSlotWidth(ROW, withPane("ask", 0)),
		Math.min(DEFAULT_CANVAS_WIDTH, canvasDockWidth(ROW)),
	);
	// Below the dock's own floor the answer is zero and the MODE overlays the
	// conversation instead (`canvasPaneMode`) - never a negative box with a divider
	// still drawn.
	assert.equal(resolveRightSlotWidth(CHAT_PANE_MIN_PX, withPane("ask", 0)), 0);

	// EXCLUSION, through the store's own actions rather than restated here: opening
	// the drawer closes all four siblings, and each of them closes the drawer.
	const slotState = () => ({
		ask: useUiPreferencesStore.getState().isAskDrawerOpen,
		canvas: useUiPreferencesStore.getState().isCanvasOpen,
		run: useUiPreferencesStore.getState().isRunPanelOpen,
		browser: useUiPreferencesStore.getState().isBrowserPaneOpen,
		console: useUiPreferencesStore.getState().isConsolePaneOpen,
	});
	useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
	assert.deepEqual(
		slotState(),
		{ ask: true, canvas: false, run: false, browser: false, console: false },
		"opening the drawer takes the slot",
	);
	for (const [open, flag] of [
		["setCanvasOpen", "canvas"],
		["setRunPanelOpen", "run"],
		["setBrowserPaneOpen", "browser"],
		["setConsolePaneOpen", "console"],
	]) {
		useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
		useUiPreferencesStore.getState()[open](true);
		/*
		 * THE WHOLE SLOT, not just the drawer's flag (agent review round 1, N2): the
		 * sibling has to have actually CLAIMED it. An assertion on
		 * `isAskDrawerOpen === false` alone passes for a setter that cleared the drawer
		 * without taking the slot, which would leave the window with nothing drawn in
		 * the place the user asked for a pane.
		 */
		assert.deepEqual(
			slotState(),
			{
				ask: false,
				canvas: flag === "canvas",
				run: flag === "run",
				browser: flag === "browser",
				console: flag === "console",
			},
			`${open} takes the slot from the drawer`,
		);
	}
	useUiPreferencesStore.getState().setAskDrawerOpen(false, "session");

	/*
	 * AND THE DRAWER BORROWS THE SLOT RATHER THAN EVICTING IT (UX round 1, U6).
	 *
	 * The exclusivity above means opening the drawer writes `isCanvasOpen: false` -
	 * and that flag is persisted, so a peek at a queue used to survive as a preference
	 * the user never expressed: a relaunch came back with the canvas gone. The pane the
	 * drawer displaced is recorded and given back on close, and what the snapshot
	 * writes while the drawer is open is the durable pane rather than the borrow.
	 */
	useUiPreferencesStore.getState().setCanvasOpen(true);
	useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
	assert.equal(useUiPreferencesStore.getState().isAskDrawerOpen, true);
	assert.equal(
		useUiPreferencesStore.getState().askDrawerEvictedPane,
		"isCanvasOpen",
		"the pane the drawer took the slot from is recorded",
	);
	const whilePeeking = persistedUiPreferences(useUiPreferencesStore.getState());
	assert.equal(
		whilePeeking.isCanvasOpen,
		true,
		"a relaunch while the drawer is open still restores the document it covered",
	);
	assert.equal("isAskDrawerOpen" in whilePeeking, false);
	assert.equal("askDrawerEvictedPane" in whilePeeking, false);

	// Closing gives the slot back rather than leaving the user with nothing.
	useUiPreferencesStore.getState().setAskDrawerOpen(false, "session");
	assert.deepEqual(
		slotState(),
		{ ask: false, canvas: true, run: false, browser: false, console: false },
		"closing the drawer returns the slot to the pane it borrowed",
	);
	assert.equal(useUiPreferencesStore.getState().askDrawerEvictedPane, null);

	// A DELIBERATE CHOICE DURING THE PEEK WINS: opening another pane while the drawer
	// is up forfeits the record, so closing the drawer cannot resurrect a surface the
	// user replaced on purpose.
	useUiPreferencesStore.getState().setCanvasOpen(true);
	useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
	useUiPreferencesStore.getState().setConsolePaneOpen(true);
	assert.equal(
		useUiPreferencesStore.getState().askDrawerEvictedPane,
		null,
		"an explicit claim forfeits the borrow",
	);
	assert.deepEqual(slotState(), {
		ask: false,
		canvas: false,
		run: false,
		browser: false,
		console: true,
	});
	useUiPreferencesStore.getState().setConsolePaneOpen(false);

	// AND IT IS THE ONE SLOT FLAG NOT PERSISTED: the canvas is a document a user
	// keeps open across launches; the drawer is a reading of the queue that is
	// there now, and a relaunch must not open a surface nobody opened.
	const persisted = persistedUiPreferences(useUiPreferencesStore.getState());
	assert.equal(
		"isAskDrawerOpen" in persisted,
		false,
		"the drawer must not be persisted",
	);
	assert.equal(typeof persisted.isCanvasOpen, "boolean");
});

test("the panel rail's lit pane is the DRAWN pane, built from the same two inputs (#872)", () => {
	/*
	 * `resolveDrawnRightSlotPane` answers WHICH pane is on screen where
	 * `resolveRightSlotOccupied` answers WHETHER one is. A claimed-but-undrawable
	 * pane must answer null (a lit rail item is a statement about what is on screen),
	 * and the asks drawer is an answer of its own - "ask" - that the rail reads as
	 * "light none of my four".
	 */
	for (const pane of ["run", "browser", "console", "canvas"]) {
		assert.equal(
			resolveDrawnRightSlotPane(claimed(pane, route(true, true, true))),
			pane,
			`${pane} is drawn on a route that mounts it`,
		);
		/* The sibling readers agree with it on WHETHER, which is the point of one derivation. */
		assert.equal(
			resolveRightSlotOccupied(claimed(pane, route(true, true, true))),
			true,
		);
		assert.equal(
			resolveDrawnRightSlotPane(claimed(pane, route(false, false, false))),
			null,
			`${pane} claimed on a route with no chat surface is not drawn`,
		);
	}
	assert.equal(
		resolveDrawnRightSlotPane(claimed("run", route(true, false, false))),
		null,
		"the run panel on a draft has no run details to draw",
	);
	/* The other three mount whenever the chat surface does, with or without run details. */
	assert.equal(
		resolveDrawnRightSlotPane(claimed("browser", route(true, false, false))),
		"browser",
	);
	assert.equal(
		resolveDrawnRightSlotPane(claimed("ask", route(true, false, true))),
		"ask",
	);
	assert.equal(
		resolveDrawnRightSlotPane(claimed("ask", route(true, false, false))),
		null,
		"the session drawer on a draft is not drawn",
	);
	assert.equal(
		resolveDrawnRightSlotPane(
			claimed("ask", route(false, false, false), "fleet"),
		),
		"ask",
		"the fleet drawer's home is the shell: drawn on every route",
	);
	assert.equal(
		resolveDrawnRightSlotPane(claimed("none", route(true, true, true))),
		null,
	);
	/* Whatever it answers, WHETHER is the occupied reader's answer. */
	for (const pane of ["run", "browser", "console", "canvas", "ask", "none"]) {
		for (const r of [
			route(true, true, true),
			route(true, false, false),
			route(false, false, false),
		]) {
			const state = claimed(pane, r);
			assert.equal(
				resolveDrawnRightSlotPane(state) !== null,
				resolveRightSlotOccupied(state),
				`${pane}: the two readers disagree about whether the slot is occupied`,
			);
		}
	}
});
