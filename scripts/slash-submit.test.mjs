import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's submit planner, asserted against the TUI's run path it ports.
 *
 * `slash-submit.ts` is the renderer twin of `Editor._run_command_from_buffer`
 * (`editor.py:8166-8227`). It is pure, so every branch below is checkable
 * without a browser — which is the point: this is the file that decides whether
 * text the user typed is submitted, spliced away, or moved to the front, and
 * the D1 defect it exists to prevent was a draft being silently consumed.
 *
 * Bundled rather than imported because the module is TypeScript in the renderer
 * tree; the module under test is the REAL one, and it is bundled together with
 * the real tokenizer it calls rather than a stand-in.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/components/slash-submit";',
			/*
			 * The pick's own WRITE, so the arming is exercised from the draft a user
			 * types to the line the next Enter submits (review F7): a suite that
			 * hand-built `"I approve spend /goal "` could not see the multi-line draft
			 * whose staged line did not run (review F1 / QA Q4).
			 */
			'export { completionFor } from "./src/renderer/src/features/chat/components/slash-completion";',
			/*
			 * The tokenizer's own span, so the case below can assert that the planner and
			 * the span agree about where a token's WORD ends (review F1 is exactly the
			 * two of them disagreeing about the separator).
			 */
			'export { slashTokenSpan } from "./src/renderer/src/features/chat/components/slash-token";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	argumentFits,
	argumentShapeVocabulary,
	armedOnlyVocabulary,
	completionFor,
	planSlashArming,
	planSlashSubmission,
	prefixingVocabulary,
	slashTokenSpan,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The registry-derived vocabularies the composer hands the planner. */
const COMMAND_NAMES = new Set([
	"team",
	"teams",
	"agent",
	"agents",
	"goal",
	"usage",
	"model",
	"compact",
	"login",
	"logout",
	"credential",
	"stop",
	"fast",
	"move",
]);
/** `consumes_prompt: true` in the shared registry. */
const PROMPT_COMMANDS = new Set(["team", "teams", "agent", "agents", "goal"]);
/** The inline-argument vocabulary: `inlineArgumentFor` returns a list. */
const VALUE_ARGUMENT_COMMANDS = new Set([
	"model",
	"effort",
	"approvals",
	"team",
	"agent",
	"theme",
]);
/** The name-list commands: `NAME_ARGUMENT_COMMANDS` + aliases. */
const NAME_LIST_COMMANDS = new Set(["team", "teams", "agent", "agents"]);
/** The `session.goal` destination's words: armed by a PICK, never by an Enter. */
const ARMED_ONLY_COMMANDS = new Set(["goal"]);
/*
 * The free-text row F1 was driven on, in the sets the composer derives: `loop`
 * is a prompt command with no name list and no arming, so what a pick of it
 * stages is a REASSEMBLY — the writer this round's cases cover.
 */
const LOOP_NAMES = new Set([...COMMAND_NAMES, "loop"]);
const LOOP_PROMPTS = new Set([...PROMPT_COMMANDS, "loop"]);
/**
 * The registry's own declaration: `arguments` is `optional` or `required`.
 *
 * `login`/`logout` are the sharp end of review round 1's R1 — both are
 * `arguments: "required"` with no inline list and no free-text prompt, and the
 * desktop forwards the typed word as the SELECTION, so reading them as prose
 * stopped a command that runs today.
 */
const ARGUMENT_COMMANDS = new Set([
	"login",
	"logout",
	"credential",
	"stop",
	"fast",
	"move",
	"model",
	"effort",
	"approvals",
	"theme",
	"team",
	"teams",
	"agent",
	"agents",
	"goal",
]);

const plan = (draft, caret, over = {}) =>
	planSlashSubmission({
		draft,
		caret,
		commandNames: COMMAND_NAMES,
		promptCommands: PROMPT_COMMANDS,
		armedOnlyCommands: ARMED_ONLY_COMMANDS,
		valueArgumentCommands: VALUE_ARGUMENT_COMMANDS,
		argumentCommands: ARGUMENT_COMMANDS,
		nameListCommands: NAME_LIST_COMMANDS,
		enabled: true,
		...over,
	});

/** The two vocabularies `planSlashArming` reads off the same registry. */
const ARMS = {
	commandNames: COMMAND_NAMES,
	armedOnlyCommands: ARMED_ONLY_COMMANDS,
};

test("the whole-draft command shape is unchanged", () => {
	// The whole-draft path is untouched for a command that TAKES an argument:
	// all three `SlashDispatchOutcome` meanings keep their current behaviour, and
	// the command the dispatcher is handed is the name plus the args of that line.
	assert.equal(plan("/usage", 6).kind, "whole");
	assert.deepEqual(plan("/usage", 6).command, { name: "usage", args: "" });
	assert.equal(plan("  /usage  ", 10).kind, "whole");
	// A command whose trailing text IS its argument is still a whole-draft
	// command on the same line, which is what keeps `/model gpt-5` a command
	// rather than a splice.
	assert.deepEqual(plan("/model gpt-5", 12).command, {
		name: "model",
		args: "gpt-5",
	});
	// And a whole-draft command that takes NO argument cannot carry one: the
	// trailing text is the user's own prose, so the draft goes to the model. This
	// is the operator's first-hand report — `/compact hello` ran `/compact` and
	// ate `hello` (see the rule's header for the whole deviation).
	assert.deepEqual(plan("/compact hello", 14), { kind: "send" });
	assert.deepEqual(plan("/usage more prose", 6), { kind: "send" });
});

test("the operator's rule: a command word is prose unless it is the input", () => {
	/*
	 * The decision this change implements, in the operator's own words: "if you
	 * don't actually hit enter on the suggested command or click it, then it
	 * should be treated as plain text instead of as a command input unless it's
	 * the only input and/or at the start of the input".
	 *
	 * The consequence list is the one the rule is written for, and each pair here
	 * is the SAME word with the SAME caret: commands on the left, prose on the
	 * right. Every prose row is `send` — no splice, no note, nothing eaten.
	 */
	// Commands: the whole draft, or a draft-opening argument-taking command.
	assert.equal(plan("/compact", 8).kind, "whole");
	assert.equal(plan("/usage", 6).kind, "whole");
	assert.equal(plan("/model gpt-5", 12).kind, "whole");
	assert.equal(plan("/goal ship it", 12).kind, "whole");
	const opening = plan("/model gpt-5\nplease check the logs", 12);
	assert.equal(opening.kind, "splice");
	assert.deepEqual(opening.command, { name: "model", args: "gpt-5" });
	assert.equal(opening.text, "please check the logs");

	// Prose: a no-argument command with trailing text, a mid-sentence word, a
	// later line, and a leading token with text after a no-argument word.
	for (const [draft, caret] of [
		["/compact hello", 14],
		["hello /compact", 14],
		["fix this /usage", 14],
		["/compact\nhello", 8],
		["please /compact this", 19],
		["/usage more prose", 6],
	]) {
		assert.deepEqual(plan(draft, caret), { kind: "send" }, draft);
	}

	/*
	 * And the narrowing `armedOnlyCommands` composes as: one more set, applied on
	 * top of the argument-taking vocabulary, never a name in either module. It is
	 * the seat peer PR #209 wires for `/goal` — a non-whole `/goal` is prose
	 * unless the pick armed it — and the whole-draft form is deliberately NOT
	 * affected by it, which is that PR's own row 1 (`/goal ship the release` runs
	 * on one Enter).
	 */
	const armedOnly = { armedOnlyCommands: new Set(["goal"]) };
	assert.deepEqual(plan("/goal ship it\nand then tell me", 12, armedOnly), {
		kind: "send",
	});
	assert.equal(plan("/goal ship the release", 21, armedOnly).kind, "whole");
	// A word not in the set is unaffected, so the input is a narrowing and not a
	// second switch.
	const other = { armedOnlyCommands: new Set(["loop"]) };
	assert.equal(
		plan("/goal ship it\nand then tell me", 12, other).kind,
		"reassemble",
	);
});

