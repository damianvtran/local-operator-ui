import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's slash tokenizer, asserted against the TUI semantics it ports.
 *
 * `slash-token.ts` is a port of `local_operator/tui/widgets/command_picker.py`
 * (`_is_boundary`, `_active_slash`, `_claiming_command`, `slash_context`,
 * `slash_token_span`, `slash_argument_context`, `slash_argument`). A port whose
 * only check is "the popup looks right" drifts from its source the first time
 * either side is edited — and every rule here HAS a right answer, decided in
 * Python. Each test names the Python function it mirrors so a reviewer can read
 * the two side by side.
 *
 * Bundled rather than imported because the module is TypeScript in the renderer
 * tree; esbuild into a data: URL is the pattern `usage-view.test.mjs` and
 * `tool-row.test.mjs` established for exactly this. The module under test is the
 * REAL one — nothing is re-implemented here.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/slash-token";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	boundarySlashes,
	activeSlash,
	claimingCommand,
	commandWordOpensDraft,
	lineOfCursor,
	slashContext,
	slashTokenSpan,
	slashArgumentContext,
	slashArgument,
	caretPhase,
	replaceSpan,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The vocabulary a real registry would supply: primaries and aliases, lower
 *  case. Only `team`, `model` and `usage` are needed by these vectors. */
const VOCAB = new Set(["team", "teams", "model", "models", "usage", "goal"]);
/** The commands whose argument phase is live in this fixture. */
const ARGUMENT_COMMANDS = ["team", "model"];

test("a slash opens a token only at a word boundary", () => {
	// `command_picker.py:_is_boundary` — the ONE rule that makes running this
	// on every keystroke of ordinary prose safe.
	assert.deepEqual(boundarySlashes("src/foo"), []);
	assert.deepEqual(boundarySlashes("and/or"), []);
	assert.equal(slashContext("src/foo", 7, VOCAB), null);
	assert.equal(slashContext("costs$5 /team", 14, VOCAB)?.query, "team");
	assert.deepEqual(boundarySlashes("/a /b"), [0, 3]);
});

test("a boundary slash anywhere in the draft opens the list", () => {
	const atStart = slashContext("/team", 5, VOCAB);
	assert.deepEqual(atStart, { start: 0, query: "team", end: 5 });
	const midDraft = slashContext("fix this /team", 13, VOCAB);
	// The `/` is at index 9 (`fix this ` is 9 cells), which is what makes this
	// requirement the caret-aware one: the OLD detector matched `^` against the
	// whole buffer and found nothing here at all.
	assert.deepEqual(midDraft, { start: 9, query: "team", end: 14 });
	// A caret before the slash is not in the token.
	assert.equal(slashContext("fix this /team", 5, VOCAB), null);
});

test("the active token is the last boundary slash at or before the caret", () => {
	// `command_picker.py:_active_slash` — a user typing `a /foo /ba|` is editing
	// `/ba`, not `/foo`.
	assert.equal(activeSlash("/foo /ba", 9, new Set()), 5);
	assert.equal(slashContext("/foo /ba", 9, VOCAB)?.query, "ba");
	assert.equal(activeSlash("/foo /ba", 2, new Set()), 0);
});

test("a recognised, space-terminated command claims the rest of its line", () => {
	const draft = "/team security improve the /team command";
	// `_claiming_command`: the FIRST recognised space-terminated command owns
	// everything after it, so the second `/team` is plain argument text.
	assert.equal(claimingCommand(draft, VOCAB), 0);
	const caret = draft.length;
	assert.equal(slashContext(draft, caret, VOCAB), null);
	assert.equal(
		slashArgument(draft, ["team"], caret, VOCAB),
		"security improve the /team command",
	);
	// Without the vocabulary there is no claim: the second slash is a token.
	assert.equal(slashContext("/team a /team", 13, new Set())?.start, 8);
});

test("caretPhase is command on the word and argument one cell past the space", () => {
	// `slash_context` and `slash_argument_context` are the two halves of one
	// handover; a caret in both would put two lists on screen at once.
	assert.equal(caretPhase("/team", 5, VOCAB, ARGUMENT_COMMANDS), "command");
	assert.equal(caretPhase("/team ", 6, VOCAB, ARGUMENT_COMMANDS), "argument");
	assert.equal(caretPhase("/team f", 7, VOCAB, ARGUMENT_COMMANDS), "argument");
	assert.equal(caretPhase("src/foo", 7, VOCAB, ARGUMENT_COMMANDS), null);
	// A command with no argument list never reaches the argument phase.
	assert.equal(caretPhase("/usage f", 8, VOCAB, ARGUMENT_COMMANDS), null);
});

test("the empty argument is an open state and distinct from the word phase", () => {
	assert.equal(slashArgument("/team ", ["team"], 6, VOCAB), "");
	assert.equal(slashArgument("/team", ["team"], 5, VOCAB), null);
	assert.equal(slashArgument("src/foo", ["team"], 7, VOCAB), null);
});

test("the argument runs to the end of its line, never the end of the buffer", () => {
	// `slash_argument_context`'s docstring: this is what lets a command sit on
	// its own line above a multi-line draft. The caret sits on the command's own
	// line, where the argument is `ops` — the line below is the message.
	assert.equal(slashArgument("/team ops\nfix this", ["team"], 9, VOCAB), "ops");
	assert.equal(
		slashArgument("/team ops ship it", ["team"], 18, VOCAB),
		"ops ship it",
	);
	const context = slashArgumentContext(
		"/team ops\nfix this",
		["team"],
		21,
		VOCAB,
	);
	assert.equal(
		context,
		null,
		"a caret on the line below is not in the command",
	);
});

