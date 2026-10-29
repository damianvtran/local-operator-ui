import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act, useRef } from "react";

const bundle = await build({
	stdin: {
		contents:
			'export {useBrowserChords} from "./src/renderer/src/features/browser/hooks/use-browser-chords"; export {suppressBrowserView} from "./src/renderer/src/shared/browser-view-policy";',
		resolveDir: process.cwd(),
	},
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
const { useBrowserChords, suppressBrowserView } = module.exports;

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
async function rig({
	tabIds = [1, 3],
	activeId = 1,
	pane = false,
	sessionId = "a",
	platform = "MacIntel",
	ownState = false,
} = {}) {
	const dom = new JSDOM(
		'<div id="mount"></div><button id="chat">Chat</button><input id="chat-editor" aria-label="Chat editor">',
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
		value: platform,
	});
	const events = [];
	const incoming = new Set();
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
				incoming.add(fn);
				return () => {
					incoming.delete(fn);
					events.push(["unsubscribe"]);
				};
			},
		},
	};
	let find = null;
	let returnRef;
	const chrome = {
		pageControl: async (tabId, action) => {
			events.push(["page-control", tabId, action]);
			if (action === "open") find ??= { tabId, query: "hello" };
			else if (action === "close") find = null;
			redraw();
		},
		state: { activeTabId: active },
		newTab: async (session) => {
			events.push(["new", session]);
			const id = nextId++;
			tabs = [...tabs, { tabId: id, sessionId: session }];
			active = id;
			redraw();
			// S5: the surface focuses the PERMANENT ROW when the new tab's start
			// page becomes current — a surface-side effect, not a chord `close()`.
			// The rig's stand-in is the root, so the DOM owner still survives.
			document.getElementById("surface")?.focus();
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
		reload: async (hard) => events.push(["reload", hard, active]),
		history: async (d) => events.push(["history", d]),
	};
	function Harness() {
		const [, render] = React.useState(0);
		redraw = () => render((n) => n + 1);
		chrome.state = { activeTabId: active, pageControls: { find } };
		const inputRef = useRef(null);
		// S4b's hook talks to an AddressController, not directly to an input. The
		// rig keeps a real focusable field so "Cmd+L puts the caret in the field"
		// remains the measured property, not a mock call count.
		const address = useRef({
			raise: () => {
				inputRef.current?.focus();
				inputRef.current?.select();
			},
			// S5 deleted `close()`: nothing is raised to lower. The new tab's start
			// page focuses the row from the SURFACE, which this rig models in the
			// `newTab` mock above.
		});
		const {
			root: ref,
			closeTab,
			openFind,
			findReturnToPage,
		} = useBrowserChords(chrome, tabs, sessionId, address, ownState);
		closeFromStrip = closeTab;
		returnRef = findReturnToPage;
		const surface = React.createElement(
			"div",
			{
				ref,
				tabIndex: -1,
				id: "surface",
				"data-tour-tag": pane ? "browser-pane-surface" : "browser-route",
			},
			React.createElement("input", {
				ref: inputRef,
				defaultValue: "https://example.test/one",
				id: "address",
			}),
			React.createElement(
				"button",
				{ id: "toolbar", type: "button" },
				"Toolbar",
			),
			React.createElement(
				"button",
				{
					id: "find-toolbar",
					type: "button",
					onClick: () => void openFind("chrome"),
				},
				"Find",
			),
			find &&
				React.createElement(
					"div",
					{ "data-tour-tag": "browser-find-row" },
					React.createElement("input", {
						id: "find-editor",
						defaultValue: "hello",
					}),
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
		return pane
			? React.createElement(
					"section",
					{ "data-tour-tag": "browser-pane" },
					React.createElement(
						"button",
						{ id: "pane-header", type: "button" },
						"Browser scope",
					),
					surface,
				)
			: surface;
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
		returnToPage: () => returnRef.current,
		events,
		root,
		flush,
		key,
		tabs: () => tabs,
		setTabs: (next, nextActive) => {
			tabs = next;
			active = nextActive;
		},
		incoming: (m) => {
			for (const fn of incoming) fn(m);
		},
		mountPeer: async ({ hidden = false } = {}) => {
			const node = document.createElement("div");
			node.hidden = hidden;
			document.body.append(node);
			const peer = createRoot(node);
			await act(async () => peer.render(React.createElement(Harness)));
			return Object.assign(
				async () => {
					await act(async () => peer.unmount());
					node.remove();
					await act(async () => root.render(React.createElement(Harness)));
				},
				{ node },
			);
		},
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
		// The URL bar measures its permanent suggestions dock on mount, and the
		// chrome hover test's own harness already ships this stub: jsdom has no
		// ResizeObserver, and the component only needs one to exist.
		"ResizeObserver",
		"IS_REACT_ACT_ENVIRONMENT",
	]) {
		previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
		let value = dom.window[key];
		if (key === "IS_REACT_ACT_ENVIRONMENT") value = true;
		else if (key === "ResizeObserver")
			value = class {
				observe() {}
				unobserve() {}
				disconnect() {}
			};
		Object.defineProperty(globalThis, key, { configurable: true, value });
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
		assert.equal(field().value, "a.example/one", "Cmd+L shows A");
		// The keyboard moves to tab B while the field still has focus.
		await draw(2, "https://b.example/two");
		assert.equal(field().value, "b.example/two", "B's own URL, not A's draft");
		await act(async () => field().blur());
		assert.deepEqual(navigated, [], "blur must not commit A's text into B");
		// A fresh blank tab (Cmd+T / last-tab replacement) shows an empty field.
		await act(async () => field().focus());
		await draw(3, "about:blank");
		// A blank tab projects no address; the start page's own field is what a
		// user sees there.
		assert.equal(field().value, "", "new blank tab is empty, not A's draft");
		await act(async () => field().blur());
		assert.deepEqual(navigated, []);
		// Typing on the CURRENT tab is never committed by blur: the suggestion
		// contract makes Enter (or a chosen candidate) the only commit, so a click
		// on the page cannot navigate to text the person did not accept.
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
		assert.deepEqual(navigated, [], "blur never commits");
		// Enter on the current tab still commits there (the draft is not lost).
		await act(async () => field().focus());
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				dom.window.HTMLInputElement.prototype,
				"value",
			).set;
			setter.call(field(), "https://typed.example/");
			field().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
			field().dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
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

/*
 * D-PR9 / U10: a DOM tooltip cannot paint above the native page view, and the
 * address field sits directly over the content rect, so no visible tooltip may
 * wrap it. jsdom has no layout, so the geometry half (panel rect vs the rect
 * `registerBrowserViewRect` reports) is measured natively and recorded in the
 * evidence; this is the half a unit test CAN pin: a control that does show a
 * tooltip is rendered as the positive control (so an empty panel list cannot
 * pass by the harness being unable to open one), and the address field must not.
 */
test("the address field renders no tooltip, while a chrome-band control still does (D-PR9)", async () => {
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
		// Radix's tooltip dispatches a `CustomEvent` on open; without jsdom's own
		// Event classes as globals it throws and the test would fail for the harness,
		// not for the product.
		"Event",
		"CustomEvent",
		"MouseEvent",
		"FocusEvent",
		"KeyboardEvent",
		"getComputedStyle",
		"ResizeObserver",
		"IS_REACT_ACT_ENVIRONMENT",
	]) {
		previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
		let value = dom.window[key];
		if (key === "IS_REACT_ACT_ENVIRONMENT") value = true;
		// jsdom's window methods need their own `this`; Radix's popper also measures
		// with a ResizeObserver jsdom does not ship, and only needs it to exist.
		else if (key === "getComputedStyle")
			value = dom.window.getComputedStyle.bind(dom.window);
		else if (key === "ResizeObserver")
			value = class {
				observe() {}
				unobserve() {}
				disconnect() {}
			};
		Object.defineProperty(globalThis, key, { configurable: true, value });
	}
	try {
		const BrowserUrlBar = loadBar();
		const { createRoot } = await import("react-dom/client");
		const root = createRoot(document.getElementById("mount"));
		await act(async () =>
			root.render(
				React.createElement(BrowserUrlBar, {
					tabId: 1,
					url: "https://a.example/one",
					pendingUrl: null,
					loading: false,
					canGoBack: true,
					canGoForward: false,
					disabled: false,
					onNavigate: () => {},
					onBack: () => {},
					onForward: () => {},
					onReload: () => {},
					onStop: () => {},
					onOpenApprovals: () => {},
					waitingCount: 0,
					onOpenDownloads: () => {},
				}),
			),
		);
		const panels = () =>
			[...document.querySelectorAll("[data-lo-tooltip-panel]")].map(
				(panel) => panel.textContent,
			);
		// POINTER ONLY, on both controls. The address tooltip used to be suppressed
		// while the field had focus (Radix opens on keyboard focus and Cmd+L focuses
		// it), so a test that focused the field first could not see that tooltip
		// at all: that version passed against the old source, a vacuous control.
		const hover = async (element) => {
			await act(async () => {
				for (const type of ["pointerover", "pointermove", "mouseover"]) {
					element.dispatchEvent(
						new dom.window.MouseEvent(type, { bubbles: true }),
					);
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 900));
		};
		const back = document.querySelector('[aria-label="Back"]');
		assert.ok(back, "the Back control rendered");
		await hover(back);
		assert.ok(
			panels().some((text) => text.startsWith("Back")),
			`positive control: hovering Back opens its tooltip; panels=${JSON.stringify(panels())}`,
		);
		const field = document.querySelector('[data-tour-tag="browser-address"]');
		assert.ok(
			field.getAttribute("aria-keyshortcuts"),
			"the chord stays machine-readable",
		);
		assert.equal(field.getAttribute("aria-label"), "Address");
		await hover(field);
		assert.deepEqual(
			panels().filter((text) => text.startsWith("Address")),
			[],
			"no tooltip over the content rect",
		);
		await act(async () => root.unmount());
	} finally {
		for (const [key, descriptor] of Object.entries(previous)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
		dom.window.close();
	}
});

test("StageA BODY route owns selected reload and distinct rapid new tabs, not a DOM rest-stop accident", async () => {
	const r = await rig({ sessionId: null });
	try {
		assert.equal(document.activeElement, document.body);
		assert.deepEqual(
			r.events.filter((e) => e[0] === "focus").at(-1),
			["focus", true],
			"main/menu receives the logical BODY owner before a physical key",
		);
		await r.key("r");
		assert.deepEqual(
			r.events.filter((e) => e[0] === "reload"),
			[["reload", false, 1]],
		);
		await act(async () => r.chrome.activateTab(3));
		await r.focus("toolbar");
		await act(async () => document.activeElement.blur());
		await r.key("r");
		assert.deepEqual(r.events.filter((e) => e[0] === "reload").at(-1), [
			"reload",
			false,
			3,
		]);
		const before = r.tabs().length;
		await act(async () => {
			for (let i = 0; i < 2; i++)
				document.body.dispatchEvent(
					new r.dom.window.KeyboardEvent("keydown", {
						key: "t",
						metaKey: true,
						bubbles: true,
						cancelable: true,
					}),
				);
		});
		await r.flush(25);
		assert.equal(r.tabs().length, before + 2);
		assert.equal(new Set(r.tabs().map((t) => t.tabId)).size, before + 2);
		assert.deepEqual(
			r.events.filter((e) => e[0] === "new"),
			[
				["new", null],
				["new", null],
			],
		);
		// Cmd+T closes the popout and the start page's own field (inside the same
		// root) takes focus; the rig's stand-in is the surface root.
		assert.equal(document.activeElement.id, "surface");
	} finally {
		await act(async () => r.root.unmount());
		r.finish();
	}
});

test("StageA real pane ancestor header owns R/T; chat, modal, wrong modifiers, IME and repeats do not", async () => {
	const r = await rig({ pane: true });
	let release;
	try {
		r.dom.window.location.hash = "#/chat";
		await r.focus("pane-header");
		await r.key("r");
		await r.key("t");
		assert.deepEqual(
			r.events.filter((e) => e[0] === "reload"),
			[["reload", false, 1]],
		);
		assert.deepEqual(
			r.events.filter((e) => e[0] === "new"),
			[["new", "a"]],
		);
		await r.focus("chat");
		const count = r.events.filter((e) =>
			["reload", "new"].includes(e[0]),
		).length;
		await r.key("r");
		await r.key("t");
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			count,
		);
		assert.deepEqual(r.events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			false,
		]);
		await r.focus("pane-header");
		await act(async () => {
			release = suppressBrowserView("dialog:StageA-modal");
		});
		await r.key("r");
		await r.key("t");
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			count,
		);
		assert.deepEqual(r.events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			false,
		]);
		await act(async () => {
			release();
			release = null;
		});
		for (const [key, flags] of [
			["r", { ctrlKey: true, metaKey: false }],
			["t", { altKey: true }],
			["r", { isComposing: true }],
			["t", { repeat: true }],
		])
			await r.key(key, flags);
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			count,
		);
		await act(async () => document.activeElement.blur());
		await r.key("t");
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			count,
			"chat BODY never inherits pane ownership",
		);
	} finally {
		release?.();
		await act(async () => r.root.unmount());
		r.finish();
	}
});