test("the plan hands the dispatcher a command, so args cannot cross a line", () => {
	/*
	 * THE SEAM. QA round 2's Q4 found that round 1's fix lived one layer above
	 * the failure: the planner answered correctly and the canonical send path
	 * then re-derived "is this whole draft a command" from the RAW text, where a
	 * `[\s\S]*` argument group read the newline as the command/argument
	 * separator. The property that must hold is exactly this one: the planner
	 * hands on a name and the args OF ITS OWN LINE, and nothing downstream has
	 * any text left to read. See `slash-dispatch.ts` for the consumer side.
	 */
	// One split, at the first whitespace, from the token's own line.
	assert.deepEqual(plan("/model gpt-5", 12).command, {
		name: "model",
		args: "gpt-5",
	});
	// The same word mid-sentence is now prose rather than a splice, so there is
	// no command object to hand on at all — the operator's rule, and the reason
	// this test's original case changed shape rather than caret.
	assert.deepEqual(plan("fix this /model gpt-5", 20), { kind: "send" });
	// A draft-OPENING argument-taking command over a second line still splits at
	// its own line end, which is what keeps a command from claiming line 2.
	const overLine = plan("/model gpt-5\nplease check the logs", 12);
	assert.equal(overLine.kind, "splice");
	assert.deepEqual(overLine.command, { name: "model", args: "gpt-5" });
	assert.equal(overLine.text, "please check the logs");
	// A command with no argument hands on an EMPTY args, not the next line.
	assert.deepEqual(plan("/model", 6).command, {
		name: "model",
		args: "",
	});
	// The blocker's own draft, caret where typing leaves it: the token is on
	// line 2, so there is no command at all — and therefore no command object
	// for any later layer to re-derive. Prose goes to the model.
	assert.deepEqual(plan("/usage\nhello from line two", 25), { kind: "send" });
	// And with the caret back on the command's line, the token is a no-argument
	// command with text after it, which the operator's rule makes prose too: line
	// 2 is neither consumed as its argument nor handed on as a command.
	assert.deepEqual(plan("/usage\nhello from line two", 6), { kind: "send" });
});

test("the caret's token decides, not the whole-draft regex (round 1 R2)", () => {
	/*
	 * The blocker: a command on line 1 of a TWO-line draft. `SLASH_SUBMISSION`
	 * against the whole draft reads the newline as the command/argument
	 * separator, so line 2 became `/usage`'s argument, the box was cleared on
	 * `consumed`, and the prose reached the transport as a provider name —
	 * observed end to end as `422 Invalid desktop operation.` (QA round 1 Q1, UX
	 * round 1 U1).
	 *
	 * The caret rule is unchanged — the span is still taken on the caret's LINE —
	 * and the operator's rule now answers the remainder differently: a
	 * no-argument command with text after it is PROSE, so the whole draft reaches
	 * the model and no dispatch happens at all. That is strictly safer than the
	 * splice these cases used to pin, and it is asserted rather than left implicit
	 * because it is the shape of the fix.
	 */
	assert.deepEqual(plan("/usage\nfix this", 6), { kind: "send" });

	// Same draft, caret at the END of line 2: the command is above the caret, so
	// the caret is not on any token and the draft is prose. Nothing is lost
	// either way — line 2 is never handed over as an argument.
	assert.deepEqual(plan("/usage\nfix this", 16), { kind: "send" });

	// A command on its own line UNDER a message is prose for the same reason: a
	// no-argument word with text after it is not a command, and the message is
	// never the argument of a command above it.
	assert.deepEqual(plan("fix this\n/usage", 15), { kind: "send" });
});

test("a slash-shaped token that names no command is reported, not consumed", () => {
	// Round 1 UX U8: `fix this /tema` used to splice the misspelling out of the
	// box, so the user lost the only copy of the word they had to fix. The word
	// now has to BE the draft before it is offered as a command at all — the
	// operator's rule — and in that one shape the planner reports it (the
	// dispatcher owns the "did you mean" note) and the caller restores the
	// ORIGINAL draft, so the misspelling stays to be fixed.
	assert.equal(plan("/tema", 5).kind, "unrecognised");
	assert.deepEqual(plan("/tema", 5).command, { name: "tema", args: "" });
	// Mid-sentence, the same token is the prose it looks like: no note, nothing
	// spliced, and the word is never offered as a command to correct.
	assert.deepEqual(plan("fix this /tema", 14), { kind: "send" });
});

test("a draft with no command token at the caret is prose", () => {
	assert.deepEqual(plan("hello world", 5), { kind: "send" });
	assert.deepEqual(plan("src/foo", 7), { kind: "send" });
	// The caret is before the token, so the token is not the caret's.
	assert.deepEqual(plan("fix this /team ops", 3), { kind: "send" });
});

test("a MID-DRAFT command word is prose in every spelling", () => {
	/*
	 * The operator's second defect, and the half of it no dialog change touches:
	 * "typing (slash)compact just compacts and deletes text in the composer".
	 * `hello /compact` used to remove the token from the sentence and run it; it
	 * is now sent as written, with the word intact, and the same holds for a
	 * free-text word the old rule hoisted to the front and staged.
	 */
	for (const [draft, caret] of [
		["hello /compact", 14],
		["fix this /usage", 14],
		["ship it /goal", 13],
		["review this /team ops", 20],
		["fix this /team", 13],
	]) {
		assert.deepEqual(plan(draft, caret), { kind: "send" }, draft);
	}
});

test("a draft-OPENING free-text command reassembles to the front, staged", () => {
	// The sub-rule the rule keeps: when a prompt-consuming command OPENS the
	// draft, the rest of the text is its argument and the assembled line is
	// staged for the user to read, never auto-submitted (the TUI's D1 rule).
	const result = plan("/goal ship it", 12);
	assert.equal(result.kind, "whole");
	assert.deepEqual(result.command, { name: "goal", args: "ship it" });

	const withArgument = plan("/team ops\nreview this", 8);
	assert.equal(withArgument.kind, "reassemble");
	assert.equal(withArgument.text, "/team ops review this");
});

test("an armed-only command is never hoisted by Enter (the operator's report)", () => {
	/*
	 * The BEFORE of this change, as a case: `I approve spend /goal` answered
	 * `{kind:"reassemble", text:"/goal I approve spend"}` — the user's sentence
	 * moved to the front of the box, nothing sent, and a second Enter needed —
	 * because a `/goal` token ANYWHERE in a draft armed the command. Observed
	 * end to end: the operator typed his request, appended `/goal`, pressed
	 * Enter, read the staging note, pressed Enter again, and got `goal set` with
	 * no message sent.
	 *
	 * The arming is now the explicit PICK of the goal row in the popup and
	 * nothing else (`planSlashArming`), so this key hands the draft back as PROSE
	 * in the order it was typed — the words are not moved and they do reach the
	 * model.
	 */
	assert.deepEqual(plan("I approve spend /goal", 21), { kind: "send" });
	assert.deepEqual(plan("please run /goal on 20 tasks", 28), { kind: "send" });
	// A word in a question is not a gesture either.
	assert.deepEqual(plan("what does /goal do", 17), { kind: "send" });

	// The whole-draft shape is UNCHANGED: the command owns its own line, the text
	// behind it is its argument, and one Enter runs it (criterion 1).
	assert.deepEqual(plan("/goal ship the release", 21), {
		kind: "whole",
		command: { name: "goal", args: "ship the release" },
	});
	assert.deepEqual(plan("/goal ship the release", 6), {
		kind: "whole",
		command: { name: "goal", args: "ship the release" },
	});
	// And the bare form stays a whole-draft command: it is the goal READ the
	// dispatcher presents directly.
	assert.deepEqual(plan("/goal", 5), {
		kind: "whole",
		command: { name: "goal", args: "" },
	});
});

/*
 * THE SEPARATOR IS THE WHITESPACE CLASS, not a literal space (review F1).
 *
 * `wordOf` — the "is this token a command's word" question — split on a literal
 * `" "` while the tokenizer ends its word on `\s` and the dispatcher posts the
 * `\s` split, so a token pasted with a TAB or an NBSP between the name and its
 * argument was read as ONE long word. The armed row's footer then promised prose,
 * Enter fell through, and the planner answered `unrecognised` with a command
 * whose `name` IS the catalogue word — which the dispatcher resolves, posting
 * `/goal <tail>` and opening the goal read over a draft nothing had sent. Every
 * one of the 126 of 261 fall-through states the review swept was a non-U+0020
 * separator, i.e. a paste shape: a TSV tab, or an NBSP lifted off a web page.
 */
/*
 * WHICH GESTURE EACH CASE IS ABOUT, because that distinction is the rule (round
 * 8's decision, stated for the record): a word merely TYPED is prose unless it is
 * the whole draft, or opens one for a command that consumes text; a token the
 * operator PICKED — a click, or Enter on a highlighted row — is a command
 * wherever it sits, which is the half of the operator's own report he kept
 * ("if you don't actually hit enter on the suggested command or click it").
 * These are all the TYPED gesture; the picked one is driven where the pick
 * happens (the composer's own suites).
 */
test("a typed word is prose unless it is the whole draft or opens an argument-taking one", () => {
	// The suite's own helper, so this case reads the same vocabularies every other
	// one does (the registry's three: names, prompts and declared arguments).
	const typed = (draft) => plan(draft, draft.length);
	for (const draft of [
		"/compact hello",
		"hello /compact",
		"fix this /usage",
		"please /credential mysecretname",
	]) {
		assert.equal(
			typed(draft).kind,
			"send",
			`${JSON.stringify(draft)} is prose`,
		);
	}
	// The whole draft, and the leading prompt command, still run.
	assert.equal(typed("/compact").kind, "whole");
	assert.equal(typed("/goal ship it").kind, "whole");
});

