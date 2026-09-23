/**
 * The MODEL picker's search rule — and only the model picker's.
 *
 * Its own module rather than an expression in `destination-pickers.tsx` because
 * it is a rule that is easy to get wrong and worth asserting on its own, which
 * is the reason `model-catalogue-listing.ts` exists beside it. `PickerHost`
 * takes it as `matcher`, so nothing else inherits it.
 *
 * WHY a rule of its own rather than the shared `filterPickerOptions`. This is
 * the one surface whose rows are a catalogue of ids the user did not write:
 * `openrouter/x-ai/grok-4.7` is published by its listing as `Grok 4.7`, and the
 * query someone types (`grok 4.7`) is neither spelling literally. Every other
 * picker's rows are things the user can see and copy — the commands picker's
 * rows are literally `/model`, `/help` — so the plain contiguous substring test
 * is right for them and wrong here. Widening the shared filter instead is what
 * broke **Search commands**: typing `/` there listed every command, and a rule
 * that reads a wordless query as no-match replaced that with `Nothing matches.`
 * (R1-3).
 *
 * WHAT the rule is. Two pools, and the SECOND is consulted only when the first
 * is empty — the backend's own `pool = ranked_strong or ranked_fuzzy` rule, not
 * a second membership test bolted on:
 *
 *   1. the CONTIGUOUS test, per field: the lowercase substring test the picker
 *      has always run over the row's own data, plus its normalised form over the
 *      strings that NAME the row. This is where the operator's spellings resolve
 *      (`grok 4.7` against the listing's own `Grok 4.7`, `gpt 6 luna` against
 *      `openai/gpt-6-luna`);
 *   2. the FALLBACK, only when pool 1 is empty: the words of a multi-word query
 *      all present in ONE naming string, order-independent — `openrouter grok`
 *      is "provider, then name", so a test that insisted the words be adjacent
 *      AND in the haystack's order answers nothing for it (R1-1 / UX U1) — and a
 *      character subsequence starting at a WORD START, for the compact and
 *      elided spellings a user actually types: `opus5`, `grok47`, `gpt6luna` and
 *      `grok 47` all resolve on the backend's `rank_rows` and answered
 *      `Nothing matches.` here (R1-1 / UX U1).
 *
 * Each half of that fallback is bounded, and both bounds are measured. A bare
 * subsequence admits almost anything — `opu` is a subsequence of `openrouter`,
 * so membership by subsequence alone listed the whole catalogue three characters
 * into a search for `opus`, hence the word-start condition on ONE side and the
 * pool rule on the other. And the word-splitting itself is confined to a query of
 * at least two words of more than one character each, because a one-character
 * "word" is a separator artefact of the normaliser rather than something a user
 * typed: `5.4` reads `5 4`, and treating those as the terms `5` AND `4` matched
 * 40 of the operator's own 650 rows — `xai/grok-4.5`, `openai/gpt-4o-2024-05-13`
 * — where the ranker and this matcher both answer 9, all of them `gpt-5.4`
 * family.
 *
 * NO FIELD IS EVER JOINED TO ANOTHER BEFORE IT IS NORMALISED, and that is a
 * correctness rule rather than tidiness (design D2, round 1 second pass, which
 * measured it as a regression against base). Normalising a joined haystack
 * fuses adjacent fields at their boundary: the Luna row's price line `… · $3/15`
 * and its context window `400k` concatenate into `3 15 400k`, in which `5 4` —
 * the normalised form of the query `5.4` — is a substring of `1[5 4]00k`. So
 * `5.4` resolved BOTH `openai/gpt-5.4` and `openrouter/openai/gpt-6-luna`, a row
 * whose text holds no `5.4` at all, where base and the merged ranker both answer
 * with `gpt-5.4` alone.
 *
 * THE NAMING STRINGS AND THE ROW'S OWN DATA ARE TREATED DIFFERENTLY, which is
 * the second half of the same correction and the reason `3 15` answers nothing.
 * The widened pools read the strings that NAME the model — `label`, the
 * selector/value, and `keywords` (listing name, provider, model id) — because
 * that is what a query is: a spelling of a model's name. `description` (provider,
 * aggregation, credential state, price pair) and `meta` (context window) stay on
 * the PRE-EXISTING contiguous test, exactly as searchable as they have always
 * been and no more. The alternative — the widened rule over every field — leaves
 * `3 15` matching every row priced `$3/15`, because that price line normalises to
 * exactly `3 15` INSIDE its own field: measured on the picker's own fixture, four
 * rows where base and the merged ranker both answer nothing. A price is data
 * about a row, not a way anyone spells a model, so a normalised query term must
 * not be able to reach it.
 *
 * MEMBERSHIP ONLY, NEVER ORDERING, as before: the caller's order is preserved
 * and no row is promoted, so the picker's tiers are untouched. The backend's
 * version-shaped numeric ordering is deliberately NOT reproduced — it was
 * reverted in local-operator #1443 and must not reappear.
 *
 * The normaliser mirrors `local_operator/model/ranking.py`'s `_match_key` byte
 * for byte (same `[^0-9a-z]+` class, same collapse-to-one-space, same trim), so
 * the two surfaces agree about what a query MEANS. `[^0-9a-z]` and not `\W` on
 * purpose: `\W` keeps the underscore a word character and the backend's class
 * does not, so `gpt_5` would normalise differently under the two.
 */

