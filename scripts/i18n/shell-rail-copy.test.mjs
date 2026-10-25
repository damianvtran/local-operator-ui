import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

// Compile only the real label derivation, not the native/DOM rail harness.
// This is display-copy evidence; focus, placement and pixel proof remain QA's.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/shared/components/navigation/panel-rail-model";',
			'export { setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"@features": join(process.cwd(), "src/renderer/src/features"),
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
	},
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
model.setLocale("en");

for (const open of [false, true]) {
	for (const cap of [null, "⌘P"]) {
		for (const count of [0, 1, 2, 1000]) {
			test(`English browser/console/canvas: open=${open}, cap=${cap}, count=${count}`, () => {
				const verb = open ? "Close" : "Open";
				const chord = cap ? ` (${cap})` : "";
				assert.deepEqual(model.browserRailLabels(open, count, cap), {
					tooltip: `${verb} browser${chord}${count ? ` — ${count} ${count === 1 ? "approval" : "approvals"} waiting` : ""}`,
					aria: `Browser${chord}${count ? `, ${count} waiting` : ""}`,
				});
				assert.deepEqual(model.consoleRailLabels(open, count, cap), {
					tooltip: `${verb} console${chord}${count ? ` — ${count} finished since you looked` : ""}`,
					aria: `Console${chord}${count ? `, ${count} finished since you looked` : ""}`,
				});
				assert.deepEqual(model.canvasRailLabels(open, count, cap), {
					tooltip: `${verb} canvas${chord}${count ? ` — ${count} ${count === 1 ? "file" : "files"}` : ""}`,
					aria: `Canvas${chord}${count ? `, ${count} ${count === 1 ? "file" : "files"}` : ""}`,
				});
			});
		}
	}
}

test("code details preserve optional halves, comma grammar and caller attention cause", () => {
	assert.deepEqual(model.codeRailLabels(false, 2, 1, "checks failing", "⌘R"), {
		tooltip: "Open code review (⌘R) — 2 opened, 1 mentioned, checks failing",
		aria: "Code review (⌘R), 2 opened, 1 mentioned, checks failing",
	});
	assert.deepEqual(model.codeRailLabels(true, 0, 0, null, null), {
		tooltip: "Close code review",
		aria: "Code review",
	});
	assert.equal(
		model.codeRailLabels(false, 1000, 0, null, null).aria,
		"Code review, 1000 opened",
	);
});

test("ask scope and tooltip stay delegated to their chat-owned derivation", () => {
	assert.deepEqual(model.askRailLabels(false, "session", 2, null), {
		tooltip: "Open asks — This conversation, 2 waiting",
		aria: "Asks, This conversation, 2 waiting",
	});
	assert.equal(
		model.askRailLabels(true, "fleet", 1000, "⌘A").aria,
		"Asks (⌘A), All conversations, 1000 waiting",
	);
});

test("tooltip action select and English missing-key fallback use the live locale", () => {
	/*
	 * `xx`, not `fr`: the French catalogue now ships `ui.shell.rail.browser.aria`
	 * ("Navigateur"), so a partial `fr` registration would render the bundled
	 * translation and the fallback assertion below would be testing nothing. The
	 * synthetic tag carries no bundled catalogue, so a miss is a real miss - the
	 * same premise `keyed-copy-behaviour.test.mjs` states with `xx` (888e1859c4).
	 */
	try {
		model.registerCatalogue("xx", {
			"ui.shell.rail.browser.tooltip":
				"{state, select, open {fixture close{chord}} other {fixture open{chord}}}",
		});
		model.setLocale("xx");
		assert.equal(
			model.browserRailLabels(true, 0, null).tooltip,
			"fixture close",
		);
		assert.equal(
			model.browserRailLabels(false, 0, "⌘P").tooltip,
			"fixture open (⌘P)",
		);
		assert.equal(model.browserRailLabels(true, 0, null).aria, "Browser");
	} finally {
		model.clearRegisteredCatalogues();
		model.setLocale("en");
	}
});
