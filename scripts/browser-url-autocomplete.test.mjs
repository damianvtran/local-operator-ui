/**
 * The address bar's real interaction contract, in a DOM.
 *
 * WHY THIS EXISTS BESIDE THE BUILT-APP PROOF: the proof is the claim about the
 * running Electron app, and it costs a launch per matrix cell. This file drives
 * the SAME shipped component and hook through jsdom so the selection arithmetic,
 * the key contract, composition and blur are cheap to pin and fail with a line
 * number. It is not pixel evidence and it is not native-view evidence; the
 * geometry claim belongs to `browser-url-autocomplete-proof.mjs`.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const BARE_PACKAGE_RE = /^[^./]/;
const dom = new JSDOM("<!doctype html><body></body>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
for (const name of ["window", "document", "HTMLElement", "Element", "Event"])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: dom.window.navigator,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
const { createRoot } = await import("react-dom/client");
/* The bundle must sit inside the checkout so its EXTERNAL bare imports
 * (`react`, `lucide-react`, Radix) resolve from the repo's node_modules; a
 * scratch-pad path outside the tree cannot. `node_modules/` keeps the tree
 * git-clean if a crashed run leaves it behind; it is removed on exit anyway. */
const scratch = await mkdtemp(
	join(process.cwd(), "node_modules", ".url-autocomplete-test-"),
);
process.on("exit", () => {
	void rm(scratch, { recursive: true, force: true });
});

const result = await build({
	stdin: {
		contents: `
import React from 'react';
import { BrowserUrlBar } from './src/renderer/src/features/browser/components/browser-url-bar';
export { BrowserUrlBar };`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	write: false,
	jsx: "automatic",
	platform: "node",
	format: "esm",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	plugins: [
		{
			name: "installed-packages-are-external",
			setup(builder) {
				builder.onResolve({ filter: BARE_PACKAGE_RE }, (args) => {
					if (args.path.startsWith("@shared")) return undefined;
					return { path: args.path, external: true };
				});
			},
		},
	],
});
const bundlePath = join(scratch, "component.mjs");
await writeFile(bundlePath, result.outputFiles[0].text);
const { BrowserUrlBar } = await import(pathToFileURL(bundlePath).href);

const ENTRIES = [
	{
		url: "https://example.com/",
		title: "Example",
		sourceTabId: 1,
		sourceIndex: 0,
		activeTab: true,
		distanceFromCurrent: 2,
	},
	{
		url: "https://example.com/account",
		title: "Account",
		sourceTabId: 1,
		sourceIndex: 1,
		activeTab: true,
		distanceFromCurrent: 1,
	},
	{
		url: "https://example.com/account/profile",
		title: "Profile",
		sourceTabId: 1,
		sourceIndex: 2,
		activeTab: true,
		distanceFromCurrent: 0,
	},
];

const SIX_ENTRIES = [
	"/account",
	"/account/a",
	"/account/b",
	"/account/c",
	"/account/d",
	"/account/e",
].map((path, sourceIndex) => ({
	url: `https://example.com${path}`,
	title: `Page ${sourceIndex}`,
	sourceTabId: 1,
	sourceIndex,
	activeTab: true,
	distanceFromCurrent: 6 - sourceIndex,
}));

const FROM_THIS_BROWSER_SESSION = /From this browser session/;
const ENTER_A_WEB_ADDRESS = /Enter a web address/;
const ADDRESS_SUGGESTIONS_UNAVAILABLE = /Address suggestions are unavailable/;
const FIXED_DOCK_HEIGHT = /h-\[104px\]/;
const BOTTOM_RULE = /border-b/;
const HEADER_ZONE_HEIGHT = /h-\[28px\]/;
const OPTIONS_VIEWPORT_HEIGHT = /h-\[75px\]/;
const FIXED_ROW_HEIGHT = /h-\[35\.5px\]/;
const NO_LINKS_YET = /No links/;

const flush = async () => {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
};

async function renderBar(overrides = {}) {
	const navigations = [];
	const requests = [];
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const props = {
		tabId: 1,
		url: "https://example.com/account",
		pendingUrl: null,
		loading: false,
		canGoBack: true,
		canGoForward: false,
		disabled: false,
		onNavigate: (url, expectedTabId) =>
			navigations.push({ url, expectedTabId }),
		onBack: () => {},
		onForward: () => {},
		onReload: () => {},
		onStop: () => {},
		onOpenApprovals: () => {},
		waitingCount: 0,
		downloadsDir: null,
		onOpenDownloads: () => {},
		addressScope: "all",
		addressScopeKey: "all",
		addressHistory: async (request) => {
			requests.push(request);
			return {
				requestId: request.requestId,
				activeTabId: 1,
				entries: ENTRIES,
			};
		},
		onStateChanged: () => () => {},
		...overrides,
	};
	await act(async () => {
		root.render(React.createElement(BrowserUrlBar, props));
	});
	await flush();
	const input = container.querySelector('[data-tour-tag="browser-address"]');
	return {
		container,
		root,
		input,
		navigations,
		requests,
		props,
		async rerender(overrides = {}) {
			Object.assign(props, overrides);
			await act(async () => {
				root.render(React.createElement(BrowserUrlBar, props));
			});
			await flush();
		},
		async cleanup() {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

function setValue(input, value, inputType = "insertText") {
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	).set;
	setter.call(input, value);
	const event = new dom.window.Event("input", { bubbles: true });
	Object.defineProperty(event, "inputType", { value: inputType });
	Object.defineProperty(event, "isComposing", { value: false });
	input.dispatchEvent(event);
}

async function type(bundle, value) {
	await act(async () => {
		bundle.input.focus();
	});
	await flush();
	await act(async () => {
		setValue(bundle.input, value);
	});
	await flush();
}

async function key(bundle, keyValue, extra = {}) {
	await act(async () => {
		bundle.input.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: keyValue,
				bubbles: true,
				cancelable: true,
				...extra,
			}),
		);
	});
	await flush();
}

