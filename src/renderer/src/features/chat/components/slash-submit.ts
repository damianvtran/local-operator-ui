/**
 * What Enter does with a draft that holds a slash command.
 *
 * The renderer's own rule, deliberately NOT the renderer twin of
 * `Editor._run_command_from_buffer` (`editor.py:8166-8227`) any more, and the
 * deviation from it is stated below rather than left to be rediscovered. It is
 * kept pure so the whole rule is testable without a browser: the token at the
 * caret is spliced out and run, the surviving draft stays in the composer, and
 * a command whose argument is FREE TEXT is reassembled to the front and STAGED
 * rather than run.
 *
 * THE DEVIATION, and the operator's reason for it. The terminal host's rule is
 * "a command typed mid-draft is a command", and "a command owns the rest of its
 * own line". That is right for a terminal, where the buffer IS the command
 * line. Here a draft is a message someone is writing, and the operator's report
 * was that both halves of the old rule ate his text: `fix this /usage` spliced
 * the command out of the middle of his sentence, and `/compact hello` ran
 * `/compact` and silently discarded `hello`. His decision, recorded here so the
 * next reader does not restore parity: a typed command word is PROSE unless the
 * user meant it, and it is meant only when it is the ENTIRE draft, or when it
 * OPENS the draft and the command consumes what follows as its argument.
 * Everything else goes to the model, untouched, with no note and nothing eaten.
 *
 * WHAT STILL RUNS, exhaustively: the whole-draft command (`/compact`, `/usage`,
 * `/model gpt-5`, `/goal ship it`), and a draft-OPENING command whose
 * destination consumes its trailing text (`/model gpt-5` above a paragraph, or
 * `/goal ship it`). The explicit-pick path is untouched: Enter on a highlighted
 * row completes the word, a pointer pick that runs still runs, and
 * `POINTER_PICK_NEVER_RUNS` still keeps a stray click from spending a
 * compaction.
 *
 * WHY THE ARGUMENT VOCABULARY IS NOT THE `promptCommands` SET. `consumes_prompt`
 * is half the answer — `/model gpt-5` and `/theme dark` consume a VALUE chosen
 * from a list, not a free-text prompt, and their trailing text is still their
 * argument. The vocabulary is therefore `promptCommands` UNION the inline
 * argument lists the registry already derives (`argumentVocabulary`,
 * `slash-commands.tsx`) UNION the registry's own `arguments` declaration, which
 * is the only one of the three that `/login`/`/logout`/`/stop`/`/fast`/`/move`
 * appear in (review round 1, R1: without it those whole-draft commands stopped
 * running and their text went to a transport that refuses a leading slash). No
 * hand-kept list of command names exists, here or there.
 * `armedOnlyCommands` is the one narrowing on top of that union and it applies
 * to the DRAFT-OPENING branch alone: a word in it is never hoisted by a typed
 * draft that merely opens with it, only by the explicit pick (peer PR #209's
 * `/goal` rule), while its whole-draft form is untouched. The input stays
 * generic — this file names no command.
 *
 * THE POSITIONAL RULE IS SHARED WITH THE POPUP. `opensDraft` is
 * `commandWordOpensDraft` (`slash-token.ts`), and `caretPhase` — the popup's own
 * "which list is up" — calls the same function. A mid-draft word therefore
 * opens no list, which is what stops the popup recruiting a word this planner
 * reads as prose and consuming the first Enter to complete it (design round 1,
 * D1 = UX U2). Asking it in two places would have been two rules again.
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
 * Rule order:
 *
 *   0. A COMMAND-LOCKED word (`commandLockedWords`, today `/credential` and its
 *      alias) whose token carries a tail → the command: `splice` where something
 *      survives the token, `whole` where the token was the draft. Asked of the
 *      DRAFT ALONE and AHEAD of the caret and of the capability flag, because the
 *      fact the rule turns on is about the WORD rather than the position or the
 *      host: the tail is a SECRET, and the readings that must never be reachable
 *      are the ones that hand it to the model. See `lockedWordPlan`.
 *   1. The capability is off → send. Nothing else is spliced on a host that could
 *      not run the command it was deleted for.
 *   2. The token at the CARET (`slashTokenSpan`, which is what
 *      `_run_command_from_buffer` itself calls first) defines the span the run
 *      owns. No token at the caret → prose; send it. The whole-draft shape is
 *      NOT tested first, it is a CONSEQUENCE of this: a `/usage` on line 1 of a
 *      two-line draft is a token on its own LINE, so the caret on line 2 finds
 *      no token and the draft is prose (round 1 R2 = Q1 = U1).
 *   3. A slash-shaped token that names no command: the token IS the whole draft
 *      → `unrecognised`, so the dispatcher's "did you mean" note still answers a
 *      misspelling and the draft is kept to fix (round 1 U8). Anything else →
 *      prose, because a `/` inside a sentence is punctuation until its word is
 *      picked as a command.
 *   4. The token is the ENTIRE draft (nothing outside its span):
 *      - the word is followed by nothing, or the command takes an argument →
 *        `whole`: `/compact`, `/model gpt-5`, `/goal ship it`;
 *      - a command that takes NO argument has text after its word
 *        (`/compact hello`) → send. This is the operator's own report: `/compact
 *        hello` used to run and eat `hello`.
 *   5. The token OPENS the draft (its span begins at the first non-space
 *      character) AND the command takes an argument → a command, with the
 *      sub-rules kept from the old rule:
 *      - a free-text command reassembles to the front, STAGED, never submitted.
 *        Exception: a NAME+message command (`/team`, `/agent`) with no name typed
 *        yet does NOT reassemble on the word alone — the name is picked from the
 *        argument list first, and leaving that list open IS the interaction;
 *      - everything else splices the token out and runs it; the surrounding
 *        draft survives.
 *   6. Anything else — mid-sentence, on a later line, or a leading token with
 *      text after a command that takes no argument (`please /compact this`, or
 *      a `/usage` line above prose) → send. The draft reaches the model as
 *      written.
 *
 * THREE DELIBERATE DEVIATIONS FROM THE TUI, and the only three in this file, each
 * landed by a different round and all stated here rather than in the parser. The
 * first is rule 5's positional premise: the reference treats a command typed
 * mid-draft as a command, owning the rest of its own line, where a word sitting
 * in a sentence names no gesture — so only a token that OPENS the draft, or is
 * the whole of it, is one. The second is main's own and this branch keeps it
 * working: an ARMED-ONLY command (`armedOnlyCommands`, today `/goal`) is never
 * hoisted by this key at all, because its arming is an explicit PICK of its own
 * row in the popup (`planSlashArming`) — the report behind it was a request
 * rearranged with a note and a second Enter needed. WHICH words each holds for is
 * the registry's business, never a name written into this function. The third is
 * rule 0, and it is the reference's own rule that a mid-draft token owns the rest
 * of its line, given the ONE case where acting on it late is unrecoverable: a
 * word whose argument is a secret. Its asymmetry is stated at `lockedWordPlan`.
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

import {
	commandWordOpensDraft,
	replaceSpan,
	slashTokenSpan,
} from "./slash-token";

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

/**
 * The mark a plan carries when the word it runs is one of `commandLockedWords`.
 *
 * It exists because TWO plan kinds can be a locked run — `whole` when the token
 * was the draft, `splice` when the word sat in a sentence — and the composer owes
 * that run two things it owes no other: a sentence saying what happened to the
 * words after the word, and an undo that puts them back (the tail was a SECRET,
 * so a silent removal and a silent refusal are both worse here than anywhere
 * else in this file). The alternative — the composer asking its own "is this
 * draft locked" question — is the second decision this file exists to prevent.
 */
