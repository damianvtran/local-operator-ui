import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	BRIDGE_EMOJI_ALIASES,
	createEmojiAliasResolver,
	createEmojiQueryGate,
	createEmojiSearch,
	findEmojiQuery,
	insertEmoji,
	normalizeEmojiAlias,
} from "../src/renderer/src/features/team-bridge/emoji/emoji-autocomplete-model.ts";

// Node's native type stripping exercises the shipped pure source without a second
// compiler or dependency tree. No DOM, keyboard integration or layout is claimed.
const corpus = JSON.parse(
	readFileSync(
		new URL(
			"../src/renderer/src/features/team-bridge/data/emoji.json",
			import.meta.url,
		),
		"utf8",
	),
).entries.map(([emoji, name, , keywords]) => ({ emoji, name, keywords }));
const search = createEmojiSearch(corpus);
const points = (...values) => String.fromCodePoint(...values);
const smile = points(0x1f600);
const toned = points(0x1f44d, 0x1f3fd);
const zwj = points(0x1f469, 0x200d, 0x1f4bb);
const queryAt = (text, extra = {}) =>
	findEmojiQuery({
		text,
		selectionStart: text.length,
		selectionEnd: text.length,
		interaction: { text, kind: "typing" },
		...extra,
	});

test("cached aliases normalize separators, width and case; exact aliases rank first", () => {
	assert.equal(normalizeEmojiAlias("  THUMBS＿UP--  "), "thumbs up");
	assert.equal(normalizeEmojiAlias("-1"), "-1");
	assert.notEqual(normalizeEmojiAlias("-1"), normalizeEmojiAlias("1"));
	assert.equal(normalizeEmojiAlias("+1"), "+1");
	const a = { emoji: "a", name: "not exact", keywords: ["super happy"] };
	const b = { emoji: "b", name: "Happy", keywords: [] };
	const c = { emoji: "c", name: "happy face", keywords: [] };
	const lookup = createEmojiSearch([a, b, c]);
	assert.deepEqual(lookup("HAPPY"), [b, c, a]);
	assert.ok(search("thumbs_up").length > 0);
	assert.deepEqual(search("thumbs_up"), search("thumbs-up"));
	assert.ok(search("happy").some((entry) => entry.emoji === smile));
	// If normalization were repeated per query, this deliberate mutation would throw.
	Object.defineProperty(a, "keywords", {
		get() {
			throw new Error("search rebuilt its index");
		},
	});
	assert.deepEqual(lookup("super"), [a]);
});

test("explicit aliases resolve deterministically; ambiguous hints never resolve", () => {
	const resolve = createEmojiAliasResolver(corpus);
	for (const [alias, [emoji]] of Object.entries(BRIDGE_EMOJI_ALIASES)) {
		assert.equal(resolve(alias)?.emoji, emoji, alias);
		assert.equal(search(alias)[0]?.emoji, emoji, alias);
	}
	assert.equal(resolve("happy"), null);
	assert.equal(resolve("face"), null);
	const ambiguous = createEmojiAliasResolver(corpus, {
		thumbs_up: [smile],
		"thumbs-up": [toned],
		missing: ["not in corpus"],
		duplicate: [smile, smile],
	});
	assert.equal(ambiguous("thumbs_up"), null);
	assert.equal(ambiguous("missing"), null);
	assert.equal(ambiguous("duplicate")?.emoji, smile);
});

test("U2: every explicit alias names exactly one emoji in the pinned corpus", () => {
	const present = new Set(corpus.map((entry) => entry.emoji));
	for (const [alias, values] of Object.entries(BRIDGE_EMOJI_ALIASES)) {
		assert.equal(values.length, 1, alias);
		assert.ok(present.has(values[0]), `${alias} missing from corpus`);
	}
	assert.ok(Object.keys(BRIDGE_EMOJI_ALIASES).length >= 60);
});

test("U2: ranking is explicit alias, exact name, name word-prefix, then keyword", () => {
	const cp = (...points) => String.fromCodePoint(...points);
	for (const [query, expected] of [
		["fire", cp(0x1f525)],
		["rocket", cp(0x1f680)],
		["eyes", cp(0x1f440)],
		["joy", cp(0x1f602)],
	])
		assert.equal(search(query)[0]?.emoji, expected, query);
	const exactName = { emoji: "n", name: "fire", keywords: [] };
	const wordPrefix = { emoji: "w", name: "heart on fire", keywords: [] };
	const keyword = { emoji: "k", name: "flame", keywords: ["fireplace"] };
	const alias = { emoji: "a", name: "unrelated", keywords: [] };
	const lookup = createEmojiSearch([keyword, wordPrefix, exactName, alias], {
		fire: ["a"],
	});
	assert.deepEqual(
		lookup("fire").map((e) => e.emoji),
		["a", "n", "w", "k"],
	);
});

test("U1: the list opens only for 2+ characters with a letter, or an explicit alias", () => {
	const gate = createEmojiQueryGate();
	for (const query of ["", "D", "P", "o", "30", "3", "__"])
		assert.equal(gate(query), false, JSON.stringify(query));
	for (const query of ["+1", "-1", "100", "fi", "smile", "笑顔"])
		assert.equal(gate(query), true, JSON.stringify(query));
});

