import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The popup's keyboard contract, executed as the code the app ships.
 *
 * Round 1 left this whole half of the interaction unverified: the `browser` tool
 * and the extension protocol have no key dispatch, so Enter / Tab / the arrows /
 * Escape, the popup's pick-by-key and the `chosenByHand` gate were marked
 * `[inferred]` — read off the source rather than observed, and QA's Q2 is
 * BLOCKED rather than passed for exactly that reason.
 *
 * The answer is the pattern this repo already uses for the planner
 * (`scripts/slash-submit.test.mjs`): bundle the REAL module with esbuild and
 * exercise it. `slash-contract.ts` holds the routing, the gate and the two lines
 * of copy INSIDE the popup, so what follows is the shipped decision, not a
 * reimplementation of it. `handleSlashKeyDown` in `slash-commands.tsx` is a thin
 * adapter over `slashKeyIntent`.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/components/slash-contract";',
			/* The matcher and the row shaper, because the no-match state below is
			   DERIVED the way the component derives it rather than asserted. */
			'export { argumentRows } from "./src/renderer/src/features/chat/components/slash-argument-rows";',
			'export { matchChoices } from "./src/renderer/src/features/chat/components/slash-rank";',
			/* The arming route's own write, so the pick case below asserts the line a
			   pick STAGES and not only the fact that it arms. */
			'export { armedOnlyVocabulary, planSlashArming, planSlashSubmission } from "./src/renderer/src/features/chat/components/slash-submit";',
			/* The pick's own write, so the footer/route pair below is read off the
			   line a real pick produces rather than a hand-built string (review F7). */
			'export { completionFor } from "./src/renderer/src/features/chat/components/slash-completion";',
			/* The tokenizer's own phase, so the free-text row's case below can pin WHY
			   the popup's old `runs` input was a constant in that state rather than
			   asserting the constant (review F2 / QA Q3-1). */
			'export { caretPhase, slashArgumentContext } from "./src/renderer/src/features/chat/components/slash-token";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	activeRowRuns,
	argumentEmptyCopy,
	argumentRows,
	armedOnlyVocabulary,
	caretPhase,
	candidateKey,
	chosenByHandSurvives,
	completionFor,
	clickFooter,
	enterFooter,
	extensionFor,
	matchChoices,
	lockedCommandNote,
	lockedRunUndoCap,
	NO_CONVERSATION_CLAUSE,
	phaseLabel,
	pickArmsCommand,
	pickStagesDraft,
	planSlashArming,
	planSlashSubmission,
	pointerPickRuns,
	reassembledNote,
	rowId,
	rowTakesDraft,
	sharedCommandPrefix,
	slashArgumentContext,
	slashKeyIntent,
	stagedNote,
	stagedPromiseVerb,
	stagedSentence,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The pick rule's inputs are the DESTINATION TABLE's own fields — a
 * destination's kind and whether it declares an inline list — so the cases
 * below read them off `picker-registry.tsx` rather than restating them: a table
 * edit that gave `/analytics` a list, or moved `session.compact` out of the
 * protected set, has to turn this file red instead of passing against a stale
 * copy.
 *
 * The table cannot be IMPORTED. Its entries hold the picker components as
 * values, so bundling it pulls the whole renderer and every package it imports
 * under node — measured at 18s of bundling plus 3s of execution, in a file that
 * ran in 1.3s, and it would run app code that has no business loading in a unit
 * test. Reading the source is the same move `slash-row-format.test.mjs` makes to
 * pin the entity ids, and it fails loudly: a rename makes these cases fail by
 * name rather than silently answering from the unknown-destination arm.
 */
const REGISTRY = readFileSync(
	"src/renderer/src/features/chat/pickers/picker-registry.tsx",
	"utf8",
);

/*
 * The four fields `pointerPickRuns` consumes, read off one entry's own block.
 * Top-level, like the composer's other regexes: `registryEntry` runs once per
 * case rather than per keystroke, but a module-level literal is the repo's rule
 * (`lint/performance/useTopLevelRegex`) and these are constants.
 */
/*
 * `[\w-]+` rather than `\w+`: the registry's kind name is a hyphenated word
 * (`machine-panel`, the `/info`-`/usage`-`/analytics` kind), and a class that
 * stopped at the hyphen read `undefined` for those three rows - which this
 * helper reports as "declares its kind" failing, i.e. as a defect in the table
 * rather than in the reader. Widened here rather than special-cased per
 * destination: what the helper must accept is any kind the table declares.
 */
const KIND = /kind: "([\w-]+)"/;
const INLINE_SOURCE = /source: "(\w+)"/;
const NAME_THEN_MESSAGE = /nameThenMessage: (true|false)/;
const RUNS = /runs: (true|false)/;

/**
 * The `DESTINATIONS` entry for `id`, as `pointerPickRuns` consumes it.
 *
 * The block is the entry's OWN braces, so an `inline` in a neighbouring entry
 * cannot be read as this one's.
 */
function registryEntry(id) {
	// Quoted only when the id needs it (`"window.close"`), bare otherwise
	// (`appearance`), which is how the table is written.
	const at = Math.max(
		REGISTRY.indexOf(`\n\t"${id}": `),
		REGISTRY.indexOf(`\n\t${id}: `),
	);
	if (at < 0) return undefined;
	const open = REGISTRY.indexOf("{", at);
	let depth = 0;
	let close = open;
	for (let i = open; i < REGISTRY.length; i++) {
		if (REGISTRY[i] === "{") depth++;
		else if (REGISTRY[i] === "}") {
			depth--;
			if (depth === 0) {
				close = i;
				break;
			}
		}
	}
	const block = REGISTRY.slice(open, close + 1);
	const kind = KIND.exec(block)?.[1];
	assert.ok(kind, `${id} declares its kind`);
	const source = INLINE_SOURCE.exec(block)?.[1];
	return {
		kind,
		inline: source
			? {
					source,
					nameThenMessage: NAME_THEN_MESSAGE.exec(block)?.[1] === "true",
					runs: RUNS.exec(block)?.[1] === "true",
				}
			: undefined,
	};
}

/** Whether a pointer pick of `id` runs, decided from the registry's own entry. */
function pickRuns(id) {
	return pointerPickRuns(id, registryEntry(id));
}

/**
 * The ARMING VOCABULARY as the composer derives it, from a catalogue row the
 * REAL destination table routes. It is written here as a minimal row rather
 * than imported because the catalogue comes from the backend over
 * `commands.list`; what must be read off the tree is the DESTINATION id, which
 * is the registry's own key below.
 */
const ARMED_ROW = {
	name: "goal",
	aliases: [],
	destination: "session.goal",
};
/* A command row carries its matched label because the listbox id does:
   `rowId` renders `cmd-<label>`, and that id is also the row's identity in the
   candidate set (round 2, R6). */
const commandRow = { kind: "command", label: "model" };
const argumentRow = (value, over = {}) => ({
	kind: "argument",
	row: { value, ...over },
});

/** The routing inputs, defaulted to the shape production passes. */
const route = (over = {}) =>
	slashKeyIntent({
		key: "Enter",
		composing: false,
		open: true,
		active: 0,
		matches: [commandRow],
		argumentQuery: "",
		commandQuery: "",
		argumentCommand: "model",
		nameThenMessage: false,
		runs: true,
		chosenByHand: false,
		...over,
	});

/** A command-phase list, in the order the popup would show it. */
const commandRows = (...labels) =>
	labels.map((label) => ({ kind: "command", label }));

test("keys are only routed while the list is up and not composing", () => {
	assert.deepEqual(route({ open: false }), { kind: "pass" });
	assert.deepEqual(route({ composing: true }), { kind: "pass" });
	// A key the list has no meaning for goes back to the composer, which is what
	// keeps typing, Shift+Enter and the IME working while a list is open.
	assert.deepEqual(route({ key: "a" }), { kind: "pass" });
	assert.deepEqual(route({ key: "Backspace" }), { kind: "pass" });
});

test("the arrows move the marker and clamp at both ends", () => {
	assert.deepEqual(
		route({ key: "ArrowDown", active: 0, matches: [commandRow, commandRow] }),
		{ kind: "move", index: 1, moved: true },
	);
	assert.deepEqual(
		route({ key: "ArrowDown", active: 1, matches: [commandRow, commandRow] }),
		{ kind: "move", index: 1, moved: false },
	);
	assert.deepEqual(
		route({ key: "ArrowUp", active: 1, matches: [commandRow, commandRow] }),
		{ kind: "move", index: 0, moved: true },
	);
	assert.deepEqual(
		route({ key: "ArrowUp", active: 0, matches: [commandRow, commandRow] }),
		{ kind: "move", index: 0, moved: false },
	);
});

/*
 * A key that asked to move and could not is NOT the choice the arming gate is
 * answered by (review F2). The adapter in `slash-commands.tsx` reads `moved` to
 * decide which setter it calls, so `moved` is what this case pins: the marker's
 * position alone cannot tell a deliberate move from a clamped no-op, which is
 * why the popup opens on a row and an Up on the first row changed nothing.
 */