const list = (bundle) =>
	bundle.container.querySelector(
		'[data-tour-tag="browser-address-suggestions"]',
	);
const listbox = (bundle) =>
	bundle.container.querySelector("[data-address-suggestions-list]");
const options = (bundle) => [
	...bundle.container.querySelectorAll("[data-address-suggestion]"),
];

test("focus fetches once and an empty query shows the session's entries", async () => {
	const bundle = await renderBar();
	await act(async () => bundle.input.focus());
	await flush();
	assert.equal(bundle.requests.length, 1);
	assert.equal(bundle.requests[0].expectedTabId, 1);
	assert.equal(bundle.requests[0].scope, "all");
	assert.ok(options(bundle).length > 0);
	assert.match(list(bundle).textContent, FROM_THIS_BROWSER_SESSION);
	await bundle.cleanup();
});

test("the list is inset to the address field's bounds, not the pane's", async () => {
	// jsdom has no layout, so the only way to pin the INSET ARITHMETIC here is to
	// hand the component the boxes the real app measures: a 1380px window whose
	// 260px icon rail leaves a 1120px pane, the field inset by the bar's left
	// controls (200px) and the Approvals control (40px). What this owns is the
	// arithmetic; the measured claim is `browser-url-autocomplete-proof.mjs`.
	const box = (left, right) => ({
		left,
		right,
		width: right - left,
		top: 0,
		bottom: 32,
		height: 32,
		x: left,
		y: 0,
		toJSON: () => ({}),
	});
	// The dock's margins are placed once, at mount, so the boxes the real app
	// measures have to exist BEFORE the component first lays out.
	const original = dom.window.Element.prototype.getBoundingClientRect;
	dom.window.Element.prototype.getBoundingClientRect = function () {
		const tag = this.getAttribute?.("data-tour-tag");
		if (tag === "browser-url-bar") return box(260, 1380);
		if (tag === "browser-address") return box(460, 1340);
		return original.call(this);
	};
	const bundle = await renderBar();
	try {
		await act(async () => bundle.input.focus());
		await flush();
		const listEl = list(bundle);
		assert.ok(listEl, "the suggestion list mounted");
		assert.equal(listEl.style.marginLeft, "200px");
		assert.equal(listEl.style.marginRight, "40px");
		const barWidth = 1380 - 260;
		const listLeft = 260 + Number.parseFloat(listEl.style.marginLeft);
		const listRight = 1380 - Number.parseFloat(listEl.style.marginRight);
		assert.ok(Math.abs(listLeft - 460) <= 1, `list.left=${listLeft}`);
		assert.ok(Math.abs(listRight - 1340) <= 1, `list.right=${listRight}`);
		assert.ok(
			listRight - listLeft < barWidth,
			`list.width=${listRight - listLeft} bar.width=${barWidth}`,
		);
	} finally {
		dom.window.Element.prototype.getBoundingClientRect = original;
		await bundle.cleanup();
	}
});

