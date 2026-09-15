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
		contents:
			'export * from "./src/renderer/src/features/chat/components/slash-submit";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { planSlashArming, planSlashSubmission } = await import(
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
	"clear",
]);
/** `consumes_prompt: true` in the shared registry. */
const PROMPT_COMMANDS = new Set(["team", "teams", "agent", "agents", "goal"]);
/** The name-list commands: `NAME_ARGUMENT_COMMANDS` + aliases. */
const NAME_LIST_COMMANDS = new Set(["team", "teams", "agent", "agents"]);
/** The `session.goal` destination's words: armed by a PICK, never by an Enter. */
const ARMED_ONLY_COMMANDS = new Set(["goal"]);

const plan = (draft, caret, over = {}) =>
	planSlashSubmission({
		draft,
		caret,
		commandNames: COMMAND_NAMES,
		promptCommands: PROMPT_COMMANDS,
		armedOnlyCommands: ARMED_ONLY_COMMANDS,
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
	// The existing whole-draft path is untouched: all three
	// `SlashDispatchOutcome` meanings keep their current behaviour, and the
	// command the dispatcher is handed is the name plus the args of that line.
	assert.equal(plan("/usage", 6).kind, "whole");
	assert.deepEqual(plan("/usage", 6).command, { name: "usage", args: "" });
	assert.equal(plan("  /usage  ", 10).kind, "whole");
	// A command with arguments on the SAME line is still a whole-draft command:
	// the existing shape, kept deliberately so `/model gpt-5` does not become a
	// splice.
	assert.equal(plan("/usage more prose", 6).kind, "whole");
	assert.deepEqual(plan("/model gpt-5", 12).command, {
		name: "model",
		args: "gpt-5",
	});
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
	assert.deepEqual(plan("fix this /model gpt-5", 20).command, {
		name: "model",
		args: "gpt-5",
	});
	// A command with no argument hands on an EMPTY args, not the next line.
	assert.deepEqual(plan("fix this /model", 14).command, {
		name: "model",
		args: "",
	});
	// The blocker's own draft, caret where typing leaves it: the token is on
	// line 2, so there is no command at all — and therefore no command object
	// for any later layer to re-derive. Prose goes to the model.
	assert.deepEqual(plan("/usage\nhello from line two", 25), { kind: "send" });
	// And with the caret back on the command's line, the command that IS handed
	// on owns that line alone: line 2 is the surviving draft, never its argument.
	const spliced = plan("/usage\nhello from line two", 6);
	assert.equal(spliced.kind, "splice");
	assert.deepEqual(spliced.command, { name: "usage", args: "" });
	assert.equal(spliced.text, "hello from line two");
});

test("the caret's token decides, not the whole-draft regex (round 1 R2)", () => {
	/*
	 * The blocker: a command on line 1 of a TWO-line draft. `SLASH_SUBMISSION`
	 * against the whole draft reads the newline as the command/argument
	 * separator, so line 2 became `/usage`'s argument, the box was cleared on
	 * `consumed`, and the prose reached the transport as a provider name —
	 * observed end to end as `422 Invalid desktop operation.` (QA round 1 Q1, UX
	 * round 1 U1). The reference `_run_command_from_buffer` takes the span on the
	 * caret's LINE and splices when the remainder is non-empty (`editor.py:
	 * 8184-8200`), which is what these three cases pin.
	 */
	const spliced = plan("/usage\nfix this", 6);
	assert.equal(spliced.kind, "splice");
	assert.deepEqual(spliced.command, { name: "usage", args: "" });
	assert.equal(spliced.text, "fix this");

	// Same draft, caret at the END of line 2: the command is above the caret, so
	// the caret is not on any token and the draft is prose. Nothing is lost
	// either way — line 2 is never handed over as an argument.
	assert.deepEqual(plan("/usage\nfix this", 16), { kind: "send" });

	// A command on its own line UNDER a message splices the same way, and the
	// message survives in the composer.
	const below = plan("fix this\n/usage", 15);
	assert.equal(below.kind, "splice");
	assert.deepEqual(below.command, { name: "usage", args: "" });
	assert.equal(below.text, "fix this");
});

