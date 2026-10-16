import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const BUTTON_IMPORT = /^@shared\/components\/ui$/;
const ANY_MODULE = /.*/;
/* Source SSR only: real menu/model/runtime, isolated button primitive. No browser
 * layout, native popover focus or persisted preference write is claimed here. */
const bundle = await build({
	stdin: {
		contents: `
			import React from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { ChatSidebarViewMenu } from "./src/renderer/src/features/chat/components/chat-sidebar-view-menu";
			import { DEFAULT_SIDEBAR_VIEW } from "./src/renderer/src/features/chat/chat-sidebar-view";
			export * from "./src/i18n";
			export const menu = (hidden = []) => renderToStaticMarkup(React.createElement(ChatSidebarViewMenu, {view: {...DEFAULT_SIDEBAR_VIEW, hidden}, onView() {}}));
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	jsx: "automatic",
	format: "cjs",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
	plugins: [
		{
			name: "isolated-button",
			setup(build) {
				build.onResolve({ filter: BUTTON_IMPORT }, (args) => ({
					path: args.path,
					namespace: "copy-fixture",
				}));
				build.onLoad({ filter: ANY_MODULE, namespace: "copy-fixture" }, () => ({
					contents:
						'import React from "react"; export const Button = ({children, variant, size, ...props}) => React.createElement("button", props, children);',
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const compiled = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	createRequire(import.meta.url),
	compiled,
	compiled.exports,
);
const ui = compiled.exports;

test("menu preserves all English groups, choices, section labels and reorder names", () => {
	ui.setLocale("en");
	const html = ui.menu();
	for (const text of [
		"Group by",
		"Time basis",
		"Order by",
		"Sections",
		"Time section",
		"Agent and team",
		"In one list",
		"Last active",
		"Created",
		"Active first",
		"Most recent",
		"Dates and ordering follow the selected clock.",
		"Pinned",
		"Running",
		"Today",
		"This week",
		"Older",
		"Agents",
		"Teams",
	])
		assert.ok(html.includes(text), text);
	assert.ok(html.includes('aria-label="Move Today up"'));
	assert.ok(html.includes('aria-label="Move Today down"'));
});
test("hidden-section ICU count preserves English zero, one, two and one thousand; zero footer stays absent", () => {
	ui.setLocale("en");
	for (const [count, text] of [
		[0, "0 sections hidden"],
		[1, "1 section hidden"],
		[2, "2 sections hidden"],
		[1000, "1000 sections hidden"],
	])
		assert.equal(ui.t("ui.chat.sidebar_view.hidden", { count }), text);
	assert.ok(!ui.menu().includes("sections hidden"));
	assert.ok(ui.menu(["today"]).includes("1 section hidden"));
	assert.ok(ui.menu(["today", "week"]).includes("2 sections hidden"));
});
test("registered section labels feed parameterized reorder names with per-key fallback", () => {
	ui.registerCatalogue("fr", {
		"ui.chat.sidebar_view.section.today": "Today test",
		"ui.chat.sidebar_view.move_up": "Up test {section}",
	});
	ui.setLocale("fr");
	const html = ui.menu();
	assert.ok(html.includes('aria-label="Up test Today test"'));
	assert.ok(html.includes('aria-label="Move Today test down"'));
	assert.ok(html.includes("Pinned"));
	ui.clearRegisteredCatalogues();
	ui.setLocale("en");
});
