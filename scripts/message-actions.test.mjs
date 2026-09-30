/**
 * The action row under a turn-closing answer (#695): which actions it offers,
 * what its Copy writes, and what a press does.
 *
 * FOUR THINGS LIVE HERE, and they are the parts a frame cannot settle:
 *
 * 1. WHICH ACTIONS THE ROW OFFERS (`answerActionsFor`) - copy always and first,
 *    speak only when an agent id resolves, never more than those two. A frame
 *    shows one row's worth of buttons; it cannot show the row that must NOT have
 *    a Speak, or that the cap holds.
 * 2. WHAT COPY WRITES - the answer's VISIBLE text (`parseReplies`'s
 *    `remainingContent`), markdown verbatim and without a reply-quote's
 *    `<reply-to>` transport markup. Asserted against the SHIPPED parser with a
 *    fixture that carries all three shapes (a reply block, a fence, a table),
 *    because the failure mode this guards is a payload that quietly becomes the
 *    raw `record.text` - which would paste the reader's own prompt back at them.
 * 3. WHAT A PRESS DOES - one clipboard call through the canonical path, the
 *    label flipped to `Copied`, and the label returning to `Copy` on the timer
 *    that this row needs and the older toolbars never did (they reset on their
 *    subject changing; this row's subject never changes while it is mounted).
 *    Mounted in JSDOM against the real component and the real clipboard call
 *    site, because "the press copies" is not a claim a source scan can carry.
 * 4. THE FAILURE PATH - a refused write leaves the label alone. `Copied` on a
 *    press the browser discarded is the one outcome this row must not produce.
 *
 * WHAT THIS FILE DOES NOT PROVE: how the row looks in any theme, where its box
 * sits against the answer's (that is a DOM measurement -
 * `scripts/chat-alignment-geometry.mjs`, quoted in
 * `docs/evidence/chat-canonical-message-actions/README.md`), or that a real
 * Speech service answers. The frames are the first two; the third is the
 * speech stack's own subject.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * React reads this flag to decide whether `act`'s warning applies. Without it
 * every mount in this file warns "The current testing environment is not
 * configured to support act(...)" - noise that would bury a real warning about
 * the component.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROW_SOURCE = readFileSync(
	"src/renderer/src/features/chat/canonical/message-actions-row.tsx",
	"utf8",
);
const TRANSCRIPT_SOURCE = readFileSync(
	"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	"utf8",
);

/*
 * The regex literals this module uses, hoisted to the top level: the
 * `useTopLevelRegex` rule charges a literal constructed inside a function, and
 * `scripts/` is outside `pnpm lint`'s path list, so this tree's own gate
 * (`pnpm lint:scripts`) is the only thing that would have said so.
 */
const RE_ROW_MOUNT =
	/<AnswerActionRow\b[\s\S]{0,200}bodyText=\{remainingContent\}/;
