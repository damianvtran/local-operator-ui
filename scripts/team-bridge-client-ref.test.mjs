import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { after, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * Team Bridge's SEND IDEMPOTENCY KEY, driven through the shipped page.
 *
 * WHY THIS EXISTS. Production refused a real user's SECOND message into a
 * conversation: `POST /v1/messaging/conversations/bcv_…/messages` answered 409
 * "[conflict] This client_ref was already used for a different conversation
 * message." The page read the key off the persisted DRAFT
 * (`team-bridge-page.tsx`: `draftState.current?.clientRef ?? crypto.randomUUID`),
 * the first send wrote its key there and burnt it, and the success path retired
 * only the attempt record - so the second message carried the first message's key.
 *
 * The rule these cases pin, in the order a person meets it:
 *   - a NEW message mints a new key, so a conversation can take more than one;
 *   - a RETRY of a FAILED attempt reuses that attempt's key, so an ambiguous
 *     failure (request landed, answer lost) cannot post the message twice;
 *   - a 409 is a burnt key, not the author's mistake: mint once and retry ONCE,
 *     then surface the failure with the text still on the box.
 *
 * These are DOM/state and wire-shape probes over the real component tree, not
 * native or layout evidence: the desktop bridge is inert, react-query talks to
 * nothing, and no hub exists here.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;

/*
 * THE DESKTOP BRIDGE, INERT. The page mounts the shared composer, whose mount
 * registers the global dictation chord (`use-speech-to-text-manager.ts` reads
 * `window.electron.ipcRenderer`), so a DOM probe needs the preload surface to
 * exist. A call that answers nothing is the honest stand-in for a bridge this rig
 * does not have - `agents-composer-mount.test.mjs` states the same stub.
 */
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
// JSDOM has no layout observers; the shared composer's @mention overlay needs the
// browser API to mount, but these tests assert state rather than layout.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(0), 0);
globalThis.cancelAnimationFrame = clearTimeout;
// A hidden document stops react-query background retries from keeping a failed
// probe alive; every request here is driven explicitly.
Object.defineProperty(dom.window.document, "visibilityState", {
	value: "hidden",
});
Object.defineProperty(dom.window.document, "hidden", { value: true });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
// The page imports the sidebar's selected-row role; stub it like the sibling
// team-bridge suites so a page probe does not pull the whole chat sidebar in.
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
 export {useConversationInputStore} from "./src/renderer/src/shared/store/conversation-input-store";
 export {draftStorageKey, eraseAccountDrafts} from "./src/renderer/src/shared/store/team-bridge-draft-account";
 export {draftTargetKey} from "./src/renderer/src/features/team-bridge/team-bridge-drafts";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["@tanstack/react-query", "react", "react-dom"],
	plugins: [sidebarStub],
	// Vite's `import.meta.env` is read at IMPORT time by the app's config loader,
	// which the shared composer's chain pulls in (`load-config.ts`): bundling for
	// node leaves it undefined and the module throws before a single assertion runs
	// (`browser-chrome.test.mjs` records the same trap). The URL is dead on purpose.
	define: { "import.meta.env": "__viteEnv" },
	// CJS output: `require` is already there, so only Vite's env needs defining.
	banner: { js: "const __viteEnv = {};" },
	// The page mounts the SHARED composer, which pulls the brand mark (.png).
	// Bundling it keeps this probe on the real component tree; a `dataurl` rather
	// than a file keeps the harness asset-free.
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
const compiledPath = `${process.cwd()}/scripts/team-bridge-client-ref-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
// The catalogue is process-global. Other Team Bridge suites pin English too, so a
// developer's locale cannot change the control names these probes click.
m.setLocale("en");
after(() => dom.window.close());
/*
 * A CLEAN COMPOSER BETWEEN CASES. The box's text lives in
 * `conversation-input-store`, which is module-global and keyed by the bridge
 * composer key - every case here mounts the same account/scope/target, so text
 * left by one case would be on the box in the next (`localStorage.clear()` empties
 * the persisted copy, never the live store).
 */
beforeEach(() => {
	m.useConversationInputStore.setState({ inputByConversation: {} });
	/*
	 * The failed-send record is module-scoped on purpose (it must outlive a route
	 * change), so a case that ends on a failure would hand its attempt to the next
	 * case's identical composer key. Erasing through the account fence - the same path
	 * sign-out takes - starts every case with no attempt in flight.
	 */
	m.eraseAccountDrafts(null, "acct_a");
});

const human = (account_id, display_label) => ({
	account_id,
	kind: "human",
	display_label,
	state: "active",
	role: "member",
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
	latest_seq: 1,
	last_read_seq: 1,
	unread_count: 0,
	muted: false,
};
const pageProps = (overrides) => ({
	selfAccountId: "acct_a",
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
	// The Scheduled quick view reads through react-query. The provider comes from
	// the SAME bundle as the page, so the context instance matches.
	const client = new m.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () =>
		root.render(
			React.createElement(
				m.QueryClientProvider,
				{ client },
				React.createElement(m.TeamBridgePageView, props),
			),
		),
	);
	return {
		element,
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
const composerText = (element) => element.querySelector("textarea")?.value;
/* The desktop transport's own refusal for a burnt key: a 409 with the hub's
   sentence as `detail` (the runtime forwards it unchanged). */
const conflict = () =>
	Object.assign(
		new Error(
			"[conflict] This client_ref was already used for a different conversation message.",
		),
		{ status: 409 },
	);

const conversation = { type: "conversation", id: "bcv_dm" };

test("a second message into the same conversation wears a fresh client_ref", async () => {
	localStorage.clear();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversation,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
			},
		}),
	);
	await typeBody(app.element, "first");
	await act(async () => sendButton(app.element).click());
	await settle();
	await typeBody(app.element, "second");
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(refs.length, 2, "both messages reached the container");
	assert.notEqual(
		refs[0],
		refs[1],
		"the second message must not carry the first message's client_ref",
	);
	await app.close();
});

test("a retry of a failed attempt reuses that attempt's client_ref", async () => {
	localStorage.clear();
	const refs = [];
	let attempts = 0;
	const app = await mountPage(
		pageProps({
			target: conversation,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
				attempts += 1;
				if (attempts === 1) throw new Error("response lost");
			},
		}),
	);
	await typeBody(app.element, "retry me");
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.equal(composerText(app.element), "retry me", "the text is restored");
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(refs.length, 2);
	assert.equal(
		refs[1],
		refs[0],
		"a retry of the SAME attempt keeps its key: the first request may have landed",
	);
	await app.close();
});

test("a 409 conflict mints a fresh key and retries exactly once", async () => {
	localStorage.clear();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversation,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
				if (refs.length === 1) throw conflict();
			},
		}),
	);
	await typeBody(app.element, "first");
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(refs.length, 2, "the conflict is retried, once");
	assert.notEqual(refs[1], refs[0], "the retry never reuses the burnt key");
	assert.equal(
		composerText(app.element),
		"",
		"the send lands and the box clears",
	);
	await app.close();
});

test("a second 409 does not loop: it surfaces and keeps the text", async () => {
	localStorage.clear();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversation,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
				throw conflict();
			},
		}),
	);
	await typeBody(app.element, "stuck");
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(
		refs.length,
		2,
		"one original attempt and ONE retry - never a third",
	);
	assert.equal(
		composerText(app.element),
		"stuck",
		"the text stays recoverable",
	);
	// The NEXT press is a manual retry of the same failed attempt, so it wears the
	// key the auto-retry minted rather than inventing a third one.
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(refs.length, 3);
	assert.equal(refs[2], refs[1]);
	await app.close();
});

/*
 * F2 - THE SAME TEXT TWICE IS TWO MESSAGES. "ok", "yes" and "thanks" are typed
 * into one conversation in normal use, so the body comparison that makes a retry
 * a retry must not be the only thing standing between the reader and a burnt key:
 * a deliberate second "ok" has to mint a new key, because it is a new message.
 * Deleting the attempt-record reset on success keeps the other four cases green
 * and only this one red - which is why it is here.
 */
test("identical text sent twice deliberately wears two different keys", async () => {
	localStorage.clear();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversation,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
			},
		}),
	);
	await typeBody(app.element, "ok");
	await act(async () => sendButton(app.element).click());
	await settle();
	await typeBody(app.element, "ok");
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(refs.length, 2, "both presses reach the wire");
	assert.notEqual(
		refs[0],
		refs[1],
		"the second 'ok' is a new message and must not reuse the first key",
	);
	await app.close();
});

/*
 * F3 - THE MATCHER STAYS NARROW. `isClientRefConflict` accepts the hub's declared
 * code and, as a fallback for runtime proxies that do not forward it, the
 * `client_ref` sentence. The fallback must not become "any 409": a
 * conversation-level conflict (the author was removed, a create raced) is not
 * recoverable by minting a key, and retrying it would double a request that can
 * only fail - and would hide the real error behind a generic one.
 */
test("a conversation-level 409 is not retried as a client_ref conflict", async () => {
	localStorage.clear();
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversation,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
				throw Object.assign(
					new Error("[conflict] the conversation was removed"),
					{ status: 409, code: "conversation_conflict" },
				);
			},
		}),
	);
	await typeBody(app.element, "hello");
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(
		refs.length,
		1,
		"one attempt only: a key cannot fix a conversation-level conflict",
	);
	await app.close();
});

/*
 * P1 - A SPENT KEY ON DISK IS NEVER SENT (round 4 retrospective, R4-01).
 *
 * The production failure behind the "swallowed" sends: a build before the fix
 * persisted each send's key in the draft and never rotated it, so after an update the
 * draft on disk holds a key the hub has ALREADY stored a message under. The hub
 * answers a spent key with matching text by REPLAYING that message - 200, the box
 * clears, no new row - so reading the persisted key turns a real send into a silent
 * no-op. Nothing else in these suites seeds a persisted key, which is why restoring
 * the pre-fix `submit` left every other case green.
 */
test("a draft persisted with a spent client_ref sends under a fresh key", async () => {
	localStorage.clear();
	localStorage.setItem(
		m.draftStorageKey("acct_a", "org_page"),
		JSON.stringify({
			[m.draftTargetKey(conversation)]: {
				target: conversation,
				body: "",
				clientRef: "spent-key",
			},
		}),
	);
	const refs = [];
	const app = await mountPage(
		pageProps({
			target: conversation,
			onSend: async (_body, clientRef) => {
				refs.push(clientRef);
			},
		}),
	);
	await typeBody(app.element, "hello again");
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(refs.length, 1, "the send reached the container");
	assert.notEqual(
		refs[0],
		"spent-key",
		"a persisted draft key may be spent; the hub would replay it and post nothing",
	);
	await app.close();
});

/*
 * R4-02 - LEAVING TEAM BRIDGE IS NOT A NEW MESSAGE. A route change unmounts the
 * whole page, so an attempt record held in component state died with it and the
 * reader's retry after coming back minted a new key: if the first request had landed
 * with its answer lost, the hub posted the message twice. A fresh mount with no
 * shared journal is exactly what `/team-bridge` gets after navigating away.
 */
test("a failed attempt keeps its client_ref across leaving and returning", async () => {
	localStorage.clear();
	const refs = [];
	const failFirst = async (_body, clientRef) => {
		refs.push(clientRef);
		if (refs.length === 1) throw new Error("response lost");
	};
	const first = await mountPage(
		pageProps({ target: conversation, onSend: failFirst }),
	);
	await typeBody(first.element, "did this land?");
	await act(async () => sendButton(first.element).click());
	await settle();
	await first.close();
	const back = await mountPage(
		pageProps({ target: conversation, onSend: failFirst }),
	);
	assert.equal(
		composerText(back.element),
		"did this land?",
		"the text survives the route change",
	);
	await act(async () => sendButton(back.element).click());
	await settle();
	assert.deepEqual(refs.length, 2);
	assert.equal(
		refs[1],
		refs[0],
		"the retry after returning is the same attempt and must keep its key",
	);
	await back.close();
});

/*
 * THE RECORD IS ACCOUNT-OWNED. It outlives the page on purpose, so it has to die with
 * the drafts: a sign-out or account switch erases them through the revocation fence,
 * and an attempt key left behind would be read by whoever signs in next.
 */
test("signing out forgets a failed attempt's client_ref", async () => {
	localStorage.clear();
	const refs = [];
	const failFirst = async (_body, clientRef) => {
		refs.push(clientRef);
		if (refs.length === 1) throw new Error("response lost");
	};
	const first = await mountPage(
		pageProps({ target: conversation, onSend: failFirst }),
	);
	await typeBody(first.element, "before sign-out");
	await act(async () => sendButton(first.element).click());
	await settle();
	await first.close();
	m.eraseAccountDrafts(localStorage, "acct_a");
	const back = await mountPage(
		pageProps({ target: conversation, onSend: failFirst }),
	);
	await typeBody(back.element, "before sign-out");
	await act(async () => sendButton(back.element).click());
	await settle();
	assert.deepEqual(refs.length, 2);
	assert.notEqual(
		refs[1],
		refs[0],
		"the erased account's attempt record must not survive the fence",
	);
	await back.close();
});
