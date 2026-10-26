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
for (const name of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Event",
	/* The outside-press rule reads `event.target instanceof Node`. Node is a real
	 * global in the renderer and only this harness has to borrow it. */
	"Node",
])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: dom.window.navigator,
});
/* The mirror's frame loop runs in the `<main>` dismiss case; jsdom supplies the
 * pair only on its window, and the renderer reads them as globals. */
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
	dom.window,
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
	dom.window,
);
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
import { useBrowserChrome } from './src/renderer/src/features/browser/hooks/use-browser-chrome';
export { BrowserUrlBar, useBrowserChrome };`,
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
const { BrowserUrlBar, useBrowserChrome } = await import(
	pathToFileURL(bundlePath).href
);

const ENTRIES = [
	{
		url: "https://example.com/",
		title: "Example",
		visitCount: 0,
		lastVisitedAt: 0,
		source: "tab",
		sourceTabId: 1,
		sourceIndex: 0,
		activeTab: true,
		distanceFromCurrent: 2,
	},
	{
		url: "https://example.com/account",
		title: "Account",
		visitCount: 0,
		lastVisitedAt: 0,
		source: "tab",
		sourceTabId: 1,
		sourceIndex: 1,
		activeTab: true,
		distanceFromCurrent: 1,
	},
	{
		url: "https://example.com/account/profile",
		title: "Profile",
		visitCount: 0,
		lastVisitedAt: 0,
		source: "tab",
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
	visitCount: 0,
	lastVisitedAt: 0,
	source: "tab",
	sourceTabId: 1,
	sourceIndex,
	activeTab: true,
	distanceFromCurrent: 6 - sourceIndex,
}));

const SWAPPED_SIX = [
	"/account/z",
	"/account/y",
	"/account/x",
	"/account/w",
	"/account/v",
	"/account/u",
].map((path, sourceIndex) => ({
	url: `https://example.com${path}`,
	title: `Other ${sourceIndex}`,
	visitCount: 0,
	lastVisitedAt: 0,
	source: "tab",
	sourceTabId: 1,
	sourceIndex,
	activeTab: true,
	distanceFromCurrent: 6 - sourceIndex,
}));

const SUGGESTIONS = /Suggestions/;
/* The history-read failure sentence. It used to read "Address suggestions are
 * unavailable." for every cause, including a plain new tab; it now says what
 * failed, and the standing/own-state wording is pinned in its own tests. */
const ADDRESS_SUGGESTIONS_UNAVAILABLE = /Couldn't read your browsing history/;
const OLD_UNAVAILABLE = /Address suggestions are unavailable/;
const SEARCH_ROW_HELLO = /Search DuckDuckGo for "hello world"/;
const BLOCKED_HINT = /Only web addresses can open here/;
const NO_BROWSING_HISTORY = /No browsing history/;

/* The row copy substitutes the user's text as an ISOLATED run (FSI/PDI, U+2068 and
 * U+2069) so an RTL sentence cannot reorder an LTR address. Those two controls
 * are display-only and invisible; assertions about what the row SAYS read it
 * without them, and the isolation itself is pinned in its own test. */
const visibleText = (node) => node.textContent.replace(/[\u2068\u2069]/g, "");

const flush = async () => {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
};

