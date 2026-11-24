/**
 * Transcript markdown decides its direction PER BLOCK (i18n census N2).
 *
 *     node --test scripts/markdown-block-direction.test.mjs
 *
 * THE OPERATOR-VISIBLE DEFECT. Under ur the document is `dir="rtl"`, and the
 * transcript body inherited it, so an English reply painted
 * "!Hello from the mock provider". The fix gives every paragraph, heading,
 * list, list item, quote, table and cell an explicit `dir` computed from its
 * own first strong character (so a mixed Urdu + English reply reads correctly
 * block by block), leaves a block with no letter without one (it inherits its
 * container), and pins code and KaTeX LTR, open fences included
 * (`utils/rehype-block-direction.ts`, `OpenFenceBody`). Round 1 moved this
 * from `dir="auto"`, which let a container skip every child that carried its
 * own `dir` and so lay an Urdu list/table/quote out LTR (design D1).
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

/*
 * The SAME shape in each script (design review round 1, D1): a list with a
 * code-only and a number-only item, a quote, a table. On 892c768 every
 * container carried `dir="auto"` while every child carried its own `dir`, and
 * the HTML auto algorithm skips such children, so the Urdu list/table/quote
 * found no strong character and resolved LTR (columns reversed, quote rule on
 * the wrong side). The containers must now carry the reply's direction
 * explicitly, and the letterless items must carry none (they inherit it).
 */
const replyIn = ({ intro, items, quote, head, cell }) =>
	[
		intro,
		"",
		`- ${items[0]}`,
		"- `npm install`",
		"- 42",
		`- ${items[1]}`,
		"",
		`> ${quote}`,
		"",
		`| ${head[0]} | ${head[1]} |`,
		"| --- | --- |",
		`| ${cell[0]} | 7 |`,
	].join("\n");
const URDU = replyIn({
	intro: "یہ جواب اردو میں ہے۔",
	items: ["پہلا نکتہ", "دوسرا نکتہ"],
	quote: "یہ ایک اقتباس ہے۔",
	head: ["نام", "قدر"],
	cell: ["الف"],
});
const ENGLISH_REPLY = replyIn({
	intro: "This reply is in English.",
	items: ["first point", "second point"],
	quote: "This is a quote.",
	head: ["Name", "Value"],
	cell: ["alpha"],
});

/** `dir` of the first `selector` whose text is exactly `text` (or the first match). */
const dirOf = (body, selector, text) => {
	const element = [...body.querySelectorAll(selector)].find(
		(candidate) => text === undefined || candidate.textContent.trim() === text,
	);
	assert.ok(element, `rendered <${selector}> "${text ?? ""}"`);
	return element.getAttribute("dir");
};

const bodyOf = (container, label) => {
	const body = container.querySelector(".lo-markdown");
	assert.ok(body, `${label}: rendered a .lo-markdown body`);
	assert.equal(
		body.getAttribute("dir"),
		null,
		`${label}: the ROOT must not decide for every block`,
	);
	return body;
};

const assertCodeLtr = (body, label) => {
	for (const pre of body.querySelectorAll("pre"))
		assert.equal(pre.getAttribute("dir"), "ltr", `${label}: <pre> stays LTR`);
	for (const code of body.querySelectorAll("code"))
		assert.equal(code.getAttribute("dir"), "ltr", `${label}: code stays LTR`);
};

/** Every block of MIXED resolves from its OWN first strong character. */
const assertBlockDirections = (container, label) => {
	const body = bodyOf(container, label);
	const expected = [
		["p", ENGLISH, "ltr"],
		["p", "یہ اردو کا پیراگراف ہے۔", "rtl"],
		["h2", "Heading", "ltr"],
		// The list resolves from its first strong character ("first item"),
		// and each item keeps its own.
		["ul", undefined, "ltr"],
		["li", "first item", "ltr"],
		["li", "دوسرا آئٹم", "rtl"],
		["blockquote", undefined, "ltr"],
		["table", undefined, "ltr"],
		["th", "Name", "ltr"],
		["th", "قدر", "rtl"],
		["td", "alpha", "ltr"],
		["td", "ایک", "rtl"],
		["p", "Run ls -la now.", "ltr"],
	];
	for (const [selector, text, dir] of expected)
		assert.equal(
			dirOf(body, selector, text),
			dir,
			`${label}: <${selector}> "${text ?? ""}" resolves ${dir}`,
		);
	assertCodeLtr(body, label);
};