import type { PickerOption } from "./picker-host";

const MATCH_SEPARATOR = /[^0-9a-z]+/g;

/** A string's spelling as the matcher sees it: lowercase, space-separated words. */
export function modelPickerMatchKey(text: string): string {
	return text.toLowerCase().replace(MATCH_SEPARATOR, " ").trim();
}

/**
 * Whether `needle`'s characters appear in `key` in order from `from`, gaps allowed.
 */
function isSubsequenceFrom(needle: string, key: string, from: number): boolean {
	let index = from + 1;
	for (let position = 1; position < needle.length; position += 1) {
		const found = key.indexOf(needle[position], index);
		if (found < 0) return false;
		index = found + 1;
	}
	return true;
}

/**
 * Whether `needle` reads as an elision of `key` — its characters in order, gaps
 * allowed — PROVIDED the first one starts a word.
 *
 * The counterpart of `ranking.py`'s `_score` with the density scoring dropped:
 * membership is the half a filter needs and scoring is the half only a ranker
 * can use. The word-start condition is what stands in for the missing scorer,
 * and it is not optional here. A bare subsequence admits a match that begins
 * INSIDE a word: `opus5`'s `o` is in `anthropic`, so `opus5` resolved
 * `anthropic/claude-sonnet-5` as well as the Opus rows — harmless for a ranker,
 * which would have sorted the Opus rows first and shown a screenful, and not
 * harmless for a filter, which shows all three with no order to explain them. A
 * user's elision elides the WORDS they can see (`grok47` from `grok 4 7`,
 * `opus5` from `opus 5`), and every one of those begins at a word.
 */
function isElision(needle: string, key: string): boolean {
	const head = needle[0];
	for (
		let start = key.indexOf(head);
		start !== -1;
		start = key.indexOf(head, start + 1)
	) {
		if (start !== 0 && key[start - 1] !== " ") continue;
		if (isSubsequenceFrom(needle, key, start)) return true;
	}
	return false;
}

/** One row's searchable strings, in both spellings the passes need. */
type OptionIndex = {
	/** Every string the pre-PR contiguous test read, lowercased, one per field. */
	lowered: string[];
	/**
	 * The strings that NAME the row — `label`, the selector, and `keywords` —
	 * normalised. The widened pools read these and nothing else: a description's
	 * price line and a meta's context window are data ABOUT a row, and the
	 * normalised form of `$3/15` is `3 15` inside its own field, so reading them
	 * here is how `3 15` came to match four rows the ranker answers nothing for.
	 */
	named: string[];
};

/**
 * Each option's strings, indexed once and kept for the life of that object.
 *
 * The filter re-runs on every keystroke while the option list is rebuilt only
 * when the catalogue or the session's model changes, so the same option objects
 * come back keystroke after keystroke — and normalising every row's strings each
 * time measured 12.5 ms against 4.9 ms on an 1800-row catalogue (R1-5), the same
 * cost the backend removed by memoising `_match_key`. A `WeakMap` is the whole
 * of it: keyed by the option itself, so a rebuilt list drops its stale rows with
 * no bookkeeping, and a shared row costs one normalisation however many
 * keystrokes read it.
 */