async function renderBar(overrides = {}) {
	const navigations = [];
	const requests = [];
	const dismissals = [];
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const props = {
		// S4b: the component now has two placements; these are the product
		// popout's, because the suggestion contract lives there.
		placement: "popout",
		overlayMode: "popout",
		anchor: { x: 0, width: 800 },
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
		onDismiss: () => dismissals.push("dismiss"),
		onCommitted: () => dismissals.push("commit"),
		onOpenApprovals: () => {},
		waitingCount: 0,
		downloadsDir: null,
		onOpenDownloads: () => {},
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
		dismissals,
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

/**
 * A real pointer press on `target` - the event a click produces BEFORE any focus
 * change. jsdom has no `PointerEvent` constructor; the row's dismissal reads the
 * press and its target, both of which `MouseEvent` carries, and it is dispatched
 * with the bubbling/cancelable/composed shape a browser sends.
 */
async function pointerDown(target) {
	await act(async () => {
		target.dispatchEvent(
			new dom.window.MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				composed: true,
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
/** The notice the combobox points at; the visible list is the native child in
 * the product, so every empty/hint/error sentence is announced through this
 * `aria-describedby` target rather than painted in DOM. */
const describedNotice = (bundle) => {
	/* The field now always names its site description first (S5 U4), so the
	   attribute is a LIST; a notice is whichever referenced node exists. */
	const ids = (bundle.input.getAttribute("aria-describedby") ?? "")
		.split(/\s+/)
		.filter(Boolean);
	for (const id of ids) {
		if (!/-(notice|unavailable)$/.test(id)) continue;
		const node = document.getElementById(id);
		if (node) return node;
	}
	return null;
};
/** The concatenated text of every node the field describes itself with. */
const describedText = (bundle) =>
	(bundle.input.getAttribute("aria-describedby") ?? "")
		.split(/\s+/)
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent ?? "")
		.join(" ");

test("focus fetches once and an empty query shows the session's entries", async () => {
	const bundle = await renderBar();
	await act(async () => bundle.input.focus());
	await flush();
	assert.equal(bundle.requests.length, 1);
	assert.equal(bundle.requests[0].expectedTabId, 1);
	assert.equal(
		bundle.requests[0].query,
		"",
		"an untouched Cmd+L seed is not a query: it asks for the top history (UX U1)",
	);
	assert.ok(bundle.requests[0].limit >= 1);
	assert.ok(options(bundle).length > 0);
	assert.match(list(bundle).textContent, SUGGESTIONS);
	await bundle.cleanup();
});

test("a same-length candidate swap drops the active row and cannot commit it", async () => {
	let entries = SIX_ENTRIES;
	let notify = () => {};
	const bundle = await renderBar({
		url: "about:blank",
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
	for (let step = 0; step < 5; step += 1) await key(bundle, "ArrowDown");
	const staleUrl = options(bundle)[4].getAttribute(
		"data-address-suggestion-url",
	);
	assert.ok(staleUrl, "a row was active before the swap");

	// The same refresh path main uses: a new snapshot arrives while the field is
	// focused. Five URLs become five DIFFERENT URLs, so only the key can see it.
	entries = SWAPPED_SIX;
	await act(async () => notify());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 150));
	});
	await flush();

	assert.equal(options(bundle).length, 5, "the set is still five rows");
	assert.equal(
		bundle.input.getAttribute("aria-activedescendant"),
		null,
		"no row is active after the set changed",
	);
	const before = bundle.navigations.length;
	await key(bundle, "Enter");
	assert.ok(
		bundle.navigations.length > before,
		"Enter still commits the draft",
	);
	assert.notEqual(
		bundle.navigations.at(-1).url,
		staleUrl,
		"Enter never commits the row the user could no longer see",
	);
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
	const active = rows.find(
		(option) =>
			option.id === bundle.input.getAttribute("aria-activedescendant"),
	);
	assert.equal(
		active?.getAttribute("data-address-suggestion-url"),
		"https://example.com/account",
		"Down lands on the first alternative the user could see, not the inline target",
	);
	assert.equal(active?.getAttribute("aria-selected"), "true");
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

test("blur never navigates and only drops the draft on a named target", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	// A NULL relatedTarget is the ambiguous case (page click, child click or
	// window deactivation). The popout keeps the draft; main's page-focus event
	// is what lowers it, and a window blur must not discard text.
	await act(async () => bundle.input.blur());
	await flush();
	assert.equal(bundle.navigations.length, 0);
	assert.equal(bundle.input.value, "example.com/acc");
	// The SURFACE owns the rest: a named focus target outside the popout is its
	// focusout handler's decision, and main's page-focus event covers the native
	// page. This component must not navigate on any blur.
	assert.equal(bundle.dismissals.length, 0);
	await bundle.cleanup();
});

test("one Escape discards the draft and lowers the popout", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "Escape");
	assert.equal(bundle.input.value, "example.com/account");
	assert.ok(!listbox(bundle));
	assert.equal(bundle.dismissals.filter((d) => d === "dismiss").length, 1);
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

test("Backspace removes the suggestion before it edits the draft", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "Backspace");
	assert.equal(bundle.input.value, "example.com/acc");
	assert.ok(!listbox(bundle));
	assert.ok(!list(bundle));
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

test("a search-intent Enter searches DuckDuckGo and the search row is the default", async () => {
	const bundle = await renderBar();
	await type(bundle, "hello world");
	const rows = options(bundle);
	assert.equal(
		rows.length,
		1,
		"no suggestion matches, so only the search row exists",
	);
	assert.match(visibleText(rows[0]), SEARCH_ROW_HELLO);
	assert.equal(
		bundle.input.getAttribute("aria-activedescendant"),
		rows[0].id,
		"the search row is the highlighted default before any arrow key",
	);
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [
		{ url: "https://duckduckgo.com/?q=hello%20world", expectedTabId: 1 },
	]);
	await bundle.cleanup();
});

test("arrow keys move over the search row as well as candidate rows", async () => {
	const bundle = await renderBar();
	await type(bundle, "example");
	const rows = options(bundle);
	assert.equal(rows[0].getAttribute("data-address-suggestion-search"), "true");
	assert.equal(bundle.input.getAttribute("aria-activedescendant"), rows[0].id);
	await key(bundle, "ArrowDown");
	assert.equal(
		bundle.input.getAttribute("aria-activedescendant"),
		rows[1].id,
		"Down leaves the search row for the first candidate",
	);
	await key(bundle, "Enter");
	assert.equal(bundle.navigations.length, 1);
	assert.ok(
		bundle.navigations[0].url.startsWith("https://example.com/"),
		"Enter committed the row Down landed on",
	);
	assert.notEqual(bundle.navigations[0].url, "https://duckduckgo.com/");
	await bundle.cleanup();
});

test("an untouched popout seed is not a query, and Enter navigates nothing", async () => {
	const bundle = await renderBar({ url: "http://intranet/wiki" });
	await act(async () => bundle.input.focus());
	await flush();
	assert.equal(
		options(bundle).some(
			(option) =>
				option.getAttribute("data-address-suggestion-search") === "true",
		),
		false,
		"the live URL is not typed text, so it cannot produce a search row (UX U1)",
	);
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, []);
	assert.deepEqual(
		bundle.dismissals,
		["dismiss"],
		"the untouched Enter lowers the popout instead of leaving it raised (UX U9)",
	);
	await bundle.cleanup();
});

test("Cmd+L, ArrowDown, Enter commits the highlighted history row", async () => {
	const bundle = await renderBar({ url: "https://example.com/account" });
	await act(async () => bundle.input.focus());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 160));
	});
	await flush();
	await key(bundle, "ArrowDown");
	const active = options(bundle).find(
		(option) =>
			option.id === bundle.input.getAttribute("aria-activedescendant"),
	);
	assert.ok(active, "Down selects a row even though the draft is untouched");
	assert.deepEqual(bundle.navigations, []);
	await key(bundle, "Enter");
	assert.equal(
		bundle.navigations.length,
		1,
		"an explicitly selected row commits whatever the draft state (UX U8)",
	);
	assert.equal(
		bundle.navigations[0].url,
		active.getAttribute("data-address-suggestion-url"),
	);
	await bundle.cleanup();
});

test("Cmd+L, type, ArrowDown, Enter commits the highlighted row", async () => {
	const bundle = await renderBar({ url: "https://example.com/account" });
	await type(bundle, "example");
	await key(bundle, "ArrowDown");
	const active = options(bundle).find(
		(option) =>
			option.id === bundle.input.getAttribute("aria-activedescendant"),
	);
	assert.ok(active);
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [
		{
			url: active.getAttribute("data-address-suggestion-url"),
			expectedTabId: 1,
		},
	]);
	await bundle.cleanup();
});

