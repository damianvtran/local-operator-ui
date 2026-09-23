import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The child reader's foot (`docs/run-sidebar.md` § 5.1, § 5.7).
 *
 * WHY THIS FILE EXISTS. The reader painted a `Result` block at the foot of the
 * page from the ROSTER ROW, and the rule that replaced it is a rule about what
 * is NOT on screen: the result is the child's own last message, so no frame can
 * show its absence and no model test can see it either — the model still carries
 * `resultText`, it is simply read in fewer states. Two claims were therefore
 * unasserted, and both are load-bearing:
 *
 *   1. a readable conversation paints NO result block, whatever `result_text`
 *      the row carries (this is the defect's fix; before it, the block rendered
 *      under the page);
 *   2. the states that cannot paint a conversation keep a BOUNDED preview and
 *      say what it is, so no state can reproduce the takeover the block caused
 *      (an unbounded `shrink-0` sibling over the only `flex-1` child of an
 *      `overflow-hidden` column does not shrink the sibling, it squeezes the
 *      page).
 *
 * The claims are asserted on the RENDERED MARKUP rather than on a predicate the
 * component exports: a test of a predicate this file could have written itself
 * would pass while the JSX painted the wrong branch, which is exactly how the
 * block survived review the first time. Bundled in memory with esbuild, like
 * `canonical-notice.test.mjs`, so the shipped component is what is rendered.
 */

