/**
 * The popup's own contract, pure and I/O-free: what a key means, when an
 * explicit arrow choice survives, and the copy that tells the user which list is
 * up, what Enter will do with it, and what an empty argument list means.
 *
 * WHY this is a module rather than three closures inside the component. Round 1
 * left the whole keyboard half of the interaction unverifiable: the browser
 * harness cannot dispatch key events, so "Enter completes / chooses / runs /
 * reassembles", the `chosenByHand` gate and the phase label's truthfulness were
 * all read off the source by eye and marked `[inferred]` (QA round 1 Q2, UX
 * round 1 U2/U3). A decision stated as a pure function of the state can be
 * bundled and executed as the code the app ships, which is what
 * `scripts/slash-contract.test.mjs` does — the same esbuild pattern
 * `scripts/slash-submit.test.mjs` already uses for the planner.
 *
 * The row type is structural on purpose: `CompletionRow` lives in
 * `slash-commands.tsx`, which imports this module, so naming it here would make
 * a value-level cycle out of a type-only dependency. Anything with the same
 * shape satisfies it, and the component's own rows are assignable to it.
 */
import { ARGUMENT_SOURCE_LABEL } from "./slash-argument-rows";
import { isUnambiguous } from "./slash-rank";
import { slashContext } from "./slash-token";

/**
 * The minimum a row must say for routing, copy and list identity to be decided.
 *
 * `label` is here because identity needs it: the candidate-set key below is the
 * row's listbox id, and a command row's id is the label that matched. Keying
 * every command row on the literal `"command"` made `[model, theme]` and
 * `[usage, team]` the same list (round 2, R6).
 */
export type RoutableRow =
	| { kind: "command"; label: string }
	| { kind: "argument"; row: { value: string; alert?: boolean } };

/** What a key does to the list. `pass` hands the event back to the composer. */
export type SlashKeyIntent =
	/** Move the marker to `index` — an explicit choice by hand. */
	| { kind: "move"; index: number }
	/** Apply `matches[index]`; `run` is false when Enter may only complete. */
	| { kind: "apply"; index: number; run: boolean }
	/**
	 * Replace the typed command word with `prefix` and leave the list open.
	 *
	 * The ambiguous-Enter path, and the one intent that does NOT act on a row: the
	 * word grows to what every candidate agrees on and the user keeps narrowing.
	 * Carries the prefix rather than an index because the answer is not one of the
	 * rows — that is the whole point of the gesture.
	 */
	| { kind: "extend"; prefix: string }
	| { kind: "close" }
	| { kind: "pass" };

export type SlashKeyInput = {
	key: string;
	/** IME composition in flight: Enter belongs to the composition, not the list. */
	composing: boolean;
	open: boolean;
	active: number;
	matches: readonly RoutableRow[];
	/** The argument typed so far, compared against the row's value by the gate. */
	argumentQuery: string;
	/**
	 * The COMMAND word typed so far, without its slash.
	 *
	 * The command phase's own query, and the one the ambiguity gate reads there —
	 * `_picker_query()` in the TUI. A sibling of `argumentQuery` rather than the
	 * same field: the two phases compare different text against different values,
	 * and the argument phase's field is empty while the command list is up.
	 */
	commandQuery: string;
	/** The command word whose argument list is up, when in the argument phase. */
	argumentCommand: string | null;
	nameThenMessage: boolean;
	runs: boolean;
	chosenByHand: boolean;
};

/**
 * Whether Enter may RUN the active argument row rather than only complete it.
 *
 * One function so the router and the footer cannot disagree: the footer TELLS
 * the user that Enter will run, and the risk being managed is that it says so on
 * a key that only completes (round 1 UX U2).
 */
export function slashRunAllowed(input: {
	argumentQuery: string;
	value: string;
	total: number;
	destructive: boolean;
	chosenByHand: boolean;
}): boolean {
	return isUnambiguous(
		input.argumentQuery,
		input.value,
		input.total,
		input.destructive,
		input.chosenByHand,
	);
}

