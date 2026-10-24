import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE COLD-OPEN HOOK ORDER (QA blocker, staging branch).
 *
 * A fresh conversation renders the status strip with no snapshot, then renders
 * it again when the stream's first frame lands. A hook registered after the
 * empty-pane `return` therefore changes the hook count between those two
 * renders and React throws #310 - the composer's error boundary catches it as
 * "Something went wrong" on the first open of every chat.
 *
 * The test mounts the REAL component in jsdom and drives exactly that
 * transition. It asserts the loaded frame renders (the strip's own text), not
 * just that nothing threw, so a fix that returned early in both frames would
 * still fail.
 */

const ROOT = process.cwd();
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
// `navigator` is a getter on Node's global object; the component reads
// `navigator.platform`, so it has to be the jsdom one.
Object.defineProperty(globalThis, "navigator", {
	value: window.navigator,
	configurable: true,
});
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.matchMedia = () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
});

const bundlePath = join(
	ROOT,
	"node_modules/.cache/session-status-strip-hooks/strip.mjs",
);
const bundle = buildSync({
	stdin: {
		contents:
			'export { SessionStatusStrip } from "./src/renderer/src/features/chat/session-status/session-status-strip.tsx";',
		resolveDir: ROOT,
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	jsx: "automatic",
	/*
	 * React stays ONE copy: the harness imports react/react-dom from the repo's
	 * node_modules, so the bundle must resolve jsx-runtime to the same instance
	 * rather than inlining a second one (two copies make every hook call read
	 * from a different dispatcher and throw).
	 */
	external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
	write: false,
	alias: {
		"@shared": join(ROOT, "src/renderer/src/shared"),
		"@features": join(ROOT, "src/renderer/src/features"),
		"@renderer": join(ROOT, "src/renderer/src"),
		"@assets": join(ROOT, "src/renderer/src/assets"),
	},
	loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl" },
	define: { "import.meta.env": "{}" },
	logLevel: "silent",
});
mkdirSync(dirname(bundlePath), { recursive: true });
writeFileSync(bundlePath, bundle.outputFiles[0].text);

const { SessionStatusStrip } = await import(`file://${bundlePath}`);
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

const LOADED_FRAME = {
	frontend: {
		model: { provider: "openai", model_id: "gpt-5" },
		context_tokens: 1200,
		context_window: 200000,
		active_duration_s: 3,
		activity_started_at: null,
		last_usage: null,
	},
};

test("fresh to loaded keeps the hook order: the cold open does not throw #310", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const render = (props) =>
		act(() => {
			root.render(React.createElement(SessionStatusStrip, props));
		});

	await render({ frontend: null });
	assert.equal(
		container.textContent?.trim(),
		"",
		"an empty pane stays silent rather than claiming a reading",
	);
	await render(LOADED_FRAME);
	assert.ok(
		(container.textContent ?? "").length > 0,
		"the loaded frame draws the strip",
	);
	// The transition back is the same hazard in reverse (a session that drops to
	// null while reconnecting).
	await render({ frontend: null });
	await act(() => root.unmount());
});
