import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SPOKEN SUMMARY'S PURE HALVES: the detection rule the transcript draws the
 * block by, and the block's state table. Both are pure so a divergence from the
 * server's `select_spoken` (`local_operator/voice/speakable.py`) is a failing
 * line here rather than a block drawn from a paragraph other than the one spoken.
 * The rendered block, the strip and the History row are
 * `voice-composer.test.mjs`'s.
 */

const bundle = await build({
	stdin: {
		contents: `
			export { splitSpokenSummary } from "./src/renderer/src/features/voice/spoken-summary";
			export { spokenBlockView, replyCutNote } from "./src/renderer/src/features/voice/spoken-summary-model";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { splitSpokenSummary, spokenBlockView, replyCutNote } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const split = (text, streaming = false) =>
	splitSpokenSummary(text, { streaming });

test("no marker: nothing to fold, the reply is untouched", () => {
	assert.equal(split("Just a reply.\n\nWith two paragraphs."), null);
	// The word in prose is not a marker; only a paragraph START is.
	assert.equal(split("The spoken: word in the middle.\n\nDone."), null);
	assert.equal(split("It was spoken: aloud\n\nSpoken text follows."), null);
	assert.equal(split(""), null);
});

test("the last paragraph is lifted out; the body keeps everything above it", () => {
	const got = split(
		"Intro line.\n\nSecond paragraph.\n\nSpoken: Use SessionStart.",
	);
	assert.deepEqual(got, {
		body: "Intro line.\n\nSecond paragraph.",
		summary: "Use SessionStart.",
		last: true,
	});
});

test("the label is case-insensitive and may be bold, italic or wrapped", () => {
	for (const label of [
		"spoken:",
		"SPOKEN:",
		"**Spoken:**",
		"**Spoken**:",
		"_Spoken:_",
		"__Spoken:__",
	]) {
		const got = split(`Body.\n\n${label} Short answer.`);
		assert.equal(got?.summary, "Short answer.", label);
		assert.equal(got?.body, "Body.", label);
	}
	// A paragraph wrapped whole in bold drops its closing marker.
	assert.equal(
		split("Body.\n\n**Spoken: Short answer.**")?.summary,
		"Short answer.",
	);
});

test("the LAST marker wins, and an earlier one stays as prose", () => {
	const got = split("Spoken: the first.\n\nMiddle.\n\nSpoken: the second.");
	assert.equal(got?.summary, "the second.");
	assert.equal(got?.body, "Spoken: the first.\n\nMiddle.");
});

test("a label alone on its own line takes the next paragraph", () => {
	const got = split("Body.\n\n**Spoken:**\n\nThe fix is in.");
	assert.equal(got?.summary, "The fix is in.");
	assert.equal(got?.body, "Body.");
	// Same paragraph, label on its own line: the rest of the paragraph is the words.
	assert.equal(
		split("Body.\n\nSpoken:\nThe fix is in.")?.summary,
		"The fix is in.",
	);
});

test("a marker with nothing after it is no block once the reply has settled", () => {
	// The server falls back to the whole reply for an empty one: nothing to draw.
	assert.equal(split("Body.\n\nSpoken:"), null);
	assert.equal(split("Body.\n\nSpoken:   \n\n"), null);
});

test("code fences hide a marker, and a blank line inside one ends nothing", () => {
	assert.equal(
		split("Example:\n\n```\nSpoken: not a marker\n```\n\nDone."),
		null,
	);
	assert.equal(split("Example:\n\n```\nline\n\nSpoken: still code\n```"), null);
	assert.equal(
		split("Example:\n\n~~~\nSpoken: tilde fence\n~~~\n\nDone."),
		null,
	);
	// An unclosed fence runs to the end: a streaming fence never leaks a marker.
	assert.equal(split("Example:\n\n```\nSpoken: not yet closed", true), null);
	// A marker AFTER a fence is real.
	assert.equal(
		split("```\nSpoken: code\n```\n\nSpoken: real one.")?.summary,
		"real one.",
	);
});

test("four leading spaces is an indented code block; three is a paragraph", () => {
	assert.equal(split("Body.\n\n    Spoken: indented code"), null);
	assert.equal(
		split("Body.\n\n   Spoken: three spaces")?.summary,
		"three spaces",
	);
	// Not a list item, quote or heading either.
	for (const lead of ["- ", "> ", "## "]) {
		assert.equal(split(`Body.\n\n${lead}Spoken: nope`), null, lead);
	}
});

test("CRLF text finds the same paragraph", () => {
	const got = split("Body.\r\n\r\nSpoken: Short answer.");
	assert.equal(got?.summary, "Short answer.");
	assert.equal(got?.body, "Body.");
});

test("text after the paragraph moves above it: the block is always last", () => {
	const got = split("Intro.\n\nSpoken: Short.\n\nAfterword.");
	assert.equal(got?.body, "Intro.\n\nAfterword.");
	assert.equal(got?.last, false);
});

test("streaming: the block begins with the label, and the raw label never shows", () => {
	// The label has arrived, its words have not.
	assert.deepEqual(split("Body.\n\nSpoken:", true), {
		body: "Body.",
		summary: "",
		last: true,
	});
	// Words streaming in.
	assert.equal(
		split("Body.\n\nSpoken: Use Session", true)?.summary,
		"Use Session",
	);
	// The label itself half written is held back, not painted as prose.
	for (const partial of [
		"Sp",
		"Spo",
		"Spoke",
		"Spoken",
		"**Spoken",
		"**Spoken:*",
	]) {
		const got = split(`Body.\n\n${partial}`, true);
		assert.equal(got?.body, "Body.", partial);
		assert.equal(got?.summary, "", partial);
	}
	// One letter is just a letter, and a longer non-label is prose.
	assert.equal(split("Body.\n\nS", true), null);
	assert.equal(split("Body.\n\nSpot the difference", true), null);
	// Not a prefix any more once the paragraph has moved on.
	assert.equal(split("Body.\n\nSpoken-word poetry is fun", true), null);
});

test("block state: voice off, or not spoken here, is a record with no control", () => {
	const base = {
		streaming: false,
		voiceHere: true,
		answerOwed: false,
		entry: undefined,
		playingThis: false,
		muted: false,
	};
	assert.deepEqual(spokenBlockView({ ...base, voiceHere: false }), {
		tone: "static",
		control: null,
	});
	assert.deepEqual(spokenBlockView(base), { tone: "static", control: null });
	const entry = {
		sessionId: "s",
		source: "summary",
		truncated: false,
		interrupted: false,
		muted: false,
		at: 1,
	};
	// Voice off wins even over a record: no voice to replay with.
	assert.deepEqual(spokenBlockView({ ...base, voiceHere: false, entry }), {
		tone: "static",
		control: null,
	});
});

test("block state: each spoken state and the control it offers", () => {
	const entry = {
		sessionId: "s",
		source: "summary",
		truncated: false,
		interrupted: false,
		muted: false,
		at: 1,
	};
	const base = {
		streaming: false,
		voiceHere: true,
		answerOwed: false,
		entry,
		playingThis: false,
		muted: false,
	};
	const view = (patch) => spokenBlockView({ ...base, ...patch });
	assert.deepEqual(view({}), { tone: "spoken", control: "replay" });
	assert.deepEqual(view({ playingThis: true }), {
		tone: "speaking",
		control: null,
	});
	assert.deepEqual(view({ playingThis: true, muted: true }), {
		tone: "muted",
		control: "play",
	});
	assert.deepEqual(view({ entry: { ...entry, muted: true } }), {
		tone: "muted",
		control: "play",
	});
	assert.deepEqual(view({ entry: { ...entry, interrupted: true } }), {
		tone: "stopped",
		control: "replay",
	});
	assert.deepEqual(view({ entry: { ...entry, truncated: true } }), {
		tone: "cut",
		control: "replay",
	});
	// Spoken from the reply, not the summary: the block claims nothing.
	assert.deepEqual(view({ entry: { ...entry, source: "reply" } }), {
		tone: "static",
		control: null,
	});
});

test("block state: streaming says 'to be spoken' only when an answer is owed", () => {
	const base = {
		streaming: true,
		voiceHere: true,
		answerOwed: true,
		entry: undefined,
		playingThis: false,
		muted: false,
	};
	assert.deepEqual(spokenBlockView(base), { tone: "upcoming", control: null });
	assert.deepEqual(spokenBlockView({ ...base, answerOwed: false }), {
		tone: "static",
		control: null,
	});
});

test("the fallback footnote: only a cut reply, only with voice on", () => {
	const entry = (patch) => ({
		sessionId: "s",
		source: "reply",
		truncated: true,
		interrupted: false,
		muted: false,
		at: 1,
		...patch,
	});
	assert.equal(replyCutNote(entry({}), true), true);
	assert.equal(replyCutNote(entry({}), false), false);
	assert.equal(replyCutNote(entry({ truncated: false }), true), false);
	// A summary's own cut is the block's label, not a footnote.
	assert.equal(replyCutNote(entry({ source: "summary" }), true), false);
	assert.equal(replyCutNote(undefined, true), false);
});
