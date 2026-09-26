#!/usr/bin/env node
/**
 * Streaming-render cost, measured rather than felt.
 *
 *     node scripts/streaming-render-budget.mjs [full|incremental] [chunkChars] [repeats]
 *
 * WHY THIS RIG EXISTS. The operator reported v0.31.0's streaming text as
 * "choppy". Choppiness has a cause and a number, and the two candidate fixes —
 * batching state updates versus throttling the markdown parse — have very
 * different costs, so before anything changed the question was measured here:
 * the transcript's streaming row re-rendered the WHOLE message through
 * `MarkdownRenderer` on every flush, and react-markdown 10.1.0 re-processes the
 * document per render (there is no memo to miss — `markdown-renderer.tsx`'s own
 * comment records that measurement), so the per-flush cost was O(message).
 *
 * THE METRIC, and why this one. For one realistic assistant message streamed as
 * N deltas — one flush per delta, which is what `use-canonical-session` does per
 * animation frame — this rig reports, across every commit while the stream runs:
 *
 *   - `totalMs`  — summed Profiler `actualDuration`: the main-thread React work
 *                  the flushes pay in total;
 *   - `worstMs`  — the largest single commit, the spike that eats a frame;
 *   - `commits`  — the number of commits;
 *   - `meanMsPerFlush` — `totalMs / commits`, which is what a frame budget
 *                  (16.7 ms) is spent against.
 *
 * READINGS TAKEN WITH THIS RIG (this machine, node 26, jsdom, one flush per
 * 4-char delta; two runs per cell, the fleet was busy so treat them as a band):
 *
 *   full (shipped: whole-message re-parse per flush)
 *     3,012 chars / 753 flushes:  total 3,236-3,581 ms  mean 4.29-4.75 ms  worst 70-116 ms
 *     6,024 chars / 1,506 flushes: total 10,660-12,168 ms  mean 7.07-8.07 ms  worst 45-184 ms
 *   incremental (closed blocks memoised, open block painted as text)
 *     3,012 chars / 753 flushes:  total 259-468 ms  mean 0.34-0.62 ms  worst 14-137 ms
 *     6,024 chars / 1,506 flushes: total 311-380 ms  mean 0.21-0.25 ms  worst 16-25 ms
 *
 * WHAT THE NUMBERS SAY: the shipped path's per-flush cost GROWS with the message
 * (mean 4.3 -> 7.1 ms as 3 KB -> 6 KB, spikes past the frame budget), while the
 * incremental path's does not — it is proportional to what arrived. That is
 * `markdown-blocks.ts`'s stated property, now measured on the canonical row's
 * own components.
 *
 * WHAT THIS RIG CANNOT SEE, stated so the number is not asked to carry it:
 * jsdom has no layout engine, no paint and no compositor, so this is main-thread
 * CPU per flush and NOTHING about frame pacing. A frame pair cannot show
 * smoothness either; the closest honest reading of the feel is this budget
 * against the 16.7 ms frame, and the rest is the operator's eyes.
 *
 * ISOLATION. jsdom in this process; no app, no fork, no Electron, no session,
 * no path read from disk. The bundle is cached under `node_modules/.cache/`,
 * which is the convention the jsdom suites here use.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(ROOT, "package.json"));
const { JSDOM } = require("jsdom");

/*
 * React DOM feature-detects `document` at import time, so the scratch document
 * has to exist on the globals before any react-dom module is loaded.
 */
