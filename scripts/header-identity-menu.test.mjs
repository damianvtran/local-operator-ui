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
import { readFileSync } from "node:fs";
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
			/* The i18n door, from the SAME bundle as the model, so a catalogue
			 * registered here is the one the model's `t()` reads. */
			'export { registerCatalogue, setLocale } from "./src/renderer/src/shared/i18n";',
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
	identityAgentClosedCaption,
	identityAgentClosedTitle,
	identityAgentConstraint,
	identityAgentConstraintCaption,
	identityAgentNotSettableReason,
	identityAgentSettable,
	identityMenuBands,
	identityMenuFooter,
	identityMenuHeadings,
	identityMenuNoSettable,
	identityMenuNoSettableTyped,
	identityMenuRefusalAnnouncement,
	identityMenuSeedActive,
	identityMenuShowsList,
	pushProfileRecent,
	registerCatalogue,
	setLocale,
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

test("a ring that covers the whole catalogue adds no band (design D1)", () => {
	// The operator's own team roster shape: two teams, both remembered. The
	// band would repeat the entire list verbatim under a second heading, which
	// is where "two groups" degrades into "a repeated list with headings" -
	// so the list is what renders, unheaded, exactly as if the ring were empty.
	const teams = [
		{ value: "lopdev", label: "lopdev" },
		{ value: "minerva", label: "minerva" },
	];
	const view = identityMenuBands({
		rows: teams,
		matches: teams,
		recents: ["lopdev", "minerva"],
		kind: "team",
		query: "",
	});
	assert.equal(view.bands.length, 1);
	assert.equal(view.bands[0].heading, null);
	assert.deepEqual(values(view.bands[0].rows), ["lopdev", "minerva"]);
	assert.equal(view.total, 2);

	// One row short of covering it, the band is a shortcut again - the rule is
	// "adds no row", not "adds few".
	const three = [...teams, { value: "pergamon", label: "pergamon" }];
	const partial = identityMenuBands({
		rows: three,
		matches: three,
		recents: ["lopdev", "minerva"],
		kind: "team",
		query: "",
	});
	assert.deepEqual(
		partial.bands.map((band) => band.heading),
		["Recent teams", "All teams"],
	);
});

test("the listbox gate is one rule for the panel and both references (U4)", () => {
	assert.equal(
		identityMenuShowsList({ loading: false, loadError: null, rowCount: 3 }),
		true,
	);
	// Each of the three non-list states hides the box, and a stale row count
	// must not reopen the gate while the refusal is what the panel says.
	assert.equal(
		identityMenuShowsList({ loading: true, loadError: null, rowCount: 3 }),
		false,
	);
	assert.equal(
		identityMenuShowsList({ loading: false, loadError: null, rowCount: 0 }),
		false,
	);
	assert.equal(
		identityMenuShowsList({
			loading: false,
			loadError: "The profile registry is unavailable.",
			rowCount: 3,
		}),
		false,
	);
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
			hasSettable: true,
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
			hasSettable: true,
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
			hasSettable: true,
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
			hasSettable: true,
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
			hasSettable: true,
		}),
		"6 teams in all — scroll, or type to filter",
	);
});

test("a view with no settable row trades its count for the way out (D1)", () => {
	/*
	 * Review round 1, D1: `search-results`' shape - four matches, every one of
	 * them refused - and the first draft printed "4 of 150 agents match" over a
	 * list where nothing could be picked. The resolution must name exits that
	 * EXIST: clearing the search reaches the manager and the delegating
	 * profiles, the team picker beside this one changes the team, and no
	 * sentence may promise the `No team` detach (core #2014's verb, not this
	 * app's yet).
	 */
	const view = {
		bands: [{ heading: null, rows: ROWS }],
		matches: 4,
		total: 150,
		noMatches: false,
	};
	assert.equal(
		identityMenuFooter({
			view,
			kind: "agent",
			query: "rev",
			overflowing: true,
			hasSettable: false,
		}),
		identityMenuNoSettableTyped(),
	);
	// One settable row in view brings the count back - the resolution is about
	// `view.matches`, not about the roster (the recents frame's case).
	assert.equal(
		identityMenuFooter({
			view,
			kind: "agent",
			query: "rev",
			overflowing: true,
			hasSettable: true,
		}),
		"4 of 150 agents match",
	);
	// The untyped edge: a visible roster with no manager row at all. The one
	// exit that remains is the team.
	assert.equal(
		identityMenuFooter({
			view,
			kind: "agent",
			query: "",
			overflowing: true,
			hasSettable: false,
		}),
		identityMenuNoSettable(),
	);
	// The no-match state keeps its own sentence: the footer stays silent.
	assert.equal(
		identityMenuFooter({
			view: { ...view, matches: 0 },
			kind: "agent",
			query: "zzz",
			overflowing: true,
			hasSettable: false,
		}),
		null,
	);
});

