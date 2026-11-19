#!/usr/bin/env node
/*
 * THE COALESCED DRAFT WRITE'S TWO CROSS-DOCUMENT CONTRACTS, plus the arms of the
 * two seams the perf fix touched that nothing else drives.
 *
 * WHY THIS FILE EXISTS. `conversation-input-store.ts` coalesces its persist write
 * onto a 300 ms trailing timer (the composer typing fix, `c118bdddb8d`). That
 * makes the QUEUE a second copy of the draft, and a second copy can only be safe
 * if the code that reads and writes it knows which copy is newer. Agent review
 * round 1 found the one place it did not:
 *
 *  1. R1-1 - the cross-window adoption. `getItem` flushed the queue before
 *     reading, so an adopting document overwrote the other document's newer write
 *     with its own stale rows and then hydrated its own copy; the foreign draft was
 *     destroyed on disk and the adopting window adopted nothing. This file
 *     reproduces that sequence against the REAL bundled store and the REAL bundled
 *     sync, and asserts that the newer copy survives BOTH the adoption and the
 *     coalescing window that follows it (the stale queue must not land later).
 *     It fails on `c118bdddb8d`.
 *  2. R1-5 - a denied `localStorage` used to drop the queued payload before
 *     attempting the write, so a permission the platform can change mid-session
 *     lost the draft and left a stale copy that every later read treats as truth.
 *  3. R1-N1 - `resetCurrentHistoryIndex`'s early return is the hot path now, and
 *     only its already-null arm was covered; the non-null arm (a real recall being
 *     abandoned by a keystroke) was not.
 *
 * WHAT IS REAL HERE. The store module and the sync module are the ones the app
 * ships, bundled from source with the same esbuild settings the perf bench uses;
 * `localStorage` and the `storage` event are jsdom's, and the "other document" is
 * a raw write of the key exactly as another document's persist write produces it -
 * the shape the platform hands an adopting document.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
for (const [key, value] of Object.entries({
	localStorage: window.localStorage,
	window,
	document: window.document,
})) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}

/*
 * The focus arm, driven directly: `document.hasFocus()` is the platform's
 * edit-in-progress test and this document's copy of it is what the sync's guard
 * reads. Set per test; an adoption test needs it false.
 */
let focused = true;
Object.defineProperty(window.document, "hasFocus", {
	configurable: true,
	value: () => focused,
});

const bundle = await build({
	stdin: {
		contents: [
			'import * as store from "./src/renderer/src/shared/store/conversation-input-store";',
			'import * as sync from "./src/renderer/src/shared/store/conversation-input-sync";',
			"export { store, sync };",
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
const bundlePath = new URL(
	`./_composer-draft-adoption-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { store, sync } = await import(bundlePath.href);
await unlink(bundlePath);

const { useConversationInputStore, COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS } = store;
const KEY = "conversation-input-store";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An empty store and an empty disk, with no queued write carried in from the
 * previous case (the queue is module-level state and outlives a test).
 */
const resetStore = () => {
	useConversationInputStore.setState({ inputByConversation: {} });
	/*
	 * Optional on purpose: the discard seam is part of the fix, and this file is run
	 * against the base commit too - there the missing seam must read as "the queue
	 * could not be cleared", not as a TypeError that hides the assertion.
	 */
	store.discardQueuedComposerDraftWrite?.();
	window.localStorage.clear();
};

/** One document's persist write, in the envelope `persist` hands to storage. */
const persistedValue = (currentInput) => ({
	state: {
		inputByConversation: {
			"conv-shared": {
				currentInput,
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
			},
		},
	},
	version: 0,
});

test("an adopting document keeps the other document's newer draft, in memory and on disk", async () => {
	resetStore();
	focused = false;
	/* Per document and idempotent: the listener must outlive every render. */
	sync.installConversationInputSync();

	/* This document is typing: its newest text is queued, not yet on disk. */
	useConversationInputStore
		.getState()
		.setCurrentInput("conv-shared", "MINE-typed");
	assert.equal(
		(window.localStorage.getItem(KEY) ?? "").includes("MINE-typed"),
		false,
		"the precondition of the defect: the local write is still in the coalescing window",
	);

	/* The other document writes the whole key - newer than anything here holds. */
	const foreignRaw = JSON.stringify(persistedValue("FOREIGN-newer"));
	window.localStorage.setItem(KEY, foreignRaw);
	window.dispatchEvent(
		new window.StorageEvent("storage", {
			key: KEY,
			newValue: foreignRaw,
			storageArea: window.localStorage,
			url: "http://localhost/",
		}),
	);
	await sleep(0);

	assert.equal(
		useConversationInputStore.getState().inputByConversation["conv-shared"]
			?.currentInput,
		"FOREIGN-newer",
		"the adopting document took the newer copy instead of its own queued one",
	);
	assert.equal(
		JSON.parse(window.localStorage.getItem(KEY)).state.inputByConversation[
			"conv-shared"
		].currentInput,
		"FOREIGN-newer",
		"the read that adopted it did not write over it",
	);

	/*
	 * AND IT STAYS: the adoption drops this document's queue rather than landing it
	 * later, because that payload describes the rows the adoption just replaced.
	 */
	await sleep(COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS + 150);
	assert.equal(
		JSON.parse(window.localStorage.getItem(KEY)).state.inputByConversation[
			"conv-shared"
		].currentInput,
		"FOREIGN-newer",
		"the stale queued write never lands over the other document's draft",
	);
});

test("a keystroke that abandons a recall clears the index the recall set", () => {
	resetStore();
	const id = "conv-history";
	useConversationInputStore.setState({
		inputByConversation: {
			[id]: {
				currentInput: "typed so far",
				submittedMessages: ["first", "second"],
				currentHistoryIndex: 1,
				replies: [],
				attachments: [],
			},
		},
	});
	assert.equal(
		useConversationInputStore.getState().getCurrentHistoryIndex(id),
		1,
		"the recall is engaged, which is the arm this pin exists for",
	);

	/*
	 * Both arms of the guard, counted rather than inferred: abandoning a walk is a
	 * write (subscribers must hear it), and abandoning nothing is not (the early
	 * return the fix added - the second store write of every keystroke).
	 */
	let notifications = 0;
	const unsubscribe = useConversationInputStore.subscribe(() => {
		notifications += 1;
	});
	useConversationInputStore.getState().resetCurrentHistoryIndex(id);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[id]
			.currentHistoryIndex,
		null,
		"the keystroke ends the walk",
	);
	assert.equal(notifications, 1, "ending a walk is a store write");

	notifications = 0;
	useConversationInputStore.getState().resetCurrentHistoryIndex(id);
	unsubscribe();
	assert.equal(
		notifications,
		0,
		"the already-at-rest arm is silent: it would write the value it already holds",
	);
});

test("a denied localStorage keeps the draft queued so the next flush lands it", () => {
	resetStore();
	const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		get() {
			throw new Error("storage denied");
		},
	});
	try {
		useConversationInputStore
			.getState()
			.setCurrentInput("conv-denied", "kept while denied");
		/* Refused, and it must not take the caller down with it. */
		store.flushComposerDraftPersist();
		assert.equal(
			window.localStorage.getItem(KEY),
			null,
			"nothing could reach the denied store",
		);
	} finally {
		Object.defineProperty(globalThis, "localStorage", saved);
	}

	/* The permission returns; the payload was never thrown away. */
	store.flushComposerDraftPersist();
	const persisted = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
	assert.equal(
		persisted.state?.inputByConversation?.["conv-denied"]?.currentInput,
		"kept while denied",
		"the refused write stayed queued instead of being dropped with the storage",
	);
});
