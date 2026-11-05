import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { canRichEditPrompt } from "./src/renderer/src/features/settings/components/system-prompt-markdown"; export { markdownToHtml, htmlToMarkdown } from "./src/renderer/src/features/chat/components/canvas/wysiwyg-utils";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { "@features": `${process.cwd()}/src/renderer/src/features` },
});
const { canRichEditPrompt, markdownToHtml, htmlToMarkdown } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const markdown =
	'# Fictional instructions\n\nUse **clear** explanations and `literal` code.\n\n- Keep context\n  - Nested rule\n- Read [the guide](https://example.invalid/guide)\n\n```python\nprint("hello")\n```\n';

test("ordinary Markdown is rich-editable despite harmless lexical normalization", () => {
	assert.equal(canRichEditPrompt(markdown), true);
	assert.equal(
		canRichEditPrompt("## Rules\n\n* Keep __all__ instructions.\n"),
		true,
	);
});

test("actual rendered edits retain nested instructions, links, fences and backticks", () => {
	const html = markdownToHtml(markdown);
	const edited = htmlToMarkdown(html.replace("clear", "precise"));
	assert.ok(edited.includes("**precise**"));
	assert.ok(edited.includes("`literal`"));
	assert.ok(edited.includes("Nested rule"));
	assert.ok(edited.includes("https://example.invalid/guide"));
	assert.ok(edited.includes('```python\nprint("hello")\n```'));
	assert.equal(canRichEditPrompt(edited), true);
});

test("unknown tags and unsupported syntax refuse rich conversion without changing source", () => {
	for (const source of [
		`${markdown}\n<policy priority="high">\nKeep all instructions.\n</policy>`,
		'<script>alert("no")</script>',
		"## Rule\n\nText[^a]\n\n[^a]: Keep this footnote.",
	]) {
		const original = source;
		assert.equal(canRichEditPrompt(source), false);
		assert.equal(source, original);
	}
});

test("long documents and literal angle brackets in code remain editable", () => {
	assert.equal(canRichEditPrompt(markdown.repeat(80)), true);
	assert.equal(canRichEditPrompt("Use `<policy>` and ``a`b``.\n"), true);
});
