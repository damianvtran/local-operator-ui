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
				SKILL_EMPTY_ATTACHED,
				SKILL_EMPTY_DRAFT,
				SKILL_LOADING_LINE,
				SKILL_MISS_LINE,
				SKILL_PHASE_LABEL,
				SKILL_TRANSIENT_REASON,
				SKILL_UNAVAILABLE_REASON,
				skillClickFooter,
				skillEnterFooter,
				skillKeyIntent,
				skillNotice,
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
	SKILL_EMPTY_ATTACHED,
	SKILL_EMPTY_DRAFT,
	SKILL_LOADING_LINE,
	SKILL_MISS_LINE,
	SKILL_PHASE_LABEL,
	SKILL_TRANSIENT_REASON,
	SKILL_UNAVAILABLE_REASON,
	hasLowercaseEvidence,
	skillClickFooter,
	skillCompletionFor,
	skillEnterFooter,
	skillKeyIntent,
	skillNotice,
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
/* The no-rows notice: durable > transient > loading > empty > miss    */
/* ------------------------------------------------------------------ */

/** The fixture defaults: an enabled backend, a folder, a leading token. */
const noticeOf = (over = {}) =>
	skillNotice({
		feature: "enabled",
		hasCwd: true,
		attached: true,
		leading: true,
		hasQuery: false,
		rowsCount: 0,
		vocabularyNonEmpty: false,
		pairingRefused: false,
		query: "success",
		...over,
	});

test("the notice copy, one ratified string per state", () => {
	assert.equal(
		SKILL_UNAVAILABLE_REASON,
		"This backend cannot serve the skill catalogue. Update the backend and try again.",
	);
	assert.equal(SKILL_TRANSIENT_REASON, "Skills aren't available right now.");
	// The loading line is the `/` sibling's own word verbatim — family parity
	// costs a state, not a new vocabulary (design round 1, D1).
	assert.equal(SKILL_LOADING_LINE, "Loading…");
	assert.equal(SKILL_EMPTY_ATTACHED, "No skills found — see /skills");
	assert.equal(SKILL_EMPTY_DRAFT, "No skills found.");
	assert.equal(SKILL_MISS_LINE, "No skills match.");
});

test("a bare leading `$` always opens SOMETHING: rows, or one stated line", () => {
	// Available: rows answer for themselves.
	assert.equal(noticeOf({ rowsCount: 3 }), null);
	// Settled-empty vocabulary, attached: the pointer may be followed.
	assert.deepEqual(noticeOf(), { kind: "empty", text: SKILL_EMPTY_ATTACHED });
	// The same state on a draft drops the pointer clause — `/skills` is refused
	// without a conversation, and a dead end is worse than a shorter sentence.
	assert.deepEqual(noticeOf({ attached: false }), {
		kind: "empty",
		text: SKILL_EMPTY_DRAFT,
	});
	// A TYPED query against an empty vocabulary takes the same empty state
	// (one state, not two: there is no vocabulary for "match" to lack).
	assert.deepEqual(noticeOf({ hasQuery: true }), {
		kind: "empty",
		text: SKILL_EMPTY_ATTACHED,
	});
	/*
	 * AND THE EMPTY ARM IS A LEADING-TOKEN NOTICE (review round 1, R1-1):
	 * dropping the `leading &&` in front of it used to leave this suite green,
	 * which is how an inline `$zzz` over an empty vocabulary would have grown
	 * a backend sentence it must not carry.
	 */
	assert.equal(noticeOf({ leading: false }), null);
});

test("durable outranks everything and fires with no query at all", () => {
	assert.deepEqual(noticeOf({ feature: "below-version" }), {
		kind: "durable",
		text: SKILL_UNAVAILABLE_REASON,
	});
	// It outranks the states it can coexist with: a fired query's error, an
	// empty vocabulary, a typed miss.
	assert.equal(
		noticeOf({ feature: "below-version", query: "error" }).kind,
		"durable",
	);
	assert.equal(
		noticeOf({
			feature: "below-version",
			vocabularyNonEmpty: true,
			hasQuery: true,
		}).kind,
		"durable",
	);
	// And it is a LEADING-token notice: an inline `$` mid-sentence is money or a
	// shell variable, not a backend report (the money-guard rule).
	assert.equal(noticeOf({ feature: "below-version", leading: false }), null);
	// Durable still outranks main's pairing cause: a backend that can never
	// answer the read is a version fact, not a transient one.
	assert.equal(
		noticeOf({ feature: "below-version", pairingRefused: true }).kind,
		"durable",
	);
});

test("transient covers unpaired, main's pairing cause, and a fired query's error; everything else is quiet", () => {
	assert.deepEqual(noticeOf({ feature: "unpaired" }), {
		kind: "transient",
		text: SKILL_TRANSIENT_REASON,
	});
	/*
	 * MAIN'S PAIRING CAUSE IS THE SAME FACT LEARNED EARLIER (QA round 1, Q-2):
	 * the probe saw the refusal before any read fired, the picker gates the
	 * vocabulary read on it, and this is the sentence that answers instead.
	 */
	assert.deepEqual(noticeOf({ pairingRefused: true }), {
		kind: "transient",
		text: SKILL_TRANSIENT_REASON,
	});
	assert.deepEqual(noticeOf({ query: "error" }), {
		kind: "transient",
		text: SKILL_TRANSIENT_REASON,
	});
	// Transient outranks empty and miss.
	assert.equal(
		noticeOf({ query: "error", vocabularyNonEmpty: true, hasQuery: true }).kind,
		"transient",
	);
	// A capability answer that never arrived asserts neither cause...
	assert.equal(noticeOf({ feature: "unknown" }), null);
	assert.equal(noticeOf({ feature: "unknown", query: "error" }), null);
	// ... and transient, like its siblings, attaches to leading tokens only —
	// pinned for BOTH its sources (review round 1, R1-1 reproduced that
	// dropping either gate left this suite green).
	assert.equal(noticeOf({ query: "error", leading: false }), null);
	assert.equal(noticeOf({ feature: "unpaired", leading: false }), null);
	assert.equal(noticeOf({ pairingRefused: true, leading: false }), null);
	// A read deliberately NOT running stays quiet: "pending" is also the shape
	// of a read nobody started (no provider, a refused pairing), where a
	// loading line would claim work that is not happening.
	assert.equal(noticeOf({ query: "pending" }), null);
	// Rows were served: a background refetch's failure does not replace them.
	assert.equal(noticeOf({ query: "error", rowsCount: 2 }), null);
	// No folder staged (mid-edit): no query is fired, so nothing has failed yet.
	assert.equal(noticeOf({ hasCwd: false }), null);
});

