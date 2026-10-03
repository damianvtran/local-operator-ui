import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Projects tab's filter model, executed in Node (the `projects-tab.test.mjs`
 * pattern: the REAL module bundled, nothing re-implemented).
 *
 * What this file is FOR: the copy a reader sees in the Filters popover and the
 * chips, the predicate each option stands for, and the count rule ("what would
 * I see if I picked this?") are the observable contract of the filter work —
 * and they are all pure functions here, so they are pinned by assertions rather
 * than by a reviewer's eye on a frame. `scripts/project-view-perf.test.mjs`
 * measures the same code paths; this file decides what they must MEAN.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * as filters from "./src/renderer/src/features/projects/project-filters";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { filters } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The search joins this file's contract at exactly one seam now: the count
 * population IS the query's admitted rows, so the tests below build that set
 * with the real matcher rather than asserting a second one exists inside the
 * filter module.
 */
const searchBundle = await build({
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
	`data:text/javascript;base64,${Buffer.from(searchBundle.outputFiles[0].text).toString("base64")}`
);

const {
	FACET_ORDER,
	FACET_LABELS,
	FIXED_VOCABULARY_FACETS,
	NO_FILTERS,
	activeSelectionCount,
	applyFilters,
	clearFilterFacet,
	facetOptions,
	facetSections,
	filterOptionLabel,
	isFilterEmpty,
	isFilterFacetActive,
	toggleFilterValue,
} = filters;

/* Sunday 20 September 2026, UTC — the day every date fixture is read against. */
const TODAY = Date.UTC(2026, 8, 20);

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

/* ------------------------------------------------------------------ copy -- */

test("the facet order and headings are the design's, in its order", () => {
	assert.deepEqual(FACET_ORDER, [
		"status",
		"team",
		"owner",
		"tags",
		"progress",
		"target",
		"estimate",
		"milestones",
		"live",
	]);
	assert.deepEqual(Object.keys(FACET_LABELS), [...FACET_ORDER]);
	assert.equal(FACET_LABELS.target, "Target date");
	assert.equal(FACET_LABELS.live, "Live sessions");
});

test("every option's copy is the design's exact wording", () => {
	assert.equal(filterOptionLabel("status", "qa"), "QA");
	assert.equal(filterOptionLabel("status", "somefuture"), "somefuture");
	assert.equal(filterOptionLabel("team", null), "No team");
	assert.equal(filterOptionLabel("owner", null), "No owner");
	assert.equal(filterOptionLabel("progress", "stale"), "Stale");
	assert.equal(filterOptionLabel("progress", "up-to-date"), "Up to date");
	assert.equal(filterOptionLabel("progress", "not-reported"), "Not reported");
	assert.equal(filterOptionLabel("target", "none"), "No target date");
	assert.equal(filterOptionLabel("target", "within-7"), "Due within 7 days");
	assert.equal(filterOptionLabel("target", "within-30"), "Due within 30 days");
	assert.equal(filterOptionLabel("estimate", "none"), "No estimate");
	assert.equal(filterOptionLabel("estimate", "points"), "Points");
	assert.equal(filterOptionLabel("estimate", "days"), "Days");
	assert.equal(filterOptionLabel("milestones", "none"), "None set");
	assert.equal(filterOptionLabel("milestones", "incomplete"), "Incomplete");
	assert.equal(filterOptionLabel("milestones", "complete"), "Complete");
	assert.equal(filterOptionLabel("live", "has-live"), "Has live sessions");
	assert.equal(filterOptionLabel("live", "no-live"), "No live sessions");
});

/* ---------------------------------------------------------- facet predicates -- */

test("status filters by the raw value; multiple selections OR together", () => {
	const rows = [
		project("a", { status: "planning" }),
		project("b", { status: "active" }),
		project("c", { status: "done" }),
	];
	const active = { ...NO_FILTERS, status: ["active", "done"] };
	assert.deepEqual(
		applyFilters(rows, active, TODAY).map((row) => row.id),
		["b", "c"],
	);
});

test("team filters through projectTeamName (owner fallback and the bucket), so a section and its filter agree", () => {
	const rows = [
		project("a", { team: "platform" }),
		project("b", { owner: "atlas" }), // no team: files under its owner
		project("c", {}), // neither: the bucket
	];
	assert.deepEqual(
		applyFilters(rows, { ...NO_FILTERS, team: ["platform"] }, TODAY).map(
			(r) => r.id,
		),
		["a"],
	);
	assert.deepEqual(
		applyFilters(rows, { ...NO_FILTERS, team: ["atlas"] }, TODAY).map(
			(r) => r.id,
		),
		["b"],
	);
	assert.deepEqual(
		applyFilters(rows, { ...NO_FILTERS, team: [null] }, TODAY).map((r) => r.id),
		["c"],
	);
});

test("owner filters by the raw field, trimmed, with its own bucket", () => {
	const rows = [
		project("a", { owner: "atlas" }),
		project("b", { owner: "  ops  " }),
		project("c", { owner: null }),
	];
	assert.deepEqual(
		applyFilters(rows, { ...NO_FILTERS, owner: ["ops"] }, TODAY).map(
			(r) => r.id,
		),
		["b"],
	);
	assert.deepEqual(
		applyFilters(rows, { ...NO_FILTERS, owner: [null] }, TODAY).map(
			(r) => r.id,
		),
		["c"],
	);
});

test("tags match membership; progress takes the three fixed predicates literally", () => {
	const rows = [
		project("a", { tags: ["q4", "payments"] }),
		project("b", { tags: [] }),
		project("c", { progress_stale: true, progress_updated_at: 1 }),
		project("d", { progress_stale: false, progress_updated_at: 2 }),
		project("e", { progress_stale: false, progress_updated_at: null }),
		project("f", { progress_stale: true, progress_updated_at: null }),
	];
	assert.deepEqual(
		applyFilters(rows, { ...NO_FILTERS, tags: ["q4"] }, TODAY).map((r) => r.id),
		["a"],
	);
	/* Stale is `progress_stale === true` exactly (c, f). */
	assert.deepEqual(
		applyFilters(rows, { ...NO_FILTERS, progress: ["stale"] }, TODAY).map(
			(r) => r.id,
		),
		["c", "f"],
	);
	/* Up to date is `progress_stale === false` exactly (a, b, d, e — the
	 * fixture default is `false`, which is the spec's literal predicate). */
	assert.deepEqual(
		applyFilters(rows, { ...NO_FILTERS, progress: ["up-to-date"] }, TODAY).map(
			(r) => r.id,
		),
		["a", "b", "d", "e"],
	);
	/* Not reported is `progress_updated_at === null` exactly (a, b, e, f —
	 * the fixture default is `null`). */
	assert.deepEqual(
		applyFilters(
			rows,
			{ ...NO_FILTERS, progress: ["not-reported"] },
			TODAY,
		).map((r) => r.id),
		["a", "b", "e", "f"],
	);
});

test("target windows are day distances against today; overdue is the model's own rule", () => {
	const rows = [
		project("none", { target_date: null }),
		project("past", { target_date: "2026-09-19" }),
		project("today", { target_date: "2026-09-20" }),
		project("in7", { target_date: "2026-09-27" }),
		project("in8", { target_date: "2026-09-28" }),
		project("in30", { target_date: "2026-10-20" }),
		project("in31", { target_date: "2026-10-21" }),
		project("done-past", { target_date: "2026-09-01", status: "done" }),
	];
	const ids = (state) => applyFilters(rows, state, TODAY).map((r) => r.id);
	assert.deepEqual(ids({ ...NO_FILTERS, target: ["none"] }), ["none"]);
	/* Overdue excludes the finished row on purpose (the model's rule). */
	assert.deepEqual(ids({ ...NO_FILTERS, target: ["overdue"] }), ["past"]);
	/* Inclusive at the boundary: exactly 7 days away is inside; 8 is not. */
	assert.deepEqual(ids({ ...NO_FILTERS, target: ["within-7"] }), [
		"today",
		"in7",
	]);
	/* "Within 30 days" ENDS at the 30th day and includes the nearer ones. */
	assert.deepEqual(ids({ ...NO_FILTERS, target: ["within-30"] }), [
		"today",
		"in7",
		"in8",
		"in30",
	]);
});

test("estimate splits by unit; milestones by ratio; live by count", () => {
	const rows = [
		project("no-estimate"),
		project("points", { estimate: 3, estimate_unit: "points" }),
		project("days", { estimate: 2, estimate_unit: "days" }),
		project("milestones-none", {
			milestones_completed: 0,
			milestones_total: 0,
		}),
		project("milestones-part", {
			milestones_completed: 1,
			milestones_total: 3,
		}),
		project("milestones-full", {
			milestones_completed: 3,
			milestones_total: 3,
		}),
		project("live", { live_sessions: 2 }),
		project("quiet", { live_sessions: 0 }),
	];
	const ids = (state) => applyFilters(rows, state, TODAY).map((r) => r.id);
	assert.deepEqual(ids({ ...NO_FILTERS, estimate: ["none"] }), [
		"no-estimate",
		"milestones-none",
		"milestones-part",
		"milestones-full",
		"live",
		"quiet",
	]);
	assert.deepEqual(ids({ ...NO_FILTERS, estimate: ["points"] }), ["points"]);
	assert.deepEqual(ids({ ...NO_FILTERS, estimate: ["days"] }), ["days"]);
	/* Milestones: 0/5 is "incomplete" (it has milestones), not "none set". */
	assert.deepEqual(ids({ ...NO_FILTERS, milestones: ["none"] }), [
		"no-estimate",
		"points",
		"days",
		"milestones-none",
		"live",
		"quiet",
	]);
	assert.deepEqual(ids({ ...NO_FILTERS, milestones: ["incomplete"] }), [
		"milestones-part",
	]);
	assert.deepEqual(ids({ ...NO_FILTERS, milestones: ["complete"] }), [
		"milestones-full",
	]);
	assert.deepEqual(ids({ ...NO_FILTERS, live: ["has-live"] }), ["live"]);
	assert.deepEqual(ids({ ...NO_FILTERS, live: ["no-live"] }), [
		"no-estimate",
		"points",
		"days",
		"milestones-none",
		"milestones-part",
		"milestones-full",
		"quiet",
	]);
});

test("facets AND across and OR within, and the empty state is the identity", () => {
	const rows = [
		project("a", { status: "active", team: "platform" }),
		project("b", { status: "active", team: "atlas" }),
		project("c", { status: "done", team: "platform" }),
	];
	assert.deepEqual(
		applyFilters(
			rows,
			{ ...NO_FILTERS, status: ["active"], team: ["platform"] },
			TODAY,
		).map((r) => r.id),
		["a"],
	);
	/* No selection returns the INPUT ARRAY by reference — the memo chain's identity. */
	assert.equal(applyFilters(rows, NO_FILTERS, TODAY), rows);
});

/* ------------------------------------------------------- toggles and counts -- */

test("toggle and clear helpers are immutable and typed per facet", () => {
	let state = NO_FILTERS;
	state = toggleFilterValue(state, "status", "active");
	state = toggleFilterValue(state, "status", "planning");
	state = toggleFilterValue(state, "team", null);
	state = toggleFilterValue(state, "progress", "stale");
	assert.deepEqual(state.status, ["active", "planning"]);
	assert.deepEqual(state.team, [null]);
	assert.deepEqual(state.progress, ["stale"]);
	assert.equal(activeSelectionCount(state), 4);
	assert.equal(isFilterFacetActive(state, "tags"), false);
	assert.equal(isFilterEmpty(state), false);

	state = toggleFilterValue(state, "status", "active");
	assert.deepEqual(state.status, ["planning"]);
	state = clearFilterFacet(state, "status");
	assert.deepEqual(state.status, []);
	assert.equal(activeSelectionCount(state), 2);
	assert.equal(
		isFilterEmpty(
			clearFilterFacet(clearFilterFacet(state, "team"), "progress"),
		),
		true,
	);
	assert.equal(isFilterEmpty(NO_FILTERS), true);
});

test("option counts answer over every OTHER facet, so a click means what it says", () => {
	const rows = [
		project("a", { status: "active", team: "platform" }),
		project("b", { status: "active", team: "atlas" }),
		project("c", { status: "done", team: "platform" }),
		project("d", { status: "done", team: null }),
	];
	/* Nothing selected: plain totals. */
	const plain = facetOptions("team", rows, NO_FILTERS, TODAY);
	assert.deepEqual(
		plain.options.map((o) => [o.label, o.count]),
		[
			["atlas", 1],
			["platform", 2],
			["No team", 1],
		],
	);
	/* Status = active: TEAM counts are over the active rows only... */
	const withStatus = facetOptions(
		"team",
		rows,
		{ ...NO_FILTERS, status: ["active"] },
		TODAY,
	);
	assert.deepEqual(
		withStatus.options.map((o) => [o.label, o.count]),
		[
			["atlas", 1],
			["platform", 1],
		],
	);
	/* ...while the STATUS facet's own counts ignore the status selection (its
	 * own facet is excluded from the population), which is what lets a reader
	 * see what ADDING "done" would do without losing the current counts. */
	const status = facetOptions(
		"status",
		rows,
		{ ...NO_FILTERS, status: ["active"] },
		TODAY,
	);
	assert.deepEqual(
		status.options.map((o) => [o.label, o.count, o.selected]),
		[
			["Planning", 0, false],
			["Active", 2, true],
			["QA", 0, false],
			["Validation", 0, false],
			["Done", 2, false],
			["Paused", 0, false],
			["Archived", 0, false],
		],
	);
});

test("the search's admitted rows ARE the count population", () => {
	/*
	 * The module does not re-derive the query's membership any more, and this is
	 * the test that held the old behaviour: the caller hands it the rows the
	 * search admitted, whichever engine admitted them. Here the caller is the
	 * local matcher, so the assertion is unchanged in shape - `docs-pass` is
	 * still excluded and `platform` still counts one - but it now pins the
	 * CONTRACT (the population is the caller's row set) rather than a second
	 * matcher inside the filter module. A backend-admitted set would behave
	 * identically, which is the point.
	 */
	const rows = [
		project("migration-a", { name: "migration-a", team: "platform" }),
		project("migration-b", { name: "migration-b", team: "atlas" }),
		project("docs", { name: "docs-pass", team: "platform" }),
	];
	const admitted = search.searchProjects(rows, "migration");
	const scoped = facetOptions("team", admitted, NO_FILTERS, TODAY);
	assert.deepEqual(
		scoped.options.map((o) => [o.label, o.count]),
		[
			["atlas", 1],
			["platform", 1],
		],
	);
});

test("options are what is present, in canonical order, and a selected value survives", () => {
	const rows = [
		project("a", { status: "planning" }),
		project("b", { status: "done" }),
		project("c", { status: "weird" }),
		project("d", { tags: ["zeta", "alpha"] }),
	];
	/*
	 * Status, a FIXED vocabulary (D5): the whole model always renders — zeros
	 * included — so an option the current data has none of is still
	 * discoverable, and an unknown status a newer backend wrote sorts after
	 * the seven known ones.
	 */
	const status = facetOptions("status", rows, NO_FILTERS, TODAY);
	assert.deepEqual(
		status.options.map((o) => [o.label, o.count]),
		[
			["Planning", 1],
			["Active", 1],
			["QA", 0],
			["Validation", 0],
			["Done", 1],
			["Paused", 0],
			["Archived", 0],
			["weird", 1],
		],
	);
	/* Tags: alphabetical. */
	const tags = facetOptions("tags", rows, NO_FILTERS, TODAY);
	assert.deepEqual(
		tags.options.map((o) => o.label),
		["alpha", "zeta"],
	);
	/* A selected value stays visible (and removable) even when the population
	 * no longer contains it, and PRESENT-DERIVED options drop at count 0 (D5's
	 * other half — Team is derived, so `ghost` survives only as the selection
	 * and nothing else is invented). */
	const vanished = facetOptions(
		"team",
		rows,
		{ ...NO_FILTERS, team: ["ghost"] },
		TODAY,
	);
	assert.deepEqual(
		vanished.options.map((o) => [o.label, o.count, o.selected]),
		[
			["ghost", 0, true],
			["No team", 4, false],
		],
	);
	/* And the "No team" bucket sorts last when present. */
	const bucket = facetOptions(
		"team",
		[project("x"), project("y", { team: "platform" })],
		NO_FILTERS,
		TODAY,
	);
	assert.deepEqual(
		bucket.options.map((o) => o.label),
		["platform", "No team"],
	);
});

test("facet sections are every facet in order, each with its own options", () => {
	const rows = [project("a", { status: "active", team: "platform" })];
	const sections = facetSections(rows, NO_FILTERS, TODAY);
	assert.deepEqual(
		sections.map((section) => section.facet),
		[...FACET_ORDER],
	);
	assert.deepEqual(
		sections.map((section) => section.label),
		FACET_ORDER.map((facet) => FACET_LABELS[facet]),
	);
	/* A facet nothing matches still renders — and a FIXED vocabulary renders
	 * WHOLE (D5): every model status shows, the selected one included, while a
	 * selected value that no longer matches anything stays visible at count 0
	 * (the present-derived rule, pinned above). */
	const empty = facetSections(
		[project("a")],
		{ ...NO_FILTERS, status: ["archived"] },
		TODAY,
	);
	const status = empty[0];
	assert.deepEqual(
		status.options.map((o) => [o.label, o.count, o.selected]),
		[
			["Planning", 0, false],
			["Active", 1, false],
			["QA", 0, false],
			["Validation", 0, false],
			["Done", 0, false],
			["Paused", 0, false],
			["Archived", 0, true],
		],
	);
});

test("the zero-count rule splits fixed vocabularies from present-derived facets (D5)", () => {
	/*
	 * The adjudicated rule, pinned once here: a FIXED-vocabulary facet renders
	 * every option its model knows, counts included (`Overdue` is askable in a
	 * week where nothing is overdue); a PRESENT-DERIVED facet keeps only what
	 * the population carries, so an option with nothing behind it does not
	 * masquerade as vocabulary. The fixed set is asserted first, so the
	 * classification in `FIXED_VOCABULARY_FACETS` and the behaviour cannot
	 * drift apart.
	 */
	assert.deepEqual([...FIXED_VOCABULARY_FACETS].sort(), [
		"estimate",
		"live",
		"milestones",
		"progress",
		"status",
		"target",
	]);
	const rows = [
		project("a", { status: "active", team: "platform" }),
		project("b", { status: "done", team: "atlas" }),
	];
	const target = facetOptions("target", rows, NO_FILTERS, TODAY);
	assert.deepEqual(
		target.options.map((o) => [o.label, o.count]),
		[
			["No target date", 2],
			["Overdue", 0],
			["Due within 7 days", 0],
			["Due within 30 days", 0],
		],
	);
	const estimate = facetOptions("estimate", rows, NO_FILTERS, TODAY);
	assert.deepEqual(
		estimate.options.map((o) => o.label),
		["No estimate", "Points", "Days"],
	);
	/* Present-derived: the search scopes the population to one row, and the
	 * team the other row carries disappears instead of showing a 0. */
	const scoped = facetOptions(
		"team",
		search.searchProjects(rows, "platform"),
		NO_FILTERS,
		TODAY,
	);
	assert.deepEqual(
		scoped.options.map((o) => [o.label, o.count]),
		[["platform", 1]],
	);
});

test("the Filters badge counts selected OPTIONS, not facets (U9)", () => {
	/*
	 * `Status · Active +1` with a badge of 1 told a reader nothing about how
	 * many options were narrowing; the badge now counts the options themselves.
	 */
	let state = NO_FILTERS;
	assert.equal(activeSelectionCount(state), 0);
	state = toggleFilterValue(state, "status", "active");
	state = toggleFilterValue(state, "status", "paused");
	assert.equal(activeSelectionCount(state), 2);
	state = toggleFilterValue(state, "team", null);
	assert.equal(activeSelectionCount(state), 3);
	state = clearFilterFacet(state, "status");
	assert.equal(activeSelectionCount(state), 1);
});
