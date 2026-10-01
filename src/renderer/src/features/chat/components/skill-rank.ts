/**
 * `$skill` ranking for the composer.
 *
 * The desktop port of `local_operator/tui/widgets/command_picker.py`'s
 * `skill_suggestions` — including its two arms — and of the
 * `argument_suggestions` floor its LEADING arm defers to, so the two hosts can
 * be diffed by name. `matchChoices` is the shared scorer beneath both, which is
 * what keeps a skill row's order the one the user already learned from every
 * other list.
 *
 * WHY THE TWO ARMS DIFFER, in the TUI's own terms (its docstring is the
 * contract; this file keeps the rule and cites the reasoning):
 *
 * At the START of the buffer a `$` is unambiguous — the user typed a sigil
 * first and nothing else can be meant — so the full case-insensitive fuzzy
 * matcher runs there, and a bare `$` opens the whole catalogue to browse.
 * INLINE, the sigil's position tells you nothing and money or a shell variable
 * is the overwhelmingly more likely reading, so matching requires POSITIVE
 * EVIDENCE the user meant a skill. Two conditions carry that evidence:
 *
 *   1. The query contains a LOWERCASE LETTER. Skill names are lowercase by
 *      convention; shell and environment variables are uppercase by an equally
 *      strong one (`$PATH`, `$HOME`, `$DEBUG`, `$LANG`).
 *   2. The query is a CASE-SENSITIVE PREFIX of the name.
 *
 * Together they close the four ways a non-invocation used to reach a row
 * inline, each found in a review round of the TUI's own change: a SUBSEQUENCE
 * score (`$LANG` reaching `planning`), a CASE-FOLDED prefix (`echo $DEBUG`
 * reaching `debug`), an UPPERCASE-NAMED skill voiding the fold rule, and
 * CASELESS tokens — an empty query and digit/underscore tokens — which no case
 * rule can help with but condition 1 removes because they carry no lowercase
 * letter at all. The empty query matters because the user passes through it on
 * every keystroke of a legitimate inline `$research`: the list simply arrives
 * one keystroke later inline than it does leading.
 *
 * The WIDER accepted class is stated at its true width rather than implied
 * away: ANY lowercase-containing token that is a case-sensitive PREFIX of ANY
 * skill name matches inline — `$path` reaches `pathfinder`, `$lang` reaches
 * `language-tutor`, and lowercase environment variables like `$http_proxy` are
 * genuinely in this class. Accepted because closing it would need a rule that
 * outranks the user's own vocabulary, the same trade
 * `local_operator/skills/invoke.py` documents as "do not name a skill after an
 * environment variable".
 *
 * `startsWith` rather than a folding comparison is deliberate and
 * load-bearing for Unicode safety: it does no case folding at all, so no
 * FOLDING match can arise — the Turkish dotless-i and the `ß`/`SS` expansions
 * never open a row a byte-comparison would not. Do not "improve" it into a
 * folding comparison.
 */

import { FUZZY_MIN_QUERY_CHARS, matchChoices } from "./slash-rank";

/**
 * A query carries the inline evidence iff it contains a lowercase letter.
 *
 * `\p{Ll}` rather than `toLowerCase() === char`: the TUI's test is Python's
 * `char.islower()`, whose class is Unicode's lowercase letters, and the two
 * spellings agree on every case either host has measured (`$ß` is evidence and
 * reaches a `ßeta` skill; `$İ` is not, because it is uppercase).
 */
const LOWERCASE_LETTER = /\p{Ll}/u;

export function hasLowercaseEvidence(query: string): boolean {
	for (const char of query) {
		if (LOWERCASE_LETTER.test(char)) return true;
	}
	return false;
}

/**
 * `$skill` rows for `query`: the full matcher when the token LEADS, the
 * evidence-gated prefix filter when it is INLINE.
 *
 * Returns `(name, choice)` pairs in the shared scorer's order. `leading` is the
 * caller's answer to `skillTokenIsLeading` — passed in rather than recomputed
 * because the two callers that need it (this gate and the accept gesture that
 * reassembles the buffer) must read the same one, and a second derivation is
 * how a rule and its gesture come to disagree.
 */
export function skillSuggestions<
	C extends { name: string; aliases?: readonly string[] },
>(
	query: string,
	choices: readonly C[],
	leading: boolean,
): { name: string; choice: C }[] {
	if (leading) {
		/*
		 * `argument_suggestions`: an empty query asks for the whole set ("I typed
		 * `$` and stopped" is a request to browse), and below the fuzzy floor the
		 * scorer's survivors are narrowed to PREFIX matches when there are any —
		 * a PREFERENCE, not a filter, so the natural abbreviations the fuzzy
		 * matcher exists for still answer.
		 */
		if (!query) return choices.map((choice) => ({ name: choice.name, choice }));
		const matches = matchChoices(query, choices);
		if (query.length >= FUZZY_MIN_QUERY_CHARS) return matches;
		const lowered = query.toLowerCase();
		const prefixed = matches.filter((pair) =>
			pair.name.toLowerCase().startsWith(lowered),
		);
		return prefixed.length > 0 ? prefixed : matches;
	}
	// Condition 1, and the reason it is tested on the query rather than the
	// name: an empty query and a caseless one (`$5`, `$_private`) both fail it,
	// which is what makes the money guard and the bare-`$` guard one clause.
	if (!hasLowercaseEvidence(query)) return [];
	/*
	 * Condition 2. Ranked by the shared scorer, then FILTERED — not a separate
	 * prefix scorer — so row ORDER stays the one every other list taught. The
	 * filter reads the choice's NAME, never an alias that could have matched:
	 * fail-CLOSED, the safe direction for a gate whose whole job is to not open
	 * on a non-name.
	 */
	return matchChoices(query, choices).filter((pair) =>
		pair.name.startsWith(query),
	);
}