test("an arrow that does not move the marker is not a hand-made choice", () => {
	/*
	 * The two events the router distinguishes: a key that asked to move and could
	 * not (the marker CLAMPS at both ends, and the popup opens with a row already
	 * active) and a key that moved it. Only the second is a choice the user made,
	 * and it is the only thing that turns an AMBIGUOUS Enter into an acting one —
	 * `commandChoiceUnambiguous`'s third arm, read through `chosenByHand`. Latching
	 * it on a clamped key handed the pre-selected row an action on a press that had
	 * changed nothing on screen (review F2).
	 */
	const list = [armedRow("login"), armedRow("logout"), armedRow("loop")];
	const clamped = route({
		key: "ArrowUp",
		active: 0,
		matches: list,
		commandQuery: "",
	});
	assert.equal(clamped.moved, false);
	assert.deepEqual(
		route({
			key: "Enter",
			active: 0,
			matches: list,
			commandQuery: "",
			chosenByHand: false,
		}),
		{ kind: "extend", prefix: "lo" },
		"the pre-selected row is not acted on: the word grows instead",
	);

	// The same list once the marker moved: now the choice is the user's, and Enter
	// acts on the row the marker reached.
	const moved = route({
		key: "ArrowDown",
		active: 0,
		matches: list,
		commandQuery: "",
	});
	assert.equal(moved.moved, true);
	assert.deepEqual(
		route({
			key: "Enter",
			active: 1,
			matches: list,
			commandQuery: "",
			chosenByHand: true,
		}),
		{ kind: "apply", index: 1, run: true },
	);
});

test("Enter runs a command row when the choice is unambiguous", () => {
	/*
	 * The reported defect: `/analytics` + Enter completed the word and needed a
	 * second Enter before the panel opened. The rule is the terminal's own
	 * (`_picker_choice_is_unambiguous`, `editor.py:7731-7765`), read through the
	 * desktop's existing `isUnambiguous`.
	 */
	// Typed in full: the user NAMED the command rather than accepting a guess.
	assert.deepEqual(
		route({ matches: commandRows("analytics"), commandQuery: "analytics" }),
		{ kind: "apply", index: 0, run: true },
	);
	// The single survivor of a short word is unambiguous too, which is the arm
	// that makes `/ana` behave the way the terminal does.
	assert.deepEqual(
		route({ matches: commandRows("analytics"), commandQuery: "an" }),
		{ kind: "apply", index: 0, run: true },
	);
	// An arrow press is the explicit choice, whatever the query left.
	assert.deepEqual(
		route({
			matches: commandRows("analytics", "agents"),
			commandQuery: "a",
			active: 1,
			chosenByHand: true,
		}),
		{ kind: "apply", index: 1, run: true },
	);
	// A list with no row at the marker completes nothing and is not a key the
	// popup consumed.
	assert.deepEqual(route({ matches: [] }), { kind: "pass" });
});

test("an ambiguous Enter grows the word to the common prefix and runs nothing", () => {
	/*
	 * `/cm` fuzzy-matches `commands` and `compact`, so nothing is applied: the word
	 * grows to what every candidate agrees on and the list stays up
	 * (`_extend_to_common_prefix`, `editor.py:8326-8345`). Completing to the
	 * HIGHLIGHTED row instead put the highest-blast-radius candidate in the buffer
	 * ready to run.
	 */
	assert.deepEqual(
		route({
			matches: commandRows("commands", "compact"),
			commandQuery: "cm",
		}),
		{ kind: "extend", prefix: "com" },
	);
	// The word is never SHORTER than what is typed: when the query already IS the
	// shared prefix the terminal returns having changed nothing, and this key is
	// consumed either way rather than falling through to a submit.
	assert.deepEqual(
		route({
			matches: commandRows("commands", "compact"),
			commandQuery: "com",
		}),
		{ kind: "extend", prefix: "com" },
	);
	// Nothing shared at all — a bare `/` shows the whole registry — so the word
	// does not move and the list stays open.
	assert.deepEqual(
		route({ matches: commandRows("usage", "team"), commandQuery: "" }),
		{ kind: "extend", prefix: "" },
	);
});

/*
 * The ambiguous Enter's SPLICE, executed on the shipped function.
 *
 * Review round 1 (F1) found that `extensionFor` had no assertion of any kind, and
 * that every gesture in `scripts/slash-enter-proof.mjs` types into a CLEARED
 * draft — so the one shape the frames never exercised was a command word with a
 * written message after it, which is the shape the function's own caller names as
 * its design case. Three facts are pinned here: the separator after the word
 * survives, a newline survives, and a word that cannot GROW is not touched at
 * all.
 */
test("an extension splices the word and leaves the text after it alone", () => {
	const commands = new Set([
		"analytics",
		"log",
		"login",
		"logout",
		"loop",
		"model",
	]);
	// The frames' own shape: nothing but the word, so nothing to preserve.
	assert.deepEqual(extensionFor("/lo", 3, "log", commands), {
		text: "/log",
		caret: 4,
	});
	// The defect: `replaceSpan`'s separator rule absorbed the space, and the
	// newline with it, welding the written message onto the command word.
	assert.deepEqual(extensionFor("/lo hello", 3, "log", commands), {
		text: "/log hello",
		caret: 4,
	});
	assert.deepEqual(extensionFor("/lo\nwrite a poem", 3, "log", commands), {
		text: "/log\nwrite a poem",
		caret: 4,
	});
	// A word that cannot GROW is a NO-OP rather than a rewrite: the reference
	// returns before writing, and `null` is this side's no-op. The second case is
	// the one review round 1 measured deleting the separator: the typed word IS
	// already the shared prefix (`/lo` over login/logout/loop), so the keystroke
	// must leave the buffer exactly as it found it.
	assert.equal(extensionFor("/log hello", 4, "log", commands), null);
	assert.equal(extensionFor("/lo hello", 3, "lo", commands), null);
	assert.equal(extensionFor("/log", 4, "log", commands), null);
	// The caret lands at the new end of the WORD, not at the end of the draft, so
	// typing continues where it was.
	assert.deepEqual(extensionFor("/lo hello", 3, "login", commands), {
		text: "/login hello",
		caret: 6,
	});
});

test("the common prefix keeps the registry's own casing", () => {
	// Case-insensitive matching, the FIRST label's spelling inserted — the
	// terminal's own rule, so a user typing `/MOD` gets `/model` rather than
	// `/MODel`.
	assert.equal(sharedCommandPrefix(["Model", "model"]), "Model");
	assert.equal(sharedCommandPrefix(["Commands", "compact"]), "Com");
	assert.equal(sharedCommandPrefix(["usage"]), "usage");
	// Nothing to grow to is a real answer: `co` keeps only what every candidate
	// agrees on, and a list with nothing in common at all holds the word still.
	assert.equal(sharedCommandPrefix(["usage", "team"]), "");
	assert.equal(sharedCommandPrefix([]), "");
});

test("Tab completes a command row and never runs it, ambiguous or not", () => {
	// Tab is the completion key: it takes the highlighted row whatever the query
	// says, which is what makes it the safe key while a list is narrowed.
	assert.deepEqual(
		route({
			key: "Tab",
			matches: commandRows("analytics"),
			commandQuery: "analytics",
		}),
		{ kind: "apply", index: 0, run: false },
	);
	assert.deepEqual(
		route({
			key: "Tab",
			matches: commandRows("commands", "compact"),
			commandQuery: "cm",
		}),
		{ kind: "apply", index: 0, run: false },
	);
});

test("a name-list row fills the name and never runs", () => {
	// `/team` and `/agent`: "a name is chosen" is "ready for the message".
	assert.deepEqual(
		route({
			matches: [argumentRow("delivery")],
			nameThenMessage: true,
			runs: false,
			argumentQuery: "delivery",
		}),
		{ kind: "apply", index: 0, run: false },
	);
});

test("Tab completes the value, never runs, on a runnable list", () => {
	assert.deepEqual(
		route({
			key: "Tab",
			matches: [argumentRow("auto"), argumentRow("ask")],
			argumentQuery: "auto",
		}),
		{ kind: "apply", index: 0, run: false },
	);
});

test("Enter runs only when the choice is unambiguous (criterion 10)", () => {
	const two = [argumentRow("auto"), argumentRow("ask")];

	// The single survivor of a query on a non-destructive list.
	assert.deepEqual(
		route({ matches: [argumentRow("auto")], argumentQuery: "auto" }),
		{ kind: "apply", index: 0, run: true },
	);

	// Typed in full: the user NAMED the row rather than accepting a guess.
	assert.deepEqual(route({ matches: two, argumentQuery: "ask", active: 1 }), {
		kind: "apply",
		index: 1,
		run: true,
	});

	// Hand-moved: an explicit arrow press is the direct answer to "the matcher
	// may have chosen for you", so one press is enough even with several rows.
	assert.deepEqual(
		route({
			matches: two,
			argumentQuery: "a",
			active: 1,
			chosenByHand: true,
		}),
		{ kind: "apply", index: 1, run: true },
	);

	// Several rows, a query that is neither the row's value nor a single
	// survivor, and no explicit move: Enter only completes.
	assert.deepEqual(route({ matches: two, argumentQuery: "a" }), {
		kind: "apply",
		index: 0,
		run: false,
	});

	// A destructive list is never run on a SINGLE SURVIVOR — the matcher is a
	// subsequence matcher, so `/logout oer` reached `openrouter` one Enter away
	// from deleting a credential the user never named (`editor.py:7731-7765`).
	assert.deepEqual(
		route({
			matches: [argumentRow("openrouter")],
			argumentQuery: "oer",
			argumentCommand: "logout",
			runs: true,
		}),
		{ kind: "apply", index: 0, run: false },
	);
	// ... but typing the id IN FULL is an explicit choice and still runs, on a
	// destructive list too. That arm is deliberately not conditioned on the
	// danger flag: the user named the row rather than letting the matcher pick.
	assert.deepEqual(
		route({
			matches: [argumentRow("anthropic")],
			argumentQuery: "anthropic",
			argumentCommand: "logout",
			runs: true,
		}),
		{ kind: "apply", index: 0, run: true },
	);

	// The row can also declare the danger itself.
	assert.deepEqual(
		route({
			matches: [argumentRow("anthropic", { alert: true })],
			argumentQuery: "anth",
		}),
		{ kind: "apply", index: 0, run: false },
	);

	// `runs: false` (the `/theme` inline list) completes even on a single
	// survivor: its destination is a dialog, and the list does not open it.
	assert.deepEqual(
		route({
			matches: [argumentRow("dracula")],
			argumentQuery: "dracula",
			runs: false,
		}),
		{ kind: "apply", index: 0, run: false },
	);
});

