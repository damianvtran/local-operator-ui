export type EmojiCandidate = {
	emoji: string;
	name: string;
	keywords: readonly string[];
};

/** Shortcode separators are equivalent, but Unicode sequences stay byte-exact. */
export function normalizeEmojiAlias(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[_\s]+|(?<=[\p{L}\p{N}])-+/gu, " ")
		.trim();
}

/**
 * The CLDR names/keywords are search hints, not a shortcode registry. Keep the
 * small compatibility vocabulary explicit; never infer a canonical alias from
 * the first matching corpus row. Unknown aliases remain ordinary search text.
 */
export const BRIDGE_EMOJI_ALIASES: Readonly<Record<string, readonly string[]>> = {
	"+1": ["\u{1f44d}"],
	thumbsup: ["\u{1f44d}"],
	thumbs_up: ["\u{1f44d}"],
	"-1": ["\u{1f44e}"],
	thumbsdown: ["\u{1f44e}"],
	thumbs_down: ["\u{1f44e}"],
	tada: ["\u{1f389}"],
	heart: ["\u2764\ufe0f"],
	smile: ["\u{1f604}"],
	woman_technologist: ["\u{1f469}\u200d\u{1f4bb}"],
};

/** Only explicit, unique aliases resolve; ambiguous labels never auto-select. */
export function createEmojiAliasResolver(
	entries: readonly EmojiCandidate[],
	registry: Readonly<Record<string, readonly string[]>> = BRIDGE_EMOJI_ALIASES,
) {
	const available = new Map(entries.map((entry) => [entry.emoji, entry]));
	const aliases = new Map<string, Set<string>>();
	for (const [alias, values] of Object.entries(registry)) {
		const key = normalizeEmojiAlias(alias);
		const targets = aliases.get(key) ?? new Set<string>();
		for (const value of values) targets.add(value);
		aliases.set(key, targets);
	}
	return (query: string): EmojiCandidate | null => {
		const targets = aliases.get(normalizeEmojiAlias(query));
		if (!targets || targets.size !== 1) return null;
		return available.get([...targets][0]) ?? null;
	};
}

const MAX_RESULTS = 32;
const DEFAULT_RESULTS = 8;

/** Build once per corpus/locale, never rebuild thousands of labels per keystroke. */
export function createEmojiSearch(
	entries: readonly EmojiCandidate[],
	registry: Readonly<Record<string, readonly string[]>> = BRIDGE_EMOJI_ALIASES,
) {
	const explicit = new Map<string, string[]>();
	for (const [alias, values] of Object.entries(registry)) {
		for (const value of values) {
			const names = explicit.get(value) ?? [];
			names.push(alias);
			explicit.set(value, names);
		}
	}
	const indexed = entries.map((entry) => ({
		entry,
		explicitAliases: (explicit.get(entry.emoji) ?? []).map(normalizeEmojiAlias),
		aliases: [entry.name, ...entry.keywords, ...(explicit.get(entry.emoji) ?? [])]
			.map(normalizeEmojiAlias),
	}));
	return (query: string, limit = DEFAULT_RESULTS): EmojiCandidate[] => {
		const cap = Number.isFinite(limit)
			? Math.max(0, Math.min(MAX_RESULTS, Math.floor(limit)))
			: DEFAULT_RESULTS;
		if (cap === 0) return [];
		const normalized = normalizeEmojiAlias(query);
		if (!normalized) return indexed.slice(0, cap).map(({ entry }) => entry);
		const words = normalized.split(" ").filter(Boolean);
		// Preserve corpus order within each tier, so arrow navigation is stable.
		const tiers: EmojiCandidate[][] = [[], [], [], []];
		for (const { entry, aliases, explicitAliases } of indexed) {
			if (!words.every((word) => aliases.some((alias) => alias.includes(word))))
				continue;
			const tier = explicitAliases.includes(normalized)
				? 0
				: aliases.includes(normalized)
					? 1
					: aliases.some((alias) => alias.startsWith(normalized))
						? 2
						: 3;
			if (tiers[tier].length < cap) tiers[tier].push(entry);
			if (tiers[0].length === cap) break;
		}
		return tiers.flat().slice(0, cap);
	};
}

