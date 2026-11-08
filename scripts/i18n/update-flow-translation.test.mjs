/**
 * THE UPDATE FLOW'S 48 KEYS ARE REALLY TRANSLATED IN EVERY SHIPPED LOCALE.
 *
 * WHY THIS FILE EXISTS. `scripts/update-flow-keying.test.mjs` proves the update
 * flow's producers resolve through `t()`, but it can only use a marker locale: it
 * cannot tell a translation from the runtime's per-key English fallback. The
 * parity gates (`check-coverage`, `locale-parity`) prove each locale carries the
 * KEYS; they do not prove a value was translated rather than copied, and a
 * translator (or a merge) that pasted the English sentence back would pass them
 * while a French window read an English update reason - the exact failure this
 * slice exists to remove. This file closes that gap at the bundled-catalogue seam
 * the app actually ships.
 *
 * WHAT IS ASSERTED, for every `supported` locale in `i18n/languages.json` (the
 * shipped manifest, NOT a hand list here, so a locale added later is covered
 * without editing this file) and every key of the three update-flow namespaces
 * (`ui.updates.service`, `ui.updates.status`, `ui.installer.setup_cause`; the key
 * set is read from the English catalogues on disk, and its size is pinned so a
 * silently dropped namespace cannot weaken the test):
 *  1. the generated `bundledCatalogues[locale]` (what `t()` reads) holds the key
 *     as a non-empty string;
 *  2. that string differs from the English one, unless the key is listed in
 *     `IDENTICAL_BY_DESIGN` with the reason the value is the same in that locale.
 *
 * `IDENTICAL_BY_DESIGN` is deliberately empty today: the audited translations
 * differ from English for all 48 keys in all seven locales. An entry would be
 * for a value that is only tokens (a bare `{version}`) or a loanword that is
 * spelled the same; each needs a reason, and a stale entry (a key that is not an
 * update-flow key, or whose value in that locale now differs) fails so the list
 * cannot grow into a blanket exemption.
 *
 * NOT PROVEN HERE: that a translation is good. That is the independent audit's
 * job (receipts in `i18n/receipts/`, rows in `i18n/ledger.json`, narrative in
 * `docs/i18n/update-flow-provenance.md`); this is only the mechanical
 * "it is not English" floor.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const NAMESPACES = [
	"ui.updates.service",
	"ui.updates.status",
	"ui.installer.setup_cause",
];
const EXPECTED_KEY_COUNT = 48;

/**
 * `"<locale>/<key>": "<why the translated value legitimately equals English>"`.
 * Empty on purpose; see the header.
 * @type {Record<string, string>}
 */
const IDENTICAL_BY_DESIGN = {};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const manifest = readJson(join(ROOT, "i18n", "languages.json"));
const shipped = manifest.languages
	.filter((row) => row.status === "supported")
	.map((row) => row.code);

const englishKeys = NAMESPACES.flatMap((namespace) =>
	Object.keys(
		readJson(
			join(ROOT, "src", "i18n", "catalogues", "en", `${namespace}.json`),
		),
	),
);

const bundle = await build({
	stdin: {
		contents: `export { bundledCatalogues, bundledEnglish } from "./src/i18n/keys.gen";`,
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".json": "json" },
});
const { bundledCatalogues, bundledEnglish } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("the manifest names the seven shipped locales and the slice has 48 keys", () => {
	assert.ok(shipped.length >= 7, `shipped locales: ${shipped.join(", ")}`);
	assert.equal(new Set(englishKeys).size, englishKeys.length);
	assert.equal(englishKeys.length, EXPECTED_KEY_COUNT);
});

for (const locale of shipped) {
	test(`${locale}: every update-flow key is a translation, not English`, () => {
		const catalogue = bundledCatalogues[locale];
		assert.ok(catalogue, `${locale} has no bundled catalogue`);
		const untranslated = [];
		for (const key of englishKeys) {
			const value = catalogue[key];
			assert.equal(typeof value, "string", `${locale}/${key} is not a string`);
			assert.ok(value.trim().length > 0, `${locale}/${key} is empty`);
			assert.equal(typeof bundledEnglish[key], "string", `en/${key} missing`);
			if (
				value === bundledEnglish[key] &&
				!IDENTICAL_BY_DESIGN[`${locale}/${key}`]
			)
				untranslated.push(key);
		}
		assert.deepEqual(
			untranslated,
			[],
			`${locale} paints English for: ${untranslated.join(", ")}`,
		);
	});
}

test("IDENTICAL_BY_DESIGN holds only live, reasoned entries", () => {
	for (const [id, reason] of Object.entries(IDENTICAL_BY_DESIGN)) {
		const [locale, ...rest] = id.split("/");
		const key = rest.join("/");
		assert.ok(shipped.includes(locale), `${id}: ${locale} is not shipped`);
		assert.ok(englishKeys.includes(key), `${id}: not an update-flow key`);
		assert.ok(reason.trim().length > 0, `${id}: needs a reason`);
		assert.equal(
			bundledCatalogues[locale][key],
			bundledEnglish[key],
			`${id}: now differs from English - delete the exemption`,
		);
	}
});