test("the highlight seeds on the current or first settable row (D2/U1)", () => {
	/*
	 * Review round 1's MAJOR pair: the panel opened - and every filter
	 * keystroke re-placed - the highlight on row zero, which on a team-led chat
	 * is routinely a row the rule refuses, so the first Enter did nothing. The
	 * seed prefers the CURRENT row when it is settable (the identity is where
	 * the eye already is), then the first settable row, and only falls back to
	 * row zero when nothing can be picked - which is exactly when the footer
	 * carries the way out.
	 */
	const row = (value, extra = {}) => ({ value, label: value, ...extra });
	assert.equal(
		identityMenuSeedActive([
			row("coder", { disabled: true }),
			row("manager", { current: true }),
			row("ops-lead"),
		]),
		1,
	);
	assert.equal(
		identityMenuSeedActive([
			row("coder", { disabled: true }),
			row("manager"),
			row("ops-lead"),
		]),
		1,
	);
	// A settable CURRENT row still wins over a settable earlier row.
	assert.equal(
		identityMenuSeedActive([
			row("ops-lead"),
			row("manager", { current: true }),
		]),
		1,
	);
	// Nothing settable: row zero, which the footer's resolution now explains.
	assert.equal(
		identityMenuSeedActive([
			row("coder", { disabled: true }),
			row("reviewer", { disabled: true }),
		]),
		0,
	);
	assert.equal(identityMenuSeedActive([]), 0);
});

test("the refused-row announcement names the row and nothing more", () => {
	// Review round 1, D2/U1: the sentence the footer's live region carries when
	// Enter lands on a row the rule refuses. Short on purpose - the row's own
	// reason is already in its accessible name and the exits are the footer's
	// subject - so this pins that it does not grow a second explanation.
	assert.equal(
		identityMenuRefusalAnnouncement("reviewer"),
		"reviewer cannot take the seat.",
	);
});

test("the recents band drops refused rows and collapses when none remain (U6)", () => {
	/*
	 * Review round 1, U6: on a team-led chat the ring is full of leaves, so the
	 * band that exists for one-pick speed was a wall of refusals (and `coder`
	 * appeared twice). The band is a SHORTCUT, not the roster - refused rows
	 * stay in All agents with their reason - so they are dropped here, and a
	 * band filtered to nothing disappears with its heading rather than
	 * rendering an empty `Recent agents`.
	 */
	const withFlags = ROWS.map((r) => ({
		...r,
		disabled: r.value === "reviewer" || r.value === "coder",
	}));
	const mixed = identityMenuBands({
		rows: withFlags,
		matches: withFlags,
		recents: ["reviewer", "architect"],
		kind: "agent",
		query: "",
	});
	assert.deepEqual(
		mixed.bands.map((band) => band.heading),
		["Recent agents", "All agents"],
	);
	assert.deepEqual(values(mixed.bands[0].rows), ["architect"]);
	// The roster band keeps every row, refused ones included.
	assert.deepEqual(values(mixed.bands[1].rows), values(withFlags));

	const allRefused = identityMenuBands({
		rows: withFlags,
		matches: withFlags,
		recents: ["reviewer", "coder"],
		kind: "agent",
		query: "",
	});
	assert.equal(allRefused.bands.length, 1);
	assert.equal(allRefused.bands[0].heading, null);
	assert.deepEqual(values(allRefused.bands[0].rows), values(withFlags));

	// A FILTER is not the band: with a query on, refused rows must stay listed
	// with their reason (that is D4's frame, `search-results`).
	const filtered = identityMenuBands({
		rows: withFlags,
		matches: withFlags.filter((r) => r.value === "reviewer"),
		recents: ["reviewer"],
		kind: "agent",
		query: "rev",
	});
	assert.equal(filtered.bands.length, 1);
	assert.deepEqual(values(filtered.bands[0].rows), ["reviewer"]);
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

test("every band heading is catalogue copy resolved per call, not a captured English literal", () => {
	/*
	 * SENTINEL CATALOGUE, NOT A TRANSLATION. `fr` is registered with marker text
	 * so the assertion proves WHICH SOURCE the heading came from; the real French
	 * is the audited catalogue's to carry. `en` is deliberately not registered, so
	 * the closing assertion proves the store returns to the shipped English
	 * rather than to a sentinel laid over it.
	 */
	registerCatalogue("fr", {
		"ui.chat.header_identity.band_recent_agents": "FR recent agents",
		"ui.chat.header_identity.band_all_agents": "FR all agents",
		"ui.chat.header_identity.band_recent_teams": "FR recent teams",
		"ui.chat.header_identity.band_all_teams": "FR all teams",
	});
	try {
		// The SAME function, asked again after the locale moved: a heading
		// captured at module load would still answer in English here.
		setLocale("fr");
		assert.deepEqual(identityMenuHeadings("agent"), {
			recents: "FR recent agents",
			all: "FR all agents",
		});
		assert.deepEqual(identityMenuHeadings("team"), {
			recents: "FR recent teams",
			all: "FR all teams",
		});
		// And it reaches the rendered bands, not only the helper.
		const view = identityMenuBands({
			rows: ROWS,
			matches: ROWS,
			recents: ["coder"],
			kind: "team",
			query: "",
		});
		assert.deepEqual(
			view.bands.map((band) => band.heading),
			["FR recent teams", "FR all teams"],
		);
	} finally {
		setLocale("en");
	}
	assert.deepEqual(identityMenuHeadings("agent"), {
		recents: "Recent agents",
		all: "All agents",
	});
});

test("the menu recomputes its bands when the locale changes (source pin, not a render)", () => {
	/*
	 * The headings are resolved when `identityMenuBands` RUNS, so a `view` memo
	 * whose inputs omit the locale would keep serving the previous language until
	 * something else changed. A mount would be the stronger proof and is the
	 * rendered pass's to give (not run here); this pins the one line the defect
	 * would live on.
	 */
	const source = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/features/chat/components/chat-header-identity-menu.tsx",
		),
		"utf8",
	);
	assert.match(source, /const locale = useI18nLocale\(\);/);
	assert.match(
		source,
		/identityMenuBands\(\{[^}]*\}\),\s*\[[^\]]*\blocale\b[^\]]*\]/,
	);
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

