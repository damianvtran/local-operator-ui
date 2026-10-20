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

const FROM_THIS_BROWSER_SESSION = /From this browser session/;
const ENTER_A_WEB_ADDRESS = /Enter a web address/;
const ADDRESS_SUGGESTIONS_UNAVAILABLE = /Address suggestions are unavailable/;

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
	assert.equal(list(bundle), null);
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
	assert.equal(list(bundle), null);
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