test("the dock is a permanent 104px band: 28px header, 75px viewport, one rule", async () => {
	const bundle = await renderBar();
	const dock = list(bundle);
	assert.ok(dock, "the dock is mounted before the field is ever focused");
	assert.equal(dock.getAttribute("data-address-dock-height"), "104");
	assert.match(dock.className, FIXED_DOCK_HEIGHT);
	assert.match(dock.className, BOTTOM_RULE);
	const header = dock.querySelector("[data-address-suggestions-header]");
	const blank = dock.querySelector("[data-address-suggestions-blank]");
	assert.match(header.className, HEADER_ZONE_HEIGHT);
	// The scroll container exists only while open: a closed dock must not mount
	// anything Chrome can make keyboard- or click-focusable.
	assert.equal(
		dock.querySelector("[data-address-suggestions-viewport]"),
		null,
		"the closed dock has no scroll viewport",
	);
	assert.ok(blank, "the closed dock still reserves the 75px zone");
	assert.match(blank.className, OPTIONS_VIEWPORT_HEIGHT);
	assert.equal(blank.getAttribute("aria-hidden"), "true");
	// Closed: blank chrome. No copy, no rows, no hint, nothing in the Tab order.
	assert.equal(dock.getAttribute("data-address-dock-open"), "false");
	assert.equal(dock.textContent.trim(), "");
	assert.equal(options(bundle).length, 0);
	for (const node of dock.querySelectorAll("*")) {
		assert.ok(
			node.tabIndex < 0,
			`the closed dock has no tab stop: ${node.outerHTML}`,
		);
	}
	// A click on the blank band cannot move focus into the dock.
	await act(async () => {
		blank.dispatchEvent(
			new dom.window.MouseEvent("mousedown", { bubbles: true }),
		);
		blank.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	assert.ok(
		!dock.contains(document.activeElement),
		`focus stayed outside the dock: ${document.activeElement?.outerHTML}`,
	);
	await bundle.cleanup();
});

test("opening keeps the zones and puts the rows inside the 75px viewport", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	const dock = list(bundle);
	assert.equal(dock.getAttribute("data-address-dock-open"), "true");
	assert.equal(dock.getAttribute("data-address-dock-height"), "104");
	assert.match(dock.className, FIXED_DOCK_HEIGHT);
	const viewport = dock.querySelector("[data-address-suggestions-viewport]");
	assert.ok(
		viewport.contains(listbox(bundle)),
		"the listbox lives inside the scroll viewport",
	);
	assert.equal(options(bundle).length, 1);
	for (const row of options(bundle)) {
		assert.match(row.className, FIXED_ROW_HEIGHT);
	}
	assert.match(dock.textContent, FROM_THIS_BROWSER_SESSION);
	await bundle.cleanup();
});

test("the status notice lives in the options viewport, under the header label", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: [],
		}),
	});
	await act(async () => bundle.input.focus());
	await flush();
	const dock = list(bundle);
	const header = dock.querySelector("[data-address-suggestions-header]");
	const viewport = dock.querySelector("[data-address-suggestions-viewport]");
	const notice = viewport.querySelector("[data-address-suggestions-notice]");
	assert.match(header.textContent, FROM_THIS_BROWSER_SESSION);
	assert.ok(notice, "the notice is inside the 75px zone");
	assert.match(notice.textContent, NO_LINKS_YET);
	assert.ok(
		!notice.className.includes("truncate"),
		"the notice wraps and scrolls instead of truncating at 480px",
	);
	assert.equal(
		header.querySelectorAll("[data-address-suggestions-notice]").length,
		0,
	);
	assert.equal(options(bundle).length, 0);
	await bundle.cleanup();
});