test("the acceptance predicate: the manager always, a delegating profile beside it", () => {
	/*
	 * `settable(name) = name === manager || delegate === true` - the rule the
	 * runtime half (damianvtran/local-operator#2014) enforces and the agent
	 * slot's one predicate in this tree (issue #861). Pinned on its two edges:
	 * the manager is settable WHATEVER its flag reads (it runs the team, so it
	 * can always take its own seat - a `false` flag cannot evict it), and only
	 * `=== true` delegates - an explicit false, a missing field and a null all
	 * answer "not settable", which is the `delegate !== true` half of the rule
	 * stated as one comparison.
	 */
	assert.equal(
		identityAgentSettable({
			name: "manager",
			manager: "manager",
			delegate: false,
		}),
		true,
	);
	assert.equal(
		identityAgentSettable({
			name: "architect",
			manager: "manager",
			delegate: true,
		}),
		true,
	);
	assert.equal(
		identityAgentSettable({
			name: "coder",
			manager: "manager",
			delegate: false,
		}),
		false,
	);
	assert.equal(
		identityAgentSettable({
			name: "coder",
			manager: "manager",
			delegate: undefined,
		}),
		false,
	);
	assert.equal(
		identityAgentSettable({
			name: "coder",
			manager: "manager",
			delegate: null,
		}),
		false,
	);
	// An unknown manager is not a match and not a default: no caller applies
	// the predicate against one (see `identityAgentConstraint`), and the pure
	// comparison must not invent the manager it did not get.
	assert.equal(
		identityAgentSettable({ name: "coder", manager: null, delegate: false }),
		false,
	);
	assert.equal(
		identityAgentSettable({ name: "coder", manager: null, delegate: true }),
		true,
	);
});

test("the constraint exists only over a KNOWN manager, and names the team", () => {
	/*
	 * A null manager is "not known" (no team bound, or the catalogue has not
	 * answered), and the panel must not constrain or explain against it:
	 * disabling the wrong rows is a claim about a team rather than about a
	 * load. The caption names the team with the string the chip shows, so the
	 * panel and a flagged chip speak one sentence.
	 */
	assert.equal(
		identityAgentConstraint({ teamLabel: "No team", manager: null }),
		null,
	);
	assert.deepEqual(
		identityAgentConstraint({
			teamLabel: "Local Operator Dev",
			manager: "manager",
		}),
		{
			manager: "manager",
			caption:
				"Local Operator Dev is led by its manager; only the manager and profiles that can delegate may take this seat.",
		},
	);
});

