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
			export { skillRowOf, skillOf } from "./src/renderer/src/features/chat/canonical/skill-row";
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
	skillRowOf,
	skillOf,
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

test("a missing or multi-line description gives the row no purpose", () => {
	const withDescription = (frontMatter) =>
		[
			HEADER,
			'<skill name="seal-demo" invocation="$seal-demo">',
			`---\nname: seal-demo\n${frontMatter}---\n\n# Seal demo\n</skill>`,
		].join("\n");

	// No `description:` key at all.
	assert.equal(skillRowOf(withDescription("")).skill.purpose, null);
	// A folded block scalar, which is how the shipped skills write a long one
	// (`description: >-` over two indented lines): the header is ONE line, so a
	// sentence split across lines is declined rather than half-rendered.
	assert.equal(
		skillRowOf(
			withDescription(
				"description: >-\n  Review a diff for the seal\n  demo\n",
			),
		).skill.purpose,
		null,
	);
	// An indented continuation under a plain scalar is multi-line too.
	assert.equal(
		skillRowOf(
			withDescription("description: Review a diff\n  for the seal demo\n"),
		).skill.purpose,
		null,
	);
	assert.equal(
		skillRowOf(withDescription("description: |\n  Review a diff\n")).skill
			.purpose,
		null,
	);
	// A single line is the case the header exists for, quotes are YAML's own
	// punctuation rather than part of the sentence, and an unclosed quote is a
	// multi-line scalar wearing a quote.
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
	assert.equal(
		skillRowOf(withDescription('description: "Review a diff\n')).skill.purpose,
		null,
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
