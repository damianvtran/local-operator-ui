import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const runtimeBundle = await build({
	stdin: {
		contents:
			'export { t } from "./src/i18n/messages"; export { setLocale } from "./src/i18n/locale";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { t, setLocale } = await import(
	`data:text/javascript;base64,${Buffer.from(runtimeBundle.outputFiles[0].text).toString("base64")}`
);
setLocale("en");

for (const count of [0, 1, 2, 1000]) {
	test(`exact English shell count clauses at ${count}`, () => {
		assert.equal(
			t("ui.shell.sidebar_navigation.aida_missed", {
				name: "Synthetic Aida",
				count,
			}),
			`Synthetic Aida, ${count} missed message${count === 1 ? "" : "s"}`,
		);
		for (const [kind, label] of [
			["browser", "Browser"],
			["mesh", "Mesh"],
		]) {
			assert.equal(
				t(`ui.shell.sidebar_navigation.${kind}_waiting`, {
					count,
					countText: String(count),
				}),
				`${label}, ${count} waiting`,
			);
		}
	});
}

test("valid free-text selection is a forms hint, not an error", () => {
	assert.equal(
		t("ui.common.forms.select.unlisted_value"),
		"Not in any listing; saved as typed.",
	);
});