/**
 * Whether Enter may RUN the active COMMAND row rather than only complete it.
 *
 * The TUI's command-phase arm of `Editor._picker_choice_is_unambiguous`
 * (`editor.py:7731-7765`), whose three answers are: the user arrowed onto the
 * row, the typed word IS the row's label, or the row is the only match. Read
 * through the same `isUnambiguous` the argument phase uses, so the two phases
 * cannot drift — with `destructive` FALSE here on purpose: the danger flag
 * protects a list of VALUES being deleted (`/logout`'s credentials), and the
 * command phase is a list of NAMES (`_argument_is_destructive` has nothing to
 * read before a list is open).
 *
 * WHY the command phase needs the gate at all, having had none: a bare `/mo`
 * leaves one row today and two tomorrow, and "Enter runs whatever the matcher
 * picked FIRST" is what the terminal's own comment calls out — `/lo` highlights
 * `loop` while `login` and `logout` also match, so a reflex second keystroke
 * could start autonomous work for a user reaching for login. The gate is what
 * makes that keystroke complete to the shared prefix instead.
 */
export function commandChoiceUnambiguous(input: {
	/** The typed command word, without its slash — the matcher's own query. */
	query: string;
	/** The active row's label: the name or alias that matched. */
	label: string;
	/** How many rows the query left, which is the single-survivor arm. */
	total: number;
	chosenByHand: boolean;
}): boolean {
	return isUnambiguous(
		input.query,
		input.label,
		input.total,
		false,
		input.chosenByHand,
	);
}

/**
 * The prefix every candidate label agrees on, case-insensitively.
 *
 * A port of `Editor._extend_to_common_prefix` (`editor.py:8326-8345`), which is
 * what an AMBIGUOUS Enter does: `names[0]` is trimmed against each later name
 * until it is a prefix of all of them, and the result keeps the FIRST name's own
 * casing because the query is matched case-insensitively (so the registry's
 * spelling of a command is what lands in the composer, not the user's). An empty
 * answer is a real one — `co` for `compact`/`context`/`commands`, but nothing at
 * all for a bare `/` — and the caller grows to it, which for the empty case means
 * the word does not move and the list stays up.
 *
 * The narrowness is the point rather than a limitation: the prefix cannot be the
 * wrong command by construction, since it is the part every candidate agrees on,
 * while completing to the highlighted row put the highest-blast-radius candidate
 * in the buffer ready to run.
 */
export function sharedCommandPrefix(labels: readonly string[]): string {
	const [first, ...rest] = labels;
	if (!first) return "";
	let shared = first;
	for (const label of rest) {
		while (shared && !label.toLowerCase().startsWith(shared.toLowerCase())) {
			shared = shared.slice(0, -1);
		}
		if (!shared) return "";
	}
	return shared;
}

/**
 * The buffer and caret an AMBIGUOUS Enter produces: the command word grows to
 * `prefix` and nothing else moves.
 *
 * The same span arithmetic as `completionFor` and deliberately NOT that
 * function, in TWO ways that review round 1 measured:
 *
 * 1. It splices the WORD SPAN itself, the way the terminal does
 *    (`_extend_to_common_prefix`, `editor.py:8350-8359`:
 *    `f"{text[:context.start]}/{shared}{text[context.end:]}"`). `replaceSpan`
 *    must NOT be reused here: it carries a separator-absorbing rule for a
 *    non-empty replacement that begins at index 0
 *    (`slash-token.ts:301-303`), which exists because a COMPLETION writes
 *    `/<label> ` WITH its own trailing space — absorbing the separator after the
 *    word keeps one space instead of two. An extension carries no trailing space
 *    (it is a prefix of the word, not a whole command), so the same rule deleted
 *    the separator and welded the next word on: `/lo hello` became `/loghello`
 *    and `/lo\nwrite a poem` became `/logwrite a poem`.
 *
 * 2. It refuses to write at all when the result would not GROW the word — the
 *    reference's own guard (`len(shared) <= len(context.query): return`,
 *    `editor.py:8347-8349`), which is why the comparison is by LENGTH rather
 *    than equality: the shared prefix can also come out SHORTER than what the
 *    user typed (a fuzzy query that no candidate extends), and shortening a word
 *    the user is still typing is a mutation no keystroke asked for. `null` is the
 *    no-op answer, and the caller's contract makes it one: `handleSlashExtend`
 *    returns without touching the draft, the caret or the store.
 *
 * The caret lands at the new end of the word rather than at the end of the draft,
 * so a user narrowing a command in front of a written message keeps typing where
 * they were.
 */
