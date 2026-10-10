import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Projects tab's view pipeline at the sizes the feature was planned
 * against: is the derivation the renderer runs on every keystroke and every
 * facet toggle actually cheap at 76 rows and at the simulated 800?
 *
 * WHAT IS MEASURED, exactly: the PURE pipeline the page composes —
 * `searchProjects` (the join) -> `applyFilters` (the facets) -> `sortProjects`
 * (the column sort) -> `groupByTeam` (the sections) — plus the matcher on its
 * own, because the two have different budgets and different failure stories:
 * a slow matcher is felt per keystroke, a slow tail is felt whenever a facet
 * toggles.
 *
 * WHY p95 OVER REPEATED RUNS, AND WHY THE ASSERTION IS ON CPU: a single
 * `performance.now()` sample on a fleet-loaded host measures the host, not the
 * code (a 40x run on a shared box has measured a 12 ms outlier on a 0.3 ms
 * operation). The p95 of many warmed runs is stable enough to hold a ceiling
 * with headroom — and the currency it is read in is CPU time, because this
 * host ran at load average 282 on 2026-09-30 and the wall reading crossed what
 * was then the matcher's budget while the CPU reading of the same runs stayed
 * near 2 ms (`samplesOf` states the measurement in full).
 *
 * THE CEILINGS' DATASET, written down per "Calibrate ceilings from CI, never
 * from your laptop" (round 2 of the PR that added this file: before the
 * recalibration the ceilings were the architecture note's 8 ms / 4 ms budgets,
 * and a slower ubuntu-latest instance tripped both on a byte-identical path):
 *
 *   - CI (ubuntu-latest), run 36796958829 at head `8eda97e11c`: pipeline CPU
 *     p95 8.22 ms, matcher CPU p95 7.41 ms — the run that tripped 8/4. The
 *     tested path is byte-identical at `68445645d7`, whose earlier CI run
 *     passed under 8/4, so the spread is the runner, not the derivation.
 *   - This host (fleet-loaded): pipeline 3.62 ms, matcher 2.60 ms at 800 rows,
 *     0.27 ms at 76 — the reading the interaction's "instant" claim rests on.
 *   - THE PASS SIDE NOW PRINTS TOO (this recalibration's first fix): the
 *     `68445645d7` pass left no numbers in its log, which is why the dataset
 *     above needed a failure to exist. Every run, pass or fail, logs both
 *     p95s, so the next recalibration starts from the log, not from scratch.
 *
 * The ceilings sit at ~1.6× the worst observed CI reading (13 ms pipeline =
 * 1.58× the 8.22; 12 ms matcher = 1.62× the 7.41): headroom for a slower
 * instance than any seen, while a ≥1.6× algorithmic regression — the class
 * this tripwire exists for — still trips it. They are a REGRESSION TRIPWIRE,
 * not the interaction's latency claim; that claim is the LOCAL reading above,
 * and the architecture's 8/4 budgets stay recorded as its provenance.
 *
 * WHAT IS NOT MEASURED HERE, and must not be implied: the DOM. These are the
 * numbers the renderer's memo chain feeds on; the frame-level claims (no row
 * remount, the count line landing) live in the storybook plays and the
 * committed frames, and 800-row E2E is deliberately not attempted in CI.
 *
 * The fixtures are DETERMINISTIC (seeded PRNG): a perf test whose input drifts
 * between runs cannot say whether a change made the code faster or the data
 * bigger.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as filters from "./src/renderer/src/features/projects/project-filters";',
			'export * as search from "./src/renderer/src/features/projects/project-search";',
			'export * as sort from "./src/renderer/src/features/projects/project-sort";',
			'export * as model from "./src/renderer/src/features/projects/project-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/* `project-model` reads the i18n locale layer (@shared/i18n), whose shim
	 * reaches src/i18n by relative path — only the @shared alias is needed
	 * (the `turn-timestamp.test.mjs` recipe). */
	alias: {
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const { filters, search, sort, model } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* ------------------------------------------------------------- fixtures -- */

/** mulberry32: seeded, tiny, and identical across runs — the fixtures' own contract. */
function mulberry32(seed) {
	let state = seed | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = [
	"migration",
	"payments",
	"storage",
	"release",
	"scheduler",
	"analytics",
	"billing",
	"search",
	"onboarding",
	"hardening",
	"papercuts",
	"telemetry",
	"upgrade",
	"docs",
	"console",
];

const STATUSES = [
	"planning",
	"active",
	"qa",
	"validation",
	"done",
	"paused",
	"archived",
];
const TEAMS = ["platform", "atlas", "growth", null];
const OWNERS = ["atlas", "beacon", "cypress", null];

/** The synthetic listing: `count` rows mirroring the measured shape (≈4.7 KB avg row in updates). */
function fixtureRows(count) {
	const random = mulberry32(0xc0ffee);
	const TODAY = Date.UTC(2026, 8, 20);
	const rows = [];
	for (let index = 0; index < count; index += 1) {
		const word = () => WORDS[Math.floor(random() * WORDS.length)];
		rows.push({
			id: `p${index}`,
			name: `${word()}-${word()}-${index}`,
			title: random() < 0.6 ? `${word()} ${word()} rollout` : null,
			description: `${word()} ${word()}: cut over the ${word()} path and retire the old one. Batch ${index}.`,
			owner: OWNERS[Math.floor(random() * OWNERS.length)],
			team: TEAMS[Math.floor(random() * TEAMS.length)],
			status: STATUSES[Math.floor(random() * STATUSES.length)],
			tags: random() < 0.5 ? [word(), "q4"] : ["q4"],
			start_date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
			target_date:
				random() < 0.7
					? `2026-1${random() < 0.5 ? 0 : 1}-${String((index % 27) + 1).padStart(2, "0")}`
					: null,
			completed_at: null,
			estimate: random() < 0.7 ? Math.floor(random() * 13) + 1 : null,
			estimate_unit: random() < 0.6 ? "points" : "days",
			milestones_completed: Math.floor(random() * 4),
			milestones_total: random() < 0.3 ? 0 : 3,
			sessions: Math.floor(random() * 5),
			live_sessions: random() < 0.3 ? Math.floor(random() * 3) : 0,
			progress_stale: random() < 0.5,
			progress_updated_at:
				random() < 0.8
					? TODAY - (Math.floor(random() * 20) * 86_400_000) / 1000
					: null,
			updated_at: TODAY / 1000 - Math.floor(random() * 30) * 86_400,
		});
	}
	return rows;
}

const ROWS_76 = fixtureRows(76);
const ROWS_800 = fixtureRows(800);
const TODAY_MS = Date.UTC(2026, 8, 20);

/* One "user is looking at something" state: a query, a facet, a column sort. */
const FILTER_STATE = {
	...filters.NO_FILTERS,
	status: ["active", "qa"],
	progress: ["stale"],
};
const SORT_SPEC = { key: "target", direction: "asc" };
const QUERY = "migration";

/** The pure pipeline the page memoizes, in the order the page composes it. */
function pipeline(rows, query, state, spec) {
	const matched = search.searchProjects(rows, query);
	const filtered = filters.applyFilters(matched, state, TODAY_MS);
	const ordered = sort.sortProjects(filtered, spec);
	return model.groupByTeam(ordered, model.projectTeamName);
}

/** Nearest-rank p95 — no interpolation, the ceiling is a real run's number. */
function p95(samples) {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

/**
 * The reading, LOGGED ON PASS AS WELL AS FAILURE, then asserted.
 *
 * The recalibration that produced the ceilings above had to mine a FAILURE
 * for its CI numbers because the pass side printed nothing (see the
 * docstring's dataset): a log that only speaks when it breaks cannot
 * accumulate the evidence the next recalibration needs, and the whole
 * failure mode this file just survived was a ceiling argued from a missing
 * dataset. `label`/`sizeNote` keep the printed line and the assertion
 * message the shapes CI already greps for.
 */
function reportAndAssert(label, samples, ceiling, sizeNote) {
	const cpu = p95(samples.cpu);
	const wall = p95(samples.wall);
	console.log(
		`[project-view-perf] ${label} ${sizeNote}: CPU p95 ${cpu.toFixed(2)} ms (ceiling ${ceiling} ms) | wall p95 ${wall.toFixed(2)} ms`,
	);
	assert.ok(
		cpu <= ceiling,
		`${label} CPU p95 ${cpu.toFixed(2)} ms exceeds ${ceiling} ms ${sizeNote} (wall p95 ${wall.toFixed(2)} ms)`,
	);
}

/**
 * Per-call samples, warmed first so the JIT is not part of the reading, in
 * BOTH currencies:
 *
 *  - `cpu` is `process.cpuUsage()`'s own user+system delta, and it is what the
 *    budgets below assert on. That is the repo's own rule — "if you must
 *    measure, measure CPU, not wall time" — applied to a test that has to
 *    survive this fleet. Measured on 2026-09-30 while this host ran at load
 *    average 282: the WALL p95 of the matcher read 5.3 ms against what was
 *    then its 4 ms budget — a reading of the host, not of the matcher —
 *    while the CPU p95 of the same runs sat near 2 ms, where the ceilings
 *    now carry their headroom.
 *    A wall-time assertion would have flaked here and taught people to route
 *    around the gate; this instrument does not.
 *  - `wall` is kept beside it and printed by the PR's own evidence script,
 *    never asserted: it is the reading a reader may want, and it is exactly
 *    the one this box cannot promise.
 */
function samplesOf(run, iterations, warmup = 30) {
	for (let index = 0; index < warmup; index += 1) run();
	const samples = { cpu: [], wall: [] };
	for (let index = 0; index < iterations; index += 1) {
		const cpuStart = process.cpuUsage();
		const wallStart = performance.now();
		run();
		samples.wall.push(performance.now() - wallStart);
		const delta = process.cpuUsage(cpuStart);
		samples.cpu.push((delta.user + delta.system) / 1000);
	}
	return samples;
}

/* -------------------------------------------------------------- budgets -- */

/* THE CI TRIPWIRES, recalibrated in round 2 (the docstring carries the full
 * dataset): ~1.6× the worst observed CI reading (8.22 / 7.41 ms at
 * `8eda97e11c`, on a path byte-identical to the run that passed at
 * `68445645d7`). The architecture's 8 ms / 4 ms budgets are the LOCAL
 * interaction claim's provenance, not these ceilings — do not quote these as
 * the interaction's latency. */
const PIPELINE_P95_MS_800 = 13;
const MATCHER_P95_MS_800 = 12;

test("the synthetic listings are the sizes the plan named", () => {
	assert.equal(ROWS_76.length, 76);
	assert.equal(ROWS_800.length, 800);
	/* The fixtures must actually exercise the pipeline: the query matches rows,
	 * and the facets leave some of them in. A perf test over an empty result
	 * measures the short-circuit, not the work. */
	for (const rows of [ROWS_76, ROWS_800]) {
		const matched = search.searchProjects(rows, QUERY);
		assert.ok(matched.length > 0, "the query matches rows");
		const filtered = filters.applyFilters(matched, FILTER_STATE, TODAY_MS);
		assert.ok(filtered.length > 0, "the facets leave rows in");
		assert.ok(filtered.length < matched.length, "the facets narrow");
	}
});

test("the pipeline stays inside its 800-row budget, p95", () => {
	const samples = samplesOf(
		() => pipeline(ROWS_800, QUERY, FILTER_STATE, SORT_SPEC),
		100,
	);
	reportAndAssert("pipeline", samples, PIPELINE_P95_MS_800, "@800");
});

test("the matcher stays inside its 800-row budget, p95", () => {
	const samples = samplesOf(() => search.searchProjects(ROWS_800, QUERY), 100);
	reportAndAssert("matcher", samples, MATCHER_P95_MS_800, "@800");
});

test("the pipeline is identity-stable: same input, identical output order", () => {
	const signature = (rows) =>
		pipeline(rows, QUERY, FILTER_STATE, SORT_SPEC)
			.map(
				(group) =>
					`${group.team ?? ""}:${group.items.map((row) => row.id).join(",")}`,
			)
			.join("|");
	for (const rows of [ROWS_76, ROWS_800]) {
		const baseline = signature(rows);
		assert.equal(signature(rows), baseline, "repeat runs agree");
		/* The input order must not leak through: the sort's total-order
		 * fallback is what makes this true, and a stable-but-order-dependent
		 * comparator would fail exactly here. */
		assert.equal(
			signature([...rows].reverse()),
			baseline,
			"input order cannot leak",
		);
	}
});

test("the 76-row listing is inside the same budget with room to spare", () => {
	const samples = samplesOf(
		() => pipeline(ROWS_76, QUERY, FILTER_STATE, SORT_SPEC),
		60,
	);
	reportAndAssert("pipeline", samples, PIPELINE_P95_MS_800, "@76");
});
