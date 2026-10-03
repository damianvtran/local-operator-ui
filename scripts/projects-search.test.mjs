import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Projects tab's local text search, executed in Node (the
 * `projects-tab.test.mjs` pattern: the REAL module bundled, nothing
 * re-implemented).
 *
 * The contract this file pins is the RANKING — bands, weights, ties — because
 * that ordering is invisible in a single frame and is exactly the part the
 * server op will inherit when it lands: a local matcher with the wrong order
 * teaches the reader the wrong result order, and the server path built from
 * this file's own table would carry the mistake forward.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * as search from "./src/renderer/src/features/projects/project-search";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { search } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const { searchMatch, searchProjects } = search;

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

const ids = (rows, query) => searchProjects(rows, query).map((row) => row.id);

test("an empty query admits everything, unchanged and by reference", () => {
	const rows = [project("a"), project("b")];
	const out = searchProjects(rows, "   ");
	assert.equal(out, rows, "the no-query identity is the input reference");
});

test("bands: exact > prefix > word-prefix > subsequence, for one field", () => {
	/* One field (name) so the band order is the only thing in play. */
	assert.equal(
		searchMatch(project("payments", { name: "payments" }), "payments"),
		4 * 2.5,
	);
	assert.equal(
		searchMatch(project("payments", { name: "payments" }), "paym"),
		3 * 2.5,
	);
	assert.equal(
		searchMatch(
			project("migration", { name: "payments-migration" }),
			"migration",
		),
		2 * 2.5,
	);
	assert.equal(
		searchMatch(project("migration", { name: "payments-migration" }), "paymig"),
		1 * 2.5,
	);
	assert.equal(
		searchMatch(project("payments", { name: "payments" }), "zzz"),
		0,
	);
});

test("weights: an exact title hit outranks every weaker-field match", () => {
	/* The design's own ordering guarantee: exact title (3x4) > subsequence
	 * anywhere (1x1.5) — and the weights decide between equal bands. */
	const title = searchMatch(project("t", { title: "billing" }), "billing");
	const name = searchMatch(project("n", { name: "billing" }), "billing");
	const description = searchMatch(
		project("d", { description: "billing" }),
		"billing",
	);
	const status = searchMatch(
		project("s", { status: "active", name: "x" }),
		"active",
	);
	assert.equal(title, 12);
	assert.equal(name, 10);
	assert.equal(description, 8);
	assert.equal(status, 4);
	assert.ok(title > name && name > description && description > status);
});

test("the fuzzy band is suppressed below three characters", () => {
	/* "pmt" subsequence-matches payments-migration; "pm" must not reach the
	 * band at all, and "pa" matches only as a word PREFIX. */
	const row = project("payments-migration", { name: "payments-migration" });
	assert.ok(
		searchMatch(row, "pmt") > 0,
		"three characters reach the fuzzy band",
	);
	assert.equal(searchMatch(row, "pm"), 0, "two characters cannot reach it");
	assert.ok(
		searchMatch(row, "pa") > 0,
		"a two-character word prefix is a prefix match",
	);
});

test("tags, owners, teams and status are searchable; description is", () => {
	const row = project("p", {
		name: "payments-migration",
		description: "Cut the payments API over to the new service",
		owner: "atlas",
		team: "platform",
		tags: ["q4", "billing"],
	});
	assert.ok(searchMatch(row, "billing") > 0, "tag");
	assert.ok(searchMatch(row, "atlas") > 0, "owner");
	assert.ok(searchMatch(row, "platform") > 0, "team");
	assert.ok(
		searchMatch(row, "payments api") > 0,
		"a two-word description phrase",
	);
	assert.ok(searchMatch(row, "q4") > 0, "short tag exact");
});

test("results order by score; ties by updated_at desc, then name", () => {
	const rows = [
		project("prefix", { name: "billing-migration", updated_at: 999 }),
		project("older-exact", { title: "billing", updated_at: 5 }),
		project("newer-exact", { title: "billing", updated_at: 50 }),
		project("other", { name: "unrelated" }),
	];
	assert.deepEqual(ids(rows, "billing"), [
		"newer-exact",
		"older-exact",
		"prefix",
	]);
	assert.deepEqual(ids(rows, "unrelated"), ["other"]);
});

test("the order is total and stable: a permutation cannot leak through", () => {
	const rows = [
		project("same-a", { title: "billing", name: "billing", updated_at: 7 }),
		project("same-b", { title: "billing", name: "billing", updated_at: 7 }),
		project("same-c", { title: "billing", name: "billing", updated_at: 7 }),
		project("other", { name: "elsewhere" }),
	];
	const baseline = ids(rows, "billing");
	assert.deepEqual(ids([...rows].reverse(), "billing"), baseline);
	assert.deepEqual(ids(rows, "billing"), baseline);
	assert.equal(baseline.length, 3);
});

test("multi-word queries read as word-prefixes and as a spaces-removed subsequence", () => {
	const row = project("payments-migration", { name: "payments-migration" });
	assert.ok(searchMatch(row, "pay mig") > 0, "both words prefix-match a word");
	assert.ok(searchMatch(row, "paymig") > 0, "the letters in order");
	assert.equal(
		searchMatch(project("docs", { name: "docs-pass" }), "docs mig"),
		0,
	);
});

