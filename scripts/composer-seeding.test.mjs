import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SEEDING EFFECT MUST DO WHAT ITS OWN COMMENT SAYS: seed the box when the
 * composer adopts a conversation, and at no other time.
 *
 * `shouldReinitialiseComposer` is the gate it always MEANT to have and did not.
 * Its deps array is `[conversationId, hydrated, getCurrentInput, historyIndex,
 * submittedMessages]`, and two of those change on every submit SETTLE -
 * `addSubmittedMessage` installs a new array identity and `retireDraft` nulls
 * the history index, in the same turn - so the effect ran again and re-seeded
 * the box from `getCurrentInput`, which `retireDraft` had just written to `""`.
 * That is the measured destruction of text typed while a send was in flight: 16
 * of 16 characters at one hold, 5 of 16 at another, with the caret still in the
 * box. It is a DIFFERENT writer from the documented clear whose whole purpose is
 * that a late echo must not clear what the user has typed since - which is
 * exactly the guarantee the second writer was breaking.
 *
 * The rule is pure and exported so it is asserted here without a DOM (the shape
 * `ask-answer.ts`'s predicates take), and the effect is pinned to it by a source
 * scan because a rule nothing consults is a comment. The BEHAVIOUR - the box
 * holding what the user typed while the send settles - is driven through the
 * shipped component in `scripts/credential-composer.test.mjs`, whose jsdom
 * harness is the only one in this tree that mounts it.
 */

const read = (path) => readFileSync(path, "utf8");

/** The source with its comments blanked, so prose about a token is not the token. */
const code = (path) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const HOOK = "src/renderer/src/shared/hooks/use-message-input.ts";
/* ------------------------------------------------------------------ */
/* The settle rule                                                      */
/* ------------------------------------------------------------------ */

/*
 * React stays external so the bundle shares ONE copy with this file's own
 * imports - which is why the bundle is written to a file and imported from
 * there rather than through a data URL: a data-URL module has no directory to
 * resolve a bare `react` from, and node refuses it (the same reason
 * `scripts/ask-options.test.mjs` writes its bundle out). The renderer's
 * `@shared` alias is declared by hand because it is a tsconfig path rather than
 * a node resolution.
 */
const bundle = await build({
	stdin: {
		contents:
			'export { historyRecallEngages, joinTranscript, retireDraftApplies, shouldReinitialiseComposer } from "./src/renderer/src/shared/hooks/use-message-input";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react/jsx-runtime"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: { ".css": "empty", ".svg": "text" },
	define: { "import.meta.env": "{}" },
	write: false,
});
const bundlePath = new URL(
	`./_composer-focus-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	historyRecallEngages,
	joinTranscript,
	retireDraftApplies,
	shouldReinitialiseComposer,
} = await import(bundlePath.href);
await unlink(bundlePath);

test("a composer seeds for a conversation it has not seeded for", () => {
	assert.equal(shouldReinitialiseComposer(undefined, "conv-1", true), true);
	assert.equal(
		shouldReinitialiseComposer("conv-0", "conv-1", true),
		true,
		"a conversation CHANGE is what the effect is named for",
	);
});

test("a settle on the SAME conversation does not seed, which is the fix", () => {
	/*
	 * The defect, as one line: the box has already been seeded for this
	 * conversation, and the submit settle that re-runs the effect must not write
	 * the store's value over what the user has typed since.
	 */
	assert.equal(shouldReinitialiseComposer("conv-1", "conv-1", true), false);
});

test("a settle with no conversation at all does not seed either", () => {
	assert.equal(shouldReinitialiseComposer(undefined, undefined, true), false);
	assert.equal(shouldReinitialiseComposer("conv-1", undefined, true), true);
});

test("nothing seeds before hydration", () => {
	/*
	 * The store is persisted, so before hydration its value is the empty default:
	 * seeding from it would write `""` over the restored draft.
	 */
	assert.equal(shouldReinitialiseComposer(undefined, "conv-1", false), false);
	assert.equal(shouldReinitialiseComposer("conv-1", "conv-1", false), false);
});

/* ------------------------------------------------------------------ */
/* The transcript's boundary (design round 1, D2; UX round 1, U2)      */
/* ------------------------------------------------------------------ */

/*
 * THE GLUE, AS ONE RULE. Plain concatenation landed a transcript flush against
 * a draft that did not end in whitespace - "review the stt overhauldictated
 * words..." - on the exact landing path this change re-publishes, and the
 * joined word shipped as the sent message (measured in both the design round's
 * and the UX round's frames; carried from the baseline build, fixed here
 * because this branch now owns the path).
 */
test("a transcript landing on a draft without a trailing space gets one", () => {
	assert.equal(
		joinTranscript(
			"review the stt overhaul",
			"dictated words from the fake upstream.",
		),
		"review the stt overhaul dictated words from the fake upstream.",
	);
});

test("a boundary either side already carried is not doubled", () => {
	assert.equal(
		joinTranscript("draft ending with space ", "follow-up"),
		"draft ending with space follow-up",
	);
	assert.equal(
		joinTranscript("draft", " leading-space transcript"),
		"draft leading-space transcript",
	);
	assert.equal(joinTranscript("", "fresh"), "fresh");
});

test("the transcript writer goes through that rule, not through `+`", () => {
	const hook = code(HOOK);
	assert.match(
		hook,
		/handleChange\(joinTranscript\(getCurrentInput\(conversationId\), text\)\)/,
		"the row's write adds the boundary",
	);
	assert.match(
		hook,
		/setInputValue\(\(current\) => joinTranscript\(current, text\)\)/,
		"the masked capture's write adds it too",
	);
});

/* ------------------------------------------------------------------ */
/* The settle's retire rule (QA round 1, Q-2)                         */
/* ------------------------------------------------------------------ */

/*
 * A LANDING TRANSCRIPT MAY NOT DROP WHAT IS ON SCREEN. QA's send -> dictate ->
 * dictate sequence: after a send, the settle ran `retireDraft()` seconds after
 * the echo and cleared the PERSISTED copy unconditionally - while the box kept
 * the first take, because the settle's clear never touched the local value.
 * The next landing then appended against the emptied register (`joinTranscript(
 * "", take2)`), and the write REPLACED the box's text: visible loss in 3 of 4
 * runs. The fix makes the settle retire only the copy the send actually owned.
 */
test("a send's settle retires its own payload and nothing newer", () => {
	assert.equal(
		retireDraftApplies("typed line", "typed line"),
		true,
		"the register still holds exactly what was sent",
	);
	assert.equal(
		retireDraftApplies("", "typed line"),
		true,
		"already retired: clearing again is a no-op",
	);
	assert.equal(
		retireDraftApplies("qa take 1", "typed line"),
		false,
		"the register moved on (a landing, or keystrokes) - not this send's to clear",
	);
});

test("send -> settle -> dictate-append cannot replace the visible text", () => {
	/*
	 * The sequence, in the register's own terms: take 1 landed after the send
	 * (so the settle must leave it), and take 2 then joins the copy the box is
	 * showing instead of replacing it.
	 */
	assert.equal(retireDraftApplies("qa take 1", "typed line"), false);
	assert.equal(joinTranscript("qa take 1", "qa take 2"), "qa take 1 qa take 2");
});

test("the settle consults that rule, not an unconditional clear", () => {
	const hook = code(HOOK);
	assert.match(
		hook,
		/retireDraftApplies\(getCurrentInput\(conversationId\), submitted\)/,
		'`retireDraft` must ask the rule before writing `""`',
	);
});

test("the seeding effect is GATED on the rule, not merely accompanied by it", () => {
	const source = code(HOOK);
	const from = source.indexOf("export const useMessageInput = ({");
	assert.ok(from > -1, "the hook is gone");
	/*
	 * The seeding effect, located by its own gate rather than by a comment: the
	 * comment blanking above removes prose, which is the point of it.
	 */
	const effectFrom = source.indexOf("lastInitialisedRef.current,", from);
	const effectTo = source.indexOf(
		"]);",
		source.indexOf("submittedMessages,", effectFrom),
	);
	assert.ok(
		effectFrom > -1 && effectTo > effectFrom,
		"the seeding effect is gone",
	);
	const effect = source.slice(
		source.lastIndexOf("useEffect(", effectFrom),
		effectTo,
	);
	assert.match(
		effect,
		/shouldReinitialiseComposer\(/,
		"the exported rule is what the effect consults, and it is consulted BEFORE the writes below",
	);
	assert.ok(
		effect.indexOf("shouldReinitialiseComposer") <
			effect.indexOf("setInputValue"),
		"the gate has to precede the seeding write, or it gates nothing",
	);
	assert.match(effect, /lastInitialisedRef\.current = conversationId;/);
	assert.match(
		effect,
		/getCurrentInput\(conversationId\)/,
		"the write the gate protects is still the store's value",
	);
	/*
	 * And the memory that makes the gate work is written by the effect it gates:
	 * a ref written anywhere else is a gate that opens on the next render.
	 */
	assert.equal(
		source.split("lastInitialisedRef.current = conversationId;").length - 1,
		1,
		"the gate's memory has exactly one writer, and it is the gated effect",
	);
});

/* ------------------------------------------------------------------ */
/* The history walk's engagement rule (issues #673 and #764)           */
/* ------------------------------------------------------------------ */

/*
 * THE FIRST-LINE TEST WAS NOT AN EMPTY-BOX TEST. `isCursorAtFirstLine()` is a
 * row count (`line === 1`), so any caret on the draft's first line took the
 * recall branch: `preventDefault` ate the native caret move, the draft was
 * swapped for a recalled message, and recovering the sentence meant a full
 * history round trip - the misfire that reads as data loss (issue #673).
 *
 * The rule is pure and exported so it is asserted here without a DOM (the
 * shape `retireDraftApplies` above takes), and the arm is pinned to it by a
 * source scan because a rule nothing consults is a comment. The BEHAVIOUR -
 * which key the composer captures, what the box holds and what the draft store
 * keeps - is driven through the shipped component in
 * `scripts/credential-composer.test.mjs`, whose jsdom harness is the only one
 * in this tree that mounts it.
 */

test("only an empty composer engages the history walk", () => {
	assert.equal(historyRecallEngages(""), true);
});

test("a draft never engages it, at any caret position", () => {
	/*
	 * The rule reads the CONTENT, so there is no caret argument to pass: a
	 * single-line draft with the caret at column 0 and a multi-line draft with
	 * the caret on its first line are the same input to it - the two caret
	 * positions the old first-line gate misfired on because the arms were the
	 * same. Whiteness is content: a stray space is the user's text.
	 */
	assert.equal(historyRecallEngages("draft"), false);
	assert.equal(historyRecallEngages("one\ntwo"), false);
	assert.equal(historyRecallEngages(" "), false);
});

test("the ArrowUp arm consults the rule before it captures the key", () => {
	const hook = code(HOOK);
	/*
	 * The old gate - a bare first-line test on the ArrowUp arm - is exactly what
	 * the issue files, so its absence is asserted, not assumed. The first-line
	 * test survives below the engagement as the WALK's gate (`historyIndex !==
	 * null`), which is why it is not banished entirely: a rule that must keep
	 * walking from the first line cannot drop the test that defines "first".
	 */
	assert.doesNotMatch(
		hook,
		/e\.key === "ArrowUp" && isCursorAtFirstLine\(\)/,
		"the caret's line must not decide engagement",
	);
	assert.match(
		hook,
		/historyRecallEngages\(inputValue\)/,
		"the exported rule is what the arm consults to initiate",
	);
});

/*
 * THE OTHER ARROW'S ARM (issue #764). `isCursorAtLastLine()` counts LOGICAL
 * lines (`line === totalLines` over `\n` counts), so a wrapped single-paragraph
 * draft reports its "last line" at EVERY caret position — and the ArrowDown arm
 * ran `preventDefault` unconditionally inside that guard while its recall walk
 * only runs once a recall is engaged (`historyIndex !== null`). With none
 * engaged the key died doing nothing: ArrowDown could not traverse a wrapped
 * draft's visual rows. The fix mirrors #673's — the arm captures only the WALK
 * it can serve and hands the key back first. jsdom has no layout engine, so the
 * WRAP is out of reach here and the BEHAVIOUR is driven in
 * `scripts/credential-composer.test.mjs`; what this scan pins is the byte shape
 * of the defect — the branch opening straight onto `preventDefault` — which no
 * runtime case on this host can produce.
 */
test("the ArrowDown arm hands the key back when no recall is engaged", () => {
	const hook = code(HOOK);
	assert.match(
		hook,
		/e\.key === "ArrowDown" && isCursorAtLastLine\(\)/,
		"the walk's own gate (the last line) stays on the arm",
	);
	const branchFrom = hook.indexOf('e.key === "ArrowDown"');
	assert.ok(branchFrom > -1, "the ArrowDown arm is gone");
	const branch = hook.slice(
		branchFrom,
		hook.indexOf("handleSubmit,", branchFrom),
	);
	const handBack = branch.indexOf("if (historyIndex === null) return;");
	assert.ok(
		handBack > -1,
		"with no recall engaged the arm hands the key back to the textarea",
	);
	assert.ok(
		handBack < branch.indexOf("e.preventDefault()"),
		"the hand-back has to precede preventDefault, or the key dies anyway",
	);
	assert.doesNotMatch(
		branch,
		/\{\s*e\.preventDefault\(\);/,
		"the old shape — the branch opening straight onto preventDefault — is gone",
	);
});
