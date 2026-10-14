/**
 * The live markdown path's cost model, pinned by RENDER COUNT.
 *
 *     node --test scripts/streaming-live-markdown.test.mjs
 *
 * `StreamingMarkdown` now parses the block that is still being written (so
 * `` `InfoList` `` is a code span the moment it is typed, not literal backticks
 * for a second). That is only acceptable if the cost stays bounded by ONE block:
 * a settled block must be parsed once, when it closes, and never again while the
 * tail grows. A DOM observer cannot show that (a wasted re-render that rebuilds
 * the same DOM mutates nothing), so `streamingRenderStats` counts the renders
 * directly: `settled` is a render of a CLOSED block, `tail` a render of the block
 * still being written.
 *
 * The workload is a 24-block document streamed in 4-character flushes - one
 * flush per animation frame is what `use-canonical-session` does. The assertion
 * is the invariant, not a time: after block N closes, its render count never
 * moves again. Frame cost is reported (mean/worst commit ms from React's own
 * Profiler) against the 16.7 ms frame budget, but it is load-dependent and only
 * printed - a number that depends on how many other agents share this laptop is
 * not a gate.
 *
 * WHAT THIS CANNOT SEE: jsdom has no layout or compositor, so this is main-thread
 * React work per flush and says nothing about paint or frame pacing.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");

/* React DOM feature-detects the document at import time. */
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.sessionStorage = bootstrap.window.sessionStorage;
const { createRoot } = await import("react-dom/client");

/* React stays out of the bundle so the mounted tree shares THIS React instance. */
const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
/* Its own cache directory: a sibling suite writes a different export set under
 * its own name, and two bundles under one path would race when both run. */
const CACHE = resolve(
	ROOT,
	"node_modules",
	".cache",
	"streaming-live-markdown",
);
mkdirSync(CACHE, { recursive: true });
const bundle = await build({
	stdin: {
		contents: `export { StreamingMarkdown, streamingRenderStats } from "./src/renderer/src/features/chat/components/markdown-renderer";`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: BARE_SPECIFIER }, (args) =>
					EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
				);
			},
		},
	],
	loader: { ".css": "empty" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
const bundlePath = resolve(CACHE, "streaming-live-markdown.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { StreamingMarkdown, streamingRenderStats } = await import(
	pathToFileURL(bundlePath).href
);
const createElement = React.createElement;

function mountDom() {
	const dom = new JSDOM('<!doctype html><div id="root"></div>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		NodeFilter: window.NodeFilter,
		MutationObserver: window.MutationObserver,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		getComputedStyle: window.getComputedStyle.bind(window),
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
		localStorage: window.localStorage,
		sessionStorage: window.sessionStorage,
		matchMedia: (query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener() {},
			removeListener() {},
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent: () => false,
		}),
		requestAnimationFrame: (cb) => window.setTimeout(() => cb(0), 0),
		cancelAnimationFrame: (h) => window.clearTimeout(h),
	};
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	window.matchMedia = shims.matchMedia;
	return {
		window,
		restore() {
			window.close();
			for (const [key, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	};
}

const PARAGRAPHS = Array.from({ length: 24 }, (_, i) =>
	i % 6 === 3
		? `- item ${i} with \`code\`\n- second **bold** item`
		: `Paragraph ${i} names \`InfoList${i}\` and **bold ${i}** with *italic* and some more prose to wrap.`,
);
const DOC = PARAGRAPHS.join("\n\n");

test("a settled block renders once; only the open block re-renders while the tail grows", async () => {
	const dom = mountDom();
	try {
		const container = dom.window.document.getElementById("root");
		const root = createRoot(container);
		const commits = [];
		const onRender = (_id, _phase, actualDuration) =>
			commits.push(actualDuration);
		streamingRenderStats.settled = 0;
		streamingRenderStats.tail = 0;
		let flushes = 0;
		for (let n = 4; n <= DOC.length + 3; n += 4) {
			const content = DOC.slice(0, Math.min(n, DOC.length));
			const before = streamingRenderStats.settled;
			await act(async () => {
				root.render(
					createElement(
						React.Profiler,
						{ id: "s", onRender },
						createElement(StreamingMarkdown, { content }),
					),
				);
			});
			flushes += 1;
			// A flush closes at most the one or two blocks that completed in it, and
			// renders each exactly once; more is a settled block re-rendered by an
			// unrelated flush.
			assert.ok(
				streamingRenderStats.settled - before <= 2,
				`@${content.length}: a closed block re-rendered while the tail grew`,
			);
		}
		assert.equal(
			streamingRenderStats.settled,
			23,
			"23 closed blocks, each rendered exactly once; the 24th is still the open block",
		);
		const total = commits.reduce((a, b) => a + b, 0);
		console.info(
			`[live-markdown] ${DOC.length} chars / ${flushes} flushes: settled renders ${streamingRenderStats.settled} (23 closed blocks), tail renders ${streamingRenderStats.tail}; commit mean ${(total / commits.length).toFixed(2)} ms, worst ${Math.max(...commits).toFixed(1)} ms, total ${total.toFixed(0)} ms (frame budget 16.7 ms)`,
		);
		await act(async () => root.unmount());
	} finally {
		dom.restore();
	}
});