export function extensionFor(
	draft: string,
	caret: number,
	prefix: string,
	commands: ReadonlySet<string>,
): { text: string; caret: number } | null {
	const word = slashContext(draft, caret, commands);
	if (!word) return null;
	if (prefix.length <= word.query.length) return null;
	return {
		text: `${draft.slice(0, word.start)}/${prefix}${draft.slice(word.end)}`,
		caret: word.start + 1 + prefix.length,
	};
}

/**
 * Whether the active row's list is destructive IN THIS HOST.
 *
 * The row's own `alert` is one arm and the command word is the other, because
 * `session.credential` revokes a stored credential from `LogoutPicker` while
 * `argumentRows` never paints a destructive detail — so for `/logout` only the
 * command-word arm can fire (round 1 R1).
 */
export function slashDestructive(
	argumentCommand: string | null,
	alert: boolean | undefined,
): boolean {
	return (argumentCommand ?? "").toLowerCase() === "logout" || alert === true;
}

/**
 * The minimum a DESTINATION entry must say for a pick to be routed.
 *
 * Structural for the same reason `RoutableRow` is: the real type
 * (`DestinationEntry`) lives in `picker-registry.tsx`, which imports this module,
 * so naming it here would make a value-level cycle out of a type-only dependency.
 * `DESTINATIONS`'s own entries are assignable to it, and the caller passes the
 * entry it looked up rather than a second table kept here.
 */
export type PickDestination =
	| {
			kind: "picker";
			inline?: { source: string; nameThenMessage: boolean; runs: boolean };
	  }
	| { kind: "navigate" }
	| { kind: "direct" };

/**
 * The destinations a POINTER pick must never run, whatever their kind says.
 *
 * NOT parity with the TUI, and not described as such: each is something a
 * keyboard gesture may do and a stray click must not. A click can land on a row
 * the user never meant to name — the pointer passes over rows on its way
 * somewhere else — and these three are the ones where the accident is not
 * recoverable in the same breath: `window.close` detaches the app,
 * `transcript.clear` wipes the view the user was reading, and `session.compact`
 * spends a compaction pass on the conversation. Each stays reachable from the
 * composer with Enter, the gesture that names it.
 */
const POINTER_PICK_NEVER_RUNS = new Set([
	"window.close",
	"transcript.clear",
	"session.compact",
]);

/**
 * Whether a POINTER pick of a command row RUNS the command rather than only
 * completing its word (`/info` → the panel, not `/info ` and a second Enter).
 *
 * The TUI's own rule, generalised to the desktop's list sources.
 * `Editor.opens_a_list` (`local_operator/tui/widgets/editor.py:2597`) answers it
 * for the terminal host: completing a command's word REPLACES running it
 * exactly when the list that opens IS the outcome of the gesture, and submitting
 * as well would run a no-op over the list it had just drawn. Here the list
 * sources are `picker-registry`'s `inline` field, so the rule reads: a
 * destination that opens an inline argument list completes, and every other
 * destination runs.
 *
 * Keyed off the destination KIND and the list SOURCE, deliberately NOT off the
 * registry's `arguments` field: `/analytics` is `arguments: "optional"` with no
 * inline list and must run bare on a pick, which is the row an `arguments`-keyed
 * rule breaks. That field states what the TUI's KEYBOARD offers and remains the
 * sole authority there; nothing reads it here.
 *
 * TWO DELIBERATE DEVIATIONS from the TUI, recorded as deviations so nobody
 * "fixes" them back to parity:
 *
 *   - `POINTER_PICK_NEVER_RUNS` above, which has no TUI counterpart at all.
 *   - `/login` and `/logout` RUN on a pick. They are the only commands whose
 *     `arguments` is `REQUIRED`, and the TUI must not run a REQUIRED-argument
 *     command on accept because accepting opens an inline list there. Neither
 *     has an inline list HERE — the picker IS the provider list, and it is a
 *     DIALOG (`LoginPicker` / `LogoutPicker`) — so completing-only would strand
 *     the user on `/login ` with nothing to choose from and no list to open.
 *
 * A destination this side has not learned yet RUNS: nothing is known about it to
 * say it opens a list, and the dispatcher answers an unmatched destination with
 * its own honest "not available in the desktop app yet" note — the same outcome
 * Enter has today.
 *
 * That arm is for ids with NO row here, and the ids it used to name as its
 * examples are now routed: `info` and `session.diagnostics` arrived as
 * `{kind: "picker"}` panels on the side that routes them, and the picker
 * registry's own rows for them landed with `origin/main` (0.23.0, merged here).
 * Asked by KIND they ran from the first day, which is the property this rule
 * exists for; the examples moved into `slash-contract.test.mjs` as routed rows,
 * and naming any one id as "not routed yet" is what made that test fail the day
 * the id was routed. Nothing may be hardcoded here for the same reason.
 */
