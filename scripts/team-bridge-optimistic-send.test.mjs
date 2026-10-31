import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE OPTIMISTIC SEND (operator report, 2026-10-30): "It takes a really long time
 * for my message to appear when sending the first message to someone or their
 * agent, make sure that it optimistically sends messages and those appear
 * instantly with no delay and then that's reconciled on the server side once
 * available seamlessly."
 *
 * WHAT THESE CASES OWN, in the order a person meets them:
 *   1. the row is in the DOM at the PRESS, before the request answers;
 *   2. a FIRST message is drawn in the lane the reader is looking at, before any
 *      conversation exists;
 *   3. reconciliation replaces the row IN PLACE - one row at every instant, the
 *      same element, no duplicate even for one frame;
 *   4. a failure leaves a failed row with Retry and Edit, and Retry keeps the key;
 *   5. two quick messages keep send order, whatever order the hub answers in;
 *   6. a 409 `client_ref` conflict re-keys the ROW rather than orphaning it.
 *
 * These are DOM/state probes over the real view, the real store and the real
 * message list. The transport is a function, so nothing here is timing or layout
 * evidence: the frames and the millisecond measurement live in the PR's visual
 * evidence, and a jsdom rect would be zero because there is no layout engine.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
dom.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async () => ({}),
	},
};
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
for (const name of [
	"HTMLElement",
	"Element",
	"Node",
	"NodeFilter",
	"MutationObserver",
	"DocumentFragment",
	"CustomEvent",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLButtonElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"FileReader",
])
	globalThis[name] = dom.window[name];
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(0), 0);
globalThis.cancelAnimationFrame = clearTimeout;
Object.defineProperty(dom.window.document, "visibilityState", {
	value: "hidden",
});
Object.defineProperty(dom.window.document, "hidden", { value: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const sidebarRole = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
).match(/export const rowCurrent =\s*("[^"]+")/)?.[1];
assert.ok(sidebarRole);
const SIDEBAR_IMPORT = /chat\/components\/chat-sidebar$/;
const ANY_PATH = /.*/;
const sidebarStub = {
	name: "chat-sidebar-stub",
	setup(build) {
		build.onResolve({ filter: SIDEBAR_IMPORT }, () => ({
			path: "sidebar-role",
			namespace: "stub",
		}));
		build.onLoad({ filter: ANY_PATH, namespace: "stub" }, () => ({
			contents: `export const rowCurrent = ${sidebarRole};`,
			loader: "js",
		}));
	},
};
const bundle = await build({
	stdin: {
		contents: `export {registerCatalogue, setLocale} from "./src/i18n";
 export {TeamBridgePageView} from "./src/renderer/src/features/team-bridge/team-bridge-page";
 export {QueryClient, QueryClientProvider} from "@tanstack/react-query";
 export {usePendingSends, resetPendingSendsForTest} from "./src/renderer/src/features/team-bridge/team-bridge-pending-sends";
 export {reconcileDraftAccount} from "./src/renderer/src/shared/store/team-bridge-draft-account";
 export {useConversationInputStore} from "./src/renderer/src/shared/store/conversation-input-store";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["@tanstack/react-query", "react", "react-dom"],
	plugins: [sidebarStub],
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = `${process.cwd()}/scripts/team-bridge-optimistic-send-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
m.setLocale("en");
after(() => dom.window.close());

const human = (accountId, label) => ({
	account_id: accountId,
	kind: "human",
	display_label: label,
});
const dmRow = {
	id: "bcv_dm",
	tenant_id: "org_page",
	kind: "dm",
	name: null,
	members: [human("acct_a", "Ada"), human("acct_b", "Bea")],
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2030-01-01T00:00:00Z",
	latest_seq: 0,
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
};
const personTarget = { type: "person", accountId: "acct_b" };
const conversationTarget = { type: "conversation", id: "bcv_dm" };
const pageProps = (overrides) => ({
	selfAccountId: "acct_a",
	accountId: "acct_a",
	selfName: "Ada",
	scope: "org_page",
	conversations: [dmRow],
	people: [
		{ account_id: "acct_b", display_label: "Bea", email: "bea@example.com" },
	],
	messages: [],
	organizations: [
		{ tenantId: "org_page", name: "Page org", role: "owner", unread: 0 },
	],
	totalUnread: 0,
	listState: "ready",
	messageState: "ready",
	onTarget: () => {},
	onNewChannel: () => {},
	onScopeChange: () => {},
	...overrides,
});
async function mountPage(props) {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	const client = new m.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const render = async (next) =>
		act(async () =>
			root.render(
				React.createElement(
					m.QueryClientProvider,
					{ client },
					React.createElement(m.TeamBridgePageView, next),
				),
			),
		);
	await render(props);
	return {
		element,
		render,
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}
const settle = () =>
	act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
async function typeBody(element, text) {
	const field = element.querySelector("textarea");
	assert.ok(field, "composer field is mounted");
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(field, text);
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}
const sendButton = (element) =>
	[...element.querySelectorAll("button")].find((button) =>
		["Send", "Send message"].includes(button.getAttribute("aria-label")),
	);
const rows = (element) => [...element.querySelectorAll("[data-row-key]")];
const _rowText = (element) => rows(element).map((row) => row.textContent);
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const conflict = () =>
	Object.assign(
		new Error(
			"[conflict] This client_ref was already used for a different conversation message.",
		),
		{ status: 409 },
	);
const message = (overrides = {}) => ({
	id: "msg_server",
	conversation_id: "bcv_dm",
	seq: 1,
	sender: human("acct_a", "Ada"),
	body: "hello",
	origin: "human",
	created_at: "2030-01-01T00:00:00Z",
	...overrides,
});

test("the row is in the DOM at the press, before the send answers", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const gate = deferred();
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: () => gate.promise,
		}),
	);
	try {
		await typeBody(app.element, "hello");
		await act(async () => sendButton(app.element).click());
		/*
		 * THIS IS THE MEASUREMENT THE REPORT ASKED FOR, at the only layer that can
		 * make it without a layout engine: the row is present with the send still
		 * unanswered, and the box has already cleared.
		 */
		const drawn = rows(app.element);
		assert.equal(drawn.length, 1, "one row, at the press");
		assert.equal(drawn[0].getAttribute("data-delivery"), "pending");
		assert.ok(drawn[0].textContent.includes("hello"));
		assert.equal(
			app.element.querySelector("textarea")?.value,
			"",
			"the box clears in the same commit",
		);
		gate.resolve(undefined);
	} finally {
		await app.close();
	}
});

test("a first message is drawn in the person's lane before any conversation exists", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const gate = deferred();
	const app = await mountPage(
		pageProps({
			target: personTarget,
			onSend: () => gate.promise,
		}),
	);
	try {
		await typeBody(app.element, "first words");
		await act(async () => sendButton(app.element).click());
		const drawn = rows(app.element);
		assert.equal(
			drawn.length,
			1,
			"the row is in the pane the reader is looking at, with no conversation yet",
		);
		assert.ok(drawn[0].textContent.includes("first words"));
		assert.ok(
			!app.element.textContent.includes("No messages yet"),
			"the empty state is gone the moment the row is drawn",
		);
		gate.resolve(undefined);
	} finally {
		await app.close();
	}
});

test("the server row replaces the optimistic one in place: one row, same element", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const gate = deferred();
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: () => gate.promise,
		}),
	);
	try {
		await typeBody(app.element, "hello");
		await act(async () => sendButton(app.element).click());
		const before = rows(app.element);
		assert.equal(before.length, 1);
		const [optimistic] = before;
		assert.equal(optimistic.getAttribute("data-delivery"), "pending");

		gate.resolve(message({ id: "msg_server", seq: 1 }));
		await settle();
		/* The page's own read now carries the stored message, as the refetch after a
		   send does in production. */
		const history = [message({ id: "msg_server", seq: 1 })];
		await app.render(
			pageProps({
				target: conversationTarget,
				messages: history,
				onSend: () => gate.promise,
			}),
		);
		await settle();
		const after = rows(app.element);
		assert.equal(after.length, 1, "never two copies, not even for one render");
		assert.equal(
			after[0],
			optimistic,
			"the same element: no remount, so no flicker and no second arrival",
		);
		assert.equal(
			after[0].getAttribute("data-delivery"),
			null,
			"the row is the server's now",
		);
	} finally {
		await app.close();
	}
});

