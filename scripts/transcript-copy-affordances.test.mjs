/**
 * The transcript's copy affordances: no row reserves space, every line can be
 * copied, and the payload is the record's own text rather than the DOM's.
 *
 * WHAT THIS FILE IS. `CanonicalTranscript` mounted in a real jsdom root over a
 * multi-answer turn (`MULTI_TURN`), plus the pure payload rules from
 * `transcript-copy.ts`. The DOM is asked:
 *
 *   1. NO FLOW ACTION ROW under an intermediate response: zero
 *      `[data-lo-response-actions]`, zero `mt-1 flex justify-end` wrappers, and
 *      the response's copy control is an `absolute` overlay
 *      (`[data-lo-gutter-actions]`), so it reserves no line. jsdom reports zero
 *      heights for everything, so the pixel half of that claim is the committed
 *      evidence frame (`docs/evidence/transcript-copy-affordances/`); what the
 *      DOM can prove is that no flow child exists to reserve the 28px.
 *   2. THE USER ROW'S CONTROL is an overlay inside its turn, focusable, and
 *      revealed by the turn's `group` - the row keeps no flow place.
 *   3. RIGHT-CLICK WORKS ON EVERY LINE KIND: prose, a tool ledger row, a fold
 *      header, a receipt. The menu opens for the line right-clicked and its
 *      Copy as Markdown writes that line's source.
 *   4. KEYBOARD: Shift+F10 opens a focused message's menu, and Mod+Shift+C
 *      copies the focused message (or the selection when no row is focused).
 *   5. SELECTION: a partial selection mounts the shared selection toolbar, and
 *      the context menu's Copy selection copies exactly the highlight.
 *
 * WHAT IT DOES NOT PROVE: pixels and theme contrast (the evidence frame and
 * design review carry those), or a real OS clipboard (the write path is the
 * app's one `copyTarget`, stubbed at `navigator.clipboard`).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Radix captures `document` at module scope, and the persisted stores read
 * their storage once at evaluation - both before this file's mount creates its
 * own window (the measurement is `speech-selection.test.mjs`'s).
 */
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.HTMLElement = bootstrap.window.HTMLElement;
globalThis.Node = bootstrap.window.Node;
globalThis.DOMRect = bootstrap.window.DOMRect;
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: bootstrap.window.navigator,
});
globalThis.getComputedStyle = bootstrap.window.getComputedStyle.bind(
	bootstrap.window,
);
const persisted = new Map();
globalThis.localStorage = {
	getItem: (key) => persisted.get(key) ?? null,
	setItem: (key, value) => persisted.set(key, value),
	removeItem: (key) => persisted.delete(key),
};
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

/* Hoisted for biome's `useTopLevelRegex`: the esbuild fixture filters. */
const RE_CREDENTIALS = /@shared\/hooks\/use-credentials/;
const RE_TOAST = /@shared\/utils\/toast-manager/;
const RE_ANY = /.*/;

