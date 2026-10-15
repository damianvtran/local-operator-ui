import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Fixture-only activation misses a forgotten locale import. Bundle the actual
// generated module so these assertions fail if Spanish ships as English again.
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

test("shipped Spanish covers settings, console and onboarding and switches back", () => {
	locale.setLocale("es");
	assert.equal(messages.t("ui.settings.page.title"), "Ajustes");
	assert.equal(messages.t("ui.console.pane.label"), "Consola");
	assert.equal(
		messages.t("ui.onboarding.modal.step_of", { current: 2, total: 5 }),
		"Paso 2 de 5",
	);
	console.log("es: Ajustes | Consola | Paso 2 de 5");
	locale.setLocale("en");
	assert.equal(messages.t("ui.settings.page.title"), "Settings");
	assert.equal(messages.t("ui.console.pane.label"), "Console");
	console.log("en: Settings | Console");
});

test("Spanish placeholders use Spanish rules; uncarried namespaces use English rules", () => {
	locale.setLocale("es");
	const formatted = messages.t("ui.console.capacity.summary_compact_bare", {
		live: 1234567,
		limit: 2000000,
	});
	const esNumber = new Intl.NumberFormat("es");
	assert.equal(
		formatted,
		`${esNumber.format(1234567)}/${esNumber.format(2000000)}`,
	);
	assert.notEqual(formatted, "1,234,567/2,000,000");
	// Canvas is intentionally uncarried: source selection must also select the
	// English formatter, rather than mixing English prose with Spanish numbers.
	const fallback = messages.t("ui.canvas.files.count", { count: 1234567 });
	assert.equal(fallback, "1,234,567 files");
	assert.equal(
		fallback,
		messages.translate("ui.canvas.files.count", { count: 1234567 }, "en"),
	);
	console.log(
		`es placeholder: ${formatted}; English fallback ui.canvas.files.count: ${fallback}`,
	);
});
