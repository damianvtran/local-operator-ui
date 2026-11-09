/** Real skill-completion hook and popup held unavailable across a locale change. No layout claim. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const DESKTOP_HOOKS_MODULE = /desktop-hooks$/;
const PAIRING_CAUSE_MODULE = /use-pairing-cause$/;
const ANY_MODULE = /.*/;
const TOAST_MANAGER_MODULE = /@shared\/utils\/toast-manager/;

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
			`import React from 'react';
                 import { useSkillCompletion, SkillSuggestionsPopup } from './src/renderer/src/features/chat/components/skill-picker';
                 export { QueryClient, QueryClientProvider } from '@tanstack/react-query';
                 const commandNames = new Set(); const argumentWords = [];
                 export function PickerFixture() {
                   const state = useSkillCompletion({text: '$', caret: 1, cwd: '~', attached: false, commandNames, argumentWords, enabled: true});
                   return React.createElement(SkillSuggestionsPopup, {state, onPick() {}});
                 }`,
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
				builder.onResolve({ filter: DESKTOP_HOOKS_MODULE }, (args) =>
					args.importer.endsWith("skill-picker.tsx")
						? { path: "capabilities", namespace: "unavailable" }
						: null,
				);
				builder.onResolve({ filter: PAIRING_CAUSE_MODULE }, (args) =>
					args.importer.endsWith("skill-picker.tsx")
						? { path: "pairing", namespace: "unavailable" }
						: null,
				);
				builder.onLoad(
					{ filter: ANY_MODULE, namespace: "unavailable" },
					(args) => ({
						loader: "js",
						contents:
							args.path === "capabilities"
								? 'const answer = {data: {}}; export const useDesktopCapabilities = () => answer; export const desktopFeatureState = () => "below-version";'
								: "export const usePairingCause = () => null;",
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
	PickerFixture,
	QueryClient,
	QueryClientProvider,
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

test("the already-open unavailable skill popup refreshes its memoized notice", async () => {
	setLocale("en");
	registerCatalogue("fr", {
		"ui.chat.slash.skill.unavailable": "Fixture unavailable skills",
	});
	const english = t("ui.chat.slash.skill.unavailable");
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	try {
		await act(async () =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(PickerFixture),
				),
			),
		);
		assert.ok(
			host.querySelector('[role="listbox"]'),
			"a leading $ opens the real unavailable popup",
		);
		assert.ok(
			host.textContent.includes(english),
			"the durable notice is present before switching locale",
		);
		await act(async () => setLocale("fr"));
		assert.ok(
			host.textContent.includes("Fixture unavailable skills"),
			`memoized notice must invalidate, not just popup chrome; actual: ${host.textContent}`,
		);
		await act(async () => setLocale("en"));
		assert.ok(host.textContent.includes(english));
	} finally {
		await act(async () => root.unmount());
		client.clear();
		host.remove();
		clearRegisteredCatalogues();
		setLocale("en");
	}
});