test("a fifth active row scrolls inside the viewport, never the page", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: SIX_ENTRIES,
		}),
	});
	await type(bundle, "example.com/acc");
	const viewport = bundle.container.querySelector(
		"[data-address-suggestions-viewport]",
	);
	Object.defineProperty(viewport, "clientHeight", {
		configurable: true,
		value: 75,
	});
	const rows = options(bundle);
	assert.equal(rows.length, 5);
	// jsdom has no layout; hand the effect the geometry the 75px viewport has:
	// 2px padding, then five 35.5px rows.
	rows.forEach((row, index) => {
		Object.defineProperty(row, "offsetTop", {
			configurable: true,
			value: 2 + index * 35.5,
		});
		Object.defineProperty(row, "offsetHeight", {
			configurable: true,
			value: 35.5,
		});
	});
	for (let step = 0; step < 5; step += 1) await key(bundle, "ArrowDown");
	assert.equal(bundle.input.getAttribute("aria-activedescendant"), rows[4].id);
	assert.equal(
		viewport.scrollTop,
		2 + 5 * 35.5 - 75,
		"the fifth row is brought fully into the viewport",
	);
	await key(bundle, "ArrowUp");
	await key(bundle, "ArrowUp");
	assert.equal(viewport.scrollTop, 2 + 2 * 35.5, "rows 3 and 4 are shown");
	assert.equal(document.activeElement, bundle.input);
	await bundle.cleanup();
});

test("a new query resets the options scroll, even with the same candidate count", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: SIX_ENTRIES,
		}),
	});
	await type(bundle, "example.com/acc");
	const viewport = bundle.container.querySelector(
		"[data-address-suggestions-viewport]",
	);
	assert.equal(options(bundle).length, 5);
	// jsdom has no layout: the 75px scrollport and the row geometry the effect
	// reads are handed to it explicitly (2px padding, then 35.5px rows).
	Object.defineProperty(viewport, "clientHeight", {
		configurable: true,
		value: 75,
	});
	options(bundle).forEach((row, index) => {
		Object.defineProperty(row, "offsetTop", {
			configurable: true,
			value: 2 + index * 35.5,
		});
		Object.defineProperty(row, "offsetHeight", {
			configurable: true,
			value: 35.5,
		});
	});
	const scrolledToFifth = 2 + 5 * 35.5 - 75;
	for (let step = 0; step < 5; step += 1) await key(bundle, "ArrowDown");
	assert.equal(viewport.scrollTop, scrolledToFifth, "the fifth row is in view");

	// Keyboard path: appending one character keeps all six entries matching, so
	// the candidate count is unchanged and only the query differs.
	await type(bundle, "example.com/acco");
	assert.equal(options(bundle).length, 5, "the candidate count is unchanged");
	assert.equal(viewport.scrollTop, 0, "the new result set starts at the top");
	assert.equal(bundle.input.getAttribute("aria-activedescendant"), null);

	// Wheel path: the pointer leaves the same offset behind; the next query change
	// must clear it just the same.
	viewport.scrollTop = scrolledToFifth;
	await type(bundle, "example.com/accou");
	assert.equal(options(bundle).length, 5);
	assert.equal(viewport.scrollTop, 0);
	await bundle.cleanup();
});

test("typing types the selected suffix into the real input", async () => {
	const bundle = await renderBar({ url: "https://example.com/account" });
	await type(bundle, "example.com/acc");
	assert.equal(bundle.input.value, "example.com/account/profile");
	assert.equal(bundle.input.selectionStart, "example.com/acc".length);
	assert.equal(bundle.input.selectionEnd, "example.com/account/profile".length);
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

test("Right accepts the suffix without navigating", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "ArrowRight");
	assert.equal(bundle.input.value, "example.com/account/profile");
	assert.equal(bundle.input.selectionStart, bundle.input.value.length);
	assert.equal(bundle.input.selectionEnd, bundle.input.value.length);
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

test("Down changes the active option and Enter commits it once", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "ArrowDown");
	const rows = options(bundle);
	assert.ok(rows.length > 0);
	assert.equal(bundle.input.getAttribute("aria-activedescendant"), rows[0].id);
	assert.equal(rows[0].getAttribute("aria-selected"), "true");
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [
		{ url: "https://example.com/account", expectedTabId: 1 },
	]);
	await bundle.cleanup();
});

test("Enter with only an inline completion commits its canonical target", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [
		{ url: "https://example.com/account/profile", expectedTabId: 1 },
	]);
	await bundle.cleanup();
});