export function pointerPickRuns(
	destination: string,
	entry: PickDestination | undefined,
): boolean {
	if (POINTER_PICK_NEVER_RUNS.has(destination)) return false;
	if (!entry) return true;
	return entry.kind !== "picker" || entry.inline === undefined;
}

/**
 * The labels of a command-phase list, in the order the popup shows them.
 *
 * Exported because the POPUP's footer needs the same set the router extends to
 * (the ambiguous line names the prefix these produce), and a second copy of the
 * filter would be a second answer to "what is in this list".
 */
export const commandLabels = (rows: readonly RoutableRow[]): string[] =>
	rows.flatMap((row) => (row.kind === "command" ? [row.label] : []));

/**
 * Route one key press.
 *
 * Ported from `editor.py:_resolve_argument` / `:8060-8115`, `_picker_choice_is_unambiguous`
 * / `:7731-7765` and `_extend_to_common_prefix` / `:8326-8345`, and pinned by
 * `slash-contract.test.mjs`, because this is the one place where a wrong answer
 * deletes a credential instead of completing a word.
 */
export function slashKeyIntent(input: SlashKeyInput): SlashKeyIntent {
	if (!input.open) return { kind: "pass" };
	if (input.composing) return { kind: "pass" };

	switch (input.key) {
		case "ArrowDown":
			return {
				kind: "move",
				index: Math.min(input.active + 1, input.matches.length - 1),
			};
		case "ArrowUp":
			return { kind: "move", index: Math.max(input.active - 1, 0) };
		case "Enter":
		case "Tab": {
			const row = input.matches[input.active];
			if (!row) return { kind: "pass" };
			if (row.kind === "command") {
				/*
				 * Tab is the completion key in BOTH phases: it takes the highlighted
				 * row whatever the query says and never runs, which is what makes it
				 * the safe key while a list is being narrowed
				 * (`editor.py:3259`).
				 */
				if (input.key === "Tab")
					return { kind: "apply", index: input.active, run: false };
				/*
				 * Enter NAMES a command, so it may also run it — but only when the
				 * choice is unambiguous (`commandChoiceUnambiguous`). An ambiguous
				 * one grows the word to the common prefix and leaves the list up, and
				 * that is where the extra keystroke belongs: it appears exactly where
				 * the intent genuinely is not clear. Completing to the HIGHLIGHTED
				 * row instead put the highest-blast-radius candidate into the buffer
				 * ready to run.
				 *
				 * `run` is the ROW's answer here; the DESTINATION's answer is applied by
				 * the one adapter every pick passes through (`message-input.tsx`),
				 * which gates a command row on `pointerPickRuns`. So a destination that
				 * opens an inline list (`/model`, `/team`, `/theme`, `/agent`,
				 * `/effort`, `/approvals`) still only completes and opens its list,
				 * exactly as a click on that row does.
				 */
				const unambiguous = commandChoiceUnambiguous({
					query: input.commandQuery,
					label: row.label,
					total: input.matches.length,
					chosenByHand: input.chosenByHand,
				});
				if (!unambiguous) {
					const prefix = sharedCommandPrefix(commandLabels(input.matches));
					return {
						kind: "extend",
						/*
						 * Never SHORTER than what is typed: `_extend_to_common_prefix`
						 * returns having changed nothing when the word is already the common
						 * prefix, and the key is consumed either way, so the caller is handed
						 * the word it already holds.
						 */
						prefix:
							prefix.length > input.commandQuery.length
								? prefix
								: input.commandQuery,
					};
				}
				return { kind: "apply", index: input.active, run: true };
			}
			// A NAME+message list (`/team`, `/agent`) fills the name and nothing
			// else: "a name is chosen" is "ready for the message", not "run it".
			if (input.nameThenMessage)
				return { kind: "apply", index: input.active, run: false };
			// Tab completes the value only, so the matcher keeps matching and the
			// user can keep typing — the enum-tail commands add no trailing space
			// for exactly this reason.
			if (input.key === "Tab")
				return { kind: "apply", index: input.active, run: false };
			// `/logout` is destructive IN THE DESKTOP TOO: `session.credential`
			// resolves to `LogoutPicker`, whose rows revoke stored credentials.
			// The `alert` arm is defence for a row that paints a destructive
			// detail; nothing sets it today, so the command-word arm is the one
			// that actually fires.
			const destructive = slashDestructive(
				input.argumentCommand,
				row.row.alert,
			);
			return {
				kind: "apply",
				index: input.active,
				run:
					input.runs &&
					slashRunAllowed({
						argumentQuery: input.argumentQuery,
						value: row.row.value,
						total: input.matches.length,
						destructive,
						chosenByHand: input.chosenByHand,
					}),
			};
		}
		case "Escape":
			return { kind: "close" };
		default:
			return { kind: "pass" };
	}
}

