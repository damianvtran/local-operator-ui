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
export const BRIDGE_EMOJI_ALIASES: Readonly<Record<string, readonly string[]>> =
	{
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
		// Common Slack/GitHub shortcodes. Each value is checked against the pinned
		// corpus by the model test, so a regenerated corpus cannot silently orphan one.
		fire: ["\u{1f525}"],
		rocket: ["\u{1f680}"],
		eyes: ["\u{1f440}"],
		joy: ["\u{1f602}"],
		grin: ["\u{1f601}"],
		laughing: ["\u{1f606}"],
		wink: ["\u{1f609}"],
		pray: ["\u{1f64f}"],
		clap: ["\u{1f44f}"],
		wave: ["\u{1f44b}"],
		ok_hand: ["\u{1f44c}"],
		sparkles: ["\u2728"],
		white_check_mark: ["\u2705"],
		x: ["\u274c"],
		warning: ["\u26a0\ufe0f"],
		thinking_face: ["\u{1f914}"],
		sob: ["\u{1f62d}"],
		cry: ["\u{1f622}"],
		shrug: ["\u{1f937}"],
		facepalm: ["\u{1f926}"],
		raised_hands: ["\u{1f64c}"],
		muscle: ["\u{1f4aa}"],
		star: ["\u2b50"],
		sunglasses: ["\u{1f60e}"],
		heart_eyes: ["\u{1f60d}"],
		rofl: ["\u{1f923}"],
		slightly_smiling_face: ["\u{1f642}"],
		upside_down_face: ["\u{1f643}"],
		see_no_evil: ["\u{1f648}"],
		point_up: ["\u261d\ufe0f"],
		point_right: ["\u{1f449}"],
		bulb: ["\u{1f4a1}"],
		memo: ["\u{1f4dd}"],
		bug: ["\u{1f41b}"],
		zap: ["\u26a1"],
		boom: ["\u{1f4a5}"],
		coffee: ["\u2615"],
		beer: ["\u{1f37a}"],
		pizza: ["\u{1f355}"],
		cake: ["\u{1f370}"],
		gift: ["\u{1f381}"],
		calendar: ["\u{1f4c6}"],
		lock: ["\u{1f512}"],
		key: ["\u{1f511}"],
		link: ["\u{1f517}"],
		chart_with_upwards_trend: ["\u{1f4c8}"],
		rotating_light: ["\u{1f6a8}"],
		construction: ["\u{1f6a7}"],
		hourglass: ["\u231b"],
		alarm_clock: ["\u23f0"],
		bell: ["\u{1f514}"],
		speech_balloon: ["\u{1f4ac}"],
		"100": ["\u{1f4af}"],
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

const HAS_LETTER = /\p{L}/u;

/**
 * Whether a typed `:query` may OPEN the list and so take Enter/Tab/arrows.
 * Operator rule: no automatic destructive replacement of prose. Emoticons and
 * colon-terminated prose (`:D`, `:P`, `:o`, `list :`, `10 :30`) must leave Enter
 * as a plain send, so the list waits for two characters including a letter.
 * Explicit aliases are the deliberate exception: `:+1` / `:-1` have no letter
 * yet are unambiguous shortcodes.
 */
export function createEmojiQueryGate(
	registry: Readonly<Record<string, readonly string[]>> = BRIDGE_EMOJI_ALIASES,
) {
	const explicit = new Set(Object.keys(registry).map(normalizeEmojiAlias));
	return (query: string): boolean => {
		if (explicit.has(normalizeEmojiAlias(query))) return true;
		return Array.from(query).length >= 2 && HAS_LETTER.test(query);
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
		name: normalizeEmojiAlias(entry.name),
		nameWords: normalizeEmojiAlias(entry.name).split(" "),
		aliases: [
			entry.name,
			...entry.keywords,
			...(explicit.get(entry.emoji) ?? []),
		].map(normalizeEmojiAlias),
	}));
	return (query: string, limit = DEFAULT_RESULTS): EmojiCandidate[] => {
		const cap = Number.isFinite(limit)
			? Math.max(0, Math.min(MAX_RESULTS, Math.floor(limit)))
			: DEFAULT_RESULTS;
		if (cap === 0) return [];
		const normalized = normalizeEmojiAlias(query);
		if (!normalized) return indexed.slice(0, cap).map(({ entry }) => entry);
		const words = normalized.split(" ").filter(Boolean);
		/*
		 * Enter commits row 0, so the tiers encode what a shortcode MEANS before
		 * how loosely it matched: an explicit alias, then the exact CLDR name, then
		 * a name word-prefix, then explicit-alias prefixes, then any keyword hit.
		 * `:fire` must reach 🔥 before "heart on fire", whose name merely contains
		 * the word. Corpus order is preserved within each tier for stable arrows.
		 */
		const tiers: EmojiCandidate[][] = [[], [], [], [], []];
		for (const {
			entry,
			aliases,
			explicitAliases,
			name,
			nameWords,
		} of indexed) {
			if (!words.every((word) => aliases.some((alias) => alias.includes(word))))
				continue;
			const tier = explicitAliases.includes(normalized)
				? 0
				: name === normalized
					? 1
					: words.every((word) => nameWords.some((w) => w.startsWith(word)))
						? 2
						: explicitAliases.some((alias) => alias.startsWith(normalized))
							? 3
							: 4;
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

const FENCE_DELIMITER = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const COLON_QUERY = /:([\p{L}\p{M}\p{N}_+\-]*)$/u;
const LAST_CHARACTER = /.$/u;
const TOKEN_BOUNDARY = /[\s\p{P}\p{S}]/u;
const EXCLUDED_BOUNDARY = /[:/@\\`]/u;
const URL_PREFIX = /(?:\w+:\/\/|www\.)\S*$/iu;

function escaped(text: string, at: number): boolean {
	let slashes = 0;
	let cursor = at;
	while (cursor > 0 && text[--cursor] === "\\") slashes++;
	return slashes % 2 === 1;
}

/** Scan the prefix, not just the current line: Markdown spans can cross newlines. */
function inCode(prefix: string): boolean {
	let fence: { marker: string; length: number } | null = null;
	let ticks = 0;
	for (const line of prefix.split("\n")) {
		const delimiter = FENCE_DELIMITER.exec(line);
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
	const match = COLON_QUERY.exec(prefix);
	if (!match) return null;
	const start = caret - match[0].length;
	const previous = text.slice(0, start).match(LAST_CHARACTER)?.[0];
	if (
		(previous &&
			(!TOKEN_BOUNDARY.test(previous) || EXCLUDED_BOUNDARY.test(previous))) ||
		escaped(text, start) ||
		inCode(prefix) ||
		// A punctuation boundary within a URL is not a shortcode boundary.
		URL_PREFIX.test(text.slice(0, start)) ||
		input.mentionRanges?.some(
			(range) => start < range.end && caret > range.start,
		)
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
