#!/usr/bin/env node
/**
 * Focused RTL contracts for the surfaces left physical by the shell slice.
 * Behavioural helpers are executed; DOM geometry remains rendered-app evidence.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `export {
			physicalScrollEdges,
			pointerIsAfterTab,
		} from "./src/renderer/src/features/browser/components/browser-tab-direction";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
});
const module_ = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, {
	module: module_,
	exports: module_.exports,
});
const { physicalScrollEdges, pointerIsAfterTab } = module_.exports;

const source = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("browser overflow uses Chromium's negative RTL scrollLeft at both edges", () => {
	const cases = [
		[0, "ltr", false, true],
		[300, "ltr", true, false],
		[0, "rtl", true, false],
		[-300, "rtl", false, true],
		[-150, "rtl", true, true],
	];
	for (const [scrollLeft, direction, left, right] of cases) {
		const actual = physicalScrollEdges(scrollLeft, 200, 500, direction);
		assert.equal(actual.left, left, `${direction} scrollLeft=${scrollLeft}`);
		assert.equal(actual.right, right, `${direction} scrollLeft=${scrollLeft}`);
	}
});

test("browser drop-after follows DOM order rather than physical right", () => {
	assert.equal(pointerIsAfterTab(175, 150, "ltr"), true);
	assert.equal(pointerIsAfterTab(125, 150, "ltr"), false);
	assert.equal(pointerIsAfterTab(125, 150, "rtl"), true);
	assert.equal(pointerIsAfterTab(175, 150, "rtl"), false);
});

test("deferred overlays and sheets use logical inline edges", () => {
	const dialog = source("src/renderer/src/shared/components/ui/dialog.tsx");
	assert.match(dialog, /absolute top-4 end-4/);
	assert.match(dialog, /gap-1\.5 pe-8/);

	const sheet = source("src/renderer/src/shared/components/ui/sheet.tsx");
	assert.match(sheet, /start:\s*"inset-y-0 start-0 .*border-e"/);
	assert.match(sheet, /end:\s*"inset-y-0 end-0 .*border-s"/);
	assert.match(sheet, /absolute top-4 end-4/);

	const options = source(
		"src/renderer/src/features/chat/components/chat-options-sidebar.tsx",
	);
	assert.match(options, /<SheetContent\s+side="end"/);
	const library = source(
		"src/renderer/src/features/library/components/library-page.tsx",
	);
	assert.match(library, /<SheetContent\s+side="start"/);
});

test("update cards, floating alerts and filter rows mirror", () => {
	const update = source(
		"src/renderer/src/shared/components/common/update-notification.tsx",
	);
	assert.match(update, /fixed top-4 end-4/);
	assert.match(update, /absolute top-2 end-2/);
	const alert = source(
		"src/renderer/src/shared/components/common/floating-alert.tsx",
	);
	assert.match(alert, /fixed end-4 bottom-4/);
	assert.match(alert, /relative pe-10/);
	const filters = source(
		"src/renderer/src/features/library/components/library-filter-rail.tsx",
	);
	assert.match(filters, /text-start text-body-sm/);
	assert.match(filters, /indent && "ps-6"/);
});

test("shell tooltips and directional icons follow the inline axis", () => {
	const sidebar = source(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(sidebar, /side=\{rtl \? "left" : "right"\}/);
	const rail = source(
		"src/renderer/src/shared/components/navigation/panel-rail-item.tsx",
	);
	assert.match(rail, /side=\{direction === "rtl" \? "right" : "left"\}/);
	const menu = source(
		"src/renderer/src/shared/components/ui/dropdown-menu.tsx",
	);
	assert.match(menu, /ChevronRight\s+className="ms-auto .*rtl:-scale-x-100"/);
	const media = source(
		"src/renderer/src/features/library/components/pptx-viewer.tsx",
	);
	assert.doesNotMatch(media, /rtl:-scale-x-100/);
});

test("technical and directional surfaces keep their physical semantics", () => {
	const address = source(
		"src/renderer/src/features/browser/components/browser-url-bar.tsx",
	);
	assert.match(address, /dir="ltr"/);
	assert.match(address, /pr-7 pl-8/);
	const timeline = source(
		"src/renderer/src/features/projects/components/project-timeline.tsx",
	);
	assert.match(timeline, /sticky left-0/);
	const mesh = source("src/renderer/src/features/mesh/mesh-canvas.tsx");
	assert.match(mesh, /absolute top-0 left-0/);
});
