/**
 * The chat header's IDENTITY MENU as VALUES: which band a row lands in, what the
 * heading above it says, what the footer reports, and what one switch does to a
 * recents ring.
 *
 * WHY THIS FILE EXISTS. The operator's second report (2026-09-26) is about three
 * behaviours at once - a bound, a filter, and a recents band separated from the
 * roster - and every one of them can fail while the panel still renders: a band
 * built from the FILTERED list silently hides a remembered profile the current
 * query does not match; a recents band that replaces rather than repeats the
 * roster makes the 151st profile unreachable; an empty ring that still emits a
 * heading is the "empty Recent" defect in its most literal form. Those are
 * decisions, so they live as pure functions
 * (`chat-header-identity-menu-model.ts`) and are pinned here without a DOM.
 *
 * WHAT THIS CANNOT SAY: that the panel is the right height on screen, that the
 * field takes focus, or that a switch runs the command. Those are the rendered
 * set's and the QA pass's to answer (the `docs/evidence/chat-header-identity`
 * frames and the real-app run), not this file's.
 *
 * The installed store is exercised through the STORE ITSELF rather than a copy of
 * its arithmetic, with the `localStorage` shim the sibling store suites carry:
 * zustand's persist middleware writes through it on every `setState`, and Node's
 * binding is `undefined` without one.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

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
			'export * from "./src/renderer/src/features/chat/components/chat-header-identity-menu-model";',
			'export { pushProfileRecent, PROFILE_RECENTS_LIMIT, useUiPreferencesStore as store, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	/*
	 * The renderer's own path aliases, restated because esbuild reads the ROOT
	 * tsconfig by default and the renderer's mapping lives in `tsconfig.app.json` -
	 * the same restatement, and the same reason, as `console-pane.test.mjs`'s
	 * bundle of the same store. Without them the store's own imports fail to
	 * resolve (`@shared/themes`) rather than resolving to a second copy.
	 */
	alias: {
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
	},
	logLevel: "silent",
});

