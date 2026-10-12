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
const CLEAR_SELECTOR = (label) =>
	`button[aria-label="Clear ${label}'s shortcut"]`;

/** One keydown, as the browser would dispatch it at the field. Returns
 * `dispatchEvent`'s answer — `false` means the recorder claimed the press
 * (`preventDefault` ran), `true` means the press travels on (F5: the claimed
 * half is what keeps the router from answering the same press). */
const pressKey = (element, init) => {
	let dispatched;
	act(() => {
		dispatched = element.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
	return dispatched;
};

async function mount(run, chrome) {
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
	/*
	 * The chrome facts, when a cell needs a platform other than the fallback:
	 * `rendererPlatform()` reads `window.api` at render time, so the stub has to
	 * exist BEFORE the render — the mac cell proves the refusal sentence follows
	 * the machine (U5).
	 */
	if (chrome) window.api = { windowChrome: { facts: () => chrome } };
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
		/*
		 * No overrides, so no Reset anywhere — but the two DEFAULTED rows offer
		 * Clear (U4: a defaulted action must be releasable), and the four rows
		 * that ship unbound have nothing to clear.
		 */
		assert.equal(api.$$("button").length, 2);
		assert.ok(api.$(CLEAR_SELECTOR("Console")));
		assert.ok(api.$(CLEAR_SELECTOR("Canvas")));
		for (const label of ["Run details", "Asks", "Browser", "Code review"]) {
			assert.equal(
				api.$(CLEAR_SELECTOR(label)),
				null,
				`an unbound ${label} has nothing to clear`,
			);
		}
	});
});

test("capture commits: the chord is written, displayed, and Reset appears", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		const claimed = pressKey(field, { key: "u", metaKey: true });
		assert.equal(
			claimed,
			false,
			"the recorder CLAIMS the accepted press (F5): `defaultPrevented` is what keeps the router from answering the same press",
		);
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
		const claimed = pressKey(field, {
			key: "c",
			metaKey: true,
			shiftKey: true,
		});
		assert.equal(
			claimed,
			false,
			"the recorder claims the refused press too (F5) — the claim is the recorder's, before any refusal verdict",
		);
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
		/* A bare key asks for a modifier instead — in the register this machine
		   reads (U5): the test host has no chrome facts, so `linux` answers. */
		pressKey(field, { key: "u" });
		assert.deepEqual(api.outputs(), ["A shortcut needs Ctrl."]);
	});
});

test("the review round's four newly-reserved chords are refused by name at the field", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		/*
		 * Review F1 = QA Q1: these four were left assignable on a rationale the
		 * app's phase order falsifies (the canvas editors listen on `window`, and
		 * the pin-move returns skip `preventDefault`), so capture must refuse each
		 * with the sentence naming the job — read at a real field, which is where
		 * a user meets it.
		 */
		const cells = [
			[{ key: "s", metaKey: true }, "Reserved: saves the canvas document."],
			[{ key: "o", metaKey: true }, "Reserved: opens a file in the canvas."],
			[
				{ key: "ArrowUp", metaKey: true, shiftKey: true },
				"Reserved: moves the focused chat up the pinned order.",
			],
			[
				{ key: "ArrowDown", metaKey: true, shiftKey: true },
				"Reserved: moves the focused chat down the pinned order.",
			],
		];
		for (const [press, sentence] of cells) {
			pressKey(field, press);
			assert.deepEqual(api.outputs(), [sentence], JSON.stringify(press));
			assert.deepEqual(
				useUiPreferencesStore.getState().shortcutBindings,
				{},
				`${JSON.stringify(press)} must not write`,
			);
			assert.equal(field.value, "Ctrl+J", "the previous value is kept");
		}
	});
});