test("an English reply under ur: every block resolves its own direction, code stays ltr (settled renderer)", async () => {
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
		assert.equal(open?.getAttribute("dir"), "ltr", "the open tail block");
		await view.rerender(h(StreamingMarkdown, { content: MIXED }));
		assertBlockDirections(view.container, "StreamingMarkdown");
		// The first paragraph is the same node it was before the append: the
		// attribute is a property of the parse, not a reason to remount.
		assert.equal(view.container.querySelector(".lo-markdown p"), open);
	} finally {
		await view.unmount();
	}
});

for (const [name, Component] of [
	["MarkdownRenderer", MarkdownRenderer],
	["StreamingMarkdown", StreamingMarkdown],
])
	test(`${name}: an Urdu reply's list, table and quote resolve RTL; an English one LTR; letterless items inherit (D1)`, async () => {
		for (const [label, content, dir, texts] of [
			["urdu", URDU, "rtl", ["پہلا نکتہ", "یہ ایک اقتباس ہے۔", "نام"]],
			[
				"english",
				ENGLISH_REPLY,
				"ltr",
				["first point", "This is a quote.", "Name"],
			],
		]) {
			const view = await mount(h(Component, { content }));
			try {
				const body = bodyOf(view.container, `${name}/${label}`);
				for (const container of ["ul", "blockquote", "table"])
					assert.equal(
						dirOf(body, container),
						dir,
						`${name}/${label}: <${container}> carries the reply's direction explicitly`,
					);
				assert.equal(dirOf(body, "li", texts[0]), dir);
				assert.equal(dirOf(body, "blockquote p", texts[1]), dir);
				assert.equal(dirOf(body, "th", texts[2]), dir);
				// No strong character: NO dir, so the item inherits the list's
				// direction instead of defaulting to ltr (a bullet on each side).
				for (const letterless of ["npm install", "42"])
					assert.equal(
						dirOf(body, "li", letterless),
						null,
						`${name}/${label}: "${letterless}" inherits the list`,
					);
				assert.equal(dirOf(body, "td", "7"), null);
				assertCodeLtr(body, `${name}/${label}`);
			} finally {
				await view.unmount();
			}
		}
	});

test("a fence still streaming is pinned LTR like a closed one (R1-2)", async () => {
	const view = await mount(
		h(StreamingMarkdown, { content: "Intro.\n\n```sh\necho hi" }),
	);
	try {
		const body = bodyOf(view.container, "open fence");
		const pre = body.querySelector("pre");
		assert.ok(pre, "the open fence paints a <pre>");
		assert.equal(pre.getAttribute("dir"), "ltr", "open <pre> stays LTR");
		assert.equal(
			pre.querySelector("code")?.getAttribute("dir"),
			"ltr",
			"open <code> stays LTR",
		);
		await view.rerender(
			h(StreamingMarkdown, { content: "Intro.\n\n```sh\necho hi\n```" }),
		);
		assertCodeLtr(bodyOf(view.container, "closed fence"), "closed fence");
	} finally {
		await view.unmount();
	}
});

test("inline math at the start of an Urdu paragraph does not turn it LTR (Q-1)", async () => {
	const view = await mount(
		h(MarkdownRenderer, { content: "$x^2$ یہ اردو کا جملہ ہے۔" }),
	);
	try {
		// The KaTeX stylesheet loads asynchronously before math is enabled.
		for (let tick = 0; tick < 50; tick += 1) {
			if (view.container.querySelector(".katex")) break;
			await act(() => new Promise((done) => setTimeout(done, 20)));
		}
		const body = bodyOf(view.container, "math");
		const katex = body.querySelector(".katex");
		assert.ok(katex, "the math pipeline rendered KaTeX");
		assert.equal(
			katex.getAttribute("dir"),
			"ltr",
			"KaTeX output is pinned LTR",
		);
		assert.equal(
			body.querySelector("p").getAttribute("dir"),
			"rtl",
			"the paragraph resolves from its Urdu text, not the formula",
		);
	} finally {
		await view.unmount();
	}
});