test("a paste with no displayed suffix keeps the best match as a row", async () => {
	const history = [
		{
			url: "https://github.com/",
			title: "GitHub",
			visitCount: 40,
			lastVisitedAt: 0,
			source: "history",
		},
		{
			url: "https://github.com/damianvtran",
			title: "Damian",
			visitCount: 1,
			lastVisitedAt: 0,
			source: "history",
		},
	];
	const bundle = await renderBar({
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: history,
		}),
	});
	await act(async () => bundle.input.focus());
	await flush();
	await act(async () => {
		setValue(bundle.input, "github.co", "insertFromPaste");
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 160));
	});
	await flush();
	assert.equal(bundle.input.value, "github.co", "a paste shows no suffix");
	assert.ok(
		options(bundle).some(
			(option) =>
				option.getAttribute("data-address-suggestion-url") ===
				"https://github.com/",
		),
		"the best match stays a row when no suffix is on screen (UX U2)",
	);
	await bundle.cleanup();
});

test("blocked input says so before Enter, and Enter refuses it", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com:");
	assert.match(describedText(bundle), BLOCKED_HINT);
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, []);
	assert.equal(bundle.input.value, "example.com:");
	await bundle.cleanup();
});

test("a file URL is refused with the same hint and never searched", async () => {
	const bundle = await renderBar();
	await type(bundle, "file:///tmp/a.txt");
	assert.match(describedText(bundle), BLOCKED_HINT);
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, []);
	await bundle.cleanup();
});

test("an arrow key clears the inline suffix it is about to disagree with", async () => {
	const bundle = await renderBar();
	await act(async () => bundle.input.focus());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 160));
	});
	await flush();
	await type(bundle, "example.com/acc");
	assert.equal(
		bundle.input.value,
		"example.com/account/profile",
		"the suffix is real selected text",
	);
	await key(bundle, "ArrowDown");
	assert.equal(
		bundle.input.value,
		"example.com/acc",
		"the field stops naming a destination the highlighted row does not use (UX U6)",
	);
	await bundle.cleanup();
});

test("an explicit arrow selection survives a late answer for the same query", async () => {
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
	await type(bundle, "example");
	await key(bundle, "ArrowDown");
	const selectedUrl = options(bundle)
		.find(
			(option) =>
				option.id === bundle.input.getAttribute("aria-activedescendant"),
		)
		?.getAttribute("data-address-suggestion-url");
	assert.ok(selectedUrl);
	entries = [
		...ENTRIES,
		{
			...ENTRIES[0],
			url: "https://example.com/late",
			sourceIndex: 9,
			distanceFromCurrent: 9,
		},
	];
	await act(async () => notify());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 160));
	});
	await flush();
	const active = options(bundle).find(
		(option) =>
			option.id === bundle.input.getAttribute("aria-activedescendant"),
	);
	assert.equal(
		active?.getAttribute("data-address-suggestion-url"),
		selectedUrl,
		"the highlight stays on the row the user arrowed to (UX U4)",
	);
	await bundle.cleanup();
});

test("the header is true for the rows it sits over", async () => {
	const history = [
		{
			url: "https://example.com/",
			title: "Example",
			visitCount: 3,
			lastVisitedAt: 0,
			source: "history",
		},
		{
			url: "https://example.com/account",
			title: "Account",
			visitCount: 1,
			lastVisitedAt: 0,
			source: "history",
		},
	];
	const bundle = await renderBar({
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: history,
		}),
	});
	await act(async () => bundle.input.focus());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 160));
	});
	await flush();
	await type(bundle, "example.com");
	const labelId = bundle.container
		.querySelector("[data-address-suggestions-list]")
		?.getAttribute("aria-labelledby");
	assert.equal(
		document.getElementById(labelId).textContent,
		"From your history",
	);
	await type(bundle, "hello world");
	const searchLabelId = bundle.container
		.querySelector("[data-address-suggestions-list]")
		?.getAttribute("aria-labelledby");
	assert.equal(
		document.getElementById(searchLabelId).textContent,
		"Suggestions",
		"a search row under 'From your history' would be false (design D1)",
	);
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
	assert.equal(bundle.input.value, "other.example");
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
	assert.match(
		describedNotice(bundle).textContent,
		ADDRESS_SUGGESTIONS_UNAVAILABLE,
	);
	assert.equal(bundle.input.value, "example.com/account");
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

test("an in-flight response is discarded when the tab changes", async () => {
	const pending = [];
	const bundle = await renderBar({
		addressHistory: (request) =>
			new Promise((resolve) => pending.push({ request, resolve })),
	});
	await act(async () => bundle.input.focus());
	await flush();
	await bundle.rerender({ tabId: 2, url: "about:blank" });
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
	assert.doesNotMatch(
		populated.input.getAttribute("aria-describedby") ?? "",
		/-notice/,
		"a populated list names no notice; the site description is not a list state",
	);
	await populated.cleanup();

	const empty = await renderBar({
		url: "",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: [],
		}),
	});
	await act(async () => empty.input.focus());
	await flush();
	assert.equal(empty.input.getAttribute("aria-controls"), null);
	// The EMPTY STATE IS NOT A PANEL (operator decision, 2026-10-24): a focused
	// field with no history and no query shows and describes nothing. The old
	// "No browsing history yet." panel was the complaint this change answers.
	assert.equal(empty.input.getAttribute("aria-expanded"), "false");
	assert.doesNotMatch(describedText(empty), NO_BROWSING_HISTORY);
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
	assert.match(describedText(bundle), ADDRESS_SUGGESTIONS_UNAVAILABLE);
	await bundle.cleanup();
});

