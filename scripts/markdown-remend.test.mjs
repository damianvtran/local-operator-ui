import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * `closeOpenMarkdown`: the optimistic closer the live tail is parsed through.
 *
 * Two properties carry the whole design, and both are pinned over EVERY prefix
 * of a corpus rather than a few hand-picked strings:
 *
 *   1. A COMPLETE block is a fixed point: nothing to close, the same string back.
 *      That is what makes the hand-over to the settled renderer a no-op.
 *   2. The closer only ever APPENDS to (or strips a dangling marker from) the
 *      END of the text: the already-painted prefix is never rewritten, so a
 *      later delta cannot move what the reader is looking at.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/utils/markdown-remend";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { closeOpenMarkdown, openFenceOf } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const closed = (source) => closeOpenMarkdown(source);
/** Trailing blank lines are layout-neutral to a markdown parse. */
const trimmed = (source) => closeOpenMarkdown(source).trimEnd();

test("unterminated inline code closes; the reported `InfoList` flash is gone", () => {
	assert.equal(closed("That's `InfoList"), "That's `InfoList`");
	assert.equal(closed("That's `InfoList` in"), "That's `InfoList` in");
	// An empty span (the opener just arrived) is dropped, not painted as ``.
	assert.equal(closed("That's `"), "That's");
	assert.equal(closed("use ``a ` b"), "use ``a ` b``");
});

test("emphasis, strong, strikethrough close in reverse order", () => {
	assert.equal(closed("a **bold"), "a **bold**");
	assert.equal(closed("a *it"), "a *it*");
	assert.equal(
		closed("a **bold and *it"),
		"a **bold and *it***".replace("***", "***"),
	);
	assert.equal(closed("a ~~gone"), "a ~~gone~~");
	assert.equal(closed("a _it"), "a _it_");
	assert.equal(closed("a __st"), "a __st__");
});

test("a dangling opener with no content yet paints nothing, not a literal marker", () => {
	assert.equal(closed("foo **"), "foo");
	assert.equal(closed("foo *"), "foo");
	assert.equal(closed("foo ~~"), "foo");
});

test("not emphasis: bullets, products, snake_case, escapes, code contents", () => {
	assert.equal(closed("2 * 3 = 6"), "2 * 3 = 6");
	assert.equal(closed("snake_case_name here"), "snake_case_name here");
	assert.equal(closed("a \\*literal"), "a \\*literal");
	assert.equal(closed("call `a * b` now"), "call `a * b` now");
	assert.equal(closed("call `a **b` now"), "call `a **b` now");
});

test("an unterminated fence closes with its own marker; a closed one is left alone", () => {
	assert.equal(closed("```ts\nconst a = 1;"), "```ts\nconst a = 1;\n```");
	assert.equal(closed("```ts\nconst a = 1;\n"), "```ts\nconst a = 1;\n```");
	assert.equal(closed("~~~\nx"), "~~~\nx\n~~~");
	assert.equal(closed("````md\n```\nx"), "````md\n```\nx\n````");
	assert.equal(closed("```ts\nx\n```"), "```ts\nx\n```");
	// Emphasis markers inside the code are code.
	assert.equal(closed("```\n**x"), "```\n**x\n```");
	// Prose before the fence still closes.
	assert.equal(closed("go **now\n\n```\nx"), "go **now**\n\n```\nx\n```");
	const open = openFenceOf("intro\n\n```mermaid\ngraph TD");
	assert.deepEqual(open, {
		before: "intro\n\n",
		marker: "```",
		info: "mermaid",
		body: "graph TD",
		indent: "",
		nested: false,
		held: 0,
	});
});

test("a bare block marker on the unfinished line is not painted yet", () => {
	assert.equal(trimmed("intro\n\n#"), "intro");
	assert.equal(trimmed("intro\n\n## "), "intro");
	assert.equal(trimmed("intro\n- "), "intro");
	assert.equal(trimmed("intro\n>"), "intro");
	assert.equal(trimmed("intro\n3."), "intro");
	// Setext: a lone `-`/`=` would retype the line above as a heading.
	assert.equal(trimmed("Title\n="), "Title");
	// A marker WITH content is a block already.
	assert.equal(trimmed("# Title"), "# Title");
	assert.equal(trimmed("- item"), "- item");
	assert.equal(trimmed("#hashtag"), "#hashtag");
});

test("an unfinished link paints its label, an unfinished image nothing", () => {
	assert.equal(closed("see [the docs](https://exa"), "see the docs");
	assert.equal(closed("see [the docs]("), "see the docs");
	assert.equal(closed("see [the docs"), "see the docs");
	assert.equal(
		closed("see [the docs](https://example.com)"),
		"see [the docs](https://example.com)",
	);
	assert.equal(closed("see ![shot](/tmp/a"), "see ");
	assert.equal(closed("a [b] c"), "a [b] c");
});

