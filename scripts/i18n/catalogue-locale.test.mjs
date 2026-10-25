import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE DEVICE TAG -> CATALOGUE TAG RULE, executed against the real generated
 * bundles.
 *
 * The bug this pins: the locale store keeps `navigator.language` verbatim
 * (`fr-FR`), the copy runtime keyed its catalogue maps with that exact string,
 * and no bundle is named `fr-FR` — so a French, Spanish, Russian, Hindi, Urdu,
 * Vietnamese or Chinese (Simplified) device rendered ENGLISH before a backend
 * answered, silently, because per-key English fallback is correct for a locale
 * that lacks a translation.
 *
 * The truth table is asserted directly on `resolveCatalogueLocale`, then the
 * same tags are pushed through `translate()` so a rule that is right but not
 * wired into the lookup still fails here. The companion lane
 * `device-tag-activation.test.mjs` carries the same cases WITHOUT importing
 * this module, which is what makes it runnable against the pre-fix tree as a
 * failing control.
 *
 * Chinese is the branch that cannot be primary-subtag only: Simplified tags map
 * to the `zh-CN` bundle, and a Traditional tag (`zh-TW`, `zh-Hant`, `zh-HK`,
 * `zh-MO`) resolves to English rather than to Simplified copy — showing the
 * wrong script is worse than showing the source locale. See the module's
 * docstring for the difference from the core's literal `zh` rule and why the
 * backend's answer still wins once negotiation happens.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as catalogue from "./src/i18n/catalogue-locale";',
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: new URL("../../", import.meta.url).pathname,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { catalogue, messages, locale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("a region-qualified device tag resolves to its language's catalogue", () => {
	for (const [tag, expected] of [
		["fr-FR", "fr"],
		["fr-CA", "fr"],
		["es-MX", "es"],
		["es-419", "es"],
		["ru-RU", "ru"],
		["hi-IN", "hi"],
		["ur-PK", "ur"],
		["vi-VN", "vi"],
		// The source locale's regions are still the source locale.
		["en-US", "en"],
		["en-GB", "en"],
	]) {
		assert.equal(catalogue.resolveCatalogueLocale(tag), expected, tag);
	}
});

test("a catalogue's own spelling wins, case-insensitively and through POSIX forms", () => {
	assert.equal(catalogue.resolveCatalogueLocale("fr"), "fr");
	assert.equal(catalogue.resolveCatalogueLocale("FR"), "fr");
	assert.equal(catalogue.resolveCatalogueLocale("Fr-fR"), "fr");
	// POSIX spellings reach `setLocale` from fixtures and from `LANG`-shaped
	// values; `_` is a separator and the encoding/modifier suffix is not a tag.
	assert.equal(catalogue.resolveCatalogueLocale("fr_FR"), "fr");
	assert.equal(catalogue.resolveCatalogueLocale("en_US.UTF-8"), "en");
	assert.equal(catalogue.resolveCatalogueLocale("fr_CA@euro"), "fr");
	// A trailing separator is not a subtag, and neither is empty space.
	assert.equal(catalogue.resolveCatalogueLocale("fr-"), "fr");
	assert.equal(catalogue.resolveCatalogueLocale("  fr-CA  "), "fr");
});

test("Chinese resolves by script: Simplified maps to zh-CN, Traditional to the source", () => {
	for (const tag of [
		"zh",
		"zh-CN",
		"zh-cn",
		"zh-Hans",
		"zh-Hans-CN",
		"zh-SG",
	]) {
		assert.equal(catalogue.resolveCatalogueLocale(tag), "zh-CN", tag);
	}
	for (const tag of ["zh-TW", "zh-Hant", "zh-Hant-TW", "zh-HK", "zh-MO"]) {
		assert.equal(catalogue.resolveCatalogueLocale(tag), "en", tag);
	}
});

test("a language this client carries no catalogue for falls back to the source", () => {
	for (const tag of ["pt-BR", "de", "ja-JP", "tr-TR", "", "   ", "und"]) {
		assert.equal(
			catalogue.resolveCatalogueLocale(tag),
			"en",
			JSON.stringify(tag),
		);
	}
	/*
	 * An extension or private-use singleton is not a plain base-language request:
	 * `fr-x-source-fallback` is the tag `features/settings/settings-i18n.test.mjs`
	 * uses to prove the per-key fallback, and assertions there rely on it landing
	 * on English copy AND English plural rules. Mapping it to French would make
	 * that suite's premise false while looking like a fix.
	 */
	for (const tag of ["fr-x-source-fallback", "ur-x-latn", "en-u-ca-buddhist"]) {
		assert.equal(catalogue.resolveCatalogueLocale(tag), "en", tag);
	}
});

test("translate() uses the canonical catalogue, and never the raw region tag", () => {
	// `ui.settings.page.title` is carried by every bundled locale, so an English
	// answer here can only mean the lookup missed the bundle.
	const key = "ui.settings.page.title";
	const english = messages.translate(key, {}, "en");
	for (const [device, language] of [
		["fr-FR", "fr"],
		["es-MX", "es"],
		["ru-RU", "ru"],
		["hi-IN", "hi"],
		["ur-PK", "ur"],
		["vi-VN", "vi"],
		["zh-Hans", "zh-CN"],
	]) {
		const rendered = messages.translate(key, {}, device);
		assert.equal(rendered, messages.translate(key, {}, language), device);
		assert.notEqual(rendered, english, `${device} must not render English`);
	}
	// Traditional Chinese renders the source locale — not Simplified copy.
	assert.equal(messages.translate(key, {}, "zh-TW"), english);
	assert.notEqual(
		messages.translate(key, {}, "zh-TW"),
		messages.translate(key, {}, "zh-CN"),
	);
});

test("the served seam keeps its own key: a catalogue registered under the raw tag wins", () => {
	try {
		/*
		 * `registerCatalogue` is keyed by the tag the SERVER served, and harness
		 * fixtures use synthetic tags (`scripts/i18n/absent-locale.mjs`) that
		 * canonicalise to `en`. The raw tag must therefore still be tried first,
		 * or those registrations become unreachable and every per-key fallback
		 * assertion quietly starts reading English.
		 */
		messages.registerCatalogue("fr-FR", { "demo.region": "Served-fr-FR" });
		messages.registerCatalogue("fr", { "demo.language": "Served-fr" });
		assert.equal(
			messages.translate("demo.region", {}, "fr-FR"),
			"Served-fr-FR",
		);
		// A key only the canonical catalogue carries is still found.
		assert.equal(messages.translate("demo.language", {}, "fr-FR"), "Served-fr");
		// And an unrelated region sees neither.
		assert.equal(
			messages.translate("demo.language", {}, "es-MX"),
			"demo.language",
		);
	} finally {
		messages.clearRegisteredCatalogues();
		locale.applyCapabilities(null);
	}
});