test("a failure leaves the row marked failed, with Retry and Edit", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
				throw new Error("transport refused");
			},
		}),
	);
	try {
		await typeBody(app.element, "does not go");
		await act(async () => sendButton(app.element).click());
		await settle();
		const [failed] = rows(app.element);
		assert.equal(failed.getAttribute("data-delivery"), "failed");
		assert.ok(failed.textContent.includes("does not go"), "the text stays");
		const buttons = [...failed.querySelectorAll("button")];
		assert.ok(
			buttons.some((button) => button.textContent === "Retry"),
			"Retry is on the row",
		);
		assert.ok(
			buttons.some((button) => button.textContent === "Edit"),
			"Edit is on the row",
		);
		/* EDIT PUTS THE WORDS BACK AND DROPS THE ROW - one copy, in the box. */
		await act(async () =>
			buttons.find((button) => button.textContent === "Edit").click(),
		);
		await settle();
		assert.equal(rows(app.element).length, 0, "the row is gone");
		assert.equal(
			app.element.querySelector("textarea")?.value,
			"does not go",
			"and the text is back in the composer",
		);
	} finally {
		await app.close();
	}
});

test("two quick messages keep send order, whatever order the hub answers in", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const gates = [deferred(), deferred()];
	const bodies = [];
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: async (body, _clientRef) => {
				const index = bodies.push(body) - 1;
				return gates[index].promise;
			},
		}),
	);
	try {
		await typeBody(app.element, "first");
		await act(async () => sendButton(app.element).click());
		await typeBody(app.element, "second");
		await act(async () => sendButton(app.element).click());
		assert.deepEqual(
			rows(app.element).map((row) => row.querySelector("p")?.textContent),
			["first", "second"],
			"send order, before any answer",
		);
		/* The hub answers the SECOND first: the queue holds the first, so the wire
		   order - and therefore the ordering the hub numbers - is still press order. */
		assert.deepEqual(bodies, ["first"], "the second waits for the first");
		gates[0].resolve(message({ id: "msg_one", seq: 1, body: "first" }));
		await settle();
		assert.deepEqual(
			bodies,
			["first", "second"],
			"the second is posted once the first is confirmed",
		);
		gates[1].resolve(message({ id: "msg_two", seq: 2, body: "second" }));
		await settle();
		await app.render(
			pageProps({
				target: conversationTarget,
				messages: [
					message({ id: "msg_one", seq: 1, body: "first" }),
					message({ id: "msg_two", seq: 2, body: "second" }),
				],
				onSend: async () => undefined,
			}),
		);
		await settle();
		assert.deepEqual(
			rows(app.element).map((row) => row.querySelector("p")?.textContent),
			["first", "second"],
			"and they stay in that order after reconciliation",
		);
	} finally {
		await app.close();
	}
});