test("Escape closes and latches the phase", () => {
	assert.deepEqual(route({ key: "Escape" }), { kind: "close" });
});

test("an explicit arrow choice survives the same list and only the same list", () => {
	// Round 1 R1: the latch was one-way, so one arrow press made every later
	// Enter run the highlighted row, including a fuzzy survivor the user never
	// moved to. The TUI retires it when the candidate SET changes
	// (`command_picker.py:1728`).
	//
	// The key IS the listbox id: `candidateKey` is `rows.map(rowId)`, the same
	// function `slash-commands.tsx` renders its rows with and computes its
	// `matchKey` from, so this block exercises the shipped comparison rather than
	// a second one beside it (round 2, R6: until then the helper had no caller
	// under `src/` and keyed every command row on the literal "command").
	const before = candidateKey([argumentRow("delivery"), argumentRow("ops")]);
	const after = candidateKey([argumentRow("delivery"), argumentRow("ops")]);
	const narrowed = candidateKey([argumentRow("delivery")]);
	const reordered = candidateKey([argumentRow("ops"), argumentRow("delivery")]);
	const grown = candidateKey([
		argumentRow("delivery"),
		argumentRow("ops"),
		argumentRow("research"),
	]);

	assert.equal(chosenByHandSurvives(before, after), true);
	assert.equal(chosenByHandSurvives(before, narrowed), false);
	assert.equal(chosenByHandSurvives(before, reordered), false);
	assert.equal(chosenByHandSurvives(before, grown), false);
	// Compare ids, not counts: `[a, b] → [a, b, c]` is a different list.
	assert.notEqual(before, grown);

	// The key is the id the listbox renders, spelled out: an argument row on its
	// value, a command row on the label that matched.
	assert.equal(
		candidateKey([argumentRow("delivery"), commandRow]),
		[rowId(argumentRow("delivery")), rowId(commandRow)].join("\n"),
	);
	assert.equal(
		candidateKey([argumentRow("delivery"), commandRow]),
		["arg-delivery", "cmd-model"].join("\n"),
	);
	// Two DIFFERENT command sets are different lists. Keying every command row on
	// the literal "command" made these the same key, which is the comparison bug
	// R6 found in the unreferenced helper.
	assert.notEqual(
		candidateKey([commandRow, { kind: "command", label: "theme" }]),
		candidateKey([
			{ kind: "command", label: "usage" },
			{ kind: "command", label: "team" },
		]),
	);
});

test("the phase label names the list's subject", () => {
	assert.equal(phaseLabel("command", undefined), "Commands");
	assert.equal(phaseLabel("argument", "team"), "Teams");
	assert.equal(phaseLabel("argument", "model"), "Models");
	assert.equal(phaseLabel("argument", "effort"), "Effort");
	assert.equal(phaseLabel("argument", "approvals"), "Approvals");
	assert.equal(phaseLabel("argument", "agent"), "Agents");
	// The renderer-local sixth source (DESIGN §5.3, /theme inline) has a name
	// like the rest, so no source renders under another's subject.
	assert.equal(phaseLabel("argument", "theme"), "Themes");
});

test("the footer says what Enter will do, in each state", () => {
	const base = {
		phase: "argument",
		command: "model",
		label: "model",
		nameThenMessage: false,
		runs: true,
		value: "openai/gpt-5",
		matched: true,
		unambiguous: true,
		/* The ambiguous arm's own two inputs: the typed word and the prefix the
		   candidates share. `lo` -> `log` is the growth case (login, logout). */
		query: "lo",
		prefix: "log",
		/* Whether this row's completion opens a list; the caller reads it off the
		   registry with `inlineArgumentFor`, and it is the one input that separates
		   `/model` from `/clear` below. */
		opensList: false,
	};
	/*
	 * The command phase has FOUR answers now, and they are read off the same inputs
	 * the router decides from: unambiguous + a running destination RUNS,
	 * unambiguous + a list-bearing destination completes (the word opens the list),
	 * unambiguous + a destination that neither runs nor opens a list completes and
	 * is RUN BY THE NEXT ENTER, and an ambiguous query grows the word instead.
	 */
	assert.equal(
		enterFooter({ ...base, phase: "command", label: "usage" }),
		"Enter runs /usage.",
	);
	assert.equal(
		enterFooter({ ...base, phase: "command", runs: false, opensList: true }),
		"Enter completes /model.",
	);
	/*
	 * The second completion state, and the reason `opensList` exists (UX round 1,
	 * U4): `/clear` is `runs: false` like `/model` because the POINTER may not run
	 * either, but its completion closes the list, so the next Enter runs it. The
	 * sentence names that rather than leaving the user to discover it.
	 */
	assert.equal(
		enterFooter({ ...base, phase: "command", label: "clear", runs: false }),
		"Enter completes /clear; Enter again runs it.",
	);
	assert.equal(
		enterFooter({ ...base, phase: "command", unambiguous: false }),
		"Enter completes to log.",
	);
	/*
	 * The two states where Enter cannot narrow at all, and the key is deliberately
	 * inert (review round 1 N2 kept it so; UX round 1 U1-U3 fixed what it SAYS): the
	 * word already IS the shared prefix, or the candidates share nothing. Both get
	 * the same line, because both need the same answer — what to press — and neither
	 * may promise a change the key will not make.
	 */
	for (const [query, prefix] of [
		["log", "log"],
		["", ""],
	]) {
		const line = enterFooter({
			...base,
			phase: "command",
			unambiguous: false,
			query,
			prefix,
		});
		assert.equal(
			line,
			"Enter needs a row you pick: ↓ then Enter · Tab completes this row.",
			`the ${query === "" ? "no-shared-prefix" : "already-at-prefix"} state speaks with one voice`,
		);
		// A line that promised a gesture would be worse than the silence it replaced:
		// in this state Enter neither runs nor completes.
		assert.doesNotMatch(line, /^Enter (runs|completes)/, line);
		// The two gestures it names are the two that act, and both are on the strip.
		assert.match(line, /↓/);
		assert.match(line, /Tab completes/);
	}
	assert.equal(
		enterFooter({ ...base, nameThenMessage: true, runs: false }),
		"Enter chooses this name.",
	);
	assert.equal(enterFooter(base), "Enter runs /model openai/gpt-5.");
	// The ambiguity case is the one a user cannot see: Enter completes only, and
	// the footer says so rather than implying a run (round 1 UX U2).
	assert.equal(
		enterFooter({ ...base, unambiguous: false }),
		"Enter completes; Enter again runs.",
	);
	assert.equal(
		enterFooter({ ...base, runs: false }),
		"Enter completes the value.",
	);
	// No row: the empty state's own copy carries the route.
	assert.equal(enterFooter({ ...base, matched: false }), null);
});

/*
 * The line and the KEY, driven together (UX round 1, U1-U4).
 *
 * The cases above assert the copy; this one asserts it is TRUE. Each state below
 * feeds the SAME inputs to `slashKeyIntent` and to `enterFooter`, and then checks
 * the sentence against what the intent and the destination table say the key does
 * — which is the property the UX walk went looking for and did not find, first in
 * the bare-`/` state (three Enters, byte-identical screen, under a footer
 * advertising the pointer) and then after `/l` grew to `/lo`.
 *
 * The destination answers come from `picker-registry.tsx` through the same
 * `pickRuns`/`registryEntry` helpers the pick cases use, so a table edit that
 * made `/analytics` list-bearing or `/model` runnable turns this red rather than
 * leaving the copy describing a table that moved.
 */
