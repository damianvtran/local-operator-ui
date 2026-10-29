import assert from "node:assert/strict";

import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Execute the shipped model and render the real pane, not a second state map.
const bundle = await build({
	stdin: {
		contents: `export {TeamBridgeMessageList} from './src/renderer/src/features/team-bridge/team-bridge-message-list'; export {manageThreadFocus} from './src/renderer/src/features/team-bridge/team-bridge-thread-focus'; export * from './src/renderer/src/features/team-bridge/team-bridge-thread-read'; export {TeamBridgeApi, requireBridgeWriteAccount} from './src/renderer/src/shared/api/local-operator/team-bridge-api'; export {teamBridgeOpenPath} from './src/shared/team-bridge-notify'; export {threadSummary} from './src/renderer/src/features/team-bridge/team-bridge-threads-model'; export {TeamBridgeThreadPane, TeamBridgeThreadPaneView} from './src/renderer/src/features/team-bridge/team-bridge-thread-pane'; export {teamBridgeMessageSchema} from './src/shared/team-bridge-contract'; export {QueryClient, QueryClientProvider} from '@tanstack/react-query'; export {createRoot} from 'react-dom/client'; export {act} from 'react'; export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';`,
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
// Keep external packages resolving from the repo, not a data URL.
const { writeFile, unlink } = await import("node:fs/promises");
const path = `${process.cwd()}/.threads-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
/*
 * A DOM MUST EXIST BEFORE `react-dom` IS EVALUATED. React decides at import
 * time whether the `input` event is usable (`isInputEventSupported`) and, with
 * no `document`, takes its legacy value-tracking path — where a controlled
 * textarea's `onChange` never fires for a test-dispatched `input`, so a reply
 * typed here would look unsendable while the shipped app is fine. The reaction
 * harness (`team-bridge-reactions-behaviour.test.mjs`) installs its window
 * first for the same reason. One document for the file: every render below is
 * mounted into and unmounted from it.
 */
const dom = new JSDOM('<!doctype html><div id="app"></div>', {
	url: "http://localhost/",
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
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key] ?? dom.window,
	});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/* `pretendToBeVisual` would start a requestAnimationFrame loop, which is a live
 * handle and leaves the file's event loop unresolved after its last test. The
 * two frame functions are all the mounted pane needs, so they are shimmed the
 * way `team-bridge-reactions-behaviour.test.mjs` shims them. */
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
after(() => dom.window.close());
let mod;
try {
	mod = await import(path);
} finally {
	await unlink(path);
}
const root = {
	id: "bcmsg_root0001",
	conversation_id: "bcv_test0001",
	seq: 1,
	sender: { account_id: "acct_a", kind: "human", display_label: "Ada" },
	body: "Root question",
	origin: "human",
	created_at: "2026-10-21T10:00:00Z",
};
test("thread rollup accepts old messages and bounds participant facepile", () => {
	assert.equal(
		mod.threadSummary(mod.teamBridgeMessageSchema.parse(root)).count,
		0,
	);
	const summary = mod.threadSummary({
		...root,
		reply_count: 4,
		reply_participants: ["A", "B", "C", "D"],
		last_reply_at: "bad",
	});
	assert.equal(summary.count, 4);
	assert.equal(summary.participants.length, 3);
	assert.equal(summary.lastReply, null);
	assert.throws(() =>
		mod.teamBridgeMessageSchema.parse({ ...root, reply_count: -1 }),
	);
});
test("the shipped pane renders its ready, loading and error states", () => {
	for (const state of ["ready", "loading", "error"]) {
		const html = mod.renderToStaticMarkup(
			mod.createElement(mod.TeamBridgeThreadPaneView, {
				root,
				replies: [],
				state,
				labelFor: (s) => s.display_label,
				onClose() {},
				onRetry() {},
				onSend: async () => {},
			}),
		);
		assert.notEqual(html, "", `${state}: the shipped view renders its state`);
		assert.match(html, /Root question/);
	}
});

/*
 * D2/D3, THE CAPABILITY OF THE EMPTY STATE. Two facts the pane used to print
 * badly: a zero count directly above the empty sentence (one fact twice), and an
 * invitation to start the thread in an organization that cannot take a reply.
 * The count line is now absent at zero, and the invitation appears only where
 * the composer can send.
 */
test("the empty thread states the reply count once and invites only when it can send", () => {
	/*
	 * THE POSITIVE HALF, and the reason it is here: absence-only assertions let the
	 * whole count block be deleted and stay green (code round 2, F1). This renders a
	 * thread that actually has replies, so the line has to exist AND say the right
	 * number; the empty render below proves the zero is dropped without dropping
	 * the line.
	 */
	const counted = mod.renderToStaticMarkup(
		mod.createElement(mod.TeamBridgeThreadPaneView, {
			root: { ...root, reply_count: 3 },
			replies: [root, root, root],
			state: "ready",
			labelFor: (s) => s.display_label,
			onClose() {},
			onRetry() {},
			onSend: async () => {},
		}),
	);
	assert.match(
		counted,
		/3 replies/,
		"a thread with replies states how many, above the rows",
	);
	assert.doesNotMatch(
		counted,
		/No replies yet/,
		"a counted thread is not empty",
	);

	const writable = mod.renderToStaticMarkup(
		mod.createElement(mod.TeamBridgeThreadPaneView, {
			root,
			replies: [],
			state: "ready",
			labelFor: (s) => s.display_label,
			onClose() {},
			onRetry() {},
			onSend: async () => {},
		}),
	);
	assert.match(writable, /No replies yet\. Start the thread\./);
	assert.doesNotMatch(
		writable,
		/\b0 replies\b/,
		"a zero is not a count: the empty sentence already says it",
	);

	const readOnly = mod.renderToStaticMarkup(
		mod.createElement(mod.TeamBridgeThreadPaneView, {
			root,
			replies: [],
			state: "ready",
			readOnly: true,
			labelFor: (s) => s.display_label,
			onClose() {},
			onRetry() {},
			onSend: async () => {},
		}),
	);
	assert.doesNotMatch(
		readOnly,
		/Start the thread/,
		"a read-only pane must not invite a reply the composer refuses",
	);
	assert.doesNotMatch(readOnly, /\b0 replies\b/);
	assert.match(
		readOnly,
		/read-only/,
		"the read-only note is the sentence that explains the empty pane",
	);
});

test("the shipped pane renders reply markdown without loading remote images", () => {
	const html = mod.renderToStaticMarkup(
		mod.createElement(mod.TeamBridgeThreadPaneView, {
			root,
			replies: [
				{
					...root,
					id: "bcmsg_reply001",
					seq: 2,
					thread_root_id: root.id,
					body: "I claim this ![tracking](https://evil.example/pixel)",
				},
			],
			state: "ready",
			labelFor: (s) => s.display_label,
			onClose() {},
			onRetry() {},
			onSend: async () => {},
		}),
	);
	assert.match(html, /I claim this/);
	assert.doesNotMatch(html, /<img/);
});

test("displayed replies acknowledge only visible seqs in an active pane, with a cleanup fence", async () => {
	const dom = new JSDOM(
		'<aside><div data-radix-scroll-area-viewport><li data-message-id="r2"></li><li data-message-id="r3"></li><li data-message-id="r8"></li></div></aside>',
	);
	const pane = dom.window.document.querySelector("aside");
	let focused = true;
	let visibility = "visible";
	Object.defineProperty(dom.window.document, "visibilityState", {
		get: () => visibility,
	});
	dom.window.document.hasFocus = () => focused;
	let deliver;
	const observed = [];
	const prior = globalThis.IntersectionObserver;
	globalThis.IntersectionObserver = class {
		constructor(cb) {
			deliver = cb;
		}
		observe(node) {
			observed.push(node);
		}
		disconnect() {}
	};
	try {
		const calls = [];
		const stop = mod.observeDisplayedThreadReplies(
			pane,
			[
				{ ...root, id: "r2", seq: 2 },
				{ ...root, id: "r3", seq: 3 },
			],
			async (seq) => {
				calls.push(seq);
			},
		);
		const entry = (id, seen = true) => ({
			target: pane.querySelector(`[data-message-id="${id}"]`),
			isIntersecting: seen,
			intersectionRect: { height: seen ? 30 : 0 },
		});
		assert.equal(
			observed.length,
			2,
			"a not-yet-fetched reply cannot be acknowledged",
		);
		deliver([entry("r2"), entry("r3", false)]);
		assert.deepEqual(calls, [2], "loaded but offscreen seq3 is not read");
		focused = false;
		deliver([entry("r3")]);
		assert.deepEqual(calls, [2]);
		visibility = "hidden";
		focused = true;
		dom.window.dispatchEvent(new dom.window.Event("focus"));
		assert.deepEqual(calls, [2]);
		visibility = "visible";
		dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
		assert.deepEqual(calls, [2, 3]);
		stop();
		deliver([entry("r8")]);
		dom.window.dispatchEvent(new dom.window.Event("focus"));
		assert.deepEqual(
			calls,
			[2, 3],
			"queued callbacks after switching targets cannot acknowledge the old pane",
		);
	} finally {
		globalThis.IntersectionObserver = prior;
		dom.window.close();
	}
});

test("the open path carries the thread and the loader binds reads to the captured account", async () => {
	const target = {
		tenantId: "tenant_a",
		conversationId: root.conversation_id,
		rootId: root.id,
	};
	const url = mod.teamBridgeOpenPath({
		tenantId: target.tenantId,
		conversationId: target.conversationId,
		threadId: target.rootId,
	});
	assert.deepEqual(
		mod.threadTargetFromSearch(new URL(url, "http://localhost").searchParams),
		target,
	);
	assert.match(url, /thread=bcmsg_root0001/);
	const calls = [];
	const original = mod.TeamBridgeApi.listReplies;
	try {
		mod.TeamBridgeApi.listReplies = async (...args) => {
			calls.push(args);
			return { root, replies: [], has_more: false };
		};
		const page = await mod.loadThreadPage(target, "acct_captured");
		assert.equal(
			page.root.id,
			root.id,
			"no timeline lookup or locally selected root object is required",
		);
		assert.deepEqual(calls, [
			[
				target.conversationId,
				target.rootId,
				{
					tenantId: "tenant_a",
					accountId: "acct_captured",
					afterSeq: undefined,
				},
			],
		]);
		mod.TeamBridgeApi.listReplies = async () => ({
			root: { ...root, conversation_id: "foreign" },
			replies: [],
		});
		await assert.rejects(
			() => mod.loadThreadPage(target, "acct_captured"),
			/identity mismatch/,
		);
		mod.TeamBridgeApi.listReplies = async () => {
			throw new Error("wrong tenant: conversation_not_found");
		};
		await assert.rejects(
			() =>
				mod.loadThreadPage({ ...target, tenantId: "wrong" }, "acct_captured"),
			/wrong tenant/,
		);
	} finally {
		mod.TeamBridgeApi.listReplies = original;
	}
});

test("the shipped container reads and replies with the captured account", async () => {
	/* The module-level document (see the bootstrap above): React bound its event
	 * system to THAT window, so a second JSDOM here would be a different realm
	 * and its events would never reach the mounted tree. */
	const saved = {
		IntersectionObserver: globalThis.IntersectionObserver,
	};
	const api = mod.TeamBridgeApi;
	const originalRead = api.markRead;
	const originalReplies = api.listReplies;
	const originalSend = api.send;
	const calls = [];
	const client = new mod.QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const app = mod.createRoot(document.getElementById("app"));
	try {
		api.markRead = async (...args) => {
			calls.push(["markRead", ...args]);
			return { last_read_seq: 2, unread_count: 0 };
		};
		api.listReplies = async (...args) => {
			calls.push(["listReplies", ...args]);
			return { root, replies: [], has_more: false };
		};
		await mod.act(async () => {
			app.render(
				mod.createElement(
					mod.QueryClientProvider,
					{ client },
					mod.createElement(mod.TeamBridgeThreadPane, {
						target: {
							tenantId: "tenant_a",
							conversationId: root.conversation_id,
							rootId: root.id,
						},
						readOnly: false,
						accountId: "acct_captured",
						labelFor: (s) => s.display_label,
						onClose() {},
					}),
				),
			);
		});
		await mod.act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		const replyCalls = calls.filter(([op]) => op === "listReplies");
		assert.ok(replyCalls.length > 0, "the enabled pane reads its thread");
		assert.equal(replyCalls[0][3].accountId, "acct_captured");
		assert.equal(replyCalls[0][3].tenantId, "tenant_a");
		assert.match(document.body.textContent, /Root question/);
	} finally {
		/* ORDER MATTERS. The send invalidates the thread and feed keys, so a
		 * refetch can still be in flight. Unmount, cancel and let those settle
		 * BEFORE the real API is restored: restoring first points the in-flight
		 * read at the live transport, which has no `window.api` in this process,
		 * and the file then reports a promise that never settles. */
		await mod.act(async () => app.unmount());
		await mod.act(async () => client.cancelQueries());
		await mod.act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		client.clear();
		api.markRead = originalRead;
		api.listReplies = originalReplies;
		api.send = originalSend;
		globalThis.IntersectionObserver = saved.IntersectionObserver;
	}
	await mod.act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
});

/* The reply composer's own dispatch, through the shipped view and a recorded
 * `onSend`: no query cache, no mutation — the draft, its idempotency key and
 * the ids it forwards are the pane's contract, and the receipt is added by the
 * container above and validated by `team-bridge-receipt-contract.test.mjs`. */
/*
 * THE RECEIPT IS REQUIRED AT THE API BOUNDARY, not merely at the wire. A send
 * whose captured account has not resolved refuses before a request exists; the
 * required parameter is what makes deleting a call site's `expectedAccountId`
 * fail `check-types` instead of shipping a reply the guarded route 422s.
 */
test("a send cannot be attempted without a captured account", () => {
	assert.equal(mod.requireBridgeWriteAccount("acct_captured"), "acct_captured");
	for (const missing of [undefined, ""]) {
		assert.throws(
			() => mod.requireBridgeWriteAccount(missing),
			/Team Bridge write account required/,
		);
	}
});

test("the shipped reply composer dispatches a threaded reply with a client ref", async () => {
	const host = document.getElementById("app");
	const sent = [];
	const root2 = mod.createRoot(host);
	try {
		await mod.act(async () => {
			root2.render(
				mod.createElement(mod.TeamBridgeThreadPaneView, {
					root,
					replies: [],
					state: "ready",
					readOnly: false,
					target: {
						tenantId: "tenant_a",
						conversationId: root.conversation_id,
						rootId: root.id,
					},
					accountId: "acct_captured",
					tenantId: "tenant_a",
					conversationId: root.conversation_id,
					labelFor: (s) => s.display_label,
					onClose() {},
					onRetry() {},
					onSend: async (...args) => {
						sent.push(args);
					},
				}),
			);
		});
		const textarea = host.querySelector("textarea");
		assert.ok(textarea, "the reply composer is available");
		const setValue = Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		await mod.act(async () => {
			textarea.focus();
			setValue.call(textarea, "A guarded reply");
			textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		const send = host.querySelector('button[aria-label="Send"]');
		assert.ok(send, "the reply send button exists");
		assert.equal(send.disabled, false, "the typed reply is sendable");
		await mod.act(async () => {
			send.click();
		});
		assert.equal(sent.length, 1, "the composer dispatches the reply");
		assert.equal(sent[0][0], "A guarded reply");
		assert.equal(typeof sent[0][1], "string");
		assert.ok(sent[0][1].length > 0, "a client ref is minted for the reply");
		assert.deepEqual(sent[0][2], [], "no attachment ids for a text reply");
	} finally {
		await mod.act(async () => root2.unmount());
	}
});

test("opening a thread focuses close; Escape respects menus and close restores the invoking row", () => {
	const dom = new JSDOM(
		'<button id="origin">Reply</button><aside><button data-thread-close>Close</button><textarea></textarea></aside>',
	);
	const doc = dom.window.document;
	const pane = doc.querySelector("aside");
	const origin = doc.getElementById("origin");
	origin.focus();
	let closed = 0;
	const cleanup = mod.manageThreadFocus(pane, () => {
		closed++;
	});
	assert.equal(doc.activeElement, pane.querySelector("[data-thread-close]"));
	const menu = doc.createElement("div");
	menu.setAttribute("role", "menu");
	pane.append(menu);
	pane.querySelector("textarea").dispatchEvent(
		new dom.window.KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		}),
	);
	assert.equal(closed, 0, "a menu owns the first Escape");
	menu.remove();
	pane.querySelector("textarea").focus();
	pane.querySelector("textarea").dispatchEvent(
		new dom.window.KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		}),
	);
	assert.equal(closed, 1);
	cleanup();
	assert.equal(doc.activeElement, origin);
	dom.window.close();
});

test("a shipped row renders its reply control and thread summary", () => {
	const html = mod.renderToStaticMarkup(
		mod.createElement(mod.TeamBridgeMessageList, {
			messages: [
				{ ...root, reply_count: 2, reply_participants: ["Ada", "Bea"] },
			],
			labelFor: (sender) => sender.display_label,
			onReply() {},
		}),
	);
	const dom = new JSDOM(html);
	try {
		assert.match(html, /Root question/);
		assert.ok(
			dom.window.document.querySelector('button[aria-label="Reply in thread"]'),
		);
		assert.ok(dom.window.document.querySelector('[role="toolbar"]'));
		assert.ok(
			dom.window.document.querySelectorAll(
				'button span[aria-hidden="true"] span',
			).length > 0,
			"the thread summary carries participant initials",
		);
	} finally {
		dom.window.close();
	}
});
