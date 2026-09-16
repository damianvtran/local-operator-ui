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
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	argumentEmptyCopy,
	argumentRows,
	candidateKey,
	chosenByHandSurvives,
	clickFooter,
	enterFooter,
	extensionFor,
	matchChoices,
	phaseLabel,
	pointerPickRuns,
	rowId,
	sharedCommandPrefix,
	slashKeyIntent,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The pick rule's inputs are the DESTINATION TABLE's own fields — a
 * destination's kind and whether it declares an inline list — so the cases
 * below read them off `picker-registry.tsx` rather than restating them: a table
 * edit that gave `/analytics` a list, or made `session.compact` routable, has to
 * turn this file red instead of passing against a stale copy.
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
const KIND = /kind: "(\w+)"/;
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
		{ kind: "move", index: 1 },
	);
	assert.deepEqual(
		route({ key: "ArrowDown", active: 1, matches: [commandRow, commandRow] }),
		{ kind: "move", index: 1 },
	);
	assert.deepEqual(
		route({ key: "ArrowUp", active: 1, matches: [commandRow, commandRow] }),
		{ kind: "move", index: 0 },
	);
	assert.deepEqual(
		route({ key: "ArrowUp", active: 0, matches: [commandRow, commandRow] }),
		{ kind: "move", index: 0 },
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
	};
	/*
	 * The command phase has THREE answers now, and they are read off the same two
	 * inputs the router decides from: unambiguous + a running destination RUNS,
	 * unambiguous + a list-bearing destination completes (the word opens the list),
	 * and an ambiguous query grows the word instead.
	 */
	assert.equal(
		enterFooter({ ...base, phase: "command", label: "usage" }),
		"Enter runs /usage.",
	);
	assert.equal(
		enterFooter({ ...base, phase: "command", runs: false }),
		"Enter completes /model.",
	);
	assert.equal(
		enterFooter({ ...base, phase: "command", unambiguous: false }),
		"Enter completes to log.",
	);
	/*
	 * The two states where Enter cannot narrow at all, and the copy has to say so
	 * rather than promise a change (review round 1, N2): the word already IS the
	 * shared prefix, or the candidates share nothing.
	 */
	assert.equal(
		enterFooter({
			...base,
			phase: "command",
			unambiguous: false,
			query: "log",
			prefix: "log",
		}),
		"Enter keeps the word: it is already the common prefix.",
	);
	assert.equal(
		enterFooter({
			...base,
			phase: "command",
			unambiguous: false,
			query: "",
			prefix: "",
		}),
		"Enter cannot narrow this: these commands share no prefix.",
	);
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
		{ phase: "command", command: null, label: "usage", runs: true },
		{ phase: "command", command: null, label: "model", runs: false },
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
			assert.equal(
				enter.includes("runs"),
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
		"Not reported yet. Enter opens the full picker.",
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
		"No matches. Enter opens the full picker.",
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
		"No matches. Enter opens the full picker.",
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
	// Two are `direct` and one is a `picker` with no inline list, so a rule
	// written off the kind alone would run all three — and a stray click would
	// detach the app, wipe the transcript view or start a compaction.
	assert.equal(registryEntry("window.close")?.kind, "direct");
	assert.equal(registryEntry("transcript.clear")?.kind, "direct");
	assert.equal(registryEntry("session.compact")?.kind, "picker");
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
	 */
	for (const id of ["info", "session.diagnostics"]) {
		assert.equal(registryEntry(id)?.kind, "picker", id);
		assert.equal(
			registryEntry(id)?.inline,
			undefined,
			`${id} lists nothing, so a pick runs it`,
		);
		assert.equal(pickRuns(id), true, id);
	}
});
