import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE FOLDED APPROVALS FOCUS PATH, DRIVEN THROUGH THE REAL MENU.
 *
 * Round 3 measured `<body>` holding focus for 85–657 ms after ⋯ → Approvals at
 * both widths: the menu item selected, Radix closed the panel, and its
 * return-to-trigger beat the dock's heading focus. The round-3 answer is two
 * callbacks — `onOpenApprovals` says whether this request OPENS the dock, and
 * `onDockOpened` runs on the tick after the close so the heading can take focus
 * then. This file is the behavioural half: it mounts the shipped menu in jsdom,
 * opens it with the keyboard, chooses Approvals, and asserts the callback order.
 * The dock's heading focus itself is covered by the surface's focus request and
 * QA's real-key walk.
 *
 * jsdom needs the same three scaffolds as the other Radix harnesses here: an
 * `:modal` answer (jsdom recurses on it), Resize/Mutation observers, and a
 * matchMedia stub.
 */

const ROOT = resolve(import.meta.dirname, "..");
const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.PointerEvent = dom.window.PointerEvent;
globalThis.FocusEvent = dom.window.FocusEvent;
globalThis.InputEvent = dom.window.InputEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) =>
	setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.matchMedia = () => ({
	matches: false,
	addListener() {},
	removeListener() {},
	addEventListener() {},
	removeEventListener() {},
});
dom.window.Element.prototype.scrollIntoView = () => {};
const nativeMatches = dom.window.Element.prototype.matches;
dom.window.Element.prototype.matches = function matches(selector) {
	if (String(selector).includes(":modal")) {
		throw new dom.window.DOMException(
			":modal is not supported here",
			"SyntaxError",
		);
	}
	return nativeMatches.call(this, selector);
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

after(() => {
	dom.window.close();
	for (const name of [
		"window",
		"document",
		"HTMLElement",
		"Element",
		"Node",
		"Event",
		"CustomEvent",
		"KeyboardEvent",
		"MouseEvent",
		"PointerEvent",
		"FocusEvent",
		"InputEvent",
		"MutationObserver",
	]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const bundle = await build({
	stdin: {
		contents: `export { BrowserPageMenu } from "./src/renderer/src/features/browser/components/browser-page-menu";`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
const cache = join(ROOT, "node_modules", ".cache", "browser-page-menu-focus");
mkdirSync(cache, { recursive: true });
const bundlePath = join(cache, "menu.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { BrowserPageMenu } = await import(pathToFileURL(bundlePath).href);

const flush = async (frames = 8) => {
	for (let i = 0; i < frames; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
	}
};

/** Mount the menu with observable callbacks and return its controls. */
const mountMenu = async ({ openResult }) => {
	const calls = { open: 0, settled: 0 };
	const props = {
		disabled: false,
		canGoForward: false,
		pageZoom: 1,
		waitingCount: 2,
		downloadsDir: null,
		showForward: false,
		showHome: false,
		onForward() {},
		onHome() {},
		onFind() {},
		onPrint() {},
		onResetZoom() {},
		onOpenDownloads() {},
		onOpenApprovals: () => {
			calls.open += 1;
			return openResult;
		},
		onDockOpened: () => {
			calls.settled += 1;
		},
		triggerRef: { current: null },
		showApprovalsFolded: true,
		canControlPage: true,
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(React.createElement(BrowserPageMenu, props));
	});
	await flush();
	const trigger = document.querySelector('[data-tour-tag="browser-page-menu"]');
	assert.ok(trigger, "the fixed overflow trigger is rendered");
	await act(async () => trigger.focus());
	await flush(4);
	await act(async () => {
		trigger.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
			}),
		);
	});
	await flush(6);
	assert.ok(document.querySelector('[role="menu"]'), "Enter opens the menu");
	const item = [...document.querySelectorAll('[role="menuitem"]')].find(
		(node) => node.dataset.tourTag === "browser-approvals",
	);
	assert.ok(item, "Approvals is an item in the folded menu");
	await act(async () => {
		item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	await flush(8);
	return {
		calls,
		trigger,
		cleanup: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
};

test("choosing Approvals opens the dock and focuses its heading after the menu closes", async () => {
	const { calls, trigger, cleanup } = await mountMenu({ openResult: true });
	assert.equal(calls.open, 1, "the item asks the surface to open the dock");
	assert.equal(
		calls.settled,
		1,
		"the heading focus is re-requested AFTER the panel has closed, not before",
	);
	assert.equal(document.querySelector('[role="menu"]'), null);
	/* Q4-1: the close's programmatic focus must not open the trigger tooltip. The
	   close grace covers >1.3s in the measured failure; wait past it. */
	await flush(40);
	assert.equal(
		document.querySelector('[role="tooltip"]'),
		null,
		"Page options must not repaint after the menu chose Approvals",
	);
	await act(async () => trigger.blur());
	await flush(2);
	await act(async () => trigger.focus());
	await flush(30);
	assert.ok(
		document.querySelector('[role="tooltip"]'),
		"a fresh focus later still opens the label",
	);
	/* Drain the tooltip before unmount: Radix's delay/auto-update timers are
	   global, not window-bound, and a live one can keep the test process alive
	   after its results are printed. */
	await act(async () => trigger.blur());
	await flush(30);
	await cleanup();
});

test("choosing Approvals while the dock is open closes it and returns focus to ⋯", async () => {
	const { calls, trigger, cleanup } = await mountMenu({ openResult: false });
	assert.equal(calls.open, 1);
	assert.equal(
		calls.settled,
		0,
		"a close must not re-focus the heading it is dismissing",
	);
	assert.equal(document.querySelector('[role="menu"]'), null);
	/* Radix's default close auto-focus is NOT declined on the close path, so the
	   trigger gets focus back instead of `<body>` (round-3 U16). */
	assert.equal(document.activeElement, trigger);
	await cleanup();
});
