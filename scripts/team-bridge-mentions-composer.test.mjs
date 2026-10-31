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
			export {TeamBridgeMessageList} from './src/renderer/src/features/team-bridge/team-bridge-message-list';
			export {renderToStaticMarkup} from 'react-dom/server';
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
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
	],
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
const MENTION_OTHER = /data-mention="other"[^>]*>@Ben Tran</;
const MENTION_VIEWER = /data-mention="viewer"[^>]*>@Damian Tran</;
const MENTION_ANY = /data-mention="/g;
const NOT_MEMBER_NOTICE =
	/Sherman Tsui isn’t in this conversation, so they won’t be notified\./;
const INVITED_NOTICE =
	/Sherman Tsui has been invited\. They won’t be notified until they join\./;
const PENDING_NOTICE = /Ivy Chen is invited but hasn’t joined yet/;
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
	{
		kind: "human",
		accountId: "acct_ivy",
		label: "Ivy Chen",
		member: false,
		invited: true,
		bridgeOff: false,
	},
	{
		// A participant-only agent row: no endpoint, so it cannot be invited.
		kind: "agent",
		accountId: "acct_sher",
		label: "Sherman Tsui’s chief of staff",
		member: false,
		bridgeOff: false,
	},
];

const setValue = Object.getOwnPropertyDescriptor(
	dom.window.HTMLTextAreaElement.prototype,
	"value",
).set;

