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
	`${process.cwd()}/scripts/window-update-depth-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/window-update-depth-runtime.cjs`;
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

/**
 * Mount the windowed strip over geometry the test owns. `heightOf(key)` is read
 * on every measurement, so a test can hand the measure pass a layout that never
 * settles - the shape of a real reflow feedback (a scrollbar that appears when
 * the strip grows and narrows every row, which makes it grow again).
 */
/* React's dev text and the production code for the same abort. */
const UPDATE_DEPTH = /Maximum update depth|#185/;

async function mountWindow({ count = 60, heightOf, onSpacerRead = () => {} }) {
	const ro = observers();
	const entries = Array.from({ length: count }, (_, i) => ({
		key: `msg:m${i}`,
		item: { type: "message", continuation: true, message: { id: `m${i}` } },
	}));
	const scene = {
		top: 0,
		range: { start: 0, end: 0 },
		spacers: { before: 0, after: 0 },
	};
	const mounted = () =>
		entries
			.slice(scene.range.start, scene.range.end)
			.reduce((sum, e) => sum + heightOf(e.key), 0);
	const content = () => scene.spacers.before + mounted() + scene.spacers.after;
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const listRef = { current: null };
	const rect = (y, size) => ({
		top: y,
		bottom: y + size,
		height: size,
		left: 0,
		right: 600,
		width: 600,
	});
	let viewportNode;
	let stick;
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
			.reduce((sum, e) => sum + heightOf(e.key), 0) -
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
										rect(rowTop(win.range.start + i), heightOf(e.key));
							},
						}),
					),
					h("li", {
						"data-window-spacer": "after",
						ref: (node) => {
							if (node)
								node.getBoundingClientRect = () => {
									onSpacerRead();
									return rect(scene.spacers.before + mounted() - scene.top, 0);
								};
						},
					}),
				),
			),
		);
	}
	return {
		scene,
		root,
		host,
		ro,
		render: () => act(async () => root.render(h(Probe))),
		frame: () =>
			act(async () => {
				await new Promise((r) => setTimeout(r, 40));
			}),
		cleanup: async () => {
			await act(async () => root.unmount());
			host.remove();
			ro.restore();
		},
	};
}

test("a strip whose rows never measure the same twice does not loop the renderer (React #185)", async () => {
	/* Every measure pass sees the other width: the scrollbar toggles, so each
	   row alternates between 50px and 58px. Before the burst budget this was a
	   synchronous layout-effect loop - measure -> setState -> correct scrollTop ->
	   new range -> measure - until React threw "Maximum update depth exceeded". */
	let wide = true;
	const errors = [];
	const original = console.error;
	console.error = (...args) => errors.push(args.map(String).join(" "));
	const t = await mountWindow({
		heightOf: () => (wide ? 50 : 58),
		onSpacerRead: () => {
			wide = !wide;
		},
	});
	let thrown = null;
	let mountedRows = 0;
	try {
		try {
			await t.render();
			for (let i = 0; i < 5; i += 1) await t.frame();
			// Still a working strip, not an empty one: the deferral keeps rows mounted.
			mountedRows = t.host.querySelectorAll("[data-window-item]").length;
		} catch (error) {
			thrown = error;
		}
	} finally {
		console.error = original;
		await t.cleanup();
	}
	const depth = (text) => UPDATE_DEPTH.test(text);
	assert.equal(
		thrown && depth(String(thrown?.message)) ? thrown.message : null,
		null,
		"no update-depth throw",
	);
	assert.deepEqual(errors.filter(depth), [], "no update-depth warning either");
	assert.ok(mountedRows > 0, `the strip still renders rows (${mountedRows})`);
});