test("an accepted target is not reused after an invalidating action", async () => {
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

	const dismissed = await arm();
	// S4b: Escape is the one-stage dismissal (blur no longer discards a draft;
	// the surface/main decide that). After it, Enter must not reuse the target.
	await key(dismissed, "Escape");
	await key(dismissed, "Enter");
	assert.deepEqual(dismissed.navigations, [], "Escape reverts to the live URL");
	await dismissed.cleanup();
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

/*
 * THE OUTSIDE PRESS, THE MAIN DISMISS AND THE EMPTY STATE (operator report,
 * 2026-10-24): clicking into the permanent address field used to leave a
 * native child open over the page, and a press outside never lowered it. These
 * cases pin the renderer half of that contract.
 */

test("focus with an empty history opens nothing, and a typed query still explains itself", async () => {
	const bundle = await renderBar({
		url: "",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: [],
		}),
	});
	await act(async () => bundle.input.focus());
	await flush();
	assert.equal(
		bundle.input.getAttribute("aria-expanded"),
		"false",
		"an empty history is not a reason to raise the native child",
	);
	assert.equal(listbox(bundle), null);
	assert.doesNotMatch(describedText(bundle), NO_BROWSING_HISTORY);
	assert.equal(bundle.navigations.length, 0);

	// A URL-shaped query with nothing behind it is no longer a dead end: the typed
	// address is offered back (and a search), so there is something to press. The
	// "no matching pages" notice is reached only by a refused input now.
	await type(bundle, "https://nothing.example/");
	assert.equal(bundle.input.getAttribute("aria-expanded"), "true");
	assert.match(
		visibleText(options(bundle)[0]),
		/Open "https:\/\/nothing\.example\/"/,
	);
	await type(bundle, "file:///tmp/a.txt");
	assert.equal(
		options(bundle).length,
		0,
		"a refused file: input offers no row",
	);
	await bundle.cleanup();
});

test("a press outside the address row lowers the list and restores the live URL", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	assert.equal(bundle.input.getAttribute("aria-expanded"), "true");
	assert.ok(listbox(bundle), "rows are on screen before the press");

	const outside = document.createElement("div");
	document.body.appendChild(outside);
	await pointerDown(outside);

	assert.equal(
		bundle.input.getAttribute("aria-expanded"),
		"false",
		"a press on non-focusable chrome produces no blur, so the press itself must dismiss",
	);
	assert.equal(listbox(bundle), null);
	assert.equal(bundle.input.value, "example.com/account");
	assert.equal(bundle.navigations.length, 0, "a dismissal is not a commitment");
	outside.remove();
	await bundle.cleanup();
});

test("a press inside the row or in portalled chrome leaves the list alone", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");

	await pointerDown(bundle.input);
	assert.equal(bundle.input.getAttribute("aria-expanded"), "true");
	assert.match(bundle.input.value, /^example\.com\/acc/);

	// A Radix menu/tooltip content is portalled out of the row: its press is
	// chrome interacting with chrome, not a dismissal of the field's list.
	const portal = document.createElement("div");
	portal.setAttribute("data-radix-popper-content-wrapper", "");
	const item = document.createElement("button");
	item.textContent = "Find";
	portal.appendChild(item);
	document.body.appendChild(portal);
	await pointerDown(item);
	assert.equal(bundle.input.getAttribute("aria-expanded"), "true");
	assert.match(bundle.input.value, /^example\.com\/acc/);
	portal.remove();
	await bundle.cleanup();
});

test("main's dismissal abandons the edit instead of re-projecting it", async () => {
	let emit = () => {};
	const projections = [];
	const intents = [];
	dom.window.api = {
		browser: {
			addressOverlay: {
				project: async (payload) => {
					projections.push(payload);
					return { accepted: true };
				},
				onEvent: (callback) => {
					emit = callback;
					return () => {};
				},
			},
		},
	};
	try {
		const bundle = await renderBar({
			onDismiss: (intent) => intents.push(intent),
		});
		await type(bundle, "example.com/acc");
		assert.equal(bundle.input.getAttribute("aria-expanded"), "true");

		// The exact event main sends for a click into the page. The baseline
		// survived this with an origin of `page` because the focus return is a
		// no-op in an unfocused window; the edit itself has to be abandoned.
		const before = projections.length;
		await act(async () => {
			emit({ type: "dismiss", reason: "page_focus" });
		});
		await flush();
		// A frame or two, so a loop that would re-raise the child gets the chance.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 60));
		});
		await flush();

		assert.equal(bundle.input.getAttribute("aria-expanded"), "false");
		assert.equal(bundle.input.value, "example.com/account");
		assert.deepEqual(
			intents,
			[],
			"main's dismissal must not ask the surface to move focus: the user's press already chose the target",
		);
		assert.notEqual(
			document.activeElement,
			bundle.input,
			"the focus outline must go with the edit; the page owns focus now",
		);
		assert.equal(bundle.navigations.length, 0);
		const after = projections.slice(before);
		assert.ok(
			after.length > 0 && after.every((payload) => payload.visible === false),
			"the child must be told to hide, and never re-projected visible",
		);
		await bundle.cleanup();
	} finally {
		dom.window.api = undefined;
	}
});

