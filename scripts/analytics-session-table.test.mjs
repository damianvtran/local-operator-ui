/**
 * The by-session table's model: paging, sorting, search and the filter,
 * executable.
 *
 *     node --test scripts/analytics-session-table.test.mjs
 *
 * The operator's request was that every session in `/analytics` be reachable
 * through table pagination, and that the table be sortable, filterable and
 * searchable. `src/renderer/src/features/chat/pickers/panels/analytics-session-state.ts`
 * is the whole of that decision outside the DOM — and four of its rules are
 * invisible in ANY frame, which is why they are pinned here rather than
 * described in a comment:
 *
 * - the `id` tie-break, which only shows when two rows tie and the reader
 *   changes page;
 * - "unknown sorts last in both directions", which a single-direction frame
 *   cannot distinguish from "unknown sorted as zero";
 * - the fraction's denominator, which must be the WINDOW total and not the
 *   narrowed one;
 * - the clamp, which is a derivation that must not rewrite the stored page.
 *
 * Two more are asserted here because the failure is silent rather than wrong:
 * the slice never exceeds `SESSION_PAGE_SIZE`, and it hands back the SAME row
 * objects the ordering pass produced — the property the section's `pageRows`
 * memo is keyed on, so a paging pass that copied rows would make every page
 * turn re-enrich twenty rows for nothing.
 *
 * The TEN cases are the design's own list (§11.1), in its order. The last case
 * is the addition review round 1 asked for (M5): the window-change reset used
 * to rest on a template literal inside the section, which is the silent class
 * of failure §12.3 describes — dropping a term from that key left the table
 * correct and merely on a stale page. The wording functions are pinned in that
 * list because three surfaces consume them (the visible match line, the pager's
 * range line and the live region) and a count stated in two places is a count
 * that can be stated two ways.
 *
 * What this file does NOT prove: that any of it is VISIBLE, that the header
 * button and `aria-sort` are rendered, or that focus survives a page turn.
 * Those are the stories' `play` functions' job
 * (`analytics-panel.stories.tsx`), and the frames in
 * `docs/evidence/panels-analytics/` are what a reviewer looks at.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

/*
 * Bundled in memory so the suite runs against the shipped TS module rather than
 * a re-implementation. `formatters` is exported alongside it so the first case
 * can assert the cost STRING order that the number order contradicts — the
 * falsifier is the disagreement between the two, not either one alone.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/pickers/panels/analytics-session-state";',
			'export * from "./src/renderer/src/features/chat/pickers/panels/formatters";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	SESSION_PAGE_SIZE,
	INITIAL_SESSION_TABLE_STATE,
	sessionTableReducer,
	sessionIndex,
	narrowSessionIndex,
	sortSessionIndex,
	sessionPage,
	enrichSessionRows,
	effectiveSortKey,
	effectiveSortDirection,
	firstDirection,
	asSessionSortKey,
	isNarrowed,
	sessionMatchLine,
	sessionTableScopeKey,
	sessionAnnouncement,
	sessionEmptyText,
	formatMicroUsd,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** One `by_session` entry, with every field the index reads. */
const usage = (over = {}) => ({
	calls: 4,
	ok_calls: 4,
	input_tokens: 900,
	output_tokens: 300,
	cache_read_tokens: 600,
	cache_write_tokens: 40,
	reasoning_tokens: 20,
	context_tokens: 1_500,
	cost_micro: 2_000_000,
	cost_known_calls: 4,
	components: {},
	by_provider: {},
	...over,
});

const index = (bySession, names = {}, parents = {}, metric = "tokens") =>
	sessionIndex(bySession, names, parents, metric);

/** The ids of a row list, in the order they came back. */
const ids = (rows) => rows.map((row) => row.id);