const bundle = await build({
	stdin: {
		contents: `
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
			export { EMPTY_TRANSCRIPT, applyHistoryPage } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export {
				copyTextForRecord,
				copyMarkdownForRecord,
				copyTextForGroup,
				copyMarkdownForGroup,
				transcriptRowActions,
			} from "./src/renderer/src/features/chat/canonical/transcript-copy";
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
		"react-dom/client",
		"@tanstack/react-query",
	],
	plugins: [
		{
			name: "copy-affordance-fixtures",
			setup(builder) {
				builder.onResolve({ filter: RE_CREDENTIALS }, () => ({
					path: "probe",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: RE_TOAST }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: RE_ANY, namespace: "fixture" }, (args) => {
					if (args.path === "probe") {
						return {
							loader: "js",
							contents: `
								export const useRadientCredentialProbe = () => ({
									canUseRadientSpeech: false,
									speechBlock: "sign-in",
								});
							`,
						};
					}
					return {
						loader: "js",
						contents: `
							export const showErrorToast = () => "toast";
							export const showInfoToast = () => "toast";
							export const showSuccessToast = () => "toast";
							export const showWarningToast = () => "toast";
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
	`./_transcript-copy-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const GATE_TS = 1_760_000_000_000;

const ENTRY = (id, ts, payload) => ({ id, ts, type: "message", payload });

const INTERMEDIATE = [
	"I will read the half-written table first, then answer the row question.",
	"",
	"```sql",
	"select id, paid_at from invoices where paid_at is null;",
	"```",
	"",
	"- the source writes an empty string",
	"- the schema expects null",
].join("\n");

const CLOSING = "It finished with the same four invoices outstanding.";

/**
 * The turn under test: the reader's message, an intermediate settled answer,
 * two ledger calls that fold into a header, and the closing answer.
 */
const MULTI_TURN = mod.applyHistoryPage(mod.EMPTY_TRANSCRIPT, {
	entries: [
		ENTRY("u1", GATE_TS / 1000, {
			kind: "message",
			role: "user",
			content: [{ text: "Is the March import finished?" }],
		}),
		ENTRY("a1", GATE_TS / 1000 + 2, {
			kind: "message",
			role: "assistant",
			content: [{ text: INTERMEDIATE }],
			stop_reason: "stop",
		}),
		ENTRY("t1", GATE_TS / 1000 + 4, {
			kind: "message",
			role: "tool",
			tool_call_id: "c1",
			tool_name: "read",
			content: [{ type: "text", text: "src/invoices/query.ts\n" }],
			provider_payload: { duration_s: 0.4, details: {} },
		}),
		ENTRY("t2", GATE_TS / 1000 + 6, {
			kind: "message",
			role: "tool",
			tool_call_id: "c2",
			tool_name: "bash",
			content: [{ type: "text", text: "tests 40\npass 40\n" }],
			provider_payload: { duration_s: 12.5, details: {} },
		}),
		ENTRY("t3", GATE_TS / 1000 + 8, {
			kind: "message",
			role: "tool",
			tool_call_id: "c3",
			tool_name: "bash",
			content: [{ type: "text", text: "build 12s\n" }],
			provider_payload: { duration_s: 12.1, details: {} },
		}),
		ENTRY("a2", GATE_TS / 1000 + 70, {
			kind: "message",
			role: "assistant",
			content: [{ text: CLOSING }],
			stop_reason: "stop",
		}),
	],
	has_more: false,
	cursor_missing: false,
});

const mountTranscript = async (transcript) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.DOMRect = dom.window.DOMRect;
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	globalThis.MutationObserver = dom.window.MutationObserver;
	/*
	 * The disclosure body asks `useMediaQuery` for reduced motion on mount.
	 * jsdom has no media query engine; "no match" is the honest answer and the
	 * animated branch is the one the product takes by default.
	 */
	dom.window.matchMedia = (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener() {},
		removeListener() {},
		addEventListener() {},
		removeEventListener() {},
		dispatchEvent: () => false,
	});
	globalThis.matchMedia = dom.window.matchMedia;
	/*
	 * JSDOM's Range has no geometry. The shared selection toolbar reads the
	 * highlight's bounding rect to place itself; a zero box is the honest
	 * jsdom reading and is enough for "the toolbar mounted".
	 */
	dom.window.Range.prototype.getBoundingClientRect = () =>
		new dom.window.DOMRect(0, 0, 0, 0);
	dom.window.Range.prototype.getClientRects = () => [];
	globalThis.requestAnimationFrame = (callback) =>
		setTimeout(() => callback(0), 0);
	globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
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
		"HTMLInputElement",
		"HTMLTextAreaElement",
		"Range",
		"MutationObserver",
	]) {
		if (dom.window[name]) globalThis[name] = dom.window[name];
	}
	const written = [];
	Object.defineProperty(dom.window.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text) => {
				written.push(text);
			},
		},
	});

	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(mod.CanonicalTranscript, {
					transcript,
					frontend: null,
					gate: null,
					waiting: false,
					starting: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: null },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
					conversationId: "story-conversation",
				}),
			),
		);
	});

	const click = async (element) => {
		assert.ok(element, "missing click target");
		await act(async () => {
			element.dispatchEvent(
				new dom.window.MouseEvent("click", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 15));
		});
	};
	const openMenu = async (element) => {
		assert.ok(element, "missing context-menu target");
		await act(async () => {
			element.dispatchEvent(
				new dom.window.MouseEvent("contextmenu", {
					bubbles: true,
					cancelable: true,
					button: 2,
					clientX: 24,
					clientY: 24,
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 15));
		});
		const menu = dom.window.document.querySelector("[data-lo-copy-menu]");
		assert.ok(menu, "the context menu opened");
		return menu;
	};
	const menuItem = (menu, label) => {
		const item = [...menu.querySelectorAll('[role="menuitem"]')].find((node) =>
			node.textContent?.includes(label),
		);
		assert.ok(item, `the menu offers ${label}`);
		return item;
	};
	const key = async (element, init) => {
		await act(async () => {
			element.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					...init,
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 15));
		});
	};
	const unmount = async () => {
		await act(async () => {
			root.unmount();
		});
		client.clear();
		dom.window.close();
	};
	return {
		dom,
		written,
		click,
		openMenu,
		menuItem,
		key,
		unmount,
	};
};