test("Escape names the escape intent so the surface can return focus to the page", async () => {
	const reasons = [];
	const bundle = await renderBar({
		onDismiss: (reason) => reasons.push(reason),
	});
	await type(bundle, "example.com/acc");
	await key(bundle, "Escape");
	assert.deepEqual(
		reasons,
		["escape"],
		"the surface distinguishes Escape (return to the page) from a cancel",
	);
	assert.equal(bundle.input.value, "example.com/account");
	assert.notEqual(
		document.activeElement,
		bundle.input,
		"Escape hands focus back, so the input must not paint a focus outline",
	);
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

test("a press during composition cannot be undone by compositionend", async () => {
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
	// The list is CLOSED while composing, which is exactly the window the press
	// listener used to miss (review round 1, R1-1).
	assert.equal(bundle.input.getAttribute("aria-expanded"), "false");

	const outside = document.createElement("div");
	document.body.appendChild(outside);
	await pointerDown(outside);

	// The IME commits its interim text after the press already ended the edit.
	await act(async () => {
		bundle.input.dispatchEvent(
			new dom.window.CompositionEvent("compositionend", { bubbles: true }),
		);
	});
	await flush();

	assert.equal(
		bundle.input.getAttribute("aria-expanded"),
		"false",
		"a late composition commit must not re-raise the child after the press left",
	);
	assert.equal(bundle.input.value, "example.com/account");
	assert.notEqual(document.activeElement, bundle.input);
	assert.equal(bundle.navigations.length, 0);
	outside.remove();
	await bundle.cleanup();
});

test("a main dismissal before the first answer keeps the list closed", async () => {
	let resolveHistory = () => {};
	let emit = () => {};
	const intents = [];
	dom.window.api = {
		browser: {
			addressOverlay: {
				project: async () => ({ accepted: true }),
				onEvent: (callback) => {
					emit = callback;
					return () => {};
				},
			},
		},
	};
	try {
		const bundle = await renderBar({
			addressHistory: (request) =>
				new Promise((resolve) => {
					resolveHistory = () =>
						resolve({
							requestId: request.requestId,
							activeTabId: 1,
							entries: ENTRIES,
						});
				}),
			onDismiss: (intent) => intents.push(intent),
		});
		await act(async () => bundle.input.focus());
		await flush();
		assert.equal(
			bundle.input.getAttribute("aria-expanded"),
			"false",
			"the answer is pending, so no list is visible to subscribe the visible path",
		);

		await act(async () => {
			emit({ type: "dismiss", reason: "page_pointer" });
		});
		await flush();

		// The late answer must not resurrect the edit the press/main already ended.
		await act(async () => {
			resolveHistory();
		});
		await flush();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		await flush();

		assert.equal(bundle.input.getAttribute("aria-expanded"), "false");
		assert.equal(bundle.input.value, "example.com/account");
		assert.notEqual(document.activeElement, bundle.input);
		assert.deepEqual(intents, [], "a main dismissal is focus-neutral");
		await bundle.cleanup();
	} finally {
		dom.window.api = undefined;
	}
});

test("a file: live URL does not announce a refusal on focus alone", async () => {
	const bundle = await renderBar({
		url: "file:///tmp/a.txt",
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: [],
		}),
	});
	await act(async () => bundle.input.focus());
	await flush();
	assert.equal(
		bundle.input.getAttribute("aria-expanded"),
		"false",
		"the focus seed is the page URL, not a typed address",
	);
	assert.doesNotMatch(describedText(bundle), BLOCKED_HINT);

	// Typing a file: address IS a user intent, and the refusal still explains it.
	await type(bundle, "file:///tmp/b.txt");
	assert.equal(bundle.input.getAttribute("aria-expanded"), "true");
	assert.match(describedText(bundle), BLOCKED_HINT);
	await bundle.cleanup();
});

/*
 * ROUND 2 (review R2-1/U3-1, R2-2/U3-2): an ended edit must not be reopened by
 * a late IME commit, and Enter on a blank draft must hand the keyboard back.
 */

test("a late IME input after a press cannot re-seed a dismissed draft", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	const outside = document.createElement("div");
	document.body.appendChild(outside);
	await pointerDown(outside);
	assert.equal(bundle.input.getAttribute("data-address-editing"), "false");

	// Chromium delivers the input that commits the composition even though the
	// field was blurred by the press.
	await act(async () => {
		setValue(bundle.input, "example.com/account/profile", "insertText");
	});
	await flush();

	assert.equal(bundle.input.getAttribute("aria-expanded"), "false");
	assert.equal(
		bundle.input.getAttribute("data-address-editing"),
		"false",
		"a late input must not seed the draft again",
	);
	assert.equal(bundle.input.value, "example.com/account");
	assert.equal(bundle.navigations.length, 0);
	outside.remove();
	await bundle.cleanup();
});

test("a late IME input after a commit cannot re-seed the navigated draft", async () => {
	const bundle = await renderBar();
	await type(bundle, "example.com/acc");
	await key(bundle, "Enter");
	assert.equal(bundle.navigations.length, 1);
	assert.equal(bundle.input.getAttribute("data-address-editing"), "false");

	await act(async () => {
		setValue(bundle.input, "example.com/account/pro", "insertText");
	});
	await flush();

	assert.equal(bundle.input.getAttribute("aria-expanded"), "false");
	assert.equal(bundle.input.getAttribute("data-address-editing"), "false");
	assert.equal(bundle.input.value, "example.com/account");
	assert.equal(bundle.navigations.length, 1);
	await bundle.cleanup();
});

test("a late input then compositionend after a press leaves the panel closed", async () => {
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

	const outside = document.createElement("div");
	document.body.appendChild(outside);
	await pointerDown(outside);

	// The `input` that commits the composition can precede `compositionend`.
	await act(async () => {
		setValue(bundle.input, "example.com/account/profile", "insertText");
	});
	await act(async () => {
		bundle.input.dispatchEvent(
			new dom.window.CompositionEvent("compositionend", { bubbles: true }),
		);
	});
	await flush();

	assert.equal(bundle.input.getAttribute("aria-expanded"), "false");
	assert.equal(bundle.input.getAttribute("data-address-editing"), "false");
	assert.equal(bundle.input.value, "example.com/account");
	assert.equal(bundle.navigations.length, 0);
	outside.remove();
	await bundle.cleanup();
});

test("Enter on a blank draft hands focus back instead of dropping it on the body", async () => {
	const reasons = [];
	const bundle = await renderBar({
		onDismiss: (intent) => reasons.push(intent),
	});
	await type(bundle, "   ");
	await key(bundle, "Enter");
	assert.deepEqual(
		reasons,
		["cancel"],
		"the surface must decide where the keyboard goes, as untouched Enter does",
	);
	assert.equal(bundle.input.value, "example.com/account");
	assert.notEqual(document.activeElement, bundle.input);
	assert.equal(bundle.navigations.length, 0);
	await bundle.cleanup();
});

/*
 * NEW TAB / OWN-STATE (operator report, 2026-10-26): typing `qa-app.qa.gominerva.com`
 * into a fresh New tab painted "Address suggestions are unavailable." and opened
 * no list. The history read was healthy (zero entries); the string came from the
 * own-state flag, because main cannot show its native child while the start page
 * is up. These pin the user-visible contract in the same configuration: own-state,
 * the product popout placement, and a history that answers with NOTHING.
 */
const OWN_STATE_ADDRESS = "qa-app.qa.gominerva.com";
const OPEN_TYPED_ROW = /Open "qa-app\.qa\.gominerva\.com"/;
const SEARCH_TYPED_ROW = /Search DuckDuckGo for "qa-app\.qa\.gominerva\.com"/;

