/*
 * Three runtime language leaks the fr census found, each pinned at the seam
 * that fixes it (census rows 1-3).
 *
 * 1. SERVER COPY FOLLOWS A LANGUAGE SWITCH. The backend renders voice status,
 *    import details, sound names and more per request, in its resolved
 *    language. A switch used to refresh only capabilities and settings, so a
 *    cached `tts.paths` answer (staleTime: Infinity) stayed English until a
 *    reload. The case mounts the real `useI18nLocaleSync` beside the real
 *    `useSpeechPaths` reader and switches the language the way the settings
 *    row does (`renegotiateLanguage`).
 * 2. THE CHOSEN LANGUAGE HOLDS BEFORE THE SERVER ANSWERS. The backend's last
 *    resolved tag is remembered in localStorage and restored at boot over the
 *    device locale; a real answer still wins.
 * 3. THE HEADER AGENT PICKER is localized: a built-in agent's description is
 *    the catalogue sentence and the `role` tag is keyed, through the same
 *    resolvers the `/agent` rows use.
 *
 * The bridge is scripted at `window.api.desktop`, the seam the
 * `language-live-updates` suite uses.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/* A real origin, so jsdom provides a working localStorage (an opaque
 * `about:blank` origin throws on access). */
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	/* Node 22+ ships its own (file-backed, warning) `localStorage` global;
	 * the renderer's is the page's, so jsdom's must win. */
	"localStorage",
];
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		try {
			Object.defineProperty(globalThis, key, {
				value: bootstrapDOM.window[key],
				configurable: true,
				writable: true,
			});
		} catch {
			// jsdom's accessors refuse out-of-context reads; the needed ones do not.
		}
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const apiCalls = [];
let capabilitiesLanguage = "en";

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			apiCalls.push({ ...request, language: capabilitiesLanguage });
			if (request?.op === "capabilities") {
				return {
					status: 200,
					body: {
						result: {
							desktop_available: true,
							features: { settings: 1, i18n: 1, tts: 1 },
							language: capabilitiesLanguage,
						},
					},
				};
			}
			if (request?.op === "tts.paths") {
				/* What the backend does: the reason is rendered per request in the
				 * language it resolved at that moment. */
				return {
					status: 200,
					body: {
						result: {
							paths: [],
							reason:
								capabilitiesLanguage === "fr"
									? "Non connecté à Radient."
									: "Not signed in to Radient.",
						},
					},
				};
			}
			return { status: 200, body: { result: {} } };
		},
		feed: {
			subscribe: () => () => {},
			watchState: (onState) => {
				onState({ connected: true });
				return () => {};
			},
		},
	},
};

const bundle = await build({
	stdin: {
		contents: [
			'import { createElement } from "react";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
			'export { useI18nLocaleSync } from "./src/renderer/src/shared/i18n/locale-sync";',
			'export { renegotiateLanguage } from "./src/renderer/src/shared/i18n/language-writes";',
			'export { LAST_BACKEND_LANGUAGE_KEY, restoreLastBackendLanguage } from "./src/renderer/src/shared/i18n/last-language";',
			'export { useSpeechPaths } from "./src/renderer/src/shared/hooks/use-speech-paths";',
			'export { applyCapabilities, currentLocale, currentLocaleState, setLocale } from "./src/i18n/locale";',
			'export { headerRosterRowText } from "./src/renderer/src/features/chat/components/chat-header-identity-model";',
			'export { bundledEnglish } from "./src/i18n/keys.gen";',
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
const bundlePath = new URL("_i18n-runtime-leaks.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	useI18nLocaleSync,
	renegotiateLanguage,
	LAST_BACKEND_LANGUAGE_KEY,
	restoreLastBackendLanguage,
	useSpeechPaths,
	applyCapabilities,
	currentLocale,
	currentLocaleState,
	setLocale,
	headerRosterRowText,
	bundledEnglish,
} = await import(bundlePath.href);

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

const calls = (op) => apiCalls.filter((call) => call.op === op);

let shownReason = null;
const Screen = () => {
	useI18nLocaleSync();
	shownReason = useSpeechPaths(true).data?.reason ?? null;
	return null;
};

const mount = async (t) => {
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
		await act(async () => root.unmount());
		client.clear();
		container.remove();
	});
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(Screen, null),
			),
		);
	});
	return client;
};

