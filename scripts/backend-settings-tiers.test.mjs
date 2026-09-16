/*
 * The tier map is only worth having if it cannot go stale in silence.
 *
 * `KEY_TIER` decides which of the 99 registry rows a user meets on arrival and
 * which sit one click away. It cannot be inferred from `kind` (that is "how a
 * value is EDITED") or from `is_default` (a value comparison), so it is curated
 * — and a curated map drifts the moment the registry gains a key nobody
 * classified. The failure mode of that drift is invisible: the new key lands
 * under Advanced, still searchable and still writable, and nobody ever notices
 * it was never decided on.
 *
 * The detector is the committed fixture (`scripts/fixtures/backend-settings-registry*.json`,
 * the real `/v1/settings` projection), asserted three ways here: every key the
 * wire can produce resolves to a tier, neither map holds a key the wire no
 * longer names, and the fallback for an unclassified key is `advanced`. Refresh
 * the fixture — the only time the wire can have changed — and this file turns
 * red until the new keys are classified.
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
const { KEY_TIER, SECTION_TIER, opensOnArrival, tierFor } = module;

/** The two committed states: a fresh install and a configured one. */
const STATES = [
	"backend-settings-registry",
	"backend-settings-registry-configured",
];
const read = (name) =>
	JSON.parse(readFileSync(`scripts/fixtures/${name}.json`, "utf8"));

const fixtures = STATES.map((name) => ({ name, payload: read(name) }));

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
	const keys = (payload) =>
		payload.settings.map((setting) => setting.key).sort();
	assert.deepEqual(
		keys(fixtures[0].payload),
		keys(fixtures[1].payload),
		"the fresh and configured fixtures disagree on the registry's key set, so one of them is stale",
	);
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

test("the core tier is small enough to be an everyday list", () => {
	const core = Object.entries(KEY_TIER)
		.filter(([, tier]) => tier === "core")
		.map(([key]) => key);
	// The budget, not a preference: the arrival frame at 1380x900 has to hold
	// the filter row, 18 headers and these rows inside 1,600px, and the closed
	// default state has to stay inside 30 focusables.
	assert.ok(
		core.length >= 8 && core.length <= 20,
		`the core tier is ${core.length} keys; the arrival layout is budgeted for 8-20`,
	);
});
