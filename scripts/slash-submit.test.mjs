import assert from "node:assert/strict";
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
	armedOnlyVocabulary,
	completionFor,
	planSlashArming,
	planSlashSubmission,
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
