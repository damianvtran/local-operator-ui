/**
 * The SHARED copy button's two sentences, in the language the reader is in.
 *
 *     node --test scripts/copy-button-copy-locale.test.mjs
 *
 * WHY THIS FILE EXISTS. `copy-button.tsx` was hoisted out of the provider panel
 * by the phone-access work (#1103) and serves callers that are not the provider
 * feature at all, so its copy belongs to `ui.common.actions.*` and not to a
 * caller's namespace. Two things a green catalogue check cannot see are proven
 * here against the REAL component and the REAL `t()`:
 *
 *   1. the exact English bytes a reader gets — "Copied" while the confirmation
 *      shows, and the whole failure sentence in the toast when the clipboard
 *      write is refused (browser permission policy, inactive document), which is
 *      the one path that names a recovery;
 *   2. that a locale change REPAINTS the button. `t()` reads the store at call
 *      time and does not subscribe, so the component has to read
 *      `useI18nLocale()` itself; drop that line and this fails on the second
 *      assertion rather than on a frame nobody looks at.
 *
 * HOW IT STANDS IN FOR A BROWSER. jsdom and React's own scheduler, the rig
 * `locale-reactivity.test.mjs` and `phone-access-block.test.mjs` use. The
 * clipboard is a stub because jsdom has none, and the toast is stubbed by PATH
 * to a recorder (the `chat-session-copy-id.test.mjs` idiom) so what the user
 * would be shown is asserted as bytes rather than inferred from the source.
 *
 * WHAT IT DOES NOT PROVE: pixels. No layout engine runs here, so this says
 * nothing about the button's width while "Copied" replaces a longer label.
 */

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
globalThis.__copyButtonToasts = toasts;

const built = await build({
	stdin: {
		contents: [
			"export * as React from 'react';",
			"export { act } from 'react';",
			"export { createRoot } from 'react-dom/client';",
			"export { CopyButton } from './src/renderer/src/shared/components/common/copy-button';",
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
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
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
				builder.onResolve({ filter: /@shared\/utils\/toast-manager/ }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						const record = (kind, message) => {
							(globalThis.__copyButtonToasts ??= []).push([kind, message]);
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
	CopyButton,
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

/** The clipboard, as the only platform surface the component touches. */
const setClipboard = (writeText) => {
	Object.defineProperty(globalThis.navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
};

/** Mount the shipped component; `label` is the caller's own per-action label. */
async function mount(label = "Copy address") {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			React.createElement(CopyButton, {
				value: "https://exact.example.test",
				label,
			}),
		);
	});
	return {
		container,
		buttonText: () => container.querySelector("button")?.textContent ?? null,
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

const press = async (container) => {
	const node = container.querySelector("button");
	await act(async () => {
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
	});
};

test("a successful press shows the exact English confirmation, then goes back", async () => {
	setLocale("en");
	const written = [];
	setClipboard(async (text) => {
		written.push(text);
	});
	toasts.length = 0;
	const view = await mount();
	try {
		assert.equal(
			view.buttonText(),
			"Copy address",
			"the caller's own per-action label renders at rest",
		);
		await press(view.container);
		assert.deepEqual(
			written,
			["https://exact.example.test"],
			"the value reached the clipboard",
		);
		assert.equal(
			view.buttonText(),
			"Copied",
			"the confirmation is the catalogue's exact English bytes",
		);
		assert.deepEqual(toasts, [], "a success raises no toast");
	} finally {
		await view.unmount();
	}
});

test("a refused clipboard write reaches the toast with the exact English sentence", async () => {
	setLocale("en");
	setClipboard(async () => {
		throw new Error("clipboard write refused");
	});
	toasts.length = 0;
	const view = await mount();
	try {
		await press(view.container);
		assert.deepEqual(
			toasts,
			[["error", "Could not copy. Select and copy it manually."]],
			"the failure sentence is the catalogue's exact English bytes, on the toast",
		);
		assert.equal(
			view.buttonText(),
			"Copy address",
			"a refused write never claims the value was copied",
		);
	} finally {
		await view.unmount();
	}
});

test("a locale change repaints both sentences through the subscription", async () => {
	setLocale("en");
	setClipboard(async () => {});
	const view = await mount();
	try {
		assert.equal(view.buttonText(), "Copy address");
		try {
			registerCatalogue("fr", {
				"ui.common.actions.copied": "Fixture copie",
				"ui.common.actions.copy_failed": "Fixture echec de copie",
			});
			/*
			 * ENTER, THEN SWITCH. Pressing AFTER the locale change would repaint the
			 * button through the press's own state update and so pass with or without
			 * the subscription (measured: the sabotage was green). The confirmation has
			 * to be showing when the locale moves, so the only thing that can re-render
			 * the button is `useI18nLocale()` itself — which is exactly the line this
			 * case exists to keep in the component.
			 */
			await press(view.container);
			assert.equal(view.buttonText(), "Copied");
			await act(async () => setLocale("fr"));
			assert.equal(
				view.buttonText(),
				"Fixture copie",
				"the showing confirmation repaints on a locale change",
			);
			/* The toast reads the store at the moment of failure, so it needs no
			 * subscription of its own; it is asserted to prove the second key too. */
			toasts.length = 0;
			setClipboard(async () => {
				throw new Error("clipboard write refused");
			});
			await press(view.container);
			assert.deepEqual(
				toasts,
				[["error", "Fixture echec de copie"]],
				"the failure sentence follows the active locale",
			);
			/* The bundled English map is the per-key fallback, so the exact English
			 * bytes still answer under a fixture locale that overrode them. */
			assert.equal(
				t("ui.common.actions.copy_failed"),
				"Fixture echec de copie",
			);
		} finally {
			clearRegisteredCatalogues();
			await act(async () => setLocale("en"));
		}
	} finally {
		await view.unmount();
	}
});

test("the shared namespace carries the exact English bytes", () => {
	assert.equal(t("ui.common.actions.copied"), "Copied");
	assert.equal(
		t("ui.common.actions.copy_failed"),
		"Could not copy. Select and copy it manually.",
	);
});
