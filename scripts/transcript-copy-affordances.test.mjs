/**
 * The transcript's copy affordances: which rows reserve space and which are
 * hover-only, every line can be copied, and the payload is the record's own text
 * rather than the DOM's.
 *
 * WHAT THIS FILE IS. `CanonicalTranscript` mounted in a real jsdom root over a
 * multi-answer turn (`MULTI_TURN`), plus the pure payload rules from
 * `transcript-copy.ts`. The DOM is asked:
 *
 *   1. NO FLOW ACTION ROW under IN-BETWEEN STATUS TEXT: zero
 *      `[data-lo-response-actions]`, zero `mt-1 flex justify-end` wrappers, and
 *      the commentary's copy control is an `absolute` overlay
 *      (`[data-lo-gutter-actions]`), so it reserves no line. jsdom reports zero
 *      heights for everything, so the pixel half of that claim is the committed
 *      evidence frame (`docs/evidence/transcript-action-bars/`); what the DOM
 *      can prove is that no flow child exists to reserve a line.
 *   2. A NON-CLOSING FINAL RESPONSE (settled, paints text, carries no
 *      `tool_calls` of its own) DOES reserve a row: `[data-lo-response-actions]`
 *      in the flow, under the prose - the operator's 2026-10-20 rule, which
 *      the ROLE decides rather than the position.
 *   3. THE USER ROW'S CONTROL is a FLOW CHILD under the bubble that reserves its
 *      place at rest, revealed by the turn's `group` - not an overlay, so the
 *      layout does not shift when the pointer arrives.
 *   4. RIGHT-CLICK WORKS ON EVERY LINE KIND: prose, a tool ledger row, a fold
 *      header, a peer receipt. The menu opens for the line right-clicked and its
 *      Copy as Markdown writes that line's source.
 *   5. KEYBOARD: Shift+F10 opens a focused message's menu, and Mod+Shift+C
 *      copies the focused message (or the selection when no row is focused).
 *   6. SELECTION: a partial assistant selection raises ONE strip with Quote,
 *      Copy and Speak (not the shared toolbar as well), and its Copy writes the
 *      highlight; a selection outside a quotable turn still gets the shared
 *      Copy/Speak toolbar.
 *
 * WHAT IT DOES NOT PROVE: pixels and theme contrast (the evidence frames and
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
			/*
			 * THE WIRE FACT THAT MAKES THIS ROW COMMENTARY: it carried the call it
			 * announces, which is what `turn-segments.ts::isFinalResponse` reads. A
			 * settled assistant row with prose and no `tool_calls` is a final response
			 * (the `FINAL_MIDTURN` fixture below) and now reserves a row of its own.
			 */
			stop_reason: "toolUse",
			tool_calls: [
				{
					id: "c1",
					type: "function",
					function: { name: "read", arguments: "{}" },
				},
			],
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
		/*
		 * A peer receipt after the closing answer: the every-line menu must reach
		 * the rows that are not messages too, and this fixture is the one the README
		 * claimed but the suite did not carry.
		 */
		ENTRY("p1", GATE_TS / 1000 + 72, {
			kind: "custom",
			custom_type: "peer_message",
			details: {
				text: "<peer-session-message from_pid='1' conversation='sibling'>\nA note from a sibling session.\n</peer-session-message>",
				sender: { pid: "1", conversation_name: "sibling" },
			},
		}),
	],
	has_more: false,
	cursor_missing: false,
});

/*
 * A turn with a FINAL RESPONSE that does not close it: the reader's message, a
 * settled handover with NO `tool_calls` (`f1`), the call that follows, and the
 * closing answer. This is the operator's "all final responses to the user even in
 * between" class - the `isFinalResponse` half of the rule, and the one the
 * in-between test must not be confused with.
 */
