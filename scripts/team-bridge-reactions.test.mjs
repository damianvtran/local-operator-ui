import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const modifier = /(?:\u{1f3fb}|\u{1f3fc}|\u{1f3fd}|\u{1f3fe}|\u{1f3ff})/u;
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/team-bridge/team-bridge-emoji-model"; export * from "./src/shared/team-bridge-contract"; export * from "./src/renderer/src/features/team-bridge/team-bridge-emoji-support";',
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

test("preference preserves every explicitly toned corpus entry for every preference", () => {
	for (const { emoji } of model.EMOJI_ENTRIES) {
		for (let tone = 1; tone <= 5; tone++) {
			const result = model.tonedEmoji(emoji, tone);
			if (modifier.test(emoji)) assert.equal(result, emoji, emoji);
			if (result !== emoji) {
				assert.equal(
					Array.from(result).filter((cp) => modifier.test(cp)).length,
					1,
				);
				assert.ok(result.includes(String.fromCodePoint(0x1f3fa + tone)));
			}
		}
	}
	assert.equal(model.tonedEmoji("🧑‍🤝‍🧑", 3), "🧑‍🤝‍🧑");
	assert.equal(model.tonedEmoji("🧑🏻‍🤝‍🧑🏿", 3), "🧑🏻‍🤝‍🧑🏿");
});

test("future optional reaction overflow trims metadata, not the history page", () => {
	const rows = Array.from({ length: 51 }, () => ({
		emoji: "👍",
		count: 1,
		reacted_by_me: false,
		sample_labels: ["a", "b", "c", "d"],
	}));
	const page = model.teamBridgeMessagePageSchema.parse({
		messages: [
			{
				id: "bcmsg_1",
				conversation_id: "bcv_1",
				seq: 1,
				sender: { account_id: "acct_1", kind: "human", display_label: "Ada" },
				body: "readable",
				origin: "human",
				created_at: "2026-10-21",
				reactions: rows,
			},
		],
	});
	assert.equal(page.messages[0].body, "readable");
	assert.equal(page.messages[0].reactions.length, 50);
	assert.equal(page.messages[0].reactions[0].sample_labels.length, 3);
	assert.equal(
		model.teamBridgeReactionsSchema.safeParse({
			message_id: "bcmsg_1",
			reactions: rows,
		}).success,
		false,
	);
});

test("glyph probe rejects fill-dependent tofu, blank pixels and unjoined sequences", () => {
	const color = new Uint8ClampedArray([240, 120, 30, 255]);
	assert.equal(model.isSingleColorGlyph(color, color, 28), true);
	assert.equal(
		model.isSingleColorGlyph(
			new Uint8ClampedArray([255, 255, 255, 255]),
			new Uint8ClampedArray([0, 0, 0, 255]),
			28,
		),
		false,
	);
	assert.equal(
		model.isSingleColorGlyph(
			new Uint8ClampedArray(4),
			new Uint8ClampedArray(4),
			28,
		),
		false,
	);
	assert.equal(model.isSingleColorGlyph(color, color, 56), false);
});
