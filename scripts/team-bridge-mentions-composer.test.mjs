import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * TEAM BRIDGE @-MENTIONS: THE KEYBOARD FLOW, through the SHIPPED reply composer.
 *
 * The thread pane's composer mounts the same `useComposerMentions` /
 * `MentionField` / `MentionNotice` trio as the channel composer, and needs no
 * message-input store, so it is the leanest real host: the pane is rendered
 * under a `MentionSourceContext` exactly as the page provides it, and driven
 * the way a person drives it - type, arrow, Enter, Esc, Backspace - and the
 * request the pane's `onSend` receives plus the staged `mentions[]` are read
 * back. jsdom has no layout, so nothing here claims position or pixels; the
 * popover's placement is the rendered capture's job.
 */
const bundle = await build({
	stdin: {
		contents: `
			export {TeamBridgeThreadPaneView} from './src/renderer/src/features/team-bridge/team-bridge-thread-pane';
			export {MentionSourceContext} from './src/renderer/src/features/team-bridge/mentions/mention-context';
			export {stagedMentions} from './src/renderer/src/features/team-bridge/mentions/mention-outbox';
			export {createRoot} from 'react-dom/client';
			export {act, createElement} from 'react';
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
});
const { writeFile, unlink } = await import("node:fs/promises");
const path = `${process.cwd()}/.mentions-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
const dom = new JSDOM('<!doctype html><div id="app"></div>', {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"Event",
	"InputEvent",
	"MouseEvent",
	"KeyboardEvent",
	"HTMLElement",
	"HTMLTextAreaElement",
	"HTMLInputElement",
	"Node",
	"Element",
	"NodeFilter",
	"MutationObserver",
	"navigator",
	"getComputedStyle",
	"localStorage",
	"CSS",
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key] ?? dom.window,
	});
}
globalThis.CSS ??= { escape: (value) => value };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
after(() => dom.window.close());
let mod;
try {
	mod = await import(path);
} finally {
	await unlink(path);
}

const CONVERSATION = "bcv_mentions01";
const NOT_MEMBER_NOTICE = /Sherman Tsui isn’t in this conversation\./;
const rootMessage = {
	id: "bcmsg_root0001",
	conversation_id: CONVERSATION,
	seq: 1,
	sender: { account_id: "acct_a", kind: "human", display_label: "Ada" },
	body: "Root question",
	origin: "human",
	created_at: "2026-10-21T10:00:00Z",
};
const candidates = [
	{
		kind: "human",
		accountId: "acct_ben",
		label: "Ben Tran",
		member: true,
		bridgeOff: false,
	},
	{
		kind: "agent",
		accountId: "acct_ben",
		endpointId: "bep_aida",
		label: "Aida (Ben Tran)",
		aliases: ["Aida", "Ben Tran"],
		member: true,
		bridgeOff: false,
	},
	{
		kind: "human",
		accountId: "acct_sher",
		label: "Sherman Tsui",
		member: false,
		bridgeOff: false,
	},
];

const setValue = Object.getOwnPropertyDescriptor(
	dom.window.HTMLTextAreaElement.prototype,
	"value",
).set;

async function mount({ sendMentions = true, kind = "group", onInvite } = {}) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = mod.createRoot(host);
	const sent = [];
	const invited = [];
	const source = {
		conversationId: CONVERSATION,
		candidates,
		conversationKind: kind,
		sendMentions,
		onInvite:
			onInvite ??
			(async (row) => {
				invited.push(row.accountId);
			}),
	};
	await mod.act(async () => {
		root.render(
			mod.createElement(
				mod.MentionSourceContext.Provider,
				{ value: source },
				mod.createElement(mod.TeamBridgeThreadPaneView, {
					root: rootMessage,
					replies: [],
					state: "ready",
					accountId: "acct_self",
					tenantId: "tnt_1",
					conversationId: CONVERSATION,
					labelFor: (s) => s.display_label,
					onClose() {},
					onRetry() {},
					onSend: async (...args) => {
						sent.push({
							args,
							mentions: mod.stagedMentions(CONVERSATION, args[0]),
						});
					},
				}),
			),
		);
	});
	const field = host.querySelector("textarea");
	const type = async (value, caret = value.length) => {
		await mod.act(async () => {
			field.focus();
			setValue.call(field, value);
			field.setSelectionRange(caret, caret);
			field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
			field.dispatchEvent(new dom.window.Event("select", { bubbles: true }));
		});
	};
	const key = async (k, init = {}) => {
		await mod.act(async () => {
			field.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: k,
					bubbles: true,
					cancelable: true,
					...init,
				}),
			);
			await new Promise((r) => setTimeout(r, 5));
		});
	};
	const options = () =>
		[...document.querySelectorAll('[role="option"]')].map((o) => ({
			key: o.getAttribute("data-mention-option"),
			selected: o.getAttribute("aria-selected") === "true",
		}));
	const unmount = async () => {
		await mod.act(async () => root.unmount());
		host.remove();
	};
	return { host, field, type, key, options, sent, invited, unmount };
}