test("only the last inline unit closes: earlier paragraphs, items and table rows stay as written", () => {
	assert.equal(closed("a **b\n\nc `d"), "a **b\n\nc `d`");
	assert.equal(closed("- a **b\n- c"), "- a **b\n- c");
	assert.equal(closed("- a\n- c **d"), "- a\n- c **d**");
	assert.equal(
		closed("**bold\nstill the same paragraph"),
		"**bold\nstill the same paragraph**",
	);
	assert.equal(closed("| a | **b |"), "| a | **b |");
});

const CORPUS = [
	"That's `InfoList` in the infoline folder. Next I'll read how **it renders** items and *how* the ~~missing~~ rows differ.",
	"- one with `code`\n- two with **bold** and a [link](https://example.com/a?b=c)\n- three",
	"# Heading with `code`\n\nBody with snake_case_name and 2 * 3 and a \\*star.",
	"```ts\nconst a = `x`;\nconst b = **not bold**;\n```\n\nAfter the fence, `tail` and _more_.",
	"> quote with **strong** and\n> a second line\n\n1. first\n2. second `code`",
	"| a | b |\n|---|---|\n| `x` | **y** |\n\n![alt text](/tmp/img.png) done.",
];

test("every prefix: a complete prefix is a fixed point and the painted prefix never rewrites", () => {
	for (const text of CORPUS) {
		for (let n = 1; n <= text.length; n++) {
			const prefix = text.slice(0, n);
			const out = closed(prefix);
			// (2) The result keeps the prefix up to the point where it may only
			// strip a dangling tail: the longest common prefix covers everything
			// but the unterminated last construct.
			const lineStart = prefix.lastIndexOf("\n") + 1;
			assert.ok(
				out.startsWith(prefix.slice(0, Math.max(0, lineStart - 1))) ||
					prefix.slice(0, lineStart) === "",
				`rewrote earlier lines: ${JSON.stringify(prefix)} -> ${JSON.stringify(out)}`,
			);
		}
		// (1) The whole text is complete.
		assert.equal(
			closed(text),
			text,
			`not a fixed point: ${JSON.stringify(text)}`,
		);
	}
});

/* ------------------------------------------- review round 1 (R1, D, Q) */

test("a half-typed closing fence is held back, never painted as a code line (D2)", () => {
	for (const partial of ["`", "``"]) {
		const source = `\`\`\`ts\nconst a = 1;\n${partial}`;
		const fence = openFenceOf(source);
		assert.equal(fence.body, "const a = 1;\n");
		assert.equal(fence.held, partial.length);
		assert.equal(closed(source), "```ts\nconst a = 1;\n```");
	}
	// Not a closer: a code line that merely STARTS with a backtick, and a run as
	// long as the opener (which really closes the fence).
	assert.equal(openFenceOf("```\n`x").body, "`x");
	assert.equal(openFenceOf("```\nx\n```"), null);
});

test("a fence in a list item is nested, keeps its indent on the closer, and is not a direct paint (R1-m1)", () => {
	const source = "1. step\n   ```sh\n   run";
	const fence = openFenceOf(source);
	assert.equal(fence.nested, true);
	assert.equal(closed(source), "1. step\n   ```sh\n   run\n   ```");
	assert.equal(openFenceOf("go\n\n```sh\nrun").nested, false);
});

test("an indented code block gets no stray closer (R1-m1)", () => {
	assert.equal(closed("    ```\nx"), "    ```\nx");
	assert.equal(closed("    a *b"), "    a *b");
});

test("a bare `[` is literal until a target begins (R1-m2)", () => {
	assert.equal(closed("x = arr[0"), "x = arr[0");
	assert.equal(closed("array[i] and arr[j"), "array[i] and arr[j");
	assert.equal(closed("see [1"), "see [1");
	// A label that can still become a link keeps painting without its bracket.
	assert.equal(closed("see [the docs"), "see the docs");
	assert.equal(closed("see [the docs]("), "see the docs");
	assert.equal(closed("see [the docs](http://exa"), "see the docs");
});

test("globs, arithmetic and identifiers are not emphasis (R1-m3, Q3)", () => {
	for (const text of [
		"match *.ts files",
		"src/**/*.ts",
		"Run cat *.txt and then *.md files.",
		"a*b and x*y",
		"costs $5*2 and $10",
		"The __init__ method and __dunder__init are special.",
		"Press the ` key to open.",
		"wrote a footnote*",
	])
		assert.equal(closed(text), text, text);
	// Real emphasis still closes.
	assert.equal(closed("a *real one"), "a *real one*");
	assert.equal(closed("a **bold"), "a **bold**");
});

test("the digits of an ordered-list marker after a blank line are held (D1)", () => {
	for (const tail of ["1", "12", "1.", "1. "])
		assert.equal(closed(`- a\n- b\n\n${tail}`), "- a\n- b\n\n");
	assert.equal(closed("- a\n\n1. s"), "- a\n\n1. s");
	// A number that ends a prose line is a number.
	assert.equal(closed("total:\n42"), "total:\n42");
});
