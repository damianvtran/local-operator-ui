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
	/**
	 * Move the marker to `index`. `moved` is false when the key clamped onto the
	 * row the marker was already on, and the two cases are NOT the same event:
	 * only a move is a choice the user made (see the gate in `slashKeyIntent`), so
	 * a key that asked to move and could not is not the arming gesture (F2).
	 */
	| { kind: "move"; index: number; moved: boolean }
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
 *
 * `machine-panel` is listed with nothing in it, and that empty arm is the whole
 * answer it owes here: it carries no `inline` source (a machine panel is a view,
 * not an argument list), so a POINTER pick of one RUNS it — which is what
 * `pointerPickRuns`'s `kind !== "picker"` arm already does for the other two
 * kinds, and what a pick of `Analytics` must do.
 */
export type PickDestination =
	| {
			kind: "picker";
			inline?: { source: string; nameThenMessage: boolean; runs: boolean };
	  }
	| { kind: "machine-panel" }
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
/**
 * Whether a PICK of this row ARMS its command instead of only completing it.
 *
 * The ROW half of the arming rule, beside `pointerPickRuns` and answered the same
 * way — from the vocabulary the composer derived from the registry, never from a
 * command name or destination written here. A command row the vocabulary calls
 * armed-only is hoisted to the front and STAGED by the pick (the DRAFT half is
 * `planSlashArming` in `slash-submit.ts`): the pick is the explicit gesture and it
 * is the only one, which is why an Enter over a draft that merely CONTAINS the
 * word sends that draft as written instead.
 *
 * The WORD is the key rather than the destination because the word is what the
 * draft and the completion both carry: `label` is the name OR ALIAS the row
 * matched and the string `completionFor` writes, and the caller's set holds both
 * members of that pair.
 */
export function pickArmsCommand(
	row: RoutableRow,
	armedOnlyCommands: ReadonlySet<string>,
): boolean {
	return (
		row.kind === "command" && armedOnlyCommands.has(row.label.toLowerCase())
	);
}

/**
 * Whether this row's command TAKES THE DRAFT as its own argument.
 *
 * The free-text rows (`consumes_prompt`): `/loop`, `/team`. A pick on one of them
 * reassembles — the command to the front, the surviving draft behind it as its
 * text — and the planner never auto-submits a reassembled line, so the gesture
 * ends STAGED rather than run.
 *
 * `runs` is part of the question and not a separate one: a row whose destination
 * opens an inline list never reaches the pick's run path at all (the list owns
 * the next key), and `/team` is exactly that row, so excluding it here is what
 * keeps `/team`'s two lines saying "completes".
 */
export function rowTakesDraft(input: {
	runs: boolean;
	takesDraft: boolean;
	hoists: boolean;
}): boolean {
	return input.hoists && input.runs && input.takesDraft;
}

/**
 * Whether a POINTER pick of this row STAGES the line rather than running or only
 * completing it — the row's REAL route, which is the only thing its click line
 * may describe.
 *
 * For an ARMED row the answer is the arming the pick performs, and it needs no
 * `runs`: `handleSlashPick` runs the armed branch BEFORE the run gate and does
 * not consult the disposition, which is why a click stages a bare `/goal` only
 * when there is a draft to hoist. For every other row the staging comes from the
 * reassembly (`rowTakesDraft`).
 *
 * Two rows make this one function rather than an expression in the footer: UX U2
 * measured the `/loop` row's click line reading "Click runs /loop." while the
 * click reassembled and sent nothing — the copy was read off `pointerPickRuns`
 * alone, which answers "does this destination's pick run", not "does THIS pick
 * run". The row the delta cites as its control was the row telling the lie.
 */
export function pickStagesDraft(input: {
	runs: boolean;
	arms: boolean;
	takesDraft: boolean;
	hoists: boolean;
}): boolean {
	if (input.arms) return input.hoists;
	return rowTakesDraft(input);
}

