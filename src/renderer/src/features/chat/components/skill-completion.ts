/**
 * The write a `$skill` PICK performs on the draft, as a pure function.
 *
 * A port of the `completion_for` SKILL branch in
 * `local_operator/tui/widgets/command_picker.py`: `_skill_span_replacement`
 * for a token that already LEADS its draft, `_reassembled_skill` otherwise.
 * Both are needed because the composer's `$` is INLINE (see `skill-token.ts`)
 * while the submit-side parser is ANCHORED at the buffer start — the
 * reassembly is what bridges the two by the time Enter can see the text.
 *
 * Pure, and deliberately its own module: `completion_for` lives beside the
 * slash machinery for the same reason, and a component file cannot be bundled
 * by the node harness that exercises this.
 */

import { type SkillToken, skillTokenIsLeading } from "./skill-token";
import { pyTrim, pyTrimStart } from "./slash-token";

/**
 * The buffer and caret that accepting `name` produces. Pure, so the popup's
 * footer and the apply path cannot disagree about what a pick writes.
 *
 * LEADING (`_skill_span_replacement`): replace the token's span with
 * `$name `, preserving the leading run and lstripping the suffix. The leading
 * run is preserved rather than normalised away so completing never silently
 * reformats what the user typed (an indented `  $research` keeps its indent),
 * and the suffix is lstripped because the write brings its own separator —
 * `$res fix bug` must not come back as `$research  fix bug`. The caret parks
 * right after `$name `, which is where the request is typed.
 *
 * INLINE (`_reassembled_skill`): the token moves to the FRONT with the
 * SURVIVING draft as its request (`fix this $res` → `$research fix this `),
 * staged for the user to read and send — neither Tab nor Enter ever submits
 * for a skill row, because a completed `$skill ` is the opening of a prompt
 * the user is still writing. One adjoining separator goes with the token, the
 * same rule the slash splice and reassembly use, so the gap the token used to
 * occupy does not survive the move. The caret parks at the END of the
 * assembled line (the TUI's own answer for this branch), which is where the
 * request continues.
 */
export function skillCompletionFor(
	text: string,
	token: SkillToken,
	name: string,
): { text: string; caret: number } {
	if (skillTokenIsLeading(text, token)) {
		const lead = text.slice(0, token.start);
		const completed = `${lead}$${name} ${pyTrimStart(text.slice(token.end))}`;
		return { text: completed, caret: token.start + name.length + 2 };
	}
	// One adjoining separator goes with the token; the PRECEDING one is
	// preferred, the following one is taken only when the token opens the
	// rebuilt region (the TUI's own two-arm rule).
	let start = token.start;
	let end = token.end;
	if (start > 0 && " \t\n".includes(text[start - 1])) start -= 1;
	else if (end < text.length && " \t\n".includes(text[end])) end += 1;
	const rest = pyTrim(text.slice(0, start) + text.slice(end));
	const assembled = rest ? `$${name} ${rest} ` : `$${name} `;
	return { text: assembled, caret: assembled.length };
}
