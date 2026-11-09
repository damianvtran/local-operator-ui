/** Real memoized Mermaid boundary, caught fallback held across a locale change. No layout claim. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const MERMAID_MODULE = /^mermaid$/;
const ANY_MODULE = /.*/;
const APPEARANCE_MODULE = /use-resolved-appearance$/;
const TOAST_MANAGER_MODULE = /@shared\/utils\/toast-manager/;
const RENDER_FAILURE = /fixture render failure/;
const ENGLISH_DIAGRAM_ERROR = /Mermaid diagram error/;
const FRENCH_DIAGRAM_ERROR = /Fixture diagram error/;
const FRENCH_CONTAINED = /Fixture contained/;

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
			"export { MermaidDiagram } from './src/renderer/src/features/chat/components/mermaid-diagram';",
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
				// The core throws before diagram loading; do not bundle the unrelated
				// Mermaid engine into this boundary-only fixture under the 1 GB guard.
				builder.onResolve({ filter: MERMAID_MODULE }, () => ({
					path: "engine",
					namespace: "unused-engine",
				}));
				builder.onLoad(
					{ filter: ANY_MODULE, namespace: "unused-engine" },
					() => ({
						loader: "js",
						contents: "export default {}",
					}),
				);
				builder.onResolve({ filter: APPEARANCE_MODULE }, () => ({
					path: "appearance",
					namespace: "force-error",
				}));
				builder.onLoad(
					{ filter: ANY_MODULE, namespace: "force-error" },
					() => ({
						loader: "js",
						contents:
							'export function useResolvedAppearance() { throw new Error("fixture render failure"); }',
					}),
				);
				builder.onResolve({ filter: TOAST_MANAGER_MODULE }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: ANY_MODULE, namespace: "fixture" }, () => ({
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
	MermaidDiagram,
	React,
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

test("the contained Mermaid fallback refreshes after its subscribing core unmounts", async () => {
	setLocale("en");
	registerCatalogue("fr", {
		"ui.chat.mermaid.error_title": "Fixture diagram error",
		"ui.chat.mermaid.error_contained": "Fixture contained",
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const originalError = console.error;
	const errors = [];
	console.error = (...args) => errors.push(args);
	try {
		await act(async () =>
			root.render(
				React.createElement(MermaidDiagram, { chart: "graph TD; A-->B" }),
			),
		);
		assert.match(
			container.textContent,
			RENDER_FAILURE,
			"the real boundary caught the injected render failure",
		);
		assert.match(container.textContent, ENGLISH_DIAGRAM_ERROR);
		assert.ok(errors.length > 0, "React reported the caught rendering error");
		await act(async () => setLocale("fr"));
		assert.match(
			container.textContent,
			FRENCH_DIAGRAM_ERROR,
			"fallback must subscribe independently of its unmounted core",
		);
		assert.match(container.textContent, FRENCH_CONTAINED);
		assert.match(
			container.textContent,
			RENDER_FAILURE,
			"language change must not reset boundary state",
		);
	} finally {
		console.error = originalError;
		await act(async () => root.unmount());
		container.remove();
		clearRegisteredCatalogues();
		setLocale("en");
	}
});
