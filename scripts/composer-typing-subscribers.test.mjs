#!/usr/bin/env node
/*
 * WHO RE-RENDERS WHEN THE COMPOSER TYPES - the regression pin for the new-chat
 * typing lag (operator, 2026-11-23: "the helix animation becomes super laggy
 * when typing, and typing also seems to have slowed down in the new chat
 * composer").
 *
 * The composer writes `conversation-input-store` on every keystroke
 * (`use-message-input.ts` `handleChange`: `setCurrentInput` then
 * `resetCurrentHistoryIndex`). Every subscriber whose selector answers a new
 * value per write re-renders per keystroke. Measured on the new-chat splash
 * (Storybook rig, real `ChatSidebar` with 120 rows beside the real composer,
 * 4x CPU throttle): the sidebar's whole-map selector cost 12-15 ms of commit per
 * keystroke - ~70% of each keystroke's React work - and with it the helix
 * dropped 55 frames past 28 ms in a 2.4 s typing burst (26 after the fix).
 *
 * WHAT THIS DRIVES: the REAL store module and the REAL `draft-rows` helpers the
 * sidebar's selectors are built from, through the exact two writes a keystroke
 * makes, counting the commits each selector asks React for. The whole-map
 * selector is kept as the falsifier: it must still commit per keystroke here, or
 * the harness is not measuring anything. Source pins then prove the SHIPPED call
 * sites use the bounded shapes (a selector's shape is not observable from the
 * store), in the style of `composer-typing-perf.test.mjs`'s B5.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const [key, value] of Object.entries({
	localStorage: dom.window.localStorage,
	window: dom.window,
	document: dom.window.document,
	IS_REACT_ACT_ENVIRONMENT: true,
})) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}

const bundle = await build({
	stdin: {
		contents: [
			'export * as store from "./src/renderer/src/shared/store/conversation-input-store";',
			'export * as draftRows from "./src/renderer/src/features/chat/draft-rows";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
const bundlePath = new URL(
	`./_composer-typing-subscribers-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { store, draftRows } = await import(bundlePath.href);
await unlink(bundlePath);
const { useConversationInputStore } = store;
const { typedDraftKeys, typedDraftTitle, liveDraftRow, untargetedDraftRows } =
	draftRows;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

const KEY = "draft-under-test";
/** One keystroke, as `use-message-input.ts`'s `handleChange` writes it. */
const keystroke = (value) => {
	const s = useConversationInputStore.getState();
	s.setCurrentInput(KEY, value, 0);
	s.resetCurrentHistoryIndex(KEY);
};

/** Mount one component per selector, type `values`, return commits per selector. */
const commitsWhileTyping = async (selectors, values) => {
	const counts = Object.fromEntries(Object.keys(selectors).map((k) => [k, 0]));
	const Probe = ({ name }) => {
		counts[name] += 1;
		useConversationInputStore(selectors[name]);
		return null;
	};
	const container = document.createElement("div");
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(
				"div",
				null,
				Object.keys(selectors).map((name) => h(Probe, { key: name, name })),
			),
		);
	});
	for (const name of Object.keys(counts)) counts[name] = 0;
	for (const value of values) {
		await act(async () => keystroke(value));
	}
	await act(async () => root.unmount());
	return counts;
};

const burst = (text) =>
	Array.from({ length: text.length }, (_, i) => text.slice(0, i + 1));

test("a typing burst re-renders the sidebar's row list once (blank -> typed), not per keystroke", async () => {
	keystroke("");
	const values = burst("the quick brown fox jumps over"); // 30 keystrokes
	const counts = await commitsWhileTyping(
		{
			// The pre-fix sidebar selector: the falsifier, it must commit per write.
			wholeMap: (s) => s.inputByConversation,
			// The shipped one (`chat-sidebar.tsx`).
			rowList: (s) => typedDraftKeys(s.inputByConversation),
		},
		values,
	);
	assert.equal(counts.wholeMap, values.length, "harness falsifier");
	assert.equal(counts.rowList, 1, "only the blank -> non-blank flip");
});

test("the per-row title subscriber is quiet past the title cap and on later lines", async () => {
	const firstLine = "x".repeat(60); // past the 48-character cap
	keystroke(firstLine);
	const values = [
		...burst("y".repeat(10)).map((tail) => firstLine + tail),
		...burst("\nsecond line").map((tail) => `${firstLine}yyyyyyyyyy${tail}`),
	];
	const counts = await commitsWhileTyping(
		{
			title: (s) => typedDraftTitle(s.inputByConversation[KEY]?.currentInput),
		},
		values,
	);
	assert.equal(counts.title, 0);
});

test("the live row says what untargetedDraftRows would say for the same text", () => {
	const drafts = { [KEY]: { key: KEY, submittedText: "claimed text" } };
	const rowsFor = (typed) =>
		untargetedDraftRows(drafts, { [KEY]: { currentInput: typed } });
	const listed = rowsFor("old words")[0];
	for (const typed of ["new words", "two\nlines", `  ${"z".repeat(80)}`]) {
		const live = liveDraftRow(listed, typedDraftTitle(typed));
		const fresh = rowsFor(typed)[0];
		assert.equal(live.title, fresh.title);
		assert.equal(live.label, fresh.label);
	}
	// Blank typed text keeps the row the list derived (the claim's fallback).
	const fallback = rowsFor("   ")[0];
	assert.equal(liveDraftRow(fallback, typedDraftTitle("   ")), fallback);
	// An unchanged title hands back the same object, so nothing downstream churns.
	assert.equal(liveDraftRow(listed, typedDraftTitle("old words")), listed);
});

/** Comments stripped, so a pin can never be satisfied by prose about it. */
const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the shipped call sites use the bounded shapes", () => {
	const sidebar = code(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	);
	assert.doesNotMatch(
		sidebar,
		/useConversationInputStore\(\s*\(\w+\)\s*=>\s*\w+\.inputByConversation,?\s*\)/,
		"the sidebar must not select the whole draft map",
	);
	assert.match(sidebar, /typedDraftKeys\(\s*s\.inputByConversation\s*\)/);
	assert.match(
		sidebar,
		/draftRows\.map\(\(listed\) => \(\s*<LiveDraftRow key=\{listed\.key\} row=\{listed\}>/,
		"each draft row follows its own text through LiveDraftRow",
	);

	const selection = code(
		"src/renderer/src/shared/components/common/text-selection-controls.tsx",
	);
	assert.doesNotMatch(
		selection,
		/useConversationInputStore\(\s*\)/,
		"a selector-less subscription re-renders every toolbar per keystroke",
	);

	const horizon = code(
		"src/renderer/src/shared/components/composer/new-chat-horizon.tsx",
	);
	assert.match(
		horizon,
		/export const NewChatHorizon = memo\(/,
		"the splash re-renders per keystroke; the helix host must not",
	);
});
