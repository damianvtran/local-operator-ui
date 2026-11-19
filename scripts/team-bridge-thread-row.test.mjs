/**
 * The thread summary row under a Team Bridge root (operator, 2026-11-04:
 * "threads take a wider row space so you can click anywhere on that row …
 * highlight unread at a glance on the thread row").
 *
 *     node --test scripts/team-bridge-thread-row.test.mjs
 *
 * WHAT IT PROVES, against the SHIPPED modules bundled from source:
 * - the model: calendar-day "last reply" branches, unread absent/0/N (absent is
 *   "cannot tell", never "read"), and the label/id participant merge;
 * - the wire: the TR1 fields are optional and a malformed one costs the badge,
 *   never the message;
 * - the component: ONE button, its accessible name, Enter/click open the
 *   thread, the badge shown/hidden, and the SAME height class in both states
 *   (the no-layout-shift contract);
 * - the read call site: with `team_bridge_thread_reads` it posts the thread
 *   read, without it the conversation read exactly as before, and either way
 *   the cached root's unread is zeroed.
 *
 * WHAT IT DOES NOT PROVE: pixels (the Storybook frames under
 * docs/pr-evidence/thread-row/), or that the hub computes the count right.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const bundle = await build({
	stdin: {
		contents: `
			export * from './src/renderer/src/features/team-bridge/team-bridge-threads-model';
			export { TeamBridgeThreadRow, lastReplyLabel } from './src/renderer/src/features/team-bridge/team-bridge-thread-row';
			export { TeamBridgeMessageList } from './src/renderer/src/features/team-bridge/team-bridge-message-list';
			export { useMarkTeamBridgeThreadRead, setCachedThreadUnread, threadUnreadAfterRead, teamBridgeKeys } from './src/renderer/src/features/team-bridge/use-team-bridge';
			export { TeamBridgeApi } from './src/renderer/src/shared/api/local-operator/team-bridge-api';
			export { desktopKeys } from './src/renderer/src/shared/api/local-operator/desktop-hooks';
			export { teamBridgeMessageSchema } from './src/shared/team-bridge-contract';
			export { desktopRequestSchema } from './src/shared/desktop-contract';
			export { QueryClient, QueryClientProvider } from '@tanstack/react-query';
			export { createRoot } from 'react-dom/client';
			export { act, createElement } from 'react';
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
const path = `${process.cwd()}/.thread-row-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
// DOM before react-dom evaluates (see team-bridge-threads.test.mjs for why).
const dom = new JSDOM('<!doctype html><div id="app"></div>', {
	url: "http://localhost/",
});
for (const key of [
	"window",
	"document",
	"Event",
	"MouseEvent",
	"KeyboardEvent",
	"HTMLElement",
	"Node",
	"Element",
	"MutationObserver",
	"navigator",
	"getComputedStyle",
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key] ?? dom.window,
	});
}
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

const NOW = new Date(2026, 10, 4, 15, 0);
const FULL_WIDTH = /\bw-full\b/;
const SEMIBOLD = /\bfont-semibold\b/;
const REST_FILL = /(^|\s)bg-(surface|elevated|canvas|sunken)\b/;
const HOVER_SUNKEN = /\bhover:bg-sunken\b/;
const PLATE_Z = /\bz-\[(\d)\]/;
const LIST_ROW_NAME = /^View thread, 4 replies, 1 unread/;
const root = {
	id: "bcmsg_root0001",
	conversation_id: "bcv_test0001",
	seq: 1,
	sender: { account_id: "acct_a", kind: "human", display_label: "Ada" },
	body: "Root question",
	origin: "human",
	created_at: "2026-11-04T10:00:00Z",
	reply_count: 4,
	reply_participants: ["Ada", "Bea"],
	last_reply_at: new Date(2026, 10, 4, 10, 39).toISOString(),
};

test("last reply phrasing follows the calendar day, not elapsed hours", () => {
	assert.equal(mod.lastReplyWhen(new Date(2026, 10, 4, 0, 5), NOW), "today");
	// 23:50 yesterday read 15h later is still "yesterday".
	assert.equal(
		mod.lastReplyWhen(new Date(2026, 10, 3, 23, 50), NOW),
		"yesterday",
	);
	assert.equal(mod.lastReplyWhen(new Date(2026, 10, 2, 12), NOW), "older");
	// Full form, and the narrow form that keeps the moment (design round 1, D3).
	for (const [at, full, short] of [
		[new Date(2026, 10, 4, 10, 39), "Last reply today at 10:39 AM", "10:39 AM"],
		[
			new Date(2026, 10, 3, 9, 5),
			"Last reply yesterday at 9:05 AM",
			"Yesterday 9:05 AM",
		],
		[new Date(2026, 9, 12, 9, 5), "Last reply Oct 12", "Oct 12"],
		[new Date(2025, 9, 12, 9, 5), "Last reply Oct 12, 2025", "Oct 12, 2025"],
	])
		assert.deepEqual(mod.lastReplyLabel(at, "en", NOW), { full, short });
});

test("unread: absent means cannot-tell, 0 and N are the hub's answer", () => {
	assert.equal(mod.threadSummary(root).unread, undefined);
	assert.equal(
		mod.threadSummary({ ...root, thread_unread_count: 0 }).unread,
		0,
	);
	assert.equal(
		mod.threadSummary({ ...root, thread_unread_count: 12 }).unread,
		12,
	);
	// Optional on the wire, and a malformed value costs the badge, not the message.
	const parsed = mod.teamBridgeMessageSchema.parse({
		...root,
		thread_unread_count: -3,
		thread_last_read_seq: "x",
		reply_participant_ids: "nope",
	});
	assert.equal(parsed.body, "Root question");
	assert.equal(parsed.thread_unread_count, undefined);
	assert.equal(parsed.thread_last_read_seq, undefined);
	assert.equal(parsed.reply_participant_ids, undefined);
	assert.equal(
		mod.teamBridgeMessageSchema.parse({ ...root, thread_unread_count: 2 })
			.thread_unread_count,
		2,
	);
});

test("participants merge labels with ids by index; labels lead", () => {
	assert.deepEqual(mod.threadParticipants({ reply_participants: ["A"] }), [
		{ label: "A" },
	]);
	assert.deepEqual(
		mod.threadParticipants({
			reply_participants: ["A", "B", "C", "D", "E"],
			reply_participant_ids: [
				{ account_id: "acct_a", kind: "human" },
				{ account_id: "acct_b", kind: "agent" },
			],
		}),
		[
			{ label: "A", accountId: "acct_a", kind: "human" },
			{ label: "B", accountId: "acct_b", kind: "agent" },
			{ label: "C" },
		],
	);
	// An id list longer than the labels never invents a replier.
	assert.equal(
		mod.threadParticipants({
			reply_participants: [],
			reply_participant_ids: [{ account_id: "acct_a", kind: "human" }],
		}).length,
		0,
	);
});

function mount(message, extra = {}) {
	const opened = [];
	const client = new mod.QueryClient({
		defaultOptions: { queries: { gcTime: 0 } },
	});
	const host = document.getElementById("app");
	const app = mod.createRoot(host);
	mod.act(() => {
		app.render(
			mod.createElement(
				mod.QueryClientProvider,
				{ client },
				mod.createElement(mod.TeamBridgeThreadRow, {
					message,
					onOpen: () => opened.push(message.id),
					locale: "en",
					now: NOW,
					...extra,
				}),
			),
		);
	});
	return {
		host,
		opened,
		unmount: () => mod.act(() => app.unmount()),
	};
}

test("the row is ONE full-width button with the whole row as its name", () => {
	const view = mount({ ...root, thread_unread_count: 2 });
	try {
		const buttons = view.host.querySelectorAll("button");
		assert.equal(buttons.length, 1, "no control nested inside the row");
		const row = buttons[0];
		assert.equal(row.type, "button");
		assert.match(row.className, FULL_WIDTH);
		assert.equal(
			row.getAttribute("aria-label"),
			"View thread, 4 replies, 2 unread. Last reply today at 10:39 AM",
		);
		assert.equal(
			row.querySelector("[data-attention-badge]").textContent,
			"2 unread",
		);
		// D4: only the count is bold, so the badge does not slide between states.
		assert.doesNotMatch(row.className, SEMIBOLD);
		assert.match(row.querySelector(".text-accent").className, SEMIBOLD);
		// D1: transparent at rest (no ground utility), `sunken` on hover.
		assert.doesNotMatch(row.className, REST_FILL);
		assert.match(row.className, HOVER_SUNKEN);
		row.click();
		assert.deepEqual(view.opened, [root.id]);
	} finally {
		view.unmount();
	}
});

test("Enter on the focused row opens the thread (native button activation)", () => {
	const view = mount(root);
	try {
		const row = view.host.querySelector("button");
		row.focus();
		assert.equal(document.activeElement, row);
		/* JSDOM does not synthesize a click from Enter the way a browser does
		 * for a <button>; that activation is the platform's, and holds because
		 * the row IS a <button type=button> with no keydown handler to swallow
		 * it. Assert both halves: no handler cancels the key, and the
		 * synthesized click opens. */
		const enter = new dom.window.KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		assert.equal(row.dispatchEvent(enter), true, "Enter is not swallowed");
		row.click();
		assert.deepEqual(view.opened, [root.id]);
	} finally {
		view.unmount();
	}
});

