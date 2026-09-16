import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
			'export { argumentShapeVocabulary } from "./src/renderer/src/features/chat/components/slash-submit";',
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
	argumentShapeVocabulary,
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
	"loop",
	"btw",
	"fork",
	"usage",
	"compact",
	"model",
	"theme",
	"mcp",
	"clear",
	"login",
	"rename",
	"move",
	"fast",
	"fleet",
]);
/** `consumes_prompt: true` in the shared registry. */
const PROMPT_COMMANDS = new Set([
	"team",
	"teams",
	"agent",
	"agents",
	"goal",
	"loop",
	"btw",
	"fork",
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
 * The wire's SHAPES, at module scope so the pairing (shaped wire vs shape-less
 * wire) can be asserted from any test in this file: the prose rule is
 * expressible only where the backend publishes this field, and the two wires
 * have different, deliberate answers.
 */
const SHAPES = argumentShapeVocabulary([
	{
		name: "mcp",
		aliases: [],
		argument_shape: "subcommand",
		argument_words: ["logout", "login", "grant"],
	},
	{
		name: "login",
		aliases: [],
		argument_shape: "provider",
		argument_words: ["openai", "anthropic"],
	},
	{ name: "usage", aliases: [], argument_shape: "word", argument_words: [] },
	{ name: "compact", aliases: [], argument_shape: "none" },
	{ name: "rename", aliases: [], argument_shape: "any" },
	/*
	 * THE PRECEDENCE ROWS. A command whose trailing text is carried by
	 * `consumes_prompt`/`prefixes_text` advertises `argument_shape: "none"` on
	 * the wire — `none` is that field's word for "no text is ever a SELECTOR
	 * for this command", not "this command takes no text" — so a planner that
	 * asked the shape first planned `send` for every one of these and handed
	 * the endpoint a draft it refuses (the permanent-refusal class). The
	 * vocabulary is asked first, and these rows are what says so.
	 */
	{ name: "team", aliases: [], argument_shape: "none" },
	{ name: "agent", aliases: [], argument_shape: "none" },
	{ name: "goal", aliases: [], argument_shape: "none" },
	{ name: "loop", aliases: [], argument_shape: "none" },
	{ name: "btw", aliases: [], argument_shape: "none" },
	{ name: "fork", aliases: [], argument_shape: "none" },
]);
const SHAPED = { argumentShapes: SHAPES };

const plan = (draft, caret, over = {}) =>
	planSlashSubmission({
		draft,
		caret,
		commandNames: COMMAND_NAMES,
		promptCommands: PROMPT_COMMANDS,
		prefixingCommands: PREFIXES_TEXT,
		armedOnlyCommands: ARMED_ONLY_COMMANDS,
		nameListCommands: NAME_LIST_COMMANDS,
		enabled: true,
		...over,
	});

/**
 * The registry's `prefixes_text` half: the commands whose trailing text is an
 * argument they own, over and above `consumes_prompt`.
 */
const PREFIXES_TEXT = new Set([
	"team",
	"teams",
	"agent",
	"agents",
	"goal",
	"loop",
	"btw",
	"fork",
	"model",
	"theme",
	"effort",
	"approvals",
]);
/**
 * The same vocabulary as an OLDER backend leaves it: no `prefixes_text` on any
 * row, so the composer unions `consumes_prompt` with the destinations that carry
 * an inline argument list (`inlineArgumentFor`).
 */
const PROMPT_UNION_INLINE = new Set([
	...PROMPT_COMMANDS,
	"model",
	"theme",
	"effort",
	"approvals",
]);

/** The caret position that puts the draft's last token under it. */
const caretAtEnd = (draft) => draft.length;

/** The text a command plan says it is: `/name` plus its own line's arguments. */
const reconstructionOf = (command) =>
	`/${command.name}${command.args ? ` ${command.args}` : ""}`.trim();

/**
 * The same planner as an older backend leaves it: no `prefixes_text` anywhere, so
 * the renderer's own union stands in. Every row that could differ is asserted
 * under BOTH, which is the whole of the "additive field" requirement — the wire
 * field may change what the composer knows, never what the user gets.
 */
const legacyPlan = (draft, caret, over = {}) =>
	plan(draft, caret, { prefixingCommands: PROMPT_UNION_INLINE, ...over });

/** The two vocabularies `planSlashArming` reads off the same registry. */
const ARMS = {
	commandNames: COMMAND_NAMES,
	armedOnlyCommands: ARMED_ONLY_COMMANDS,
};

test("rows 1, 2 and 4: the whole-draft command shape is unchanged", () => {
	// Row 1: a bare word IS the command — this is what Enter on the pre-selected
	// popup row has always meant.
	assert.equal(plan("/usage", 6).kind, "whole");
	assert.deepEqual(plan("/usage", 6).command, { name: "usage", args: "" });
	assert.equal(plan("  /usage  ", 10).kind, "whole");
	assert.equal(plan("/compact", 8).kind, "whole");
	// Row 2: the value commands, whose trailing text is their argument.
	assert.deepEqual(plan("/model gpt-5", 12).command, {
		name: "model",
		args: "gpt-5",
	});
	assert.deepEqual(plan("/theme dark", 11).command, {
		name: "theme",
		args: "dark",
	});
	// Row 4: a start command as the whole draft runs, with the prose as its
	// argument.
	assert.deepEqual(plan("/goal ship it", 13).command, {
		name: "goal",
		args: "ship it",
	});
	assert.deepEqual(plan("/team ops fix this", 18).command, {
		name: "team",
		args: "ops fix this",
	});
	// Row 12: a name-list command with no name typed is still the command.
	assert.deepEqual(plan("/team", 5), {
		kind: "whole",
		command: { name: "team", args: "" },
	});
});

test("row 3: a command that owns no text does not get one by being followed", () => {
	/*
	 * The operator's own report, first clause: `/compact hello` ran `/compact` and
	 * silently discarded `hello`. WHICH WIRE decides the answer: this narrowing is
	 * expressible only where the backend publishes `argument_shape`, so on the
	 * shape-less wire these two are commands (as they are on `main`) and on the
	 * shaped one they are messages. Both rows are asserted, because the pairing is
	 * the contract the operator's app runs.
	 */
	assert.deepEqual(plan("/compact hello", 14, {}), {
		kind: "whole",
		command: { name: "compact", args: "hello" },
	});
	assert.deepEqual(plan("/usage more prose", 17, {}), {
		kind: "whole",
		command: { name: "usage", args: "more prose" },
	});
	assert.deepEqual(plan("/usage more prose", 17, SHAPED), { kind: "send" });
	// `/usage\nfix this` is the same shape across a line break, at every caret.
	assert.deepEqual(plan("/usage\nfix this", 6), { kind: "send" });
	assert.deepEqual(plan("/usage\nfix this", caretAtEnd("/usage\nfix this")), {
		kind: "send",
	});
	assert.deepEqual(plan("/compact\nhello", caretAtEnd("/compact\nhello")), {
		kind: "send",
	});
});

test("row 5 and the §1.3 repair: a start command stages from the leading line, caret anywhere", () => {
	const draft = "/team ops fix this\nand then ship it";
	// The caret in the command line, at column 0, in the middle of the word, and
	// at the end of the draft: ONE outcome and ONE staging text for all four.
	for (const caret of [0, 4, 12, caretAtEnd(draft)]) {
		const result = plan(draft, caret);
		assert.deepEqual(
			result,
			{
				kind: "reassemble",
				text: "/team ops fix this and then ship it",
				caret: "/team ops fix this and then ship it".length,
			},
			`caret ${caret} produced ${JSON.stringify(result)}`,
		);
	}
	// A single-line start command opening a longer draft stages the same way.
	assert.deepEqual(plan("/team ops fix this", 18), {
		kind: "whole",
		command: { name: "team", args: "ops fix this" },
	});
	// A name-list command with no name typed does not reassemble on the word
	// alone even from the leading line: the name comes from the list first.
	assert.deepEqual(plan("/team\nfix this", 5), {
		kind: "list-open",
		command: { name: "team", args: "" },
	});
});

test("§1.3: the caret cannot decide a draft-opening value command either", () => {
	const draft = "/model gpt-5\nplease check the logs";
	// Column 0 is the case the caret rule could not express: the same draft ran
	// the command a keystroke earlier and was prose the moment the caret reached
	// the start. One splice, and the body survives in the composer.
	for (const caret of [0, 5, 12]) {
		const result = plan(draft, caret);
		assert.equal(
			result.kind,
			"splice",
			`caret ${caret} produced ${result.kind}`,
		);
		assert.deepEqual(result.command, { name: "model", args: "gpt-5" });
		assert.equal(result.text, "please check the logs");
	}
});

test("row 6: an armed-only command is prose until an explicit pick arms it", () => {
	/*
	 * Peer PR #209's narrowing, which this rule carries rather than weakens: a
	 * `/goal` that merely OPENS a longer draft is prose at every caret. The
	 * narrowing arrives as DATA — `armedOnlyCommands` — because this module names
	 * no command, and #209 is what wires the registry's `session.goal` rows into
	 * it. Until that lands the input is absent and the draft-opening branch
	 * behaves as the rest of the rule says, which is what the second half of this
	 * test pins.
	 */
	const draft = "/goal ship the release\nand tell me when it is done";
	const armed = { armedOnlyCommands: new Set(["goal"]) };
	for (const caret of [0, 5, draft.indexOf("\n"), caretAtEnd(draft)]) {
		assert.deepEqual(
			plan(draft, caret, armed),
			{ kind: "send" },
			`caret ${caret}`,
		);
	}
	// Its whole-draft form is untouched: one Enter runs it, armed or not.
	assert.deepEqual(plan("/goal ship the release", 22, armed).command, {
		name: "goal",
		args: "ship the release",
	});
	// The narrowing is per-word and generic: another word of the same shape is
	// unaffected by it.
	assert.equal(
		plan("/team ops fix this\nand then ship it", 4, armed).kind,
		"reassemble",
	);
	// No unwired shape is left to stage it: #209 landed on `main`, so every caller
	// hands the vocabulary in, and the same `/goal …` that opens a body is prose
	// whether the arming arrived or not. (Before the merge this branch asserted
	// `reassemble` here, which was the pre-#209 behaviour of the same draft.)
	assert.equal(plan(draft, 4).kind, "send");
});

test("rows 7 and 8: a command word that owns no text opens a message, not a control", () => {
	/*
	 * Row 7 on BOTH wires: the shaped one narrows it to a message (the subcommand
	 * shape's vocabulary does not hold a sentence), and the shape-less one runs it
	 * as `/mcp` with the sentence as its argument — `main`'s behaviour, and the
	 * pairing's stated cost. The MULTI-LINE form below is prose on both, because
	 * that half is carried by the booleans and never needed a shape.
	 */
	const single = "/mcp logout seems to cause a crash on the TUI";
	assert.deepEqual(plan(single, 0, SHAPED), { kind: "send" });
	assert.deepEqual(plan(single, caretAtEnd(single), SHAPED), { kind: "send" });
	assert.deepEqual(plan(single, 0, {}), {
		kind: "whole",
		command: { name: "mcp", args: "logout seems to cause a crash on the TUI" },
	});
	// Row 8: the operator's own three-line draft, caret anywhere. This is the
	// screenshot: it was refused by the backend's blanket policy, and the UI half
	// of the fix is that the composer already classifies it as prose.
	const reported = [
		"/mcp logout seems to cause a crash on the TUI,",
		"can you review and fix that issue,",
		"replicate it and then fix and test end to end",
	].join("\n");
	for (const caret of [0, 3, reported.indexOf("\n"), caretAtEnd(reported)]) {
		assert.deepEqual(plan(reported, caret), { kind: "send" }, `caret ${caret}`);
	}
});

test("row 9: a slash-shaped word that names no command is reported, not eaten", () => {
	// Round 1 UX U8: the misspelling is the thing to fix, so the dispatcher
	// reports it (its own "did you mean" note) and the draft is KEPT.
	assert.equal(plan("/tema", 5).kind, "unrecognised");
	assert.deepEqual(plan("/tema", 5).command, { name: "tema", args: "" });
	// Inside a sentence it is punctuation, and a "did you mean" for a word the
	// user never offered as a command would be a note about nothing.
	assert.deepEqual(plan("fix this /tema", 14), { kind: "send" });
	assert.deepEqual(plan("fix this /tema\nand more", 12), { kind: "send" });
});

test("rows 10, 11 and 13: a token inside a sentence is punctuation", () => {
	// Row 10: the second half of the operator's report. The caret ON the token
	// (row 13) and at the end of the draft (row 10) both send the sentence whole,
	// which is the stated behaviour change from the old rule's splice.
	const midSentence = "fix this /usage";
	assert.deepEqual(plan(midSentence, caretAtEnd(midSentence)), {
		kind: "send",
	});
	assert.deepEqual(plan(midSentence, midSentence.indexOf("/usage") + 2), {
		kind: "send",
	});
	// Row 11: a command on a LATER line belongs to that line, not to the draft.
	assert.deepEqual(plan("hello\n/team ops", 15), { kind: "send" });
	assert.deepEqual(plan("fix this\n/usage", 15), { kind: "send" });
	assert.deepEqual(plan("please /compact this", 19), { kind: "send" });
});

test("the planner hands the dispatcher a command whose args cannot cross a line", () => {
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
	assert.deepEqual(plan("/model gpt-5\nplease check the logs", 0).command, {
		name: "model",
		args: "gpt-5",
	});
	// A command with no argument hands on an EMPTY args, not the next line.
	assert.deepEqual(plan("\n/model\nplease check the logs", 6).command, {
		name: "model",
		args: "",
	});
	// And every plan that carries a command carries args with no newline in them,
	// checked structurally over the shapes that produce one at all.
	for (const [draft, caret] of [
		["/model gpt-5\nplease check the logs", 0],
		["/team ops fix this\nand then ship it", 4],
		["/model gpt-5", 12],
		["/team ops fix this", 18],
	]) {
		const result = plan(draft, caret);
		if ("command" in result) {
			assert.ok(
				!result.command.args.includes("\n"),
				`${JSON.stringify(draft)} handed on ${JSON.stringify(result.command)}`,
			);
		}
	}
});

test("staging is lossless: every non-whitespace character survives", () => {
	/*
	 * The risk the leading-line hoist creates: a draft the user meant as prose
	 * being claimed by a command word, or a claim dropping characters. Asserted
	 * over the start commands in both forms the spec's corpus names — the
	 * single-line `<word> <prose>` and the multi-line `<word> <name> <prose>` —
	 * for every caret, so no draft is dropped and nothing is eaten.
	 */
	for (const word of ["team", "agent", "goal", "loop", "btw", "fork"]) {
		for (const draft of [
			`/${word} fix the thing`,
			`/${word} ops fix the thing\nand then ship it`,
			`/${word}\nfix the thing`,
		]) {
			for (const caret of [0, 2, draft.indexOf("\n"), caretAtEnd(draft)]) {
				const result = plan(draft, caret);
				if (result.kind === "reassemble") {
					const staged = result.text.replace(/\s+/g, "");
					const typed = draft.replace(/\s+/g, "");
					assert.equal(
						staged,
						typed,
						`staging ${JSON.stringify(draft)} at ${caret} dropped characters: ${JSON.stringify(result.text)}`,
					);
				}
				if (result.kind === "whole") {
					// A whole-draft command accounts for the WHOLE draft: nothing is left
					// behind in the box and nothing was consumed silently.
					assert.equal(
						draft.trim(),
						reconstructionOf(result.command),
						`${JSON.stringify(draft)} at ${caret} claimed a draft it does not account for`,
					);
				}
				if (result.kind === "list-open") {
					// A list-open plan claims the leading LINE only — the roster owns the
					// key and the body below it is untouched, which is the same exception
					// the caret path has always carried.
					assert.equal(
						draft.split("\n")[0].trim(),
						reconstructionOf(result.command),
						`${JSON.stringify(draft)} at ${caret} claimed a draft it does not account for`,
					);
				}
			}
		}
	}
});

test("an older backend's vocabulary changes nothing (the additive field)", () => {
	/*
	 * The wire field is ADDITIVE, and this is where that is asserted rather than
	 * argued: every row of the table, run against both vocabularies, must produce
	 * the identical plan. A backend that predates `prefixes_text` sends no such
	 * key, the composer falls back to `consumes_prompt ∪ inlineArgumentFor`, and
	 * the user sees the same application.
	 */
	const drafts = [
		"/compact",
		"/model gpt-5",
		"/model gpt-5\nplease check the logs",
		"/theme dark\nand tell me what changed",
		"/compact hello",
		"/usage more prose",
		"/goal ship it",
		"/goal ship it\nand then tell me",
		"/team ops fix this\nand then ship it",
		"/team",
		"/team\nfix this",
		"/mcp logout seems to cause a crash on the TUI",
		"/tema",
		"fix this /usage",
		"hello\n/team ops",
		"/usage\nfix this",
	];
	for (const draft of drafts) {
		for (const caret of [0, 3, draft.indexOf("\n"), caretAtEnd(draft)]) {
			assert.deepEqual(
				legacyPlan(draft, caret),
				plan(draft, caret),
				`${JSON.stringify(draft)} at ${caret} differs between vocabularies`,
			);
		}
	}
	/*
	 * And the second input is consulted where it DECIDES something: a whole-draft
	 * word with trailing text is prose only when the wire says the command owns no
	 * text, which is the shaped branch. On the shape-less wire the vocabulary is not
	 * asked at all — `main`'s rule is — so the two rows below differ by the WIRE,
	 * not by the vocabulary, and that is what this pair asserts.
	 */
	assert.deepEqual(plan("/model gpt-5", 12, {}), {
		kind: "whole",
		command: { name: "model", args: "gpt-5" },
	});
});

test("the capabilities flag turns the planner off completely", () => {
	// Acceptance criterion 23: with the commands capability off, nothing is
	// spliced and the draft sends as prose — the same fallback the model path
	// already has.
	assert.deepEqual(plan("fix this /usage", 14, { enabled: false }), {
		kind: "send",
	});
	assert.deepEqual(plan("/usage", 6, { enabled: false }), { kind: "send" });
	assert.deepEqual(
		plan("/team ops fix this\nand more", 4, { enabled: false }),
		{
			kind: "send",
		},
	);
});

test("no branch consumes typed text without an outcome", () => {
	// Acceptance criterion 24, asserted structurally: every branch either hands
	// the whole line on, hands a line on AND reports what survives, or hands the
	// draft to the model. Nothing returns a plan that deletes text and says
	// nothing.
	for (const [draft, caret] of [
		["fix this /usage", 14],
		["/model gpt-5\nplease check the logs", 0],
		["fix this /team", 13],
		["/team ops fix this\nand then ship it", 4],
		["/usage", 6],
		["/compact hello", 14],
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

const SEPARATOR = /\s/;

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

const loopPlan = (draft, caret) =>
	planSlashSubmission({
		draft,
		caret,
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
	const staged = loopPlan(completion.text, completion.caret);
	assert.equal(staged.kind, "reassemble", JSON.stringify(staged));
	return { staged, next: loopPlan(staged.text, staged.caret) };
};

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
		/*
		 * A free-text command in the MIDDLE of a sentence is prose now, at every
		 * separator (spec rows 10/13): the operator's report, and the row that used
		 * to reassemble the sentence to the front.
		 */
		assert.deepEqual(
			plan(`ship it${separator}/team${separator}ops`, 11),
			{ kind: "send" },
			`prompt row mid-sentence, separator ${at}`,
		);
		/*
		 * What this case exists for is the SPLIT, and the split is unchanged: the
		 * word is recognised at `\s` rather than at a literal space. The observable
		 * form of that is the whole-draft row below — a separator the old
		 * `split(" ")` read as part of the NAME would leave `team\tops` unrecognised
		 * and route the draft through `unrecognised` instead of running it.
		 */
		assert.deepEqual(
			plan(`${separator}/team${separator}ops`, 12),
			{ kind: "whole", command: { name: "team", args: "ops" } },
			`whole-draft row, separator ${at}`,
		);
	}
	// The plain space is unchanged, which is exactly why nothing noticed the rest.
	assert.deepEqual(plan("prose /goal and more", 11), { kind: "send" });
});

/* The tokenizer's separator class, as the planner and the dispatcher read it;
   top-level because the lint rule that keeps regexes out of hot paths applies
   here too (the repo's `useTopLevelRegex`). */

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

test("a name-list command: the whole draft runs it, a body keeps its list open", () => {
	/*
	 * Spec row 12: a name-list command that IS the draft is the command — the
	 * operator's ruling, and what Enter over the pre-selected popup row has always
	 * meant. The exception below is the one #233 carries and the spec's §1.3
	 * excludes from the draft-opening hoist: the name is picked from the list
	 * first, and leaving that list open IS the interaction
	 * (`editor.py:8219-8222`), which is why the plan carries the command so a
	 * caller whose list cannot answer can still say which command is waiting
	 * (round 1 UX U5).
	 */
	assert.deepEqual(plan("/team", 5), {
		kind: "whole",
		command: { name: "team", args: "" },
	});
	assert.deepEqual(plan("/agent", 6), {
		kind: "whole",
		command: { name: "agent", args: "" },
	});
	// The word OPENS a longer draft with no name typed: list-open, not a
	// reassembly — the body is not this command's argument until a name is
	// chosen, and the roster list is what the word put on screen.
	assert.deepEqual(plan("/team\nand then ship it", 5), {
		kind: "list-open",
		command: { name: "team", args: "" },
	});
	/*
	 * Mid-sentence it is prose (rows 10, 11 and 13): the rule this replaces
	 * reassembled `fix this /team ops` to the front and took `list-open` on
	 * `fix this /team`, and moving a sentence the user is still writing is the
	 * quiet text movement the operator reported.
	 */
	assert.deepEqual(plan("fix this /team ops", 17), { kind: "send" });
	assert.deepEqual(plan("fix this /teams", 14), { kind: "send" });
});

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
	/*
	 * And with no vocabulary to arm it, a `/goal` in a sentence is STILL prose:
	 * the submission planner sends it as written (spec rows 10/13), so the absent
	 * destination row cannot turn a sentence into a command through the old
	 * implicit hoist. Only the PICK path changes shape when the vocabulary is
	 * empty (`planSlashArming` above), which is the window this pins.
	 */
	assert.equal(
		planSlashSubmission({
			draft: "I approve spend /goal",
			caret: 21,
			commandNames: COMMAND_NAMES,
			promptCommands: PROMPT_COMMANDS,
			prefixingCommands: PREFIXES_TEXT,
			nameListCommands: NAME_LIST_COMMANDS,
			enabled: true,
			...arms,
		}).kind,
		"send",
	);
});

test("a reassembled line runs on the next Enter, whatever shape the draft had", () => {
	/*
	 * The invariant, on the writer the rule now reserves for a draft-OPENING
	 * free-text command (spec row 5): the staged line is the WHOLE DRAFT and it is
	 * ONE LINE. A staged line that still carried a surviving newline would leave
	 * the rest of the draft outside the command's span (`slashTokenSpan` claims
	 * the caret's own LINE) and the next Enter would answer `send`: the user would
	 * have spent the keystroke, read a note saying the command would run, and the
	 * literal `/loop …` would have gone to the model as prompt text.
	 */
	/*
	 * The shapes that still stage through the completion's own write: the word
	 * opens the draft and the body survives the rewrite (a draft whose whole text
	 * the completion collapses onto one line arrives as `whole` instead, which is
	 * the arming case above).
	 */
	const single = stagedByEnter(
		"/loop please fix the flaky test\nand then run",
		5,
	);
	assert.deepEqual(
		single.staged.text,
		"/loop please fix the flaky test and then run",
	);
	assert.deepEqual(single.next, {
		kind: "whole",
		command: { name: "loop", args: "please fix the flaky test and then run" },
	});

	const two = stagedByEnter(
		"/loop please summarise the failing tests\nnote which are flaky and then stop",
		5,
	);
	assert.deepEqual(
		two.staged.text,
		"/loop please summarise the failing tests note which are flaky and then stop",
	);
	assert.deepEqual(two.next, {
		kind: "whole",
		command: {
			name: "loop",
			args: "please summarise the failing tests note which are flaky and then stop",
		},
	});

	// Every staged line is a single line with the caret at its end: the two facts
	// the next Enter's plan depends on, on this writer as on the arming's.
	for (const { staged, next } of [single, two]) {
		assert.equal(
			staged.text.includes("\n"),
			false,
			JSON.stringify(staged.text),
		);
		assert.equal(staged.caret, staged.text.length);
		assert.equal(next.kind, "whole", JSON.stringify(next));
	}

	/*
	 * And the shapes this case used to drive — prose BEFORE the word, or the
	 * command on a line of its own below it — are prose now (spec rows 10, 11 and
	 * 13): the old writer moved the user's sentence to the front of his own
	 * command line, which is the text movement the operator reported. Asserted
	 * `send` here rather than deleted, so a future change that re-introduces the
	 * hoist fails on the rule it contradicts instead of quietly staging again.
	 */
	assert.deepEqual(loopPlan("please run /loop", 16), { kind: "send" });
	assert.deepEqual(loopPlan("Please fix the flaky test\nand run /loop", 35), {
		kind: "send",
	});
});

test("the wire's argument shapes decide what a whole draft is, and the vocabulary is the fallback", () => {
	/*
	 * The operator's single-line case is the reason this field exists: `/mcp
	 * logout` is a command and `/mcp logout seems to cause a crash` is a message,
	 * and "the command owns trailing text" cannot tell them apart. The backend
	 * refuses exactly the whole-draft texts that are VALID under the shape, so the
	 * composer reads the same field — a whole-draft text the desktop runs is one
	 * the endpoint refuses, and planning a valid command as prose would hand the
	 * endpoint a text it refuses (the permanent-refusal class).
	 */

	// A subcommand with its name: the command.
	assert.deepEqual(plan("/mcp logout", 11, SHAPED).command, {
		name: "mcp",
		args: "logout",
	});
	// The operator's draft: the same word, text that is not that shape's argument.
	assert.deepEqual(plan("/mcp logout seems to cause a crash", 37, SHAPED), {
		kind: "send",
	});
	// A selector token, and text that is not one.
	assert.equal(plan("/usage on", 9, SHAPED).kind, "whole");
	assert.deepEqual(plan("/usage more prose", 17, SHAPED), { kind: "send" });
	// A provider this install knows, and one it does not.
	assert.equal(plan("/login openai", 12, SHAPED).kind, "whole");
	assert.deepEqual(plan("/login zzz", 10, SHAPED), { kind: "send" });
	/*
	 * And the precedence, on the wire shape those words really carry: a free-text
	 * command's whole-draft form is a command with ANY text after it, whatever
	 * `argument_shape` says, because its vocabulary is what the endpoint's
	 * admission rule reads.
	 */
	for (const [draft, command] of [
		["/team ops fix this", { name: "team", args: "ops fix this" }],
		["/goal ship it", { name: "goal", args: "ship it" }],
		["/loop keep going", { name: "loop", args: "keep going" }],
		["/btw aside", { name: "btw", args: "aside" }],
		["/fork do it", { name: "fork", args: "do it" }],
		["/agent do a thing", { name: "agent", args: "do a thing" }],
		["/team ops", { name: "team", args: "ops" }],
	]) {
		const result = plan(draft, draft.length, SHAPED);
		assert.equal(result.kind, "whole", `${draft} must stay a command`);
		assert.deepEqual(result.command, command, draft);
	}

	// A form field that takes arbitrary text.
	assert.equal(plan("/rename my thing", 15, SHAPED).kind, "whole");
	// And a command that takes nothing keeps eating nothing.
	assert.deepEqual(plan("/compact hello", 14, SHAPED), { kind: "send" });
	assert.equal(plan("/compact", 8, SHAPED).kind, "whole");

	/*
	 * THE RELEASED BACKEND'S SPELLING: no `argument_shape` anywhere. That is the
	 * pairing the app installs today (`features.commands: 1`, no shape fields on
	 * any row), and on it the planner reproduces `main` EXACTLY: a whole-draft
	 * command word with trailing text is a command, full stop.
	 *
	 * Twice this branch tried to answer the pairing from a half-vocabulary and was
	 * wrong twice, measured: reading `arguments: none` for every row stopped
	 * `/mcp logout`, `/login openai`, `/rename <title>` and `/move <path>` from
	 * running at all (QA round 1 Q1, base vs head on the wire), and reading
	 * `arguments: optional` as "owns text" still sent `/usage on` to the messages
	 * endpoint, where the released blanket policy refuses it (QA round 2 Q1, UX
	 * round 2 U1). The distinction the prose rule needs — a selector token here, a
	 * message there — is not in the wire, so the composer stops guessing rather
	 * than inventing a third vocabulary for it. The cost is stated in the PR, and
	 * the operator's rule arrives with the release that publishes the shapes.
	 */
	const released = {};

	for (const [draft, command] of [
		["/mcp logout", { name: "mcp", args: "logout" }],
		["/login openai", { name: "login", args: "openai" }],
		["/rename my title", { name: "rename", args: "my title" }],
		["/move ~/x", { name: "move", args: "~/x" }],
		["/fast on", { name: "fast", args: "on" }],
		["/usage on", { name: "usage", args: "on" }],
		// And the two the prose rule narrows on a SHAPED wire stay commands here,
		// which is what `main` does with them.
		["/compact hello", { name: "compact", args: "hello" }],
		["/usage more prose", { name: "usage", args: "more prose" }],
	]) {
		const result = plan(draft, draft.length, released);
		assert.equal(
			result.kind,
			"whole",
			`${draft} must be a command, as on main`,
		);
		assert.deepEqual(result.command, command, draft);
	}
	assert.deepEqual(
		plan("/mcp logout seems to cause a crash on the TUI", 41, released).kind,
		"whole",
		"a single-line draft is a whole-draft command on this wire, as on main",
	);

	/*
	 * AND THE HOIST ASKS THE BOOLEANS ALONE (`prompt ∪ value`), on both wires. A
	 * shape-less backend gets no hoist at all for a word the booleans do not carry,
	 * because `main` never hoisted one: a multi-line draft that merely opens with a
	 * command word is the operator's report in its multi-line form, and staging it
	 * as a command would be a regression introduced by the fallback rather than by
	 * the rule. The row below is the proof — `mcp` is not a prompt command — and the
	 * second one shows the hoist still working for a word that IS.
	 */
	assert.deepEqual(
		plan(
			"/mcp logout seems to cause a crash on the TUI,\ncan you review and fix it",
			70,
			released,
		),
		{ kind: "send" },
		"the coarse source must not hoist an opening line into a command",
	);
	// While a START command — carried by the booleans — still stages from its
	// leading line on that same backend.
	assert.equal(
		plan("/team ops fix this\nand then ship it", 35, released).kind,
		"reassemble",
	);

	/*
	 * The shapes are a THIRD source, never the first: a free-text command whose
	 * row also publishes a shape is still a command with any text, so the §1.3
	 * repair has to be reachable on the wire spelling this fixture ships.
	 */
	for (const caret of [0, 4, 12, 35]) {
		const planForCarets = plan(
			"/team ops fix this\nand then ship it",
			caret,
			SHAPED,
		);
		assert.equal(
			planForCarets.kind,
			"reassemble",
			`the opening line stages from any caret (caret ${caret})`,
		);
	}

	// A row that publishes no shape is LEFT OUT rather than defaulted: absence is
	// "an older backend", and a defaulted `any` would make every one of its rows
	// accept arbitrary text.
	assert.equal(
		argumentShapeVocabulary([{ name: "unshaped", aliases: [] }]).has(
			"unshaped",
		),
		false,
		"a row without `argument_shape` must not appear in the wire shapes",
	);

	/*
	 * PINNED, because it is the one pairing where this planner and the backend's
	 * admission rule can disagree: a whole-draft `/goal ship it` is a COMMAND (the
	 * endpoint refuses it, so a `send` plan would be the permanent-refusal class),
	 * while a draft that merely CONTAINS `/goal` — mid-sentence, or opening a
	 * multi-line body — stays prose under #209's armedOnly rule, which nothing but
	 * an explicit pick may hoist.
	 */
	assert.deepEqual(plan("/goal ship it", 13, SHAPED).command, {
		name: "goal",
		args: "ship it",
	});
	assert.deepEqual(plan("please /goal ship it", 20, SHAPED), { kind: "send" });
	assert.deepEqual(plan("/goal\nship the release", 5, SHAPED), {
		kind: "send",
	});

	/*
	 * And the OTHER wire, pinned here because it is the branch that decides what the
	 * operator's app does today: with no shapes published, the planner reproduces
	 * `main` — a whole-draft command word with trailing text is a command — so the
	 * two rows the prose rule narrows on a shaped wire are commands on this one.
	 * The pairing is the contract; see the "both wires" test below for the matrix.
	 */
	assert.deepEqual(plan("/rename my thing", 15, {}), {
		kind: "whole",
		command: { name: "rename", args: "my thing" },
	});
	assert.deepEqual(plan("/compact hello", 14, {}), {
		kind: "whole",
		command: { name: "compact", args: "hello" },
	});
});

/*
 * COMMAND-LOCKED WORDS, and the security reason they are exempt from the prose
 * rule (round 6).
 *
 * `/credential`'s argument is a SECRET. The dispatcher strips it before building
 * command text for exactly that reason (`slash-dispatch.ts:523-525`), and the
 * desktop's own suite asserts the property after an Escape and an edit that moves
 * the token: "the moved token dispatched as the command again ... the arguments are
 * stripped so a secret can never land in command text, and no message carries the
 * token" (`scripts/credential-composer.test.mjs`, the moved-token case). Under the
 * prose rule the mid-draft token was answered `send` — a MESSAGE — which would have
 * posted the secret to the model and left the dispatcher with nothing to strip.
 *
 * The exemption is the CALLER's set, never a name written in the planner, and it is
 * asserted in both directions here so the rule the operator asked for stays intact
 * for every other word.
 */
test("a command-locked word dispatches wherever its token sits", () => {
	const locked = {
		commandLockedWords: new Set(["credential", "cred"]),
		// Visible to the planner at all, which is the caller's other half: a word no
		// vocabulary carries is `unrecognised`/`send` whatever else is said about it.
		commandNames: new Set([...COMMAND_NAMES, "credential", "cred"]),
	};
	const draft = "please /credential SECRET";
	const spliced = plan(draft, draft.length, locked);
	assert.equal(spliced.kind, "splice", draft);
	assert.deepEqual(spliced.command, { name: "credential", args: "SECRET" });
	// The token leaves the draft, so nothing carries it into a message.
	assert.equal(spliced.text, "please");
	// The SAME draft with no locked words is the sentence the operator wrote.
	assert.deepEqual(
		plan(draft, draft.length, {
			commandNames: new Set([...COMMAND_NAMES, "credential", "cred"]),
		}),
		{ kind: "send" },
	);
	// A whole-draft token is a command on either vocabulary, unchanged.
	assert.equal(plan("/credential SECRET", 18, locked).kind, "whole");
	assert.equal(
		plan("/credential SECRET", 18, {
			commandNames: new Set([...COMMAND_NAMES, "credential", "cred"]),
		}).kind,
		"whole",
	);
	// The alias is a word of its own, from the same set.
	assert.equal(plan("see /cred x", 11, locked).kind, "splice");
});

test("the composer passes the capture's own words to the planner", () => {
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);
	assert.match(
		composer,
		/commandLockedWords: CREDENTIAL_WORD_SET/,
		"the composer must hand the planner the capture's words",
	);
	assert.match(
		composer,
		/const CREDENTIAL_WORD_SET: ReadonlySet<string> = new Set\(CREDENTIAL_WORDS\)/,
		"and build them from the module that owns the token",
	);
	const capture = readFileSync(
		"src/renderer/src/features/chat/components/credential-capture.ts",
		"utf8",
	);
	assert.match(
		capture,
		/export const CREDENTIAL_WORDS: readonly string\[\] = \["credential", "cred"\]/,
		"one vocabulary: the token's own regex is built from these words",
	);
});