test("empty queries have stable defaults, all results are bounded, misses are empty", () => {
	assert.equal(search("").length, 8);
	assert.deepEqual(search(""), corpus.slice(0, 8));
	assert.equal(search("", 10000).length, 32);
	assert.equal(search("", 2.9).length, 2);
	assert.deepEqual(search("", -1), []);
	assert.deepEqual(search("", 0), []);
	assert.equal(search("", Number.NaN).length, 8);
	assert.equal(search("", Number.POSITIVE_INFINITY).length, 8);
	assert.deepEqual(search("no_such_emoji_928372"), []);
	assert.deepEqual(createEmojiSearch([])(""), []);
});

test("token starts accept punctuation, multiline, empty and non-Latin aliases", () => {
	for (const text of [
		":",
		":sm",
		"hello :sm",
		"(:sm",
		"!:sm",
		"a\n:sm",
		":+1",
		":-1",
		":笑",
		":cafe\u0301",
		":woman-technologist",
	]) {
		assert.ok(queryAt(text), text);
	}
	assert.deepEqual(queryAt("hello :sm"), { start: 6, end: 9, query: "sm" });
	const lookup = createEmojiSearch([
		{ emoji: smile, name: "笑顔", keywords: ["heureux"] },
	]);
	assert.equal(lookup("笑")[0].emoji, smile);
	assert.equal(lookup("HEUREUX")[0].emoji, smile);
});

test("times, schemes, URLs, escaped colons and nonboundaries do not trigger", () => {
	for (const text of [
		"12:30",
		"https:",
		"https://host/:sm",
		"https://host?q=:sm",
		"www.host?q=:sm",
		"word:sm",
		"::sm",
		"@:sm",
		"\\:sm",
		" :sm:",
		" :sm text",
	]) {
		assert.equal(queryAt(text), null, text);
	}
	// An even backslash count is not an escape, but still is not a token boundary.
	assert.equal(queryAt("\\\\:sm"), null);
	assert.ok(queryAt("https://host text :sm"));
});

test("code spans and fences suppress across lines and reopen after closing", () => {
	for (const text of [
		"`:sm",
		"`code\n:sm",
		"``code ` :sm",
		"```js\n:sm",
		"~~~\n:sm",
		"   ```\n:sm",
		"```\n~~~\n:sm",
		"````\n```\n:sm",
	]) {
		assert.equal(queryAt(text), null, text);
	}
	for (const text of [
		"`code` :sm",
		"``code ` `` :sm",
		"```js\ncode\n```\n:sm",
		"~~~\ncode\n~~~~\n:sm",
		"\\`plain :sm",
	]) {
		assert.ok(queryAt(text), text);
	}
});

test("only current trusted typing owns queries, never paste, restore, STT or IME", () => {
	const text = ":sm";
	assert.equal(queryAt(text, { interaction: null }), null);
	for (const kind of ["paste", "restore", "dictation"]) {
		assert.equal(queryAt(text, { interaction: { text, kind } }), null);
	}
	assert.equal(
		queryAt(text, { interaction: { text: ":s", kind: "typing" } }),
		null,
	);
	assert.equal(queryAt(text, { composing: true }), null);
	assert.equal(queryAt(text, { selectionEnd: 0 }), null);
	assert.equal(queryAt(text, { selectionStart: -1, selectionEnd: -1 }), null);
	assert.equal(queryAt(text, { selectionStart: 1.5, selectionEnd: 1.5 }), null);
	assert.equal(queryAt(text, { mentionRanges: [{ start: 0, end: 3 }] }), null);
	assert.ok(queryAt(text, { mentionRanges: [{ start: 3, end: 8 }] }));
});

test("midtext edits preserve UTF-16 suffix, tones and ZWJ exactly", () => {
	for (const emoji of [smile, toned, zwj]) {
		const prefix = `${zwj}\nhello `;
		const text = `${prefix}:sm remainder\nmore`;
		const caret = prefix.length + 3;
		const query = queryAt(text, { selectionStart: caret, selectionEnd: caret });
		assert.ok(query);
		const edit = insertEmoji(text, query, emoji);
		assert.deepEqual(edit, {
			text: `${prefix}${emoji} remainder\nmore`,
			caret: prefix.length + emoji.length,
			edit: { start: prefix.length, end: caret, insert: emoji },
		});
	}
	assert.ok(corpus.some((entry) => entry.emoji === toned));
	assert.ok(corpus.some((entry) => entry.emoji === zwj));
});

test("replacement refuses stale queries instead of corrupting the draft", () => {
	const query = queryAt(":sm");
	assert.equal(insertEmoji(":other", query, smile), null);
	assert.equal(insertEmoji(":s", query, smile), null);
	assert.equal(insertEmoji(":sm", { ...query, start: -1 }, smile), null);
	assert.equal(insertEmoji(":sm", { ...query, end: 0 }, smile), null);
	assert.equal(insertEmoji(":sm", { ...query, start: 0.5 }, smile), null);
	assert.equal(insertEmoji(":sm", { ...query, end: Number.NaN }, smile), null);
});
