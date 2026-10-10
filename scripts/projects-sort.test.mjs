import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Projects tab's sort model, executed in Node (the `projects-tab.test.mjs`
 * pattern: the REAL module bundled, nothing re-implemented).
 *
 * THE TWO CLAIMS THIS FILE REPLACES PROSE WITH:
 *
 *   1. "Nulls always last, both directions" — asserted per key, per direction,
 *      because the cheap implementation (negating an ascending comparator)
 *      silently flips the nulls to the front and nothing else notices.
 *   2. "Identity-stable" — the same input produces the identical order, and a
 *      permutation of the input produces the same order too: the total-order
 *      fallback is what makes the second half true, and a sort that keeps an
 *      unstable tie would fail it on a different V8 seed.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * as sort from "./src/renderer/src/features/projects/project-sort";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/* The projects model reached here reads the i18n locale layer
	 * (@shared/i18n), whose shim reaches src/i18n by relative path — only the
	 * @shared alias is needed (the `turn-timestamp.test.mjs` recipe). */
	alias: {
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const { sort } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const {
	DEFAULT_SORT_LABEL,
	PROJECTS_SORT_STORAGE_KEY,
	clearAllAnnouncement,
	compareProjects,
	firstSortDirection,
	isSortKey,
	readProjectsSort,
	sortAnnouncement,
	sortColumnLabel,
	sortDirectionWords,
	sortProjects,
	writeProjectsSort,
} = sort;

/** One listing row, with the fields a test does not care about. */
const project = (id, extra = {}) => ({
	id,
	name: id,
	description: "",
	owner: null,
	team: null,
	title: null,
	status: "active",
	tags: [],
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	milestones_completed: 0,
	milestones_total: 0,
	sessions: 0,
	live_sessions: 0,
	progress_stale: false,
	progress_updated_at: null,
	updated_at: 1_000,
	...extra,
});

const ids = (rows, spec) => sortProjects(rows, spec).map((row) => row.id);

/* --------------------------------------------------------------- storage -- */

test("the sort store is guarded, and anything unrecognised reads as no sort", () => {
	assert.equal(PROJECTS_SORT_STORAGE_KEY, "projects-sort");
	const original = globalThis.localStorage;
	const store = new Map();
	globalThis.localStorage = {
		getItem: (name) => store.get(name) ?? null,
		setItem: (name, value) => store.set(name, value),
		removeItem: (name) => store.delete(name),
	};
	try {
		assert.equal(readProjectsSort(), null);
		for (const [token, expected] of [
			["name:asc", { key: "name", direction: "asc" }],
			["target:desc", { key: "target", direction: "desc" }],
			["progress:asc", { key: "progress", direction: "asc" }],
		]) {
			store.set(PROJECTS_SORT_STORAGE_KEY, token);
			assert.deepEqual(readProjectsSort(), expected);
		}
		for (const junk of [
			"",
			"name",
			"name:up",
			"frobnicate:asc",
			"name:asc:extra",
			'{"key":"name"}',
		]) {
			store.set(PROJECTS_SORT_STORAGE_KEY, junk);
			assert.equal(readProjectsSort(), null);
		}
		/* A write lands the token shape; a null write REMOVES. */
		writeProjectsSort({ key: "estimate", direction: "desc" });
		assert.equal(store.get(PROJECTS_SORT_STORAGE_KEY), "estimate:desc");
		writeProjectsSort(null);
		assert.equal(store.has(PROJECTS_SORT_STORAGE_KEY), false);
		assert.ok(isSortKey("milestones"));
		assert.ok(!isSortKey("tags"));
	} finally {
		globalThis.localStorage = original;
	}
});

test("a locked store cannot fail the read or the write", () => {
	const original = globalThis.localStorage;
	globalThis.localStorage = {
		getItem: () => {
			throw new Error("locked");
		},
		setItem: () => {
			throw new Error("locked");
		},
		removeItem: () => {
			throw new Error("locked");
		},
	};
	try {
		assert.equal(readProjectsSort(), null);
		writeProjectsSort({ key: "name", direction: "asc" });
		writeProjectsSort(null);
	} finally {
		globalThis.localStorage = original;
	}
});

/* ------------------------------------------------------------------ copy -- */

test("the direction words, first directions and announcement copy are the design's", () => {
	assert.equal(DEFAULT_SORT_LABEL, "Default (as listed)");
	assert.equal(sortColumnLabel("name"), "Project");
	assert.equal(sortColumnLabel("progress"), "Progress");
	/* First activation: ascending for labels, DESCENDING for dates (the ux
	 * round's folded NIT, "(most recent first)"). */
	assert.equal(firstSortDirection("name"), "asc");
	assert.equal(firstSortDirection("status"), "asc");
	assert.equal(firstSortDirection("estimate"), "asc");
	assert.equal(firstSortDirection("milestones"), "asc");
	assert.equal(firstSortDirection("live"), "asc");
	assert.equal(firstSortDirection("target"), "desc");
	assert.equal(firstSortDirection("progress"), "desc");
	assert.equal(sortDirectionWords("name", "asc"), "A to Z");
	assert.equal(sortDirectionWords("name", "desc"), "Z to A");
	assert.equal(sortDirectionWords("target", "desc"), "latest first");
	assert.equal(sortDirectionWords("target", "asc"), "soonest first");
	assert.equal(sortDirectionWords("progress", "desc"), "most recent first");
	assert.equal(
		sortAnnouncement({ key: "estimate", direction: "asc" }),
		"Sorted by Estimate, points first.",
	);
	assert.equal(
		sortAnnouncement({ key: "target", direction: "desc" }),
		"Sorted by Target, latest first.",
	);
	assert.equal(sortAnnouncement(null), "Sort cleared.");
});

/*
 * U15/U16/U17's copy, pinned whole rather than sampled: the sentence names
 * exactly what was cleared, in the doors' own order - and CAPITALISED in
 * every branch (U17; the facet- and sort-led sentences used to read
 * `filters cleared.` / `sort cleared.` beside this file's `Sort cleared.`).
 * A branch that loses its capital, or a fragment that moves, fails here as a
 * string rather than as a screen-reader silence nobody can see.
 */
test("the clear-all announcement names what cleared, capitalised in every branch", () => {
	const clear = (search, filters, sort) =>
		clearAllAnnouncement({ search, filters, sort });
	assert.equal(clear(true, false, false), "Search cleared.");
	assert.equal(clear(false, true, false), "Filters cleared.");
	assert.equal(clear(false, false, true), "Sort cleared.");
	assert.equal(clear(false, true, true), "Filters and sort cleared.");
	assert.equal(clear(true, false, true), "Search and sort cleared.");
	assert.equal(clear(true, true, false), "Search and filters cleared.");
	assert.equal(clear(true, true, true), "Search, filters and sort cleared.");
	/* Nothing cleared announces nothing (the doors only offer Clear all when
	 * there is something to clear, but the composer is total). */
	assert.equal(clear(false, false, false), "");
});

/* ------------------------------------------------------------ comparators -- */

test("name sorts A to Z base-insensitively, nulls cannot exist", () => {
	const rows = [
		project("b", { name: "beta" }),
		project("a", { name: "Alpha" }),
		project("c", { name: "gamma" }),
	];
	assert.deepEqual(ids(rows, { key: "name", direction: "asc" }), [
		"a",
		"b",
		"c",
	]);
	assert.deepEqual(ids(rows, { key: "name", direction: "desc" }), [
		"c",
		"b",
		"a",
	]);
	/* The DISPLAY title is what sorts (the row's identity on screen). */
	const titled = [
		project("x", { name: "z-key", title: "aardvark" }),
		project("y", { name: "a-key", title: null }),
	];
	assert.deepEqual(ids(titled, { key: "name", direction: "asc" }), ["y", "x"]);
});

test("status sorts by the model's own order, unknown values last in BOTH directions", () => {
	const rows = [
		project("done", { status: "done" }),
		project("planning", { status: "planning" }),
		project("future", { status: "someday" }),
		project("archived", { status: "archived" }),
	];
	assert.deepEqual(ids(rows, { key: "status", direction: "asc" }), [
		"planning",
		"done",
		"archived",
		"future",
	]);
	assert.deepEqual(ids(rows, { key: "status", direction: "desc" }), [
		"archived",
		"done",
		"planning",
		"future",
	]);
});

test("target sorts by the cell's value (completed_at wins) with nulls last both ways", () => {
	const rows = [
		project("early", { target_date: "2026-09-01" }),
		project("late", { target_date: "2026-10-01" }),
		project("none-a", { updated_at: 900 }),
		project("none-b", { updated_at: 800 }),
		project("finished", {
			status: "done",
			completed_at: "2026-09-15",
			target_date: "2026-12-01",
		}),
	];
	assert.deepEqual(ids(rows, { key: "target", direction: "asc" }), [
		"early",
		"finished",
		"late",
		"none-a",
		"none-b",
	]);
	assert.deepEqual(ids(rows, { key: "target", direction: "desc" }), [
		"late",
		"finished",
		"early",
		"none-a",
		"none-b",
	]);
});

test("estimate sorts by (unit, value) — points then days — nulls last both ways", () => {
	const rows = [
		project("days-2", { estimate: 2, estimate_unit: "days" }),
		project("points-8", { estimate: 8, estimate_unit: "points" }),
		project("points-2", { estimate: 2, estimate_unit: "points" }),
		project("none", { estimate: null }),
	];
	assert.deepEqual(ids(rows, { key: "estimate", direction: "asc" }), [
		"points-2",
		"points-8",
		"days-2",
		"none",
	]);
	assert.deepEqual(ids(rows, { key: "estimate", direction: "desc" }), [
		"days-2",
		"points-8",
		"points-2",
		"none",
	]);
});

test("milestones sorts by ratio, not count — and 0/0 is last in both directions", () => {
	const rows = [
		project("full", { milestones_completed: 1, milestones_total: 1 }),
		project("half", { milestones_completed: 2, milestones_total: 4 }),
		project("overhalf", { milestones_completed: 3, milestones_total: 4 }),
		project("none", { milestones_completed: 0, milestones_total: 0 }),
		project("zero-of-five", { milestones_completed: 0, milestones_total: 5 }),
	];
	assert.deepEqual(ids(rows, { key: "milestones", direction: "asc" }), [
		"zero-of-five",
		"half",
		"overhalf",
		"full",
		"none",
	]);
	assert.deepEqual(ids(rows, { key: "milestones", direction: "desc" }), [
		"full",
		"overhalf",
		"half",
		"zero-of-five",
		"none",
	]);
});

test("live sorts on the count; zero is a value, not an absence", () => {
	const rows = [
		project("two", { live_sessions: 2, updated_at: 1 }),
		project("zero", { live_sessions: 0, updated_at: 2 }),
		project("one", { live_sessions: 1, updated_at: 3 }),
	];
	assert.deepEqual(ids(rows, { key: "live", direction: "asc" }), [
		"zero",
		"one",
		"two",
	]);
	assert.deepEqual(ids(rows, { key: "live", direction: "desc" }), [
		"two",
		"one",
		"zero",
	]);
});

test("progress sorts on the stamp: asc is most stale first; nulls last both ways", () => {
	const rows = [
		project("recent", { progress_updated_at: 3_000 }),
		project("old", { progress_updated_at: 1_000 }),
		project("middle", { progress_updated_at: 2_000 }),
		project("unreported", { progress_updated_at: null }),
	];
	assert.deepEqual(ids(rows, { key: "progress", direction: "asc" }), [
		"old",
		"middle",
		"recent",
		"unreported",
	]);
	assert.deepEqual(ids(rows, { key: "progress", direction: "desc" }), [
		"recent",
		"middle",
		"old",
		"unreported",
	]);
});

test("the total-order fallback settles every equal pair: updated_at desc, then name", () => {
	const rows = [
		project("same-again", { updated_at: 500, name: "same" }),
		project("other", { updated_at: 700, name: "same" }),
		project("old", { updated_at: 100 }),
		project("new", { updated_at: 900 }),
	];
	/* All four share the same live count: the fallback decides entirely. */
	for (const direction of ["asc", "desc"]) {
		assert.deepEqual(ids(rows, { key: "live", direction }), [
			"new",
			"other",
			"same-again",
			"old",
		]);
	}
	const compared = compareProjects(rows[0], rows[1], {
		key: "live",
		direction: "asc",
	});
	assert.ok(compared > 0, "the older row sorts after the newer one");
});

test("the sort is identity-stable: permutations of the input produce one order", () => {
	const rows = Array.from({ length: 24 }, (_, index) =>
		project(`p${index}`, {
			name: `name-${index % 7}`,
			updated_at: 100 + (index % 3) * 100,
			estimate: index % 5 === 0 ? null : (index % 4) + 1,
			estimate_unit: index % 2 === 0 ? "points" : "days",
			milestones_completed: index % 3,
			milestones_total: index % 3 === 0 ? 0 : 3,
			live_sessions: index % 4,
			progress_updated_at: index % 5 === 0 ? null : 1000 + index,
			target_date:
				index % 6 === 0
					? null
					: `2026-10-${String((index % 9) + 1).padStart(2, "0")}`,
			status: ["planning", "active", "qa", "done"][index % 4],
		}),
	);
	for (const key of [
		"name",
		"status",
		"target",
		"estimate",
		"milestones",
		"live",
		"progress",
	]) {
		for (const direction of ["asc", "desc"]) {
			const spec = { key, direction };
			const baseline = ids(rows, spec);
			assert.deepEqual(ids(rows, spec), baseline, "repeat runs agree");
			const shuffled = [...rows].reverse();
			assert.deepEqual(
				ids(shuffled, spec),
				baseline,
				"input order cannot leak through",
			);
		}
	}
});
