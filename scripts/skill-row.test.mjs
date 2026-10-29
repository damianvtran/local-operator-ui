import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE READ HALF OF THE `$skill` CONTRACT: a persisted payload, turned back into
 * the row a reader should see (`skill-row.ts`).
 *
 * The payloads below are LITERALS of the shape `invoke.py:render_invocation`
 * writes and the desktop's port reproduces byte for byte — the header sentence,
 * the attribute-carrying tag, the SKILL.md file verbatim, the closing tag and
 * the request — rather than strings recomputed from the code under test, because
 * an expectation derived from the implementation pins nothing (the convention
 * `scripts/skill-invocation.test.mjs` states for the write half). What the
 * payload DOES contain is the interesting half of this suite: the resolver hands
 * back the file verbatim, so the body carries its YAML front matter, and the
 * header line's purpose is read out of that.
 *
 * The last case here is the one that proves the two halves meet: whatever
 * `renderSkillInvocation` writes, `skillRowOf` reads back as the line it was
 * built from. A port that drifted on either side fails that and nothing else.
 */

const bundle = await build({
	stdin: {
		contents: `
			export { editDraftOf, editTextOf, displayTextOf, skillOf, skillRowOf } from "./src/renderer/src/features/chat/canonical/skill-row";
			export { escapeSkillAttribute, renderSkillInvocation, typedLineOf, unescapeSkillAttribute } from "./src/renderer/src/features/chat/components/skill-invocation";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const bundlePath = new URL(`./_skill-row-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	editDraftOf,
	editTextOf,
	displayTextOf,
	skillOf,
	skillRowOf,
	escapeSkillAttribute,
	renderSkillInvocation,
	typedLineOf,
	unescapeSkillAttribute,
} = await import(bundlePath.href);
await unlink(bundlePath);

const HEADER =
	"The user invoked the `seal-demo` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.";

/** A SKILL.md as the resolver returns it: the file verbatim, front matter and all. */
const SKILL_FILE = `---
name: seal-demo
description: Review a diff for the seal demo
---

# Seal demo

Answer with one line.
`;

/** The payload the composer sends for `$seal-demo review the diff`. */
const PAYLOAD = [
	HEADER,
	'<skill name="seal-demo" invocation="$seal-demo review the diff">',
	`${SKILL_FILE}</skill>`,
	"review the diff",
].join("\n");

test("a payload is read back as the seal and the request that follows it", () => {
	assert.deepEqual(skillRowOf(PAYLOAD), {
		text: "$seal-demo review the diff",
		skill: {
			name: "seal-demo",
			token: "$seal-demo",
			request: "review the diff",
			purpose: "Review a diff for the seal demo",
			body: "# Seal demo\n\nAnswer with one line.",
		},
	});
});

test("a bare `$name` is a header with an empty request", () => {
	const payload = [
		HEADER,
		'<skill name="seal-demo" invocation="$seal-demo">',
		`${SKILL_FILE}</skill>`,
	].join("\n");
	assert.deepEqual(skillRowOf(payload), {
		text: "$seal-demo",
		skill: {
			name: "seal-demo",
			token: "$seal-demo",
			request: "",
			purpose: "Review a diff for the seal demo",
			body: "# Seal demo\n\nAnswer with one line.",
		},
	});
});

test("a quoted send keeps its reply markup in the row's own text", () => {
	/*
	 * `buildSendPayload` prefixes the markup, so the payload a quoted send
	 * persists begins with it (`utils/reply-utils.ts`). `text` has to carry it
	 * back: `parseReplies` strips it for the row, and a re-send of the row's own
	 * text has to assemble the same string the composer would.
	 */
	const reply = "<reply-to>the answer above</reply-to>";
	const row = skillRowOf(`${reply}\n${PAYLOAD}`);
	assert.equal(row.text, `${reply}\n$seal-demo review the diff`);
	assert.equal(row.skill.request, "review the diff");
	// And the quote run itself is not read as part of the payload.
	assert.equal(skillRowOf(reply), null);
});

test("a description is folded to one line, whatever shape the author wrote", () => {
	const withDescription = (frontMatter) =>
		[
			HEADER,
			'<skill name="seal-demo" invocation="$seal-demo">',
			`---\nname: seal-demo\n${frontMatter}---\n\n# Seal demo\n</skill>`,
		].join("\n");

	// A FOLDED block scalar, which is how the shipped skills write a long one:
	// the indented continuation lines join with single spaces, YAML's own
	// folding. This is the shape that must NOT cost the row its purpose.
	assert.equal(
		skillRowOf(
			withDescription(
				"description: >-\n  Review a diff for the seal\n  demo\n",
			),
		).skill.purpose,
		"Review a diff for the seal demo",
	);
	// The bare form, and a blank line inside the block (a paragraph break in
	// YAML): both fold to the same one line.
	assert.equal(
		skillRowOf(
			withDescription(
				"description: >\n  Review a diff\n\n  for the seal demo\n",
			),
		).skill.purpose,
		"Review a diff for the seal demo",
	);
	// A LITERAL block is flattened too: a caption is one line, and the author's
	// own line breaks are in the body one press away.
	assert.equal(
		skillRowOf(
			withDescription(
				"description: |-\n  Review a diff\n  for the seal demo\n",
			),
		).skill.purpose,
		"Review a diff for the seal demo",
	);
	assert.equal(
		skillRowOf(withDescription("description: |\n  Review a diff\n")).skill
			.purpose,
		"Review a diff",
	);
	// A plain scalar carried on by an indented line is the same value.
	assert.equal(
		skillRowOf(
			withDescription("description: Review a diff\n  for the seal demo\n"),
		).skill.purpose,
		"Review a diff for the seal demo",
	);
	// One line, plain or quoted either way; the quotes are YAML's punctuation.
	assert.equal(
		skillRowOf(withDescription("description: Review a diff\n")).skill.purpose,
		"Review a diff",
	);
	assert.equal(
		skillRowOf(withDescription('description: "Review a diff"\n')).skill.purpose,
		"Review a diff",
	);
	assert.equal(
		skillRowOf(withDescription("description: 'Review a diff'\n")).skill.purpose,
		"Review a diff",
	);
	// A quoted scalar whose closing quote arrives on the NEXT line is one value,
	// and the quotes come off the folded result.
	assert.equal(
		skillRowOf(
			withDescription('description: "Review a diff\n  for the seal demo"\n'),
		).skill.purpose,
		"Review a diff for the seal demo",
	);
	// A quote that never closes is unparseable: the row falls back to the name
	// rather than showing half a sentence.
	assert.equal(
		skillRowOf(withDescription('description: "Review a diff\n')).skill.purpose,
		null,
	);
	// Absent and present-but-empty are the same answer, and the next key's lines
	// are never folded into the value.
	assert.equal(skillRowOf(withDescription("")).skill.purpose, null);
	assert.equal(
		skillRowOf(withDescription("description:\n")).skill.purpose,
		null,
	);
	assert.equal(
		skillRowOf(
			withDescription("description: >-\n  Review a diff\nname: seal-demo\n"),
		).skill.purpose,
		"Review a diff",
	);
	assert.equal(
		skillRowOf(
			withDescription("name: other\ndescription: >-\n  Review a diff\n"),
		).skill.purpose,
		"Review a diff",
	);
});

test("a body with no front matter is its own body, and carries no purpose", () => {
	const payload = [
		HEADER,
		'<skill name="seal-demo" invocation="$seal-demo">',
		"# Seal demo\n\nAnswer with one line.\n</skill>",
	].join("\n");
	assert.deepEqual(skillRowOf(payload).skill, {
		name: "seal-demo",
		token: "$seal-demo",
		request: "",
		purpose: null,
		body: "# Seal demo\n\nAnswer with one line.",
	});
	// An UNTERMINATED `---` is prose that opens with three dashes, not front
	// matter: the resolver returns the file verbatim, so swallowing the rest of
	// it would hide the whole body.
	const unterminated = [
		HEADER,
		'<skill name="seal-demo" invocation="$seal-demo">',
		"---\nname: seal-demo\n# Seal demo\n</skill>",
	].join("\n");
	assert.equal(skillRowOf(unterminated).skill.body.startsWith("---"), true);
});

test("a request that contains the closing tag does not shorten the body", () => {
	const payload = [
		HEADER,
		'<skill name="seal-demo" invocation="$seal-demo mention </skill>">',
		`${SKILL_FILE}</skill>`,
		"quote </skill> in your answer",
	].join("\n");
	const row = skillRowOf(payload);
	assert.equal(row.skill.body, "# Seal demo\n\nAnswer with one line.");
	assert.equal(row.skill.request, "quote </skill> in your answer");
	// The typed line is escaped in the attribute and unescaped here, so the row
	// shows the words the user typed.
	assert.equal(row.text, "$seal-demo mention </skill>");
});

test("a body containing the closing tag cuts there — the format's own limit", () => {
	/*
	 * The `<skill>` block is not escapable, so the body ends at the FIRST close —
	 * the same limit `utils/reply-utils.ts` documents for a quoted body containing
	 * `</reply-to>`. Pinned as that rather than papered over: a scan that guessed
	 * a second tag would read a "body" out of the request.
	 */
	const payload = [
		HEADER,
		'<skill name="seal-demo" invocation="$seal-demo">',
		"# Seal demo\n</skill>\nAnswer with one line.\n</skill>",
	].join("\n");
	const row = skillRowOf(payload);
	assert.equal(row.skill.body, "# Seal demo");
	assert.equal(row.skill.request, "Answer with one line.\n</skill>");
});

test("prose that quotes the tag is not an invocation", () => {
	assert.equal(
		skillRowOf('the payload opens with <skill name="seal-demo"> and a body'),
		null,
	);
	assert.equal(
		skillRowOf('we write <skill name="x" invocation="y"> by hand'),
		null,
	);
	// A tag with no close has no body this read can describe.
	assert.equal(skillRowOf('<skill name="x" invocation="y">a body'), null);
	// Ordinary messages, reply markup included, are not payloads either.
	assert.equal(skillRowOf("$seal-demo review the diff"), null);
	assert.equal(skillRowOf("<reply-to>x</reply-to>\nplain words"), null);
	assert.equal(skillRowOf(""), null);
	assert.equal(skillOf("plain words"), undefined);
});

test("what the write half renders is what this read half reads", () => {
	/*
	 * The round trip, over the shapes that stress it: escaping in the attribute
	 * (`&`, `"`, `<`, `>` and a newline), a bare token, and a request that is
	 * several lines long.
	 */
	const vectors = [
		{
			typed: '$seal-demo fix & <retry> the "diff"',
			request: 'fix & <retry> the "diff"',
		},
		{ typed: "$seal-demo", request: "" },
		{ typed: "$seal-demo line one\nline two", request: "line one\nline two" },
	];
	for (const vector of vectors) {
		const payload = renderSkillInvocation(
			{
				name: "seal-demo",
				request: vector.request,
				token: "$seal-demo",
				typed: vector.typed,
			},
			SKILL_FILE,
		);
		const row = skillRowOf(payload);
		assert.equal(row.text, vector.typed, vector.typed);
		assert.equal(row.skill.request, vector.request, vector.typed);
		assert.equal(row.skill.purpose, "Review a diff for the seal demo");
		assert.equal(row.skill.body, "# Seal demo\n\nAnswer with one line.");
		// The function the payload's own reader uses, over the same string.
		assert.equal(typedLineOf(payload), vector.typed);
	}
});

test("what the scene's fixture stores is what the writer produces", async () => {
	/*
	 * The `skill-seal` scene photographs a seeded journal, and the fixture that
	 * writes it pins the payloads as literals (a fixture recomputed at read time
	 * would pin nothing). This is the other half of that claim: the app's own
	 * writer, over the same two SKILL.md files, produces exactly those bytes -- so
	 * a drifted writer fails HERE rather than photographing a format that no
	 * longer ships, which is the failure mode `imagegen-card-fixture.mjs` records
	 * for its own journal rows.
	 */
	const fixture = await import("./skill-seal-fixture.mjs");
	const vectors = [
		{
			name: "seal-demo",
			skill: fixture.SEAL_DEMO_SKILL,
			payload: fixture.SEAL_DEMO_PAYLOAD,
			request: "review the diff",
			token: "$seal-demo",
		},
		{
			name: "seal-audit",
			skill: fixture.SEAL_AUDIT_SKILL,
			payload: fixture.SEAL_AUDIT_PAYLOAD,
			request: "audit this branch",
			token: "$seal-audit",
		},
	];
	for (const vector of vectors) {
		const typed = `${vector.token} ${vector.request}`;
		assert.equal(
			renderSkillInvocation(
				{
					name: vector.name,
					request: vector.request,
					token: vector.token,
					typed,
				},
				vector.skill,
			),
			vector.payload,
			vector.name,
		);
		// And the row the scene reads off it: the typed line, and the request.
		const row = skillRowOf(vector.payload);
		assert.equal(row.text, typed, vector.name);
		assert.equal(row.skill.request, vector.request, vector.name);
	}
	// The fixture's first description is a FOLDED block scalar, so this is D3' in
	// one assertion: it reaches the row as ONE line rather than as nothing.
	assert.equal(
		skillRowOf(fixture.SEAL_DEMO_PAYLOAD).skill.purpose,
		"Review a diff for the seal demo and say what breaks",
	);
	// And the second is long enough to clip on a row, so the truncation frame is a
	// real case rather than a hoped-for one.
	assert.equal(
		skillRowOf(fixture.SEAL_AUDIT_PAYLOAD).skill.purpose.length > 120,
		true,
	);
});

test("a message that QUOTES a whole tag is not an invocation", () => {
	/*
	 * THE GATE IS THE PAYLOAD'S OWN SHAPE, not its tag: a message can carry a
	 * whole `<skill name=... invocation=...>` run without being one of these, and
	 * three rows in this machine's own store do -- agent briefings that describe
	 * this wire format (QA round 1, Q1: 18-20k characters each). Sealing one would
	 * paint `$seal-demo` and a slice of the tail and hide the briefing itself, which on
	 * this surface is unrecoverable: a sealed row draws the typed line, the
	 * request and the body, and nothing else.
	 */
	const prose =
		'Heads up: the format is <skill name="x" invocation="$seal-demo do it"> body </skill> then the request. Thoughts?';
	assert.equal(skillRowOf(prose), null);
	// The same prose inside a quoted run, which is how a reply to such a message
	// arrives: the markup is stripped and what follows is still prose.
	assert.equal(
		skillRowOf(`<reply-to>${prose}</reply-to>\nwhy does it do that?`),
		null,
	);
	// A stack of quoted runs over prose is the same answer.
	assert.equal(
		skillRowOf(
			`<reply-to>a</reply-to>\n<reply-to>${prose}</reply-to>\nand then?`,
		),
		null,
	);
	// The header sentence alone is prose, and a header whose name is not the
	// tag's is a message ABOUT a payload rather than one.
	assert.equal(
		skillRowOf("The user invoked the `x` skill directly. Follow it."),
		null,
	);
	assert.equal(
		skillRowOf(
			[
				"The user invoked the `x` skill directly. Follow it.",
				'<skill name="y" invocation="$seal-demo go">',
				"body\n</skill>",
			].join("\n"),
		),
		null,
	);
	// A tag BEFORE the header sentence is not the payload's shape either.
	assert.equal(
		skillRowOf(
			[
				'<skill name="x" invocation="$seal-demo go">',
				"body\n</skill>",
				"The user invoked the `x` skill directly. Follow it.",
			].join("\n"),
		),
		null,
	);
});

test("a YAML scalar's own punctuation is not painted", () => {
	const withDescription = (frontMatter) =>
		[
			HEADER,
			'<skill name="seal-demo" invocation="$seal-demo">',
			`---\nname: seal-demo\n${frontMatter}---\n\n# Seal demo\n</skill>`,
		].join("\n");
	const purposeOf = (frontMatter) =>
		skillRowOf(withDescription(frontMatter)).skill.purpose;

	// Single-quoted: YAML escapes a quote by DOUBLING it, and has no backslashes.
	assert.equal(purposeOf("description: 'it''s fine'\n"), "it's fine");
	// Double-quoted: `\"` and `\\` are the two escapes a caption plausibly
	// carries, and they come off.
	assert.equal(purposeOf('description: "say \\"hi\\" now"\n'), 'say "hi" now');
	assert.equal(purposeOf('description: "a \\\\ b"\n'), "a \\ b");
	// A plain scalar's inline comment is not part of the value...
	assert.equal(
		purposeOf("description: Does a thing # not this\n"),
		"Does a thing",
	);
	// ...while inside a block scalar a `#` is content, and a `#` with no space in
	// front of it is not a comment anywhere.
	assert.equal(
		purposeOf("description: >-\n  Does a thing\n  # not this\n"),
		"Does a thing # not this",
	);
	assert.equal(purposeOf("description: issue#42\n"), "issue#42");
	// The two shapes that were already right stay right.
	assert.equal(purposeOf("description: Review a diff\n"), "Review a diff");
	assert.equal(purposeOf('description: "Review a diff"\n'), "Review a diff");
});

test("the YAML shapes round 2 found: modifier order, comments, CRLF, last key", () => {
	const withFile = (skillFile) =>
		[
			HEADER,
			'<skill name="seal-demo" invocation="$seal-demo">',
			`${skillFile}\n</skill>`,
		].join("\n");
	const purposeOfFile = (skillFile) =>
		skillRowOf(withFile(skillFile)).skill.purpose;

	/*
	 * A block scalar's indent digit may PRECEDE the chomping sign (agent review
	 * round 2, MINOR-1; QA round 2, Q5): YAML reads `|2-` as a block scalar, and
	 * the first spelling of the pattern let it fall through to the plain branch,
	 * which painted the indicator into the caption.
	 */
	assert.equal(
		purposeOfFile("---\nname: seal-demo\ndescription: |2-\n  a b\n---\n"),
		"a b",
	);
	assert.equal(
		purposeOfFile("---\nname: seal-demo\ndescription: |-2\n  a b\n---\n"),
		"a b",
	);
	// An indicator may carry a comment, and the value is still the block below it.
	assert.equal(
		purposeOfFile(
			"---\nname: seal-demo\ndescription: >- # a note\n  one two\n---\n",
		),
		"one two",
	);
	// A comment may follow a QUOTED value too (agent review round 2, MINOR-4):
	// the closing quote is found rather than tested for at the end.
	assert.equal(
		purposeOfFile('---\nname: seal-demo\ndescription: "abc" # note\n---\n'),
		"abc",
	);
	assert.equal(
		purposeOfFile("---\nname: seal-demo\ndescription: 'abc' # note\n---\n"),
		"abc",
	);
	// CRLF line endings, through the whole front matter (agent review round 2,
	// MINOR-3).
	assert.equal(
		purposeOfFile(
			"---\r\nname: seal-demo\r\ndescription: >-\r\n  one\r\n  two\r\n---\r\n",
		),
		"one two",
	);
	// A `description:` as the LAST key, with no newline after it.
	assert.equal(
		purposeOfFile("---\nname: seal-demo\ndescription: Last one\n---"),
		"Last one",
	);
});

test("Edit hands the composer the typed line and the quote as a chip", () => {
	/*
	 * The Edit half of the change (agent review round 1, MINOR-4; UX round 1,
	 * U1). `chat-page.tsx` calls `editDraftOf` for the undelivered row's Edit and
	 * compares the composer's text against `editTextOf` for `retryDisabled`, so the
	 * shapes below are the ones the call site can meet.
	 */
	assert.equal(editTextOf(PAYLOAD), "$seal-demo review the diff");
	/*
	 * U1: a QUOTED skill send comes home as TWO pieces. The box gets the line --
	 * markup in the box was submitted literally, so the first token stopped being
	 * `$name` and the skill was silently not applied, with the instructions never
	 * reaching the model -- and the quote rides the composer's own chip path, which
	 * re-assembles the same payload on send.
	 */
	const reply = "<reply-to>the answer above</reply-to>";
	const draft = editDraftOf(`${reply}\n${PAYLOAD}`);
	assert.equal(draft.text, "$seal-demo review the diff");
	assert.equal(draft.replies.length, 1);
	assert.equal(draft.replies[0].text, "the answer above");
	assert.equal(
		editTextOf(`${reply}\n${PAYLOAD}`),
		"$seal-demo review the diff",
	);
	// Everything else comes back verbatim -- an ordinary message, prose that
	// merely quotes a tag (which `skillRowOf` declines), and a plain quoted
	// message, which keeps the markup-in-the-box shape it had before this row
	// existed.
	assert.equal(editDraftOf("plain words"), null);
	assert.equal(editTextOf("plain words"), "plain words");
	const prose =
		'the format is <skill name="x" invocation="$seal-demo do it"> body </skill> then the request';
	assert.equal(editTextOf(prose), prose);
	assert.equal(editTextOf(`${reply}\nplain words`), `${reply}\nplain words`);
});

test("the new block shape paints as the typed line and edits back to it", () => {
	const block = [
		"<operator-skills>",
		"",
		"The user invoked the following skills directly. Follow them for this request. Their reference files, if any, are listed at the end of each body and are read with `skill://<name>/<path>`.",
		"",
		'<skill name="seal-demo">',
		"# Seal demo",
		"",
		"Answer with one line.",
		"</skill>",
		"",
		"</operator-skills>",
	].join("\n");
	const typed = "$seal-demo review the diff";
	const payload = `${typed}\n\n${block}`;
	assert.equal(displayTextOf(payload), typed);
	assert.equal(editTextOf(payload), typed);
	const draft = editDraftOf(payload);
	assert.equal(draft.text, typed);
	assert.deepEqual(draft.replies, []);
	// A message may carry several skills, so there is no single seal to name.
	assert.equal(skillOf(payload), undefined);
	// Ordinary text is byte-identical, whitespace included.
	assert.equal(displayTextOf("  keep my spaces  "), "  keep my spaces  ");
	// A quoted new-shape send: the row keeps the prefix (parseReplies splits it)
	// and Edit hands the box the typed line alone.
	const reply = "<reply-to>the answer above</reply-to>";
	const quoted = editDraftOf(`${reply}\n${payload}`);
	assert.equal(quoted.text, typed);
	assert.equal(quoted.replies.length, 1);
});

test("escape and unescape are inverses, and unescape undoes the entities once", () => {
	const raw = 'a & b "c" <d> e\nf &#10; g &amp; h';
	const escaped = escapeSkillAttribute(raw);
	assert.equal(escaped.includes("&amp;"), true);
	assert.equal(unescapeSkillAttribute(escaped), raw);
	// An already-escaped `&` is not unescaped twice (`&amp;lt;` is the literal
	// text `&lt;`, not `<`) — the reason `&amp;` is undone LAST.
	assert.equal(unescapeSkillAttribute("&amp;lt;"), "&lt;");
	assert.equal(unescapeSkillAttribute("&amp;amp;"), "&amp;");
	// And the two are the harness's own spellings of the same five replacements.
	assert.equal(escapeSkillAttribute('&"<>\n'), "&amp;&quot;&lt;&gt;&#10;");
});
