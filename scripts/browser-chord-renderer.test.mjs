import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act, useRef } from "react";

const bundle = await build({
	entryPoints: [
		"src/renderer/src/features/browser/hooks/use-browser-chords.ts",
	],
	bundle: true,
	write: false,
	platform: "node",
	format: "cjs",
	external: ["react"],
	plugins: [
		{
			name: "projection-accessor",
			setup(b) {
				b.onResolve({ filter: /browser-projection-store$/ }, () => ({
					path: "projection",
					namespace: "test",
				}));
				b.onLoad({ filter: /.*/, namespace: "test" }, () => ({
					contents:
						"export function browserBridge(){return window.api.browser}",
				}));
			},
		},
	],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);
const { useBrowserChords } = module.exports;

test("real renderer hook owns scoped DOM commands, focus lifecycle and queued rapid input", async () => {
	const dom = new JSDOM(
		'<div id="mount"></div><button id="chat">Chat</button>',
		{ url: "http://127.0.0.1:1/#/browser", pretendToBeVisual: true },
	);
	const previous = {};
	for (const key of [
		"window",
		"document",
		"navigator",
		"Node",
		"HTMLElement",
		"IS_REACT_ACT_ENVIRONMENT",
	]) {
		previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
		});
	}
	Object.defineProperty(dom.window.navigator, "platform", {
		value: "MacIntel",
	});
	const events = [];
	let incoming;
	let tabs = [
		{ tabId: 1, sessionId: "a" },
		{ tabId: 3, sessionId: "a" },
	];
	let active = 1;
	let redraw;
	let closeFromStrip;
	const api = {
		setChordFocus: async (f) => events.push(["focus", f]),
		focusPage: async () => events.push(["page"]),
		onChord: (fn) => {
			incoming = fn;
			return () => events.push(["unsubscribe"]);
		},
	};
	dom.window.api = { browser: api };
	const chrome = {
		state: { activeTabId: active },
		newTab: async (session) => {
			events.push(["new", session]);
			tabs = [...tabs, { tabId: 10, sessionId: session }];
			active = 10;
			redraw();
		},
		closeTab: async (id) => {
			events.push(["close", id]);
			tabs = tabs.filter((t) => t.tabId !== id);
			redraw();
			return true;
		},
		activateTab: async (id) => {
			events.push(["activate", id]);
			active = id;
			redraw();
		},
		reopenTab: async (s) => events.push(["reopen", s]),
		reload: async (hard) => events.push(["reload", hard]),
		history: async (d) => events.push(["history", d]),
	};
	function Harness() {
		const [, render] = React.useState(0);
		redraw = () => render((n) => n + 1);
		chrome.state = { activeTabId: active };
		const address = useRef(null);
		const { root: ref, closeTab } = useBrowserChords(
			chrome,
			tabs,
			"a",
			address,
		);
		closeFromStrip = closeTab;
		return React.createElement(
			"div",
			{ ref, tabIndex: -1, id: "surface" },
			React.createElement("input", {
				ref: address,
				defaultValue: "https://example.test/one",
				id: "address",
			}),
			React.createElement(
				"button",
				{ id: "toolbar", type: "button" },
				"Toolbar",
			),
		);
	}
	// ReactDOM probes input support at module load; load it AFTER jsdom exists,
	// otherwise its legacy IE input polyfill is a dead measurement instrument.
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(document.getElementById("mount"));
	const flush = () =>
		act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
	async function key(value, flags = {}) {
		await act(async () => {
			document.activeElement.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: value,
					metaKey: true,
					bubbles: true,
					cancelable: true,
					...flags,
				}),
			);
			await Promise.resolve();
		});
		await flush();
	}
	let routeMoves = 0;
	dom.window.addEventListener("keydown", (event) => {
		if (!event.defaultPrevented && event.key === "[") routeMoves++;
	});
	try {
		await act(async () => root.render(React.createElement(Harness)));
		await act(async () => document.getElementById("toolbar").focus());
		await flush();
		assert.deepEqual(events.at(-1), ["focus", true]);
		await key("l");
		assert.equal(document.activeElement.id, "address");
		assert.equal(document.activeElement.selectionStart, 0);
		assert.equal(document.activeElement.selectionEnd, 24);
		await key("[");
		assert.equal(routeMoves, 0);
		assert.ok(events.some((e) => e[0] === "history" && e[1] === "back"));
		await key("R", { shiftKey: true });
		assert.ok(events.some((e) => e[0] === "reload" && e[1] === true));
		const before = events.length;
		await key("r", { altKey: true });
		await key("r", { isComposing: true });
		assert.equal(events.length, before);
		await key("9");
		assert.ok(events.some((e) => e[0] === "activate" && e[1] === 3));
		await key("Tab", { metaKey: false, ctrlKey: true });
		await key("Tab", { metaKey: false, ctrlKey: true, repeat: true });
		assert.deepEqual(events.filter((e) => e[0] === "activate").slice(-2), [
			["activate", 1],
			["activate", 3],
		]);
		await act(async () => document.getElementById("chat").focus());
		await flush();
		assert.deepEqual(events.at(-1), ["focus", false]);
		const closed = events.filter((e) => e[0] === "close").length;
		await key("w");
		assert.equal(events.filter((e) => e[0] === "close").length, closed);
		await act(async () => document.getElementById("toolbar").focus());
		await act(async () => incoming({ intent: "tab-1", origin: "page" }));
		await flush();
		assert.ok(events.some((e) => e[0] === "page"));
		tabs = [{ tabId: 1, sessionId: "a" }];
		active = 1;
		await act(async () => redraw());
		await key("w");
		assert.ok(events.some((e) => e[0] === "close" && e[1] === 1));
		assert.deepEqual(events.filter((e) => e[0] === "new").at(-1), ["new", "a"]);
		const newBefore = events.filter((e) => e[0] === "new").length;
		await act(async () => {
			await closeFromStrip(10);
		});
		assert.equal(
			events.filter((e) => e[0] === "new").length,
			newBefore + 1,
			"strip shares last-tab replacement",
		);
		chrome.closeTab = async () => false;
		await act(async () => {
			assert.equal(await closeFromStrip(10), false);
		});
		assert.equal(
			events.filter((e) => e[0] === "new").length,
			newBefore + 1,
			"refusal cannot create a replacement",
		);
		await act(async () => root.unmount());
		assert.ok(events.some((e) => e[0] === "unsubscribe"));
		assert.deepEqual(events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			false,
		]);
	} finally {
		for (const [key, descriptor] of Object.entries(previous)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
		dom.window.close();
	}
});
