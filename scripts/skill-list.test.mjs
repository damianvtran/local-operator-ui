import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE `$skill` GRAMMAR, RANKING, ACCEPT WRITE AND KEY ROUTING, executed as the
 * code that ships.
 *
 * The `$` list is the composer's third popup family and it follows the same
 * split as the other two: pure modules carry the rules (`skill-token.ts`,
 * `skill-rank.ts`, `skill-completion.ts`, `skill-contract.ts`) and the
 * component carries the React state. This file bundles and executes the pure
 * half, which is the half that must not drift — and the browser harness cannot
 * dispatch key events, so the routing has to be exercised here or it is not
 * exercised at all (`slash-contract.ts`/`at-contract.ts` made the same move).
 *
 * The one thing this file cannot do is run the SHIPPED component; that is the
 * design/UX rounds' rendered-frame job plus QA's live pass.
 */

const bundle = await build({
	stdin: {
		contents: `
			export {
				skillToken,
				skillTokenIsLeading,
			} from "./src/renderer/src/features/chat/components/skill-token";
			export {
				skillSuggestions,
				hasLowercaseEvidence,
			} from "./src/renderer/src/features/chat/components/skill-rank";
			export { skillCompletionFor } from "./src/renderer/src/features/chat/components/skill-completion";
			export {
				SKILL_PHASE_LABEL,
				skillClickFooter,
				skillEnterFooter,
				skillKeyIntent,
				skillRowId,
			} from "./src/renderer/src/features/chat/components/skill-contract";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const bundlePath = new URL(`./_skill-list-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	SKILL_PHASE_LABEL,
	hasLowercaseEvidence,
	skillClickFooter,
	skillCompletionFor,
	skillEnterFooter,
	skillKeyIntent,
	skillRowId,
	skillSuggestions,
	skillToken,
	skillTokenIsLeading,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------------------------------------------ */
/* The `$` token grammar                                               */
/* ------------------------------------------------------------------ */

const tokenOf = (text, caret = null) => skillToken(text, caret);

test("a `$` opens a token only at a word boundary", () => {
	// Glued to its left context, a `$` is punctuation inside a word — money and
	// shell variables that never became sigils. This is the ONE rule that makes
	// running the tokenizer on every keystroke of ordinary prose safe.
	assert.equal(tokenOf("costs$5"), null);
	assert.equal(tokenOf("a$b"), null);
	// A boundary `$` followed by money still TOKENISES (the grammar is the
	// boundary's, not the vocabulary's) — what it no longer does is vanish
	// silently: a no-match query keeps its listbox up saying so (design round 1,
	// D3), the sibling `/` palette's own answer. `skill-rank.test` below
	// asserts the empty match.
	assert.deepEqual(tokenOf("costs $5", 8), {
		start: 6,
		end: 8,
		query: "5",
	});
});

test("the caret must be INSIDE the token, and the word ends at a separator", () => {
	const text = "$res fix";
	assert.deepEqual(tokenOf(text, 0), { start: 0, end: 4, query: "res" });
	assert.deepEqual(tokenOf(text, 2), { start: 0, end: 4, query: "res" });
	assert.deepEqual(tokenOf(text, 4), { start: 0, end: 4, query: "res" });
	// A caret out in the request closes the list: the picker phase is a property
	// of the parse, not of a latch.
	assert.equal(tokenOf(text, 6), null);
	assert.equal(tokenOf(text, null), null);
});

test("the token indentifies by line, sigil and boundary, inline included", () => {
	// Line 2 (`hello\n$re`): the `$` at offset 6.
	assert.deepEqual(tokenOf("hello\n$re", 9), {
		start: 6,
		end: 9,
		query: "re",
	});
	// Leading indentation is preserved, not special-cased: `  $re` is a boundary
	// `$` on its line like any other (the harness parser lstrips, so the two
	// hosts agree about what "leading" means).
	assert.deepEqual(tokenOf("  $re", 5), { start: 2, end: 5, query: "re" });
	// The LAST boundary sigil at or before the caret is the one being edited.
	assert.deepEqual(tokenOf("$a $re", 6), { start: 3, end: 6, query: "re" });
});

test("leading means whitespace-only before the token", () => {
	assert.equal(skillTokenIsLeading("$res", tokenOf("$res")), true);
	assert.equal(skillTokenIsLeading("  $res", tokenOf("  $res")), true);
	assert.equal(skillTokenIsLeading("fix $res", tokenOf("fix $res")), false);
	assert.equal(skillTokenIsLeading("fix\n$res", tokenOf("fix\n$res")), false);
});

/* ------------------------------------------------------------------ */
/* The ranking: full matcher leading, evidence-gated prefix inline     */
/* ------------------------------------------------------------------ */

const CATALOGUE = [
	{ name: "research", description: "Investigate things" },
	{ name: "pathfinder", description: "Find paths" },
	{ name: "language-tutor", description: "Teach a language" },
	{ name: "planning", description: "Plan work" },
	{ name: "ßeta", description: "A lower-case cased name" },
	{ name: "DEBUG", description: "An uppercase-named skill" },
];
const names = (rows) => rows.map((row) => row.name);

test("leading: an empty query opens the whole catalogue, and the fuzzy matcher runs", () => {
	assert.deepEqual(names(skillSuggestions("", CATALOGUE, true)), [
		"research",
		"pathfinder",
		"language-tutor",
		"planning",
		"ßeta",
		"DEBUG",
	]);
	// `rsrch` is a subsequence, not a prefix — the leading arm keeps the full
	// case-insensitive matcher, exactly as the TUI's `argument_suggestions` does.
	assert.ok(
		names(skillSuggestions("rsrch", CATALOGUE, true)).includes("research"),
	);
	// `Research` at a sentence start still works when the token leads.
	assert.deepEqual(names(skillSuggestions("Research", CATALOGUE, true)), [
		"research",
	]);
});

test("leading: the short-query prefix preference prefers, never filters", () => {
	assert.deepEqual(names(skillSuggestions("res", CATALOGUE, true)), [
		"research",
	]);
	// No prefix match below the fuzzy floor: the fuzzy survivors still answer.
	const fuzzy = names(skillSuggestions("rsh", CATALOGUE, true));
	assert.ok(fuzzy.includes("research"), `the fuzzy fallback answers: ${fuzzy}`);
});

test("inline: the four closed non-invocations stay closed", () => {
	// SUBSEQUENCE: `LANG` scoring against `planning`.
	assert.deepEqual(skillSuggestions("LANG", CATALOGUE, false), []);
	// CASE-FOLDED PREFIX: `DEBUG`.lower() IS `debug`.
	assert.deepEqual(skillSuggestions("DEBUG", CATALOGUE, false), []);
	// CASELESS: an empty query (a bare trailing `$`) and digit/underscore tokens.
	assert.deepEqual(skillSuggestions("", CATALOGUE, false), []);
	assert.deepEqual(skillSuggestions("5", CATALOGUE, false), []);
	assert.deepEqual(skillSuggestions("_private", CATALOGUE, false), []);
	// An UPPERCASE-NAMED skill does not void the rule: the evidence is read off
	// the QUERY, which carries no lowercase letter either way.
	assert.deepEqual(skillSuggestions("DEB", CATALOGUE, false), []);
});

test("inline: lowercase-evidence case-sensitive prefixes DO open", () => {
	assert.deepEqual(names(skillSuggestions("res", CATALOGUE, false)), [
		"research",
	]);
	// The accepted wider class, at its true width: `$path` reaches `pathfinder`
	// and `$lang` reaches `language-tutor` (prefix matching, not equality).
	assert.deepEqual(names(skillSuggestions("path", CATALOGUE, false)), [
		"pathfinder",
	]);
	assert.deepEqual(names(skillSuggestions("lang", CATALOGUE, false)), [
		"language-tutor",
	]);
	// A lower-cased spelling of a case-sensitive prefix is NOT one: `$Res` is
	// not a prefix of `research`, so it does not open (the query does carry a
	// lowercase letter, so condition 1 passes and condition 2 is the gate).
	assert.deepEqual(skillSuggestions("Res", CATALOGUE, false), []);
	// `ß` is a lowercase letter and a case-sensitive prefix of `ßeta`.
	assert.deepEqual(names(skillSuggestions("ß", CATALOGUE, false)), ["ßeta"]);
	// ...and its UPPERCASE sibling carries no lowercase evidence.
	assert.deepEqual(skillSuggestions("İ", CATALOGUE, false), []);
	assert.deepEqual(skillSuggestions("STRASSE", CATALOGUE, false), []);
});

test("hasLowercaseEvidence reads the query, not the vocabulary", () => {
	assert.equal(hasLowercaseEvidence("res"), true);
	assert.equal(hasLowercaseEvidence("Res"), true);
	assert.equal(hasLowercaseEvidence("RES"), false);
	assert.equal(hasLowercaseEvidence(""), false);
	assert.equal(hasLowercaseEvidence("$5_"), false);
});

/* ------------------------------------------------------------------ */
/* The accept write                                                    */
/* ------------------------------------------------------------------ */

const complete = (text, caret, name) => {
	const token = tokenOf(text, caret);
	assert.ok(token, `a token exists in ${JSON.stringify(text)}`);
	return skillCompletionFor(text, token, name);
};

test("a leading token is replaced in place, preserving lead and lstriping the suffix", () => {
	assert.deepEqual(complete("$res fix bug", 4, "research"), {
		text: "$research fix bug",
		caret: 10,
	});
	assert.deepEqual(complete("  $res fix", 5, "research"), {
		text: "  $research fix",
		caret: 12,
	});
	// The write brings its own separator, so the suffix's runs collapse.
	assert.deepEqual(complete("$res  fix", 4, "research"), {
		text: "$research fix",
		caret: 10,
	});
	assert.deepEqual(complete("$res\nfix", 4, "research"), {
		text: "$research fix",
		caret: 10,
	});
});

test("an inline token is reassembled to the FRONT with the draft as its request", () => {
	const assembled = "$research fix this ";
	assert.deepEqual(complete("fix this $res", 12, "research"), {
		text: assembled,
		caret: assembled.length,
	});
	// One adjoining separator goes with the token, so no gap survives the move.
	assert.deepEqual(complete("fix this $res bug", 12, "research"), {
		text: "$research fix this bug ",
		caret: "$research fix this bug ".length,
	});
	assert.deepEqual(complete("hello\n$res fix", 9, "research"), {
		text: "$research hello fix ",
		caret: "$research hello fix ".length,
	});
	assert.deepEqual(complete("fix $res", 7, "research"), {
		text: "$research fix ",
		caret: "$research fix ".length,
	});
});

/* ------------------------------------------------------------------ */
/* The key routing                                                     */
/* ------------------------------------------------------------------ */

const intent = (over = {}) =>
	skillKeyIntent({
		key: "ArrowDown",
		composing: false,
		open: true,
		active: 0,
		count: 3,
		...over,
	});

test("arrows move and clamp; a closed list and a composition pass through", () => {
	assert.deepEqual(intent(), { kind: "move", index: 1, moved: true });
	assert.deepEqual(intent({ active: 2 }), {
		kind: "move",
		index: 2,
		moved: false,
	});
	assert.deepEqual(intent({ key: "ArrowUp" }), {
		kind: "move",
		index: 0,
		moved: false,
	});
	assert.deepEqual(intent({ key: "ArrowUp", active: 2 }), {
		kind: "move",
		index: 1,
		moved: true,
	});
	assert.deepEqual(intent({ open: false }), { kind: "pass" });
	assert.deepEqual(intent({ composing: true }), { kind: "pass" });
});

test("Enter and Tab both complete, never run; Escape closes; nothing else is claimed", () => {
	assert.deepEqual(intent({ key: "Enter" }), { kind: "apply", index: 0 });
	assert.deepEqual(intent({ key: "Tab", active: 1 }), {
		kind: "apply",
		index: 1,
	});
	assert.deepEqual(intent({ key: "Escape" }), { kind: "close" });
	assert.deepEqual(intent({ key: "a" }), { kind: "pass" });
	// Enter with no row to take PASSES, so the line is sent as written: the
	// no-match query keeps its listbox up saying the miss (D3), and a key that
	// was claimed there would wedge the very send the empty state explains.
	// Same answer the sibling's empty slash list gives.
	assert.deepEqual(intent({ key: "Enter", count: 0, active: 0 }), {
		kind: "pass",
	});
});

test("the popup's copy and ids are the contract's own", () => {
	assert.equal(SKILL_PHASE_LABEL, "Skills");
	assert.equal(skillRowId("language-tutor"), "skill-language-tutor");
	assert.equal(skillRowId("a b"), "skill-a_b");
	assert.equal(
		skillEnterFooter("research"),
		"Enter completes $research; Enter again sends it.",
	);
	assert.equal(skillClickFooter("research"), "Click completes $research.");
});

/* ------------------------------------------------------------------ */
/* The wiring                                                          */
/* ------------------------------------------------------------------ */

/** The source with its comments blanked, so prose about a token is not the token. */
const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/*
 * THE COMPONENT'S FOUR SEAMS, pinned as SOURCE because that is where they are
 * written and a seam nothing consults is a comment: the hook call that derives
 * the list, the key adapter in the routing chain, the accept write, and the
 * submit expansion. The behaviours each seam performs are asserted above and in
 * `skill-invocation.test.mjs`; what these pins protect is that the seams stay
 * WIRED on the shipped component — an edit that dropped one would otherwise
 * leave every pure test green.
 */
test("the shipped composer wires the `$` seams", () => {
	/*
	 * The shared composer's path, which is where the bootstrap lift (#683) moved
	 * the component on the fold: the seams are the same ones, read from the file
	 * that now ships them.
	 */
	const input = code(
		"src/renderer/src/shared/components/composer/message-input.tsx",
	);
	assert.match(input, /useSkillCompletion\(\{/, "the list state exists");
	assert.match(
		input,
		/handleSkillKeyDown\(event, skills, handleSkillPick\)/,
		"the routing chain consults it",
	);
	assert.match(
		input,
		/skillCompletionFor\(/,
		"the accept write goes through the pure port",
	);
	assert.match(
		input,
		/<SkillSuggestionsPopup state=\{skills\} onPick=\{handleSkillPick\} \/>/,
		"and the list renders",
	);
	assert.match(
		input,
		/parseSkillInvocation\(message, skillNames\)/,
		"the submit reads the TYPED line before anything splices it",
	);
	assert.match(
		input,
		/renderSkillInvocation\(/,
		"and renders the harness payload",
	);
	assert.match(
		input,
		/readSkillBody\(/,
		"reading the body through the shared cache",
	);
	/*
	 * THE EMPTY STATE (design round 1, D3), pinned on the picker's own source
	 * because it is a React component the harness cannot bundle: a no-match
	 * query keeps the listbox and says the miss, rather than unmounting silently
	 * where the sibling `/` palette says "No commands match.".
	 */
	const picker = code(
		"src/renderer/src/features/chat/components/skill-picker.tsx",
	);
	assert.match(picker, /No skills match\./, "the miss is stated");
	assert.match(
		picker,
		/rows\.length > 0 \|\| hasQuery/,
		"and the listbox stays up for a no-match query",
	);
	assert.match(
		picker,
		/enabled: active && Boolean\(sessionId\) && provided/,
		"the vocabulary read is provider-gated (QA round 1, Q-1)",
	);
	assert.match(
		picker,
		/useOptionalQueryClient\(\)/,
		"through the provider-optional client, as the host contract requires",
	);
});
