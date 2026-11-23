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
						createElement(StreamingMarkdown, { content, animateInk: true }),
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

async function withLiveRenderer(probe) {
	const dom = mountDom();
	const container = dom.window.document.getElementById("root");
	const root = createRoot(container);
	const paint = (content, props = {}) =>
		act(async () =>
			root.render(
				createElement(StreamingMarkdown, {
					content,
					animateInk: true,
					...props,
				}),
			),
		);
	try {
		await probe({ container, document: dom.window.document, paint });
	} finally {
		await act(async () => root.unmount());
		dom.restore();
	}
}

test("seed, correction and remount are static; a live suffix keeps earlier selection and markup", () =>
	withLiveRenderer(async ({ container, document, paint }) => {
		const seed = "Already visible";
		await paint(seed);
		const paragraph = container.querySelector("p");
		const node = paragraph.firstChild;
		assert.equal(container.querySelector(".lo-stream-ink"), null);
		const selection = document.getSelection();
		selection.setBaseAndExtent(node, 0, node, 7);
		await paint(`${seed} new **bold**`);
		assert.equal(selection.toString(), "Already");
		assert.equal(paragraph.firstChild, node);
		assert.equal(container.querySelector("strong").textContent, "bold");
		assert.deepEqual(
			Array.from(
				container.querySelectorAll(".lo-stream-ink"),
				(span) => span.textContent,
			),
			[" new ", "bold"],
		);
		const original = paragraph.querySelector(".lo-stream-ink");
		await paint(`${seed} new **bold** and \`code\``);
		assert.equal(original, paragraph.querySelector(".lo-stream-ink"));
		assert.equal(container.querySelector("code").textContent, "code");
		assert.equal(container.querySelector("code .lo-stream-ink"), null);
		assert.equal(selection.toString(), "Already");
		await paint("Authoritative correction, no fade");
		assert.equal(container.querySelector(".lo-stream-ink"), null);
		await paint("Authoritative correction, no fade", { key: "remounted" });
		assert.equal(container.querySelector(".lo-stream-ink"), null);
	}));

test("a genuinely new stream fades once; a split Arabic word or emoji stays in one text leaf", () =>
	withLiveRenderer(async ({ container, paint }) => {
		const first = "مرح";
		await paint(first, { revealOnMount: true });
		const ink = container.querySelector(".lo-stream-ink");
		assert.ok(ink);
		await paint("مرحبا 👩", { revealOnMount: true });
		const emoji = container.querySelectorAll(".lo-stream-ink")[1];
		assert.equal(container.querySelector(".lo-stream-ink"), ink);
		assert.equal(ink.textContent, "مرحبا");
		await paint("مرحبا 👩‍💻", { revealOnMount: true });
		assert.equal(container.querySelectorAll(".lo-stream-ink")[1], emoji);
		assert.equal(emoji.textContent, " 👩‍💻");
		await paint("مرحبا 👩‍💻 plus a new word", { animateInk: false });
		assert.equal(container.querySelector(".lo-stream-ink"), null);
	}));

test("unmodified selected ink survives a gap and a later paragraph correction", () =>
	withLiveRenderer(async ({ container, document, paint }) => {
		const selection = document.getSelection();
		const seed = "Read this new sentence.";
		await paint(seed, { revealOnMount: true });
		const first = container.querySelector(".lo-stream-ink");
		const node = first.firstChild;
		selection.setBaseAndExtent(node, 0, node, 4);
		await paint(seed, { animateInk: false });
		assert.equal(selection.toString(), "Read");
		assert.ok(selection.anchorNode === node, "gap preserves the exact anchor");

		// A catch-up chunk cannot inherit even a still-running old animation.
		await paint(`${seed} Catch-up.`, { animateInk: false });
		assert.ok(
			container.querySelector("p > span") === first,
			"catch-up keeps the span",
		);
		assert.equal(container.querySelector(".lo-stream-ink"), null);
		await paint(`${seed} Catch-up.`);
		await paint(`${seed} Catch-up. **new** complete prose.\n\nTail draft.\n`);
		const selected = container.querySelector(
			"strong .lo-stream-ink",
		).firstChild;
		selection.setBaseAndExtent(selected, 0, selected, 3);
		const link = "[doc](https://example.invalid)";
		const corrected = `${seed} Catch-up. **new** complete prose.\n\nTail ${link}.`;
		await paint(corrected);
		assert.equal(selection.toString(), "new");
		assert.ok(
			selection.anchorNode === selected,
			"correction preserves the exact anchor",
		);
		assert.equal(
			container.querySelector("p:nth-child(2)").textContent,
			"Tail doc.",
		);
		assert.equal(container.querySelector("p:nth-child(2) a"), null);
		await paint(`${corrected}\n\nFollowing paragraph.\n`);
		assert.equal(
			container.querySelector("p:nth-child(2) a").href,
			"https://example.invalid/",
		);
		assert.ok(
			selection.anchorNode === selected,
			"correction preserves the exact anchor",
		);
	}));