/* ------------------------------------------------------------------ 1 */
test("numeric sorts use the numbers, not the formatted strings", () => {
	// The two rows are chosen so the CELL strings sort the other way round:
	// `"$10.00" < "$2.00"` as text, against `2_000_000 < 10_000_000` as micro-USD.
	const ten = usage({ cost_micro: 10_000_000, cost_known_calls: 4 });
	const two = usage({ cost_micro: 2_000_000, cost_known_calls: 4 });
	assert.ok(
		formatMicroUsd(two.cost_micro, 4, 4) > formatMicroUsd(ten.cost_micro, 4, 4),
		"the fixture must be one whose STRINGS sort against its numbers",
	);
	const rows = index({ a1: two, b2: ten }).rows;
	assert.deepEqual(
		ids(sortSessionIndex(rows, "cost", "asc")),
		["a1", "b2"],
		"ascending cost must follow cost_micro, not the formatted string",
	);
});

/* ------------------------------------------------------------------ 2 */
test("an unknown value sorts last in BOTH directions", () => {
	const known = usage({ cost_micro: 2_000_000, cost_known_calls: 4 });
	const unpriced = usage({ cost_micro: 0, cost_known_calls: 0 });
	const unmeasurable = usage({ context_tokens: 0, cache_read_tokens: 0 });
	const rows = index({ a1: known, b2: unpriced, c3: unmeasurable }).rows;
	for (const direction of ["asc", "desc"]) {
		assert.equal(
			ids(sortSessionIndex(rows, "cost", direction)).at(-1),
			"b2",
			`unpriced cost must be last under ${direction}`,
		);
		assert.equal(
			ids(sortSessionIndex(rows, "cache", direction)).at(-1),
			"c3",
			`an unmeasurable cache rate must be last under ${direction}`,
		);
	}
	// And the unknown rows are ordered among themselves by the tie-break, so two
	// `—` rows do not swap places between two identical clicks.
	const twoUnknown = index({
		c3: unpriced,
		a1: usage({ cost_known_calls: 0 }),
	}).rows;
	assert.deepEqual(ids(sortSessionIndex(twoUnknown, "cost", "desc")), [
		"a1",
		"c3",
	]);
});

/* ------------------------------------------------------------------ 3 */
test("ties break by id ascending under both directions", () => {
	const rows = index({
		c3: usage({ output_tokens: 300 }),
		a1: usage({ output_tokens: 300 }),
		b2: usage({ output_tokens: 300 }),
	}).rows;
	// Equal values, so the whole order is the tie-break: id ascending, whichever
	// way the primary comparison runs.
	for (const direction of ["asc", "desc"]) {
		assert.deepEqual(ids(sortSessionIndex(rows, "tokens", direction)), [
			"a1",
			"b2",
			"c3",
		]);
	}
});

/* ------------------------------------------------------------------ 4 */
test("the filter hides rows with a parent edge, and nothing when there is no map", () => {
	const bySession = { a1: usage(), b2: usage(), c3: usage() };
	const parents = { b2: "a1" };
	const withMap = index(bySession, {}, parents);
	assert.deepEqual(
		ids(narrowSessionIndex(withMap, "", { topLevelOnly: true })),
		["a1", "c3"],
	);
	// An older backend sends no parents map at all: every row is top-level, and
	// the table renders flat ids rather than answering with an empty set for a
	// structure nobody stated.
	const withoutMap = index(bySession);
	assert.deepEqual(
		ids(narrowSessionIndex(withoutMap, "", { topLevelOnly: true })),
		["a1", "b2", "c3"],
	);
});