export type LockedRunMark = { locked?: true };

export type SlashSubmissionPlan =
	/**
	 * Not a command in this draft. Send the draft to the model — which is also the
	 * answer for a draft that merely CONTAINS an armed-only command's word.
	 */
	| { kind: "send" }
	/** The whole draft is the command: nothing survives removing its token. */
	| ({ kind: "whole"; command: SlashCommandInvocation } & LockedRunMark)
	/** Splice the token out of the draft, keep the rest, and run `command`. */
	| ({
			kind: "splice";
			start: number;
			end: number;
			command: SlashCommandInvocation;
			text: string;
			caret: number;
	  } & LockedRunMark)
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
	 * Names (primaries and aliases) of commands whose destination carries an
	 * inline argument list (`argumentVocabulary` in `slash-commands.tsx`, derived
	 * from `picker-registry`'s `inline` field).
	 *
	 * With `promptCommands` this is the `takesArgument` vocabulary: a command's
	 * trailing text is its argument if it consumes a free-text prompt OR a value
	 * chosen from a list. The union is taken in the rule rather than passed in as
	 * one set, so each half keeps its own single derivation.
	 */
	valueArgumentCommands: ReadonlySet<string>;
	/**
	 * Names (primaries and aliases) of commands whose registry entry declares an
	 * argument at all — `SlashCommandMeta.arguments` is `optional` or
	 * `required` (`slash-commands.tsx`, off the backend's own catalogue).
	 *
	 * THE THIRD SOURCE, and it is not a convenience: the other two are narrower
	 * than the field they approximate. `/login openai` is `arguments:
	 * "required"` with no inline list and no free-text prompt — the desktop
	 * forwards the typed word as the SELECTION
	 * (`desktop_commands.py:127`, `selection=args`) — so a union of those two
	 * read `/login openai` as prose and stopped a command that runs today
	 * (review round 1, R1; QA Q1 measured the live consequence: the send was
	 * refused, because a message may not start with `/`).
	 *
	 * Optional so a caller that has not wired it composes exactly as before
	 * rather than failing to build; the composer wires it.
	 */
	argumentCommands?: ReadonlySet<string>;
	/** Names of commands whose argument list is open before any name is typed. */
	nameListCommands: ReadonlySet<string>;
	/**
	 * Names (primaries and aliases) a typed draft may never hoist by opening with
	 * one: only an explicit pick arms such a command (peer PR #209's `/goal` rule,
	 * wired there from the registry's own `session.goal` rows).
	 *
	 * It narrows the draft-opening branch alone — the whole-draft `/goal <text>`
	 * form runs untouched — and it is optional, so a caller that has not wired it
	 * behaves exactly as the rest of this rule says. Generic on purpose: this file
	 * names no command, and the pick path cannot be affected by it.
	 */
	armedOnlyCommands?: ReadonlySet<string>;
	/**
	 * Words whose token plans as the COMMAND wherever it sits in the draft,
	 * whatever the caret says and whatever surrounds it.
	 *
	 * The CALLER's answer rather than names written into this file, because the
	 * fact that makes these words special belongs to the module that owns them:
	 * `/credential` and its alias take a SECRET as their argument, and the
	 * dispatcher strips that argument before command text is built for exactly
	 * that reason (`slash-dispatch.ts`). A MESSAGE is not something the dispatcher
	 * can strip, so the reading this file's prose rule gives every other word —
	 * send it — would post the secret to the model, silently and unrecoverably,
	 * while the reading the locked words get fails in front of the user instead
	 * (a refused command). `credential-capture.ts` owns the spellings.
	 *
	 * EMPTY BY DEFAULT, and it must stay empty for a caller that has not thought
	 * about it: a host that knows nothing about credentials cannot acquire the
	 * behaviour by omission. See `lockedWordPlan` for the rule itself.
	 */
	commandLockedWords?: ReadonlySet<string>;
	/**
	 * The word whose UN-MASKED RUN this draft carries, when the composer's own cancel
	 * record says it put characters back (`CancelledToken.restored > 0`) — or absent
	 * for every other draft, which is the default and the whole of "no other caller
	 * can acquire this by accident".
	 *
	 * It is the one input that lets a slash which does not OPEN a word count as a
	 * token, and the one that lets the run be taken when an edit has broken the word
	 * entirely (QA round 5, Q-1; UX round 5, U19/U20). Both are the same fact: this
	 * app un-masked characters into THIS draft, so the words in it are credential
	 * material rather than the model's, and the record is the only thing that can tell
	 * it apart from prose that merely mentions the word. See `lockedWordPlan`.
	 */
	unmaskedRunWord?: string;
	/** Whether a boundary slash token is a command at all (the feature is on). */
	enabled: boolean;
	/**
	 * WHICH GESTURE is asking, because the two answers are deliberately different.
	 *
	 * A typed word in the middle of a sentence is prose (the operator's rule, and
	 * this file's reason for existing). A PICK of that command's own row is not a
	 * typed word: the user chose the command from the popup, so it is a command
	 * wherever it sits, and the pick's run path reads this to keep the promise the
	 * footer makes ("Click stages /loop." — peer PR #209's `hoists`/`takesDraft`
	 * machinery, which postdates the typed rule and would otherwise be inert).
	 *
	 * Defaulted to `"typed"`, so every caller that has not thought about it gets the
	 * conservative answer, and the pick path is the only one that passes anything.
	 */
	gesture?: "typed" | "pick";
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
/** The default for an input a caller has not wired yet; never mutated. */
const EMPTY_COMMANDS: ReadonlySet<string> = new Set<string>();

/** The lower-cased command word of a token's text, `/team ops` → `team`. */
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

/**
 * One locked word as a literal alternative in a `RegExp`.
 *
 * The only part of the locked-word rule that is not a fact about drafts: the
 * words arrive as a SET from the caller rather than as a pattern this file
 * wrote, and an unescaped metacharacter in one of them would either change what
 * is matched (`c.ed`) or throw at construction. Escaping is the whole of the
 * defence, and it is cheaper than refusing a set that carries one — refusing
 * would turn a caller's typo into a rule that silently does nothing.
 */
function literalWord(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The end of the line the offset sits on: where a token's own span ends.
 *
 * `indexOf` rather than `lineOfCursor`, because a `/` alone is all this scan has:
 * the helper takes a CARET and this rule has none. The CRLF strip is the one
 * behaviour that has to be reproduced faithfully rather than approximated, since
 * `lineOfCursor` does it for every other reader of a token's word and a `\r` left
 * on the end of an argument would be a second way to spell a token the stream
 * pastes (review round 1, minor-1).
 */
function tokenLineEnd(draft: string, index: number): number {
	const newline = draft.indexOf("\n", index);
	const end = newline === -1 ? draft.length : newline;
	return draft[end - 1] === "\r" ? end - 1 : end;
}

/**
 * The splice a COMMAND-LOCKED word's token takes, or `null`.
 *
 * ASKED OF THE DRAFT ALONE, and the placement of its one call is the whole of
 * this rule rather than a detail of it: `slashTokenSpan` claims the token at the
 * CARET, so a locked word typed mid-sentence with the caret anywhere but on it —
 * at column 0 above all — has no span at all, answers `send` at the early return
 * three lines into `planSlashSubmission`, and posts the secret to the model as
 * message text. Asking here, AHEAD of that return, is what makes the answer the
 * same at every caret.
 *
 * WHY THIS WORD AND NOT EVERY WORD is the asymmetry the caller's set encodes, and
 * it decides the DIRECTION of the whole rule: a `/credential` argument is a
 * SECRET, the dispatcher strips it before command text is built for exactly that
 * reason, and a message is not something the dispatcher can strip. So one
 * direction is silent and unrecoverable (the secret is in the transcript, and no
 * keystroke undoes it) while the other fails in front of the user, in the
 * command's own refusal — and the visible failure is the one to prefer. That is
 * also why a draft merely MENTIONING the command with words after it now plans as
 * the command: the cost of reading prose as a gesture is a refusal the user can
 * see and undo, and the cost of the reverse is a leaked secret.
 *
 * FOUR CONJUNCTS, each narrowing rather than decorating:
 *
 *   - the word is one the CALLER locked, and it is spelled as a token (a
 *     boundary `/`, the word, then whitespace or the end: `/credentials` is not
 *     one — the matcher's `(?!\S)` draws the same line as `CREDENTIAL_TOKEN`);
 *   - a NON-EMPTY TAIL, because the invocation being planned is `/credential
 *     <secret>`: a bare mid-draft token is the composer's own arming gesture, and
 *     the capture owns it rather than this planner;
 *   - a surviving REST, because the whole-draft form is ALREADY the command — the
 *     shape `credential-capture`'s own suite pins for `/credential <args>` — and
 *     this branch may not move it;
 *   - a word the host KNOWS (`commandNames`), so the rule cannot invent a command
 *     for a word the catalogue does not advertise.
 *
 * THE SPAN IS THE TOKEN'S OWN LINE, derived here rather than asked of
 * `slashTokenSpan` — THE ONE PLACE IN THIS FILE THAT DERIVES ONE, and the reason
 * is a difference between two questions. That helper answers "which token does the
 * CARET own", and its answer runs through the tokenizer's CLAIMING rule: once a
 * recognised command word is space-terminated the rest of its line is that
 * command's ARGUMENT, so a `/credential` behind a `/team ops` is text the
 * tokenizer hands back as `/team`'s. This rule asks a different question — does
 * this draft CONTAIN a locked word with an argument — and it may not answer it the
 * caret's way, because the draft is what the model is handed: a locked word inside
 * another command's argument leaks exactly the same secret as one standing alone
 * (`please /team ops /credential <secret>` is sent whole today), and the claim is
 * a rule about EDITING a line rather than about what that line holds. So the
 * slash, the locked word, and the end of ITS OWN line is the whole of the span:
 * the tokenizer's own end, and its own start for every shape but that nested one.
 *
 * AND THE SLASH DOES NOT HAVE TO OPEN A WORD (QA round 4, Q-1). The tokenizer's
 * left boundary exists so a `/` inside a word is punctuation rather than a
 * command — a path, a ratio, `n/2` — and for an ORDINARY word that reading is
 * untouched. For a LOCKED word the question is not which word the user meant but
 * whether a secret is about to travel as message text, and the measurement is
 * blunt about what the boundary cost here: type `/credential <secret>`, press the
 * app's own Escape (whose sentence says Enter will take those characters as the
 * command's argument), press Home and type one character in front of the slash —
 * the draft is now `x/credential <plaintext>`, the boundary is gone, this rule
 * found nothing, the draft no longer started with `/` so the leading-slash
 * refusal had no part of it, and the press put the value into a message record and
 * a provider request body. The value was the one the APP had just un-masked.
 *
 * AND IT IS SCOPED TO THE DRAFT THE APP ITSELF UN-MASKED (QA and UX round 5).
 * The first form of the widening above dropped the boundary for EVERY draft, and
 * the price was measured on both sides of the seam: UX watched a sentence —
 * `the docs/credential rotation policy is stale` — be truncated to `the docs` and
 * answered with a Credential dialog that no press could ever dismiss into a send,
 * and QA watched that same in-word prose stop being sendable at all. So the
 * boundary is required again for every draft BUT one: the draft the composer's
 * cancel record says it put characters back into. Those drafts carry the reason
 * this rule exists, and an ordinary path or URL is prose again.
 *
 * WHAT IS LEFT, STATED RATHER THAN IMPLIED: a FRESH draft that misspells the word
 * and was never cancelled (`please /credxential <secret>`, no Escape) stays prose,
 * because nothing but the user knows the word was meant as a command — the same on
 * `main`. The record is the only thing that can tell those two apart, and it only
 * exists where the app un-masked something.
 *
 * ONE PASS, AND NOTHING IS EVER ASKED PER `/`. The scan is a single `exec` walk
 * over the draft plus arithmetic on each match, so a draft full of `/`s costs the
 * same as a draft with none, and the tokenizer — whose `activeSlash` rebuilds its
 * line's boundary-slash list at every call — is not entered at all. That is the
 * cost this rule has to keep, because it runs on every keystroke of every draft,
 * through `planSlashSubmission`.
 */
function lockedWordPlan(
	draft: string,
	caret: number,
	commandNames: ReadonlySet<string>,
	lockedWords: ReadonlySet<string>,
	unmaskedRunWord: string | undefined,
): SlashSubmissionPlan | null {
	/*
	 * THE WORDS ARE FOLDED HERE, once, and both questions below ask the folded set.
	 * The caller hands over a vocabulary and this rule asks it twice — the
	 * alternation that finds a token, and the membership test that confirms the
	 * token's word — so a caller who spelled one with a capital used to get a rule
	 * that silently did nothing: the pattern matched and the test refused it
	 * (review F6). A word that folds to nothing is dropped rather than escaped into
	 * an alternation that would match a bare `/`.
	 */
	const words = new Set(
		[...lockedWords].map((word) => word.toLowerCase()).filter(Boolean),
	);
	/*
	 * THE WORD WHOSE UN-MASKED RUN THIS DRAFT CARRIES, when the composer's own cancel
	 * record says it put characters back — and the ONE thing that lets a slash which
	 * does not open a word count as a token. The caller hands over the word the record
	 * was built for (its own spelling, `/` and separator included when it arrives that
	 * way), and `undefined` for every other draft.
	 */
	const runWord = (unmaskedRunWord ?? "")
		.toLowerCase()
		.replace(/^\//, "")
		.trim();
	// An unwired or empty vocabulary, on a draft the app never un-masked, is the whole
	// of "no other caller can acquire this by accident": the walk below never runs. A
	// draft that DOES carry a run is the one exception, because the spelling of the
	// word in it may no longer be the spelling this vocabulary holds.
	if (words.size === 0 && runWord === "") return null;
	/*
	 * THE LEFT BOUNDARY IS REQUIRED, AND ONLY THE RECORD LIFTS IT. It exists so a `/`
	 * inside a word is punctuation rather than a command — a path, a ratio, `n/2` —
	 * and dropping it for every draft turned that prose into a credential dialog and
	 * an unsendable sentence (UX round 5, U19/U20). A draft carrying a run is the one
	 * place where an in-word slash cannot be punctuation: the app itself un-masked
	 * characters for a word, and the user is editing them.
	 */
	const boundary = runWord === "" ? "(?:^|(?<=\\s))" : "";
	const token = new RegExp(
		`${boundary}\\/(?:${[...words].map(literalWord).join("|")})(?!\\S)`,
		"gi",
	);
	for (
		let match = token.exec(draft);
		match !== null;
		match = token.exec(draft)
	) {
		const index = match.index;
		const end = tokenLineEnd(draft, index);
		const typed = invocationOf(draft.slice(index, end).trim());
		const word = typed.name.toLowerCase();
		if (!words.has(word)) continue;
		// A bare token is NOT this rule's: `/credential ` is the composer's own
		// arming gesture, and the capture owns it rather than the planner.
		if (typed.args === "") continue;
		/*
		 * THE NAME THE CATALOGUE KNOWS THE WORD BY, whenever it knows one. This rule
		 * case-folds and the dispatcher does NOT (`slash-dispatch.ts` resolves
		 * `command.name === word` then `aliases.includes(word)`), so handing the
		 * typed spelling over made `/Cred <secret>` answer "Unknown command /Cred"
		 * over a draft whose tail it had already taken — safe, and untrue about the
		 * user's own sentence (review F3). The catalogue's own spellings are
		 * lower-cased (`slash-commands.tsx` builds every vocabulary that way), so the
		 * folded word IS the catalogue's spelling; a word the catalogue does not
		 * advertise keeps the spelling the user typed, which is what the dispatcher's
		 * own "Unknown command /…" note quotes back.
		 */
		const known = commandNames.has(word);
		const command = known ? { name: word, args: typed.args } : typed;
		return runPlan(draft, caret, index, end, command, known);
	}
	/*
	 * THE RUN THE APP PUT BACK, whose word an edit has broken (QA round 5, Q-1).
	 *
	 * An edit INSIDE the word (`/credxential`), one immediately AFTER it
	 * (`/credentiaxl`) or a Backspace inside it leaves the draft holding the characters
	 * the Escape had just un-masked, with no token this vocabulary can find and, for
	 * the inside cases, no token the composer's `recordWord` can find either — so the
	 * gesture degraded to prose, the prose rule handed the draft to the model, and the
	 * draft no longer started with `/` so the leading-slash policy had no part of it.
	 * Measured on the real app: a message record and a provider request body carrying
	 * the canary, byte-identical on the pre-fold head and on `main`.
	 *
	 * The record is what the word's own spelling cannot be: it says WHICH WORD was
	 * holding characters here (`unmaskedRunWord`) and that they came back. So the
	 * draft's first slash token is taken as that word's run — the same span the scan
	 * above would have taken, the same `locked: true`, the same receipt and undo — and
	 * the dispatcher is handed the recorded word with the tail as its argument, which
	 * is refused as command-line text and never sent. The user's own prose before the
	 * token stays in the box; the undo returns everything the run took.
	 *
	 * ITS COST, stated: inside such a draft any slash token is read this way, including
	 * one the user wrote as a path, and the words after it go as the command's argument
	 * until this edit is undone. That window is the app's own — the record exists only
	 * between an Escape and the next send, dispatch or conversation change — and the
	 * alternative was measured too: the secret in a provider body.
	 */
	if (runWord === "") return null;
	const broken = /\/[^\s/]+/.exec(draft);
	if (broken === null) return null;
	const brokenIndex = broken.index;
	const brokenEnd = tokenLineEnd(draft, brokenIndex);
	const brokenTyped = invocationOf(draft.slice(brokenIndex, brokenEnd).trim());
	return runPlan(
		draft,
		caret,
		brokenIndex,
		brokenEnd,
		{ name: runWord, args: brokenTyped.args },
		commandNames.has(runWord),
	);
}

/*
 * WHAT ONE RUN'S PLAN IS, given the span it owns and the command it hands the
 * dispatcher — asked by the scan above for a word the draft still spells, and by the
 * broken-word path for the word the record remembers. It is ONE function because the
 * two must answer identically: the receipt, the undo, the caret and the dispatcher's
 * own reading are all consequences of this object, and a second construction would be
 * a second answer to "what did this press do".
 */
function runPlan(
	draft: string,
	caret: number,
	index: number,
	end: number,
	command: SlashCommandInvocation,
	known: boolean,
): SlashSubmissionPlan {
	const rest = replaceSpan(draft, index, end, "");
	/*
	 * NOTHING SURVIVES THE TOKEN: the whole-draft form, and the one shape this
	 * rule takes that the caret-led path also reaches. It is answered here rather
	 * than left to the arm below for a measured reason (UX round 1, U1): that arm
	 * reads the word's trailing text as its argument only when the CATALOGUE says
	 * the command takes one, and a stale or still-loading catalogue read it as a
	 * sentence and SENT the secret — the same fail-open review F1 found on the
	 * other side of this rule. A locked word's tail is its argument by definition,
	 * so the answer does not depend on what the catalogue says about arguments:
	 * `whole` where the word is one the host can run, and `unrecognised` — which
	 * runs the dispatcher's own "unknown command" note and KEEPS the draft — where
	 * it is not, because a catalogue that cannot resolve the word must not be able
	 * to destroy the user's whole draft either.
	 */
	if (rest.text.trim() === "")
		return known
			? { kind: "whole", command, locked: true }
			: { kind: "unrecognised", command };
	/*
	 * A surviving REST still splices, whether or not the catalogue knows the word:
	 * an unadvertised word reaches the dispatcher's `!spec` branch, which notes
	 * "Unknown command /…" and returns `consumed`, so the tail is deleted and
	 * never sent — the visible failure rather than the silent leak (review F1).
	 *
	 * THE CARET IS CLAMPED, not moved to the splice point: `rest.caret` is where
	 * the removal ended, and a draft that arrived whole with the caret at column 0
	 * used to jump 28 columns for no reason the user could see (design D5). A caret
	 * the removal swallowed collapses to the splice point, which is what an editor
	 * does.
	 */
	/*
	 * THE CARET MOVES BY WHAT THE REMOVAL TOOK, AND NO FURTHER (design D5, code review
	 * round 2 MINOR 2). The survivor is `draft.slice(0, rest.caret)` +
	 * `draft.slice(rest.caret + removed)`, so the three cases are the three positions a
	 * caret can be in: BEFORE the splice point it is untouched, at or after the END of
	 * the removed run it shifts back by exactly that run, and inside the run it
	 * collapses onto the splice point — what an editor does with a deleted selection.
	 *
	 * The first version clamped to `rest.caret` for everything past the token, which
	 * moved a caret the removal never swallowed: on a multi-line draft with the caret
	 * on a SURVIVING line it jumped back to line 1's splice point (measured on the real
	 * planner: `please /credential C\r\nand then ship it` at the caret at the end gave
	 * 6, where line 2 had survived the run entire).
	 */
	const removed = draft.length - rest.text.length;
	const after = rest.caret + removed;
	return {
		kind: "splice",
		start: index,
		end,
		command,
		text: rest.text,
		caret:
			caret <= rest.caret
				? Math.max(caret, 0)
				: caret >= after
					? caret - removed
					: rest.caret,
		locked: true,
	};
}

export function planSlashSubmission({
	draft,
	caret,
	commandNames,
	promptCommands,
	armedOnlyCommands,
	valueArgumentCommands,
	nameListCommands,
	argumentCommands,
	commandLockedWords,
	unmaskedRunWord,
	enabled,
	gesture = "typed",
}: SlashSubmissionArgs): SlashSubmissionPlan {
	/*
	 * The command-locked word, asked of the DRAFT alone and ahead of the caret —
	 * see `lockedWordPlan` for why the position of this call IS the rule. A locked
	 * word with a tail is a command at every caret, and the caret can therefore
	 * never be the thing that decides which way a secret goes.
	 *
	 * AND AHEAD OF THE CAPABILITY FLAG, which is the fail-CLOSED direction review F2
	 * asked for. The flag lives on the capability query (`commands`), not on the
	 * command catalogue, and it is off for the first moments of every boot and for
	 * every host whose backend does not publish the feature — so asking it first left
	 * the secret travelling to the model on exactly the drafts this rule exists for.
	 * Closed is the right direction here because the two failures are not the same
	 * size: a plan that cannot run leaves the words in the box, where the user still
	 * owns them (the dispatcher restores the draft it could not address, and an
	 * absent dispatcher leaves the box untouched), while a `send` they cause is
	 * unrecoverable. Every OTHER word keeps the old order: the capability flag still
	 * turns the planner off for them, which is the behaviour the suite pins.
	 */
	const locked = lockedWordPlan(
		draft,
		caret,
		commandNames,
		commandLockedWords ?? EMPTY_COMMANDS,
		unmaskedRunWord,
	);
	if (locked !== null) return locked;

	// The capability flag: when `commands` is off, nothing else is spliced and
	// nothing is lost — the same fallback the model path already has. A splice that
	// ran here would delete text on a backend that cannot run the command it was
	// deleted for.
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
	const word = wordOf(commandText);

	/*
	 * The two positional facts the whole rule is written against, each read ONCE
	 * from the span rather than re-derived downstream.
	 *
	 * `wholeDraft` is "nothing survives removing the span", the shape the plan
	 * kind `whole` is named for. `opensDraft` is "the span begins at the draft's
	 * first non-space character", which is the operator's "at the start of the
	 * input". They overlap (a whole draft opens it) and they are asked in that
	 * order because the whole-draft form is the stricter one and has sub-rules of
	 * its own.
	 */
	const wholeDraft = spliced.text.trim() === "";
	const opensDraft = commandWordOpensDraft(draft, span.start);

	// Slash-shaped but not a command this host knows. The misspelling is the
	// thing to fix, so the caller reports it and keeps the draft rather than
	// consuming it (round 1 U8) — but only where the token WAS the draft: a `/`
	// inside a sentence nobody picked is punctuation, and a "did you mean" for it
	// would be a note about a word the user never offered as a command.
	if (!commandNames.has(word))
		return wholeDraft ? { kind: "unrecognised", command } : { kind: "send" };

	/*
	 * Whether this command's trailing text is its ARGUMENT — the single test the
	 * rule turns on. Three sources, because the registry declares the fact three
	 * ways and none of them covers the others: `consumes_prompt` is the free-text
	 * half, `valueArgumentCommands` is the list-chosen half
	 * (`inlineArgumentFor`), and `argumentCommands` is the declaration itself
	 * (`arguments`), which is the only one `/login` appears in (R1).
	 */
	const consumesText =
		promptCommands.has(word) ||
		valueArgumentCommands.has(word) ||
		(argumentCommands ?? EMPTY_COMMANDS).has(word);
	/*
	 * And whether the word is armed ONLY by an explicit pick. This narrows the
	 * DRAFT-OPENING branch alone, never the whole-draft one, because that is what
	 * the rule it comes from says: `/goal ship the release` (the whole draft) runs
	 * on one Enter, while a `/goal` that merely opens a longer draft is prose
	 * until the pick arms it (peer PR #209, rows 1 and 6).
	 */
	const armedOnly = (armedOnlyCommands ?? EMPTY_COMMANDS).has(word);

	if (wholeDraft) {
		// The token is the draft. With nothing after the word it is the command
		// (`/compact`, `/usage`); with text after it, that text is the command's
		// argument only if the command takes one (`/model gpt-5`, `/goal ship
		// it`). A no-argument command with trailing text is the operator's own
		// report — `/compact hello` ran and ate `hello` — so the draft is prose.
		if (!consumesText && command.args) return { kind: "send" };
		return { kind: "whole", command };
	}

	// Not the whole draft: only a token that OPENS the draft, for a command whose
	// trailing text IS its argument and which a typed draft may hoist at all, is
	// a command. Anything else is the sentence the user is writing, and it is sent
	// as written.
	if (!consumesText || armedOnly) return { kind: "send" };
	if (!opensDraft && gesture !== "pick") return { kind: "send" };

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
	if (armedOnly) return { kind: "send" };

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