test("case-insensitive throughout", () => {
	assert.equal(
		searchMatch(project("p", { name: "Payments" }), "PAYMENTS"),
		4 * 2.5,
	);
	assert.equal(searchMatch(project("p", { title: "Billing" }), "billing"), 12);
});

/*
 * The JOIN with the backend engine, and the copy that has to be true of
 * whichever engine served — both pure, both here rather than in a frame,
 * because a single still cannot show that a sentence is false.
 */

test("the backend's hits become this listing's rows, in the ANSWER's rank order", () => {
	const rows = [
		project("a", { name: "alpha" }),
		project("b", { name: "beta" }),
		project("c", { name: "gamma" }),
	];
	// The order is the answer's, not the listing's: rank is the backend's
	// model, and re-deriving one here would be a second, disagreeing one.
	assert.deepEqual(
		search
			.projectsForHits(rows, [{ id: "c" }, { id: "a" }, { id: "b" }])
			.map((row) => row.id),
		["c", "a", "b"],
	);
	// An id the listing does not hold is DROPPED, not invented: the store moved
	// under the answer (a project deleted between the two reads).
	assert.deepEqual(
		search
			.projectsForHits(rows, [{ id: "a" }, { id: "gone" }])
			.map((row) => row.id),
		["a"],
	);
	// No hits is no rows, and it never falls back to the listing.
	assert.deepEqual(search.projectsForHits(rows, []), []);
});

/*
 * The claims the per-engine copy is held to, hoisted to module scope because a
 * literal re-allocated per assertion is the thing `useTopLevelRegex` refuses —
 * and these are the sentence's own words, so they read better named.
 */
const CLIENT_DISCLAIMER = /Update text is not searched\./;
const ANY_DISCLAIMER = /is not searched/;
const NAMES_UPDATES = /update text/;
const SHARED_RECOVERY = /Clearing the search and filters restores the list\.$/;

test("each engine carries its own no-match subline, and neither lies about update text", () => {
	const { SEARCH_SUBLINE } = search;
	/*
	 * THE CLAIM THIS PINS, mechanically: "Update text is not searched" is a fact
	 * about the client matcher — `updates[]` is detail-only on the wire, so a
	 * query ranked here cannot reach it — and the backend index DOES read it,
	 * which is the whole reason it exists. So the sentence must not be shared,
	 * and the engine that reads updates must not deny doing so.
	 */
	assert.match(SEARCH_SUBLINE.client, CLIENT_DISCLAIMER);
	assert.doesNotMatch(
		SEARCH_SUBLINE.backend,
		ANY_DISCLAIMER,
		"the index reads update text; a sentence denying it is false the moment it serves",
	);
	assert.match(SEARCH_SUBLINE.backend, NAMES_UPDATES);
	// The one claim BOTH engines make, because both are the same box over the
	// same listing: an empty result is undone by the same clear.
	for (const engine of ["client", "backend"]) {
		assert.match(
			SEARCH_SUBLINE[engine],
			SHARED_RECOVERY,
			`${engine}: the shared half of the sentence`,
		);
		assert.notEqual(SEARCH_SUBLINE[engine].trim(), "");
	}
	assert.notEqual(SEARCH_SUBLINE.client, SEARCH_SUBLINE.backend);
});

test("the index gate is version 2 of the projects capability", () => {
	// Stated here, beside the fallback it gates, rather than only in the
	// contract suite: the number is what decides which engine serves.
	assert.equal(search.PROJECTS_SEARCH_MIN_VERSION, 2);
});

test("the query BOTH engines are asked is trimmed and bounded, once", () => {
	const { projectsSearchQuery } = search;
	// Identity for anything a board search is actually typed with: the bound is
	// the route's, and it must not touch an ordinary box.
	assert.equal(projectsSearchQuery("  payments  "), "payments");
	assert.equal(projectsSearchQuery(""), "");
	assert.equal(projectsSearchQuery("   "), "");
	// Bounded at the route's own number, and trimmed FIRST so the bound counts
	// the string that would be sent rather than the box's own whitespace.
	const long = `${" ".repeat(10)}${"a".repeat(400)}`;
	assert.equal(projectsSearchQuery(long).length, 256);
	assert.equal(
		projectsSearchQuery("a".repeat(256)),
		"a".repeat(256),
		"exactly at the bound is not over it",
	);
	assert.equal(projectsSearchQuery("a".repeat(257)).length, 256);
	/*
	 * THE REASON THIS IS A FUNCTION rather than a slice at each call site: the
	 * FALLBACK must rank this same string, or a paste over the bound makes the
	 * two engines answer different questions (review round 1, MINOR-2). The page
	 * and the hook both call it, and this asserts the one property that makes
	 * that safe — that the result is a prefix of the trimmed box, so the index
	 * and the Client matcher cannot disagree about the box itself.
	 */
	const box = `${"a".repeat(300)} needletail`;
	const bounded = projectsSearchQuery(box);
	assert.equal(box.trim().startsWith(bounded), true);
	// And the row the two strings disagree about, as the page-level suite builds
	// it: an exact hit under the bounded string, unreachable under the box.
	const exact = project("x", { name: bounded });
	assert.ok(searchMatch(exact, bounded) > 0);
	assert.equal(searchMatch(exact, box), 0);
});