test("badge: hidden when absent or 0, shown when N; height class identical", () => {
	const heights = [];
	for (const [unread, badge] of [
		[undefined, null],
		[0, null],
		[1, "1 unread"],
		[12, "12 unread"],
		[140, "99+ unread"],
	]) {
		const view = mount(
			unread === undefined ? root : { ...root, thread_unread_count: unread },
		);
		try {
			const row = view.host.querySelector("button");
			const mark = row.querySelector("[data-attention-badge]");
			assert.equal(mark?.textContent ?? null, badge, `unread=${unread}`);
			assert.equal(
				row.getAttribute("aria-label").includes("unread"),
				badge !== null,
			);
			heights.push(
				row.dataset.threadRowHeight,
				row.className.match(/\bh-\d+\b/g).join(" "),
			);
		} finally {
			view.unmount();
		}
	}
	assert.deepEqual(new Set(heights), new Set(["h-8"]), "one fixed height");
});

test("no replies: the row is absent", () => {
	const view = mount({ ...root, reply_count: 0 });
	try {
		assert.equal(view.host.querySelector("button"), null);
	} finally {
		view.unmount();
	}
});

test("an agent replier keeps the agent mark; an unresolved person draws an initial", () => {
	const view = mount({
		...root,
		reply_participants: ["Aida", "Bea"],
		reply_participant_ids: [{ account_id: "acct_aida", kind: "agent" }],
	});
	try {
		assert.ok(view.host.querySelector("[data-agent-mark]"));
		assert.equal(
			view.host.querySelector('[data-thread-face="initial"]').textContent,
			"B",
		);
	} finally {
		view.unmount();
	}
});

