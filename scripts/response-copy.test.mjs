/**
 * Every settled agent response in a turn can be copied (#1043).
 *
 * WHAT THIS FILE IS: `CanonicalTranscript` rendered through a real jsdom root
 * (the `speech-user-copy.test.mjs` rig) with a turn holding TWO settled
 * assistant responses. Before #1043 only the closing one carried a Copy
 * control, so the earlier response could only be copied by hand-selecting it.
 * The DOM is asked:
 *
 *   1. the earlier response carries a Copy-only `data-lo-response-actions`
 *      row, hover-revealed by its own record's `group` (no always-on chrome);
 *   2. the closing answer keeps its full `data-lo-answer-actions` row, and only
 *      that one - no per-paragraph Speak/Fork (the PR #698 clutter rule);
 *   3. a press copies THAT response's own text;
 *   4. a response still streaming offers no Copy.
 *
 * WHAT IT DOES NOT PROVE: pixels - the frames are the PR's evidence.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The bootstrap document, before the graph is evaluated, and the
 * `localStorage` beside it: see `speech-selection.test.mjs` for the measurements
 * (Radix's module-scope DOM capture, and the persisted stores' storage read at
 * module scope).
 */
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.HTMLElement = bootstrap.window.HTMLElement;
globalThis.Node = bootstrap.window.Node;
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: bootstrap.window.navigator,
});
globalThis.getComputedStyle = bootstrap.window.getComputedStyle.bind(
	bootstrap.window,
);
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
for (const name of [
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"Element",
	"HTMLButtonElement",
	"HTMLAnchorElement",
]) {
	if (bootstrap.window[name]) globalThis[name] = bootstrap.window[name];
}

const bundle = await build({
	stdin: {
		contents: `
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
			export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: [
		"react",
		"react/jsx-runtime",
		"react-dom",
		"react-dom/server",
		"react-dom/client",
		"@tanstack/react-query",
	],
	plugins: [
		{
			name: "speech-fixtures",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-credentials/ },
					() => ({ path: "probe", namespace: "fixture" }),
				);
				builder.onResolve({ filter: /@shared\/utils\/toast-manager/ }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
					if (args.path === "probe") {
						return {
							loader: "js",
							contents: `
								export const useRadientCredentialProbe = () => ({
									canUseRadientSpeech: false,
									speechBlock: "sign-in",
								});
							`,
						};
					}
					return {
						loader: "js",
						contents: `
							export const showErrorToast = () => "toast";
							export const showInfoToast = () => "toast";
							export const showSuccessToast = () => "toast";
							export const showWarningToast = () => "toast";
							export const dismissToast = () => {};
							export const resetToastDedup = () => {};
						`,
					};
				});
			},
		},
	],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
	jsx: "automatic",
});

const { writeFile, unlink } = await import("node:fs/promises");
const bundlePath = new URL(
	`./_response-copy-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const GATE_TS = 1_760_000_000_000;

const gateUser = (id, text) => ({
	kind: "user",
	id,
	ts: GATE_TS,
	text,
	images: [],
});

const gateAnswer = (id, text) => ({
	kind: "assistant",
	id,
	ts: GATE_TS + 1_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});

const mountTranscript = async (records) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	/* The transcript's own effects schedule through a bare rAF (the paging and
	 * reveal loops), which the jsdom window has and the process global does not. */
	globalThis.requestAnimationFrame = (callback) =>
		setTimeout(() => callback(0), 0);
	globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	for (const name of [
		"Event",
		"CustomEvent",
		"MouseEvent",
		"KeyboardEvent",
		"FocusEvent",
		"PointerEvent",
		"Element",
		"HTMLElement",
		"Node",
		"HTMLButtonElement",
		"HTMLAnchorElement",
	]) {
		if (dom.window[name]) globalThis[name] = dom.window[name];
	}
	const written = [];
	Object.defineProperty(dom.window.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text) => {
				written.push(text);
			},
		},
	});

	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	const transcript = {
		...mod.EMPTY_TRANSCRIPT,
		records,
		index: new Map(records.map((row, at) => [row.id, at])),
	};
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{
					client: new QueryClient({
						defaultOptions: { queries: { retry: false } },
					}),
				},
				React.createElement(mod.CanonicalTranscript, {
					transcript,
					frontend: null,
					gate: null,
					waiting: false,
					starting: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: null },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
					conversationId: "story-conversation",
				}),
			),
		);
	});
	const userRow = () =>
		dom.window.document.querySelector("[data-lo-user-actions]");
	const answerRow = () =>
		dom.window.document.querySelector("[data-lo-answer-actions]");
	const press = async (button) => {
		await act(async () => {
			button.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	const unmount = async () => {
		await act(async () => {
			root.unmount();
		});
	};
	return { dom, userRow, answerRow, press, written, unmount };
};

const responseRows = (dom) => [
	...dom.window.document.querySelectorAll("[data-lo-response-actions]"),
];

test("an earlier settled response carries a hover-revealed Copy; the closing answer keeps the full row", async () => {
	const { dom, press, written, unmount } = await mountTranscript([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "It finished with four invoices outstanding."),
		{
			...gateAnswer("a2", "Update: the fourth one cleared."),
			ts: GATE_TS + 2_000,
		},
	]);
	const rows = responseRows(dom);
	assert.equal(rows.length, 1, "the non-closing response has its own row");
	const labels = [...rows[0].querySelectorAll("button")].map((button) =>
		button.getAttribute("aria-label"),
	);
	assert.deepEqual(
		labels,
		["Copy"],
		"Copy alone - no Speak or Fork per response",
	);
	assert.ok(rows[0].classList.contains("opacity-0"), "fades at rest");
	assert.ok(
		rows[0].classList.contains("group-hover:opacity-100"),
		"revealed by hovering the response",
	);
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-answer-actions]").length,
		1,
		"exactly one full row, on the closing answer",
	);
	await press(rows[0].querySelector('button[aria-label="Copy"]'));
	assert.deepEqual(
		written,
		["It finished with four invoices outstanding."],
		"the press copies that response's own text",
	);
	await unmount();
});

test("a response still streaming offers no Copy", async () => {
	const { dom, unmount } = await mountTranscript([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "It finished with four invoices outstanding."),
		{
			...gateAnswer("a2", "Update: the fourth"),
			ts: GATE_TS + 2_000,
			streaming: true,
			complete: false,
		},
	]);
	/*
	 * The live response is drawn inside the turn's working fold, not as a
	 * prose row, so the assertion is scoped by record id: nothing under it
	 * offers a Copy while it is still receiving deltas.
	 */
	const streaming = dom.window.document.querySelectorAll(
		'[data-record-id="a2"]',
	);
	assert.ok(streaming.length > 0, "the streaming response is on screen");
	for (const node of streaming) {
		assert.equal(
			node.querySelector('button[aria-label="Copy"]'),
			null,
			"the streaming response carries no Copy",
		);
	}
	/* The settled response before it still can be copied. */
	assert.equal(
		dom.window.document.querySelectorAll(
			'[data-record-id="a1"] [data-lo-response-actions]',
		).length,
		1,
		"the settled response before it keeps its Copy",
	);
	await unmount();
});
