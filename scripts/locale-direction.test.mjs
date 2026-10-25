#!/usr/bin/env node
/**
 * Portalled menus inherit the locale direction, executable (design round 1, D1).
 *
 * WHAT THIS PROVES AND WHAT IT CANNOT: Radix derives a menu's direction from its
 * `DirectionProvider` context, not from `<html dir>` - the content is portalled
 * out of the subtree that inherits the root attribute. This file mounts the SHIPPED
 * `LocaleDirectionProvider` around a real `DropdownMenu` in jsdom and reads the
 * `dir` attribute Radix writes on the portalled content:
 *
 *   - ur -> `rtl`, en -> `ltr` (the fix);
 *   - the SAME tree with no provider stays `ltr` while the locale says ur (the
 *     negative control - without it, a `dir` that came from somewhere else
 *     would read as a pass).
 *
 * Bidi RESOLUTION inside the content is the renderer's job and is not asserted
 * here; the pixels belong to QA's rendered frames. `bdi`/isolation ordering is
 * jsdom's own `dir` handling, pinned separately in `rtl-layout.test.mjs`.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><body></body>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
for (const name of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Event",
	"MouseEvent",
	"Node",
	"MutationObserver",
	"CustomEvent",
	"KeyboardEvent",
	"FocusEvent",
]) {
	globalThis[name] = dom.window[name];
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const { createRoot } = await import("react-dom/client");
/* Inside the checkout so the bundle's bare imports resolve from the repo's
 * node_modules; removed on exit so a crashed run cannot dirty the tree. */
const scratch = await mkdtemp(
	join(process.cwd(), "node_modules", ".locale-direction-test-"),
);
process.on("exit", () => {
	void rm(scratch, { recursive: true, force: true });
});
const outfile = join(scratch, "bundle.mjs");

const bundle = await build({
	stdin: {
		contents: `export { LocaleDirectionProvider } from "./src/renderer/src/shared/i18n/locale-direction";
			export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./src/renderer/src/shared/components/ui/dropdown-menu";`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	/*
	 * The provider's direction hook reads the locale store, which needs the whole
	 * i18n backend bridge. The test is about RADIX's inheritance, not about the
	 * store (that is `document-direction.test.mjs`), so the hook is stubbed to a
	 * value the test sets: the provider under test is still the shipped component
	 * and the Radix tree is the shipped primitive.
	 */
	plugins: [
		{
			/* One React instance: the bundle must import it at runtime, not embed a
			 * second copy whose dispatcher is null against this file's react-dom. */
			name: "installed-packages-are-external",
			setup(b) {
				b.onResolve({ filter: /^[^./]/ }, (args) => {
					if (args.path.startsWith("@shared")) return undefined;
					return { path: args.path, external: true };
				});
			},
		},
		{
			name: "direction-stub",
			setup(b) {
				b.onResolve({ filter: /use-document-direction$/ }, () => ({
					path: "direction-stub",
					namespace: "stub",
				}));
				b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
					contents:
						"export const useTextDirection = () => globalThis.__direction;",
					loader: "js",
				}));
			},
		},
	],
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	write: false,
});
const { writeFile } = await import("node:fs/promises");
await writeFile(outfile, bundle.outputFiles[0].text);
const {
	LocaleDirectionProvider,
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} = await import(pathToFileURL(outfile).href);

/** Mount the shipped primitives; `withProvider` is the only difference between runs. */
async function openMenu({ withProvider, direction }) {
	globalThis.__direction = direction;
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	const tree = React.createElement(
		DropdownMenu,
		{ defaultOpen: true },
		React.createElement(DropdownMenuTrigger, null, "open"),
		React.createElement(
			DropdownMenuContent,
			null,
			React.createElement(DropdownMenuItem, null, "Item"),
		),
	);
	await act(async () => {
		root.render(
			withProvider
				? React.createElement(LocaleDirectionProvider, null, tree)
				: tree,
		);
	});
	const content = document.querySelector("[data-radix-menu-content]");
	assert.ok(content, "the menu content mounted");
	const found = content.getAttribute("dir");
	const item = document.querySelector('[role="menuitem"]');
	await act(async () => root.unmount());
	host.remove();
	return { dir: found, itemClass: item?.className ?? "" };
}

test("the portalled menu inherits the Urdu direction from the app provider", async () => {
	const { dir } = await openMenu({ withProvider: true, direction: "rtl" });
	assert.equal(dir, "rtl");
});

test("the same provider keeps English on ltr", async () => {
	const { dir } = await openMenu({ withProvider: true, direction: "ltr" });
	assert.equal(dir, "ltr");
});

test("without the provider Radix falls back to ltr - the negative control", async () => {
	const { dir } = await openMenu({ withProvider: false, direction: "rtl" });
	assert.equal(
		dir,
		"ltr",
		"Radix's fallback is what the app inherited before the provider; a provider that stopped supplying dir would read here",
	);
});
