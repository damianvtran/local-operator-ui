import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's slash ranker, asserted against the TUI scorer it ports.
 *
 * `slash-rank.ts` is a port of `local_operator/tui/autocomplete.py`
 * (`score_command_text_match`, `match_commands`, `match_choices`) plus
 * `Editor._picker_choice_is_unambiguous`. Every band and every tie-break below
 * is a decision that file already made, and the ORDERING is load-bearing: the
 * popup renders this output verbatim and Enter applies `matches[active]`, so a
 * scorer that disagrees with the list is a highlight that lies about what Enter
 * will do.
 *
 * Bundled rather than imported because the module is TypeScript in the renderer
 * tree; the module under test is the REAL one.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/slash-rank";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	SCORE_EXACT,
	SCORE_PREFIX,
	SCORE_FUZZY_MAX,
	scoreCommandTextMatch,
	matchCommands,
	matchChoices,
	isUnambiguous,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Registry-order fixture. `model`/`models` and `move` prefix-collide on `m`
 *  on purpose, which is the flat-prefix property under test. */
const COMMANDS = [
	{ name: "team", aliases: ["teams"] },
	{ name: "model", aliases: ["models"] },
	{ name: "move", aliases: [] },
	{ name: "logout", aliases: [] },
	{ name: "usage", aliases: [] },
];

test("the score bands are exact > prefix > fuzzy > none", () => {
	assert.equal(scoreCommandTextMatch("model", "model"), SCORE_EXACT);
	assert.equal(scoreCommandTextMatch("MODEL", "model"), SCORE_EXACT);
	assert.equal(scoreCommandTextMatch("mod", "model"), SCORE_PREFIX);
	assert.equal(scoreCommandTextMatch("", "model"), 0, "empty prefix is not a match");
	assert.equal(scoreCommandTextMatch("zzz", "model"), 0);
	const fuzzy = scoreCommandTextMatch("mdl", "model");
	assert.ok(fuzzy >= 1 && fuzzy <= SCORE_FUZZY_MAX, `fuzzy score in band, got ${fuzzy}`);
	assert.ok(fuzzy < SCORE_PREFIX);
});

test("the prefix tier is flat, so registry order survives a longer prefix", () => {
	// `model` and `move` both prefix-match `m` and keep REGISTRY order (team is
	// index 0 but only a fuzzy survivor here, so it comes after both). If the
	// tier were not flat, a length or recency tiebreak would reshuffle the list
	// under the user as they typed, moving the highlighted row out from under
	// their Enter.
	assert.deepEqual(
		matchCommands("m", COMMANDS)
			.slice(0, 2)
			.map((row) => row.name),
		["model", "move"],
	);
	// The fuzzy survivor sorts below the whole prefix tier, never between two
	// prefix matches.
	assert.equal(matchCommands("m", COMMANDS).at(-1).name, "team");
	assert.deepEqual(
		matchCommands("mo", COMMANDS).map((row) => row.name),
		["model", "move"],
	);
});

test("a fuzzy subsequence finds a command a prefix filter could not", () => {
	// The defect this port fixes: `/lgt` found nothing where the TUI finds
	// `logout`.
	assert.deepEqual(
		matchCommands("lgt", COMMANDS).map((row) => row.name),
		["logout"],
	);
	// The renderer always holds the bare word, but the TUI's matcher takes the
	// buffer prefix, so a leading slash must not change the answer.
	assert.deepEqual(
		matchCommands("/lgt", COMMANDS).map((row) => row.name),
		["logout"],
	);
	// A whole-buffer string still scores its last token.
	assert.deepEqual(
		matchCommands("fix this /lgt", COMMANDS).map((row) => row.name),
		["logout"],
	);
});

test("an alias match displays the alias, and that alias is runnable", () => {
	// Design §4.1's deliberate behaviour change: the row label is the string the
	// completion writes, so a row labelled `/models` writes `models`. Aliases
	// are themselves commands in the shared registry.
	// `model` itself does not match `models` (the query has an extra character),
	// so the alias is the only row and it carries the primary command.
	assert.deepEqual(
		matchCommands("models", COMMANDS).map((row) => row.name),
		["models"],
	);
	assert.equal(matchCommands("models", COMMANDS)[0].command.name, "model");
});

test("a zero-score query yields no rows and an empty query yields none either", () => {
	assert.deepEqual(matchCommands("zzz", COMMANDS), []);
	assert.deepEqual(matchCommands("", COMMANDS), []);
	// `matchChoices`, by contrast, treats an empty query as "show me everything".
	assert.equal(matchChoices("", COMMANDS).length, COMMANDS.length);
});

test("matchChoices returns the primary name even when an alias matched", () => {
	const choices = [
		{ name: "anthropic", aliases: ["claude"] },
		{ name: "openai", aliases: ["gpt"] },
	];
	assert.deepEqual(
		matchChoices("claude", choices).map((row) => row.name),
		["anthropic"],
	);
	assert.deepEqual(
		matchChoices("", choices).map((row) => row.name),
		["anthropic", "openai"],
	);
	// An argument's alias is only a way to FIND it: returning `claude` would put
	// a word in the buffer that the command then rejects.
	const fuzzy = matchChoices("g", choices).map((row) => row.name);
	assert.ok(!fuzzy.includes("gpt"), "an alias must never be returned as a value");
});

test("a tie keeps registry order, which is what keeps the row stable", () => {
	const tied = [
		{ name: "ab", aliases: [] },
		{ name: "ac", aliases: [] },
	];
	// `a` prefix-matches both: equal score, first in registry order wins.
	assert.deepEqual(
		matchCommands("a", tied).map((row) => row.name),
		["ab", "ac"],
	);
	// The same property on the argument side.
	assert.deepEqual(
		matchChoices("a", tied).map((row) => row.name),
		["ab", "ac"],
	);
});

test("Enter runs a row only when the choice is unambiguous", () => {
	// A hand-moved row: the user read the list and chose.
	assert.equal(isUnambiguous("", "any-row", 9, false, true), true);
	// Typed in full: the user named it rather than letting the matcher choose.
	assert.equal(isUnambiguous("openrouter", "openrouter", 3, false, false), true);
	assert.equal(isUnambiguous("OpenRouter", "openrouter", 3, false, false), true);
	// One survivor of a harmless list.
	assert.equal(isUnambiguous("oer", "openrouter", 1, false, false), true);
	// One survivor of a DESTRUCTIVE list is NOT evidence: a subsequence matcher
	// leaves one survivor from a query that spells nothing, and `/logout oer`
	// was one Enter away from deleting a credential the user never named.
	assert.equal(isUnambiguous("oer", "openrouter", 1, true, false), false);
	// Several survivors: complete, then let the second Enter run it.
	assert.equal(isUnambiguous("o", "openrouter", 4, false, false), false);
});
