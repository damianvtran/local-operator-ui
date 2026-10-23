/** Component state, not geometry proof: jsdom runs the real React effects and event handlers.
 * Transport is scripted; i18n/prose are inert seams. Real browser/layout QA remains independent. */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { Profiler, createElement as h } from "react";
// Keep the bounded-work contract on this existing desktop-suite entry point;
// the sibling also runs alone when diagnosing scheduler behavior.
import "./team-bridge-emoji-support-scheduler.test.mjs";
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
			'export {EMOJI_ENTRIES} from "./src/renderer/src/features/team-bridge/team-bridge-emoji-model";',
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
						? `
							// Warm by default for existing interaction tests. The cold test below
							// opts into an empty cache and counts actual probe calls separately.
							export const cachedEmojiSupport=(emoji)=>globalThis.__coldGlyphCache
								? globalThis.__coldGlyphCache.get(emoji)
								: !globalThis.__unsupportedGlyphs?.has(emoji);
							export const canRenderEmoji=(emoji)=>{
								globalThis.__glyphProbeCount=(globalThis.__glyphProbeCount??0)+1;
								const supported=!globalThis.__unsupportedGlyphs?.has(emoji);
								globalThis.__coldGlyphCache?.set(emoji,supported);
								return supported;
							};
						`
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
	EMOJI_ENTRIES,
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

test("cold picker commits its tray without probing glyphs or fetching data; close cancels deferred work", async () => {
	const m = mount();
	const originalFrame = globalThis.requestAnimationFrame;
	const originalCancel = globalThis.cancelAnimationFrame;
	const originalFetch = globalThis.fetch;
	const frames = new Map();
	let nextFrame = 0;
	let fetches = 0;
	globalThis.requestAnimationFrame = (callback) => {
		const id = ++nextFrame;
		frames.set(id, callback);
		return id;
	};
	globalThis.cancelAnimationFrame = (id) => frames.delete(id);
	globalThis.fetch = () => {
		fetches++;
		throw new Error("The offline picker must not fetch");
	};
	globalThis.__coldGlyphCache = new Map();
	globalThis.__glyphProbeCount = 0;
	try {
		await act(() =>
			m.root.render(
				h(TeamBridgeEmojiPicker, {
					accountId: "cold-picker",
					onSelect: () => assert.fail("mount must not select"),
					onClose: () => {},
				}),
			),
		);
		assert.ok(
			m.host.querySelector("input"),
			"search/tray must commit immediately",
		);
		assert.ok(
			m.host.querySelector("fieldset"),
			"categories must commit immediately",
		);
		assert.ok(
			m.host.querySelector("div.grid"),
			"recent tray reserves its geometry",
		);
		assert.equal(
			globalThis.__glyphProbeCount,
			0,
			"first commit cannot do canvas probes",
		);
		assert.equal(fetches, 0);
		assert.ok(frames.size > 0, "cold support discovery is deferred");
		// The first rAF is before paint, not proof that a frame has painted.
		const first = [...frames.values()];
		frames.clear();
		for (const callback of first) callback(0);
		assert.equal(globalThis.__glyphProbeCount, 0);
		await m.close();
		assert.equal(
			frames.size,
			0,
			"closing cancels even the second-frame boundary",
		);
		assert.equal(globalThis.__glyphProbeCount, 0);
		assert.equal(fetches, 0);
	} finally {
		if (m.host.isConnected) await m.close();
		globalThis.requestAnimationFrame = originalFrame;
		globalThis.cancelAnimationFrame = originalCancel;
		globalThis.fetch = originalFetch;
		globalThis.__coldGlyphCache = undefined;
		globalThis.__glyphProbeCount = undefined;
	}
});

test("partial support only appends proven cells and does not replace the focused button", async () => {
	const m = mount();
	const originalFrame = globalThis.requestAnimationFrame;
	const originalCancel = globalThis.cancelAnimationFrame;
	const frames = new Map();
	let nextFrame = 0;
	globalThis.requestAnimationFrame = (callback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	};
	globalThis.cancelAnimationFrame = (id) => frames.delete(id);
	const first = EMOJI_ENTRIES.slice(0, 5);
	globalThis.__coldGlyphCache = new Map([
		[first[0].emoji, true],
		[first[1].emoji, true],
		[first[4].emoji, true], // A different picker warmed a later corpus entry.
	]);
	globalThis.__glyphProbeCount = 0;
	const render = () =>
		m.root.render(
			h(TeamBridgeEmojiPicker, {
				accountId: "partial-picker",
				onSelect: () => {},
				onClose: () => {},
			}),
		);
	try {
		await act(render);
		assert.equal(m.host.querySelectorAll("table button").length, 2);
		const focused = m.host.querySelector('table button[data-index="1"]');
		focused.focus();
		globalThis.__coldGlyphCache.set(first[2].emoji, false);
		globalThis.__coldGlyphCache.set(first[3].emoji, true);
		await act(render);
		assert.deepEqual(
			[...m.host.querySelectorAll("table button")].map(
				(button) => button.textContent,
			),
			[first[0].emoji, first[1].emoji, first[3].emoji, first[4].emoji],
		);
		assert.equal(document.activeElement, focused);
		assert.equal(m.host.querySelector('table button[data-index="1"]'), focused);
		assert.equal(
			globalThis.__glyphProbeCount,
			0,
			"rerender only reads cache facts",
		);
	} finally {
		await m.close();
		assert.equal(frames.size, 0);
		globalThis.requestAnimationFrame = originalFrame;
		globalThis.cancelAnimationFrame = originalCancel;
		globalThis.__coldGlyphCache = undefined;
		globalThis.__glyphProbeCount = undefined;
	}
});