/**
 * The `runs` input BOTH footer lines read for the active row, in either phase,
 * answered from the row's own route.
 *
 * WHY it is not simply `state.inline?.runs`: that value belongs to the ARGUMENT
 * phase's list and is structurally absent in the command phase — `inline` is
 * derived from `argumentWord`, which is derived from `slashArgumentContext`, and
 * `caretPhase` answers `"command"` exactly when that context is `null`. The two
 * phases are disjoint by construction, so feeding `enterFooter` that expression
 * pinned its command-phase branches to a constant `false` no state could move:
 * the free-text row's Enter line was unreachable, and the unit test that pinned
 * the copy passed a `runs: true` the component never produced (review F2 / QA
 * Q3-1). The click line below had the right input all along, which is what made
 * the pair disagree on screen.
 *
 * So the question is asked the way the pick itself asks it: a COMMAND row
 * answers from its DESTINATION (`pointerPickRuns` — whether a pick of this row
 * runs rather than opening a list), and anything else answers from the argument
 * list's own `runs`. `destination` is `undefined` exactly when the active row is
 * not a command row, because every registry command carries one.
 *
 * One function rather than an expression at each call site because the two
 * footers must not be able to describe the same row's route differently; the
 * suite in `scripts/slash-contract.test.mjs` drives it the way the component
 * does rather than hand-building its answer.
 */
export function activeRowRuns(input: {
	destination: string | undefined;
	entry: PickDestination | undefined;
	inlineRuns: boolean;
}): boolean {
	return input.destination === undefined
		? input.inlineRuns
		: pointerPickRuns(input.destination, input.entry);
}

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
		case "ArrowDown": {
			const index = Math.min(input.active + 1, input.matches.length - 1);
			return { kind: "move", index, moved: index !== input.active };
		}
		case "ArrowUp": {
			const index = Math.max(input.active - 1, 0);
			return { kind: "move", index, moved: index !== input.active };
		}
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

/**
 * The sentence a STAGED line's next Enter owes the user, in the command's own
 * terms (`Enter sets the goal and sends the text`).
 *
 * One table, read by the composer's note and by the popup's footer, because both
 * describe the same key in the same state and a second copy is a second answer —
 * the pair used to say "the next Enter runs it" in the popup beside "Enter sets
 * the goal and sends the text" in the note, one flow describing one key twice
 * (design D4). Keyed by DESTINATION rather than written at the call site for the
 * reason F6 gave: the staging is a generic mechanism, so a sentence naming the
 * goal would go false the moment a second destination joined
 * `ARMED_ONLY_DESTINATIONS`. An unlisted destination gets the generic predicate,
 * which is true of any staged armed line.
 */
const STAGED_PROMISE: Record<string, string> = {
	"session.goal": "sets the goal and sends the text",
};

/**
 * What the next Enter does with a line the pick staged.
 *
 * The FALLBACK is a sentence rather than nothing on purpose: an armed
 * destination with no copy of its own still has an honest promise ("runs it"),
 * so the absence of a sentence cannot turn into a note that says nothing about
 * the key the user is about to press.
 */
export function stagedPromiseVerb(destination: string | undefined): string {
	return (destination ? STAGED_PROMISE[destination] : undefined) ?? "runs it";
}
/**
 * The stop a sentence already ends in, so the note does not double it.
 *
 * ASCII alone was not the rule this helper states: the line is the USER's own
 * text in whatever script they typed it in, and a quote that ends in a full stop
 * of another script got the template's `.` appended after it —
 * `stagedSentence("完了。")` read `完了。.` (review F4). The set is the sentence
 * enders the composed-Japanese/CJK block uses (U+3002, U+FF01, U+FF1F) plus the
 * ellipsis character, which ends a sentence in running text in both scripts.
 */
const SENTENCE_STOP = /[.!?。！？…]$/;