test("the word/argument separator is the whitespace class, not a literal space", () => {
	for (const separator of ["\t", "\u00a0", "\u2009", "\v", "\f"]) {
		const at = JSON.stringify(separator);
		// The armed word is recognised, so Enter hands the draft back as PROSE —
		// the honest answer, and the one its footer gave for the same state.
		assert.deepEqual(
			plan(`prose${separator}/goal${separator}and more`, 11),
			{ kind: "send" },
			`armed word, separator ${at}`,
		);
		// A free-text command reassembles with its argument split the same way the
		// dispatcher will split it, rather than taking `list-open` on a name the
		// user had already typed.
		const team = plan(`ship it${separator}/team${separator}ops`, 11, {
			gesture: "pick",
		});
		assert.equal(team.kind, "reassemble", `prompt row, separator ${at}`);
		/*
		 * A DELIBERATE, STATED CONSEQUENCE of the collapse both writers now share
		 * (review F1 / QA Q3-1): the staged line is that writer's, so a paste shape is
		 * normalised to the single space a person would type. What this case exists
		 * for is the SPLIT — the word is recognised at `\s` rather than at a literal
		 * space, so the row reassembles instead of taking `list-open` on a name the
		 * user had already typed — and the split is unchanged. What moved is the
		 * separator's survival into the user's own line, which the armed writer has
		 * never preserved either: `/goal` staged with the same paste shape reads
		 * `/goal and more prose`.
		 */
		assert.equal(
			team.text,
			"/team ops ship it",
			`staged line, separator ${at}`,
		);
		assert.equal(team.text.includes("\n"), false, "staged, and one line");
	}
	// The plain space is unchanged, which is exactly why nothing noticed the rest.
	assert.deepEqual(plan("prose /goal and more", 11), { kind: "send" });
});

/* The tokenizer's separator class, as the planner and the dispatcher read it;
   top-level because the lint rule that keeps regexes out of hot paths applies
   here too (the repo's `useTopLevelRegex`). */
const SEPARATOR = /\s/;

/**
 * The same question asked of the TOKENIZER, so the two answers cannot drift
 * again: the word `slashTokenSpan` claims ends at the first whitespace character.
 */
test("the tokenizer and the planner split a token at the same character", () => {
	for (const separator of [" ", "\t", "\u00a0"]) {
		const draft = `please run${separator}/team${separator}ops`;
		const span = slashTokenSpan(draft, 13, COMMAND_NAMES);
		assert.ok(
			span,
			`a token at the caret with separator ${JSON.stringify(separator)}`,
		);
		// The invoked name is the word up to the separator, in both modules: the
		// planner answers `reassemble` (above) rather than the `unrecognised`
		// branch F1 measured.
		assert.equal(
			draft.slice(span.start + 1).split(SEPARATOR)[0],
			"team",
			`separator ${JSON.stringify(separator)}`,
		);
	}
});
test("the non-goal prompt commands keep the reassembly Enter has always had", () => {
	/*
	 * The change is scoped to the armed vocabulary, and the vocabulary is the
	 * registry's. `/team` — the other `consumes_prompt` command — keeps the
	 * hoisting, because an assembled `/team ops <message>` line is one the user
	 * asked to read before it runs, and nothing about the goal report changes it.
	 */
	/*
	 * The gesture is the PICK's, and that is the whole of this round's merge: a
	 * mid-draft prompt command hoists when the user CHOSE the row, and is prose
	 * when they merely typed the word into a sentence (this branch's rule). The
	 * hoisting itself is unchanged where the user asked for it — which is what
	 * this case was written to hold.
	 */
	const team = plan("please ship it /team ops", 23, { gesture: "pick" });
	assert.equal(team.kind, "reassemble");
	assert.equal(team.text, "/team ops please ship it");
	// And the same draft typed rather than picked is prose: nothing is
	// rearranged and nothing is eaten.
	assert.deepEqual(plan("please ship it /team ops", 23), { kind: "send" });
	/*
	 * The name-list exception survives where the word is ACTED on: a `/team` that
	 * opens the draft, or one picked from the popup, keeps its roster list open
	 * rather than reassembling on the word alone.
	 */
	assert.deepEqual(plan("/team\nreview this", 5), {
		kind: "list-open",
		command: { name: "team", args: "" },
	});
	assert.deepEqual(plan("fix this /team", 13, { gesture: "pick" }), {
		kind: "list-open",
		command: { name: "team", args: "" },
	});
	// And the same word typed mid-sentence is prose, which is this branch's rule:
	// no list opens, nothing is rearranged, the sentence is sent as written.
	assert.deepEqual(plan("fix this /team", 13), { kind: "send" });
});

test("the pick arms the command: hoisted, staged, and nothing else", () => {
	/*
	 * The pick path as the composer runs it. `completionFor` writes the picked
	 * word IN PLACE at the token (`I approve spend /goal ` — unchanged by this
	 * change), and `planSlashArming` then hoists the command to the front with
	 * the surviving draft as its argument. That line is what the user reads and
	 * what the next Enter submits: the goal set and the text sent.
	 */
	assert.deepEqual(
		planSlashArming({ draft: "I approve spend /goal ", caret: 22, ...ARMS }),
		{ kind: "armed", text: "/goal I approve spend", caret: 21 },
	);
	// A command on its OWN line under a message hoists to one line, which is the
	// shape the reassembly has always had (`spliced.text.trim()`); the pick's own
	// write is `completionFor`'s, in place at the token.
	assert.deepEqual(
		planSlashArming({ draft: "ship it\n/goal ", caret: 14, ...ARMS }),
		{ kind: "armed", text: "/goal ship it", caret: 13 },
	);
	// With an argument already typed, it hoists with the word, which is the shape
	// the reassembly has always had.
	assert.deepEqual(
		planSlashArming({ draft: "ship it /goal now ", caret: 17, ...ARMS }),
		{ kind: "armed", text: "/goal now ship it", caret: 17 },
	);
});

test("a pick with nothing to arm is the completion it has always been", () => {
	// A bare `/goal ` pick: no text to arm, so the pick writes its completion and
	// the next Enter reaches the bare form's own READ (`PRESENT_DIRECTLY`).
	assert.deepEqual(planSlashArming({ draft: "/goal ", caret: 6, ...ARMS }), {
		kind: "none",
	});
	// A pick of a row the vocabulary does not call armed-only writes nothing
	// extra, and a pick with no token at the caret arms nothing at all.
	assert.deepEqual(
		planSlashArming({ draft: "ship it /team ", caret: 14, ...ARMS }),
		{ kind: "none" },
	);
	assert.deepEqual(
		planSlashArming({ draft: "ship it /goal ", caret: 3, ...ARMS }),
		{ kind: "none" },
	);
});

test("a name-list command with no name typed keeps its list open", () => {
	// Acceptance criterion 21, narrowed to the shape it still applies to and
	// asserted a second way here: when a bare `/team` or `/agent` OPENS the draft
	// over something else, it does NOT reassemble on the word alone — the name is
	// picked from the list first (`editor.py:8219-8222`). The plan carries the
	// command so a caller whose list cannot answer can still say which command is
	// waiting (round 1 UX U5).
	assert.deepEqual(plan("/team\nreview this", 5), {
		kind: "list-open",
		command: { name: "team", args: "" },
	});
	assert.deepEqual(plan("/agent\nreview this", 6), {
		kind: "list-open",
		command: { name: "agent", args: "" },
	});
	assert.deepEqual(plan("/teams\nreview this", 6), {
		kind: "list-open",
		command: { name: "teams", args: "" },
	});
	// With a name typed, the exception does not apply and it reassembles.
	assert.equal(plan("/team ops\nreview this", 8).kind, "reassemble");
	// The bare word ALONE is a whole-draft command, which is what it was before
	// this change: the destination's own picker opens from the dispatch, and the
	// list-open plan is only ever reached when the word has a draft around it.
	assert.deepEqual(plan("/team", 5), {
		kind: "whole",
		command: { name: "team", args: "" },
	});
	assert.deepEqual(plan("/team ", 6), {
		kind: "whole",
		command: { name: "team", args: "" },
	});
	// And mid-sentence the roster word is prose: the list is a thing the user
	// opens, not a thing a sentence opens for them.
	assert.deepEqual(plan("fix this /team", 13), { kind: "send" });
});

test("the capabilities flag turns the planner off completely", () => {
	// Acceptance criterion 23: with the commands capability off, nothing is
	// spliced and the draft sends as prose — the same fallback the model path
	// already has.
	assert.deepEqual(plan("fix this /usage", 14, { enabled: false }), {
		kind: "send",
	});
	assert.deepEqual(plan("/usage", 6, { enabled: false }), { kind: "send" });
});