const INDEX = new WeakMap<PickerOption, OptionIndex>();

/** A string that carries no characters the matcher can read is not a target. */
const hasText = (text: string) => text.trim() !== "";

function indexOf(option: PickerOption): OptionIndex {
	const cached = INDEX.get(option);
	if (cached) return cached;
	const naming = [option.label, option.value].concat(option.keywords ?? []);
	const data = [option.description ?? "", option.meta ?? ""];
	const index: OptionIndex = {
		lowered: naming
			.concat(data)
			.filter(hasText)
			.map((field) => field.toLowerCase()),
		named: naming
			.filter(hasText)
			.map(modelPickerMatchKey)
			.filter((key) => key !== ""),
	};
	INDEX.set(option, index);
	return index;
}

/**
 * The rows a query matches, in the order they came in.
 *
 * TWO EMPTY-ISH CASES, and they are not the same — the backend draws the same
 * line. A query the user has not typed into at all (blank, or whitespace) lists
 * everything; a query that is non-empty but NORMALISES to empty (`.`, `!`,
 * `...`, `-`) carries no words and returns NOTHING rather than falling into the
 * list-everything branch. Folding the two together replaces the list with the
 * whole catalogue on one punctuation keystroke — the backend measured `'.'`
 * taking 257 to 574 rows — which reads as the search box doing the opposite of
 * what was asked. This is the one place the rule narrows rather than widens
 * against the old behaviour, and the old behaviour there was the defect.
 */
export function matchModelPickerOptions(
	options: PickerOption[],
	query: string,
): PickerOption[] {
	const typed = query.trim();
	if (!typed) return options;
	const needle = modelPickerMatchKey(query);
	if (!needle) return [];
	const literal = typed.toLowerCase();
	/*
	 * The order-independent term pass runs for a query of at least TWO words of
	 * more than one character each, and nowhere else. A one-character "word" is
	 * a separator artefact of the normaliser rather than something a user typed:
	 * `5.4` reads `5 4`, and treating that as the terms `5` AND `4` matched every
	 * row whose name holds both digits — measured over the operator's own 650-row
	 * catalogue, 40 rows, including `xai/grok-4.5` and `openai/gpt-4o-2024-05-13`.
	 * That is the D2 class of defect (a query reaching a row it does not name)
	 * arriving by a different door, so the split is confined to the case it was
	 * written for: a multi-word query whose words the user typed — `openrouter
	 * grok`, "provider, then name".
	 */
	const words = needle.split(" ").filter(Boolean);
	const splittable = words.length > 1 && words.every((word) => word.length > 1);
	/*
	 * Two pools, evaluated in order and the second only if the first is empty:
	 * the exact/substring pool REPLACES the fuzzy one, which is the backend's
	 * rule and the reason a three-character query cannot list the whole
	 * catalogue (see the header). Every row in the fuzzy pool is a row no
	 * substring test could answer, so nothing the first pool holds is reached
	 * only through it.
	 */
	/*
	 * Pool 1: the CONTIGUOUS test, per field, the way the backend builds its
	 * "strong" pool. `lowered` carries every string the pre-PR rule read, so
	 * nothing that matched before is dropped by the field split; `named` carries
	 * the naming strings normalised, which is where the operator's spellings
	 * resolve.
	 */
	const exact = options.filter((option) => {
		const { lowered, named } = indexOf(option);
		return (
			lowered.some((field) => field.includes(literal)) ||
			named.some((key) => key.includes(needle))
		);
	});
	if (exact.length > 0) return exact;
	/*
	 * Pool 2: everything looser, consulted ONLY when pool 1 is empty — the
	 * backend's `pool = ranked_strong or ranked_fuzzy`. Keeping the fallback a
	 * fallback is what stops it widening an answer that already has exact hits:
	 * `opu` is a subsequence of `openrouter`, so an unconditional subsequence
	 * pool listed the whole catalogue three characters into a search for `opus`,
	 * and the multi-word pass over a query like `mistral small` added six rows
	 * the ranker does not return once its own substring pool has hits.
	 */
	return options.filter((option) =>
		indexOf(option).named.some(
			(key) =>
				(splittable && words.every((word) => key.includes(word))) ||
				isElision(needle, key),
		),
	);
}
