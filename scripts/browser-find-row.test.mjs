import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bundle = await build({
	entryPoints: [
		"src/renderer/src/features/browser/components/browser-find-row.tsx",
	],
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	write: false,
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
});
// HOW THE CHROME-BAND GUARD FINDS ITS TOOLTIPS (i18n extraction, 2026-10).
//
// The guard greps `browser-url-bar.tsx` for the tooltip tag whose content is the
// find/zoom chord hint, to assert it prefers the chrome band. Before the
// extraction that tag carried the English literal (`Find in page (${glyph})`), so
// the guard matched on `Find in page` / `Reset page zoom`; the extraction moved
// those strings into catalogue keys, the source now carries
// `t("ui.browser.browser_url_bar.find_in_page_shortcut", …)`, and the literal
// grep matches no tag at all — failing on a tag that is still correctly placed.
// The guard's SUBJECT is unchanged (a tooltip tag exists and prefers the chrome
// band); only the thing it is found BY moves with the copy, so it is keyed on the
// id that now holds that copy rather than on the English text.
// `<Tooltip\b[^>]*>` spans the tag's attributes including newlines, and no `>`
// appears inside a `t(…)` call, so a multi-line tag is matched whole.
function chromeBandTooltipTag(source, keyId) {
	return [...source.matchAll(/<Tooltip\b[^>]*>/g)]
		.map((m) => m[0])
		.find((tag) => tag.includes(keyId));
}

