/**
 * Arrival is a live-tail event, never a history landing (PR #1872 agent review
 * round 2, R2-1).
 *
 * Every pane starts with no session id, and the transcript keeps the null
 * pane's key when it learns its first stated id (Q1, `foldIdentityFor`) so a
 * new chat's echo keeps its node. The arrival ledger is keyed the same way, so
 * without a re-seed at that learn, a cold open of a conversation that is
 * mid-turn - whose first snapshot lands the id and the whole history in one
 * commit - classed every history row as arriving and every user row rose.
 *
 * WHAT IS REAL: the whole `CanonicalTranscript` over reducer-built records; the
 * harness is `agent-turn-head-dom.test.mjs`'s.
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
	`./_transcript-arrival-cold-open-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { applyHistoryPage, EMPTY_TRANSCRIPT, CanonicalTranscript } =
	await import(bundlePath.href);
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
const user = (text) =>
	entry({ kind: "message", role: "user", content: [{ text }] });
const answer = (text) =>
	entry({
		kind: "message",
		role: "assistant",
		content: [{ text }],
		stop_reason: "stop",
	});
const recordsOf = (entries) =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries,
		has_more: false,
		cursor_missing: false,
	}).records;
const transcriptOf = (list) => ({
	records: list,
	index: new Map(list.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
	viewEpoch: 0,
});
const FRONTEND = { session_id: "abc123def456", cwd: "/tmp", epoch: 1 };
// `waiting: true` is `canonical.turnAlive`: the turn is live, so the pane is.
const props = (frontend, list) => ({
	frontend,
	attachmentScope: undefined,
	transcript: transcriptOf(list),
	openFrame: undefined,
	gate: null,
	waiting: true,
	loadingOlder: false,
	onLoadOlder: async () => true,
	containerRef: { current: null },
	isSmallView: false,
	status: "live",
	failure: null,
	awaitingHydration: false,
	onReconnect: () => {},
	agentMark: null,
	agentName: "coder",
});

const flush = async () => {
	for (let depth = 0; depth < 4 && rafQueue.length; depth++) {
		const queued = rafQueue.splice(0);
		await act(async () => {
			for (const callback of queued) callback(0);
		});
	}
};

const mount = async (t) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	return {
		container,
		render: async (next) => {
			await act(async () =>
				root.render(
					h(QueryClientProvider, { client }, h(CanonicalTranscript, next)),
				),
			);
			await flush();
		},
	};
};

const ARRIVAL = ".lo-transcript-arrival-rise, .lo-transcript-arrival";
/** The row element carrying `text`, found by its arrival-classable wrapper. */
const rowWith = (container, text) =>
	[...container.querySelectorAll("[data-record-id], .group")].find((node) =>
		node.textContent.includes(text),
	) ?? null;
const arrivingTexts = (container) =>
	[...container.querySelectorAll(ARRIVAL)].map((node) => node.textContent);

/* --------------------------------- tests -------------------------------- */

test("a cold-opened mid-turn conversation's history does not arrive when its id lands with it", async (t) => {
	const { container, render } = await mount(t);
	// The stream before its first snapshot: no id, no rows.
	await render(props(null, []));
	// The first snapshot names the session and lands the history in one commit.
	const history = recordsOf([
		user("Question 0"),
		answer("Answer 0"),
		user("Question 1"),
		answer("Answer 1"),
		user("Question 2"),
	]);
	await render(props(FRONTEND, history));
	assert.match(container.textContent, /Question 2/);
	assert.deepEqual(arrivingTexts(container), []);
});

test("a new chat's echo keeps its node and its arrival through the id being learned", async (t) => {
	const { container, render } = await mount(t);
	await render(props(null, []));
	// The press paints the echo before the owner has named the session.
	const echo = recordsOf([user("Hello there")]);
	await render(props(null, echo));
	const before = rowWith(container, "Hello there");
	assert.ok(before, "the echo is painted");
	assert.equal(
		container.querySelectorAll(".lo-transcript-arrival-rise").length,
		1,
	);
	// The first snapshot names the session and carries the same row.
	await render(props(FRONTEND, echo));
	const risen = container.querySelectorAll(".lo-transcript-arrival-rise");
	assert.equal(risen.length, 1, "the echo is still arrival-classed");
	assert.ok(risen[0].textContent.includes("Hello there"));
	assert.ok(risen[0].isConnected);
	assert.equal(
		rowWith(container, "Hello there"),
		before,
		"the echo keeps its DOM node",
	);
});

test("a genuinely new row after the id is learned still arrives", async (t) => {
	const { container, render } = await mount(t);
	await render(props(null, []));
	const entries = [user("Question 0"), answer("Answer 0")];
	await render(props(FRONTEND, recordsOf(entries)));
	assert.deepEqual(arrivingTexts(container), []);
	const live = recordsOf([...entries, user("A brand new message")]);
	await render(props(FRONTEND, live));
	const texts = arrivingTexts(container);
	assert.equal(texts.length, 1);
	assert.match(texts[0], /A brand new message/);
});