const emptyHistory = async (request) => ({
	requestId: request.requestId,
	activeTabId: 1,
	entries: [],
});

test("a new tab with no history still lists the typed address and a search", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: emptyHistory,
	});
	await type(bundle, OWN_STATE_ADDRESS);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
	await flush();

	assert.doesNotMatch(
		bundle.container.textContent,
		/unavailable|stopped working|aren't shown/i,
		"a start page is not an unavailable list",
	);
	assert.equal(
		bundle.container.querySelector(
			'[data-tour-tag="browser-address-unavailable"]',
		),
		null,
		"no unavailable pill is painted over the field",
	);
	const box = listbox(bundle);
	assert.ok(box, "a listbox exists for the typed address");
	assert.equal(
		box.closest(".sr-only"),
		null,
		"the own-state list is VISIBLE: it is the only presenter there",
	);
	const rows = options(bundle);
	assert.equal(rows.length, 2, "the typed address and the search entry");
	assert.match(visibleText(rows[0]), OPEN_TYPED_ROW);
	assert.match(visibleText(rows[1]), SEARCH_TYPED_ROW);
	assert.equal(
		bundle.input.getAttribute("aria-activedescendant"),
		rows[0].id,
		"URL intent highlights the typed address",
	);
	assert.equal(bundle.input.getAttribute("aria-expanded"), "true");
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [
		{ url: OWN_STATE_ADDRESS, expectedTabId: 1 },
	]);
	await bundle.cleanup();
});

test("own-state: search intent keeps the search row first and highlighted", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: emptyHistory,
	});
	await type(bundle, "what is a vpn");
	const rows = options(bundle);
	assert.equal(rows.length, 1, "a search is not also a typed address");
	assert.match(visibleText(rows[0]), /Search DuckDuckGo for "what is a vpn"/);
	assert.equal(bundle.input.getAttribute("aria-activedescendant"), rows[0].id);
	await bundle.cleanup();
});

test("a typed-address row is offered only when nothing matched", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
	});
	await type(bundle, "example.com/acc");
	assert.ok(
		options(bundle).every(
			(row) => !row.hasAttribute("data-address-suggestion-typed"),
		),
		"history candidates exist, so there is no typed-address row above them",
	);
	await bundle.cleanup();
});

test("typed-address rows appear before the first history answer lands", async () => {
	let release = () => {};
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: async (request) => {
			await gate;
			return { requestId: request.requestId, activeTabId: 1, entries: [] };
		},
	});
	await type(bundle, OWN_STATE_ADDRESS);
	assert.equal(options(bundle).length, 2, "rows do not wait on IPC");
	release();
	await flush();
	await bundle.cleanup();
});

test("own-state: a rejected history read says so and keeps the typed rows", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: async () => {
			throw new Error("proof: unavailable");
		},
	});
	await type(bundle, OWN_STATE_ADDRESS);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
	await flush();
	assert.match(bundle.container.textContent, ADDRESS_SUGGESTIONS_UNAVAILABLE);
	assert.doesNotMatch(bundle.container.textContent, OLD_UNAVAILABLE);
	assert.equal(options(bundle).length, 2, "a typed address still works");
	await bundle.cleanup();
});

test("a press on an own-state row commits it and is not an outside press", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: emptyHistory,
	});
	await type(bundle, OWN_STATE_ADDRESS);
	const search = options(bundle)[1];
	await pointerDown(search);
	assert.equal(
		bundle.input.getAttribute("data-address-editing"),
		"true",
		"the list is inside the field's press region (#1396)",
	);
	await act(async () => {
		search.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await flush();
	assert.deepEqual(bundle.navigations, [
		{
			url: `https://duckduckgo.com/?q=${encodeURIComponent(OWN_STATE_ADDRESS)}`,
			expectedTabId: 1,
		},
	]);
	await bundle.cleanup();
});

test("Escape lowers the own-state list like the native one", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: emptyHistory,
	});
	await type(bundle, OWN_STATE_ADDRESS);
	assert.equal(options(bundle).length, 2);
	await key(bundle, "Escape");
	assert.equal(options(bundle).length, 0);
	assert.equal(bundle.dismissals.at(-1), "dismiss");
	await bundle.cleanup();
});

test("the standing hint names its cause and is never said for a plain new tab", async () => {
	const platform = await renderBar({
		overlayMode: "suspend",
		overlayReason: "platform",
	});
	assert.match(
		describedText(platform),
		/Suggestions aren't shown on this system/,
	);
	await platform.cleanup();

	const restart = await renderBar({
		overlayMode: "suspend",
		overlayReason: "child_crash",
	});
	assert.match(describedText(restart), /restart Local Operator/);
	await restart.cleanup();

	const blank = await renderBar({
		overlayMode: "suspend",
		overlayReason: null,
	});
	assert.doesNotMatch(describedText(blank), /Suggestions|restart/);
	await blank.cleanup();

	const ownState = await renderBar({
		url: "about:blank",
		ownState: true,
		overlayMode: "suspend",
		overlayReason: "platform",
		addressHistory: emptyHistory,
	});
	await type(ownState, OWN_STATE_ADDRESS);
	assert.doesNotMatch(
		ownState.container.textContent,
		/aren't shown|stopped working/,
		"own-state has a DOM list, so a platform without the native one is irrelevant",
	);
	assert.equal(options(ownState).length, 2);
	await ownState.cleanup();
});

test("typed and search rows isolate the user's text for RTL sentences, display only", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: emptyHistory,
	});
	await type(bundle, "github.com/");
	const rows = options(bundle);
	assert.equal(
		rows[0].textContent,
		'Open "\u2068github.com/\u2069"',
		"the typed value is wrapped in FSI/PDI inside the sentence, quotes outside",
	);
	assert.equal(
		rows[1].textContent,
		'Search DuckDuckGo for "\u2068github.com/\u2069"',
	);
	assert.equal(
		rows[0].getAttribute("data-address-suggestion-url"),
		null,
		"a typed row carries no URL attribute: the isolates never reach a target",
	);
	// Enter commits the RAW text; the isolates are never part of a destination.
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [
		{ url: "github.com/", expectedTabId: 1 },
	]);
	await bundle.cleanup();
});

