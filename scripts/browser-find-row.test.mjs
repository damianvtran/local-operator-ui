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
		'<button id="before">Before</button><div id="mount"></div>',
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
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		assert.deepEqual(calls.at(-1), [1, "close"]);
		assert.equal(document.activeElement.id, "before");
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
			true,
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