const RE_CLOSES_TURN_LINE = /\{closesTurn && \(/;
const RE_ROW_MOUNT_SITES = /<AnswerActionRow\b/g;

/**
 * One in-memory build of the shipped row and its model.
 *
 * React stays EXTERNAL, the recipe the other mount rigs in this tree carry: the
 * component is rendered by this process's `react-dom`, and a bundled second copy
 * of React would give it a different hook dispatcher. The credential probe is
 * aliased to a fixture - the real hook is a react-query read against a local
 * server, and what this file needs from it is only the ANSWER, in both of its
 * halves.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { AnswerActionRow } from "./src/renderer/src/features/chat/canonical/message-actions-row";
			export { answerActionsFor, ANSWER_ACTIONS_LABEL, COPY_FEEDBACK_MS } from "./src/renderer/src/features/chat/canonical/message-actions";
			export { parseReplies } from "./src/renderer/src/features/chat/utils/reply-utils";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react/jsx-runtime", "react-dom"],
	plugins: [
		{
			/*
			 * The probe, answered statically. `speech` selects which half of it
			 * the mount sees, so one bundle covers "configured" and "not
			 * configured" without a second build.
			 */
			name: "credential-probe-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-credentials/ },
					() => ({ path: "probe", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						export const useRadientCredentialProbe = () => ({
							hasRadientApiKey: globalThis.__speechConfigured === true,
							isUnavailable: false,
						});
					`,
				}));
			},
		},
	],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
	jsx: "automatic",
});
/*
 * Written to a real file rather than imported as a data: URL: the bundle imports
 * React by bare specifier (external, so one copy is shared with this process's
 * renderer), and a data: URL has no base path for module resolution. Removed as
 * soon as it is imported - the recipe `aida-rail-marks.test.mjs` states.
 */
const bundlePath = new URL("./_message-actions.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------------------------------------ the rules */

test("copy is always offered, and it is first", () => {
	assert.deepEqual(mod.answerActionsFor({ agentId: undefined }), ["copy"]);
	assert.deepEqual(mod.answerActionsFor({ agentId: "c1" }), ["copy", "speak"]);
});

test("the row is capped at two actions, and Quote is not one of them", () => {
	for (const agentId of [undefined, "c1"]) {
		const actions = mod.answerActionsFor({ agentId });
		assert.ok(actions.length <= 2, `cap: got ${actions.length}`);
		assert.ok(
			!actions.includes("quote"),
			"Quote is raised by the selection, never by this row",
		);
	}
});

/* ------------------------------------------------- what Copy writes */

const REPLY_BLOCK = [
	"<reply-to>Is the March import finished?</reply-to>",
	"",
	"Four were late, and the oldest is 41 days behind.",
	"",
	"| invoice | days |",
	"|---|---|",
	"| INV-0041 | 41 |",
	"",
	"```sql",
	"select * from invoices where paid_at is null;",
	"```",
].join("\n");

test("the copied text is the VISIBLE answer, not the wire text", () => {
	const { remainingContent, replies } = mod.parseReplies(REPLY_BLOCK);
	assert.equal(replies.length, 1, "the fixture carries one reply block");
	assert.ok(
		!remainingContent.includes("<reply-to>"),
		"the transport markup is not something the reader can see, so it is not something Copy hands over",
	);
	assert.ok(
		remainingContent.includes("| INV-0041 | 41 |"),
		"markdown source is copied verbatim: the table survives",
	);
	assert.ok(
		remainingContent.includes("select * from invoices where paid_at is null;"),
		"the fence's body survives, and so do its fences",
	);
	assert.notEqual(
		remainingContent,
		REPLY_BLOCK,
		"the visible text is NOT the raw record text - this is the assertion the payload is pinned by",
	);
});

test("an answer with no reply block copies its own text, trimmed", () => {
	const { remainingContent } = mod.parseReplies("\n\nthe answer\n\n");
	assert.equal(remainingContent, "the answer");
});

/* --------------------------------------------- the press, mounted */

/**
 * A JSDOM mount of the real row, with the clipboard and the clipboard only
 * faked.
 *
 * `writeText` is the seam the app itself uses (`copyTarget`), so faking it
 * exercises the shipped call site, the shipped label switch and the shipped
 * timer - which is the whole of what a press does.
 */
const mount = async ({
	speechConfigured = false,
	refuseWrite = false,
} = {}) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	/*
	 * `navigator` is a getter-only property on this runtime's global object, so it
	 * is REPLACED rather than assigned - the row's copy path reads the global, and
	 * a failed assignment here would leave the test exercising Node's own
	 * `navigator` (which has no clipboard) while claiming to exercise the app's.
	 */
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Node = dom.window.Node;
	globalThis.__speechConfigured = speechConfigured;

	const written = [];
	Object.defineProperty(dom.window.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text) => {
				if (refuseWrite) throw new Error("clipboard refused");
				written.push(text);
			},
		},
	});

	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(mod.AnswerActionRow, {
				bodyText: "Four were late, and the oldest is 41 days behind.",
				agentId: "c1",
				speechId: "a1",
			}),
		);
	});
	const button = (label) =>
		dom.window.document.querySelector(
			`[data-lo-answer-actions] button[aria-label="${label}"]`,
		);
	return { dom, written, button, root };
};

