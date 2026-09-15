/**
 * The write a PICK performs on the draft, as a pure function.
 *
 * `completionFor` used to live in `slash-commands.tsx`. It moved here — beside
 * the other pure `slash-*` modules and out of the component — for one reason: it
 * is the FIRST half of the arming seam. The pick's write is fed straight into
 * `planSlashArming` (`message-input.tsx`), and review F7 found that no test
 * exercised the two together: both suites hand-built the string the pick writes
 * (`"I approve spend /goal "`), so a change in what TYPING produces would move
 * the seam the arming sits on without turning anything red. A component file
 * cannot be bundled by the node harness — `slash-commands.tsx` pulls React, the
 * desktop hooks and every picker with it — while this module imports the
 * tokenizer and nothing else.
 *
 * The row types are structural for the same reason `slash-contract.ts`'s are:
 * the real `CompletionRow` lives in the component, so naming it here would make
 * a value-level cycle out of a type-only dependency.
 */

import { replaceSpan, slashArgumentContext, slashContext } from "./slash-token";

/** A command row, as the write needs it: the matched label and nothing else. */
type CommandTarget = { kind: "command"; label: string };

/** An argument row, as the write needs it: the chosen value. */
type ArgumentTarget = { kind: "argument"; row: { value: string } };

export type CompletionTarget = CommandTarget | ArgumentTarget;

/**
 * The buffer and caret that accepting a row produces. Pure, so the popup and
 * the apply path cannot disagree about what a pick writes.
 *
 * Command rows: replace the word token with `/<label> ` — the trailing space is
 * load-bearing, not cosmetic (it terminates the word, closing this list, and for
 * a list-taking command opens the argument phase). Argument rows: replace the
 * ARGUMENT span only, leaving the command word intact; the name-list commands
 * (`/team`, `/agent`) add their own terminating space, which is what closes the
 * list and opens the free-text tail (`editor.py:_complete_name_argument`). The
 * enum-tail commands add NO space, or the matcher would stop matching and Tab
 * would appear to fill the field and abandon it in one keystroke.
 *
 * `nameThenMessage` is passed in rather than read off the row because it belongs
 * to the command's destination, which this module deliberately does not import.
 */
export function completionFor(
	draft: string,
	caret: number,
	row: CompletionTarget,
	commands: ReadonlySet<string>,
	argumentWords: readonly string[],
	nameThenMessage: boolean,
): { text: string; caret: number } | null {
	if (row.kind === "command") {
		const word = slashContext(draft, caret, commands);
		if (!word) return null;
		return replaceSpan(draft, word.start, word.end, `/${row.label} `);
	}
	const argument = slashArgumentContext(draft, argumentWords, caret, commands);
	if (!argument) return null;
	const suffix = nameThenMessage ? " " : "";
	return {
		text: `${draft.slice(0, argument.start)}${row.row.value}${suffix}${draft.slice(argument.end)}`,
		caret: argument.start + row.row.value.length + suffix.length,
	};
}
