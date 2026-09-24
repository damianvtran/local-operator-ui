/**
 * The one sidebar's TWO SECTIONS - Agents + Teams above, Chats below - and the
 * boundary between them: the floors, the default, the auto share, and that the
 * size the user drags to is written to disk and read back.
 *
 * WHY A FILE OF ITS OWN, beside `chat-sidebar-layout.test.mjs` and
 * `sidebar-split.test.mjs`. The layout suite pins the sidebar's WIDTH axis (260
 * docked, 56 strip, the 1024/880 thresholds); the split suite pins the boundary's
 * arithmetic case by case, against a fixture panel. This file pins the operator's
 * request as a contract (2026-09-24: "make sure that we have visible sections for
 * agent+teams and chats ... but keep the UX of being able to relatively size them
 * in the sidebar"), which is the one statement a later "tidy the default back to a
 * disclosure" change has to fail against, and it pins it at the sidebar's REAL
 * heights rather than at a fixture's.
 *
 * WHAT THIS CANNOT SAY: that the sections LOOK right, or that a drag on the real
 * boundary produces these numbers - `renderer-driver.mjs --scene sidebar-sections`
 * does that on the built app, and its frames are the claim.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The storage shim the store needs to load in node at all: zustand's `persist`
 * writes through `localStorage` on every `setState`, which node lacks (the same
 * shim `console-pane.test.mjs` carries). It is also the instrument for the
 * persistence cases below - the store writes into it and a fresh parse reads it.
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

const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/sidebar-split";',
			'export { SIDEBAR_DOCK_MIN_PX } from "./src/renderer/src/features/chat/chat-sidebar-layout";',
			'export { useUiPreferencesStore, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
		].join("\n"),
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
	logLevel: "silent",
});
const {
	DEFAULT_SIDEBAR_REGIONS,
	SIDEBAR_AUTO_MAX_FRACTION,
	SIDEBAR_MIN_REGION_PX,
	SIDEBAR_SPLIT_OFFERED_PX,
	parseSidebarListHeight,
	resolveSidebarSplit,
	useUiPreferencesStore,
	persistedUiPreferences,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/**
 * The panel at the two window heights the redesign's frames are taken at.
 *
 * `capacity` is the box the two sections share (the sidebar body under the
 * brand row, the two primary rows and the four destinations, minus the foot and
 * the boundary's own 8px band); `panel` is the list component's content box.
 * Both were read off the built app by `--scene sidebar-sections` at 1380x900 and
 * 1024x673 (`capacity`, `panel` in its `default geometry` note; at 900 the two
 * drags' extremes 72 + 480 re-derive the same 552) - real numbers, not round ones.
 */
const AT_900 = { capacity: 552, panel: 560 };
const AT_673 = { capacity: 325, panel: 333 };

const split = (over) =>
	resolveSidebarSplit({
		regions: DEFAULT_SIDEBAR_REGIONS,
		listHeight: null,
		order: "entities-first",
		showList: true,
		query: false,
		drawnListHeight: 2000,
		...over,
	});

test("both sections are drawn on a column nobody has touched", () => {
	assert.equal(DEFAULT_SIDEBAR_REGIONS, "both");
	const out = split({
		capacity: AT_900.capacity,
		panelContentHeight: AT_900.panel,
	});
	assert.equal(out.entityVisible, true, "Agents + Teams is a visible section");
	assert.equal(out.listVisible, true, "Chats is a visible section");
	assert.notEqual(out.divider, null, "and there is a boundary between them");
	assert.equal(out.divider.resizable, true, "which can be dragged");
	assert.equal(out.restore, null, "nothing is hidden, so no restore row");
});

test("each section's floor is 72px, and neither can be dragged below it", () => {
	/*
	 * 72 = heading 28 + one row 32 + rule 1 + padding 8, rounded up on the 4px
	 * ramp (`sidebar-split.ts`). It is the SAME floor for both, so the Agents +
	 * Teams section always keeps its heading and one row, and the Chats section
	 * its first label and one row.
	 */
	assert.equal(SIDEBAR_MIN_REGION_PX, 72);
	for (const { capacity, panel } of [AT_900, AT_673]) {
		const out = split({ capacity, panelContentHeight: panel });
		assert.equal(out.divider.min, SIDEBAR_MIN_REGION_PX, "chats floor");
		assert.equal(
			capacity - out.divider.max,
			SIDEBAR_MIN_REGION_PX,
			"agents + teams floor: the most the chats can take leaves it 72",
		);
		// A stored height at either extreme is drawn at the floor, not past it.
		assert.equal(
			split({ capacity, panelContentHeight: panel, listHeight: 1 }).divider
				.value,
			SIDEBAR_MIN_REGION_PX,
		);
		assert.equal(
			split({ capacity, panelContentHeight: panel, listHeight: 3999 }).divider
				.value,
			capacity - SIDEBAR_MIN_REGION_PX,
		);
	}
});

