/**
 * THE SPOKEN SUMMARY IN THE REAL TRANSCRIPT ROW.
 *
 * WHAT IS REAL: the whole `CanonicalTranscript` rendering a reduced history page
 * (a voiced user turn, then an assistant answer ending in a `Spoken:` paragraph)
 * and the shipped voice store the block reads. Pinned: the paragraph is drawn as
 * a labelled block and never as prose; the block claims "Spoken aloud" with Replay
 * only for a message this window spoke from the summary; a streaming paragraph is
 * a block from its label on and a half-written label is held back; and a reply
 * with no paragraph draws nothing - the block is never invented. Layout and
 * colour are the Storybook frames' (`docs/pr-evidence/voice-spoken-summary`).
 * The harness is `agent-turn-head-dom.test.mjs`'s.
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
			'export { useVoiceStore } from "./src/renderer/src/features/voice/voice-store";',
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
	`./_spoken-summary-transcript-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	applyHistoryPage,
	EMPTY_TRANSCRIPT,
	CanonicalTranscript,
	useVoiceStore,
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
const SESSION = "a1a1a1a1a1a1";
const REPLY = "Here are the hooks:\n\n- PreToolUse\n- SessionStart";
const SUMMARY = "Use SessionStart; it runs after every reset.";

const recordsFor = (assistantText, streaming = false) => {
	const list = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry({
				kind: "message",
				role: "user",
				content: [{ text: "Which hook reloads the memory?" }],
			}),
			entry({
				kind: "message",
				role: "assistant",
				content: [{ text: assistantText }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	}).records;
	return streaming
		? list.map((record) =>
				record.kind === "assistant" ? { ...record, streaming: true } : record,
			)
		: list;
};

const mount = async (t, list) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	let root;
	t.after(async () => {
		await act(async () => root?.unmount());
		container.remove();
		useVoiceStore.setState({
			active: undefined,
			rig: undefined,
			spoken: {},
			exchange: null,
			activity: null,
			lastSpoken: null,
		});
	});
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
					conversationId: SESSION,
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

const voiceOn = async () => {
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive({ session_id: SESSION, enabled_at: 1 });
		store.setRig({ rig: "ready", webui_url: null, clients: 1 });
	});
};

test("a settled reply's Spoken: paragraph is a block at the end, and the label is not prose", async (t) => {
	const list = recordsFor(`${REPLY}\n\nSpoken: ${SUMMARY}`);
	const container = await mount(t, list);
	const block = container.querySelector("[data-spoken-summary]");
	assert.ok(block, "the block drew");
	assert.equal(block.getAttribute("data-spoken-summary"), "static");
	assert.match(block.textContent, /Spoken summary/);
	assert.match(block.textContent, new RegExp(SUMMARY));
	assert.equal(block.querySelector("[data-spoken-control]"), null);
	assert.doesNotMatch(container.textContent, /Spoken: /, "no raw label");
	assert.match(
		container.textContent,
		/PreToolUse/,
		"the reply above is untouched",
	);
	// At the END: nothing of the reply follows the block inside the answer.
	const reply = [...container.querySelectorAll("li")].at(-1);
	assert.ok(
		reply.compareDocumentPosition(block) &
			window.Node.DOCUMENT_POSITION_FOLLOWING,
	);
});

test("no paragraph, no block: it is never invented", async (t) => {
	const container = await mount(t, recordsFor(REPLY));
	assert.equal(container.querySelector("[data-spoken-summary]"), null);
	assert.equal(container.querySelector("[data-spoken-reply-note]"), null);
	assert.match(container.textContent, /SessionStart/);
});

test("a marker quoted in a code fence is code, not a block", async (t) => {
	const container = await mount(
		t,
		recordsFor("Example of the protocol:\n\n```\nSpoken: not a block\n```"),
	);
	assert.equal(container.querySelector("[data-spoken-summary]"), null);
	assert.match(container.textContent, /Spoken: not a block/);
});

test("a message this window spoke from the summary reads Spoken aloud, with Replay", async (t) => {
	const list = recordsFor(`${REPLY}\n\nSpoken: ${SUMMARY}`);
	const messageId = list.find((record) => record.kind === "assistant").id;
	await voiceOn();
	await act(async () => {
		useVoiceStore.getState().setLastSpoken({
			sessionId: SESSION,
			text: SUMMARY,
			truncated: false,
			messageId,
			source: "summary",
			at: Date.now(),
		});
	});
	const container = await mount(t, list);
	const block = container.querySelector("[data-spoken-summary]");
	assert.equal(block.getAttribute("data-spoken-summary"), "spoken");
	assert.ok(block.querySelector('[data-spoken-control="replay"]'));
});

test("voice off hides Replay again even for a message that was spoken", async (t) => {
	const list = recordsFor(`${REPLY}\n\nSpoken: ${SUMMARY}`);
	const messageId = list.find((record) => record.kind === "assistant").id;
	await act(async () => {
		useVoiceStore.getState().setLastSpoken({
			sessionId: SESSION,
			text: SUMMARY,
			truncated: false,
			messageId,
			source: "summary",
			at: Date.now(),
		});
	});
	const container = await mount(t, list);
	const block = container.querySelector("[data-spoken-summary]");
	assert.equal(block.getAttribute("data-spoken-summary"), "static");
	assert.equal(block.querySelector("[data-spoken-control]"), null);
});

test("a message spoken from the reply (an older server, or no paragraph) draws no block, and a cut says so in a footnote", async (t) => {
	const list = recordsFor(REPLY);
	const messageId = list.find((record) => record.kind === "assistant").id;
	await voiceOn();
	await act(async () => {
		useVoiceStore.getState().setLastSpoken({
			sessionId: SESSION,
			text: "Here are the hooks.",
			truncated: true,
			messageId,
			source: "reply",
			at: Date.now(),
		});
	});
	const container = await mount(t, list);
	assert.equal(container.querySelector("[data-spoken-summary]"), null);
	const note = container.querySelector("[data-spoken-reply-note]");
	assert.match(note.textContent, /Spoken aloud: first part only/);
	assert.ok(note.querySelector('[data-spoken-control="replay"]'));
});

test("streaming: the block draws from the label on, and a half-written label never shows", async (t) => {
	await voiceOn();
	await act(async () =>
		useVoiceStore.getState().setExchange("working", SESSION),
	);
	const partial = await mount(t, recordsFor(`${REPLY}\n\nSpo`, true));
	assert.equal(
		partial
			.querySelector("[data-spoken-summary]")
			?.getAttribute("data-spoken-summary"),
		"upcoming",
	);
	assert.doesNotMatch(partial.textContent, /Spo(?!ken summary|ken aloud)/);
	assert.match(partial.textContent, /To be spoken/);

	const words = await mount(
		t,
		recordsFor(`${REPLY}\n\nSpoken: Use Session`, true),
	);
	const blocks = words.querySelectorAll("[data-spoken-summary]");
	assert.equal(blocks.length, 1);
	assert.match(blocks[0].textContent, /Use Session/);
	assert.doesNotMatch(words.textContent, /Spoken: /);
});