test("blur dismisses and never navigates", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await act(async () => bundle.input.blur());
	await flush();
	assert.equal(bundle.navigations.length, 0);
	assert.equal(bundle.input.value, "https://example.com/account");
	await bundle.cleanup();
});

test("Escape dismisses, then abandons", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "Escape");
	assert.equal(bundle.input.value, "example.com/acc");
	assert.equal(listbox(bundle), null);
	assert.equal(list(bundle).textContent.trim(), "");
	await key(bundle, "Escape");
	assert.equal(bundle.input.value, "https://example.com/account");
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

test("Backspace removes the suggestion before it edits the draft", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "Backspace");
	assert.equal(bundle.input.value, "example.com/acc");
	assert.equal(listbox(bundle), null);
	assert.equal(list(bundle).textContent.trim(), "");
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

test("Tab never commits an unaccepted suffix", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "Tab");
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

test("a search-intent Enter shows the address hint instead of navigating", async () => {
	const bundle = await renderBar();
	await type(bundle, "hello world");
	await key(bundle, "Enter");
	assert.equal(bundle.navigations.length, 0);
	assert.match(list(bundle).textContent, ENTER_A_WEB_ADDRESS);
	await bundle.cleanup();
});

test("typing then Ctrl+Z returns the user's own edit, not the generated suffix", async () => {
	const bundle = await renderBar();
	await act(async () => bundle.input.focus());
	await flush();
	await act(async () => setValue(bundle.input, "exa"));
	await flush();
	await act(async () => setValue(bundle.input, "examp"));
	await flush();
	await key(bundle, "z", { ctrlKey: true });
	assert.equal(bundle.input.value, "exa");
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

test("composition suppresses completion until the next ordinary input", async () => {
	const bundle = await renderBar();
	await act(async () => bundle.input.focus());
	await flush();
	await act(async () => {
		bundle.input.dispatchEvent(
			new dom.window.CompositionEvent("compositionstart", { bubbles: true }),
		);
		setValue(bundle.input, "exa");
	});
	await flush();
	assert.equal(bundle.input.value, "exa");
	await act(async () => {
		bundle.input.dispatchEvent(
			new dom.window.CompositionEvent("compositionend", { bubbles: true }),
		);
	});
	await flush();
	assert.equal(bundle.input.value, "exa");
	await bundle.cleanup();
});

test("a tab change clears the snapshot and the completion", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	assert.notEqual(bundle.input.value, "example.com/acc");
	await act(async () => {
		bundle.root.render(
			React.createElement(BrowserUrlBar, {
				tabId: 2,
				url: "https://other.example/",
				pendingUrl: null,
				loading: false,
				canGoBack: false,
				canGoForward: false,
				disabled: false,
				onNavigate: () => {},
				onBack: () => {},
				onForward: () => {},
				onReload: () => {},
				onStop: () => {},
				onOpenApprovals: () => {},
				waitingCount: 0,
				downloadsDir: null,
				onOpenDownloads: () => {},
				addressScope: "all",
				addressScopeKey: "all",
				addressHistory: async (request) => ({
					requestId: request.requestId,
					activeTabId: 2,
					entries: ENTRIES,
				}),
				onStateChanged: () => () => {},
			}),
		);
	});
	await flush();
	assert.equal(bundle.input.value, "https://other.example/");
	await bundle.cleanup();
});

test("an unavailable history read degrades to plain editing", async () => {
	const bundle = await renderBar({
		addressHistory: async () => {
			throw new Error("proof: unavailable");
		},
	});
	await act(async () => bundle.input.focus());
	await flush();
	assert.match(list(bundle).textContent, ADDRESS_SUGGESTIONS_UNAVAILABLE);
	assert.equal(bundle.input.value, "https://example.com/account");
	await bundle.cleanup();
});

const HTTP_ENTRIES = [
	{
		url: "http://127.0.0.1:8080/account",
		title: "Account",
		sourceTabId: 1,
		sourceIndex: 1,
		activeTab: true,
		distanceFromCurrent: 1,
	},
	{
		url: "http://127.0.0.1:8080/account/profile",
		title: "Profile",
		sourceTabId: 1,
		sourceIndex: 2,
		activeTab: true,
		distanceFromCurrent: 0,
	},
];

test("Right then Enter navigates the HTTP target, not an HTTPS upgrade", async () => {
	const bundle = await renderBar({
		url: "http://127.0.0.1:8080/account",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: HTTP_ENTRIES,
		}),
	});
	await type(bundle, "127.0.0.1:8080/acc");
	await key(bundle, "ArrowRight");
	assert.equal(bundle.input.value, "127.0.0.1:8080/account/profile");
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [
		{ url: "http://127.0.0.1:8080/account/profile", expectedTabId: 1 },
	]);
	await bundle.cleanup();
});

