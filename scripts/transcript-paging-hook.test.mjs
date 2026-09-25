import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = join(ROOT, "node_modules", ".cache", "transcript-paging-hook");
const bundle = await build({
	stdin: {
		contents:
			'export { useScrollPaging } from "./src/renderer/src/features/chat/canonical/use-scroll-paging";\nexport { SETTLE_MS } from "./src/renderer/src/features/chat/canonical/scroll-paging";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	external: ["react"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "use-scroll-paging.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { useScrollPaging, SETTLE_MS } = await import(new URL(`file://${bundlePath}`).href);
const { createRoot } = await import("react-dom/client");

after(() => {
	Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

/**
 * Mount the production hook against just enough DOM to exercise its real event
 * listeners and layout effect. Geometry is controlled because jsdom has no
 * layout engine; the revision, hold, input dispatch and scrollTop write are not
 * mocked. This catches a missing hook-to-helper connection without pretending
 * to be a rendered browser capture.
 */
function mountHook(options = {}) {
	const dom = new JSDOM(
		'<!doctype html><div id="root"></div><div id="transcript"><div data-lo-transcript-content><div data-record-id="held-row"></div></div></div>',
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	const { window } = dom;
	const originals = new Map();
	const pendingFrames = new Map();
	let nextFrame = 1;
	const frame = (callback) => {
		const id = nextFrame++;
		pendingFrames.set(id, callback);
		return id;
	};
	const cancelFrame = (id) => pendingFrames.delete(id);
	const scroller = window.document.querySelector("#transcript");
	const row = scroller.querySelector("[data-record-id]");
	let scrollTop = -50;
	let scrollHeight = 1000;
	let anchorTop = 120;
	Object.defineProperties(scroller, {
		clientHeight: { configurable: true, value: 800 },
		scrollHeight: {
			configurable: true,
			get: () => scrollHeight,
		},
		scrollTop: {
			configurable: true,
			get: () => scrollTop,
			set: (value) => {
				scrollTop = value;
			},
		},
	});
	scroller.getBoundingClientRect = () => ({ top: 100, bottom: 900 });
	row.getBoundingClientRect = () => ({
		top: anchorTop,
		bottom: anchorTop + 30,
	});
	window.CSS = { escape: (value) => String(value).replaceAll('"', '\\"') };
	window.Element.prototype.scrollIntoView = () => {};
	window.ResizeObserver = class {
		observe() {}
		disconnect() {}
	};
	const globals = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		KeyboardEvent: window.KeyboardEvent,
		WheelEvent: window.WheelEvent,
		CSS: window.CSS,
		ResizeObserver: window.ResizeObserver,
		requestAnimationFrame: frame,
		cancelAnimationFrame: cancelFrame,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [name, value] of Object.entries(globals)) {
		originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value,
		});
	}
	Object.defineProperty(window, "requestAnimationFrame", {
		configurable: true,
		value: frame,
	});
	Object.defineProperty(window, "cancelAnimationFrame", {
		configurable: true,
		value: cancelFrame,
	});

	const root = createRoot(window.document.querySelector("#root"));
	let rowCount = 1;
	let widenCalls = 0;
	// Parameterised so a case can mount the reader in the state it is about
	// (rows held back, a landing to drive) without a second harness beside
	// this one.
	let hiddenRows = options.hiddenRows ?? 1;
	const onLoadOlder = options.onLoadOlder ?? (async () => false);
	function Harness() {
		useScrollPaging({
			containerRef: { current: scroller },
			sessionKey: "synthetic-session",
			hiddenRows,
			hasMore: options.hasMore ?? true,
			onWiden: () => {
				widenCalls++;
			},
			onLoadOlder,
			loadingOlder: false,
			rowCount,
			contentKey: "fixture",
		});
		return null;
	}
	const render = () => act(() => root.render(React.createElement(Harness)));
	const flushFrame = () => {
		const callbacks = [...pendingFrames.values()];
		pendingFrames.clear();
		act(() => {
			for (const callback of callbacks) callback(0);
		});
	};
	const flushInitial = () => {
		for (let i = 0; i < 4 && pendingFrames.size; i++) flushFrame();
	};
	const requestReveal = () => {
		act(() =>
			scroller.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Home",
					bubbles: true,
				}),
			),
		);
		flushFrame();
	};
	const readerInput = () =>
		act(() =>
			scroller.dispatchEvent(
				new window.WheelEvent("wheel", {
					deltaY: -80,
					bubbles: true,
				}),
			),
		);
	const growAboveAnchor = () => {
		scrollHeight += 400;
		anchorTop += 24;
		rowCount++;
		render();
	};
	const close = () => {
		for (const id of pendingFrames.keys()) cancelFrame(id);
		act(() => root.unmount());
		dom.window.close();
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	};

	render();
	flushInitial();
	return {
		close,
		get scrollTop() {
			return scrollTop;
		},
		get widenCalls() {
			return widenCalls;
		},
		setScrollTop: (value) => {
			scrollTop = value;
		},
		setScrollHeight: (value) => {
			scrollHeight = value;
		},
		setHiddenRows: (value) => {
			hiddenRows = value;
			render();
		},
		flushFrames: (count = 1) => {
			for (let i = 0; i < count; i++) flushFrame();
		},
		requestReveal,
		readerInput,
		growAboveAnchor,
	};
}