test("the Enter line names what the key actually does, in every state", () => {
	/* Real command/destination pairs, read off `slash-dispatch.ts`'s own map
	   (`analytics: "analytics"`, `model: "model"`). */
	const CASES = [
		{ labels: ["analytics"], query: "", destination: "analytics" },
		{ labels: ["model"], query: "model", destination: "model" },
		{ labels: ["login", "logout", "loop"], query: "", destination: "login" },
		{ labels: ["login", "logout", "loop"], query: "lo", destination: "login" },
	];
	/* The bare-`/` case is the one that produced the popup's first-ever sentence,
	   so the row set is the real 13-command list rather than one row: nothing in
	   it shares a prefix, which is why the key cannot narrow there. */
	CASES[2].labels = [
		"analytics",
		"agent",
		"approvals",
		"clear",
		"compact",
		"effort",
		"info",
		"login",
		"logout",
		"loop",
		"model",
		"session",
		"team",
	];
	const rows = CASES.map((c) => ({
		...c,
		matches: commandRows(...c.labels),
		prefix: sharedCommandPrefix(c.labels),
	}));
	for (const c of rows) {
		const chosenByHand = false;
		const intent = route({
			key: "Enter",
			active: 0,
			matches: c.matches,
			commandQuery: c.query,
			chosenByHand,
		});
		const runs = pickRuns(c.destination);
		const opensList = Boolean(registryEntry(c.destination)?.inline);
		const line = enterFooter({
			phase: "command",
			command: null,
			label: c.labels[0],
			nameThenMessage: false,
			runs,
			opensList,
			value: "",
			matched: true,
			unambiguous: intent.kind === "apply",
			query: c.query,
			prefix: c.prefix,
		});
		const where = `/${c.query} over ${c.labels.join(", ")}`;

		if (intent.kind === "extend" && intent.prefix === c.query) {
			// The key is inert: the line may not promise a run or a completion, and
			// it must name the gestures that do act.
			assert.equal(
				line,
				"Enter needs a row you pick: ↓ then Enter · Tab completes this row.",
				where,
			);
			continue;
		}
		if (intent.kind === "extend") {
			// The word grows, so the line reports the growth and no run.
			assert.equal(line, `Enter completes to ${intent.prefix}.`, where);
			assert.doesNotMatch(line, /runs/, where);
			continue;
		}
		assert.equal(intent.kind, "apply", where);
		if (intent.run && runs) {
			assert.equal(line, `Enter runs /${c.labels[0]}.`, where);
			continue;
		}
		// Unambiguous, but the destination declines to run on a pick: the line says
		// complete, and adds the second-Enter clause only where there IS one.
		assert.match(
			line,
			new RegExp(`^Enter completes /${c.labels[0]}[.;]`),
			where,
		);
		assert.equal(
			line,
			opensList
				? `Enter completes /${c.labels[0]}.`
				: `Enter completes /${c.labels[0]}; Enter again runs it.`,
			where,
		);
	}

	/*
	 * Tab, in every one of those states: it applies the HIGHLIGHTED row and never
	 * runs, so no state's Tab press can be described by a line that promises a run.
	 */
	for (const c of rows) {
		assert.equal(
			route({
				key: "Tab",
				active: 0,
				matches: c.matches,
				commandQuery: c.query,
				chosenByHand: false,
			}).run,
			false,
			`Tab never runs (/${c.query})`,
		);
	}
});

/*
 * The composition the two halves above live in, pinned as SOURCE because that is
 * where it is written: the intent says "the keyboard named this command", and the
 * one adapter both pick paths share then asks the destination. A reviewer reading
 * these cases should be able to see the `&&` they mirror rather than take a
 * restatement of it on trust.
 */
const MESSAGE_INPUT = readFileSync(
	"src/renderer/src/features/chat/components/message-input.tsx",
	"utf8",
);