// Source/layout guard ONLY: jsdom cannot measure a WebContentsView or prove
// Radix's final placement. Keep new triggers in the in-flow chrome band with
// explicit top placement; native intersection evidence remains a separate gate.
test("source guard: find/zoom live in the page menu, which pauses the page while open", () => {
	const base = "src/renderer/src/features/browser/components/";
	const row = readFileSync(`${base}browser-find-row.tsx`, "utf8");
	const menu = readFileSync(`${base}browser-page-menu.tsx`, "utf8");
	const surface = readFileSync(`${base}browser-surface.tsx`, "utf8");
	// S5: the pause moved into the shared primitive, and it is MEASURED. The page
	// menu is a `DropdownMenuContent`, so it registers only where its painted panel
	// intersects the native view — which the row's bottom edge makes true in the
	// product, and which an inside-band menu can measure as false.
	const primitive = readFileSync(
		"src/renderer/src/shared/components/ui/dropdown-menu.tsx",
		"utf8",
	);
	const tags = [...row.matchAll(/<Tooltip\b[^>]*>/g)].map((m) => m[0]);
	assert.equal(tags.length, 3, "Previous, Next and Close all need this guard");
	for (const tag of tags) assert.ok(tag.includes('side="top"'), tag);
	// S4b moved Find and Print out of the bar and Zoom reset into the page menu.
	// A menu panel paints into the content rect, so it must hide the native view
	// while open — the rule the old tooltip guard protected in the chrome band.
	assert.match(menu, /ui\.browser\.browser_url_bar\.find_in_page/);
	assert.match(menu, /ui\.browser\.browser_url_bar\.page_zoom_reset/);
	assert.match(
		menu,
		/<DropdownMenuContent/,
		"the menu uses the shared primitive",
	);
	assert.match(
		primitive,
		/useMeasuredBrowserViewPanel<HTMLDivElement>\("menu"\)/,
		"the shared menu primitive registers the measured pause",
	);
	assert.doesNotMatch(
		menu,
		/useSuppressBrowserView\(/,
		"the page menu carries no unconditional registration of its own",
	);
	const popout = surface.indexOf("<BrowserUrlBar");
	const find = surface.indexOf("<BrowserFindRow");
	const viewport = surface.indexOf('data-tour-tag="browser-content"');
	assert.ok(
		popout >= 0 && find > popout && viewport > find,
		"the permanent address row and the find row precede the native viewport",
	);
	assert.match(row, /className="@container\/bfind flex shrink-0 flex-wrap/);
	assert.doesNotMatch(row + menu, /useSuppressBrowserViewWhileReaching/);
});

/*
 * NEGATIVE CONTROL: the guard above must fail when the page menu stops hiding
 * the view, or it would be a sentence about a file rather than a check on it.
 */
test("negative control: removing the page menu's view suppression fails the guard", () => {
	const menu = readFileSync(
		"src/renderer/src/features/browser/components/browser-page-menu.tsx",
		"utf8",
	);
	const primitive = readFileSync(
		"src/renderer/src/shared/components/ui/dropdown-menu.tsx",
		"utf8",
	);
	const guard = (source) =>
		/useMeasuredBrowserViewPanel<HTMLDivElement>\("menu"\)/.test(source);
	assert.ok(guard(primitive), "the shipped primitive registers the pause");
	const stripped = primitive.replaceAll(
		'useMeasuredBrowserViewPanel<HTMLDivElement>("menu")',
		"",
	);
	assert.notEqual(stripped, primitive, "the control must alter the source");
	assert.ok(!guard(stripped), "without the call the guard fails");
});

test("find row uses main counts, accessible status, next/previous/Escape and no overlay tooltip", async () => {
	const dom = new JSDOM(
		'<div data-tour-tag="browser-route"><button id="before">Before</button><div id="mount"></div></div>',
		{ url: "http://127.0.0.1:1/#/browser", pretendToBeVisual: true },
	);
	const saved = new Map();
	for (const key of [
		"window",
		"document",
		"navigator",
		"Node",
		"Element",
		"HTMLElement",
		"HTMLInputElement",
		"MutationObserver",
		"getComputedStyle",
		"Event",
		"CustomEvent",
		"IS_REACT_ACT_ENVIRONMENT",
	]) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
		});
	}
	let root;
	try {
		const mod = { exports: {} };
		new Function("require", "module", "exports", bundle.outputFiles[0].text)(
			createRequire(import.meta.url),
			mod,
			mod.exports,
		);
		const { createRoot } = await import("react-dom/client");
		root = createRoot(document.getElementById("mount"));
		document.getElementById("before").focus();
		const calls = [];
		const chrome = {
			state: {
				activeTabId: 1,
				pageControls: {
					find: { tabId: 1, query: "hello", ordinal: 2, matches: 10 },
				},
			},
			pageControl: async (...args) => {
				calls.push(args);
			},
		};
		await act(async () =>
			root.render(React.createElement(mod.exports.BrowserFindRow, { chrome })),
		);
		const field = document.querySelector('[aria-label="Find in page"]');
		assert.equal(document.activeElement, field);
		assert.equal(field.value, "hello");
		assert.equal(document.querySelector("output").textContent, "2 of 10");
		/* THE REACHABLE NON-PLURAL NUMERIC ARM (grouping sweep). The live-region
		 * match position is the one place the count genuinely crosses 1000 —
		 * Electron reports a document-wide match count — and it is NOT a plural
		 * arm, so the `::group-off` sweep over the plural arms did not reach it.
		 * The pre-extraction literal interpolated the RAW number (`${ordinal} of
		 * ${matches}`), so the English must read `1 of 1000`, never `1 of 1,000`.
		 * Both placeholders are pinned at four digits through the shipped
		 * component, not a hand-built string. */
		chrome.state.pageControls.find = {
			tabId: 1,
			query: "hello",
			ordinal: 1,
			matches: 1000,
		};
		await act(async () =>
			root.render(React.createElement(mod.exports.BrowserFindRow, { chrome })),
		);
		assert.equal(
			document.querySelector("output").textContent,
			"1 of 1000",
			"a four-digit match count renders raw, not digit-grouped as 1,000",
		);
		chrome.state.pageControls.find = {
			tabId: 1,
			query: "hello",
			ordinal: 1000,
			matches: 1000,
		};
		await act(async () =>
			root.render(React.createElement(mod.exports.BrowserFindRow, { chrome })),
		);
		assert.equal(
			document.querySelector("output").textContent,
			"1000 of 1000",
			"the ordinal does not group either, at the same four-digit count",
		);
		chrome.state.pageControls.find = {
			tabId: 1,
			query: "hello",
			ordinal: 2,
			matches: 10,
		};
		assert.equal(
			document.querySelector("output").getAttribute("aria-live"),
			"polite",
		);
		assert.equal(
			document.querySelector("[data-lo-tooltip-panel]"),
			null,
			"in-flow row, no tooltip over native view",
		);
		for (const shiftKey of [false, true])
			await act(async () =>
				field.dispatchEvent(
					new dom.window.KeyboardEvent("keydown", {
						key: "Enter",
						shiftKey,
						bubbles: true,
						cancelable: true,
					}),
				),
			);
		assert.deepEqual(calls, [
			[1, "search", "hello", true, true],
			[1, "search", "hello", false, true],
		]);
		await act(async () =>
			field.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					isComposing: true,
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		assert.equal(
			calls.filter((call) => call[1] === "close").length,
			0,
			"IME Escape is not a close gesture",
		);
		await act(async () =>
			field.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		assert.deepEqual(calls.at(-1), [1, "close"]);
		assert.equal(document.activeElement.id, "before");
		for (const label of ["Previous match", "Next match", "Close find"]) {
			const button = document.querySelector(`[aria-label="${label}"]`);
			const before = calls.filter((call) => call[1] === "close").length;
			await act(async () => {
				button.focus();
				button.dispatchEvent(
					new dom.window.KeyboardEvent("keydown", {
						key: "Escape",
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			assert.equal(
				calls.filter((call) => call[1] === "close").length,
				before + 1,
				`Escape from ${label} closes`,
			);
			assert.equal(document.activeElement.id, "before");
		}
		// Main deliberately does not acknowledge these edits yet: the live field
		// must not be restored to the old projection between rapid keystrokes.
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLInputElement.prototype,
			"value",
		).set;
		for (const value of ["rapid-a", "rapid-ab"]) {
			await act(async () => {
				setter.call(field, value);
				field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
			});
		}
		assert.equal(
			field.value,
			"rapid-ab",
			"unacknowledged IPC cannot erase a typed character",
		);
		assert.deepEqual(
			calls.slice(-2),
			[
				[1, "search", "rapid-a"],
				[1, "search", "rapid-ab"],
			],
			"the real editor event door must send both queries to main",
		);
		chrome.state.pageControls.find = {
			tabId: 1,
			query: "missing",
			ordinal: 0,
			matches: 0,
		};
		await act(async () =>
			root.render(React.createElement(mod.exports.BrowserFindRow, { chrome })),
		);
		assert.equal(document.querySelector("output").textContent, "No matches");
		assert.equal(
			document.querySelector('[aria-label="Next match"]').disabled,
			false,
		);
		chrome.state.pageControls.find.pending = true;
		await act(async () =>
			root.render(React.createElement(mod.exports.BrowserFindRow, { chrome })),
		);
		assert.equal(
			document.querySelector("output").textContent,
			"Searching…",
			"a silent native callback is not a no-match verdict",
		);
		chrome.state.pageControls.find.pending = false;
		chrome.state.pageControls.find.unreported = true;
		await act(async () =>
			root.render(React.createElement(mod.exports.BrowserFindRow, { chrome })),
		);
		assert.equal(
			document.querySelector("output").textContent,
			"No result reported. Press Enter to search again.",
		);
		let pageFocus = 0;
		window.api = {
			browser: {
				focusPage: async () => {
					pageFocus++;
				},
			},
		};
		await act(async () =>
			root.render(
				React.createElement(mod.exports.BrowserFindRow, {
					chrome,
					returnToPage: { current: true },
				}),
			),
		);
		await act(async () =>
			document.querySelector('[aria-label="Find in page"]').dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		assert.equal(
			pageFocus,
			1,
			"native-page find returns through guarded page-focus IPC, not stale chrome activeElement",
		);
		chrome.state.pageControls.find = null;
		await act(async () =>
			root.render(React.createElement(mod.exports.BrowserFindRow, { chrome })),
		);
		assert.equal(
			document.querySelector('[data-tour-tag="browser-find-row"]'),
			null,
		);
	} finally {
		if (root) await act(async () => root.unmount());
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
		dom.window.close();
	}
});

/*
 * NEGATIVE CONTROL for the four-digit pin above. A pin that cannot fail is not a
 * pin: this renders the SAME key's PRE-FIX ICU source — the shipped message with
 * its `, ::group-off` token removed, which is exactly what shipped before the
 * grouping sweep — and requires it to GROUP at 1000. So the two assertions above
 * measure the `::group-off` fix rather than a number that happens to be four
 * digits. It formats the catalogue's own bytes (not a hand-typed string), so it
 * tracks the shipped message: change the arm and the control changes with it.
 */
test("negative control: the pre-fix find-row arm groups at four digits", async () => {
	const { IntlMessageFormat } = await import("intl-messageformat");
	const english = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.browser.json", "utf8"),
	);
	const shipped = english["ui.browser.browser_find_row.match_position"];
	assert.ok(
		shipped.includes(", ::group-off"),
		`the shipped arm carries the grouping opt-out: ${shipped}`,
	);
	const prefixSource = shipped.replaceAll(", ::group-off", "");
	assert.notEqual(prefixSource, shipped, "the pre-fix source must differ");
	const format = (source, ordinal, matches) =>
		new IntlMessageFormat(source, "en").format({ ordinal, matches });
	assert.equal(
		format(prefixSource, 1, 1000),
		"1 of 1,000",
		"the pre-fix arm groups at four digits — the defect this pin exists to catch",
	);
	assert.equal(
		format(shipped, 1, 1000),
		"1 of 1000",
		"the shipped arm does not group",
	);
});