test("StageA hidden, non-browser BODY and ambiguous multiple surfaces never claim fallback/messages", async () => {
	const r = await rig();
	let removePeer;
	try {
		const surface = document.getElementById("surface");
		surface.hidden = true;
		await r.key("r");
		await r.key("t");
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			0,
		);
		surface.hidden = false;
		surface.setAttribute("inert", "");
		await r.key("r");
		await r.key("t");
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			0,
			"inert chrome cannot claim BODY",
		);
		surface.removeAttribute("inert");
		await r.focus("chat-editor");
		await r.key("r");
		await r.key("t");
		await act(async () =>
			document.body.dispatchEvent(
				new r.dom.window.KeyboardEvent("keydown", {
					key: "t",
					metaKey: true,
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			0,
			"outside editable remains the owner even if a BODY event is synthesized",
		);
		await act(async () => document.activeElement.blur());
		r.dom.window.location.hash = "#/chat";
		await r.key("r");
		await r.key("t");
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			0,
		);
		r.dom.window.location.hash = "#/browser";
		removePeer = await r.mountPeer();
		await r.key("r");
		await r.key("t");
		await act(async () => r.incoming({ intent: "new-tab", origin: "chrome" }));
		await r.flush();
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			0,
			"no global broadcast into multiple scoped surfaces",
		);
	} finally {
		await removePeer?.();
		await act(async () => r.root.unmount());
		r.finish();
	}
});

