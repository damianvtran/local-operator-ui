/**
 * Transcript markdown decides its direction PER BLOCK (i18n census N2).
 *
 *     node --test scripts/markdown-block-direction.test.mjs
 *
 * THE OPERATOR-VISIBLE DEFECT. Under ur the document is `dir="rtl"`, and the
 * transcript body inherited it, so an English reply painted
 * "!Hello from the mock provider". The fix gives every paragraph, heading,
 * list, list item, quote, table and cell its own `dir="auto"` (each resolves
 * from its own first strong character, so a mixed Urdu + English reply reads
 * correctly block by block) and pins code LTR
 * (`utils/rehype-block-direction.ts`).
 *
 * WHAT THIS CAN AND CANNOT SEE. jsdom has no bidi engine: this pins the
 * MARKUP (which elements carry which `dir`) on both renderers - the settled
 * `MarkdownRenderer` and the streaming `StreamingMarkdown`, mid-stream and
 * settled - under a document whose `<html dir="rtl">` matches ur. The painted
 * glyph order is rendered-app evidence.
 *
 * ISOLATION. jsdom in this process, synthetic strings, no app or session.
 */
import assert from "node:assert/strict";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const ROOT = resolve(import.meta.dirname, "..");

const dom = new JSDOM(
	'<!doctype html><html dir="rtl" lang="ur"><body><div id="root"></div></body></html>',
	{ url: "http://localhost/", pretendToBeVisual: true },
);
const { window } = dom;
const originals = new Map();
const shims = {
	window,
	document: window.document,
	navigator: window.navigator,
	HTMLElement: window.HTMLElement,
	Element: window.Element,
	Node: window.Node,
	NodeFilter: window.NodeFilter,
	MutationObserver: window.MutationObserver,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
	requestAnimationFrame: (cb) => window.setTimeout(() => cb(0), 0),
	cancelAnimationFrame: (handle) => window.clearTimeout(handle),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
// A module in the import graph measures a canvas at load; jsdom has none.
window.HTMLCanvasElement.prototype.getContext = () => null;

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");

const EXTERNAL = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;
const CACHE = resolve(
	ROOT,
	"node_modules",
	".cache",
	"markdown-block-direction",
);
mkdirSync(CACHE, { recursive: true });
const bundle = await build({
	stdin: {
		contents:
			'export { MarkdownRenderer, StreamingMarkdown } from "./src/renderer/src/features/chat/components/markdown-renderer";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "{}" },
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: /^[^./]/ }, (args) =>
					EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
				);
			},
		},
	],
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
	logLevel: "silent",
});
const bundlePath = resolve(
	CACHE,
	`markdown-block-direction-${process.pid}.mjs`,
);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { MarkdownRenderer, StreamingMarkdown } = await import(
	pathToFileURL(bundlePath).href
);
unlinkSync(bundlePath);

after(() => {
	window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
});

const mount = async (element) => {
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element);
	});
	return {
		container,
		rerender: (next) =>
			act(async () => {
				root.render(next);
			}),
		unmount: () =>
			act(async () => {
				root.unmount();
				container.remove();
			}),
	};
};

/** The reply the census caught, plus a mixed Urdu/English body. */
const ENGLISH = "Hello from the mock provider!";
const MIXED = [
	ENGLISH,
	"",
	"یہ اردو کا پیراگراف ہے۔",
	"",
	"## Heading",
	"",
	"- first item",
	"- دوسرا آئٹم",
	"",
	"> quoted line",
	"",
	"| Name | قدر |",
	"| --- | --- |",
	"| alpha | ایک |",
	"",
	"Run `ls -la` now.",
	"",
	"```sh",
	"echo hi",
	"```",
].join("\n");

const BLOCKS = "p, h2, ul, li, blockquote, table, th, td";

const assertBlockDirections = (container, label) => {
	const body = container.querySelector(".lo-markdown");
	assert.ok(body, `${label}: rendered a .lo-markdown body`);
	assert.equal(
		body.getAttribute("dir"),
		null,
		`${label}: the ROOT must not decide for every block`,
	);
	const blocks = [...body.querySelectorAll(BLOCKS)];
	const tags = new Set(blocks.map((element) => element.tagName.toLowerCase()));
	for (const tag of BLOCKS.split(", "))
		assert.ok(tags.has(tag), `${label}: corpus renders a <${tag}>`);
	for (const element of blocks)
		assert.equal(
			element.getAttribute("dir"),
			"auto",
			`${label}: <${element.tagName.toLowerCase()}> "${element.textContent.slice(0, 30)}" decides its own direction`,
		);
	const pre = body.querySelector("pre");
	assert.equal(
		pre?.getAttribute("dir"),
		"ltr",
		`${label}: a code block stays LTR`,
	);
	for (const code of body.querySelectorAll("code"))
		assert.equal(code.getAttribute("dir"), "ltr", `${label}: code stays LTR`);
	const first = body.querySelector("p");
	assert.equal(first.textContent, ENGLISH);
	assert.equal(first.getAttribute("dir"), "auto");
};

test("an English reply under ur: every block carries dir=auto, code stays ltr (settled renderer)", async () => {
	assert.equal(window.document.documentElement.getAttribute("dir"), "rtl");
	const view = await mount(h(MarkdownRenderer, { content: MIXED }));
	try {
		assertBlockDirections(view.container, "MarkdownRenderer");
	} finally {
		await view.unmount();
	}
});

test("the streaming renderer carries the same per-block dir mid-stream and settled", async () => {
	const view = await mount(h(StreamingMarkdown, { content: ENGLISH }));
	try {
		// Mid-stream: the single open paragraph already decides its own direction.
		const open = view.container.querySelector(".lo-markdown p");
		assert.equal(open?.getAttribute("dir"), "auto", "the open tail block");
		await view.rerender(h(StreamingMarkdown, { content: MIXED }));
		assertBlockDirections(view.container, "StreamingMarkdown");
		// The first paragraph is the same node it was before the append: the
		// attribute is a property of the parse, not a reason to remount.
		assert.equal(view.container.querySelector(".lo-markdown p"), open);
	} finally {
		await view.unmount();
	}
});