/* ------------------------------------------------------------------ 5 */
test("search is a case-folded substring of the label and the id", () => {
	/* The INDEX is what the narrowing pass takes — not `index.rows`, which is
	   the array it produces (a mistake this file made on its first run, and one
	   the next reader would make too). */
	const fixture = index(
		{ a1b2c3d4e5f6: usage(), ff00ff00ff00: usage(), c3: usage() },
		{ a1b2c3d4e5f6: "Panel views", ff00ff00ff00: "Résumé draft" },
	);
	const found = (query) =>
		ids(narrowSessionIndex(fixture, query, { topLevelOnly: false }));

	// Case-folded, and the substring is enough: a partial label matches.
	assert.deepEqual(found("PANEL VIE"), ["a1b2c3d4e5f6"]);
	// The id is matched too, because it is the only handle an unnamed session
	// has: `c3` has no name at all and must still be findable.
	assert.deepEqual(found("c3"), ["a1b2c3d4e5f6", "c3"]);
	// Whitespace-only narrows nothing and says nothing.
	assert.equal(found("   ").length, 3);
	assert.equal(found("").length, 3);
	// The two accepted limits, asserted so a future change to either is visible:
	// word order matters (substring, not a token search)...
	assert.equal(found("views panel").length, 0);
	// ...and there is no accent folding (`toLocaleLowerCase` only).
	assert.equal(found("resume").length, 0);
});

/* ------------------------------------------------------------------ 6 */
test("paging arithmetic: pageCount, the range, and the clamp", () => {
	const bySession = Object.fromEntries(
		Array.from({ length: 45 }, (_, i) => [
			`id${String(i).padStart(2, "0")}`,
			usage(),
		]),
	);
	const ordered = sortSessionIndex(index(bySession).rows, "tokens", "desc");
	assert.equal(SESSION_PAGE_SIZE, 20);
	const first = sessionPage(ordered, 0);
	assert.deepEqual(
		{
			count: first.rows.length,
			pageCount: first.pageCount,
			from: first.from,
			to: first.to,
			total: first.total,
		},
		{ count: 20, pageCount: 3, from: 1, to: 20, total: 45 },
	);
	const last = sessionPage(ordered, 2);
	assert.deepEqual(
		{ from: last.from, to: last.to, count: last.rows.length },
		{
			from: 41,
			to: 45,
			count: 5,
		},
	);
	// No page beyond the end: a stored page of 9 clamps to the last one rather
	// than rendering an empty table.
	const clamped = sessionPage(ordered, 9);
	assert.equal(clamped.page, 2);
	assert.equal(clamped.rows.length, 5);
	// A set that shrank under the reader keeps a well-formed page too.
	const shrunk = sessionPage(ordered.slice(0, 3), 4);
	assert.deepEqual(
		{
			page: shrunk.page,
			pageCount: shrunk.pageCount,
			from: shrunk.from,
			to: shrunk.to,
		},
		{
			page: 0,
			pageCount: 1,
			from: 1,
			to: 3,
		},
	);
	// And the empty set is not a special case for the clamp: page 0, count 1.
	const empty = sessionPage([], 3);
	assert.deepEqual(
		{
			page: empty.page,
			pageCount: empty.pageCount,
			from: empty.from,
			to: empty.to,
			total: empty.total,
		},
		{
			page: 0,
			pageCount: 1,
			from: 0,
			to: 0,
			total: 0,
		},
	);
});

