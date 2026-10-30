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

import type {
	SettingSearchEntry,
	SettingSearchField,
} from "./settings-search-index";
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
	for (const token of tokens) {
		let tokenBest = -1;
		let tokenField: SettingSearchField | null = null;
		for (const field of Object.keys(FIELD_WEIGHT) as SettingSearchField[]) {
			const haystack = entry.fields[field];
			if (!haystack) continue;
			const quality = matchQuality(haystack, token);
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
	const scored: SettingSearchMatch[] = [];
	for (const entry of entries) {
		const hit = scoreEntry(entry, tokens);
		if (hit) scored.push({ entry, ...hit });
	}
	scored.sort(
		(a, b) =>
			b.score - a.score ||
			// Document order is the tie-break, never the label's alphabet: two rows
			// with the same score should read in the order the page renders them,
			// which is the order the reader will jump through with the arrows.
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
	return [
		...ordered.filter((group) => group.sectionId !== ""),
		...headless,
	];
}