const bootstrap = new JSDOM('<!doctype html><div id="root"></div>', {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.HTMLElement = bootstrap.window.HTMLElement;
globalThis.Element = bootstrap.window.Element;
globalThis.Node = bootstrap.window.Node;
globalThis.NodeFilter = bootstrap.window.NodeFilter;
globalThis.MutationObserver = bootstrap.window.MutationObserver;
globalThis.Event = bootstrap.window.Event;
globalThis.CustomEvent = bootstrap.window.CustomEvent;
globalThis.getComputedStyle = bootstrap.window.getComputedStyle.bind(
	bootstrap.window,
);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) =>
	bootstrap.window.setTimeout(() => callback(0), 0);
globalThis.cancelAnimationFrame = (handle) =>
	bootstrap.window.clearTimeout(handle);
globalThis.matchMedia = (query) => ({
	matches: false,
	media: query,
	onchange: null,
	addListener() {},
	removeListener() {},
	addEventListener() {},
	removeEventListener() {},
	dispatchEvent: () => false,
});
bootstrap.window.matchMedia = globalThis.matchMedia;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
bootstrap.window.ResizeObserver = globalThis.ResizeObserver;
/*
 * The bundle drags in one app module that measures a console cell at import
 * time by drawing to a canvas; jsdom has no canvas package and raises "not
 * implemented" for it. Harmless to the components under measurement, silenced
 * so the readings are not buried in noise.
 */
bootstrap.window.HTMLCanvasElement.prototype.getContext = () => null;

const { build } = require("esbuild");
const React = require("react");
const { act, Profiler } = React;
const createElement = React.createElement;
const { createRoot } = require("react-dom/client");

const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = resolve(
	ROOT,
	"node_modules",
	".cache",
	"streaming-render-budget",
);
mkdirSync(CACHE, { recursive: true });
const bundle = await build({
	stdin: {
		contents: `
			export { MarkdownRenderer, StreamingMarkdown } from "./src/renderer/src/features/chat/components/markdown-renderer";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	// Vite's `import.meta.env` is read by config modules at import time. The URL
	// is dead on purpose: nothing here should reach a service.
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
const bundlePath = resolve(CACHE, "streaming-render-budget.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { MarkdownRenderer, StreamingMarkdown } = await import(
	pathToFileURL(bundlePath).href
);

/**
 * One realistic assistant message, the constructs agent output actually carries:
 * paragraphs with inline emphasis and code, a link and a bare path, nested and
 * loose lists, a fenced code block, a table, and a closing paragraph.
 */
const BASE = `Here is the summary you asked for, with the pieces that matter.

The parser now keeps the tail stable across flushes. A path like /tmp/report.txt
and a link to [the docs](https://example.com/docs) render once their block closes,
while **bold text** and \`inline code\` in the open block arrive as source.

- First item, with **emphasis** and \`code\`
- Second item, wrapping onto
  a continuation line
  - Nested child one
  - Nested child two
- Third item

\`\`\`ts
export function example(input: string): number {
\tconst trimmed = input.trim();
\tconst hasValue = trimmed.length > 0;
\treturn hasValue ? trimmed.length : 0;
}
\`\`\`

Some prose between the fences, so the reader sees a paragraph settle.

| column A | column B |
| --- | --- |
| one | two |
| three | four |

A closing paragraph that discusses the **result**: the incremental path must
end in the same text as the full parse, including inline math like $x + y$,
plus a final sentence that trails off into the end of the message.`;

const variant = process.argv[2] ?? "full";
const CHUNK = Number(process.argv[3] ?? 4);
const REPEATS = Number(process.argv[4] ?? 3);
const MESSAGE = BASE.repeat(REPEATS);

/*
 * The two shapes under measurement. `full` is the shipped row's rendering:
 * every changed flush re-parses the whole message. `incremental` is what the
 * row renders now: the memoised closed blocks plus the open block as text.
 */
const Row = ({ content, streaming }) => {
	const styleProps = { fontSize: "var(--text-body)", lineHeight: 1.6 };
	return streaming && variant === "incremental"
		? createElement(StreamingMarkdown, { content, styleProps })
		: createElement(MarkdownRenderer, {
				content,
				linkify: !streaming,
				styleProps,
			});
};

const container = bootstrap.window.document.getElementById("root");
const root = createRoot(container);

const stats = { total: 0, worst: 0, commits: 0 };
const onRender = (_id, _phase, actualDuration) => {
	stats.commits += 1;
	stats.total += actualDuration;
	if (actualDuration > stats.worst) stats.worst = actualDuration;
};

const deltas = [];
for (let i = 0; i < MESSAGE.length; i += CHUNK) {
	deltas.push(MESSAGE.slice(0, Math.min(i + CHUNK, MESSAGE.length)));
}

const render = (content, streaming) =>
	createElement(
		Profiler,
		{ id: "row", onRender },
		createElement(Row, { content, streaming }),
	);

// A warm mount, so the first parse is not counted as a stream frame.
await act(async () => {
	root.render(render(deltas[0], true));
});
stats.total = 0;
stats.worst = 0;
stats.commits = 0;

const startedAt = performance.now();
for (let i = 1; i < deltas.length; i++) {
	await act(async () => {
		root.render(render(deltas[i], true));
	});
}
const wallMs = performance.now() - startedAt;

// The row's settle: the whole message through the full renderer.
await act(async () => {
	root.render(render(MESSAGE, false));
});

console.log(
	JSON.stringify(
		{
			variant,
			chunk: CHUNK,
			repeats: REPEATS,
			deltas: deltas.length,
			chars: MESSAGE.length,
			totalMs: Number(stats.total.toFixed(1)),
			worstMs: Number(stats.worst.toFixed(1)),
			commits: stats.commits,
			wallMs: Number(wallMs.toFixed(1)),
			meanMsPerFlush: Number(
				(stats.total / Math.max(1, stats.commits)).toFixed(2),
			),
		},
		null,
		2,
	),
);
process.exit(0);