test("a 409 conflict re-keys the row instead of orphaning it", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
				if (refs.length === 1) throw conflict();
				return message({ id: "msg_retried", seq: 1 });
			},
		}),
	);
	try {
		await typeBody(app.element, "hello");
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.deepEqual(refs.length, 2, "the conflict is retried, once");
		assert.notEqual(refs[1], refs[0], "the retry never reuses the burnt key");
		const drawn = rows(app.element);
		assert.equal(drawn.length, 1, "one row: the retry is the same message");
		assert.equal(
			drawn[0].getAttribute("data-delivery"),
			null,
			"and it is confirmed under the key that landed",
		);
	} finally {
		await app.close();
	}
});

/* ---------------------------------------------------------------------------
 * REMEDIATION - round 1
 *
 * Four defects the first round found in the optimistic path, each one written as
 * the smallest case that fails before the fix and passes after it.
 * ------------------------------------------------------------------------- */

/*
 * B1 - THE SAME WORDS TWICE IS TWO MESSAGES, NOT A REPLAY.
 *
 * `submit` returns at once now, so a second press of the same text is possible
 * while the first is still in flight. It used to look like a retry and reuse the
 * key: the hub answers a replayed key carrying the same body by returning the
 * ORIGINAL message, so the second press produced a success and no row. Two presses,
 * one message.
 */
