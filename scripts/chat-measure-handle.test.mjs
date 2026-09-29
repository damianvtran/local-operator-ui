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
 * in, and the bounds exported by `chat-measure-drag.ts`), the keyboard
 * arithmetic (arrow steps, the coarse shift step, Home/End, Enter-to-reset),
 * and - since round 2's U4 - the release decision itself: a synthetic
 * press/move/release driven through the same event path a pointer produces,
 * with the scroller's geometry stubbed, asserting which releases reach
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
	await act(async () => {
		createRoot(container).render(
			React.createElement(ChatMeasureHandle, {
				edge: "right",
				width: 900,
				onWidthChange: (width) => changes.push(width),
				onReset: () => resets.push(true),
				label: "Widen or narrow the conversation column (right edge)",
				...props,
			}),
		);
	});
	const separator = container.querySelector('[role="separator"]');
	assert.ok(separator, "the handle renders a separator");
	return { separator, changes, resets };
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