const rowOf = (dom, id) =>
	dom.window.document.querySelector(`[data-record-id="${id}"]`);

/* --------------------------------------------------------- the pure rules */

test("visible text drops the reply transport; markdown keeps the source", () => {
	const record = {
		kind: "assistant",
		id: "a1",
		ts: 0,
		text: [
			"<reply-to>What was the total?</reply-to>",
			"",
			"```sql",
			"select count(*) from invoices;",
			"```",
			"",
			"- one",
			"- two",
		].join("\n"),
		streaming: false,
		stopReason: null,
		error: false,
	};
	const text = mod.copyTextForRecord(record);
	assert.ok(
		!text.includes("<reply-to>"),
		"the visible copy has no transport markup",
	);
	assert.equal(
		mod.copyMarkdownForRecord(record),
		text,
		"markdown is the source minus the transport prefix, not innerText",
	);
	assert.ok(text.includes("```sql"), "the fence survives");
	assert.ok(text.includes("- one\n- two"), "the list survives");
});

test("a tool row copies a fenced block naming the tool, command and output", () => {
	const record = {
		kind: "tool",
		id: "tool:1",
		ts: 0,
		toolCallId: "1",
		toolName: "bash",
		intent: null,
		args: { command: "pytest -q" },
		phase: "done",
		argumentBytes: 12,
		output: "40 passed\n",
	};
	const text = mod.copyTextForRecord(record);
	assert.ok(text.includes("bash"), "the tool name is in the payload");
	assert.ok(text.includes("pytest -q"), "the command is in the payload");
	assert.ok(text.includes("40 passed"), "the output is in the payload");
	const markdown = mod.copyMarkdownForRecord(record);
	assert.ok(markdown.startsWith("```text\n"), "markdown is one fenced block");
	assert.ok(markdown.endsWith("\n```"), "and closes the fence");
});

test("a fold summary copies its summary line", () => {
	const summary = { units: ["Explored 4 files", "1 search"], prose: false };
	assert.equal(mod.copyTextForGroup(summary), "Explored 4 files · 1 search");
	assert.equal(
		mod.copyMarkdownForGroup(summary),
		"Explored 4 files · 1 search",
	);
});

/* ------------------------------------------------------------ no layout */

