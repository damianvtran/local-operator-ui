import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The dock row's width, driven on the shipped hook in a real DOM.
 *
 * The row exists only on the BrowserSurface's ready return; the availability
 * branch (cold start, host retry) has no row at all. A one-shot mount effect
 * therefore observes null and never fires again, and the narrow pane falls back
 * to the 24px side form after the host becomes ready. This file mounts the hook
 * with the row absent first, then present, and asserts the full-width state
 * arrives on the attach that the remount performs — the failure F1 described.
 *
 * jsdom has no layout, so the row's `clientWidth` is defined on the node the
 * ref receives; that is the one value the hook reads.
 */

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/browser",
});
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.HTMLElement = DOM.window.HTMLElement;
globalThis.Element = DOM.window.Element;
globalThis.Node = DOM.window.Node;
globalThis.DOMRect = DOM.window.DOMRect;
globalThis.getComputedStyle = DOM.window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** No callbacks are fired: jsdom has no layout to change. The attach itself
 * reports, which is the behaviour under test. */
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
};

const bundle = await build({
	entryPoints: [
		"src/renderer/src/features/browser/model/use-approvals-dock-width.ts",
	],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	external: ["react"],
});
const bundlePath = join(
	process.cwd(),
	"scripts",
	"_browser-approvals-dock-width.bundle.mjs",
);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { useApprovalsDockWidth } = await import(
	`${new URL(`file://${bundlePath}`).href}?v=${Date.now()}`
);
unlinkSync(bundlePath);

const { createRoot } = await import("react-dom/client");

function Probe({ width = 264 }) {
	const [available, setAvailable] = React.useState(false);
	globalThis.__showDockRow = () => setAvailable(true);
	const { fullWidth, attachDockRow } = useApprovalsDockWidth();
	const setRow = (node) => {
		if (node) {
			Object.defineProperty(node, "clientWidth", {
				value: width,
				configurable: true,
			});
		}
		attachDockRow(node);
	};
	return React.createElement(
		"div",
		null,
		available
			? React.createElement("div", { ref: setRow, "data-row": "present" })
			: null,
		React.createElement(
			"output",
			{ id: "layout" },
			fullWidth ? "full" : "side",
		),
	);
}

test("a row that appears after the availability branch attaches the full width", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(React.createElement(Probe));
	});
	assert.equal(
		container.querySelector("#layout").textContent,
		"side",
		"with no row there is no width to measure; the initial state is not a claim",
	);
	await act(async () => {
		globalThis.__showDockRow();
	});
	assert.equal(
		container.querySelector("#layout").textContent,
		"full",
		"the row mounted after the availability branch must be measured on attach, not only at mount",
	);
	await act(async () => root.unmount());
	container.remove();
});

test("the same attach reports a wide row as the side form", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(React.createElement(Probe, { width: 640 }));
	});
	await act(async () => {
		globalThis.__showDockRow();
	});
	assert.equal(
		container.querySelector("#layout").textContent,
		"side",
		"the callback ref reports the width it was attached to, not a constant",
	);
	await act(async () => root.unmount());
	container.remove();
});
