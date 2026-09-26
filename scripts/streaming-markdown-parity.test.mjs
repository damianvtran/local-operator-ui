/**
 * The incremental streaming render, held to the full parse.
 *
 *     node --test scripts/streaming-markdown-parity.test.mjs
 *
 * WHY THIS FILE EXISTS. The transcript's streaming row now renders with
 * `StreamingMarkdown` and hands the settled message to `MarkdownRenderer`
 * (`canonical-transcript.tsx`), because the whole-message re-parse costs
 * O(message) per flush and that is what the operator reported as choppy
 * streaming. The change has one hazard, and it is not performance: an
 * incremental renderer that is almost right paints text that is correct while
 * streaming and DIFFERENT once the stream settles, which a reader sees as the
 * message changing under their eyes. So three properties are pinned here, on a
 * corpus of the constructs real agent output is made of — code fences (one of
 * which opens in one flush and closes several later), tables, nested and loose
 * lists, blockquotes, inline emphasis, inline code, links, inline math, and a
 * paragraph that is still open when the stream ends:
 *
 *   1. THE SPLIT LOSES NOTHING AND REORDERS NOTHING. At every flush, the
 *      scanner's closed blocks each appear in the source in order, with only
 *      blank runs between them, and the tail is exactly the remaining suffix.
 *      That is the partition invariant: every non-blank character of the source
 *      is in exactly one block or in the tail.
 *   2. ALREADY-PAINTED GROUPS NEVER CHANGE. Each closed block's source is
 *      byte-identical at every later flush — the premise the memoisation rests
 *      on. A block whose text could still change is a block the reader would
 *      watch change.
 *   3. THE SETTLED PAINT IS THE FULL PARSE. When the row stops streaming, its
 *      markup equals `MarkdownRenderer`'s render of the same string as a fresh
 *      element, byte for byte. This is the anti-jump rule: whatever the
 *      incremental path showed mid-flight, what a reader is left with is the
 *      same output the whole-message renderer has always produced.
 *
 * Plus two per-construct checks the corpus is chosen for: the in-flight TAIL is
 * exactly the source suffix (clipped only for trailing whitespace, the
 * documented `trimmedEndLength` rule), and every construct's payload text is
 * present in order in the painted DOM at every flush.
 *
 * WHAT THIS FILE CANNOT SEE. jsdom has no layout engine and no compositor, so
 * a green run here is not a frame and says nothing about frame pacing; it is
 * not visual evidence and does not claim to be. The perceived-smoothness
 * measurement is the jsdom Profiler harness reported on the pull request.
 *
 * ISOLATION. Nothing boots the app, a fork or Electron: jsdom in this process,
 * a synthetic document, no session and no path read from disk.
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

/* React DOM feature-detects the document at import time, so the document has to
 * exist before react-dom is loaded. */
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.sessionStorage = bootstrap.window.sessionStorage;
const { createRoot } = await import("react-dom/client");

