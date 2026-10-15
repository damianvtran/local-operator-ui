import assert from "node:assert/strict";
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
