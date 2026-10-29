import type { TeamBridgeReaction } from "../../../../shared/team-bridge-contract";
import data from "./data/emoji.json";

export type EmojiEntry = {
	emoji: string;
	name: string;
	group: number;
	keywords: string[];
};
export const EMOJI_GROUPS = data.groups;
export const EMOJI_ENTRIES: EmojiEntry[] = data.entries.map(
	([emoji, name, group, keywords]) => ({
		emoji: emoji as string,
		name: name as string,
		group: group as number,
		keywords: keywords as string[],
	}),
);
export const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "✅", "🔥"];
export type EmojiUsage = Record<string, { score: number; at: number }>;
const WHITESPACE = /\s+/;
const stripTone = (value: string) =>
	Array.from(value)
		.filter((cp) => {
			const n = cp.codePointAt(0) ?? 0;
			return !(n >= 0x1f3fb && n <= 0x1f3ff) && n !== 0xfe0f;
		})
		.join("");
const HALF_LIFE = 30 * 86400_000;
const scoreAt = (entry: { score: number; at: number }, now: number) =>
	entry.score * 2 ** (-Math.max(0, now - entry.at) / HALF_LIFE);

/** Decay by elapsed time, not browser sessions: reopening the app cannot inflate recency. */
export function recordEmojiUsage(
	usage: EmojiUsage,
	emoji: string,
	now: number,
): EmojiUsage {
	const next = {
		...usage,
		[emoji]: {
			score: (usage[emoji] ? scoreAt(usage[emoji], now) : 0) + 1,
			at: now,
		},
	};
	// Only emoji keys and aggregate usage live on disk, never message IDs, labels or bodies.
	return Object.fromEntries(
		Object.entries(next)
			.sort((a, b) => scoreAt(b[1], now) - scoreAt(a[1], now))
			.slice(0, 200),
	);
}
export function frequentEmoji(usage: EmojiUsage, now: number): string[] {
	const ranked = Object.entries(usage)
		.sort(
			(a, b) => scoreAt(b[1], now) - scoreAt(a[1], now) || b[1].at - a[1].at,
		)
		.map(([emoji]) => emoji);
	return [...new Set([...ranked, ...QUICK_EMOJI])].slice(0, 8);
}
export function searchEmoji(query: string, group: number | null): EmojiEntry[] {
	const words = query
		.toLocaleLowerCase()
		.trim()
		.split(WHITESPACE)
		.filter(Boolean);
	return EMOJI_ENTRIES.filter(
		(entry) =>
			(group === null || entry.group === group) &&
			words.every((word) =>
				`${entry.name} ${entry.keywords.join(" ")} ${entry.emoji}`
					.toLocaleLowerCase()
					.includes(word),
			),
	);
}
/** Server summaries replace this optimistic projection; a refusal restores the original snapshot. */
export function toggleReaction(
	rows: readonly TeamBridgeReaction[],
	emoji: string,
): TeamBridgeReaction[] {
	const existing = rows.find((r) => r.emoji === emoji);
	if (!existing)
		return [
			...rows,
			{ emoji, count: 1, reacted_by_me: true, sample_labels: [] },
		];
	return rows.flatMap((r) =>
		r.emoji !== emoji
			? [r]
			: r.reacted_by_me
				? r.count === 1
					? []
					: [{ ...r, count: r.count - 1, reacted_by_me: false }]
				: [{ ...r, count: r.count + 1, reacted_by_me: true }],
	);
}
const toneModifiers = (emoji: string) =>
	Array.from(emoji).filter((cp) => {
		const value = cp.codePointAt(0) ?? 0;
		return value >= 0x1f3fb && value <= 0x1f3ff;
	});
// Derive single-person bases from the pinned corpus, not a second hand-maintained Unicode list.
const PERSON_BASES = new Set(
	EMOJI_ENTRIES.flatMap(({ emoji }) => {
		const points = Array.from(emoji);
		return points.length === 2 && toneModifiers(emoji).length === 1
			? [points[0]]
			: [];
	}),
);
// Index once: applying a preference to the visible virtual window must not scan 3963 entries
// per cell, and ambiguous aliases deliberately stay unresolved rather than choosing corpus order.
const TONE_VARIANTS = new Map<string, Map<string, string[]>>();
for (const entry of EMOJI_ENTRIES) {
	const modifiers = toneModifiers(entry.emoji);
	if (modifiers.length !== 1) continue;
	const bare = stripTone(entry.emoji);
	const tones = TONE_VARIANTS.get(bare) ?? new Map<string, string[]>();
	tones.set(modifiers[0], [...(tones.get(modifiers[0]) ?? []), entry.emoji]);
	TONE_VARIANTS.set(bare, tones);
}
/** A preference may resolve a neutral single-person base, never replace an explicit identity.
 * Multi-person sequences and ambiguous/mixed-tone candidates remain exactly what was clicked. */
export function tonedEmoji(emoji: string, tone: number): string {
	if (!tone || toneModifiers(emoji).length) return emoji;
	if (
		emoji.includes("\u200d") &&
		Array.from(emoji).filter((cp) => PERSON_BASES.has(cp)).length > 1
	)
		return emoji;
	const bare = stripTone(emoji);
	const modifier = String.fromCodePoint(0x1f3fa + tone);
	const variants = TONE_VARIANTS.get(bare)?.get(modifier) ?? [];
	return variants.length === 1 ? variants[0] : emoji;
}