test("no branch consumes typed text without an outcome", () => {
	// Acceptance criterion 24, asserted structurally: every branch either hands
	// the whole line on, hands a line on AND reports what survives, or hands the
	// draft to the model. Nothing returns a plan that deletes text and says
	// nothing.
	for (const [draft, caret] of [
		["fix this /usage", 14],
		["/team", 5],
		["/goal ship it", 12],
		["/usage", 6],
		["/model gpt-5\nplease check the logs", 12],
		["prose", 5],
	]) {
		const result = plan(draft, caret);
		assert.ok(
			[
				"send",
				"whole",
				"splice",
				"reassemble",
				"list-open",
				"unrecognised",
			].includes(result.kind),
			`${draft} produced ${result.kind}`,
		);
		if (result.kind === "splice") {
			// A splice must report the text that survives it, so the composer can
			// put it back verbatim if the command does not run.
			assert.equal(typeof result.text, "string");
			assert.ok(result.text.length < draft.length);
		}
	}
});

/*
 * THE SEAM THE BLOCKER SAT ON, exercised end to end rather than from a
 * hand-built string: the pick's WRITE (`completionFor`, which is what typing
 * then picking produces) feeds the arming plan, and the arming plan's line is
 * handed back to the Enter planner. Review F1 / QA Q4 found that a multi-line
 * draft staged a line whose next Enter was `send` — the goal never set, the
 * literal `/goal …` reaching the model as prompt text — and review F7 found the
 * suites could not see it because both hand-built the string the pick writes.
 */
const picked = (draft, caret) => {
	const completion = completionFor(
		draft,
		caret,
		{ kind: "command", label: "goal" },
		COMMAND_NAMES,
		[],
		false,
	);
	assert.ok(completion, `the pick writes for ${JSON.stringify(draft)}`);
	const armed = planSlashArming({
		draft: completion.text,
		caret: completion.caret,
		...ARMS,
	});
	assert.equal(armed.kind, "armed", JSON.stringify(armed));
	return { armed, next: plan(armed.text, armed.caret) };
};

/*
 * The OTHER writer of a staged line, through the same end-to-end seam: the
 * reassembly Enter performs. Review F1 / QA Q3-1 found it staged a two-line line
 * whose next Enter was `send` — the literal `/loop …` reaching the model as
 * prose while its own note had just promised the command would run — because the
 * one-line collapse lived on the arming writer instead of on the writer both
 * gestures pass through. These cases are that shape, on the shipped modules.
 */
const loopPlan = (draft, caret, gesture = "typed") =>
	planSlashSubmission({
		draft,
		caret,
		// The pick writes the line these cases are about, so the pick's own
		// gesture is what they ask with (see `submissionFor`).
		gesture,
		commandNames: LOOP_NAMES,
		promptCommands: LOOP_PROMPTS,
		armedOnlyCommands: ARMED_ONLY_COMMANDS,
		nameListCommands: NAME_LIST_COMMANDS,
		enabled: true,
	});

const stagedByEnter = (draft, caret) => {
	const completion = completionFor(
		draft,
		caret,
		{ kind: "command", label: "loop" },
		LOOP_NAMES,
		[],
		false,
	);
	assert.ok(completion, `the pick writes for ${JSON.stringify(draft)}`);
	const staged = loopPlan(completion.text, completion.caret, "pick");
	assert.equal(staged.kind, "reassemble", JSON.stringify(staged));
	// The next Enter is a TYPED one — the user reads the staged line, then presses
	// Enter — and the staged line is a draft-opening command, so it runs.
	return { staged, next: loopPlan(staged.text, staged.caret) };
};

test("an armed line runs on the next Enter, whatever shape the draft had", () => {
	/*
	 * THE INVARIANT: the staged line is the WHOLE DRAFT and it is ONE LINE. A
	 * command owns its word plus the rest of ITS OWN LINE (`slashTokenSpan`), so
	 * a staged line that still carried a surviving newline would leave the rest of
	 * the draft outside the command's span and the next Enter would answer `send`.
	 * These are the shapes this file's own header recommends — the message before
	 * the slash, or on another line — and each is asserted through the real pick
	 * write, the real stage, and the real Enter planner.
	 */
	const single = picked("I approve spend /goal", 21);
	assert.deepEqual(single.armed.text, "/goal I approve spend");
	assert.deepEqual(single.next, {
		kind: "whole",
		command: { name: "goal", args: "I approve spend" },
	});

	// Two lines, command on its own at the end: the sentence keeps its order and
	// the goal text is the whole sentence.
	const two = picked(
		"Please fix the flaky test\nand run /goal",
		"Please fix the flaky test\nand run /goal".length,
	);
	assert.deepEqual(two.armed.text, "/goal Please fix the flaky test and run");
	assert.deepEqual(two.next, {
		kind: "whole",
		command: { name: "goal", args: "Please fix the flaky test and run" },
	});

	// Three lines, caret at the end: the F1/Q4 draft verbatim.
	const threeDraft =
		"Please fix the flaky test and\nthen run the release.\n/goal";
	const three = picked(threeDraft, threeDraft.length);
	assert.deepEqual(
		three.armed.text,
		"/goal Please fix the flaky test and then run the release.",
	);
	assert.deepEqual(three.next, {
		kind: "whole",
		command: {
			name: "goal",
			args: "Please fix the flaky test and then run the release.",
		},
	});

	// Caret mid-line, with text after the command on its own line: the line's tail
	// is part of the command's own line, so it stays with the command and the
	// earlier lines are the argument — the shape the reassembly has always had.
	// Caret on the word, text after it on the same line: the state the popup is
	// open in when the user has not finished the sentence.
	const mid = picked(
		"Please fix the flaky test\nand run /goal and report",
		"Please fix the flaky test\nand run /goal".length,
	);
	assert.deepEqual(
		mid.armed.text,
		"/goal and report Please fix the flaky test and run",
	);
	assert.deepEqual(mid.next, {
		kind: "whole",
		command: {
			name: "goal",
			args: "and report Please fix the flaky test and run",
		},
	});

	// Every staged line is a single line, and the caret is at its end: the two
	// facts the next Enter's plan depends on, asserted rather than inferred.
	for (const { armed } of [single, two, three, mid]) {
		assert.equal(armed.text.includes("\n"), false, JSON.stringify(armed.text));
		assert.equal(armed.caret, armed.text.length);
	}
});

test("the staged line reads as a person would type it (no doubled space)", () => {
	/*
	 * `completionFor` writes `/<label> ` IN PLACE of the word, so a draft with
	 * text after the token keeps its own separating space and the staged line used
	 * to carry two (reviewer Q2). The staged line is what the user reads before
	 * Enter and what the note quotes verbatim, so it is collapsed.
	 */
	const armed = picked("I approve spend /goal and then report", 21);
	assert.deepEqual(armed.armed.text, "/goal and then report I approve spend");
	assert.equal(armed.armed.text.includes("  "), false);
	assert.deepEqual(armed.next, {
		kind: "whole",
		command: { name: "goal", args: "and then report I approve spend" },
	});
});

test("a reassembled line runs on the next Enter, whatever shape the draft had", () => {
	/*
	 * The same invariant, on the other writer (review F1 / QA Q3-1): the staged
	 * line is the WHOLE DRAFT and it is ONE LINE. A draft whose prose sits on a
	 * line of its own used to stage the prose INLINE with the command, so
	 * `slashTokenSpan` — which claims the caret's own LINE — put the surviving text
	 * outside the command's span and the next Enter answered `send`: the user
	 * spent the keystroke, read a note saying the command would run, and the
	 * literal `/loop …` went to the model as prompt text.
	 */
	// One line, prose before the word.
	const single = stagedByEnter("please run /loop", 16);
	assert.deepEqual(single.staged.text, "/loop please run");
	assert.deepEqual(single.next, {
		kind: "whole",
		command: { name: "loop", args: "please run" },
	});

	// The two-line shape the review drove: prose above, the command last.
	const two = stagedByEnter(
		"Please fix the flaky test\nand run /loop",
		"Please fix the flaky test\nand run /loop".length,
	);
	assert.deepEqual(two.staged.text, "/loop Please fix the flaky test and run");
	assert.deepEqual(two.next, {
		kind: "whole",
		command: { name: "loop", args: "Please fix the flaky test and run" },
	});

	// Three lines, caret at the end: the same draft shape the arming cases use.
	const threeDraft =
		"Please fix the flaky test and\nthen run the release.\n/loop";
	const three = stagedByEnter(threeDraft, threeDraft.length);
	assert.deepEqual(
		three.staged.text,
		"/loop Please fix the flaky test and then run the release.",
	);
	assert.deepEqual(three.next, {
		kind: "whole",
		command: {
			name: "loop",
			args: "Please fix the flaky test and then run the release.",
		},
	});

	// The completion's own doubled separator, on this writer too: the draft keeps
	// its separating space after the word the completion rewrote.
	const doubled = stagedByEnter("please run /loop on 3 tasks", 16);
	assert.deepEqual(doubled.staged.text, "/loop on 3 tasks please run");
	assert.equal(doubled.staged.text.includes("  "), false);

	// Every staged line is a single line with the caret at its end: the two facts
	// the next Enter's plan depends on, on this writer as on the arming's.
	for (const { staged, next } of [single, two, three, doubled]) {
		assert.equal(
			staged.text.includes("\n"),
			false,
			JSON.stringify(staged.text),
		);
		assert.equal(staged.caret, staged.text.length);
		assert.equal(next.kind, "whole", JSON.stringify(next));
	}
});

