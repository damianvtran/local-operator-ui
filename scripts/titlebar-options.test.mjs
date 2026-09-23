import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { contentGeometryMatches } from "./renderer-content-geometry.mjs";

const DRAG_REGION_RULE =
	/\[data-titlebar-platform="mac"\][\s\S]*?\[data-titlebar-drag\]\s*\{\s*-webkit-app-region:\s*drag;/;
const NO_DRAG_RULE = /-webkit-app-region:\s*no-drag;/;
const COLLAPSED_CHAT_HEADING_SAFE_AREA =
	/\[data-titlebar-platform="mac"\]\s+\[data-titlebar-sidebar-collapsed="true"\]\s+\[data-titlebar-chat-heading\]\s*\{\s*padding-left:\s*2rem;/;
const BANNER_BACKGROUND_RULE =
	/\[data-titlebar-platform="mac"\]\s+\[data-titlebar-banner\]\s*\{[\s\S]*?background-image:\s*linear-gradient\(\s*to right,\s*var\(--color-canvas\)\s+0\s+80px,\s*transparent\s+80px\s*\);[\s\S]*?padding-left:\s*80px;/;
const CHAT_HEADER_SAFE_AREA_SELECTOR = '[data-tour-tag="chat-header"]';
const GLOBAL_DRAG_RULE =
	/(?:^|\n)\s*(?:html|body|#app|main)\s*\{[^}]*-webkit-app-region:\s*drag/m;

const bundle = await build({
	stdin: {
		contents: 'export { titlebarOptions } from "./src/main/titlebar-options";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { titlebarOptions } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("macOS hides the titlebar while retaining native traffic lights", () => {
	assert.deepEqual(titlebarOptions("darwin"), { titleBarStyle: "hidden" });
});

test("Windows, Linux, and other platforms keep their existing native titlebar", () => {
	for (const platform of ["win32", "linux", "freebsd", "openbsd"]) {
		assert.deepEqual(titlebarOptions(platform), {});
	}
});

test("macOS hidden-titlebar content exactly fills the window", () => {
	const windowSize = { width: 1380, height: 900 };
	const facts = (contentBounds) => ({
		platform: "darwin",
		windowSize,
		contentBounds,
	});

	assert.equal(
		contentGeometryMatches(facts({ width: 1380, height: 900 })),
		true,
	);
	for (const contentBounds of [
		{ width: 1379, height: 900 },
		{ width: 1380, height: 899 },
		{ width: 1380, height: 901 },
	]) {
		assert.equal(
			contentGeometryMatches(facts(contentBounds)),
			false,
			JSON.stringify(contentBounds),
		);
	}
});

test("Windows and Linux retain the bounded native-titlebar content inset", () => {
	const windowSize = { width: 1380, height: 900 };
	for (const platform of ["win32", "linux"]) {
		const matches = (contentBounds) =>
			contentGeometryMatches({ platform, windowSize, contentBounds });

		for (const height of [899, 860]) {
			assert.equal(
				matches({ width: 1380, height }),
				true,
				`${platform} ${height}`,
			);
		}
		for (const contentBounds of [
			{ width: 1380, height: 900 },
			{ width: 1380, height: 859 },
			{ width: 1379, height: 872 },
		]) {
			assert.equal(
				matches(contentBounds),
				false,
				`${platform} ${JSON.stringify(contentBounds)}`,
			);
		}
	}
});

test("macOS drag and safe areas are limited to existing empty shell headers", () => {
	const css = readFileSync("src/renderer/src/styles/index.css", "utf8");
	const shell = readFileSync("src/renderer/src/app.tsx", "utf8");
	const rail = readFileSync(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
		"utf8",
	);
	const connectivityBanner = readFileSync(
		"src/renderer/src/shared/components/common/connectivity-banner.tsx",
		"utf8",
	);
	const compatibilityBanner = readFileSync(
		"src/renderer/src/shared/components/common/backend-compatibility-banner.tsx",
		"utf8",
	);
	const chatHeader = readFileSync(
		"src/renderer/src/features/chat/components/chat-header.tsx",
		"utf8",
	);
	const desktopTests = readFileSync("package.json", "utf8");
	const chatSidebar = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);

	assert.match(css, DRAG_REGION_RULE);
	assert.match(css, NO_DRAG_RULE);
	assert.match(css, COLLAPSED_CHAT_HEADING_SAFE_AREA);
	assert.match(css, BANNER_BACKGROUND_RULE);
	assert.ok(!css.includes(CHAT_HEADER_SAFE_AREA_SELECTOR));
	assert.ok(chatHeader.includes('data-tour-tag="chat-header"'));
	assert.ok(shell.includes("data-titlebar-platform="));
	assert.ok(rail.includes("data-titlebar-rail-header"));
	assert.ok(rail.includes("data-titlebar-collapsed-toggle-row"));
	assert.ok(rail.includes("aria-expanded={expanded}"));
	assert.ok(rail.includes("aria-label={toggleLabel}"));
	assert.ok(rail.includes('<Tooltip content={toggleLabel} side="right">'));
	assert.ok(!rail.includes("data-titlebar-expand-slot"));
	assert.ok(chatSidebar.includes("data-titlebar-chat-heading"));
	assert.ok(connectivityBanner.includes('data-titlebar-banner=""'));
	assert.ok(compatibilityBanner.includes('data-titlebar-banner=""'));
	assert.ok(chatHeader.includes('data-titlebar-no-drag=""'));
	assert.ok(desktopTests.includes("scripts/titlebar-options.test.mjs"));
	assert.doesNotMatch(css, GLOBAL_DRAG_RULE);
});
