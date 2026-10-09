/**
 * The one chat list's sections and their relative times, executable.
 *
 *     node --test scripts/chat-list-sections.test.mjs
 *
 * The rules live in `chat-list-sections.ts` rather than in the sidebar's JSX for
 * the reason this repository states everywhere (`sidebar-catalogue-gate.ts`
 * carries it in full): a decision written as a JSX condition is a decision no
 * test in this suite can reach, because the sidebar reads the router, the
 * canonical-sessions store and the capability hooks and this repository's
 * desktop suite is `node:test` over `scripts/*.test.mjs` with no DOM harness.
 *
 * WHAT THIS FILE IS GUARDING, in the design round's own terms (D1): the list was
 * the backend's `active`/`previous` partition under an `All chats` toggle, with
 * no time anywhere and the running chat drawn as the LAST row of `Active chats`.
 * §C1 replaces it with sections a reader asks of it - RUNNING, TODAY, THIS WEEK,
 * OLDER - and a right-aligned relative time per row.
 *
 * AND THE TIME BASIS (2026-09-28). The sections and the labels read ONE clock
 * chosen by the view: `active` (the transcript's activity time, the default) or
 * `created` (the conversation's birth). Every assertion below that pins a bin or
 * a label names its basis, because the two can disagree - the disagreement is the
 * feature the operator asked for - and a test that left the basis implicit could
 * not say which half it checked.
 *
 * WHAT IT CANNOT SAY: that the column LOOKS right. The section headings, the
 * times' column and the list's spacing are pixels, and the pixels are the rig's
 * job (the `l-sidebar` states in the after set, and the geometry assertions
 * beside them).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-list-sections";',
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
	CHAT_LIST_SECTIONS,
	CHAT_LIST_SECTION_LABEL,
	isRunningRow,
	relativeTime,
	relativeTimeSentence,
	rowTimeMs,
	sectionRows,
	sectionOf,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const sidebar = readFileSync(join(ROOT, SIDEBAR), "utf8");

/*
 * A fixed "now": 2026-09-24 at 15:00 LOCAL. Local rather than UTC because the
 * TODAY boundary is a local-calendar one - "today" is the word on screen - and a
 * test pinned to a UTC instant would pass in one timezone and fail in another.
 */
const NOW = new Date(2026, 8, 24, 15, 0, 0).getTime();
const at = (ms) => ({ updated_at: ms / 1000 });
/** The other clock: when the conversation was born, as the wire carries it. */
const born = (ms) => ({ created_at: ms / 1000 });
const row = (extra) => ({ session_id: "s", title: "t", ...extra });
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The two bases, named where a call is about one of them. */
const ACTIVE = "active";
const CREATED = "created";

/** A row the reader must act on, whatever its last write was. */
const BUSY = { status: { code: "busy", label: "Working" } };

test("the sections are the four §C1 names, in the order they are drawn", () => {
	assert.deepEqual(CHAT_LIST_SECTIONS, ["running", "today", "week", "older"]);
	assert.deepEqual(
		CHAT_LIST_SECTIONS.map((key) => CHAT_LIST_SECTION_LABEL[key]),
		["Running", "Today", "This week", "Older"],
	);
});

test("a running row is RUNNING wherever its last write sorted it", () => {
	/*
	 * The D1 measurement, as a rule: the one chat actually working was drawn as
	 * the LAST row of `Active chats`, because the backend orders that section by
	 * its own status precedence and the client had no section for "working".
	 */
	assert.equal(
		sectionOf(
			row({ ...BUSY, updated_at: (NOW - 30 * DAY) / 1000 }),
			NOW,
			ACTIVE,
		),
		"running",
		"age must not demote a running row - it would sink to OLDER",
	);
	// A turn waiting on the READER is running: it is the one thing to act on.
	for (const code of ["busy", "delegating", "approval", "answer", "wedged"]) {
		assert.equal(isRunningRow(row({ status: { code, label: code } })), true);
	}
	// Completion is not liveness: the AFTER frames held ten `complete` rows in
	// `Active chats`, and none of them was working.
	for (const code of ["complete", "idle", "recent", undefined]) {
		assert.equal(isRunningRow(row({ status: { code, label: "" } })), false);
	}
});

