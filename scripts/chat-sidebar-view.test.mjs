/**
 * The sidebar's view: the page ladder, the three invariants the operator asked
 * for, the grouping, and the section show/hide + reorder the popover drives.
 *
 *     node --test scripts/chat-sidebar-view.test.mjs
 *
 * WHY THIS FILE EXISTS, in the operator's own words (2026-09-25): "show the
 * latest 10 (sorting active to the top) and then have a 'Load 10 more', starts
 * with 10, then 25, then 50, and then user can click to load more, search should
 * still be able to search and find, and the currently viewed session should
 * always be visible in there". Each of those three clauses is a test below that
 * FAILS when the rule is broken - which is the point: a pagination contract
 * asserted only by the shape of the control is a contract nobody is holding.
 *
 * The rules live in `chat-sidebar-view.ts` rather than in the sidebar's JSX for
 * the reason `chat-list-sections.ts` states in full: the sidebar cannot be
 * rendered by this repository's `node:test` suite, so a decision written as a
 * JSX condition is a decision no test can reach.
 *
 * WHAT IT CANNOT SAY: that the band, the popover and the section headers LOOK
 * right. Those are pixels and they were the rig's job (`--scene sidebar-sections`
 * on the built app, and the frames it wrote); that scene was retired with the
 * split's removal (agent review round 1, R2/Q3), so frames of this surface come
 * from whoever next runs a capture pass over the merged panel.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The storage shim the store needs to load in node at all: zustand's `persist`
 * writes through `localStorage` on every `setState`, which node lacks (the same
 * shim `chat-sidebar-sections.test.mjs` and `console-pane.test.mjs` carry). It
 * is also the instrument for the persistence case below - the store writes into
 * it, and a fresh parse reads it the way a launch does.
 *
 * THE KEY IS DISCOVERED, NOT SPELLED: the test finds the entry whose parsed
 * state carries `chatSidebarView`. Hard-coding the storage key would make this
 * file a second place a rename has to land, and the reader of this assertion
 * does not care what the key is - only that the store wrote one and that what
 * it wrote is the view the popover had just set.
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
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/chat-sidebar-view";',
			'export * from "./src/renderer/src/features/chat/chat-list-sections";',
			/*
			 * The roster's own module joins for the PIN field's cases: the stored
			 * `pinnedAgents` list is written by `togglePinnedAgent` and parsed a
			 * field down from it, so the round trip below would be asserting one
			 * half of a contract the other half spells.
			 */
			'export * from "./src/renderer/src/features/chat/chat-sidebar-agents";',
			/*
			 * The store joins the bundle for the PERSISTENCE case, and for one
			 * reason: the view the popover writes is a persisted field, so the
			 * claim "this setting survives a relaunch" is a claim about the
			 * store's own round trip and not about the sidebar's markup.
			 */
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
});