test(
	"a language switch refetches server-rendered copy without a reload (census row 1)",
	{ timeout: 60_000 },
	async (t) => {
		applyCapabilities(null, "en-US");
		capabilitiesLanguage = "en";
		apiCalls.length = 0;
		const client = await mount(t);
		await settle(
			() => currentLocale() === "en" && shownReason !== null,
			"the first answer and the voice status must land",
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
		assert.equal(
			calls("tts.paths").length,
			1,
			"the FIRST capabilities answer is not a change: nothing refetches",
		);
		assert.equal(shownReason, "Not signed in to Radient.");

		// The settings row's own write path: PATCH landed, renegotiate.
		capabilitiesLanguage = "fr";
		await act(async () => renegotiateLanguage(client));
		await settle(
			() => currentLocale() === "fr",
			"the store must follow the new answer",
		);
		await settle(
			() => shownReason === "Non connecté à Radient.",
			`the voice status must refetch in the new language; still showing ${JSON.stringify(shownReason)} after ${calls("tts.paths").length} tts.paths read(s)`,
		);
		assert.equal(
			calls("tts.paths").at(-1).language,
			"fr",
			"the refetch must happen after the backend confirmed the new language",
		);
		assert.equal(
			calls("capabilities").filter((call) => call.language === "fr").length,
			1,
			"the refresh must not re-invalidate capabilities into a second read",
		);
	},
);

test(
	"the backend's language is remembered and restored before the server answers (census row 2)",
	{ timeout: 60_000 },
	async (t) => {
		localStorage.removeItem(LAST_BACKEND_LANGUAGE_KEY);
		applyCapabilities(null, "en-US");
		capabilitiesLanguage = "fr";
		await mount(t);
		await settle(() => currentLocale() === "fr", "the answer must land");
		assert.equal(
			localStorage.getItem(LAST_BACKEND_LANGUAGE_KEY),
			"fr",
			"a backend-resolved answer must be remembered",
		);

		// Next launch: no answer yet, an English device.
		applyCapabilities(null, "en-US");
		assert.equal(currentLocale(), "en-US");
		assert.equal(restoreLastBackendLanguage(), true);
		assert.deepEqual(currentLocaleState(), {
			locale: "fr",
			source: "remembered",
		});

		// The backend stays the owner: a real answer replaces the remembered tag.
		applyCapabilities({ features: { i18n: 1 }, language: "es" });
		assert.equal(currentLocale(), "es");
		assert.equal(
			restoreLastBackendLanguage(),
			false,
			"a remembered tag never overrides a live backend answer",
		);
		assert.equal(currentLocale(), "es");

		// A tag a user or an older build wrote that is not a language is ignored.
		applyCapabilities(null, "en-US");
		localStorage.setItem(LAST_BACKEND_LANGUAGE_KEY, "fr; DROP");
		assert.equal(restoreLastBackendLanguage(), false);
		assert.equal(currentLocale(), "en-US");
		localStorage.removeItem(LAST_BACKEND_LANGUAGE_KEY);
	},
);

test("the header agent picker localizes built-in descriptions and the kind tag (census row 3)", () => {
	const shipped = {
		value: "manager",
		name: "manager",
		source: "builtin",
		kind: "role",
		description: bundledEnglish["ui.agents.descriptions.manager"],
	};
	setLocale("fr");
	try {
		const row = headerRosterRowText(shipped, "agent");
		assert.notEqual(
			row.description,
			shipped.description,
			"a shipped seed's description must not stay the English sentence",
		);
		assert.ok(row.description, "the translated sentence must be present");
		assert.equal(row.meta, "rôle", "the kind tag must be keyed");

		// The operator's own words are never translated.
		const edited = { ...shipped, description: "Mon propre texte." };
		assert.equal(
			headerRosterRowText(edited, "agent").description,
			"Mon propre texte.",
		);
		// A team's description is always the operator's.
		assert.equal(
			headerRosterRowText({ ...shipped, kind: undefined }, "team").description,
			shipped.description,
		);
	} finally {
		setLocale("en");
	}
	assert.equal(headerRosterRowText(shipped, "agent").meta, "role");
	assert.equal(
		headerRosterRowText(shipped, "agent").description,
		shipped.description,
		"English keeps the shipped sentence byte-for-byte",
	);
});
