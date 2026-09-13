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
 *   0. The capability is off → send. Nothing is spliced on a host that could not
 *      run the command it was deleted for.
 *   1. The token at the CARET (`slashTokenSpan`, which is what
 *      `_run_command_from_buffer` itself calls first) defines the span the run
 *      owns. No token at the caret → prose; send it. The whole-draft shape is
 *      NOT tested first: a `/usage` on line 1 of a two-line draft is a token on
 *      its own LINE, and asking `SLASH_SUBMISSION` about the whole draft let it
 *      claim line 2 as its argument and clear the box (round 1 R2 = Q1 = U1).
 *   2. Nothing survives removing the span → the token IS the draft → whole.
 *   3. A slash-shaped token that names no command → `unrecognised`: report it
 *      through the normal dispatch (which owns the "did you mean" note) and keep
 *      the ORIGINAL draft, so a misspelt inline command is there to fix rather
 *      than gone (round 1 U8).
 *   4. A free-text command → reassemble to the front, STAGED, never submitted.
 *      Exception: a NAME+message command (`/team`, `/agent`) with no name typed
 *      yet does NOT reassemble on the word alone — the name is picked from the
 *      argument list first, and leaving that list open IS the interaction.
 *   5. Otherwise splice the token out and run it; the surrounding draft
 *      survives.
 *
 * "WHICH LINE THE COMMAND OWNS", the rule this file exists to state: a command
 * owns its word plus the rest of ITS OWN LINE, never the lines around it. That
 * is why the span ends at the line end (`slash-token.ts` `slashTokenSpan`) and
 * why a message meant to survive a run sits BEFORE the slash or on another
 * line.
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
	| { kind: "list-open"; line: string }
	/** Slash-shaped, but names no command: report it and KEEP the draft. */
	| { kind: "unrecognised"; line: string };

/**
 * The whole-draft command shape.
 *
 * The DISPATCHER's guard, not the planner's: `planSlashSubmission` no longer
 * asks this question, because the token at the caret is what decides a draft.
 * It stays exported as the ONE pattern object `slash-dispatch.ts` imports, so
 * "is this line a command at all" cannot drift between two copies.
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

	/*
	 * The token at the CARET decides first, and the whole-draft shape is then a
	 * CONSEQUENCE of that decision (nothing survives the span). The reverse order
	 * — asking `SLASH_SUBMISSION` about the whole trimmed draft first — is how
	 * `/usage\nfix this` came to be handed over as one command: the regex reads
	 * the newline as the command/argument separator, so line 2 became `/usage`'s
	 * argument, the box was cleared on `consumed`, and the argument reached the
	 * transport as a provider name (round 1 R2 = QA Q1 = UX U1). The reference
	 * calls `slash_token_span` first for the same reason (`editor.py:8184-8197`).
	 */
	const span = slashTokenSpan(draft, caret, commandNames);
	if (span === null) return { kind: "send" };

	const spliced = replaceSpan(draft, span.start, span.end, "");
	const commandText = draft.slice(span.start, span.end).trim();
	if (spliced.text.trim() === "") return { kind: "whole", line: commandText };

	const word = wordOf(commandText);
	// Slash-shaped but not a command this host knows: the misspelling is the
	// thing to fix, so the caller reports it and keeps the draft rather than
	// consuming the token (round 1 U8).
	if (!commandNames.has(word))
		return { kind: "unrecognised", line: commandText };

	if (promptCommands.has(word)) {
		const typedArgument = commandText.slice(1).split(" ").slice(1).join(" ");
		// A name-list command with no name typed yet: `_apply_command` has
		// already completed the word to `/team ` and opened the roster list;
		// leaving it open is the whole interaction, and reassembly happens when
		// a NAME row is chosen (TUI `editor.py:8219-8222`).
		if (nameListCommands.has(word) && !typedArgument.trim())
			return { kind: "list-open", line: commandText };
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
