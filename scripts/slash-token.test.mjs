import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
 * every other test here would still pass: MY OWN sweep (3,652 drafts, 7,304 rows at
 * both carets) moved 264 of them out of the reverse direction when this line was
 * fixed, and the review's separate 4,029-draft sweep moved 162 of its rows.
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

/*
 * THE INVENTORY, AS A CHECK RATHER THAN A SENTENCE (round 4, F4-1).
 *
 * The class above is the only separator class on the composer path, and this is
 * what keeps that true. Three rounds fixed the instance they were handed and the
 * next instance appeared in a module nobody had looked at, so this reads every
 * PRODUCT module under `components/` from disk and fails if one carries a `\s`
 * or `\S` of its own — in CODE, since comments are stripped: a docblock quoting
 * the old spelling is not a violation.
 *
 * THE QUESTIONS, module by module, so a reader does not re-derive them:
 *
 *   - `slash-token.ts` — the class itself, its forms, and the token boundary and
 *     word end (it is where the definition lives, so it is the one file excluded
 *     from the scan);
 *   - `slash-submit.ts` — the planner's split, strips, boundary scan, argument
 *     count and un-masked-run scan;
 *   - `slash-highlight.ts` — the tint's word end, the first content line's strip
 *     and start offset, and the name's leading offset;
 *   - `slash-commands.tsx` — the popup's word, the surviving-text test and "a
 *     name is one word" (the fifth module, round 4's F4-1);
 *   - `at-token.ts` — the mention tokeniser's boundary and word end, the same
 *     question for a different sigil (round 4's inventory);
 *   - `slash-rank.ts` — the last separator-cut token of a whole-buffer string,
 *     which ranks the completion rows (round 4's inventory);
 *   - `credential-capture.ts` — the arming lookbehind and the three boundary
 *     tests beside it.
 *
 * THE DELIBERATE OTHER CLASS: the TUI partitions the `/cmd` ARGUMENT on a LITERAL
 * space (`editor.py`'s `partition(" ")`), and so do these, which is why they are
 * `" "` and not the class:
 *
 *   - `slash-token.ts` — the argument context's own partition;
 *   - `slash-highlight.ts` — the same partition when it reads the argument's
 *     first word (the position arithmetic around it IS the class);
 *   - `slash-commands.tsx` — the inline argument's first word;
 *   - `credential-capture.ts` — the reference's `[ \t]*$` tail on the token;
 *   - `at-contract.ts`/`at-token.ts` — the mention syntax's quoting test.
 *
 * The rest of the `.trim()` calls on this path (a search box, a path, a display
 * string, the composer's own "is the box empty") are the JS class deliberately:
 * they ask about the renderer's own state, which no other host answers, so there
 * is no second answer for them to disagree with.
 *
 * MUTATION-CHECKED, not asserted: putting `\s` back into `at-token.ts` — clean
 * since round 2 — fails this test and nothing else in the suite.
 */
const COMPOSER_PATH = "src/renderer/src/features/chat/components";
const ASKERS = [
	"at-token.ts",
	"credential-capture.ts",
	"slash-commands.tsx",
	"slash-highlight.ts",
	"slash-rank.ts",
	"slash-submit.ts",
];

/**
 * `[\s\S]` is "match any character" — an idiom for a span that may cross
 * newlines, and no statement about where a word ends. Removed before the scan
 * (as the literal two-character sequence, hence the doubled backslashes).
 */
const ANY_CHARACTER_IDIOM = /\[\\s\\S\]|\[\\S\\s\]/g;

/**
 * Modules whose remaining `\s` is deliberately a different question, each with
 * the reason. One entry, and it is a DISPLAY string: the cleared-goal preview
 * flattens a run of whitespace for the reader, on the renderer's own text, and
 * nothing compares its output to another host's answer.
 */
const NOT_A_CLASS = {
	"composer-status-row.tsx":
		"the cleared-goal preview flattens a run for DISPLAY, on the renderer's own string",
};

test("no composer-path module declares its own separator class (F4-1)", () => {
	const files = readdirSync(COMPOSER_PATH).filter(
		(file) => /\.tsx?$/.test(file) && !file.endsWith(".stories.tsx"),
	);
	// Read from disk and asserted non-trivially large: a scan over an empty or
	// renamed directory would pass while checking nothing.
	assert.ok(files.length > 50, `read the composer path, not a list that can go stale (${files.length} modules)`);
	const offenders = [];
	for (const file of files) {
		if (file === "slash-token.ts") continue;
		if (file in NOT_A_CLASS) continue;
		const code = readFileSync(`${COMPOSER_PATH}/${file}`, "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "")
			// the any-character idiom, removed before the scan
			.replace(ANY_CHARACTER_IDIOM, "");
		// A single backslash before s/S, so the LaTeX that `markdown-math.ts`
		// searches for (`\\sum`) is not a hit.
		const hit = code.match(/(?<!\\)\\[sS]/);
		if (hit) offenders.push(`${file} (${hit[0]})`);
	}
	assert.deepEqual(
		offenders,
		[],
		`these modules carry a separator class of their own: ${offenders.join(", ")}`,
	);
	for (const file of ASKERS) {
		const source = readFileSync(`${COMPOSER_PATH}/${file}`, "utf8");
		assert.match(source, /from "\.\/slash-token"/, `${file} reads the shared class`);
	}
});