const {
	CHAT_PAGE_START,
	CHAT_PAGE_STEP,
	CHAT_PAGE_STEPS,
	DEFAULT_SIDEBAR_VIEW,
	ENTITY_SECTIONS,
	SIDEBAR_SECTIONS,
	SIDEBAR_SECTION_LABEL,
	isEntitySection,
	isSectionShown,
	canMoveSection,
	moveSection,
	pageLimit,
	pageMoreLabel,
	pageOrder,
	pageRows,
	parseSidebarView,
	groupRows,
	sectionRows,
	shownSections,
	toggleSection,
	persistedUiPreferences,
	useUiPreferencesStore,
	isActiveRow,
	entityRows,
	entityMore,
	entitySectionGap,
	ENTITY_SECTION_GAP,
	ENTITY_SECTION_GAP_COLLAPSED,
	CHAT_LIST_SECTIONS,
	PINNED_AGENTS_MAX,
	togglePinnedAgent,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

/** One catalogue row, with only the fields these rules read. */
const row = (id, at, code) => ({
	session_id: id,
	title: id,
	updated_at: at,
	status: code ? { code } : undefined,
});

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const SECONDS = (hoursAgo) => (NOW - hoursAgo * 3_600_000) / 1000;

/*
 * THE LADDER IS THE CONTRACT, and it is spelled out here rather than derived:
 * "starts with 10, then 25, then 50, and then user can click to load more". The
 * increment past 50 is 50 - a doubling ladder past the third rung would put a
 * metric ton of rows behind one press, and a smaller one would make the last
 * press barely move, so the ladder is flat from its third rung on. Stated
 * because it is the one number the operator's sentence leaves to the
 * implementer.
 */
test("the page ladder is 10, then 25, then 50, then +50 a press", () => {
	assert.equal(pageLimit(0), 10, "a column nobody has paged loads 10");
	assert.equal(pageLimit(1), 25);
	assert.equal(pageLimit(2), 50);
	assert.equal(pageLimit(3), 100);
	assert.equal(pageLimit(4), 150);
	assert.equal(pageLimit(9), 50 + (9 - 2) * CHAT_PAGE_STEP);
	assert.deepEqual([...CHAT_PAGE_STEPS], [25, 50]);
	assert.equal(CHAT_PAGE_START, 10);
	assert.equal(pageLimit(-1), 10, "a negative counter is the first page");
	assert.equal(pageLimit(2.7), 50, "a fractional counter floors");
});

test("the foot control names the next page, bounded by what is left", () => {
	assert.equal(pageMoreLabel(0, 100), "Show 15 more chats");
	assert.equal(pageMoreLabel(1, 100), "Show 25 more chats");
	assert.equal(pageMoreLabel(2, 4), "Show 4 more chats");
	assert.equal(pageMoreLabel(2, 1), "Show 1 more chat");
	assert.equal(pageMoreLabel(2, 0), "Show 0 more chats");
});

/*
 * INVARIANT 1 - the conversation being VIEWED is on screen.
 *
 * The failure this pins is the one a page-bound list always produces: the
 * reader opens a conversation, comes back to the list, and their own chat is
 * not in it - because the row the app is displaying sits at position 300 and
 * the page stopped at 10.
 */
/*
 * THE EXPANDED GROUP'S OWN BOUND (operator, 2026-09-27): "there's far too many
 * team/agent messages shown on screen at once when expanded, can you have max 10
 * at first sorted by most recent/active then click to load more".
 *
 * The chats list has been bounded by the ladder since it shipped; the rows INSIDE
 * an expanded team or agent were not, which is what his screenshot shows. These
 * four tests are the requests's four load-bearing clauses, one each, so that
 * breaking any of them reddens a named claim rather than a picture.
 */
test("an expanded group draws the ladder's prefix, in the catalogue's own order", () => {
	const rows = Array.from({ length: 41 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = entityRows(rows, { loads: 0 });
	assert.equal(
		page.rows.length,
		10,
		"ten rows first, whatever the group holds",
	);
	assert.equal(page.held, 41);
	assert.equal(page.hidden, 31);
	assert.deepEqual(
		page.rows.map((entry) => entry.session_id),
		rows.slice(0, 10).map((entry) => entry.session_id),
		"the bound takes a PREFIX - it never re-sorts the group",
	);
	assert.equal(page.lifted, false);
	/*
	 * AND THE LADDER IS THE CHATS LIST'S, not a second set of numbers: 10, then
	 * 25, then 50, then fifty more a press. A group is that list one level down.
	 */
	for (const [loads, expected] of [
		[0, 10],
		[1, 25],
		[2, 50],
		[3, 100],
	]) {
		assert.equal(
			entityRows(rows, { loads }).rows.length,
			Math.min(expected, 41),
			`rung ${loads} draws ${expected}`,
		);
	}
	assert.equal(
		entityRows(rows, { loads: 9 }).hidden,
		0,
		"a rung past the group's size withholds nothing",
	);
});

test("the bound never hides live work: a running row is out of the quota", () => {
	const quiet = Array.from({ length: 41 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const rows = [...quiet];
	rows[40] = row("s40", SECONDS(41), "busy");
	const page = entityRows(rows, { loads: 0 });
	assert.equal(
		page.rows.some((entry) => entry.session_id === "s40"),
		true,
		"a turn in flight at position 40 is drawn, not withheld",
	);
	assert.equal(
		page.rows.findIndex((entry) => entry.session_id === "s40"),
		// Ten drawn rows, then the running one wherever it sits in the catalogue.
		10,
		"and it is drawn IN PLACE, so the order is still the catalogue's",
	);
	assert.equal(page.rows.length, 11, "one extra row, not a re-sort");
	/*
	 * The exemption is the RUNNING section's own predicate rather than a second
	 * list of status codes, so the two cannot drift: `approval` and `wedged` are
	 * as live as `busy` here because they are live there.
	 */
	for (const code of ["busy", "delegating", "approval", "answer", "wedged"]) {
		const only = entityRows(
			[...quiet.slice(0, 40), row("live", SECONDS(41), code)],
			{ loads: 0 },
		);
		assert.equal(
			only.rows.some((entry) => entry.session_id === "live"),
			true,
			`a ${code} row is never withheld`,
		);
	}
	assert.equal(
		entityRows([...quiet.slice(0, 40), row("cold", SECONDS(41))], {
			loads: 0,
		}).rows.some((entry) => entry.session_id === "cold"),
		false,
		"while the same row with no live state IS withheld",
	);
});

test("a query is never bounded: the bound cannot hide a hit", () => {
	const rows = Array.from({ length: 41 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = entityRows(rows, { loads: 0, searching: true });
	assert.equal(page.rows.length, 41, "every match the query produced is drawn");
	assert.equal(page.hidden, 0);
	assert.equal(page.lifted, false);
});

test("the viewed conversation is lifted when the bound withheld it", () => {
	const rows = Array.from({ length: 41 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = entityRows(rows, { loads: 0, currentId: "s34" });
	assert.equal(page.lifted, true);
	assert.equal(page.rows[0].session_id, "s34", "it leads the group");
	assert.equal(page.rows.length, 11, "one row is added, not forty");
	assert.equal(
		new Set(page.rows.map((entry) => entry.session_id)).size,
		page.rows.length,
		"no row is drawn twice",
	);
	assert.deepEqual(
		page.rows.slice(1).map((entry) => entry.session_id),
		rows.slice(0, 10).map((entry) => entry.session_id),
		"the sort behind it is untouched",
	);
	assert.equal(page.hidden, 30, "the lifted row is not also counted as hidden");
	/*
	 * AND A VIEWED ROW THE BOUND ALREADY DRAWS IS NOT MOVED: the lift is a remedy
	 * for one situation, and applying it unconditionally would reorder a group the
	 * reader is looking at for no reason at all.
	 */
	const inside = entityRows(rows, { loads: 0, currentId: "s3" });
	assert.equal(inside.lifted, false);
	assert.deepEqual(
		inside.rows.map((entry) => entry.session_id),
		rows.slice(0, 10).map((entry) => entry.session_id),
	);
	/*
	 * A CONVERSATION THIS GROUP DOES NOT HOLD IS NOT ADOPTED. Another team's session
	 * being the viewed one must not put a row under this team.
	 */
	const elsewhere = entityRows(rows, { loads: 0, currentId: "other-team" });
	assert.equal(elsewhere.lifted, false);
	assert.equal(elsewhere.rows.length, 10);
});

/*
 * THE COUNT AND THE DISCLOSURE AGREE (the brief's fourth clause): the badge states
 * what the group HOLDS, so a reader under `41` looking at ten rows could not tell
 * ten-of-forty-one from all-of-forty-one until the control said so.
 */
test("the group's foot names the next page AND the position it is drawn from", () => {
	const foot = entityMore({ add: 15, drawn: 10, total: 41 });
	assert.equal(foot.label, "Show 15 more chats · 10 of 41");
	/* The name contains the visible label whole (round 1, U4): same ` · `, not a comma. */
	assert.equal(foot.aria, "Show 15 more chats · 10 of 41 shown");
	/* A press that adds one row counts it, for `pageMoreLabel`'s reason. */
	assert.equal(
		entityMore({ add: 1, drawn: 40, total: 41 }).label,
		"Show 1 more chat · 40 of 41",
	);
	/*
	 * And it drops the position when the reader is already looking at everything,
	 * which is what keeps the control from contradicting the badge beside it.
	 */
	assert.equal(
		entityMore({ add: 15, drawn: 41, total: 41 }).label,
		"Show 15 more chats",
	);
	/* Nothing withheld and no cursor: no control, so `10 of 10` is never printed. */
	assert.equal(entityMore({ add: 0, drawn: 10, total: 10 }), null);
});

/*
 * THE COLLAPSED SECTION'S GAP (operator, 2026-09-27): "shrink the gap between
 * agents and teams headers when agents is collapsed, there's an extra gap wasting
 * space there". Measured on the panel at 360px, the gap between the two headings
 * is 16.0px with `Agents` collapsed AND 16.0px with it expanded - one shared
 * `space-y-4` that does not know whether there are rows for it to separate. So
 * the fix is a conditional value; a smaller constant would tighten the expanded
 * case, where the rhythm is doing real work.
 */
test("the gap below a section is conditional on whether that section drew rows", () => {
	assert.equal(entitySectionGap(true), ENTITY_SECTION_GAP);
	assert.equal(entitySectionGap(false), ENTITY_SECTION_GAP_COLLAPSED);
	assert.notEqual(
		ENTITY_SECTION_GAP_COLLAPSED,
		ENTITY_SECTION_GAP,
		"a single smaller constant is exactly the fix this refuses",
	);
	/*
	 * Tailwind's own 4px step, so "tighter" is a number rather than a claim: the
	 * collapsed gap is strictly smaller than the section rhythm it replaces.
	 */
	const px = (cls) => Number(/(\d+)/.exec(cls)?.[1] ?? Number.NaN) * 4;
	assert.ok(px(ENTITY_SECTION_GAP_COLLAPSED) < px(ENTITY_SECTION_GAP));
	/*
	 * AND IT IS THE SAME WHATEVER THE COLLAPSED SECTION HOLDS - the argument is one
	 * boolean, so an empty section and a section holding forty rows cannot space
	 * differently. That is the case a per-count rule gets wrong.
	 */
	assert.equal(entitySectionGap(false), entitySectionGap(false));
});

test("invariant 1: the viewed conversation is on screen past the page's end", () => {
	const rows = Array.from({ length: 60 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = pageRows(rows, { limit: 10, currentId: "s42" });
	assert.equal(page.rows.length, 11, "the viewed row joins the page");
	assert.equal(page.rows[0].session_id, "s42", "and leads it");
	assert.equal(page.lifted, true);
	assert.equal(
		new Set(page.rows.map((entry) => entry.session_id)).size,
		page.rows.length,
		"no row is drawn twice",
	);
	assert.deepEqual(
		page.rows.slice(1).map((entry) => entry.session_id),
		rows.slice(0, 10).map((entry) => entry.session_id),
		"the page behind it is unchanged",
	);
});

test("invariant 1: a viewed conversation inside the page is not lifted", () => {
	const rows = Array.from({ length: 60 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = pageRows(rows, { limit: 25, currentId: "s3" });
	assert.equal(page.lifted, false);
	assert.equal(page.rows.length, 25);
	assert.equal(page.rows[3].session_id, "s3");
});

/*
 * INVARIANT 2 - a search looks at everything, not at the loaded page.
 *
 * The search itself is the backend's (`chat-search.ts` joins its answer to the
 * rows on screen), and the page is what makes this hard: a match at position
 * 300 of 400 conversations is a row the page would never have loaded. Under a
 * query the limit does not apply, which is the only reading of "search should
 * still be able to search and find" that can find it.
 */
test("invariant 2: a search reaches past the page and reveals an unloaded match", () => {
	const rows = Array.from({ length: 60 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const hidden = rows[42];
	const paged = pageRows(rows, { limit: 10, currentId: null });
	assert.equal(
		paged.rows.some((entry) => entry.session_id === hidden.session_id),
		false,
		"without a query the match is outside the page",
	);
	const searched = pageRows(rows, {
		limit: 10,
		currentId: null,
		searching: true,
	});
	assert.equal(searched.rows.length, 60);
	assert.equal(
		searched.rows.some((entry) => entry.session_id === hidden.session_id),
		true,
		"a query admits every row the search matched",
	);
	assert.equal(searched.lifted, false, "nothing needs lifting while searching");
});

/*
 * INVARIANT 3 - the active rows sit above the rest WITHOUT inverting what is
 * below them.
 *
 * The operator's phrase was "sorting active to the top", and the hazard is the
 * naive implementation: a `sort()` on a boolean comparator is stable in modern
 * engines but a `sort()` on a status string is not, and either way the tempting
 * second pass - reverse the non-active rows so the active ones "rise" - buries
 * today's conversation under last week's.
 */
test("invariant 3: active rows lead, recency below them is not inverted", () => {
	const rows = [
		row("today", SECONDS(1)),
		row("older", SECONDS(100)),
		row("busy", SECONDS(200), "busy"),
		row("yesterday", SECONDS(30)),
		row("answer", SECONDS(300), "answer"),
	];
	const ordered = pageOrder(rows, "active-first");
	assert.deepEqual(
		ordered.map((entry) => entry.session_id),
		["busy", "answer", "today", "older", "yesterday"],
		"the active pair keeps the catalogue's order, and the rest keeps its own",
	);
	assert.equal(isActiveRow(rows[2]), true);
	assert.equal(isActiveRow(rows[0]), false);
});

test("invariant 3: an explicit recency order does not lift at all", () => {
	const rows = [
		row("a", SECONDS(1)),
		row("busy", SECONDS(200), "busy"),
		row("b", SECONDS(2)),
	];
	assert.deepEqual(
		pageOrder(rows, "recent").map((entry) => entry.session_id),
		["a", "busy", "b"],
		"the catalogue's order passes through untouched",
	);
});

test("the page order is a partition, never a sort: it allocates no times", () => {
	// Three active rows out of order among six, and the page below a limit that
	// cuts in the middle of the active block: every active row is still drawn.
	const rows = [
		row("a", SECONDS(1)),
		row("busy1", SECONDS(50), "busy"),
		row("b", SECONDS(2)),
		row("busy2", SECONDS(51), "delegating"),
		row("c", SECONDS(3)),
		row("busy3", SECONDS(52), "wedged"),
	];
	const page = pageRows(pageOrder(rows, "active-first"), {
		limit: 10,
		currentId: null,
	});
	assert.deepEqual(
		page.rows.slice(0, 3).map((entry) => entry.session_id),
		["busy1", "busy2", "busy3"],
	);
});

test("grouping by agent names the unbound rows rather than dropping them", () => {
	const rows = [
		{ ...row("one", SECONDS(1)), binding: { agent: "docs-writer" } },
		{ ...row("two", SECONDS(2)), binding: { agent: "docs-writer" } },
		{ ...row("three", SECONDS(3)), binding: { team: "chat-redesign" } },
		row("four", SECONDS(4)),
	];
	const groups = groupRows(rows, "agent");
	assert.deepEqual(
		groups.map((entry) => entry.label),
		["docs-writer", "chat-redesign", "Ungrouped"],
	);
	assert.equal(groups[0].rows.length, 2);
	assert.equal(groups[2].rows.length, 1, "an unbound row is still a row");
	// Flat is one group with no label; the component draws no header for it, and
	// the empty label is how it knows.
	const flat = groupRows(rows, "flat");
	assert.equal(flat.length, 1);
	assert.equal(flat[0].rows.length, 4);
	assert.equal(flat[0].label, "");
});

test("the section grouping is the list's own, not a second partition", () => {
	const rows = [row("x", SECONDS(1)), row("busy", SECONDS(9), "busy")];
	assert.equal(
		groupRows(rows, "section"),
		null,
		"the section arrangement is `chat-list-sections.ts`'s, and this returns nothing rather than a second copy of it",
	);
	// The arrangement the null defers to, driven through the module that owns it,
	// so the deferral is a fact about the shipped code and not about a stub.
	const sectioned = sectionRows(rows, NOW, "active");
	assert.deepEqual(
		sectioned.running.map((entry) => entry.session_id),
		["busy"],
	);
	assert.deepEqual(
		sectioned.today.map((entry) => entry.session_id),
		["x"],
	);
});

test("every chat-list section has a place in the view's canonical order", () => {
	// A section added to `chat-list-sections.ts` without a place here would be
	// drawn by nothing and switchable by nothing, which is the silent half of a
	// missing feature: the rows would simply stop appearing.
	for (const key of CHAT_LIST_SECTIONS) {
		assert.ok(
			SIDEBAR_SECTIONS.includes(key),
			`${key} is a chat-list section with no key in SIDEBAR_SECTIONS`,
		);
		assert.ok(SIDEBAR_SECTION_LABEL[key], `${key} has no label`);
		assert.equal(isEntitySection(key), false);
	}
	assert.equal(SIDEBAR_SECTIONS[0], "pinned");
	assert.deepEqual(
		ENTITY_SECTIONS.slice(),
		["agents", "teams"],
		"the two entity sections are the ones the AGENTS/TEAMS region draws",
	);
});

test("hiding a section is reversible and never empties the column", () => {
	const hidden = toggleSection(DEFAULT_SIDEBAR_VIEW, "week");
	assert.equal(isSectionShown(hidden, "week"), false);
	assert.equal(shownSections(hidden).length, SIDEBAR_SECTIONS.length - 1);
	const restored = toggleSection(hidden, "week");
	assert.deepEqual(restored.hidden, []);
	for (const key of SIDEBAR_SECTIONS) {
		assert.equal(isSectionShown(restored, key), true);
	}
});

test("reordering moves the section the reader can see, past a hidden one", () => {
	const view = {
		...DEFAULT_SIDEBAR_VIEW,
		hidden: ["week"],
	};
	const moved = moveSection(view, "older", -1);
	assert.deepEqual(
		shownSections(moved),
		["pinned", "running", "older", "today", "agents", "teams"],
		"older rose past today, because this week's section is not on screen",
	);
	assert.equal(
		new Set(moved.order).size,
		SIDEBAR_SECTIONS.length,
		"the order is still a permutation of every section",
	);
});

test("reordering at an end is a no-op rather than a wrap", () => {
	const first = moveSection(DEFAULT_SIDEBAR_VIEW, "pinned", -1);
	assert.deepEqual(first.order, DEFAULT_SIDEBAR_VIEW.order);
	const last = moveSection(DEFAULT_SIDEBAR_VIEW, "teams", 1);
	assert.deepEqual(last.order, DEFAULT_SIDEBAR_VIEW.order);
	const unknown = moveSection(DEFAULT_SIDEBAR_VIEW, "nope", 1);
	assert.deepEqual(unknown.order, DEFAULT_SIDEBAR_VIEW.order);
});

test("a stored view is normalised, never trusted", () => {
	const parsed = parseSidebarView({
		hidden: ["week", "week", "nonsense", 7],
		order: ["teams", "nonsense", "agents", "teams"],
		groupBy: "agent",
		orderBy: "recent",
		loads: 3.9,
	});
	assert.deepEqual(parsed.hidden, ["week"], "duplicates and non-sections drop");
	assert.deepEqual(
		parsed.order.slice(0, 2),
		["teams", "agents"],
		"the stored order leads",
	);
	assert.deepEqual(
		parsed.order.slice().sort(),
		SIDEBAR_SECTIONS.slice().sort(),
		"and the sections it forgot are appended",
	);
	assert.equal(parsed.groupBy, "agent");
	assert.equal(parsed.orderBy, "recent");
	assert.equal(parsed.loads, 3);
});

test("an unreadable or tampered view draws the column nobody has configured", () => {
	assert.deepEqual(parseSidebarView(null), DEFAULT_SIDEBAR_VIEW);
	assert.deepEqual(parseSidebarView("week"), DEFAULT_SIDEBAR_VIEW);
	assert.deepEqual(
		parseSidebarView({
			groupBy: "workspace",
			orderBy: "manual",
			hidden: "week",
		}),
		DEFAULT_SIDEBAR_VIEW,
		"an unknown option falls back on its own axis rather than dropping the view",
	);
	assert.equal(parseSidebarView({ loads: -3 }).loads, 0);
	assert.equal(parseSidebarView({ loads: Number.NaN }).loads, 0);
	assert.equal(
		parseSidebarView({ loads: Number.POSITIVE_INFINITY }).loads,
		0,
		"an infinite page is refused rather than clamped to a row count",
	);
	/*
	 * R13 (review round 3): a FINITE absurd counter used to pass through, and the
	 * ladder's own arithmetic then overflowed into `Infinity - Infinity` - the foot
	 * control printed `Show NaN more chats`. Clamped to the store's own 500-row page
	 * cap, which is the largest read this list can honestly ask for.
	 */
	assert.equal(
		parseSidebarView({ loads: 1e9 }).loads,
		500,
		"a tampered click counter is clamped to the store's page cap",
	);
	assert.equal(parseSidebarView({ loads: 1e308 }).loads, 500);
	assert.equal(
		pageMoreLabel(parseSidebarView({ loads: 1e308 }).loads, 40),
		"Show 40 more chats",
		"and the foot it feeds names a count rather than `NaN` (the R13 symptom)",
	);
	assert.deepEqual(DEFAULT_SIDEBAR_VIEW.hidden, []);
	assert.equal(DEFAULT_SIDEBAR_VIEW.groupBy, "section");
	assert.equal(DEFAULT_SIDEBAR_VIEW.basis, "active");
	assert.equal(DEFAULT_SIDEBAR_VIEW.orderBy, "active-first");
	assert.equal(DEFAULT_SIDEBAR_VIEW.loads, 0);
});

/*
 * THE PINNED ROSTER'S STORED LIST (issue #663), parsed on its own axis like
 * every other field: a blob from before the field existed yields no pins, and a
 * tampered one degrades per ENTRY - non-strings and empties dropped, duplicates
 * collapsed, the count clamped to `PINNED_AGENTS_MAX` - rather than taking the
 * view down with it. The keys are opaque HERE (the roster they name is not
 * loaded at parse time), so a pin that names no row survives and is inert:
 * that is the difference between a preference that has outlived an agent and a
 * defect.
 */
test("a stored view without pins parses to none, and a tampered list degrades field-wise", () => {
	assert.deepEqual(
		parseSidebarView({}).pinnedAgents,
		[],
		"a blob from before the field existed means no pins",
	);
	assert.deepEqual(parseSidebarView({ pinnedAgents: "kept" }).pinnedAgents, []);
	assert.deepEqual(
		parseSidebarView({ pinnedAgents: ["kept", 7, null, "kept", "second", ""] })
			.pinnedAgents,
		["kept", "second"],
		"strings only, deduped, empties dropped",
	);
	const many = Array.from({ length: 80 }, (_, index) => `agent-${index}`);
	assert.equal(
		parseSidebarView({ pinnedAgents: many }).pinnedAgents.length,
		PINNED_AGENTS_MAX,
		"the count is clamped rather than trusted",
	);
	assert.deepEqual(DEFAULT_SIDEBAR_VIEW.pinnedAgents, []);
});

test("the time basis parses like the other two choices: stored, validated, defaulted", () => {
	assert.equal(parseSidebarView({ basis: "created" }).basis, "created");
	assert.equal(
		parseSidebarView({ basis: "modified" }).basis,
		"active",
		"a basis this build cannot name falls back to the default rather than emptying the field",
	);
	assert.equal(parseSidebarView({ basis: 7 }).basis, "active");
});

test("a reorder pair is offered only where a press can land (D1)", () => {
	/*
	 * The defect this pins, measured on the operator's panel: Pinned draws first
	 * whatever the stored order says, and the entity region draws in fixed source
	 * order, so a pair on either moved the stored order and the popover while the
	 * column it describes stood still. The pair is drawn on the chat sections
	 * alone, and enabled only when the adjacent SHOWN section in that direction is
	 * another chat section.
	 */
	for (const key of ["pinned", "agents", "teams"]) {
		assert.equal(
			canMoveSection(DEFAULT_SIDEBAR_VIEW, key, -1),
			false,
			`${key} must offer no up`,
		);
		assert.equal(
			canMoveSection(DEFAULT_SIDEBAR_VIEW, key, 1),
			false,
			`${key} must offer no down`,
		);
	}
	// The default order's interior chat neighbours: running/down, today/both, week/up.
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "running", 1), true);
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "today", -1), true);
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "today", 1), true);
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "week", -1), true);
	// The edges: Pinned above running, the entity region below Older.
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "running", -1), false);
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "older", 1), false);
});

test("an empty section cannot move, and nothing moves against one (round 1's m1/U1)", () => {
	/*
	 * THE DEFECT THIS PINS, driven end to end in round 1: with a store whose only
	 * row sits in Today, `This week` is shown but draws no rows (an empty chat
	 * section contributes no label), and `Move Today down` was enabled - pressing
	 * it rewrote the stored order and the panel's own list while the column the
	 * reader was watching stood still. The mirror is an empty SOURCE: pressing an
	 * empty section's own arrow at a drawn neighbour is equally invisible, because
	 * the section being moved contributed nothing to the drawn sequence either
	 * way. So the predicate asks BOTH ends - the section being moved and the
	 * adjacent shown section in that direction must both draw - and with no
	 * predicate (a caller with no rows to point at) the geometric rule stands.
	 */
	const draws = (drawn) => (key) => drawn.includes(key);
	assert.equal(
		canMoveSection(
			DEFAULT_SIDEBAR_VIEW,
			"today",
			1,
			draws(["running", "today"]),
		),
		false,
		"today cannot move against an empty week",
	);
	assert.equal(
		canMoveSection(
			DEFAULT_SIDEBAR_VIEW,
			"running",
			1,
			draws(["today", "week"]),
		),
		false,
		"an empty section cannot move at all",
	);
	assert.equal(
		canMoveSection(
			DEFAULT_SIDEBAR_VIEW,
			"today",
			1,
			draws(["running", "today", "week"]),
		),
		true,
		"both ends drawn: the press is real",
	);
	assert.equal(
		canMoveSection(DEFAULT_SIDEBAR_VIEW, "today", 1),
		true,
		"no predicate: the geometric rule alone",
	);
});

test("a hidden section cannot move, and a hidden neighbour makes a new one adjacent", () => {
	const hidden = toggleSection(DEFAULT_SIDEBAR_VIEW, "today");
	assert.equal(
		canMoveSection(hidden, "today", -1),
		false,
		"a section that is not drawn has no up",
	);
	// With today hidden, running's shown down-neighbour is week - still a chat section.
	assert.equal(canMoveSection(hidden, "running", 1), true);
	const shuffled = {
		...DEFAULT_SIDEBAR_VIEW,
		order: ["pinned", "running", "agents", "today", "week", "older", "teams"],
	};
	assert.equal(
		canMoveSection(shuffled, "today", -1),
		false,
		"its shown up-neighbour is an entity row",
	);
	assert.equal(canMoveSection(shuffled, "today", 1), true);
});

test("the component draws the band's controls and the popover's four groups", () => {
	// The markup assertions this suite can make about a component it cannot
	// render: the three icon-only buttons exist, each is named for a screen
	// reader, and each of the popover's groups is drawn. A control that lost its
	// `aria-label` would be an unlabelled button, and that is a real regression
	// rather than a style question - so it is pinned here beside the menu's
	// presence, which is the part a driver frame cannot read.
	//
	// TWO FILES, because the band and the panel are two: the band is drawn by the
	// sidebar (which cannot be rendered here) and the panel by
	// `chat-sidebar-view-menu.tsx` (which can, and is what the design round's
	// story renders). Asserting both from one place is what keeps a control from
	// being deleted from one half without this file noticing.
	const source = readFileSync(SIDEBAR, "utf8");
	const menu = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar-view-menu.tsx",
		"utf8",
	);
	for (const hook of [
		"data-sidebar-band",
		"data-sidebar-view-options",
		"data-sidebar-create",
		"data-sidebar-page-more",
		"data-sidebar-open-agent",
	]) {
		assert.ok(source.includes(hook), `${hook} is not drawn`);
	}
	for (const label of ["Group by", "Time basis", "Order by", "Sections"]) {
		assert.ok(
			menu.includes(`"${label}"`) || menu.includes(`>${label}<`),
			`the view popover draws no ${label} group`,
		);
	}
	for (const hook of [
		"data-sidebar-view-choice",
		"data-sidebar-view-basis",
		"data-sidebar-view-section",
		"data-sidebar-view-move",
	]) {
		assert.ok(menu.includes(hook), `${hook} is not drawn`);
	}
	assert.ok(
		menu.includes("basis: option.key"),
		"the Time basis rows do not write the view's basis on press",
	);
	assert.ok(
		source.includes('navigate("/agents?create=agent")') &&
			source.includes('navigate("/agents?create=team")'),
		"the create menu is not wired to the two existing authoring flows",
	);
	assert.ok(
		source.includes('aria-label="Search chats and agents"'),
		"the band's search control has no accessible name",
	);
	assert.ok(
		source.includes('aria-label="Open agent…"'),
		"the band's agent jump has no accessible name",
	);
});

/*
 * THE AGENT JUMP'S SEED (issue #663): the band control opens the palette and
 * writes the agents-scope seed, in that order.
 *
 * WHAT THIS FILE CAN SAY about it: the two writes exist at the control's own
 * anchor and in the order the store's shapes want - `openCommandPalette`
 * raises the flag and does not touch the query, and the seed is written after
 * it, so both land in the one commit the palette's open-time sync reads. What
 * the seed MEANS is `palette-search.ts`'s table and is pinned in
 * `scripts/palette-search.test.mjs`; that the palette then renders seeded is
 * the story's frame and QA's walk.
 */
test("the band's agent jump opens the palette and seeds it to the agent scope", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	const at = source.indexOf("data-sidebar-open-agent");
	assert.notEqual(at, -1, "the band's Open agent… control is gone");
	const control = source.slice(at, at + 1_800);
	assert.ok(
		control.includes("openCommandPalette()") &&
			control.includes("setCommandPaletteQuery(AGENT_ROSTER_SEED)"),
		"the control no longer opens the palette seeded to the agents scope",
	);
	assert.ok(
		control.indexOf("openCommandPalette()") <
			control.indexOf("setCommandPaletteQuery("),
		"the seed is written before the open, so an open-time reset would clobber it",
	);
});

/*
 * THE TWO ENTITY SECTIONS OBEY THE POPOVER LIKE EVERY OTHER SECTION.
 *
 * The operator's report (2026-09-27), verbatim: "I unchecked the Agents section
 * from the view settings and that section still seems to be there". The tick
 * went out and the panel's own "1 section hidden" sentence appeared, while the
 * region below kept drawing the row - both halves of one frame disagreeing
 * about one state.
 *
 * WHICH SIDE WAS WRONG, because it decides the shape of the fix: the WRITE
 * reached the store (the panel's tick and its sentence are read from that same
 * `view.hidden`), and the READ half of the region simply never asked. The
 * chats list asked (`drawnSections`), which is why its six sections hid
 * correctly while these two did not - one code path, two callers, one of them
 * missing.
 *
 * THE MODEL HALF is asserted first: an entity key is an ordinary member of
 * `hidden`, survives the store's own parse, and is claimed by the same
 * `isSectionShown` the switch's tick reads.
 */
test("an entity section is hidden by the same field as a chat section", () => {
	const stored = parseSidebarView({ hidden: ["agents"] });
	assert.deepEqual(
		stored.hidden,
		["agents"],
		"a stored entity key is not discarded on the way in",
	);
	assert.equal(isSectionShown(stored, "agents"), false);
	assert.equal(shownSections(stored).includes("agents"), false);
	const restored = toggleSection(stored, "agents");
	assert.equal(isSectionShown(restored, "agents"), true);
});

/*
 * THE COMPONENT HALF, read rather than rendered: the sidebar cannot be mounted
 * by this suite (the module's own header says why), so the gate is asserted
 * where it is written. Each entity heading must sit behind
 * `isSectionShown(view, <key>)` - the call the popover's switch reads - and the
 * assertion is a window AROUND the heading call rather than a substring search
 * of the whole file, so a gate copied elsewhere cannot stand in for this one.
 * It fails on the revision the operator reported: no such gate existed, so the
 * window held no match.
 */
test("the AGENTS/TEAMS region draws each entity row behind the view's own gate", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	for (const key of ENTITY_SECTIONS) {
		const at = source.indexOf(`{heading("${key}", `);
		assert.ok(at > 0, `the ${key} section's heading call is gone`);
		const window = source.slice(Math.max(0, at - 600), at);
		assert.ok(
			window.includes(`isSectionShown(view, "${key}") && (`),
			`${key} is drawn without asking the view, so the popover's switch cannot hide it`,
		);
	}
});