async function mount({
	sendMentions = true,
	kind = "group",
	onInvite,
	list = candidates,
} = {}) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = mod.createRoot(host);
	const sent = [];
	const invited = [];
	const invite =
		onInvite ??
		(async (row) => {
			invited.push(row.accountId);
		});
	const sourceFor = (rows) => ({
		conversationId: CONVERSATION,
		candidates: rows,
		conversationKind: kind,
		sendMentions,
		onInvite: invite,
		canInvite: (row) =>
			kind !== "dm" &&
			!row.invited &&
			(row.kind === "human" || Boolean(row.endpointId)),
	});
	const render = (rows) =>
		root.render(
			mod.createElement(
				mod.MentionSourceContext.Provider,
				{ value: sourceFor(rows) },
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
	await mod.act(async () => render(list));
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
	const rerender = (rows) => mod.act(async () => render(rows));
	return {
		host,
		field,
		type,
		key,
		options,
		sent,
		invited,
		unmount,
		rerender,
	};
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
			[
				"human:acct_ben",
				"agent:acct_ben",
				"human:acct_sher",
				"human:acct_ivy",
				"agent:acct_sher",
			],
			"active members first; invited and non-members are the org sections",
		);
		assert.equal(ui.options()[0].selected, true);
		await ui.key("ArrowUp");
		assert.equal(
			ui.options()[4].selected,
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
		// R1-02: and stays closed for that @ - the next letter is prose.
		await ui.type("x @zzz t");
		assert.equal(
			ui.field.getAttribute("aria-expanded"),
			"false",
			"the zero-match space dismissed this @, like Esc",
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

test("a non-member pick is quiet text with a notice; every choice keeps it out of mentions[] (R1-01)", async () => {
	const ui = await mount();
	const notice = () => ui.host.querySelector("[data-mention-notice]");
	const button = (label) =>
		[...(notice()?.querySelectorAll("button") ?? [])].find(
			(b) => (b.textContent || b.getAttribute("aria-label")) === label,
		);
	try {
		// Mention without notifying.
		await ui.type("@sher");
		await ui.key("Enter");
		assert.match(notice()?.textContent ?? "", NOT_MEMBER_NOTICE);
		assert.ok(
			ui.host.querySelector('[data-mention-pill="silent"]'),
			"a non-member pick starts as quiet text, before any choice",
		);
		await mod.act(async () => {
			button("Mention without notifying").click();
			await new Promise((r) => setTimeout(r, 5));
		});
		assert.equal(notice(), null);
		assert.equal(
			document.activeElement,
			ui.field,
			"focus is back in the field (D4)",
		);
		await ui.key("Enter");
		assert.equal(
			ui.sent[0].mentions,
			undefined,
			"a silenced mention is not sent",
		);

		// Dismiss is the same: the hub would refuse a non-member row.
		await ui.type("@Ben Tran @sher");
		await ui.key("Enter");
		await mod.act(async () => {
			button("Dismiss").click();
			await new Promise((r) => setTimeout(r, 5));
		});
		assert.equal(notice(), null);
		assert.equal(
			document.activeElement,
			ui.field,
			"focus is back after Dismiss (D4)",
		);
		await ui.key("Enter");
		assert.deepEqual(
			ui.sent[1].mentions,
			undefined,
			"@Ben Tran was typed, not picked, and the dismissed non-member is not sent",
		);

		// Invite: still non-notifying until the person is ACTIVE.
		await ui.type("@sher");
		await ui.key("Enter");
		await mod.act(async () => {
			button("Invite them").click();
			await new Promise((r) => setTimeout(r, 5));
		});
		assert.deepEqual(ui.invited, ["acct_sher"]);
		assert.match(notice()?.textContent ?? "", INVITED_NOTICE);
		assert.equal(button("Invite them"), undefined, "no second invite");
		assert.equal(
			document.activeElement,
			ui.field,
			"focus is back after Invite (D4)",
		);
		assert.equal(
			ui.host.querySelector('[data-mention-pill="notify"]'),
			null,
			"an invited person is not notifying yet",
		);
		// The refetch shows them active: the pill upgrades itself.
		await ui.rerender(
			candidates.map((c) =>
				c.kind === "human" && c.accountId === "acct_sher"
					? { ...c, member: true }
					: c,
			),
		);
		assert.ok(
			ui.host.querySelector('[data-mention-pill="notify"]'),
			"active now, so the mention notifies",
		);
		await ui.key("Enter");
		assert.deepEqual(ui.sent[2].mentions, [
			{ kind: "human", account_id: "acct_sher" },
		]);
	} finally {
		await ui.unmount();
	}
});

test("an invited member is offered as a non-member and never serialized (R1-01)", async () => {
	const ui = await mount();
	try {
		await ui.type("@ivy");
		assert.deepEqual(
			[...document.querySelectorAll('[role="option"]')].map((o) =>
				o.textContent.includes("Invited"),
			),
			[true],
			"the row carries the Invited tag",
		);
		await ui.key("Enter");
		const notice = ui.host.querySelector("[data-mention-notice]");
		assert.match(notice?.textContent ?? "", PENDING_NOTICE);
		assert.equal(
			[...notice.querySelectorAll("button")].some(
				(b) => b.textContent === "Invite them",
			),
			false,
			"already invited: no Invite",
		);
		await ui.key("Enter");
		assert.equal(ui.sent[0].mentions, undefined);
	} finally {
		await ui.unmount();
	}
});

test("an agent with no endpoint is never offered Invite (R1-05)", async () => {
	const ui = await mount();
	try {
		await ui.type("@sherman tsui’s");
		const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
			o.getAttribute("data-mention-option")?.startsWith("agent:"),
		);
		assert.ok(option);
		await mod.act(async () => option.click());
		const labels = [
			...ui.host.querySelectorAll("[data-mention-notice] button"),
		].map((b) => b.textContent || b.getAttribute("aria-label"));
		assert.deepEqual(labels, ["Mention without notifying", "Dismiss"]);
	} finally {
		await ui.unmount();
	}
});

test("a member who is no longer active at send time is filtered out (R1-01)", async () => {
	const ui = await mount();
	try {
		await ui.type("@ben");
		await ui.key("Enter");
		await ui.rerender(
			candidates.map((c) =>
				c.kind === "human" && c.accountId === "acct_ben"
					? { ...c, member: false }
					: c,
			),
		);
		await ui.key("Enter");
		assert.equal(ui.sent[0].mentions, undefined);
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

test("message bodies highlight mentions; the reader's own is the stronger token", () => {
	const html = mod.renderToStaticMarkup(
		mod.createElement(
			mod.MentionSourceContext.Provider,
			{
				value: {
					conversationId: CONVERSATION,
					candidates,
					conversationKind: "group",
					sendMentions: true,
					self: { accountId: "acct_self", label: "Damian Tran" },
				},
			},
			mod.createElement(mod.TeamBridgeMessageList, {
				messages: [
					{
						...rootMessage,
						id: "bcmsg_m1",
						body: "@Ben Tran and @Damian Tran: `@Ben Tran` in code",
					},
				],
				labelFor: (s) => s.display_label,
			}),
		),
	);
	assert.match(html, MENTION_OTHER);
	assert.match(html, MENTION_VIEWER);
	assert.equal(
		(html.match(MENTION_ANY) ?? []).length,
		2,
		"inline code is not highlighted",
	);
	const bare = mod.renderToStaticMarkup(
		mod.createElement(mod.TeamBridgeMessageList, {
			messages: [{ ...rootMessage, id: "bcmsg_m2", body: "@Ben Tran" }],
			labelFor: (s) => s.display_label,
		}),
	);
	assert.equal(
		MENTION_ANY.test(bare),
		false,
		"no mention source, no highlight",
	);
});
