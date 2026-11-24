import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const require = createRequire(import.meta.url);

test("the Browser route rejoins its rect transport after React 18 StrictMode replay", async (t) => {
	// Mount the actual surface and let React replay its effects. Only layout, the
	// animation clock and the preload boundary are synthetic; jsdom cannot paint.
	const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
	const { window } = dom;
	const { document } = window;
	let box = { left: 10, top: 20, right: 110, bottom: 120 };
	let nextFrame = 0;
	const frames = new Map();
	const requestAnimationFrame = (callback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	};
	const cancelAnimationFrame = (id) => frames.delete(id);
	const advance = () => {
		for (const id of [...frames.keys()]) {
			const callback = frames.get(id);
			frames.delete(id);
			callback?.(0);
		}
	};
	class ResizeObserver {
		observe() {}
		disconnect() {}
	}
	Object.assign(window, {
		ResizeObserver,
		requestAnimationFrame,
		cancelAnimationFrame,
	});
	Object.assign(globalThis, {
		window,
		document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		DOMRect: window.DOMRect,
		MutationObserver: window.MutationObserver,
		localStorage: window.localStorage,
		getComputedStyle: window.getComputedStyle.bind(window),
		ResizeObserver,
		requestAnimationFrame,
		cancelAnimationFrame,
		IS_REACT_ACT_ENVIRONMENT: true,
	});
	const viewport = '[data-tour-tag="browser-content"]';
	window.HTMLElement.prototype.getBoundingClientRect = function () {
		return this.matches(viewport) ? box : new window.DOMRect();
	};

	const delivered = [];
	const state = { tabs: [], pendingConsent: [], approvals: [] };
	const stateListeners = new Set();
	const notifyState = () => {
		for (const notify of stateListeners) notify();
	};
	window.api = {
		browser: {
			state: async () => ({ ...state }),
			onStateChanged: (notify) => {
				stateListeners.add(notify);
				return () => stateListeners.delete(notify);
			},
			retry: async () => {
				state.availability = { status: "ready" };
				notifyState();
			},
			setContentRect: async (rect) => {
				delivered.push(rect);
			},
			setViewVisible: async () => {},
			onChord: () => () => {},
			setChordFocus: async () => {},
			onConsentAttention: () => () => {},
			onConsentChanged: () => () => {},
		},
	};

	const { createRoot } = await import("react-dom/client");
	const bundle = await build({
		stdin: {
			contents: [
				'export { BrowserPage } from "./src/renderer/src/features/browser/components/browser-page";',
				'export { useBrowserChrome } from "./src/renderer/src/features/browser/hooks/use-browser-chrome";',
				'export { overlapsBrowserView } from "./src/renderer/src/shared/browser-view-policy";',
			].join("\n"),
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "cjs",
		platform: "node",
		write: false,
		jsx: "automatic",
		alias: {
			"@assets": "./src/renderer/src/assets",
			"@shared": "./src/renderer/src/shared",
			"@features": "./src/renderer/src/features",
		},
		define: { "import.meta.env": "{}" },
		loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl" },
		external: ["react", "react-dom", "react/jsx-runtime"],
	});
	const module = { exports: {} };
	new Function("module", "exports", "require", bundle.outputFiles[0].text)(
		module,
		module.exports,
		require,
	);
	const { BrowserPage, overlapsBrowserView, useBrowserChrome } = module.exports;

	const root = createRoot(document.getElementById("root"));
	const route = React.createElement(
		React.StrictMode,
		null,
		React.createElement(BrowserPage),
	);
	const overlay = { x: 10, y: 20, width: 1, height: 1 };
	const first = { x: 10, y: 20, width: 100, height: 100 };
	const moved = { x: 11, y: 20, width: 130, height: 100 };
	const seen = (step) => t.diagnostic(`${step}: ${JSON.stringify(delivered)}`);
	const expectRect = (step, expected) => {
		seen(step);
		assert.deepEqual(delivered.at(-1), expected, step);
	};
	try {
		await act(async () => root.render(route));
		const readyNode = document.querySelector(viewport);
		assert.ok(readyNode, "ready DOM is attached");
		assert.equal(overlapsBrowserView(overlay), true);
		await act(async () => {
			advance();
			advance();
		});
		seen("mount after effect replay");
		const mountedRect = delivered.at(-1);

		box = { ...box, left: 11, right: 141 };
		await act(async () => {
			advance();
			advance();
		});
		seen("width and position change");
		assert.deepEqual([mountedRect, delivered.at(-1)], [first, moved]);
		assert.equal(overlapsBrowserView(overlay), false);

		// The tracker runs after this frame's transport callback. A collapse must
		// hide in the tracking frame, without publishing another rect afterward.
		box = { ...box, right: 11 };
		await act(async () => advance());
		expectRect("zero-area viewport", null);
		const afterCollapse = delivered.length;
		await act(async () => advance());
		assert.equal(delivered.length, afterCollapse);
		assert.equal(overlapsBrowserView({ ...overlay, x: 11 }), false);

		box = { ...box, right: 141 };
		await act(async () => {
			advance();
			advance();
		});
		expectRect("restored viewport", moved);
		assert.equal(overlapsBrowserView({ ...overlay, x: 11 }), true);

		// A resize is now queued for the coalescer. Removing the actual ready div
		// via the projection store must clear both the registry and that work.
		box = { ...box, right: 151 };
		await act(async () => advance());
		expectRect("resize still queued", moved);
		state.availability = {
			status: "unavailable",
			message: "Test retry",
			canRetry: true,
		};
		await act(async () => notifyState());
		assert.equal(document.querySelector(viewport), null);
		expectRect("unavailable detaches without another frame", null);
		assert.equal(overlapsBrowserView({ ...overlay, x: 11 }), false);
		const afterDetach = delivered.length;
		await act(async () => advance());
		assert.equal(delivered.length, afterDetach);

		await act(async () => {
			document
				.querySelector('[data-tour-tag="browser-availability-retry"]')
				.click();
		});
		const recoveredNode = document.querySelector(viewport);
		assert.ok(recoveredNode, "ready div returns on retry");
		assert.notEqual(recoveredNode, readyNode, "retry mounts a new node");
		await act(async () => {
			advance();
			advance();
		});
		expectRect("new ready div after recovery", { ...moved, width: 140 });
		assert.equal(overlapsBrowserView({ ...overlay, x: 11 }), true);

		box = { ...box, right: 161 };
		await act(async () => advance());
		expectRect("resize queued before route exit", { ...moved, width: 140 });
		act(() => root.render(null));
		expectRect("route unmount sends null in the same commit", null);
		assert.equal(overlapsBrowserView({ ...overlay, x: 11 }), false);
		const afterUnmount = delivered.length;
		await act(async () => {
			advance();
			advance();
		});
		assert.equal(delivered.length, afterUnmount);

		await act(async () => root.render(route));
		const remountedNode = document.querySelector(viewport);
		assert.ok(remountedNode, "route remount attaches a viewport");
		assert.notEqual(remountedNode, recoveredNode);
		await act(async () => {
			advance();
			advance();
		});
		expectRect("fresh StrictMode route mount", { ...moved, width: 150 });
		assert.equal(overlapsBrowserView({ ...overlay, x: 11 }), true);

		// Without a caller-provided hide, the hook still owns its queued frame.
		// Replay must release that frame's slot before the publisher sets up again.
		function PublishOnce() {
			const { setContentRect } = useBrowserChrome();
			React.useLayoutEffect(() => setContentRect(first), [setContentRect]);
			return null;
		}
		await act(async () =>
			root.render(
				React.createElement(
					React.StrictMode,
					null,
					React.createElement(PublishOnce),
				),
			),
		);
		await act(async () => advance());
		expectRect(
			"transport cleanup allows a new frame without caller cleanup",
			first,
		);
	} finally {
		await act(async () => root.unmount());
		dom.window.close();
	}
});
