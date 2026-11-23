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
			export { spokenBlockView, replyCutNote, replayOffer, replayFactsOf } from "./src/renderer/src/features/voice/spoken-summary-model";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	splitSpokenSummary,
	spokenBlockView,
	replyCutNote,
	replayOffer,
	replayFactsOf,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const split = (text, streaming = false) =>
	splitSpokenSummary(text, { streaming });
const split2 = (text, streaming) => splitSpokenSummary(text, { streaming });

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
	// From `spoke` on, a half-written label is held back from the prose and NO
	// block is drawn: the label is not whole, so there is nothing to label yet.
	for (const partial of [
		"Spoke",
		"Spoken",
		"**Spoken",
		"_Spoke",
		"**Spoken**",
	]) {
		const got = split(`Body.\n\n${partial}`, true);
		assert.equal(got?.body, "Body.", partial);
		assert.equal(got?.held, true, partial);
		assert.equal(got?.summary, "", partial);
	}
	// The whole label (colon and any closing mark arriving) is the block.
	for (const whole of ["Spoken:", "**Spoken:*", "**Spoken**:", "_Spoken:"]) {
		const got = split(`Body.\n\n${whole}`, true);
		assert.equal(got?.body, "Body.", whole);
		assert.equal(got?.held, undefined, whole);
		assert.equal(got?.summary, "", whole);
	}
	// Fewer than five letters is an ordinary word: prose, and no block.
	for (const word of ["S", "Sp", "Spo", "Spok", "_Sp", "**Spo"])
		assert.equal(split(`Body.\n\n${word}`, true), null, word);
	assert.equal(split("Body.\n\nSpot the difference", true), null);
	// Not a prefix any more once the paragraph has moved on.
	assert.equal(split("Body.\n\nSpoken-word poetry is fun", true), null);
});

/*
 * THE STREAMING SWEEP (review m1, QA Q-4): every label form the server accepts,
 * revealed one character at a time, against the three promises - an ordinary
 * paragraph is never held or boxed past `Spoke`; a half label never reaches the
 * prose from `spoke` on and draws no block; a whole label draws the block, and
 * only the words. `violations` is the sweep's own judge, so the negative control
 * below can hand it a rule that breaks each promise and see it fire.
 */
const FORMS = [
	["Spoken:", ""],
	["**Spoken:**", ""],
	["**Spoken**:", ""],
	["__Spoken:__", ""],
	["_Spoken:_", ""],
	["*Spoken:*", ""],
	["*Spoken*:", ""],
	["spoken:", ""],
];

function violations(splitFn) {
	const found = [];
	for (const [label] of FORMS) {
		const words = "Use SessionStart.";
		const text = `Body.\n\n${label} ${words}`;
		const start = "Body.\n\n".length;
		// The label is whole at its colon: that is when the server's rule matches.
		const labelEnd = start + label.indexOf(":") + 1;
		for (let end = start + 1; end <= text.length; end += 1) {
			const got = splitFn(text.slice(0, end), true);
			const shown = text.slice(start, end);
			const letters = shown.replace(/^[*_]+/, "").length;
			const tag = `${label} @${end - start}`;
			if (end >= labelEnd) {
				// The label is whole: the block, the words only, no label in the body.
				if (!got || got.held || got.body !== "Body.")
					found.push(`${tag}: block expected`);
				else if (/spoken/i.test(got.summary))
					found.push(`${tag}: label in summary`);
			} else if (letters >= 5) {
				// Half a label, long enough to hold: hidden and no block.
				if (!got || got.held !== true || got.body !== "Body.")
					found.push(`${tag}: hold expected`);
			} else if (got !== null) {
				found.push(`${tag}: too short to hold`);
			}
		}
	}
	// An ordinary paragraph is prose at every length, bar the one-delta `Spoke`.
	for (const word of [
		"Spotify is great.",
		"Sport is fun.",
		"Spokesperson said no.",
		"Spoke to the team.",
		"Spoken language is odd.",
	]) {
		const text = `Body.\n\n${word}`;
		for (let end = "Body.\n\n".length + 1; end <= text.length; end += 1) {
			const got = splitFn(text.slice(0, end), true);
			const shown = text.slice("Body.\n\n".length, end);
			if (got !== null && !/^spoke(n)?$/i.test(shown))
				found.push(`${word} @${shown}: held or boxed`);
		}
	}
	return found;
}

test("streaming sweep: every label form, one character at a time", () => {
	assert.deepEqual(violations(split2), []);
});

test("streaming sweep: the negative control fires on each broken rule", () => {
	// Never holds: a half label reaches the prose.
	assert.ok(
		violations((text) => splitSpokenSummary(text, { streaming: false }))
			.length > 0,
	);
	// Holds from two characters, as the old rule did: "Spotify" is boxed.
	const eager = (text, streaming) => {
		const got = splitSpokenSummary(text, { streaming });
		if (got) return got;
		const tail = text.split("\n\n").at(-1);
		return tail.length >= 2 && "spoken:".startsWith(tail.toLowerCase())
			? {
					body: text.slice(0, text.lastIndexOf("\n\n")),
					summary: "",
					last: true,
				}
			: null;
	};
	assert.ok(violations(eager).some((v) => v.includes("too short")));
	// Draws a block for a held label.
	const boxed = (text, streaming) => {
		const got = splitSpokenSummary(text, { streaming });
		return got?.held ? { ...got, held: undefined } : got;
	};
	assert.ok(violations(boxed).length > 0);
});

