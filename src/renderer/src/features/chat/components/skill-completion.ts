/**
 * The write a `$skill` PICK performs on the draft, as a pure function.
 *
 * A port of the `completion_for` SKILL branch in
 * `local_operator/tui/widgets/command_picker.py`: `_skill_span_replacement`,
 * and NOTHING ELSE. The token is replaced where it sits — `[start, end)` — and
 * every character outside that span survives verbatim.
 *
 * WHY THERE IS NO REASSEMBLY ANY MORE. The submit-side trigger used to be
 * anchored at the start of the message, so a token typed mid-sentence had to be
 * moved to the front for the send to see it. It is not anchored any more:
 * `skillMentions` reads every boundary `$name` in the message, the same way the
 * TUI does after its own inline change. Moving a token the user placed would
 * now be an edit nobody asked for — and it would mangle a draft that mentions
 * two skills (`compare $a and $b`).
 *
 * TAB and ENTER both still accept a suggestion and still land on the token's
 * span, not at the end of the buffer; neither ever submits. The user keeps
 * writing after the skill name.
 *
 * Pure, and deliberately its own module: `completion_for` lives beside the
 * slash machinery for the same reason, and a component file cannot be bundled
 * by the node harness that exercises this.
 */

import type { SkillToken } from "./skill-token";
import { SEPARATOR } from "./slash-token";

/**
 * The buffer and caret that accepting `name` produces. Pure, so the popup's
 * footer and the apply path cannot disagree about what a pick writes.
 *
 * The token's `$name` replaces its own span. A single space is inserted ONLY
 * when the next character is not already whitespace: that space is the token
 * terminator the list-close depends on, and when the user already typed one it
 * is the separator and stays byte-identical. Nothing is lstripped or joined:
 * `fix $re\nthe bug` keeps its newline rather than being collapsed into one
 * line.
 *
 * The caret lands one cell past whatever separator terminated the token — the
 * inserted space, or the user's own whitespace — so it sits where the request
 * continues without the completion moving any character. A NEWLINE terminates
 * the token but is not a place to park the caret: the request continues on the
 * line the token is on, so the caret stops right after the name.
 */
export function skillCompletionFor(
	text: string,
	token: SkillToken,
	name: string,
): { text: string; caret: number } {
	const tail = text.slice(token.end);
	const separator = tail === "" || !SEPARATOR.test(tail[0]) ? " " : "";
	const completed = `${text.slice(0, token.start)}$${name}${separator}${tail}`;
	if (tail !== "" && (tail[0] === "\r" || tail[0] === "\n")) {
		return { text: completed, caret: token.start + name.length + 1 };
	}
	return { text: completed, caret: token.start + name.length + 2 };
}