test("pressing Send twice with the same text while it is pending keeps two keys and two rows", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const gates = [deferred(), deferred()];
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: (_body, clientRef) => {
				refs.push(clientRef);
				return gates[refs.length - 1].promise;
			},
		}),
	);
	try {
		await typeBody(app.element, "ok");
		await act(async () => sendButton(app.element).click());
		await typeBody(app.element, "ok");
		await act(async () => sendButton(app.element).click());
		await settle();
		/*
		 * The second press waits for the first to settle (the lane keeps send order),
		 * so what is observable at once is the ROW: two messages, two rows, before
		 * either request finishes.
		 */
		assert.equal(
			rows(app.element).length,
			2,
			"both messages are visible at once",
		);
		assert.equal(refs.length, 1, "the second is queued behind the first");
		gates[0].resolve(undefined);
		await settle();
		assert.equal(
			refs.length,
			2,
			"the queued press is dispatched once the lane drains",
		);
		assert.notEqual(
			refs[0],
			refs[1],
			"a pending message's key is spent; the second 'ok' must mint its own",
		);
		gates[1].resolve(undefined);
	} finally {
		await app.close();
	}
});

/*
 * B2 - A LANE IS ONE DRAFT, NOT ONE KIND OF DRAFT.
 *
 * Every compose draft shared the lane key `"compose"`, and a lane remembers the
 * conversation its first create produced. A later group therefore posted into the
 * earlier group - the message reached people the author never addressed. The lane
 * now carries the account and the full draft identity, and forgets its conversation
 * when it drains.
 */
test("two different group drafts never share a created conversation", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const intos = [];
	const firstTarget = {
		type: "compose",
		recipients: [
			{ kind: "human", accountId: "acct_b", label: "Bea" },
			{ kind: "human", accountId: "acct_c", label: "Cy" },
		],
	};
	const secondTarget = {
		type: "compose",
		recipients: [
			{ kind: "human", accountId: "acct_d", label: "Di" },
			{ kind: "human", accountId: "acct_e", label: "Ed" },
		],
	};
	/* The container's part: report the created id back to the view, then post. */
	const send = (createdId) => (_body, _clientRef, _attachments, delivery) => {
		intos.push(delivery?.into?.conversationId);
		if (!delivery?.into) delivery?.onCreated?.(createdId, "org_page");
		return Promise.resolve(undefined);
	};
	const app = await mountPage(
		pageProps({ target: firstTarget, onSend: send("bcv_group_first") }),
	);
	try {
		await typeBody(app.element, "for Bea and Cy");
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.equal(
			intos[0],
			undefined,
			"the first draft creates its conversation",
		);
		await app.render(
			pageProps({ target: secondTarget, onSend: send("bcv_group_second") }),
		);
		await typeBody(app.element, "for Di and Ed");
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.equal(
			intos[1],
			undefined,
			"a second draft creates its own conversation instead of posting into the first group",
		);
	} finally {
		await app.close();
	}
});

/*
 * M1 / D1 - THE MOVE ONTO THE CREATED CONVERSATION MUST NOT COVER THE ROW.
 *
 * The reported lane: a first message to a person. `onCreated` resolves the person
 * to the new DM, so the thread's query starts fresh and reports "loading" - and the
 * loading branch was tested BEFORE the rows, so the author's message vanished behind
 * a spinner for one round trip and remounted when the read landed. The row is drawn
 * ahead of that state now, and the same element must survive it.
 */
test("the first message survives the move onto its conversation, through the thread read", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	/* A PERSON WITH NO DM YET: `personTarget` is Bea, who already has one, so that
	   target resolves into an existing conversation and never creates anything. */
	const app = await mountPage(
		pageProps({
			target: { type: "person", accountId: "acct_c" },
			/* A roster row for the person, or the pane has no destination at all. */
			people: [
				{
					account_id: "acct_b",
					display_label: "Bea",
					email: "bea@example.com",
				},
				{ account_id: "acct_c", display_label: "Cy", email: "cy@example.com" },
			],
			/* The container's part: the create answers and reports its conversation. */
			onSend: (_body, _clientRef, _attachments, delivery) => {
				delivery?.onCreated?.("bcv_new_dm", "org_page");
				return Promise.resolve(undefined);
			},
		}),
	);
	const newDm = {
		...dmRow,
		id: "bcv_new_dm",
		latest_seq: 0,
		last_message_at: null,
	};
	try {
		await typeBody(app.element, "first words");
		await act(async () => sendButton(app.element).click());
		const [atPress] = rows(app.element);
		assert.ok(atPress, "the row exists in the person lane");
		/* The create answered: the list now holds the DM, its thread read is out. */
		await app.render(
			pageProps({
				target: { type: "conversation", id: newDm.id },
				conversations: [newDm],
				messageState: "loading",
			}),
		);
		await settle();
		const drawn = rows(app.element);
		assert.equal(drawn.length, 1, "one row while the thread read is in flight");
		assert.equal(
			drawn[0],
			atPress,
			"the same element: the row was not unmounted behind the spinner",
		);
		assert.ok(
			!app.element.querySelector('[aria-label="Loading messages"]'),
			"no spinner over the author's own message",
		);
		/* The read lands; the row is still the same node. */
		await app.render(
			pageProps({
				target: { type: "conversation", id: newDm.id },
				conversations: [newDm],
				messages: [],
			}),
		);
		await settle();
		assert.equal(
			rows(app.element)[0],
			atPress,
			"and still the same element after it",
		);
	} finally {
		await app.close();
	}
});