test("a line-initial `/goal <text>` command line above prose is prose (stated change)", () => {
	/*
	 * A DELIBERATE, STATED BEHAVIOUR CHANGE (QA Q1). The base reassembled this
	 * draft — `/goal ship it\nand then tell me` became the single staged line
	 * `/goal ship it and then tell me` — because a `/goal` token on a line was
	 * enough to hoist it. The rule the operator asked for is that a word sitting
	 * in a draft names no gesture, and the rule is line-scoped: the command here
	 * owns its own line only while nothing survives its word, and prose sits
	 * outside it. So the draft goes as written, in its own order, and the command
	 * word is prose rather than a demoted command.
	 *
	 * It is in the PR body's before/after table and here, so it is a stated change
	 * rather than a silent one. What is NOT changed: the same line with nothing
	 * below it is still a whole-draft command, at every caret past the slash.
	 */
	assert.deepEqual(plan("/goal ship it\nand then tell me", 30), {
		kind: "send",
	});
	assert.deepEqual(plan("/goal ship it\nand then tell me", 6), {
		kind: "send",
	});
	assert.equal(plan("/goal ship it", 13).kind, "whole");
});

test("the arming vocabulary is the registry's, and its absence takes the pick path", () => {
	/*
	 * Review F4 / QA Q3. The derivation was a `useMemo` inside the component, so
	 * every suite handed in its own `new Set(["goal"])` and nothing held it. It is
	 * a pure exported function now, and what it derives from is the DESTINATION the
	 * catalogue advertises — which is also the thing the picker registry routes.
	 */
	const catalogue = [
		{ name: "goal", aliases: [], destination: "session.goal" },
		{ name: "loop", aliases: [], destination: "session.loop" },
		{ name: "objective", aliases: ["obj"], destination: "session.goal" },
	];
	assert.deepEqual([...armedOnlyVocabulary(catalogue)].sort(), [
		"goal",
		"obj",
		"objective",
	]);

	/*
	 * THE HAZARD, stated rather than left implicit: a catalogue that does NOT
	 * advertise the armed destination derives no words, and the row then stops
	 * arming — the planner falls back to the implicit hoist this change removes.
	 * That is why the vocabulary is pinned against the destination
	 * `picker-registry.tsx` routes (`slash-contract.test.mjs`), and why the pick
	 * and the planner read one set: the window this can bite in is a UI shipped
	 * ahead of a core without the destination row.
	 */
	const withoutGoal = armedOnlyVocabulary([
		{ name: "goal", aliases: [], destination: "session.other" },
	]);
	assert.equal(withoutGoal.size, 0);
	const arms = {
		commandNames: COMMAND_NAMES,
		armedOnlyCommands: withoutGoal,
	};
	assert.deepEqual(
		planSlashArming({ draft: "I approve spend /goal ", caret: 22, ...arms }),
		{ kind: "none" },
	);
	assert.equal(
		planSlashSubmission({
			draft: "I approve spend /goal",
			caret: 21,
			commandNames: COMMAND_NAMES,
			promptCommands: PROMPT_COMMANDS,
			nameListCommands: NAME_LIST_COMMANDS,
			enabled: true,
			...arms,
		}).kind,
		/*
		 * PROSE, where the implicit hoist used to be the fallback. This branch's
		 * rule makes a mid-draft word prose whatever the arming vocabulary says, so
		 * the hazard above is now bounded in the direction that matters: a catalogue
		 * without the destination row loses the arming AND gets no surprise
		 * rearrangement — the sentence is sent as written.
		 */
		"send",
	);
});

/*
 * Review round 1, R1 — the registry's own `arguments` field is the third
 * vocabulary, and without it every whole-draft command whose argument list is
 * not inline stopped running. Measured on the head the round reviewed: these
 * read `whole` at base `d20c123c1` and `send` after this branch's rule, and QA
 * Q1 then measured the live consequence — the send is refused, because a
 * message may not start with `/`, and the command never runs.
 */
test("a command that declares an argument keeps its whole-draft form", () => {
	for (const [draft, name, args] of [
		["/login openai", "login", "openai"],
		["/logout openai", "logout", "openai"],
		["/credential anthropic", "credential", "anthropic"],
		["/credential k", "credential", "k"],
		["/stop 2", "stop", "2"],
		["/fast on", "fast", "on"],
		["/move ~/work", "move", "~/work"],
	]) {
		assert.deepEqual(
			plan(draft, draft.length),
			{ kind: "whole", command: { name, args } },
			`${draft} is the command and its declared argument`,
		);
	}

	/*
	 * And the narrowing is still the declaration, not "any trailing word": a
	 * no-argument command with text after it is prose (the operator's own report
	 * about `/compact hello`), and the same command mid-sentence is prose too.
	 */
	assert.equal(plan("/compact hello", 14).kind, "send");
	assert.equal(plan("fix this /login openai", 21).kind, "send");
});

/*
 * THE COMMAND-LOCKED WORD, and it is the one place in this file where a typed
 * word is a command WITHOUT being the draft or opening it.
 *
 * The defect it closes is not a planning preference. `/credential` and its alias
 * take a SECRET as their argument: the dispatcher strips that argument before
 * command text is built (`slash-dispatch.ts`, `args: ""`) and the endpoint refuses
 * it with 422 for every other client. The same word mid-sentence planned as prose,
 * so the draft went to the model as message text and the secret was in the
 * transcript. The two directions do not cost the same, which is why this is a rule
 * rather than a caret's opinion — a refused command is visible and undoable, a
 * leaked secret is neither.
 *
 * `commandLockedWords` is the caller's set and is EMPTY by default: the words are
 * `credential-capture.ts`'s (`CREDENTIAL_WORDS`), handed over by the composer, so
 * a host that knows nothing about credentials cannot acquire the behaviour by
 * omission. What the composer's own handoff is worth is pinned in
 * `credential-composer.test.mjs`, where deleting it is observable — the planner's
 * cases below cannot see it, because they write the set themselves.
 */
const LOCKED_WORDS = new Set(["credential", "cred"]);
/*
 * The vocabulary the composer's registry-derived set actually carries: `cred` is
 * a real ALIAS of the command (`local_operator/slash_commands.py`, `aliases=("cred",)`,
 * and `slash-commands.tsx` adds primaries and aliases alike), and this suite's
 * `COMMAND_NAMES` above leaves the aliases of `/team`, `/agent` and `/credential`
 * out because none of its other cases needed one. A word the catalogue does not
 * advertise keeps the spelling the user typed — asserted below — so the alias has
 * to be declared here for the alias case to mean anything.
 */
const LOCKED_NAMES = new Set([...COMMAND_NAMES, "cred"]);
const locked = (draft, caret, over = {}) =>
	plan(draft, caret, {
		commandNames: LOCKED_NAMES,
		commandLockedWords: LOCKED_WORDS,
		...over,
	});
/** A value that cannot be mistaken for prose or for a real credential. */
const CANARY = "LOP_TYPED_LEAK_CANARY_4417";

test("a locked word plans as the command at every caret, column 0 included", () => {
	/*
	 * THE PLACEMENT CASE, and the whole of the difficulty. `slashTokenSpan` claims
	 * the token at the CARET, so a check that asked it — or that sat below its early
	 * return — answered `send` for a caret that is not on the token, column 0 above
	 * all. That is the hole a previous attempt left open at every caret but the
	 * token's own, so each shape is driven at ALL THREE positions and the third of
	 * them is the one that fails when the check is moved back down: at caret 0 there
	 * is no token at the caret at all.
	 *
	 * The CARET the plan hands back is the user's own, clamped into what survives
	 * (design round 1, D5): the removal cannot preserve a caret it swallowed, and it
	 * has no business moving one it did not.
	 */
	for (const [draft, name, survivor, insideToken] of [
		[`please /credential ${CANARY}`, "credential", "please", 15],
		[`please /cred ${CANARY}`, "cred", "please", 15],
		[
			`please store this key for me /credential ${CANARY}`,
			"credential",
			"please store this key for me",
			35,
		],
	]) {
		const start = draft.indexOf("/cred");
		for (const [caret, expectedCaret] of [
			[0, 0],
			[insideToken, survivor.length],
			[draft.length, survivor.length],
		]) {
			assert.deepEqual(
				locked(draft, caret),
				{
					kind: "splice",
					start,
					end: draft.length,
					command: { name, args: CANARY },
					text: survivor,
					caret: expectedCaret,
					locked: true,
				},
				`${JSON.stringify(draft)} at caret ${caret}: the command, the sentence that survives it, and a caret that does not jump`,
			);
		}
	}

	/*
	 * The last shape IS "the token moved to the END of the buffer": its own line
	 * ends where the draft does, so the prefix typed in front of it is what
	 * survives.
	 */
	const moved = `please store this key for me /credential ${CANARY}`;
	assert.equal(
		locked(moved, moved.length).text,
		"please store this key for me",
	);

	/*
	 * A CARET THE REMOVAL DID NOT SWALLOW MOVES BY WHAT IT TOOK AND NO FURTHER (code
	 * review round 2, MINOR 2). The rule is arithmetic rather than a clamp: the survivor
	 * is the draft minus ONE contiguous run, so a caret past that run shifts back by its
	 * length while a caret inside it collapses onto the splice point. The first version
	 * clamped everything past the token, which on a MULTI-LINE draft dropped a caret
	 * sitting on a surviving line back to line 1 — the reviewer measured
	 * `please /credential C\r\nand then ship it` at the end answering 6 — and this pins
	 * the same shapes.
	 */
	const multi = `please /credential ${CANARY}\nand then ship it`;
	const survivorText = "please\nand then ship it";
	const splice = locked(multi, 0);
	assert.equal(
		splice.text,
		survivorText,
		"the run's own line goes, the line below stays",
	);
	const removed = multi.length - survivorText.length;
	for (const [caret, expected] of [
		[0, 0], // before the splice point: untouched
		[8, 6], // inside the token: collapsed onto the splice point
		[multi.length, multi.length - removed], // the end: shifted by what was taken
		[
			// On the SURVIVING line, which is the case the clamp got wrong: the offset
			// of "and" in the draft maps to its own offset in the survivor, not to the
			// splice point on line 1.
			multi.indexOf("and then"),
			survivorText.indexOf("and then"),
		],
	]) {
		assert.equal(
			locked(multi, caret).caret,
			expected,
			`caret ${caret} in ${JSON.stringify(multi)}`,
		);
	}
});