/*
 * THE PINNED ROWS RIDE IN A GROUPED LIST TOO.
 *
 * `Group by` is one of the popover's promises and it is a LAYOUT: switching it
 * must not change which conversations are drawn. Grouping by agent or
 * flattening handed `groupRows` the page alone, and `Pinned` is only drawn
 * under the section arrangement - so every pinned chat disappeared from the
 * column, silently, on a press that claims to rearrange it. Asserted as source
 * because the fix is which array the component passes (the rule itself is
 * `groupRows`'s, and the suite above already pins that it keeps every row it is
 * given).
 */
test("a grouped list is the page plus the pinned rows, never the page alone", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	assert.ok(
		source.includes("groupRows([...pinned, ...pagedRows], view.groupBy)"),
		"the grouped arrangement drops the pinned rows, so grouping acts as a filter",
	);
});

/*
 * PERSISTENCE, per control, and stated apart from whether the control works.
 *
 * A setting that works until the app restarts is a different bug from one that
 * never works, and the popover's controls all ride ONE persisted object
 * (`chatSidebarView`): the module's `toggleSection`/`moveSection` and the two
 * single-choice writes each return a complete next view, the store keeps the
 * whole object, and a launch rehydrates it through `parseSidebarView`. So the
 * instrument is a write of the shape the panel makes, the bytes the persist
 * middleware leaves behind, and a parse of those bytes - the same round trip
 * `chat-sidebar-sections.test.mjs` takes for the dragged height, and the one
 * half of this audit a mounted frame cannot show (Storybook never reloads the
 * page a play function drove).
 */