/**
 * The native child's rows for the two embedded-value rows. The projection loop
 * needs a delivered content rect (main refuses a projection without the page
 * rect it echoes), so a tiny host mounts the real `useBrowserChrome` hook and
 * sends one through the stubbed bridge - the same call the surface makes.
 */
test("mirror rows carry the value's isolate range and no bidi controls", async () => {
	const projections = [];
	const bridge = new Proxy(
		{
			addressOverlay: {
				project: async (payload) => {
					projections.push(payload);
					return { accepted: true };
				},
				onEvent: () => () => {},
			},
			state: async () => null,
			onStateChanged: () => () => {},
			setContentRect: async () => undefined,
		},
		{
			// Subscriptions (`on*`) return their unsubscribe; every other call is a
			// resolved no-op, which is all the rect hook needs from the bridge.
			get: (target, name) =>
				target[name] ??
				(String(name).startsWith("on")
					? () => () => {}
					: async () => undefined),
		},
	);
	dom.window.api = { browser: bridge };
	let bundle = null;
	let hostRoot = null;
	let host = null;
	try {
		host = document.createElement("div");
		document.body.appendChild(host);
		hostRoot = createRoot(host);
		let sendRect = () => {};
		const Rect = () => {
			sendRect = useBrowserChrome().setContentRect;
			return null;
		};
		await act(async () => {
			hostRoot.render(React.createElement(Rect));
		});
		await act(async () => {
			sendRect({ x: 0, y: 100, width: 800, height: 600 });
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		bundle = await renderBar({ addressHistory: emptyHistory });
		await type(bundle, "192.168.1.1/");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 120));
		});
		const sent = projections
			.filter((payload) => payload.visible && payload.view?.kind === "rows")
			.at(-1);
		assert.ok(sent, "the native child was sent a rows projection");
		const [open, search] = sent.view.rows;
		assert.equal(open.text, 'Open "192.168.1.1/"');
		assert.equal(search.text, 'Search DuckDuckGo for "192.168.1.1/"');
		for (const row of [open, search]) {
			assert.equal(/[\u2066-\u2069]/.test(row.text), false, "no bidi controls");
			assert.equal(
				row.text.slice(row.isolate.start, row.isolate.end),
				"192.168.1.1/",
				"the range names exactly the value",
			);
		}
	} finally {
		// Cleanup must survive a failed assertion: a left-over projection loop keeps
		// the process alive and turns a failure into a hang.
		await bundle?.cleanup();
		if (hostRoot) await act(async () => hostRoot.unmount());
		host?.remove();
		dom.window.api = undefined;
	}
});

/*
 * `enabled` follows own-state <-> presented page, so `request` changes identity
 * on every such flip. The window-wide `onStateChanged` listener must not follow
 * it: CI on this PR caught the start-page harness (whose fake bridge tracks ONE
 * listener) losing the surface's own subscription, so a landed page never showed.
 */
test("flipping own-state does not churn the state-change subscription", async () => {
	let subscribed = 0;
	let unsubscribed = 0;
	// `suspend` is where `enabled` really flips with own-state: the DOM list
	// enables the read, a presented page without the native child does not.
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		overlayMode: "suspend",
		overlayReason: "platform",
		onStateChanged: () => {
			subscribed += 1;
			return () => {
				unsubscribed += 1;
			};
		},
	});
	assert.equal(subscribed, 1);
	await bundle.rerender({ ownState: false });
	await bundle.rerender({ ownState: true });
	await bundle.rerender({ ownState: false });
	assert.equal(subscribed, 1, "one listener for the life of the bar");
	assert.equal(unsubscribed, 0);
	await bundle.cleanup();
	assert.equal(unsubscribed, 1);
});

/*
 * ROUND 1 REMEDIATION (design/UX/QA on PR #1434). Each case below was written
 * and run against the previous head first; the failures are quoted in the PR's
 * remediation comment.
 */
const visitedEntry = (url, title = "") => ({
	url,
	title,
	visitCount: 3,
	lastVisitedAt: 1,
	source: "history",
});

test("U1: a completion on screen is the first, highlighted row and never 'no match'", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: [visitedEntry("http://127.0.0.1:8080/docs/guide", "Guide")],
		}),
	});
	await type(bundle, "127.0.0.1:8080/do");
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
	await flush();
	assert.equal(
		bundle.input.value,
		"127.0.0.1:8080/docs/guide",
		"the field is completing from history",
	);
	assert.doesNotMatch(
		bundle.container.textContent,
		/No matching pages/,
		"the list must not say there is no match while the field completes",
	);
	assert.doesNotMatch(
		bundle.container.querySelector('[role="status"]').textContent,
		/No matching pages/,
	);
	const rows = options(bundle);
	assert.equal(rows.length, 1, "the completion's destination is a real row");
	assert.equal(
		rows[0].getAttribute("data-address-suggestion-url"),
		"http://127.0.0.1:8080/docs/guide",
	);
	assert.equal(rows[0].getAttribute("aria-selected"), "true");
	assert.equal(bundle.input.getAttribute("aria-activedescendant"), rows[0].id);
	await key(bundle, "Enter");
	assert.deepEqual(bundle.navigations, [
		{ url: "http://127.0.0.1:8080/docs/guide", expectedTabId: 1 },
	]);
	await bundle.cleanup();
});

test("U2: a title-only history match keeps the typed row, the search row and the highlight", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: [
				visitedEntry(
					"https://duckduckgo.com/?q=qa-app.qa.gominerva.com",
					"qa-app.qa.gominerva.com at DuckDuckGo",
				),
			],
		}),
	});
	await type(bundle, OWN_STATE_ADDRESS);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
	await flush();
	const rows = options(bundle);
	assert.equal(rows.length, 3, "typed, search, then the title-only match");
	assert.match(visibleText(rows[0]), OPEN_TYPED_ROW);
	assert.match(visibleText(rows[1]), SEARCH_TYPED_ROW);
	assert.equal(
		rows[2].getAttribute("data-address-suggestion-source"),
		"history",
	);
	assert.equal(bundle.input.getAttribute("aria-activedescendant"), rows[0].id);
	await bundle.cleanup();
});

