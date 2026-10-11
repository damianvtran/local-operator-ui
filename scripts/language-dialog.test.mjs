/*
 * The palette's language dialog (i18n slice B2): the same enum + note as the
 * settings row, writing through the same seam.
 *
 * Two cases. The FIRST is the dialog's render contract: it opens closed,
 * shows the registry row's control and the `In effect:` note, and keeps Save
 * disabled while nothing is dirty. The SECOND exercises the extracted
 * `saveLanguageValue` seam - the exact function the Save button calls - and
 * proves the write reaches `settings.edit`, renegotiates the capabilities
 * chain, and moves the store (and the note) to the new language.
 *
 * WHY THE SEAM AND NOT A CLICKED PICKER: Radix's portalled listbox commits to
 * no synthetic event jsdom can produce (keyboard focus lands on the container,
 * mouse-typed pointer events, clicks and native-select bridging were each
 * tried), which is the same boundary `settings-language-row.test.mjs` records
 * for the settings row - where the reset button, not the picker, drives the
 * write. Extracting the save as a function keeps the clicked path honest: the
 * button's onClick is `saveLanguageValue({ value, queryClient })` and nothing
 * else.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
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
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// jsdom's accessors refuse out-of-context reads; the needed ones do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
bootstrapDOM.window.Element.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const apiCalls = [];
let capabilitiesLanguage = "en";
const setCapabilitiesLanguage = (language) => {
	capabilitiesLanguage = language;
};
globalThis.window.api = {
	desktop: {
		request: async (request) => {
			apiCalls.push({ ...request });
			if (request?.op === "capabilities") {
				return {
					status: 200,
					body: {
						result: {
							desktop_available: true,
							features: { settings: 1, i18n: 1 },
							language: capabilitiesLanguage,
						},
					},
				};
			}
			if (request?.op === "settings.list") {
				return {
					status: 200,
					body: {
						result: JSON.parse(
							readFileSync(
								"scripts/fixtures/backend-settings-registry-configured.json",
								"utf8",
							),
						),
					},
				};
			}
			return { status: 200, body: { result: {} } };
		},
	},
};

const bundle = await build({
	stdin: {
		contents: [
			'import { createElement } from "react";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
			'export { LanguageDialog, saveLanguageValue } from "./src/renderer/src/features/settings/components/language-dialog";',
			'export { useLanguageDialogStore } from "./src/renderer/src/features/settings/components/language-dialog-store";',
			'export { useI18nLocaleSync } from "./src/renderer/src/shared/i18n/locale-sync";',
			'export { applyCapabilities, currentLocale } from "./src/renderer/src/shared/i18n";',
			"export { createElement };",
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

const bundlePath = new URL("_language-dialog.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	LanguageDialog,
	saveLanguageValue,
	useLanguageDialogStore,
	useI18nLocaleSync,
	applyCapabilities,
	currentLocale,
} = await import(bundlePath.href);

/* The app mounts this once; without it nothing feeds the store. */
const LocaleSync = () => {
	useI18nLocaleSync();
	return null;
};

const settle = async (cond, note, ms = 5000) => {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (cond()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	}
	assert.ok(cond(), note);
};

const TEST_TIMEOUT_MS = 60_000;

const mount = async (t) => {
	applyCapabilities(null);
	setCapabilitiesLanguage("en");
	apiCalls.length = 0;
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			gcTime: 0,
		},
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		try {
			await act(async () => {
				root.unmount();
			});
		} finally {
			client.clear();
		}
		container.remove();
	});
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(
					React.Fragment,
					null,
					createElement(LanguageDialog, null),
					createElement(LocaleSync, null),
				),
			),
		);
	});
	return { client };
};

test(
	"the dialog shows the row's control and note, closed until asked, Save clean",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t);
		assert.equal(document.querySelector('[role="dialog"]'), null);

		await act(async () => {
			useLanguageDialogStore.getState().openLanguage();
		});
		await settle(
			() => Boolean(document.querySelector("#setting-effective-language")),
			"the same note as the row must render",
		);
		await settle(() => currentLocale() === "en", "the store must be seeded");
		assert.ok(
			document.body.textContent.includes("Interface language"),
			"the title must render",
		);
		assert.equal(
			document.querySelector("#setting-effective-language").textContent,
			"In effect: en",
		);
		const saveButton = document.querySelector("[data-language-save]");
		assert.ok(saveButton, "the save button must render");
		assert.ok(saveButton.disabled, "Save must be disabled while clean");
	},
);

test(
	"the save seam writes the one setting and renegotiates the chain",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		const { client } = await mount(t);
		await settle(() => currentLocale() === "en", "the store must be seeded");
		const edits = () => apiCalls.filter((call) => call.op === "settings.edit");
		assert.equal(edits().length, 0, "no edit before the save");
		setCapabilitiesLanguage("fr");
		await act(async () => {
			await saveLanguageValue({ value: "fr", queryClient: client });
		});
		await settle(
			() => edits().length === 1,
			"the save must write through settings.edit",
		);
		assert.deepEqual(
			{ op: edits()[0].op, key: edits()[0].key, value: edits()[0].value },
			{ op: "settings.edit", key: "language", value: "fr" },
		);
		await settle(
			() => currentLocale() === "fr",
			"the capabilities answer must move the store",
		);
	},
);