test("CRLF yields the same word and argument as LF", () => {
	// `_line_of_cursor` strips the `\\r` once, for every consumer: `.partition(" ")`
	// does not treat it as a separator, so the word used to come back as "team\\r".
	assert.equal(lineOfCursor("/team\r\n", 5).line, "/team");
	assert.equal(slashContext("/team\r\n", 5, VOCAB)?.query, "team");
	assert.equal(slashArgument("/team \r\n", ["team"], 7, VOCAB), "");
	assert.equal(slashArgument("/team ops\r\n", ["team"], 9, VOCAB), "ops");
});

test("a stale caret is clamped rather than thrown on", () => {
	assert.doesNotThrow(() => lineOfCursor("/team", 99));
	assert.deepEqual(lineOfCursor("ab\ncd", 99), {
		line: "cd",
		lineStart: 3,
		column: 2,
	});
	assert.doesNotThrow(() => slashContext("/team", 99, VOCAB));
	assert.doesNotThrow(() => slashArgument("/team ops", ["team"], -4, VOCAB));
	assert.equal(slashArgument("/team ops", ["team"], -4, VOCAB), null);
});

test("slashTokenSpan covers the word plus its inline argument", () => {
	const draft = "fix this /team ops";
	const span = slashTokenSpan(draft, draft.length, VOCAB);
	// The `/` is at 9 and the token ends at the end of its line (18), not at the
	// end of the word: this is the span a RUN splices out.
	assert.deepEqual(span, { start: 9, end: 18 });
	assert.equal(replaceSpan(draft, span.start, span.end, "").text, "fix this");
	assert.equal(replaceSpan(draft, span.start, span.end, "").caret, 8);
});

test("replaceSpan removes exactly one adjoining separator", () => {
	// `Editor._splice_command`: the PRECEDING separator is preferred; the
	// following one is taken only when the token opened the buffer.
	assert.deepEqual(replaceSpan("fix this /tea", 9, 13, "/team "), {
		text: "fix this /team ",
		caret: 15,
	});
	assert.deepEqual(replaceSpan("/tea fix this", 0, 4, "/team "), {
		text: "/team fix this",
		caret: 6,
	});
	assert.deepEqual(replaceSpan("/tea\nship it", 0, 4, "/team "), {
		text: "/team ship it",
		caret: 6,
	});
	// A token at the very end with nothing to absorb keeps its own text intact.
	assert.deepEqual(replaceSpan("go /tea", 3, 7, "/team "), {
		text: "go /team ",
		caret: 9,
	});
});

test("a mid-draft command word opens no list, because the planner reads it as prose", () => {
	/*
	 * Design round 1, D1 = UX U2. The list used to open on the tokenizer alone,
	 * so `fix this /team` offered a roster whose footer promised the command
	 * would run, while the planner — rewritten by this change — sends that draft
	 * to the model as written; the first Enter then completed a word the planner
	 * refuses, and only the second Enter sent anything. `caretPhase` now asks the
	 * same positional question the planner asks (`commandWordOpensDraft`), so the
	 * popup and the submit rule cannot disagree about whether a word is a command.
	 */
	assert.equal(
		caretPhase("fix this /team", 13, VOCAB, ARGUMENT_COMMANDS),
		null,
	);
	assert.equal(
		caretPhase("hello /compact", 14, VOCAB, ARGUMENT_COMMANDS),
		null,
	);
	assert.equal(
		caretPhase("fix this /model gpt-5", 20, VOCAB, ARGUMENT_COMMANDS),
		null,
	);
	// The legitimate positions are untouched: the whole draft, and the draft's
	// opening word with its own argument list.
	assert.equal(caretPhase("/team", 5, VOCAB, ARGUMENT_COMMANDS), "command");
	assert.equal(caretPhase("/model ", 7, VOCAB, ARGUMENT_COMMANDS), "argument");
	// Leading whitespace is still the start of the draft, not a position after it.
	assert.equal(caretPhase("  /team", 7, VOCAB, ARGUMENT_COMMANDS), "command");
});

/*
 * R3-1: THE PRE-WORD PREFIX IS MEASURED IN PYTHON'S CLASS, not JavaScript's.
 * `commandWordOpensDraft` asks whether everything before the word is separators —
 * the endpoint's own question, since its `strip()` must leave the word starting
 * with `/` — and the row that discriminates is U+FEFF, which `trim()` removes and
 * Python keeps. Without these two, the predicate could go back to `trim()` and
 * every other test here would still pass: the sweep that found it moved 264 rows
 * of a 3,652-draft corpus out of the reverse direction.
 */
test("the pre-word prefix is Python separators, not JavaScript's (R3-1)", () => {
	assert.equal(
		commandWordOpensDraft("\u0085/team ops", 1),
		true,
		"U+0085 is a separator for the TUI, so the word does open the draft",
	);
	assert.equal(
		commandWordOpensDraft("\u001c/team ops", 1),
		true,
		"U+001C likewise",
	);
	assert.equal(
		commandWordOpensDraft("\ufeff/team ops", 1),
		false,
		"U+FEFF is NOT a separator, so the word does not open the draft",
	);
	assert.equal(
		commandWordOpensDraft(" \t/team ops", 2),
		true,
		"space and tab still do",
	);
	assert.equal(
		commandWordOpensDraft(" /team ops", 2),
		false,
		"a space AND a slash are not separators",
	);
});
