import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * `useScrollToBottom`'s flight LIFECYCLE, mounted (PR #2068 agent review round
 * 1, R1-3). `scroll-to-tail.test.mjs` proves the driver in isolation; this
 * proves the page hook that owns it: the jump-to-latest chip retires at
 * takeoff rather than at the landing, a conversation switch and an unmount
 * each cancel the flight (no frame writes a scroller it no longer belongs to),
 * and a reader's gesture that cancels the flight puts the chip back on the
 * real offset.
 *
 * The browser env (`browserTailScrollEnv`) reads `window.requestAnimationFrame`
 * and `performance.now()`, so both are replaced with a clock this file steps.
 */
const ROOT = resolve(import.meta.dirname, "..");
const CACHE = join(ROOT, "node_modules", ".cache", "scroll-to-bottom-flight");
const bundle = await build({
	stdin: {
		contents:
			'export { useScrollToBottom } from "./src/renderer/src/shared/hooks/use-scroll-to-bottom";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "use-scroll-to-bottom.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { useScrollToBottom } = await import(
	new URL(`file://${bundlePath}`).href
);
const { createRoot } = await import("react-dom/client");

after(() => {
	Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

function mount({ start = -3000 } = {}) {
	const dom = new JSDOM(
		'<!doctype html><div id="root"></div><div id="scroller"></div>',
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	const { window } = dom;
	const scroller = window.document.querySelector("#scroller");
	let top = start;
	const writes = [];
	Object.defineProperties(scroller, {
		clientHeight: { configurable: true, value: 800 },
		scrollHeight: { configurable: true, value: 6000 },
		scrollTop: {
			configurable: true,
			get: () => top,
			set: (value) => {
				top = Math.min(0, value);
				writes.push(top);
			},
		},
	});
	let clock = 0;
	const frames = new Map();
	let nextFrame = 1;
	const raf = (cb) => {
		const id = nextFrame++;
		frames.set(id, cb);
		return id;
	};
	const caf = (id) => frames.delete(id);
	window.ResizeObserver = class {
		observe() {}
		disconnect() {}
	};
	const originals = new Map();
	const globals = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		ResizeObserver: window.ResizeObserver,
		requestAnimationFrame: raf,
		cancelAnimationFrame: caf,
		performance: { now: () => clock },
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
	for (const [name, value] of [
		["requestAnimationFrame", raf],
		["cancelAnimationFrame", caf],
	])
		Object.defineProperty(window, name, { configurable: true, value });

	const ref = { current: scroller };
	let handle = null;
	let contentKey = "conversation-a";
	function Harness() {
		handle = useScrollToBottom(ref, { contentKey });
		return null;
	}
	const root = createRoot(window.document.querySelector("#root"));
	const render = () => act(() => root.render(React.createElement(Harness)));
	render();
	/** One animation frame for every queued callback, 16 ms later. */
	const step = () =>
		act(() => {
			clock += 16;
			const queued = [...frames.entries()];
			frames.clear();
			for (const [, cb] of queued) cb(clock);
		});
	return {
		scroller,
		writes,
		get top() {
			return top;
		},
		get chip() {
			return handle.isFarFromBottom;
		},
		scrollToBottom: () => act(() => handle.scrollToBottom()),
		step,
		switchConversation: (key) => {
			contentKey = key;
			render();
		},
		gesture: (type) =>
			act(() => scroller.dispatchEvent(new window.Event(type))),
		setTop: (value) => {
			top = value;
		},
		unmount: () => act(() => root.unmount()),
		close: () => {
			dom.window.close();
			for (const [name, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
		},
	};
}

test("the chip retires at takeoff, stays down mid-flight, and the flight lands", () => {
	const h = mount();
	try {
		assert.equal(h.chip, true, "a scrolled-up reader sees the chip");
		h.scrollToBottom();
		assert.equal(h.chip, false, "retired in the same tick as the request");
		h.step();
		h.step();
		assert.ok(h.top > -3000 && h.top < 0, "mid-flight");
		assert.equal(h.chip, false, "not re-read from a passing offset");
		for (let i = 0; i < 60 && h.top !== 0; i++) h.step();
		assert.equal(h.top, 0);
		assert.equal(h.chip, false);
	} finally {
		h.unmount();
		h.close();
	}
});

test("a gesture cancels the flight and the chip is re-read from the real offset", () => {
	const h = mount();
	try {
		h.scrollToBottom();
		h.step();
		h.step();
		h.gesture("wheel");
		h.setTop(-2500); // where the reader's own wheel took them
		h.step();
		assert.equal(h.top, -2500, "the flight never writes again");
		assert.equal(h.chip, true, "the chip is back for a reader left away");
	} finally {
		h.unmount();
		h.close();
	}
});

test("a conversation switch cancels the flight", () => {
	const h = mount();
	try {
		h.scrollToBottom();
		h.step();
		h.step();
		h.switchConversation("conversation-b");
		const writes = h.writes.length;
		const at = h.top;
		for (let i = 0; i < 10; i++) h.step();
		assert.equal(h.writes.length, writes, "no frame writes after the switch");
		assert.equal(h.top, at);
	} finally {
		h.unmount();
		h.close();
	}
});

test("an unmount cancels the flight", () => {
	const h = mount();
	try {
		h.scrollToBottom();
		h.step();
		h.step();
		h.unmount();
		const writes = h.writes.length;
		for (let i = 0; i < 10; i++) h.step();
		assert.equal(
			h.writes.length,
			writes,
			"no frame writes a torn-down scroller",
		);
	} finally {
		h.close();
	}
});