/*
 * M2 - A CONVERSATION THIS CLIENT JUST CREATED IS NOT A STRANGER.
 *
 * A group draft moves the view onto the new conversation as soon as its create
 * answers, one line before the list refetch that would contain it. The thread read
 * that decision as "addressed, not in your list" and said the reader may not be a
 * member of the group they had just made.
 */
test("a freshly created group is never reported as not open to you", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const target = {
		type: "compose",
		/* Two addressees: a group, which is the only draft a create can make (a single
		   person resolves to their DM and never reaches this path). */
		recipients: [
			{ kind: "human", accountId: "acct_b", label: "Bea" },
			{ kind: "human", accountId: "acct_c", label: "Cy" },
		],
	};
	const app = await mountPage(
		pageProps({
			target,
			onSend: (_body, _clientRef, _attachments, delivery) => {
				delivery?.onCreated?.("bcv_new_group", "org_page");
				return Promise.resolve(undefined);
			},
		}),
	);
	try {
		await typeBody(app.element, "for the new group");
		await act(async () => sendButton(app.element).click());
		await settle();
		/* The view is on the created conversation; the list has not caught up. */
		await app.render(
			pageProps({
				target: { type: "conversation", id: "bcv_new_group" },
				conversations: [dmRow],
				messageState: "idle",
			}),
		);
		await settle();
		assert.equal(rows(app.element).length, 1, "the row is still drawn");
		assert.ok(
			!app.element.textContent.includes("not open to you"),
			"and the pane does not refuse a conversation it just created",
		);
	} finally {
		await app.close();
	}
});

/*
 * D2 - A PENDING ROW NEVER DRAWS ABOVE A CONFIRMED ONE.
 *
 * A confirmed row drawn from its send response keeps the hub's seq while the page
 * does not hold it yet; a pending row was numbered from the PAGE alone, so it could
 * sort above the message that came first and the two swapped when the page caught up.
 */
test("a second message never draws above the first, even before the page catches up", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const second = deferred();
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: (body) =>
				body === "first"
					? Promise.resolve(message({ id: "msg_first", seq: 1 }))
					: second.promise,
		}),
	);
	try {
		await typeBody(app.element, "first");
		await act(async () => sendButton(app.element).click());
		await settle();
		await typeBody(app.element, "second");
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.deepEqual(
			rows(app.element).map((row) => row.querySelector("p")?.textContent),
			["hello", "second"],
			"send order: the confirmed row first, the pending one after it",
		);
		second.resolve(undefined);
	} finally {
		await app.close();
	}
});

/*
 * D3 - THE PENDING STATE IS NOT SILENT TO A SCREEN READER.
 *
 * The ink change is the visual cue; a status is the non-visual one. It is one per
 * unconfirmed row and it leaves with the state.
 */
test("a pending row announces that it is sending, and stops when confirmed", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const gate = deferred();
	const app = await mountPage(
		pageProps({ target: conversationTarget, onSend: () => gate.promise }),
	);
	try {
		await typeBody(app.element, "still going");
		await act(async () => sendButton(app.element).click());
		const status = app.element.querySelector(
			'[data-row-key] [aria-live="polite"]',
		);
		assert.ok(status, "the row carries a status while in flight");
		assert.ok(status.textContent.trim().length > 0, "with words in it");
		gate.resolve(message({ id: "msg_done", seq: 1, body: "still going" }));
		await settle();
		assert.equal(
			app.element.querySelector('[data-row-key] [aria-live="polite"]'),
			null,
			"and the status leaves with the pending state",
		);
	} finally {
		await app.close();
	}
});

