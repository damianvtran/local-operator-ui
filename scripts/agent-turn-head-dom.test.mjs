/**
 * The transcript's turn head for an agent with NO picture: no element, and no
 * gap, above the turn's first tool row (operator, 2026-11-04: "make the photo
 * icon not appear if the agent doesn't have an image yet, it doesn't need to be
 * there or occupy space").
 *
 * WHAT IS REAL: the whole `CanonicalTranscript` rendering a reduced history
 * page (user turn, then a bash call and its result), and `decideAvatarMark`
 * producing the mark the page would hand it. The mark is decided here from
 * facts rather than through `useAgentSlotMark`, because that hook reads the
 * desktop transport; the decision is the one the page calls.
 *
 * jsdom has no layout engine, so "no gap" is asserted structurally: the first
 * tool row's entry wrapper has no turn-avatar wrapper (`data-turn-avatar-gap`,
 * which carries the mb-* gap) and no `data-agent-mark` before it. The pixel
 * offsets are the PR's rendered evidence (`docs/pr-evidence/agent-avatar-no-placeholder`).
 * The harness is `receipt-fold-behaviour.test.mjs`'s.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
const rafQueue = [];
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	localStorage: window.localStorage,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => {
		rafQueue.push(callback);
		return rafQueue.length;
	},
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	MutationObserver: window.MutationObserver,
	NodeFilter: window.NodeFilter,
	HTMLInputElement: window.HTMLInputElement,
	IntersectionObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
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
window.requestAnimationFrame = shims.requestAnimationFrame;
window.cancelAnimationFrame = shims.cancelAnimationFrame;
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const bundle = await build({
	stdin: {
		contents: [
			'export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { decideAvatarMark } from "./src/renderer/src/shared/agent-avatar/avatar-presence";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_agent-turn-head-dom-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	applyHistoryPage,
	EMPTY_TRANSCRIPT,
	CanonicalTranscript,
	decideAvatarMark,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_792_000_000;
let sequence = 0;
const entry = (payload) => {
	sequence += 1;
	return {
		id: `entry-${sequence}`,
		ts: TS + sequence,
		type: "message",
		payload,
	};
};
const records = () =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry({
				kind: "message",
				role: "user",
				content: [{ text: "Run the tests." }],
			}),
			entry({
				kind: "message",
				role: "assistant",
				tool_calls: [
					{
						id: "call-1",
						name: "bash",
						arguments: { command: "pnpm test", i: "Running the tests" },
					},
				],
				stop_reason: "toolUse",
			}),
			entry({
				kind: "message",
				role: "tool",
				tool_call_id: "call-1",
				tool_name: "bash",
				content: [{ text: "exit code: 0\n--- stdout ---\nok" }],
				is_error: false,
			}),
		],
		has_more: false,
		cursor_missing: false,
	}).records;

const mount = async (t, agentMark) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	let root;
	t.after(async () => {
		await act(async () => root?.unmount());
		container.remove();
	});
	const list = records();
	await act(async () => {
		root = createRoot(container);
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(CanonicalTranscript, {
					frontend: null,
					attachmentScope: undefined,
					transcript: {
						records: list,
						index: new Map(
							list.map((record, position) => [record.id, position]),
						),
						generation: 1,
						oldestId: null,
						hasMore: false,
						argsByCall: new Map(),
					},
					openFrame: undefined,
					gate: null,
					waiting: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: container },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
					agentMark,
					agentName: "coder",
				}),
			),
		);
	});
	for (let depth = 0; depth < 4 && rafQueue.length > 0; depth += 1) {
		const queued = rafQueue.splice(0);
		await act(async () => {
			for (const callback of queued) callback(0);
		});
	}
	return container;
};

const base = {
	agentId: "agent-1",
	agentName: "coder",
	src: null,
	settled: true,
	owned: true,
};

/* Every pictureless state the turn head can be asked about, owned and not. */
const PICTURELESS = [
	["absent", base],
	["failed (claimed, no bytes)", { ...base, claimed: true }],
	["unreadable list", { ...base, unreadable: true }],
	["cold, unclaimed", { ...base, settled: false }],
	["uploading a first picture", { ...base, uploading: true }],
];

for (const [label, facts] of PICTURELESS) {
	for (const owned of [true, false]) {
		test(`no picture (${label}, ${owned ? "owned" : "not owned"}): nothing and no gap above the first tool row`, async (t) => {
			const mark = decideAvatarMark({ ...facts, owned });
			assert.equal(mark, null, "the decision answers nothing");
			const container = await mount(t, mark);
			/* The agent turn's first row: the bash call, folded as "1 action". */
			assert.match(container.textContent, /1 action/, "the tool row rendered");
			assert.equal(
				container.querySelector("[data-agent-mark]"),
				null,
				"no mark",
			);
			assert.equal(
				container.querySelector("[data-turn-avatar-gap]"),
				null,
				"no turn-avatar wrapper, so no gap",
			);
			assert.equal(
				container.querySelector("[data-agent-avatar-edit]"),
				null,
				"no door",
			);
		});
	}
}

test("a picture draws once at the turn head, above the tool row, with no door (control)", async (t) => {
	const mark = decideAvatarMark({ ...base, src: "blob:fixture" });
	assert.equal(mark.kind, "picture");
	/* The page strips the door for the turn head (`pictureDoor: false`). */
	const container = await mount(t, { ...mark, door: null });
	const marks = container.querySelectorAll("[data-agent-mark]");
	assert.equal(marks.length, 1, "one mark for one turn");
	const gap = container.querySelector("[data-turn-avatar-gap]");
	assert.ok(gap, "the mark sits in its gap wrapper");
	assert.equal(container.querySelector("[data-agent-avatar-edit]"), null);
	/* It precedes the tool row's text in document order. */
	const text = [...container.querySelectorAll("*")].find(
		(node) =>
			/1 action/.test(node.textContent ?? "") && node.children.length === 0,
	);
	assert.ok(text, "the tool row's text is in the DOM");
	assert.ok(
		gap.compareDocumentPosition(text) & window.Node.DOCUMENT_POSITION_FOLLOWING,
		"the mark is above the first tool row",
	);
});