/*
 * jsdom has no layout, so `MentionField` cannot measure the caret and would
 * wait for a position. Stub the one geometry read it needs.
 */
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
	left: 10,
	top: 500,
	right: 400,
	bottom: 540,
	width: 390,
	height: 40,
});

test("@ opens from cached candidates; members first; arrows wrap; Enter inserts a token", async () => {
	const ui = await mount();
	try {
		await ui.type("hi @");
		assert.equal(
			ui.field.getAttribute("aria-expanded"),
			"true",
			"the popover opens on @",
		);
		assert.deepEqual(
			ui.options().map((o) => o.key),
			["human:acct_ben", "agent:acct_ben", "human:acct_sher"],
		);
		assert.equal(ui.options()[0].selected, true);
		await ui.key("ArrowUp");
		assert.equal(
			ui.options()[2].selected,
			true,
			"↑ from the top wraps to the bottom",
		);
		await ui.key("ArrowDown");
		assert.equal(
			ui.options()[0].selected,
			true,
			"↓ from the bottom wraps to the top",
		);
		await ui.type("hi @ai");
		assert.deepEqual(
			ui.options().map((o) => o.key),
			["agent:acct_ben"],
			"typing filters",
		);
		await ui.key("Enter");
		assert.equal(ui.field.value, "hi @Aida (Ben Tran) ");
		assert.equal(ui.field.getAttribute("aria-expanded"), "false");
		assert.equal(ui.sent.length, 0, "Enter inserted; it did not send");
		const pill = ui.host.querySelector('[data-mention-pill="notify"]');
		assert.equal(
			pill?.textContent,
			"@Aida (Ben Tran)",
			"the token is drawn as a pill",
		);
	} finally {
		await ui.unmount();
	}
});

test("Esc closes and keeps the text; a space with zero matches closes; IME never opens", async () => {
	const ui = await mount();
	try {
		await ui.type("@be");
		assert.equal(ui.field.getAttribute("aria-expanded"), "true");
		await ui.key("Escape");
		assert.equal(ui.field.value, "@be", "Esc keeps the text");
		assert.equal(ui.field.getAttribute("aria-expanded"), "false");
		await ui.type("@bex ");
		assert.equal(
			ui.field.getAttribute("aria-expanded"),
			"false",
			"same @ stays dismissed",
		);
		await ui.type("x @zzz ");
		assert.equal(
			ui.field.getAttribute("aria-expanded"),
			"false",
			"space + zero matches closes",
		);
		await mod.act(async () => {
			ui.field.dispatchEvent(
				new dom.window.Event("compositionstart", { bubbles: true }),
			);
		});
		await ui.type("y @");
		assert.equal(
			ui.field.getAttribute("aria-expanded"),
			"false",
			"no popover mid-composition",
		);
	} finally {
		await ui.unmount();
	}
});

