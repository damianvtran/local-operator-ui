/**
 * Caret-aware `$skill` tokenizer for the composer.
 *
 * A port of the `$` grammar from `local_operator/tui/widgets/command_picker.py`
 * (`_active_sigil`'s last-boundary-sigil rule, `skill_token`'s boundary and
 * word-phase rules, and `skill_token_is_leading`), so the two hosts can be
 * diffed by name. The TUI file's own header states the two properties the
 * desktop keeps by porting it rather than inventing a rule:
 *
 *   - A `$` opens a token only at a WORD BOUNDARY: line start, or right after a
 *     separator. `costs$5` and `a$b` are punctuation inside a word, never a
 *     sigil, so money and shell variables that are glued to their left context
 *     cannot open the list at all.
 *   - It is WORD-PHASE only, like `slashContext`: the terminating whitespace
 *     means the user has moved on into the request, where a skill list is stale
 *     advice. The caret must be INSIDE the token; moving it out closes the list,
 *     which is what makes the picker phase a property of the parse.
 *
 * INLINE, on the same terms as the TUI's current rule: the token may sit
 * anywhere a boundary allows (`fix this $res`, or a `$` opening line 2), and
 * the ACCEPT gesture is what reconciles that with the anchored submit-side
 * parser — `skillCompletionFor` moves the token to the FRONT with the
 * surviving draft as its request before Enter can see it.
 *
 * WHAT IS DELIBERATELY NOT PORTED, stated so a reader does not take its absence
 * for an oversight: the TUI relaxes a recognised command's claim over its line
 * for `consumes_prompt` commands, so `/team delivery $research …` can open the
 * skill list inside the argument, and `_reassembled_skill_argument` moves the
 * token to the ARGUMENT's front. The desktop has no equivalent inline form —
 * its `/team` argument is a dialog's request field, not composer text the
 * submit-side parser ever reads — so the desktop keeps the claim TOTAL: the
 * CALLER (`useSkillCompletion`) suppresses this token whenever a slash context
 * is live at the caret, and a `$` inside a command's argument stays prose. The
 * harness contract for that case is unaffected: the argument string the TUI
 * feeds its parser is never produced by this host.
 *
 * Pure and I/O-free: no React, no DOM, no network.
 */

import { SEPARATOR, lineOfCursor, pyTrim } from "./slash-token";

export type SkillToken = {
	/** Whole-buffer offset of the `$`. */
	start: number;
	/** Whole-buffer offset one past the last character of the word. */
	end: number;
	/** The text between the `$` and the word's end (may be empty). */
	query: string;
};

/**
 * The LAST boundary `$` at or before the caret — the sigil being edited.
 *
 * `_active_sigil`'s rule, restated: `$` has no vocabulary of its own to
 * terminate a token with, so unlike `/` there is no claiming clause — the last
 * boundary sigil at or before the caret is always the one being edited
 * (`$a $re|` is `$re`).
 */
function activeSigil(line: string, column: number): number | null {
	let candidate: number | null = null;
	for (let index = 0; index < line.length; index++) {
		if (line[index] !== "$") continue;
		if (index !== 0 && !SEPARATOR.test(line[index - 1])) continue;
		if (index <= column) candidate = index;
	}
	return candidate;
}

/**
 * The `$skill` token being typed at the caret, or `None`.
 *
 * `query` is `""` for a bare `$`, which — at the LEADING position — opens the
 * whole catalogue to browse (the empty-list rule lives in `skill-rank.ts`;
 * this function only says where the token is). `cursor === null` means the end
 * of the buffer, like every other tokenizer here.
 */
export function skillToken(
	text: string,
	cursor: number | null = null,
): SkillToken | null {
	const { line, lineStart, column } = lineOfCursor(text, cursor);
	const dollar = activeSigil(line, column);
	if (dollar === null) return null;
	let end = dollar + 1;
	while (end < line.length && !SEPARATOR.test(line[end])) end++;
	// The caret must be INSIDE the token; a caret in the request has left it.
	if (column > end) return null;
	return {
		start: lineStart + dollar,
		end: lineStart + end,
		query: line.slice(dollar + 1, end),
	};
}

/**
 * Whether `token` opens `text`, ignoring leading whitespace.
 *
 * THE definition of "leading" for the `$` grammar, in one place because two
 * separate decisions turn on it and they must not drift: whether the fuzzy
 * matcher may run inline without evidence (`skillSuggestions`) and whether
 * accepting a row has to reassemble the buffer (`skillCompletionFor`). Both
 * ask the same question — is this token already the prefix the anchored
 * submit-side parser reads? — so both read the same answer.
 *
 * `pyTrim`, not `trim()`: the submit-side parser `lstrip`s Python's class, and
 * JavaScript's is a different set in both directions (see `slash-token.ts`).
 */
export function skillTokenIsLeading(text: string, token: SkillToken): boolean {
	return pyTrim(text.slice(0, token.start)) === "";
}
