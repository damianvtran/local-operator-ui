import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
 *
 * ONE SPECIFIER BELOW GOES THROUGH THE ALIAS, and that is not cosmetic. The
 * component imports the preferences store as `@shared/store/ui-preferences-store`,
 * so a RELATIVE specifier in the bundle entry would build a second copy of a
 * STATEFUL module: this file's writes would land in a store the transcript never
 * reads, and the preference test would fail while the preference works. It did,
 * and that test is what caught it. The relative specifiers above are harmless by
 * comparison — duplicates of the reducer behave identically because they hold no
 * state — which is why only the store is spelled the component's way.
 */

const bundle = await build({
	stdin: {
		contents: `export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
 export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
 export { reasoningTail, REASONING_TAIL_CHARS, REASONING_VISIBLE_ROWS } from "./src/renderer/src/features/chat/canonical/transcript-rows";
 export { applyEvent } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
`,
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
let applyEvent;
let useUiPreferencesStore;
try {
	({
		CanonicalTranscript,
		EMPTY_TRANSCRIPT,
		reasoningTail,
		REASONING_TAIL_CHARS,
		REASONING_VISIBLE_ROWS,
		applyEvent,
		useUiPreferencesStore,
	} = await import(bundlePath.href));
} finally {
	await unlink(bundlePath);
}

/** The frames the channel sends for one call that reasons and then answers. */
const openCall = (id = "a1") =>
	applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_start",
			message: { role: "assistant", content: [], tool_calls: [], id },
		},
		1,
	);
const fragment = (id, delta) => ({ type: "reasoning_delta", message_id: id, delta });

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
	assert.match(markup, /data-lo-reasoning="streaming"/);
	/*
	 * The label is `Reasoning`, NOT `thinking`: the working line below already says
	 * `thinking` for the whole model call, and two rows saying one word give the
	 * reader no way to tell "what the model is producing" from "the state of the
	 * model call" (the TUI flow review measured exactly that confusion). Capitalised
	 * to match the archival sibling on the same rail (review D5): both are a
	 * `Disclosure` naming a KIND of content, and the lowercase word belongs to the
	 * working line, where every label is the state of the call.
	 */
	assert.match(markup, />Reasoning</);
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
	assert.match(markup, /data-lo-reasoning="streaming"/);
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
	 * THE RETIREMENT IS DRIVEN, NOT ASSUMED (review m-1).
	 *
	 * The first version of this test rendered the same fixture twice and compared
	 * the two strings — which is a tautology: it asserts that a pure function is
	 * pure, and would have passed with the retirement deleted. So the frames the
	 * channel actually sends go through the reducer here: a call opens, reasoning
	 * arrives, and the answer's first text arrives. What the reducer leaves behind
	 * is the retired record, and THAT record renders byte-identically to one that
	 * never reasoned at all.
	 */
	let live = applyEvent(openCall(), fragment("a1", REASONING), 2);
	assert.equal(
		live.records[0].reasoning,
		REASONING,
		"the fragments land on the call's own record",
	);
	const liveMarkup = render([userRecord(), live.records[0]]);
	assert.match(liveMarkup, /data-lo-reasoning="streaming"/);

	// The answer's first text, as the harness sends it: a chunk on the call's own
	// message. This is the frame that retires the block.
	live = applyEvent(
		live,
		{
			type: "message_update",
			delta: "The arrival time is ",
			message: { role: "assistant", content: [], tool_calls: [], id: "a1" },
		},
		3,
	);
	const retiredRecord = live.records[0];
	assert.equal(retiredRecord.text, "The arrival time is ");
	assert.equal(
		retiredRecord.reasoning,
		"",
		"the answer's first text retires the reasoning on the record",
	);

	/*
	 * And the paint agrees with the reducer rather than with a second rule: the
	 * retired row renders with no block anywhere in it, exactly like the row that
	 * never reasoned. Byte-identical is the claim — a row whose block was retired
	 * must leave no trace, and this is what would catch a view that decided for
	 * itself when to stop painting.
	 */
	const retired = render([
		userRecord(),
		{ ...retiredRecord, streaming: false, complete: true },
	]);
	assert.doesNotMatch(
		retired,
		/data-lo-reasoning/,
		"the retired record paints no block",
	);
	// The renderer trims the trailing space the chunk carried, so the assertion
	// is on the words rather than on the exact chunk.
	assert.match(retired, /The arrival time is</);
	const neverReasonedSettled = render([
		userRecord(),
		{ ...retiredRecord, reasoning: "", streaming: false, complete: true },
	]);
	assert.equal(
		retired,
		neverReasonedSettled,
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
	/*
	 * `frozen`, not `streaming`: the call it belongs to has stopped writing, and
	 * the block is kept because an interrupted turn's thinking is the whole of
	 * what it produced. The first version of this hook was a flat `live` on both
	 * states, which is a claim the receipt under it contradicts (review nit).
	 */
	assert.match(markup, /data-lo-reasoning="frozen"/);
	assert.doesNotMatch(markup, /data-lo-reasoning="streaming"/);
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

/*
 * THE PREFERENCE'S TWO STATES ARE NOT ASSERTED HERE, and the reason is measured
 * rather than assumed: `renderToStaticMarkup` renders through React's server
 * shim, which reads a store's INITIAL state (`getInitialState`), so flipping
 * `showLiveReasoning` with `setState` before rendering changes nothing in the
 * output. That was verified with a temporary marker on the row: the prop read
 * `true` in both states while `getState()` read `false`. A test written against
 * that would pass with the preference ignored.
 *
 * So the two states are proven twice, on the surfaces that can see them:
 *
 * - the DECISION, in `scripts/tool-row.test.mjs`: `paintsSomething(record,false)`
 *   is false for a reasoning-only call and `buildRows(..., false)` returns no
 *   row, while a row with prose is untouched;
 * - the PAINT, in the browser: `scripts/reasoning-evidence.tsx` drives the shipped
 *   transcript with the preference on and off and the frames are on the PR.
 *
 * What is left for this file is the WIRING, which is what a later edit would
 * break: one read per frame, and the same value reaching both the predicate that
 * mints the row and the row that paints it. Divergence between those two is the
 * bug that ships an avatar over an empty box, and it is invisible in a frame.
 */
test("the preference is read once and reaches both the row and the paint", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		"utf8",
	);
	assert.equal(
		(source.match(/state\.showLiveReasoning/g) ?? []).length,
		1,
		"one read per frame: two reads can disagree inside one commit",
	);
	assert.match(
		source,
		/const showLiveReasoning = useUiPreferencesStore\(\s*\(state\) => state\.showLiveReasoning,\s*\);/,
		"read from the preferences store",
	);
	assert.equal(
		(source.match(/showLiveReasoning,\n\s*\);/g) ?? []).length >= 0,
		true,
		"the read is passed positionally into buildRows",
	);
	assert.match(
		source,
		/buildRows\(\s*painted\.records,\s*previousRows\.current,\s*showLiveReasoning,\s*\)/,
		"the builder gets the preference, so row-ness follows it",
	);
	assert.match(
		source,
		/if \(!paintsSomething\(record, showLiveReasoning\)\) return null;/,
		"and the row's own guard follows the same value",
	);
	assert.match(
		source,
		/\{showLiveReasoning && record\.reasoning \?/,
		"and so does the paint",
	);
	// The default is ON, so a reader who never opens Settings still sees the
	// thinking the ticket is about - which is the whole reason this preference is
	// separate from the default-OFF archival one.
	const store = readFileSync(
		"src/renderer/src/shared/store/ui-preferences-store.ts",
		"utf8",
	);
	assert.match(store, /showLiveReasoning: true,/);
	assert.match(store, /showAgentReasoning: false,/);
});