test("the split is offered at every docked window height the app draws", () => {
	/*
	 * The app's minimum window is 800x600 and the dock appears at 1024 wide; the
	 * shortest docked case the frames take is 673 tall, where the shared box is
	 * 325 - comfortably over two floors (144), so the boundary is draggable there.
	 */
	assert.equal(SIDEBAR_SPLIT_OFFERED_PX, 144);
	assert.ok(AT_673.capacity >= SIDEBAR_SPLIT_OFFERED_PX);
});

test("with no dragged height, the chats take the larger share", () => {
	/*
	 * The one-sidebar merge's reason for existing was that the agents tree pushed
	 * the chats below the fold. With both sections visible by default, the auto
	 * rule is what keeps that from coming back: a long chat list is capped at 60%
	 * of the panel, so the chats hold more of the column than the section above.
	 */
	assert.equal(SIDEBAR_AUTO_MAX_FRACTION, 0.6);
	const out = split({
		capacity: AT_900.capacity,
		panelContentHeight: AT_900.panel,
	});
	assert.ok(out.listMax > AT_900.capacity - out.listMax);
	assert.equal(out.listFixed, false, "auto is a cap, not a box");
});

test("the dragged size is persisted, and survives the round trip to disk", () => {
	memory.clear();
	const store = useUiPreferencesStore;
	store.getState().setChatSidebarListHeight(312);
	store.getState().setChatSidebarRegions("both");
	// What the persist middleware writes is what the partialize function keeps:
	// assert the field is IN it rather than trusting the default.
	const kept = persistedUiPreferences(store.getState());
	assert.equal(kept.chatSidebarListHeight, 312);
	assert.equal(kept.chatSidebarRegions, "both");
	// And the bytes on "disk": the store's own key, parsed as the next launch will.
	const raw = memory.get("ui-preferences-storage");
	assert.ok(raw, "the store wrote its key");
	const reread = JSON.parse(raw).state;
	assert.equal(parseSidebarListHeight(reread.chatSidebarListHeight), 312);
	// The next launch draws that number, clamped only by the window it is in.
	const relaunched = split({
		capacity: AT_900.capacity,
		panelContentHeight: AT_900.panel,
		listHeight: reread.chatSidebarListHeight,
		regions: reread.chatSidebarRegions,
	});
	assert.equal(relaunched.divider.value, 312);
	assert.equal(relaunched.listFixed, true);

	// The reset (double-click / Enter on the boundary) writes AUTO, which is also
	// persisted, so a reset is not undone by the next launch.
	store.getState().restoreDefaultChatSidebarListHeight();
	assert.equal(
		JSON.parse(memory.get("ui-preferences-storage")).state
			.chatSidebarListHeight,
		null,
	);
});

/**
 * THE ONE-SCROLLER CONTRACT, pinned at the source level, and the reason it is read
 * from the SOURCE rather than driven here.
 *
 * The defect this guards against was a CSS rule, not a decision: the sidebar's own
 * div carried `overflow-x-hidden`, and setting one axis of `overflow` computes the
 * other from `visible` to `auto` (CSS 2.1 §11.1.1) - so the column became a third
 * scroller wrapping the two its sections carry, which is exactly what the operator
 * photographed. No node test in this suite renders CSS, and jsdom computes no
 * layout at all, so the instrument is the shipped class list on the two elements
 * that decide it, plus the drill the rig runs: `--scene sidebar-sections`
 * `checkSidebarScroll` measures `scrollHeight === clientHeight` on the column and the
 * panel, one scrollable element under a point, and a wheel over either pane leaving
 * the chrome and the other pane where they were, in both palettes and at short
 * heights. Read together - this file says the classes are right, the scene says the
 * browser agrees.
 */
test("the sidebar's column cannot scroll, and its panes contain their own overflow", () => {
	const sidebar = readFileSync(
		new URL(
			"../src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const shell = sidebar.match(
		/data-sidebar-shell=""[\s\S]{0,240}?className="([^"]+)"/,
	);
	assert.ok(shell, "the shell's own class list was not found");
	assert.match(
		shell[1],
		/(^|\s)overflow-hidden(\s|$)/,
		"the column must not scroll at all",
	);
	assert.doesNotMatch(
		shell[1],
		/overflow-x-hidden|overflow-y-auto|overflow-auto/,
		"`overflow-x-hidden` computes `overflow-y: auto`, which makes the column a third scroller",
	);

	const pane = readFileSync(
		new URL(
			"../src/renderer/src/features/chat/components/chat-sidebar.tsx",
			import.meta.url,
		),
		"utf8",
	);
	/*
	 * Both region class lists, by the marker each carries: the entity pane's
	 * `[overflow-anchor:none]` and the list pane's `[scrollbar-gutter:stable]`.
	 */
	for (const [marker, label] of [
		["min-h-0 flex-1 space-y-4 overflow-y-auto", "the agents pane"],
		["relative space-y-4 overflow-y-auto", "the chats pane"],
	]) {
		assert.ok(
			pane.includes(marker),
			`${label}'s class list must carry ${marker}`,
		);
	}
});