export type EmojiQuery = { start: number; end: number; query: string };
type Range = { start: number; end: number };
export type EmojiQueryInput = {
	text: string;
	selectionStart: number;
	selectionEnd: number;
	/** Only a trusted typing event may arm a query; value changes alone cannot. */
	interaction: {
		text: string;
		kind: "typing" | "paste" | "restore" | "dictation";
	} | null;
	composing?: boolean;
	mentionRanges?: readonly Range[];
};

function escaped(text: string, at: number): boolean {
	let slashes = 0;
	while (at > 0 && text[--at] === "\\") slashes++;
	return slashes % 2 === 1;
}

/** Scan the prefix, not just the current line: Markdown spans can cross newlines. */
function inCode(prefix: string): boolean {
	let fence: { marker: string; length: number } | null = null;
	let ticks = 0;
	for (const line of prefix.split("\n")) {
		const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
		if (fence) {
			if (
				delimiter &&
				delimiter[1][0] === fence.marker &&
				delimiter[1].length >= fence.length &&
				delimiter[2].trim() === ""
			)
				fence = null;
			continue;
		}
		if (!ticks && delimiter) {
			fence = { marker: delimiter[1][0], length: delimiter[1].length };
			continue;
		}
		for (let i = 0; i < line.length; i++) {
			if (line[i] !== "`" || (!ticks && escaped(line, i))) continue;
			let end = i + 1;
			while (line[end] === "`") end++;
			const length = end - i;
			if (!ticks) ticks = length;
			else if (ticks === length) ticks = 0;
			i = end - 1;
		}
	}
	return fence !== null || ticks !== 0;
}

/** Offsets deliberately use UTF-16, matching textarea selections and mention sidecars. */
export function findEmojiQuery(input: EmojiQueryInput): EmojiQuery | null {
	const { text, selectionStart: caret, selectionEnd, interaction } = input;
	if (
		input.composing ||
		!interaction ||
		interaction.kind !== "typing" ||
		interaction.text !== text ||
		caret !== selectionEnd ||
		!Number.isInteger(caret) ||
		caret < 0 ||
		caret > text.length
	)
		return null;
	const prefix = text.slice(0, caret);
	const match = /:([\p{L}\p{M}\p{N}_+\-]*)$/u.exec(prefix);
	if (!match) return null;
	const start = caret - match[0].length;
	const previous = text.slice(0, start).match(/.$/u)?.[0];
	if (
		(previous &&
			(!/[\s\p{P}\p{S}]/u.test(previous) || /[:/@\\`]/u.test(previous))) ||
		escaped(text, start) ||
		inCode(prefix) ||
		// A punctuation boundary within a URL is not a shortcode boundary.
		/(?:\w+:\/\/|www\.)\S*$/iu.test(text.slice(0, start)) ||
		input.mentionRanges?.some((range) => start < range.end && caret > range.start)
	)
		return null;
	return { start, end: caret, query: match[1] };
}

/** The hook must route this edit through the mention owner's existing history path. */
export function insertEmoji(
	text: string,
	query: EmojiQuery,
	emoji: string,
): { text: string; caret: number; edit: Range & { insert: string } } | null {
	// Refuse stale selections rather than replacing unrelated text after an async render.
	if (
		!Number.isInteger(query.start) ||
		!Number.isInteger(query.end) ||
		query.start < 0 ||
		query.end > text.length ||
		query.end <= query.start ||
		text.slice(query.start, query.end) !== `:${query.query}`
	)
		return null;
	return {
		text: text.slice(0, query.start) + emoji + text.slice(query.end),
		caret: query.start + emoji.length,
		edit: { start: query.start, end: query.end, insert: emoji },
	};
}
