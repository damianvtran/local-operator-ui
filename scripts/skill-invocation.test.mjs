import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE `$skill` SUBMISSION HALF, pinned against the harness contract.
 *
 * `local_operator/skills/invoke.py` owns the `$name` contract and expansion is
 * a CLIENT duty, so this suite pins the desktop port against the harness's own
 * behaviour. The vectors below were derived from that file — `parse_invocation`
 * (`:128-170`), `render_invocation` (`:173-207`), `_escape_attr` (`:210-224`)
 * and `_skill_body_has_content` (`tui/app.py:1099-1120`) — and are written as
 * LITERALS rather than recomputed from the module, because a test that derives
 * its expectation from the code under test pins nothing: the literals are what
 * lets a drift in the port turn this red.
 */

const bundle = await build({
	stdin: {
		contents: `
			export {
				escapeSkillAttribute,
				parseSkillInvocation,
				renderSkillInvocation,
				skillBodyHasContent,
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
	escapeSkillAttribute,
	parseSkillInvocation,
	renderSkillInvocation,
	skillBodyHasContent,
	typedLineOf,
	unescapeSkillAttribute,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------------------------------------------ */
/* parse_invocation: the recognition rule                              */
/* ------------------------------------------------------------------ */

const NAMES = ["research", "language-tutor", "pathfinder"];

test("a first-token `$name` matching a discovered skill is an invocation", () => {
	assert.deepEqual(parseSkillInvocation("$research fix the login bug", NAMES), {
		name: "research",
		request: "fix the login bug",
		token: "$research",
		typed: "$research fix the login bug",
	});
	// A bare token is legal and its request is ""; the skill body is the
	// instruction in that case, not an invented request.
	assert.deepEqual(parseSkillInvocation("$research", NAMES), {
		name: "research",
		request: "",
		token: "$research",
		typed: "$research",
	});
	// Case-insensitive second pass, resolving the ORIGINAL discovery name.
	assert.deepEqual(parseSkillInvocation("$ResearCH fix", NAMES), {
		name: "research",
		request: "fix",
		token: "$ResearCH",
		typed: "$ResearCH fix",
	});
	// Leading whitespace is stripped exactly as the harness does (`lstrip`).
	assert.deepEqual(parseSkillInvocation("  $research fix", NAMES), {
		name: "research",
		request: "fix",
		token: "$research",
		typed: "$research fix",
	});
});

test("anything that is not a first-token discovered name is prose", () => {
	for (const text of [
		"$100 for the redesign",
		"a $5 coffee",
		"echo $PATH",
		"",
		"$",
		"fix it with $research",
		"$nope x",
		// The pattern's class swallows `_`, so this miss does not fall back to
		// `research` — the safe direction for a token the grammar had to take.
		"$research_extra x",
		// `.` and `-` do not END a token: `research.` is the name, and it misses.
		"$research. x",
	]) {
		assert.equal(parseSkillInvocation(text, NAMES), null, text);
	}
	// A comma IS outside the name class, so it ends the token and the request
	// begins with it.
	assert.deepEqual(parseSkillInvocation("$research, fix", NAMES), {
		name: "research",
		request: ", fix",
		token: "$research",
		typed: "$research, fix",
	});
	// No partial matching: the vocabulary decides, and `re` is not a skill.
	assert.equal(parseSkillInvocation("$re fix", NAMES), null);
});

/* ------------------------------------------------------------------ */
/* _escape_attr: the order is the rule                                 */
/* ------------------------------------------------------------------ */

test("escapeSkillAttribute is `_escape_attr` character-for-character", () => {
	assert.equal(escapeSkillAttribute("plain"), "plain");
	assert.equal(escapeSkillAttribute('a"b'), "a&quot;b");
	assert.equal(escapeSkillAttribute("<&>"), "&lt;&amp;&gt;");
	assert.equal(escapeSkillAttribute("x\ny"), "x&#10;y");
	// `&` FIRST, or the escapes' own ampersands would be doubled again: a
	// literal `&quot;` must come back as `&amp;quot;` so the inverse recovers it.
	assert.equal(escapeSkillAttribute("&quot;"), "&amp;quot;");
	// `]` is NOT escaped (the harness does not either): `]]>` is `]]&gt;`.
	assert.equal(escapeSkillAttribute("]]>"), "]]&gt;");
});

/* ------------------------------------------------------------------ */
/* render_invocation: the payload                                      */
/* ------------------------------------------------------------------ */

const HEADER =
	"The user invoked the `research` skill directly. Follow it for this request. " +
	"Its reference files, if any, are listed at the end of the body and are read " +
	"with `skill://<name>/<path>`.";