test("the rule's copy is pinned as the design round's candidate", () => {
	// These strings are the copy candidates the brief lands with; the design
	// round weighs them against the core half's refusal wording. Pinned so a
	// JSX edit cannot quietly reword a claim the captured frames are read
	// against.
	assert.equal(
		identityAgentConstraintCaption("lopdev"),
		"lopdev is led by its manager; only the manager and profiles that can delegate may take this seat.",
	);
	assert.equal(
		identityAgentNotSettableReason(),
		"Needs a delegating profile here.",
	);
});

test("the strict rule closes the seat for EVERY name, and only when the caller says so (issue #861, second slice)", () => {
	/*
	 * `teamOwnsSeat` is the runtime's `AgentSlotOwnedByTeam` (core PR #2050):
	 * refused for every name while a team is attached, the manager's own
	 * included. Absent or false is an OLDER host and must answer as the
	 * #866 predicate did - the matrix below holds both halves on the same four
	 * seats, so a change to either shows up as a cell.
	 */
	const seats = [
		{ name: "manager", delegate: false, loose: true },
		{ name: "ops-lead", delegate: true, loose: true },
		{ name: "coder", delegate: false, loose: false },
		{ name: "ops-lead", delegate: null, loose: false },
	];
	for (const seat of seats) {
		const base = {
			name: seat.name,
			manager: "manager",
			delegate: seat.delegate,
		};
		for (const older of [undefined, false]) {
			assert.equal(
				identityAgentSettable({ ...base, teamOwnsSeat: older }),
				seat.loose,
				`${seat.name}/${seat.delegate} on an older host`,
			);
		}
		assert.equal(
			identityAgentSettable({ ...base, teamOwnsSeat: true }),
			false,
			`${seat.name}/${seat.delegate} under the strict rule`,
		);
	}
});

test("a closure builds a constraint with no catalogue row, and carries the runtime's sentence", () => {
	const sentence = identityAgentClosedCaption("lopdev", "manager");
	assert.deepEqual(
		identityAgentConstraint({
			teamLabel: "lopdev",
			manager: null,
			closure: { speaker: "manager", sentence, title: "T" },
		}),
		{
			manager: "manager",
			caption: sentence,
			closed: sentence,
			closedTitle: "T",
		},
	);
	// No closure and no manager: still nothing to apply (the #866 null).
	assert.equal(
		identityAgentConstraint({
			teamLabel: "No team",
			manager: null,
			closure: null,
		}),
		null,
	);
});

test("the closed note's lead line names the team as the chip does (design D2/D3)", () => {
	// The label the chip shows, where the sentence under it keeps the slug.
	assert.equal(
		identityAgentClosedTitle("Local Operator Dev"),
		"Agent seat closed by Local Operator Dev",
	);
});

/*
 * THE FOOTER AND SEAT WORDING ARE KEYED NOW (feat/i18n-identity-footer). Three
 * claims, each pinned against the thing it could regress:
 *
 *  1. ENGLISH IS BYTE-IDENTICAL to the template strings these sentences used to
 *     be, for every count that is not 1 - proved by evaluating the OLD
 *     expression beside the new key over a matrix (including counts of 1,000
 *     and up, where an ICU `#` would have inserted a thousands separator).
 *  2. The singular arms are the one deliberate change: `1 agents` is now
 *     `1 agent`.
 *  3. A language switch reaches every sentence: the SAME functions answer in the
 *     registered catalogue after `setLocale`, so nothing was frozen at load.
 */
const oldFooterAll = (total, noun) =>
	`${total} ${noun} in all \u2014 scroll, or type to filter`;
const oldFooterMatch = (matches, total, noun) =>
	matches === total
		? `${total} ${noun} match`
		: `${matches} of ${total} ${noun} match`;

test("English footer is byte-identical to the old template for every non-singular count", () => {
	const roster = [2, 3, 5, 6, 11, 150, 999, 1000, 1234, 12345];
	let compared = 0;
	for (const kind of ["agent", "team"]) {
		const noun = kind === "team" ? "teams" : "agents";
		for (const total of roster) {
			const base = {
				bands: [{ heading: null, rows: ROWS }],
				matches: total,
				total,
				noMatches: false,
			};
			const call = (view, query, overflowing) =>
				identityMenuFooter({
					view,
					kind,
					query,
					overflowing,
					hasSettable: true,
				});
			assert.equal(call(base, "", true), oldFooterAll(total, noun));
			assert.equal(call(base, "x", false), oldFooterMatch(total, total, noun));
			compared += 2;
			for (const matches of [1, 2, total - 1].filter(
				(n) => n >= 1 && n < total,
			)) {
				assert.equal(
					call({ ...base, matches }, "x", false),
					oldFooterMatch(matches, total, noun),
					`${matches} of ${total} ${noun}`,
				);
				compared += 1;
			}
		}
	}
	assert.ok(compared >= 90, `matrix compared ${compared} cases`);
});

