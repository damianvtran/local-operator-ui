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
	enterFooter,
	matchChoices,
	phaseLabel,
	pointerPickRuns,
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

const commandRow = { kind: "command" };
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

test("a destination this side does not route yet answers by kind, not by id", () => {
	// These two arrive as `{kind: "picker"}` panels on the side that routes them.
	// Read off the kind, they run on the day their rows land, with no change here
	// — which is why neither id may be hardcoded into the rule.
	for (const id of ["info", "session.diagnostics"]) {
		assert.equal(registryEntry(id), undefined, `${id} is not routed here yet`);
		assert.equal(pickRuns(id), true, id);
	}
});
