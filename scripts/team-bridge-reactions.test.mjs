import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/team-bridge/team-bridge-emoji-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
test("full pinned RGI corpus, including longest mixed-tone sequence", () => {
	assert.equal(model.EMOJI_ENTRIES.length, 3963);
	assert.equal(
		Math.max(...model.EMOJI_ENTRIES.map((e) => Buffer.byteLength(e.emoji))),
		35,
	);
	assert.equal(model.searchEmoji("", null).length, 3963);
	assert.ok(
		model
			.searchEmoji("kiss", null)
			.some((e) => Buffer.byteLength(e.emoji) === 35),
	);
});
test("name and CLDR keyword search and Unicode category order", () => {
	assert.ok(model.searchEmoji("thumbs up", null).some((e) => e.emoji === "👍"));
	assert.ok(model.searchEmoji("celebration", null).length > 0);
	assert.equal(model.searchEmoji("no-such-emoji-xyz", null).length, 0);
	assert.equal(model.EMOJI_GROUPS[0], "Smileys & Emotion");
	assert.equal(model.EMOJI_GROUPS.at(-1), "Flags");
	assert.ok(model.searchEmoji("", 1).every((e) => e.group === 1));
});
test("frequency combines successful count and recency decay", () => {
	const now = Date.now();
	const day = 86400000;
	assert.deepEqual(model.frequentEmoji({}, now), model.QUICK_EMOJI);
	let usage = model.recordEmojiUsage({}, "🚀", now - 90 * day);
	usage = model.recordEmojiUsage(usage, "🌟", now);
	assert.equal(model.frequentEmoji(usage, now)[0], "🌟");
	usage = model.recordEmojiUsage(usage, "🚀", now);
	assert.equal(model.frequentEmoji(usage, now)[0], "🚀");
});
test("toggle and rollback snapshots are immutable", () => {
	const previous = [
		{
			emoji: "👍",
			count: 2,
			reacted_by_me: false,
			sample_labels: ["Ada", "Bea"],
		},
	];
	const optimistic = model.toggleReaction(previous, "👍");
	assert.equal(optimistic[0].count, 3);
	assert.equal(optimistic[0].reacted_by_me, true);
	assert.equal(previous[0].count, 2);
	assert.equal(previous[0].reacted_by_me, false);
	assert.deepEqual(model.toggleReaction(optimistic, "👍"), previous);
	assert.deepEqual(
		model.toggleReaction(
			[{ emoji: "👍", count: 1, reacted_by_me: true, sample_labels: [] }],
			"👍",
		),
		[],
	);
});
test("tone selects only a real RGI variant", () => {
	assert.equal(model.tonedEmoji("👍", 3), "👍🏽");
	assert.equal(model.tonedEmoji("🔥", 3), "🔥");
});
