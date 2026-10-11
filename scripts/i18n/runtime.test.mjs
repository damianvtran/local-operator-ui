import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The catalogue runtime and the locale store, executed in Node.
 *
 * The bundled ENGLISH catalogue is empty at U0 (no extraction slice has landed
 * yet), so the en-bundle lookup path is proven in `typed-keys.test.mjs` — which
 * renders through a fixture catalogue the generator bundled. THIS suite proves
 * the other half of the resolution order: registered catalogues win over the
 * bundle, lookups merge namespace by namespace, the active locale decides what
 * `t()`/`translate()` read, and every failure mode degrades to the key rather
 * than throwing through a render path.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { messages, locale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("the store starts on the device locale, under Node's own navigator", () => {
	// Node ships `navigator.language`; the pre-connection rule is to use it
	// verbatim, un-normalised — the exact value every migrated site read.
	const state = locale.currentLocaleState();
	assert.equal(state.locale, globalThis.navigator.language);
	assert.equal(state.source, "device");
});

test("resolveLocale: the backend answer wins only with the feature and a non-empty language", () => {
	assert.deepEqual(
		locale.resolveLocale({ features: { i18n: 1 }, language: "fr" }),
		{
			locale: "fr",
			source: "backend",
		},
	);
	// An older backend without the feature keeps the device locale.
	assert.equal(
		locale.resolveLocale({ features: {}, language: "fr" }).source,
		"device",
	);
	// A blank tag is not an answer.
	assert.equal(
		locale.resolveLocale({ features: { i18n: 1 }, language: "  " }).source,
		"device",
	);
	// Absent capabilities are the pre-connection case.
	assert.equal(locale.resolveLocale(undefined).source, "device");
});

test("applyCapabilities moves the store, notifies once, and ignores identical answers", () => {
	const seen = [];
	const unsubscribe = locale.subscribeLocale(() =>
		seen.push(locale.currentLocale()),
	);
	try {
		locale.applyCapabilities({ features: { i18n: 1 }, language: "fr" });
		assert.equal(locale.currentLocale(), "fr");
		assert.equal(locale.currentLocaleState().source, "backend");
		assert.deepEqual(seen, ["fr"]);
		// The capabilities query re-polls; an identical answer must not wake
		// every consumer.
		locale.applyCapabilities({ features: { i18n: 1 }, language: "fr" });
		assert.deepEqual(seen, ["fr"]);
		// An answer without the feature re-resolves to the device.
		locale.applyCapabilities({ features: {} });
		assert.equal(locale.currentLocale(), globalThis.navigator.language);
		assert.equal(seen.length, 2);
	} finally {
		unsubscribe();
		locale.applyCapabilities(null);
	}
});

test("registered catalogues win over the bundle, and merge namespace by namespace", () => {
	try {
		messages.registerCatalogue("fr", { "demo.a": "A-fr" });
		messages.registerCatalogue("fr", { "demo.b": "B-fr" });
		assert.equal(messages.translate("demo.a", {}, "fr"), "A-fr");
		assert.equal(messages.translate("demo.b", {}, "fr"), "B-fr");
		// A key in no catalogue of that locale degrades to the KEY (the
		// bundled en catalogue is empty at U0; the bundle path itself is
		// proven in typed-keys.test.mjs).
		assert.equal(messages.translate("demo.absent", {}, "fr"), "demo.absent");
	} finally {
		messages.clearRegisteredCatalogues();
	}
});

test("translate renders ICU through the real runtime, and degrades instead of throwing", () => {
	try {
		// The active locale is the RAW device tag pre-connection ("en-US" under
		// Node), which is why this case pins "en" explicitly rather than
		// assuming the bundle's spelling: the lookup is per-locale first, the
		// en bundle second.
		locale.setLocale("en");
		messages.registerCatalogue("en", {
			"demo.hello": "Hello, {name}!",
			"demo.count": "{count, plural, one {# file} other {# files}}",
			"demo.bad": "{unclosed",
		});
		assert.equal(
			messages.translate("demo.hello", { name: "Ada" }),
			"Hello, Ada!",
		);
		assert.equal(messages.translate("demo.count", { count: 1 }), "1 file");
		assert.equal(messages.translate("demo.count", { count: 5 }), "5 files");
		// A malformed catalogue entry is a build-time defect (the catalogue
		// checks catch it); at render time it degrades to the key.
		assert.equal(messages.translate("demo.bad"), "demo.bad");
		// A missing required argument degrades the same way.
		assert.equal(messages.translate("demo.hello"), "demo.hello");
	} finally {
		messages.clearRegisteredCatalogues();
		locale.applyCapabilities(null);
	}
});

test("translate resolves the active locale when none is pinned", () => {
	try {
		messages.registerCatalogue("fr", { "demo.a": "A-fr" });
		locale.setLocale("fr");
		assert.equal(messages.translate("demo.a"), "A-fr");
	} finally {
		messages.clearRegisteredCatalogues();
		locale.applyCapabilities(null);
	}
});
