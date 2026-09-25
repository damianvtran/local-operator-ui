import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE BOX'S TEXT, DRIVEN THROUGH THE REAL HOOK.
 *
 * `composer-send-failure.test.mjs` pins what the STORE does with a failed message;
 * this file pins the half that was invisible to it, because the composer keeps the
 * text being typed into in its own React state and every store-level test replaces
 * that with a stand-in. Three of review round 1's blockers live in exactly that
 * gap:
 *
 *  - B2/Q-1/U3: `Clear` emptied the row and left the WORDS on screen (they then
 *    glued onto the next message and went out as one bubble), and the late-delivery
 *    reconciliation did the same, because a store-side write reached the textarea
 *    only through `pendingText`;
 *  - U6: the "still sending" line could never appear on a second press, because the
 *    hook's own re-entry guard returned in silence and the press never reached the
 *    sentence.
 *
 * A real jsdom document, a real `react-dom/client` root and the SHIPPED hook, with
 * the shipped store under it. The box is a real `<textarea>` bound the way the
 * composer binds it, so the assertion reads the DOM rather than the hook's own
 * variable - the difference between "the state is right" and "the box says so".
 *
 * WHAT THIS IS NOT: proof of layout, of a browser's key handling or of a real send.
 * Geometry is the evidence rig's business, and the request/response half is the
 * store suite's.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
/*
 * The stores read `localStorage` at module scope, so the DOM has to exist before
 * the bundle is imported - and the last value read (the persisted row after a
 * `Clear`) is part of what these cases assert.
 */
const originals = new Map();
const liveTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const tracked =
	(real) =>
	(...args) => {
		const id = real(...args);
		liveTimers.push(id);
		return id;
	};
globalThis.setTimeout = tracked(realSetTimeout);
globalThis.setInterval = tracked(realSetInterval);

/*
 * A FRESH STORE PER FILE, and not jsdom's. The runner may put more than one file in
a worker process, and the store bundles other suites install read `localStorage`
at module scope - so a suite that shares the document's own storage changes
behaviour depending on which file ran first (measured: one case in this file
passed against the previous head when it shared a worker with the store suite and
failed when it did not, which is a regression test that would not have caught its
own defect). One file, one storage, one outcome.
 */
const storage = new Map();
const localStorageStub = {
	getItem: (key) => storage.get(key) ?? null,
	setItem: (key, value) => storage.set(key, String(value)),
	removeItem: (key) => storage.delete(key),
};
for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: localStorageStub,
	sessionStorage: localStorageStub,
	HTMLElement: window.HTMLElement,
	HTMLTextAreaElement: window.HTMLTextAreaElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	KeyboardEvent: window.KeyboardEvent,
	InputEvent: window.InputEvent,
	MouseEvent: window.MouseEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.setTimeout = tracked(realSetTimeout);
window.setInterval = tracked(realSetInterval);

