import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * What the model's reasoning block PAINTS, rendered by the shipped transcript.
 *
 * The states the ticket lists are asserted here as MARKUP rather than looked at
 * in a still, because the claims are about what reaches the DOM and a picture
 * cannot say which element it is: that the block exists while a call is
 * reasoning, that its window is bounded and says so, that it is GONE the moment
 * the row has prose, that an abort keeps it, and that a turn which never reasons
 * renders exactly what it rendered before this change.
 *
 * Rendered through `CanonicalTranscript`, not through `LiveReasoning` alone: the
 * block's presence is a decision made three modules up (the reducer keeps the
 * field, `paintsSomething` decides whether the record is a row at all, and the
 * row decides where the block goes), and a test that mounted the leaf would pass
 * while the row never rendered it.
 *
 * The live-browser rig for these states is `scripts/reasoning-evidence.{html,tsx}`
 * with `scripts/reasoning-evidence.vite.mjs`, driven as `docs/evidence/`'s README
 * for the submit-latency harness describes; this file is the part of that
 * evidence that survives in CI.
 */

const bundle = await build({
	stdin: {
		contents: `export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
 export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
 export { reasoningTail, REASONING_TAIL_CHARS, REASONING_VISIBLE_ROWS } from "./src/renderer/src/features/chat/canonical/transcript-rows";`,
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
const bundlePath = new URL("./_reasoning-stream.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let CanonicalTranscript;
let EMPTY_TRANSCRIPT;
let reasoningTail;
let REASONING_TAIL_CHARS;
let REASONING_VISIBLE_ROWS;
try {
	({
		CanonicalTranscript,
		EMPTY_TRANSCRIPT,
		reasoningTail,
		REASONING_TAIL_CHARS,
		REASONING_VISIBLE_ROWS,
	} = await import(bundlePath.href));
} finally {
	await unlink(bundlePath);
}

const TS = 1_760_000_000_000;

const userRecord = () => ({
	kind: "user",
	id: "u1",
	ts: TS,
	text: "Work out the arrival time step by step.",
	images: [],
});

const assistantRecord = (extra = {}) => ({
	kind: "assistant",
	id: "a1",
	ts: TS + 1,
	text: "",
	reasoning: "",
	streaming: true,
	stopReason: null,
	error: false,
	...extra,
});

/** The shipped transcript, with the one state under test. */
const render = (records, props = {}) =>
	renderToStaticMarkup(
		h(CanonicalTranscript, {
			transcript: { ...EMPTY_TRANSCRIPT, records },
			frontend: null,
			gate: null,
			waiting: true,
			starting: false,
			startingAfterId: null,
			loadingOlder: false,
			onLoadOlder: async () => true,
			containerRef: { current: null },
			isSmallView: false,
			status: "live",
			failure: null,
			awaitingHydration: false,
			onReconnect: () => {},
			...props,
		}),
	);

const REASONING =
	"The train leaves at 14:05. First leg: 240 km at 80 km/h takes 3 hours.";

test("a call that is reasoning paints the block, and it is a different word from the working line", () => {
	const markup = render([
		userRecord(),
		assistantRecord({ reasoning: REASONING }),
	]);
	assert.match(markup, /data-lo-reasoning="live"/);
	// The label is `reasoning`, NOT `thinking`: the working line below already
	// says `thinking` for the whole model call, and two rows saying one word give
	// the reader no way to tell "what the model is producing" from "the state of
	// the model call" (the TUI flow review measured exactly that confusion).
	assert.match(markup, />reasoning</);
	assert.match(markup, /data-lo-working-line="true"/);
	assert.match(
		markup,
		/>thinking</,
		"the working line still carries the phase word",
	);
	assert.match(
		markup,
		new RegExp(REASONING.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	);
	// The answer has not started, so the row is not claiming one: no prose and no
	// caption about a missing prefix of an answer.
	assert.doesNotMatch(markup, /Earlier text of this answer/);
});

test("the block is a bounded window and says when it is one", () => {
	const long =
		"Re-checking the second leg, because that is the one that bites. ".repeat(
			80,
		);
	assert.ok(
		long.length > REASONING_TAIL_CHARS * 2,
		`the fixture must be long enough to be elided twice over — got ${long.length} chars against a ${REASONING_TAIL_CHARS}-char window`,
	);
	const { text, elided } = reasoningTail(long);
	assert.equal(elided, true);
	const markup = render([userRecord(), assistantRecord({ reasoning: long })]);
	assert.match(markup, /data-lo-reasoning="live"/);
	assert.match(markup, /\u2026 /, "the elision mark is painted with the text");
	// Bounded by ROWS as well as by characters: a model that never emits a
	// newline would otherwise paint its whole window as one paragraph.
	assert.ok(
		text.split("\n").length <= REASONING_VISIBLE_ROWS,
		`${text.split("\n").length} painted rows`,
	);
	// And what is painted is the END of the reasoning, which is the part the
	// reader is following.
	assert.ok(long.endsWith(text));
});

test("the answer retires the block, and a turn that never reasoned is unchanged", () => {
	const settled = assistantRecord({
		text: "The arrival time is 20:00.",
		streaming: false,
		complete: true,
	});
	const neverReasoned = render([userRecord(), settled]);
	assert.doesNotMatch(neverReasoned, /data-lo-reasoning/);
	assert.match(neverReasoned, /The arrival time is 20:00\./);

	/*
	 * The strongest form of "a consumer that does not understand the event keeps
	 * rendering exactly what it rendered": a settled row whose reasoning the
	 * reducer had cleared (the retirement it performs on the answer's first
	 * token) renders BYTE-IDENTICALLY to a row that never carried any. If the
	 * retirement were conditional in the view instead, these two would differ and
	 * this assertion is what would catch it.
	 */
	const retired = render([userRecord(), settled]);
	assert.equal(
		retired,
		neverReasoned,
		"a retired block leaves no trace in the markup",
	);
});

test("an interrupted turn keeps the block, frozen, under the turn's own receipt", () => {
	const markup = render(
		[
			userRecord(),
			assistantRecord({
				reasoning: "Weighing two options, and then the user stopped me.",
				streaming: false,
				stopReason: "aborted",
			}),
		],
		// The turn is over, so the session-level latch is down: an aborted turn
		// sets `waiting` false, which is what takes the working line away.
		{ waiting: false },
	);
	assert.match(markup, /data-lo-reasoning="live"/);
	assert.match(markup, /Stopped before finishing/);
	// It is not claiming to be live: no spinner of its own, and the working line
	// is gone with the turn.
	assert.doesNotMatch(markup, /data-lo-working-line/);
	/*
	 * And the turn's completion caption is NOT stamped on it: the block is
	 * content, but it is not the answer the caption times, and a `<time>` of the
	 * thinking would present an interrupted thought as the reply. Scoped to the
	 * assistant row, because the USER row's own stamp is a different carrier and
	 * must stay (`the two captions are separate carriers`, turn-timestamp tests).
	 */
	const assistantRow = markup.slice(markup.indexOf('data-record-id="a1"'));
	assert.doesNotMatch(assistantRow, /<time/);
	assert.doesNotMatch(assistantRow, /data-stamp/);
});

test("the block adds no second liveness element while the answer streams", () => {
	const streaming = assistantRecord({
		text: "The arrival time is ",
		reasoning: "",
	});
	const markup = render([userRecord(), streaming]);
	assert.doesNotMatch(markup, /data-lo-reasoning/);
	// One working line, as before: `paintsSomething` yields the row to the prose
	// and the aggregate line stays the only thing claiming liveness.
	assert.equal(markup.split("data-lo-working-line").length - 1, 1);
});

test("the reasoning never reaches the answer's own register", () => {
	// It is painted at body-sm on muted ink, in the trace column — not at the
	// answer's reading weight and not at full-strength ink, which § 7 gives to the
	// reply and to the user's message.
	const markup = render([
		userRecord(),
		assistantRecord({ reasoning: REASONING }),
	]);
	const block = markup.slice(markup.indexOf('data-lo-reasoning="live"'));
	const paragraph = block.slice(0, block.indexOf("</p>"));
	assert.match(paragraph, /text-body-sm/);
	assert.match(paragraph, /text-ink-muted/);
	// Monospace is the machine's voice and this is prose; the class is absent.
	assert.doesNotMatch(paragraph, /font-mono/);
});