test("StageA focused A survives hidden B mount/update/unmount and one incoming invocation dispatches once", async () => {
	const r = await rig({ pane: true });
	let removePeer;
	try {
		r.dom.window.location.hash = "#/chat";
		await r.focus("pane-header");
		const start = r.events.length;
		removePeer = await r.mountPeer({ hidden: true });
		await act(async () => {
			removePeer.node.hidden = false;
		});
		await act(async () => {
			removePeer.node.style.display = "none";
		});
		await act(async () => r.incoming({ intent: "new-tab", origin: "chrome" }));
		await r.flush(25);
		assert.equal(
			r.events.filter((e) => e[0] === "new").length,
			1,
			"main output is scoped, never broadcast into B",
		);
		await removePeer();
		removePeer = null;
		await r.flush();
		assert.equal(
			r.events.slice(start).some((e) => e[0] === "focus" && e[1] === false),
			false,
			"B cannot overwrite A's one main-process boolean",
		);
		// S4b: the replacement tab is a start page, whose own field autofocuses on
		// mount; the popout is lowered. This rig has no start page, so body is the
		// honest focus owner after the new-tab close.
		assert.equal(document.activeElement.id, "surface");
		await r.key("r");
		assert.equal(r.events.filter((e) => e[0] === "reload").length, 1);
	} finally {
		await removePeer?.();
		await act(async () => r.root.unmount());
		r.finish();
	}
});

