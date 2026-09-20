/**
 * Ranking for the composer's slash lists.
 *
 * A literal port of `local_operator/tui/autocomplete.py:205-308`
 * (`score_command_text_match`, `_subsequence_score`, `match_commands`,
 * `match_choices`), plus `Editor._picker_choice_is_unambiguous`
 * (`editor.py:7731-7765`). Pure and I/O-free.
 *
 * WHY a scorer rather than the old `startsWith` filter. The composer filtered
 * with `command.name.startsWith(needle) || aliases.some(startsWith)`, so `/lgt`
 * found nothing where the TUI finds `logout`; a user who learned the TUI's
 * fuzzy habit silently loses their command. The bands are the whole behaviour,
 * so they are constants rather than magic numbers:
 *
 *   - exact 1000, prefix 900 (FLAT, so registry order breaks ties and the list
 *     does not reshuffle under a longer typed prefix), fuzzy subsequence 1..40,
 *     no match 0.
 *   - An EMPTY prefix scores 0: "nothing typed" is not a match. The bare-`/`
 *     menu is the picker's call (`matchChoices`), never the matcher's.
 *
 * THE ORDERING CONTRACT, stated once so the popup and the completion cannot
 * disagree:
 *
 *   1. Every candidate is scored on its BEST name (`name` first, then aliases in
 *      declared order — the alias order IS the tie-break order).
 *   2. Candidates sort by `(-score, registryIndex)`.
 *   3. Zero-score candidates are dropped (`matchCommands`), or every choice is
 *      kept in the given order when the query is empty (`matchChoices`).
 *   4. The highlighted row is the row that gets applied, BY CONSTRUCTION: the
 *      popup renders `matchCommands(...)` output verbatim and Enter/Tab apply
 *      `matches[active].name`. There is deliberately no second "the" match
 *      anywhere, which is why the display name is the NAME OR ALIAS THAT
 *      MATCHED rather than the primary name: a row labelled `/models` that
 *      writes `/model` is a row whose highlight does not describe what Enter
 *      does. Aliases are themselves runnable commands
 *      (`slash_commands.py:slash_command_for` resolves through `names`), so
 *      nothing becomes unrunnable. This IS a visible change from the old
 *      primary-name label and is flagged for the design round.
 */

import { SEPARATOR_RUN, pyTrim } from "./slash-token";

export const SCORE_EXACT = 1000;
export const SCORE_PREFIX = 900;
export const SCORE_FUZZY_MAX = 40;

/**
 * Below this many typed characters the fuzzy tail is suppressed, keeping only
 * the prefix matches (when any exist).
 *
 * A port of `command_picker.py:997` (`FUZZY_MIN_QUERY_CHARS = 3`), and the WHY
 * is measured there rather than cosmetic: a one- or two-letter query matched an
 * arbitrary-looking set by subsequence — `/m` offered `move, model, mcp, mobile`
 * in the TUI and additionally `resume, rename, theme, compact` here. The correct
 * command ranked first every time, but rows 2+ taught the user that the list is
 * unreliable, and the extra rows also changed Enter's meaning: with more than
 * one survivor the single-survivor arm of the ambiguity gate stops firing, so a
 * command that runs on one Enter in the TUI needed two in the composer (round 1
 * R3). Typo tolerance lives at three characters and up, so nothing the feature
 * exists for is affected.
 */
export const FUZZY_MIN_QUERY_CHARS = 3;

/**
 * Score `prefix` as an in-order subsequence of `target`, 1..40 or 0.
 * Consecutive matched characters and early matches push the score toward 40.
 */
function subsequenceScore(prefix: string, target: string): number {
	let score = 0;
	let prevIndex = -2;
	let targetIndex = 0;
	for (const char of prefix) {
		const found = target.indexOf(char, targetIndex);
		if (found < 0) return 0;
		score += found === prevIndex + 1 ? 2 : 1;
		prevIndex = found;
		targetIndex = found + 1;
	}
	if (score <= 0) return 0;
	return Math.max(1, Math.min(SCORE_FUZZY_MAX, score));
}

/**
 * Case-insensitive: exact 1000 > prefix 900 (flat) > fuzzy subsequence 1..40 >
 * no match 0. An EMPTY prefix scores 0.
 */
export function scoreCommandTextMatch(prefix: string, target: string): number {
	const lowerPrefix = prefix.toLowerCase();
	const lowerTarget = target.toLowerCase();
	if (!lowerPrefix) return 0;
	if (lowerPrefix === lowerTarget) return SCORE_EXACT;
	if (lowerTarget.startsWith(lowerPrefix)) return SCORE_PREFIX;
	return subsequenceScore(lowerPrefix, lowerTarget);
}

/*
 * THE RUN IS `./slash-token`'S, not a regex of its own: this file takes the LAST
 * separator-cut token of a whole-buffer string, which is the same question the
 * planner and the tokenizer ask, and a second class here ranked the popup's rows
 * against a word the composer would never run (round 4, F4-1's inventory).
 */

/**
 * The typed prefix, normalised to a single bare word.
 *
 * The TUI's matcher takes the editor text before the caret and requires it to
 * start with `/` (`match_commands` strips and tests the sigil). The renderer
 * always already holds the word from `slashContext().query`, so requiring the
 * slash would make every call strip it anyway — this accepts either spelling,
 * and the last whitespace-delimited token of a whole-buffer string, so a caller
 * that hands over the draft prefix cannot silently score the prose.
 */
