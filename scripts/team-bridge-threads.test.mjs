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
for (const state of ["ready", "loading", "error"])
	test(`thread pane renders ${state} without fake reply actions`, () => {
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
		assert.match(html, /Root question/);
		assert.match(html, /Close thread/);
		assert.match(
			html,
			state === "ready"
				? /No replies yet/
				: state === "loading"
					? /Loading messages/
					: /Messages could not be loaded/,
		);
		// The composer's textbox legitimately carries this name; a reply BUTTON
		// (the toolbar's) must not exist in the pane.
		assert.doesNotMatch(html, /<button[^>]*aria-label="Reply in thread"/);
	});
test("populated thread renders reply through safe markdown, never image requests", () => {
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

test("an old-root notification link fetches its root directly, preserves tenant and refuses foreign responses", async () => {
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
	assert.equal(
		mod.threadTargetFromSearch(
			new URLSearchParams({
				conversation: target.conversationId,
				thread: target.rootId,
			}),
		),
		null,
	);
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

test("old-root pane load, visible-reply read clears badge, and late old-target responses cannot paint or ack", async () => {
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
	dom.window.document.hasFocus = () => true;
	const observers = [];
	globalThis.IntersectionObserver = class {
		constructor(cb) {
			this.cb = cb;
			observers.push(this);
		}
		observe() {}
		disconnect() {}
	};
	const api = mod.TeamBridgeApi;
	const originalRead = api.markRead;
	const originalReplies = api.listReplies;
	const calls = [];
	let badge = 1;
	let finishOld;
	const client = new mod.QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	client.setQueryData(["team-bridge", "status"], {
		account_id: "acct_reader",
		tenant_id: "tenant_a",
		state: "ready",
		local: { enabled: true },
		read_only: false,
	});
	const app = mod.createRoot(dom.window.document.getElementById("app"));
	const target = {
		tenantId: "tenant_a",
		conversationId: root.conversation_id,
		rootId: root.id,
	};
	const render = async (identity) =>
		mod.act(async () => {
			app.render(
				mod.createElement(
					mod.QueryClientProvider,
					{ client },
					mod.createElement(mod.TeamBridgeThreadPane, {
						key: identity.rootId,
						target: identity,
						readOnly: false,
						labelFor: (s) => s.display_label,
						onClose() {},
					}),
				),
			);
		});
	try {
		api.markRead = async (conversationId, input) => {
			calls.push({ conversationId, ...input });
			if (input.seq >= 2) badge = 0;
			return { last_read_seq: input.seq, unread_count: badge };
		};
		api.listReplies = async () => ({
			root: { ...root, reply_count: 1 },
			replies: [
				{
					...root,
					id: "reply_visible",
					seq: 2,
					thread_root_id: root.id,
					body: "Visible answer",
				},
			],
			has_more: false,
		});
		await render(target);
		await mod.act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		const row = dom.window.document.querySelector(
			'[data-message-id="reply_visible"]',
		);
		assert.ok(
			row,
			"direct replies fetch resolves a root not present in any timeline page",
		);
		assert.equal(badge, 1, "loading alone does not acknowledge");
		await mod.act(async () => {
			observers.at(-1).cb([
				{
					target: row,
					isIntersecting: true,
					intersectionRect: { height: 20 },
				},
			]);
		});
		assert.equal(
			badge,
			0,
			"actually displayed reply acknowledges seq2 for this follower",
		);
		assert.deepEqual(calls, [
			{
				conversationId: root.conversation_id,
				tenantId: "tenant_a",
				seq: 2,
				expectedAccountId: "acct_reader",
			},
		]);
		const oldObserver = observers.at(-1);
		api.listReplies = () =>
			new Promise((resolve) => {
				finishOld = resolve;
			});
		await render({ ...target, rootId: "bcmsg_pending" });
		await mod.act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		api.listReplies = async () => ({
			root: { ...root, id: "bcmsg_new", body: "Current target" },
			replies: [],
			has_more: false,
		});
		await render({ ...target, rootId: "bcmsg_new" });
		await mod.act(async () => {
			finishOld({
				root: { ...root, id: "bcmsg_pending", body: "Stale old target" },
				replies: [],
				has_more: false,
			});
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		assert.ok(dom.window.document.body.textContent.includes("Current target"));
		assert.equal(
			dom.window.document.body.textContent.includes("Stale old target"),
			false,
		);
		oldObserver.cb([
			{ target: row, isIntersecting: true, intersectionRect: { height: 20 } },
		]);
		assert.equal(
			calls.length,
			1,
			"old observer and late fetch cannot acknowledge a new selection",
		);
	} finally {
		await mod.act(async () => app.unmount());
		for (const mutation of client.getMutationCache().getAll())
			mutation.destroy();
		client.clear();
		api.markRead = originalRead;
		api.listReplies = originalReplies;
		for (const [name, value] of Object.entries(saved)) globalThis[name] = value;
		dom.window.close();
	}
});

test("loading/error pane does not invent zero replies; a known root count remains honest", () => {
	for (const state of ["loading", "error"]) {
		const props = {
			root,
			replies: [],
			state,
			labelFor: (s) => s.display_label,
			onClose() {},
			onRetry() {},
			onSend: async () => {},
		};
		const unknown = mod.renderToStaticMarkup(
			mod.createElement(mod.TeamBridgeThreadPaneView, props),
		);
		assert.equal(unknown.includes("0 replies"), false);
		const known = mod.renderToStaticMarkup(
			mod.createElement(mod.TeamBridgeThreadPaneView, {
				...props,
				root: { ...root, reply_count: 3 },
			}),
		);
		assert.ok(known.includes("3 replies"));
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

test("reply hover tool and summary initials have no nested ladder plates", () => {
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
		const reply = dom.window.document.querySelector(
			'button[aria-label="Reply in thread"]',
		);
		assert.ok(reply);
		assert.equal(
			reply.classList.contains("bg-elevated"),
			false,
			"the shared ghost control has no independent resting ground",
		);
		/* The reveal moved to the message toolbar (one per row), which shows on
		   the row's hover AND focus-within; the button itself is the ghost. */
		const toolbar = reply.closest('[role="toolbar"]');
		assert.ok(toolbar);
		assert.ok(
			toolbar.className.includes("group-focus-within/message:opacity-100"),
		);
		assert.equal(
			reply.classList.contains("hover:bg-accent-wash"),
			true,
			"the established ghost primitive owns interaction feedback",
		);
		const initials = [
			...dom.window.document.querySelectorAll(
				'button span[aria-hidden="true"] span',
			),
		];
		assert.equal(initials.length, 2);
		assert.equal(
			initials.some((span) => span.classList.contains("bg-sunken")),
			false,
			"initials are ink on the summary action, not another plate inside its hover",
		);
	} finally {
		dom.window.close();
	}
});
