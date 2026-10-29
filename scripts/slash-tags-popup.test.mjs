import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The `/tag` surface as the popup actually renders it.
 *
 * The row rules are pure and live in `slash-tags.test.mjs`; this file asserts
 * the three things only a rendered frame can show: the header's live count, the
 * `[x]`/`[ ]` markers, and the error line's role. Geometry and contrast are not
 * claimed here (jsdom has no layout) — the design round owns those.
 */

const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{ url: "http://localhost/", pretendToBeVisual: true },
);
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* jsdom context-bound accessors */
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/* jsdom implements no layout, so the popup's active-row reveal is a no-op here;
   the real geometry belongs to the browser/design pass. */
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
if (!globalThis.CSS)
	globalThis.CSS = {
		escape: (value) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`),
	};

const require = createRequire(import.meta.url);

const bundle = await build({
	stdin: {
		contents:
			'export { SlashSuggestionsPopup } from "./src/renderer/src/features/chat/components/slash-commands";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	mainFields: ["module", "main"],
	loader: { ".css": "empty" },
	alias: {
		"@features": resolve("src/renderer/src/features"),
		"@shared": resolve("src/renderer/src/shared"),
	},
	plugins: [
		{
			name: "react-singleton",
			setup(builder) {
				builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({
					path: pathToFileURL(require.resolve(args.path)).href,
					external: true,
				}));
			},
		},
	],
});
const { SlashSuggestionsPopup } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const tagRow = (over = {}) => ({
	value: "Work",
	name: "Work",
	tagId: "t-work",
	applied: false,
	...over,
});

const state = (over = {}) => ({
	phase: "argument",
	open: true,
	active: 0,
	matches: [{ kind: "argument", row: tagRow() }],
	listId: "slash-tag-test",
	activeDescendantId: null,
	argumentCommand: "tag",
	inline: { source: "session-tags", nameThenMessage: false, runs: true },
	effectiveEntry: () => undefined,
	argumentQuery: "",
	commandQuery: "",
	argumentList: { rows: [], loading: false, error: null, needsSession: false },
	tagSelectedCount: 0,
	tagError: null,
	tagNotice: "",
	tagPending: false,
	actOnTagRow: async () => {},
	reopen: () => {},
	close: () => {},
	setActive: () => {},
	setActiveHover: () => {},
	chosenByHand: false,
	isLoading: false,
	available: true,
	commands: [],
	commandNames: new Set(),
	promptCommands: new Set(),
	armedOnlyCommands: new Set(),
	hoists: false,
	paneHasSession: true,
	...over,
});

const render = async (props) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = require("react-dom/client").createRoot(container);
	await act(async () => {
		root.render(React.createElement(SlashSuggestionsPopup, props));
	});
	return container;
};

const text = (node) => node.textContent.replace(/\s+/g, " ").trim();

test("the header reads the live applied count, and membership is visible", async () => {
	const node = await render({
		state: state({
			matches: [
				{ kind: "argument", row: tagRow({ applied: true, primary: true }) },
				{
					kind: "argument",
					row: tagRow({ value: "Home", name: "Home", tagId: "t-home" }),
				},
			],
			tagSelectedCount: 1,
		}),
		onPick: () => {},
	});
	assert.match(text(node), /Tags\s*·\s*1 of 8/);
	assert.match(text(node), /\[x\]\s*Work/);
	assert.match(text(node), /\[ \]\s*Home/);
	assert.match(text(node), /Primary/);
});

test("the empty query still shows the current tags", async () => {
	const node = await render({
		state: state({
			matches: [
				{ kind: "argument", row: tagRow({ applied: true }) },
				{
					kind: "argument",
					row: tagRow({ value: "Home", name: "Home", tagId: "t-home" }),
				},
			],
			tagSelectedCount: 1,
		}),
		onPick: () => {},
	});
	assert.match(text(node), /Work/);
	assert.match(text(node), /Home/);
});

test("the create row names the exact new tag and the Enter operation", async () => {
	const node = await render({
		state: state({
			matches: [
				{
					kind: "argument",
					row: {
						value: "Garden",
						name: "Create “Garden”",
						description: "Saved for all conversations",
						create: true,
					},
				},
			],
			argumentQuery: "Garden",
		}),
		onPick: () => {},
	});
	assert.match(text(node), /Create “Garden”/);
	assert.match(text(node), /Enter Create “Garden”/);
	assert.doesNotMatch(text(node), /Apply/);
});

test("a write error is an alert and the retry copy is the hook's own", async () => {
	const node = await render({
		state: state({
			tagError: "Tags were not saved. Try again.",
			matches: [{ kind: "argument", row: tagRow({ applied: true }) }],
		}),
		onPick: () => {},
	});
	const alert = node.querySelector('[role="alert"]');
	assert.ok(alert, "the failure is announced, not silent");
	assert.equal(text(alert), "Tags were not saved. Try again.");
});

test("the unapplied footer names the tag it adds", async () => {
	const node = await render({
		state: state({
			matches: [{ kind: "argument", row: tagRow() }],
		}),
		onPick: () => {},
	});
	// A complete phrase in the popup's English, like its siblings — not the
	// dialog's bare button label (review F5).
	assert.match(text(node), /Enter Add “Work”/);
	assert.match(text(node), /Click Add “Work”/);
});

test("a registry load failure is printed once", async () => {
	const failure = "Tags could not be loaded. Try again.";
	const node = await render({
		state: state({
			matches: [],
			argumentList: {
				rows: [],
				loading: false,
				error: failure,
				needsSession: false,
			},
			tagError: failure,
		}),
		onPick: () => {},
	});
	const occurrences = text(node).split(failure).length - 1;
	assert.equal(occurrences, 1, "one sentence, not the same line twice");
	assert.equal(
		node.querySelector('[role="alert"]'),
		null,
		"the empty row region owns the one line",
	);
});

test("a non-tag argument list keeps its existing header and footer", async () => {
	const node = await render({
		state: state({
			argumentCommand: "theme",
			inline: { source: "theme", nameThenMessage: false, runs: true },
			argumentQuery: "",
			matches: [
				{
					kind: "argument",
					row: { value: "dune", name: "Dune", description: "Sand" },
				},
			],
			tagSelectedCount: 0,
		}),
		onPick: () => {},
	});
	assert.match(text(node), /Themes/);
	assert.doesNotMatch(text(node), /of 8/);
	assert.match(text(node), /Enter runs \/theme dune/);
});
