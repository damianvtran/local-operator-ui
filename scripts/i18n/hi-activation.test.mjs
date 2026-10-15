import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// A fixture-only pass misses a forgotten generated import. Exercise the actual
// bundled catalogues so locale publication cannot silently remain English.
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

test("shipped Hindi covers all three surfaces and switches back to English", () => {
	locale.setLocale("hi");
	assert.equal(messages.t("ui.settings.page.title"), "सेटिंग्स");
	assert.equal(messages.t("ui.console.pane.label"), "कंसोल");
	assert.equal(
		messages.t("ui.onboarding.modal.step_of", { current: 2, total: 5 }),
		"चरण 2, कुल 5",
	);
	console.log("hi" + ": " + "सेटिंग्स" + " | " + "कंसोल" + " | " + "चरण 2, कुल 5");
	locale.setLocale("en");
	assert.equal(messages.t("ui.settings.page.title"), "Settings");
	assert.equal(messages.t("ui.console.pane.label"), "Console");
	console.log("en: Settings | Console");
});

test("local number placeholders and English-source fallback retain their own formatting", () => {
	locale.setLocale("hi");
	const formatted = messages.t("ui.console.capacity.summary_compact_bare", {
		live: 1234567,
		limit: 2000000,
	});
	const number = new Intl.NumberFormat("hi");
	assert.equal(
		formatted,
		`${number.format(1234567)}/${number.format(2000000)}`,
	);
	// Canvas is not carried: English source must use English number formatting,
	// even while the active locale uses different grouping or native digits.
	const fallback = messages.t("ui.canvas.files.count", { count: 1234567 });
	assert.equal(fallback, "1,234,567 files");
	assert.equal(
		fallback,
		messages.translate("ui.canvas.files.count", { count: 1234567 }, "en"),
	);
	console.log(
		`local placeholder: ${formatted}; English fallback ui.canvas.files.count: ${fallback}`,
	);
});
