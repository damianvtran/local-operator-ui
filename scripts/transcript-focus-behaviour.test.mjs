/**
 * The transcript's blank-space click, driven through the SHIPPED component
 * (issue #661).
 *
 *     node --test scripts/transcript-focus-behaviour.test.mjs
 *
 * WHAT ONLY A MOUNT CAN SAY. `transcript-focus.test.mjs` pins the rule's table;
 * this file drives the REAL `CanonicalTranscript` in jsdom and asserts the two
 * facts the table cannot: that the container's listeners are actually wired to
 * that rule (the regression a refactor moves silently), and that a focus the
 * rule allows goes through the composer's own registered hand-off
 * (`composer-field.ts`) rather than around it.
 *
 * THE CELLS ARE THE ISSUE'S OWN LIST. A blank click focuses (the bug - this
 * cell failed on the base tree); a control keeps its own press; a selection
 * suppresses in BOTH of its readings (present when the press began, and present
 * at the click - the browser collapses the first on mousedown, which is why the
 * container records it); a drag suppresses while a wobble inside the slop does
 * not; a wheel notch suppresses within its window and the same click focuses
 * once the window has passed; an open dialog suppresses; and the lazy-load
 * door - the older-history control - keeps its own press too. jsdom has no
 * layout engine, so nothing here is geometry evidence; the frames carry the
 * pixels and this file carries the guards.
 *
 * WHY THE CLOCK IS SHIM, NOT SLEEP. The wheel window is a wall-clock rule, and
 * a test that sleeps 200 ms to prove it both waits on a clock AND fails to
 * prove the boundary. The harness owns `performance.now` instead, so the cells
 * are exact: a notch at t suppresses a click at t, and the same click focuses
 * at t+200.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;

/** The one clock this file moves; every `performance.now()` reads it. */
const clock = { now: 1_000_000 };

/** The older-history control's copy, however its state spells it. */
const LOAD_OLDER_COPY = /earlier|older|try again/i;

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
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => {
		setTimeout(callback, 0);
		return 0;
	},
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
 * Only the CLOCK is owned by this file; the real Performance object stays in
 * place, because the transcript calls `performance.mark` per commit and a
 * replacement object would have to reimplement that API to keep the component
 * mounting at all.
 */
const originalNow = performance.now;
performance.now = () => clock.now;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	performance.now = originalNow;
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const bundle = await build({
	stdin: {
		contents: [
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { registerComposerFocus } from "./src/renderer/src/features/chat/composer-field";',
		].join("\n"),
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
		/* External so the provider and the bundled hooks share ONE copy; a
		 * bundled second copy carries a different context and `useQuery` would
		 * not find the client this file seeds. */
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_transcript-focus-behaviour-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CanonicalTranscript, registerComposerFocus } = await import(
	bundlePath.href
);
await unlink(bundlePath);

/*
 * THE COMPOSER'S OWN HAND-OFF, as the app wires it: the registry carries the
 * function `MessageInput` publishes, and this file registers a stand-in for it
 * so a hand-off is OBSERVABLE (it moves `document.activeElement`). The element
 * is a real textarea in the jsdom tree: `focus()` on it is the observable.
 */
const composer = document.createElement("textarea");
document.body.appendChild(composer);
registerComposerFocus(
	() => composer.focus(),
	() => composer,
);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

const userRecord = (id, over = {}) => ({
	kind: "user",
	id,
	ts: TS,
	text: "Which invoices were late last month?",
	images: [],
	...over,
});
const toolRecord = (id, over = {}) => ({
	kind: "tool",
	id,
	ts: TS + 1_000,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "pnpm test:desktop" },
	phase: "done",
	argumentBytes: 20,
	output: "tests 40\npass 40\n",
	isError: false,
	durationS: 0.4,
	startedAt: null,
	endedAt: TS + 2_000,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	neverSent: false,
	notRunReason: null,
	...over,
});
const answerRecord = (id, over = {}) => ({
	kind: "assistant",
	id,
	ts: TS + 3_000,
	text: "Four invoices were late: 1042, 1088, 1103 and 1177.",
	streaming: false,
	stopReason: null,
	error: false,
	settledAt: TS + 3_000,
	...over,
});

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

/* ------------------------------ the mount ------------------------------- */

const mount = async (t, records, over = {}) => {
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			mounted.root?.unmount();
		});
		mounted.container?.remove();
	});
	mounted.container = document.createElement("div");
	document.body.appendChild(mounted.container);
	const client =
		over.client ??
		new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () => {
		mounted.root = createRoot(mounted.container);
		mounted.root.render(
			h(
				QueryClientProvider,
				{ client },
				h(CanonicalTranscript, {
					frontend: null,
					transcript: {
						...transcriptOf(records),
						hasMore: over.hasMore ?? false,
					},
					gate: null,
					waiting: false,
					loadingOlder: false,
					onLoadOlder: over.onLoadOlder ?? (async () => true),
					containerRef: { current: null },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
				}),
			),
		);
	});
	mounted.scroller = mounted.container.querySelector(
		"[data-lo-canonical-transcript]",
	);
	assert.ok(mounted.scroller, "the transcript's scroll container rendered");
	return mounted;
};

