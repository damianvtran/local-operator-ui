/** Component state, not geometry proof: jsdom runs the real React effects and event handlers.
 * Transport is scripted; i18n/prose are inert seams. Real browser/layout QA remains independent. */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { Profiler, createElement as h } from "react";
const I18N_SEAM = /^@shared\/i18n(?:\/use-locale)?$/;
const API_SEAM = /^@shared\/api\/local-operator\/team-bridge-api$/;
const PROSE_SEAM = /^\.\/team-bridge-markdown$/;
const ANY_SEAM = /.*/;
const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Node",
	"SVGElement",
	"Event",
	"MouseEvent",
	"KeyboardEvent",
	"CustomEvent",
	"MutationObserver",
	"HTMLInputElement",
	"localStorage",
	"navigator",
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const bundle = await build({
	stdin: {
		contents: [
			'export {TeamBridgeReactions} from "./src/renderer/src/features/team-bridge/team-bridge-reactions";',
			'export {TeamBridgeMessageList} from "./src/renderer/src/features/team-bridge/team-bridge-message-list";',
			'export {TeamBridgeEmojiPicker} from "./src/renderer/src/features/team-bridge/team-bridge-emoji-picker";',
			'export {useReactionPreferences} from "./src/renderer/src/features/team-bridge/team-bridge-reaction-preferences";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
	jsx: "automatic",
	alias: { "@shared": "./src/renderer/src/shared" },
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	plugins: [
		{
			name: "external-boundaries",
			setup(b) {
				b.onResolve({ filter: I18N_SEAM }, (args) => ({
					path: args.path,
					namespace: "seam",
				}));
				b.onResolve({ filter: API_SEAM }, (args) => ({
					path: args.path,
					namespace: "seam",
				}));
				b.onResolve({ filter: PROSE_SEAM }, (args) => ({
					path: args.path,
					namespace: "seam",
				}));
				b.onLoad({ filter: ANY_SEAM, namespace: "seam" }, (args) => ({
					contents: args.path.includes("api/")
						? "export const TeamBridgeApi={react:(...args)=>globalThis.__reactionApi(...args)};"
						: args.path.includes("markdown")
							? "export const TeamBridgeMarkdown=({children})=>children;"
							: 'export const t=(key)=>key; export const useI18nLocale=()=>"en";export const formatDate=()=>"today";export const formatTime=()=>"12:00";',
					loader: "js",
				}));
			},
		},
	],
});
const file = new URL(
	`./_reaction-behaviour-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(file, bundle.outputFiles[0].text);
const {
	TeamBridgeReactions,
	TeamBridgeMessageList,
	TeamBridgeEmojiPicker,
	useReactionPreferences,
} = await import(file.href);
await unlink(file);
after(() => dom.window.close());
const props = {
	conversationId: "bcv_example1",
	messageId: "bcmsg_example1",
	accountId: "a",
	tenantId: "tnt_1",
};
const reaction = {
	emoji: "👍",
	count: 2,
	reacted_by_me: false,
	sample_labels: ["Bea"],
};
const mount = () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	return {
		host,
		root,
		close: async () => {
			await act(() => root.unmount());
			host.remove();
		},
	};
};
const click = async (node) => {
	await act(() =>
		node.dispatchEvent(new MouseEvent("click", { bubbles: true })),
	);
};

test("missing optional reactions settle without an effect-render loop", async () => {
	const m = mount();
	let renders = 0;
	await act(() =>
		m.root.render(
			h(
				Profiler,
				{
					id: "reactions",
					onRender: () => {
						renders++;
					},
				},
				h(TeamBridgeReactions, props),
			),
		),
	);
	assert.ok(renders <= 2, `rendered ${renders} times`);
	assert.equal(m.host.querySelectorAll("button").length, 1);
	await m.close();
});

test("busy toggle ignores polls, disables second input, and restores snapshot on refusal", async () => {
	const m = mount();
	let reject;
	let calls = 0;
	const toggle = () => {
		calls++;
		return new Promise((_resolve, no) => {
			reject = no;
		});
	};
	await act(() =>
		m.root.render(
			h(TeamBridgeReactions, { ...props, reactions: [reaction], toggle }),
		),
	);
	await click(m.host.querySelector("button[aria-pressed]"));
	assert.equal(m.host.querySelector("button[aria-pressed]").textContent, "👍3");
	assert.equal(m.host.querySelector("button[aria-pressed]").disabled, true);
	await click(m.host.querySelector("button[aria-pressed]"));
	assert.equal(calls, 1);
	await act(() =>
		m.root.render(
			h(TeamBridgeReactions, {
				...props,
				reactions: [{ ...reaction, count: 99 }],
				toggle,
			}),
		),
	);
	assert.equal(m.host.querySelector("button[aria-pressed]").textContent, "👍3");
	await act(async () => {
		reject(new Error("reaction_limit"));
		await Promise.resolve();
	});
	assert.equal(m.host.querySelector("button[aria-pressed]").textContent, "👍2");
	assert.ok(m.host.querySelector('[role="alert"]'));
	assert.equal(m.host.querySelector("button[aria-pressed]").disabled, false);
	await m.close();
});

test("account-keyed message-list mount cannot inherit a previous account's pending projection", async () => {
	const m = mount();
	let resolve;
	globalThis.__reactionApi = () =>
		new Promise((yes) => {
			resolve = yes;
		});
	const message = {
		id: "bcmsg_example1",
		conversation_id: "bcv_example1",
		seq: 1,
		sender: { account_id: "a", kind: "human", display_label: "Ada" },
		body: "hello",
		origin: "human",
		created_at: "2026-10-21",
		reactions: [reaction],
	};
	const render = (accountId) =>
		m.root.render(
			h(TeamBridgeMessageList, {
				messages: [message],
				labelFor: () => "Ada",
				reactionContext: { accountId, tenantId: "tnt_1" },
			}),
		);
	await act(() => render("a"));
	await click(m.host.querySelector("button[aria-pressed]"));
	assert.equal(m.host.querySelector("button[aria-pressed]").textContent, "👍3");
	await act(() => render("b"));
	assert.equal(m.host.querySelector("button[aria-pressed]").textContent, "👍2");
	await act(async () => {
		resolve({
			message_id: message.id,
			reactions: [{ ...reaction, count: 3, reacted_by_me: true }],
		});
		await Promise.resolve();
	});
	assert.equal(m.host.querySelector("button[aria-pressed]").textContent, "👍2");
	await m.close();
});

test("disabled picker never selects or closes; exact toned grid pick survives a different preference", async () => {
	const m = mount();
	const picks = [];
	let closes = 0;
	useReactionPreferences.getState().setTone("picker", 3);
	const render = (disabled) =>
		m.root.render(
			h(TeamBridgeEmojiPicker, {
				accountId: "picker",
				disabled,
				onSelect: (e) => picks.push(e),
				onClose: () => {
					closes++;
				},
			}),
		);
	await act(() => render(true));
	const quick = m.host.querySelector("div.grid button");
	assert.equal(quick.disabled, true);
	await click(quick);
	assert.deepEqual(picks, []);
	assert.equal(closes, 0);
	await act(() => render(false));
	await click(m.host.querySelector("div.grid button"));
	assert.equal(picks[0], "👍🏽");
	assert.equal(closes, 1);
	await m.close();
});

async function search(host, value) {
	const input = host.querySelector("input");
	const set = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(() => {
		set.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

test("search and category grid dispatch the glyph displayed, preserving explicit tone", async () => {
	const m = mount();
	const picks = [];
	useReactionPreferences.getState().setTone("identity", 3);
	await act(() =>
		m.root.render(
			h(TeamBridgeEmojiPicker, {
				accountId: "identity",
				onSelect: (e) => picks.push(e),
				onClose: () => {},
			}),
		),
	);
	await search(m.host, "thumbs up");
	const light = Array.from(m.host.querySelectorAll("table button")).find(
		(button) => button.textContent === "👍🏻",
	);
	assert.ok(light, "search must expose the explicit light-tone cell");
	await click(light);
	assert.equal(picks.at(-1), "👍🏻");
	const base = Array.from(m.host.querySelectorAll("table button")).find(
		(button) => button.getAttribute("aria-label") === "thumbs up",
	);
	assert.equal(base.textContent, "👍🏽");
	await click(base);
	assert.equal(picks.at(-1), base.textContent);
	await search(
		m.host,
		"kiss: person, person, light skin tone, medium-light skin tone",
	);
	const mixed = m.host.querySelector("table button");
	assert.ok(mixed);
	const glyph = mixed.textContent;
	await click(mixed);
	assert.equal(picks.at(-1), glyph);
	assert.equal(Buffer.byteLength(glyph), 35);
	await m.close();
});
