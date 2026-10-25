import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Execute the shipped model and render the real pane, not a second state map.
const bundle = await build({
	stdin: {
		contents: `export {TeamBridgeMessageList} from './src/renderer/src/features/team-bridge/team-bridge-message-list'; export {manageThreadFocus} from './src/renderer/src/features/team-bridge/team-bridge-thread-focus'; export * from './src/renderer/src/features/team-bridge/team-bridge-thread-read'; export {TeamBridgeApi} from './src/renderer/src/shared/api/local-operator/team-bridge-api'; export {teamBridgeOpenPath} from './src/shared/team-bridge-notify'; export {threadSummary} from './src/renderer/src/features/team-bridge/team-bridge-threads-model'; export {TeamBridgeThreadPane, TeamBridgeThreadPaneView} from './src/renderer/src/features/team-bridge/team-bridge-thread-pane'; export {teamBridgeMessageSchema} from './src/shared/team-bridge-contract'; export {QueryClient, QueryClientProvider} from '@tanstack/react-query'; export {createRoot} from 'react-dom/client'; export {act} from 'react'; export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	external: ["react", "react-dom/server"],
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
});
// Keep external packages resolving from the repo, not a data URL.
const { writeFile, unlink } = await import("node:fs/promises");
const path = `${process.cwd()}/.threads-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
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
/*
 * THE HOLD AT THE PANE'S OWN DOOR. `TeamBridgeThreadPaneView` is the export a
 * story or rig mounts directly, and it now renders nothing while the thread
 * surface is held: no root body, no state copy (so no invented reply count) and
 * no markdown/image path. These three states used to assert the pane's copy;
 * the copy is unreachable until the constant flips, and asserting it here would
 * be an assertion about a surface no build mounts.
 */
test("the held pane view renders nothing in every state", () => {
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
		assert.equal(html, "", `${state}: the held view renders no body`);
	}
});

test("a held pane reaches no markdown or image path either", () => {
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
	assert.equal(html, "");
	assert.doesNotMatch(html, /I claim this|tracking|<img/);
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

test("the held open path carries no thread, while the loader still addresses the root and refuses foreign responses", async () => {
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
	// THE HOLD: the conversation is routable, the thread lane is not.
	assert.equal(
		mod.threadTargetFromSearch(new URL(url, "http://localhost").searchParams),
		null,
	);
	assert.doesNotMatch(url, /thread=|bcmsg_root0001/);
	const calls = [];
	const original = mod.TeamBridgeApi.listReplies;
	try {
		mod.TeamBridgeApi.listReplies = async (...args) => {
			calls.push(args);
			return { root, replies: [], has_more: false };
		};
		const page = await mod.loadThreadPage(target);
		assert.equal(
			page.root.id,
			root.id,
			"no timeline lookup or locally selected root object is required",
		);
		assert.deepEqual(calls, [
			[
				target.conversationId,
				target.rootId,
				{ tenantId: "tenant_a", afterSeq: undefined },
			],
		]);
		mod.TeamBridgeApi.listReplies = async () => ({
			root: { ...root, conversation_id: "foreign" },
			replies: [],
		});
		await assert.rejects(() => mod.loadThreadPage(target), /identity mismatch/);
		mod.TeamBridgeApi.listReplies = async () => {
			throw new Error("wrong tenant: conversation_not_found");
		};
		await assert.rejects(
			() => mod.loadThreadPage({ ...target, tenantId: "wrong" }),
			/wrong tenant/,
		);
	} finally {
		mod.TeamBridgeApi.listReplies = original;
	}
});

test("the held container mounts nothing and issues no thread read or acknowledgement", async () => {
	const dom = new JSDOM('<div id="app"></div>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const saved = {
		window: globalThis.window,
		document: globalThis.document,
		IntersectionObserver: globalThis.IntersectionObserver,
		IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
	};
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const api = mod.TeamBridgeApi;
	const originalRead = api.markRead;
	const originalReplies = api.listReplies;
	const calls = [];
	const client = new mod.QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const app = mod.createRoot(dom.window.document.getElementById("app"));
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
						labelFor: (s) => s.display_label,
						onClose() {},
					}),
				),
			);
		});
		await mod.act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		assert.deepEqual(calls, [], "the held mount must not touch the transport");
		assert.equal(dom.window.document.body.textContent.trim(), "");
	} finally {
		await mod.act(async () => app.unmount());
		client.clear();
		api.markRead = originalRead;
		api.listReplies = originalReplies;
		for (const [name, value] of Object.entries(saved)) globalThis[name] = value;
		dom.window.close();
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

test("a held row renders no reply control or summary, so neither can nest a plate", () => {
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
		// The body still renders; the thread affordances do not.
		assert.match(html, /Root question/);
		assert.equal(
			dom.window.document.querySelector('button[aria-label="Reply in thread"]'),
			null,
		);
		assert.equal(dom.window.document.querySelector('[role="toolbar"]'), null);
		assert.equal(
			dom.window.document.querySelectorAll(
				'button span[aria-hidden="true"] span',
			).length,
			0,
			"no summary initials without a summary action",
		);
	} finally {
		dom.window.close();
	}
});
