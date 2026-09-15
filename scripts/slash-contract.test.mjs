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
			'export { armedOnlyVocabulary, planSlashArming } from "./src/renderer/src/features/chat/components/slash-submit";',
			/* The pick's own write, so the footer/route pair below is read off the
			   line a real pick produces rather than a hand-built string (review F7). */
			'export { completionFor } from "./src/renderer/src/features/chat/components/slash-completion";',
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
	armedOnlyVocabulary,
	candidateKey,
	chosenByHandSurvives,
	completionFor,
	clickFooter,
	enterFooter,
	matchChoices,
	phaseLabel,
	pickArmsCommand,
	planSlashArming,
	pointerPickRuns,
	rowId,
	slashKeyIntent,
	stagedNote,
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
		argumentCommand: "model",
		nameThenMessage: false,
		runs: true,
		chosenByHand: false,
		// No armed words and no draft to hoist: `slash-commands.stories.tsx`'s own
		// neutral state, so every existing case below keeps the routing it had.
		armedOnlyCommands: new Set(),
		hoists: false,
		...over,
	});

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

test("a command row completes and never runs", () => {
	// Criterion: Enter on a half-typed command word opens its argument list; a
	// run here would submit a command the user has not finished naming.
	assert.deepEqual(route({ matches: [commandRow, commandRow], active: 1 }), {
		kind: "apply",
		index: 1,
		run: false,
	});
	// A list with no row at the marker completes nothing and is not a key the
	// popup consumed.
	assert.deepEqual(route({ matches: [] }), { kind: "pass" });
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
		nameThenMessage: false,
		runs: true,
		value: "openai/gpt-5",
		matched: true,
		unambiguous: true,
	};
	assert.equal(
		enterFooter({ ...base, phase: "command" }),
		"Enter completes the command.",
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
		// the pick runs, and the Enter line never claims a run in the command
		// phase, where Enter only ever completes.
		assert.equal(click.includes("runs"), row.runs, `${row.label}: ${click}`);
		if (row.phase === "command") {
			assert.equal(
				enterFooter({
					phase: "command",
					command: null,
					nameThenMessage: false,
					runs: true,
					value: "",
					matched: true,
					unambiguous: true,
				}).includes("runs"),
				false,
				"Enter never runs a command row, so it cannot say it does",
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
/* The words a registry with goal, team and model in it would derive. */
const WORDS = new Set(["goal", "team", "model"]);

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
test("a plain Enter on the armed row falls through, and only a choice stages it", () => {
	const armed = { matches: [armedRow("goal")], armedOnlyCommands: ARMED_ONLY, hoists: true };

	// The plain press: back to the composer, which submits the draft as prose.
	// Enter and Tab both, because Tab is the accept-and-keep-typing key and a
	// stray press must not rewrite a sentence either (UX U1, U3).
	assert.deepEqual(route({ ...armed }), { kind: "pass" });
	assert.deepEqual(route({ ...armed, key: "Tab" }), { kind: "pass" });

	// The same press once an arrow key has put the marker on the row by hand.
	assert.deepEqual(route({ ...armed, chosenByHand: true }), {
		kind: "apply",
		index: 0,
		run: false,
	});
	assert.deepEqual(route({ ...armed, key: "Tab", chosenByHand: true }), {
		kind: "apply",
		index: 0,
		run: false,
	});

	// Nothing survives the word — a bare `/goal`, or a half-typed `/goa` — so the
	// token IS the line and this key completes it, exactly as it does for every
	// other command row.
	assert.deepEqual(route({ ...armed, hoists: false }), {
		kind: "apply",
		index: 0,
		run: false,
	});
	assert.deepEqual(route({ matches: [{ kind: "command", label: "goa" }] }), {
		kind: "apply",
		index: 0,
		run: false,
	});

	// A row the vocabulary does not call armed-only is untouched: `/loop` keeps
	// the completion it has always had on this key.
	assert.deepEqual(
		route({ matches: [{ kind: "command", label: "loop" }], hoists: true }),
		{ kind: "apply", index: 0, run: false },
	);

	// And with no vocabulary at all — a catalogue that does not advertise the
	// armed destination — the row stops arming (review F4 / QA Q3): the pick
	// completes instead, which is the safe direction for a key press, and the
	// planner's implicit hoist is what
	// `scripts/slash-submit.test.mjs` pins as the hazard.
	assert.deepEqual(route({ ...armed, armedOnlyCommands: new Set() }), {
		kind: "apply",
		index: 0,
		run: false,
	});
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

	// The click half. `pointerPickRuns` still answers TRUE for this destination
	// (a picker with no inline list), which is exactly why the footer cannot be
	// read off it alone: the click STAGES this draft and runs nothing.
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

	const clickLine = clickFooter({
		phase: "command",
		command: null,
		label: "goal",
		nameThenMessage: false,
		runs: pickRuns("session.goal"),
		arms,
		hoists: true,
		value: "",
		matched: true,
	});
	assert.equal(clickLine, "Click stages /goal.");
	assert.equal(clickLine.includes("runs"), false);

	// The Enter half, for the two states a user is actually in.
	const enterPlain = enterFooter({
		phase: "command",
		command: null,
		label: "goal",
		nameThenMessage: false,
		runs: false,
		arms,
		hoists: true,
		chosenByHand: false,
		value: "",
		matched: true,
		unambiguous: true,
	});
	assert.equal(
		enterPlain,
		"Enter sends this draft as prose; arrow to /goal to stage it.",
	);
	assert.equal(enterPlain.includes("runs"), false);
	// ...and the routing that line describes is the routing the composer takes.
	assert.deepEqual(
		route({
			matches: [armedRow("goal")],
			armedOnlyCommands: ARMED_ONLY,
			hoists: true,
		}),
		{ kind: "pass" },
	);

	const enterByHand = enterFooter({
		phase: "command",
		command: null,
		label: "goal",
		nameThenMessage: false,
		runs: false,
		arms,
		hoists: true,
		chosenByHand: true,
		value: "",
		matched: true,
		unambiguous: true,
	});
	assert.equal(enterByHand, "Enter stages /goal; the next Enter runs it.");
	assert.deepEqual(
		route({
			matches: [armedRow("goal")],
			armedOnlyCommands: ARMED_ONLY,
			hoists: true,
			chosenByHand: true,
		}),
		{ kind: "apply", index: 0, run: false },
	);

	// The BARE form is the state where the click really does run (the read
	// opens), and the two lines still agree with the route: the key completes,
	// the click runs.
	assert.equal(
		clickFooter({
			phase: "command",
			command: null,
			label: "goal",
			nameThenMessage: false,
			runs: pickRuns("session.goal"),
			arms,
			hoists: false,
			value: "",
			matched: true,
		}),
		"Click runs /goal.",
	);
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
});
