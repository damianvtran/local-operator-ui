/*
 * The tier map is only worth having if it cannot go stale in silence.
 *
 * `KEY_TIER` decides which of the registry's rows a user meets on arrival and
 * which sit one click away. It cannot be inferred from `kind` (that is "how a
 * value is EDITED") or from `is_default` (a value comparison), so it is curated
 * — and a curated map drifts the moment the registry gains a key nobody
 * classified. The failure mode of that drift is invisible: the new key lands
 * under Advanced, still searchable and still writable, and nobody ever notices
 * it was never decided on.
 *
 * THE DETECTOR HAS TWO SOURCES, and it needs both. The committed fixture
 * (`scripts/fixtures/backend-settings-registry*.json`, the real `/v1/settings`
 * projection) is asserted three ways below — every key the wire can produce
 * resolves to a tier, neither map holds a key the wire no longer names, and the
 * fallback for an unclassified key is `advanced` — but a fixture is not evidence
 * about a wire it does not describe, and that is exactly how it failed: the
 * fixture said 99 keys in 18 sections while the released server served 102 in 19,
 * so no assertion here could see three unclassified keys and one new section
 * (QA round 1, Q1). The second source is the REGISTRY ITSELF, read from the
 * backend's own `settings_io` by `scripts/backend-settings-registry.mjs`, and
 * asserted below. Reach it on a machine with a backend — `lop-update` installs
 * the released runtime, and `LOCAL_OPERATOR_BACKEND_PYTHON` names any other —
 * and refresh the fixtures with `node scripts/derive-backend-settings-fixture.mjs`
 * when it disagrees. On a machine with none (CI) that arm skips LOUDLY rather
 * than passing, because "nothing to compare" and "compared and equal" are
 * different results and only one of them is evidence.
 *
 * The maps are exercised through the SHIPPED module rather than a copy of it:
 * the bundle below imports the same `backend-settings-tiers.ts` the section
 * does, so a second implementation cannot pass this test while the product
 * disagrees with it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { readRegistryProjection } from "./backend-settings-registry.mjs";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/backend-settings-tiers";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { KEY_TIER, SECTION_TIER, allOpenTargets, opensOnArrival, tierFor } =
	module;

/** The two committed states: a fresh install and a configured one. */
const STATES = [
	"backend-settings-registry",
	"backend-settings-registry-configured",
];
const read = (name) =>
	JSON.parse(readFileSync(`scripts/fixtures/${name}.json`, "utf8"));

const fixtures = STATES.map((name) => ({ name, payload: read(name) }));

const keys = (payload) => payload.settings.map((setting) => setting.key).sort();
const sectionNames = (payload) =>
	payload.sections.map((section) => section.name);

/* ------------------------------------------------------------------ *
 * Coverage
 * ------------------------------------------------------------------ */

test("every key the wire can produce resolves to a tier", () => {
	for (const { name, payload } of fixtures) {
		for (const setting of payload.settings) {
			const tier = tierFor(setting);
			assert.ok(
				tier === "core" || tier === "advanced",
				`${name}: ${setting.key} resolved to ${tier}`,
			);
		}
	}
});

test("the two fixture states name the same keys", () => {
	assert.deepEqual(
		keys(fixtures[0].payload),
		keys(fixtures[1].payload),
		"the fresh and configured fixtures disagree on the registry's key set, so one of them is stale",
	);
});

/*
 * The arm the fixture cannot provide: the REGISTRY this app talks to.
 *
 * Everything above reads the fixture. This reads `settings_io.SETTINGS` through
 * the backend's own projection, so a key or a section the fixture does not
 * describe is caught here — which is the failure the whole file exists for and
 * the one it could not see (QA round 1, Q1: three keys and a `desktop` section
 * absent from the fixture, no assertion red).
 */