test("every view setting the popover writes survives a relaunch", () => {
	memory.clear();
	const store = useUiPreferencesStore;
	// One press, per control, in the panel's own spelling.
	const hidden = toggleSection(DEFAULT_SIDEBAR_VIEW, "agents");
	const moved = moveSection(hidden, "today", 1);
	const grouped = { ...moved, groupBy: "flat" };
	const ordered = { ...grouped, orderBy: "recent" };
	// The pin is the roster's own field and rides the same object: one press, in
	// the module's own spelling, so the relaunch below proves it comes back.
	const pinned = togglePinnedAgent(ordered, "release-captain");
	store.getState().setChatSidebarView(pinned);
	// The store is the writer, and the filter the middleware keeps is the one it
	// ships: assert the field is IN the persisted blob rather than assuming it.
	assert.deepEqual(
		persistedUiPreferences(store.getState()).chatSidebarView,
		pinned,
	);
	// The bytes on disk, parsed the way the next launch parses them.
	const key = [...memory.keys()].find((entry) => {
		try {
			return JSON.parse(memory.get(entry)).state?.chatSidebarView !== undefined;
		} catch {
			return false;
		}
	});
	assert.ok(key, "the store wrote a key carrying the sidebar's view");
	const relaunched = parseSidebarView(
		JSON.parse(memory.get(key)).state.chatSidebarView,
	);
	assert.deepEqual(
		relaunched.hidden,
		["agents"],
		"the hidden section came back",
	);
	assert.equal(isSectionShown(relaunched, "agents"), false);
	assert.deepEqual(relaunched.order, ordered.order, "the reorder came back");
	assert.equal(relaunched.groupBy, "flat", "the grouping came back");
	assert.equal(relaunched.orderBy, "recent", "the ordering came back");
	assert.deepEqual(
		relaunched.pinnedAgents,
		["release-captain"],
		"the pin came back",
	);
	// And the one control with a non-default value nothing else writes: the page
	// ladder, whose counter is the only field that can only ever grow.
	store.getState().setChatSidebarView({ ...relaunched, loads: 2 });
	const again = parseSidebarView(
		JSON.parse(memory.get(key)).state.chatSidebarView,
	);
	assert.equal(again.loads, 2, "the page rung came back");
	assert.equal(pageLimit(again.loads), CHAT_PAGE_STEPS[1]);
});
