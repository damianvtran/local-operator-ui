/*
 * The key→source map is the thing that decides whether five registry rows get
 * a combobox at all, and it is curated — so the only interesting failure is
 * silent drift in one direction.
 *
 * An unclassified key needs no assertion: it degrades to the plain text field
 * the row has always rendered, which is correct, and that is why this map has
 * no completeness test the way `backend-settings-tiers.test.mjs` does. The
 * direction that DOES need one is the other: a key named here that the registry
 * no longer sends would be an entry that silently stops doing anything, and
 * nothing in the product would look wrong.
 *
 * The map is exercised through the SHIPPED module rather than a copy of it —
 * the bundle below imports the same `backend-setting-combos.ts` the section
 * does — so a second source of truth cannot pass this test while the settings
 * page disagrees with it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/backend-setting-combos";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	// The shipped map now resolves labels through the renderer's i18n binding;
	// use the same alias as the application rather than stubbing translation.
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const { COMBO_PLACEHOLDER, SETTING_COMBOS, settingComboSource } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The two committed states: a fresh install and a configured one. */
const STATES = [
	"backend-settings-registry",
	"backend-settings-registry-configured",
];
const read = (name) =>
	JSON.parse(readFileSync(`scripts/fixtures/${name}.json`, "utf8"));

const fixtures = STATES.map((name) => ({ name, payload: read(name) }));
const rows = (payload) => payload.settings;

test("every key the map names is a key the wire actually sends", () => {
	for (const { name, payload } of fixtures) {
		const keys = new Set(rows(payload).map((setting) => setting.key));
		for (const key of Object.keys(SETTING_COMBOS)) {
			assert.ok(
				keys.has(key),
				`${name}: SETTING_COMBOS names ${key}, which the registry does not send - a stale entry that silently does nothing`,
			);
		}
	}
});

test("each of the five rows resolves to the source its stored shape needs", () => {
	// `hosting` holds a bare provider id; `model_name` holds a bare model id;
	// the subagent tiers hold the full `provider/model` selector. The three are
	// not interchangeable and the backend does not normalise between them.
	assert.equal(settingComboSource("hosting"), "provider");
	assert.equal(settingComboSource("model_name"), "model");
	for (const key of [
		"subagents.models.lo",
		"subagents.models.med",
		"subagents.models.hi",
	]) {
		assert.equal(settingComboSource(key), "provider-model", key);
	}
});

test("the map covers the five rows and nothing else", () => {
	assert.deepEqual(Object.keys(SETTING_COMBOS).sort(), [
		"hosting",
		"model_name",
		"subagents.models.hi",
		"subagents.models.lo",
		"subagents.models.med",
	]);
});

test("an unclassified key keeps the plain text field", () => {
	// Not an error and not a default: `web_search.providers` is a
	// comma-separated ordered list, `bash.shell` is a path, and a combobox is
	// the wrong control for both.
	assert.equal(settingComboSource("web_search.providers"), null);
	assert.equal(settingComboSource("bash.shell"), null);
	assert.equal(settingComboSource("retry.fallbackChains"), null);
});

const assertNoMeaningfulRowPlaceholder = (setting, name) => {
	assert.ok(
		setting.placeholder === undefined ||
			setting.placeholder === null ||
			setting.placeholder === "",
		`${name}: ${setting.key} carries meaningful placeholder ${JSON.stringify(setting.placeholder)} — revisit the constant's authority if the actual wire begins supplying one`,
	);
};

test("every kind has a placeholder, and it cannot come from the row", () => {
	for (const [kind, placeholder] of Object.entries(COMBO_PLACEHOLDER)) {
		assert.ok(placeholder.length > 0, `${kind} has no placeholder`);
	}
	/*
	 * The trap this guards. Older wire rows omitted `placeholder`; the actual
	 * current public GET /v1/settings and _view.model_dump serialize the empty
	 * string default. Both mean NO meaningful server placeholder, not a new
	 * source for the control. Accept exactly absent/null/empty, never generic
	 * falsiness or a nonempty future server value. The full authoritative
	 * fixtures retain the wire's empty string rather than hiding it.
	 */
	for (const { name, payload } of fixtures) {
		for (const setting of rows(payload)) {
			if (!settingComboSource(setting.key)) continue;
			assertNoMeaningfulRowPlaceholder(setting, name);
			assert.notEqual(
				COMBO_PLACEHOLDER[settingComboSource(setting.key)],
				setting.placeholder,
			);
		}
	}
});

test("the row-placeholder guard rejects a meaningful future value, not just truthy values", () => {
	for (const placeholder of [undefined, null, ""])
		assert.doesNotThrow(() =>
			assertNoMeaningfulRowPlaceholder(
				{ key: "hosting", placeholder },
				"control",
			),
		);
	for (const placeholder of ["Future server search prompt", " ", false, 0])
		assert.throws(() =>
			assertNoMeaningfulRowPlaceholder(
				{ key: "hosting", placeholder },
				"counterfactual",
			),
		);
});
