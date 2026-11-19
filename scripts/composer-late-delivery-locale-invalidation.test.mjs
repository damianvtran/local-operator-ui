import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/** Real MessageInput receives the page's memoized late-delivery notice once.
 * Locale is the only change after mounting; jsdom asserts copy, not pixels. */
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/agents",
});
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
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * A STORAGE THAT ANSWERS. Two persisted stores in this graph (the onboarding
 * store, the conversation-input store) rehydrate at import time, and a jsdom
 * window without storage throws inside them before any test runs.
 */
const storage = new Map();
Object.defineProperty(DOM.window, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
		clear: () => storage.clear(),
		key: (index) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		},
	},
});
globalThis.localStorage = DOM.window.localStorage;
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
/*
 * FRAMES, BECAUSE JSDOM HAS NONE WITHOUT `pretendToBeVisual`. The composer's send
 * path schedules its optimistic paint on one, so a missing `requestAnimationFrame`
 * fails a send a browser would have made.
 */
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
};
/*
 * A CANVAS THAT ANSWERS, because the composer's graph measures text at MODULE
 * scope (the maths renderer's default console width) and jsdom's canvas throws
 * "not implemented" — an import-time failure that would read as a broken test
 * rather than a missing shim. Only `measureText` is ever called.
 */
DOM.window.HTMLCanvasElement.prototype.getContext = () => ({
	measureText: (text) => ({ width: String(text).length * 8 }),
	font: "",
	fillText: () => {},
	clearRect: () => {},
	save: () => {},
	restore: () => {},
});

/*
 * THE DESKTOP BRIDGE, INERT. The composer's mount path reaches it (the catalogue
 * read behind the credential probe, the transcription manager's own probe); this
 * file is about what the box renders and what its send seam carries, and a call
 * that answers "nothing" is the honest stand-in for a bridge this rig does not
 * have.
 */
DOM.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async (channel) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
};
DOM.window.api = {
	ipcRenderer: {
		invoke: async () => ({}),
		send: () => {},
		on: () => {},
		once: () => {},
		removeListener: () => {},
		removeAllListeners: () => {},
	},
	readFile: undefined,
	platform: "darwin",
};
globalThis.api = DOM.window.api;

const bundle = await build({
	stdin: {
		contents: [
			'export { MessageInput } from "../src/renderer/src/shared/components/composer/message-input";',
			'export { composerNoticeFor } from "../src/renderer/src/features/chat/composer-notice";',
			'export { t, setLocale, registerCatalogue, clearRegisteredCatalogues } from "../src/i18n";',
			'export { createRoot } from "react-dom/client";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: `${process.cwd()}/scripts`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	/*
	 * THE COMPOSER'S GRAPH REACHES ASSETS AND FONTS (the brand mark, the maths
	 * renderer's own faces). They are not what this file is about, and the rig's
	 * recipe is `shared-composer.test.mjs`'s: every one of them loads as an
	 * empty/text/dataurl module so the bundle stays about behaviour.
	 */
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	define: { "import.meta.env": "{}" },
	/*
	 * THE BUNDLE KEEPS A CJS DEPENDENCY (react-error-boundary, reached through the
	 * composer's own error boundary), and a CJS file inside an ESM bundle needs a
	 * `require` that resolves from THIS file — the recipe `shared-composer.test.mjs`
	 * states for the same reason.
	 */
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
});
const bundlePath = new URL(
	"._composer-late-delivery-locale.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(bundlePath);
	for (const handle of process._getActiveHandles?.() ?? []) {
		if (handle?.constructor?.name === "MessagePort") handle.close();
	}
	DOM.window.close();
});
const {
	MessageInput,
	composerNoticeFor,
	QueryClient,
	QueryClientProvider,
	createRoot,
	t,
	setLocale,
	registerCatalogue,
	clearRegisteredCatalogues,
} = await import(bundlePath.href);

for (const [arm, key] of [
	["delivered", "ui.chat.canonical.send_failure.late_delivery"],
	["draft-only", "ui.chat.canonical.send_failure.late_delivery_draft"],
	["overlap", "ui.chat.canonical.send_failure.late_delivery_overlap"],
])
	test(`a cached ${arm} late-delivery notice translates in the composer`, async () => {
		setLocale("en");
		registerCatalogue("fr", { [key]: `Fixture ${arm} delivery` });
		const notice = composerNoticeFor({
			error: null,
			code: undefined,
			retry: false,
			muted: false,
			rowError: undefined,
			rowCode: undefined,
			rowRetry: undefined,
			lateDelivered: arm,
		});
		const english = t(key);
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
						React.createElement(MessageInput, {
							conversationId: `synthetic-s5-${arm}`,
							messages: [],
							onSendMessage: async () => {},
							isLoading: false,
							transcriptless: true,
							autoFocus: false,
							sendError: notice,
						}),
					),
				),
			);
			assert.ok(
				host.textContent.includes(english),
				"the real composer renders the late-delivery arm",
			);
			await act(async () => setLocale("fr"));
			assert.ok(
				host.textContent.includes(`Fixture ${arm} delivery`),
				`cached ${arm} notice must translate after locale change; actual: ${host.textContent.slice(0, 350)}`,
			);
			await act(async () => setLocale("en"));
			assert.ok(
				host.textContent.includes(english),
				"notice returns to English without rebuilding its object",
			);
		} finally {
			await act(async () => root.unmount());
			client.clear();
			host.remove();
			clearRegisteredCatalogues();
			setLocale("en");
		}
	});
