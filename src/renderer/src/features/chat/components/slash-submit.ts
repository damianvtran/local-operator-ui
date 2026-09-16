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
 * Rule order:
 *
 *   0. The capability is off → send. Nothing is spliced on a host that could not
 *      run the command it was deleted for.
 *   1. The token at the CARET (`slashTokenSpan`, which is what
 *      `_run_command_from_buffer` itself calls first) defines the span the run
 *      owns. The rule below is then applied to that span.
 *   2. No token at the caret → the DRAFT-OPENING fallback, and only that: the
 *      draft's LEADING line is evaluated as if the caret were inside its command
 *      word. Without it the caret decides an outcome it cannot express — a
 *      `/model gpt-5\nplease check the logs` whose caret reached column 0 (Home,
 *      or select-all collapsed to the start) planned `send`, while the same
 *      draft ran the command a keystroke earlier. It cannot fire on a draft that
 *      does not OPEN with a command word, so a slash mid-sentence, on a later
 *      line, or in ordinary prose is unaffected (prose → send).
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
 *      character) AND the command takes an argument AND it is not armed-only →
 *      a command, with the sub-rules kept from the old rule:
 *      - a free-text command reassembles to the front, STAGED, never submitted.
 *        Exception: a NAME+message command (`/team`, `/agent`) with no name typed
 *        yet does NOT reassemble on the word alone — the name is picked from the
 *        argument list first, and leaving that list open IS the interaction;
 *      - everything else splices the token out and runs it; the surrounding
 *        draft survives.
 *   6. Anything else — mid-sentence, on a later line, a leading token whose
 *      command takes no argument (`please /compact this`, `/usage\nfix this`),
 *      or an armed-only command that merely opens the draft → send. The draft
 *      reaches the model as written.
 *
 * ONE DELIBERATE DEVIATION FROM THE TUI, and the only one in this file: rule 5's
 * and rule 6's armed-only clause.
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
 * What a VALID argument for a command is, as the wire reports it.
 *
 * The field exists because "does this command own its trailing text" turned out
 * to be too coarse to answer the operator's report: `/mcp logout` is a command
 * and `/mcp logout seems to cause a crash` is a message, and both are "a command
 * word with text after it". The endpoint refuses exactly the whole-draft texts
 * that are valid under a shape, so the composer reads the same field rather than
 * guessing at the boundary.
 */
export type ArgumentShape = "none" | "word" | "provider" | "subcommand" | "any";

/** One row's shape, and the vocabulary its first token must come from. */
export type ArgumentShapeRow = {
	shape: ArgumentShape;
	/** Empty means ANY single token, never "no token at all". */
	words: ReadonlySet<string>;
};

/** A registry row, as far as the shapes are concerned. */
export type ArgumentShapeCatalogueRow = {
	name: string;
	aliases: readonly string[];
	argument_shape?: ArgumentShape;
	argument_words?: readonly string[];
	/**
	 * The wire's own `arguments` mode (`none`/`optional`/`required`), which every
	 * released backend has sent since long before `argument_shape` existed. It is
	 * the SECOND source a backend without shapes is read from, because dropping to
	 * "no text is ever an argument" would stop `/mcp logout`, `/login openai`,
	 * `/rename <title>` and `/move <path>` from running at all on the backend the
	 * app installs today — measured, and a regression against `main` (QA Q1).
	 */
	arguments?: string;
};

/**
 * The shapes, keyed by every primary and alias.
 *
 * A row that carries no `argument_shape` is LEFT OUT rather than defaulted to
 * `any`: absence is the backend predating the field, which is the one case the
 * planner answers from its own vocabulary (`prefixingVocabulary`) instead. The
 * distinction matters — a default would silently make every older backend's rows
 * accept arbitrary text.
 */
export function argumentShapeVocabulary(
	commands: readonly ArgumentShapeCatalogueRow[],
): Map<string, ArgumentShapeRow> {
	const shapes = new Map<string, ArgumentShapeRow>();
	for (const command of commands) {
		if (!command.argument_shape) continue;
		const row: ArgumentShapeRow = {
			shape: command.argument_shape,
			words: new Set(
				(command.argument_words ?? []).map((word) => word.toLowerCase()),
			),
		};
		shapes.set(command.name.toLowerCase(), row);
		for (const alias of command.aliases) shapes.set(alias.toLowerCase(), row);
	}
	return shapes;
}