const bundle = await build({
	stdin: {
		contents: `
			export { useMessageInput } from "./src/renderer/src/shared/hooks/use-message-input";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export * from "./src/renderer/src/shared/store/canonical-sessions-store";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	/*
	 * React stays OUT of the bundle, and the bundle is written to a file beside this
	 * one before it is imported: a hook and a renderer must share ONE React instance
	 * (two copies is the "reading 'useSyncExternalStore' of null" crash), and a bare
	 * `react` import only resolves from a file inside the project.
	 */
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			// The echo registry is React and a live EventSource; the composer's contract
			// with it is one call, and none of these cases is about it.
			name: "text-authority-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = () => {};
export const retractPendingUser = () => {};
export const retractLocalEcho = () => "queued";
export const discardPendingEchoes = () => {};
export const clearRetractedEchoes = () => {};
export const deliverEcho = () => {};`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const bundlePath = new URL(
	`./_composer-text-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const module = await import(bundlePath.href);
await unlink(bundlePath);
const { useMessageInput, useConversationInputStore, composerIdentityFor } =
	module;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { document } = window;

/*
 * The composer's own box, bound the way `message-input.tsx` binds it: the hook's
 * value in, its `setInputValue` out, and `textareaRef` attached - so the assertion
 * below reads the same DOM node the app's user types into.
 */
const Probe = ({ options, holder }) => {
	const handle = useMessageInput(options);
	holder.handle = handle;
	return createElement("textarea", {
		ref: handle.textareaRef,
		value: handle.inputValue,
		onChange: (event) => handle.setInputValue(event.target.value),
	});
};

/*
 * ONE MOUNT AT A TIME, each in its own container, and the previous one is
 * unmounted first. Two live roots in one document is a fixture that lies: every
 * previous probe stays subscribed to the store, so a write made by the case under
 * test reaches a box from an earlier case - and a document-wide query for `textarea`
 * then reads that one (measured while writing this file).
 */
async function mount(options) {
	if (mounted) await act(async () => mounted.root.unmount());
	const holder = {};
	const container = document.createElement("div");
	document.getElementById("root").appendChild(container);
	const root = createRoot(container);
	root.render(createElement(Probe, { options, holder }));
	mounted = { holder, root, container };
	await act(async () => {});
	return mounted;
}

const boxText = () => mounted.container.querySelector("textarea").value;
const identity = "22222222-2222-2222-2222-222222222222";

/**
 * A clean store for each case: the rows AND the bytes they were persisted as.
 *
 * The storage is RE-PINNED here rather than only at setup, because another suite in
 * the same worker process assigns `globalThis.localStorage` at its own module scope
 * - and a case whose outcome depends on which file ran first is not a regression
 * test (measured: the `Clear` case passed against the previous head when it shared
 * a worker with the store suite, and failed when it did not).
 */
function resetStore() {
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		writable: true,
		value: localStorageStub,
	});
	storage.clear();
	useConversationInputStore.setState({ inputByConversation: {} });
}

/** A send the test releases when it wants the outcome to arrive. */
function deferredSend() {
	const sent = [];
	let release;
	const settled = new Promise((resolve) => {
		release = resolve;
	});
	const onSubmit = (message) => {
		sent.push(message);
		return settled.then(() => false);
	};
	return { sent, release, onSubmit };
}

let mounted;
after(async () => {
	await act(async () => {
		mounted?.root?.unmount();
	});
	for (const id of liveTimers.splice(0)) {
		clearTimeout(id);
		clearInterval(id);
	}
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	dom.window.close();
});

/* ------------------------------------------------------------------ the box */

test("Clear empties the BOX, and a store write reaches a box already mounted", async () => {
	resetStore();
	const { holder } = await mount({
		conversationId: identity,
		onSubmit: async () => {},
	});
	await act(async () => {
		holder.handle.setInputValue("the message I typed");
	});
	assert.equal(
		useConversationInputStore.getState().inputByConversation[identity]
			?.currentInput,
		"the message I typed",
		"the keystroke reached the store (the fixture is hydrated)",
	);
	assert.equal(boxText(), "the message I typed");

	/*
	 * The press the notice offers, as the pane performs it: the store clears the
	 * row. Before this change the ROW emptied and the box kept the words, so the
	 * next thing the user typed was appended to a message the app had already
	 * discarded - measured as one bubble carrying two messages (B2/Q-1/U3).
	 */
	await act(async () => {
		useConversationInputStore.getState().clearComposer(identity);
	});
	/*
	 * TWO FLUSHES, and the second is not decoration: the store write re-renders the
	 * hook, the hook's effect notices the store authored the box and sets the text it
	 * owns, and that second render is what moves the DOM. In the app the pair is one
	 * frame; in a test it has to be awaited, or the assertion reads the box before the
	 * effect that empties it has run.
	 */
	await act(async () => {});
	assert.equal(
		boxText(),
		"",
		"Clear emptied the row and left the words on screen",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[identity]
			?.currentInput,
		"",
	);
});

test("a message that reconciles as delivered empties the box in silence", async () => {
	resetStore();
	const { holder } = await mount({
		conversationId: identity,
		onSubmit: async () => {},
	});
	await act(async () => {
		holder.handle.setInputValue("sent but unconfirmed");
		const store = useConversationInputStore.getState();
		/*
		 * The two writes the send path performs around a failure: the payload leaves
		 * with the echo and comes back when the outcome is unknown.
		 */
		store.beginInFlight(identity, {
			text: "sent but unconfirmed",
			attachments: [],
			replies: [],
		});
		store.returnInFlight(identity, identity);
	});
	assert.equal(
		boxText(),
		"sent but unconfirmed",
		"the returned message is in the box",
	);

	// And then the owner's row arrives: the message was delivered after all.
	await act(async () => {
		useConversationInputStore.getState().reconcileDelivered(identity);
	});
	await act(async () => {});
	assert.equal(
		boxText(),
		"",
		"a delivered message's draft was left in the box, where the next press would send it again",
	);
});

test("a returned payload reaches a composer that mounts after the failure", async () => {
	resetStore();
	const store = useConversationInputStore.getState();
	/*
	 * The failure happens with no composer mounted at all - the identity flip, or a
	 * switch away - which is the case the store has to survive on its own.
	 */
	store.beginInFlight(identity, {
		text: "lost in the flip",
		attachments: [],
		replies: [],
	});
	store.returnInFlight(identity, identity);

	const { holder } = await mount({
		conversationId: identity,
		onSubmit: async () => {},
	});
	assert.equal(
		boxText(),
		"lost in the flip",
		"the returned text never reached a composer mounted after it",
	);
	// And adoption is once: the row no longer holds it, so a second mount is empty of it.
	assert.equal(
		useConversationInputStore.getState().inputByConversation[identity]
			?.pendingText,
		undefined,
	);
});

test("a masked credential capture keeps the box against a store write", async () => {
	resetStore();
	const { holder } = await mount({
		conversationId: identity,
		onSubmit: async () => {},
		draftHeld: true,
	});
	await act(async () => {
		holder.handle.setInputValue("LOP_SECRET_ABC");
		/*
		 * A returned payload arrives mid-capture. Adopting it would put a returned
		 * message inside a secret the user is composing, and the capture's own write at
		 * its end is what merges the two.
		 */
		useConversationInputStore.getState().returnPayload(identity, {
			text: "returned while capturing",
			attachments: [],
			replies: [],
		});
	});
	assert.equal(
		boxText(),
		"LOP_SECRET_ABC",
		"the adoption overwrote the box inside a masked capture",
	);
});

/*
 * THE BOX IS WHAT THE DUPLICATE WAS MADE OF (review round 2, R2/U1).
 *
 * The store side of this is pinned in `composer-send-failure`; this is the half
 * that could only be seen in the composer's own text: the delivered words have to
 * come OUT of the textarea, leaving the line the user typed after them. A
 * store-level case cannot fail this way - the box's text is React state the store
 * write reaches through the hook - which is exactly how the round-1 duplicate
 * stayed invisible.
 */
test("a late delivery takes the delivered words out of the box", async () => {
	resetStore();
	const { holder } = await mount({
		conversationId: identity,
		onSubmit: async () => {},
	});
	const store = useConversationInputStore.getState();
	await act(async () => {
		holder.handle.setInputValue("the message that went");
	});
	await act(async () => {
		store.beginInFlight(identity, {
			text: "the message that went",
			attachments: [{ id: "chip-1", path: "/tmp/shot.png" }],
			replies: [],
		});
		/*
		 * The user types their next line while the message is in flight, and then the
		 * failure hands the message back - the merge puts it in front of their words.
		 */
		holder.handle.setInputValue("and my own next line");
		store.returnInFlight(identity, identity);
	});
	await act(async () => {});
	assert.equal(
		boxText(),
		"the message that went\n\nand my own next line",
		"the returned message did not come home in front of the user's own line",
	);

	// And then the owner's row arrives: it had been delivered after all.
	await act(async () => {
		useConversationInputStore.getState().reconcileDelivered(identity);
	});
	await act(async () => {});
	assert.equal(
		boxText(),
		"and my own next line",
		"the box still holds the delivered message, so the next press sends it again",
	);
});

/*
 * U6, AND IT IS A RULE ABOUT A CONTROL, so it is pinned where the control's own
 * predicate is written (this suite mounts the composer; the pane's send lock is
 * pinned by the pane's own suites).
 *
 * The Send control used to be disabled for the whole flight, so the second press
 * the previous round fixed was never delivered to the pane: the send lock's line
 * ("Your last message is still sending.") was unreachable from the one control a
 * user reaches for. The refusal belongs to the store, which is where a second
 * admission is actually refused.
 */
test("the send control is pressable while a send is in flight", () => {
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);
	/*
	 * The control's OWN predicate, sliced out of the file rather than matched across
	 * it: `message-input.tsx` has other disabled rules (`isInputDisabled || isLoading`
	 * guards a slash action half a file away), and a file-wide match would pin one of
	 * those instead of the button this finding is about.
	 */
	/*
	 * THE CONTROL IS FOUND BY ITS LABEL'S TAIL, not by a literal
	 * `aria-label="Send message"`. Main's #482 made the label follow the DESTINATION
	 * ("Ask the aside" while a panel is attached), so the send button's label is a
	 * ternary now and the old anchor matched nothing at all - a source assertion that
	 * matches nothing is a failure, which is how the fold surfaced it.
	 */
	const at = [...composer.matchAll(/aria-label=\{/g)]
		.map((match) => match.index)
		.find((index) => composer.slice(index, index + 900).includes('"Send message"'));
	assert.ok(typeof at === "number" && at > 0, "the send control moved");
	const button = composer.slice(
		composer.lastIndexOf("<Button", at),
		composer.indexOf("</Button>", at),
	);
	assert.match(
		button,
		/disabled=\{/,
		"the send control has no predicate at all",
	);
	/*
	 * COMMENTS STRIPPED, which is the convention every other source assertion in this
	 * repository follows and here it is load-bearing: the fix's own comment says "and
	 * not `isLoading` any more", so matching the raw text would fail on the sentence
	 * explaining the change.
	 */
	const code = button.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	assert.ok(
		!code.includes("isLoading"),
		"the send control is disabled for the whole flight again, so the press the send lock exists to answer cannot reach it",
	);
	assert.ok(
		code.includes("isInputDisabled"),
		"a box that refuses input must still disable the press",
	);
});

/* -------------------------------------------------------------- the press */

test("a second press reaches the pane instead of vanishing", async () => {
	resetStore();
	const send = deferredSend();
	const { holder } = await mount({
		conversationId: identity,
		onSubmit: send.onSubmit,
	});
	await act(async () => {
		holder.handle.setInputValue("first");
	});

	/*
	 * The first press: it is out, and its outcome has not arrived.
	 */
	await act(async () => {
		void holder.handle.handleSubmit();
	});
	assert.equal(send.sent.length, 1);

	/*
	 * And the second, while the first is still going. It must REACH the pane: the
	 * pane's send lock is where the "still sending" sentence is raised, and the hook's
	 * own re-entry guard used to return in silence, so the user got nothing back at
	 * all - indistinguishable from a dead key (U6).
	 */
	await act(async () => {
		void holder.handle.handleSubmit();
	});
	assert.equal(
		send.sent.length,
		2,
		"the second press was swallowed by the hook, so the composer could never say why nothing was sent",
	);
	assert.equal(
		boxText(),
		"first",
		"a refused press must leave the text where the user can send it",
	);

	// The first send settles as a failure: the box keeps the text (the store's return
	// path owns that) and the composer is free again.
	await act(async () => {
		send.release();
	});
	await act(async () => {});
	assert.equal(boxText(), "first");
});