test("an open-block correction keeps the exact selected formatted leaf without replay", (t) =>
	withLiveRenderer(async ({ container, document, paint }) => {
		let tick = 0;
		t.mock.method(performance, "now", () => tick);
		const inks = () =>
			Array.from(
				container.querySelectorAll(".lo-stream-ink"),
				(node) => node.textContent,
			);
		await paint("Select");
		await paint("Select **Read** the tail draft.");
		const strong = container.querySelector("strong");
		const span = strong.querySelector(".lo-stream-ink");
		const node = span.firstChild;
		const selection = document.getSelection();
		selection.setBaseAndExtent(node, 0, node, 4);
		const checkSelection = () => {
			const range = selection.getRangeAt(0);
			assert.equal(selection.toString(), "Read");
			assert.ok(range.startContainer === node && range.endContainer === node);
			assert.deepEqual([range.startOffset, range.endOffset], [0, 4]);
			assert.ok(container.querySelector("strong") === strong);
			assert.ok(strong.firstChild === span && span.firstChild === node);
		};
		let corrected = "";
		for (const [source, text] of [
			[
				"Select **Read** the corrected tail.",
				"Select Read the corrected tail.",
			],
			[
				"Select **Read** the [doc](https://example.invalid).",
				"Select Read the doc.",
			],
		]) {
			tick += 20; // Rewrite while the original clock would still be active.
			await paint(source);
			checkSelection();
			assert.deepEqual(inks(), []);
			assert.deepEqual(
				Array.from(
					container.querySelectorAll("p > span"),
					(leaf) => leaf.textContent,
				),
				[" "],
				"the rewritten leaf must not inherit a stale wrapper",
			);
			assert.equal(container.textContent, text);
			assert.equal(container.querySelector("a"), null, "open links stay inert");
			corrected = source;
		}
		tick += 500;
		await paint(`${corrected} Fresh words.`);
		checkSelection();
		assert.deepEqual(inks(), [" Fresh words."]);
		assert.equal(container.textContent, "Select Read the doc. Fresh words.");
	}));

test("Japanese chunks ink just the new text; Latin and combining sequences stay joined", (t) =>
	withLiveRenderer(async ({ container, paint }) => {
		let tick = 0;
		t.mock.method(performance, "now", () => tick);
		let source = "";
		const pieces = [
			"これは",
			"テストです。",
			"次の文が出ます。",
			"さらに続きます。",
		];
		for (const piece of pieces) {
			tick += 500;
			source += piece;
			await paint(source, { revealOnMount: true });
			assert.deepEqual(
				Array.from(
					container.querySelectorAll(".lo-stream-ink"),
					(node) => node.textContent,
				),
				[piece],
			);
			assert.equal(container.textContent, source);
		}
		for (const [prefix, suffix] of [
			["ユーザー", "名"],
			["テスト", "ー"],
			["テストー", "です"],
			["ﾃｽﾄ", "ｰ"],
			["これは", "一例"],
		]) {
			const key = prefix;
			tick += 500;
			await paint(prefix, { key, revealOnMount: true });
			tick += 500;
			await paint(prefix + suffix, { key });
			assert.deepEqual(
				Array.from(
					container.querySelectorAll(".lo-stream-ink"),
					(node) => node.textContent,
				),
				[suffix],
				`${prefix} + ${suffix}`,
			);
			assert.equal(container.textContent, prefix + suffix);
		}
		await paint("of", { key: "ligature", revealOnMount: true });
		const word = container.querySelector(".lo-stream-ink");
		await paint("office cafe", { key: "ligature" });
		assert.equal(word.textContent, "office");
		const cafe = word.nextSibling;
		await paint("office cafe\u0301 👩", { key: "ligature" });
		assert.equal(cafe.textContent, " cafe\u0301");
		const emoji = cafe.nextSibling;
		await paint("office cafe\u0301 👩🏽‍💻", { key: "ligature" });
		assert.equal(emoji.textContent, " 👩🏽‍💻");
		assert.equal(container.textContent, "office cafe\u0301 👩🏽‍💻");
	}));

