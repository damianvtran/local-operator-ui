import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE ASK-MODE DRAFT SWAP, driven through the shipped components and the shipped
 * store.
 *
 * Why this file exists: the converged BLOCKER of round 1 was invisible to every
 * rig in the repo. `ask-queue.test.mjs` can assert the read model but not a
 * render; the composer suite predates these modules; and the store's own text
 * tests replace the composer with a stand-in. So the defect that mattered most -
 * a chat draft being submitted as the agent's ANSWER, and an answer being posted
 * as a chat message - had no possible signal in CI.
 *
 * WHAT THIS PINS
 *
 *  1. The door: a mount into a queue that is published but EMPTY must NOT fire the
 *     drawer's close door (a settle from the terminal or the phone, or a timeout)
 *     - reachable on every conversation switch, and firing there destroyed a
 *     draft, because the caller's swap moved the chat text into the ask buffer and
 *     wrote the empty ask buffer into the box. The old shape of this test also
 *     pinned a door that said "collapsed" to an already-collapsed page; there is
 *     no collapsed mount any more (the drawer is mounted only while open, and the
 *     flag that decides it is the store's), so that half is gone with the state it
 *     described rather than weakened.
 *  2. The authority: the swap has to reach the BOX, and the store's revision is
 *     what the composer mirrors on. `setCurrentInput` (the keystroke writer) must
 *     not bump it; `setComposerText` (the app's writer) must.
 *
 * WHAT IT DOES NOT CLAIM: that a real keystroke produces the same state, or
 * anything about layout. The end-to-end wiring of the box is a frame-rig
 * measurement (the QA round drove it over CDP); this file is the regression
 * signal that would have caught the blocker without one.
 */

const bootstrap = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
// React refuses `act` outside a declared act environment, and says so on every render.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: `
			export { AskDrawer } from "./src/renderer/src/features/chat/components/asks/ask-drawer";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	// The renderer's own alias, so the bundle reads the real modules rather than a
	// stand-in - the same alias the sibling component rigs declare.
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
	logLevel: "silent",
});
const bundlePath = new URL(
	`./_ask-draft-swap-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { AskDrawer, useConversationInputStore } = await import(bundlePath.href);
await unlink(bundlePath).catch(() => {});

const h = React.createElement;
const TS = 1_760_000_000_000;

const openAsk = {
	ask_id: "a-7f3c",
	created_at: TS,
	expires_at: TS + 3_600_000,
	timeout_s: 3600,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "target",
			question: "Which environment?",
			options: [{ label: "staging" }],
		},
	],
};

/** A published queue carrying `asks`, which is what the surfaces gate on. */
const frontend = (asks) => ({
	asks,
	asks_open:
		asks === null ? null : asks.filter((row) => row.status === "open").length,
	asks_truncated: null,
});

const mount = async (element) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element);
	});
	return {
		container,
		async rerender(next) {
			await act(async () => {
				root.render(next);
			});
		},
		async unmount() {
			await act(async () => {
				root.unmount();
			});
			container.remove();
		},
	};
};

/* --------------------------------------------------------------- the door ---- */

test("a MOUNT into an empty-but-published queue does not fire the close door", async () => {
	// Reachable on every pane mount: `SessionPanel` is keyed by conversation, so
	// this is every conversation switch, and the caller's swap would empty the box
	// of a draft retained for the conversation being opened.
	const calls = [];
	const view = await mount(
		h(AskDrawer, {
			frontend: frontend([]),
			scope: "session",
			onClose: () => calls.push(true),
		}),
	);
	assert.deepEqual(calls, [], "a mount is not an emptying");
	await view.unmount();
});

test("the close door fires ONCE per emptying", async () => {
	const calls = [];
	const props = { scope: "session", onClose: () => calls.push(true) };
	const view = await mount(
		h(AskDrawer, { frontend: frontend([openAsk]), ...props }),
	);
	assert.deepEqual(calls, [], "mount with rows is not an emptying");
	await view.rerender(h(AskDrawer, { frontend: frontend([]), ...props }));
	assert.deepEqual(calls, [true], "one close, delivered once");
	// And not again on the renders that follow it.
	await view.rerender(h(AskDrawer, { frontend: frontend([]), ...props }));
	await view.rerender(h(AskDrawer, { frontend: frontend([]), ...props }));
	assert.deepEqual(calls, [true], "the transition fires once, not per render");
	await view.unmount();
});

/* ---------------------------------------------------------- the authority ---- */

test("only the app's writer bumps the revision the composer mirrors on", () => {
	const store = () => useConversationInputStore.getState();
	const id = "sess-swap";
	// The keystroke path: the composer calls this on every change, so it must stay
	// silent or the composer would mirror its own typing back at itself.
	store().setCurrentInput(id, "chat draft");
	const afterKeystroke = store().inputByConversation[id].textRevision ?? 0;
	store().setCurrentInput(id, "chat draft two");
	assert.equal(
		store().inputByConversation[id].textRevision ?? 0,
		afterKeystroke,
		"the keystroke writer is not the box's author",
	);
	// The app's writer: this is what makes the swap reach the box at all.
	store().setComposerText(id, "answer draft");
	assert.ok(
		(store().inputByConversation[id].textRevision ?? 0) > afterKeystroke,
		"the app's writer must bump the revision, or the box never adopts the swap",
	);
	assert.equal(store().inputByConversation[id].currentInput, "answer draft");
	// An EMPTY value is an instruction here, not "no change": switching into an
	// empty ask buffer means the box must be empty.
	store().setComposerText(id, "");
	assert.equal(store().inputByConversation[id].currentInput, "");
	assert.equal(store().inputByConversation[id].unredactedChars, 0);
});