test("picker Enter and Space choose the displayed tone through the same cell handler", async () => {
	const m = mount();
	const selected = [];
	useReactionPreferences.getState().setTone("keyboard-tone", 3);
	try {
		await act(() =>
			m.root.render(
				h(TeamBridgeEmojiPicker, {
					accountId: "keyboard-tone",
					initialQuery: "thumbs up",
					onSelect: (emoji) => selected.push(emoji),
					onClose: () => {},
				}),
			),
		);
		const table = m.host.querySelector("table");
		const cell = table.querySelector('button[data-index="0"]');
		assert.ok(cell);
		for (const key of ["Enter", " "]) {
			await act(() =>
				table.dispatchEvent(
					new KeyboardEvent("keydown", { key, bubbles: true }),
				),
			);
			assert.equal(selected.at(-1), cell.textContent);
		}
		assert.equal(selected.length, 2);
	} finally {
		await m.close();
	}
});

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
	assert.equal(
		visibleText(m.host.querySelector("button[aria-pressed]")),
		"👍3",
	);
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
	assert.equal(
		visibleText(m.host.querySelector("button[aria-pressed]")),
		"👍3",
	);
	await act(async () => {
		reject(new Error("reaction_limit"));
		await Promise.resolve();
	});
	assert.equal(
		visibleText(m.host.querySelector("button[aria-pressed]")),
		"👍2",
	);
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
	assert.equal(
		visibleText(m.host.querySelector("button[aria-pressed]")),
		"👍3",
	);
	await act(() => render("b"));
	assert.equal(
		visibleText(m.host.querySelector("button[aria-pressed]")),
		"👍2",
	);
	await act(async () => {
		resolve({
			message_id: message.id,
			reactions: [{ ...reaction, count: 3, reacted_by_me: true }],
		});
		await Promise.resolve();
	});
	assert.equal(
		visibleText(m.host.querySelector("button[aria-pressed]")),
		"👍2",
	);
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

test("no reactions draws nothing on the row; populated chips remain in the message flow", async () => {
	const m = mount();
	await act(() => m.root.render(h(TeamBridgeReactions, props)));
	assert.equal(m.host.querySelector("[data-reaction-layout]"), null);
	await act(() =>
		m.root.render(h(TeamBridgeReactions, { ...props, reactions: [reaction] })),
	);
	const chips = m.host.querySelector('[data-reaction-layout="chips"]');
	assert.ok(chips);
	assert.equal(chips.classList.contains("absolute"), false);
	const button = chips.querySelector("button[aria-pressed]");
	assert.equal(button.getAttribute("aria-label"), "thumbs up 2");
	assert.equal(
		document.getElementById(button.getAttribute("aria-describedby"))
			.textContent,
		"Bea",
	);
	await m.close();
});

test("unsupported glyph is not offered, and an incoming unsupported reaction uses its name", async () => {
	globalThis.__unsupportedGlyphs = new Set(["🫫"]);
	const m = mount();
	await act(() =>
		m.root.render(
			h(TeamBridgeEmojiPicker, {
				accountId: "font",
				initialQuery: "cracking face",
				onSelect: () => {},
				onClose: () => {},
			}),
		),
	);
	assert.equal(m.host.querySelector("table"), null);
	assert.ok(m.host.textContent.includes("ui.teamBridge.reactions.noResults"));
	await act(() =>
		m.root.render(
			h(TeamBridgeReactions, {
				...props,
				reactions: [{ ...reaction, emoji: "🫫" }],
			}),
		),
	);
	assert.equal(m.host.textContent.includes("🫫"), false);
	assert.ok(m.host.textContent.includes("cracking face"));
	await m.close();
	globalThis.__unsupportedGlyphs = undefined;
});