test("compaction keeps a local selected batch and its boundary, not unrelated wrappers", (t) =>
	withLiveRenderer(async ({ container, document, paint }) => {
		let tick = 0;
		t.mock.method(performance, "now", () => tick);
		const outside = document.body.appendChild(document.createElement("p"));
		outside.textContent = "Outside the transcript";
		const selection = document.getSelection();
		for (const where of ["outside", "caret", "range", "drag"]) {
			let source = "Stable seed.";
			const props = { key: where };
			await paint(source, props);
			const stable = container.querySelector("p").firstChild;
			source += " selection";
			await paint(source, props);
			const inked = container.querySelector(".lo-stream-ink").firstChild;
			const node =
				where === "outside"
					? outside.firstChild
					: where === "range"
						? inked
						: stable;
			const end = where === "caret" || where === "drag" ? 0 : 7;
			selection.setBaseAndExtent(node, 0, node, end);
			const win = document.defaultView;
			const dispatch = (target, type) => {
				const event = new win.MouseEvent(type, { bubbles: true, button: 0 });
				Object.defineProperties(event, {
					isPrimary: { value: true },
					pointerId: { value: 1 },
				});
				target.dispatchEvent(event);
			};
			if (where === "drag")
				dispatch(container.querySelector("p"), "pointerdown");
			for (let i = 0; i < 105; i++) {
				if (where === "drag" && i === 5) {
					assert.equal(container.querySelectorAll(".lo-stream-ink").length, 6);
					dispatch(outside, "pointerup");
				}
				tick += 150;
				source += ` batch${i}`;
				await paint(source, props);
				if (where === "drag" && i < 5) continue;
				const max = where === "outside" ? 1 : where === "range" ? 3 : 2;
				assert.ok(
					container.querySelectorAll(".lo-stream-ink").length <= max,
					where,
				);
			}
			assert.equal(container.textContent, source);
			assert.ok(selection.anchorNode === node, where);
			assert.equal(selection.toString(), node.textContent.slice(0, end), where);
		}
	}));

test("descendant blur keeps the local drag hold; window blur releases it", (t) =>
	withLiveRenderer(async ({ container, document, paint }) => {
		const win = document.defaultView;
		let tick = 0;
		t.mock.method(performance, "now", () => tick);
		let source = "Stable seed.";
		await paint(source, { revealOnMount: true });
		const button = document.body.appendChild(document.createElement("button"));
		button.focus();
		const down = new win.MouseEvent("pointerdown", {
			bubbles: true,
			button: 0,
		});
		Object.defineProperties(down, {
			isPrimary: { value: true },
			pointerId: { value: 1 },
		});
		container.querySelector("p").dispatchEvent(down);
		button.blur();
		const inkCount = () => container.querySelectorAll(".lo-stream-ink").length;
		tick += 500;
		source += " First append.";
		await paint(source);
		assert.equal(inkCount(), 2, "descendant blur must not compact during drag");
		win.dispatchEvent(new win.FocusEvent("blur"));
		tick += 500;
		source += " Second append.";
		await paint(source);
		assert.equal(inkCount(), 1, "window blur releases the hold");
		assert.equal(container.textContent, source);
	}));

test("growing a direct fence updates its literal, not the Markdown lead", () =>
	withLiveRenderer(async ({ container, paint }) => {
		let source = "Stable **lead** before the code.\n```ts\nconst initial = 1;";
		await paint(source);
		const before = streamingRenderStats.markdown;
		const lead = container.querySelector("p");
		for (let i = 0; i < 30; i++) {
			source += `\nconst item${i} = ${i};`;
			await paint(source);
		}
		assert.equal(streamingRenderStats.markdown, before);
		assert.equal(container.querySelector("p"), lead);
		assert.ok(
			container
				.querySelector("pre code")
				.textContent.includes("const item29 = 29;"),
		);
	}));
