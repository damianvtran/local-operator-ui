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
			'export * from "./src/renderer/src/features/chat/chat-list-sections"; export { withQueuedAskStatuses } from "./src/renderer/src/features/chat/components/chat-session-status";',
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
	// `chat-session-status.tsx` joins this bundle for the derivation test below, so
	// the build needs the app's JSX runtime and path aliases (its siblings read
	// the same tsconfig; the alias map above is what keeps this file standalone).
	jsx: "automatic",
	tsconfig: "tsconfig.app.json",
});

const {
	CHAT_LIST_SECTIONS,
	CHAT_LIST_SECTION_LABEL,
	isRunningRow,
	isStoppedOnReader,
	relativeTime,
	relativeTimeSentence,
	rowTimeMs,
	sectionRows,
	sectionOf,
	withQueuedAskStatuses,
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

test("the sections are the five names, in the order they are drawn", () => {
	assert.deepEqual(CHAT_LIST_SECTIONS, [
		"running",
		"today",
		"yesterday",
		"week",
		"older",
	]);
	/*
	 * THE TABLE HOLDS MESSAGE KEYS, not the four English words it used to. A
	 * module-scope sentence table cannot follow a language switch, so the
	 * wording now lives in the English catalogue and this file pins the KEYS -
	 * the heading and the view popover's section row share them, which is what
	 * `ui.chat.sidebar_view.section.*` names here.
	 */
	assert.deepEqual(
		CHAT_LIST_SECTIONS.map((key) => CHAT_LIST_SECTION_LABEL[key]),
		[
			"ui.chat.sidebar_view.section.running",
			"ui.chat.sidebar_view.section.today",
			"ui.chat.sidebar_view.section.yesterday",
			"ui.chat.sidebar_view.section.week",
			"ui.chat.sidebar_view.section.older",
		],
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
	assert.equal(sectionOf(row(at(yesterdayLate)), NOW, ACTIVE), "yesterday");
	assert.equal(sectionOf(row(at(NOW - HOUR)), NOW, ACTIVE), "today");
	// The boundary itself belongs to the day that has started.
	const midnight = new Date(2026, 8, 24, 0, 0, 0).getTime();
	assert.equal(sectionOf(row(at(midnight)), NOW, ACTIVE), "today");
	assert.equal(sectionOf(row(at(midnight - 1)), NOW, ACTIVE), "yesterday");
});

test("YESTERDAY is the calendar day before today, and WEEK starts at its midnight", () => {
	const yesterdayStart = new Date(2026, 8, 23, 0, 0, 0).getTime();
	// Both ends of yesterday: the first millisecond and the last.
	assert.equal(sectionOf(row(at(yesterdayStart)), NOW, ACTIVE), "yesterday");
	assert.equal(
		sectionOf(
			row(at(new Date(2026, 8, 23, 23, 59, 59, 999).getTime())),
			NOW,
			ACTIVE,
		),
		"yesterday",
	);
	// One millisecond earlier is the day before, which is the WEEK's outer edge.
	assert.equal(sectionOf(row(at(yesterdayStart - 1)), NOW, ACTIVE), "week");
	/*
	 * THAT BOTH CUTS ARE THE READER'S LOCAL CALENDAR STARTS, not UTC midnights and
	 * not a fixed wall-clock time, is what the transition tests below hold to
	 * account in zones whose offset moves - a `getHours() === 0` check here would
	 * only restate the constants this test built the boundaries with (round 1, M4).
	 */
	// The bins keep their order, and `sectionRows` draws every one of them.
	assert.deepEqual(Object.keys(sectionRows([], NOW, ACTIVE)), [
		"running",
		"today",
		"yesterday",
		"week",
		"older",
	]);
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
	assert.equal(sectionOf(row(born(midnight - 1)), NOW, CREATED), "yesterday");
	assert.equal(
		sectionOf(
			row(born(new Date(2026, 8, 23, 0, 0, 0).getTime() - 1)),
			NOW,
			CREATED,
		),
		"week",
	);
	assert.equal(sectionOf(row(born(NOW - 6 * DAY)), NOW, CREATED), "week");
	assert.equal(sectionOf(row(born(NOW - 7 * DAY)), NOW, CREATED), "older");
	// And RUNNING is a status partition, not the basis's to move.
	assert.equal(
		sectionOf(row({ ...BUSY, ...born(NOW - 400 * DAY) }), NOW, CREATED),
		"running",
	);
});

test("the sections keep their order and the running rule still wins over yesterday", () => {
	const yesterdayMidday = new Date(2026, 8, 23, 12, 0, 0).getTime();
	// A running conversation does not file under the day it last moved.
	assert.equal(
		sectionOf(row({ ...BUSY, ...at(yesterdayMidday) }), NOW, ACTIVE),
		"running",
	);
	// One row per bin, so the record's own shape states the order.
	const rows = [
		row({ session_id: "run", ...BUSY, ...at(NOW) }),
		row({ session_id: "today", ...at(NOW - HOUR) }),
		row({ session_id: "yesterday", ...at(yesterdayMidday) }),
		row({ session_id: "week", ...at(yesterdayMidday - 3 * DAY) }),
		row({ session_id: "older", ...at(yesterdayMidday - 30 * DAY) }),
	];
	const sectioned = sectionRows(rows, NOW, ACTIVE);
	assert.deepEqual(
		CHAT_LIST_SECTIONS.map((key) => [
			key,
			sectioned[key].map((entry) => entry.session_id),
		]),
		[
			["running", ["run"]],
			["today", ["today"]],
			["yesterday", ["yesterday"]],
			["week", ["week"]],
			["older", ["older"]],
		],
	);
});

/*
 * THE TRANSITION TEST, and why it has to set the zone itself. The boundaries are
 * LOCAL midnights, so a fixed instant proves nothing about them unless the zone
 * around it is known. Each block moves `process.env.TZ` to a zone whose clock
 * jumps on a specific date, puts "now" on the day after it, and reads rows on
 * both sides of the jump - including one 30 minutes after midnight on the outer
 * boundary's day, which the 6 x 24h arithmetic this replaced filed an hour (or
 * half an hour) into OLDER.
 */
test("the week boundary is a local midnight across a daylight-saving change", () => {
	const original = process.env.TZ;
	const atLocal = (year, month, day, hour, minute) =>
		new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
	const bin = (instant, now) => sectionOf(row(at(instant)), now, ACTIVE);
	try {
		/* New York, 2026-03-08 02:00: that day is 23 hours long, so the clock the
		 * test reads is a spring-forward one. now = 2026-03-09 10:00 local, and the
		 * old `today - 6 x 24h` cut landed at 2026-03-02 23:00 (an hour EARLY in
		 * wall-clock terms), which is the half hour this test pins. */
		process.env.TZ = "America/New_York";
		const spring = atLocal(2026, 3, 9, 10, 0);
		assert.equal(bin(atLocal(2026, 3, 8, 0, 1), spring), "yesterday");
		assert.equal(bin(atLocal(2026, 3, 8, 23, 59), spring), "yesterday");
		assert.equal(bin(atLocal(2026, 3, 7, 23, 59), spring), "week");
		assert.equal(bin(atLocal(2026, 3, 3, 0, 0), spring), "week");
		assert.equal(
			bin(atLocal(2026, 3, 2, 23, 30), spring),
			"older",
			"the 6x24h cut landed at 23:00 the evening before, so this half hour was drawn as WEEK",
		);

		/* New York, 2026-11-01 02:00: the day repeats an hour (25 hours long).
		 * now = 2026-11-02 10:00 local, and the old `today - 6 x 24h` cut landed at
		 * 2026-10-27 01:00 - an hour LATE - which swallowed the half hour below. */
		const fall = atLocal(2026, 11, 2, 10, 0);
		assert.equal(bin(atLocal(2026, 11, 1, 0, 1), fall), "yesterday");
		assert.equal(bin(atLocal(2026, 11, 1, 23, 59), fall), "yesterday");
		assert.equal(bin(atLocal(2026, 10, 31, 23, 59), fall), "week");
		assert.equal(
			bin(atLocal(2026, 10, 27, 0, 30), fall),
			"week",
			"the 6x24h cut landed at 01:00, so this half hour filed as OLDER",
		);
		assert.equal(bin(atLocal(2026, 10, 26, 23, 59), fall), "older");

		/* Lord Howe Island, 2026-10-04 02:00: a THIRTY minute jump, the shape a
		 * whole-hour fix would still get wrong. now = 2026-10-05 10:00 local, and
		 * the old `today - 6 x 24h` cut landed at 2026-09-28 23:30. */
		process.env.TZ = "Australia/Lord_Howe";
		const lordHowe = atLocal(2026, 10, 5, 10, 0);
		assert.equal(bin(atLocal(2026, 10, 4, 0, 1), lordHowe), "yesterday");
		assert.equal(bin(atLocal(2026, 10, 3, 23, 59), lordHowe), "week");
		assert.equal(bin(atLocal(2026, 9, 29, 0, 0), lordHowe), "week");
		assert.equal(
			bin(atLocal(2026, 9, 28, 23, 45), lordHowe),
			"older",
			"the 6x24h cut landed at 23:30 in a half-hour zone, so a quarter hour of the week was drawn as WEEK",
		);
	} finally {
		process.env.TZ = original;
	}
});

/*
 * THE MIDNIGHT GAP (round 1, M2), the shape the transition blocks above miss
 * because their zones jump at 02:00 or 02:30. A zone can spring forward AT
 * midnight, so the day itself has no 00:00: America/Santiago goes 23:59:59 ->
 * 01:00 on 2026-09-06 (Havana and Asunción share the shape). What the cut must
 * be is the FIRST instant of each calendar day - 01:00 on the gap day itself,
 * because no instant of that day precedes it - and that gap day is no reason to
 * cut its neighbours an hour late, which is what a time of day carried across
 * the day arithmetic did.
 */
test("a midnight DST gap moves only its own day's cut, never the days around it", () => {
	const original = process.env.TZ;
	const atLocal = (year, month, day, hour, minute) =>
		new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
	const bin = (instant, now) => sectionOf(row(at(instant)), now, ACTIVE);
	try {
		process.env.TZ = "America/Santiago";
		/* The gap is the environment's fact to state before the bins are read: on
		 * Sep 6, 00:00 and 01:00 name ONE instant, so 01:00 is the day's first. */
		assert.equal(
			new Date(2026, 8, 6, 0, 0, 0, 0).getTime(),
			new Date(2026, 8, 6, 1, 0, 0, 0).getTime(),
			"this zone's 2026-09-06 has no 00:00, which is the case being pinned",
		);
		const now = atLocal(2026, 9, 6, 10, 0);
		// Sep 6 begins at 01:00, and everything from that instant is TODAY.
		assert.equal(bin(new Date(2026, 8, 6, 1, 0, 0, 0).getTime(), now), "today");
		assert.equal(
			bin(new Date(2026, 8, 6, 1, 0, 0, 0).getTime() - 1, now),
			"yesterday",
		);
		/* Yesterday cuts at SEP 5's OWN midnight, 00:00. The carried 01:00 filed this
		 * hour under WEEK (measured on the old `setHours` + `setDate` body). */
		assert.equal(bin(atLocal(2026, 9, 5, 0, 0), now), "yesterday");
		assert.equal(
			bin(atLocal(2026, 9, 5, 0, 30), now),
			"yesterday",
			"the inherited 01:00 cut filed this half hour as WEEK",
		);
		assert.equal(bin(atLocal(2026, 9, 5, 23, 59), now), "yesterday");
		assert.equal(bin(atLocal(2026, 9, 4, 23, 59), now), "week");
		// And the week's outer edge is six midnights back, Aug 31's own 00:00.
		assert.equal(bin(atLocal(2026, 8, 31, 0, 0), now), "week");
		assert.equal(bin(atLocal(2026, 8, 31, 0, 0) - 1, now), "older");
	} finally {
		process.env.TZ = original;
	}
});

test("WEEK's outer edge is the sixth midnight back, not six 24-hour steps", () => {
	/*
	 * THE DEFECT ON ITS OWN, without the Yesterday bin in the picture: the cut this
	 * replaced was `startOfDay(now) - 6 * 24h`, so a row one half hour either side
	 * of the true boundary filed under the wrong heading for one hour a year. Both
	 * cases below FAIL against that arithmetic - the week was an hour long on the
	 * spring side and an hour short on the autumn one - and pass on calendar days.
	 */
	const original = process.env.TZ;
	const atLocal = (year, month, day, hour, minute) =>
		new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
	try {
		process.env.TZ = "America/New_York";
		// 2026-03-08 springs forward: six 24h steps start at 2026-03-02 23:00.
		assert.equal(
			sectionOf(
				row(at(atLocal(2026, 3, 2, 23, 30))),
				atLocal(2026, 3, 9, 10, 0),
				ACTIVE,
			),
			"older",
		);
		// 2026-11-01 falls back: six 24h steps start at 2026-10-27 01:00.
		assert.equal(
			sectionOf(
				row(at(atLocal(2026, 10, 27, 0, 30))),
				atLocal(2026, 11, 2, 10, 0),
				ACTIVE,
			),
			"week",
		);
	} finally {
		process.env.TZ = original;
	}
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
	/*
	 * EMPTY SECTIONS CONTRIBUTE NO LABEL, the rule Pinned already followed, and
	 * Yesterday joins it without a branch of its own: the guard is one generic
	 * test over `rows`, so a section that draws nothing is skipped by the same
	 * line every other section is. A clauseful `key === "yesterday"` here would
	 * be the second rule this pin refuses.
	 */
	assert.match(
		sidebar,
		/if \(rows\.length === 0\) return null;/,
		"an empty section no longer skips itself",
	);
	assert.doesNotMatch(
		sidebar,
		/key === "yesterday"/,
		"Yesterday must not need handling of its own",
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
		/!isRunningRow\(row\)\s*&&\s*relativeTime\(row, listNow, view\.basis\)/,
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

test("waiting is Running even when the conversation last moved long ago", () => {
	const waiting = row({
		updated_at: (NOW - 30 * DAY) / 1000,
		status: {
			code: "waiting",
			label: "Waiting on 2 jobs · 1 subagent running",
		},
	});
	assert.equal(isRunningRow(waiting), true);
	assert.equal(sectionOf(waiting, NOW, ACTIVE), "running");
});

/*
 * ---------------------------------------------------------------------------
 * ONE DERIVED ROW SPEAKS FOR BOTH THE MARK AND THE SECTION (2026-11-23)
 * ---------------------------------------------------------------------------
 *
 * The wire code for an open queued ask is `answer`, so an idle conversation
 * with one ask filed under RUNNING and was lifted as "stopped on the reader" -
 * while PR #2053 had already made it draw as a resting ring. The two disagreed
 * because the section read the wire row and the mark read a derived one; the
 * sidebar now derives the LIST first (`withQueuedAskStatuses`), and these cases
 * pin what that has to mean for the section and the lift.
 */
const QUEUED_ASK = { status: { code: "answer", label: "Answer needed" } };
const ASK_COUNT = new Map([["s", 1]]);

test("[M-section-idle-asks1] an idle conversation with a queued ask is not running and not stopped on the reader", () => {
	const [derived] = withQueuedAskStatuses(
		[row({ ...QUEUED_ASK, live_state: "idle", ...at(NOW - HOUR) })],
		ASK_COUNT,
	);
	assert.equal(isRunningRow(derived), false);
	assert.equal(sectionOf(derived, NOW, ACTIVE), "today");
});

test("[M-section-busy-asks1] a busy conversation with a queued ask stays Running, and is not stopped on the reader", () => {
	const [derived] = withQueuedAskStatuses(
		[row({ ...QUEUED_ASK, live_state: "busy", ...at(NOW - HOUR) })],
		ASK_COUNT,
	);
	assert.equal(isRunningRow(derived), true);
	assert.equal(sectionOf(derived, NOW, ACTIVE), "running");
});

test("[M-section-blocking] a blocking answer and an approval still file under Running", () => {
	const answer = row({ ...QUEUED_ASK, live_state: "idle" });
	// No count: a question gate with no queue row behind it, so the code stands.
	const [blocking] = withQueuedAskStatuses([answer], new Map());
	assert.equal(blocking, answer);
	assert.equal(isRunningRow(blocking), true);
	assert.equal(isStoppedOnReader(blocking), true);
	assert.equal(sectionOf(blocking, NOW, ACTIVE), "running");
	// An approval keeps its own code even with a queued ask beside it.
	const approval = row({
		status: { code: "approval", label: "Approval needed" },
		live_state: "idle",
	});
	const [gate] = withQueuedAskStatuses([approval], ASK_COUNT);
	assert.equal(gate.status.code, "approval");
	assert.equal(isRunningRow(gate), true);
	assert.equal(isStoppedOnReader(gate), true);
	assert.equal(sectionOf(gate, NOW, ACTIVE), "running");
});
