/**
 * The user turn's copy arm, mounted where it ships.
 *
 * WHAT THIS FILE IS, exactly: `CanonicalTranscript` rendered through a real
 * jsdom root with two records - the reader's own turn and the answer's - and
 * then the DOM is asked what a frame cannot answer:
 *
 *   1. WHICH ROWS HAVE WHICH ROW: the user turn carries exactly one
 *      `data-lo-user-actions` toolbar offering Copy first and no Speak (see
 *      `answerActionsFor`) - and, since #1002, Fork beside it, because this
 *      mount names both the conversation and the record's own journal id, so
 *      the row is a cut point - the answer carries exactly one
 *      `data-lo-answer-actions`, and the user row sits UNDER the bubble in the
 *      turn's own column (the mount site, not just its presence).
 *   2. WHAT A PRESS COPIES, which is the visible text: a turn that was itself
 *      a reply carries the `<reply-to>` transport markup in `record.text`, and
 *      the copy must be what the prose renders - the REPLY - rather than the
 *      markup that prefixed it (memo (e), the same rule the answer's row
 *      holds).
 *   3. THE GATE, on the user arm: a turn with no words mounts no row, the
 *      `isQuotable` rule the quote control reads.
 *   4. THE REVEAL, as rendered: the row wears the resting fade and its column
 *      is the `group` that clears it.
 *
 * WHAT THIS FILE DOES NOT PROVE: the answer row's own press (that is
 * `message-actions.test.mjs`, which mounts the same component directly), or
 * any pixel - the frames are the design round's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The bootstrap document, before the graph is evaluated, and the
 * `localStorage` beside it: see `speech-selection.test.mjs` for the measurements
 * (Radix's module-scope DOM capture, and the persisted stores' storage read at
 * module scope).
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
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
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

const bundle = await build({
	stdin: {
		contents: `
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
			export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
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
	`./_speech-user-copy-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const GATE_TS = 1_760_000_000_000;

const gateUser = (id, text) => ({
	kind: "user",
	id,
	ts: GATE_TS,
	text,
	images: [],
});

const gateAnswer = (id, text) => ({
	kind: "assistant",
	id,
	ts: GATE_TS + 1_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});

const mountTranscript = async (records) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	/* The transcript's own effects schedule through a bare rAF (the paging and
	 * reveal loops), which the jsdom window has and the process global does not. */
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

	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	const transcript = {
		...mod.EMPTY_TRANSCRIPT,
		records,
		index: new Map(records.map((row, at) => [row.id, at])),
	};
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{
					client: new QueryClient({
						defaultOptions: { queries: { retry: false } },
					}),
				},
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
	const userRow = () =>
		dom.window.document.querySelector("[data-lo-user-actions]");
	const answerRow = () =>
		dom.window.document.querySelector("[data-lo-answer-actions]");
	const press = async (button) => {
		await act(async () => {
			button.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	const unmount = async () => {
		await act(async () => {
			root.unmount();
		});
	};
	return { dom, userRow, answerRow, press, written, unmount };
};

test("the user turn carries the copy row under its bubble, and only the answer speaks", async () => {
	const { dom, userRow, answerRow, unmount } = await mountTranscript([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "It finished with the same four invoices outstanding."),
	]);
	const row = userRow();
	assert.ok(row, "the user turn carries a row");
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-user-actions]").length,
		1,
		"exactly one, on the user turn",
	);
	assert.ok(answerRow(), "the answer's own row is untouched");
	/*
	 * The mount site, not just the presence: the row is a SIBLING OF THE BUBBLE
	 * ROW inside the turn's column, which is what makes it read under the
	 * message rather than beside it.
	 */
	assert.match(
		row.previousElementSibling?.textContent ?? "",
		/Is the March import finished\?/,
		"the row sits directly under the bubble",
	);
	const labels = [...row.querySelectorAll("button")].map((button) =>
		button.getAttribute("aria-label"),
	);
	assert.deepEqual(
		labels,
		["Copy", "Fork from this message"],
		"Copy first and no Speak on the reader's own words; Fork rides along because this mount names the conversation AND the record's own journal id, which is a cut point (#1002)",
	);
	/*
	 * The reveal, as rendered: the resting fade is on the row, and the group
	 * that clears it is the turn's own column.
	 */
	assert.ok(row.classList.contains("opacity-0"), "fades at rest");
	assert.ok(
		row.classList.contains("group-hover:opacity-100"),
		"revealed by the turn's hover",
	);
	assert.ok(
		row.parentElement?.classList.contains("group"),
		"the column above is the group",
	);
	await unmount();
});

test("the press copies the visible text, not the reply markup it was sent under", async () => {
	const visible = "It finished with four outstanding.";
	const { userRow, press, written, unmount } = await mountTranscript([
		gateUser(
			"u1",
			`<reply-to>What was the invoice total?</reply-to>\n\n${visible}`,
		),
		gateAnswer("a1", "Four, as before."),
	]);
	const row = userRow();
	await press(row.querySelector('button[aria-label="Copy"]'));
	assert.deepEqual(
		written,
		[visible],
		"the copy is the prose, the same text the transcript renders",
	);
	assert.ok(!written[0].includes("reply-to"), "never the transport markup");
	await unmount();
});

test("a user turn with no words mounts no row", async () => {
	const { dom, userRow, unmount } = await mountTranscript([
		gateUser("u1", ""),
		gateAnswer("a1", "Four, as before."),
	]);
	assert.equal(userRow(), null, "nothing to copy, nothing offered");
	assert.equal(
		dom.window.document.querySelectorAll("[data-lo-answer-actions]").length,
		1,
		"and the answer's row is still there",
	);
	await unmount();
});