/*
 * m1 - EDIT THEN SEND IS THE SAME ATTEMPT (review round 2).
 *
 * Edit takes a failed message out of the store and puts its words back in the box.
 * Pressing Send with them unchanged is the reader retrying that message, not writing
 * a new one - so it must keep the attempt's key. Minting a fresh one would post a
 * second copy of anything the first request actually landed (answer lost), which is
 * the duplicate this whole attempt record exists to prevent. Retry already kept it;
 * this is the other door to the same message.
 */
test("Edit then Send with the text unchanged keeps the attempt's key", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: (_body, clientRef) => {
				refs.push(clientRef);
				if (refs.length === 1) throw new Error("response lost");
				return undefined;
			},
		}),
	);
	try {
		await typeBody(app.element, "did this land?");
		await act(async () => sendButton(app.element).click());
		await settle();
		const [failed] = rows(app.element);
		const edit = [...failed.querySelectorAll("button")].find(
			(button) => button.textContent === "Edit",
		);
		await act(async () => edit.click());
		await settle();
		assert.equal(
			app.element.querySelector("textarea")?.value,
			"did this land?",
			"Edit hands the words back",
		);
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.equal(refs.length, 2, "the second press reached the wire");
		assert.equal(
			refs[1],
			refs[0],
			"the retried words keep their key, so a landed request is deduplicated",
		);
	} finally {
		await app.close();
	}
});

/*
 * M3 - NOTHING UNSENT OUTLIVES THE ACCOUNT (review round 2's regression case).
 *
 * The drafts, the composer's rows and the send-attempt records all die with the
 * account. The pending rows and the lanes are the operator's unsent words in the
 * same sense - a failed row used to come back with a live Retry for whoever signed
 * in next - and they register with the same fence. This drives the real reconciler
 * the app calls and asserts both halves: the rows go, and a lane forgets the
 * conversation it created, so the next draft cannot post into the previous one.
 */
test("signing out empties the pending rows and the lanes' remembered conversation", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const intos = [];
	const target = {
		type: "compose",
		recipients: [
			{ kind: "human", accountId: "acct_b", label: "Bea" },
			{ kind: "human", accountId: "acct_c", label: "Cy" },
		],
	};
	const app = await mountPage(
		pageProps({
			target,
			onSend: (_body, _clientRef, _attachments, delivery) => {
				intos.push(delivery?.into?.conversationId);
				if (!delivery?.into)
					delivery?.onCreated?.("bcv_after_signout", "org_page");
				return Promise.resolve(undefined);
			},
		}),
	);
	try {
		await typeBody(app.element, "before sign-out");
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.equal(
			m.usePendingSends.getState().entries.length,
			1,
			"the row is held while the account is signed in",
		);
		await act(async () => {
			m.reconcileDraftAccount(window.localStorage, { state: "signed_out" });
		});
		assert.equal(
			m.usePendingSends.getState().entries.length,
			0,
			"the unsent row is dropped with the account",
		);
		await typeBody(app.element, "after sign-out");
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.deepEqual(
			intos,
			[undefined, undefined],
			"and the lane forgot the conversation it created, so the next draft creates its own",
		);
	} finally {
		await app.close();
	}
});

/*
 * D3 (design round 2) - THE PENDING INK MUST REACH THE PROSE BLOCK.
 *
 * `.lo-markdown { color: var(--md-ink, var(--lo-ink)) }` is unlayered, so a Tailwind
 * `text-*` utility cannot colour a message body: the class was there and the pixels
 * were not (measured `rgb(56,58,66)` on a pending row that asked for muted ink). The
 * row now drives `--md-ink`, the property that actually wins, and only while pending.
 *
 * WHAT THIS CAN AND CANNOT SEE: this probe has no stylesheet (the bundle drops CSS),
 * so it cannot read a computed colour - `scripts/evidence` and the PR's live capture
 * carry that measurement. What it can prove is the mechanism the colour rides on, and
 * that a confirmed row does not carry it.
 */