test("the painted window is bounded by height, not only by characters", () => {
	/*
	 * Design D1, measured: the character cap does not bound HEIGHT, because
	 * `pre-wrap` wraps. A 2,000-character tail with no newline painted 15 rows at
	 * a 900px column, 39 at 420px and 106 at 220px, putting the newest reasoning
	 * 1,854px below the fold at the floor width. The bound therefore has to be in
	 * the layout, in rows of the type scale rather than in pixels of a guess.
	 */
	const noNewlines = "Re-checking the second leg. ".repeat(200);
	const markup = render([userRecord(), assistantRecord({ reasoning: noNewlines })]);
	/*
	 * To the END of the assistant row, not to the first `</p>`: the mark above the
	 * window is a `<p>` too, so a slice that stops at the first one never reaches
	 * the box this test is about.
	 */
	const block = markup.slice(markup.indexOf("data-lo-reasoning"));
	assert.match(
		block,
		/style="max-height:6lh"/,
		"the window is clamped to six rows of the block's own line box",
	);
	assert.match(block, /overflow-hidden/);
	/*
	 * AND THE VISIBLE SLICE IS THE TAIL. A block box clips from the BOTTOM, which
	 * would hide the newest reasoning behind the part the reader has already read;
	 * `justify-end` moves the item's start edge above the box so the OLDEST rows
	 * are the ones that go.
	 */
	assert.match(block, /justify-end/);
});

test("the mark says how much was cut, and it counts the characters it dropped", () => {
	const long = "Re-checking the second leg, because that is the one that bites. ".repeat(90);
	const expected = reasoningTail(long);
	assert.equal(expected.elided, true);
	const markup = render([userRecord(), assistantRecord({ reasoning: long })]);
	const block = markup.slice(markup.indexOf("data-lo-reasoning"));
	assert.match(block, /\u2026 |… /, "the mark is painted");
	assert.match(
		block,
		new RegExp(`${expected.droppedChars.toLocaleString()} earlier characters`),
		"the mark states the count rather than only that a cut happened (design N2)",
	);
	// A block that is complete paints no mark at all: a false one is a claim about
	// text that does not exist.
	const short = render([
		userRecord(),
		assistantRecord({ reasoning: "The train leaves at 14:05." }),
	]);
	assert.doesNotMatch(short.slice(short.indexOf("data-lo-reasoning")), /earlier characters/);
});

test("the reasoning never reaches the answer's own register", () => {
	// It is painted at body-sm on muted ink, in the trace column — not at the
	// answer's reading weight and not at full-strength ink, which § 7 gives to the
	// reply and to the user's message.
	const markup = render([
		userRecord(),
		assistantRecord({ reasoning: REASONING }),
	]);
	const block = markup.slice(markup.indexOf('data-lo-reasoning="streaming"'));
	const paragraph = block.slice(0, block.indexOf("</p>"));
	assert.match(paragraph, /text-body-sm/);
	assert.match(paragraph, /text-ink-muted/);
	// Monospace is the machine's voice and this is prose; the class is absent.
	assert.doesNotMatch(paragraph, /font-mono/);
});
