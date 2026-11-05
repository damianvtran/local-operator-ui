import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<div id="editor"></div>', {
	url: "http://fictional.invalid",
});
globalThis.window = dom.window;
const bundle = await build({
	stdin: {
		contents:
			'export {SourcePreservingMarkdown} from "./src/renderer/src/features/chat/components/canvas/source-preserving-markdown";export {fictionalInstructionShape,extendedInstructionShape} from "./src/renderer/src/features/settings/components/system-prompt-fidelity.fixtures";export {canRichEditPrompt} from "./src/renderer/src/features/settings/components/system-prompt-markdown";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { "@features": `${process.cwd()}/src/renderer/src/features` },
});
const {
	SourcePreservingMarkdown,
	fictionalInstructionShape,
	extendedInstructionShape,
	canRichEditPrompt,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const create = (source) => {
	const codec = new SourcePreservingMarkdown("Fictional edit-source label");
	const root = dom.window.document.createElement("div");
	root.innerHTML = codec.render(source);
	return { codec, root };
};
const textLeaf = (root, text) =>
	[...root.querySelectorAll("span[data-prompt-node]")].find(
		(node) => !node.children.length && node.textContent === text,
	);

test("regression: shipped guard rejects realistic fictional tags/comments; fidelity renderer reads everything", () => {
	assert.equal(canRichEditPrompt(fictionalInstructionShape), false);
	for (const source of [fictionalInstructionShape, extendedInstructionShape]) {
		const { codec, root } = create(source);
		assert.equal(codec.read(root), source);
		assert.ok(root.querySelector("h1"));
		assert.ok(root.querySelector("strong"));
		assert.ok(root.querySelectorAll("[data-prompt-opaque]").length >= 3);
		assert.equal(root.querySelector("policy,fictional-policy"), null);
	}
});

test("same-paragraph text edit preserves all untouched syntax and opaque spans byte-for-byte", () => {
	const source =
		'\n# Fictional rules\n\nKeep  __exact emphasis__ beside <policy> and `literal` with &lt;angle&gt; and \\<escaped\\>.\n\n<!-- retain this comment exactly -->\n\n[guide]: https://example.invalid/guide "Title"\n\nRead [the guide][guide].\n';
	const { codec, root } = create(source);
	textLeaf(root, "Keep  ").textContent = "Change  ";
	assert.equal(codec.read(root), source.replace("Keep  ", "Change  "));
	textLeaf(root, " beside ").textContent = " near ";
	assert.equal(
		codec.read(root),
		source.replace("Keep  ", "Change  ").replace(" beside ", " near "),
	);
});

test("nested list and table leaf edits patch the smallest source span", () => {
	const source =
		'-   Parent __rule__\n    -   Inner `<sample>`\n    -   Keep this <custom> marker\n\n| Key | Value |\n| :--- | ---: |\n| One | Two |\n\n~~~python extra-info\nprint("literal <sample>")\n~~~\n';
	const { codec, root } = create(source);
	textLeaf(root, "Parent ").textContent = "Updated ";
	textLeaf(root, "Two").textContent = "Three";
	assert.equal(
		codec.read(root),
		source.replace("Parent ", "Updated ").replace("Two", "Three"),
	);
});

test("task toggles and fenced-code edits preserve surrounding source and info strings", () => {
	const source =
		'-   [ ] Keep __this__ <tag> rule\n\n~~~python exact-meta\nprint("one")\n~~~\n';
	const { codec, root } = create(source);
	const checkbox = root.querySelector('input[type="checkbox"]');
	checkbox.checked = true;
	checkbox.setAttribute("checked", "");
	assert.equal(codec.read(root), source.replace("[ ]", "[x]"));
	root.querySelector("pre code").textContent = 'print("two")\n';
	assert.equal(
		codec.read(root),
		source.replace("[ ]", "[x]").replace('print("one")', 'print("two")'),
	);
});

test("opaque local edits are versioned; stale apply refuses; historical DOM remains exact", () => {
	const source =
		'Read <policy priority="high"> literally.\n\n<!-- exact marker -->\n';
	const { codec, root } = create(source);
	const oldHtml = root.innerHTML;
	const atom = codec.getOpaque(root.querySelector("[data-prompt-opaque]"));
	const changed = codec.replaceOpaque(
		root,
		atom.id,
		source,
		'<policy priority="fictional">',
	);
	assert.equal(
		changed,
		source.replace('<policy priority="high">', '<policy priority="fictional">'),
	);
	const newHtml = root.innerHTML;
	assert.equal(codec.replaceOpaque(root, atom.id, source, "stale"), null);
	root.innerHTML = oldHtml;
	assert.equal(codec.read(root), source);
	root.innerHTML = newHtml;
	assert.equal(codec.read(root), changed);
	root.querySelector("[data-prompt-opaque]").remove();
	assert.equal(
		codec.read(root),
		changed.replace('<policy priority="fictional">', ""),
	);
	root.innerHTML = oldHtml;
	assert.equal(codec.read(root), source);
});

test("repeated whole-source/rich rebuilds and unusual whitespace are canonical no-ops", () => {
	const source =
		"\r\n# Rules\r\n\r\nText &amp; \\<literal\\>  \r\nnext line.\r\n\r\n<!-- keep -->\r\n";
	const { codec, root } = create(source);
	for (let round = 0; round < 5; round++) {
		assert.equal(codec.read(root), source);
		root.innerHTML = codec.render(codec.read(root));
	}
	const { codec: blank, root: empty } = create("");
	empty.textContent = "Fictional new paragraph";
	assert.equal(blank.read(empty), "Fictional new paragraph");
});

test("unsafe HTML, handlers, image resources and link protocols never become active DOM", () => {
	const source =
		"<script>globalThis.fictionalExecuted = true</script>\n\n<img src=\"https://example.invalid/private\" onerror='run()'>\n\n![Image](https://example.invalid/image)\n\n[Bad](javascript:run()) and [Data](data:text/html,example) and [Safe](https://example.invalid/guide).\n";
	const { codec, root } = create(source);
	assert.equal(
		root.querySelector("script,img,iframe,style,object,embed,svg,math"),
		null,
	);
	assert.equal(root.querySelector("[src],[onerror],[onclick],[style]"), null);
	assert.equal(root.querySelectorAll("a").length, 1);
	assert.equal(
		root.querySelector("a").getAttribute("href"),
		"https://example.invalid/guide",
	);
	assert.equal(codec.read(root), source);
	assert.equal(globalThis.fictionalExecuted, undefined);
	const atom = codec.getOpaque(root.querySelector("[data-prompt-opaque]"));
	const edited = codec.replaceOpaque(
		root,
		atom.id,
		source,
		'<iframe src="https://example.invalid/frame"></iframe>',
	);
	assert.ok(
		edited.includes('<iframe src="https://example.invalid/frame"></iframe>'),
	);
	assert.equal(root.querySelector("iframe"), null);
});

test("long fictional document stays readable and leaf edits retain every unknown span", () => {
	const source = fictionalInstructionShape.repeat(12);
	const { codec, root } = create(source);
	assert.equal(codec.read(root), source);
	const first = textLeaf(root, "Working agreements");
	first.textContent = "Fictional revised agreements";
	assert.equal(
		codec.read(root),
		source.replace("Working agreements", "Fictional revised agreements"),
	);
});