test("the record is what lifts the slash's left boundary, and only the record (QA round 4 Q-1 / UX round 5 U19)", () => {
	/*
	 * TWO ROUNDS MET HERE, and the rule that satisfies both is the RECORD's.
	 *
	 * QA round 4: `/credential <value>` -> the app's own Escape -> Home -> one character
	 * in front of the slash. The tokenizer's boundary rule — which exists so a `/` inside
	 * a word is punctuation — claimed no token, so this rule found no locked word, the
	 * draft no longer started with `/` so the leading-slash refusal had no part of it,
	 * and the press put the value into a message record and a provider request body.
	 *
	 * QA and UX round 5: the first fix for that dropped the boundary for EVERY draft,
	 * and a sentence — `the docs/credential rotation policy is stale` — became a
	 * credential dialog and an unsendable line. So the boundary is back for every draft
	 * BUT the one the composer's cancel record says it put characters back into
	 * (`unmaskedRunWord`), which is the only thing that can tell look-alike prose from
	 * the material this app un-masked. Both halves are driven below.
	 *
	 * THE CARET IS NOT PART OF THE QUESTION: the rule reads the draft alone, so every
	 * caret answers the same, and the first of them — column 0 — is where a caret-led
	 * check has nothing at all to claim.
	 */
	for (const [draft, name, survivor] of [
		[`x/credential ${CANARY}`, "credential", "x"],
		[`x/cred ${CANARY}`, "cred", "x"],
		[`see /credential ${CANARY}`, "credential", "see"],
		[`please /credential ${CANARY}`, "credential", "please"],
	]) {
		const start = draft.indexOf("/cred");
		for (const caret of [0, 1, start + 5, draft.length]) {
			const { caret: _caret, ...substance } = locked(draft, caret, {
				unmaskedRunWord: name,
			});
			assert.deepEqual(
				substance,
				{
					kind: "splice",
					start,
					end: draft.length,
					command: { name, args: CANARY },
					text: survivor,
					locked: true,
				},
				`${JSON.stringify(draft)} at caret ${caret}: the locked word is the command and its tail is its argument`,
			);
		}
	}
	/*
	 * THE OTHER HALF, and it is the whole of UX round 5: the SAME drafts, without the
	 * record, are prose — prose that a user can actually send. The in-word slash is
	 * punctuation again, a path is a path, and a URL is a URL.
	 */
	for (const draft of [
		`x/credential ${CANARY}`,
		"the docs/credential rotation policy is stale",
		"see scripts/cred for the rotation policy",
		"https://example.com/credential/rotation",
	]) {
		assert.deepEqual(
			plan(draft, draft.length, {
				commandNames: LOCKED_NAMES,
				commandLockedWords: LOCKED_WORDS,
			}),
			{ kind: "send" },
			`${JSON.stringify(draft)}: without the record this is the operator's own prose and it sends`,
		);
	}
	assert.deepEqual(
		plan(`x/credential ${CANARY}`, 1),
		{ kind: "send" },
		"no locked words and no record: the default is untouched",
	);
});

test("a word an edit has broken still hands the run over, when the record says so (QA round 5, Q-1)", () => {
	/*
	 * QA ROUND 5's BLOCKER, at the three positions the word's own spelling cannot cover:
	 * a character INSIDE the word, one immediately AFTER it, and a Backspace inside it.
	 * Every one of them leaves the draft holding the characters the Escape un-masked,
	 * with no token this vocabulary can see and — for the inside cases — nothing the
	 * composer's own `recordWord` can see either, so the press degraded to prose and the
	 * canary reached a message record and a provider body on this head, on the pre-fold
	 * head and on `main` alike.
	 *
	 * The record is the fact a spelling cannot be: it names the WORD that was holding
	 * characters here, so the draft's first slash token is taken as that word's run —
	 * the same span, the same `locked: true`, the same receipt and undo as the intact
	 * case above, and the dispatcher refuses the tail as command-line text rather than
	 * sending it.
	 */
	for (const [draft, survivor] of [
		[`please /credxential ${CANARY}`, "please"],
		[`please /credentialx ${CANARY}`, "please"],
		[`please /creential ${CANARY}`, "please"],
		[`see /credxential ${CANARY}`, "see"],
		[`/credxential ${CANARY}`, ""],
	]) {
		const start = draft.indexOf("/");
		for (const caret of [0, start + 5, draft.length]) {
			const { caret: _caret, ...substance } = locked(draft, caret, {
				unmaskedRunWord: "credential",
			});
			assert.deepEqual(
				substance,
				start === 0 && survivor === ""
					? {
							kind: "whole",
							command: { name: "credential", args: CANARY },
							locked: true,
						}
					: {
							kind: "splice",
							start,
							end: draft.length,
							command: { name: "credential", args: CANARY },
							text: survivor,
							locked: true,
						},
				`${JSON.stringify(draft)} at caret ${caret}: the run is the recorded word's argument, whatever the word now spells`,
			);
		}
	}
	/*
	 * AND THE RESIDUAL, stated rather than implied (the PR body carries it too): a FRESH
	 * draft that misspells the word and was never cancelled stays prose, because nothing
	 * but the user knows the word was meant as a command. The same on `main`.
	 */
	assert.deepEqual(
		plan(`please /credxential ${CANARY}`, 5, {
			commandNames: LOCKED_NAMES,
			commandLockedWords: LOCKED_WORDS,
		}),
		{ kind: "send" },
		"a misspelt word with no record is prose, exactly as it is on main",
	);
});

test("the whole-draft locked form is the command, whatever the catalogue says", () => {
	/*
	 * UX round 1's U1, at the planner: the whole-draft form is the shape whose
	 * premise the round-1 PR body got wrong. It IS `whole` on a full catalogue —
	 * `credential` declares `arguments: optional`, so the arm below reads its tail
	 * as its argument — but that arm asks the CATALOGUE, and a catalogue that is
	 * empty (the list query in flight, a backend that does not answer it, or a
	 * runtime that renamed the alias) read the tail as a sentence and answered
	 * `send`: the secret to the model on the one shape the body claimed was safe.
	 * A locked word's tail is its argument BY DEFINITION, so this rule answers it
	 * without asking what the catalogue thinks arguments are.
	 *
	 * An unadvertised word is `unrecognised`, not `whole`: the dispatcher notes
	 * "Unknown command /…" and the composer keeps the draft, so a catalogue that
	 * cannot resolve the word cannot destroy the user's whole draft either.
	 */
	assert.deepEqual(locked(`/credential ${CANARY}`, CANARY.length + 12), {
		kind: "whole",
		command: { name: "credential", args: CANARY },
		locked: true,
	});
	assert.deepEqual(locked(`/cred ${CANARY}`, CANARY.length + 6), {
		kind: "whole",
		command: { name: "cred", args: CANARY },
		locked: true,
	});
	// The same proof the other way: this is what the caret-led arm answers when the
	// catalogue is the one that decides.
	assert.equal(
		plan(`/credential ${CANARY}`, CANARY.length + 12, {
			commandNames: new Set(),
		}).kind,
		"unrecognised",
	);
	const empty = plan(`/credential ${CANARY}`, 0, {
		commandNames: new Set(),
		commandLockedWords: LOCKED_WORDS,
	});
	assert.equal(empty.kind, "unrecognised", "no catalogue, no `whole`");
	assert.equal(
		empty.command.name,
		"credential",
		"and the word is still reported",
	);
});

