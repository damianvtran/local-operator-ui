/*
 * The live half of the language setting (i18n slice B1): a `config` frame on
 * the machine-wide desktop feed moves the interface, and only an EXTERNAL
 * transition is announced.
 *
 * WHAT THIS PROVES, in the four cases below: a language frame refetches the
 * capabilities chain and the store follows the new answer; a redelivered
 * frame (same epoch+seq) is handled once; the app's own write inside the
 * own-write window refetches but stays quiet; and a config frame that does not
 * name `language` changes nothing.
 *
 * What it cannot claim: the backend's half of the contract (the frame's
 * emission is core PR #2213's, verified there against the real watcher); this
 * file drives the renderer's end with a frame the contract describes. The
 * bridge is scripted at `window.api.desktop` - the same seam the
 * `settings-language-row` suite uses - plus a `feed` whose `subscribe` this
 * test fires by hand, which is exactly how the preload delivers frames.
 */
import assert from "node:assert/strict";
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
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of context; the ones the
		// components need (`HTML*Element`, `Event`, `getComputedStyle`) do not.
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

/*
 * The scripted transport + the scripted FEED. Bodies carry `desktopResult`'s
 * `{ result }` envelope; the feed's `subscribe` captures the handler so a test
 * fires frames by hand, exactly as the preload relays them.
 */
const apiCalls = [];
const feedHandlers = [];
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
							features: { settings: 1, i18n: 1, desktop_feed: 1 },
							language: capabilitiesLanguage,
						},
					},
				};
			}
			return { status: 200, body: { result: {} } };
		},
		feed: {
			subscribe: (onFrame) => {
				feedHandlers.push(onFrame);
				return () => {
					const index = feedHandlers.indexOf(onFrame);
					if (index >= 0) feedHandlers.splice(index, 1);
				};
			},
			watchState: (onState) => {
				onState({ connected: true });
				return () => {};
			},
		},
	},
};

const toastStub = new URL("language-live-toast-stub.mjs", import.meta.url)
	.pathname;

const bundle = await build({
	stdin: {
		contents: [
			'import { createElement } from "react";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
			'export { useI18nLocaleSync } from "./src/renderer/src/shared/i18n/locale-sync";',
			'export { applyCapabilities, currentLocale, markLocalLanguageWrite } from "./src/renderer/src/shared/i18n";',
			'export { toastCalls } from "./scripts/language-live-toast-stub.mjs";',
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
		"@shared/utils/toast-manager": toastStub,
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

const bundlePath = new URL(
	"_language-live-updates.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	useI18nLocaleSync,
	applyCapabilities,
	currentLocale,
	markLocalLanguageWrite,
	toastCalls,
} = await import(bundlePath.href);

const LocaleSync = () => {
	useI18nLocaleSync();
	return null;
};

const settle = async (cond, note, ms = 4000) => {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (cond()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	}
	assert.ok(cond(), note);
};

const capabilitiesCalls = () =>
	apiCalls.filter((call) => call.op === "capabilities").length;

const emitFrame = async (frame) => {
	await act(async () => {
		for (const handler of [...feedHandlers]) handler(frame);
	});
};

const mount = async (t) => {
	const mounted = { client: null, root: null, container: null };
	t.after(async () => {
		try {
			await act(async () => {
				mounted.root?.unmount();
			});
		} finally {
			mounted.client?.clear();
		}
		mounted.container?.remove();
	});
	mounted.client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			gcTime: 0,
		},
	});
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(LocaleSync, null),
			),
		);
	});
	return mounted;
};

const TEST_TIMEOUT_MS = 60_000;

test(
	"a language frame refetches the chain, moves the store, and announces once",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		applyCapabilities(null);
		toastCalls.length = 0;
		const mounted = await mount(t);
		await settle(
			() => currentLocale() === "en",
			"the store must resolve the seeded capabilities answer first",
		);
		const before = capabilitiesCalls();
		setCapabilitiesLanguage("fr");
		await emitFrame({
			epoch: "e1",
			seq: 7,
			type: "config",
			payload: { changed_keys: ["language"], language: "fr" },
		});
		await settle(
			() => capabilitiesCalls() > before,
			"a language frame must renegotiate the capabilities chain",
		);
		await settle(
			() => currentLocale() === "fr",
			"the store must follow the new capabilities answer",
		);
		await settle(
			() => toastCalls.length === 1,
			"an external transition must be announced once",
		);
		assert.ok(
			toastCalls[0].message.includes("fr"),
			"the announcement must name the new language",
		);
		assert.equal(toastCalls[0].options?.id, "i18n-language-external");

		// A redelivered frame is handled once: no second refetch, no second toast.
		const afterFirst = capabilitiesCalls();
		await emitFrame({
			epoch: "e1",
			seq: 7,
			type: "config",
			payload: { changed_keys: ["language"], language: "fr" },
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 150));
		});
		assert.equal(capabilitiesCalls(), afterFirst, "no refetch on redelivery");
		assert.equal(toastCalls.length, 1, "no second toast on redelivery");
	},
);

test(
	"the app's own write inside the window refetches but stays quiet",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		applyCapabilities(null);
		setCapabilitiesLanguage("en");
		toastCalls.length = 0;
		const mounted = await mount(t);
		await settle(() => currentLocale() === "en", "seeded");
		/*
		 * What the settings row and the dialog call the moment their write
		 * resolves: the frame that follows is this app's own echo.
		 */
		markLocalLanguageWrite();
		const before = capabilitiesCalls();
		setCapabilitiesLanguage("de");
		await emitFrame({
			epoch: "e2",
			seq: 1,
			type: "config",
			payload: { changed_keys: ["language"], language: "de" },
		});
		await settle(
			() => capabilitiesCalls() > before,
			"the frame still refetches",
		);
		await settle(() => currentLocale() === "de", "the store still follows");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 150));
		});
		assert.equal(toastCalls.length, 0, "no announcement for our own write");
	},
);

test(
	"a config frame that does not name language changes nothing",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		applyCapabilities(null);
		setCapabilitiesLanguage("en");
		toastCalls.length = 0;
		const mounted = await mount(t);
		await settle(() => currentLocale() === "en", "seeded");
		const before = capabilitiesCalls();
		await emitFrame({
			epoch: "e3",
			seq: 3,
			type: "config",
			payload: { changed_keys: ["display.dock"], language: "en" },
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 150));
		});
		assert.equal(capabilitiesCalls(), before, "no refetch for other keys");
		assert.equal(toastCalls.length, 0, "no toast for other keys");
	},
);