test("the message list draws the row in place of the old pill", () => {
	const client = new mod.QueryClient({
		defaultOptions: { queries: { gcTime: 0 } },
	});
	const app = mod.createRoot(document.getElementById("app"));
	try {
		mod.act(() => {
			app.render(
				mod.createElement(
					mod.QueryClientProvider,
					{ client },
					mod.createElement(mod.TeamBridgeMessageList, {
						messages: [{ ...root, thread_unread_count: 1 }],
						labelFor: (s) => s.display_label,
						onReply() {},
					}),
				),
			);
		});
		const row = document.querySelector("[data-thread-row]");
		assert.ok(row);
		assert.match(row.getAttribute("aria-label"), LIST_ROW_NAME);
	} finally {
		mod.act(() => app.unmount());
	}
});

async function readWith(capability, { answer = {}, newest, seq = 5 } = {}) {
	const api = mod.TeamBridgeApi;
	const saved = { markRead: api.markRead, markThreadRead: api.markThreadRead };
	const calls = [];
	api.markRead = async (...args) => {
		calls.push(["markRead", ...args]);
		return { last_read_seq: 5, unread_count: 0 };
	};
	api.markThreadRead = async (...args) => {
		calls.push(["markThreadRead", ...args]);
		return answer;
	};
	const client = new mod.QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: Number.POSITIVE_INFINITY,
				gcTime: Number.POSITIVE_INFINITY,
			},
			mutations: { retry: false, gcTime: 0 },
		},
	});
	// A validated owner in the REAL auth/status caches, the way
	// team-bridge-archive.test.mjs seeds it: the write fence reads both.
	client.setQueryData(["radient-user", "user"], {
		account: { id: "acct_captured" },
	});
	client.setQueryData(mod.teamBridgeKeys.statusFor("acct_captured"), {
		state: "ready",
		account_id: "acct_captured",
		local: { enabled: true },
	});
	client.setQueryData(mod.desktopKeys.capabilities, {
		desktop_available: true,
		features: capability ? { team_bridge_thread_reads: 1 } : {},
	});
	const key = mod.teamBridgeKeys.messages(
		root.conversation_id,
		"tenant_a",
		"acct_captured",
	);
	client.setQueryData(key, {
		messages: [{ ...root, thread_unread_count: 3, thread_last_read_seq: 1 }],
	});
	let hook;
	function Probe() {
		hook = mod.useMarkTeamBridgeThreadRead(
			root.conversation_id,
			"tenant_a",
			root.id,
			() => newest,
		);
		return null;
	}
	const app = mod.createRoot(document.getElementById("app"));
	try {
		mod.act(() => {
			app.render(
				mod.createElement(
					mod.QueryClientProvider,
					{ client },
					mod.createElement(Probe),
				),
			);
		});
		await mod.act(() => hook.mutateAsync({ seq }));
		return { calls, cached: client.getQueryData(key).messages[0] };
	} finally {
		mod.act(() => app.unmount());
		client.clear();
		Object.assign(api, saved);
	}
}