/* ------------------------------------------------------------------ 7 */
test("the reducer's reset table, including the row that must NOT reset", () => {
	const sorted = sessionTableReducer(
		{ ...INITIAL_SESSION_TABLE_STATE, query: "status", page: 4 },
		{
			type: "sort",
			key: "cost",
			ranking: { key: "tokens", direction: "desc" },
		},
	);
	assert.deepEqual(sorted, {
		query: "status",
		sort: { key: "cost", direction: "desc" },
		filters: { topLevelOnly: false },
		page: 0,
		scope: null,
	});
	// Activating the active column flips the direction, and the Session column
	// opens ascending rather than descending.
	assert.deepEqual(
		sessionTableReducer(sorted, {
			type: "sort",
			key: "cost",
			ranking: { key: "cost", direction: "desc" },
		}).sort,
		{ key: "cost", direction: "asc" },
	);
	assert.deepEqual(
		sessionTableReducer(sorted, {
			type: "sort",
			key: "session",
			ranking: { key: "cost", direction: "desc" },
		}).sort,
		{ key: "session", direction: "asc" },
	);
	assert.equal(firstDirection("tokens"), "desc");
	assert.equal(firstDirection("session"), "asc");
	// A keystroke, a filter toggle and a page change reset the page; the window
	// moving under the reader resets ONLY the page and keeps their order,
	// filter and query.
	for (const action of [
		{ type: "search", query: "x" },
		{ type: "filter", topLevelOnly: true },
		{ type: "reset" },
	]) {
		assert.equal(sessionTableReducer(sorted, action).page, 0, action.type);
	}
	assert.deepEqual(sessionTableReducer(sorted, { type: "reset" }), {
		...sorted,
		page: 0,
	});
	// The refetch path is NOT a reducer action at all: a `refreshing` flip or a
	// new payload object leaves the state untouched, so a refetch over the same
	// window cannot throw the reader off the page they are on.
	assert.equal(
		sessionTableReducer(sorted, { type: "page", page: 7 }).page,
		7,
		"only the reader moves the page",
	);
	// An action that changes nothing returns the SAME object, which is what lets
	// React bail out of a re-render on the paths that are otherwise cheap to
	// re-run.
	assert.equal(sessionTableReducer(sorted, { type: "reset" }), sorted);
	assert.equal(
		sessionTableReducer(sorted, { type: "search", query: "status" }),
		sorted,
	);
});

/* ------------------------------------------------------------------ 8 */
test("the fraction's denominator cannot move", () => {
	const bySession = {
		a1: usage({ output_tokens: 300 }),
		b2: usage({ output_tokens: 300 }),
		c3: usage({
			output_tokens: 0,
			input_tokens: 0,
			context_tokens: 0,
			cache_read_tokens: 0,
		}),
	};
	const names = { a1: "Panel views", b2: "Composer slash parity" };
	const parents = { b2: "a1" };
	const both = index(bySession, names, parents);
	const enrich = (rows, total) =>
		enrichSessionRows(rows, { total, names, parents });
	const fractionOf = (rows, id) => rows.find((row) => row.id === id).fraction;

	const all = enrich(
		narrowSessionIndex(both, "", { topLevelOnly: false }),
		both.total,
	);
	const searched = enrich(
		narrowSessionIndex(both, "panel", { topLevelOnly: false }),
		both.total,
	);
	const filtered = enrich(
		narrowSessionIndex(both, "", { topLevelOnly: true }),
		both.total,
	);
	const pageTurn = enrich(
		sessionPage(
			sortSessionIndex(all.length ? both.rows : [], "tokens", "desc"),
			0,
		).rows,
		both.total,
	);

	// Byte-identical: the same object, which is the strongest form of "did not
	// move" — the bar is a share of THIS WINDOW, whatever is on screen.
	assert.equal(fractionOf(searched, "a1"), fractionOf(all, "a1"));
	assert.equal(fractionOf(filtered, "a1"), fractionOf(all, "a1"));
	assert.equal(fractionOf(pageTurn, "a1"), fractionOf(all, "a1"));
	// A one-row result is not a full bar: the row's share of the window is
	// unchanged by everything else having been filtered out.
	const oneRow = enrich(
		narrowSessionIndex(both, "panel", { topLevelOnly: false }),
		both.total,
	);
	assert.equal(oneRow.length, 1);
	assert.equal(fractionOf(oneRow, "a1"), 300 / 600);
	// And a row with no metric value at all is at zero rather than absent.
	assert.equal(fractionOf(all, "c3"), 0);
});

