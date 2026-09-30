/**
 * `clipForSpeech`: what one press sends when the text is longer than the
 * service reads.
 *
 * WHAT THIS FILE IS, exactly: the boundaries. A press must never send more
 * than the service's cap, must end where a person would end a sentence rather
 * than mid-word when a sentence ender is available, and must DISCLOSE the cut
 * (the toast lives in `speak-control.tsx`; the flag this module returns is what
 * raises it). The three shapes a window can have - a sentence ender, only
 * whitespace, neither - are each asserted against an independently computed
 * expectation, so the module cannot agree with a bug in its own scan.
 *
 * WHAT THIS FILE DOES NOT PROVE: that the service accepts the result (its own
 * cap is the server's half, and the number is mirrored from it), or that the
 * toast is raised (that is `speech-controls.test.mjs`'s press cases, where the
 * surface actually presses).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/shared/lib/speech-clip";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { clipForSpeech, SPEECH_MAX_CHARS } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("text within the cap is returned untouched and undeclared", () => {
	const short = "Four were late, and the oldest is 41 days behind.";
	const result = clipForSpeech(short);
	assert.equal(
		result.clipped,
		false,
		"nothing was cut, so nothing is disclosed",
	);
	assert.equal(result.text, short);
});

test("the cap itself is not a cut", () => {
	const exact = "x".repeat(SPEECH_MAX_CHARS);
	const result = clipForSpeech(exact);
	assert.equal(result.clipped, false, "exactly the cap is within it");
	assert.equal(result.text, exact);
});

test("a long text is cut at its last sentence ender inside the window", () => {
	/*
	 * Independent expectation: the window's own last `.` (every one of them is
	 * followed by a space, so each is a boundary), cut just past it. Computed
	 * WITHOUT the module's scan, so the two agreeing is a fact about the module
	 * rather than about a shared bug.
	 */
	const sentence = "The quick brown fox jumps over the lazy dog. ";
	const long = sentence.repeat(250);
	assert.ok(long.length > SPEECH_MAX_CHARS, "the fixture must exceed the cap");
	const window = long.slice(0, SPEECH_MAX_CHARS);
	const dot = window.lastIndexOf(".");
	const expected = window.slice(0, dot + 1);
	const result = clipForSpeech(long);
	assert.equal(result.clipped, true);
	assert.equal(
		result.text,
		expected,
		"the cut keeps the ender and drops the space after it",
	);
	assert.ok(result.text.endsWith("."), "the read ends like a sentence");
});

test("a newline inside the window is a boundary too", () => {
	const long = "line\n".repeat(2500);
	const window = long.slice(0, SPEECH_MAX_CHARS);
	const result = clipForSpeech(long);
	assert.equal(result.clipped, true);
	assert.equal(
		result.text,
		window.trimEnd(),
		"the paragraph break is kept, the newline trimmed",
	);
});

test("with no ender the cut falls to the last whitespace", () => {
	const long = `${"x".repeat(7000)} ${"y".repeat(4000)}`;
	const result = clipForSpeech(long);
	assert.equal(result.clipped, true);
	assert.equal(
		result.text,
		"x".repeat(7000),
		"cut before the trailing run, not mid-token",
	);
});

test("a dot inside a host is not a sentence, and does not halve it", () => {
	const long = `${"x".repeat(9000)}.com/foo ${"y".repeat(2000)}`;
	const result = clipForSpeech(long);
	assert.equal(result.clipped, true);
	assert.ok(
		result.text.endsWith(".com/foo"),
		"the dot is followed by a letter, so the window's real cut is the whitespace after it",
	);
});

test("with neither ender nor whitespace the cut is the hard limit", () => {
	const long = "z".repeat(SPEECH_MAX_CHARS + 2000);
	const result = clipForSpeech(long);
	assert.equal(result.clipped, true);
	assert.equal(result.text, "z".repeat(SPEECH_MAX_CHARS));
	assert.equal(result.text.length, SPEECH_MAX_CHARS);
});

test("a whitespace-only window still sends something", () => {
	const long = `${" ".repeat(SPEECH_MAX_CHARS + 10)}end`;
	const result = clipForSpeech(long);
	assert.equal(result.clipped, true, "the cut is still disclosed");
	assert.ok(
		result.text.length > 0,
		"a press that speaks nothing is worse than a hard cut",
	);
});

test("every result is within the cap and a prefix of its input", () => {
	const fixtures = [
		"The quick brown fox jumps over the lazy dog. ".repeat(250),
		"line\n".repeat(2500),
		`${"x".repeat(7000)} ${"y".repeat(4000)}`,
		"z".repeat(SPEECH_MAX_CHARS + 2000),
	];
	for (const input of fixtures) {
		const result = clipForSpeech(input);
		assert.ok(
			result.text.length <= SPEECH_MAX_CHARS,
			`${input.length}-char input produced a ${result.text.length}-char read`,
		);
		assert.ok(
			input.startsWith(result.text),
			"the read is always a prefix of what was asked",
		);
	}
});
