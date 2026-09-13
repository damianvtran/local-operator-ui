/**
 * What Enter does with a draft that holds a slash command.
 *
 * The renderer twin of `Editor._run_command_from_buffer`
 * (`editor.py:8166-8227`), kept pure so the whole rule is testable without a
 * browser. Today the composer only recognises a draft that is ENTIRELY a
 * command (`slash-dispatch.ts`'s `SLASH_SUBMISSION` against `text.trim()`), so a
 * command typed into a sentence is prose and silently reaches the model. In the
 * TUI it is not: the token at the caret is spliced out and run, the surviving
 * draft stays in the composer, and a command whose argument is FREE TEXT is
 * reassembled to the front and STAGED rather than run.
 *
 * Rule order, one-to-one with the TUI:
 *
 *   1. The whole trimmed draft is a command → hand it to dispatch as today. All
 *      three existing `SlashDispatchOutcome` meanings are untouched.
 *   2. No slash token at the caret → prose; send it.
 *   3. The token IS the draft (nothing survives its removal) → whole.
 *   4. A free-text command → reassemble to the front, STAGED, never submitted.
 *      Exception: a NAME+message command (`/team`, `/agent`) with no name typed
 *      yet does NOT reassemble on the word alone — the name is picked from the
 *      argument list first, and leaving that list open IS the interaction.
 *   5. Otherwise splice the token out and run it; the surrounding draft
 *      survives.
 *
 * WHY the reassembly is never auto-submitted: the risk in both directions is
 * the same one — treating trailing prose as a name silently ate a user's
 * request (`draft` → D1 in the TUI). Staging puts the assembled line in front
 * of the user to read before Enter.
 */

import { replaceSpan, slashTokenSpan } from "./slash-token";

export type SlashSubmissionPlan =
	/** Not a command in this draft. Send the draft to the model. */
	| { kind: "send" }
	/** The whole trimmed draft is a command. Hand it to dispatch as today. */
	| { kind: "whole"; line: string }
	/** Splice `[start, end)` out of the draft, keep the rest, and run `line`. */
	| {
			kind: "splice";
			start: number;
			end: number;
			line: string;
			text: string;
			caret: number;
	  }
	/** Move `line` to the front, keep the rest as its argument, stage, do not run. */
	| { kind: "reassemble"; text: string; caret: number }
	/** A name-list command with no name typed yet: the roster list owns the key. */
	| { kind: "list-open" };

/**
 * The whole-draft command shape.
 *
 * Exported so the planner and `slash-dispatch`'s own guard are the same
 * pattern object: "is this line a command at all" must have one answer, and two
 * copies of a regex is how a draft comes to be a command on one path and prose
 * on the other.
 */
export const SLASH_SUBMISSION = /^\/([A-Za-z]+)(?:\s([\s\S]*))?$/;

export type SlashSubmissionArgs = {
	draft: string;
	caret: number;
	/** Lower-cased primaries AND aliases, from the registry metadata. */
	commandNames: ReadonlySet<string>;
	/** Names (primaries and aliases) of commands with `consumes_prompt: true`. */
	promptCommands: ReadonlySet<string>;
	/** Names of commands whose argument list is open before any name is typed. */
	nameListCommands: ReadonlySet<string>;
	/** Whether a boundary slash token is a command at all (the feature is on). */
	enabled: boolean;
};

/** The lower-cased command word of a token's text, `/team ops` → `team`. */
function wordOf(commandText: string): string {
	return commandText.slice(1).split(" ")[0].toLowerCase();
}

export function planSlashSubmission({
	draft,
	caret,
	commandNames,
	promptCommands,
	nameListCommands,
	enabled,
}: SlashSubmissionArgs): SlashSubmissionPlan {
	// The capability flag, first and unconditionally: when `commands` is off,
	// nothing is spliced and nothing is lost — the same fallback the model path
	// already has. A splice that ran here would delete text on a backend that
	// cannot run the command it was deleted for.
	if (!enabled) return { kind: "send" };

	const trimmed = draft.trim();
	if (SLASH_SUBMISSION.test(trimmed)) return { kind: "whole", line: trimmed };

	const span = slashTokenSpan(draft, caret, commandNames);
	if (span === null) return { kind: "send" };

	// The separator rule is the splice's, reused rather than restated: what
	// survives a removal is exactly what a completion would have left behind.
	const spliced = replaceSpan(draft, span.start, span.end, "");
	const commandText = draft.slice(span.start, span.end).trim();
	if (spliced.text.trim() === "") return { kind: "whole", line: commandText };

	const word = wordOf(commandText);
	if (promptCommands.has(word)) {
		const typedArgument = commandText.slice(1).split(" ").slice(1).join(" ");
		// A name-list command with no name typed yet: `_apply_command` has
		// already completed the word to `/team ` and opened the roster list;
		// leaving it open is the whole interaction, and reassembly happens when
		// a NAME row is chosen (TUI `editor.py:8219-8222`).
		if (nameListCommands.has(word) && !typedArgument.trim())
			return { kind: "list-open" };
		const rest = spliced.text.trim();
		const text = rest ? `${commandText} ${rest}` : `${commandText} `;
		return { kind: "reassemble", text, caret: text.length };
	}

	return {
		kind: "splice",
		start: span.start,
		end: span.end,
		line: commandText,
		text: spliced.text,
		caret: spliced.caret,
	};
}