test("loading speaks one line, and only on a leading token", () => {
	/*
	 * DESIGN ROUND 1, D1 (UX round 1, U4 asked for the same line): a leading `$`
	 * on a cold catalogue used to open NOTHING while the sessionless read was in
	 * flight — the one arm of "a leading `$` always opens something" that did
	 * not hold. It now renders the family's "Loading…", the same word the `/`
	 * sibling prints ahead of every other cause.
	 */
	assert.deepEqual(noticeOf({ query: "loading" }), {
		kind: "loading",
		text: SKILL_LOADING_LINE,
	});
	// The money guard is unchanged: an inline `$` never gets a consultation
	// line, loading included.
	assert.equal(noticeOf({ query: "loading", leading: false }), null);
	// Cached rows answer for themselves: a refetch in flight does not replace
	// them with a loading line.
	assert.equal(noticeOf({ query: "loading", rowsCount: 2 }), null);
	// Loading outranks only the states that cannot coexist with it; a pairing
	// refusal is checked before it (no read was fired at all in that state).
	assert.equal(
		noticeOf({ query: "loading", pairingRefused: true }).kind,
		"transient",
	);
});

test("the miss is unchanged, and it keeps the evidence it always had", () => {
	assert.deepEqual(noticeOf({ vocabularyNonEmpty: true, hasQuery: true }), {
		kind: "miss",
		text: SKILL_MISS_LINE,
	});
	// The miss may attach to an INLINE token — a settled non-empty vocabulary
	// and a typed query are positive evidence the user meant a skill, wherever
	// the token sits (#690's behaviour, unchanged).
	assert.deepEqual(
		noticeOf({ vocabularyNonEmpty: true, hasQuery: true, leading: false }),
		{ kind: "miss", text: SKILL_MISS_LINE },
	);
	// A settled non-empty vocabulary with NO typed query and no rows cannot
	// arise (the empty query lists the catalogue); the selector stays quiet.
	assert.equal(noticeOf({ vocabularyNonEmpty: true, hasQuery: false }), null);
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
	assert.match(
		picker,
		/skillNotice\(\{/,
		"the no-rows line comes from the state machine",
	);
	assert.match(
		picker,
		/rows\.length > 0 \|\| notice !== null/,
		"and the listbox stays up when there is something to say",
	);
	assert.match(
		picker,
		/enabled: active && provided && skillCwd\.length > 0/,
		"the vocabulary read is provider-gated and needs a folder (QA round 1, Q-1)",
	);
	assert.match(
		picker,
		/desktopFeatureState\(capabilities\.data, "skill_catalogue"\)/,
		"the gate reads the sessionless key's STATE (durable/transient/quiet)",
	);
	/*
	 * THE PAIRING GATE (QA round 1, Q-2), pinned at source because the read is
	 * silenced before a request can exist: main's pairing cause gates `active`,
	 * so the vocabulary read fires NO call against a daemon that already refused
	 * this app's credential — and the machine's cells above prove the sentence
	 * that answers instead.
	 */
	assert.match(
		picker,
		/const active = enabled && feature === "enabled" && !pairingRefused;/,
		"the vocabulary read is gated on main's pairing cause",
	);
	assert.match(
		picker,
		/usePairingCause\(\)/,
		"read through the shared pairing hook",
	);
	/*
	 * THE DRAFT SEAM COMPOSES RATHER THAN REPLACES (QA round 1, Q-1, the
	 * blocker): the store lets the seam's return replace the payload the press
	 * built, so the seam has to answer with the composed text. The mount-level
	 * regression lives in `shared-composer.test.mjs`; this pin is the seam's
	 * own line, where the replacement used to happen.
	 */
	assert.match(
		input,
		/return composeOutgoing\(settled\.text\);/,
		"the draft seam composes the payload instead of returning the raw line",
	);
	assert.match(
		picker,
		/\{ op: "skills\.list", cwd: skillCwd \}/,
		"and the read is sessionless — the composer's own folder",
	);
	/*
	 * THE SEND SEAM (F-1 closed): the expansion gate no longer needs a session,
	 * and the body read addresses the same folder the list read.
	 */
	assert.match(
		input,
		/if \(invocation && skillReadProvided\)/,
		"the expansion gate is sessionless",
	);
	assert.match(
		input,
		/readSkillBody\(\s*skillReadClient,\s*cwd \?\? "",\s*invocation\.name,/,
		"and the body read travels with the composer's folder",
	);
	assert.match(
		picker,
		/useOptionalQueryClient\(\)/,
		"through the provider-optional client, as the host contract requires",
	);
});