test("StageA loading and failed selected tabs keep BODY reload targeted and new tabs in the existing scope", async () => {
	const r = await rig({ sessionId: null });
	try {
		for (const [loading, failed] of [
			[true, false],
			[false, true],
		]) {
			await act(async () => {
				r.setTabs(
					[
						{ tabId: 1, sessionId: null },
						{ tabId: 3, sessionId: null, loading, failed },
					],
					3,
				);
				r.redraw();
			});
			await r.focus("toolbar");
			await act(async () => document.activeElement.blur());
			await r.key("r");
			assert.deepEqual(r.events.filter((e) => e[0] === "reload").at(-1), [
				"reload",
				false,
				3,
			]);
		}
		await r.key("t");
		assert.deepEqual(
			r.events.filter((e) => e[0] === "new"),
			[["new", null]],
		);
		assert.equal(r.tabs().length, 3);
		// The new tab is a start page with its own field (not modeled here). A
		// BOOLEAN is the assertion subject: `assert.equal` on a DOM node prints the
		// node on failure, and inspecting a live jsdom element can allocate GBs.
		assert.equal(document.activeElement.id, "surface");
	} finally {
		await act(async () => r.root.unmount());
		r.finish();
	}
});

/*
 * THE VIEW-SUPPRESSION REGISTRY CONFLATED TWO DIFFERENT FACTS (S4a).
 *
 * `availableRoots` refused every root while ANY registration was live, and the
 * browser surface registers its OWN state pages there: the start page and the
 * load-failure panel hide the NATIVE VIEW so their DOM can paint (design 11.3).
 * That registration is not an overlay covering the browser - the browser is
 * exactly what the user is looking at - so Cmd+L/T/R were dropped on those two
 * states, and the renderer reported "focus left the browser" to main, which made
 * main refuse the same keys on its side.
 *
 * The NEGATIVE CONTROL is the real modal case: an id the surface does not own
 * must still take every chord away, including main's broadcast door.
 */
