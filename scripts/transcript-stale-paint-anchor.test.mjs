import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";

/*
 * THE TRANSCRIPT COLUMN DOES NOT TOP-ANCHOR A CACHED FRAGMENT.
 *
 * THE DEFECT (P2 of the session-switch plan; probe `short-cache-probe.md`,
 * reproduced on a built renderer). A cached return paints the newest suffix the
 * paint cache could keep - at most 200 rows and 1 MiB - and a heavy session's
 * suffix is often shorter than the pane. The column carried `mb-auto` in every
 * state, so the suffix was top-aligned and then bottom-packed when the taller
 * page landed: first visible row +200.6 px, last row +212.6 px, ONE frame,
 * 26/26 and 16/16 runs at 500/700 KB tool results (0 px at 120-350 KB, normal
 * 70-turn, 86 MB-class and 1-2-turn short sessions - the last group must KEEP
 * its top alignment, which is what makes this a conditional rather than a
 * removal).
 *
 * WHAT IS REAL: the shipped `CanonicalTranscript`, mounted through React in
 * jsdom with the shims `transcript-foot-slot.test.mjs` uses and for the same
 * reasons, reading the production props the chat pane passes it.
 * WHAT IS AUTHORED: nothing but the props. jsdom has no layout engine, so the
 * assertion is the CLASS LIST that decides the layout - the anchor token is
 * present or absent - and the pixels are the probe's, cited above.
 *
 * The last test is the one that would have caught the regression this file
 * exists for: it walks the stale mount to the snapshot's commit and asserts
 * that the only token that changes is the anchor itself.
 */

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
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
/* `useMediaQuery` inside the working line reads the jsdom window's, not the global. */
window.matchMedia ??= shims.matchMedia;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const bundle = await build({
	stdin: {
		contents:
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";\n' +
			'export { readPaint, writePaint, __resetPaintCache } from "./src/renderer/src/shared/store/paint-cache";',
		resolveDir: process.cwd(),
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
const bundlePath = new URL(
	`./_stale-anchor-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CanonicalTranscript, readPaint, writePaint, __resetPaintCache } =
	await import(bundlePath.href);
await unlink(bundlePath);

const TS = 1_760_000_000_000;

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

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

/* Two rows: shorter than any pane, which is the shape the anchor is about. */
const SHORT = [userRecord("user:1"), answerRecord("answer:1")];

const element = (records, over = {}) =>
	h(
		QueryClientProvider,
		{ client: queryClient },
		h(CanonicalTranscript, {
			transcript: transcriptOf(records),
			gate: null,
			waiting: false,
			loadingOlder: false,
			onLoadOlder: async () => true,
			containerRef: { current: null },
			isSmallView: false,
			status: over.status ?? "live",
			failure: null,
			awaitingHydration: false,
			onReconnect: () => {},
			stale: over.stale ?? false,
			// The indicator's hold, so a stale mount reaches its rendered state
			// without a clock (the same lever `transcript-foot-slot.test.mjs` uses).
			staleIndicatorDelayMs: 0,
			paintRunning: false,
			...(over.paintComplete === undefined
				? {}
				: { paintComplete: over.paintComplete }),
		}),
	);

const mount = (records, over = {}) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => root.render(element(records, over)));
	return {
		container,
		// The snapshot's commit: same pane, the rows now the owner's and the paint's
		// own claim withdrawn.
		confirm: (next = {}) => {
			act(() => root.render(element(records, { ...over, ...next })));
		},
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
};

const column = (container) =>
	container.querySelector("[data-lo-transcript-content]");

/*
 * Hoisted for the same reason `transcript-foot-slot.test.mjs` hoists its own: the
 * scanner's `useTopLevelRegex` charges a literal constructed inside a function,
 * and this one runs per assertion.
 */
const WHITESPACE = /\s+/;

const tokensOf = (container) => {
	const node = column(container);
	assert.ok(node, "the transcript paints its content column");
	return new Set(node.className.split(WHITESPACE));
};

test("a stale pane holding an incomplete paint does not top-anchor", () => {
	const { container, unmount } = mount(SHORT, {
		stale: true,
		paintComplete: false,
	});
	const tokens = tokensOf(container);
	assert.equal(
		tokens.has("mb-auto"),
		false,
		`a cached fragment must sit bottom-packed, where the taller page will leave it: got \`${column(container)?.className}\``,
	);
	// And it is still the same column: bottom-packing is the ABSENCE of the top
	// anchor, not a second one.
	for (const token of ["relative", "flex", "flex-col"])
		assert.ok(
			tokens.has(token),
			`the column's own layout is unchanged: expected \`${token}\`, got \`${column(container)?.className}\``,
		);
	unmount();
});

test("a stale pane holding the whole conversation keeps the top anchor", () => {
	const { container, unmount } = mount(SHORT, {
		stale: true,
		paintComplete: true,
	});
	assert.ok(
		tokensOf(container).has("mb-auto"),
		"a genuinely short conversation is top-aligned today and a complete paint has no taller page to land",
	);
	unmount();
});

test("a live pane keeps the top anchor", () => {
	const { container, unmount } = mount(SHORT);
	assert.ok(
		tokensOf(container).has("mb-auto"),
		"the ordinary short conversation is unchanged: nothing is stale, so nothing is a fragment",
	);
	unmount();
});

test("a stale caller with no cached paint behind it keeps the top anchor", () => {
	const { container, unmount } = mount(SHORT, { stale: true });
	assert.ok(
		tokensOf(container).has("mb-auto"),
		"a pane with no cache entry has no fragment to bottom-pack",
	);
	unmount();
});

test("the snapshot's commit adds the anchor and changes nothing else", () => {
	const { container, unmount, confirm } = mount(SHORT, {
		stale: true,
		paintComplete: false,
	});
	const before = tokensOf(container);
	assert.equal(before.has("mb-auto"), false, "fragment: bottom-packed");
	confirm({ stale: false, paintComplete: null });
	const after = tokensOf(container);
	assert.ok(
		after.has("mb-auto"),
		"the page has landed: the column's own 'only while it fits' rule decides again",
	);
	const added = [...after].filter((token) => !before.has(token));
	const removed = [...before].filter((token) => !after.has(token));
	assert.deepEqual(
		{ added, removed },
		{ added: ["mb-auto"], removed: [] },
		"the ONE token that moves between the stale frame and the reconciled one is the anchor - any other difference would be a second layout change riding along",
	);
	unmount();
});

/*
 * THE MEASURED SHAPE, END TO END THROUGH THE SHIPPED STORE: the probe's heavy
 * tool results, written by the real `writePaint`, decide the real column's
 * anchor - no hand-set booleans in between.
 */
const heavyToolRecord = (id, bytes) => ({
	kind: "tool",
	id,
	ts: TS,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "pnpm test:desktop" },
	phase: "done",
	argumentBytes: 0,
	output: "x".repeat(bytes),
	isError: false,
	durationS: 12.5,
	startedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
});

test("a heavy transcript the cache cannot keep whole lands bottom-packed", () => {
	__resetPaintCache();
	// Five ~250 KB results against the 1 MiB per-conversation ceiling: the same
	// trim the probe's 500/700 KB fixtures hit, on a conversation whose page said
	// there was nothing older.
	const rows = Array.from({ length: 5 }, (_, index) =>
		heavyToolRecord(`tool:${index}`, 250 * 1024),
	);
	writePaint("heavy", {
		transcript: {
			...transcriptOf(rows),
			oldestId: "tool:0",
		},
	});
	const paint = readPaint("heavy");
	assert.ok(paint, "the paint exists");
	assert.ok(
		paint.transcript.records.length < rows.length,
		"the byte ceiling dropped rows, which is what makes this paint a suffix",
	);
	assert.equal(
		paint.complete,
		false,
		"the store's own derivation says the rows are not the whole conversation",
	);
	// The store's verdict, straight into the shipped column's prop.
	const { container, unmount } = mount(paint.transcript.records, {
		stale: true,
		paintComplete: paint.complete,
	});
	assert.equal(
		tokensOf(container).has("mb-auto"),
		false,
		`the column that paints this suffix must be bottom-packed: got \`${column(container)?.className}\``,
	);
	unmount();
});