const facts = {
	streaming: false,
	voiceHere: true,
	answerOwed: false,
	entry: undefined,
	playingThis: false,
	requested: false,
	muted: false,
	paused: false,
	busy: false,
};
const summaryEntry = {
	sessionId: "s",
	source: "summary",
	truncated: false,
	interrupted: false,
	muted: false,
	at: 1,
};
const view = (patch) => spokenBlockView({ ...facts, ...patch });
const shape = (tone, control, disabled = false) => ({
	tone,
	control,
	disabled,
});

test("block state: voice off, or not spoken here, is a record with no control", () => {
	assert.deepEqual(view({ voiceHere: false }), shape("static", null));
	assert.deepEqual(view({}), shape("static", null));
	// Voice off wins even over a record: no voice to replay with.
	assert.deepEqual(
		view({ voiceHere: false, entry: summaryEntry }),
		shape("static", null),
	);
});

test("block state: each spoken state and the control it offers", () => {
	const entry = summaryEntry;
	const spoken = (patch) => view({ entry, ...patch });
	assert.deepEqual(spoken({}), shape("spoken", "replay"));
	assert.deepEqual(
		spoken({ entry: { ...entry, interrupted: true } }),
		shape("stopped", "replay"),
	);
	assert.deepEqual(
		spoken({ entry: { ...entry, truncated: true } }),
		shape("cut", "replay"),
	);
	// Never heard (spoken while muted): "Play", even with the speaker back on.
	assert.deepEqual(
		spoken({ entry: { ...entry, muted: true } }),
		shape("muted", "play"),
	);
	// Spoken from the reply, not the summary: the block claims nothing.
	assert.deepEqual(
		spoken({ entry: { ...entry, source: "reply" } }),
		shape("static", null),
	);
});

test("block state: asked or playing is 'Speaking', never 'Spoken aloud'; Replay waits, mounted", () => {
	const entry = summaryEntry;
	// U2: the record exists from the request; the label does not claim the audio.
	assert.deepEqual(
		view({ entry, requested: true, busy: true }),
		shape("speaking", "replay", true),
	);
	assert.deepEqual(
		view({ entry, playingThis: true, busy: true }),
		shape("speaking", "replay", true),
	);
	// Muted while it plays: nothing is heard, and Play is the word - also waiting.
	assert.deepEqual(
		view({ entry, playingThis: true, busy: true, muted: true }),
		shape("muted", "play", true),
	);
	// Asked, and the server has not yet said what it speaks: still "Speaking".
	assert.deepEqual(
		view({ requested: true, busy: true }),
		shape("speaking", "replay", true),
	);
	// A request for a message this window has no record of, once refused, is plain.
	assert.deepEqual(view({ requested: false }), shape("static", null));
	// A streaming paragraph that already has a record is the record's state.
	assert.deepEqual(
		view({ streaming: true, entry, requested: true, busy: true }),
		shape("speaking", "replay", true),
	);
});

test("block state: ONE replay rule - not the holder or paused: none; busy: waits; muted: Play", () => {
	const entry = summaryEntry;
	assert.deepEqual(view({ entry, paused: true }), shape("spoken", null));
	assert.deepEqual(
		view({ entry, busy: true }),
		shape("spoken", "replay", true),
	);
	assert.deepEqual(view({ entry, muted: true }), shape("spoken", "play"));
	assert.deepEqual(
		view({ entry, muted: true, busy: true }),
		shape("spoken", "play", true),
	);
	// The rule itself, which the strip, History and the footnote read.
	const offer = (patch) =>
		replayOffer({
			voiceHere: true,
			paused: false,
			busy: false,
			muted: false,
			...patch,
		});
	assert.deepEqual(offer({}), { word: "replay", disabled: false });
	assert.equal(offer({ voiceHere: false }), null);
	assert.equal(offer({ paused: true }), null);
	assert.deepEqual(offer({ busy: true }), { word: "replay", disabled: true });
	assert.deepEqual(offer({ muted: true }), { word: "play", disabled: false });
});

test("replay facts: busy is audio moving, a request in flight, or this conversation's owed answer", () => {
	const state = {
		active: { session_id: "s", enabled_at: 1 },
		rig: { rig: "ready", clients: 1 },
		activity: null,
		speakRequest: null,
		exchange: null,
	};
	const read = (patch, id = "s") => replayFactsOf({ ...state, ...patch }, id);
	assert.deepEqual(read({}), {
		voiceHere: true,
		paused: false,
		muted: false,
		busy: false,
	});
	assert.equal(read({ activity: "speaking" }).busy, true);
	assert.equal(read({ activity: "hearing" }).busy, true);
	assert.equal(
		read({ speakRequest: { sessionId: "s", messageId: "m", at: 1 } }).busy,
		true,
	);
	assert.equal(
		read({ exchange: { kind: "working", sessionId: "s" } }).busy,
		true,
	);
	// Another conversation's owed answer is not this one's.
	assert.equal(
		read({ exchange: { kind: "working", sessionId: "t" } }).busy,
		false,
	);
	assert.equal(read({}, "t").voiceHere, false);
	assert.equal(replayFactsOf(state, undefined).voiceHere, false);
	assert.equal(read({ rig: { rig: "ready", paused: true } }).paused, true);
	assert.equal(read({ rig: { rig: "ready", muted: true } }).muted, true);
});

test("block state: streaming says 'to be spoken' only when an answer is owed", () => {
	const base = { streaming: true, answerOwed: true };
	assert.deepEqual(view(base), shape("upcoming", null));
	assert.deepEqual(view({ ...base, answerOwed: false }), shape("static", null));
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