/* ------------------------------------------------------------------ 9 */
test("the wording: the match line, the announcement and the empty text", () => {
	// The match line renders only while something is narrowing.
	assert.equal(
		sessionMatchLine({
			matched: 38,
			total: 4_550,
			query: "",
			topLevelOnly: false,
		}),
		null,
	);
	assert.equal(
		sessionMatchLine({
			matched: 38,
			total: 4_550,
			query: "status",
			topLevelOnly: false,
		}),
		'38 of 4,550 sessions match "status"',
	);
	assert.equal(
		sessionMatchLine({
			matched: 404,
			total: 4_550,
			query: "",
			topLevelOnly: true,
		}),
		"404 of 4,550 sessions · top-level only",
	);
	assert.equal(
		sessionMatchLine({
			matched: 38,
			total: 4_550,
			query: "status",
			topLevelOnly: true,
		}),
		'38 of 4,550 sessions match "status" · top-level only',
	);
	// A whitespace-only query narrows nothing, so the line says only what the
	// filter did.
	assert.equal(
		sessionMatchLine({
			matched: 4_550,
			total: 4_550,
			query: "  ",
			topLevelOnly: true,
		}),
		"4,550 of 4,550 sessions · top-level only",
	);
	// The singulars, pinned. The NOUN follows the total the match is stated
	// against (`of 1 session`), and the VERB follows the matched count, because
	// that is the sentence's subject — `1 of 4,550 sessions match` reads wrong
	// at exactly the moment a reader has narrowed to one row.
	assert.equal(
		sessionMatchLine({
			matched: 1,
			total: 1,
			query: "panel",
			topLevelOnly: false,
		}),
		'1 of 1 session matches "panel"',
	);
	assert.equal(
		sessionMatchLine({
			matched: 1,
			total: 4_550,
			query: "6e127",
			topLevelOnly: false,
		}),
		'1 of 4,550 sessions matches "6e127"',
	);
	assert.equal(
		sessionMatchLine({
			matched: 2,
			total: 4_550,
			query: "6e12",
			topLevelOnly: false,
		}),
		'2 of 4,550 sessions match "6e12"',
	);

	const context = {
		query: "status",
		matched: 38,
		page: 1,
		pageCount: 228,
		sortKey: "cost",
		sortDirection: "desc",
		topLevelOnly: false,
	};
	assert.equal(
		sessionAnnouncement(null, context),
		"",
		"opening announces nothing",
	);
	assert.equal(
		sessionAnnouncement("search", context),
		'38 sessions match "status".',
	);
	assert.equal(
		sessionAnnouncement("sort", context),
		"Sorted by Cost, highest first.",
	);
	assert.equal(
		sessionAnnouncement("sort", {
			...context,
			sortKey: "session",
			sortDirection: "asc",
		}),
		"Sorted by Session, A to Z.",
	);
	assert.equal(sessionAnnouncement("page", context), "Page 2 of 228.");
	assert.equal(
		sessionAnnouncement("filter", {
			...context,
			matched: 404,
			topLevelOnly: true,
		}),
		"Top-level only: 404 sessions.",
	);
	// And the branch that turns it back off, which is the module's other half of
	// the same sentence and was asserted nowhere (review round 1, M5).
	assert.equal(
		sessionAnnouncement("filter", {
			...context,
			matched: 819,
			topLevelOnly: false,
		}),
		"Top-level only off: 819 sessions.",
	);
	// The announcement reads its numbers from the RENDERED state, which is what
	// makes the clamp announceable: the same "page" change, after the answer
	// shrank to two pages, says the page the reader is actually on.
	assert.equal(
		sessionAnnouncement("page", { ...context, page: 1, pageCount: 2 }),
		"Page 2 of 2.",
	);
	/*
	 * A field holding ONLY spaces is not a cleared field, and the live region
	 * must not say it was: the spaces are still in the field and the clear
	 * control is still beside them, so "Search cleared." describes a state the
	 * reader (and a screen-reader reader, who has no way to check) does not
	 * have. Q-2's own repro — focus the field, type three spaces — used to
	 * produce that sentence. The match line still says nothing, which is §6.3;
	 * this pins the announcement, which is the other surface.
	 */
	assert.equal(
		sessionAnnouncement("search", { ...context, query: "  " }),
		"",
		"a whitespace-only query narrows nothing AND says nothing",
	);
	// The genuinely cleared field keeps its sentence: the two states differ in
	// the RAW value, not in the trimmed one.
	assert.equal(
		sessionAnnouncement("search", { ...context, query: "", matched: 4_550 }),
		"Search cleared.",
	);

	// The empty states, and the detail that has to be true of clearing the
	// search: it names the POOL the search ran over, not the window.
	assert.equal(
		sessionEmptyText({
			total: 4_550,
			filtered: 4_550,
			matched: 4_550,
			query: "",
			topLevelOnly: false,
		}),
		null,
		"a non-empty table has nothing to explain",
	);
	assert.equal(
		sessionEmptyText({
			total: 0,
			filtered: 0,
			matched: 0,
			query: "",
			topLevelOnly: false,
		}),
		null,
		"a window with no sessions is the panel's own empty, not this one",
	);
	assert.deepEqual(
		sessionEmptyText({
			total: 4_550,
			filtered: 4_550,
			matched: 0,
			query: "zzz",
			topLevelOnly: false,
		}),
		{
			text: 'No sessions match "zzz".',
			detail: "4,550 sessions in this window. Clear the search to see them.",
		},
	);
	assert.deepEqual(
		sessionEmptyText({
			total: 4_550,
			filtered: 404,
			matched: 0,
			query: "zzz",
			topLevelOnly: true,
		}),
		{
			text: 'No sessions match "zzz".',
			detail: "404 sessions match the filter. Clear the search to see them.",
		},
	);
	assert.deepEqual(
		sessionEmptyText({
			total: 4_550,
			filtered: 0,
			matched: 0,
			query: "",
			topLevelOnly: true,
		}),
		{
			text: "No top-level sessions in this window.",
			detail: "All 4,550 sessions in this window have a parent.",
		},
	);
	assert.deepEqual(
		sessionEmptyText({
			total: 1,
			filtered: 0,
			matched: 0,
			query: "",
			topLevelOnly: true,
		}),
		{
			text: "No top-level sessions in this window.",
			detail: "The one session in this window has a parent.",
		},
	);
});