/**
 * Stable listbox ids. Command rows key on the matched label; argument rows on
 * the value, sanitised because a selector carries `/` and `.` is fine but a
 * space is not.
 *
 * This is the ONE definition of a row's identity, used both for the DOM ids the
 * popup renders (`id={`${listId}-${rowId(row)}`}` in `slash-commands.tsx`) and for
 * the candidate-set key below. The two were derived separately until round 2
 * (R6), which is how the reviewed helper came to key every command row on the
 * literal `"command"` while the shipped component keyed on the label.
 */
export function rowId(row: RoutableRow): string {
	return row.kind === "command"
		? `cmd-${row.label}`
		: `arg-${row.row.value.replace(/[^\w.-]/g, "_")}`;
}

/**
 * Identity of a candidate SET: the rows, in order, by the id the listbox renders.
 *
 * A new query can leave the same rows in a different arrangement, and the TUI
 * retires an explicit choice when the candidate set changes
 * (`command_picker.py:1728`: "the row the user arrowed onto is gone"). Comparing
 * ids rather than counting rows is the difference between "the list changed" and
 * "a row was added": `[a, b] → [a, b, c]` is a different list.
 *
 * `slash-commands.tsx` computes its `matchKey` with this function, so the set the
 * suite pins below and the set the component compares are the same string — the
 * property R6 found missing when this helper had no caller under `src/`.
 */
export function candidateKey(rows: readonly RoutableRow[]): string {
	return rows.map(rowId).join("\n");
}

/**
 * Whether an arrow-moved choice survives a change to the candidate set.
 *
 * The gate exists because the matcher may have picked the row on the user's
 * behalf, and one explicit move is the direct answer to that — for THIS row in
 * THIS list. Carrying it across a new list is how "/model" + one arrow press
 * ran a fuzzy survivor the user never moved to (round 1 R1). Same key, choice
 * stands; different key, the gate re-arms.
 */
export function chosenByHandSurvives(
	previousKey: string | null,
	nextKey: string,
): boolean {
	return previousKey === nextKey;
}

