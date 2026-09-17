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

test("every kind has a placeholder, and it cannot come from the row", () => {
	for (const [kind, placeholder] of Object.entries(COMBO_PLACEHOLDER)) {
		assert.ok(placeholder.length > 0, `${kind} has no placeholder`);
	}
	/*
	 * The trap this guards. The released `_view` projects no `placeholder` for
	 * these rows, so a placeholder read from the row would be absent for every
	 * user while looking right in a frame that carried one. The fixtures are the
	 * best available stand-in for the wire here, and the fact to pin is that
	 * they carry none for these five keys — which is exactly why the constant
	 * exists rather than a fallback onto `setting.placeholder`.
	 */
	for (const { name, payload } of fixtures) {
		for (const setting of rows(payload)) {
			if (!settingComboSource(setting.key)) continue;
			assert.ok(
				setting.placeholder === undefined || setting.placeholder === null,
				`${name}: ${setting.key} carries the placeholder ${JSON.stringify(setting.placeholder)} — if the wire really sends one, the constant is the wrong source and this test says so`,
			);
			assert.notEqual(
				COMBO_PLACEHOLDER[settingComboSource(setting.key)],
				setting.placeholder,
			);
		}
	}
});