/* ----------------------------------------------------------------- 10 */
test("the page is bounded, has no repeats, and hands back the ordered rows", () => {
	// 60 rows, the first 30 of them roots: the slice must be unaffected by the
	// rows a filter removed, and the removal is not a renumbering of pages.
	const bySession = Object.fromEntries(
		Array.from({ length: 60 }, (_, i) => [
			`id${String(i).padStart(2, "0")}`,
			usage({ output_tokens: 100 + (i % 9) * 10 }),
		]),
	);
	const parents = Object.fromEntries(
		Array.from({ length: 30 }, (_, i) => [
			`id${String(i + 30).padStart(2, "0")}`,
			"id00",
		]),
	);
	const both = index(bySession, {}, parents);
	const roots = narrowSessionIndex(both, "", { topLevelOnly: true });
	assert.equal(roots.length, 30);
	const orderedRoots = sortSessionIndex(roots, "tokens", "desc");
	for (let page = 0; page < 3; page++) {
		const slice = sessionPage(orderedRoots, page);
		assert.ok(slice.rows.length <= SESSION_PAGE_SIZE);
		assert.equal(
			new Set(ids(slice.rows)).size,
			slice.rows.length,
			"no row twice",
		);
		// Reference-identical rows: the slice selects from the ordering pass and
		// rewrites nothing, which is what the section's `pageRows` memo is keyed
		// on — a copy per page would re-enrich twenty rows on every page turn.
		for (const row of slice.rows) {
			assert.ok(
				orderedRoots.includes(row),
				"a page must hand back the ordered pass's own row objects",
			);
		}
	}
	// The last page of the filtered set holds the remainder, and no page beyond
	// it exists.
	assert.equal(sessionPage(orderedRoots, 1).rows.length, 10);
	assert.equal(sessionPage(orderedRoots, 1).pageCount, 2);
	assert.equal(sessionPage(orderedRoots, 5).rows.length, 10);
	// A sort over the narrowed set keeps every row exactly once, too.
	const all = sortSessionIndex(
		narrowSessionIndex(both, "", { topLevelOnly: false }),
		"session",
		"asc",
	);
	assert.equal(new Set(ids(all)).size, 60);
});