test("the catalogue cannot disarm the lock (review F1)", () => {
	/*
	 * The fail-open the reviewer measured: `commandNames` comes from the
	 * command-LIST query while the capability flag comes from `capabilities`, so
	 * between boot and the list's arrival — and on any backend that does not answer
	 * it — the catalogue is empty and the flag is on. Requiring membership then
	 * disarmed this rule exactly where it matters, which the reviewer demonstrated
	 * at the planner: `word not in catalogue → send`, `alias not in catalogue →
	 * send`.
	 *
	 * Nothing is required of the catalogue now, and the direction is safe in both
	 * halves: a word the host knows runs; a word it does not reaches the
	 * dispatcher's `!spec` branch, which notes "Unknown command /…" and returns
	 * `consumed`, so the tail is deleted and never sent.
	 */
	for (const caret of [0, 15, `please /credential ${CANARY}`.length]) {
		const planned = plan(`please /credential ${CANARY}`, caret, {
			commandNames: new Set(),
			commandLockedWords: LOCKED_WORDS,
		});
		assert.equal(planned.kind, "splice", `caret ${caret}`);
		assert.equal(
			planned.command.name,
			"credential",
			"the spelling the user typed",
		);
		assert.equal(planned.command.args, CANARY);
		assert.equal(planned.locked, true);
	}
	// The alias too, for the same reason: the runtime's own alias list is the other
	// copy of the vocabulary, and a change there must not disarm this silently.
	assert.equal(
		plan(`please /cred ${CANARY}`, 0, {
			commandNames: new Set(),
			commandLockedWords: LOCKED_WORDS,
		}).kind,
		"splice",
	);
});

test("the capability flag does not disarm the lock (review F2)", () => {
	/*
	 * The same fail-open one gate higher. `enabled` is the CAPABILITY flag, which is
	 * off for the first moments of every boot and on every host that does not publish
	 * the feature — so asking it first left the leak standing on precisely the drafts
	 * this rule exists for. The lock is asked first and fails CLOSED: the plan cannot
	 * run, the words stay in the box (the dispatcher restores a draft it cannot
	 * address, and no dispatcher at all leaves the box untouched), and nothing is
	 * sent. The direction is the one the rule's own asymmetry argues for — a plan that
	 * cannot run is recoverable, a `send` is not.
	 *
	 * Every OTHER word keeps the old order, which is what the suite's own
	 * "capabilities flag turns the planner off completely" case pins.
	 */
	assert.equal(
		locked(`please /credential ${CANARY}`, 0, { enabled: false }).kind,
		"splice",
	);
	assert.equal(
		locked(`please /credential ${CANARY}`, 0, { enabled: false }).locked,
		true,
	);
	assert.equal(
		locked(`/credential ${CANARY}`, 0, { enabled: false }).kind,
		"whole",
	);
	assert.deepEqual(plan("fix this /usage", 14, { enabled: false }), {
		kind: "send",
	});
	assert.deepEqual(plan("fix this /usage", 14, {}), { kind: "send" });
});

test("a locked run hands the dispatcher the catalogue's own spelling", () => {
	/*
	 * Review F3: this rule case-folds and the dispatcher does not
	 * (`slash-dispatch.ts` resolves `command.name === word` then
	 * `aliases.includes(word)`), so `/Cred <secret>` planned a run whose word the
	 * dispatcher could not resolve: it answered "Unknown command /Cred" over a draft
	 * whose tail it had already taken. Safe, and untrue about the user's own
	 * sentence. The catalogue's spellings are lower-cased, so the folded word IS the
	 * catalogue's spelling, and that is what a locked run hands over.
	 *
	 * The general rule is untouched: a word this rule does NOT own still reaches the
	 * dispatcher as typed, which is why every other case in this file is unchanged.
	 */
	for (const [draft, name] of [
		[`please /CREDENTIAL ${CANARY}`, "credential"],
		[`please /Cred ${CANARY}`, "cred"],
	]) {
		const planned = locked(draft, 0);
		assert.equal(planned.kind, "splice", draft);
		assert.equal(planned.command.name, name, draft);
		assert.equal(planned.command.args, CANARY, draft);
	}
	// A word the catalogue does not advertise keeps the spelling the user typed,
	// which is what the dispatcher's "Unknown command /…" note quotes back.
	assert.equal(
		plan(`please /Cred ${CANARY}`, 0, {
			commandNames: new Set(),
			commandLockedWords: LOCKED_WORDS,
		}).command.name,
		"Cred",
	);
});

test("the locked vocabulary is case-folded on both sides (review F6)", () => {
	/*
	 * The set used to be folded only where the word was READ, while the alternation
	 * that FINDS the token was built from it as given — so a caller who spelled a
	 * word with a capital got a rule that matched the token and then refused it, i.e.
	 * a silent no-op. The set is folded once, and both questions ask the folded one.
	 */
	assert.deepEqual(
		plan(`please /Credential ${CANARY}`, 0, {
			commandLockedWords: new Set(["Credential"]),
		}),
		locked(`please /Credential ${CANARY}`, 0),
	);
});

test("the locked rule moves nothing but a locked word's own line", () => {
	// A bare token is the composer's own arming gesture (`/credential ` + a paste),
	// and the capture owns it: with no tail there is no argument to plan, and this
	// rule must not turn a mention of the command into a run.
	assert.equal(locked("please /credential ", 18).kind, "send");
	assert.equal(locked("please /credential", 17).kind, "send");
	// `/credentials` is not the token, exactly as the arming matcher draws it.
	assert.equal(locked(`please /credentials ${CANARY}`, 0).kind, "send");
	// A word the caller did not lock is not this rule's, whatever it carries.
	assert.equal(plan(`please /frobnicate ${CANARY}`, 0).kind, "send");
	// A tab separates like any other whitespace, and a CRLF paste leaves no `\r`
	// on the argument.
	assert.deepEqual(
		locked(`please /credential\t${CANARY}`, 0),
		locked(`please /credential ${CANARY}`, 0),
	);
	assert.equal(
		locked(`please /credential ${CANARY}\r\nand then ship it`, 0).command.args,
		CANARY,
	);
	/*
	 * A locked word behind another command's word is STILL this rule's, and that
	 * is deliberate: the tokenizer hands the rest of that line back as `/team`'s
	 * argument, so the caret-led path plans `send` for this draft and the secret
	 * travels with it. A claim is a rule about editing a line; this rule is about
	 * what the line contains.
	 */
	assert.deepEqual(locked(`please /team ops /credential ${CANARY}`, 0), {
		kind: "splice",
		start: 17,
		end: 55,
		command: { name: "credential", args: CANARY },
		text: "please /team ops",
		caret: 0,
		locked: true,
	});
	// The rest of the draft survives a run, its own lines included.
	assert.equal(
		locked(`please /credential ${CANARY}\nand then ship it`, 0).text,
		"please\nand then ship it",
	);
	/*
	 * A caller's word is a LITERAL, not a pattern: without the escape the set's
	 * `a.b` would match a draft spelling `aXb` and pull a command out of prose.
	 */
	const dotted = { commandNames: new Set([...COMMAND_NAMES, "a.b"]) };
	assert.equal(
		plan("please /aXb secret", 0, {
			...dotted,
			commandLockedWords: new Set(["a.b"]),
		}).kind,
		"send",
	);
	assert.equal(
		plan("please /a.b secret", 0, {
			...dotted,
			commandLockedWords: new Set(["a.b"]),
		}).kind,
		"splice",
	);
	// An empty vocabulary is the default in disguise, and an empty WORD cannot
	// build an alternation that matches everything.
	assert.equal(
		locked(`please /credential ${CANARY}`, 0, {
			commandLockedWords: new Set([""]),
		}).kind,
		"send",
	);
});