const bundle = await build({
	stdin: {
		contents: `export { RunChildReader } from "./src/renderer/src/features/chat/components/run-details/run-child-reader";
export * as fixtures from "./src/renderer/src/features/chat/components/run-details/run-details.fixtures";
export { deriveRunDetails } from "./src/renderer/src/features/chat/components/run-details/run-detail-model";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});
const bundlePath = new URL("./_run-child-reader.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let RunChildReader;
let fixtures;
let deriveRunDetails;
try {
	({ RunChildReader, fixtures, deriveRunDetails } = await import(
		bundlePath.href
	));
} finally {
	await unlink(bundlePath);
}

/*
 * THE MARKUP PATTERNS, at the top level because biome's `useTopLevelRegex` is a
 * gate here and because a named pattern is what makes an assertion readable: the
 * labels are the claim under test, and one of them appearing in two of these is
 * the difference between "no block" and "no result block".
 */
/** The footer's sentence (§ 5.6), which every state carries and none of this changes. */
const READ_ONLY_FOOTER = /Read-only — this is the subagent&#x27;s conversation/;
const RESULT_LABEL = /<span[^>]*>Result<\/span>/;
const RESULT_PREVIEW_LABEL = /<span[^>]*>Result preview<\/span>/;
const FAILURE_LABEL = /<span[^>]*>Failed<\/span>/;
const ANY_OUTCOME_LABEL = /<span[^>]*>(Failed|Result|Result preview)<\/span>/;
/** The conversation's own last block, which is the row the reader IS for. */
const CONVERSATION_LINE = /Three of the four match the ledger/;
/** The result's opening words: inside the wire's clip, so only the row has them. */
const RESULT_OPENING = /Four of the 412 March invoices are unpaid/;
/** The result's last paragraph: BEYOND the clip, so only the page has it. */
const RESULT_CLOSING = /Recommended next step: reissue INV-2031/;
/** The bounded preview, with its own class list captured for the bounds assertions. */
const PREVIEW_PARAGRAPH = /<p class="([^"]*)">[^<]*Four of the 412/;
const MAX_HEIGHT = /max-h-40/;
const SCROLLS = /overflow-auto/;
const MONO = /font-mono/;
/** The exact words of the preview's honesty line, with React's escaping. */
const PREVIEW_NOTE =
	/This is a shortened copy\. This subagent&#x27;s conversation is not available\s+here\./;
/** The failure block, with its class list captured: machine voice, bounded. */
const FAILURE_PARAGRAPH = /<pre class="([^"]*)">FileNotFoundError/;
const FAILURE_TEXT = /FileNotFoundError: \[Errno 2\] No such file or directory/;

/** One reader, rendered, from a wire row and a page — the two inputs the pane
 * hands it in the app (the preview seam is the story/test seam the reader
 * documents; the app's own live path fetches the page).
 */
const renderReader = ({ job = {}, page = fixtures.childPage() } = {}) => {
	const details = deriveRunDetails({
		nowMs: fixtures.FIXTURE_NOW_MS,
		jobs: [fixtures.readerChild(job)],
		todos: [],
	});
	return renderToStaticMarkup(
		h(RunChildReader, {
			row: details.subagents[0],
			/*
			 * No children on this row: the child's OWN subagents section is not what
			 * this file is about, and an empty list is the state that paints nothing
			 * (`run-child-subagents.tsx`), so it cannot add or remove a foot block.
			 */
			childRows: [],
			childrenOpenable: true,
			onOpenChild: () => {},
			paneWidth: 420,
			sessionId: "parent-session",
			pulse: 0,
			live: false,
			previewPage: page,
			attachmentScope: null,
			onUnopenable: () => {},
			measuredAtMs: fixtures.FIXTURE_NOW_MS,
			measuredAtRealMs: fixtures.FIXTURE_NOW_MS,
		}),
	);
};

/** A settled child whose result the wire clipped, as `readerChild` sends one. */
const SETTLED = {
	status: "done",
	settledSecondsAgo: 12,
	progress: undefined,
	result: fixtures.CLIPPED_RESULT,
};

test("a readable conversation paints no result block, whatever the row carries", () => {
	const html = renderReader({ job: SETTLED });

	/*
	 * The clipped value is NOT on screen. This page carries no result of its own
	 * (no `finalResult`), so the opening words can only have come from the row's
	 * `result_text` — which is what the removed block painted.
	 */
	assert.equal(
		html.includes("Four of the 412 March invoices are unpaid"),
		false,
		"the roster row's clipped result must not be painted under a readable conversation",
	);
	// And no label claims one.
	assert.equal(RESULT_PREVIEW_LABEL.test(html), false);
	assert.equal(RESULT_LABEL.test(html), false);
	// The conversation itself IS painted, so this is not a test of an empty page.
	assert.match(html, CONVERSATION_LINE);
	// The footer still closes the page (§ 5.6, unchanged by this rule).
	assert.match(html, READ_ONLY_FOOTER);
});

test("the result paints where it belongs: the conversation's own last row", () => {
	const html = renderReader({
		job: SETTLED,
		page: fixtures.childPage({ finalResult: fixtures.LONG_RESULT }),
	});
	// The page's last row holds the whole text — including the paragraph that
	// lies BEYOND the wire's 2,000-character clip, which is the half a reader
	// could never have recovered from the foot (`CLIPPED_RESULT` is the prefix
	// and does not contain it).
	assert.match(html, RESULT_OPENING);
	assert.match(html, RESULT_CLOSING);
	assert.equal(
		fixtures.CLIPPED_RESULT.includes("Recommended next step"),
		false,
	);
	// And no block repeats it under the page that just carried it.
	assert.equal(RESULT_LABEL.test(html), false);
	assert.equal(RESULT_PREVIEW_LABEL.test(html), false);
});

test("a conversation that cannot be read keeps a BOUNDED, honestly-labelled preview", () => {
	const html = renderReader({
		job: SETTLED,
		page: fixtures.childPage({ state: "gone" }),
	});

	assert.match(html, RESULT_PREVIEW_LABEL);
	// Bounded: the same bound the failure block has, and it is a scroll box
	// rather than a paragraph that grows.
	const preview = html.match(PREVIEW_PARAGRAPH);
	assert.ok(preview, "the clipped result is painted as a paragraph");
	assert.match(preview[1], MAX_HEIGHT, "the preview carries a max height");
	assert.match(preview[1], SCROLLS, "the preview scrolls inside that height");
	// Honest about being a fragment, and about why it is here at all.
	assert.match(html, PREVIEW_NOTE);
});

test("the unreadable states are exactly the ones that preview, and loading is not one", () => {
	// `pending` and `gone` are absences; a reader with no child id has no page
	// to fetch; and `ready` with nothing painted has none to show.
	for (const [name, options] of [
		[
			"pending",
			{ job: SETTLED, page: fixtures.childPage({ state: "pending" }) },
		],
		["gone", { job: SETTLED, page: fixtures.childPage({ state: "gone" }) }],
		[
			"ready with no rows",
			{
				job: SETTLED,
				page: { ...fixtures.childPage(), entries: [] },
			},
		],
		[
			"no session id",
			{ job: { ...SETTLED, sessionId: null }, page: fixtures.childPage() },
		],
	]) {
		assert.match(
			renderReader(options),
			RESULT_PREVIEW_LABEL,
			`${name} previews the clipped result`,
		);
	}

	/*
	 * `loading` is the deliberate exclusion: the page is in flight, so nothing is
	 * painted yet and the row's own result is not a copy of anything on screen.
	 * A preview here would appear and then vanish under itself.
	 */
	assert.equal(
		RESULT_PREVIEW_LABEL.test(
			renderReader({
				job: SETTLED,
				/*
				 * The page the route has not answered yet, built by substituting the
				 * state rather than by asking `childPage` for it: the fixture's own
				 * signature is deliberately the three states the ROUTE can answer, and
				 * `loading` is the renderer's before-the-answer state rather than one
				 * of them.
				 */
				page: { ...fixtures.childPage(), state: "loading" },
			}),
		),
		false,
		"a page in flight is not an unreadable page",
	);
});

test("the failure is painted verbatim, in every transcript state, and wins the slot", () => {
	const FAILED = {
		status: "failed",
		settledSecondsAgo: 8,
		progress: undefined,
		error:
			"FileNotFoundError: [Errno 2] No such file or directory: 'ledger/q1.csv'",
	};
	for (const [name, page] of [
		["a readable page", fixtures.childPage({ includeTool: true })],
		["a gone page", fixtures.childPage({ state: "gone" })],
	]) {
		const html = renderReader({ job: FAILED, page });
		assert.match(html, FAILURE_LABEL, `${name} keeps the label`);
		assert.match(html, FAILURE_TEXT, `${name} prints the exception verbatim`);
		// The exception is machine voice in the `danger` bucket, bounded.
		const failure = html.match(FAILURE_PARAGRAPH);
		assert.ok(failure, `${name} paints it as a verbatim block`);
		assert.match(failure[1], MAX_HEIGHT);
		assert.match(failure[1], MONO);
	}

	// A row carrying BOTH (a failed child whose runner also recorded a result)
	// shows the failure and only the failure — the precedence the single outcome
	// block had before this change.
	const both = renderReader({
		job: { ...FAILED, result: fixtures.CLIPPED_RESULT },
		page: fixtures.childPage({ state: "gone" }),
	});
	assert.match(both, FAILURE_LABEL);
	assert.equal(RESULT_PREVIEW_LABEL.test(both), false);
	assert.equal(
		both.includes("Four of the 412 March invoices are unpaid"),
		false,
	);
});

test("a running child with a conversation has a quiet foot", () => {
	const html = renderReader({
		page: fixtures.childPage({ includeTool: true, launchTurn: true }),
	});
	assert.equal(ANY_OUTCOME_LABEL.test(html), false);
	assert.match(html, READ_ONLY_FOOTER);
});
