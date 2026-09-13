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
	// splice. Note the consequence the inline contract accepts: a second LINE
	// under a leading command word is read as its argument, which is why a
	// message kept apart from the command sits BEFORE the slash or on another
	// line (see the case below).
	assert.equal(plan("/usage more prose", 6).kind, "whole");
	assert.equal(plan("/usage\nfix this", 6).kind, "whole");
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
	// (`editor.py:8219-8222`).
	assert.deepEqual(plan("fix this /team", 13), { kind: "list-open" });
	assert.deepEqual(plan("fix this /agent", 14), { kind: "list-open" });
	assert.deepEqual(plan("fix this /teams", 14), { kind: "list-open" });
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