test("TODAY is the local calendar day, not a rolling 24 hours", () => {
	// 11pm yesterday is not today at 9am, whatever the arithmetic says.
	const yesterdayLate = new Date(2026, 8, 23, 23, 0, 0).getTime();
	assert.equal(sectionOf(row(at(yesterdayLate)), NOW, ACTIVE), "week");
	assert.equal(sectionOf(row(at(NOW - HOUR)), NOW, ACTIVE), "today");
	// The boundary itself belongs to the day that has started.
	const midnight = new Date(2026, 8, 24, 0, 0, 0).getTime();
	assert.equal(sectionOf(row(at(midnight)), NOW, ACTIVE), "today");
	assert.equal(sectionOf(row(at(midnight - 1)), NOW, ACTIVE), "week");
});

test("THIS WEEK reaches back six more days, and no further", () => {
	assert.equal(sectionOf(row(at(NOW - 6 * DAY)), NOW, ACTIVE), "week");
	assert.equal(sectionOf(row(at(NOW - 7 * DAY)), NOW, ACTIVE), "older");
	assert.equal(sectionOf(row(at(NOW - 400 * DAY)), NOW, ACTIVE), "older");
});

test("the Created basis keeps every boundary rule, read at birth", () => {
	/*
	 * The calendar rule is the BASIS's input rather than a second rule: `sectionOf`
	 * does not know which clock it read. These cases pin that the Created basis is
	 * the same arithmetic on `created_at` - today's midnight still belongs to
	 * today, six days back is still the week, seven is still out.
	 */
	const midnight = new Date(2026, 8, 24, 0, 0, 0).getTime();
	assert.equal(sectionOf(row(born(NOW - HOUR)), NOW, CREATED), "today");
	assert.equal(sectionOf(row(born(midnight - 1)), NOW, CREATED), "week");
	assert.equal(sectionOf(row(born(NOW - 6 * DAY)), NOW, CREATED), "week");
	assert.equal(sectionOf(row(born(NOW - 7 * DAY)), NOW, CREATED), "older");
	// And RUNNING is a status partition, not the basis's to move.
	assert.equal(
		sectionOf(row({ ...BUSY, ...born(NOW - 400 * DAY) }), NOW, CREATED),
		"running",
	);
});

test("the two bases can file one row differently, and the label follows the basis", () => {
	/*
	 * The fixture the operator's report is made of: a conversation created 40 days
	 * ago and asked something an hour ago. Under the default basis it is TODAY "1h";
	 * under Created it is OLDER "5w". Both are right - the basis is the reader's
	 * choice - and the label must never disagree with the bin it sits under, which
	 * is why both read `rowTimeMs` with the same basis.
	 */
	const moved = row({
		session_id: "moved",
		...born(NOW - 40 * DAY),
		...at(NOW - HOUR),
	});
	assert.equal(sectionOf(moved, NOW, ACTIVE), "today");
	assert.equal(sectionOf(moved, NOW, CREATED), "older");
	assert.equal(relativeTime(moved, NOW, ACTIVE), "1h");
	assert.equal(relativeTime(moved, NOW, CREATED), "5w");
	const parts = sectionRows([moved], NOW, CREATED);
	assert.deepEqual(
		parts.older.map((r) => r.session_id),
		["moved"],
	);
});

test("a row with no time at all is OLDER, never 1970", () => {
	/*
	 * `updated_at` is the wire's `mtime` (seconds). A row that arrived without one
	 * has NO time, and reading it as zero would both file it at the bottom with a
	 * date on it and print `56y` beside it.
	 */
	for (const value of [undefined, null, Number.NaN, "1758668400"]) {
		assert.equal(rowTimeMs(row({ updated_at: value }), ACTIVE), null);
		assert.equal(sectionOf(row({ updated_at: value }), NOW, ACTIVE), "older");
		assert.equal(relativeTime(row({ updated_at: value }), NOW, ACTIVE), "");
		assert.equal(
			relativeTimeSentence(row({ updated_at: value }), NOW, ACTIVE),
			"",
		);
	}
});