/**
 * Whether `args` is a valid argument for `shape` — the same test the messages
 * endpoint's admission rule applies to a whole draft.
 *
 * The empty string is deliberately NOT answered here: "the word and nothing
 * else" is the whole-draft form the rule states separately, and answering it
 * from a shape would make `/rename` (shape `any`) depend on its vocabulary
 * rather than on being a complete command.
 */
export function argumentFits(shape: ArgumentShapeRow, args: string): boolean {
	const trimmed = args.trim();
	if (trimmed === "") return false;
	const tokens = trimmed.split(WHITESPACE);
	const firstKnown =
		shape.words.size === 0 || shape.words.has(tokens[0].toLowerCase());
	switch (shape.shape) {
		case "none":
			return false;
		case "word":
		case "provider":
			return tokens.length === 1 && firstKnown;
		case "subcommand":
			return tokens.length <= 2 && firstKnown;
		case "any":
			return true;
	}
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
	 * Names (primaries and aliases) of commands whose trailing text is an
	 * ARGUMENT the command owns, over and above the free-text prompt: the value
	 * commands (`/model gpt-5`, `/theme dark`, `/effort high`), whose trailing
	 * text is a value chosen from a list rather than a message.
	 *
	 * Fed from the registry row's own `prefixes_text` field when the backend
	 * carries it, and from the inline argument lists the renderer already
	 * derives (`argumentVocabulary` in `slash-commands.tsx`, from
	 * `picker-registry`'s `inline` field) when it does not — an older backend
	 * must not change behaviour here. With `promptCommands` this is the
	 * `consumesText` vocabulary; the union is taken in the rule rather than
	 * passed in as one set, so each half keeps its own single derivation.
	 */
	prefixingCommands: ReadonlySet<string>;
	/**
	 * Per-word argument SHAPES from the wire (`argument_shape`/`argument_words`),
	 * keyed by every primary and alias. Present only for a backend that sends the
	 * field; a word absent from the map is answered by the vocabulary fallback
	 * below, which is what an older backend gets for every word.
	 */
	argumentShapes?: ReadonlyMap<string, ArgumentShapeRow>;
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
	/**
	 * Words whose token DISPATCHES wherever it sits in the draft.
	 *
	 * The caller's answer rather than a name written here, and there is exactly one
	 * such word in the product: `/credential`, whose argument is a SECRET. The
	 * dispatcher strips that argument before it becomes command text for that reason
	 * (`slash-dispatch.ts:523-525`), so a mid-draft token the prose rule called a
	 * message would send the secret to the model instead. Measured rather than
	 * argued: `scripts/credential-composer.test.mjs`'s moved-token case asserts the
	 * Escaped token dispatches again once an edit moves it, and this branch answered
	 * `send` for it (`please /credential SECRET` -> `send`).
	 */
	commandLockedWords?: ReadonlySet<string>;
	/** Whether a boundary slash token is a command at all (the feature is on). */
	enabled: boolean;
};

/**
 * The shapes an older backend leaves: none. Named rather than a bare `new Map()`
 * at the use so "the wire said nothing" is a value the planner can be read
 * against — and it selects the fallback path, never a defaulted shape.
 */
const NO_SHAPES: ReadonlyMap<string, ArgumentShapeRow> = new Map();

/** No command-locked words: the caller's set is the whole vocabulary. */
const NO_WORDS: ReadonlySet<string> = new Set();

/** The name/argument separator: the first whitespace character of a token. */
const WHITESPACE = /\s/;

/** The first non-whitespace character of a draft, or -1. */
const FIRST_CONTENT = /\S/;

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

type Vocabularies = {
	commandNames: ReadonlySet<string>;
	promptCommands: ReadonlySet<string>;
	prefixingCommands: ReadonlySet<string>;
	nameListCommands: ReadonlySet<string>;
	armedOnlyCommands: ReadonlySet<string>;
	argumentShapes: ReadonlyMap<string, ArgumentShapeRow>;
	commandLockedWords: ReadonlySet<string>;
};

/**
 * The plan a span earns, given the vocabularies. The ONE implementation of the
 * rule: the caret path and the draft-opening fallback both come through here,
 * which is what makes their outcome identical by construction rather than by
 * two branches being kept in step by hand.
 */
function planForSpan(
	draft: string,
	span: { start: number; end: number },
	{
		commandNames,
		promptCommands,
		prefixingCommands,
		nameListCommands,
		armedOnlyCommands,
		argumentShapes,
		commandLockedWords,
	}: Vocabularies,
): SlashSubmissionPlan {
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
	const opensDraft = draft.slice(0, span.start).trim() === "";

	// Slash-shaped but not a command this host knows. The misspelling is the
	// thing to fix, so the caller reports it and keeps the draft rather than
	// consuming it (round 1 U8) — but only where the token WAS the draft: a `/`
	// inside a sentence nobody picked is punctuation, and a "did you mean" for it
	// would be a note about a word the user never offered as a command.
	if (!commandNames.has(word))
		return wholeDraft ? { kind: "unrecognised", command } : { kind: "send" };

	/*
	 * Whether this command's trailing text is its ARGUMENT — the single test the
	 * rule turns on. `promptCommands` is the free-text half (`consumes_prompt`),
	 * `prefixingCommands` is the value half (`prefixes_text`, or the renderer's
	 * own `inlineArgumentFor` derivation against an older backend).
	 */
	const consumesText = promptCommands.has(word) || prefixingCommands.has(word);
	/*
	 * And whether the word is armed ONLY by an explicit pick. This narrows the
	 * DRAFT-OPENING branch alone, never the whole-draft one, because that is what
	 * the rule it comes from says: `/goal ship the release` (the whole draft) runs
	 * on one Enter, while a `/goal` that merely opens a longer draft is prose
	 * until the pick arms it (peer PR #209, rows 1 and 6).
	 */
	const armedOnly = armedOnlyCommands.has(word);

	if (wholeDraft) {
		// The token is the draft. With nothing after the word it is the command
		// (`/compact`, `/usage`); with text after it, that text is the command's
		// argument only if a valid argument is what it is (`/model gpt-5`, `/goal
		// ship it`, `/mcp logout`), and a draft whose trailing text is not one is a
		// message (`/compact hello`, `/mcp logout seems to cause a crash`, the
		// operator's own report).
		if (command.args === "") return { kind: "whole", command };
		/*
		 * THE VOCABULARY FIRST, and unconditionally: `consumes_prompt ∪
		 * prefixes_text` is "this command's trailing text is its argument", so the
		 * whole-draft form of such a command is a command with ANY text after it.
		 * The endpoint refuses exactly that, and checking the shape first inverted
		 * the precedence on the words that carry `argument_shape: "none"` — `none`
		 * describes the OTHER half (a command whose text is a selector, where no
		 * text is ever its argument), and reading it first sent every
		 * `/team ops fix this`-shaped draft to the endpoint to be refused.
		 */
		if (consumesText) return { kind: "whole", command };
		/*
		 * A BACKEND THAT PUBLISHES NO SHAPE GETS `main`'s RULE, EXACTLY.
		 *
		 * The wire's shape is what makes the prose rule expressible: it is the only
		 * source that can say "this command owns a selector token" (`/usage on` runs
		 * while `/usage more prose` is a message) or "this one takes any text"
		 * (`/rename my title`). The released backend sends no such field, and the
		 * two half-answers tried here before it were both wrong in the same way —
		 * reading `arguments: none` for every row stopped `/mcp logout`, `/login
		 * openai`, `/rename <title>` and `/move <path>` from running at all (QA round
		 * 1 Q1, measured base vs head on the wire), and reading `arguments: optional`
		 * as "owns text" still sent `/usage on` to the messages endpoint, where the
		 * old blanket policy refuses it (QA round 2 Q1, UX round 2 U1).
		 *
		 * So for this pairing the composer stops guessing: a whole-draft command word
		 * with trailing text is a command, full stop, which is what `main` does and
		 * what the released endpoint's own admission rule expects. The cost is stated
		 * rather than hidden — on that backend `/compact hello` runs as `/compact
		 * hello` and a single-line `/mcp logout seems to cause a crash` goes to the
		 * command route — and the operator's prose rule arrives with the backend
		 * release that publishes the shapes. No third vocabulary is invented for a
		 * pairing that cannot express the distinction.
		 */
		const shape = argumentShapes.get(word);
		if (shape) {
			return argumentFits(shape, command.args)
				? { kind: "whole", command }
				: { kind: "send" };
		}
		/* See above: no shape on the wire is `main`'s rule, exactly. */
		return { kind: "whole", command };
	}

	/*
	 * COMMAND-LOCKED: this word's token is a command wherever it sits, and it leaves
	 * the draft behind exactly as it would have before the prose rule (the splice the
	 * branch below still does for an opening value command).
	 *
	 * The prose rule's justification is that the surviving text is a sentence
	 * somebody meant to write. That is true of `/compact hello` and false of a token
	 * whose argument is a SECRET: there the sentence would carry the secret, and the
	 * only thing the dispatcher can strip is command text it is handed - not a message
	 * it never sees. See `commandLockedWords` for the measurement.
	 */
	if (commandLockedWords.has(word)) {
		return {
			kind: "splice",
			start: span.start,
			end: span.end,
			command,
			text: spliced.text,
			caret: spliced.caret,
		};
	}

	// Not the whole draft: only a token that OPENS the draft, for a command whose
	// trailing text IS its argument and which a typed draft may hoist at all, is
	// a command. Anything else is the sentence the user is writing, and it is sent
	// as written.
	if (!consumesText || armedOnly || !opensDraft) return { kind: "send" };
	if (promptCommands.has(word)) {
		// A name-list command with no name typed yet: `_apply_command` has
		// already completed the word to `/team ` and opened the roster list;
		// leaving it open is the whole interaction, and reassembly happens when
		// a NAME row is chosen (TUI `editor.py:8219-8222`).
		if (nameListCommands.has(word) && !command.args)
			return { kind: "list-open", command };
		return {
			kind: "reassemble",
			...stagedLine(commandText, spliced.text.trim()),
		};
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
 * The span of the command word that OPENS the draft, or `null`.
 *
 * Asked only when no token sits at the caret, and answered by the SAME
 * tokenizer the caret path uses: the caret is placed just inside the leading
 * `/`, so the span is whatever `slashTokenSpan` says it is — including its
 * end-of-LINE rule and its CRLF handling. A third line-based reading of the
 * draft here is exactly how the two hosts would drift apart again.
 *
 * It cannot claim prose: the leading character must be a `/`, and everything
 * after it is judged by `planForSpan` (which sends anything whose word is not a
 * command, and anything whose command takes no argument).
 */
function draftOpeningSpan(
	draft: string,
	commandNames: ReadonlySet<string>,
): { start: number; end: number } | null {
	const start = draft.search(FIRST_CONTENT);
	if (start === -1 || draft[start] !== "/") return null;
	const span = slashTokenSpan(draft, start + 1, commandNames);
	if (span === null || span.start !== start) return null;
	return span;
}

export function planSlashSubmission({
	draft,
	caret,
	commandNames,
	promptCommands,
	prefixingCommands,
	nameListCommands,
	armedOnlyCommands,
	argumentShapes,
	commandLockedWords,
	enabled,
}: SlashSubmissionArgs): SlashSubmissionPlan {
	// The capability flag, first and unconditionally: when `commands` is off,
	// nothing is spliced and nothing is lost — the same fallback the model path
	// already has. A splice that ran here would delete text on a backend that
	// cannot run the command it was deleted for.
	if (!enabled) return { kind: "send" };

	const vocabularies: Vocabularies = {
		commandNames,
		promptCommands,
		prefixingCommands,
		nameListCommands,
		armedOnlyCommands,
		argumentShapes: argumentShapes ?? NO_SHAPES,
		commandLockedWords: commandLockedWords ?? NO_WORDS,
	};

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
	if (span !== null) return planForSpan(draft, span, vocabularies);

	/*
	 * No token at the caret. The DRAFT-OPENING branch is then evaluated from the
	 * draft's LEADING line, because "this draft opens with a command" is a fact
	 * about the TEXT and the caret cannot express it: `slashTokenSpan` anchors on
	 * the caret's own line and its argument ends at that line's end, so a caret
	 * moved into the body (or to column 0, where a claiming command's own word
	 * excludes it) made the same draft prose. Start commands whose instruction
	 * spans lines are the case this exists for; the whole-draft shape, the
	 * mid-sentence token and the later-line token all still answer `send` here
	 * (§1.2 rows 3, 7, 8, 10, 11, 13), because `planForSpan` sends whatever does
	 * not open the draft with a command that consumes what follows.
	 */
	const opening = draftOpeningSpan(draft, commandNames);
	if (opening === null) return { kind: "send" };
	return planForSpan(draft, opening, vocabularies);
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