/**
 * The one-word name for the list that is up.
 *
 * The argument row reuses the command row's exact geometry, so without this the
 * only cue that the box changed MEANING is a vanished `/` and a vanished hint
 * column (design D3, UX U3) — and the meaning is what decides what Enter does.
 */
export function phaseLabel(
	phase: "command" | "argument",
	source: keyof typeof ARGUMENT_SOURCE_LABEL | undefined,
): string {
	if (phase === "command") return "Commands";
	return source ? ARGUMENT_SOURCE_LABEL[source] : "Arguments";
}

export type EnterFooterInput = {
	phase: "command" | "argument";
	/** The command word whose argument list is up, without its slash. */
	command: string | null;
	/** The active COMMAND row's matched label (the alias that matched). */
	label: string;
	nameThenMessage: boolean;
	runs: boolean;
	/** The active row's value, and whether there is an active row at all. */
	value: string;
	matched: boolean;
	unambiguous: boolean;
	/**
	 * The command phase's ambiguous arm: the word typed so far, and the prefix
	 * every candidate shares (both without the slash).
	 *
	 * Here because the ambiguous line has THREE outcomes rather than one, and only
	 * the caller can tell them apart: the word GROWS to `prefix` when the prefix is
	 * longer than what was typed, and the keystroke is a no-op — the reference's own
	 * guard, `editor.py:8347-8349` — when it is not. The two no-op cases have
	 * different reasons and therefore different copy: the word is already the
	 * prefix, or the candidates share nothing at all. Measured in review round 1
	 * (N2): the single line promised a change in both.
	 */
	query: string;
	prefix: string;
};

/**
 * One line saying what Enter does in the state the user is looking at.
 *
 * A green test cannot see this; a user cannot either without it. The four
 * meanings of Enter (complete, complete-and-wait, run, stage) are real states,
 * and the TUI's practice is a footer that says which one is next — the desktop
 * left the user to remember it (UX round 1 U2). `stage` is deliberately absent:
 * staging happens on a composer Enter with the list already closed, and it is
 * announced there by its own note (see `message-input.tsx`, UX round 1 U7).
 *
 * The command phase used to have ONE line — "Enter completes the command." —
 * which stopped being true the round Enter stopped being completion-only: it now
 * runs the row when the choice is unambiguous, and grows the word to the common
 * prefix when it is not. Both arms read the same two inputs the router decides
 * from, so the line cannot promise a gesture the key does not perform.
 */
export function enterFooter(input: EnterFooterInput): string | null {
	// No row to act on: the empty state's own copy names the route it offers
	// ("Enter opens the full picker."), so the footer would only repeat it.
	if (!input.matched) return null;
	if (input.phase === "command") {
		if (input.unambiguous)
			return input.runs
				? `Enter runs /${input.label}.`
				: `Enter completes /${input.label}.`;
		/*
		 * Ambiguous, so Enter narrows rather than acts — and it narrows only where
		 * there is somewhere further to go. `sharedCommandPrefix` answers "" for a
		 * list with nothing in common, and a word that already IS the prefix cannot
		 * grow either; naming which of the two applies is the difference between a
		 * promise and a description.
		 */
		if (input.prefix.length === 0)
			return "Enter cannot narrow this: these commands share no prefix.";
		if (input.prefix.length <= input.query.length)
			return "Enter keeps the word: it is already the common prefix.";
		return `Enter completes to ${input.prefix}.`;
	}
	if (input.nameThenMessage) return "Enter chooses this name.";
	if (!input.runs) return "Enter completes the value.";
	if (!input.unambiguous) return "Enter completes; Enter again runs.";
	const command = input.command ? `/${input.command} ` : "";
	return `Enter runs ${command}${input.value}.`.trim();
}

export type ClickFooterInput = {
	phase: "command" | "argument";
	/** The command word whose argument list is up, without its slash. */
	command: string | null;
	/** The active COMMAND row's matched label (the alias that matched). */
	label: string;
	nameThenMessage: boolean;
	/**
	 * Whether a pointer pick of the ACTIVE row RUNS it. For a command row that is
	 * `pointerPickRuns` of its destination, for an argument row the list's own
	 * `runs`. Passed in rather than resolved here because both live in the
	 * destination table this module deliberately does not import.
	 */
	runs: boolean;
	/** The active row's value, and whether there is an active row at all. */
	value: string;
	matched: boolean;
};

