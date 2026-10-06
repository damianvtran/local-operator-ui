/**
 * The measure handle's accessible wiring, in jsdom.
 *
 * WHY THIS FILE EXISTS. `readShippedChatMeasurePx` answers `null` wherever the
 * stylesheet was never loaded, and no jsdom suite loads `styles/index.css`, so
 * the handles never rendered under `node --test`: the separator's roles and
 * value bounds were pinned only by the CDP rig
 * (`scripts/chat-measure-drag-evidence.mjs`), which is real but slow and sits
 * behind Storybook (review, finding 6). The read's own comment calls the
 * stylesheet-less host "the shape of a unit test" and says this is what it
 * exists for - so the test sets the property the guard reads. The shipped
 * measure is declared on `:root` as a custom property, and jsdom resolves an
 * INLINE custom property through `getComputedStyle` (measured - see the
 * assertion below), so writing it onto `document.documentElement` is the
 * supported way to make the read answer inside a test host.
 *
 * WHAT THIS FILE PINS. The shipped component (`ChatMeasureHandle`) is rendered
 * and asserted against its contract: `role="separator"` with
 * `aria-orientation="vertical"` and `aria-valuenow/min/max` (the width handed
 * in, and the bounds exported by `chat-measure-drag.ts`), the announced key map
 * (`aria-keyshortcuts`), the state line's own structure (it is a SIBLING of the
 * widget and `aria-hidden`, which is the shape the repo's `useSemanticElements`
 * rule requires), the keyboard arithmetic (arrow steps, the coarse shift step,
 * Home/End, Enter-to-reset), and the render-gated commit path - round 2's U4 for
 * releases, round 3's U6/U8 for keyboard steps (the step starts from the
 * RENDERED width when the column is clamped, and a step that cannot move a pixel
 * writes nothing): a synthetic press/move/release driven through the same event
 * path a pointer produces, and a synthetic keydown through the handler, both
 * with the scroller's geometry stubbed, asserting which widths reach
 * `onWidthChange` and which are refused before the store is touched.
 *
 * WHAT IT DELIBERATELY DOES NOT PIN. REAL layout (jsdom has none: the pane
 * reading is stubbed to the numbers the story host measures, so what is
 * exercised is the DECISION and its use of the reading, not the reading's own
 * arithmetic against a live layout), the hover-intent delay, and the
 * capture-phase PREVENTDEFAULT ordering against the scroller's paging guard.
 * The real geometry is the CDP rig's (`chat-measure-drag-evidence.mjs` drives
 * the real surface against real layout), and this file says so rather than
 * implying otherwise: a jsdom render cannot register the scroller's native
 * listener wiring the ordering depends on.
 */
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// React DOM feature-detects input events at import time. Give it a document
// before loading it, rather than activating its legacy IE event path.
const bootstrapDOM = new JSDOM("<!doctype html>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
/*
 * Node has no `getComputedStyle`, and the read's capability guard asks for
 * exactly that: without this line every bare `node --test` host answers `null`,
 * which is how the first draft of this file failed. A browser host has it as a
 * global, and jsdom puts it on the window, so the test promotes it the same way
 * it promotes `document`. Measured on jsdom 26.1.0: an INLINE custom property
 * set on `documentElement.style` resolves through it.
 */
globalThis.getComputedStyle = bootstrapDOM.window.getComputedStyle.bind(
	bootstrapDOM.window,
);
const { createRoot } = await import("react-dom/client");

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const TSX_EXT = /\.tsx?$/;
const outdir = `${root}/node_modules/.cache/chat-measure-handle-test`;
const entries = [
	"src/renderer/src/features/chat/components/chat-measure-handle.tsx",
	"src/renderer/src/features/chat/chat-measure.ts",
	"src/renderer/src/features/chat/chat-measure-drag.ts",
];
const outputs = await build({
	entryPoints: entries.map((entry) => `${root}/${entry}`),
	outdir,
	bundle: true,
	format: "esm",
	platform: "browser",
	jsx: "automatic",
	packages: "external",
	alias: { "@shared": `${root}/src/renderer/src/shared` },
	write: true,
	metafile: true,
	logLevel: "silent",
});
const outFor = (entry) => {
	const key = Object.keys(outputs.metafile.outputs).find((k) =>
		k.endsWith(entry.split("/").pop().replace(TSX_EXT, ".js")),
	);
	assert.ok(key, `no bundle for ${entry}`);
	return `${root}/${key}`;
};
const { ChatMeasureHandle } = await import(outFor(entries[0]));
const {
	CHAT_MEASURE_OVERRIDE_VAR,
	CHAT_MEASURE_SHIPPED_VAR,
	readShippedChatMeasurePx,
} = await import(outFor(entries[1]));
const { CHAT_MEASURE_MIN_PX, CHAT_MEASURE_MAX_PX } = await import(
	outFor(entries[2])
);

after(async () => {
	await Promise.all(
		Object.keys(outputs.metafile.outputs).map((k) => unlink(`${root}/${k}`)),
	);
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.getComputedStyle = undefined;
});

/** The separator under a freshly rendered handle, with its callbacks. */
const renderHandle = async (props, host = document.body) => {
	const container = document.createElement("div");
	host.appendChild(container);
	const changes = [];
	const resets = [];
	const element = (p) =>
		React.createElement(ChatMeasureHandle, {
			edge: "right",
			width: 900,
			onWidthChange: (width) => changes.push(width),
			onReset: () => resets.push(true),
			label: "Widen or narrow the conversation column (right edge)",
			...p,
		});
	const root = createRoot(container);
	await act(async () => {
		root.render(element(props));
	});
	const separator = container.querySelector('[role="separator"]');
	assert.ok(separator, "the handle renders a separator");
	/*
	 * A RE-RENDER, so a walk of successive presses can run through ONE mounted
	 * component rather than a remount per step (U8's walk pins what each key's
	 * result then becomes the next key's starting width). The callbacks are the
	 * same closures, so `changes` accumulates across the walk.
	 */
	const rerender = async (p) => {
		await act(async () => {
			root.render(element(p));
		});
	};
	return { separator, changes, resets, rerender };
};

/**
 * The handle inside the transcript structure its pane reading walks: a scroller
 * (`[data-lo-canonical-transcript]`) around a content column
 * (`[data-lo-transcript-content]`) around the handle.
 *
 * jsdom HAS NO LAYOUT, so the scroller's geometry is stubbed to the numbers
 * the story host measures at a 1000px pane: a 1000px scroller with 16+16px
 * paddings, which is the 968px content box U4's seat renders 968 in
 * (`clientWidth - paddings`, what `paneWidthPx` reads). The stub is the
 * scroller's OWN shape - an inline padding and an instance `clientWidth` -
 * rather than a fake reading handed to the component, so the component's
 * arithmetic runs through the same expressions production uses.
 */
const renderHandleInScroller = async ({ paneClientWidth, props }) => {
	const scroller = document.createElement("div");
	scroller.setAttribute("data-lo-canonical-transcript", "");
	scroller.style.paddingLeft = "16px";
	scroller.style.paddingRight = "16px";
	Object.defineProperty(scroller, "clientWidth", {
		value: paneClientWidth,
		configurable: true,
	});
	const column = document.createElement("div");
	column.setAttribute("data-lo-transcript-content", "");
	scroller.appendChild(column);
	document.body.appendChild(scroller);
	const rendered = await renderHandle(props, column);
	return { scroller, column, ...rendered };
};

/**
 * A press/move/release through the same events a pointer produces: `mousedown`
 * on the separator, then `mousemove`/`mouseup` on the window (where the
 * component registers them - a release outside the window arrives as a bare
 * `mouseup` and is resolved against the last position the pointer was seen at).
 */
const drag = async (separator, { fromX, toX }) => {
	await act(async () => {
		separator.dispatchEvent(
			new window.MouseEvent("mousedown", {
				clientX: fromX,
				clientY: 240,
				button: 0,
				buttons: 1,
				detail: 1,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await act(async () => {
		window.dispatchEvent(
			new window.MouseEvent("mousemove", {
				clientX: toX,
				clientY: 240,
				bubbles: true,
			}),
		);
	});
	await act(async () => {
		window.dispatchEvent(
			new window.MouseEvent("mouseup", {
				clientX: toX,
				clientY: 240,
				bubbles: true,
			}),
		);
	});
};

const press = async (separator, key, shiftKey = false) => {
	await act(async () => {
		separator.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
		);
	});
};

test("the shipped measure reads through an inline custom property, and is null without one", async () => {
	// The gate's own semantics, in the host its comment calls a unit test: no
	// stylesheet, no property - and `readShippedChatMeasurePx` answers `null`
	// rather than inventing a measure. jsdom 26 resolves an inline custom
	// property through `getComputedStyle` (measured), so the second half of
	// this test exercises the read's happy path rather than a stub's.
	assert.equal(
		readShippedChatMeasurePx(),
		null,
		"a host with no measure property has no measure",
	);
	document.documentElement.style.setProperty(CHAT_MEASURE_SHIPPED_VAR, "900px");
	assert.equal(readShippedChatMeasurePx(), 900);
	// The read parses rather than truncates: a fractional shipped measure
	// survives, which is what lets the rig compare a 812.5 reading at all.
	document.documentElement.style.setProperty(
		CHAT_MEASURE_SHIPPED_VAR,
		"812.5px",
	);
	assert.equal(readShippedChatMeasurePx(), 812.5);
});

test("the separator carries its roles and value bounds", async () => {
	const { separator } = await renderHandle({});
	assert.equal(separator.getAttribute("aria-orientation"), "vertical");
	assert.equal(separator.getAttribute("aria-valuenow"), "900");
	assert.equal(
		separator.getAttribute("aria-valuemin"),
		String(CHAT_MEASURE_MIN_PX),
	);
	assert.equal(
		separator.getAttribute("aria-valuemax"),
		String(CHAT_MEASURE_MAX_PX),
	);
	assert.equal(separator.getAttribute("data-lo-chat-measure-handle"), "right");
	assert.equal(separator.getAttribute("tabindex"), "0");
	assert.equal(
		separator.getAttribute("aria-label"),
		"Widen or narrow the conversation column (right edge)",
	);
});

/*
 * The announced key map, kept across the tooltip. The tooltip is the POINTER
 * channel and it must not replace this one: `aria-keyshortcuts` plus the mounts'
 * labels are where a screen reader reads the keys, and the state line's arrival
 * moved the strip's copy around without touching either.
 */
test("the separator still announces its keys", async () => {
	const { separator } = await renderHandle({});
	assert.equal(
		separator.getAttribute("aria-keyshortcuts"),
		"ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End Enter",
	);
});

/*
 * The state line's STRUCTURE, which is a lint requirement rather than a taste:
 * `role="separator"` on an element with children is refused by the repo's own
 * `useSemanticElements`, so the line is a sibling of the widget and the widget
 * stays childless. A later refactor that nests the line would silently restore
 * the shape the rule exists to refuse, so it is pinned here - the line is paint
 * the wrapper owns, tagged with the edge it marks, hidden from the
 * accessibility tree, and never inside the separator.
 */
test("the state line is a sibling of a childless separator, and aria-hidden", async () => {
	const { separator } = await renderHandle({});
	const line = separator.parentElement?.querySelector(
		'[data-lo-chat-measure-line="right"]',
	);
	assert.ok(line, "the handle renders its state line");
	assert.equal(line.getAttribute("aria-hidden"), "true");
	assert.equal(line.children.length, 0, "the line is paint, not a container");
	assert.equal(separator.children.length, 0, "the separator stays childless");
	assert.equal(
		separator.querySelector("[data-lo-chat-measure-line]"),
		null,
		"the line must not be a descendant of the widget",
	);
});

/*
 * THE POINTER-EVENTS PAIRING, which is the only thing between a full-column
 * absolutely-positioned box and every click in the transcript (the property the
 * 24px offset used to carry alone). jsdom cannot see Tailwind's cascade, so the
 * pin has to be the class pairing itself - the source-text shape
 * `chrome-keychain.test.mjs` and `notification-spawn-sites.test.mjs` use.
 */
test("the wrapper is transparent to the pointer and the separator opts back in", async () => {
	const { separator } = await renderHandle({});
	const wrapper = separator.parentElement;
	assert.ok(wrapper, "the separator sits inside the wrapper");
	assert.match(wrapper.className, /pointer-events-none/);
	assert.match(separator.className, /pointer-events-auto/);
});

/*
 * THE BAND HUGS THE LINE (UX round 1's U1). Both offsets are placed from the
 * same edge, the band on the gutter side of the line, so a press on the drawn
 * rule starts the drag the way every family divider's does. The old 34px offset
 * and its clamp are gone with the dead zone between the two.
 */
test("the band and the line are placed from the same edge, the band outboard", async () => {
	for (const edge of ["left", "right"]) {
		const { separator } = await renderHandle({ edge });
		const line = separator.parentElement?.querySelector(
			`[data-lo-chat-measure-line="${edge}"]`,
		);
		assert.ok(line, `the ${edge} line renders`);
		assert.match(separator.className, new RegExp(`-${edge}-2\\.5`));
		assert.match(line.className, new RegExp(`-${edge}-0\\.5`));
		assert.doesNotMatch(separator.className, /34px/);
		assert.equal(separator.getAttribute("style"), null);
	}
});

/*
 * THE TOOLTIP'S ANCHOR (agent review round 1's M1): a bounded 16px box at the
 * hand's Y, a sibling of the widget rather than the widget itself - anchored to
 * the separator, the panel is placed against the content column's own height and
 * goes off-screen on any transcript that scrolls.
 */
test("the tooltip anchor is a bounded sibling box, not the separator", async () => {
	const { separator } = await renderHandle({});
	const anchor = separator.parentElement?.querySelector(
		"[data-lo-chat-measure-anchor]",
	);
	assert.ok(anchor, "the handle renders its tooltip anchor");
	assert.notEqual(anchor, separator);
	assert.equal(
		separator.querySelector("[data-lo-chat-measure-anchor]"),
		null,
		"the anchor must not be a descendant of the widget",
	);
	assert.match(anchor.className, /pointer-events-none/);
	assert.equal(anchor.style.height, "16px");
});

test("the keyboard steps move the width, and Enter resets", async () => {
	const { separator, changes, resets } = await renderHandle({});
	await press(separator, "ArrowRight");
	await press(separator, "ArrowLeft");
	await press(separator, "ArrowRight", true);
	await press(separator, "Home");
	await press(separator, "End");
	await press(separator, "Enter");
	assert.deepEqual(changes, [
		900 + 16,
		900 - 16,
		900 + 64,
		CHAT_MEASURE_MIN_PX,
		CHAT_MEASURE_MAX_PX,
	]);
	assert.deepEqual(resets, [true]);
});

/*
 * The release decision, through the commit path (round 2's U4): the release
 * asks the pane before it writes, with the scroller's reading stubbed to the
 * story host's numbers. These two tests are the component-level half of the
 * pair `scripts/chat-measure-drag.test.mjs` pins as arithmetic.
 */

test("a release the pane is already showing never reaches the store", async () => {
	/*
	 * The measured seat: stored 1100 at a pane whose content box is 968 (the
	 * 1000px scroller inset by 16+16px, the story host's own numbers). A 20px
	 * travelled drag points at 1060, still above what the pane can show, so the
	 * release must write NOTHING - no store call, no `aria-valuenow` move, and
	 * the override property put back exactly where the gesture found it.
	 */
	const { separator, changes } = await renderHandleInScroller({
		paneClientWidth: 1000,
		props: { width: 1100 },
	});
	document.documentElement.style.setProperty(
		CHAT_MEASURE_OVERRIDE_VAR,
		"1100px",
	);
	await drag(separator, { fromX: 500, toX: 480 });
	assert.deepEqual(changes, [], "an invisible commit must not reach the store");
	assert.equal(
		separator.getAttribute("aria-valuenow"),
		"1100",
		"the announcement must not move either",
	);
	assert.equal(
		document.documentElement.style.getPropertyValue(CHAT_MEASURE_OVERRIDE_VAR),
		"1100px",
		"the preview must be put back so the column keeps the width it had",
	);
});

test("the same release commits where the pane can show it", async () => {
	/*
	 * The pair's other seat: a pane that can draw 1060 (a 1400px scroller), so
	 * the drag 1100 -> 1060 moves pixels and the release reaches the store with
	 * the dragged width - the width the hand asked for, not a display value.
	 */
	const { separator, changes } = await renderHandleInScroller({
		paneClientWidth: 1400,
		props: { width: 1100 },
	});
	await drag(separator, { fromX: 500, toX: 480 });
	assert.deepEqual(
		changes,
		[1060],
		"a visible narrowing commits the dragged width",
	);
});

/*
 * The keyboard half of the same rule, rebuilt for round 3's U8: the step
 * starts from the RENDERED width when the column is clamped, and a step that
 * cannot move a pixel still never reaches the store. Measured seats: stored
 * 1100 at a 968px content box walks 952 -> 936 -> 872; the same key at the
 * 800 and 780 panes steps from those content boxes; growth at the pane's edge
 * (`ArrowRight`, `End`) is a no-op; a roomy pane is unchanged (the case
 * below). Same scroller stub and numbers as the pair above, so the two paths
 * are compared against one arithmetic.
 */

test("a clamped ArrowLeft steps from the rendered width and keeps walking", async () => {
	const { separator, changes, rerender } = await renderHandleInScroller({
		paneClientWidth: 1000,
		props: { width: 1100 },
	});
	await press(separator, "ArrowLeft");
	assert.deepEqual(
		changes,
		[952],
		"the first press lands one step below what the pane draws",
	);
	await rerender({ width: 952 });
	await press(separator, "ArrowLeft");
	assert.deepEqual(changes, [952, 936], "and the next press moves again");
	await rerender({ width: 936 });
	await press(separator, "ArrowLeft", true);
	assert.deepEqual(changes, [952, 936, 872], "the coarse step crosses too");
});

test("the same step starts from each pane's own rendered width", async () => {
	const narrow = await renderHandleInScroller({
		paneClientWidth: 800,
		props: { width: 1100 },
	});
	await press(narrow.separator, "ArrowLeft");
	assert.deepEqual(
		narrow.changes,
		[752],
		"a 800px pane draws 768, so the step lands at 752",
	);
	const narrower = await renderHandleInScroller({
		paneClientWidth: 780,
		props: { width: 810 },
	});
	await press(narrower.separator, "ArrowLeft");
	await press(narrower.separator, "ArrowLeft", true);
	assert.deepEqual(
		narrower.changes,
		[732, 684],
		"a 780px pane draws 748, and both steps move it",
	);
});

test("growth at the pane's edge writes nothing", async () => {
	const { separator, changes } = await renderHandleInScroller({
		paneClientWidth: 1000,
		props: { width: 1100 },
	});
	await press(separator, "ArrowRight");
	await press(separator, "End");
	assert.deepEqual(
		changes,
		[],
		"there is nothing wider to show, so neither key reaches the store",
	);
	assert.equal(
		separator.getAttribute("aria-valuenow"),
		"1100",
		"the announcement must not move either",
	);
});

test("the same keyboard step commits where the pane can show it", async () => {
	const { separator, changes } = await renderHandleInScroller({
		paneClientWidth: 1400,
		props: { width: 1100 },
	});
	await press(separator, "ArrowLeft");
	assert.deepEqual(
		changes,
		[1084],
		"a step that moves pixels commits where the step lands",
	);
});