const FINAL_MIDTURN = mod.applyHistoryPage(mod.EMPTY_TRANSCRIPT, {
	entries: [
		ENTRY("u1", GATE_TS / 1000, {
			kind: "message",
			role: "user",
			content: [{ text: "Is the March import finished?" }],
		}),
		ENTRY("f1", GATE_TS / 1000 + 2, {
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

const mountTranscript = async (transcript, options = {}) => {
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
	/*
	 * `mutations: false` removes the DOM observer for the handful of tests that
	 * must prove a behaviour holds WITHOUT it. The shared selection toolbar
	 * uses an observer as its catch-up path and a layout effect as its
	 * pre-paint path; a test with the observer present cannot tell which one
	 * did the work, because the observer arrives inside the same 30ms settle.
	 */
	if (options.mutations === false) {
		dom.window.MutationObserver = undefined;
		globalThis.MutationObserver = undefined;
	} else {
		globalThis.MutationObserver = dom.window.MutationObserver;
	}
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

test("plain text drops the reply transport and markdown syntax; markdown keeps the source", () => {
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
	const markdown = mod.copyMarkdownForRecord(record);
	assert.equal(
		text,
		"select count(*) from invoices;\n\n- one\n- two",
		"plain text separates the code block and keeps the list markers",
	);
	assert.equal(
		markdown,
		"```sql\nselect count(*) from invoices;\n```\n\n- one\n- two",
		"markdown keeps the source fence and list",
	);
});

test("a skill turn copies its typed line, not the expanded SKILL.md payload", () => {
	const header =
		"The user invoked the `seal-demo` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.";
	const payload = [
		header,
		`<skill name="seal-demo" ${["invoc", "ation"].join("")}="${"$seal-demo review the diff"}">`,
		"---",
		"name: seal-demo",
		"description: Review a diff for the seal demo",
		"---",
		"",
		"# Seal demo",
		"",
		"Answer with one line.",
		"</skill>",
		"review the diff",
	].join("\n");
	const record = {
		kind: "user",
		id: "skill:1",
		ts: 0,
		text: payload,
		images: [],
	};
	assert.equal(
		mod.copyTextForRecord(record),
		"$seal-demo review the diff",
		"plain text is the typed invocation",
	);
	assert.equal(
		mod.copyMarkdownForRecord(record),
		"$seal-demo review the diff",
		"markdown does not smuggle the expanded body past the row's gate",
	);
});

test("plain text preserves inline code, operators and emphasis targets", () => {
	const record = {
		kind: "assistant",
		id: "literal",
		ts: 0,
		text: [
			"`_init_` stays an identifier.",
			"",
			"`**/*.ts` stays a glob.",
			"",
			"x * y * z is arithmetic.",
			"",
			"2 * 3 * 4 = 24.",
			"",
			"**bold** and *italic* and [label](https://example.com).",
			"",
			"```ts",
			"const glob = **/*.ts;",
			"```",
		].join("\n"),
		streaming: false,
		stopReason: null,
		error: false,
	};
	assert.equal(
		mod.copyTextForRecord(record),
		[
			"_init_ stays an identifier.",
			"",
			"**/*.ts stays a glob.",
			"",
			"x * y * z is arithmetic.",
			"",
			"2 * 3 * 4 = 24.",
			"",
			"bold and italic and label.",
			"",
			"const glob = **/*.ts;",
		].join("\n"),
		"inline/fenced code and spaced operators survive exactly",
	);
});
test("plain text separates blocks and keeps ordered/nested list structure", () => {
	const plain = (text) =>
		mod.copyTextForRecord({
			kind: "assistant",
			id: "blocks",
			ts: 0,
			text,
			streaming: false,
			stopReason: null,
			error: false,
		});
	const cases = [
		[
			"```ts\nconst a = 1;\n```\n\nAfter the block.",
			"const a = 1;\n\nAfter the block.",
		],
		["```\nfirst\n```\n\n```\nsecond\n```", "first\n\nsecond"],
		["```\nx\n```\n\n## Title", "x\n\nTitle"],
		["<div>block</div>\n\nAfter it.", "<div>block</div>\n\nAfter it."],
		["Before <span>inline</span> after.", "Before <span>inline</span> after."],
		[
			"1. Run the migration.\n2. Restart the worker.\n3. Check the queue.",
			"1. Run the migration.\n2. Restart the worker.\n3. Check the queue.",
		],
		[
			"1. Outer\n   - inner a\n   - inner b\n2. Second",
			"1. Outer\n  - inner a\n  - inner b\n2. Second",
		],
		[
			"1. first\n\n   - n1\n   - n2\n\n   after nested\n\n2. next",
			"1. first\n  - n1\n  - n2\n  after nested\n2. next",
		],
		["- one\n- two", "- one\n- two"],
	];
	for (const [source, expected] of cases) {
		assert.equal(plain(source), expected, source);
	}
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

test("an in-between status row has no in-flow action row and no reserved line", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-response-actions]").length,
		0,
		"no final-response row: this turn has no mid-turn handover",
	);
	assert.equal(
		dom.window.document.querySelectorAll('[class*="mt-1 flex justify-end"]')
			.length,
		0,
		"and no wrapper reserves a line",
	);
	/*
	 * Narration is part of the folded work (that is the condensation rule, and
	 * nothing here changes it), so the reader has to open the bar to see the row -
	 * the ordinary door the other tests in this file use.
	 */
	const bar = dom.window.document.querySelector(
		'[data-turn-summary] button[aria-expanded="false"]',
	);
	assert.ok(bar, "the tool span is a bar at rest");
	await rig.click(bar);
	/*
	 * `[data-lo-message-row]` disambiguates the ROW from the bar: the bar carries
	 * its anchor row's `data-record-id` as well, and `rowOf` alone would return
	 * the bar container once the span is open.
	 */
	const responseRow = dom.window.document.querySelector(
		'[data-record-id="a1"][data-lo-message-row]',
	);
	assert.ok(responseRow, "the commentary row is on screen once the bar opens");
	const gutter = responseRow.querySelector("[data-lo-gutter-actions]");
	assert.ok(gutter, "it keeps a copy control, in the gutter");
	assert.equal(
		gutter.getAttribute("aria-label"),
		"Commentary actions",
		"named for its class",
	);
	assert.ok(
		gutter.classList.contains("absolute"),
		"absolutely positioned, so it contributes no line to the row's height",
	);
	assert.equal(
		gutter.classList.contains("rounded-md") ||
			gutter.classList.contains("border") ||
			gutter.classList.contains("bg-elevated"),
		false,
		"and BARE: the screenshot's pill is the regression, and a hover-only pill is still a pill",
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

test("a non-closing FINAL response reserves an in-flow row with the full answer set", async () => {
	const rig = await mountTranscript(FINAL_MIDTURN);
	const dom = rig.dom;
	const row = rowOf(dom, "f1");
	assert.ok(row, "the mid-turn final response is on screen");
	const control = row.querySelector("[data-lo-response-actions]");
	assert.ok(control, "it carries the response row");
	assert.equal(
		control.getAttribute("aria-label"),
		"Response actions",
		"its own name, distinct from the closing answer's",
	);
	assert.equal(
		control.classList.contains("absolute"),
		false,
		"IN THE FLOW: a final response takes the row it is handed",
	);
	assert.ok(
		control.className.includes("opacity-0") &&
			control.className.includes("group-hover:opacity-100"),
		"revealed on hover, opacity-only",
	);
	const labels = [...control.querySelectorAll("button")].map((button) =>
		button.getAttribute("aria-label"),
	);
	assert.deepEqual(
		labels,
		["Copy", "Speak aloud", "Fork from this message"],
		"the full answer set, not Copy alone",
	);
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-gutter-actions]").length,
		0,
		"nothing here is in-between status text",
	);
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-answer-actions]").length,
		1,
		"and the closing answer keeps the one answer-marked row",
	);
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-response-actions]").length,
		1,
		"one response row, for the one non-closing handover",
	);
	/*
	 * THE FOURTH SEAT STANDS DOWN FOR A SELECTION (review round 1, C1). The CSS
	 * rule and the sweep in `text-selection-controls.tsx` cover this marker; this
	 * asserts the DOM half on the SAME mount rather than paying a second one.
	 */
	const prose = row.querySelector(".lo-markdown");
	assert.ok(prose, "the response's prose is on screen");
	const range = dom.window.document.createRange();
	range.selectNodeContents(prose.firstChild ?? prose);
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
	assert.ok(
		control.hasAttribute("inert"),
		"the response row is inert while a selection is live",
	);
	assert.equal(
		control.getAttribute("aria-hidden"),
		"true",
		"and out of the accessibility tree",
	);
	await act(async () => {
		selection.removeAllRanges();
		dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	assert.equal(
		control.hasAttribute("inert"),
		false,
		"and restored to the hit test when the selection clears",
	);
	await rig.unmount();
});

test("the user row's control is a reserved flow row under the bubble, revealed by focus", async () => {
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
	assert.equal(
		control.classList.contains("absolute"),
		false,
		"IN THE FLOW: the operator asked for a row under the message that takes up space",
	);
	/*
	 * Its seat: a child of the turn's own flex COLUMN, and the control's previous
	 * sibling is the horizontal ROW that holds the bubble. Review round 1's B1
	 * passed the old assertion (`control.parentElement ===
	 * bubble.parentElement?.parentElement`) while the control was mounted INSIDE
	 * that row, because the bubble's own wrapper nesting made both sides resolve
	 * to the row. The assertions below cannot pass in that shape: the parent must
	 * be the COLUMN (`flex-col`, not `justify-end`), the previous sibling must be
	 * the bubble's row, and the control must follow the bubble in document order.
	 */
	const seat = control.parentElement;
	assert.ok(seat, "the control has a parent");
	assert.ok(
		seat.className.includes("flex-col"),
		"it is a child of the turn's flex COLUMN, so it stacks under the bubble",
	);
	assert.equal(
		seat.className.includes("justify-end") ||
			seat.className.includes("flex-row"),
		false,
		"it is NOT inside the horizontal bubble row",
	);
	assert.equal(
		control.closest("[data-record-id] .justify-end"),
		null,
		"no `justify-end` row is one of its ancestors",
	);
	const bubbleRow = control.previousElementSibling;
	assert.ok(
		bubbleRow?.contains(bubble),
		"the bubble's own row is its previous sibling - directly under the message",
	);
	assert.ok(
		(bubble.compareDocumentPosition(control) &
			dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !==
			0,
		"and the control follows the bubble in document order",
	);
	assert.ok(
		control.className.includes("group-focus-within:opacity-100"),
		"revealed when the turn holds focus",
	);
	assert.ok(
		control.className.includes("opacity-0") &&
			control.className.includes("group-hover:opacity-100"),
		"and hidden at rest by OPACITY ONLY, so revealing it moves nothing",
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
		"focusing the row reveals the control without changing the row's height (the real proof is the frame pair: same y/height at rest and on hover)",
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

test("a peer receipt opens its own menu and copies its body", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const peer = dom.window.document.querySelector('[data-record-kind="peer"]');
	assert.ok(peer, "the peer receipt is on screen");
	const menu = await rig.openMenu(peer);
	await rig.click(rig.menuItem(menu, "Copy text"));
	assert.deepEqual(
		rig.written,
		["A note from a sibling session."],
		"the receipt's body, without its transport envelope",
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

test("a partial assistant selection raises one Copy/Quote/Speak strip", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	/*
	 * `a1` is COMMENTARY now, so it lives inside the turn's collapsed span and
	 * the bar carries the same `data-record-id` as its anchor row. Open the bar
	 * (the reader's own door) and address the ROW marker, then select inside the
	 * row's PROSE box - the old `findText(row)` picked the bar's "Took " line
	 * when the row's container began with the collapsed span's header (review
	 * round 1, C2).
	 */
	const bar = dom.window.document.querySelector(
		'[data-turn-summary] button[aria-expanded="false"]',
	);
	assert.ok(bar, "the tool span is a bar at rest");
	await rig.click(bar);
	const answer = dom.window.document.querySelector(
		'[data-record-id="a1"][data-lo-message-row]',
	);
	assert.ok(answer, "the commentary row is on screen once the bar opens");
	const findText = (node) => {
		if (node.nodeType === 3 && node.textContent.trim().length > 0) return node;
		for (const child of node.childNodes) {
			const found = findText(child);
			if (found) return found;
		}
		return null;
	};
	const textNode = findText(answer.querySelector(".lo-markdown") ?? answer);
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
	/*
	 * ONE STRIP FOR ONE HIGHLIGHT (design D1 / UX U1). The quote toolkit already
	 * owns assistant prose, and it now carries Copy beside Quote and Speak; the
	 * shared toolbar must stand down, not paint a second panel underneath it.
	 */
	const quoteStrip = dom.window.document.querySelector(
		"[data-lo-quote-toolkit]",
	);
	assert.ok(quoteStrip, "the assistant selection has its owning strip");
	assert.equal(
		dom.window.document.querySelector("[data-lo-selection-toolbar]") === null,
		true,
		"and the shared toolbar is not mounted beside it",
	);
	assert.ok(
		quoteStrip.querySelector('button[aria-label="Quote"]'),
		"Quote is preserved",
	);
	const stripCopy = quoteStrip.querySelector(
		'button[aria-label="Copy selection"]',
	);
	assert.ok(stripCopy, "Copy acts on the same highlight");
	assert.ok(
		quoteStrip.querySelector('button[aria-label="Speak aloud"]'),
		"one Speak control rides the same strip",
	);
	assert.ok(
		quoteStrip.className.includes("z-20"),
		"the strip sits above the row's own gutter controls",
	);
	assert.ok(
		answer.hasAttribute("data-lo-selection-active"),
		"the row marks that a selection strip owns its trailing seat",
	);
	const responseControl = answer.querySelector("[data-lo-gutter-actions]");
	assert.ok(responseControl, "the response gutter is still mounted");
	assert.ok(
		responseControl.hasAttribute("inert"),
		"but it is inert while the selection strip owns the seat",
	);
	answer.focus();
	assert.ok(
		answer.hasAttribute("data-lo-selection-active"),
		"and focusing the response row does not clear the ownership",
	);
	await rig.click(stripCopy);
	assert.equal(rig.written.length, 1);
	assert.ok(
		rig.written[0].startsWith("I will read"),
		"the strip copies the highlight, not the whole message",
	);
	/*
	 * The press and the focus may have collapsed the jsdom selection; re-create
	 * it so the menu's Copy selection is asked against a live highlight, which
	 * is the same state the reader is in after pressing the strip.
	 */
	selection.removeAllRanges();
	selection.addRange(range);
	await act(async () => {
		dom.window.document.dispatchEvent(
			new dom.window.MouseEvent("mouseup", { bubbles: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	const menu = await rig.openMenu(answer);
	assert.notEqual(
		rig.menuItem(menu, "Copy selection").getAttribute("aria-disabled"),
		"true",
		"with a highlight in hand, Copy selection is offered",
	);
	await rig.click(rig.menuItem(menu, "Copy selection"));
	assert.equal(rig.written.length, 2);
	assert.ok(
		rig.written[1].startsWith("I will read"),
		"the menu's Copy selection writes the same highlight",
	);
	/*
	 * Clearing the highlight restores the row's own controls: the marker and the
	 * inert/aria-hidden suppression must not survive the selection they were for.
	 */
	selection.removeAllRanges();
	await act(async () => {
		dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	assert.equal(
		answer.hasAttribute("data-lo-selection-active"),
		false,
		"clearing removes the ownership marker",
	);
	assert.equal(
		responseControl.hasAttribute("inert"),
		false,
		"and restores the response gutter to the hit test",
	);
	assert.equal(
		responseControl.hasAttribute("aria-hidden"),
		false,
		"and removes its hidden accessibility state",
	);
	await rig.unmount();
});

test("a user selection raises Copy and Speak but no Quote", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const user = rowOf(dom, "u1");
	const bubble = user.querySelector("[data-glass-block]");
	assert.ok(bubble, "the user bubble is on screen");
	const findText = (node) => {
		if (node.nodeType === 3 && node.textContent.trim().length > 0) return node;
		for (const child of node.childNodes) {
			const found = findText(child);
			if (found) return found;
		}
		return null;
	};
	const textNode = findText(bubble);
	assert.ok(textNode, "the bubble has a text node to select");
	const range = dom.window.document.createRange();
	range.selectNodeContents(textNode);
	const selection = dom.window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	await act(async () => {
		dom.window.document.dispatchEvent(
			new dom.window.MouseEvent("mouseup", { bubbles: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	const strip = dom.window.document.querySelector("[data-lo-quote-toolkit]");
	assert.ok(strip, "the user turn's selection has its own strip");
	assert.equal(
		strip.querySelector('button[aria-label="Quote"]') === null,
		true,
		"a user selection offers no Quote",
	);
	assert.ok(
		strip.querySelector('button[aria-label="Copy selection"]'),
		"Copy is offered",
	);
	assert.ok(
		strip.querySelector('button[aria-label="Speak aloud"]'),
		"Speak is offered",
	);
	assert.equal(
		dom.window.document.querySelector("[data-lo-selection-toolbar]") === null,
		true,
		"the shared toolbar does not double the user strip",
	);
	const userControl = user.querySelector("[data-lo-user-actions]");
	assert.ok(userControl, "the user gutter is still mounted");
	assert.ok(
		userControl.hasAttribute("inert"),
		"and it is inert while the selection strip owns the seat",
	);
	await rig.unmount();
});

test("a selection outside a quotable turn still gets the shared Copy/Speak strip", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const bar = dom.window.document.querySelector(
		'[data-turn-summary] button[aria-expanded="false"]',
	);
	assert.ok(bar, "the turn opens as a bar");
	await rig.click(bar);
	const fold = dom.window.document.querySelector("[data-fold-ids]");
	assert.ok(fold, "the ledger fold is on screen");
	const summary = fold.querySelector("[data-fold-summary]");
	assert.ok(summary, "the fold header is the line to select");
	const findText = (node) => {
		if (node.nodeType === 3 && node.textContent.trim().length > 0) return node;
		for (const child of node.childNodes) {
			const found = findText(child);
			if (found) return found;
		}
		return null;
	};
	const textNode = findText(summary);
	assert.ok(textNode, "the fold header has a text node to select");
	const range = dom.window.document.createRange();
	range.selectNodeContents(textNode);
	const selection = dom.window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	await act(async () => {
		dom.window.document.dispatchEvent(
			new dom.window.MouseEvent("mouseup", { bubbles: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	assert.equal(
		dom.window.document.querySelector("[data-lo-quote-toolkit]") === null,
		true,
		"no quote strip owns a ledger header",
	);
	const shared = dom.window.document.querySelector(
		"[data-lo-selection-toolbar]",
	);
	assert.ok(shared, "the shared Copy/Speak toolbar takes the selection");
	assert.ok(shared.querySelector('button[aria-label="Copy"]'), "with Copy");
	await rig.unmount();
});

/*
 * THE TOOLBAR STATE MACHINE (operator report, 2026-10-19).
 *
 * The defect was not one toolbar's CSS: it was TWO independent booleans, each
 * read from a different event, and a third surface (the row's own action row)
 * that read neither. A still frame cannot pin that - what can is the
 * (selection, hover) matrix below, asserted as "how many toolbars are on
 * screen" per state rather than as a pixel.
 *
 * The four states are the operator's four: neither, hover only, selection on a
 * row that is ALSO hovered (the overlap the screenshot shows), and a selection
 * outside a quotable turn (the shared strip's own case, covered above and
 * extended here with the column marker).
 *
 * `hover` is driven as `focus` on the row: the reveal is `group-hover` and
 * `group-focus-within` over the SAME opacity rule (`message-actions.ts`), and
 * jsdom has no `:hover`. That is the closest instrument this harness has, and
 * it is the state the CSS treats identically.
 */
test("exactly one toolbar is mounted for every (selection, hover) pair", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const doc = dom.window.document;
	const content = doc.querySelector("[data-lo-transcript-content]");
	assert.ok(content, "the transcript publishes its content root");

	const toolbars = () => [
		...doc.querySelectorAll(
			"[data-lo-quote-toolkit], [data-lo-selection-toolbar], [data-lo-link-toolbar]",
		),
	];
	const findText = (node) => {
		if (node.nodeType === 3 && node.textContent.trim().length > 0) return node;
		for (const child of node.childNodes) {
			const found = findText(child);
			if (found) return found;
		}
		return null;
	};
	const highlight = async (row) => {
		const textNode = findText(row);
		assert.ok(textNode, "the row has a text node to select");
		const range = doc.createRange();
		range.selectNodeContents(textNode);
		const selection = dom.window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		await act(async () => {
			doc.dispatchEvent(new dom.window.Event("selectionchange"));
			doc.dispatchEvent(
				new dom.window.MouseEvent("mouseup", { bubbles: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		return selection;
	};

	// 1. NEITHER: nothing selected, nothing focused.
	assert.equal(toolbars().length, 0, "no selection and no hover shows nothing");
	assert.equal(
		content.hasAttribute("data-lo-selection-live"),
		false,
		"and the column does not claim a live selection",
	);

	// 2. HOVER ONLY: the row's own cluster is the one toolbar, and it is not
	//    suppressed - the rule must not be satisfied by hiding everything.
	const answer = rowOf(dom, "a2");
	const answerCluster = answer.querySelector("[data-lo-answer-actions]");
	assert.ok(answerCluster, "the closing answer owns a cluster");
	await act(async () => {
		answer.focus();
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
	assert.equal(toolbars().length, 0, "hover alone raises no selection toolbar");
	assert.equal(
		answerCluster.hasAttribute("inert"),
		false,
		"and the row's own cluster stays interactive",
	);

	// 3. SELECTION ON A HOVERED ROW: the overlap state. Exactly ONE toolbar -
	//    the quote strip - and the row's cluster stands down in the same commit.
	const selection = await highlight(answer);
	assert.equal(
		toolbars().length,
		1,
		`a hovered row with a selection shows one toolbar, not ${toolbars().length}`,
	);
	assert.ok(
		toolbars()[0].hasAttribute("data-lo-quote-toolkit"),
		"and it is the quote strip that owns the highlight",
	);
	assert.equal(
		toolbars()[0].querySelectorAll("button").length,
		3,
		"Quote, Copy and Speak ride the one strip",
	);
	assert.equal(
		content.hasAttribute("data-lo-selection-live"),
		true,
		"the column publishes the live selection before paint",
	);
	assert.equal(
		answer.hasAttribute("data-lo-selection-active"),
		true,
		"the row marks that a strip owns its seat",
	);
	assert.equal(
		answerCluster.hasAttribute("inert"),
		true,
		"the row's own cluster is out of the hit test",
	);
	assert.equal(
		answerCluster.getAttribute("aria-hidden"),
		"true",
		"and out of the accessibility tree",
	);

	// 4. CLEARED: back to neither, with the row's own controls restored. A
	//    stale marker here is the "toolbar stays up with no highlight" defect.
	await act(async () => {
		selection?.removeAllRanges();
		doc.dispatchEvent(new dom.window.Event("selectionchange"));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	assert.equal(toolbars().length, 0, "clearing removes the selection strip");
	assert.equal(
		content.hasAttribute("data-lo-selection-live"),
		false,
		"and the column marker",
	);
	assert.equal(
		answer.hasAttribute("data-lo-selection-active"),
		false,
		"and the row marker",
	);
	assert.equal(
		answerCluster.hasAttribute("inert"),
		false,
		"and the cluster is interactive again",
	);
	assert.equal(answerCluster.hasAttribute("aria-hidden"), false);

	await rig.unmount();
});

test("a non-quotable selection also publishes the column marker", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const doc = dom.window.document;
	const bar = doc.querySelector(
		'[data-turn-summary] button[aria-expanded="false"]',
	);
	assert.ok(bar, "the turn opens as a bar");
	await rig.click(bar);
	const summary = doc.querySelector("[data-fold-ids] [data-fold-summary]");
	assert.ok(summary, "the fold header is the line to select");
	const findText = (node) => {
		if (node.nodeType === 3 && node.textContent.trim().length > 0) return node;
		for (const child of node.childNodes) {
			const found = findText(child);
			if (found) return found;
		}
		return null;
	};
	const textNode = findText(summary);
	const range = doc.createRange();
	range.selectNodeContents(textNode);
	const selection = dom.window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	await act(async () => {
		doc.dispatchEvent(new dom.window.Event("selectionchange"));
		doc.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	assert.ok(
		doc.querySelector("[data-lo-selection-toolbar]"),
		"the shared strip is the owner",
	);
	assert.ok(
		doc
			.querySelector("[data-lo-transcript-content]")
			?.hasAttribute("data-lo-selection-live"),
		"and the column knows a selection is live, so row clusters stand down",
	);
	await rig.unmount();
});

/*
 * CLEARING A SELECTION MUST RESTORE *EVERY* ROW'S CONTROLS (agent review round
 * 1, C1). The shared strip's effect once wrote `inert`/`aria-hidden` on all
 * three clusters and then refused to remove any of them while a peer strip was
 * present - so the rows the quote toolkit never owns (the user row and the
 * intermediate response) kept both attributes after the selection was gone:
 * their presses did nothing. The regression is asserted on the rows that
 * expose it, not on the row the quote toolkit happens to own.
 */
test("clearing a selection restores the rows the quote toolkit never owned", async () => {
	const rig = await mountTranscript(MULTI_TURN);
	const dom = rig.dom;
	const doc = dom.window.document;
	const userCluster = rowOf(dom, "u1").querySelector("[data-lo-user-actions]");
	const responseCluster = rowOf(dom, "a1").querySelector(
		"[data-lo-gutter-actions]",
	);
	assert.ok(userCluster, "the user row owns a cluster");
	assert.ok(responseCluster, "the intermediate response owns a cluster");

	const answer = rowOf(dom, "a2");
	const walker = doc.createTreeWalker(answer, dom.window.NodeFilter.SHOW_TEXT);
	const textNode = walker.nextNode();
	assert.ok(textNode, "the closing answer has a text node");
	const range = doc.createRange();
	range.selectNodeContents(textNode);
	const selection = dom.window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	await act(async () => {
		doc.dispatchEvent(new dom.window.Event("selectionchange"));
		doc.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	/*
	 * The visibility of those two rows WHILE the strip is up is the stylesheet's
	 * `visibility: hidden` (jsdom applies no CSS), so the assertion that matters
	 * here is the OUTCOME after the selection is gone: a stale `inert` is what
	 * killed their presses in the review's reproduction.
	 */

	await act(async () => {
		selection.removeAllRanges();
		doc.dispatchEvent(new dom.window.Event("selectionchange"));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	assert.equal(
		userCluster.hasAttribute("inert"),
		false,
		"clearing restores the user row - a stale inert kills its presses",
	);
	assert.equal(
		userCluster.getAttribute("aria-hidden"),
		null,
		"and returns it to the accessibility tree",
	);
	assert.equal(
		responseCluster.hasAttribute("inert"),
		false,
		"clearing restores the intermediate response as well",
	);
	assert.equal(responseCluster.getAttribute("aria-hidden"), null);
	await rig.unmount();
});

/*
 * THE PRE-PAINT CHECK IS LOAD-BEARING (agent review round 1, C4; closed in
 * round 2 after the reviewer proved the mount works here).
 *
 * The shared strip has two mechanisms for "an owning strip is already here":
 * a pre-paint `useLayoutEffect` and a `MutationObserver` catch-up. With the
 * observer present, a test that waits 30ms cannot tell which one removed the
 * panel - deleting the layout effect still passes, because the observer
 * arrives inside the same settle. This case mounts with NO observer, so the
 * only thing that can keep the panel out of the DOM is the pre-paint check.
 *
 * The round-1 rejection claimed this mount was impossible; the round-2
 * reviewer showed `use-transcript-dom-window.ts:405` is not reached because
 * `containerRef` is null in this harness. The mount works, so the test exists.
 */
test("the shared strip never mounts beside an owning strip without an observer", async () => {
	const rig = await mountTranscript(MULTI_TURN, { mutations: false });
	const dom = rig.dom;
	const doc = dom.window.document;
	const answer = rowOf(dom, "a2");
	const walker = doc.createTreeWalker(answer, dom.window.NodeFilter.SHOW_TEXT);
	const textNode = walker.nextNode();
	assert.ok(textNode, "the closing answer has a text node");
	const range = doc.createRange();
	range.selectNodeContents(textNode);
	const selection = dom.window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	await act(async () => {
		doc.dispatchEvent(new dom.window.Event("selectionchange"));
		doc.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	assert.ok(
		doc.querySelector("[data-lo-quote-toolkit]"),
		"the quote strip owns the highlight",
	);
	assert.equal(
		doc.querySelector("[data-lo-selection-toolbar]"),
		null,
		"and the shared strip did not mount beside it without an observer to stand it down",
	);
	await rig.unmount();
});