const {
	IDENTITY_MENU_MAX_HEIGHT,
	IDENTITY_MENU_MAX_HEIGHT_CLASS,
	PROFILE_RECENTS_LIMIT,
	identityMenuBands,
	identityMenuFooter,
	identityMenuHeadings,
	pushProfileRecent,
	store,
	persistedUiPreferences,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Six agents, in the order a catalogue lists them. */
const ROWS = [
	{ value: "architect", label: "architect" },
	{ value: "coder", label: "coder" },
	{ value: "manager", label: "manager" },
	{ value: "reviewer", label: "reviewer" },
	{ value: "scout", label: "scout" },
	{ value: "tui-designer", label: "tui-designer" },
].map((row) => ({ ...row, description: `${row.label}'s own line.` }));

const values = (rows) => rows.map((row) => row.value);

/* Hoisted to the top level, which is where this file's lint rules want a literal
 * that is used once per case but compiled per call. */
const CEILING = /min\(22rem,/;
const AVAILABLE_HEIGHT = /--radix-popover-content-available-height/;

test("a roster with no recents is ONE band with no heading", () => {
	// The fresh-install case, and the one that must not grow an empty band: there
	// is nothing to separate, so nothing is said.
	const view = identityMenuBands({
		rows: ROWS,
		matches: ROWS,
		recents: [],
		kind: "agent",
		query: "",
	});
	assert.equal(view.bands.length, 1);
	assert.equal(view.bands[0].heading, null);
	assert.deepEqual(values(view.bands[0].rows), values(ROWS));
	assert.equal(view.total, 6);
});

test("recents are a band ABOVE the roster, and the roster keeps every row", () => {
	// The core claim of the change: a recents band is a repeat, never a filter.
	// If the second band came from `rows` minus the remembered names, this test's
	// last assertion is where it fails - which is the truncated-picker defect.
	const view = identityMenuBands({
		rows: ROWS,
		matches: ROWS,
		recents: ["reviewer", "coder"],
		kind: "agent",
		query: "",
	});
	assert.deepEqual(
		view.bands.map((band) => band.heading),
		["Recent agents", "All agents"],
	);
	assert.deepEqual(values(view.bands[0].rows), ["reviewer", "coder"]);
	assert.deepEqual(values(view.bands[1].rows), values(ROWS));
	assert.equal(view.bands[1].rows.length, ROWS.length);
});

test("the recents band follows the RING's order, not the catalogue's", () => {
	const view = identityMenuBands({
		rows: ROWS,
		matches: ROWS,
		recents: ["tui-designer", "architect"],
		kind: "team",
		query: "",
	});
	assert.deepEqual(values(view.bands[0].rows), ["tui-designer", "architect"]);
	assert.deepEqual(
		view.bands.map((band) => band.heading),
		["Recent teams", "All teams"],
	);
});

test("a remembered name the catalogue no longer offers is dropped", () => {
	const named = identityMenuBands({
		rows: ROWS,
		matches: ROWS,
		recents: ["coder", "ghost"],
		kind: "agent",
		query: "",
	});
	assert.deepEqual(values(named.bands[0].rows), ["coder"]);

	// Every ring entry unresolvable is the same state as an empty ring: no band,
	// no heading - not a heading over nothing.
	const allGone = identityMenuBands({
		rows: ROWS,
		matches: ROWS,
		recents: ["ghost", "phantom"],
		kind: "agent",
		query: "",
	});
	assert.equal(allGone.bands.length, 1);
	assert.equal(allGone.bands[0].heading, null);
	assert.deepEqual(values(allGone.bands[0].rows), values(ROWS));
});

test("a query flattens the bands: the list is a result, not a browse", () => {
	// `matches` is what the app's own filter left (`filterPickerOptions`), so this
	// is the shape the panel renders while a filter is active: one band, no
	// headings, recents NOT lifted - a remembered row that does not match is not
	// offered, because the user narrowed the list.
	const matches = ROWS.filter((row) => row.value.includes("rev"));
	const view = identityMenuBands({
		rows: ROWS,
		matches,
		recents: ["coder"],
		kind: "agent",
		query: "rev",
	});
	assert.equal(view.bands.length, 1);
	assert.equal(view.bands[0].heading, null);
	assert.deepEqual(values(view.bands[0].rows), ["reviewer"]);
	assert.equal(view.matches, 1);
	assert.equal(view.total, 6);
	assert.equal(view.noMatches, false);
});

test("a query that matches nothing says so, and is not the empty-roster state", () => {
	const view = identityMenuBands({
		rows: ROWS,
		matches: [],
		recents: ["coder"],
		kind: "agent",
		query: "zzz",
	});
	assert.equal(view.noMatches, true);
	assert.deepEqual(view.bands[0].rows, []);
	// Whitespace is not a query: the panel must not flatten to "Nothing matches"
	// because somebody pressed space in the field.
	const blank = identityMenuBands({
		rows: ROWS,
		matches: ROWS,
		recents: ["coder"],
		kind: "agent",
		query: "   ",
	});
	assert.equal(blank.noMatches, false);
	assert.equal(blank.bands.length, 2);
});

test("the footer names the roster only when there is something to say", () => {
	const fits = {
		bands: [{ heading: null, rows: ROWS }],
		matches: 6,
		total: 6,
		noMatches: false,
	};
	// A list that fits and no query is silent: a count under five rows is noise.
	assert.equal(
		identityMenuFooter({
			view: fits,
			kind: "agent",
			query: "",
			overflowing: false,
		}),
		null,
	);
	// The bound binding is what makes the count a fact worth printing.
	assert.equal(
		identityMenuFooter({
			view: fits,
			kind: "agent",
			query: "",
			overflowing: true,
		}),
		"6 agents in all — scroll, or type to filter",
	);
	// A filtered count IS the answer to what was typed, so it is printed whether
	// or not the (short) list overflows.
	const filtered = { ...fits, matches: 1 };
	assert.equal(
		identityMenuFooter({
			view: filtered,
			kind: "agent",
			query: "rev",
			overflowing: false,
		}),
		"1 of 6 agents match",
	);
	// Nothing matched: the empty sentence is the panel's, and the footer must not
	// claim a count over an empty result.
	assert.equal(
		identityMenuFooter({
			view: { ...fits, matches: 0 },
			kind: "team",
			query: "zzz",
			overflowing: false,
		}),
		null,
	);
	// The two menus name their own noun.
	assert.equal(
		identityMenuFooter({
			view: fits,
			kind: "team",
			query: "",
			overflowing: true,
		}),
		"6 teams in all — scroll, or type to filter",
	);
});

test("the headings are one rule per menu, so the two panels read alike", () => {
	assert.deepEqual(identityMenuHeadings("agent"), {
		recents: "Recent agents",
		all: "All agents",
	});
	assert.deepEqual(identityMenuHeadings("team"), {
		recents: "Recent teams",
		all: "All teams",
	});
});

test("the bound is a ceiling the panel can only shrink to fit", () => {
	// Both halves matter: an absolute ceiling (so the number does not mean
	// different things in different windows) and the available height (so a panel
	// opened near the bottom of one takes the room that exists rather than
	// overflowing off-screen).
	assert.equal(IDENTITY_MENU_MAX_HEIGHT, 352);
	assert.match(IDENTITY_MENU_MAX_HEIGHT_CLASS, CEILING);
	assert.match(IDENTITY_MENU_MAX_HEIGHT_CLASS, AVAILABLE_HEIGHT);
});

test("a switch moves a profile to the front of its ring, bounded, no duplicates", () => {
	const { rememberProfile } = store.getState();
	const names = ["a", "b", "c", "d", "e", "f"];
	for (const name of names) rememberProfile("agent", name);
	assert.deepEqual(store.getState().profileRecents.agent, ["f", "e", "d", "c"]);
	assert.equal(PROFILE_RECENTS_LIMIT, 4);

	// Re-using a name MOVES it rather than adding a second row for it.
	rememberProfile("agent", "d");
	assert.deepEqual(store.getState().profileRecents.agent, ["d", "f", "e", "c"]);

	// The two menus are separate rings: an agent switch cannot reorder teams.
	assert.deepEqual(store.getState().profileRecents.team, []);
	rememberProfile("team", "lopdev");
	assert.deepEqual(store.getState().profileRecents.team, ["lopdev"]);
	assert.deepEqual(store.getState().profileRecents.agent, ["d", "f", "e", "c"]);
});

test("the ring survives a reload, because the band is about last week too", () => {
	// The ring is persisted by the store's own filter, not by a second list of
	// keys: `persistedUiPreferences` strips two in-flight requests and nothing
	// else, so a field added to the store is written to disk by construction.
	const persisted = persistedUiPreferences({
		profileRecents: { agent: ["coder"], team: [] },
		runPanelReveal: { section: "todos" },
		consoleOpenIntent: "abc",
	});
	assert.deepEqual(persisted.profileRecents, { agent: ["coder"], team: [] });
	assert.equal("runPanelReveal" in persisted, false);
	assert.equal("consoleOpenIntent" in persisted, false);
});

test("the ring update is pure, so the store action has no arithmetic of its own", () => {
	assert.deepEqual(pushProfileRecent([], "coder"), ["coder"]);
	assert.deepEqual(pushProfileRecent(["a", "b", "c", "d"], "b"), [
		"b",
		"a",
		"c",
		"d",
	]);
	assert.deepEqual(pushProfileRecent(["a", "b", "c", "d"], "e"), [
		"e",
		"a",
		"b",
		"c",
	]);
	// The input ring is not mutated in place: the store's previous state object is
	// what a subscriber compares against.
	const ring = ["a", "b"];
	pushProfileRecent(ring, "c");
	assert.deepEqual(ring, ["a", "b"]);
});