test("the rendered payload is the harness's own text, byte for byte", () => {
	const invocation = parseSkillInvocation("$research fix the login bug", NAMES);
	const payload = renderSkillInvocation(
		invocation,
		"# Research\n\nRead the code first.",
	);
	assert.equal(
		payload,
		`${HEADER}\n<skill name="research" invocation="$research fix the login bug">\n# Research\n\nRead the code first.\n</skill>\nfix the login bug`,
	);
});

test("a bare `$name` gets no fake request and no trailing line", () => {
	const payload = renderSkillInvocation(
		parseSkillInvocation("$research", NAMES),
		"Body",
	);
	assert.equal(
		payload,
		`${HEADER}\n<skill name="research" invocation="$research">\nBody\n</skill>`,
	);
});

test("the typed line is escaped INSIDE the attribute, not normalised", () => {
	const invocation = parseSkillInvocation(
		'$research fix "it" & ship <now>',
		NAMES,
	);
	const payload = renderSkillInvocation(invocation, "B");
	assert.match(
		payload,
		/invocation="\$research fix &quot;it&quot; &amp; ship &lt;now&gt;"/,
	);
	// A multi-line draft cannot break the single-line tag: the newline rides the
	// attribute as a literal `&#10;` instead (asserted exactly below).
	const invoked = parseSkillInvocation("$research one\ntwo", NAMES);
	assert.equal(
		renderSkillInvocation(invoked, "B").split("\n")[1],
		'<skill name="research" invocation="$research one&#10;two">',
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
/* _unescape_attr / typed_line_of: the REPLAY half of the contract      */
/* ------------------------------------------------------------------ */

test("unescapeSkillAttribute is `_unescape_attr` character-for-character", () => {
	assert.equal(unescapeSkillAttribute("plain"), "plain");
	assert.equal(unescapeSkillAttribute("a&quot;b"), 'a"b');
	assert.equal(unescapeSkillAttribute("&lt;&amp;&gt;"), "<&>");
	assert.equal(unescapeSkillAttribute("x&#10;y"), "x\ny");
	// `&amp;` LAST, or the other four would read an escape a literal `&` opened:
	// `&amp;lt;` is the text `&lt;`, not `<`.
	assert.equal(unescapeSkillAttribute("&amp;lt;"), "&lt;");
	assert.equal(unescapeSkillAttribute("&amp;amp;"), "&amp;");
	assert.equal(unescapeSkillAttribute("&amp;quot;"), "&quot;");
	// The pair is reversible over the whole character set either side touches.
	const raw = 'a & b "c" <d> e\nf 5 < 6';
	assert.equal(unescapeSkillAttribute(escapeSkillAttribute(raw)), raw);
});

test("typedLineOf reads the typed line out of a payload, and null out of anything else", () => {
	const payload = renderSkillInvocation(
		parseSkillInvocation("$research fix the login bug", NAMES),
		"# Research\n\nRead the code first.",
	);
	assert.equal(payload.startsWith(HEADER), true);
	assert.equal(typedLineOf(payload), "$research fix the login bug");
	// Escaped INSIDE the attribute and recovered here, so the row shows what the
	// user typed rather than the transport's spelling of it.
	assert.equal(
		typedLineOf(
			renderSkillInvocation(
				parseSkillInvocation('$language-tutor compare <a> & "b"', NAMES),
				"body",
			),
		),
		'$language-tutor compare <a> & "b"',
	);
	// A multi-line draft is one line in the tag, and comes back as it was typed.
	assert.equal(
		typedLineOf(
			renderSkillInvocation(
				{
					...parseSkillInvocation("$research one", NAMES),
					typed: "$research one\ntwo",
				},
				"body",
			),
		),
		"$research one\ntwo",
	);
	// Every ordinary message, and prose that merely quotes the tag, is `null`:
	// the caller then paints the text verbatim.
	assert.equal(typedLineOf("plain message"), null);
	assert.equal(typedLineOf("<reply-to>x</reply-to>\n$research fix"), null);
	assert.equal(
		typedLineOf('we say <skill name="research"> without the attribute'),
		null,
	);
	assert.equal(typedLineOf(""), null);
});