test("Tab inserts; Backspace removes the pill as one token; send carries deduped mentions[]", async () => {
	const ui = await mount();
	try {
		await ui.type("@ben");
		await ui.key("Tab");
		await ui.type(`${ui.field.value}@ben`);
		await ui.key("Tab");
		await ui.type(`${ui.field.value}@ai`);
		await ui.key("Enter");
		assert.equal(ui.field.value, "@Ben Tran @Ben Tran @Aida (Ben Tran) ");
		// Backspace at the end of the last pill (after its trailing space is gone).
		await ui.type("@Ben Tran @Ben Tran @Aida (Ben Tran)", 36);
		await ui.key("Backspace");
		assert.equal(
			ui.field.value,
			"@Ben Tran @Ben Tran ",
			"the whole pill went in one key",
		);
		await ui.type(`${ui.field.value}@ai`);
		await ui.key("Enter");
		await ui.key("Enter");
		assert.equal(ui.sent.length, 1, "Enter with the popover closed sends");
		assert.equal(ui.sent[0].args[0], "@Ben Tran @Ben Tran @Aida (Ben Tran)");
		assert.deepEqual(ui.sent[0].mentions, [
			{ kind: "human", account_id: "acct_ben" },
			{ kind: "agent", account_id: "acct_ben", endpoint_id: "bep_aida" },
		]);
	} finally {
		await ui.unmount();
	}
});

test("without team_bridge_send_mentions the text is sent and no mentions[] is staged", async () => {
	const ui = await mount({ sendMentions: false });
	try {
		await ui.type("@ben");
		await ui.key("Enter");
		await ui.key("Enter");
		assert.equal(ui.sent.length, 1);
		assert.equal(ui.sent[0].args[0], "@Ben Tran");
		assert.equal(ui.sent[0].mentions, undefined);
	} finally {
		await ui.unmount();
	}
});

test("a non-member pick raises the notice; invite, or mention without notifying", async () => {
	const ui = await mount();
	try {
		await ui.type("@sher");
		await ui.key("Enter");
		const notice = () => ui.host.querySelector("[data-mention-notice]");
		assert.match(
			notice()?.textContent ?? "",
			NOT_MEMBER_NOTICE,
		);
		const button = (label) =>
			[...notice().querySelectorAll("button")].find(
				(b) => b.textContent === label,
			);
		assert.ok(button("Invite them"));
		await mod.act(async () => button("Mention without notifying").click());
		assert.equal(notice(), null);
		assert.ok(
			ui.host.querySelector('[data-mention-pill="silent"]'),
			"the pill stays, quiet",
		);
		await ui.key("Enter");
		assert.equal(
			ui.sent[0].mentions,
			undefined,
			"a silenced mention is not sent",
		);

		await ui.type("@sher");
		await ui.key("Enter");
		await mod.act(async () => {
			button("Invite them").click();
			await new Promise((r) => setTimeout(r, 5));
		});
		assert.deepEqual(ui.invited, ["acct_sher"]);
		assert.equal(notice(), null, "a successful invite settles the notice");
	} finally {
		await ui.unmount();
	}
});

test("in a DM the notice offers only 'Mention without notifying'", async () => {
	const ui = await mount({ kind: "dm" });
	try {
		await ui.type("@sher");
		await ui.key("Enter");
		const labels = [
			...ui.host.querySelectorAll("[data-mention-notice] button"),
		].map((b) => b.textContent || b.getAttribute("aria-label"));
		assert.deepEqual(labels, ["Mention without notifying", "Dismiss"]);
	} finally {
		await ui.unmount();
	}
});

test("@ inside an email never opens", async () => {
	const ui = await mount();
	try {
		await ui.type("mail ben@min");
		assert.equal(ui.field.getAttribute("aria-expanded"), "false");
	} finally {
		await ui.unmount();
	}
});