test("the locked scan costs one pass, not one call per slash", () => {
	/*
	 * The claim is a RATIO between arms measured in ONE interleaved loop, on the
	 * same draft, on the same machine — the pattern `submit-latency.test.mjs` argues
	 * for: a ratio survives a slower box, an absolute millisecond figure does not.
	 * The control arm is the same plan with the lock set EMPTY, so the difference
	 * between them IS the scan.
	 *
	 * THE ARMS MATCH TOO (review F5). An unmatched scan over a slash-dense draft is
	 * the first claim — "a draft full of `/`s costs what a draft with none costs" —
	 * and the reviewer's number for the shape it replaced (one tokenizer call per
	 * boundary slash, which is what an `indexOf` walk into `slashTokenSpan` costs,
	 * `activeSlash` rebuilding the line's boundary-slash list every call) was
	 * 745-2204 ms against 0.42-0.51 ms for the whole plan: three orders of magnitude.
	 * The third arm is a MATCH, which is the arithmetic the source comment promises —
	 * and it is the faster one, because the splice returns before the rest of the
	 * planner runs.
	 */
	const draft = "x /abc ".repeat(4096).slice(0, 32 * 1024);
	const RATIO_MAX = 6;
	const rounds = 25;
	const median = (samples) => {
		samples.sort((a, b) => a - b);
		return samples[Math.floor(samples.length / 2)];
	};
	const timed = (over, text = draft) => {
		const start = performance.now();
		plan(text, text.length, over);
		return performance.now() - start;
	};
	// Warm EVERY arm first, so none pays for another's JIT in the loop below.
	for (let i = 0; i < 10; i++) {
		timed({});
		timed({ commandLockedWords: LOCKED_WORDS });
		timed(
			{ commandLockedWords: LOCKED_WORDS },
			`${draft} please /credential X`,
		);
	}
	const empty = [];
	const withWords = [];
	const matching = [];
	for (let i = 0; i < rounds; i++) {
		empty.push(timed({}));
		withWords.push(timed({ commandLockedWords: LOCKED_WORDS }));
		matching.push(
			timed(
				{ commandLockedWords: LOCKED_WORDS },
				`${draft} please /credential X`,
			),
		);
	}
	const ratio = median(withWords) / Math.max(median(empty), 1e-6);
	assert.ok(
		ratio < RATIO_MAX,
		`the locked scan must cost about what not running it costs: ${ratio.toFixed(2)}x (non-empty ${median(withWords).toFixed(4)} ms vs empty ${median(empty).toFixed(4)} ms, need <${RATIO_MAX}x)`,
	);
	// The matching arm cannot be the expensive one: it returns at the token.
	assert.ok(
		median(matching) <= Math.max(median(withWords) * RATIO_MAX, 1),
		`a match must not cost more than the scan that finds it: ${median(matching).toFixed(4)} ms against ${median(withWords).toFixed(4)} ms`,
	);
});

/*
 * THE WIRE'S OWN VOCABULARY — `prefixes_text`, `argument_shape` and
 * `argument_words`, the fields the messages endpoint's admission rule is written
 * against (`command_argument_is_used`, `local_operator/slash_commands.py`).
 *
 * The rows below are the shapes the released backend publishes for these words,
 * including the two that the registry's booleans cannot express and that the
 * operator's own report turned on: `/mcp logout` is a valid subcommand while
 * `/mcp logout seems to cause a crash` is the sentence he was writing, and
 * `/login openai` is a command while `/login zzz` is not.
 *
 * The pins are DELETION-SENSITIVE rather than decorative: the shape cases are
 * exactly the rows the three registry vocabularies above answer differently
 * (none of `usage`, `compact` or `mcp` is in them), so a planner that stops
 * reading `argumentShapes` fails here, and one that DEFAULTS a shape-less row to
 * `any` fails the fallback case.
 */
const WIRE_ROWS = [
	{
		name: "team",
		aliases: ["teams"],
		prefixes_text: true,
		argument_shape: "any",
		argument_words: [],
	},
	{
		name: "agent",
		aliases: ["agents"],
		prefixes_text: true,
		argument_shape: "any",
		argument_words: [],
	},
	{
		name: "goal",
		aliases: [],
		prefixes_text: true,
		argument_shape: "any",
		argument_words: [],
	},
	{
		name: "move",
		aliases: [],
		prefixes_text: false,
		argument_shape: "any",
		argument_words: [],
	},
	{
		name: "credential",
		aliases: ["cred"],
		prefixes_text: false,
		argument_shape: "any",
		argument_words: [],
	},
	{ name: "usage", aliases: [], argument_shape: "word", argument_words: [] },
	{ name: "compact", aliases: [], argument_shape: "none", argument_words: [] },
	{
		name: "login",
		aliases: [],
		argument_shape: "provider",
		argument_words: ["openai", "anthropic"],
	},
	{
		name: "mcp",
		aliases: [],
		argument_shape: "subcommand",
		argument_words: ["logout", "login", "grant"],
	},
];
const WIRE_SHAPES = argumentShapeVocabulary(WIRE_ROWS);
const WIRE_PREFIXING = prefixingVocabulary(WIRE_ROWS);
const WIRE_NAMES = new Set([...COMMAND_NAMES, "mcp"]);

/** The composer's own call, with the wire the catalogue hands it. */
const planWire = (draft, caret, over = {}) =>
	plan(draft, caret, {
		commandNames: WIRE_NAMES,
		argumentShapes: WIRE_SHAPES,
		prefixingCommands: WIRE_PREFIXING,
		...over,
	});

test("the wire's argument shape decides the whole draft", () => {
	const cases = [
		// `word` takes one token: a selector's short form, not a sentence.
		["/usage on", "whole"],
		["/usage more prose", "send"],
		// `none` owns nothing after it, and a bare word is still the command.
		["/compact", "whole"],
		["/compact hello", "send"],
		// `provider` is one token DRAWN FROM THE PUBLISHED VOCABULARY.
		["/login openai", "whole"],
		["/login zzz", "send"],
		// `subcommand` is at most two tokens, the first a real subcommand — the
		// operator's own draft is the row this field exists for.
		["/mcp logout", "whole"],
		["/mcp logout seems to cause a crash", "send"],
		// `any` owns whatever follows it.
		["/move ~/x", "whole"],
		["/credential hunter2", "whole"],
	];
	for (const [draft, expected] of cases) {
		assert.equal(
			planWire(draft, draft.length).kind,
			expected,
			`${JSON.stringify(draft)} at its end`,
		);
	}
});

test("a row the wire says nothing about keeps its own answer", () => {
	/*
	 * ABSENCE IS NOT A DEFAULT. The fields are additive, so a backend that does not
	 * publish them must compose exactly as it did before they existed — and the
	 * direction that would be silent is a shape-less row defaulting to `any`, which
	 * is the answer that hands a sentence to a command.
	 */
	const silentAboutUsage = argumentShapeVocabulary(
		WIRE_ROWS.filter((row) => row.name !== "usage"),
	);
	assert.equal(
		planWire("/usage on", 9, { argumentShapes: silentAboutUsage }).kind,
		"send",
		"no shape published, so the registry's own answer stands",
	);
	assert.equal(
		planWire("/usage on", 9).kind,
		"whole",
		"and the published shape is what changes it",
	);
});

test("the leading line is read for a word the wire says owns its tail", () => {
	/*
	 * THE CARET NO LONGER DECIDES THE DRAFT-OPENING BRANCH. `slashTokenSpan` claims
	 * the caret's own line, so this draft had no token at a caret in the body and
	 * planned `send` there while planning the command with the caret inside its
	 * word — the same keystrokes, two answers.
	 */
	const draft = "/team ops fix this\nand then ship it";
	const carets = [0, 4, 12, draft.length];
	assert.deepEqual(
		carets.map((caret) => planWire(draft, caret).kind),
		["reassemble", "reassemble", "reassemble", "reassemble"],
	);
	assert.equal(
		planWire(draft, draft.length).kind,
		"reassemble",
		"the caret in the instruction is the case this repairs",
	);
	// With the wire silent the free-text half of the registry answers the hoist,
	// so the repair is not gated on a backend this app may not be talking to.
	assert.deepEqual(
		carets.map((caret) => plan(draft, caret).kind),
		["reassemble", "reassemble", "reassemble", "reassemble"],
	);
});

test("the hoist is `any`-only, so a value-shaped word above a paragraph stays prose", () => {
	/*
	 * THE ROW THE HOIST MUST NOT TAKE. `logout` is a real subcommand and the word
	 * `mcp` is a real command, so a hoist that validated the LEADING LINE's own
	 * tokens ("logout") ran this as `/mcp` while the endpoint read the paragraph —
	 * the operator's own two-sentence report, arriving as a command.
	 */
	const draft = "/mcp logout\nseems to cause a crash on the TUI";
	assert.equal(
		planWire(draft, draft.length).kind,
		"send",
		"the caret's line decides, and the shape does not own it",
	);
	// ... while the caret-led case is NOT narrowed: the shape validates it.
	assert.equal(planWire("/mcp logout", 11).kind, "whole");
});

test("the wire vocabulary is keyed by alias, and `argumentFits` is the endpoint's shape test", () => {
	assert.equal(
		WIRE_SHAPES.get("teams"),
		WIRE_SHAPES.get("team"),
		"an alias resolves to its primary's row",
	);
	assert.equal(
		WIRE_SHAPES.has("fast"),
		false,
		"a row with no published shape is left out, never defaulted",
	);
	assert.equal(
		WIRE_PREFIXING.has("teams"),
		true,
		"`prefixes_text` is keyed by alias too",
	);
	assert.equal(
		argumentFits(
			{ shape: "subcommand", words: new Set(["logout"]) },
			"logout seems to cause a crash",
		),
		false,
	);
	assert.equal(
		argumentFits({ shape: "word", words: new Set() }, ""),
		false,
		"the empty argument is the whole-draft form, not this function's to answer",
	);
	assert.equal(
		argumentFits({ shape: "provider", words: new Set(["openai"]) }, "zzz"),
		false,
		"a provider outside the published vocabulary is not one",
	);
});
