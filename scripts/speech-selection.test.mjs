/**
 * The selection's Speech: both toolbars, the press, and the rules that were
 * already there.
 *
 * WHAT THIS FILE IS, exactly:
 *
 *   1. THE TURN'S TOOLBAR (`quote-toolkit.tsx`), mounted against a real turn
 *      element with a real highlight: Quote and Speak are both present; the
 *      Speak press is exercised THROUGH the shipped chain (store -> relay seam
 *      `window.api.desktop.media`) and the request proves the words are the
 *      highlight and nothing else - not the timestamp, not the turn; the
 *      playing state shows on the toolbar; the highlight survives the press.
 *   2. QUOTE IS UNCHANGED: the same toolbar's Quote stages exactly the
 *      highlight into the composer store, makes no speech request, and (its
 *      long-standing answer) takes the highlight down when it lands.
 *   3. ESCAPE IS UNCHANGED: the toolbar leaves and the highlight is cleared.
 *   4. ONE CONTROL PER HIGHLIGHT, across two turns: a drag from one turn into
 *      another raises exactly ONE toolbar, and it is the turn the drag BEGAN
 *      in - asserted through the press, because the count alone cannot say
 *      which one won.
 *   5. THE LINK TOOLBAR: a highlight wholly inside a link offers Speak beside
 *      Quote (the state the turn's own control does not mount for), speaking
 *      exactly the highlight; with no highlight, the same button speaks the
 *      link's own text - the `fallbackText` arm `use-quote-press.ts` documents.
 *
 * WHAT THIS FILE STUBS, and therefore does not prove: the frame geometry.
 * `Range.prototype.getClientRects` returns one fixed box here (jsdom has no
 * layout), so these cases prove the PRESS and the gating, not the placement -
 * the boxes are `message-quote.test.mjs`'s and the frames are the design
 * round's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/*
 * THE DOM, BEFORE THE GRAPH IS EVALUATED (`stt-mic-gate-session.test.mjs`'s
 * comment; the pattern is load-bearing): Radix captures its DOM availability
 * at module scope, and a bundle imported with no `document` gets NO-OP layout
 * effects for the rest of the process - measured on the tooltip suites: the
 * open flips and the portal never mounts.
 */
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.HTMLElement = bootstrap.window.HTMLElement;
globalThis.Node = bootstrap.window.Node;
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: bootstrap.window.navigator,
});
globalThis.getComputedStyle = bootstrap.window.getComputedStyle.bind(
	bootstrap.window,
);
for (const name of [
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"Element",
	"HTMLButtonElement",
	"HTMLAnchorElement",
]) {
	if (bootstrap.window[name]) globalThis[name] = bootstrap.window[name];
}
/*
 * `localStorage` too, and BEFORE the graph is evaluated: the persisted stores
 * capture their storage at module scope (`createJSONStorage` calls its getter
 * once), and a bundle imported without one gets `undefined` - every later
 * `setState` then throws on `setItem` (measured here: the first `reset()`).
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

const bundle = await build({
	stdin: {
		loader: "jsx",
		contents: `
			import { useRef, useState } from "react";
			import { QuoteToolkit } from "./src/renderer/src/features/chat/canonical/quote-toolkit";
			import { LinkToolkit } from "./src/renderer/src/features/chat/canonical/link-toolkit";

			export const QuoteHarness = ({ conversationId, text }) => {
				const turnRef = useRef(null);
				return (
					<div>
						<div ref={turnRef}>
							<p>{text}</p>
						</div>
						<QuoteToolkit conversationId={conversationId} turnRef={turnRef} />
					</div>
				);
			};

			export const TwoTurnHarness = ({ conversationId, first, second }) => {
				const firstRef = useRef(null);
				const secondRef = useRef(null);
				return (
					<div>
						<div ref={firstRef}>
							<p>{first}</p>
						</div>
						<div ref={secondRef}>
							<p>{second}</p>
						</div>
						<QuoteToolkit conversationId={conversationId} turnRef={firstRef} />
						<QuoteToolkit conversationId={conversationId} turnRef={secondRef} />
					</div>
				);
			};

			export const LinkHarness = ({ conversationId, label }) => {
				const turnRef = useRef(null);
				const [subject, setSubject] = useState(null);
				return (
					<div>
						<div ref={turnRef}>
							<p>
								{"See "}
								<a
									ref={setSubject}
									href="file:///tmp/report.txt"
									data-lo-kind="file"
									data-lo-target="/tmp/report.txt"
								>
									{label}
								</a>
								{" for detail."}
							</p>
						</div>
						{subject && (
							<LinkToolkit
								conversationId={conversationId}
								turnRef={turnRef}
								subject={subject}
								quoteAvailable
								onDismiss={() => {}}
							/>
						)}
					</div>
				);
			};

			export { useConversationInputStore } from "@shared/store/conversation-input-store";
			export { useSpeechStore, selectionSpeechKey } from "@shared/store/speech-store";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: [
		"react",
		"react/jsx-runtime",
		"react-dom",
		"react-dom/server",
		"@tanstack/react-query",
	],
	plugins: [
		{
			name: "speech-fixtures",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-credentials/ },
					() => ({ path: "probe", namespace: "fixture" }),
				);
				builder.onResolve({ filter: /@shared\/utils\/toast-manager/ }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
					if (args.path === "probe") {
						return {
							loader: "js",
							contents: `
								export const useRadientCredentialProbe = () => ({
									canUseRadientSpeech: globalThis.__speechConfigured === true,
									speechBlock: "sign-in",
								});
							`,
						};
					}
					return {
						loader: "js",
						contents: `
							const channel = () => (globalThis.__speechToasts ??= { errors: [], infos: [] });
							export const showErrorToast = (message) => { channel().errors.push(message); return "toast"; };
							export const showInfoToast = (message) => { channel().infos.push(message); return "toast"; };
							export const showSuccessToast = (message) => { channel().infos.push(message); return "toast"; };
							export const showWarningToast = (message) => { channel().infos.push(message); return "toast"; };
							export const dismissToast = () => {};
							export const resetToastDedup = () => {};
						`,
					};
				});
			},
		},
	],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
	jsx: "automatic",
});

const { writeFile, unlink } = await import("node:fs/promises");
const bundlePath = new URL(
	`./_speech-selection-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------------------------------------- the fakes */

