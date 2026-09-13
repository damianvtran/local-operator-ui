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
const { planSlashSubmission, SLASH_SUBMISSION } = await import(
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

const plan = (draft, caret, over = {}) =>
	planSlashSubmission({
		draft,
		caret,
		commandNames: COMMAND_NAMES,
		promptCommands: PROMPT_COMMANDS,
		nameListCommands: NAME_LIST_COMMANDS,
		enabled: true,
		...over,
	});

test("the whole-draft command shape is unchanged", () => {
	// The existing whole-draft path is untouched: all three
	// `SlashDispatchOutcome` meanings keep their current behaviour.
	assert.ok(SLASH_SUBMISSION.test("/usage"));
	assert.ok(SLASH_SUBMISSION.test("/model gpt-5"));
	assert.equal(plan("/usage", 6).kind, "whole");
	assert.equal(plan("/usage", 6).line, "/usage");
	assert.equal(plan("  /usage  ", 10).kind, "whole");
	// A command with arguments on the SAME line is still a whole-draft command:
	// the existing shape, kept deliberately so `/model gpt-5` does not become a
	// splice.
	assert.equal(plan("/usage more prose", 6).kind, "whole");
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
	assert.equal(spliced.line, "/usage");
	assert.equal(spliced.text, "fix this");

	// Same draft, caret at the END of line 2: the command is above the caret, so
	// the caret is not on any token and the draft is prose. Nothing is lost
	// either way — line 2 is never handed over as an argument.
	assert.deepEqual(plan("/usage\nfix this", 16), { kind: "send" });

	// A command on its own line UNDER a message splices the same way, and the
	// message survives in the composer.
	const below = plan("fix this\n/usage", 15);
	assert.equal(below.kind, "splice");
	assert.equal(below.line, "/usage");
	assert.equal(below.text, "fix this");
});

test("a slash-shaped token that names no command is reported, not consumed", () => {
	// Round 1 UX U8: `fix this /tema` used to splice the misspelling out of the
	// box, so the user lost the only copy of the word they had to fix. The
	// planner reports it (the dispatcher owns the "did you mean" note) and the
	// caller restores the ORIGINAL draft.
	const result = plan("fix this /tema", 14);
	assert.equal(result.kind, "unrecognised");
	assert.equal(result.line, "/tema");
	// A whole-draft misspelling keeps the existing shape: dispatch answers
	// `not-a-command` / `consumed` exactly as it did before this change.
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
	assert.equal(result.line, "/usage");
	assert.equal(result.text, "fix this");
	assert.equal(result.caret, 8);
});

test("a free-text command mid-draft reassembles to the front, staged", () => {
	// Acceptance criterion 20: never auto-submitted, and nothing lost. Moving
	// the command to the front is what the TUI does rather than guessing which
	// trailing words are a name and which are the message (D1).
	const result = plan("ship it /goal", 13);
	assert.equal(result.kind, "reassemble");
	assert.equal(result.text, "/goal ship it");
	assert.equal(result.caret, 13);

	// Hand-typed argument and draft: the draft is appended AFTER the argument,
	// which still parses and is staged for the user to read.
	const withArgument = plan("review this /team ops", 20);
	assert.equal(withArgument.kind, "reassemble");
	assert.equal(withArgument.text, "/team ops review this");
});

test("a name-list command with no name typed keeps its list open", () => {
	// Acceptance criterion 21: `/team` and `/agent` do NOT reassemble on the word
	// alone — the name is picked from the list first
	// (`editor.py:8219-8222`). The plan carries the line so a caller whose list
	// cannot answer can still say which command is waiting (round 1 UX U5).
	assert.deepEqual(plan("fix this /team", 13), {
		kind: "list-open",
		line: "/team",
	});
	assert.deepEqual(plan("fix this /agent", 14), {
		kind: "list-open",
		line: "/agent",
	});
	assert.deepEqual(plan("fix this /teams", 14), {
		kind: "list-open",
		line: "/teams",
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
	assert.equal(result.line, "/usage");
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