test("re-pressing the row's own chord records nothing; pressing its default clears the override (U3)", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		/* The chord the row already shows, with no override: no write, no Reset. */
		pressKey(field, { key: "j", metaKey: true });
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		assert.equal(api.$(RESET_SELECTOR("Console")), null, "nothing to reset");
		/* With an override, pressing the DEFAULT deletes it — the map never
		   stores a value identical to the default. */
		api.store({ shortcutBindings: { "panel.console": "primary+u" } });
		assert.equal(field.value, "Ctrl+U");
		pressKey(field, { key: "j", metaKey: true });
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		assert.equal(field.value, "Ctrl+J");
		assert.equal(
			api.$(RESET_SELECTOR("Console")),
			null,
			"Reset leaves with the override",
		);
	});
});

test("Clear stores the explicit no-chord state; Reset restores the default (U4)", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		const clear = api.$(CLEAR_SELECTOR("Console"));
		assert.ok(clear, "a defaulted action offers Clear");
		/* The real keyboard path: the focused button deletes itself, and the
		   successor must not be `<body>` (the U2 class of defect). */
		act(() => {
			clear.focus();
		});
		act(() => {
			clear.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {
			"panel.console": null,
		});
		assert.equal(field.value, "No shortcut");
		assert.equal(
			api.window.document.activeElement,
			field,
			"Clear hands focus back to the field",
		);
		const reset = api.$(RESET_SELECTOR("Console"));
		assert.ok(reset, "the cleared row offers Reset");
		act(() => {
			reset.focus();
		});
		act(() => {
			reset.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		assert.equal(field.value, "Ctrl+J");
		assert.equal(
			api.window.document.activeElement,
			field,
			"Reset hands focus back too (U2): it deletes itself, so <body> must not inherit the caret",
		);
	});
});

test("the needs-a-modifier sentence follows the platform (U5)", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		pressKey(field, { key: "u" });
		assert.deepEqual(api.outputs(), ["A shortcut needs Ctrl."]);
	});
	await mount(
		async (api) => {
			const field = api.$(FIELD_SELECTOR("Console"));
			act(() => {
				field.focus();
			});
			/* macOS keeps both spellings: `primary` is meta OR ctrl there. */
			pressKey(field, { key: "u" });
			assert.deepEqual(api.outputs(), ["A shortcut needs ⌘ or Ctrl."]);
		},
		{ platform: "mac" },
	);
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

test("keyboard-only: the field records, Tab navigates, Escape parks the cue without dropping focus", async () => {
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
		const hint = () =>
			[...api.window.document.querySelectorAll("span")].find(
				(s) => s.textContent === "Press the keys you want; Esc cancels.",
			);
		assert.ok(hint(), "the recording hint appears while the field is focused");
		/* A modifier alone is not a candidate and not a refusal. */
		pressKey(field, { key: "Meta", metaKey: true });
		assert.deepEqual(api.outputs(), []);
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		/*
		 * U1: Tab is LEFT TO THE BROWSER — no refusal, no `preventDefault` — so the
		 * press moves focus as it does anywhere else (jsdom does not implement the
		 * move itself, so the readback here is that the press travelled on
		 * UNCONSUMED and was not answered; QA walks the real move).
		 */
		assert.equal(
			pressKey(field, { key: "Tab" }),
			true,
			"Tab must not be preventDefaulted",
		);
		assert.deepEqual(api.outputs(), [], "Tab is not a refusal");
		/*
		 * U2: Escape ends the recording CUE and keeps focus on the field — the blur
		 * this replaced dropped the caret to `<body>` and sent the next Tab back to
		 * the top of the page.
		 */
		pressKey(field, { key: "Escape" });
		assert.equal(
			api.window.document.activeElement,
			field,
			"Escape never drops focus to <body>",
		);
		assert.equal(hint(), undefined, "the cue leaves with the edit");
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		/* ...and the next captured key re-arms the cue rather than binding blind. */
		pressKey(field, { key: "u" });
		assert.deepEqual(api.outputs(), ["A shortcut needs Ctrl."]);
		assert.ok(hint(), "the next capture re-arms the cue");
	});
});