const fakeAudios = [];
class FakeAudio {
	constructor(src) {
		this.src = src;
		this.played = false;
		fakeAudios.push(this);
	}
	play() {
		this.played = true;
		return Promise.resolve();
	}
	pause() {}
}
globalThis.Audio = FakeAudio;
URL.createObjectURL = () => "blob:test/speech";
URL.revokeObjectURL = () => {};

/*
 * The one box every `getClientRects` answers with. jsdom has no layout, so the
 * placement math needs SOME rectangle; one fixed box keeps the toolbar
 * measured-and-placed rather than `invisible`, and no case here asserts on its
 * numbers (see the header).
 */
const STUB_RECT = {
	top: 100,
	left: 40,
	right: 300,
	bottom: 117,
	width: 260,
	height: 17,
};

const reset = () => {
	mod.useSpeechStore.setState({
		audioCache: new Map(),
		loadingKey: null,
		playingKey: null,
		error: null,
		audioElement: null,
		currentUrl: null,
		generation: 0,
	});
	mod.useConversationInputStore.setState({ inputByConversation: {} });
	fakeAudios.length = 0;
	globalThis.__speechToasts = { errors: [], infos: [] };
};

/** Mount a harness in a fresh document; `element` is the rendered component. */
const mount = async (component, props) => {
	reset();
	globalThis.__speechConfigured = true;
	const requests = [];
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.localStorage = dom.window.localStorage;
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	for (const name of [
		"Event",
		"CustomEvent",
		"MouseEvent",
		"KeyboardEvent",
		"FocusEvent",
		"PointerEvent",
		"Element",
		"HTMLElement",
		"Node",
		"HTMLButtonElement",
		"HTMLAnchorElement",
	]) {
		if (dom.window[name]) globalThis[name] = dom.window[name];
	}
	/*
	 * The boxes, at the boundary the app reads them through: a Range has none in
	 * jsdom (`getClientRects is not a function`, measured), and both toolbars
	 * measure through one.
	 */
	dom.window.Range.prototype.getClientRects = () => [STUB_RECT];
	dom.window.Element.prototype.getClientRects = () => [STUB_RECT];
	dom.window.api = {
		desktop: {
			media: async (request) => {
				requests.push(request);
				return {
					kind: "bytes",
					mimeType: "audio/mpeg",
					data: new Uint8Array([1, 2, 3]),
				};
			},
		},
	};

	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(React.createElement(component, props));
	});

	const flush = async () => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	const press = async (button) => {
		await act(async () => {
			button.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
		await flush();
	};
	const select = async (startNode, start, endNode, end) => {
		await act(async () => {
			const range = dom.window.document.createRange();
			range.setStart(startNode, start);
			range.setEnd(endNode, end);
			const selection = dom.window.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
			dom.window.document.dispatchEvent(
				new dom.window.Event("selectionchange", { bubbles: true }),
			);
		});
	};
	const unmount = async () => {
		await act(async () => {
			root.unmount();
		});
	};

	return { dom, root, press, select, flush, requests, unmount };
};

const buttonIn = (dom, selector, label) =>
	dom.window.document.querySelector(
		`${selector} button[aria-label="${label}"]`,
	);

/* ---------------------------------------- 1. the turn's toolbar */

test("the selection's toolbar offers Speak beside Quote, and speaks exactly the highlight", async () => {
	const text = "The quick brown fox jumps over the lazy dog.";
	const { dom, press, select, requests, unmount } = await mount(
		mod.QuoteHarness,
		{
			conversationId: "conv-1",
			text,
		},
	);
	const node = dom.window.document.querySelector("p").firstChild;
	await select(node, 4, node, 19); // "quick brown fox"

	const toolbar = () =>
		dom.window.document.querySelector("[data-lo-quote-toolkit]");
	assert.ok(toolbar(), "a highlight of this turn raises the toolbar");
	assert.ok(
		buttonIn(dom, "[data-lo-quote-toolkit]", "Quote"),
		"Quote is unchanged",
	);
	assert.ok(
		buttonIn(dom, "[data-lo-quote-toolkit]", "Speak aloud"),
		"Speak rides beside it",
	);

	await press(buttonIn(dom, "[data-lo-quote-toolkit]", "Speak aloud"));
	assert.deepEqual(
		requests,
		[
			{
				op: "speech.agent",
				agentId: "conv-1",
				request: { input_text: "quick brown fox" },
			},
		],
		"the request is the highlight itself - no timestamp, no turn",
	);
	assert.equal(
		mod.useSpeechStore.getState().playingKey,
		mod.selectionSpeechKey("conv-1", "quick brown fox"),
		"and the playing entry is keyed to those same words",
	);
	assert.ok(
		buttonIn(dom, "[data-lo-quote-toolkit]", "Stop"),
		"the toolbar shows the playing state",
	);
	assert.equal(
		dom.window.getSelection().toString(),
		"quick brown fox",
		"the press leaves the reader's highlight alone",
	);
	await unmount();
});

/* ---------------------------------------- 2/3. Quote and Escape, unchanged */

test("Quote stages exactly the highlight and leaves speech alone", async () => {
	const text = "The quick brown fox jumps over the lazy dog.";
	const { dom, press, select, requests, unmount } = await mount(
		mod.QuoteHarness,
		{
			conversationId: "conv-1",
			text,
		},
	);
	const node = dom.window.document.querySelector("p").firstChild;
	await select(node, 4, node, 19);
	await press(buttonIn(dom, "[data-lo-quote-toolkit]", "Quote"));
	assert.deepEqual(
		mod.useConversationInputStore
			.getState()
			.inputByConversation["conv-1"]?.replies.map((reply) => reply.text),
		["quick brown fox"],
		"the quote is the highlight",
	);
	assert.deepEqual(requests, [], "Quote makes no speech request");
	assert.equal(
		dom.window.document.querySelector("[data-lo-quote-toolkit]"),
		null,
		"the answered highlight takes the toolbar down (the long-standing rule)",
	);
	await unmount();
});

test("Escape dismisses the toolbar and the highlight", async () => {
	const text = "The quick brown fox jumps over the lazy dog.";
	const { dom, select, unmount } = await mount(mod.QuoteHarness, {
		conversationId: "conv-1",
		text,
	});
	const node = dom.window.document.querySelector("p").firstChild;
	await select(node, 4, node, 19);
	assert.ok(
		dom.window.document.querySelector("[data-lo-quote-toolkit]"),
		"raised before the key",
	);
	await act(async () => {
		dom.window.document.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	assert.equal(
		dom.window.document.querySelector("[data-lo-quote-toolkit]"),
		null,
		"Escape takes the control down",
	);
	assert.equal(
		dom.window.getSelection().toString(),
		"",
		"and clears the highlight",
	);
	await unmount();
});

/* ---------------------------------------- 4. one control per highlight */

test("a drag across two turns raises one control, owned by the turn it began in", async () => {
	const { dom, press, select, unmount } = await mount(mod.TwoTurnHarness, {
		conversationId: "conv-1",
		first: "Alpha beta gamma.",
		second: "Second turn words.",
	});
	const paragraphs = dom.window.document.querySelectorAll("p");
	await select(paragraphs[0].firstChild, 4, paragraphs[1].firstChild, 6);

	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-quote-toolkit]").length,
		1,
		"exactly one control for one highlight",
	);
	await press(buttonIn(dom, "[data-lo-quote-toolkit]", "Quote"));
	assert.deepEqual(
		mod.useConversationInputStore
			.getState()
			.inputByConversation["conv-1"]?.replies.map((reply) => reply.text),
		["a beta gamma."],
		"the winner is the turn the highlight BEGAN in, clipped to that turn",
	);
	await unmount();
});

/* ---------------------------------------- 5. the link toolbar */

test("a highlight inside a link offers Speak on the link toolbar, speaking exactly it", async () => {
	const { dom, press, select, requests, unmount } = await mount(
		mod.LinkHarness,
		{
			conversationId: "conv-1",
			label: "report.txt",
		},
	);
	const anchor = dom.window.document.querySelector("a");
	await select(anchor.firstChild, 0, anchor.firstChild, 6); // "report"

	const labels = [
		...dom.window.document.querySelectorAll("[data-lo-link-toolbar] button"),
	].map((button) => button.getAttribute("aria-label"));
	assert.deepEqual(
		labels.slice(0, 2),
		["Quote", "Speak aloud"],
		"the pair leads the strip when the highlight is the subject",
	);
	await press(buttonIn(dom, "[data-lo-link-toolbar]", "Speak aloud"));
	assert.deepEqual(
		requests,
		[
			{
				op: "speech.agent",
				agentId: "conv-1",
				request: { input_text: "report" },
			},
		],
		"the words are the highlight, not the link's whole label",
	);
	await unmount();
});

test("with no highlight, the link toolbar's Speak answers with the link's own text", async () => {
	const { dom, press, requests, unmount } = await mount(mod.LinkHarness, {
		conversationId: "conv-1",
		label: "report.txt",
	});
	const button = buttonIn(dom, "[data-lo-link-toolbar]", "Speak aloud");
	assert.ok(button, "the hover arm offers Speak too (round 2, U4)");
	await press(button);
	assert.deepEqual(
		requests,
		[
			{
				op: "speech.agent",
				agentId: "conv-1",
				request: { input_text: "report.txt" },
			},
		],
		"the fallback is the link's visible text, read at press time",
	);
	await unmount();
});
