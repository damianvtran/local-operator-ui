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
 *   4. An ARMED-ONLY command's word is not hoisted by this key at all: the
 *      draft goes back as PROSE, in the order it was typed. The arming is an
 *      explicit gesture, and it happens somewhere else entirely
 *      (`planSlashArming`, called by the popup's pick).
 *   5. A free-text command → reassemble to the front, STAGED, never submitted.
 *      Exception: a NAME+message command (`/team`, `/agent`) with no name typed
 *      yet does NOT reassemble on the word alone — the name is picked from the
 *      argument list first, and leaving that list open IS the interaction.
 *   6. Otherwise splice the token out and run it; the surrounding draft
 *      survives.
 *
 * ONE DELIBERATE DEVIATION FROM THE TUI, and the only one in this file: rule 4.
 * The reference reassembles a free-text command typed into a sentence, and that
 * is right where the assembled line is what the user asked to read before it
 * ran. For `/goal` it made the arming IMPLICIT and the Enter lossy: the operator
 * typed a request, appended `/goal`, pressed Enter, and got his own sentence
 * rearranged with a note — nothing was sent, the words had moved, and a second
 * Enter was needed. A word sitting in a sentence names no gesture, so the
 * desktop arms `/goal` only from an explicit choice of its own row in the popup
 * (a click, or a key press on a row the user moved the marker to by hand), and an
 * Enter over a draft that merely CONTAINS the word sends the draft as written. WHICH words this holds for is the registry's business
 * (`armedOnlyCommands`), never a name written into this function.
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
 * The destinations whose command is armed EXPLICITLY and never inferred.
 *
 * `/goal` is the one command whose WORD used to arm it by merely appearing in a
 * draft: Enter over `I approve spend /goal` moved the sentence to the front,
 * staged it and sent nothing, so the request never ran and the words had moved
 * (the operator's report). A word sitting in a sentence names no gesture, so the
 * only arming is the explicit PICK of the command's own row in the popup, and
 * Enter over a draft that merely contains the word sends that draft as written.
 *
 * Keyed off the DESTINATION, which is what the catalogue says the command IS: a
 * rename or a new alias of `/goal` then carries the arming with it instead of
 * silently dropping the command out of the set. It lives here, beside the
 * planner that consumes the vocabulary it produces, rather than in the component
 * that derives it — the derivation is a decision, and a decision inside a React
 * hook cannot be executed by `scripts/slash-submit.test.mjs`.
 */
export const ARMED_ONLY_DESTINATIONS: ReadonlySet<string> = new Set([
	"session.goal",
]);

/**
 * The minimum a catalogue row must say to contribute arming words.
 *
 * Structural for the same reason `slash-contract.ts`'s row types are: the real
 * type (`SlashCommandMeta`) lives in `slash-commands.tsx`, which imports this
 * module, so naming it here would make a value-level cycle out of a type-only
 * dependency. `commands.list`'s rows are assignable to it.
 */
export type ArmingCatalogueRow = {
	name: string;
	aliases: readonly string[];
	destination: string;
};

/**
 * The words (primaries AND aliases, lower-cased) whose command arms by pick.
 *
 * Derived from the catalogue the way `commandNames` and `promptCommands` are,
 * so the set follows the registry: a backend that renamed the destination, or
 * gave it another alias, moves the arming vocabulary with the row rather than
 * leaving the planner hoisting a word the pick no longer arms. What it cannot
 * do is invent a word for a destination the catalogue does not advertise — the
 * row IS the fact here, which is why `slash-contract.test.mjs` pins this
 * derivation against the destination `picker-registry.tsx` routes.
 */
export function armedOnlyVocabulary(
	commands: readonly ArmingCatalogueRow[],
): Set<string> {
	const names = new Set<string>();
	for (const command of commands) {
		if (!ARMED_ONLY_DESTINATIONS.has(command.destination)) continue;
		names.add(command.name.toLowerCase());
		for (const alias of command.aliases) names.add(alias.toLowerCase());
	}
	return names;
}

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
	/**
	 * Not a command in this draft. Send the draft to the model — which is also the
	 * answer for a draft that merely CONTAINS an armed-only command's word.
	 */
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
	/**
	 * Names (primaries and aliases) of commands whose arming is EXPLICIT: a
	 * free-text command this key never hoists, because the only gesture that arms
	 * it is a PICK of its own row in the popup (`planSlashArming`). Derived from
	 * the registry's destinations, so the set follows the catalogue rather than a
	 * name written down here.
	 */
	armedOnlyCommands: ReadonlySet<string>;
	/** Names of commands whose argument list is open before any name is typed. */
	nameListCommands: ReadonlySet<string>;
	/** Whether a boundary slash token is a command at all (the feature is on). */
	enabled: boolean;
};

/** The name/argument separator: the first whitespace character of a token. */
const WHITESPACE = /\s/;

/**
 * The lower-cased command word of a token's text, `/team ops` → `team`.
 *
 * The split is `invocationOf`'s, and that is the whole point of this being a
 * function rather than an expression at its two call sites: it used to be
 * `commandText.slice(1).split(" ")[0]`, which read the name half of a token
 * whose name and argument are separated by anything else as ONE long word. So
 * for `prose\t/goal\tand more` the question asked was "is `goal\tand` a command?"
 * — answered no, which routed the draft into the `unrecognised` branch and
 * dispatched `/goal and more` over a draft the footer had just told the user
 * would be sent as prose (review F1: 126 of 261 fall-through states, every one of
 * them a PASTE shape — a TSV tab, an NBSP or a thin space lifted off a web page).
 * `\s` is the class `slash-token.ts` ends its word on and the class the
 * dispatcher posts, and two answers to "what is this token's word" have to be
 * the same answer.
 */
function wordOf(commandText: string): string {
	return invocationOf(commandText).name.toLowerCase();
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

/**
 * The staged line a HOISTED command is written as: the command's own text first,
 * the surviving draft behind it as its argument (`/goal ship it` from `ship it
 * /goal`).
 *
 * One helper because two gestures stage: a free-text command reassembled by
 * Enter, and an armed-only command hoisted by a pick (`planSlashArming`). They
 * must not be able to disagree about the shape, and the trailing space of the
 * empty case is part of it — it terminates the word, which is one of the two
 * jobs that space does (`editor.py:_complete_name_argument`).
 *
 * THE INVARIANT THE NEXT ENTER DEPENDS ON, owned here because this is the ONE
 * place that writes a line the planner will read back: THE STAGED LINE IS THE
 * WHOLE DRAFT, AND IT IS ONE LINE. `slashTokenSpan` claims the caret's own LINE
 * (`slash-token.ts`), and the staged caret is the end of the buffer, so a staged
 * line that still carried a surviving newline would put the command's span on
 * its first line with the rest of the draft outside it: the next Enter's planner
 * would answer `send`, nothing would run, and the literal `/loop …` would reach
 * the model as prompt text while the note the user just read promised the
 * command would run (review F1 / QA Q4 on the armed path, and review F1 / QA
 * Q3-1 on the reassembly path — the same omission, found twice because the
 * flattening lived in one of the two callers). So BOTH halves are COLLAPSED
 * here, at the one choke point: the line reads as a person would type it
 * (reviewer Q2: the completion's own doubled space), and it is the same shape
 * `/goal ship it` already has when typed whole, which is what makes one Enter
 * run it. Stating it on the caller instead is how the second writer came to
 * skip it.
 */
function stagedLine(
	commandText: string,
	rest: string,
): { text: string; caret: number } {
	const text = rest
		? `${oneLine(commandText)} ${oneLine(rest)}`
		: `${oneLine(commandText)} `;
	return { text, caret: text.length };
}

/**
 * One line, as a person would type it: every whitespace run collapsed to a
 * single space, trimmed at both ends.
 *
 * The staged line's own shape — and the reason both writers flatten — is the
 * invariant on `stagedLine` above.
 */
function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function planSlashSubmission({
	draft,
	caret,
	commandNames,
	promptCommands,
	armedOnlyCommands,
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

	/*
	 * ARMED-ONLY commands take nothing from this key. `/goal` inside a sentence is
	 * prose: the draft goes back UNTOUCHED and in its own order rather than being
	 * moved to the front, because moving a user's sentence is not an arming
	 * gesture and the Enter that did it sent nothing (the operator's report). The
	 * one gesture that arms the command is the popup pick, which is where the
	 * hoisting lives now — and the pick's own note says what the next Enter does,
	 * so the user is told the arming happened instead of inferring it from a box
	 * that silently changed.
	 *
	 * The command is still RECOGNISED here (the `unrecognised` branch above is
	 * unaffected), so a misspelt armed command is still reported rather than sent.
	 */
	if (armedOnlyCommands.has(word)) return { kind: "send" };

	if (promptCommands.has(word)) {
		// The typed argument is the SAME split the command posts (`invocationOf`
		// above), for the reason `wordOf` states: a literal-space split read
		// `/team\tops` as one word with no argument, so a name-aware row took the
		// `list-open` branch on a name the user had already typed. It is also the
		// trimmed form, which is what the emptiness test below means.
		const typedArgument = command.args;
		// A name-list command with no name typed yet: `_apply_command` has
		// already completed the word to `/team ` and opened the roster list;
		// leaving it open is the whole interaction, and reassembly happens when
		// a NAME row is chosen (TUI `editor.py:8219-8222`).
		if (nameListCommands.has(word) && !typedArgument.trim())
			return { kind: "list-open", command };
		const rest = spliced.text.trim();
		// The staged line is one line, both halves collapsed — see the invariant on
		// `stagedLine`. A two-line draft staged here put the command's span on its
		// first line, so the next Enter answered `send` and the literal `/loop …`
		// went to the model as prose while the note said it would run (review F1 /
		// QA Q3-1).
		return { kind: "reassemble", ...stagedLine(commandText, rest) };
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

/**
 * What an EXPLICIT pick of a command's own row does with the draft.
 *
 * The pick is the popup's own gesture — a CLICK on that row, or Enter/Tab on a row
 * the user put the marker on by hand (an arrow key; `slashKeyIntent`'s gate in
 * `slash-contract.ts` states why the pre-selected row is not a choice) — and for
 * an armed-only command it is the ONLY thing that arms the command. It writes the
 * line the assembler writes: the command first, the surviving draft behind it as
 * its argument, left in the box for the user to read before Enter runs it (the
 * goal set, the text sent).
 *
 * `none` is two cases that the caller treats identically, because the pick has
 * one write either way: the draft names no armed-only command at the caret, or
 * nothing survives the token — a bare `/goal` pick stays the plain COMPLETION it
 * has always been (`/goal ` with the caret after it), since there is no text to
 * arm, and Enter still reaches the bare form's own READ (`PRESENT_DIRECTLY` in
 * `slash-dispatch.ts`).
 *
 * WHY a second entry point rather than a flag on `planSlashSubmission`: the two
 * gestures ask different questions about the same draft, and the answers are
 * deliberately opposite. Enter asks "does this draft submit something?", which
 * for an armed command is `send` — the draft is prose. A pick asks "does this
 * gesture arm the command?", which is `armed`. One plan that meant the opposite
 * of itself depending on how it was called is the class of defect this module's
 * header exists to prevent.
 *
 * THE ONE-LINE SHAPE the staged line owes the next Enter is stated once, on
 * `stagedLine` above, because that is what writes it for both this gesture and
 * the reassembly. Nothing about the invariant belongs on a caller: the version
 * of this paragraph that lived here, as the only place that "writes a line the
 * planner will read back", is why the reassembly writer shipped without the
 * collapse (review F1 / QA Q3-1).
 */
export type SlashArmingPlan =
	/** The pick armed the command: this line is staged, the next Enter runs it. */
	| { kind: "armed"; text: string; caret: number }
	/** Nothing was armed: the pick writes its completion and nothing else. */
	| { kind: "none" };

export type SlashArmingArgs = {
	/**
	 * The draft as the pick left it: the completion already written in place
	 * (`completionFor`), which is the draft the NEXT Enter will submit.
	 */
	draft: string;
	caret: number;
	commandNames: ReadonlySet<string>;
	armedOnlyCommands: ReadonlySet<string>;
};

export function planSlashArming({
	draft,
	caret,
	commandNames,
	armedOnlyCommands,
}: SlashArmingArgs): SlashArmingPlan {
	const span = slashTokenSpan(draft, caret, commandNames);
	if (span === null) return { kind: "none" };
	const commandText = draft.slice(span.start, span.end).trim();
	/*
	 * The word is checked here as well as at the row (`pickArmsCommand`) because
	 * this is the function that decides what gets HOISTED: a caller that reached
	 * it with somebody else's command in the draft arms nothing and takes the
	 * completion path, which is the safe direction. Both tests read the same
	 * registry-derived set, so they can only disagree if the draft no longer names
	 * the row that was picked.
	 */
	if (!armedOnlyCommands.has(wordOf(commandText))) return { kind: "none" };
	const rest = replaceSpan(draft, span.start, span.end, "").text.trim();
	if (!rest) return { kind: "none" };
	// `stagedLine` collapses both halves, which is what keeps the staged line one
	// line whatever shape the draft had — see the invariant on it. The flattening
	// is not restated here: it lives at the one place both writers pass through.
	return { kind: "armed", ...stagedLine(commandText, rest) };
}
