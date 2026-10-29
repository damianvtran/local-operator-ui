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
const FONT_SEAM = /^\.\/team-bridge-emoji-support$/;
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
	"NodeFilter",
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
			'export {TeamBridgeThreadPaneView} from "./src/renderer/src/features/team-bridge/team-bridge-thread-pane";',
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
				b.onResolve({ filter: FONT_SEAM }, (args) => ({
					path: args.path,
					namespace: "seam",
				}));
				b.onLoad({ filter: ANY_SEAM, namespace: "seam" }, (args) => ({
					contents: args.path.includes("emoji-support")
						? "export const canRenderEmoji=(emoji)=>!globalThis.__unsupportedGlyphs?.has(emoji); export const warmEmojiProbeCache=()=>{globalThis.__warmCalls=(globalThis.__warmCalls??0)+1; return ()=>{}};"
						: args.path.includes("api/")
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
	TeamBridgeThreadPaneView,
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
const visibleText = (node) =>
	[...node.querySelectorAll("span")]
		.filter((span) => !span.classList.contains("sr-only"))
		.map((span) => span.textContent)
		.join("");
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
	// No reactions, no chips: the add entry for such a message is the message
	// toolbar's react button, not a second pill on the row.
	assert.equal(m.host.querySelectorAll("button").length, 0);
	await m.close();
});

test("the shipped reaction views render and send the captured account on toggle", async () => {
	const calls = [];
	globalThis.__reactionApi = async (...args) => {
		calls.push(args);
		return {
			message_id: props.messageId,
			reactions: [{ ...reaction, count: 3, reacted_by_me: true }],
		};
	};
	const m = mount();
	await act(() =>
		m.root.render(
			h(TeamBridgeReactions, {
				...props,
				reactions: [reaction],
			}),
		),
	);
	assert.ok(m.host.querySelector('[data-reaction-layout="chips"]'));
	await click(m.host.querySelector('[data-reaction-layout="chips"] button'));
	assert.deepEqual(calls, [
		[
			props.conversationId,
			props.messageId,
			reaction.emoji,
			true,
			props.tenantId,
			props.accountId,
		],
	]);
	const grid = mount();
	await act(() =>
		grid.root.render(
			h(TeamBridgeEmojiPicker, {
				accountId: "a",
				onSelect() {},
				onClose() {},
			}),
		),
	);
	assert.ok(grid.host.textContent.length > 0, "emoji grid");
	assert.ok(grid.host.querySelector("input"));
	await grid.close();
	await m.close();
});

test("a shipped message list mounts reaction controls for the captured account", async () => {
	const m = mount();
	for (const accountId of ["a", "b"]) {
		await act(() =>
			m.root.render(
				h(TeamBridgeMessageList, {
					messages: [rowMessage],
					labelFor: () => "Bea",
					reactionContext: { accountId, tenantId: "tnt_1" },
				}),
			),
		);
		assert.ok(
			m.host.querySelector('[data-reaction-layout="chips"]'),
			accountId,
		);
		assert.ok(m.host.querySelector('[role="toolbar"]'), accountId);
	}
	assert.match(m.host.textContent, /hello/);
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

test("a row without a reaction context stays inert while an owned row draws chips", async () => {
	const m = mount();
	await act(() =>
		m.root.render(
			h(TeamBridgeMessageList, {
				messages: [rowMessage],
				labelFor: () => "Bea",
			}),
		),
	);
	assert.equal(m.host.querySelector('[data-reaction-layout="chips"]'), null);
	await act(() =>
		m.root.render(
			h(TeamBridgeMessageList, {
				messages: [{ ...rowMessage, reactions: [reaction] }],
				labelFor: () => "Bea",
				reactionContext: props,
			}),
		),
	);
	assert.ok(m.host.querySelector('[data-reaction-layout="chips"]'));
	assert.match(m.host.textContent, /hello/);
	await m.close();
});

/*
 * THE ONE MESSAGE TOOLBAR (stack-integration finding #1304 x #1308: the reply
 * tool and the reaction pill both sat top-right and overlapped). jsdom has no
 * layout, so the no-overlap geometry lives in the MessageToolbar story's play
 * function; these pin the structure and the keyboard contract.
 */
/* A border or a shadow on the toolbar would break docs/branding.md: borderless
   chrome, and the one shadow only for objects that leave the flow. */
const CHROME_EDGE = /\b(border|shadow)/;
const rowMessage = {
	id: "bcmsg_toolbar01",
	conversation_id: "bcv_example1",
	seq: 1,
	sender: { account_id: "a", kind: "human", display_label: "Ada" },
	body: "hello",
	origin: "human",
	created_at: "2026-10-21T12:00:00Z",
	reactions: [reaction],
	reply_count: 2,
	reply_participants: ["Bea"],
};
const renderList = (m, extra = {}) =>
	act(() =>
		m.root.render(
			h(TeamBridgeMessageList, {
				messages: [rowMessage],
				labelFor: () => "Ada",
				reactionContext: { accountId: "a", tenantId: "tnt_1" },
				onReply() {},
				...extra,
			}),
		),
	);
const named = (scope, name) =>
	[...scope.querySelectorAll("button")].filter(
		(b) => b.getAttribute("aria-label") === name,
	);

test("the shipped row offers Reply in thread and preserves its focus hand-off", async () => {
	const m = mount();
	let replies = 0;
	await renderList(m, { onReply: () => replies++ });
	const reply = named(m.host, "ui.teamBridge.replies.action")[0];
	assert.ok(reply);
	await click(reply);
	assert.equal(replies, 1);
	await m.close();
});

test("the shipped thread pane renders its root and reply", async () => {
	const m = mount();
	await act(() =>
		m.root.render(
			h(TeamBridgeThreadPaneView, {
				root: rowMessage,
				replies: [
					{ ...rowMessage, id: "bcmsg_reply02", thread_root_id: rowMessage.id },
				],
				state: "ready",
				labelFor: () => "Ada",
				onClose() {},
				onRetry() {},
				onSend: async () => {},
				reactionContext: { accountId: "a", tenantId: "tnt_1" },
			}),
		),
	);
	assert.ok(m.host.querySelector('[role="toolbar"]'));
	assert.equal(named(m.host, "ui.teamBridge.replies.action").length, 0);
	assert.match(m.host.textContent, /hello/);
	await m.close();
});

test("a shipped list schedules the emoji probe used by its picker", async () => {
	globalThis.__warmCalls = undefined;
	const m = mount();
	await renderList(m, { forceToolbar: true });
	assert.ok(
		globalThis.__warmCalls > 0,
		"the shipped reaction surface warms its emoji probe",
	);
	await m.close();
	globalThis.__warmCalls = undefined;
});

test("a shipped row exposes its message toolbar with both react and reply", async () => {
	const m = mount();
	await renderList(m, { forceToolbar: true });
	const toolbar = m.host.querySelector('[data-message-toolbar=""]');
	assert.ok(toolbar);
	assert.equal(named(toolbar, "ui.teamBridge.reactions.add").length, 1);
	assert.equal(named(toolbar, "ui.teamBridge.replies.action").length, 1);
	await m.close();
});