test("a slash-shaped token that names no command is reported, not consumed", () => {
	// Round 1 UX U8: `fix this /tema` used to splice the misspelling out of the
	// box, so the user lost the only copy of the word they had to fix. The
	// planner reports it (the dispatcher owns the "did you mean" note) and the
	// caller restores the ORIGINAL draft.
	const result = plan("fix this /tema", 14);
	assert.equal(result.kind, "unrecognised");
	assert.deepEqual(result.command, { name: "tema", args: "" });
	// A whole-draft misspelling keeps the existing shape: the command is handed
	// on and the dispatcher's own "unknown command" note (with its suggestions)
	// answers it, exactly as it did before this change.
	assert.equal(plan("/tema", 5).kind, "whole");
});

test("a draft with no command token at the caret is prose", () => {
	assert.deepEqual(plan("hello world", 5), { kind: "send" });
	assert.deepEqual(plan("src/foo", 7), { kind: "send" });
	// The caret is before the token, so the token is not the caret's.
	assert.deepEqual(plan("fix this /team ops", 3), { kind: "send" });
});

test("a command typed into a sentence splices out and runs", () => {
	// Acceptance criterion 19: the surrounding draft survives.
	const result = plan("fix this /usage", 14);
	assert.equal(result.kind, "splice");
	assert.deepEqual(result.command, { name: "usage", args: "" });
	assert.equal(result.text, "fix this");
	assert.equal(result.caret, 8);
});

test("a free-text command mid-draft reassembles to the front, staged", () => {
	// Acceptance criterion 20: never auto-submitted, and nothing lost. Moving
	// the command to the front is what the TUI does rather than guessing which
	// trailing words are a name and which are the message (D1).
	const result = plan("ship it /team ops", 17);
	assert.equal(result.kind, "reassemble");
	assert.equal(result.text, "/team ops ship it");
	assert.equal(result.caret, 17);

	// Hand-typed argument and draft: the draft is appended AFTER the argument,
	// which still parses and is staged for the user to read.
	const withArgument = plan("review this /team ops", 20);
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

test("the non-goal prompt commands keep the reassembly Enter has always had", () => {
	/*
	 * The change is scoped to the armed vocabulary, and the vocabulary is the
	 * registry's. `/team` — the other `consumes_prompt` command — keeps the
	 * hoisting, because an assembled `/team ops <message>` line is one the user
	 * asked to read before it runs, and nothing about the goal report changes it.
	 */
	const team = plan("please ship it /team ops", 23);
	assert.equal(team.kind, "reassemble");
	assert.equal(team.text, "/team ops please ship it");
	// The name-list exception is untouched: `/team` with no name typed keeps its
	// roster list open rather than reassembling on the word alone.
	assert.deepEqual(plan("fix this /team", 13), {
		kind: "list-open",
		command: { name: "team", args: "" },
	});
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
	assert.deepEqual(
		planSlashArming({ draft: "/goal ", caret: 6, ...ARMS }),
		{ kind: "none" },
	);
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
	// Acceptance criterion 21: `/team` and `/agent` do NOT reassemble on the word
	// alone — the name is picked from the list first
	// (`editor.py:8219-8222`). The plan carries the command so a caller whose
	// list cannot answer can still say which command is waiting (round 1 UX U5).
	assert.deepEqual(plan("fix this /team", 13), {
		kind: "list-open",
		command: { name: "team", args: "" },
	});
	assert.deepEqual(plan("fix this /agent", 14), {
		kind: "list-open",
		command: { name: "agent", args: "" },
	});
	assert.deepEqual(plan("fix this /teams", 14), {
		kind: "list-open",
		command: { name: "teams", args: "" },
	});
	// With a name typed, the exception does not apply and it reassembles.
	assert.equal(plan("fix this /team ops", 17).kind, "reassemble");
});

test("a command on its own line below a draft collapses that line", () => {
	// The draft is the message, the command is what routes it. End-of-line, not
	// end-of-buffer, is what keeps the two apart.
	const result = plan("fix this\n/usage", 15);
	assert.equal(result.kind, "splice");
	assert.equal(result.text, "fix this");
	assert.deepEqual(result.command, { name: "usage", args: "" });
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
		["fix this /team", 13],
		["fix this /goal", 13],
		["/usage", 6],
		["prose", 5],
	]) {
		const result = plan(draft, caret);
		assert.ok(
			["send", "whole", "splice", "reassemble", "list-open"].includes(
				result.kind,
			),
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