test("the browser's own state pages keep L/T/R and main's messages; a real modal takes them", async () => {
	const r = await rig({ pane: true });
	const releases = [];
	try {
		// EACH STATE ON ITS OWN. These are the surface's two self-registrations
		// (`browser-surface.tsx`) pushed through the REAL shared registry, so
		// ref-counting and id shape are the app's; a regression in either one must
		// fail on its own line rather than hide behind the other.
		for (const id of [
			"browser-state:browser-start-page:test",
			"browser-state:browser-load-failure:test",
		]) {
			let release;
			await act(async () => {
				release = suppressBrowserView(id);
			});
			await r.focus("toolbar");
			const reloads = r.events.filter((e) => e[0] === "reload").length;
			const tabs = r.events.filter((e) => e[0] === "new").length;
			const activeTab = r.chrome.state.activeTabId;
			await r.key("l");
			assert.equal(
				document.activeElement.id,
				"address",
				`Cmd+L reaches the address field (${id})`,
			);
			assert.equal(document.activeElement.selectionStart, 0);
			assert.equal(
				document.activeElement.selectionEnd,
				"https://example.test/one".length,
				`and selects what is there, so typing replaces it (${id})`,
			);
			await r.key("r");
			await r.key("t");
			assert.deepEqual(
				r.events.filter((e) => e[0] === "reload").slice(reloads),
				[["reload", false, activeTab]],
				`Cmd+R reloads the browser's tab, never the app window (${id})`,
			);
			assert.deepEqual(
				r.events.filter((e) => e[0] === "new").slice(tabs),
				[["new", "a"]],
				`Cmd+T opens a browser tab in the existing scope (${id})`,
			);
			// Cmd+T lands on a start page; the surface focuses the permanent row,
			// which this rig models as the surface root.
			assert.equal(document.activeElement.id, "surface");
			await act(async () => release());
		}

		// BOTH AT ONCE: the filter has to be a union over the list, not a single
		// prefix that happens to match. Main's broadcast door is the second door to
		// the same owner and must find it while only self-registrations are live.
		await act(async () => {
			for (const id of [
				"browser-state:browser-start-page:test",
				"browser-state:browser-load-failure:test",
			])
				releases.push(suppressBrowserView(id));
		});
		const start = r.events.length;
		await act(async () => r.incoming({ intent: "new-tab", origin: "chrome" }));
		await r.flush(20);
		assert.deepEqual(
			r.events.slice(start).filter((e) => e[0] === "new"),
			[["new", "a"]],
			"main's broadcast door finds the same owner while only state pages hide the view",
		);
		assert.deepEqual(r.events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			true,
		]);

		// NEGATIVE CONTROL: a genuine overlay is a different fact.
		await act(async () => {
			for (const release of releases.splice(0)) release();
		});
		await act(async () => {
			releases.push(suppressBrowserView("dialog:test"));
		});
		await r.focus("toolbar");
		const modalStart = r.events.length;
		await r.key("l");
		await r.key("r");
		await r.key("t");
		await act(async () => r.incoming({ intent: "new-tab", origin: "chrome" }));
		await r.flush(20);
		assert.equal(
			r.events.slice(modalStart).filter((e) => ["reload", "new"].includes(e[0]))
				.length,
			0,
			"a dialog owns the keyboard: no browser command executes",
		);
		assert.equal(
			document.activeElement.id,
			"toolbar",
			"and Cmd+L does not move focus into the address field",
		);
		assert.deepEqual(r.events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			false,
		]);

		// Releasing the dialog restores ownership; ref-counting leaves nothing behind.
		await act(async () => {
			for (const release of releases.splice(0)) release();
		});
		const reloads = r.events.filter((e) => e[0] === "reload").length;
		await r.focus("toolbar");
		await r.key("r");
		assert.equal(
			r.events.filter((e) => e[0] === "reload").length,
			reloads + 1,
			"the chords come back when the overlay closes",
		);
		assert.deepEqual(r.events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			true,
		]);
	} finally {
		for (const release of releases.splice(0)) release();
		await act(async () => r.root.unmount());
		r.finish();
	}
});

