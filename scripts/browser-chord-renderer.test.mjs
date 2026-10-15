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

/**
 * One mounted harness per scenario: the REAL hook against a surface whose tab
 * buttons are real DOM nodes the projection removes, which is the case the first
 * version of this file never covered (it closed with focus on a persistent
 * toolbar, so a removed focus owner was untestable - UX U2).
 *
 * jsdom does not fire `focusout` when a focused node is removed, Chromium does
 * (UX r1 measured `focusout target=a related=null` then activeElement BODY in the
 * harness browser), so `removeTabNode` replays that event: the unit under test
 * is how the hook reacts to it, not whether jsdom emulates it.
 */
async function rig({ tabIds = [1, 3], activeId = 1 } = {}) {
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
		"Element",
		"HTMLElement",
		"MutationObserver",
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
	let nextId = 10;
	let tabs = tabIds.map((tabId) => ({ tabId, sessionId: "a" }));
	let active = activeId;
	let redraw;
	let closeFromStrip;
	// Late projections are timers; a test that ends first must not let one fire
	// into a torn-down document.
	const timers = new Set();
	const removeTabNode = (id) => {
		const node = document.getElementById(`tab-${id}`);
		if (node && document.activeElement === node) {
			node.dispatchEvent(
				new dom.window.FocusEvent("focusout", {
					bubbles: true,
					relatedTarget: null,
				}),
			);
		}
	};
	dom.window.api = {
		browser: {
			setChordFocus: async (f) => events.push(["focus", f]),
			focusPage: async () => events.push(["page"]),
			onChord: (fn) => {
				incoming = fn;
				return () => events.push(["unsubscribe"]);
			},
		},
	};
	const chrome = {
		state: { activeTabId: active },
		newTab: async (session) => {
			events.push(["new", session]);
			const id = nextId++;
			tabs = [...tabs, { tabId: id, sessionId: session }];
			active = id;
			redraw();
		},
		closeTab: async (id) => {
			events.push(["close", id]);
			removeTabNode(id);
			tabs = tabs.filter((t) => t.tabId !== id);
			if (active === id) active = tabs.at(-1)?.tabId ?? null;
			// The projection lands AFTER the invoke resolves, as in the app: a hook
			// that reads `c.state` on the very next press must not see the old one.
			const timer = setTimeout(() => {
				timers.delete(timer);
				redraw();
			}, 5);
			timers.add(timer);
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
			// The strip's real shape: a row carrying `data-tab-id` around the
			// `[role="tab"]` button, which is what the hook's handoff selector reads.
			tabs.map((t) =>
				React.createElement(
					"div",
					{ key: t.tabId, "data-tab-id": String(t.tabId) },
					React.createElement(
						"button",
						{ id: `tab-${t.tabId}`, role: "tab", type: "button" },
						`Tab ${t.tabId}`,
					),
				),
			),
		);
	}
	// ReactDOM probes input support at module load; load it AFTER jsdom exists,
	// otherwise its legacy IE input polyfill is a dead measurement instrument.
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(document.getElementById("mount"));
	const flush = (ms = 0) =>
		act(async () => {
			await new Promise((resolve) => setTimeout(resolve, ms));
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
		await flush(20);
	}
	await act(async () => root.render(React.createElement(Harness)));
	return {
		dom,
		events,
		root,
		flush,
		key,
		tabs: () => tabs,
		setTabs: (next, nextActive) => {
			tabs = next;
			active = nextActive;
		},
		incoming: (m) => incoming(m),
		redraw: () => redraw(),
		closeFromStrip: (id) => closeFromStrip(id),
		chrome,
		focus: (id) => act(async () => document.getElementById(id).focus()),
		inSurface: () =>
			document.getElementById("surface").contains(document.activeElement),
		finish: () => {
			for (const timer of timers) clearTimeout(timer);
			for (const [k, descriptor] of Object.entries(previous)) {
				if (descriptor) Object.defineProperty(globalThis, k, descriptor);
				else delete globalThis[k];
			}
			dom.window.close();
		},
	};
}

/*
 * The address bar half of the chord contract (UX r1 U1): a draft typed for tab A
 * must not survive a keyboard tab change, and the blur that follows must not
 * commit A's text into tab B. Bundled through the shipped component (CJS, so the
 * `createRequire` above resolves React and the UI packages like the hook bundle
 * does) rather than re-implemented, so the assertion is on the real field.
 */
const barBundle = await build({
	entryPoints: [
		"src/renderer/src/features/browser/components/browser-url-bar.tsx",
	],
	bundle: true,
	write: false,
	platform: "node",
	format: "cjs",
	packages: "external",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: { ".css": "empty" },
});
// Evaluated INSIDE the test, after jsdom's globals exist: the bundle `require`s
// react-dom, which feature-detects input events at load and otherwise installs
// its legacy IE polyfill (`attachEvent`), a dead measurement instrument here.
const loadBar = () => {
	const barModule = { exports: {} };
	new Function("require", "module", "exports", barBundle.outputFiles[0].text)(
		createRequire(import.meta.url),
		barModule,
		barModule.exports,
	);
	return barModule.exports.BrowserUrlBar;
};

test("address draft belongs to its tab: a chord-driven tab change drops it and blur never navigates the new tab", async () => {
	const dom = new JSDOM('<div id="mount"></div>', {
		url: "http://127.0.0.1:1/#/browser",
		pretendToBeVisual: true,
	});
	const previous = {};
	for (const key of [
		"window",
		"document",
		"navigator",
		"Node",
		"Element",
		"HTMLElement",
		"HTMLInputElement",
		"IS_REACT_ACT_ENVIRONMENT",
	]) {
		previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
		});
	}
	const navigated = [];
	const props = (tabId, url) => ({
		tabId,
		url,
		pendingUrl: null,
		loading: false,
		canGoBack: false,
		canGoForward: false,
		disabled: false,
		onNavigate: (u) => navigated.push(u),
		onBack: () => {},
		onForward: () => {},
		onReload: () => {},
		onStop: () => {},
		onOpenApprovals: () => {},
		waitingCount: 0,
		onOpenDownloads: () => {},
	});
	try {
		const BrowserUrlBar = loadBar();
		const { createRoot } = await import("react-dom/client");
		const root = createRoot(document.getElementById("mount"));
		const draw = (tabId, url) =>
			act(async () =>
				root.render(React.createElement(BrowserUrlBar, props(tabId, url))),
			);
		const field = () =>
			document.querySelector('[data-tour-tag="browser-address"]');
		await draw(1, "https://a.example/one");
		await act(async () => field().focus());
		assert.equal(field().value, "https://a.example/one", "Cmd+L shows A");
		// The keyboard moves to tab B while the field still has focus.
		await draw(2, "https://b.example/two");
		assert.equal(
			field().value,
			"https://b.example/two",
			"B's own URL, not A's draft",
		);
		await act(async () => field().blur());
		assert.deepEqual(navigated, [], "blur must not commit A's text into B");
		// A fresh blank tab (Cmd+T / last-tab replacement) shows an empty field.
		await act(async () => field().focus());
		await draw(3, "about:blank");
		assert.equal(field().value, "", "new blank tab is empty, not A's text");
		await act(async () => field().blur());
		assert.deepEqual(navigated, []);
		// Typing on the CURRENT tab still commits there (the draft is not lost).
		await act(async () => field().focus());
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				dom.window.HTMLInputElement.prototype,
				"value",
			).set;
			setter.call(field(), "https://typed.example/");
			field().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		await act(async () => field().blur());
		assert.deepEqual(navigated, ["https://typed.example/"]);
		await act(async () => root.unmount());
	} finally {
		for (const [key, descriptor] of Object.entries(previous)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
		dom.window.close();
	}
});

