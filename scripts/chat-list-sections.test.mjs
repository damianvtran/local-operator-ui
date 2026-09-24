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
const row = (extra) => ({ session_id: "s", title: "t", ...extra });
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
		sectionOf(row({ ...BUSY, updated_at: (NOW - 30 * DAY) / 1000 }), NOW),
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
	assert.equal(sectionOf(row(at(yesterdayLate)), NOW), "week");
	assert.equal(sectionOf(row(at(NOW - HOUR)), NOW), "today");
	// The boundary itself belongs to the day that has started.
	const midnight = new Date(2026, 8, 24, 0, 0, 0).getTime();
	assert.equal(sectionOf(row(at(midnight)), NOW), "today");
	assert.equal(sectionOf(row(at(midnight - 1)), NOW), "week");
});

test("THIS WEEK reaches back six more days, and no further", () => {
	assert.equal(sectionOf(row(at(NOW - 6 * DAY)), NOW), "week");
	assert.equal(sectionOf(row(at(NOW - 7 * DAY)), NOW), "older");
	assert.equal(sectionOf(row(at(NOW - 400 * DAY)), NOW), "older");
});

test("a row with no time at all is OLDER, never 1970", () => {
	/*
	 * `updated_at` is the wire's `mtime` (seconds). A row that arrived without one
	 * has NO time, and reading it as zero would both file it at the bottom with a
	 * date on it and print `56y` beside it.
	 */
	for (const value of [undefined, null, Number.NaN, "1758668400"]) {
		assert.equal(rowTimeMs(row({ updated_at: value })), null);
		assert.equal(sectionOf(row({ updated_at: value }), NOW), "older");
		assert.equal(relativeTime(row({ updated_at: value }), NOW), "");
		assert.equal(relativeTimeSentence(row({ updated_at: value }), NOW), "");
	}
});

test("the wire's seconds are read as seconds", () => {
	// A factor-of-1000 error here puts every row in 1970 and is invisible in a
	// frame whose fixture times are all in one day.
	assert.equal(rowTimeMs({ updated_at: 1_758_668_400 }), 1_758_668_400_000);
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
			relativeTime(row(at(NOW - age)), NOW),
			expected,
			`${age}ms before now`,
		);
	}
	// A clock skewed ahead of the backend's is not a negative number.
	assert.equal(relativeTime(row(at(NOW + 5 * HOUR)), NOW), "now");
});

test("the long form is a sentence, for the accessible name and the flyout", () => {
	assert.equal(
		relativeTimeSentence(row(at(NOW - 2 * HOUR)), NOW),
		"2 hours ago",
	);
	assert.equal(relativeTimeSentence(row(at(NOW - HOUR)), NOW), "1 hour ago");
	assert.equal(relativeTimeSentence(row(at(NOW - 2 * DAY)), NOW), "2 days ago");
	assert.equal(relativeTimeSentence(row(at(NOW)), NOW), "just now");
});

test("the partition keeps the catalogue's order and loses no row", () => {
	const rows = [
		row({ session_id: "a", ...at(NOW - 2 * DAY) }),
		row({ session_id: "b", ...BUSY, ...at(NOW - 100 * DAY) }),
		row({ session_id: "c", ...at(NOW - HOUR) }),
		row({ session_id: "d", ...at(NOW - 40 * DAY) }),
		row({ session_id: "e", ...at(NOW - 3 * DAY) }),
	];
	const parts = sectionRows(rows, NOW);
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
		"the catalogue's own order survives inside a section",
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
	assert.match(
		sidebar,
		/CHAT_LIST_SECTIONS\.map\(/,
		"the sidebar must render its sections from the shipped list",
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
		/!isRunningRow\(row\) && relativeTime\(row, listNow\)/,
		"a running row's time is `now`, which the spinner already says",
	);
	/*
	 * The accessible name keeps the time as its tail and the visible `2h` stays
	 * out of it, the shape `ChatSessionStatus` uses for its own `, unread`.
	 */
	assert.match(
		sidebar,
		/, \{relativeTimeSentence\(row, listNow\)\}/,
		"the row's accessible name no longer says how long ago it moved",
	);
});
