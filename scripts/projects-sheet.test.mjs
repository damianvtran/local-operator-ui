import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The CREATE sheet's pure model, executed in Node.
 *
 * `project-sheet-model.ts` is what the sheet derives rather than invents: the
 * key from a title, the description template, the clipboard-markdown
 * conversion, and the paste splice the sheet and the detail's inline editor
 * both mount. This file pins each of them, so the dialog, the stories and the
 * frames all read one definition — the `projects-tab.test.mjs` pattern. (The
 * sheet is create-only since the inline-edit slice: this model never had an
 * edit mode, and the fields it fed now live in `project-edit-model.ts`, pinned
 * by `projects-inline-edit.test.mjs`.)
 *
 * BUNDLED RATHER THAN IMPORTED: these are TypeScript modules in the renderer
 * tree, and the app's tsconfig does not run here. The module imports nothing
 * from the renderer or Electron, so the bundle stays a pure function library.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as sheet from "./src/renderer/src/features/projects/project-sheet-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const source = bundle.outputFiles[0].text;
const { sheet } = await import(
	`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const { markdownFromClipboardHtml, projectKeyFromTitle } = sheet;

/* Hoisted for `useTopLevelRegex`, the way every other scripts/ lane does. */
const STARTS_KEY_CHAR = /^[a-z0-9]/;
const ENDS_KEY_CHAR = /[a-z0-9]$/;

test("the key derivation: spaces become dashes, case folds, the rule holds", () => {
	assert.equal(projectKeyFromTitle("Payments Migration"), "payments-migration");
	assert.equal(projectKeyFromTitle("  Spaced  Out  "), "spaced-out");
	assert.equal(projectKeyFromTitle("Café API!"), "cafe-api");
	assert.equal(projectKeyFromTitle("S6d-ii: part 2"), "s6d-ii-part-2");
	/* Dots, underscores and dashes are legal key characters and survive. */
	assert.equal(projectKeyFromTitle("q4.hardening_final"), "q4.hardening_final");
	/* Runs of separators collapse to one dash. */
	assert.equal(projectKeyFromTitle("a  --  b"), "a-b");
});

test("the key derivation: starts and ends alphanumeric, clamped to 64", () => {
	for (const title of ["---leading", "trailing---", ".dots.", "!!bang!!"]) {
		const key = projectKeyFromTitle(title);
		assert.match(key, STARTS_KEY_CHAR, `${title} -> ${key}`);
		if (key) assert.match(key, ENDS_KEY_CHAR, `${title} -> ${key}`);
	}
	const long = projectKeyFromTitle("x".repeat(100));
	assert.equal(long.length, 64);
	/* The clamp can cut a trailing separator; the trim runs again after it. */
	const clamped = projectKeyFromTitle(`${"a".repeat(63)}-tail`);
	assert.equal(clamped.length, 63);
});

test("the key derivation: no usable characters derive the empty key", () => {
	assert.equal(projectKeyFromTitle(""), "");
	assert.equal(projectKeyFromTitle("!!! ???"), "");
	/* CJK folds to nothing: the sheet shows an empty key the author fills. */
	assert.equal(projectKeyFromTitle("日本語"), "");
});

test("the description template: light sections, inside the field's cap", () => {
	const template = sheet.PROJECT_DESCRIPTION_TEMPLATE;
	assert.equal(template, "## Summary\n\n## Goals\n\n## Notes");
	assert.ok(template.length < 240, "the seed must leave room to write");
});

test("markdown from clipboard HTML: headings, paragraphs, inline marks", () => {
	assert.equal(
		markdownFromClipboardHtml(
			"<h2>Summary</h2><p>Some <strong>bold</strong> and <em>italic</em> and <code>x = 1</code>.</p>",
		),
		"## Summary\n\nSome **bold** and *italic* and `x = 1`.",
	);
	assert.equal(
		markdownFromClipboardHtml("<p>first</p><p>second</p>"),
		"first\n\nsecond",
	);
	assert.equal(markdownFromClipboardHtml("line<br/>break"), "line\nbreak");
});

test("markdown from clipboard HTML: lists, running numbers, links", () => {
	assert.equal(
		markdownFromClipboardHtml("<ul><li>One</li><li>Two</li></ul>"),
		"- One\n- Two",
	);
	assert.equal(
		markdownFromClipboardHtml(
			"<ol><li>first</li><li>second</li><li>third</li></ol>",
		),
		"1. first\n2. second\n3. third",
	);
	assert.equal(
		markdownFromClipboardHtml(
			'<p>See <a href="https://example.com/x">the docs</a>.</p>',
		),
		"See [the docs](https://example.com/x).",
	);
});

test("markdown from clipboard HTML: pre blocks stay verbatim, fences tagged", () => {
	assert.equal(
		markdownFromClipboardHtml(
			'<pre><code class="language-py">if x:\n    y()</code></pre>',
		),
		"```py\nif x:\n    y()\n```",
	);
	/* Inline marks inside a fence are NOT converted: the author pasted code. */
	assert.equal(
		markdownFromClipboardHtml("<pre><code>a * b</code></pre>"),
		"```\na * b\n```",
	);
	/* A LATER fence's language never leaks onto an earlier, untagged one. */
	assert.equal(
		markdownFromClipboardHtml(
			'<pre><code>plain</code></pre><pre><code class="language-js">two()</code></pre>',
		),
		"```\nplain\n```\n\n```js\ntwo()\n```",
	);
});

test("markdown from clipboard HTML: entities decode, unknown tags drop to text", () => {
	assert.equal(
		markdownFromClipboardHtml("<p>a &amp; b &lt;c&gt; &quot;d&quot;&#39;s</p>"),
		'a & b <c> "d"\'s',
	);
	assert.equal(
		markdownFromClipboardHtml(
			"<div><table><tr><td>cell</td></tr></table></div>",
		),
		"cell",
	);
	assert.equal(markdownFromClipboardHtml("<p>&#x2764;</p>"), "\u2764");
});

test("markdown from clipboard HTML: a closed <pre> restores the ordinary rules after it", () => {
	/*
	 * The four shapes review round 1 measured. Before the pop-to-own-frame
	 * fix, `</pre>` popped the `<code>` frame instead of its own, so the pre
	 * frame stayed on the stack and everything AFTER a fence kept pre
	 * semantics: no whitespace collapse, no backticks, no quote prefixes.
	 */
	assert.equal(
		markdownFromClipboardHtml("<pre><code>x  y</code></pre><p>a   b</p>"),
		"```\nx  y\n```\n\na b",
	);
	assert.equal(
		markdownFromClipboardHtml(
			"<pre><code>x</code></pre><p>use <code>y</code> here</p>",
		),
		"```\nx\n```\n\nuse `y` here",
	);
	assert.equal(
		markdownFromClipboardHtml(
			"<pre><code>x</code></pre><blockquote><p>q</p></blockquote>",
		),
		"```\nx\n```\n\n> q",
	);
});

test("markdown from clipboard HTML: inline markup inside a blockquote does not leak its prefix", () => {
	assert.equal(
		markdownFromClipboardHtml(
			"<blockquote><p><strong>b</strong> after</p></blockquote><p>outside</p>",
		),
		"> **b** after\n\noutside",
	);
});

test("markdown from clipboard HTML: an anchor without an href leaves no mark", () => {
	assert.equal(
		markdownFromClipboardHtml('<p>see <a name="x">here</a>.</p>'),
		"see here.",
	);
});

test("markdown from clipboard HTML: blockquotes prefix, three-plus blanks collapse", () => {
	assert.equal(
		markdownFromClipboardHtml(
			"<blockquote><p>quoted line</p></blockquote><p>after</p>",
		),
		"> quoted line\n\nafter",
	);
	assert.equal(
		markdownFromClipboardHtml("<p>a</p><p></p><p></p><p>b</p>"),
		"a\n\nb",
	);
});
