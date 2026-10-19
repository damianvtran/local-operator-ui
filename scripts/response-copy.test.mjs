/**
 * Every settled agent response in a turn can be copied (#1043).
 *
 * WHAT THIS FILE IS: `CanonicalTranscript` rendered through a real jsdom root
 * (the `speech-user-copy.test.mjs` rig) with a turn holding TWO settled
 * assistant responses. Before #1043 only the closing one carried a Copy
 * control, so the earlier response could only be copied by hand-selecting it.
 * The DOM is asked:
 *
 *   1. the earlier response carries a Copy-only GUTTER control
 *      (`data-lo-gutter-actions`), absolutely positioned and hover-revealed by
 *      its own record's `group`, so it reserves no line;
 *   2. there is NO in-flow `data-lo-response-actions` row left to reserve one -
 *      the operator's excess-space report, and the reason the marker moved;
 *   3. the closing answer keeps its full `data-lo-answer-actions` row, and only
 *      that one - no per-paragraph Speak/Fork (the PR #698 clutter rule);
 *   4. a press copies THAT response's own text;
 *   5. a response still streaming offers no GUTTER Copy. Its line context menu
 *      still copies the partial text on screen: a right-click asks for what is
 *      there, and refusing a live row's words would be a different product rule
 *      from the one that keeps the hover control off a moving line.
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

/* Hoisted for biome's useTopLevelRegex: the esbuild fixture filters. */
const RE_CREDENTIALS = /@shared\/hooks\/use-credentials/;
const RE_TOAST = /@shared\/utils\/toast-manager/;
const RE_ANY = /.*/;
const RE_STREAMING_TEXT = /Update: the fourth/;

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
				builder.onResolve({ filter: RE_CREDENTIALS }, () => ({
					path: "probe",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: RE_TOAST }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: RE_ANY, namespace: "fixture" }, (args) => {
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

const mountTranscript = async (records, { waiting = false } = {}) => {
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
	globalThis.DOMRect = dom.window.DOMRect;
	/* The transcript's own effects schedule through a bare rAF (the paging and
	 * reveal loops), which the jsdom window has and the process global does not. */
	globalThis.requestAnimationFrame = (callback) =>
		setTimeout(() => callback(0), 0);
	globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
	/* The live-turn path (`waiting: true`) reads `matchMedia`; jsdom has none. */
	dom.window.matchMedia = (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	});
	globalThis.matchMedia = dom.window.matchMedia;
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	globalThis.MutationObserver = dom.window.MutationObserver;
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
					waiting,
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

/*
 * The response copy control is now the GUTTER OVERLAY (`data-lo-gutter-actions`),
 * not the in-flow `data-lo-response-actions` row #1043 added. The assertion the
 * operator's excess-space report needs is that the flow row is GONE, so this
 * helper names the replacement and the first test counts both.
 */
const responseRows = (dom) => [
	...dom.window.document.querySelectorAll("[data-lo-gutter-actions]"),
];

test("an earlier settled response carries an absolute gutter Copy; the closing answer keeps the full row", async () => {
	const { dom, press, written, unmount } = await mountTranscript([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "It finished with four invoices outstanding."),
		{
			...gateAnswer("a2", "Update: the fourth one cleared."),
			ts: GATE_TS + 2_000,
		},
	]);
	const rows = responseRows(dom);
	assert.equal(rows.length, 1, "the non-closing response has its own control");
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-response-actions]").length,
		0,
		"and no in-flow response row remains to reserve a line",
	);
	const labels = [...rows[0].querySelectorAll("button")].map((button) =>
		button.getAttribute("aria-label"),
	);
	assert.deepEqual(
		labels,
		["Copy"],
		"Copy alone - no Speak or Fork per response",
	);
	assert.equal(
		rows[0].getAttribute("aria-label"),
		"Response actions",
		'its own accessible name, not a second "Answer actions" toolbar',
	);
	assert.ok(rows[0].classList.contains("absolute"), "out of the flow");
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

test("a response still streaming offers no gutter Copy", async () => {
	/*
	 * `waiting: true` is the live turn: without it the streaming record folds
	 * into the turn's summary bar and its prose never renders, so "no gutter
	 * Copy under it" would hold whether or not the gate exists. The line's
	 * context menu is a separate surface and is allowed to copy the partial
	 * text (see the header).
	 */
	const { dom, press, written, unmount } = await mountTranscript(
		[
			gateUser("u1", "Is the March import finished?"),
			gateAnswer("a1", "It finished with four invoices outstanding."),
			{
				...gateAnswer("a2", "Update: the fourth"),
				ts: GATE_TS + 2_000,
				streaming: true,
				complete: false,
			},
		],
		{ waiting: true },
	);
	const streaming = dom.window.document.querySelector(
		'[data-record-kind="assistant"][data-record-id="a2"]',
	);
	assert.ok(streaming, "the streaming response is mounted as a prose row");
	assert.match(
		streaming.textContent ?? "",
		RE_STREAMING_TEXT,
		"and its text is on screen",
	);
	/*
	 * Compared as a boolean: a failing `assert.equal(element, null)` makes the
	 * reporter walk the jsdom element, which ran this process out of memory.
	 */
	assert.equal(
		streaming.querySelector("[data-lo-gutter-actions]") === null,
		true,
		"the streaming response carries no Copy",
	);
	assert.equal(
		dom.window.document.querySelectorAll(
			'[data-record-id="a1"] [data-lo-gutter-actions]',
		).length,
		1,
		"the settled response before it keeps its Copy",
	);
	/*
	 * THE LINE'S CONTEXT MENU IS A DIFFERENT SURFACE and deliberately still
	 * copies the text on screen. A right-click on a live row is a request for
	 * what is there, not for a settled answer that does not exist yet; the
	 * hover-revealed gutter stays off the moving line, and the menu is the way
	 * to take the partial paragraph.
	 */
	await act(async () => {
		streaming.dispatchEvent(
			new dom.window.MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				button: 2,
				clientX: 24,
				clientY: 24,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 15));
	});
	const menu = dom.window.document.querySelector("[data-lo-copy-menu]");
	assert.ok(menu, "the streaming row still opens its line menu");
	const copyText = [...menu.querySelectorAll('[role="menuitem"]')].find(
		(node) => node.textContent?.includes("Copy text"),
	);
	assert.ok(copyText, "the menu offers Copy text");
	await press(copyText);
	assert.deepEqual(
		written,
		["Update: the fourth"],
		"the menu copies the partial words on screen",
	);
	await unmount();
});

test("a response row plays no arrival flash, even on a fresh record (#698)", async () => {
	/*
	 * FRESH timestamps, and ids no other case uses: the row skips the flash for
	 * a record older than ROW_ARRIVAL_RECENT_MS and for an id it has already
	 * flashed, so GATE_TS (2025) would let this pass whatever the mount does.
	 */
	const now = Date.now();
	const { dom, unmount } = await mountTranscript([
		{ ...gateUser("fu1", "Is the March import finished?"), ts: now - 3_000 },
		{
			...gateAnswer("fa1", "It finished with four invoices outstanding."),
			ts: now - 2_000,
		},
		{
			...gateAnswer("fa2", "Update: the fourth one cleared."),
			ts: now - 1_000,
		},
	]);
	const rows = responseRows(dom);
	assert.equal(
		rows.length,
		1,
		"the fresh non-closing response has its control",
	);
	assert.equal(
		rows[0].hasAttribute("data-lo-arrive"),
		false,
		"no arrival flash on a response row",
	);
	await unmount();
});
