/**
 * The Keyboard shortcuts settings section, driven for real (#928).
 *
 *     node --test scripts/keyboard-shortcuts-section.test.mjs
 *
 * WHY THIS FILE EXISTS. The recorder is the one place a user arms a chord, and
 * every rule it carries is invisible in a still: capture commits, a refusal
 * KEEPS the previous value and says why, Reset deletes the override rather than
 * writing the default, an unset row says so. This file mounts the REAL section
 * against the REAL store in jsdom and presses real shapes at it — the rig
 * `panel-rail.test.mjs` documents — so the states a frame can only show are
 * also the states a suite can re-run.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");

const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.sessionStorage = bootstrap.window.sessionStorage;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrap.window.close();
	for (const name of ["window", "document", "localStorage", "sessionStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = join(
	ROOT,
	"node_modules",
	".cache",
	"keyboard-shortcuts-section",
);
const bundle = await build({
	stdin: {
		contents: `
			export { KeyboardShortcutsSection } from "./src/renderer/src/features/settings/components/keyboard-shortcuts-section";
			export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45999" };',
	},
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: BARE_SPECIFIER }, (args) =>
					EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
				);
			},
		},
	],
	loader: { ".css": "empty" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "section.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { KeyboardShortcutsSection, useUiPreferencesStore } = await import(
	pathToFileURL(bundlePath).href
);

const FIELD_SELECTOR = (label) =>
	`input[aria-label="${label}: press the keys you want"]`;
const RESET_SELECTOR = (label) =>
	`button[aria-label="Reset ${label} to its default"]`;

/** One keydown, as the browser would dispatch it at the field. */
const pressKey = (element, init) => {
	act(() => {
		element.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
};

async function mount(run) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		KeyboardEvent: window.KeyboardEvent,
		MouseEvent: window.MouseEvent,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const root = createRoot(window.document.getElementById("root"));
	const api = {
		window,
		$: (selector) => window.document.querySelector(selector),
		$$: (selector) => [...window.document.querySelectorAll(selector)],
		outputs: () =>
			[...window.document.querySelectorAll("output")].map((o) => o.textContent),
		store: (patch) => {
			act(() => {
				useUiPreferencesStore.setState(patch);
			});
		},
	};
	act(() => {
		useUiPreferencesStore.setState({ shortcutBindings: {} });
	});
	act(() => {
		root.render(React.createElement(KeyboardShortcutsSection, {}));
	});
	await act(async () => {});
	try {
		await run(api, window);
	} finally {
		act(() => root.unmount());
		await act(async () => {});
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
}

test("one row per action: the labels, the default chord, and the unset state", async () => {
	await mount(async (api) => {
		for (const label of [
			"Console",
			"Canvas",
			"Run details",
			"Asks",
			"Browser",
			"Code review",
		]) {
			assert.ok(api.$(FIELD_SELECTOR(label)), `the ${label} row must exist`);
		}
		/* The test host has no chrome facts, so the platform resolves `linux` —
		   the display tables' own fallback, same as everywhere else in this tree. */
		assert.equal(api.$(FIELD_SELECTOR("Console")).value, "Ctrl+J");
		assert.equal(api.$(FIELD_SELECTOR("Canvas")).value, "Ctrl+Shift+C");
		for (const label of ["Run details", "Asks", "Browser", "Code review"]) {
			assert.equal(api.$(FIELD_SELECTOR(label)).value, "No shortcut");
		}
		/* No overrides, so no Reset anywhere. */
		assert.equal(api.$$("button").length, 0);
	});
});

test("capture commits: the chord is written, displayed, and Reset appears", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		pressKey(field, { key: "u", metaKey: true });
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {
			"panel.console": "primary+u",
		});
		assert.equal(field.value, "Ctrl+U");
		assert.ok(api.$(RESET_SELECTOR("Console")), "an override shows Reset");
	});
});

test("a conflict KEEPS the previous value and names the holder", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		pressKey(field, { key: "c", metaKey: true, shiftKey: true });
		assert.deepEqual(
			useUiPreferencesStore.getState().shortcutBindings,
			{},
			"a refused capture must not write",
		);
		assert.equal(field.value, "Ctrl+J", "the previous value is kept");
		assert.deepEqual(api.outputs(), ["Already assigned to Open canvas."]);
	});
});

test("a reserved chord is refused with its own sentence", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		pressKey(field, { key: "n", metaKey: true });
		assert.deepEqual(api.outputs(), ["Reserved: starts a new chat."]);
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		/* A bare key asks for a modifier instead. */
		pressKey(field, { key: "u" });
		assert.deepEqual(api.outputs(), ["A shortcut needs ⌘ or Ctrl."]);
	});
});

test("Reset deletes the override and restores the default", async () => {
	await mount(async (api) => {
		api.store({ shortcutBindings: { "panel.browser": "primary+i" } });
		assert.equal(api.$(FIELD_SELECTOR("Browser")).value, "Ctrl+I");
		const reset = api.$(RESET_SELECTOR("Browser"));
		assert.ok(reset);
		act(() => {
			reset.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		assert.equal(api.$(FIELD_SELECTOR("Browser")).value, "No shortcut");
		assert.equal(
			api.$(RESET_SELECTOR("Browser")),
			null,
			"Reset left once unset",
		);
	});
});

test("keyboard-only: the field records, Escape ends the edit, modifier-only is ignored", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Asks"));
		assert.notEqual(field.getAttribute("tabindex"), "-1");
		act(() => {
			field.focus();
		});
		assert.equal(
			api.window.document.activeElement,
			field,
			"focus is the recording state",
		);
		/* The hint appears with the recording state. */
		const hint = [...api.window.document.querySelectorAll("span")].find(
			(s) => s.textContent === "Press the keys you want; Esc cancels.",
		);
		assert.ok(hint, "the recording hint appears while the field is focused");
		/* A modifier alone is not a candidate and not a refusal. */
		pressKey(field, { key: "Meta", metaKey: true });
		assert.deepEqual(api.outputs(), []);
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		/* Escape ends the edit without binding anything. */
		pressKey(field, { key: "Escape" });
		assert.notEqual(api.window.document.activeElement, field);
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
	});
});
