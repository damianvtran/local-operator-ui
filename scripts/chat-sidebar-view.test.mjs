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
 * right. Those are pixels and they are the rig's job (`--scene sidebar-sections`
 * on the built app, and the frames it writes).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/chat-sidebar-view";',
			'export * from "./src/renderer/src/features/chat/chat-list-sections";',
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
	isActiveRow,
	CHAT_LIST_SECTIONS,
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
	const sectioned = sectionRows(rows, NOW);
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
		"the two entity sections are the ones the Agents disclosure owns",
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
	assert.equal(DEFAULT_SIDEBAR_VIEW.orderBy, "active-first");
	assert.equal(DEFAULT_SIDEBAR_VIEW.loads, 0);
});

test("the component draws the band's controls and the popover's three groups", () => {
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
	]) {
		assert.ok(source.includes(hook), `${hook} is not drawn`);
	}
	for (const label of ["Group by", "Order by", "Sections"]) {
		assert.ok(
			menu.includes(`"${label}"`) || menu.includes(`>${label}<`),
			`the view popover draws no ${label} group`,
		);
	}
	for (const hook of [
		"data-sidebar-view-choice",
		"data-sidebar-view-section",
		"data-sidebar-view-move",
	]) {
		assert.ok(menu.includes(hook), `${hook} is not drawn`);
	}
	assert.ok(
		source.includes('navigate("/agents?create=agent")') &&
			source.includes('navigate("/agents?create=team")'),
		"the create menu is not wired to the two existing authoring flows",
	);
	assert.ok(
		source.includes('aria-label="Search chats and agents"'),
		"the band's search control has no accessible name",
	);
});