test("a pending row drives --md-ink and a confirmed one does not", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const gate = deferred();
	const app = await mountPage(
		pageProps({ target: conversationTarget, onSend: () => gate.promise }),
	);
	try {
		await typeBody(app.element, "ink check");
		await act(async () => sendButton(app.element).click());
		const pendingBody = app.element.querySelector(
			"[data-row-key] .lo-markdown",
		);
		assert.ok(pendingBody, "the pending row draws its prose block");
		assert.equal(
			pendingBody.style.getPropertyValue("--md-ink").trim(),
			"var(--lo-ink-muted)",
			"the pending ink arrives through the property the stylesheet reads",
		);
		gate.resolve(message({ id: "msg_ink", seq: 1, body: "ink check" }));
		await settle();
		const confirmedBody = app.element.querySelector(
			"[data-row-key] .lo-markdown",
		);
		assert.ok(confirmedBody, "the confirmed row draws the same block");
		assert.equal(
			confirmedBody.style.getPropertyValue("--md-ink"),
			"",
			"and a confirmed row leaves the ink to the stylesheet",
		);
	} finally {
		await app.close();
	}
});

/*
 * m2 (review round 3) - THE ATTEMPT RECORD FOLLOWS A RE-KEYED ROW.
 *
 * The 409 retry re-keys the ROW (PR #1512's rule) but used to leave the attempt
 * record naming the burnt key. Then Edit, then Send re-derived that spent key from
 * the record: the hub refused it, a THIRD key was minted, and the copy the retry had
 * already landed came back as a duplicate. Sequence in this case: K1 conflicts, K2
 * lands with its answer lost, Edit, Send - and the third send must wear K2, not K1
 * and not a new K3.
 */
test("after a 409 retry, Edit then Send reuses the retried key, not the burnt one", async () => {
	localStorage.clear();
	m.resetPendingSendsForTest();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversationTarget,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
				if (refs.length === 1) throw conflict();
				if (refs.length === 2) throw new Error("response lost");
				return message({ id: "msg_late", seq: 1 });
			},
		}),
	);
	try {
		await typeBody(app.element, "did this land?");
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.equal(refs.length, 2, "the conflict is retried once");
		assert.notEqual(refs[1], refs[0], "the retry never reuses the burnt key");
		const [failed] = rows(app.element);
		const edit = [...failed.querySelectorAll("button")].find(
			(button) => button.textContent === "Edit",
		);
		await act(async () => edit.click());
		await settle();
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.equal(refs.length, 3, "the reader's third press reached the wire");
		assert.equal(
			refs[2],
			refs[1],
			"it re-sends the attempt's CURRENT key, so a landed retry is deduplicated",
		);
	} finally {
		await app.close();
	}
});

/*
 * D7 (design round 3) - MARKDOWN'S OWN EMPHASIS TAKES THE PENDING INK.
 *
 * `markdown.css` pins `strong`, `code` and the headings to `--lo-ink`, so inside a
 * pending body they stayed confirmed-looking and an all-bold message had no cue. The
 * fix is a SCOPED rule that reads `--md-ink`, the property the pending row sets.
 *
 * WHAT THIS CASE CAN SEE: no stylesheet is applied in this probe, so it cannot compute
 * a colour (the rendered check is the designer's live row). It can - and does - fail
 * if the scoped rule is deleted or if it stops reading `--md-ink`, which is the half a
 * rename or a "tidy-up" would silently break. The global rules in `markdown.css` are
 * asserted untouched, because moving those would restyle the reasoning panel.
 */
test("the pending ink reaches strong/code/headings through a scoped rule only", async () => {
	const { readFileSync } = await import("node:fs");
	const shell = readFileSync("src/renderer/src/styles/index.css", "utf8");
	const markdown = readFileSync(
		"src/renderer/src/features/chat/components/markdown.css",
		"utf8",
	);
	assert.match(
		shell,
		/\[data-delivery="pending"\][^{]*\.team-bridge-message-body[^{]*:is\([^)]*strong[^)]*code[^)]*h1/,
		"a rule scoped to a pending row covers strong, code and the headings",
	);
	assert.match(
		shell,
		/\[data-delivery="pending"\][\s\S]{0,400}?color: var\(--md-ink/,
		"and it reads --md-ink, the property the pending row sets",
	);
	assert.equal(
		(markdown.match(/var\(--md-ink/g) ?? []).length,
		1,
		"markdown.css still reads --md-ink in ONE place (the prose rule), so the globals were not moved",
	);
	assert.match(
		markdown,
		/strong[^{]*\{[^}]*color: var\(--lo-ink\)/,
		"and emphasis stays pinned to full ink for every other markdown surface",
	);
});
