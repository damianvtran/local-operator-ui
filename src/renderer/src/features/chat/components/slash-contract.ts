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

/** The minimum a row must say for routing and copy to be decided. */
export type RoutableRow =
	| { kind: "command" }
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
			// A command row COMPLETES only: sending here would submit a
			// half-typed command word.
			if (row.kind === "command")
				return { kind: "apply", index: input.active, run: false };
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
 * Identity of a candidate SET: the rows, in order, by the id the listbox renders.
 *
 * A new query can leave the same rows in a different arrangement, and the TUI
 * retires an explicit choice when the candidate set changes
 * (`command_picker.py:1728`: "the row the user arrowed onto is gone"). Comparing
 * ids rather than counting rows is the difference between "the list changed" and
 * "a row was added": `[a, b] → [a, b, c]` is a different list.
 */
export function candidateKey(rows: readonly RoutableRow[]): string {
	return rows
		.map((row) =>
			row.kind === "command" ? "command" : `argument:${row.row.value}`,
		)
		.join("\n");
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
	nameThenMessage: boolean;
	runs: boolean;
	/** The active row's value, and whether there is an active row at all. */
	value: string;
	matched: boolean;
	unambiguous: boolean;
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
 */
export function enterFooter(input: EnterFooterInput): string | null {
	// No row to act on: the empty state's own copy names the route it offers
	// ("Enter opens the full picker."), so the footer would only repeat it.
	if (!input.matched) return null;
	if (input.phase === "command") return "Enter completes the command.";
	if (input.nameThenMessage) return "Enter chooses this name.";
	if (!input.runs) return "Enter completes the value.";
	if (!input.unambiguous) return "Enter completes; Enter again runs.";
	const command = input.command ? `/${input.command} ` : "";
	return `Enter runs ${command}${input.value}.`.trim();
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