test("an unambiguous Enter still asks the destination before it runs", () => {
	assert.match(
		MESSAGE_INPUT,
		/disposition\.run\s*&&\s*\(\s*row\.kind === "command"\s*\?\s*pointerPickRuns\(/,
		"the pick path no longer gates a command row's run on its destination",
	);
	/*
	 * What the two rules compose to, for the ids the REAL registry carries: the
	 * panels and the navigate destinations run on the first Enter, and every
	 * destination whose pick opens an inline list completes and opens it.
	 */
	const enterRuns = (id, label) => {
		const intent = route({ matches: commandRows(label), commandQuery: label });
		return intent.kind === "apply" && intent.run && pickRuns(id);
	};
	for (const [id, label] of [
		["analytics", "analytics"],
		["info", "info"],
		["session.diagnostics", "session"],
		["settings", "settings"],
	]) {
		assert.equal(enterRuns(id, label), true, id);
	}
	for (const [id, label] of [
		["session.model", "model"],
		["session.effort", "effort"],
		["session.approvals", "approvals"],
		["appearance", "theme"],
		["session.team", "team"],
		["session.agent", "agent"],
	]) {
		assert.equal(enterRuns(id, label), false, `${id} opens a list`);
	}
	/*
	 * The three ids a POINTER pick must never run keep their TWO-Enter path: the
	 * predicate that protects them is the one both paths read, so a single Enter
	 * neither detaches the app nor clears the transcript view — the behaviour
	 * `/exit`, `/clear` and `/compact` already had, and Enter's second press is
	 * still what runs them.
	 */
	for (const [id, label] of [
		["window.close", "exit"],
		["transcript.clear", "clear"],
		["session.compact", "compact"],
	]) {
		assert.equal(enterRuns(id, label), false, id);
	}
});

/*
 * The click footer's claim has to be the one the gesture KEEPS. Both the copy
 * and the pick read the same two inputs — a command row's destination rule
 * (`pointerPickRuns`) and an argument list's own `runs` — so the cases below
 * derive the rule from the REAL registry entries and assert the line tracks it.
 * A table edit that made `/analytics` list-bearing, or removed `session.compact`
 * from the protected set, turns this red rather than leaving the copy promising
 * a run the row no longer performs (UX round 2, U10).
 */
test("the click footer says what a click will do, in each state", () => {
	const base = {
		phase: "argument",
		command: "model",
		label: "model",
		nameThenMessage: false,
		runs: true,
		value: "openai/gpt-5",
		matched: true,
	};
	assert.equal(
		clickFooter({ ...base, phase: "command" }),
		"Click runs /model.",
	);
	assert.equal(
		clickFooter({ ...base, phase: "command", runs: false }),
		"Click completes /model.",
	);
	assert.equal(
		clickFooter({ ...base, nameThenMessage: true, runs: false }),
		"Click chooses this name.",
	);
	assert.equal(clickFooter(base), "Click runs /model openai/gpt-5.");
	assert.equal(
		clickFooter({ ...base, runs: false }),
		"Click completes this value.",
	);
	// No row: the empty list's own copy names the route, so a pointer line here
	// would describe a gesture aimed at nothing.
	assert.equal(clickFooter({ ...base, matched: false }), null);
});

test("the click footer never claims a run the pick does not perform", () => {
	const states = [
		// Panel and navigate destinations: the pick IS the gesture.
		["analytics", "analytics"],
		["usage", "usage"],
		// The two REQUIRED-argument commands, a deliberate deviation.
		["auth.login", "login"],
		["auth.logout", "logout"],
		// List-bearing: completing the word opens the list, so the pointer
		// cannot run. `/theme` is the one whose inline list has no run either.
		["session.model", "model"],
		["session.effort", "effort"],
		["session.approvals", "approvals"],
		["appearance", "theme"],
		// NAME+message rows: a name is chosen, then the message is typed.
		["session.team", "team"],
		["session.agent", "agent"],
		// The three protected ids: a stray click must not detach the app, wipe
		// the transcript view or spend a compaction pass.
		["window.close", "exit"],
		["transcript.clear", "clear"],
		["session.compact", "compact"],
	];
	for (const [id, label] of states) {
		const runs = pickRuns(id);
		const line = clickFooter({
			phase: "command",
			command: null,
			label,
			nameThenMessage: false,
			runs,
			value: "",
			matched: true,
		});
		assert.equal(
			line.includes("runs"),
			runs,
			`${id} runs on a pick: ${runs}, and the footer says: ${line}`,
		);
	}
	// A NAME+message row is the state a user cannot see through: its `runs` is
	// false for a reason the row does not show, and the pointer line must say
	// what it does rather than promise a run.
	const name = clickFooter({
		phase: "argument",
		command: "team",
		label: "team",
		nameThenMessage: true,
		runs: false,
		value: "delivery",
		matched: true,
	});
	assert.equal(name, "Click chooses this name.");
	assert.equal(name.includes("runs"), false);
});

/*
 * The two lines describe the same row, so they cannot describe two different
 * rows: whatever Enter's line says about ACTING, the pointer's line is read off
 * the same `runs` input. The property asserted here is the one the manager's
 * brief names — a state where the pointer cannot act must not be described as
 * if it can.
 */
test("the two footer lines cannot disagree about the active row", () => {
	const rows = [
		{
			phase: "command",
			command: null,
			label: "usage",
			runs: true,
			opensList: false,
		},
		{
			phase: "command",
			command: null,
			label: "model",
			runs: false,
			opensList: true,
		},
		{ phase: "argument", command: "model", label: "model", runs: true },
		{ phase: "argument", command: "theme", label: "theme", runs: false },
	];
	for (const row of rows) {
		const click = clickFooter({
			...row,
			nameThenMessage: false,
			value: "v",
			matched: true,
		});
		assert.ok(click, `${row.label} has a pointer line`);
		// "Acting" is the word `runs`: it appears in the pointer line exactly when
		// the pick runs.
		assert.equal(click.includes("runs"), row.runs, `${row.label}: ${click}`);
		if (row.phase === "command") {
			/*
			 * Enter's own line claims a run exactly when BOTH halves hold — the choice
			 * is unambiguous and the destination runs — which is the pair the router
			 * computes (`commandChoiceUnambiguous` and `pickRuns`).
			 */
			const enter = enterFooter({
				phase: "command",
				command: null,
				label: row.label,
				nameThenMessage: false,
				opensList: row.opensList,
				runs: row.runs,
				value: "",
				matched: true,
				unambiguous: true,
				/* Both inputs belong to the AMBIGUOUS arm; the unambiguous one ignores
				   them, and they are carried so this call is the same shape the popup
				   makes rather than a partial literal. */
				query: "lo",
				prefix: "log",
			});
			/*
			 * Anchored, not a substring search: the U4 clause ("Enter completes
			 * /clear; Enter again runs it.") contains the word `runs` while THIS press
			 * does not run, and the property being pinned is what the sentence
			 * promises about the key the user is about to press.
			 */
			assert.equal(
				/^Enter runs /.test(enter),
				row.runs,
				`${row.label}: an unambiguous Enter follows its destination — ${enter}`,
			);
			assert.equal(
				enterFooter({
					phase: "command",
					command: null,
					label: row.label,
					nameThenMessage: false,
					runs: row.runs,
					value: "",
					matched: true,
					unambiguous: false,
					query: "lo",
					prefix: "log",
				}).includes("runs"),
				false,
				"an ambiguous Enter runs nothing, so it cannot say it does",
			);
		}
	}
});

/** Test of the empty copy, kept below the two footer blocks. */
test("the empty copy names which of the four causes it is", () => {
	const list = { rows: [], loading: false, error: null, needsSession: false };
	// An `effort` cold owner reports nothing rather than "this model has none"
	// (`destination-pickers.tsx` carries the same rule for its dialog).
	assert.equal(
		argumentEmptyCopy(list),
		"Not reported yet. Enter runs the command.",
	);
	assert.equal(
		argumentEmptyCopy({ ...list, needsSession: true }),
		"Needs an open conversation. Start one first.",
	);
	assert.equal(
		argumentEmptyCopy({
			...list,
			error: "Could not read the model catalogue.",
		}),
		"Could not read the model catalogue.",
	);
	assert.equal(argumentEmptyCopy({ ...list, loading: true }), "Loading…");
	// Rows behind the list and none of them matching is a fact about the FILTER,
	// which is the sentence UX round 1 U4 asked for.
	assert.equal(
		argumentEmptyCopy({ ...list, rows: [{ value: "delivery" }] }),
		"No matches. Enter runs the command.",
	);
});

/*
 * The state the `argument-phase-no-match` frame photographs has to be one a user
 * reaches by typing, so it is DERIVED here the way the component derives it - a
 * non-empty roster the matcher answers nothing for - rather than trusted from a
 * story fixture. That is also the property the capture's readiness poll needs:
 * with the fixture honest, the only thing that could keep the frame out of the
 * set was the poll itself.
 */
test("the no-match state is what typing a missing team produces", () => {
	const teams = [
		{ value: "delivery", name: "delivery", description: "Ships the release" },
		{
			value: "reviewers",
			name: "reviewers",
			description: "Reviews every diff",
		},
	];
	const rows = argumentRows("team", teams, null);
	assert.ok(rows.length > 0, "the roster is reported");
	assert.equal(matchChoices("zzz", rows).length, 0, "the query excludes it");
	assert.equal(
		argumentEmptyCopy({
			rows,
			loading: false,
			error: null,
			needsSession: false,
		}),
		"No matches. Enter runs the command.",
	);
});

const PICK_RUNS = [
	// Panel destinations. The pick IS the gesture: running opens the panel, and
	// completing alone would leave the word in the composer for a second Enter,
	// which is the operator's report. `/analytics` is the regression row if this
	// is keyed off the registry's `arguments` field instead: it is
	// `arguments: "optional"` with NO inline list, so an `arguments`-keyed rule
	// would complete-only the one command that has nothing to list.
	"analytics",
	"usage",
	"commands",
	"skills",
	// Navigate destinations: the surface they name is the outcome.
	"settings",
	"providers",
	"accounts",
	"updates",
	"mcp",
];

test("a pointer pick runs the command unless completing it opens a list", () => {
	for (const id of PICK_RUNS) {
		assert.ok(registryEntry(id), `${id} is a real destination`);
		assert.equal(pickRuns(id), true, id);
	}
});

test("the two REQUIRED-argument commands run on a pick (a deliberate deviation)", () => {
	/*
	 * The TUI must not run a REQUIRED-argument command on accept, because
	 * accepting there opens an inline list (`Editor.opens_a_list`). These two have
	 * no inline list HERE — the picker IS the provider list, and it is a dialog —
	 * so completing-only would strand the user on `/login ` with nothing to pick.
	 */
	for (const id of ["auth.login", "auth.logout"]) {
		assert.equal(registryEntry(id)?.kind, "picker", id);
		assert.equal(registryEntry(id)?.inline, undefined, id);
		assert.equal(pickRuns(id), true, id);
	}
});

test("a list-bearing command completes and never runs", () => {
	for (const [id, source] of [
		["session.model", "model"],
		["session.effort", "effort"],
		["session.approvals", "approvals"],
		// `/theme`: an inline list whose apply path is a dialog (`runs: false`).
		["appearance", "theme"],
	]) {
		assert.equal(registryEntry(id)?.inline?.source, source, id);
		assert.equal(pickRuns(id), false, id);
	}
	// A NAME+message row (`/team`, `/agent`): "a name is chosen" is "ready for the
	// message", never "run it".
	for (const id of ["session.team", "session.agent"]) {
		assert.equal(registryEntry(id)?.inline?.nameThenMessage, true, id);
		assert.equal(pickRuns(id), false, id);
	}
});

test("the three protected destinations are protected by id, not by kind", () => {
	// All three are `direct` now, and a rule written off the kind alone would run
	// every one of them — a stray click would detach the app, wipe the transcript
	// view or start a compaction. That is exactly why the protection is a set of
	// IDs rather than a property of the kind: `/compact` moving from a picker to a
	// direct destination must not make a stray click able to spend a pass.
	assert.equal(registryEntry("window.close")?.kind, "direct");
	assert.equal(registryEntry("transcript.clear")?.kind, "direct");
	assert.equal(
		registryEntry("session.compact")?.kind,
		"direct",
		"`/compact` presents by running, not by opening a dialog",
	);
	assert.equal(
		registryEntry("session.compact")?.inline,
		undefined,
		"and it lists nothing, so only the protected set keeps it from running",
	);
	for (const id of ["window.close", "transcript.clear", "session.compact"])
		assert.equal(pickRuns(id), false, id);
});

test("a destination with no row here answers by kind, not by id", () => {
	/*
	 * The arm for an id this build has not learned: nothing is known about it, so
	 * a pointer pick RUNS and the dispatcher answers with its own honest note.
	 *
	 * The id is synthetic on purpose. This test used to name `info` and
	 * `session.diagnostics` as its examples — the ids the other side routes as
	 * `{kind: "picker"}` panels — and it went red the day their rows landed here
	 * with `origin/main` (0.23.0, merged into this branch). Naming a real id as
	 * "not routed yet" makes a promise about somebody else's registry; the rule
	 * is about the ABSENCE of a row, so the assertion takes an absent one.
	 */
	const unrouted = "session.not-a-destination";
	assert.equal(registryEntry(unrouted), undefined, `${unrouted} is not routed`);
	assert.equal(pickRuns(unrouted), true, unrouted);

	/*
	 * And the landed form of what those two stood for, which is the half worth
	 * keeping: both ids are rows now, and a pick still runs them — a panel with
	 * no inline list, read off the kind rather than off either id.
	 *
	 * The two ids no longer share a KIND, and that difference is now the
	 * load-bearing fact about them: `/info` describes the machine, so it is a
	 * `machine-panel` that any host can present, while `/session` reads a
	 * conversation and stays a `picker` the chat pane owns. What they still share —
	 * and what this arm is about — is that neither declares an inline source, so a
	 * pointer pick RUNS it. Both are asserted per id rather than as one set.
	 */
	const panels = [
		{ id: "info", kind: "machine-panel" },
		{ id: "session.diagnostics", kind: "picker" },
	];
	for (const { id, kind } of panels) {
		assert.equal(registryEntry(id)?.kind, kind, id);
		assert.equal(
			registryEntry(id)?.inline,
			undefined,
			`${id} lists nothing, so a pick runs it`,
		);
		assert.equal(pickRuns(id), true, id);
	}
});

/*
 * The arming route, which is the one pick rule that does not COMPLETE: the row is
 * hoisted to the front of the draft and STAGED so the next Enter runs it. The
 * vocabulary is DERIVED here the way the composer derives it — from a catalogue
 * row whose destination the picker registry routes (`ARMED_ROW` above,
 * `registryEntry("session.goal")` in the paired case below) — rather than handed
 * in as a literal set, which is what let a destination rename empty the set with
 * no red test (review F4 / QA Q3). Both halves are exercised as shipped code: the
 * ROW gate here, the DRAFT write from the planner.
 */
const ARMED_ONLY = armedOnlyVocabulary([ARMED_ROW]);
/* The words a registry with goal, team, model and loop in it would derive. */
const WORDS = new Set(["goal", "team", "model", "loop"]);
/*
 * The other two vocabularies `useSlashCompletion` derives from the same
 * catalogue, so the pick chain below is driven with the sets the composer
 * passes rather than with a shape invented here.
 */
const PROMPT = new Set(["loop", "team"]);
const NAME_LIST = new Set(["team"]);

/** `planSlashSubmission` with the vocabularies above, which is what the pick runs. */
const submissionFor = (draft, caret, gesture = "typed") =>
	planSlashSubmission({
		draft,
		caret,
		commandNames: WORDS,
		promptCommands: PROMPT,
		armedOnlyCommands: ARMED_ONLY,
		nameListCommands: NAME_LIST,
		enabled: true,
		/*
		 * The gesture the real caller would be making, and the default is the
		 * conservative one. A PICK of a row is an explicit choice, so a command
		 * chosen that way is a command wherever it sits in the draft — the row's
		 * own footer says what the click does, and this is the planner's half of
		 * keeping it (`message-input.tsx`'s pick path passes `"pick"`).
		 */
		gesture,
	});

/** A command row, keyed by the name OR ALIAS that matched (`rowId`'s `label`). */
const armedRow = (label) => ({ kind: "command", label });

/**
 * The draft as `completionFor` leaves it: the picked word written IN PLACE.
 * Computed rather than typed out, so a change in what the pick writes moves both
 * suites instead of leaving them green against a stale string (review F7).
 */
const PICKED = completionFor(
	"I approve spend /goal",
	21,
	armedRow("goal"),
	WORDS,
	[],
	false,
).text;

test("a pick of the armed row hoists and stages; other rows are unchanged", () => {
	assert.equal(pickArmsCommand(armedRow("goal"), ARMED_ONLY), true);
	// An ALIAS arms too: the row carries whichever of the two matched, and the set
	// holds the primaries and the aliases together, exactly as `commandNames` does.
	assert.equal(
		pickArmsCommand(armedRow("goals"), new Set(["goal", "goals"])),
		true,
	);
	/*
	 * `/team` is the other `consumes_prompt` command and keeps the completion
	 * path this change left alone: an assembled `/team ops <message>` line is one
	 * the user asked to read before it ran, and nothing about the goal report
	 * moves it.
	 */
	assert.equal(pickArmsCommand(armedRow("team"), ARMED_ONLY), false);
	assert.equal(pickArmsCommand(armedRow("model"), ARMED_ONLY), false);
	// An argument row never arms: an arming gesture NAMES a command.
	assert.equal(pickArmsCommand(argumentRow("gpt-5"), ARMED_ONLY), false);
	// The comparison is the vocabulary's case handling, not the row's spelling.
	assert.equal(pickArmsCommand(armedRow("Goal"), ARMED_ONLY), true);

	/*
	 * And the route's own write, which is the half a user sees: the picked word is
	 * hoisted to the front with the surviving draft behind it, staged in the box
	 * for the next Enter. The completion is what the pick has always written
	 * (`... /goal `, in place, caret after it).
	 */
	assert.deepEqual(
		planSlashArming({
			draft: PICKED,
			caret: PICKED.length,
			commandNames: WORDS,
			armedOnlyCommands: ARMED_ONLY,
		}),
		{ kind: "armed", text: "/goal I approve spend", caret: 21 },
	);
	// Nothing to arm: a bare `/goal ` pick stays the plain completion it has
	// always been, and the next Enter reaches the bare form's own READ.
	assert.deepEqual(
		planSlashArming({
			draft: "/goal ",
			caret: 6,
			commandNames: WORDS,
			armedOnlyCommands: ARMED_ONLY,
		}),
		{ kind: "none" },
	);
});

/*
 * THE OPERATOR'S CASE, as a routing decision. `I approve spend /goal` with the
 * popup open: the row is pre-selected (nothing moved the marker), so a plain
 * Enter is the SUBMIT key, not the arming gesture — the draft goes as prose. The
 * arming is a choice the user makes: an arrow key on the row, or the pointer.
 */
test("the keyboard rule is the popup's own, and the arm belongs to the pick", () => {
	/*
	 * The composed contract, in one test: #221's rule decides the KEY — an
	 * unambiguous Enter applies AND acts, an ambiguous one grows the word, Tab
	 * completes and never acts — and what that apply DOES is the pick's
	 * (`handleSlashPick`): a pick of an armed-only row whose draft survives arming
	 * hoists the command and stages the line instead of running the destination.
	 *
	 * So no `armedOnlyCommands` vocabulary and no `hoists` flag are needed here any
	 * more: the row and the draft are both in hand at the pick, which is where the
	 * arm is decided, and the composer's own Enter over a draft that merely
	 * CONTAINS the word never reaches an armed row at all — the planner answers
	 * `send` (`scripts/slash-submit.test.mjs` pins that). What the key owes the
	 * user is that it does not act on a row nobody chose.
	 */
	const list = [armedRow("goal")];
	// Unambiguous: the query IS the label (and a one-row list is unambiguous
	// whatever is typed), so this is the acting apply the pick then stages.
	assert.deepEqual(route({ matches: list, commandQuery: "goal" }), {
		kind: "apply",
		index: 0,
		run: true,
	});
	// Tab is the completing key: it applies and never acts, which is what makes it
	// the safe key while a list is narrowed (#221's rule, kept exactly).
	assert.deepEqual(route({ matches: list, commandQuery: "goal", key: "Tab" }), {
		kind: "apply",
		index: 0,
		run: false,
	});
	// Ambiguous: the row is not acted on. This is the state a bare `/` over the
	// whole catalogue is in, and the reason nothing arms from a stray press.
	assert.deepEqual(
		route({
			matches: [armedRow("goal"), armedRow("goals")],
			commandQuery: "go",
		}),
		{ kind: "extend", prefix: "goal" },
	);
	// A name-list row fills the name and never runs, as it always has.
	assert.deepEqual(
		route({
			matches: [{ kind: "argument", row: { value: "alpha" } }],
			argumentQuery: "al",
			nameThenMessage: true,
		}),
		{ kind: "apply", index: 0, run: false },
	);
});

/*
 * THE FOOTER AND THE ROUTE, READ TOGETHER.
 *
 * Review F2 / QA Q5 / UX U2 / design D1: the popup printed "Enter completes the
 * command." and "Click runs /goal." for the one row whose Enter now hoists and
 * stages, and the test that pinned the pair derived its `runs` one-sidedly, so it
 * stayed green. This case asks the ROUTE what the two gestures do — the row's
 * arming (`pickArmsCommand`), the click's real outcome (`planSlashArming` on the
 * line `completionFor` writes) and the key's (`slashKeyIntent`) — and then
 * asserts the two lines say exactly that. A future edit to either side has to
 * keep them agreeing.
 */
test("the goal row's footer lines describe the gestures the route performs", () => {
	// Read off the tree, not restated: the destination the vocabulary arms is one
	// the picker registry routes.
	const entry = registryEntry("session.goal");
	assert.ok(entry, "session.goal is a destination the picker registry routes");

	// The row half, from the vocabulary the catalogue derives.
	const arms = pickArmsCommand(armedRow("goal"), ARMED_ONLY);
	assert.equal(arms, true, "a pick of the goal row arms it");

	// `pointerPickRuns` still answers TRUE for this destination (a picker with no
	// inline list), which is exactly why neither line may be read off it alone:
	// the gesture STAGES this draft and runs nothing.
	assert.equal(pickRuns("session.goal"), true);
	const picked = completionFor(
		"I approve spend /goal",
		21,
		armedRow("goal"),
		WORDS,
		[],
		false,
	);
	const drafted = planSlashArming({
		draft: picked.text,
		caret: picked.caret,
		commandNames: WORDS,
		armedOnlyCommands: ARMED_ONLY,
	});
	assert.equal(drafted.kind, "armed");

	/*
	 * Both lines, on the pane the operator's own report was taken on. The arm is
	 * the row's own outcome on the ACTING key — #221's unambiguous apply, which is
	 * what `handleSlashPick` answers by staging the hoisted line — so there is ONE
	 * sentence here rather than a by-hand and a typed variant. It says what the
	 * pick does: not "runs", which the destination's `pointerPickRuns` alone would
	 * have claimed, and not "completes", which the completion alone would.
	 */
	const composed = {
		phase: "command",
		command: null,
		label: "goal",
		nameThenMessage: false,
		runs: pickRuns("session.goal"),
		arms,
		takesDraft: false,
		destination: "session.goal",
		paneHasSession: true,
		hoists: true,
		value: "",
		matched: true,
		unambiguous: true,
	};
	const enterLine = enterFooter(composed);
	assert.equal(enterLine, "Enter stages /goal; the next Enter runs it.");
	assert.equal(enterLine.includes("completes"), false);
	assert.equal(clickFooter(composed), "Click stages /goal.");
	assert.equal(clickFooter(composed).includes("runs"), false);

	// Nothing survives the word — a bare `/goal` — so the pick completes it and the
	// bare form is run by the next Enter. That is #221's own answer and it stays.
	assert.equal(
		enterFooter({ ...composed, hoists: false }),
		"Enter runs /goal.",
	);

	// The KEY those lines describe: #221's rule, with the staging decided by the
	// pick. An unambiguous Enter is the acting apply...
	assert.deepEqual(
		route({ matches: [armedRow("goal")], commandQuery: "goal" }),
		{
			kind: "apply",
			index: 0,
			run: true,
		},
	);
	// ...while Tab completes and never acts, so it never arms either.
	assert.deepEqual(
		route({ matches: [armedRow("goal")], commandQuery: "goal", key: "Tab" }),
		{ kind: "apply", index: 0, run: false },
	);
});

/*
 * THE CLICK LINE IS THE ROW'S ROUTE, for the rows the armed fix did not reach.
 *
 * UX U2: `/loop` — the row this delta's own remediation writes down as its
 * control — printed "Click runs /loop." while the click reassembled the draft
 * and sent nothing, because the line was read off `pointerPickRuns` alone. That
 * answers "does this destination's pick run"; it does not answer "does THIS
 * pick run". The chain below is the pick's own (`completionFor` →
 * `planSlashSubmission`), so the line cannot be green against a route the pick
 * does not take.
 */
test("the click line is the row's real route, for the prompt row too", () => {
	const loop = armedRow("loop");
	const runs = pickRuns("session.loop");
	assert.equal(
		runs,
		true,
		"a pick of the loop destination reaches the run path",
	);

	// The drafted form: the pick writes the word, the planner REASSEMBLES, and a
	// reassembled line is never auto-submitted — so nothing ran, and the box was
	// rewritten in front of the user.
	const picked = completionFor(
		"please run /loop on 3 tasks",
		16,
		loop,
		WORDS,
		[],
		false,
	);
	assert.equal(picked.text, "please run /loop  on 3 tasks");
	assert.equal(
		submissionFor(picked.text, picked.caret, "pick").kind,
		"reassemble",
	);

	const line = clickFooter({
		phase: "command",
		command: null,
		label: "loop",
		nameThenMessage: false,
		runs,
		arms: false,
		takesDraft: true,
		hoists: true,
		value: "",
		matched: true,
	});
	assert.equal(line, "Click stages /loop.");
	assert.equal(line.includes("runs"), false);
	// The predicate the line is read from, asserted on its own: the staging claim
	// belongs to the ROUTE (an armed row with a draft, or a prompt row whose pick
	// reaches the run path), not to the destination's `runs` alone.
	assert.equal(
		pickStagesDraft({
			runs: true,
			arms: true,
			takesDraft: false,
			hoists: true,
		}),
		true,
	);
	assert.equal(
		pickStagesDraft({
			runs: true,
			arms: true,
			takesDraft: false,
			hoists: false,
		}),
		false,
		"a bare armed row runs, which is the state the read opens in",
	);
	assert.equal(
		pickStagesDraft({
			runs: true,
			arms: false,
			takesDraft: true,
			hoists: true,
		}),
		true,
	);
	assert.equal(
		pickStagesDraft({
			runs: false,
			arms: false,
			takesDraft: true,
			hoists: true,
		}),
		false,
		"an inline-list row never reaches the run path",
	);

	// The same row with nothing to reassemble really does run, and the line says
	// so — the distinction a one-sided `runs` could not make.
	const bare = completionFor("/loop", 2, loop, WORDS, [], false);
	assert.equal(submissionFor(bare.text, bare.caret).kind, "whole");
	assert.equal(
		clickFooter({
			phase: "command",
			command: null,
			label: "loop",
			nameThenMessage: false,
			runs,
			arms: false,
			takesDraft: true,
			hoists: false,
			value: "",
			matched: true,
		}),
		"Click runs /loop.",
	);

	// And the row the predicate deliberately excludes: `/team`'s destination opens
	// an inline list, so its pick never reaches the run path and its line keeps
	// saying it completes.
	assert.equal(pickRuns("session.team"), false);
	assert.equal(
		clickFooter({
			phase: "command",
			command: null,
			label: "team",
			nameThenMessage: false,
			runs: false,
			arms: false,
			takesDraft: true,
			hoists: true,
			value: "",
			matched: true,
		}),
		"Click completes /team.",
	);
});

/*
 * THE FREE-TEXT ROW'S OWN LINE (UX U3). This key completes the word; the key
 * that MOVES the draft is the next one, on the composer, where the popup is
 * closed and nothing on screen says it will happen. Both lines are read from the
 * one staging predicate, so the rule that separates `/goal` from `/loop` cannot
 * be stated on one row and contradicted on the other.
 *
 * THE INPUTS ARE THE COMPONENT'S OWN, which is the half round 3 found missing:
 * this test used to hand `enterFooter` a `runs: true` the popup never produces
 * for the row, so it stayed green while the app printed the fallback in every
 * state the popup can be in (review F2 / QA Q3-1). `activeRowRuns` is what
 * `slash-commands.tsx` passes BOTH footer lines, driven here off the real
 * destination table the way the component drives it.
 */
test("the free-text row names the key that moves the draft", () => {
	/*
	 * The command phase's inputs: the popup is up on a COMMAND row, so there is no
	 * argument list to read a `runs` off — `inline` is built from `argumentWord`,
	 * which is built from `slashArgumentContext`, and this state's phase is
	 * `"command"` precisely because that context is null. The two phases are
	 * disjoint by construction, so the expression the popup used to pass here
	 * (`state.inline?.runs ?? false`) was a constant `false` in every state this
	 * test is about. Asserted rather than described, so a tokenizer that let the
	 * two phases overlap would fail here instead of quietly restoring the bug.
	 */
	const ARGUMENT_WORDS = ["model", "team"];
	assert.ok(registryEntry("session.model")?.inline, "model's list is real");
	assert.ok(registryEntry("session.team")?.inline, "team's list is real");
	/*
	 * A draft-OPENING command, because that is the position this branch's rule
	 * gives the phase to (`commandWordOpensDraft`): a word typed inside a sentence
	 * is prose, the popup does not open on it, and Q2 of round 2 measured exactly
	 * that from the keyboard. The phase's own property — a command row has no
	 * argument list to read a `runs` off, because `slashArgumentContext` is null
	 * there — is unchanged by where the row was raised.
	 */
	assert.equal(caretPhase("/loop", 5, WORDS, ARGUMENT_WORDS), "command");
	assert.equal(slashArgumentContext("/loop", ARGUMENT_WORDS, 5, WORDS), null);

	// The row's own route for that state, read the way the component reads it:
	// from the DESTINATION the registry routes `/loop` to, not from an argument
	// list this phase has not got.
	const loopRuns = activeRowRuns({
		destination: "session.loop",
		entry: registryEntry("session.loop"),
		inlineRuns: false,
	});
	assert.equal(loopRuns, true, "`/loop`'s pick reaches its own run path");

	const hoisting = {
		phase: "command",
		command: null,
		nameThenMessage: false,
		runs: loopRuns,
		arms: false,
		takesDraft: true,
		hoists: true,
		paneHasSession: true,
		value: "",
		matched: true,
		unambiguous: true,
	};
	assert.equal(
		enterFooter({ ...hoisting, label: "loop" }),
		"Enter stages /loop; the next Enter runs it.",
	);
	/*
	 * The gesture is the PICK's, and this is the round-3 merge's one semantic
	 * seam: a mid-draft prompt command hoists when the user CHOSE the row (the
	 * footer above is read from `hoists`/`takesDraft`, which are the row's own
	 * claims), and is prose when the word was merely typed — `submissionFor`'s
	 * default, asserted on the next line.
	 */
	assert.equal(
		submissionFor("please run /loop on 3 tasks", 16, "pick").kind,
		"reassemble",
		"and that is the plan the composer's next Enter takes, after the pick",
	);
	assert.deepEqual(
		submissionFor("please run /loop on 3 tasks", 16),
		{ kind: "send" },
		"typed rather than picked, the same sentence is sent as written",
	);

	// Nothing to move: the bare word completes and the next Enter RUNS it, so the
	// row says the thing it has always said.
	assert.equal(
		enterFooter({ ...hoisting, label: "loop", hoists: false }),
		"Enter runs /loop.",
	);
	// A list-bearing prompt row is not this row: `/team`'s pick opens the roster,
	// and the key after the completion belongs to that list rather than to a
	// reassembly. Its `runs` comes off the same derivation, so the two rows are
	// separated by the destination table rather than by a second literal.
	const teamRuns = activeRowRuns({
		destination: "session.team",
		entry: registryEntry("session.team"),
		inlineRuns: false,
	});
	assert.equal(teamRuns, false, "`/team` opens its roster instead");
	// Its destination DOES declare an inline list, which is the second half of
	// #221's table for a `runs: false` row: the completion opens the roster, so
	// there is no second-Enter clause to promise. Read off the registry, the way
	// the popup's own call site reads it (`inlineArgumentFor`).
	assert.equal(
		Boolean(registryEntry("session.team")?.inline),
		true,
		"`/team`'s destination declares an inline list",
	);
	assert.equal(
		enterFooter({
			...hoisting,
			label: "team",
			runs: teamRuns,
			opensList: Boolean(registryEntry("session.team")?.inline),
		}),
		"Enter completes /team.",
	);
	// And a row with no draft to take keeps the plain sentence whatever its pick
	// does with one.
	assert.equal(
		enterFooter({ ...hoisting, label: "usage", takesDraft: false }),
		"Enter runs /usage.",
	);
	// The ARGUMENT phase's half of the same derivation, unchanged: there the
	// active row is not a command row and its list answers for itself.
	assert.equal(
		activeRowRuns({
			destination: undefined,
			entry: undefined,
			inlineRuns: true,
		}),
		true,
	);
	assert.equal(
		activeRowRuns({
			destination: undefined,
			entry: undefined,
			inlineRuns: false,
		}),
		false,
	);
	// The one rule both lines are read from, so the pairing is pinned rather than
	// implied by two strings agreeing.
	assert.equal(
		rowTakesDraft({ runs: true, takesDraft: true, hoists: true }),
		true,
	);
	assert.equal(
		rowTakesDraft({ runs: true, takesDraft: true, hoists: false }),
		false,
		"nothing survives the line: the next Enter runs the bare command",
	);
});

/*
 * THE PANE'S OWN ANSWER (UX U1 / design D3). The note and the arming line are the
 * two surfaces on either side of the same Enter, and on a pane that cannot
 * address a session the dispatcher refuses the command between them. A promise
 * from the popup and a refusal from the stream, one keystroke apart, is the state
 * U1 measured; both now carry the pane's answer.
 */
/** The refusal clause `stagedNote` and the arming lines both carry. */
const NEEDS_CONVERSATION = /Needs an open conversation/;

test("the staging lines decline to promise a run on a pane with no session", () => {
	const composed = {
		phase: "command",
		command: null,
		label: "goal",
		nameThenMessage: false,
		runs: false,
		arms: true,
		takesDraft: false,
		destination: "session.goal",
		hoists: true,
		value: "",
		matched: true,
		unambiguous: true,
	};
	/*
	 * A pane that cannot address a session gets the staging sentence with the
	 * refusal's own clause where the promise would be — on BOTH rows that stage,
	 * because both of them promise "the next Enter runs it". The promise is the
	 * half that goes false on this pane (design D3 / UX U1), and the note carries
	 * the same clause for the same reason.
	 */
	assert.equal(
		enterFooter({ ...composed, paneHasSession: false }),
		"Enter stages /goal; this pane needs an open conversation to run it.",
	);
	assert.equal(
		enterFooter({ ...composed, paneHasSession: true }),
		"Enter stages /goal; the next Enter runs it.",
	);
	assert.equal(
		enterFooter({ ...composed, paneHasSession: false }).includes(
			"the next Enter",
		),
		false,
		"the run promise is the half that goes false on this pane",
	);
	// The free-text row's line, on the same pane and for the same reason.
	const hoisting = {
		...composed,
		label: "loop",
		runs: true,
		arms: false,
		takesDraft: true,
	};
	assert.equal(
		enterFooter({ ...hoisting, paneHasSession: false }),
		"Enter stages /loop; this pane needs an open conversation to run it.",
	);
	// The note and the line now say the same thing about the same pane, which is
	// the pair U1 was raised on: a promise in the popup, a refusal in the stream.
	assert.match(
		stagedNote("/goal I approve spend", "session.goal", false),
		NEEDS_CONVERSATION,
	);
	assert.match(reassembledNote("/loop please run", false), NEEDS_CONVERSATION);
});

/*
 * The staged line's receipt, in one place (review F6: the sentence named the
 * goal over a generic mechanism, and it promised a key a pane with no
 * conversation cannot honour — UX U5 / design D5).
 */
test("the staged note's promise is the destination's, and the pane's", () => {
	assert.equal(
		stagedNote("/goal I approve spend", "session.goal", true),
		"Staged /goal I approve spend. Enter sets the goal and sends the text.",
	);
	// The promise is the DESTINATION's own sentence rather than a second, vaguer
	// one for the same key (design D4): the footer names the effect generically
	// ("the next Enter runs it") and the note the user is left looking at names it
	// exactly, from the one table, so the two cannot drift.
	assert.equal(
		stagedNote("/goal I approve spend", "session.goal", true),
		`Staged /goal I approve spend. Enter ${stagedPromiseVerb("session.goal")}.`,
	);
	// A pane with no conversation: the dispatcher refuses `/goal` there, so the
	// note says what it can do instead of promising the goal will be set. The
	// sentence is the dispatcher's own, so the refusal the user reads next says
	// the same thing.
	assert.equal(
		stagedNote("/goal I approve spend", "session.goal", false),
		"Staged /goal I approve spend. Needs an open conversation; start one first.",
	);
	// A second armed destination inherits an honest sentence rather than the
	// goal's: the staging is generic, the promise is the command's.
	assert.equal(
		stagedNote("/objective ship it", "session.other", true),
		"Staged /objective ship it. Enter runs it.",
	);
	// A quote that already ends in a stop does not get a second one: the note's
	// template appended its own full stop to the user's text, which the multi-line
	// collapse made visible (`…and then run the release.. Enter sets …` — QA
	// round 2, Q2-2).
	assert.equal(
		stagedNote(
			"/goal Please fix the flaky test and then run the release.",
			"session.goal",
			true,
		),
		"Staged /goal Please fix the flaky test and then run the release. Enter sets the goal and sends the text.",
	);
	assert.equal(stagedSentence("ship it"), "ship it.");
	assert.equal(stagedSentence("ship it."), "ship it.");
	assert.equal(stagedSentence("what?"), "what?");
	/*
	 * The stop is not ASCII's alone. The quote is the user's own text in whatever
	 * script they typed it in, and the ASCII-only class let the template append its
	 * own full stop after a sentence that had already ended: `完了。.` (review F4).
	 * The set is the composed CJK enders plus the ellipsis character.
	 */
	assert.equal(stagedSentence("完了。"), "完了。");
	assert.equal(stagedSentence("本当！"), "本当！");
	assert.equal(stagedSentence("なぜ？"), "なぜ？");
	assert.equal(stagedSentence("待って…"), "待って…");
	assert.equal(
		reassembledNote("完了。", true),
		"Staged 完了。 Enter again runs it.",
		"and the note that quotes it punctuates it once",
	);
	/*
	 * THE REASSEMBLY'S NOTE carries the same clause, from the same helper family
	 * (review F3): the composer stages the reassembled line through
	 * `reassembledNote`, which shares this clause and the quote's punctuation with
	 * `stagedNote` but keeps its own verb — "again" is the signal round 1 UX U7
	 * asked for, that the key the user just pressed moved their sentence rather
	 * than sending it. What the pane clause buys is the last line below: on a pane
	 * that can address no session, `Enter again runs it` was a promise the
	 * dispatcher breaks one keystroke later.
	 */
	assert.equal(
		reassembledNote("/loop please run", true),
		"Staged /loop please run. Enter again runs it.",
	);
	assert.equal(
		reassembledNote("/loop please run", false),
		`Staged /loop please run. ${NO_CONVERSATION_CLAUSE}`,
	);
	// The clause is ONE string, so the two notes cannot drift into two refusals.
	assert.ok(
		stagedNote("/goal I approve spend", "session.goal", false).endsWith(
			NO_CONVERSATION_CLAUSE,
		),
	);
	assert.ok(
		reassembledNote("/loop please run", false).endsWith(NO_CONVERSATION_CLAUSE),
	);
});

/*
 * The sentence a LOCKED run raises, and the two promises it may make (design round
 * 1's D1/D2; UX round 2's U2/U3/U8/U9/U12; code review round 2's MINOR 3/MINOR 4).
 *
 * Pinned as text rather than as a shape, like its two siblings above, because what
 * this note owes the user is exactly its words: what happened to the words after the
 * token, that a command-line value is not stored, where the value belongs, and — only
 * where there is something honest to hand back — the key that puts the words back.
 * The four things it may never do are asserted with it: echo the value (the tail is a
 * secret and this lands in the transcript), promise a dialog a pane cannot open,
 * promise a key over a mask the app cannot restore, or restate the dispatcher's own
 * refusal in a second vocabulary.
 */
test("the locked run's sentence says what happened and what it can give back", () => {
	assert.equal(lockedRunUndoCap(true), "⌘Z");
	assert.equal(lockedRunUndoCap(false), "Ctrl+Z");

	// Both promises: the dialog opens, and the record holds the user's characters.
	assert.equal(
		lockedCommandNote("credential", { dialog: true, undo: true }, true),
		"The words after /credential were taken as its argument, and a value written on a command line is not stored. Enter the secret in the dialog's Name and Value fields. Press ⌘Z in the composer to put the words back.",
	);
	// The key is named WITH ITS HOME, and that is the round-2 correction: the press
	// leaves the keyboard in the dialog it opened, where the chord is the field's own
	// (UX U9 / QA Q-2).
	assert.match(
		lockedCommandNote("credential", { dialog: true, undo: true }, true),
		/in the composer to put the words back\.$/,
	);

	// No dialog (a pane with no conversation, or a word the catalogue cannot resolve):
	// the words and the way back, and the dispatcher's own sentence explains the rest.
	assert.equal(
		lockedCommandNote("credential", { dialog: false, undo: true }, false),
		"The words after /credential were taken as its argument, and a value written on a command line is not stored. Press Ctrl+Z in the composer to put the words back.",
	);
	assert.ok(
		!/Name and Value fields/.test(
			lockedCommandNote("credential", { dialog: false, undo: true }, true),
		),
		"a pane that cannot open the dialog is not promised one",
	);

	// A mask the app cannot restore (a restored draft's literal cells, whose value did
	// not survive §6): the destination, and NO promise of the key (UX U8).
	assert.equal(
		lockedCommandNote("credential", { dialog: true, undo: false }, true),
		"The words after /credential were taken as its argument, and a value written on a command line is not stored. Enter the secret in the dialog's Name and Value fields.",
	);
	// And with neither: the one true clause, which the dispatcher's own note follows.
	assert.equal(
		lockedCommandNote("cred", { dialog: false, undo: false }, true),
		"The words after /cred were taken as its argument, and a value written on a command line is not stored.",
	);

	// Never the value: the sentence is a function of the word, the two facts and the
	// platform, and of nothing else.
	assert.equal(
		lockedCommandNote("credential", { dialog: true, undo: true }, true),
		lockedCommandNote("credential", { dialog: true, undo: true }, true),
	);
});