/* --------------------------------------------------------------- extras */
test("the sort key a header reports is a key this model knows", () => {
	assert.equal(asSessionSortKey("cost"), "cost");
	assert.equal(
		asSessionSortKey("lastSeen"),
		null,
		"an unknown key is not a sort",
	);
	// The effective order follows the panel's metric until a column is clicked,
	// and the panel ranks largest-first in both metrics.
	for (const [metric, key] of [
		["tokens", "tokens"],
		["spend", "cost"],
	]) {
		assert.equal(effectiveSortKey(INITIAL_SESSION_TABLE_STATE, metric), key);
		assert.equal(effectiveSortDirection(INITIAL_SESSION_TABLE_STATE), "desc");
	}
	// An explicit column survives a metric change — the reader's order is theirs.
	const explicit = {
		...INITIAL_SESSION_TABLE_STATE,
		sort: { key: "session", direction: "asc" },
	};
	assert.equal(effectiveSortKey(explicit, "spend"), "session");
	assert.equal(effectiveSortDirection(explicit), "asc");
	// And "is anything narrowing the table" is what the strip's presence and the
	// match line both key off.
	assert.equal(isNarrowed(INITIAL_SESSION_TABLE_STATE), false);
	assert.equal(
		isNarrowed({ ...INITIAL_SESSION_TABLE_STATE, query: "  " }),
		false,
	);
	assert.equal(
		isNarrowed({ ...INITIAL_SESSION_TABLE_STATE, query: "x" }),
		true,
	);
	assert.equal(
		isNarrowed({
			...INITIAL_SESSION_TABLE_STATE,
			filters: { topLevelOnly: true },
		}),
		true,
	);
});

