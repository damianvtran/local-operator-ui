import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * THE FOOT SLOT: the working line's row is reserved in every state, so a turn's
 * start and end move nothing.
 *
 * THE DEFECT THIS PINS (operator report, 2026-09-27): "sometimes the whole
 * conversation including the leading edge shifts up even though we're now in
 * the scroll phase". Measured on `scripts/scroll-shift-evidence.mjs` (a tall
 * fixture at 1380x872; frames and traces in `docs/evidence/scroll-shift/`):
 * while the transcript is
 * anchored at the tail, the working line MOUNTING moved every settled row AND
 * the last row's bottom edge - the leading edge - up 29.4px in one frame at a
 * turn's start, and unmounting moved them back down at the turn's end. The
 * scroller is pinned at `scrollTop = 0`, so anything that appears below the
 * last row displaces the whole conversation.
 *
 * WHY THE ASSERTIONS ARE STRUCTURAL. jsdom has no layout engine, so nothing
 * here measures a pixel - the harness' frames and the per-frame trace carry
 * "the reserve is 29.4 and the rows do not move". What a DOM tree CAN pin is
 * the property the geometry follows from: the element that carries the line
 * exists WHILE NO TURN RUNS, with the same box (one reserved line of the
 * line's own type) as when one does. On the tree before the fix the idle pane
 * had no such element at all - the line's row appeared with the turn - which is
 * the shape every assertion below refuses.
 *
 * The boot below is `turn-timestamp.test.mjs`'s, deliberately: it mounts the
 * PRODUCTION `CanonicalTranscript` through jsdom with the same shims and for
 * the same reasons (React DOM feature-detects `document` at import time, the
 * transcript's imports reach the preference stores, and the theme/preference
 * readers want `matchMedia` on both the global and the jsdom window). The two
 * files differ in subject, not in harness.
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
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

/*
 * The transcript reads its cross-session visibility through react-query
 * (`useCrossSessionHidden`), so the mount needs a client in scope - unseeded is
 * the fail-closed path, which is the pane this suite's states photograph
 * (nothing hidden). `@tanstack/react-query` is external to the bundle so the
 * hook inside it and the provider below share ONE copy.
 */
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const bundle = await build({
	stdin: {
		contents:
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	/* Vite's env, read in an effect by the transcript's dev-only readout. */
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
const bundlePath = new URL(`./_foot-slot-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CanonicalTranscript } = await import(bundlePath.href);
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

/** The call in flight, which is the state a working line is derived from. */
const runningToolRecord = (id) => ({
	kind: "tool",
	id,
	ts: TS,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "pnpm test:desktop" },
	phase: "running",
	argumentBytes: 0,
	output: null,
	isError: false,
	durationS: null,
	startedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
});

const SETTLED = [userRecord("user:1"), answerRecord("answer:1")];
const WORKING = [userRecord("user:1"), runningToolRecord("tool:1")];
/*
 * Hoisted for the same reason `canonical-chat.test.mjs` hoists its own: the
 * scanner's `useTopLevelRegex` charges a literal constructed inside a function,
 * and this one runs per assertion.
 */
const WHITESPACE = /\s+/;

const mount = (records, over = {}) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			h(
				QueryClientProvider,
				{ client: queryClient },
				h(CanonicalTranscript, {
					transcript: transcriptOf(records),
					gate: null,
					waiting: over.waiting ?? false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: container },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
				}),
			),
		);
	});
	return {
		container,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
};

const footSlot = (container) =>
	container.querySelector("[data-lo-transcript-foot]");

test("the idle pane reserves the working line's row", () => {
	const { container, unmount } = mount(SETTLED);
	const slot = footSlot(container);
	assert.ok(
		slot,
		"a conversation with rows carries the foot slot while NO turn runs: the row the working line mounts into must exist before the line does, or the line's arrival moves the conversation (the report this file pins)",
	);
	assert.equal(
		container.querySelector("[data-lo-working-line]"),
		null,
		"and it is empty: no line is painted outside a turn",
	);
	assert.equal(slot.textContent, "", "the reserve paints no text of its own");
	/*
	 * The reserve's BOX, in the only terms a layout-less environment has: one
	 * line of the line's own type, `min-h-[1lh]` against `text-mono-sm`, in the
	 * `item` gap tier - 12px + one 12px/1.45 line = the 29.4px the harness
	 * measured the line's arrival displacing the conversation by. Asserting the
	 * class list is asserting the arithmetic; the frames carry the pixels.
	 */
	const tokens = new Set(slot.className.split(WHITESPACE));
	for (const token of ["mt-3", "min-h-[1lh]", "font-mono", "text-mono-sm"])
		assert.ok(
			tokens.has(token),
			`the reserve is one mono-sm line on the item tier: expected \`${token}\` on the slot, got \`${slot.className}\``,
		);
	unmount();
});

test("the line mounts INTO the reserved row, and stays the last thing painted", () => {
	const idle = mount(SETTLED);
	const idleSlot = footSlot(idle.container);
	const working = mount(WORKING, { waiting: true });
	const workingSlot = footSlot(working.container);
	const line = working.container.querySelector("[data-lo-working-line]");
	assert.ok(line, "a running turn paints the working line");
	assert.ok(
		workingSlot,
		"and the row it mounts into is there while the turn runs too - the SAME slot, not one that appeared with the line",
	);
	assert.equal(
		line.closest("[data-lo-transcript-foot]"),
		workingSlot,
		"the line mounts INSIDE the reserved slot: one row that changes contents, not a row that appears beside it",
	);
	assert.equal(
		idleSlot?.className,
		workingSlot.className,
		"and the slot's box is the same whether or not a turn is running - that equality IS the no-shift property (a different box would move the conversation by the difference)",
	);
	assert.equal(
		workingSlot.nextElementSibling,
		null,
		"the slot stays the last element of the conversation: nothing is painted below the line",
	);
	idle.unmount();
	working.unmount();
});

test("no conversation rows, no foot slot", () => {
	const { container, unmount } = mount([]);
	assert.equal(
		footSlot(container),
		null,
		"the reserve belongs to a conversation, not to the pane: an empty transcript reserves nothing",
	);
	unmount();
});