test("the fixtures describe the registry the backend actually ships", (t) => {
	const live = readRegistryProjection();
	if (!live) {
		t.skip(
			"no backend registry is reachable, so the fixtures were NOT compared to one — install the runtime (`lop-update`) or set LOCAL_OPERATOR_BACKEND_PYTHON to check this",
		);
		return;
	}
	for (const [state, name] of [
		["fresh", "backend-settings-registry"],
		["configured", "backend-settings-registry-configured"],
	]) {
		const committed = fixtures.find((fixture) => fixture.name === name).payload;
		const served = live[state];
		assert.deepEqual(
			keys(served),
			keys(committed),
			`${name}.json does not describe the registry ${live.interpreter} serves — re-run \`node scripts/derive-backend-settings-fixture.mjs\` and classify whatever it newly carries`,
		);
		assert.deepEqual(
			sectionNames(served),
			sectionNames(committed),
			`${name}.json's section list does not match the registry ${live.interpreter} serves`,
		);
	}
});

test("KEY_TIER classifies every key the wire names", () => {
	for (const { name, payload } of fixtures) {
		for (const setting of payload.settings) {
			assert.ok(
				Object.hasOwn(KEY_TIER, setting.key),
				`${name}: ${setting.key} is not in KEY_TIER - decide its tier (a key nobody classified silently lands under Advanced)`,
			);
		}
	}
});

test("KEY_TIER holds no key the wire has dropped", () => {
	const known = new Set(
		fixtures[1].payload.settings.map((setting) => setting.key),
	);
	for (const key of Object.keys(KEY_TIER)) {
		assert.ok(
			known.has(key),
			`KEY_TIER still classifies ${key}, which the registry no longer names - remove it or refresh the fixture`,
		);
	}
});

/* ------------------------------------------------------------------ *
 * The resolution rule
 * ------------------------------------------------------------------ */

test("an unclassified key fails closed to advanced", () => {
	assert.equal(
		tierFor({ key: "some.future.key", section: "openrouter" }),
		"advanced",
	);

	// The section fallback is the belt for a key the curation missed, and it
	// only exists where a section's members genuinely agree: a split section
	// must NOT promote its tuning keys.
	assert.equal(
		tierFor({ key: "some.future.key", section: "web_tools" }),
		"core",
	);
	assert.equal(
		tierFor({ key: "web_search.some_future_scalar", section: "web_search" }),
		"advanced",
	);

	// Every section the cache names has to be a real one, or the fallback
	// becomes a map of typos that never matches.
	const sections = new Set(
		fixtures[1].payload.sections.map((section) => section.name),
	);
	for (const section of Object.keys(SECTION_TIER)) {
		assert.ok(
			sections.has(section),
			`SECTION_TIER names the section ${section}, which the registry no longer has`,
		);
	}
});

test("the wire's own field wins when a server carries one", () => {
	// The fast-follow backend field is what removes this map. Until it ships,
	// this is the seam that says which answer wins when both exist.
	assert.equal(
		tierFor({ key: "hosting", section: "model", tier: "advanced" }),
		"advanced",
	);
	assert.equal(
		tierFor({ key: "retry.maxRetries", section: "failover", tier: "core" }),
		"core",
	);
	// An absent or unrecognised field is not an opinion.
	assert.equal(
		tierFor({ key: "hosting", section: "model", tier: null }),
		"core",
	);
	assert.equal(
		tierFor({ key: "hosting", section: "model", tier: "expert" }),
		"core",
	);
});

/* ------------------------------------------------------------------ *
 * The arrival layout this map produces
 * ------------------------------------------------------------------ */

test("arrival opens the core-heavy sections and nothing else", () => {
	const payload = fixtures[1].payload;
	const bySection = new Map();
	for (const setting of payload.settings) {
		const rows = bySection.get(setting.section) ?? [];
		rows.push(setting);
		bySection.set(setting.section, rows);
	}
	const open = [...bySection]
		.filter(([, rows]) => opensOnArrival(rows))
		.map(([section]) => section)
		.sort();
	assert.deepEqual(open, ["approvals", "fork", "model", "web_tools"]);
	assert.equal(opensOnArrival([]), false, "an empty section is not open");
});