test("an intermediate answer has no in-flow action row and no reserved line", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-response-actions]").length,
		0,
		"the per-response flow row is gone",
	);
	assert.equal(
		dom.window.document.querySelectorAll('[class*="mt-1 flex justify-end"]')
			.length,
		0,
		"and its wrapper is gone with it",
	);
	const responseRow = rowOf(dom, "a1");
	assert.ok(responseRow, "the intermediate answer is on screen");
	const gutter = responseRow.querySelector("[data-lo-gutter-actions]");
	assert.ok(gutter, "it keeps a copy control, in the gutter");
	assert.ok(
		gutter.classList.contains("absolute"),
		"absolutely positioned, so it contributes no line to the row's height",
	);
	/*
	 * THE REVEAL'S GROUP IS THE FOCUSABLE WRAPPER. The first after-frame showed
	 * the gutter at opacity 0 with the row focused: the tab stop was the
	 * `[data-record-id]` wrapper, while every `group` was an inner box that the
	 * focus was not inside. The wrapper must therefore wear `group`, and the
	 * answer's content box draws the focus ring the wrapper suppresses.
	 */
	assert.ok(
		responseRow.classList.contains("group"),
		"the focusable row wrapper is the group the gutter reveal reads",
	);
	assert.ok(
		responseRow.className.includes("focus-visible:outline-none"),
		"the full-width row ring is suppressed",
	);
	const answerRing = responseRow.querySelector(
		'[class*="group-focus-visible:outline-2"]',
	);
	assert.ok(answerRing, "the content box draws the focus ring instead");
	assert.equal(
		responseRow.classList.contains("mt-1"),
		false,
		"and no margin wrapper remains under the prose",
	);
	/*
	 * jsdom has no layout engine, so both boxes are zero; the assertion is kept
	 * because it states the contract the real frame measures (the manager's
	 * after capture reads the pixel pair), and it fails the day a flow child is
	 * added back under the prose - that child would be the only nonzero box.
	 */
	const prose = responseRow.querySelector(".lo-markdown") ?? responseRow;
	assert.equal(
		responseRow.getBoundingClientRect().height,
		prose.getBoundingClientRect().height,
		"the response row's height is its prose's height, with no reserved line",
	);
	await rig.unmount();
});

test("the user row's control is an absolute overlay, focusable with the row", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const userRow = rowOf(dom, "u1");
	assert.ok(userRow, "the user turn is on screen");
	assert.equal(userRow.tabIndex, 0, "message rows are tab stops");
	assert.equal(userRow.getAttribute("role"), "group");
	assert.ok(userRow.getAttribute("aria-label"), "and named");
	assert.ok(
		userRow.classList.contains("group"),
		"the focusable row wrapper is the group the reveal reads",
	);
	assert.ok(
		userRow.className.includes("focus-visible:outline-none"),
		"the full-width row ring is suppressed",
	);
	const bubble = userRow.querySelector("[data-glass-block]");
	assert.ok(bubble, "the user bubble is on screen");
	assert.ok(
		bubble.className.includes("group-focus-visible:outline-2") &&
			bubble.className.includes("group-focus-visible:outline-accent"),
		"the bubble draws the ring the row suppresses",
	);
	const control = userRow.querySelector("[data-lo-user-actions]");
	assert.ok(control, "the reader's own copy control is present");
	assert.ok(control.classList.contains("absolute"), "outside the flow");
	assert.ok(
		control.className.includes("group-focus-within:opacity-100"),
		"revealed when the turn holds focus",
	);
	const heightBefore = userRow.getBoundingClientRect().height;
	await act(async () => {
		userRow.focus();
	});
	assert.equal(
		dom.window.document.activeElement,
		userRow,
		"the row itself takes focus - the reveal has an owner",
	);
	assert.equal(
		userRow.getBoundingClientRect().height,
		heightBefore,
		"focusing the row reveals the control without changing the row's height",
	);
	await rig.unmount();
});

/* ------------------------------------------------------- the context menu */

test("a prose line copies its original markdown from the menu", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const menu = await rig.openMenu(
		rowOf(dom, "a1").querySelector(".lo-markdown") ?? rowOf(dom, "a1"),
	);
	assert.equal(
		rig.menuItem(menu, "Copy selection").getAttribute("aria-disabled"),
		"true",
		"with no highlight, Copy selection says it cannot act",
	);
	await rig.click(rig.menuItem(menu, "Copy as Markdown"));
	assert.deepEqual(
		rig.written,
		[INTERMEDIATE],
		"the raw record text, unchanged",
	);
	await rig.unmount();
});

