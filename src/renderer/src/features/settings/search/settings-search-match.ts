/**
 * @file settings-search-match.ts
 * @description
 * What a query means to the Settings index, in what order the answers come
 * back, and — the part a reader can check — WHY each one matched.
 *
 * Pure and synchronous, no React, so the ranking is pinned in memory by
 * `scripts/settings-search-match.test.mjs` rather than through a browser. It is
 * the same split `features/command-palette/palette-search.ts` makes for the
 * palette, and for the same reason: which row an answer is, and which FIELD it
 * matched on, are the two things most likely to be silently wrong.
 *
 * ## Ranking
 *
 * Field weight first, the match's own quality second, document order last:
 *
 * | field         | weight | the row says                    |
 * | ------------- | ------ | ------------------------------- |
 * | `label`       | 1.0    | "matched the name"              |
 * | `synonym`     | 0.8    | "matched a related term"        |
 * | `key`         | 0.75   | "matched the setting key"       |
 * | `choice`      | 0.7    | "matched an option"             |
 * | `section`     | 0.6    | "matched the section"           |
 * | `description` | 0.4    | "matched the description"       |
 *
 * Label above synonym above section above description is the issue's own
 * ordering; `key` sits with the synonyms because a key is another name for the
 * same row, and `choice` sits just below because an option label is a word the
 * row CONTAINS rather than a word the row is called. A query token must match
 * at least one field of an entry for the entry to be admitted (every token, the
 * palette's AND rule), and the entry's score is the sum of its tokens' best
 * field weights damped by quality — so a whole-word label match beats a
 * substring one, and both beat a description.
 *
 * ## The reason is not a decoration
 *
 * The panel prints one line per result saying where the match came from, and
 * `reason` carries exactly the field that produced the winning score. Nothing
 * here ever falls back to "matched the name" when the name did not match: the
 * reason is a `SettingSearchField`, and the UI maps it to copy through a total
 * table, so a new field cannot render as a claim about a field that was not
 * consulted.
 */

/*
 * The folding, tokenising and lobe-scoring primitives are the COMMAND PALETTE's,
 * imported rather than copied: one spelling of "what a token matches" across the
 * app's two search surfaces. `scoreItem`/`searchPalette` are deliberately NOT
 * reused — they rank palette items by palette fields and palette tiers, and a
 * settings row is not a palette item.
 */
import {
	matchQuality,
	normalizeText,
	tokenize,
} from "../../command-palette/palette-search";
import type {
	SettingSearchEntry,
	SettingSearchField,
} from "./settings-search-index";

/** One field's contribution to an entry's score. */
const FIELD_WEIGHT: Readonly<Record<SettingSearchField, number>> = {
	label: 1,
	synonym: 0.8,
	key: 0.75,
	choice: 0.7,
	section: 0.6,
	description: 0.4,
};

/**
 * How a match's own quality damps its field weight.
 *
 * The gaps are the palette's, for the palette's reason: a term that starts a
 * word is something the reader can see, a substring is still visible, and a
 * subsequence is a guess. The field weight stays the dominant term, so a
 * subsequence in the label still outranks an exact match in the description —
 * finding the right row loosely beats finding the wrong field exactly.
 */
const QUALITY_FACTOR = {
	exact: 1,
	prefix: 0.92,
	substring: 0.7,
	subsequence: 0.45,
} as const;

/**
 * Singular/plural folding, English only.
 *
 * A settings surface is full of both numbers: the query a reader types follows
 * the word in their head ("imports", "providers", "keys"), and the row they are
 * looking for may say either — "Import conversations" one place, "Keyboard
 * shortcuts" another. Strict matching made those two spellings strangers, so a
 * plural query could answer nothing at all while its singular found the row
 * (QA round 3, Q-R3-1).
 *
 * The fold is deliberately small and symmetric: at least four letters and a
 * trailing `s`, with the `es` taken for the sibilant endings English actually
 * spells that way. It is a SPELLING rule, not a stemmer — the word still has to
 * appear, so a folded hit is still a hit in the field that literally contains
 * it (singular or plural), never a letter-scatter dressed as one.
 */