test("StageA renderer window blur does not clear a retained pane DOM owner; real outside input does", async () => {
	const r = await rig({ pane: true });
	try {
		r.dom.window.location.hash = "#/chat";
		await r.focus("pane-header");
		const start = r.events.length;
		await act(async () => {
			r.dom.window.dispatchEvent(new r.dom.window.Event("blur"));
			document.activeElement.dispatchEvent(
				new r.dom.window.FocusEvent("focusout", {
					bubbles: true,
					relatedTarget: null,
				}),
			);
		});
		await r.flush();
		assert.equal(
			r.events.slice(start).some((e) => e[0] === "focus" && e[1] === false),
			false,
			"null relatedTarget does not prove DOM departure",
		);
		await act(async () =>
			r.dom.window.dispatchEvent(new r.dom.window.Event("focus")),
		);
		assert.deepEqual(r.events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			true,
		]);
		await r.focus("chat");
		assert.deepEqual(r.events.filter((e) => e[0] === "focus").at(-1), [
			"focus",
			false,
		]);
		await r.key("r");
		await r.key("t");
		assert.equal(
			r.events.filter((e) => ["reload", "new"].includes(e[0])).length,
			0,
		);
	} finally {
		await act(async () => r.root.unmount());
		r.finish();
	}
});

test("RT-only BODY direct neighbors retain existing address/find/close/reopen/zoom/digit/cycle/history meanings", async () => {
	const r = await rig({ tabIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
	const body = () => act(async () => document.activeElement.blur());
	try {
		for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
			await body();
			await r.key(String(digit));
			assert.deepEqual(r.events.filter((e) => e[0] === "activate").at(-1), [
				"activate",
				digit === 9 ? 10 : digit,
			]);
		}
		await body();
		await r.key("Tab", { metaKey: false, ctrlKey: true });
		assert.deepEqual(r.events.filter((e) => e[0] === "activate").at(-1), [
			"activate",
			1,
		]);
		await body();
		await r.key("Tab", { metaKey: false, ctrlKey: true, shiftKey: true });
		assert.deepEqual(r.events.filter((e) => e[0] === "activate").at(-1), [
			"activate",
			10,
		]);
		for (const [key, direction] of [
			["[", "back"],
			["]", "forward"],
		]) {
			await body();
			await r.key(key);
			assert.deepEqual(r.events.filter((e) => e[0] === "history").at(-1), [
				"history",
				direction,
			]);
		}
		for (const [key, action] of [
			["=", "in"],
			["-", "out"],
			["0", "reset"],
		]) {
			await body();
			await r.key(key);
			assert.deepEqual(r.events.filter((e) => e[0] === "page-control").at(-1), [
				"page-control",
				10,
				action,
			]);
		}
		await body();
		await r.key("f");
		assert.deepEqual(r.events.filter((e) => e[0] === "page-control").at(-1), [
			"page-control",
			10,
			"open",
		]);
		// This bare placeholder tests routing, not BrowserFindRow's own mount
		// autofocus effect (browser-find-row.tsx). Native QA checks real focus.
		assert.ok(document.getElementById("find-editor"));
		await body();
		await r.key("l");
		assert.equal(document.activeElement.id, "address");
		assert.equal(document.activeElement.selectionStart, 0);
		assert.equal(
			document.activeElement.selectionEnd,
			document.activeElement.value.length,
		);
		await body();
		await r.key("T", { shiftKey: true });
		assert.deepEqual(r.events.filter((e) => e[0] === "reopen").at(-1), [
			"reopen",
			"a",
		]);
		await body();
		await r.key("w");
		assert.deepEqual(r.events.filter((e) => e[0] === "close").at(-1), [
			"close",
			10,
		]);
		assert.equal(r.tabs().length, 9);
	} finally {
		await act(async () => r.root.unmount());
		r.finish();
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

test("a Linux host gets Latin-1 primary chords on Ctrl, and Meta is not primary (MAJOR-3)", async () => {
	/*
	 * THE LANE THE MAC-ONLY RIG COULD NOT FAIL (agent review round 2, MAJOR-3).
	 * The hook derived `darwin` from `chordPlatform()`'s truthiness, and that
	 * helper answers `"mac" | "linux"` — two truthy strings — so every host was
	 * read as a Mac. The rig hardcoded `MacIntel` and passed. This runs the same
	 * shipped hook under a Linux `navigator.platform` and presses the primary
	 * modifier the Linux table names: Ctrl for L/T/R/W/digits, while Cmd does
	 * nothing. The Mac lane above is unchanged and still proves the other half.
	 */
	const r = await rig({
		tabIds: [1, 3],
		activeId: 1,
		platform: "Linux x86_64",
	});
	const { events, key } = r;
	const ctrl = { metaKey: false, ctrlKey: true };
	try {
		await r.focus("toolbar");
		await key("l", ctrl);
		assert.equal(
			document.activeElement.id,
			"address",
			"Ctrl+L raises the address",
		);

		await r.focus("toolbar");
		await key("t", ctrl);
		assert.deepEqual(events.at(-1), ["new", "a"], "Ctrl+T opens a tab");

		await r.focus("toolbar");
		await key("r", ctrl);
		assert.ok(
			events.some((e) => e[0] === "reload" && e[1] === false),
			"Ctrl+R reloads",
		);

		await r.focus("toolbar");
		await key("2", ctrl);
		assert.deepEqual(
			events.filter((e) => e[0] === "activate").at(-1),
			["activate", 3],
			"Ctrl+2 selects the second tab",
		);

		await key("w", ctrl);
		assert.deepEqual(
			events.filter((e) => e[0] === "close").at(-1),
			["close", 3],
			"Ctrl+W closes the selected tab",
		);

		await r.focus("toolbar");
		await key("f", ctrl);
		assert.ok(
			events.some((e) => e[0] === "page-control" && e[2] === "open"),
			"Ctrl+F opens the find row",
		);

		// The OTHER half of the bug: on this host Meta is not primary, so the
		// Mac spelling must not fire. A hook that still mapped everything to
		// `darwin` would pass the Ctrl presses above only by accident if it read
		// modifiers loosely; this pins the platform branch itself.
		await r.focus("toolbar");
		const before = events.length;
		await key("l");
		assert.equal(events.length, before, "Cmd+L is not a chord on Linux");
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

test("closing the last tab opens the fresh blank tab and keeps the browser as focus owner", async () => {
	const r = await rig({ tabIds: [7], activeId: 7 });
	const { events, key, flush } = r;
	try {
		await r.focus("tab-7");
		await flush();
		await key("w");
		await flush(40);
		assert.deepEqual(events.filter((e) => e[0] === "new").at(-1), ["new", "a"]);
		// S4b: the replacement is a START PAGE, whose own field autofocuses on
		// mount; the popout is lowered rather than focusing an address bar that no
		// longer exists at rest. This rig has no start page, so the surface root is
		// the honest focus owner here.
		assert.equal(document.activeElement.id, "surface");
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

test("page-open then chrome-repeat and toolbar repeat preserve first origin and select editor", async () => {
	const r = await rig();
	try {
		await r.focus("address");
		await act(async () => r.incoming({ intent: "find-page", origin: "page" }));
		await r.flush(20);
		assert.equal(r.returnToPage(), true);
		await r.focus("find-editor");
		await r.key("f");
		assert.equal(
			r.returnToPage(),
			true,
			"repeat in chrome retains original native-page return",
		);
		await r.focus("find-toolbar");
		await act(async () => document.getElementById("find-toolbar").click());
		await r.flush(20);
		assert.equal(document.activeElement.id, "find-editor");
		assert.equal(document.activeElement.selectionStart, 0);
		assert.equal(document.activeElement.selectionEnd, 5);
		assert.equal(
			r.returnToPage(),
			true,
			"toolbar re-focus cannot replace opening ownership either",
		);
	} finally {
		await act(async () => r.root.unmount());
		r.finish();
	}
});

test("S5: chords share the menu's own-state in both directions", async () => {
	const blocked = await rig({ ownState: true });
	try {
		await blocked.focus("toolbar");
		await blocked.key("f", { metaKey: true });
		await blocked.key("=", { metaKey: true });
		assert.equal(
			blocked.events.filter((e) => e[0] === "page-control").length,
			0,
			"a start/failure page refuses Find and zoom, like the disabled menu",
		);
	} finally {
		blocked.finish();
	}

	// `about:blank` while a submitted navigation is loading is NOT own-state:
	// the menu is enabled, so the same chord must reach main.
	const loading = await rig({ ownState: false });
	try {
		await loading.focus("toolbar");
		await loading.key("f", { metaKey: true });
		assert.ok(
			loading.events.some((e) => e[0] === "page-control" && e[2] === "open"),
			"the loading blank page still opens Find",
		);
	} finally {
		loading.finish();
	}
});

test("S5: the surface hands the chords the same own-state as the menu", () => {
	const surface = readFileSync(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
		"utf8",
	);
	const chords = readFileSync(
		"src/renderer/src/features/browser/hooks/use-browser-chords.ts",
		"utf8",
	);
	assert.match(surface, /browserOwnState,\s*\);/, "the surface passes it in");
	assert.match(
		surface,
		/canControlPage=\{!browserOwnState && activeTab !== null\}/,
		"the menu reads the same fact",
	);
	assert.equal(
		(chords.match(/if \(latest\.current\.browserOwnState\) return;/g) ?? [])
			.length,
		2,
		"Find and zoom both take the shared guard",
	);
});