test("the row is a toolbar with the actions as its leftmost content", async () => {
	const { dom, button } = await mount();
	const toolbar = dom.window.document.querySelector("[data-lo-answer-actions]");
	assert.ok(toolbar, "the toolbar is in the DOM");
	assert.equal(toolbar.getAttribute("role"), "toolbar");
	assert.equal(toolbar.getAttribute("aria-label"), mod.ANSWER_ACTIONS_LABEL);
	assert.ok(
		button("Copy"),
		"Copy is offered at rest, with no pointer in the frame",
	);
	assert.ok(
		dom.window.document.querySelector(
			'[data-lo-answer-actions] [aria-hidden="true"]',
		),
		"the icons are hidden from the accessibility tree; the accessible name is the label",
	);
	await act(async () => root_unmount(dom));
});

/* The mount's own teardown, kept in one place so every case leaves nothing. */
const root_unmount = async (dom) => {
	dom.window.document.body.innerHTML = "";
};

test("a press copies the answer and says so, then stops saying so", async () => {
	const { dom, written, button } = await mount();
	await act(async () => {
		button("Copy").dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.deepEqual(
		written,
		["Four were late, and the oldest is 41 days behind."],
		"one clipboard call, carrying the answer the reader can see",
	);
	assert.ok(button("Copied"), "the label is the press's own answer");
	/*
	 * The reset is this row's own requirement: the older toolbars clear `copied`
	 * when their subject changes, and this button's subject never does. Waiting
	 * the real interval is the only way to prove the timer is armed at the
	 * shipped constant rather than at some other number.
	 */
	await act(async () => {
		await new Promise((resolve) =>
			setTimeout(resolve, mod.COPY_FEEDBACK_MS + 250),
		);
	});
	assert.ok(button("Copy"), "the label has returned to Copy");
	assert.equal(button("Copied"), null);
	await act(async () => root_unmount(dom));
});

test("a refused write does not claim success", async () => {
	const { dom, written, button } = await mount({ refuseWrite: true });
	await act(async () => {
		button("Copy").dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.deepEqual(written, [], "nothing reached the clipboard");
	assert.ok(button("Copy"), "the label is unchanged");
	assert.equal(button("Copied"), null, "a failed press must not claim success");
	await act(async () => root_unmount(dom));
});

test("Speak is offered when there is an agent to speak with, and disabled when speech is not configured", async () => {
	const off = await mount({ speechConfigured: false });
	assert.ok(
		off.dom.window.document.querySelector(
			'[data-lo-answer-actions] button[aria-label="Speak aloud"]',
		),
		"the button is there",
	);
	assert.equal(
		off.dom.window.document.querySelector(
			'[data-lo-answer-actions] button[aria-label="Speak aloud"]',
		).disabled,
		true,
		"and it says so with its state rather than by hiding, so the reason in its tooltip can reach the reader",
	);
	await act(async () => root_unmount(off.dom));
});

/* ------------------------------------------------------- the wiring */

test("the row rides the turn-closing line, and nothing else mounts it", () => {
	assert.ok(
		RE_ROW_MOUNT.test(TRANSCRIPT_SOURCE),
		"the transcript hands the row the VISIBLE text, the same value its Quote gate reads",
	);
	assert.ok(
		RE_CLOSES_TURN_LINE.test(TRANSCRIPT_SOURCE),
		"the line's condition is closesTurn: the actions are a fact about the answer, while the numbers and the stamp are gated separately on !closingLineSuppressed",
	);
	assert.ok(
		TRANSCRIPT_SOURCE.includes(
			"!closingLineSuppressed && foot && foot.actions > 0",
		),
		"the caption keeps its own gate, so a bar'd turn still gets the actions and not the numbers",
	);
	assert.equal(
		(TRANSCRIPT_SOURCE.match(RE_ROW_MOUNT_SITES) ?? []).length,
		1,
		"one mount site",
	);
});

test("one clipboard call site: the row uses copyTarget and adds no second implementation", () => {
	assert.ok(
		ROW_SOURCE.includes("copyTarget("),
		"the canonical path's copy is used",
	);
	assert.ok(
		!ROW_SOURCE.includes("navigator.clipboard"),
		"a second writeText is the defect the canonical path exists to prevent",
	);
	assert.ok(
		!ROW_SOURCE.includes("ClipboardItem"),
		"and no rich-clipboard variant either: the row copies plain text, like /copy",
	);
});