test("singular arms read as English: 1 agent, 1 team (the deliberate grammar fix)", () => {
	const one = (kind, query, overflowing) =>
		identityMenuFooter({
			view: {
				bands: [{ heading: null, rows: ROWS.slice(0, 1) }],
				matches: 1,
				total: 1,
				noMatches: false,
			},
			kind,
			query,
			overflowing,
			hasSettable: true,
		});
	assert.equal(
		one("agent", "", true),
		"1 agent in all \u2014 scroll, or type to filter",
	);
	assert.equal(
		one("team", "", true),
		"1 team in all \u2014 scroll, or type to filter",
	);
	assert.equal(one("agent", "x", false), "1 agent matches");
	assert.equal(one("team", "x", false), "1 team matches");
	// The old expression said `1 agents match` - the thing this fixes.
	assert.equal(oldFooterMatch(1, 1, "agents"), "1 agents match");
});

test("a language switch reaches the footer, the refusal, the caption, the reason and the closed title", () => {
	const view = {
		bands: [{ heading: null, rows: ROWS }],
		matches: 4,
		total: 150,
		noMatches: false,
	};
	const footer = (kind, query, overflowing, hasSettable, v = view) =>
		identityMenuFooter({ view: v, kind, query, overflowing, hasSettable });
	/* SENTINEL CATALOGUE, NOT A TRANSLATION: marker text proves which source each
	 * sentence came from, and each message keeps its own plural arms and slots,
	 * with the noun BEFORE the count in the stub so a fixed `count noun` order in
	 * the code would fail here. `en` is not registered, so the closing assertions
	 * prove the store returns to the shipped English. */
	const H = "ui.chat.header_identity.";
	registerCatalogue("fr", {
		[`${H}footer_all_agents`]:
			"{count, plural, one {FR all {count} agent} other {FR all {count} agents}}",
		[`${H}footer_all_teams`]: "FR all teams {count}",
		[`${H}footer_match_agents`]:
			"{count, plural, one {FR match agent {count}} other {FR match agents {count}}}",
		[`${H}footer_match_teams`]: "FR match teams {count}",
		[`${H}footer_partial_agents`]:
			"{total, plural, one {FR partial agent {total} / {matches}} other {FR partial agents {total} / {matches}}}",
		[`${H}footer_partial_teams`]: "FR partial teams {total} / {matches}",
		[`${H}no_settable_typed`]: "FR no settable typed",
		[`${H}no_settable`]: "FR no settable",
		[`${H}cannot_take_seat`]: "FR {label} cannot",
		[`${H}needs_delegating_profile`]: "FR needs delegate",
		[`${H}team_led_by_manager`]: "FR {team} led",
		[`${H}agent_seat_closed_title`]: "FR closed by {team}",
	});
	try {
		setLocale("fr");
		assert.equal(footer("agent", "", true, true), "FR all 150 agents");
		assert.equal(footer("team", "", true, true), "FR all teams 150");
		assert.equal(
			footer("agent", "x", false, true, { ...view, matches: 150 }),
			"FR match agents 150",
		);
		assert.equal(
			footer("team", "x", false, true, { ...view, matches: 150 }),
			"FR match teams 150",
		);
		assert.equal(
			footer("agent", "x", false, true),
			"FR partial agents 150 / 4",
		);
		assert.equal(footer("team", "x", false, true), "FR partial teams 150 / 4");
		assert.equal(footer("agent", "x", false, false), "FR no settable typed");
		assert.equal(footer("agent", "", true, false), "FR no settable");
		assert.equal(identityMenuNoSettable(), "FR no settable");
		assert.equal(
			identityMenuRefusalAnnouncement("reviewer"),
			"FR reviewer cannot",
		);
		assert.equal(identityAgentNotSettableReason(), "FR needs delegate");
		assert.equal(identityAgentConstraintCaption("lopdev"), "FR lopdev led");
		assert.equal(identityAgentClosedTitle("lopdev"), "FR closed by lopdev");
		// The plural arm of the SAME key moves with the count.
		assert.equal(
			footer("agent", "", true, true, { ...view, matches: 1, total: 1 }),
			"FR all 1 agent",
		);
	} finally {
		setLocale("en");
	}
	assert.equal(
		footer("agent", "", true, true),
		"150 agents in all \u2014 scroll, or type to filter",
	);
	assert.equal(
		identityMenuRefusalAnnouncement("reviewer"),
		"reviewer cannot take the seat.",
	);
	assert.equal(
		identityAgentNotSettableReason(),
		"Needs a delegating profile here.",
	);
});
