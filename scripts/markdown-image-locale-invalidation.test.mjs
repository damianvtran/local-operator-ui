/** Real memoized markdown image, open menu held across a locale change. No layout claim. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
/*
 * Node defines `navigator` and much of the DOM surface as getters that refuse
 * assignment, so the element constructors and events are taken from jsdom only
 * where Node has not already claimed the name. React DOM needs the constructors
 * and events; forcing the node-owned ones is what breaks the bundled scheduler.
 */
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
];
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that refuse to leave their context; none is needed here.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
dom.window.Element.prototype.scrollIntoView = () => {};

/** Toasts the component raised, as `[kind, message]`. */
const toasts = [];
globalThis.__localeInvalidationToasts = toasts;

const built = await build({
	stdin: {
		contents: [
			"export * as React from 'react';",
			"export { act } from 'react';",
			"export { createRoot } from 'react-dom/client';",
			"export { MarkdownRenderer } from './src/renderer/src/features/chat/components/markdown-renderer';",
			"export { t, setLocale, registerCatalogue, clearRegisteredCatalogues, currentLocale } from './src/i18n';",
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	jsx: "automatic",
	legalComments: "none",
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
		"@renderer": `${process.cwd()}/src/renderer/src`,
	},
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	plugins: [
		{
			name: "toast-recorder",
			setup(builder) {
				// Images never load Mermaid. Keep its uncalled dynamic engine out
				// of this fixture so failure stacks fit the host's 1 GB guard.
				builder.onResolve({ filter: /^mermaid$/ }, () => ({
					path: "engine",
					namespace: "unused-engine",
				}));
				builder.onLoad({ filter: /.*/, namespace: "unused-engine" }, () => ({
					loader: "js",
					contents: "export default {}",
				}));
				builder.onResolve({ filter: /@shared\/utils\/toast-manager/ }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						const record = (kind, message) => {
							(globalThis.__localeInvalidationToasts ??= []).push([kind, message]);
						};
						export const showSuccessToast = (message) => record("success", message);
						export const showErrorToast = (message) => record("error", message);
						export const showInfoToast = (message) => record("info", message);
						export const showWarningToast = (message) => record("warning", message);
						export const dismissToast = () => {};
						export const resetToastDedup = () => {};
					`,
				}));
			},
		},
	],
});
const {
	act,
	createRoot,
	MarkdownRenderer,
	React,
	t,
	setLocale,
	registerCatalogue,
	clearRegisteredCatalogues,
} = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

after(() => {
	/*
	 * Release the scheduler's ref'd MessagePorts: with them open the runner
	 * prints its summary and the process stays alive. This is teardown, not a
	 * forced green — every case has reported by the time it runs.
	 */
	for (const handle of process._getActiveHandles?.() ?? []) {
		try {
			if (handle?.constructor?.name === "MessagePort") handle.close();
		} catch {
			// A handle that refuses to close is not this suite's to force.
		}
	}
	dom.window.close();
});

test("an open markdown image menu refreshes through the memoized component map", async () => {
	setLocale("en");
	registerCatalogue("fr", {
		"ui.chat.image_actions.copy_image_url": "Fixture image URL",
		"ui.chat.image_actions.open_in_browser": "Fixture browser",
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () =>
			root.render(
				React.createElement(MarkdownRenderer, {
					content: "![shot](https://example.test/image.png)",
					linkify: false,
				}),
			),
		);
		const trigger = container.querySelector("[data-markdown-image] button");
		assert.ok(trigger, "the shipped markdown img map mounts its image menu");
		await act(async () =>
			trigger.dispatchEvent(
				new window.MouseEvent("pointerdown", {
					bubbles: true,
					button: 0,
					ctrlKey: false,
				}),
			),
		);
		assert.match(document.body.textContent, /Copy image URL/);
		await act(async () => setLocale("fr"));
		assert.match(
			document.body.textContent,
			/Fixture image URL/,
			"already-open image menu must invalidate without changing markdown props",
		);
		assert.match(document.body.textContent, /Fixture browser/);
	} finally {
		await act(async () => root.unmount());
		container.remove();
		clearRegisteredCatalogues();
		setLocale("en");
	}
});
