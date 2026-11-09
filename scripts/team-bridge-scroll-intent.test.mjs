import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * "IT FIGHTS ME": a reader at the bottom of a Team Bridge conversation who
 * scrolls up must never be thrown back down.
 *
 * Real hooks (`use-stick-to-bottom`, `use-team-bridge-timeline-window`),
 * synthetic geometry: jsdom has no layout, so scrollTop / scrollHeight /
 * clientHeight and row rects are modelled here, and ResizeObserver callbacks
 * are fired by hand at the moments a browser would fire them (the windowed
 * timeline re-cutting its slice and re-measuring rows mid-gesture). This is
 * the hook contract, not browser-frame evidence.
 */
const bundle = await build({
	stdin: {
		contents: `
 export {useStickToBottom} from "./src/renderer/src/features/team-bridge/use-stick-to-bottom";
 export {useTimelineWindow} from "./src/renderer/src/features/team-bridge/use-team-bridge-timeline-window";
 `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["react", "react-dom"],
	loader: { ".css": "empty" },
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiled = new Module(
	`${process.cwd()}/scripts/scroll-intent-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/scroll-intent-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLImageElement = dom.window.HTMLImageElement;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
	dom.window,
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
	dom.window,
);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const h = React.createElement;
const VIEW = 400;

/** A fake ResizeObserver registry: `fire()` is "the content just resized". */
function observers() {
	const all = [];
	const previous = globalThis.ResizeObserver;
	globalThis.ResizeObserver = class {
		constructor(callback) {
			this.callback = callback;
			this.active = true;
			all.push(this);
		}
		observe() {}
		disconnect() {
			this.active = false;
		}
	};
	return {
		fire: () =>
			act(async () => {
				for (const o of all) if (o.active) o.callback([]);
			}),
		live: () => all.filter((o) => o.active).length,
		restore: () => {
			globalThis.ResizeObserver = previous;
		},
	};
}

/** Mount `useStickToBottom` on a Radix-shaped host whose content height we own. */
async function mountStick() {
	const state = { content: 2000, top: 0, ids: ["a", "b"], resetKey: "c1" };
	const ro = observers();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let api;
	let node;
	const instrument = (element) => {
		if (!element || element === node) return;
		node = element;
		Object.defineProperties(element, {
			scrollHeight: { configurable: true, get: () => state.content },
			clientHeight: { configurable: true, get: () => VIEW },
			scrollTop: {
				configurable: true,
				get: () => state.top,
				set: (value) => {
					state.top = Math.max(0, Math.min(state.content - VIEW, value));
				},
			},
		});
	};
	function Probe() {
		api = m.useStickToBottom({
			resetKey: state.resetKey,
			contentKey: state.ids.join(":"),
		});
		return h(
			"div",
			{ ref: api.rootRef },
			h(
				"div",
				{ ref: instrument, "data-radix-scroll-area-viewport": "" },
				h(
					"div",
					null,
					state.ids.map((id) => h("div", { key: id }, id)),
				),
			),
		);
	}
	const render = () => act(async () => root.render(h(Probe)));
	await render();
	const max = () => state.content - VIEW;
	return {
		state,
		max,
		api: () => api,
		render,
		fireResize: ro.fire,
		/** The reader's scroll: the browser moves scrollTop, then dispatches. */
		userScroll: (to) =>
			act(async () => {
				node.scrollTop = to;
				node.dispatchEvent(new window.Event("scroll"));
			}),
		wheel: (deltaY, init = {}) =>
			act(async () => {
				node.dispatchEvent(new window.WheelEvent("wheel", { deltaY, ...init }));
			}),
		/** Content grows by `by` px with no scroll event (a row re-measured). */
		grow: async (by) => {
			state.content += by;
			await ro.fire();
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			host.remove();
			assert.equal(ro.live(), 0, "observers are released");
			ro.restore();
		},
	};
}

test("a reader at the bottom scrolling up in small steps is never pulled back, even as the content resizes", async () => {
	const t = await mountStick();
	try {
		assert.equal(t.state.top, t.max(), "opens at the newest message");
		/* Before the fix: every step below sat inside the 48px band, so the
		   hook stayed pinned and the resize threw the reader back to max. */
		const trace = [];
		let expected = t.state.top;
		for (let step = 0; step < 6; step += 1) {
			expected -= 6;
			await t.userScroll(expected);
			await t.grow(step % 2 === 0 ? 12 : -8); // the window re-measures mid-gesture
			trace.push({
				scrollTop: t.state.top,
				scrollHeight: t.state.content,
				clientHeight: VIEW,
			});
			assert.equal(
				t.state.top,
				expected,
				`step ${step}: reader kept their position (${JSON.stringify(trace)})`,
			);
		}
		assert.equal(t.api().isPinned(), false);
		t.state.ids = [...t.state.ids, "c"];
		t.state.content += 60;
		await t.render();
		assert.equal(t.state.top, expected, "a new message does not yank them");
	} finally {
		await t.cleanup();
	}
});

test("an upward wheel unpins before its scroll lands, so a resize in between cannot yank", async () => {
	const t = await mountStick();
	try {
		// A pinch-zoom arrives as a ctrl+wheel: not a scroll, so it never unpins.
		await t.wheel(-4, { ctrlKey: true });
		await t.grow(30);
		assert.equal(t.state.top, t.max(), "pinch leaves a pinned reader pinned");
		const bottom = t.state.top;
		await t.wheel(-4); // the scroll has not been applied yet
		await t.grow(30);
		assert.equal(t.state.top, bottom, "resize between wheel and scroll holds");
		await t.userScroll(bottom - 4);
		await t.grow(30);
		assert.equal(t.state.top, bottom - 4, "and the scroll itself holds");
		// An upward tick the browser absorbed must not strand the reader: a
		// downward tick inside the band re-pins.
		await t.userScroll(t.max());
		await t.wheel(4);
		assert.equal(t.api().isPinned(), true);
	} finally {
		await t.cleanup();
	}
});

test("only the reader re-pins: scrolling back down into the band follows new messages again", async () => {
	const t = await mountStick();
	try {
		await t.userScroll(t.max() - 300);
		await t.grow(50);
		assert.equal(t.state.top, t.max() - 350, "held while reading history");
		await t.userScroll(t.max() - 20); // the reader's own move down, into the band
		assert.equal(t.api().isPinned(), true);
		t.state.ids = [...t.state.ids, "c"];
		t.state.content += 80;
		await t.render();
		assert.equal(t.state.top, t.max(), "follows the next message");
		await t.grow(40);
		assert.equal(t.state.top, t.max(), "and later reflows (image load, D9)");
	} finally {
		await t.cleanup();
	}
});

test("content shrinking under a pinned reader (scrollTop clamped down) is not mistaken for intent", async () => {
	const t = await mountStick();
	try {
		t.state.content -= 120; // a slice re-cut shorter
		await t.userScroll(t.state.top); // the clamp's own scroll event
		assert.equal(t.state.top, t.max());
		assert.equal(t.api().isPinned(), true, "still pinned");
		t.state.ids = [...t.state.ids, "c"];
		t.state.content += 90;
		await t.render();
		assert.equal(t.state.top, t.max(), "still follows new messages");
	} finally {
		await t.cleanup();
	}
});

test("pin() on own send and a conversation switch still put the reader at the newest message", async () => {
	const t = await mountStick();
	try {
		await t.userScroll(t.max() - 500);
		await act(async () => t.api().pin());
		assert.equal(t.state.top, t.max(), "own send pins");
		await t.userScroll(t.max() - 500);
		t.state.resetKey = "c2";
		t.state.content = 3000;
		await t.render();
		assert.equal(t.state.top, t.max(), "switch opens at newest");
		assert.equal(t.api().isPinned(), true);
	} finally {
		await t.cleanup();
	}
});

/*
 * THE SECOND WRITER. The windowed timeline kept its own "at bottom" in an
 * anchor refreshed one animation frame AFTER each scroll. A layout change in
 * that frame gap - a row re-measured as the slice re-cut - read the stale
 * `atBottom: true` and snapped the reader to the end even when they had
 * scrolled well past the 48px band. With `isPinned` given, the strip asks the
 * stick-to-bottom hook instead.
 */
test("the windowed strip holds the bottom only when stick-to-bottom says the reader is there", async () => {
	const ro = observers();
	const ids = Array.from({ length: 60 }, (_, i) => `m${i}`);
	const entries = ids.map((id) => ({
		key: `msg:${id}`,
		item: { type: "message", continuation: true, message: { id } },
	}));
	const real = new Map(entries.map((e) => [e.key, 50])); // estimate is 44
	const scene = {
		top: 0,
		range: { start: 0, end: 0 },
		spacers: { before: 0, after: 0 },
	};
	const mounted = () =>
		entries
			.slice(scene.range.start, scene.range.end)
			.reduce((sum, e) => sum + real.get(e.key), 0);
	const content = () => scene.spacers.before + mounted() + scene.spacers.after;
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const listRef = { current: null };
	let stick;
	let viewportNode;
	const rect = (y, size) => ({
		top: y,
		bottom: y + size,
		height: size,
		left: 0,
		right: 600,
		width: 600,
	});
	const instrument = (element) => {
		if (!element || element === viewportNode) return;
		viewportNode = element;
		Object.defineProperties(element, {
			scrollHeight: { configurable: true, get: content },
			clientHeight: { configurable: true, get: () => VIEW },
			scrollTop: {
				configurable: true,
				get: () => scene.top,
				set: (value) => {
					scene.top = Math.max(0, Math.min(content() - VIEW, value));
				},
			},
		});
		element.getBoundingClientRect = () => rect(0, VIEW);
	};
	const rowTop = (index) =>
		scene.spacers.before +
		entries
			.slice(scene.range.start, index)
			.reduce((sum, e) => sum + real.get(e.key), 0) -
		scene.top;
	function Probe() {
		stick = m.useStickToBottom({
			resetKey: "c1",
			contentKey: String(entries.length),
		});
		const win = m.useTimelineWindow({
			entries,
			listRef,
			scrollRootRef: stick.rootRef,
			resetKey: "c1",
			hasOlder: false,
			loadingOlder: false,
			isPinned: stick.isPinned,
		});
		scene.range = win.range;
		scene.spacers = win.spacers;
		return h(
			"div",
			{ ref: stick.rootRef },
			h(
				"div",
				{ ref: instrument, "data-radix-scroll-area-viewport": "" },
				h(
					"ol",
					{ ref: listRef },
					entries.slice(win.range.start, win.range.end).map((e, i) =>
						h("li", {
							key: e.key,
							"data-window-item": e.key,
							ref: (node) => {
								if (node)
									node.getBoundingClientRect = () =>
										rect(rowTop(win.range.start + i), real.get(e.key));
							},
						}),
					),
					h("li", {
						"data-window-spacer": "after",
						ref: (node) => {
							if (node)
								node.getBoundingClientRect = () =>
									rect(scene.spacers.before + mounted() - scene.top, 0);
						},
					}),
				),
			),
		);
	}
	const frame = () =>
		act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 40));
		});
	const userScroll = (to) =>
		act(async () => {
			viewportNode.scrollTop = to;
			viewportNode.dispatchEvent(new window.Event("scroll"));
		});
	try {
		await act(async () => root.render(h(Probe)));
		await frame();
		await act(async () => stick.pin());
		await userScroll(scene.top);
		await frame(); // the strip's rAF records its anchor at the end
		const max = () => content() - VIEW;
		assert.equal(scene.top, max(), "at the newest message");
		const reading = scene.top - 200;
		await userScroll(reading);
		const visible = () =>
			[...host.querySelectorAll("[data-window-item]")].find(
				(node) => node.getBoundingClientRect().bottom > 0,
			);
		const row = visible();
		const before = row.getBoundingClientRect().top;
		// Same frame, before the strip's rAF: a mounted row ABOVE the reader
		// re-measures taller (the slice re-cut, a code block reflowed).
		const above = [...host.querySelectorAll("[data-window-item]")][0];
		real.set(above.dataset.windowItem, 90);
		await ro.fire();
		assert.ok(
			scene.top < max() - 100,
			`not snapped to the end (top ${scene.top}, max ${max()})`,
		);
		assert.ok(
			Math.abs(row.getBoundingClientRect().top - before) <= 1,
			`the row being read holds its place (${before} -> ${row.getBoundingClientRect().top})`,
		);
	} finally {
		await act(async () => root.unmount());
		host.remove();
		ro.restore();
	}
});