test("categories are target-sized plain toggles, not incomplete tabs", async () => {
	const m = mount();
	await act(() =>
		m.root.render(
			h(TeamBridgeEmojiPicker, {
				accountId: "categories",
				onSelect: () => {},
				onClose: () => {},
			}),
		),
	);
	assert.equal(m.host.querySelector('[role="tab"]'), null);
	const buttons = [...m.host.querySelectorAll("fieldset button")];
	assert.equal(buttons.length, 10);
	assert.ok(
		buttons.every(
			(b) => b.classList.contains("min-w-6") && b.classList.contains("min-h-8"),
		),
	);
	await click(buttons[2]);
	assert.equal(buttons[2].getAttribute("aria-pressed"), "true");
	assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
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

test("a row renders exactly one toolbar, holding react and reply", async () => {
	const m = mount();
	await renderList(m);
	const toolbars = m.host.querySelectorAll('[role="toolbar"]');
	assert.equal(toolbars.length, 1);
	const labels = [...toolbars[0].querySelectorAll("button")].map((b) =>
		b.getAttribute("aria-label"),
	);
	assert.deepEqual(labels, [
		"ui.teamBridge.reactions.add",
		"ui.teamBridge.replies.action",
	]);
	// No "More" menu (review round 3, M4/F1; design D12): it could only repeat
	// the two buttons beside it.
	assert.equal(named(m.host, "ui.teamBridge.actions.more").length, 0);
	assert.equal(toolbars[0].querySelector('[aria-haspopup="menu"]'), null);
	// The name comes from the shared Tooltip, not the native `title` (D13).
	for (const b of toolbars[0].querySelectorAll("button"))
		assert.equal(b.getAttribute("title"), null, b.outerHTML);
	assert.equal(
		toolbars[0].getAttribute("aria-label"),
		"ui.teamBridge.actions.label",
	);
	// The old separate affordances are gone: one reply-in-thread control on the
	// row (the summary is a different label), and no reaction pill outside it.
	assert.equal(named(m.host, "ui.teamBridge.replies.action").length, 1);
	assert.equal(m.host.querySelector('[data-reaction-layout="toolbar"]'), null);
	// Borderless, no shadow, 28px hit targets (>= 24), ghost buttons.
	assert.equal(CHROME_EDGE.test(toolbars[0].className), false);
	for (const b of toolbars[0].querySelectorAll("button"))
		assert.ok(b.classList.contains("size-7"), b.outerHTML);
	await m.close();
});

test("keyboard focus reveals the toolbar; one tab stop and arrows rove", async () => {
	const m = mount();
	await renderList(m);
	const toolbar = m.host.querySelector('[role="toolbar"]');
	// Revealed by the row's focus-within as well as its hover.
	assert.ok(
		toolbar.className.includes("group-focus-within/message:opacity-100"),
	);
	assert.ok(toolbar.className.includes("group-hover/message:opacity-100"));
	const buttons = [...toolbar.querySelectorAll("button")];
	assert.deepEqual(
		buttons.map((b) => b.tabIndex),
		[0, -1],
		"one tab stop: the row's Tab lands on the toolbar once",
	);
	await act(() => buttons[0].focus());
	const key = (k) =>
		act(() =>
			document.activeElement.dispatchEvent(
				new KeyboardEvent("keydown", { key: k, bubbles: true }),
			),
		);
	await key("ArrowRight");
	assert.equal(document.activeElement, buttons[1]);
	assert.deepEqual(
		buttons.map((b) => b.tabIndex),
		[-1, 0],
		"the roving stop follows focus",
	);
	await key("End");
	assert.equal(document.activeElement, buttons[1]);
	await key("ArrowRight");
	assert.equal(document.activeElement, buttons[1], "bounded, not wrapping");
	await key("Home");
	assert.equal(document.activeElement, buttons[0]);
	await m.close();
});

test("thread replies get react, never reply-in-thread", async () => {
	const m = mount();
	await renderList(m, {
		messages: [
			{ ...rowMessage, id: "bcmsg_reply01", thread_root_id: rowMessage.id },
		],
	});
	const toolbar = m.host.querySelector('[role="toolbar"]');
	assert.deepEqual(
		[...toolbar.querySelectorAll("button")].map((b) =>
			b.getAttribute("aria-label"),
		),
		["ui.teamBridge.reactions.add"],
	);
	// The thread pane passes no onReply at all: same answer for its root.
	await renderList(m, { onReply: undefined });
	assert.equal(named(m.host, "ui.teamBridge.replies.action").length, 0);
	await m.close();
});

test("the tab stop is clamped when the button list shrinks (review round 3, M3)", async () => {
	const m = mount();
	await renderList(m);
	const reply = () => named(m.host, "ui.teamBridge.replies.action")[0];
	await act(() => reply().focus());
	assert.equal(reply().tabIndex, 0, "focus last rested on the second button");
	// The reader loses the ability to react (the conversation closed): the
	// list shrinks to ONE button, while `roving` still points at index 1.
	await renderList(m, {
		reactionContext: { accountId: "a", tenantId: "tnt_1", disabled: true },
	});
	const buttons = [...m.host.querySelectorAll('[role="toolbar"] button')];
	assert.equal(buttons.length, 1);
	assert.deepEqual(
		buttons.map((b) => b.tabIndex),
		[0],
		"the toolbar always keeps exactly one tab stop",
	);
	await m.close();
});

test("choosing Reply in thread leaves focus where the pane put it (review round 3, F1)", async () => {
	// The hand-off defect lived in the removed More menu: Radix returned focus
	// to its trigger AFTER the pane focused its close button. The direct button
	// must not take focus back either, so this models the pane (an element that
	// focuses itself synchronously when the reply opens it).
	const pane = document.createElement("button");
	pane.setAttribute("data-thread-close", "");
	document.body.append(pane);
	const m = mount();
	await renderList(m, { onReply: () => pane.focus() });
	await click(named(m.host, "ui.teamBridge.replies.action")[0]);
	assert.equal(document.activeElement, pane, "focus stays in the pane");
	pane.remove();
	await m.close();
});

test("the thread pane's rows carry react and never reply-in-thread, with no overlap-prone second affordance (review round 3, M1)", async () => {
	// Rendered through the real pane, which is what the CI-less story guard
	// used to be the only check of: a regression where the pane starts passing
	// `onReply` is caught here.
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
	const toolbars = m.host.querySelectorAll('[role="toolbar"]');
	assert.equal(toolbars.length, 2, "one per row: the root and the reply");
	for (const toolbar of toolbars)
		assert.deepEqual(
			[...toolbar.querySelectorAll("button")].map((b) =>
				b.getAttribute("aria-label"),
			),
			["ui.teamBridge.reactions.add"],
		);
	assert.equal(named(m.host, "ui.teamBridge.replies.action").length, 0);
	assert.equal(
		m.host.querySelectorAll('[data-reaction-layout="toolbar"]').length,
		0,
	);
	await m.close();
});

test("a reader who cannot react or reply gets no toolbar at all", async () => {
	const m = mount();
	await renderList(m, {
		reactionContext: { accountId: "a", tenantId: "tnt_1", disabled: true },
		onReply: undefined,
	});
	assert.equal(m.host.querySelector('[role="toolbar"]'), null);
	await m.close();
});

test("#1334 integration: local pending/failed rows offer Retry only; confirmed rows restore reply/reaction tools", async () => {
	const m = mount();
	const entry = {
		clientRef: "local-ref",
		body: "Local send",
		status: "failed",
	};
	const message = {
		id: "pending:local-ref",
		conversation_id: "bcv_example1",
		seq: Number.MAX_SAFE_INTEGER,
		sender: { account_id: "a", kind: "human", display_label: "Ada" },
		body: entry.body,
		origin: "human",
		created_at: "2026-10-22",
		reactions: [reaction],
		reply_count: 1,
	};
	const retries = [];
	const replies = [];
	const render = (pending, row = message) =>
		m.root.render(
			h(TeamBridgeMessageList, {
				messages: [row],
				labelFor: () => "Ada",
				pendingSends: pending,
				onRetrySend: (ref) => retries.push(ref),
				reactionContext: { accountId: "a", tenantId: "tnt_1" },
				onReply: (msg) => replies.push([msg.conversation_id, msg.id]),
				forceToolbar: true,
			}),
		);
	try {
		for (const status of ["sending", "sent", "failed"]) {
			await act(() => render([{ ...entry, status }]));
			assert.equal(
				m.host.querySelectorAll('[role="toolbar"],button[aria-pressed]').length,
				0,
				status,
			);
			const buttons = [...m.host.querySelectorAll("button")];
			assert.equal(buttons.length, status === "failed" ? 1 : 0, status);
			if (status === "failed") {
				await click(buttons[0]);
				assert.deepEqual(retries, ["local-ref"]);
			}
		}
		const confirmed = { ...message, id: "bcmsg_confirmed", seq: 2 };
		await act(() => render([], confirmed));
		assert.ok(m.host.querySelector('[role="toolbar"]'));
		assert.ok(m.host.querySelector("button[aria-pressed]"));
		const reply = m.host.querySelector(
			'button[aria-label="ui.teamBridge.replies.action"]',
		);
		assert.ok(reply);
		await click(reply);
		assert.deepEqual(replies, [["bcv_example1", "bcmsg_confirmed"]]);
	} finally {
		await m.close();
	}
});