/**
 * A staged line as the sentence the note puts after "Staged".
 *
 * The stop is added only when the line does not already carry one, because the
 * line is the USER's own text: a draft ending in a full stop used to produce
 * `Staged /goal Please fix the flaky test and then run the release.. Enter sets
 * the goal and sends the text.` — the template appending its own full stop to
 * text that ends in one (QA round 2, Q2-2, recorded there as a pre-existing
 * shape of this sentence; the multi-line collapse is what started putting a
 * whole draft's trailing punctuation into it). One helper, so the two staging
 * notes cannot punctuate the same quote differently.
 */
export function stagedSentence(text: string): string {
	return SENTENCE_STOP.test(text) ? text : `${text}.`;
}

/**
 * The clause the DISPATCHER's own refusal carries for a pane that can address no
 * conversation, quoted from one place because two notes now promise against it.
 *
 * It is the dispatcher's sentence verbatim (`slash-dispatch.ts`, the `!sessionId`
 * guards), so a note that shows it and the refusal the user then reads are the
 * same words (UX U5 / design D5).
 */
export const NO_CONVERSATION_CLAUSE =
	"Needs an open conversation; start one first.";

/**
 * The staged ARMED line's own receipt (`message-input.tsx`'s `onSlashNote`).
 *
 * `paneHasSession` is the ONE thing this sentence may not guess at: the
 * dispatcher refuses `/goal` on a pane with no conversation
 * (`slash-dispatch.ts`, "needs an open conversation") and the staged line goes
 * with the refusal, so promising "Enter sets the goal and sends the text" there
 * would be the app contradicting itself one keystroke later (UX U5 / design D5).
 * The honest sentence is the dispatcher's own, so the note and the refusal the
 * user then reads are the same words.
 *
 * The noun is `Staged`, the same one the reassembly's note uses, because from the
 * user's side the two are one state: a command line sitting in the box whose
 * next Enter runs it (design D3).
 */
export function stagedNote(
	text: string,
	destination: string | undefined,
	paneHasSession: boolean,
): string {
	return paneHasSession
		? `Staged ${stagedSentence(text)} Enter ${stagedPromiseVerb(destination)}.`
		: `Staged ${stagedSentence(text)} ${NO_CONVERSATION_CLAUSE}`;
}
/**
 * The REASSEMBLY's own staged line: the note the composer writes when Enter
 * pushes a free-text command to the front of a sentence it was typed into.
 *
 * Its own sentence rather than a call to `stagedNote`, and the difference is not
 * cosmetic: the armed note's verb is its ROW's destination promise, delivered by
 * a pick, while this one answers a key the user has already pressed — "Enter
 * again runs it" is the signal round 1 UX U7 asked for, because a user who
 * pressed Enter twice has no other way to see that their sentence MOVED rather
 * than sent. What the two sentences must agree on is the punctuation of the quote
 * (`stagedSentence`) and the refusal clause above, and both come from here.
 *
 * `paneHasSession` is the same input the armed note takes, for the same reason
 * and on the same pane: the dispatcher refuses a command a pane cannot address,
 * so "again runs it" there was a promise the app broke one keystroke later
 * (review F3 — this sentence was pane-blind for a round after its sibling
 * learned the clause).
 */
export function reassembledNote(text: string, paneHasSession: boolean): string {
	return paneHasSession
		? `Staged ${stagedSentence(text)} Enter again runs it.`
		: `Staged ${stagedSentence(text)} ${NO_CONVERSATION_CLAUSE}`;
}