test("a response carrying an older request id is discarded", async () => {
	const pending = [];
	const bundle = await renderBar({
		addressHistory: (request) =>
			new Promise((resolve) => pending.push({ request, resolve })),
	});
	await act(async () => bundle.input.focus());
	await flush();
	assert.equal(pending.length, 1);
	await act(async () => {
		pending[0].resolve({
			requestId: pending[0].request.requestId - 1,
			activeTabId: 1,
			entries: ENTRIES,
		});
	});
	await flush();
	assert.equal(options(bundle).length, 0);
	await bundle.cleanup();
});

test("a response for a tab that is no longer active is discarded", async () => {
	const pending = [];
	const bundle = await renderBar({
		addressHistory: (request) =>
			new Promise((resolve) => pending.push({ request, resolve })),
	});
	await act(async () => bundle.input.focus());
	await flush();
	await act(async () => {
		pending[0].resolve({
			requestId: pending[0].request.requestId,
			activeTabId: 2,
			entries: ENTRIES,
		});
	});
	await flush();
	assert.equal(options(bundle).length, 0);
	await bundle.cleanup();
});

test("an in-flight response is discarded when the display scope changes", async () => {
	const pending = [];
	const bundle = await renderBar({
		addressHistory: (request) =>
			new Promise((resolve) => pending.push({ request, resolve })),
	});
	await act(async () => bundle.input.focus());
	await flush();
	await bundle.rerender({ addressScopeKey: "session:other" });
	await act(async () => {
		pending[0].resolve({
			requestId: pending[0].request.requestId,
			activeTabId: 1,
			entries: ENTRIES,
		});
	});
	await flush();
	assert.equal(options(bundle).length, 0);
	await bundle.cleanup();
});

test("paste fills the draft without generating an inline completion", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await act(async () => {
		setValue(bundle.input, "example.com/acc", "insertFromPaste");
	});
	await flush();
	assert.equal(bundle.input.selectionStart, bundle.input.selectionEnd);
	assert.equal(bundle.input.selectionEnd, "example.com/acc".length);
	await bundle.cleanup();
});

test("a background refresh that shrinks the list drops the stale active row", async () => {
	let entries = ENTRIES;
	let notify = () => {};
	const bundle = await renderBar({
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries,
		}),
		onStateChanged: (callback) => {
			notify = callback;
			return () => {};
		},
	});
	await type(bundle, "example.com/acc");
	await key(bundle, "ArrowDown");
	await key(bundle, "ArrowDown");
	assert.ok(bundle.input.getAttribute("aria-activedescendant"));
	entries = [ENTRIES[1]];
	await act(async () => notify());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 150));
	});
	await flush();
	const active = bundle.input.getAttribute("aria-activedescendant");
	if (active !== null) {
		assert.ok(
			options(bundle).some((option) => option.id === active),
			"the active descendant names a row that still exists",
		);
	}
	const before = bundle.navigations.length;
	await key(bundle, "Enter");
	assert.equal(bundle.navigations.length, before + 1);
	await bundle.cleanup();
});

test("aria-controls names the listbox only while a listbox exists", async () => {
	const populated = await renderBar();
	await type(populated, "example.com/acc");
	assert.ok(populated.input.getAttribute("aria-controls"));
	assert.equal(populated.input.getAttribute("aria-describedby"), null);
	await populated.cleanup();

	const empty = await renderBar({
		url: "about:blank",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: [],
		}),
	});
	await act(async () => empty.input.focus());
	await flush();
	assert.equal(empty.input.getAttribute("aria-controls"), null);
	const described = empty.input.getAttribute("aria-describedby");
	assert.ok(described);
	assert.match(document.getElementById(described).textContent, /No links/);
	await empty.cleanup();
});