test("thread read: the TR1 route with the capability, today's conversation read without", async () => {
	// The hub's echo wins (F1): a partial read shows its remainder, not 0.
	const on = await readWith(true, { answer: { thread_unread_count: 2 } });
	assert.equal(on.calls[0][0], "markThreadRead");
	assert.equal(on.calls[0][1], root.conversation_id);
	assert.equal(on.calls[0][2], root.id);
	assert.equal(on.calls[0][3].seq, 5);
	assert.equal(on.calls[0][3].tenantId, "tenant_a");
	assert.equal(on.cached.thread_unread_count, 2, "the hub's remainder");
	assert.equal(on.cached.thread_last_read_seq, 5);

	const off = await readWith(false, { newest: 5 });
	assert.deepEqual(
		off.calls.map((call) => call[0]),
		["markRead"],
		"no thread-read call without the capability",
	);
	assert.equal(off.calls[0][2].seq, 5);
	assert.equal(off.cached.thread_unread_count, 0, "read to the tail: 0");
});

test("no optimistic zero on a partial read without an echo (F1)", async () => {
	const partial = await readWith(true, { newest: 9, seq: 5 });
	assert.equal(partial.cached.thread_unread_count, 3, "left to the refetch");
	const unknownTail = await readWith(false, { newest: undefined });
	assert.equal(unknownTail.cached.thread_unread_count, 3);
	assert.equal(mod.threadUnreadAfterRead(undefined, 9, 9), 0);
	assert.equal(mod.threadUnreadAfterRead(undefined, 8, 9), undefined);
	assert.equal(mod.threadUnreadAfterRead({ unread_count: 9 }, 8, 9), undefined);
});

