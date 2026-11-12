import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * THE READER'S PLACE SURVIVES A REMOUNT.
 *
 * THE DEFECT (operator report, 2026-11-12: "when i switch between team bridge and
 * session, it has some sort of loading mechanism to load conversation? looks like
 * it always does this"; QA measured the other half - 0 of 12 scrolled returns
 * kept their place). `/chat` and `/team-bridge` are sibling routes, so the panel
 * unmounts on the way out and this scroller's only resting place is the tail.
 *
 * WHAT IS REAL: the shipped `CanonicalTranscript` in jsdom, mounted and
 * unmounted through React, reading and writing the SHIPPED paint cache.
 * WHAT IS AUTHORED: geometry. jsdom has no layout engine, so the scroller's
 * rect, its `scrollTop` and the rows' rects are stubs - the assertion is the
 * ARITHMETIC the restore performs on them (`scrollRegionToTop`'s own contract,
 * pinned separately in `scroll-region-to-top.test.mjs`), not a pixel claim.
 *
 * The geometry each case authors:
 *
 *   region   top 0, clientHeight 600, scrollTop as each case states
 *   row      `top` from the case's table, 60px tall
 *
 * so "row r at top t, wanted at 100" is `scrollTop += t - 0 - 100`.
 */

const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = dom;
const originals = new Map();
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	localStorage: window.localStorage,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;

/*
 * THE AUTHORED GEOMETRY. Rows are keyed by `data-record-id`; the scroller is the
 * element the transcript's own `containerRef` lands on.
 */
const ROWS = new Map();
const writes = [];
let initialScroll = 0;
const isScroller = (el) => el?.hasAttribute?.("data-lo-canonical-transcript");
const rect = (top, height) => ({
	top,
	bottom: top + height,
	height,
	left: 0,
	right: 800,
	width: 800,
	x: 0,
	y: top,
	toJSON: () => ({}),
});
for (const proto of [window.Element.prototype, window.HTMLElement.prototype]) {
	Object.defineProperty(proto, "getBoundingClientRect", {
		configurable: true,
		writable: true,
		value() {
			if (isScroller(this)) return rect(0, 600);
			const authored = this.dataset?.recordId
				? ROWS.get(this.dataset.recordId)
				: undefined;
			return authored ? rect(authored.top, authored.height) : rect(0, 0);
		},
	});
	Object.defineProperty(proto, "clientHeight", {
		configurable: true,
		get() {
			return isScroller(this) ? 600 : 0;
		},
	});
	Object.defineProperty(proto, "scrollTop", {
		configurable: true,
		get() {
			if (!isScroller(this)) return 0;
			return this.__authoredScroll ?? initialScroll;
		},
		set(value) {
			if (!isScroller(this)) return;
			this.__authoredScroll = value;
			writes.push(value);
		},
	});
}

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	dom.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const ROOT = resolve(import.meta.dirname, "..");
const bundle = await build({
	stdin: {
		contents:
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";\nexport { writePaint, readPaint, __resetPaintCache } from "./src/renderer/src/shared/store/paint-cache";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const cache = join(ROOT, "node_modules", ".cache", "transcript-scroll-restore");
mkdirSync(cache, { recursive: true });
const bundlePath = join(cache, `bundle-${process.pid}.mjs`);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { CanonicalTranscript, writePaint, readPaint, __resetPaintCache } =
	await import(pathToFileURL(bundlePath).href);

const TS = 1_760_000_000_000;
const userRecord = (id) => ({
	kind: "user",
	id,
	ts: TS,
	text: "Which invoices were late last month?",
	images: [],
});
const answerRecord = (id) => ({
	kind: "assistant",
	id,
	ts: TS,
	text: "Four invoices were late: 1042, 1088, 1103 and 1177.",
	streaming: false,
	stopReason: null,
	error: false,
});
const RECORDS = [userRecord("user:1"), answerRecord("answer:1")];
const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	oldestTs: 0,
	hasMore: false,
	argsByCall: new Map(),
});

const mount = (over = {}) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			h(
				QueryClientProvider,
				{ client: queryClient },
				h(CanonicalTranscript, {
					transcript: transcriptOf(RECORDS),
					gate: null,
					waiting: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: null },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
					conversationId: over.conversationId ?? "s1",
					restoredScroll: over.restoredScroll ?? null,
				}),
			),
		);
	});
	return {
		container,
		scroller: container.querySelector("[data-lo-canonical-transcript]"),
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
};

const setup = ({ scroll = 0, rows = [] } = {}) => {
	__resetPaintCache();
	ROWS.clear();
	writes.length = 0;
	initialScroll = scroll;
	for (const [id, top] of rows) ROWS.set(id, { top, height: 60 });
};

test("a scrolled-up return lands on the row it left, at its old offset", () => {
	setup({
		scroll: -500,
		rows: [
			["user:1", 260],
			["answer:1", 320],
		],
	});
	const mounted = mount({
		restoredScroll: { pinned: false, id: "user:1", offsetPx: 100 },
	});
	assert.deepEqual(
		writes,
		[-340],
		"scrollTop = -500 + (row at 260) - (region at 0) - (wanted 100) = -340, one acknowledged write in the layout phase",
	);
	assert.equal(mounted.scroller?.scrollTop, -340);
	mounted.unmount();
});

test("a pinned return writes nothing and stays at the tail", () => {
	setup({
		scroll: 0,
		rows: [
			["user:1", 260],
			["answer:1", 320],
		],
	});
	const mounted = mount({ restoredScroll: { pinned: true } });
	assert.deepEqual(writes, [], "the tail is the scroller's own default");
	assert.equal(mounted.scroller?.scrollTop, 0);
	mounted.unmount();
});

test("a row the transcript no longer holds falls back to the tail", () => {
	// The reconcile may have replaced the cached rows by the time a slow mount
	// restores; a missing anchor is not a guess at the nearest neighbour.
	setup({
		scroll: 0,
		rows: [
			["user:1", 260],
			["answer:1", 320],
		],
	});
	const mounted = mount({
		restoredScroll: { pinned: false, id: "gone:1", offsetPx: 100 },
	});
	assert.deepEqual(writes, []);
	assert.equal(mounted.scroller?.scrollTop, 0);
	mounted.unmount();
});

test("leaving a scrolled transcript records the row the reader was on", () => {
	// The write side of R5, through the shipped unmount path: the transcript's
	// layout cleanup records onto the paint the session hook is about to replace.
	setup({
		scroll: -500,
		rows: [
			["user:1", -40],
			["answer:1", 20],
		],
	});
	writePaint("s1", {
		transcript: transcriptOf(RECORDS),
		busy: false,
	});
	const mounted = mount({ conversationId: "s1" });
	assert.ok(mounted.scroller, "the scroller is mounted");
	mounted.unmount();
	assert.deepEqual(
		readPaint("s1")?.scroll,
		{ pinned: false, id: "user:1", offsetPx: -40 },
		"the first row whose bottom is still below the scrollport's top is the reader's row, with its own offset",
	);
});

test("leaving a tail-pinned transcript records the tail", () => {
	setup({
		scroll: 0,
		rows: [
			["user:1", -40],
			["answer:1", 20],
		],
	});
	writePaint("s1", {
		transcript: transcriptOf(RECORDS),
		busy: false,
	});
	const mounted = mount({ conversationId: "s1" });
	mounted.unmount();
	assert.deepEqual(readPaint("s1")?.scroll, { pinned: true });
});