test("real renderer hook owns scoped DOM commands, focus lifecycle and queued rapid input", async () => {
	const r = await rig();
	const { events, key, flush } = r;
	let routeMoves = 0;
	r.dom.window.addEventListener("keydown", (event) => {
		if (!event.defaultPrevented && event.key === "[") routeMoves++;
	});
	try {
		await r.focus("toolbar");
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
		await r.focus("toolbar");
		await act(async () => r.incoming({ intent: "tab-1", origin: "page" }));
		await flush();
		assert.ok(events.some((e) => e[0] === "page"));
		await act(async () => r.root.unmount());
		assert.ok(events.some((e) => e[0] === "unsubscribe"));
		assert.deepEqual(events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			false,
		]);
	} finally {
		r.finish();
	}
});

test("keyboard close with focus ON the closing tab button keeps the browser as focus owner (UX U2)", async () => {
	const r = await rig({ tabIds: [1, 3, 5], activeId: 5 });
	const { events, key, flush } = r;
	try {
		// Focus the very node the close removes: the case that stranded the flag.
		await r.focus("tab-5");
		await flush();
		assert.deepEqual(events.at(-1), ["focus", true]);
		await key("w");
		assert.ok(events.some((e) => e[0] === "close" && e[1] === 5));
		assert.equal(document.getElementById("tab-5"), null, "tab node removed");
		assert.ok(r.inSurface(), "focus stays inside the browser surface");
		// No transient or stranded "left the browser": a false here is what let the
		// next Cmd+W fall through to the menu and close the whole app window.
		const focusReports = events.filter((e) => e[0] === "focus");
		assert.deepEqual(focusReports.at(-1), ["focus", true]);
		assert.ok(
			!focusReports.some((e, i) => i > 0 && e[1] === false),
			`focus owner must never be dropped: ${JSON.stringify(focusReports)}`,
		);
		// ...and the NEXT press is still heard by the surface, closing the next tab.
		await key("w");
		assert.deepEqual(
			events.filter((e) => e[0] === "close").map((e) => e[1]),
			[5, 3],
		);
	} finally {
		r.finish();
	}
});