test("a Created row with no birth is OLDER with no label, and zero is not 1970", () => {
	/*
	 * The backend's `session_created_at` answers `0.0` when the directory cannot be
	 * read, so zero is a documented "unknown" rather than an instant; a row that
	 * carried it as a date would print `56y` and file itself among the oldest
	 * conversations. Absent and invalid values share the answer.
	 */
	for (const value of [undefined, null, Number.NaN, "1758668400", 0, -5]) {
		assert.equal(rowTimeMs(row({ created_at: value }), CREATED), null);
		assert.equal(sectionOf(row({ created_at: value }), NOW, CREATED), "older");
		assert.equal(relativeTime(row({ created_at: value }), NOW, CREATED), "");
		assert.equal(
			relativeTimeSentence(row({ created_at: value }), NOW, CREATED),
			"",
		);
	}
	// The two clocks are independent: a refused birth leaves the ACTIVE basis alone.
	assert.equal(
		sectionOf(
			row({ created_at: 0, updated_at: (NOW - HOUR) / 1000 }),
			NOW,
			ACTIVE,
		),
		"today",
	);
});

test("the wire's seconds are read as seconds", () => {
	// A factor-of-1000 error here puts every row in 1970 and is invisible in a
	// frame whose fixture times are all in one day.
	assert.equal(
		rowTimeMs({ updated_at: 1_758_668_400 }, ACTIVE),
		1_758_668_400_000,
	);
	assert.equal(
		rowTimeMs({ created_at: 1_758_668_400 }, CREATED),
		1_758_668_400_000,
	);
});

test("the relative time is terse, and tops out at years", () => {
	const cases = [
		[0, "now"],
		[30 * 1000, "now"],
		[60 * 1000, "1m"],
		[59 * 60 * 1000, "59m"],
		[HOUR, "1h"],
		[23 * HOUR, "23h"],
		[DAY, "1d"],
		[6 * DAY, "6d"],
		[7 * DAY, "1w"],
		[364 * DAY, "52w"],
		[365 * DAY, "1y"],
	];
	for (const [age, expected] of cases) {
		assert.equal(
			relativeTime(row(at(NOW - age)), NOW, ACTIVE),
			expected,
			`${age}ms before now`,
		);
	}
	// A clock skewed ahead of the backend's is not a negative number.
	assert.equal(relativeTime(row(at(NOW + 5 * HOUR)), NOW, ACTIVE), "now");
});

test("the long form is a sentence, and it NAMES the basis it read", () => {
	/*
	 * The visible label is terse (`1h`) and cannot say which clock it read, so the
	 * sentence - the accessible name's tail and the flyout's - says it in words.
	 * A swapped basis changes what the number MEANS; a reader who hears only
	 * "3 weeks ago" would be guessing.
	 */
	assert.equal(
		relativeTimeSentence(row(at(NOW - 2 * HOUR)), NOW, ACTIVE),
		"last active 2 hours ago",
	);
	assert.equal(
		relativeTimeSentence(row(at(NOW - HOUR)), NOW, ACTIVE),
		"last active 1 hour ago",
	);
	assert.equal(
		relativeTimeSentence(row(at(NOW - 2 * DAY)), NOW, ACTIVE),
		"last active 2 days ago",
	);
	assert.equal(
		relativeTimeSentence(row(at(NOW)), NOW, ACTIVE),
		"last active just now",
	);
	assert.equal(
		relativeTimeSentence(row(born(NOW - 3 * 7 * DAY)), NOW, CREATED),
		"created 3 weeks ago",
	);
	assert.equal(
		relativeTimeSentence(row(born(NOW)), NOW, CREATED),
		"created just now",
	);
});