/**
 * One line saying what a CLICK does in the state the user is looking at.
 *
 * The pointer became a second way to act on this list when a pick of a command
 * row started RUNNING its destination, and nothing on screen said so: rows are
 * `cursor-default`, the one per-row column reads the registry's `arguments`
 * field (which states what the TUI's KEYBOARD offers and is orthogonal to
 * whether a click acts), and the footer named Enter alone. Two rows that look
 * identical therefore did different things on the same gesture with no way to
 * predict which (UX round 2, U10).
 *
 * Same instrument as `enterFooter`, for the same reason: the decision is a pure
 * function of the state, so the two lines are read off the one active row and
 * cannot disagree about what that row is. It says what the gesture will DO — a
 * row whose pick only completes says so — and the states where the pointer
 * cannot act at all (a destination that opens an inline list, a NAME+message
 * row, the three protected ids) are covered by that same word rather than by a
 * promise the pointer does not keep.
 */
export function clickFooter(input: ClickFooterInput): string | null {
	// No row to act on: the empty state's own copy names the route it offers.
	if (!input.matched) return null;
	if (input.phase === "command")
		return input.runs
			? `Click runs /${input.label}.`
			: `Click completes /${input.label}.`;
	if (input.nameThenMessage) return "Click chooses this name.";
	if (!input.runs) return "Click completes this value.";
	const command = input.command ? `/${input.command} ` : "";
	return `Click runs ${command}${input.value}.`.trim();
}

/**
 * The minimum the empty copy reads, named structurally for the same reason
 * `RoutableRow` is: `SlashArgumentListState` lives in `slash-commands.tsx`,
 * which imports this module, so naming it here would turn a type-only
 * dependency into a cycle.
 */
export type EmptyArgumentList = {
	rows: readonly unknown[];
	loading: boolean;
	error: string | null;
	needsSession: boolean;
};

/**
 * The honest empty state for an argument list.
 *
 * An empty list has FOUR causes and they are different facts. "Not reported
 * yet" is the `effort` cold-owner case: the route reads the owner's live spec,
 * which is unresolved before the first turn, so a model with a full ladder
 * answers `[]` (`destination-pickers.tsx` already carries this rule for the
 * dialog). Reading it as "this model has none" was a defect once. A failure, a
 * missing session and — new here — a query that matched nothing are the others.
 *
 * The no-match case used to fall into the cold-owner sentence, so typing a team
 * the roster does not have reported "the roster was never reported": a false
 * statement in the primary `/team` flow, in the voice of the one surface the
 * design made honest about the three empty causes (round 1 UX U4).
 *
 * The route is named because that is the promise §C16 makes and because the
 * user is otherwise at a dead end holding the command. "Enter opens the full
 * picker" is TRUE in every empty state here: the token is the whole line, so
 * Enter falls through to the composer's planner, which runs the command the
 * user typed and opens its picker (round 1 D2).
 *
 * It lives here, beside the Enter footer, because it is the other line of copy
 * whose correctness is a decision rather than a rendering, and because the
 * no-match sentence is the one a story frame has to be able to reach:
 * `slash-contract.test.mjs` derives the state the way the component derives it
 * (a non-empty list the matcher answers nothing for) instead of trusting a
 * fixture to agree with the component's rule.
 */
export function argumentEmptyCopy(list: EmptyArgumentList): string {
	if (list.needsSession) return "Needs an open conversation. Start one first.";
	if (list.error) return list.error;
	if (list.loading) return "Loading…";
	// Rows exist, the query excluded all of them: "not reported yet" would be a
	// lie about the source rather than a fact about the filter.
	if (list.rows.length > 0) return "No matches. Enter opens the full picker.";
	return "Not reported yet. Enter opens the full picker.";
}
