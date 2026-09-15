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
	/** The command word whose argument list is up, when in the argument phase. */
	argumentCommand: string | null;
	nameThenMessage: boolean;
	runs: boolean;
	chosenByHand: boolean;
	/**
	 * The words whose command arms by PICK alone (`armedOnlyVocabulary`, off the
	 * registry). Enter on one of these rows is not the arming gesture unless the
	 * user chose the row by hand — see the gate in `slashKeyIntent`.
	 */
	armedOnlyCommands: ReadonlySet<string>;
	/**
	 * Whether text SURVIVES the caret's token in this draft, i.e. whether a pick of
	 * the active row would HOIST the draft (the command moved to the front with
	 * that text as its argument) rather than only complete its word. Read off the
	 * draft by the caller (`useSlashCompletion`, which has the text and the caret)
	 * because the row alone cannot answer it: a bare `/goal` pick completes, the
	 * same word inside a sentence hoists.
	 */
	hoists: boolean;
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
 * The sentence a STAGED line's next Enter owes the user, in the command's own
 * terms (`Enter sets the goal and sends the text`).
 *
 * One table, read by the composer's note and by the popup's footer, because both
 * describe the same key in the same state and a second copy is a second answer.
 * Keyed by DESTINATION rather than written at the call site for the reason F6
 * gave: the staging is a generic mechanism, so a sentence naming the goal would
 * go false the moment a second destination joined `ARMED_ONLY_DESTINATIONS`. An
 * unlisted destination gets the generic sentence, which is true of any staged
 * armed line — the next Enter runs it.
 */
const STAGED_PROMISE: Record<string, string> = {
	"session.goal": "Enter sets the goal and sends the text",
};

/**
 * What the next Enter does with a line the pick staged.
 *
 * The FALLBACK is a sentence rather than nothing on purpose: an armed
 * destination with no copy of its own still has an honest promise ("Enter runs
 * it"), so the absence of a sentence cannot turn into a note that says nothing
 * about the key the user is about to press.
 */
export function stagedPromise(destination: string | undefined): string {
	return (
		(destination ? STAGED_PROMISE[destination] : undefined) ?? "Enter runs it"
	);
}

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
		? `Staged ${text}. ${stagedPromise(destination)}.`
		: `Staged ${text}. Needs an open conversation; start one first.`;
}

/**
 * Route one key press.
 *
 * Ported from `editor.py:_resolve_argument` / `:8060-8115` and pinned by
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
				 * AN ARMED ROW IS NOT ARMED BY A KEY THAT HAPPENED TO BE PRESSED.
				 *
				 * `pickArmsCommand` answers the row half — this row's pick stages its
				 * command instead of only completing its word — and the remaining
				 * question is whether THIS press is a pick at all. It is one only when
				 * the user put the marker on the row by hand (an arrow key: the popup
				 * opens with the row already active, so the pre-selected marker is not a
				 * choice), and a pointer click never reaches here (`handleSlashPick` is
				 * called with `run: true` straight from the row).
				 *
				 * A plain press must not silently become the arming gesture: that is the
				 * operator's report, where Enter over `I approve spend /goal` moved his
				 * sentence, staged it and sent nothing. So when something survives the
				 * word — the draft a pick would HOIST — the key FALLS THROUGH to the
				 * composer, which is where Enter submits: `planSlashSubmission` answers
				 * `send` for an armed-only word, so the draft goes as prose in its own
				 * order and nothing is staged. Tab follows the same rule, because Tab is
				 * the accept-and-keep-typing key and a stray press must not rewrite a
				 * sentence either (UX U3).
				 *
				 * When NOTHING survives, the word IS the line: this key completes it
				 * exactly as it does for every other command row, which is what `/goal`
				 * alone has always done.
				 */
				if (pickArmsCommand(row, input.armedOnlyCommands)) {
					if (!input.hoists)
						return { kind: "apply", index: input.active, run: false };
					if (!input.chosenByHand) return { kind: "pass" };
				}
				// A command row COMPLETES only: sending here would submit a
				// half-typed command word.
				return { kind: "apply", index: input.active, run: false };
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
	 * Whether a pick of the ACTIVE row ARMS its command (`pickArmsCommand`). Passed
	 * in rather than resolved here because it depends on the registry-derived
	 * vocabulary this module does not import, and because the row's own route is
	 * exactly what this line has to describe.
	 */
	arms: boolean;
	/**
	 * Whether the draft would be HOISTED (text survives the caret's word). A bare
	 * `/goal` completes like any other command row; the same word inside a sentence
	 * is the question this footer has to answer.
	 */
	hoists: boolean;
	/** Whether an arrow key moved the marker in this list (the pick by hand). */
	chosenByHand: boolean;
};

/**
 * One line saying what Enter does in the state the user is looking at.
 *
 * A green test cannot see this; a user cannot either without it. The four
 * meanings of Enter (complete, complete-and-wait, run, stage) are real states,
 * and the TUI's practice is a footer that says which one is next — the desktop
 * left the user to remember it (UX round 1 U2). `stage` used to be deliberately
 * absent: staging happened on a composer Enter with the list already closed and
 * was announced there by its own note (UX round 1 U7). The arming changed that —
 * the popup's own row is now one of the two staging gestures — so the ARMED row's
 * states are named below, and a plain press that would hoist says what it does
 * INSTEAD (review F2 / QA Q5 / UX U2 / design D1, which found this line promising
 * "Enter completes the command." for a row whose Enter now hoists).
 */
export function enterFooter(input: EnterFooterInput): string | null {
	// No row to act on: the empty state's own copy names the route it offers
	// ("Enter opens the full picker."), so the footer would only repeat it.
	if (!input.matched) return null;
	if (input.phase === "command") {
		/*
		 * THE ARMED ROW says three different things, and saying only one of them is
		 * how this line described a gesture that does not happen. The popup opens
		 * with the row already active, so Enter over a draft that merely contains
		 * the word sends that draft as prose, and the staging needs a choice the
		 * user actually made:
		 *   - nothing survives the word: the key completes it, as for every row;
		 *   - a plain press with a sentence to keep: the draft goes as prose, and
		 *     the line names the gesture that stages instead — which is also where
		 *     the rule that separates `/goal` from `/loop` becomes readable (U6);
		 *   - the row was chosen by hand: the key stages it.
		 */
		if (input.arms) {
			if (!input.hoists) return "Enter completes the command.";
			if (!input.chosenByHand)
				return `Enter sends this draft as prose; arrow to /${input.label} to stage it.`;
			return `Enter stages /${input.label}; the next Enter runs it.`;
		}
		return "Enter completes the command.";
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
	/**
	 * Whether a pick of the ACTIVE row ARMS its command (`pickArmsCommand`). The
	 * pointer's answer is unconditional — a click on the goal row IS the picking
	 * gesture the keyboard needs a hand-made choice for — so this line needs the
	 * row's route and whether there is a draft to hoist, and nothing else.
	 */
	arms: boolean;
	/** Whether text survives the caret's word: a click then STAGES rather than runs. */
	hoists: boolean;
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
	if (input.phase === "command") {
		/*
		 * A CLICK ON AN ARMED ROW STAGES AND RUNS NOTHING — and it is the one gesture
		 * that always does, which is why the line cannot be read off
		 * `pointerPickRuns` alone. That answer says the destination is a panel or a
		 * dialog whose pick runs, and it is still true of a BARE `/goal` (the pick
		 * writes `/goal ` and the read opens); it is the HOIST that makes the
		 * difference, which is why the draft is part of the question.
		 */
		if (input.arms && input.hoists) return `Click stages /${input.label}.`;
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