/*
 * The arrival tab order, re-derived for the registry that actually ships.
 *
 * The spec's `<= 30` was arithmetic, not a preference: 18 section headers + the
 * 5 filter-bar controls (search, `Modified`, `Show advanced`, `Expand all`,
 * `Collapse all`) + the 7 rows the arrival sections show. QA measured 31 and was
 * right to (round 1, Q2) — the registry had grown a nineteenth section, so the
 * same sum produced one more focusable. The budget is therefore stated as the
 * SUM it always was and asserted against the fixture, so a registry that grows
 * another section fails here rather than quietly raising the tab order, and the
 * code is not left claiming a target it does not meet.
 */
const FILTER_BAR_CONTROLS = 5;
const ARRIVAL_FOCUSABLE_BUDGET = 31;

/*
 * The reader's own sequence: collapse the index, then search it.
 *
 * `Collapse all` used to seed the FILTER's collapse set with the sections holding
 * core rows, on the reading that a press before a query should also shape the
 * query's view. The filtered view reads that set as "the reader shut this
 * section", so the press suppressed the force-open a search performs: `Collapse
 * all` then `provider` reported "35 results in 6 sections" with two matched
 * sections collapsed and 30 rows rendered, and with the tier shown it rendered no
 * rows at all under a count of 35. Both reviewers reproduced it, and QA ran the
 * same command on the pre-remediation tree to prove the line is what introduced
 * it (UX round 2 U13, QA round 2 Q8). The mirror-image half: a press made WHILE a
 * query is up must not decide the reader's layout once the query is cleared
 * (U14).
 */
test("Collapse all, then a query: the query still force-opens what it matched", () => {
	const names = ["model", "approvals", "fork", "web_tools"];

	const beforeQuery = allOpenTargets(false, false, names);
	assert.deepEqual(
		beforeQuery.layout?.closed,
		names,
		"an unfiltered press is about the whole list",
	);
	assert.deepEqual(
		beforeQuery.filter,
		[],
		"an unfiltered press leaves the filter's set EMPTY, so the next search can force-open what it matched",
	);

	const duringQuery = allOpenTargets(false, true, ["model", "web_search"]);
	assert.equal(
		duringQuery.layout,
		null,
		"a press made while a query is up must not rewrite the reader's own layout",
	);
	assert.deepEqual(
		duringQuery.filter,
		["model", "web_search"],
		"it collapses the list on screen, which the filter's own set records",
	);
	assert.deepEqual(
		allOpenTargets(true, true, ["model", "web_search"]).filter,
		[],
		"Expand all clears the filtered collapses",
	);
	assert.deepEqual(
		allOpenTargets(true, false, names).layout?.opened,
		names,
		"an unfiltered Expand all opens the list it is about",
	);
});

test("the arrival tab order stays inside its budget", () => {
	const payload = fixtures[1].payload;
	const bySection = new Map();
	for (const setting of payload.settings) {
		const rows = bySection.get(setting.section) ?? [];
		rows.push(setting);
		bySection.set(setting.section, rows);
	}
	const arrivalRows = [...bySection.values()]
		.filter((rows) => opensOnArrival(rows))
		.flatMap((rows) => rows.filter((setting) => tierFor(setting) === "core"));
	const total =
		payload.sections.length + FILTER_BAR_CONTROLS + arrivalRows.length;
	assert.equal(
		total,
		ARRIVAL_FOCUSABLE_BUDGET,
		`the closed default state costs ${total} focusables (${payload.sections.length} headers + ${FILTER_BAR_CONTROLS} filter-bar controls + ${arrivalRows.length} arrival rows); the budget is ${ARRIVAL_FOCUSABLE_BUDGET}`,
	);
});

test("the core tier is small enough to be an everyday list", () => {
	const core = Object.entries(KEY_TIER)
		.filter(([, tier]) => tier === "core")
		.map(([key]) => key);
	// The budget, not a preference: the arrival frame at 1380x900 has to hold
	// the filter row, 19 headers and these rows inside 1,600px, and the closed
	// default state has to stay inside its own budget (asserted above).
	assert.ok(
		core.length >= 8 && core.length <= 20,
		`the core tier is ${core.length} keys; the arrival layout is budgeted for 8-20`,
	);
});