const blankRecords = () => [
	userRecord("user:1"),
	toolRecord("tool:1"),
	answerRecord("answer:1"),
];

/** Park focus off the composer so each cell's assertion is about its own click. */
const parkFocus = () => {
	const neutral = document.createElement("button");
	document.body.appendChild(neutral);
	neutral.focus();
	neutral.remove();
	assert.notEqual(document.activeElement, composer);
};

/**
 * One press and its click, with the container's `pointerdown` recording in
 * between - the sequence a real mouse produces. `downAt` and `clickAt` are
 * separate coordinates because a drag is exactly a click whose pointer moved,
 * and `between` is where the wheel cell walks its clock and the selection cells
 * change the selection the way the browser would.
 */
const clickThrough = async (
	element,
	{ downAt = { x: 0, y: 0 }, clickAt = downAt, between, shift = false } = {},
) => {
	const send = (type, { x, y }) =>
		element.dispatchEvent(
			new window.MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				button: 0,
				clientX: x,
				clientY: y,
				shiftKey: shift,
			}),
		);
	await act(async () => {
		send("pointerdown", downAt);
		send("pointerup", downAt);
		between?.();
		send("click", clickAt);
	});
};

const selectRowText = (mounted) => {
	const row = mounted.scroller.querySelector(
		"[data-record-id][data-record-kind]",
	);
	assert.ok(row, "a row rendered to select text from");
	const range = document.createRange();
	range.selectNodeContents(row);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	assert.equal(selection.isCollapsed, false);
	return selection;
};

/* -------------------------------- the cells ------------------------------ */

test("a click on blank transcript space focuses the composer", async (t) => {
	const mounted = await mount(t, blankRecords());
	parkFocus();
	await clickThrough(mounted.scroller);
	assert.equal(
		document.activeElement,
		composer,
		"the click handed the caret to the composer",
	);
});

test("a control keeps its own press", async (t) => {
	const mounted = await mount(t, blankRecords());
	const control = mounted.scroller.querySelector("button");
	assert.ok(control, "a control rendered inside the transcript");
	parkFocus();
	await clickThrough(control);
	assert.notEqual(
		document.activeElement,
		composer,
		"clicking a control did not pull the caret into the composer",
	);
});

test("the older-history control keeps its own press too", async (t) => {
	/* The lazy-load door: its own click loads a page, and it must not double as
	 * a caret hand-off (the button is a control even though it is not a row). */
	const mounted = await mount(t, blankRecords(), { hasMore: true });
	const loadOlder = [...mounted.scroller.querySelectorAll("button")].find(
		(button) => LOAD_OLDER_COPY.test(button.textContent ?? ""),
	);
	assert.ok(loadOlder, "the older-history control rendered");
	parkFocus();
	await clickThrough(loadOlder);
	assert.notEqual(document.activeElement, composer);
});

