import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE READER'S OWN LINE BREAKS, AND WHERE THEY ARE KEPT.
 *
 * WHY THIS EXISTS (operator report, 2026-09-25): a message sent with `Prod:` /
 * `Email: …` / `Password: …` each on its own line reads back in the transcript
 * as ONE line — `Prod: Email: … Password: …` — while the session record holds
 * every newline. A single newline inside a paragraph is a markdown SOFT break:
 * not a node, just a line ending inside a `text` node's value, which HTML
 * collapses to a space unless something turns it into a `break` node first.
 * `remark-soft-breaks.ts` does that (hand-rolled; `remark-breaks` is not a
 * dependency of this repository), and `markdown-renderer.tsx` appends it to the
 * four citation-bearing remark pipelines, which are the renderer's user-turn
 * pipelines.
 *
 * A GREEN SCREENSHOT CANNOT FALSIFY A WHITESPACE RULE, so the claim is pinned
 * here in the three halves each of which can actually fail:
 *
 *  1. THE TRANSFORM, over hand-built mdast trees — one break per line ending,
 *     empty parts keeping their break, untouched subtrees not rebuilt, and
 *     value-bearing nodes (`code`, `inlineCode`) out of reach by construction.
 *  2. THE PIPELINE, end to end over the real modules — the operator's shape
 *     (built by the app's own `credentialCitation`) renders `<br>` where the
 *     lines were and still renders the chip; the same source WITHOUT the
 *     transform renders the collapsed shape that is the report (so the test
 *     discriminates, rather than asserting a constant); and an agent-side
 *     source keeps CommonMark's collapse, because its pipelines never carry
 *     the transform.
 *  3. THE WIRING, which is a fact about `markdown-renderer.tsx` and cannot be
 *     reached by a bundle: a source scan asserts the four citation pipelines
 *     end with `remarkSoftBreaks` and the four agent-facing ones do not — the
 *     cheap-precise-half pattern `no-websocket-plane.test.mjs` documents. Its
 *     limit is the same as its precision (it sees the file, not the processor
 *     the file builds); the frames in
 *     `docs/evidence/chat-canonical-credential-citation/` are the pixels.
 *
 * REAL: the shipped `remark-soft-breaks.ts`, `credential-capture.ts` and
 * `credential-citation-remark.ts`, bundled from source by esbuild and driven
 * through the real `unified`/`remark-parse`/`remark-gfm`/`remark-rehype`
 * modules on a three-member plugin stack (`remark-gfm`,
 * `remarkCredentialCitations`, `remarkSoftBreaks`); the app's own arrays also
 * carry `remarkMath` and `remarkLinkifyTargets`, and the transform sits LAST,
 * so their absence changes nothing these cases assert.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { unified } from "unified";
			import remarkParse from "remark-parse";
			import remarkGfm from "remark-gfm";
			import remarkRehype from "remark-rehype";
			import rehypeStringify from "rehype-stringify";

			export {
				credentialCitation,
				credentialMarker,
			} from "./src/renderer/src/features/chat/components/credential-capture";
			import { remarkCredentialCitations } from "./src/renderer/src/features/chat/components/credential-citation-remark";
			import { remarkSoftBreaks } from "./src/renderer/src/features/chat/utils/remark-soft-breaks";
			export { remarkCredentialCitations, remarkSoftBreaks };

			/*
			 * The four citation-bearing pipelines, as the renderer's own arrays
			 * assemble them: the two flags are separate arguments so the negative
			 * control can drop exactly one (the transform) and leave the tree
			 * otherwise identical.
			 */
			export const parseWith = (document, { citations, breaks }) => {
				let processor = unified().use(remarkParse).use(remarkGfm);
				if (citations) processor = processor.use(remarkCredentialCitations);
				if (breaks) processor = processor.use(remarkSoftBreaks);
				return processor.runSync(processor.parse(document));
			};

			export const render = (tree) => {
				const processor = unified().use(remarkRehype).use(rehypeStringify);
				return String(processor.stringify(processor.runSync(tree)));
			};
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const {
	credentialCitation,
	credentialMarker,
	remarkCredentialCitations,
	remarkSoftBreaks,
	parseWith,
	render,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

assert.equal(typeof remarkSoftBreaks, "function");
assert.equal(typeof parseWith, "function");

const text = (value) => ({ type: "text", value });
const para = (children) => ({ type: "paragraph", children });
const softBreak = { type: "break" };

/*
 * ---------------------------------------------------------------------------
 * 1. The transform, over hand-built trees.
 * ---------------------------------------------------------------------------
 */

test("each line ending becomes one break node, in all three spellings", () => {
	for (const [value, first, second] of [
		["Prod:\nEmail: ", "Prod:", "Email: "],
		["Prod:\r\nEmail: ", "Prod:", "Email: "],
		["Prod:\rEmail: ", "Prod:", "Email: "],
	]) {
		const tree = { type: "root", children: [para([text(value)])] };
		remarkSoftBreaks()(tree);
		assert.deepEqual(
			tree.children[0].children,
			[text(first), softBreak, text(second)],
			JSON.stringify(value),
		);
	}
});

test("an empty part still keeps its break, so the count of line endings survives", () => {
	const tree = { type: "root", children: [para([text("a\n\nb")])] };
	remarkSoftBreaks()(tree);
	assert.deepEqual(tree.children[0].children, [
		text("a"),
		softBreak,
		softBreak,
		text("b"),
	]);
});

test("a subtree with nothing to keep is not rebuilt", () => {
	const children = [text("no line endings here")];
	const tree = { type: "root", children: [para(children)] };
	remarkSoftBreaks()(tree);
	assert.equal(
		tree.children[0].children,
		children,
		"the same array, not an equal one",
	);
});

test("the walk reaches nested labels and leaves value-bearing nodes alone", () => {
	const fenced = { type: "code", value: "a\nb" };
	const inline = { type: "inlineCode", value: "a\nb" };
	const strong = { type: "strong", children: [text("a\nb")] };
	const tree = { type: "root", children: [fenced, inline, para([strong])] };
	remarkSoftBreaks()(tree);
	assert.deepEqual(fenced, { type: "code", value: "a\nb" });
	assert.deepEqual(inline, { type: "inlineCode", value: "a\nb" });
	assert.deepEqual(strong.children, [text("a"), softBreak, text("b")]);
});

/*
 * ---------------------------------------------------------------------------
 * 2. The pipeline, end to end over the real modules.
 * ---------------------------------------------------------------------------
 *
 * SYNTHETIC VALUES, deliberately: the operator's own message names real
 * addresses and two real store keys. The SHAPE is theirs — the fields on their
 * own lines, a trailing space after the citation and a blank line before the
 * next block — because that shape is what the parser and the transform see.
 */
const payload = (index, key) => ({
	index,
	key,
	value: "x".repeat(19),
	marker: credentialMarker(index, "x".repeat(19)),
});
const CITATION = credentialCitation(payload(1, "LOP_SECRET_PRODKEY01"));
const REPORTED = [
	"Can you add these credentials to lop secrets and appropriately describe them for e2e testing with the Minerva platform, UI logins:",
	"",
	"Prod:",
	"Email: ops@example.com",
	`Password: ${CITATION} `,
].join("\n");

/*
 * The regexes, hoisted because `scripts/`'s lint refuses a literal inside a
 * function body (`useTopLevelRegex`) — and these run once per assertion.
 * `BARE_SOFT_BREAK` below keeps its own comment because its meaning is the
 * claim, not the mechanics.
 */
const PROD_PARAGRAPH = /<p>Prod:[\s\S]*?<\/p>/;
const BREAK_TAG = /<br>/g;
const BREAK_TAG_ANY = /<br>/;
const EMAIL_THEN_PASSWORD_LINES =
	/<br>\nEmail: <a[^>]*>ops@example\.com<\/a><br>\nPassword: /;
const CHIP_HREF = /href="#lo-credential\/LOP_SECRET_PRODKEY01\/19"/;
const CHIP_SENTENCE = /\[credential LOP_SECRET_PRODKEY01 \(19 chars\)/;
const PROD_COLLAPSED = /<p>Prod:\nEmail: /;
const ANSWER_COLLAPSED = /<p>Here is the plan:\nrun the migrations first/;
const SOFT_BREAKS_LAST = /remarkSoftBreaks,?\s*$/;
const SOFT_BREAKS_MENTION = /remarkSoftBreaks/;

/** The one paragraph the reported shape's fields live in. */
const prodParagraph = (html) => {
	const match = PROD_PARAGRAPH.exec(html);
	assert.ok(match, `no Prod paragraph in:\n${html}`);
	return match[0];
};

/**
 * The soft break a browser collapses, left bare: a `\n` in the markup that is
 * not the one every `<br>` handler emits after the element (`<br>\n`). If this
 * matches, at least one line ending is still sitting in a text node and the
 * paragraph will collapse it to a space.
 */
const BARE_SOFT_BREAK = /(?<!<br>)\n/;

test("the reader's turn keeps its lines and its chip", () => {
	const html = render(parseWith(REPORTED, { citations: true, breaks: true }));
	const prod = prodParagraph(html);
	// The two line endings of the Prod block are the two `<br>`s a reader sees,
	// and no bare soft break is left for the browser to collapse.
	assert.equal((prod.match(BREAK_TAG) ?? []).length, 2, prod);
	assert.doesNotMatch(prod, BARE_SOFT_BREAK, prod);
	// The chip survives the transform: the citation link is still the one the
	// citation plugin built, sentence and all.
	assert.match(prod, EMAIL_THEN_PASSWORD_LINES);
	assert.match(prod, CHIP_HREF);
	assert.match(prod, CHIP_SENTENCE);
});

test("the same source WITHOUT the transform is the collapsed shape that was reported", () => {
	const html = render(parseWith(REPORTED, { citations: true, breaks: false }));
	const prod = prodParagraph(html);
	assert.equal((prod.match(BREAK_TAG) ?? []).length, 0, prod);
	// The report, as markup: the fields sit in ONE text run separated by bare
	// newlines, which is exactly what the browser collapses to a space.
	assert.match(prod, PROD_COLLAPSED);
	assert.match(prod, BARE_SOFT_BREAK, prod);
});

test("an agent-side answer keeps CommonMark's collapse - its pipelines never carry the transform", () => {
	const answer = [
		"Here is the plan:",
		"run the migrations first",
		"then restart the workers",
	].join("\n");
	const html = render(parseWith(answer, { citations: false, breaks: false }));
	assert.doesNotMatch(html, BREAK_TAG_ANY);
	assert.match(html, ANSWER_COLLAPSED);
});

/*
 * ---------------------------------------------------------------------------
 * 3. The wiring, in the renderer source.
 * ---------------------------------------------------------------------------
 */

test("the four citation pipelines end with the transform, and the agent-facing four do not", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/components/markdown-renderer.tsx",
		"utf8",
	);
	const arrayBody = (name) => {
		const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(
			source,
		);
		assert.ok(match, `markdown-renderer.tsx no longer defines ${name}`);
		return match[1];
	};
	for (const name of [
		"GFM_AND_CITATIONS",
		"GFM_MATH_AND_CITATIONS",
		"GFM_LINKIFY_AND_CITATIONS",
		"GFM_MATH_LINKIFY_AND_CITATIONS",
	]) {
		assert.match(
			arrayBody(name),
			SOFT_BREAKS_LAST,
			`${name} must carry remarkSoftBreaks as its last plugin`,
		);
	}
	for (const name of [
		"GFM_ONLY",
		"GFM_AND_MATH",
		"GFM_LINKIFY",
		"GFM_MATH_LINKIFY",
	]) {
		assert.doesNotMatch(
			arrayBody(name),
			SOFT_BREAKS_MENTION,
			`${name} is agent-facing and must not keep soft breaks`,
		);
	}
});

// The plugins the scan above looks for are the real exports, so a rename in the
// module cannot sail past it by matching nothing anywhere.
assert.equal(typeof remarkCredentialCitations, "function");
assert.equal(typeof remarkSoftBreaks, "function");