test("thread reads accept only the authoritative thread count (F7)", async () => {
	const conversationOnly = await readWith(true, {
		answer: { unread_count: 9 },
		newest: 9,
		seq: 5,
	});
	assert.equal(
		conversationOnly.cached.thread_unread_count,
		3,
		"left to the refetch",
	);
	const authoritative = await readWith(true, {
		answer: {
			conversation_id: root.conversation_id,
			root_id: root.id,
			thread_last_read_seq: 5,
			thread_unread_count: 2,
		},
		newest: 9,
		seq: 5,
	});
	assert.equal(authoritative.cached.thread_unread_count, 2);
	assert.equal(mod.threadUnreadAfterRead({ unread_count: 9 }, 9, 9), 0);
	assert.equal(
		mod.threadUnreadAfterRead(
			{ thread_unread_count: 2, unread_count: 9 },
			9,
			9,
		),
		2,
	);
});

test("the cache write is owner-scoped and never invents a count (F2)", () => {
	const client = new mod.QueryClient({
		defaultOptions: { queries: { gcTime: 0 } },
	});
	const mine = mod.teamBridgeKeys.messages(
		root.conversation_id,
		"tenant_a",
		"acct_me",
	);
	const theirs = mod.teamBridgeKeys.messages(
		root.conversation_id,
		"tenant_a",
		"acct_other",
	);
	const old = { messages: [root] };
	client.setQueryData(mine, {
		messages: [{ ...root, thread_unread_count: 4 }],
	});
	client.setQueryData(theirs, {
		messages: [{ ...root, thread_unread_count: 4 }],
	});
	const target = {
		conversationId: root.conversation_id,
		tenantId: "tenant_a",
		rootId: root.id,
	};
	mod.setCachedThreadUnread(client, { ...target, accountId: "acct_me" }, 0, 9);
	assert.equal(client.getQueryData(mine).messages[0].thread_unread_count, 0);
	assert.equal(client.getQueryData(theirs).messages[0].thread_unread_count, 4);
	client.setQueryData(mine, old);
	mod.setCachedThreadUnread(client, { ...target, accountId: "acct_me" }, 0, 9);
	assert.equal(
		client.getQueryData(mine).messages[0].thread_unread_count,
		undefined,
		"an older hub's absent count stays absent",
	);
});

test("one unreadable participant id costs only its own plate (F3)", () => {
	const parsed = mod.teamBridgeMessageSchema.parse({
		...root,
		reply_participants: ["Ben", "Robo", "Cora"],
		reply_participant_ids: [
			{ account_id: "acct_ben", kind: "human" },
			{ account_id: "acct_robo", kind: "robot" },
			{ account_id: "acct_cora", kind: "agent" },
		],
	});
	assert.deepEqual(mod.threadParticipants(parsed), [
		{ label: "Ben", accountId: "acct_ben", kind: "human" },
		{ label: "Robo" },
		{ label: "Cora", accountId: "acct_cora", kind: "agent" },
	]);
});

test("earlier plates paint on top, so a leading agent keeps its mark (Q1)", () => {
	const view = mount({
		...root,
		reply_participants: ["Aida", "Ben", "Cora"],
	});
	try {
		const z = [
			...view.host.querySelectorAll("button > span:first-child > *"),
		].map((plate) => Number(plate.className.match(PLATE_Z)?.[1]));
		assert.deepEqual(z, [3, 2, 1]);
	} finally {
		view.unmount();
	}
});

test("the desktop op is strict and maps to the TR1 route", () => {
	const ok = mod.desktopRequestSchema.safeParse({
		op: "team_bridge.thread_read",
		conversation_id: "bcv_1",
		message_id: "bcmsg_1",
		tenant_id: "tenant_a",
		expected_account_id: "acct_a",
		seq: 3,
	});
	assert.equal(ok.success, true);
	for (const missing of [
		"expected_account_id",
		"tenant_id",
		"seq",
		"message_id",
	]) {
		const request = {
			op: "team_bridge.thread_read",
			conversation_id: "bcv_1",
			message_id: "bcmsg_1",
			tenant_id: "tenant_a",
			expected_account_id: "acct_a",
			seq: 3,
		};
		delete request[missing];
		assert.equal(
			mod.desktopRequestSchema.safeParse(request).success,
			false,
			`${missing} is required`,
		);
	}
});