/* --------------------------------------------------------------- extras */
test("the window-change reset is a derivation, and it is pinned", () => {
	/*
	 * §4.3's three triggers, which are the one documented rule that used to
	 * rest on a template literal inside the section — a key that had quietly
	 * lost a term while the table stayed CORRECT, just at a stale page. §12.3
	 * names that as the silent class, so it is asserted here rather than
	 * described: each field on its own moves the key, and a key that omits one
	 * of them fails on that field's own case.
	 */
	const base = sessionTableScopeKey({
		metric: "tokens",
		windowDays: 7,
		thisSessionOnly: false,
	});
	assert.equal(
		sessionTableScopeKey({
			metric: "tokens",
			windowDays: 7,
			thisSessionOnly: false,
		}),
		base,
		"the same window is the same key",
	);
	assert.notEqual(
		sessionTableScopeKey({
			metric: "spend",
			windowDays: 7,
			thisSessionOnly: false,
		}),
		base,
		"the metric is in the key",
	);
	assert.notEqual(
		sessionTableScopeKey({
			metric: "tokens",
			windowDays: 30,
			thisSessionOnly: false,
		}),
		base,
		"the window is in the key",
	);
	assert.notEqual(
		sessionTableScopeKey({
			metric: "tokens",
			windowDays: 7,
			thisSessionOnly: true,
		}),
		base,
		"the scope is in the key",
	);
	/*
	 * And what is NOT in it, which is the other half of the rule: the key reads
	 * three props, so a refetch — a new payload object, a `refreshing` flip —
	 * cannot move it however much else about the props changed. The extras are
	 * spread in through a cast because passing them is exactly the mistake a
	 * future caller would make.
	 */
	assert.equal(
		sessionTableScopeKey({
			metric: "tokens",
			windowDays: 7,
			thisSessionOnly: false,
			// Spread in as the extra PROPS a section render carries, which is
			// exactly the mistake a future caller would make.
			data: { aggregate: {}, daily: [] },
			refreshing: true,
			loading: false,
		}),
		base,
		"a refetch is new data over the same window, and the key cannot see it",
	);

	/*
	 * The reducer's side of it. The first key is ADOPTED rather than reset
	 * against — on mount there is no earlier window for a page to be stale
	 * against — a later key change resets the page and nothing else, and the
	 * window already in force returns the SAME object so React bails out.
	 */
	const mounted = sessionTableReducer(INITIAL_SESSION_TABLE_STATE, {
		type: "scope",
		key: base,
	});
	assert.deepEqual(mounted, { ...INITIAL_SESSION_TABLE_STATE, scope: base });
	assert.equal(mounted.page, 0, "adopting the first key does not reset");
	assert.equal(
		sessionTableReducer(mounted, { type: "scope", key: base }),
		mounted,
		"the same window returns the same state object",
	);
	const late = { ...mounted, page: 6, query: "status", sort: null };
	const moved = sessionTableReducer(late, {
		type: "scope",
		key: sessionTableScopeKey({
			metric: "spend",
			windowDays: 7,
			thisSessionOnly: false,
		}),
	});
	assert.equal(moved.page, 0);
	assert.equal(
		moved.query,
		"status",
		"the reader's narrowing survives the move",
	);
});

/* ----------------------------------------------------------------- 11 */
test("the first press on the ranking column flips the order that column advertises", () => {
	/*
	 * UX round 2, U5. The first state every reader meets ranks by the panel's
	 * metric, so the metric's own header draws itself active-descending while
	 * `state.sort` is still `null` - "follow the metric". A press on that column
	 * therefore has to flip against the order the reader can SEE. Without the
	 * seed it re-derived the order already on screen: nothing moved, nothing was
	 * announced (the round measured 0 differing pixels between the pre- and
	 * post-click header frames), and the press had silently taken ownership, so a
	 * later `Spend` press stopped re-ranking.
	 */
	const ranking = { key: "tokens", direction: "desc" };
	const pressed = sessionTableReducer(INITIAL_SESSION_TABLE_STATE, {
		type: "sort",
		key: "tokens",
		ranking,
	});
	assert.deepEqual(pressed.sort, { key: "tokens", direction: "asc" });
	assert.equal(pressed.page, 0, "and the press returns the reader to page one");
	// A column that is NOT ranking the table still opens in its own first
	// direction: the seed is what the press is measured against, not a policy.
	assert.deepEqual(
		sessionTableReducer(INITIAL_SESSION_TABLE_STATE, {
			type: "sort",
			key: "cost",
			ranking,
		}).sort,
		{ key: "cost", direction: "desc" },
	);
	/*
	 * And taking ownership is what a metric change now respects - the reason this
	 * is a seed on the action rather than `state.sort` initialised to a column,
	 * which would have cost the re-ranking the `null` state exists for.
	 */
	assert.equal(effectiveSortKey(pressed, "spend"), "tokens");
	assert.equal(
		effectiveSortKey(INITIAL_SESSION_TABLE_STATE, "spend"),
		"cost",
		"with no press the metric still re-ranks the table",
	);
	// The second press flips the reader's OWN order whatever seed arrives with
	// it: an explicit sort is consulted first.
	assert.deepEqual(
		sessionTableReducer(pressed, {
			type: "sort",
			key: "tokens",
			ranking: { key: "tokens", direction: "desc" },
		}).sort,
		{ key: "tokens", direction: "desc" },
	);
});
