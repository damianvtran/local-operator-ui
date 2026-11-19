import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE MEASURED PAUSE MUST ARM WHEN THE PANEL MOUNTS, NOT WHEN ITS WRAPPER DOES
 * (agent BLOCKER-1, QA Q-1).
 *
 * Radix's `DropdownMenuContent` is a wrapper: it mounts with its parent, while
 * the panel inside it mounts only when the menu opens. The first S5 cut
 * measured once, on wrapper mount, found no element and never tried again — so
 * the row's ⋯ menu opened with no `data-suppressed-by` and painted under the
 * native page. This file drives that exact shape: a component that exists from
 * the start, whose measured panel appears LATER, rendered through the real
 * shared primitive.
 */

const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{ pretendToBeVisual: true, url: "http://localhost/" },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* accessor with no setter */
	}
}
/* React's event system constructs events with the GLOBAL constructors; Node has
   its own `Event`, so jsdom's must win before react-dom dispatches anything. */
for (const name of [
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"PointerEvent",
	"FocusEvent",
	"InputEvent",
]) {
	if (name in dom.window) globalThis[name] = dom.window[name];
}
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.Element.prototype.scrollIntoView = () => {};
const nativeMatches = dom.window.Element.prototype.matches;
dom.window.Element.prototype.matches = function matches(selector) {
	if (String(selector).includes(":modal")) {
		throw new dom.window.DOMException(":modal unsupported", "SyntaxError");
	}
	return nativeMatches.call(this, selector);
};
/* jsdom has no layout: every panel reports a box that overlaps the view. */
dom.window.Element.prototype.getBoundingClientRect = function rect() {
	return {
		x: 0,
		y: 0,
		left: 0,
		top: 0,
		right: 400,
		bottom: 200,
		width: 400,
		height: 200,
		toJSON() {
			return this;
		},
	};
};
/* The policy's release hold is frame-spaced. Node has no RAF (CI's Node version
   especially), so a close that measured a reach would throw inside a layout
   effect instead of releasing; a bounded timer is the same schedule here. */
const probeFrames = new Set();
globalThis.requestAnimationFrame = (callback) => {
	const id = setTimeout(() => {
		probeFrames.delete(id);
		callback(performance.now());
	}, 16);
	probeFrames.add(id);
	return id;
};
globalThis.cancelAnimationFrame = (id) => {
	probeFrames.delete(id);
	clearTimeout(id);
};
/** The probe's only timer source. Called after unmount so a failed assertion
 *  cannot leave a frame-spaced timer (or the React root) holding the process. */
function clearProbeFrames() {
	for (const id of probeFrames) clearTimeout(id);
	probeFrames.clear();
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = await import("react");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const ENTRY = `
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	browserViewSuppressed,
	registerBrowserViewRect,
	suppressedOverlayIds,
	useMeasuredBrowserViewPanel,
} from "./src/renderer/src/shared/browser-view-policy";


export function mount(container) {
	const root = createRoot(container);
	let setShow = () => {};
	function LaterPanel() {
		const [show, set] = useState(false);
		setShow = set;
		const panelRef = useMeasuredBrowserViewPanel("menu");
		return createElement(
			"div",
			null,
			show
				? createElement("div", { ref: panelRef, id: "later-panel" }, "panel")
				: null,
		);
	}
	root.render(createElement(LaterPanel));
	return {
		show: (value) => setShow(value),
		unmount: () => root.unmount(),
	};
}

export { browserViewSuppressed, suppressedOverlayIds, registerBrowserViewRect };
`;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "policy-kinds.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	// EXTERNAL REACT IS THE ACT BOUNDARY: a second bundled React made the outer
	// `act` a no-op around this root (the LaterPanel warning), and the unflushed
	// update is what stalled the CI lane. A real file lets the bare imports
	// resolve to the same React instance the test imports.
	external: ["react", "react-dom/client"],
	write: false,
});
const bundlePath = `./_browser-view-policy-kinds-${process.pid}.mjs`;
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const mod = await import(pathToFileURL(bundlePath).href);
after(() => {
	try {
		unlinkSync(bundlePath);
	} catch {
		// Already removed by a failed earlier cleanup.
	}
});

const flush = async (frames = 12) => {
	for (let i = 0; i < frames; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
	}
};

test("a panel that mounts AFTER its always-mounted wrapper still arms the pause (BLOCKER-1)", async () => {
	const release = mod.registerBrowserViewRect(() => ({
		x: 0,
		y: 0,
		width: 500,
		height: 500,
	}));
	const container = document.createElement("div");
	document.body.appendChild(container);
	let view;
	await act(async () => {
		view = mod.mount(container);
	});
	try {
		await flush();
		assert.equal(mod.browserViewSuppressed(), false, "nothing mounted yet");

		await act(async () => view.show(true));
		await flush();
		assert.equal(
			mod.browserViewSuppressed(),
			true,
			"the panel's arrival is measured; the id sweep names a menu",
		);
		assert.ok(
			mod.suppressedOverlayIds().some((id) => id.startsWith("menu:")),
			JSON.stringify(mod.suppressedOverlayIds()),
		);

		await act(async () => view.show(false));
		await flush(8);
		assert.equal(mod.browserViewSuppressed(), false, "unmount releases");
		await act(async () => view.show(true));
		await flush(6);
		assert.equal(
			mod.browserViewSuppressed(),
			true,
			"positive control: the same panel pauses while a view is registered",
		);
		await act(async () => view.show(false));
		await flush(8);
		release();
		await act(async () => view.show(true));
		await flush(6);
		assert.equal(
			mod.browserViewSuppressed(),
			false,
			"negative control: no registered view, no pause, whatever the panel does",
		);
		// IN-BAND NEGATIVE CONTROL: registered, mounted, and not overlapping.
		const far = mod.registerBrowserViewRect(() => ({
			x: 2000,
			y: 0,
			width: 300,
			height: 300,
		}));
		await act(async () => view.show(true));
		await flush(8);
		assert.equal(
			mod.browserViewSuppressed(),
			false,
			"a mounted panel outside the view rect must not pause",
		);
		await act(async () => view.show(false));
		await flush(6);
		far();
	} finally {
		await act(async () => view.unmount());
		clearProbeFrames();
		release();
		container.remove();
	}
});

test("every pause-measured primitive hands the panel MOUNT to the hook", () => {
	const path = (p) => readFileSync(p, "utf8");
	for (const [file, kind] of [
		["dropdown-menu", "menu"],
		["context-menu", "context-menu"],
		["popover", "popover"],
		["select", "select"],
	]) {
		const source = path(`src/renderer/src/shared/components/ui/${file}.tsx`);
		assert.match(
			source,
			new RegExp(`useMeasuredBrowserViewPanel<HTMLDivElement>\\("${kind}"\\)`),
			`${file} asks the policy for a measured ${kind}`,
		);
		// A callback ref, not a RefObject: the panel mounts later than the wrapper.
		assert.match(
			source,
			/const composedRef = useMemo\(\s*\(\) => composeRefs\(ref, panelRef\),\s*\[ref, panelRef\],?\s*\);/,
			`${file} passes the panel node back through a STABLE composed ref`,
		);
		assert.match(source, /ref=\{composedRef\}/, `${file} uses that ref`);
	}
});