test("the mounted paging hook holds layout growth but yields to later reader input", () => {
	const layoutOnly = mountHook();
	try {
		layoutOnly.requestReveal();
		assert.equal(
			layoutOnly.widenCalls,
			1,
			"the real Home listener armed a reveal",
		);
		layoutOnly.growAboveAnchor();
		assert.equal(
			layoutOnly.scrollTop,
			-26,
			"layout-only growth is corrected by the production useLayoutEffect",
		);
	} finally {
		layoutOnly.close();
	}

	const laterInput = mountHook();
	try {
		laterInput.requestReveal();
		assert.equal(
			laterInput.widenCalls,
			1,
			"the real Home listener armed a reveal",
		);
		laterInput.readerInput();
		laterInput.growAboveAnchor();
		assert.equal(
			laterInput.scrollTop,
			-50,
			"real wheel input invalidates the hook's held sample before the row-count commit",
		);
	} finally {
		laterInput.close();
	}
});

/*
 * Round-1 review F1, at the layer it was reproduced against the pump: a
 * rule-6 widen owed because a landing happened inside the input debounce has
 * nobody to re-decide it when the landing itself returned `none` — the pump's
 * only delayed re-run for a `none` state was gated on an armed demand. The
 * pure suite can hold the debt (the policy returns it either way); only the
 * mounted hook shows whether the pump ever asks again on its own.
 *
 * TIMING NOTE, stated because the case is about a window: the landing must
 * happen within `SETTLE_MS` of the input for the debt to be unpaid at the
 * landing's own decide, which is the state the pump has to schedule for. No
 * real work happens between the two here (a wheel event, two frame flushes and
 * one prop commit), so the margin is the whole debounce; on a machine loaded
 * enough to lose 120 ms inside that, the case degenerates to the
 * already-settled path the pure suite covers and stops discriminating.
 */
test("a rule-6 debt landed inside the debounce is re-decided at the settle", async () => {
	let loads = 0;
	const hook = mountHook({
		hiddenRows: 0,
		onLoadOlder: async () => {
			loads += 1;
			return true;
		},
	});
	try {
		// Hard top: distance = scrollHeight - clientHeight - |scrollTop| = 2.
		hook.setScrollTop(-198);
		hook.readerInput();
		hook.flushFrames(4);
		assert.equal(loads, 1, "the hard-top push buys its round trip");
		// Let the fetch's promise resolve, then land the page the way the app
		// does: rows arrive, the extent grows under the reader, and the window
		// is still holding 60 of them back. The reader is now OFF the hard top
		// (distance 100) but inside the zone, which is the whole reason the
		// debt has to wait for a settle: `settled` is only free at the wall.
		await new Promise((resolve) => setTimeout(resolve, 0));
		hook.setScrollTop(-500);
		hook.setScrollHeight(1400);
		hook.setHiddenRows(60);
		hook.flushFrames(6);
		assert.equal(
			hook.widenCalls,
			0,
			"inside the debounce the debt waits rather than mounting under the reader",
		);
		// The pump must re-decide at the settle the debt is waiting for: no
		// further input, no further content change.
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 80));
		hook.flushFrames(6);
		assert.equal(
			hook.widenCalls,
			1,
			"the owed widen is paid at the settle it was waiting for",
		);
	} finally {
		hook.close();
	}
});