export type EnterFooterInput = {
	phase: "command" | "argument";
	/** The command word whose argument list is up, without its slash. */
	command: string | null;
	/** The active COMMAND row's matched label (the alias that matched). */
	label: string;
	nameThenMessage: boolean;
	runs: boolean;
	/**
	 * Whether this command's completion OPENS a list rather than finishing the
	 * command — i.e. whether its destination declares an inline argument source.
	 *
	 * The caller has it (`inlineArgumentFor(destination)`) and this module
	 * deliberately does not, because it does not import the destination table.
	 * Needed for one arm of the copy: a row that completes and then OPENS a list
	 * (`/model`) is finished with after that completion — the next Enter completes
	 * a VALUE — while a row that completes and closes the list (`/clear`) runs on
	 * the next Enter. Both are `runs: false` here (the pointer may not run either),
	 * so without this the two states would get the same sentence and one of them
	 * would be a lie (UX round 1 U4).
	 */
	opensList: boolean;
	/** The active row's value, and whether there is an active row at all. */
	value: string;
	matched: boolean;
	unambiguous: boolean;
	/**
	 * Whether a pick of the ACTIVE row ARMS its command (`pickArmsCommand`). Passed
	 * in rather than resolved here because it depends on the registry-derived
	 * vocabulary this module does not import, and because the row's own route is
	 * exactly what this line has to describe.
	 */
	arms: boolean;
	/**
	 * The active command's own `consumes_prompt` — whether it can be handed a
	 * whole sentence. Read off the row for the same reason `arms` is: this line
	 * describes the route, and the route is the row's (UX U3).
	 */
	takesDraft: boolean;
	/** The armed row's destination, for the promise table above. */
	destination?: string;
	/**
	 * Whether text SURVIVES the caret's LINE — `slashTokenSpan`'s end is the end of
	 * the caret's own line. A bare `/goal` completes like any other command row;
	 * the same word inside a sentence is the question this footer has to answer.
	 */
	hoists: boolean;
	/**
	 * Whether this pane can address a SESSION at all — the dispatcher's own
	 * question (`useSlashDispatch`'s `sessionId`), passed down from the page that
	 * builds the dispatcher.
	 *
	 * It is not the same question as "does this composer hold a session id": on a
	 * real New-chat pane the page supplies `sessionStatus` from the preview while
	 * the composer's `conversationId` is the PANE's identity, so the composer read
	 * `true` on the one pane whose next Enter is refused with "needs an open
	 * conversation" (UX U1). This line is on screen during the gesture, so it owes
	 * the same answer the note gives after it (design D3).
	 */
	paneHasSession: boolean;
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

/**
 * What Enter does when it is deliberately inert: nothing, and the line has to
 * say what does act instead.
 *
 * Why the key is inert here rather than acting on the highlighted row: the
 * highlight is the MATCHER's guess, and completing to an arbitrary survivor of an
 * ambiguous query is what put the wrong command one Enter away from running — the
 * rule this branch exists to fix. The defect UX round 1 (U1/U2) measured was the
 * FEEDBACK around that decision, not the decision: in the bare-`/` state (the
 * popup's first state, and this string's first outing) three Enters left the
 * screen byte-identical while a highlighted row sat under the caret and the line
 * beside this one advertised the POINTER; after `/l` grew to `/lo`, the same
 * thing repeated under a row that a single arrow key would have made Enter act on.
 *
 * Every clause is true of the keys, and this file's test drives them together
 * rather than trusting the sentence:
 *
 *   - `↓` moves the highlight (and is what marks a row CHOSEN, which is the flag
 *     the ambiguity gate reads), so the row the user lands on is the row Enter
 *     then acts on — running it, or completing it when its destination opens a
 *     list;
 *   - Tab applies the HIGHLIGHTED row and never runs it (`editor.py:3259`), so it
 *     is the one-gesture route to the row the user is looking at.
 *
 * "a row you pick" rather than the reviewer's suggested naming of the highlighted
 * row (`↓ then Enter runs /analytics`): `↓` moves the highlight OFF that row, so
 * naming it would be the same class of untruth this change removes.
 */
const ENTER_NEEDS_A_PICK =
	"Enter needs a row you pick: ↓ then Enter · Tab completes this row.";

export function enterFooter(input: EnterFooterInput): string | null {
	// No row to act on: the empty state's own copy names the route it offers
	// ("Enter opens the full picker."), so the footer would only repeat it.
	if (!input.matched) return null;
	if (input.phase === "command") {
		if (input.unambiguous) {
			/*
			 * THE STAGING STATES come first, because they are what the row's own pick
			 * does rather than what the key alone decides: a pick of an ARMED-ONLY row
			 * arms its command (hoisted to the front and staged), and a pick of a row
			 * whose command TAKES THE DRAFT reassembles it. Neither is a run —
			 * `planSlashArming` and the planner's reassembly never auto-submit a line
			 * they staged — so the words "runs" and "completes" are both wrong here,
			 * and the line says what happens instead (review F2 / QA Q3-1: this branch
			 * was gated on an input the command phase cannot produce, so the free-text
			 * row printed the fallback while the frame claimed otherwise).
			 *
			 * `pickStagesDraft` is the ONE predicate these two lines and the pick
			 * itself read, so the footer cannot promise a staging the click does not
			 * perform, or miss one it does.
			 *
			 * The pane clause is the same one the note carries (design D3 / UX U1):
			 * this line is on screen DURING the gesture, so a pane that cannot address
			 * a session must not be promised the run the next Enter will refuse.
			 */
			if (
				pickStagesDraft({
					runs: input.runs,
					arms: input.arms,
					takesDraft: input.takesDraft,
					hoists: input.hoists,
				})
			)
				return input.paneHasSession
					? `Enter stages /${input.label}; the next Enter runs it.`
					: `Enter stages /${input.label}; this pane needs an open conversation to run it.`;
			/*
			 * The four answers this table carried before the arming, kept exactly as
			 * the router reads them: unambiguous + a running destination RUNS,
			 * unambiguous + a list-bearing destination completes (the word opens the
			 * list), unambiguous + a destination that neither runs nor opens a list
			 * completes and is run by the NEXT Enter, and an ambiguous query grows the
			 * word instead.
			 */
			return input.runs
				? `Enter runs /${input.label}.`
				: input.opensList
					? `Enter completes /${input.label}.`
					: `Enter completes /${input.label}; Enter again runs it.`;
		}
		/*
		 * Ambiguous, so Enter narrows where there is somewhere further to go, and the
		 * line reports the growth when there is. Where there is not — the word already
		 * IS the shared prefix, or the candidates share nothing — the key is inert by
		 * design, and the line names the gestures that act instead rather than
		 * restating the matcher's reason (UX round 1, U1-U3).
		 */
		if (input.prefix.length === 0 || input.prefix.length <= input.query.length)
			return ENTER_NEEDS_A_PICK;
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
	/**
	 * The same three inputs `enterFooter` reads for the STAGING question, for the
	 * same reason: a pointer pick of an armed-only row arms it and of a row whose
	 * command takes the draft reassembles it, and the click is one of the two
	 * arming gestures this PR documents. `runs` above answers "does this
	 * DESTINATION's pick run", which is a different question from "does THIS pick
	 * run" — reading the click line off it alone is what let `/loop`'s row say
	 * "Click runs /loop." while the click reassembled and sent nothing (UX U2).
	 */
	arms: boolean;
	takesDraft: boolean;
	hoists: boolean;
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
	if (input.phase === "command") {
		if (
			pickStagesDraft({
				runs: input.runs,
				arms: input.arms,
				takesDraft: input.takesDraft,
				hoists: input.hoists,
			})
		)
			return `Click stages /${input.label}.`;
		return input.runs
			? `Click runs /${input.label}.`
			: `Click completes /${input.label}.`;
	}
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
 * user is otherwise at a dead end holding the command — but the route is "the
 * command runs", not "a picker opens". The old sentence promised the picker and
 * that is not what Enter does: it falls through to the composer's planner,
 * which runs the command with what has been typed, and whether that opens a
 * control is the DESTINATION's decision (measured, UX round 2, U10: `/model
 * gpt-5` + Enter switches the model and opens nothing). Saying "Enter runs the
 * command" is true in every empty state here and promises nothing the app does
 * not do.
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
	if (list.rows.length > 0) return "No matches. Enter runs the command.";
	return "Not reported yet. Enter runs the command.";
}