function typedWord(textBeforeCursor: string): string {
	const trimmed = pyTrim(textBeforeCursor);
	const lastToken = trimmed.split(SEPARATOR_RUN).pop() ?? "";
	return lastToken.startsWith("/") ? lastToken.slice(1) : lastToken;
}

/**
 * `(displayName, command)` matches for slash text, best first.
 *
 * `displayName` is the NAME OR ALIAS THAT MATCHED, because that is what the row
 * shows and what the completion writes. Ties keep registry order.
 */
export function matchCommands<T extends { name: string; aliases: string[] }>(
	textBeforeCursor: string,
	commands: readonly T[],
): { name: string; command: T }[] {
	const typed = typedWord(textBeforeCursor);
	const scored: { score: number; index: number; name: string; command: T }[] =
		[];
	commands.forEach((command, index) => {
		let best = 0;
		let bestName = command.name;
		for (const alias of [command.name, ...command.aliases]) {
			const score = scoreCommandTextMatch(typed, alias);
			if (score > best) {
				best = score;
				bestName = alias;
			}
		}
		if (best > 0) scored.push({ score: best, index, name: bestName, command });
	});
	scored.sort((a, b) => b.score - a.score || a.index - b.index);
	return scored.map((entry) => ({ name: entry.name, command: entry.command }));
}

/**
 * The command list for a typed word: the TUI's `command_suggestions`.
 *
 * The bare `/` case is here rather than in the caller because the empty query
 * has ONE answer for both hosts — the whole registry, in registration order —
 * and because it is the reason `scoreCommandTextMatch` scores an empty prefix
 * at 0 rather than 1000.
 *
 * The short-query rule is a PREFERENCE, not a filter, and that is load-bearing:
 * an empty return closes the picker, and a closed picker takes its Tab and
 * Enter guards down with it, so Tab would indent the user's message and Enter
 * would submit the raw text. The queries with no prefix match at all are exactly
 * the natural abbreviations the fuzzy matcher exists for (`/lg`, `/ls`, `/md`).
 *
 * The prefix test runs on the DISPLAY name — the name or alias the row shows —
 * exactly as `command_suggestions` tests `pair[0]`, so a row kept by the
 * preference is the row the user is looking at.
 */
export function commandSuggestions<
	T extends { name: string; aliases: string[] },
>(query: string, commands: readonly T[]): { name: string; command: T }[] {
	if (!query)
		return commands.map((command) => ({ name: command.name, command }));
	const matches = matchCommands(`/${query}`, commands);
	if (query.length >= FUZZY_MIN_QUERY_CHARS) return matches;
	const lowered = query.toLowerCase();
	const prefixed = matches.filter(({ name }) =>
		name.toLowerCase().startsWith(lowered),
	);
	return prefixed.length > 0 ? prefixed : matches;
}

/**
 * Rank bare choices against a query, sharing the same scorer.
 *
 * Two deliberate differences from `matchCommands`. There is no leading `/` to
 * strip, because an argument is a bare word. And the display name is ALWAYS
 * `choice.name`, never the alias that matched: a command's aliases are
 * themselves typeable commands, whereas an argument's aliases are only a way to
 * FIND it — `claude` finds the `anthropic` provider, but `/login claude` is not
 * a thing, so returning the alias would put a word into the buffer the command
 * then rejects as unknown.
 *
 * An EMPTY query returns EVERY choice in the given order, because "I typed the
 * command and stopped" is a request to see the whole set.
 */
export function matchChoices<C extends { name: string; aliases?: string[] }>(
	query: string,
	choices: readonly C[],
): { name: string; choice: C }[] {
	if (!query) return choices.map((choice) => ({ name: choice.name, choice }));
	const scored: { score: number; order: number; choice: C }[] = [];
	choices.forEach((choice, order) => {
		const best = Math.max(
			0,
			...[choice.name, ...(choice.aliases ?? [])].map((alias) =>
				scoreCommandTextMatch(query, alias),
			),
		);
		if (best > 0) scored.push({ score: best, order, choice });
	});
	scored.sort((a, b) => b.score - a.score || a.order - b.order);
	return scored.map((entry) => ({
		name: entry.choice.name,
		choice: entry.choice,
	}));
}

/**
 * Whether Enter may RUN the highlighted row rather than only complete it.
 *
 * Unambiguous means one of three things, ported from
 * `Editor._picker_choice_is_unambiguous`:
 *
 *   - the user moved onto the row by hand (an arrow key was pressed). The gate
 *     exists because the matcher may have picked the row on the user's behalf,
 *     and an explicit move is the direct answer to that;
 *   - the typed query equals the row's value in full, so the user named it
 *     rather than letting the matcher choose;
 *   - there is exactly one match AND the list is not destructive.
 *
 * Everything else completes and waits for a second Enter. The point is the
 * uneven blast radius: `/usage` is harmless and `/logout` is not. "Exactly one
 * match" is not evidence on a DESTRUCTIVE list — the matcher is a subsequence
 * matcher, so a query that spells nothing can still leave one survivor
 * (`/logout oer` reached openrouter, `/logout dpsk` deepseek, `/logout xoh`
 * xai-oauth — each one Enter away from deleting a credential the user never
 * named).
 */
export function isUnambiguous(
	query: string,
	value: string,
	suggestionCount: number,
	destructive: boolean,
	chosenByHand: boolean,
): boolean {
	if (chosenByHand) return true;
	if (query.trim().toLowerCase() === value.trim().toLowerCase()) return true;
	return !destructive && suggestionCount <= 1;
}