test("rapid double Cmd+W closes two different tabs, never the same one twice (UX U8 stale projection)", async () => {
	const r = await rig({ tabIds: [1, 3, 5], activeId: 5 });
	const { events, flush } = r;
	try {
		await r.focus("tab-5");
		await flush();
		// Both presses land before any render: the queue, not a debounce, orders them.
		await act(async () => {
			for (let i = 0; i < 2; i++)
				document.activeElement.dispatchEvent(
					new r.dom.window.KeyboardEvent("keydown", {
						key: "w",
						metaKey: true,
						bubbles: true,
						cancelable: true,
					}),
				);
			await Promise.resolve();
		});
		// The projection lands on a timer outside `act`, as it does in the app.
		for (
			let i = 0;
			i < 40 && events.filter((e) => e[0] === "close").length < 2;
			i++
		)
			await flush(10);
		assert.deepEqual(
			events.filter((e) => e[0] === "close").map((e) => e[1]),
			[5, 3],
		);
		assert.ok(r.inSurface());
	} finally {
		r.finish();
	}
});

test("closing the last tab opens the fresh blank tab and puts the caret in the address bar", async () => {
	const r = await rig({ tabIds: [7], activeId: 7 });
	const { events, key, flush } = r;
	try {
		await r.focus("tab-7");
		await flush();
		await key("w");
		await flush(40);
		assert.deepEqual(events.filter((e) => e[0] === "new").at(-1), ["new", "a"]);
		assert.equal(document.activeElement.id, "address");
		assert.deepEqual(events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			true,
		]);
		// And a second Cmd+W acts on the replacement, still heard.
		await key("w");
		assert.ok(events.filter((e) => e[0] === "close").length >= 2);
	} finally {
		r.finish();
	}
});

test("strip close shares last-tab replacement and a refusal creates nothing", async () => {
	const r = await rig({ tabIds: [10], activeId: 10 });
	const { events } = r;
	try {
		await r.focus("toolbar");
		const newBefore = events.filter((e) => e[0] === "new").length;
		await act(async () => {
			await r.closeFromStrip(10);
		});
		assert.equal(
			events.filter((e) => e[0] === "new").length,
			newBefore + 1,
			"strip shares last-tab replacement",
		);
		r.chrome.closeTab = async () => false;
		await act(async () => {
			assert.equal(await r.closeFromStrip(10), false);
		});
		assert.equal(
			events.filter((e) => e[0] === "new").length,
			newBefore + 1,
			"refusal cannot create a replacement",
		);
	} finally {
		r.finish();
	}
});
