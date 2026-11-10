/**
 * The page menu's "Extensions" submenu, mounted in jsdom.
 *
 * WHY THIS TEST EXISTS (local-operator-ui 0.53.0, operator report: "I can't
 * actually click the button"). `DropdownMenuSubContent` rendered IN PLACE, as a
 * DOM descendant of the parent menu panel. Radix positions a sub panel with
 * `position: fixed`, and `position: fixed` resolves against the nearest
 * ancestor with a `transform`/`filter`/`backdrop-filter`. On glass the parent
 * panel itself wears `backdrop-filter: blur(12px)` (`[data-glass-overlay]` in
 * `styles/index.css`), so it became the sub panel's containing block, and its
 * `overflow-hidden` clipped the whole sub panel away: the row highlighted, the
 * submenu "opened" invisibly, and the pointer travelling toward it left the
 * trigger for nothing, which closed it. Keyboard Enter still "worked" because
 * focus moved into the clipped panel — which is why PR #1821's native QA filed
 * the pointer failure as a simulation artefact.
 *
 * jsdom has no layout, so the clip itself is the Storybook/native frame's
 * evidence. What IS decidable here is the cause: the sub panel must not be a
 * descendant of the parent panel (it is portalled to <body>), and choosing a
 * row in it must still reach its handler and keep the submenu's own focus and
 * keyboard contract (ArrowRight opens it).
 *
 * The harness is `account-profile-editor-dom.test.mjs`'s: an esbuild bundle
 * with React external, jsdom installed before the bundle is evaluated.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { BrowserExtensionsSubmenu } from "./src/renderer/src/features/browser/components/browser-extensions-menu";',
			'export { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem } from "./src/renderer/src/shared/components/ui/dropdown-menu";',
			'export { createElement } from "react";',
			'export { createRoot } from "react-dom/client";',
			'export { act } from "react";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	tsconfig: "tsconfig.app.json",
});
const bundlePath = new URL(
	`./_dropdown-submenu-portal-dom-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = dom;
const shims = {
	window,
	document: window.document,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => setTimeout(callback, 0),
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
};
for (const key of [
	"Element",
	"Node",
	"NodeList",
	"DocumentFragment",
	"ShadowRoot",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLDivElement",
	"HTMLSpanElement",
	"HTMLImageElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"SVGElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"Event",
	"CustomEvent",
	"MutationObserver",
]) {
	if (key in window) shims[key] = window[key];
}
// jsdom has no PointerEvent; Radix reads `pointerType` off a MouseEvent fine.
shims.PointerEvent ??= window.MouseEvent;
window.PointerEvent ??= window.MouseEvent;
const originals = new Map();
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.HTMLElement.prototype.scrollIntoView ??= () => {};
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.releasePointerCapture ??= () => {};

const {
	BrowserExtensionsSubmenu,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	DropdownMenuItem,
	createElement: h,
	createRoot,
	act,
} = await import(bundlePath.href);

after(async () => {
	await unlink(bundlePath).catch(() => {});
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	window.close();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountPageMenu(calls) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			h(
				DropdownMenu,
				{ open: true, onOpenChange: () => {} },
				h(DropdownMenuTrigger, null, "More"),
				h(
					DropdownMenuContent,
					{ align: "end", "data-testid": "page-menu" },
					h(DropdownMenuItem, null, "Find in page"),
					h(BrowserExtensionsSubmenu, {
						extensions: [
							{
								id: "aeblfdkhhhdcdjpifhhbdiojplfjncoa",
								name: "1Password",
								hasPopup: true,
							},
						],
						onOpenPopup: (extension) => calls.push(`popup:${extension.name}`),
						onManage: () => calls.push("manage"),
						onOpenStore: () => calls.push("store"),
					}),
				),
			),
		);
		await tick();
	});
	return { host, root };
}

/* Unmount even when an assertion fails: a menu left mounted by one test is a
 * second copy of every row the next test queries (portals live on <body>). */
async function withPageMenu(run) {
	const calls = [];
	const { host, root } = await mountPageMenu(calls);
	try {
		await run(calls);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

const subTrigger = () =>
	document.querySelector('[data-tour-tag="browser-extensions-menu"]');
const manageRow = () =>
	document.querySelector('[data-tour-tag="browser-extensions-manage"]');

async function openSubWithArrowRight() {
	const trigger = subTrigger();
	assert.ok(trigger, "the Extensions row renders in the page menu");
	await act(async () => {
		trigger.focus();
		trigger.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
		);
		await tick();
	});
}

test("the Extensions submenu is portalled out of the page menu's panel", () =>
	withPageMenu(async () => {
		await openSubWithArrowRight();
		const row = manageRow();
		assert.ok(row, "ArrowRight opens the submenu and shows Manage extensions…");
		const parentPanel = document.querySelector('[data-testid="page-menu"]');
		const subPanel = row.closest('[role="menu"]');
		assert.ok(parentPanel && subPanel, "both menu panels are mounted");
		assert.notEqual(subPanel, parentPanel);
		// THE regression: inside the parent panel, the parent's backdrop-filter +
		// overflow-hidden clip the sub panel to nothing on glass.
		assert.equal(
			parentPanel.contains(subPanel),
			false,
			"the sub panel must not be a DOM descendant of the parent panel",
		);
		// It still carries the floating-panel markers the shared rules read.
		assert.ok(subPanel.hasAttribute("data-glass-overlay"));
		assert.ok(subPanel.hasAttribute("data-lo-floating"));
		assert.ok(subPanel.hasAttribute("data-titlebar-no-drag"));
	}));

/* Portalling moves the sub panel out of the parent's DOM subtree; these pin
 * that its rows still reach their handlers through Radix's React context. */
for (const [tag, expected] of [
	["browser-extensions-manage", "manage"],
	["browser-extensions-store", "store"],
]) {
	test(`choosing ${tag} reaches its handler`, () =>
		withPageMenu(async (calls) => {
			await openSubWithArrowRight();
			const row = document.querySelector(`[data-tour-tag="${tag}"]`);
			assert.ok(row, `${tag} renders`);
			await act(async () => {
				row.click();
				await tick();
			});
			assert.deepEqual(calls, [expected]);
		}));
}

test("an extension row opens that extension's popup", () =>
	withPageMenu(async (calls) => {
		await openSubWithArrowRight();
		const row = [...document.querySelectorAll('[role="menuitem"]')].find(
			(item) => item.textContent?.includes("1Password"),
		);
		assert.ok(row, "the installed extension is listed");
		await act(async () => {
			row.click();
			await tick();
		});
		assert.deepEqual(calls, ["popup:1Password"]);
	}));