test("a selection at press time suppresses, even after the browser collapses it", async (t) => {
	const mounted = await mount(t, blankRecords());
	/*
	 * `parkFocus` FIRST: focusing an element collapses the document selection
	 * in jsdom (measured), and this cell is about the selection existing when
	 * the PRESS begins - the state the browser itself collapses at mousedown,
	 * which the `between` below reproduces.
	 */
	parkFocus();
	const selection = selectRowText(mounted);
	await clickThrough(mounted.scroller, {
		between: () => {
			/* What mousedown does to a selection before the click arrives. */
			selection.removeAllRanges();
		},
	});
	assert.notEqual(
		document.activeElement,
		composer,
		"the press-time selection was honoured after the click-time collapse",
	);
});

test("a selection present at click time suppresses", async (t) => {
	const mounted = await mount(t, blankRecords());
	parkFocus();
	await clickThrough(mounted.scroller, {
		between: () => {
			selectRowText(mounted);
		},
	});
	assert.notEqual(document.activeElement, composer);
});

test("a drag suppresses; a wobble inside the slop does not", async (t) => {
	const dragged = await mount(t, blankRecords());
	parkFocus();
	await clickThrough(dragged.scroller, {
		downAt: { x: 0, y: 0 },
		clickAt: { x: 60, y: 40 },
	});
	assert.notEqual(
		document.activeElement,
		composer,
		"a 60px drag is a scroll or a selection, not a click",
	);

	const wobbled = await mount(t, blankRecords());
	parkFocus();
	await clickThrough(wobbled.scroller, {
		downAt: { x: 10, y: 10 },
		clickAt: { x: 12, y: 11 },
	});
	assert.equal(
		document.activeElement,
		composer,
		"a 2px wobble is still a click and still focuses",
	);
});

test("a shift-click keeps the browser's selection extension", async (t) => {
	const mounted = await mount(t, blankRecords());
	parkFocus();
	/* Shift is the selection-EXTENDING modifier (design round 2, U1): the click
	 * must reach the browser unbroken rather than moving the caret. */
	await clickThrough(mounted.scroller, { shift: true });
	assert.notEqual(
		document.activeElement,
		composer,
		"a shift-click is an extension gesture, not a caret request",
	);
	/* The same spot without Shift still hands the caret over, so the cell is
	 * about the modifier rather than about where the pointer landed. */
	await clickThrough(mounted.scroller);
	assert.equal(
		document.activeElement,
		composer,
		"the same click without Shift still focuses the composer",
	);
});

test("a wheel notch suppresses inside its window and releases outside it", async (t) => {
	const mounted = await mount(t, blankRecords());
	parkFocus();
	await act(async () => {
		mounted.scroller.dispatchEvent(
			new window.WheelEvent("wheel", { bubbles: true }),
		);
	});
	await clickThrough(mounted.scroller);
	assert.notEqual(
		document.activeElement,
		composer,
		"a click within the wheel window is the scroll's own gesture",
	);

	/* The same click once the window has passed: the hand-off comes back. */
	clock.now += 200;
	await clickThrough(mounted.scroller);
	assert.equal(
		document.activeElement,
		composer,
		"a deliberate click after the scroll keeps the caret hand-off",
	);
});

test("an open dialog or sheet suppresses", async (t) => {
	const mounted = await mount(t, blankRecords());
	const modal = document.createElement("div");
	modal.setAttribute("role", "dialog");
	modal.setAttribute("data-state", "open");
	document.body.appendChild(modal);
	t.after(() => {
		modal.remove();
	});
	parkFocus();
	await clickThrough(mounted.scroller);
	assert.notEqual(
		document.activeElement,
		composer,
		"a click while a modal is open does not move the caret",
	);
});