function singularWord(word: string): string {
	if (word.length < 4 || !word.endsWith("s")) return word;
	if (/(?:ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
	return word.slice(0, -1);
}

/** The same fold, applied word by word to a folded haystack. */
function singularHaystack(haystack: string): string {
	let changed = false;
	const folded = haystack
		.split(" ")
		.map((word) => {
			const next = singularWord(word);
			if (next !== word) changed = true;
			return next;
		})
		.join(" ");
	return changed ? folded : haystack;
}

/** Folded haystacks per entry, built once: a query is not the time to re-split. */
const SINGULAR_HAYSTACKS = new WeakMap<
	object,
	Partial<Record<SettingSearchField, string>>
>();

/** The palette's quality type, named here because it is not exported there. */
type WordQuality = NonNullable<ReturnType<typeof matchQuality>>;

/** The quality ladder, best first, for comparing two candidate spellings. */
const QUALITY_RANK: Readonly<Record<string, number>> = {
	exact: 3,
	prefix: 2,
	substring: 1,
};

/**
 * The best WORD-level quality for a token in a haystack, trying both numbers.
 *
 * `matchQuality` is the palette's and stays untouched; this is the settings
 * surface's spelling rule on top of it. A subsequence is never returned, for
 * the reason `scoreEntry` refuses it: the reason line names a field, so the word
 * has to be there.
 */
function bestWordQuality(
	haystack: string,
	folded: string,
	token: string,
): WordQuality | null {
	const foldedToken = singularWord(token);
	const candidates: (WordQuality | null)[] = [matchQuality(haystack, token)];
	if (foldedToken !== token)
		candidates.push(matchQuality(haystack, foldedToken));
	if (folded !== haystack) {
		candidates.push(matchQuality(folded, token));
		if (foldedToken !== token)
			candidates.push(matchQuality(folded, foldedToken));
	}
	let best: WordQuality | null = null;
	for (const quality of candidates) {
		if (!quality || quality === "subsequence") continue;
		if (!best || QUALITY_RANK[quality] > QUALITY_RANK[best]) best = quality;
	}
	return best;
}

/** One result: the entry, its score, and the field that won it. */
export type SettingSearchMatch = {
	entry: SettingSearchEntry;
	score: number;
	/** The field that produced the winning score — the reason the row is shown. */
	reason: SettingSearchField;
};

export type SettingSearchResults = {
	/** At most `cap` rows, best first. */
	results: SettingSearchResult[];
	/** How many entries matched in total, before the cap. */
	total: number;
};

/** What the panel renders: an entry plus the reason line it must print. */
export type SettingSearchResult = {
	entry: SettingSearchEntry;
	reason: SettingSearchField;
};

/** The default number of rows the panel shows (issue #1492's "~12"). */
export const SETTINGS_SEARCH_CAP = 12;

/**
 * What a query that equals a row's printed label is worth on top of its words.
 *
 * Large enough that no ordinary multi-token score can outbid it (the label tier
 * tops out at 1.0 per token, so +2 clears any query of two tokens or fewer) and
 * small enough that two equally-named rows still order by the rest of the rule.
 */
const NAMED_LABEL_BONUS = 2;

/**
 * Score one entry against the query's tokens, or null when it is not admitted.
 *
 * Exported for its own test: the panel only needs `searchSettings`, but the
 * ranking rule is worth asserting without building a list around it.
 */
export function scoreEntry(
	entry: SettingSearchEntry,
	tokens: readonly string[],
): { score: number; reason: SettingSearchField } | null {
	let total = 0;
	let best = -1;
	let reason: SettingSearchField | null = null;
	/*
	 * One folded copy of each field per entry, built the first time a query
	 * needs it and reused for every later one: the fold is a spelling rule, and
	 * the page's rows and the registry's do not change under a keystroke.
	 */
	let foldedHaystacks = SINGULAR_HAYSTACKS.get(entry.fields);
	if (!foldedHaystacks) {
		foldedHaystacks = {};
		for (const field of Object.keys(FIELD_WEIGHT) as SettingSearchField[]) {
			const haystack = entry.fields[field];
			if (haystack) foldedHaystacks[field] = singularHaystack(haystack);
		}
		SINGULAR_HAYSTACKS.set(entry.fields, foldedHaystacks);
	}
	for (const token of tokens) {
		let tokenBest = -1;
		let tokenField: SettingSearchField | null = null;
		for (const field of Object.keys(FIELD_WEIGHT) as SettingSearchField[]) {
			const haystack = entry.fields[field];
			if (!haystack) continue;
			const quality = bestWordQuality(
				haystack,
				foldedHaystacks[field] ?? singularHaystack(haystack),
				token,
			);
			if (!quality) continue;
			const value = FIELD_WEIGHT[field] * QUALITY_FACTOR[quality];
			if (value > tokenBest) {
				tokenBest = value;
				tokenField = field;
			}
		}
		// A token that matches nothing excludes the entry: an AND query ("dark
		// theme") must not return every row that matched one of its words.
		if (tokenField === null) return null;
		total += tokenBest;
		if (tokenBest > best) {
			best = tokenBest;
			reason = tokenField;
		}
	}
	return reason ? { score: total, reason } : null;
}

/**
 * Filter, rank and cap the index for one query.
 *
 * `cap` is the panel's row budget. `total` is reported before the cut so the
 * panel can say "+N more" instead of silently truncating — and the cap exists
 * because the registry is ~230 rows: rendering all of them for a one-letter
 * query is the cost this whole module is arranged to avoid.
 */
export function searchSettings(
	entries: readonly SettingSearchEntry[],
	query: string,
	cap = SETTINGS_SEARCH_CAP,
): SettingSearchResults {
	const tokens = tokenize(query);
	if (tokens.length === 0) return { results: [], total: 0 };
	/*
	 * A QUERY THAT *IS* A ROW'S NAME ANSWERS WITH THAT ROW, FIRST.
	 *
	 * "Translucent window" is not a bag of two words that happen to occur in a
	 * row — it is a row's printed name, and a reader typing a name is naming a
	 * destination rather than searching prose for those words (QA round 1, Q5).
	 * Equality is tested against the entry's LABEL, which the index keeps as the
	 * title the row prints and separate from its help text, so a row whose help
	 * spells the same words cannot take the place of the row CALLED that.
	 */
	const named = normalizeText(query);
	const scored: SettingSearchMatch[] = [];
	for (const entry of entries) {
		const hit = scoreEntry(entry, tokens);
		if (!hit) continue;
		const isNamed = entry.fields.label !== "" && entry.fields.label === named;
		scored.push({
			entry,
			reason: hit.reason,
			score: isNamed ? hit.score + NAMED_LABEL_BONUS : hit.score,
		});
	}
	scored.sort(
		(a, b) =>
			b.score - a.score ||
			/*
			 * Then the TIGHTER name: among rows whose names all contain the word,
			 * `Model` and `Default model` answer "model" better than a name that
			 * buries it in a clause (QA round 1, Q6's missing model row).
			 */
			a.entry.fields.label.length - b.entry.fields.label.length ||
			// Document order last, never the label's alphabet: equal answers read in
			// the order the page renders them, which is the order the arrows walk.
			a.entry.order - b.entry.order,
	);
	return {
		results: scored
			.slice(0, Math.max(0, cap))
			.map(({ entry, reason }) => ({ entry, reason })),
		total: scored.length,
	};
}

/**
 * Is this an empty query, as the field's state asks it?
 *
 * Settings search treats a query of only whitespace as empty — the panel shows
 * its empty state, not "no results for ' '".
 */
export function isBlankQuery(query: string): boolean {
	return normalizeText(query) === "";
}

/** One section's slice of the capped result list. */
export type SettingSearchGroup = {
	/** The section's printed label; `""` for a row with no section context. */
	sectionLabel: string;
	sectionId: string;
	results: SettingSearchResult[];
};

/**
 * Group a ranked result list into the panel's headed blocks.
 *
 * Groups appear in the order their BEST row appears — so the list still opens
 * with the row that answered the query — and each group keeps the global rank
 * inside it. The heading is the section the rows live in, which is the one
 * piece of context a jump needs anyway: a flat list of ninety labels from a
 * 3000px page tells the reader nothing about where they are going.
 *
 * A group with an empty label is the "no section context" bucket: rendered rows
 * outside any `data-search-section` still deserve to be found, and they are
 * shown LAST regardless of their score, because their absence of context means
 * the reader has no idea where the jump lands.
 */
export function groupSettingResults(
	results: readonly SettingSearchResult[],
): SettingSearchGroup[] {
	const groups = new Map<string, SettingSearchGroup>();
	for (const result of results) {
		const key = result.entry.sectionId || "";
		const group = groups.get(key);
		if (group) {
			group.results.push(result);
			continue;
		}
		groups.set(key, {
			sectionId: key,
			sectionLabel: result.entry.sectionLabel,
			results: [result],
		});
	}
	const ordered = [...groups.values()];
	const headless = ordered.filter((group) => group.sectionId === "");
	return [...ordered.filter((group) => group.sectionId !== ""), ...headless];
}
