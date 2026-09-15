/**
 * What Enter does with a draft that holds a slash command.
 *
 * The renderer twin of `Editor._run_command_from_buffer`
 * (`editor.py:8166-8227`), kept pure so the whole rule is testable without a
 * browser. The token at the caret is spliced out and run, the surviving draft
 * stays in the composer, and a command whose argument is FREE TEXT is
 * reassembled to the front and STAGED rather than run.
 *
 * THE ONE DECISION. This function is the only thing that answers "what does
 * this draft submit?" — it hands back a plan, and the plan carries the command
 * the dispatcher will post (`SlashCommandInvocation`), already split. Nothing
 * downstream re-reads the draft to re-derive that answer. The reason is a
 * defect this file's first version still allowed: the planner answered `send`
 * for a two-line draft whose caret was on line 2, and the canonical send path
 * then asked its own question of the RAW text — a `SLASH_SUBMISSION` guard
 * whose `[\s\S]*` argument group read the newline as the command/argument
 * separator, so `/usage` on line 1 claimed line 2 as its argument, the box was
 * emptied, and the prose reached the transport as a provider name (QA round 2,
 * Q4 — round 1's Q1, one layer below where it was fixed). An ordering guard did
 * not catch it because the second guard was never an ordering problem: it was a
 * SECOND decision. So the split lives here, where the span is known to end at
 * its own line end, and the dispatcher is handed the answer.
 *
 * Rule order, one-to-one with the TUI:
 *
 *   0. The capability is off → send. Nothing is spliced on a host that could not
 *      run the command it was deleted for.
 *   1. The token at the CARET (`slashTokenSpan`, which is what
 *      `_run_command_from_buffer` itself calls first) defines the span the run
 *      owns. No token at the caret → prose; send it. The whole-draft shape is
 *      NOT tested first, it is a CONSEQUENCE of this: a `/usage` on line 1 of a
 *      two-line draft is a token on its own LINE, so the caret on line 2 finds
 *      no token and the draft is prose (round 1 R2 = Q1 = U1).
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

/**
 * A command the dispatcher can post without asking anything about its text.
 *
 * Produced by `planSlashSubmission` and by the controls that name a command
 * outright (`session-status-strip.tsx`'s readings, the Commands panel) — never
 * by parsing a draft, which is the whole point: `args` can only ever be the
 * rest of the command's OWN LINE, because the span it is cut from ends there
 * (`slashTokenSpan`). `name` is the word as typed, NOT lower-cased: the
 * dispatcher's catalogue lookup is case-sensitive, and `/Usage` answering
 * "unknown command" is the behaviour this carries over unchanged.
 */
export type SlashCommandInvocation = {
	name: string;
	args: string;
};

export type SlashSubmissionPlan =
	/** Not a command in this draft. Send the draft to the model. */
	| { kind: "send" }
	/** The whole draft is the command: nothing survives removing its token. */
	| { kind: "whole"; command: SlashCommandInvocation }
	/** Splice the token out of the draft, keep the rest, and run `command`. */
	| {
			kind: "splice";
			start: number;
			end: number;
			command: SlashCommandInvocation;
			text: string;
			caret: number;
	  }
	/** Move the command to the front, keep the rest as its argument, stage it. */
	| { kind: "reassemble"; text: string; caret: number }
	/** A name-list command with no name typed yet: the roster list owns the key. */
	| { kind: "list-open"; command: SlashCommandInvocation }
	/** Slash-shaped, but names no command: report it and KEEP the draft. */
	| { kind: "unrecognised"; command: SlashCommandInvocation };

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

/** The name/argument separator: the first whitespace character of a token. */
const WHITESPACE = /\s/;

/** The lower-cased command word of a token's text, `/team ops` → `team`. */
function wordOf(commandText: string): string {
	return commandText.slice(1).split(" ")[0].toLowerCase();
}

/**
 * Split a token's text into the name and args a command posts.
 *
 * Fed `commandText` — a `slashTokenSpan` slice, whose end is the end of its own
 * LINE — so the split is done once, on text that cannot contain a newline. The
 * separator is the first whitespace character, matching what the old
 * whole-draft regex treated as the name/argument boundary (`/team\tops` still
 * parses as `team` + `ops`).
 */
function invocationOf(commandText: string): SlashCommandInvocation {
	const body = commandText.slice(1);
	const separator = body.search(WHITESPACE);
	if (separator === -1) return { name: body, args: "" };
	return {
		name: body.slice(0, separator),
		args: body.slice(separator + 1).trim(),
	};
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
	const command = invocationOf(commandText);
	if (spliced.text.trim() === "") return { kind: "whole", command };

	const word = wordOf(commandText);
	// Slash-shaped but not a command this host knows: the misspelling is the
	// thing to fix, so the caller reports it and keeps the draft rather than
	// consuming the token (round 1 U8).
	if (!commandNames.has(word)) return { kind: "unrecognised", command };

	if (promptCommands.has(word)) {
		const typedArgument = commandText.slice(1).split(" ").slice(1).join(" ");
		// A name-list command with no name typed yet: `_apply_command` has
		// already completed the word to `/team ` and opened the roster list;
		// leaving it open is the whole interaction, and reassembly happens when
		// a NAME row is chosen (TUI `editor.py:8219-8222`).
		if (nameListCommands.has(word) && !typedArgument.trim())
			return { kind: "list-open", command };
		const rest = spliced.text.trim();
		const text = rest ? `${commandText} ${rest}` : `${commandText} `;
		return { kind: "reassemble", text, caret: text.length };
	}

	return {
		kind: "splice",
		start: span.start,
		end: span.end,
		command,
		text: spliced.text,
		caret: spliced.caret,
	};
}