/* React stays out of the bundle so the mounted tree shares THIS React instance. */
const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = resolve(
	ROOT,
	"node_modules",
	".cache",
	"streaming-markdown-parity",
);
mkdirSync(CACHE, { recursive: true });
const bundle = await build({
	stdin: {
		contents: `
			export { MarkdownRenderer, StreamingMarkdown } from "./src/renderer/src/features/chat/components/markdown-renderer";
			export { createBlockScanner, scanMarkdownBlocks, trimmedEndLength } from "./src/renderer/src/features/chat/utils/markdown-blocks";
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
			export { applyEvent, applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
		`,
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
const bundlePath = resolve(CACHE, "streaming-markdown-parity.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	MarkdownRenderer,
	StreamingMarkdown,
	createBlockScanner,
	scanMarkdownBlocks,
	trimmedEndLength,
	CanonicalTranscript,
	applyEvent,
	applyHistoryPage,
	EMPTY_TRANSCRIPT,
} = await import(pathToFileURL(bundlePath).href);

const createElement = React.createElement;

/* ------------------------------------------------------------- the document */

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

/* ----------------------------------------------------------------- the corpus */

/**
 * Every construct the guard exists for, and why each is here:
 *
 * - `fences` opens a fenced block in one flush and closes it several later,
 *   with a second fence after it — the split hazard the scanner's lookahead
 *   exists for.
 * - `lists` carries a loose list (blank line between items) and a nested list.
 * - `table`, `quote` and `math` are the block constructs whose parse depends on
 *   context.
 * - `links` carries inline links, an autolink and a path-shaped token.
 * - `refs` carries a link-reference definition AFTER the paragraph that uses
 *   it — the scanner's own documented limitation, whose settle is what this
 *   test holds it to.
 * - `open-tail` ends mid-paragraph, so the last block is still open when the
 *   stream stops: the tail-clipping rule and the handover both get exercised on
 *   it.
 */
const CORPUS = [
	{
		name: "fences",
		payload: ["const trimmed", "return hasValue", "second fence"],
		text: [
			"Here is the helper.",
			"",
			"```ts",
			"export function example(input: string): number {",
			"\tconst trimmed = input.trim();",
			"\tconst hasValue = trimmed.length > 0;",
			"\treturn hasValue ? trimmed.length : 0;",
			"}",
			"```",
			"",
			"And the second fence:",
			"",
			"~~~",
			"plain text",
			"still the second fence",
			"~~~",
			"",
			"Done.",
		].join("\n"),
	},
	{
		name: "lists",
		payload: ["First item", "Second item", "Nested child", "Fourth item"],
		text: [
			"- First item, with **emphasis** and `code`",
			"",
			"- Second item, wrapping onto",
			"  a continuation line",
			"  - Nested child one",
			"  - Nested child two",
			"",
			"- Fourth item",
			"",
			"1. ordered one",
			"2. ordered two",
		].join("\n"),
	},
	{
		name: "table",
		payload: ["column A", "column B", "one", "three", "four"],
		text: [
			"| column A | column B |",
			"| --- | --- |",
			"| one | two |",
			"| three | four |",
		].join("\n"),
	},
	{
		name: "quote",
		payload: ["quoted sentence", "inner item"],
		text: [
			"> A quoted sentence that wraps onto a second line,",
			">",
			"> - inner item",
		].join("\n"),
	},
	{
		name: "math",
		payload: ["x + y", "a^2 + b^2"],
		text: [
			"Inline math like $x + y$ in a sentence.",
			"",
			"$$",
			"a^2 + b^2",
			"$$",
		].join("\n"),
	},
	{
		name: "links",
		payload: ["the docs", "example.com"],
		text: [
			"A link to [the docs](https://example.com/docs) and an autolink",
			"https://example.com/plain plus a path-shaped token /tmp/report.txt.",
		].join("\n"),
	},
	{
		name: "refs",
		payload: ["the guide"],
		text: [
			"Read [the guide][g] before starting.",
			"",
			"[g]: https://example.com/guide",
		].join("\n"),
	},
	{
		name: "open-tail",
		payload: ["trails off", "still being written"],
		text: [
			"A settled paragraph with **bold**.",
			"",
			"The final paragraph trails off while still being written",
		].join("\n"),
	},
];

/**
 * Prefixes to feed, for a flush size. The last prefix is the whole text, so the
 * settle case is always exercised.
 */
function prefixes(text, size) {
	const out = [];
	for (let i = 1; i <= text.length; i += size) {
		out.push(text.slice(0, Math.min(i, text.length)));
	}
	if (out[out.length - 1] !== text) out.push(text);
	return out;
}

/* ------------------------------------------------- 1-2. the split invariants */

test("the split loses nothing, reorders nothing, and settles blocks for good", () => {
	for (const item of CORPUS) {
		for (const size of [1, 2, 3, 5, 8, 13]) {
			const scanner = createBlockScanner();
			let previousBlocks = [];
			for (const prefix of prefixes(item.text, size)) {
				scanMarkdownBlocks(scanner, prefix);
				const where = `${item.name} @${prefix.length}`;
				// Append-only: every block seen at an earlier flush is still there,
				// byte for byte, at this one. A block whose text can still change is
				// a block the reader would watch change.
				assert.ok(
					scanner.blocks.length >= previousBlocks.length,
					`${where}: blocks shrank`,
				);
				for (let i = 0; i < previousBlocks.length; i++) {
					assert.equal(
						scanner.blocks[i],
						previousBlocks[i],
						`${where}: closed block ${i} changed after closing`,
					);
				}
				// Partition: each block appears in the source, in order, with only
				// blank runs between them; the tail is the remaining suffix, and the
				// gap the scanner leaves between the last block and the tail is a
				// blank run it dropped (a blank run only ARMS a break — the block
				// closes when the next non-blank line proves it does not continue —
				// and the run itself is structural whitespace the full parse renders
				// as nothing). Every non-blank character of the source is therefore
				// in exactly one block or in the tail: lost and reordered both fail
				// here, and duplicated text fails the walk.
				let cursor = 0;
				for (const block of scanner.blocks) {
					const at = prefix.indexOf(block, cursor);
					assert.ok(at >= 0, `${where}: a closed block is not in the source`);
					const gap = prefix.slice(cursor, at);
					assert.ok(
						gap.trim() === "",
						`${where}: non-blank text vanished between blocks: ${JSON.stringify(gap)}`,
					);
					cursor = at + block.length;
				}
				const tail = prefix.slice(scanner.blockStart);
				assert.ok(
					cursor <= scanner.blockStart,
					`${where}: the tail overlaps a closed block`,
				);
				assert.ok(
					prefix.slice(cursor, scanner.blockStart).trim() === "",
					`${where}: non-blank text vanished between the last block and the tail: ${JSON.stringify(prefix.slice(cursor, scanner.blockStart))}`,
				);
				assert.ok(
					prefix.endsWith(tail),
					`${where}: the tail is not the remaining suffix`,
				);
				previousBlocks = [...scanner.blocks];
			}
		}
	}
});

/* --------------------------------------- 3. the tail is exactly the suffix */

test("the in-flight tail paints the source suffix, clipped only for trailing whitespace", async () => {
	const dom = mountDom();
	try {
		const container = dom.window.document.getElementById("root");
		const root = createRoot(container);
		for (const item of CORPUS) {
			for (const size of [3, 7]) {
				const scanner = createBlockScanner();
				for (const prefix of prefixes(item.text, size)) {
					scanMarkdownBlocks(scanner, prefix);
					await act(async () => {
						root.render(createElement(StreamingMarkdown, { content: prefix }));
					});
					const where = `${item.name} @${prefix.length}`;
					const tail = container.querySelector(".lo-stream-tail");
					const tailEnd =
						scanner.blockStart +
						trimmedEndLength(prefix.slice(scanner.blockStart));
					const expected = prefix.slice(scanner.blockStart, tailEnd);
					const painted = tail ? tail.textContent : "";
					assert.equal(
						painted,
						expected,
						`${where}: the tail is not the source suffix`,
					);
				}
			}
		}
		await act(async () => root.unmount());
	} finally {
		dom.restore();
	}
});

/* ------------------------------- 4. every construct's payload survives, in order */

test("every construct's payload text is painted, in order, at every flush", async () => {
	const dom = mountDom();
	try {
		const container = dom.window.document.getElementById("root");
		const root = createRoot(container);
		for (const item of CORPUS) {
			for (const size of [2, 9]) {
				for (const prefix of prefixes(item.text, size)) {
					await act(async () => {
						root.render(createElement(StreamingMarkdown, { content: prefix }));
					});
					const painted = container.textContent ?? "";
					let cursor = 0;
					for (const payload of item.payload) {
						// Present only once the prefix has carried the whole payload.
						if (!prefix.includes(payload)) continue;
						const at = painted.indexOf(payload, cursor);
						assert.ok(
							at >= 0,
							`${item.name} @${prefix.length}: ${JSON.stringify(payload)} is missing from the paint (or out of order)`,
						);
						cursor = at;
					}
				}
			}
		}
		await act(async () => root.unmount());
	} finally {
		dom.restore();
	}
});

/* ----------------------------- 5. the settlement is the full parse, byte for byte */

test("the settled paint is byte-identical to a fresh whole-message render", async () => {
	const dom = mountDom();
	try {
		const container = dom.window.document.getElementById("root");
		const reference = dom.window.document.createElement("div");
		dom.window.document.body.appendChild(reference);
		const root = createRoot(container);
		const refRoot = createRoot(reference);
		for (const item of CORPUS) {
			// Stream it in the smallest flush the corpus uses, so the incremental
			// path has painted every intermediate state before settling.
			const scanner = createBlockScanner();
			for (const prefix of prefixes(item.text, 3)) {
				scanMarkdownBlocks(scanner, prefix);
				await act(async () => {
					root.render(createElement(StreamingMarkdown, { content: prefix }));
				});
			}
			// The handover the row performs when `record.streaming` goes false.
			await act(async () => {
				root.render(createElement(MarkdownRenderer, { content: item.text }));
			});
			await act(async () => {
				refRoot.render(createElement(MarkdownRenderer, { content: item.text }));
			});
			assert.equal(
				container.innerHTML,
				reference.innerHTML,
				`${item.name}: the settled paint differs from the whole-message render`,
			);
		}
		await act(async () => root.unmount());
		await act(async () => refRoot.unmount());
	} finally {
		dom.restore();
	}
});

/* ------------- 6. a link appears when its BLOCK closes, never mid-token */

test("a closed block is linkified and the open tail stays prose", async () => {
	const dom = mountDom();
	try {
		const container = dom.window.document.getElementById("root");
		const root = createRoot(container);
		/*
		 * The row used to pass `linkify={!record.streaming}`, so NO link existed
		 * until the whole message settled. The incremental renderer keeps that
		 * guarantee where it is still true — the OPEN block is painted as text and
		 * never scanned, so a half-written `/Users/x/opoint-renewal-2026-09-1`
		 * cannot become a link to a path that does not exist — but a CLOSED
		 * block's source can never change again, which is what `StableBlock`
		 * documents as the reason a finished path inside it is safe to link.
		 * This pins both halves so neither is dropped by a later edit.
		 */
		const open =
			"First paragraph.\n\nSee [the docs](https://example.com/docs) and /tmp/report.txt";
		await act(async () => {
			root.render(createElement(StreamingMarkdown, { content: open }));
		});
		assert.equal(
			container.querySelectorAll("a").length,
			0,
			"the open tail is prose: no anchor can exist for a block still being written",
		);
		assert.ok(
			(container.textContent ?? "").includes(
				"[the docs](https://example.com/docs)",
			),
			"and it paints the source literally",
		);
		/*
		 * A third paragraph's line closes the second block — but only once that
		 * line is TERMINATED: a line without its newline may still grow, so the
		 * scanner keeps it in the tail and the block it would close stays open one
		 * line longer (`markdown-blocks.ts`: "A line without its terminator may
		 * still grow"). In a real stream the newline arrives with the next chunk;
		 * this fixture supplies it, and that trailing newline is the whole reason
		 * the block below closes.
		 */
		const closed = `${open}\n\nThird paragraph.\n`;
		await act(async () => {
			root.render(createElement(StreamingMarkdown, { content: closed }));
		});
		const anchors = [...container.querySelectorAll("a")];
		assert.ok(
			anchors.some(
				(a) => a.getAttribute("href") === "https://example.com/docs",
			),
			"once its block has closed, the link is a link",
		);
		await act(async () => root.unmount());
	} finally {
		dom.restore();
	}
});

/* ------------------- 7. the ROW wires the split, and settles to the full parse */

test("the transcript row renders incrementally while streaming and whole once settled", async () => {
	/*
	 * The components above are only half of the change: `canonical-transcript.tsx`
	 * is what chooses between them on `record.streaming`. This mounts the REAL
	 * transcript with one assistant record, streams it (an open paragraph), then
	 * settles it by folding `message_end` — the same event production sends — and
	 * asserts both halves of the wiring: the streaming row must be the incremental
	 * one (its tail marker), and the settled row must be byte-identical to a fresh
	 * whole-message render. Without this, a later edit could flip the condition and
	 * every component-level test would stay green while the row silently went back
	 * to re-parsing per token.
	 */
	const dom = mountDom();
	try {
		const container = dom.window.document.getElementById("root");
		const root = createRoot(container);
		const openText = "The retry budget is now per-route, and **bold** is open";
		let transcript = applyEvent(
			EMPTY_TRANSCRIPT,
			{
				type: "message_start",
				message: { id: "a1", role: "assistant", content: [], tool_calls: [] },
			},
			1,
		);
		transcript = applyEvent(
			transcript,
			{
				type: "message_update",
				delta: openText,
				message: { id: "a1", role: "assistant", content: [], tool_calls: [] },
			},
			2,
		);
		const props = (t) => ({
			transcript: t,
			frontend: null,
			gate: null,
			waiting: false,
			starting: false,
			loadingOlder: false,
			onLoadOlder: async () => true,
			containerRef: React.createRef(),
			isSmallView: false,
			status: "live",
			failure: null,
			awaitingHydration: false,
			conversationId: "streaming-parity-test",
			onReconnect: () => {},
		});
		await act(async () => {
			root.render(createElement(CanonicalTranscript, props(transcript)));
		});
		const row = container.querySelector('[data-record-id="a1"]');
		assert.ok(row, "the streaming row is on screen");
		assert.ok(
			row.querySelector(".lo-stream-tail"),
			"a streaming row is rendered by the incremental path",
		);
		// Settle the row the way production does.
		const settled = applyEvent(
			transcript,
			{
				type: "message_end",
				message: {
					id: "a1",
					role: "assistant",
					content: [{ type: "text", text: openText }],
					tool_calls: [],
				},
			},
			3,
		);
		await act(async () => {
			root.render(createElement(CanonicalTranscript, props(settled)));
		});
		const settledRow = container.querySelector('[data-record-id="a1"]');
		assert.ok(
			!settledRow.querySelector(".lo-stream-tail"),
			"a settled row leaves the incremental path",
		);
		// The same inputs the row hands it: settled content, linkify on, and the
		// row's own style props (isSmallView is false here).
		const expected = createElement(MarkdownRenderer, {
			content: openText,
			linkify: true,
			styleProps: { fontSize: "var(--text-body)", lineHeight: 1.6 },
		});
		const reference = dom.window.document.createElement("div");
		dom.window.document.body.appendChild(reference);
		const refRoot = createRoot(reference);
		await act(async () => refRoot.render(expected));
		const settledMarkdown = settledRow.querySelector(".lo-markdown");
		assert.equal(
			settledMarkdown.outerHTML,
			reference.firstChild.outerHTML,
			`the settled row's markdown is the whole-message render, byte for byte\nrow:       ${settledMarkdown.outerHTML}\nreference: ${reference.firstChild.outerHTML}`,
		);
		await act(async () => root.unmount());
		await act(async () => refRoot.unmount());
	} finally {
		dom.restore();
	}
});