test("Q2: a press on the own-state list's own chrome keeps focus and the draft", async () => {
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: emptyHistory,
	});
	await type(bundle, OWN_STATE_ADDRESS);
	const panel = bundle.container.querySelector(
		'[data-address-list-placement="dom"]',
	);
	assert.ok(panel);
	const header = panel.firstElementChild;
	for (const target of [header, panel]) {
		const press = new dom.window.MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			target.dispatchEvent(press);
		});
		assert.equal(
			press.defaultPrevented,
			true,
			"mousedown on the list's header/edge must not move focus off the field",
		);
	}
	assert.equal(bundle.input.value, OWN_STATE_ADDRESS);
	await bundle.cleanup();
});

test("Q3: bidi controls in the typed value never reach the displayed row, and Enter navigates the raw text", async () => {
	const raw = "ab\u2069\u202Ecd.example";
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: emptyHistory,
	});
	await type(bundle, raw);
	const rows = options(bundle);
	assert.ok(rows.length > 0);
	// The ONE legitimate FSI/PDI pair is the isolate this row wraps around the
	// value; take it off and no bidi control may remain, so the typed PDI + RLO
	// cannot close the isolate and reorder the sentence.
	for (const row of rows) {
		const withoutIsolate = row.textContent.replace(
			"\u2068abcd.example\u2069",
			"abcd.example",
		);
		assert.notEqual(withoutIsolate, row.textContent, "the value is isolated");
		assert.equal(
			/[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/.test(withoutIsolate),
			false,
			`row text carries no stray bidi control: ${JSON.stringify(row.textContent)}`,
		);
	}
	await key(bundle, "Enter");
	assert.equal(
		bundle.navigations.at(-1).url,
		`https://duckduckgo.com/?q=${encodeURIComponent(raw)}`,
		"the commit target stays the raw typed text",
	);
	await bundle.cleanup();
});

test("D2: the full unavailable sentence is the field's title for every standing cause, and the list header's for a failed read", async () => {
	const cases = [
		[
			{ overlayMode: "suspend", overlayReason: "platform" },
			/aren't shown on this system.*Press Enter/,
		],
		[
			{ overlayMode: "suspend", overlayReason: "child_crash" },
			/stopped working.*restart Local Operator/,
		],
	];
	for (const [props, expected] of cases) {
		const bundle = await renderBar(props);
		assert.match(bundle.input.getAttribute("title") ?? "", expected);
		assert.equal(
			bundle.input.getAttribute("title"),
			document.getElementById(
				bundle.input
					.getAttribute("aria-describedby")
					.split(" ")
					.find((id) => id.endsWith("-unavailable")),
			).textContent,
			"the title is exactly the sentence the pill paints and the field describes itself with",
		);
		await bundle.cleanup();
	}
	// A pane below the list's width floor: main refuses `anchor_too_narrow`,
	// which the mirror reports through `onUnavailable`.
	let refuse = false;
	dom.window.api = {
		browser: new Proxy(
			{
				addressOverlay: {
					project: async () => ({
						accepted: false,
						reason: "anchor_too_narrow",
					}),
					onEvent: () => () => {},
				},
			},
			{
				// Subscriptions return their unsubscribe; everything else resolves.
				get: (target, name) =>
					target[name] ??
					(String(name).startsWith("on")
						? () => () => {}
						: async () => undefined),
			},
		),
	};
	try {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const hostRoot = createRoot(host);
		let sendRect = () => {};
		const Rect = () => {
			sendRect = useBrowserChrome().setContentRect;
			return null;
		};
		await act(async () => hostRoot.render(React.createElement(Rect)));
		await act(async () => {
			sendRect({ x: 0, y: 100, width: 800, height: 600 });
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		const bundle = await renderBar({ addressHistory: emptyHistory });
		await type(bundle, OWN_STATE_ADDRESS.replace("qa-app.", "x."));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 120));
		});
		refuse = /too narrow/.test(bundle.input.getAttribute("title") ?? "");
		await bundle.cleanup();
		await act(async () => hostRoot.unmount());
		host.remove();
	} finally {
		dom.window.api = undefined;
	}
	assert.equal(refuse, true, "the narrow-pane sentence is the field's title");

	const failed = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: async () => {
			throw new Error("proof");
		},
	});
	await type(failed, OWN_STATE_ADDRESS);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
	await flush();
	const header = failed.container.querySelector(
		'[data-address-list-placement="dom"]',
	).firstElementChild;
	assert.match(header.textContent, /Couldn't read your browsing history/);
	assert.equal(
		header.getAttribute("title"),
		header.textContent,
		"the truncated header carries its full sentence as a title",
	);
	await failed.cleanup();
});

test("U1: the completion row stays highlighted while the user keeps typing into it", async () => {
	// Per-keystroke, with the history answer already in: the second keystroke
	// leaves the row set unchanged, so only the keystroke handler can keep the
	// highlight the first one set.
	const bundle = await renderBar({
		url: "about:blank",
		ownState: true,
		addressHistory: async (request) => ({
			requestId: request.requestId,
			activeTabId: 1,
			entries: [visitedEntry("http://127.0.0.1:8080/docs/guide", "Guide")],
		}),
	});
	await type(bundle, "127.0.0.1:8080/d");
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
	await flush();
	await act(async () => {
		setValue(bundle.input, "127.0.0.1:8080/do");
	});
	await flush();
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
	await flush();
	assert.equal(bundle.input.value, "127.0.0.1:8080/docs/guide");
	const rows = options(bundle);
	assert.equal(rows.length, 1);
	assert.equal(
		bundle.input.getAttribute("aria-activedescendant"),
		rows[0].id,
		"the completion's row is highlighted after the second keystroke too",
	);
	await bundle.cleanup();
});
