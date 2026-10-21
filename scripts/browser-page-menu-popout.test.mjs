import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * S4b round-2 regression: the page menu must not take the popout with it.
 *
 * WHY A DOM TEST AND NOT A SOURCE GUARD. Round 1 found this by reading and by a
 * scratch probe: opening the menu from the raised popout closed the field row,
 * twice over — the menu registers view suppression (presentation flips, which
 * the controller used to read as a layout change and dismiss on), and Radix
 * portals the panel to `document.body` and moves focus into it, which the
 * popout's blur rule read as "focus left". Neither is visible in the JSX, so
 * this file mounts the SHIPPED `BrowserPageMenu` with the SHIPPED portal and
 * the SHIPPED `isPortalledChromeTarget`, inside a wrapper that applies the
 * surface's two rules (blur dismissal and close-focus return), and drives it.
 *
 * WHAT THIS IS NOT: Chromium. jsdom has no layout, no native view and no real
 * focus ring; the popout's pixel geometry and the native child's placement are
 * the probe's and the QA lease's job. This proves the DOM focus arbitration and
 * the menu's own wiring, which is where the defect was.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* jsdom context-bound accessors */
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Radix composes pointer events; jsdom does not ship PointerEvent everywhere.
if (typeof dom.window.PointerEvent !== "function") {
	class PointerEventPolyfill extends dom.window.MouseEvent {
		constructor(type, init = {}) {
			super(type, init);
			// `button`/`buttons` are getters on MouseEvent; define, do not assign.
			for (const [name, value] of [
				["pointerId", init.pointerId ?? 1],
				["pointerType", init.pointerType ?? "mouse"],
				["isPrimary", init.isPrimary ?? true],
				["pointerId", init.pointerId ?? 1],
			])
				Object.defineProperty(this, name, { value, configurable: true });
			if (init.buttons !== undefined)
				Object.defineProperty(this, "buttons", {
					value: init.buttons,
					configurable: true,
				});
		}
	}
	dom.window.PointerEvent = PointerEventPolyfill;
	globalThis.PointerEvent = PointerEventPolyfill;
}
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const bundle = await build({
	stdin: {
		contents: `
			export { BrowserPageMenu } from "./src/renderer/src/features/browser/components/browser-page-menu";
			export { isPortalledChromeTarget } from "./src/renderer/src/features/browser/model/floating-chrome";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	mainFields: ["module", "main"],
	alias: { "@shared": resolve("src/renderer/src/shared") },
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"react-dom/client",
		"lucide-react",
	],
});
const bundlePath = new URL("./_browser-page-menu.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { createElement: h, useRef, useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BrowserPageMenu, isPortalledChromeTarget } = await import(
	bundlePath.href
);
await unlink(bundlePath);

const noop = () => {};

/** The surface's popout wrapper, reduced to the two rules under test. */
function Harness() {
	const [dismissed, setDismissed] = useState(0);
	const [addressRaises, setAddressRaises] = useState(0);
	const [menuOpen, setMenuOpen] = useState(false);
	const inputRef = useRef(null);
	return h(
		"div",
		{
			"data-tour-tag": "harness-popout",
			"data-dismissed": String(dismissed),
			"data-address-raises": String(addressRaises),
			"data-menu-open": String(menuOpen),
			onBlurCapture: (event) => {
				const next = event.relatedTarget;
				if (next && !event.currentTarget.contains(next)) {
					if (isPortalledChromeTarget(next)) return;
					setDismissed((count) => count + 1);
				}
			},
		},
		h("input", {
			ref: inputRef,
			defaultValue: "127.0.0.1:62815/fixture",
			"data-tour-tag": "harness-address",
		}),
		h(BrowserPageMenu, {
			placement: "popout",
			disabled: false,
			loading: false,
			canGoBack: true,
			canGoForward: false,
			pageZoom: 1,
			waitingCount: 0,
			downloadsDir: null,
			onAddress: () => {
				setAddressRaises((count) => count + 1);
				inputRef.current?.focus();
			},
			onBack: noop,
			onForward: noop,
			onReload: noop,
			onStop: noop,
			onHome: noop,
			onFind: noop,
			onPrint: noop,
			onResetZoom: noop,
			onOpenDownloads: noop,
			onOpenApprovals: noop,
			onOpenChange: setMenuOpen,
			onCloseAutoFocus: (event) => {
				// The shipped surface only suppresses Radix's return-to-trigger while
				// the row is up; this harness models exactly that.
				const target = inputRef.current;
				if (!target) return;
				event.preventDefault();
				target.focus();
			},
		}),
	);
}

async function mount() {
	const container = dom.window.document.createElement("div");
	dom.window.document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(h(Harness));
	});
	return { container, root };
}

function pointer(type) {
	return new dom.window.PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		buttons: 1,
		pointerType: "mouse",
	});
}

async function openMenu(container) {
	const trigger = container.querySelector(
		'[data-tour-tag="browser-page-menu"]',
	);
	assert.ok(trigger, "the popout menu trigger is rendered");
	await act(async () => {
		trigger.dispatchEvent(pointer("pointerdown"));
	});
	await act(async () => {});
}

test("opening the page menu from the popout keeps the row and the panel", async () => {
	const { container, root } = await mount();
	const input = container.querySelector('[data-tour-tag="harness-address"]');
	await act(async () => {
		input.focus();
	});
	await openMenu(container);
	const menu = dom.window.document.querySelector('[role="menu"]');
	assert.ok(menu, "the menu content is mounted");
	assert.ok(
		dom.window.document.querySelector("[data-radix-popper-content-wrapper]"),
		"and it is in Radix's portal, outside the popout subtree",
	);
	assert.equal(
		container.querySelector("[data-dismissed]").dataset.dismissed,
		"0",
		"focus moving into the portal is not the user leaving the field",
	);
	assert.equal(
		container.querySelector("[data-menu-open]").dataset.menuOpen,
		"true",
	);
	await act(async () => root.unmount());
});

test("the Address item raises the field and focus comes back to it", async () => {
	const { container, root } = await mount();
	const input = container.querySelector('[data-tour-tag="harness-address"]');
	await act(async () => {
		input.focus();
	});
	await openMenu(container);
	const menu = dom.window.document.querySelector('[role="menu"]');
	const press = async (key) => {
		await act(async () => {
			(dom.window.document.activeElement ?? menu).dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await act(async () => {});
	};
	// Keyboard open highlights nothing; one ArrowDown moves to the first item.
	await press("ArrowDown");
	await press("Enter");
	await act(async () => {});
	const harness = container.querySelector("[data-dismissed]");
	assert.equal(
		harness.dataset.addressRaises,
		"1",
		"the Address item raises the field",
	);
	assert.equal(
		harness.dataset.dismissed,
		"0",
		"and the row is still there afterwards",
	);
	assert.equal(
		dom.window.document.activeElement,
		input,
		"focus is in the field, not back on the menu trigger",
	);
	await act(async () => root.unmount());
});