test("the partition keeps the order it is GIVEN and loses no row", () => {
	const rows = [
		row({ session_id: "a", ...at(NOW - 2 * DAY) }),
		row({ session_id: "b", ...BUSY, ...at(NOW - 100 * DAY) }),
		row({ session_id: "c", ...at(NOW - HOUR) }),
		row({ session_id: "d", ...at(NOW - 40 * DAY) }),
		row({ session_id: "e", ...at(NOW - 3 * DAY) }),
	];
	const parts = sectionRows(rows, NOW, ACTIVE);
	assert.deepEqual(
		parts.running.map((r) => r.session_id),
		["b"],
		"the running row is the first section",
	);
	assert.deepEqual(
		parts.today.map((r) => r.session_id),
		["c"],
	);
	assert.deepEqual(
		parts.week.map((r) => r.session_id),
		["a", "e"],
		/*
		 * THE SEQUENCE INSIDE A SECTION IS THE CALLER'S (2026-10-08): this module is
		 * a `filter`, and the order a reader sees is `pageOrder`'s - sorted by the
		 * basis's clock - applied BEFORE this call. The assertion is that the
		 * partition preserves the order it is given byte for byte, which is the half
		 * that keeps the arrangement the single ordering authority.
		 */
		"the order the caller arranged survives the partition",
	);
	assert.deepEqual(
		parts.older.map((r) => r.session_id),
		["d"],
	);
	assert.equal(
		Object.values(parts).flat().length,
		rows.length,
		"every row lands in exactly one section",
	);
});

test("the sidebar draws those sections, and a label is not a control", () => {
	/*
	 * The wiring, pinned as source text: the section labels must not be buttons.
	 * U22's report was that clicking a header collapsed the list by accident, and
	 * a `Disclosure` row is what a later reader reaches for when a section wants a
	 * heading.
	 */
	/*
	 * THE SECTIONS ARE DRAWN IN THE READER'S ORDER since the view popover landed
	 * (2026-09-25), so the loop runs over `drawnSections` - which is
	 * `shownSections(view)` filtered to the chat sections, i.e. the shipped list
	 * with the reader's reorder and show/hide applied. The assertion is that the
	 * ARRANGEMENT still comes from the module rather than from a literal written
	 * into the JSX, so it accepts either loop head and refuses a third spelling: a
	 * hand-written `["running", "today", ...]` here would be the second copy this
	 * line exists to catch.
	 */
	assert.match(
		sidebar,
		/(drawnSections|CHAT_LIST_SECTIONS)\.map\(/,
		"the sidebar must render its sections from the shipped list",
	);
	assert.ok(
		sidebar.includes("shownSections(view).filter("),
		"the drawn order must come from the view module, not from a literal",
	);
	assert.match(
		sidebar,
		/CHAT_LIST_SECTION_LABEL\[/,
		"the labels come from the shipped table, not a second copy",
	);
	const label = sidebar.slice(
		sidebar.indexOf("const sectionLabel = ("),
		sidebar.indexOf("const keyDown = ("),
	);
	assert.ok(label.length > 0, "the section label helper is the anchor here");
	assert.doesNotMatch(
		label,
		/<button|<Button/,
		"a section label became a control again, so pressing a heading acts",
	);
	assert.match(
		label,
		/<h3/,
		"the label is a heading, which is what gives the list its structure",
	);
	// And the header action is a SIBLING of the label rather than nested in it.
	assert.match(
		sidebar,
		/key === firstSection \? markAllReadControl : undefined/,
		"the bulk read receipt moved off the first section's header",
	);
});

test("a row prints its relative time, and a running row does not", () => {
	assert.match(
		sidebar,
		/data-session-time/,
		"the row's time lost its hook, so nothing can assert it on screen",
	);
	assert.match(
		sidebar,
		/!isRunningRow\(row\) && relativeTime\(row, listNow, view\.basis\)/,
		"a running row's time is `now`, which the spinner already says",
	);
	/*
	 * The accessible name keeps the time as its tail and the visible `2h` stays
	 * out of it, the shape `ChatSessionStatus` uses for its own `, unread`.
	 */
	assert.match(
		sidebar,
		/, \{relativeTimeSentence\(row, listNow, view\.basis\)\}/,
		"the row's accessible name no longer says how long ago it moved",
	);
});

test("the basis is threaded from the view to the call sites, never defaulted", () => {
	/*
	 * The model refuses to pick a basis for a caller (the parameter is required),
	 * and this pins that the sidebar passes the READER's - a default written at a
	 * call site would make the control half-wired while every unit test above
	 * stayed green.
	 */
	assert.match(sidebar, /sectionRows\(pagedRows, listNow, view\.basis\)/);
	assert.match(sidebar, /view\.basis !== DEFAULT_SIDEBAR_VIEW\.basis/);
});