test("the unavailable notice is described by the field", async () => {
	const bundle = await renderBar({
		addressHistory: async () => {
			throw new Error("proof: unavailable");
		},
	});
	await act(async () => bundle.input.focus());
	await flush();
	assert.equal(bundle.input.getAttribute("aria-controls"), null);
	const described = bundle.input.getAttribute("aria-describedby");
	assert.ok(described);
	assert.match(
		document.getElementById(described).textContent,
		ADDRESS_SUGGESTIONS_UNAVAILABLE,
	);
	await bundle.cleanup();
});

test("an accepted target is not reused after an invalidating action", async () => {
	const canonical = "http://127.0.0.1:8080/account/profile";
	const display = "127.0.0.1:8080/account/profile";
	const arm = async () => {
		const bundle = await renderBar({
			url: "http://127.0.0.1:8080/account",
			addressHistory: async (request) => ({
				requestId: request.requestId,
				activeTabId: 1,
				entries: HTTP_ENTRIES,
			}),
		});
		await type(bundle, "127.0.0.1:8080/a");
		await type(bundle, "127.0.0.1:8080/acc");
		await key(bundle, "ArrowRight");
		assert.equal(bundle.input.value, display);
		return bundle;
	};

	const edited = await arm();
	await act(async () => setValue(edited.input, `${display}x`, "insertText"));
	await flush();
	await key(edited, "Enter");
	assert.deepEqual(edited.navigations, [
		{ url: `${display}x`, expectedTabId: 1 },
	]);
	await edited.cleanup();

	const undone = await arm();
	await key(undone, "z", { ctrlKey: true });
	await key(undone, "Enter");
	assert.deepEqual(undone.navigations, [
		{ url: "127.0.0.1:8080/a", expectedTabId: 1 },
	]);
	await undone.cleanup();

	const redone = await arm();
	await key(redone, "z", { ctrlKey: true });
	await key(redone, "z", { ctrlKey: true, shiftKey: true });
	await key(redone, "Enter");
	assert.deepEqual(redone.navigations, [
		{ url: "127.0.0.1:8080/acc", expectedTabId: 1 },
	]);
	await redone.cleanup();

	const blurred = await arm();
	await act(async () => blurred.input.blur());
	await flush();
	await key(blurred, "Enter");
	assert.deepEqual(blurred.navigations, [], "blur reverts to the live URL");
	await blurred.cleanup();
});

test("Escape after accepting keeps the canonical target", async () => {
	const canonical = "http://127.0.0.1:8080/account/profile";
	const bundle = await renderBar({
		url: "http://127.0.0.1:8080/account",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: HTTP_ENTRIES,
		}),
	});
	await type(bundle, "127.0.0.1:8080/a");
	await type(bundle, "127.0.0.1:8080/acc");
	await key(bundle, "ArrowRight");
	await key(bundle, "Escape");
	assert.equal(bundle.input.value, "127.0.0.1:8080/account/profile");
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [{ url: canonical, expectedTabId: 1 }]);
	await bundle.cleanup();
});

test("a second Escape after accepting abandons and clears the target", async () => {
	const bundle = await renderBar({
		url: "http://127.0.0.1:8080/account",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: HTTP_ENTRIES,
		}),
	});
	await type(bundle, "127.0.0.1:8080/a");
	await type(bundle, "127.0.0.1:8080/acc");
	await key(bundle, "ArrowRight");
	await key(bundle, "Escape");
	await key(bundle, "Escape");
	assert.equal(bundle.input.value, "http://127.0.0.1:8080/account");
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, []);
	await bundle.cleanup();
});

test("switching tabs and back keeps the accepted target", async () => {
	const canonical = "http://127.0.0.1:8080/account/profile";
	const bundle = await renderBar({
		url: "http://127.0.0.1:8080/account",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: HTTP_ENTRIES,
		}),
	});
	await type(bundle, "127.0.0.1:8080/a");
	await type(bundle, "127.0.0.1:8080/acc");
	await key(bundle, "ArrowRight");
	await bundle.rerender({ tabId: 2, url: "https://other.example/" });
	await bundle.rerender({ tabId: 1, url: "http://127.0.0.1:8080/account" });
	assert.equal(bundle.input.value, "127.0.0.1:8080/account/profile");
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [{ url: canonical, expectedTabId: 1 }]);
	await bundle.cleanup();
});
