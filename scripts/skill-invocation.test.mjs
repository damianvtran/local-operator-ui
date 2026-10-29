import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE `$skill` TRIGGER AND PAYLOAD, pinned against the harness contract.
 *
 * `local_operator/skills/invoke.py` owns the `$name` contract and expansion is a
 * CLIENT duty, so this suite pins the desktop port against the harness's own
 * behaviour: `sigils.skill_name_spans`, `sigils.skill_mentions`,
 * `sigils.defuse_skill_block`, `invoke.render_skill_block` and
 * `harness.rows._strip_spans`. The vectors are written as LITERALS rather than
 * recomputed from the module, because a test that derives its expectation from
 * the code under test pins nothing: the literals are what lets a drift in the
 * port turn this red.
 *
 * The legacy write half (`render_invocation`) is still exercised because its
 * shape is what every pre-block transcript holds and what `skill-row.ts`
 * continues to read.
 */

const bundle = await build({
	stdin: {
		contents: `
			export {
				SKILL_BLOCK_CLOSE,
				SKILL_BLOCK_OPEN,
				SKILL_BLOCK_PREAMBLE,
				defuseSkillBlock,
				escapeSkillAttribute,
				planSkillMentions,
				renderSkillBlock,
				renderSkillInvocation,
				skillBlockSpans,
				skillBodyHasContent,
				skillMentions,
				skillNameSpans,
				stripSkillBlock,
				typedLineOf,
				unescapeSkillAttribute,
			} from "./src/renderer/src/features/chat/components/skill-invocation";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const bundlePath = new URL(
	`./_skill-invocation-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	SKILL_BLOCK_CLOSE,
	SKILL_BLOCK_OPEN,
	SKILL_BLOCK_PREAMBLE,
	defuseSkillBlock,
	escapeSkillAttribute,
	planSkillMentions,
	renderSkillBlock,
	renderSkillInvocation,
	skillBlockSpans,
	skillBodyHasContent,
	skillMentions,
	skillNameSpans,
	stripSkillBlock,
	typedLineOf,
	unescapeSkillAttribute,
} = await import(bundlePath.href);
await unlink(bundlePath);

const NAMES = ["research", "release-notes", "pathfinder", "seal-demo"];
const mention = (text, names = NAMES, opts = {}) =>
	skillMentions(text, names, opts);

/* ------------------------------------------------------------------ */
/* `skill_name_spans` / `skill_mentions`: the trigger                   */
/* ------------------------------------------------------------------ */

test("a boundary `$name` is a mention, wherever it sits in the message", () => {
	assert.deepEqual(mention("$research fix"), [
		{ start: 0, end: 9, text: "$research", name: "research", leading: true },
	]);
	// INLINE is the new case: the old parser was anchored at the buffer start
	// and this token is what that parser could never see.
	assert.deepEqual(mention("fix it with $research"), [
		{
			start: 12,
			end: 21,
			text: "$research",
			name: "research",
			leading: false,
		},
	]);
	// WHOLE TEXT, not line by line: a token after a newline is a token, and only
	// the buffer's first token is leading (`text[:start].strip()` is empty).
	assert.deepEqual(mention("\n\n  $research"), [
		{ start: 4, end: 13, text: "$research", name: "research", leading: true },
	]);
	assert.deepEqual(mention("line one\n$research"), [
		{
			start: 9,
			end: 18,
			text: "$research",
			name: "research",
			leading: false,
		},
	]);
	// MULTI, in text order: one message may fire several skills.
	assert.deepEqual(mention("$research then $release-notes"), [
		{ start: 0, end: 9, text: "$research", name: "research", leading: true },
		{
			start: 15,
			end: 29,
			text: "$release-notes",
			name: "release-notes",
			leading: false,
		},
	]);
});

test("money, glue, shell and quoting are not tokens", () => {
	for (const text of [
		"costs$5",
		"a$b",
		"$100 for the redesign",
		"a $5 coffee",
		"echo $PATH",
		"`$research`",
		'"$research"',
		"($research)",
		"$$research",
		"$",
		"$-foo",
	]) {
		assert.deepEqual(mention(text), [], text);
	}
	// An ENVIRONMENT VARIABLE cannot fire a skill mid-sentence even when the
	// vocabulary has an exactly lower-case name: inline resolution needs a
	// lowercase letter in the token, and `$PATH` has none.
	const env = ["path", "debug"];
	assert.deepEqual(mention("echo $PATH", env), []);
	assert.deepEqual(mention("echo $DEBUG", env), []);
	assert.deepEqual(mention("use $path now", env), [
		{
			start: 4,
			end: 9,
			text: "$path",
			name: "path",
			leading: false,
		},
	]);
});

test("case: exact always fires; case-insensitive only on the leading or lowercase evidence", () => {
	// Leading keeps the legacy rule: the sigil itself is the evidence.
	assert.equal(mention("$Research")[0]?.name, "research");
	assert.equal(mention("$RESEARCH")[0]?.name, "research");
	// Inline requires a lowercase letter in the token.
	assert.equal(mention("fix $Research")[0]?.name, "research");
	assert.deepEqual(mention("fix $RESEARCH"), []);
	assert.deepEqual(mention("fix $RESEARCH and $research")[0]?.name, "research");
	// The resolved name is the DISCOVERY spelling, not what was typed.
	assert.equal(mention("fix $ReLeAsE-NoTeS")[0]?.name, "release-notes");
});

test("trailing punctuation is trimmed one character at a time", () => {
	// `,` is outside the name class, so the token ends before it.
	assert.deepEqual(mention("$research, fix"), [
		{ start: 0, end: 9, text: "$research", name: "research", leading: true },
	]);
	// `.`, `-` and `_` are INSIDE the class: the run swallows them and the
	// resolver then trims back to a discovered name.
	assert.deepEqual(mention("$research."), [
		{ start: 0, end: 9, text: "$research", name: "research", leading: true },
	]);
	assert.deepEqual(mention("$release-notes."), [
		{
			start: 0,
			end: 14,
			text: "$release-notes",
			name: "release-notes",
			leading: true,
		},
	]);
	// A genuinely dotted name wins on the FULL run, so trimming cannot steal it.
	assert.deepEqual(mention("$seal.demo.", ["seal", "seal.demo"]), [
		{ start: 0, end: 10, text: "$seal.demo", name: "seal.demo", leading: true },
	]);
	// But an underscore in the MIDDLE is not trailing: no fallback to `research`.
	assert.deepEqual(mention("$research_extra"), []);
	// The raw scanner still reports the untrimmed run, which is what the inert
	// ink is painted from.
	assert.deepEqual(skillNameSpans("$research."), [
		{ start: 0, end: 10, name: "research." },
	]);
});

test("mentions dedupe by RESOLVED name, first-seen order", () => {
	assert.deepEqual(mention("$research and $Research"), [
		{ start: 0, end: 9, text: "$research", name: "research", leading: true },
	]);
	assert.deepEqual(
		mention("$research $release-notes $research").map((row) => row.name),
		["research", "release-notes"],
	);
});

test("skipSpans drop a token BEFORE the dedupe, so a quoted body cannot shadow a real one", () => {
	// A token inside an existing block is not a mention.
	assert.deepEqual(
		mention("$research in a body", NAMES, {
			skipSpans: [[0, 100]],
		}),
		[],
	);
	// And it does not enter the dedupe set: the real `$research` after the
	// skipped body still fires.
	const text = "$research in a body, then $research for real";
	const spans = [[0, 26]];
	assert.deepEqual(mention(text, NAMES, { skipSpans: spans }), [
		{
			start: 26,
			end: 35,
			text: "$research",
			name: "research",
			leading: false,
		},
	]);
});

/* ------------------------------------------------------------------ */
/* renderSkillBlock: byte parity with `invoke.render_skill_block`      */
/* ------------------------------------------------------------------ */

const EXACT_BLOCK = [
	"<operator-skills>",
	"",
	"The user invoked the following skills directly. Follow them for this request. Their reference files, if any, are listed at the end of each body and are read with `skill://<name>/<path>`.",
	"",
	'<skill name="research">',
	"# Research",
	"",
	"Do it.",
	"</skill>",
	"",
	'<skill name="release-notes">',
	"# Notes",
	"</skill>",
	"",
	"</operator-skills>",
].join("\n");

test("the tail block is the harness's bytes, preamble included", () => {
	const block = renderSkillBlock([
		{ name: "research", body: "# Research\n\nDo it." },
		{ name: "release-notes", body: "# Notes" },
	]);
	assert.equal(block, EXACT_BLOCK);
	// The constants are pinned too: a drifted preamble orphans every transcript
	// already written, so it is not a string to "tidy".
	assert.equal(SKILL_BLOCK_OPEN, "<operator-skills>");
	assert.equal(SKILL_BLOCK_CLOSE, "</operator-skills>");
	assert.equal(
		SKILL_BLOCK_PREAMBLE,
		"The user invoked the following skills directly. Follow them for this request. Their reference files, if any, are listed at the end of each body and are read with `skill://<name>/<path>`.",
	);
});

test("a body cannot close the block early: all three markers are defused", () => {
	const zero = "\u200b";
	const body = [
		"quotes <operator-skills> and </operator-skills>",
		'and an element head <skill name="x">',
		"but a plain <skill> stays readable",
	].join("\n");
	const defused = defuseSkillBlock(body);
	assert.equal(
		defused,
		`quotes <${zero}operator-skills> and <${zero}/operator-skills>\nand an element head <${zero}skill name=x">\nbut a plain <skill> stays readable`,
	);
	// And the defused body is what the block renders, so the scanner sees one
	// complete block rather than a split one.
	const block = renderSkillBlock([{ name: "research", body }]);
	const spans = skillBlockSpans(block);
	assert.deepEqual(spans, [[0, block.length]]);
});

/* ------------------------------------------------------------------ */
/* skillBlockSpans / stripSkillBlock                                   */
/* ------------------------------------------------------------------ */

test("a block needs the marker, the preamble AND the closer", () => {
	const block = renderSkillBlock([{ name: "research", body: "B" }]);
	assert.deepEqual(skillBlockSpans(`before\n\n${block}\nafter`), [
		[8, 8 + block.length],
	]);
	// A quoted marker with no preamble is not a block: a sentence that merely
	// names the tag is never hidden.
	assert.deepEqual(skillBlockSpans(`${SKILL_BLOCK_OPEN}\ntext`), []);
	// An unclosed opener reports nothing, and it does not stop the scan: a later
	// complete block keeps its own span instead of pairing with this closer.
	const broken = `${SKILL_BLOCK_OPEN}\n\n${SKILL_BLOCK_PREAMBLE}\nbody ${SKILL_BLOCK_OPEN} here\n${SKILL_BLOCK_CLOSE}`;
	const text = `${broken}\n\n${block}`;
	assert.deepEqual(
		skillBlockSpans(text).map(([start]) => start),
		[broken.length + 2],
	);
});

test("stripSkillBlock removes complete blocks and leaves every other byte alone", () => {
	const block = renderSkillBlock([
		{ name: "research", body: "# Research\n\nDo it." },
	]);
	assert.equal(stripSkillBlock(`fix the bug\n\n${block}`), "fix the bug");
	assert.equal(stripSkillBlock(block), "");
	// A block in the middle: the separator before it belonged to the block, so
	// the prose is right-stripped; the text after keeps its own leading newlines.
	assert.equal(
		stripSkillBlock(`before\n\n${block}\n\nafter`),
		"before\n\nafter",
	);
	// No complete block: the string is returned byte-identical, never trimmed.
	const ordinary = "  keep my spaces  ";
	assert.equal(stripSkillBlock(ordinary), ordinary);
});

/* ------------------------------------------------------------------ */
/* planSkillMentions: the idempotence rules over an existing block     */
/* ------------------------------------------------------------------ */

test("the plan ignores tokens inside a block and names already attached", () => {
	const block = renderSkillBlock([
		{ name: "research", body: "the body quotes $research" },
	]);
	// The body's token is skipped, and the block's own head is `already`, so a
	// replay of the same payload attaches nothing twice.
	assert.deepEqual(planSkillMentions(`$research fix\n\n${block}`, NAMES), []);
	// A second, genuinely different name before the block still fires.
	assert.deepEqual(
		planSkillMentions(`$release-notes and $research\n\n${block}`, NAMES).map(
			(row) => row.name,
		),
		["release-notes"],
	);
});

/* ------------------------------------------------------------------ */
/* skillBodyHasContent                                                 */
/* ------------------------------------------------------------------ */

test("a stub whose YAML is the whole file is not content", () => {
	assert.equal(skillBodyHasContent(null), false);
	assert.equal(skillBodyHasContent(""), false);
	assert.equal(skillBodyHasContent("   \n\t "), false);
	assert.equal(
		skillBodyHasContent("---\nname: research\ndescription: A stub\n---\n"),
		false,
	);
	assert.equal(
		skillBodyHasContent("---\nname: research\n---\n\n# The method\nDo it."),
		true,
	);
	// An UNTERMINATED block is malformed rather than empty: it counts as
	// content, and the user sees the odd result rather than a wrong sentence.
	assert.equal(skillBodyHasContent("---\nname: research"), true);
	assert.equal(skillBodyHasContent("plain body"), true);
});

/* ------------------------------------------------------------------ */
/* The LEGACY shape: escape, write and read                            */
/* ------------------------------------------------------------------ */

const HEADER =
	"The user invoked the `research` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.";

test("escapeSkillAttribute / unescapeSkillAttribute are inverses", () => {
	assert.equal(unescapeSkillAttribute("plain"), "plain");
	assert.equal(unescapeSkillAttribute("a&quot;b"), 'a"b');
	assert.equal(unescapeSkillAttribute("&lt;&amp;&gt;"), "<&>");
	assert.equal(unescapeSkillAttribute("x&#10;y"), "x\ny");
	// `&amp;` LAST, or the other four would read an escape a literal `&` opened.
	assert.equal(unescapeSkillAttribute("&amp;lt;"), "&lt;");
	assert.equal(unescapeSkillAttribute("&amp;amp;"), "&amp;");
	const raw = 'a & b "c" <d> e\nf 5 < 6';
	assert.equal(unescapeSkillAttribute(escapeSkillAttribute(raw)), raw);
});

test("a legacy payload is still written and read byte for byte", () => {
	const invocation = {
		name: "research",
		request: "fix the login bug",
		token: "$research",
		typed: "$research fix the login bug",
	};
	const payload = renderSkillInvocation(invocation, "B");
	assert.equal(
		payload,
		`${HEADER}\n<skill name="research" invocation="$research fix the login bug">\nB\n</skill>\nfix the login bug`,
	);
	assert.equal(typedLineOf(payload), invocation.typed);
	assert.equal(typedLineOf("plain message"), null);
	assert.equal(typedLineOf("<reply-to>x</reply-to>\n$research fix"), null);
	assert.equal(
		typedLineOf('we say <skill name="research"> without the attribute'),
		null,
	);
});