test("a tool row opens its own menu and copies its fenced result", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	/*
	 * The settled turn arrives collapsed into its bar; the bar's own press is
	 * the reader's door to the ledger rows, so the test takes the same door
	 * rather than mounting a state the product never shows.
	 */
	const bar = dom.window.document.querySelector(
		'[data-turn-summary] button[aria-expanded="false"]',
	);
	assert.ok(bar, "the turn opens as a bar");
	await rig.click(bar);
	/*
	 * The ledger calls are inside their own fold, which starts closed. Opening it
	 * is the reader's second press; the fold header itself is the line the
	 * context menu is attached to, so this is the ordinary path to a tool row.
	 */
	const foldToggle = dom.window.document.querySelector(
		"[data-fold-ids] button[aria-expanded]",
	);
	assert.ok(foldToggle, "the ledger fold is on screen");
	await rig.click(foldToggle);
	const toolRow = dom.window.document.querySelector(
		'[data-record-kind="tool"]',
	);
	assert.ok(toolRow, "the ledger row is on screen after the bar opens");
	const menu = await rig.openMenu(toolRow);
	assert.deepEqual(
		[...menu.querySelectorAll('[role="menuitem"]')].map(
			(node) => node.textContent,
		),
		["Copy text", "Copy as Markdown", "Copy selection"],
		"the menu's three items, in order",
	);
	await rig.click(rig.menuItem(menu, "Copy as Markdown"));
	assert.equal(rig.written.length, 1);
	assert.ok(rig.written[0].startsWith("```text"), "a fenced block");
	assert.ok(rig.written[0].includes("read"), "the tool name is in it");
	await rig.unmount();
});

test("a fold header opens a menu with its summary line", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const bar = dom.window.document.querySelector(
		'[data-turn-summary] button[aria-expanded="false"]',
	);
	assert.ok(bar, "the turn opens as a bar");
	await rig.click(bar);
	const fold = dom.window.document.querySelector("[data-fold-ids]");
	assert.ok(fold, "the three ledger calls folded into one header");
	const summary = fold.querySelector("[data-fold-summary]");
	const menu = await rig.openMenu(summary ?? fold);
	await rig.click(rig.menuItem(menu, "Copy text"));
	assert.deepEqual(
		rig.written,
		[(summary?.textContent ?? "").trim()],
		"the copied text is the header's own summary line",
	);
	await rig.unmount();
});

test("Shift+F10 opens the focused message's menu, and Mod+Shift+C copies it", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const answer = rowOf(dom, "a2");
	await act(async () => {
		answer.focus();
	});
	await rig.key(answer, { key: "F10", shiftKey: true });
	const menu = dom.window.document.querySelector("[data-lo-copy-menu]");
	assert.ok(menu, "Shift+F10 opens the focused row's menu");
	await act(async () => {
		menu.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 15));
	});
	await rig.key(answer, { key: "C", ctrlKey: true, shiftKey: true });
	assert.deepEqual(
		rig.written,
		[CLOSING],
		"Mod+Shift+C copies the focused message",
	);
	await rig.unmount();
});

test("a partial selection mounts the shared toolbar and the menu copies it", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const answer = rowOf(dom, "a1");
	const findText = (node) => {
		if (node.nodeType === 3 && node.textContent.trim().length > 0) return node;
		for (const child of node.childNodes) {
			const found = findText(child);
			if (found) return found;
		}
		return null;
	};
	const textNode = findText(answer);
	assert.ok(textNode, "the answer has a text node to select");
	const range = dom.window.document.createRange();
	range.selectNodeContents(textNode);
	const selection = dom.window.getSelection();
	assert.ok(selection, "jsdom exposes a selection");
	selection.removeAllRanges();
	selection.addRange(range);
	await act(async () => {
		dom.window.document.dispatchEvent(
			new dom.window.MouseEvent("mouseup", { bubbles: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	const toolbars = [
		...dom.window.document.querySelectorAll("div.absolute.z-10"),
	].filter((node) => node.querySelector('button[aria-label="Copy"]'));
	assert.ok(
		toolbars.length > 0,
		"the shared selection toolbar mounted over the highlight",
	);
	const menu = await rig.openMenu(answer);
	assert.notEqual(
		rig.menuItem(menu, "Copy selection").getAttribute("aria-disabled"),
		"true",
		"with a highlight in hand, Copy selection is offered",
	);
	await rig.click(rig.menuItem(menu, "Copy selection"));
	assert.equal(rig.written.length, 1);
	assert.ok(
		rig.written[0].startsWith("I will read"),
		"the highlight, not the whole message",
	);
	await rig.unmount();
});
