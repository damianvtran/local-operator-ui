/**
 * The initials a team's compact mark draws, as VALUES.
 *
 * WHY THIS FILE EXISTS. The operator's request (2026-10-01) replaces the drawn
 * team name in a chat sidebar session row with a two-character mark, so the
 * compression rule IS the visible content of the change: a wrong split shows a
 * wrong mark on every row of that team, and a captured frame cannot say which
 * letter a mark should have carried. `teamInitials` is a leaf (`team-initials.ts`)
 * precisely so this can be pinned without a DOM, the same arrangement
 * `scripts/header-identity-model.test.mjs` states for its own model.
 *
 * WHAT THIS CANNOT SAY: that the bubble draws, where it sits in the row, what it
 * does on hover, or that its initials survive an image failure. Those are the
 * rendered set's (the bubble's own story and the sidebar's frames on the PR) and
 * the QA pass's, not this file's.
 *
 * ONE VECTOR IS A KNOWN DEVIATION FROM THE REQUEST, and it is asserted here as the
 * rule's real output rather than smoothed over: the operator's message listed `HP`
 * for `Hyperplane Development`. No deterministic word-based rule produces `HP`
 * from that name - a first-word/last-word rule gives `HD`, and `HP` would need the
 * second word's THIRD letter. Nothing is special-cased for it; the deviation is
 * carried in the pull request body for the operator to rule on.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/team-initials";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { teamInitials } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("two or more words take the first letter of the first and of the last", () => {
	const cases = [
		["Local Operator Development", "LD"],
		["Radient Development", "RD"],
		["Data Quality", "DQ"],
		["Minerva Development", "MD"],
		["Pergamon Research", "PR"],
		["Radient Net", "RN"],
		/* The operator's own list asks for HP here; the rule cannot produce it (see
		   this file's header). Asserted as HD so the deviation is visible in a run,
		   not only in a sentence. */
		["Hyperplane Development", "HD"],
	];
	for (const [name, expected] of cases) {
		assert.equal(teamInitials(name), expected, name);
	}
});

test("one word takes its first two letters", () => {
	assert.equal(teamInitials("Content"), "CO");
	assert.equal(teamInitials("helpdesk"), "HE");
	assert.equal(teamInitials("Development"), "DE");
});

test("every run of non-alphanumerics is a separator, so a slug is words too", () => {
	assert.equal(teamInitials("release-crew"), "RC");
	assert.equal(teamInitials("docs-pod"), "DP");
	assert.equal(teamInitials("data_quality"), "DQ");
	assert.equal(teamInitials("a.b.c"), "AC");
	assert.equal(teamInitials("Radient  Net"), "RN");
});

test("camelCase is a word boundary, so no space is needed to get two words", () => {
	assert.equal(teamInitials("localOperator"), "LO");
	assert.equal(teamInitials("radientDevelopment"), "RD");
	assert.equal(teamInitials("HTTPServer"), "HS");
});

test("the result is uppercase whatever the input's case was", () => {
	assert.equal(teamInitials("radient development"), "RD");
	assert.equal(teamInitials("RADIENT DEVELOPMENT"), "RD");
	assert.equal(teamInitials("release CREW"), "RC");
	/* Alternating case IS a camelCase boundary, so this is the rule applied to
	   gibberish rather than a case rule: `ReLeAsE cReW` splits into seven words and
	   takes the first of the first and of the last, `RW`. Stated so the next reader
	   does not read it as a case bug. */
	assert.equal(teamInitials("ReLeAsE cReW"), "RW");
});

test("whitespace and separators that carry no word are dropped", () => {
	assert.equal(teamInitials("  release   crew  "), "RC");
	assert.equal(teamInitials("-release-crew-"), "RC");
	assert.equal(teamInitials("\tMinerva\nDevelopment\t"), "MD");
	/* A trailing separator must not become the "last word" and blank the second
	   letter - the empty-segment drop is what pays for this case. */
	assert.equal(teamInitials("Release Engineering "), "RE");
});

test("a name with nothing to take draws the deterministic placeholder", () => {
	assert.equal(teamInitials(""), "?");
	assert.equal(teamInitials("   "), "?");
	assert.equal(teamInitials("---"), "?");
	assert.equal(teamInitials(" ... "), "?");
	assert.equal(teamInitials("!!!"), "?");
});

test("a one-character word is itself rather than an empty second letter", () => {
	assert.equal(teamInitials("A"), "A");
	assert.equal(teamInitials("x"), "X");
	/* Two words where the last is one character. */
	assert.equal(teamInitials("Team A"), "TA");
});

test("digits are alphanumerics, and a leading digit is that word's first character", () => {
	assert.equal(teamInitials("3D Print"), "3P");
	assert.equal(teamInitials("Team 7"), "T7");
});

test("a non-ASCII letter is a separator, which is the module's stated limit", () => {
	/* Named rather than left to be discovered: the rule is ASCII-only, so `Café`
	   is one word and draws `CA`. A locale-aware rule is a different question. */
	assert.equal(teamInitials("Café"), "CA");
});
