import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * ACTIVATION FROM A REAL DEVICE TAG, before any backend answers.
 *
 * The locale store keeps `navigator.language` verbatim (`./src/i18n/locale`), so
 * a French device's ACTIVE tag is `fr-FR`, a Spanish one `es-MX`, an Urdu one
 * `ur-PK`. Until a backend answers capabilities, `t()` is the only thing
 * rendering copy — and it used to key its catalogues with that raw string, which
 * no bundle is named, so every one of those devices rendered English. Silent,
 * because a per-key English fallback is the correct degradation for a locale
 * that genuinely lacks a translation.
 *
 * This lane imports ONLY modules that exist before the fix (`messages`,
 * `locale`), which is the point: it is the failing-before / passing-after
 * control. Run it against a tree without the canonicalisation and the assertions
 * below fail with English where a translation is expected; no assertion here
 * names the new module, so the failure is the bug rather than a missing import.
 *
 * The expected values are derived from each language's own bundle render rather
 * than pinned to a translated string, so a translator's wording change does not
 * break this lane; what it pins is WHICH catalogue answered.
 */

const bundle = await build({
	stdin: {
		contents: [
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
const { messages, locale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Carried by every bundled locale, so an English answer means a missed lookup. */
const KEY = "ui.settings.page.title";

test("every shipped language renders from its real device tag", () => {
	const english = messages.translate(KEY, {}, "en");
	for (const [device, language] of [
		["fr-FR", "fr"],
		["fr-CA", "fr"],
		["es-MX", "es"],
		["ru-RU", "ru"],
		["hi-IN", "hi"],
		["ur-PK", "ur"],
		["vi-VN", "vi"],
		["zh-Hans", "zh-CN"],
		["zh-SG", "zh-CN"],
	]) {
		const rendered = messages.translate(KEY, {}, device);
		assert.notEqual(rendered, english, `${device} rendered English`);
		assert.equal(rendered, messages.translate(KEY, {}, language), device);
	}
});

test("a Traditional Chinese device gets English, never Simplified copy", () => {
	const english = messages.translate(KEY, {}, "en");
	const simplified = messages.translate(KEY, {}, "zh-CN");
	assert.notEqual(
		simplified,
		english,
		"the zh-CN bundle must be real, or this test is vacuous",
	);
	for (const device of ["zh-TW", "zh-Hant", "zh-HK", "zh-Hant-TW"]) {
		assert.equal(messages.translate(KEY, {}, device), english, device);
	}
});

test("the active locale is what renders, and the backend's answer still wins", () => {
	// The store's own setLocale: this is the reported path (`setLocale("fr-FR")`
	// rendered English), not a translate() with an explicit tag.
	locale.setLocale("fr-FR");
	assert.equal(locale.currentLocale(), "fr-FR");
	assert.equal(messages.t(KEY), messages.translate(KEY, {}, "fr"));

	// Unsupported device tag: the source locale, not a stale one.
	locale.setLocale("pt-BR");
	assert.equal(messages.t(KEY), messages.translate(KEY, {}, "en"));

	/*
	 * BACKEND TRUTH WINS AFTER NEGOTIATION. The canonicalisation is the
	 * pre-connection bootstrap only: a capabilities answer replaces the store
	 * outright, including an answer that disagrees with the device tag.
	 */
	locale.setLocale("fr-FR");
	locale.applyCapabilities({ features: { i18n: 1 }, language: "en" });
	assert.equal(locale.currentLocaleState().source, "backend");
	assert.equal(messages.t(KEY), messages.translate(KEY, {}, "en"));
	locale.applyCapabilities({ features: { i18n: 1 }, language: "zh-CN" });
	assert.equal(messages.t(KEY), messages.translate(KEY, {}, "zh-CN"));

	// Reset to the device bootstrap for the rest of the process.
	locale.applyCapabilities(null);
});
