/**
 * Every final response in a turn carries its own full action row (#1043, and the
 * operator's 2026-10-20 rule).
 *
 * WHAT THIS FILE IS: `CanonicalTranscript` rendered through a real jsdom root
 * (the `speech-user-copy.test.mjs` rig) with a turn holding TWO settled
 * assistant responses. Before #1043 only the closing one carried a Copy
 * control; the operator's rule then split the class in two by the WIRE FACT
 * (`turn-segments.ts::isFinalResponse`): a response that carries no `tool_calls`
 * is a handover and gets the full in-flow row, and one that carries its own calls
 * is in-between status commentary and gets the bare hover-only overlay.
 *
 * The DOM is asked:
 *
 *   1. a non-closing FINAL response carries an IN-FLOW `data-lo-response-actions`
 *      row - Copy, Speak and Fork - under its prose, and no glyph is boxed;
 *   2. the closing answer keeps its full `data-lo-answer-actions` row on the foot
 *      line, and only that one wears the answer marker;
 *   3. an in-between COMMENTARY row (`callsTools: true`) carries the bare
 *      hover-only `data-lo-gutter-actions` overlay: absolutely positioned, Copy
 *      alone, so it reserves no line;
 *   4. a press copies THAT response's own text;
 *   5. a response still streaming offers no bar. Its line context menu still
 *      copies the partial text on screen: a right-click asks for what is there,
 *      and refusing a live row's words would be a different product rule from
 *      the one that keeps the action bar off a moving line.
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
 * A non-closing FINAL response wears the IN-FLOW `data-lo-response-actions` row
 * (the operator's rule). The in-between status class is asked for separately, by
 * marker, in its own case below - the two classes must not be counted together.
 */
const responseRows = (dom) => [
	...dom.window.document.querySelectorAll("[data-lo-response-actions]"),
];

const labelsOf = (row) =>
	[...row.querySelectorAll("button")].map((button) =>
		button.getAttribute("aria-label"),
	);

test("an earlier final response carries the full in-flow row; the closing answer keeps its own", async () => {
	const { dom, press, written, unmount } = await mountTranscript([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "It finished with four invoices outstanding."),
		{
			...gateAnswer("a2", "Update: the fourth one cleared."),
			ts: GATE_TS + 2_000,
		},
	]);
	const rows = responseRows(dom);
	assert.equal(
		rows.length,
		1,
		"the non-closing final response has its own row",
	);
	assert.deepEqual(
		labelsOf(rows[0]),
		["Copy", "Speak aloud", "Fork from this message"],
		"the full answer set: a handover is a handover wherever it sits",
	);
	assert.equal(
		rows[0].getAttribute("aria-label"),
		"Response actions",
		'its own accessible name, not a second "Answer actions" toolbar',
	);
	assert.equal(rows[0].classList.contains("absolute"), false, "in the flow");
	assert.equal(
		rows[0].classList.contains("rounded-md"),
		false,
		"and BARE: no container, no edge, no ground (the operator's regression)",
	);
	assert.equal(
		rows[0].classList.contains("border"),
		false,
		"no border on the row either",
	);
	assert.ok(rows[0].classList.contains("opacity-0"), "fades at rest");
	assert.ok(
		rows[0].classList.contains("group-hover:opacity-100"),
		"revealed by hovering the response",
	);
	/*
	 * The row's reserved meta line: the span that right-aligns it, inside the
	 * `mt-1 flex items-center gap-2` rhythm the answer's foot line uses.
	 */
	const metaRow = rows[0].parentElement?.parentElement;
	assert.ok(
		metaRow?.className.includes("mt-1") &&
			metaRow?.className.includes("flex") &&
			metaRow?.className.includes("items-center"),
		"its reserved meta row is the foot line's own rhythm",
	);
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-answer-actions]").length,
		1,
		"exactly one answer-marked row, on the closing answer",
	);
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-gutter-actions]").length,
		0,
		"no commentary overlay: neither response is in-between status text",
	);
	await press(rows[0].querySelector('button[aria-label="Copy"]'));
	assert.deepEqual(
		written,
		["It finished with four invoices outstanding."],
		"the press copies that response's own text",
	);
	await unmount();
});

test("in-between commentary keeps the bare hover-only overlay, Copy alone", async () => {
	const { dom, press, written, unmount } = await mountTranscript([
		gateUser("u1", "Is the March import finished?"),
		/*
		 * `callsTools: true` is the wire fact: this row announced the call that
		 * follows it, so it is narration rather than a handover.
		 */
		{ ...gateAnswer("n1", "Reading the ledger first."), callsTools: true },
		gateAnswer("a1", "It finished with four invoices outstanding."),
	]);
	const gutter = [
		...dom.window.document.querySelectorAll("[data-lo-gutter-actions]"),
	];
	assert.equal(gutter.length, 1, "the commentary row has the overlay");
	assert.deepEqual(labelsOf(gutter[0]), ["Copy"], "Copy alone");
	assert.equal(
		gutter[0].getAttribute("aria-label"),
		"Commentary actions",
		"named for its class, distinct from both answer rows",
	);
	assert.ok(gutter[0].classList.contains("absolute"), "out of the flow");
	assert.equal(
		gutter[0].classList.contains("rounded-md"),
		false,
		"the overlay is bare too: no pill, no ground",
	);
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-response-actions]").length,
		0,
		"narration is not a response row",
	);
	await press(gutter[0].querySelector('button[aria-label="Copy"]'));
	assert.deepEqual(
		written,
		["Reading the ledger first."],
		"the overlay copies the commentary's own text",
	);
	await unmount();
});

test("a response still streaming offers no action bar", async () => {
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
		streaming.querySelector("[data-lo-response-actions]") === null,
		true,
		"and no response row either: the bar is settled-only",
	);
	assert.equal(
		dom.window.document.querySelectorAll(
			'[data-record-id="a1"] [data-lo-response-actions]',
		).length,
		1,
		"the settled response before it keeps its bar",
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
