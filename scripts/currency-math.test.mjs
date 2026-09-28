import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * CURRENCY AND MATH IN ONE MESSAGE, pinned at the layer the bug lives at.
 *
 * WHY THIS EXISTS (operator report, 2026-09-27): cost reports rendered as
 * mangled italics and raw LaTeX fragments because `remark-math`'s
 * single-dollar tokenizer has no adjacency rules - once math is on for a
 * message, the `$` of `$0.30/M` and the `$` of a later price pair up into one
 * `inlineMath` node and everything between them is typeset. The fix is
 * `markdown-math-guarded.ts`, which registers upstream's `$$` flow and
 * `mathFromMarkdown` unchanged and vendors the single-dollar text tokenizer
 * with pandoc's documented guards (see that file for the provenance and the
 * reasoning). This file pins the BEHAVIOUR, in four halves each of which can
 * fail on its own:
 *
 *  1. THE GUARDS, over the cases in the report and the ones the deliberate
 *     changes are about: every price stays literal TEXT (not an `inlineMath`
 *     node, `$` visible), a price ahead of a genuine span no longer steals it,
 *     and the two accepted deviations (spaced `$ x $`, digit-led `$2^n$`) are
 *     pinned AS deviations rather than left to drift.
 *  2. THE EQUALITY HALF: for a pure-math corpus, the guarded plugin and
 *     `remark-math` produce IDENTICAL mdast (positions stripped). This is the
 *     half that catches a guard that reaches further than its comment claims -
 *     it is why the corpus must stay dollar-clean of currency.
 *  3. THE UNTOUCHED CASES: inline code, fenced code, `\$` escapes and the
 *     citation-shaped pair stay literal - three of them were already literal
 *     before this change, and the citation pair was NOT (its measured failure
 *     is one of the `-before` frames).
 *  4. THE WIRING, which is a fact about `markdown-renderer.tsx` and source
 *     files rather than a tree: the four math arrays carry the guarded plugin,
 *     the four GFM-only arrays do not, and nothing under `src/` imports
 *     `remark-math` any more - the cheap-precise-half pattern
 *     `soft-breaks.test.mjs` documents. Its limit is the same as its
 *     precision (it sees the file, not the processor the file builds); the
 *     frames in `docs/evidence/chat-math-currency/` are the pixels.
 *
 * REAL: the shipped `markdown-math-guarded.ts`, bundled from source by esbuild
 * and driven through the real `unified` / `remark-parse` / `remark-gfm`
 * modules - the same stack `markdown-renderer.tsx` assembles - with the
 * end-to-end HTML checks rendering through `remark-rehype` + `rehype-katex`,
 * the renderer's own output chain.
 */

const bundle = await build({
	stdin: {
		contents: `
			export { default as remarkGuardedMath } from "./src/renderer/src/features/chat/components/markdown-math-guarded";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { remarkGuardedMath } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const { default: remarkMath } = await import("remark-math");
const { unified } = await import("unified");
const { default: remarkParse } = await import("remark-parse");
const { default: remarkGfm } = await import("remark-gfm");
const { default: remarkRehype } = await import("remark-rehype");
const { default: rehypeKatex } = await import("rehype-katex");
const { default: rehypeStringify } = await import("rehype-stringify");

/** Parse one document with one math plugin, through the renderer's own stack. */
const parseWith = (plugin, source) =>
	unified().use(remarkParse).use(remarkGfm).use(plugin).parse(source);
const guarded = (source) => parseWith(remarkGuardedMath, source);

/**
 * The two literals the import scan reads, hoisted to module scope for the
 * reason this tree's lint states: the walk may run over every source file, so
 * a per-call literal is the call-frequency case the rule exists for.
 */
const SCRIPT_EXTENSION = /\.(ts|tsx|js|jsx|mts|cts)$/;
const REMARK_MATH_SPECIFIER = /["']remark-math["']/;

/** The guarded plugin's own name, as the wiring scan looks for it. */
const GUARDED_PLUGIN = /remarkGuardedMath/;
const reference = (source) => parseWith(remarkMath, source);

/** The rendered HTML, the way the renderer's output chain produces it. */
const renderWith = async (plugin, source) =>
	String(
		await unified()
			.use(remarkParse)
			.use(remarkGfm)
			.use(plugin)
			.use(remarkRehype)
			.use(rehypeKatex)
			.use(rehypeStringify)
			.process(source),
	);

/** Every node of one type in the tree, in document order. */
const nodesOf = (tree, type) => {
	const found = [];
	const walk = (node) => {
		if (node.type === type) found.push(node);
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	return found;
};

/** The visible text of a subtree (values of text/`inlineCode`, children else). */
const textOf = (node) =>
	typeof node.value === "string"
		? node.value
		: (node.children ?? []).map(textOf).join("");

/** The tree without `position` - what `remark-math` and the guards must share. */
const bare = (node) => {
	if (Array.isArray(node)) return node.map(bare);
	if (node && typeof node === "object") {
		const out = {};
		for (const [key, value] of Object.entries(node)) {
			if (key === "position") continue;
			out[key] = bare(value);
		}
		return out;
	}
	return node;
};

/* ---------------------------------------------------------------------------
 * 1. The guards: currency stays literal, once math is on.
 * ---------------------------------------------------------------------------
 */

test("a lone price pair stays literal text, dollar signs visible", () => {
	const source = "Costs are $0.30/M fresh-in and $0.006/M cached-in.";
	const tree = guarded(source);
	assert.equal(nodesOf(tree, "inlineMath").length, 0);
	assert.equal(textOf({ children: tree.children }), source);
});

test("the screenshot's first bullet keeps its bold whole and every amount literal", () => {
	const source =
		"- Exact: an **11-call review = $0.0146 * ($291k input, 264k cached, 4k output)** - matches the published rates ($0.30/M fresh-in, $0.006/M cached-in, $1.20/M out).";
	const tree = guarded(source);
	assert.equal(nodesOf(tree, "inlineMath").length, 0);
	const strongs = nodesOf(tree, "strong");
	assert.equal(strongs.length, 1);
	assert.equal(
		textOf(strongs[0]),
		"11-call review = $0.0146 * ($291k input, 264k cached, 4k output)",
	);
	assert.ok(
		textOf({ children: tree.children }).includes(
			"($0.30/M fresh-in, $0.006/M cached-in, $1.20/M out).",
		),
	);
});

test("the screenshot's second bullet keeps BOTH of its strongs, with the amounts inside them", () => {
	const source =
		"reviews 5-58 (typical ~26), verdicts 5-19 -> **light review $0.015-0.03** . typical $0.03-0.05 . heavy ~$0.07-0.09 . verdict $0.01-0.03 -> blended ~ $0.03-0.05/engagement. **(My earlier estimate of $0.09 was conservatively high by 2-3x.)**";
	const tree = guarded(source);
	assert.equal(nodesOf(tree, "inlineMath").length, 0);
	const strongs = nodesOf(tree, "strong").map(textOf);
	assert.deepEqual(strongs, [
		"light review $0.015-0.03",
		"(My earlier estimate of $0.09 was conservatively high by 2-3x.)",
	]);
});

test("pandoc's classic pair, a hyphen range, and a sentence of prices all stay literal", () => {
	for (const source of [
		"It cost $20,000 and $30,000 in total.",
		"a $5-$10 range, maybe $5-$10M",
		"the total was $5, and then $10.",
	]) {
		const tree = guarded(source);
		assert.equal(nodesOf(tree, "inlineMath").length, 0, source);
		assert.equal(textOf({ children: tree.children }), source);
	}
});

test("prices in table cells stay literal", () => {
	const source =
		"| item | cost |\n| --- | --- |\n| run | $0.03 |\n| heavy | $0.09 |";
	const tree = guarded(source);
	assert.equal(nodesOf(tree, "inlineMath").length, 0);
	const cells = nodesOf(tree, "tableCell").map(textOf);
	assert.ok(cells.includes("$0.03"), JSON.stringify(cells));
	assert.ok(cells.includes("$0.09"), JSON.stringify(cells));
});

test("a price AHEAD of a genuine span no longer steals its opener", () => {
	// The reported shape of the theft: `remark-math` measures
	// `inlineMath("5 now, where ")` + literal `x^2$ holds`; the price is the
	// span's opener there. Here the price is text and the span still parses.
	for (const source of [
		"pay $5 now, where $x^2$ holds",
		"costs $5 and $x^2$ matters",
	]) {
		const tree = guarded(source);
		const maths = nodesOf(tree, "inlineMath");
		assert.equal(maths.length, 1, source);
		assert.equal(maths[0].value, "x^2");
		assert.ok(textOf({ children: tree.children }).includes("$5"), source);
	}
});

test("a trailing lonely dollar is plain text", () => {
	const tree = guarded("the price is $");
	assert.equal(nodesOf(tree, "inlineMath").length, 0);
	assert.equal(textOf({ children: tree.children }), "the price is $");
});

/* ---------------------------------------------------------------------------
 * 2. Genuine math is preserved, and the guarded tokenizer is invisible to it.
 * ---------------------------------------------------------------------------
 */

test("genuine single-dollar spans still parse, including adjacent ones", () => {
	for (const [source, value] of [
		["Where $x^2 + y^2 = z^2$ holds.", "x^2 + y^2 = z^2"],
		["both $a$ and $b$ hold", "a"],
		["$a$-$b$ chain", "a"],
		["the rate ($x$) applies", "x"],
	]) {
		const maths = nodesOf(guarded(source), "inlineMath");
		assert.ok(maths.length >= 1, source);
		assert.equal(maths[0].value, value, source);
	}
	// The second span of `$a$ and $b$` is the one the closer rules could have
	// eaten if (b)/(c) were wrong - pin its count, not just the first span.
	assert.equal(
		nodesOf(guarded("both $a$ and $b$ hold"), "inlineMath").length,
		2,
	);
	assert.equal(nodesOf(guarded("$a$-$b$ chain"), "inlineMath").length, 2);
});

test("display math and inline double-dollar are upstream's, unchanged", () => {
	const display = nodesOf(guarded("$$\nE = mc^2\n$$"), "math");
	assert.equal(display.length, 1);
	assert.equal(display[0].value, "E = mc^2");
	// `$$0.30$$` is NOT currency handling and NOT display: it is upstream's
	// inline span whose open is two dollars. Pinned as the base behaved.
	const inline = nodesOf(guarded("so $$0.30$$ stays"), "inlineMath");
	assert.equal(inline.length, 1);
	assert.equal(inline[0].value, "0.30");
});

/*
 * THE EQUALITY HALF. A pure-math corpus through both plugins; the trees must
 * be identical with positions stripped. This is what keeps the guards honest:
 * any rule that reaches past currency fails here. The corpus carries no
 * currency, no tab-spaced spans and no digit-led single dollars - each of those
 * is a deliberate difference, pinned in its own test instead.
 */
test("the guarded plugin and remark-math produce identical mdast for pure math", () => {
	const corpus = [
		"Where $x^2 + y^2 = z^2$ holds.",
		"both $a$ and $b$ hold",
		"the rate ($x$) applies",
		"$a$-$b$ chain",
		"so $$0.30$$ stays",
		"$$\nE = mc^2\n$$",
		"the fraction $\\frac{1}{2}$ and the sum $\\sum_i x_i$ both parse",
		"**bold with $x^2$ inside**",
		"run `echo $HOME` and then $x$",
	];
	let maths = 0;
	for (const source of corpus) {
		assert.deepEqual(bare(guarded(source)), bare(reference(source)), source);
		maths +=
			nodesOf(guarded(source), "inlineMath").length +
			nodesOf(guarded(source), "math").length;
	}
	// Non-vacuity: a plugin that parsed nothing everywhere would pass the loop.
	assert.ok(maths >= 6, `corpus parsed only ${maths} math nodes`);
});

/* ---------------------------------------------------------------------------
 * 3. Deliberate behaviour changes, pinned AS changes.
 * ---------------------------------------------------------------------------
 */

test("spaced single-dollar math no longer renders - the opener guard's cost", () => {
	// Pandoc-derived rule (a): a span may not open on whitespace. Upstream
	// rendered `$ x + y = z $`; this change documents the trade as accepted,
	// because the same rule is what keeps `$ 50` from opening.
	const source = "the equation $ x + y = z $ holds";
	const tree = guarded(source);
	assert.equal(nodesOf(tree, "inlineMath").length, 0);
	assert.equal(textOf({ children: tree.children }), source);
});

test("digit-led single-dollar math no longer renders - consistent with the gate", () => {
	// The renderer's `containsRenderableMath` already refused a `$` followed by
	// a digit ("a lone dollar sign only counts when it is not followed by a
	// digit" - markdown-math.ts); the parser now agrees with that gate.
	const source = "the identity $2^n - 1$ is odd";
	const tree = guarded(source);
	assert.equal(nodesOf(tree, "inlineMath").length, 0);
	assert.equal(textOf({ children: tree.children }), source);
});

test("tab-spaced math no longer renders - the whitespace guard covers tabs too", () => {
	// Stricter than `remark-math`, deliberately: guard (a)/(b) treat a tab as
	// whitespace, so `$<tab>x$` and `$x<tab>$` stay literal. Upstream (and the
	// prototype this was built from) rendered both.
	for (const source of ["a $\tx$ b", "a $x\t$ b"]) {
		const tree = guarded(source);
		assert.equal(nodesOf(tree, "inlineMath").length, 0, JSON.stringify(source));
		assert.equal(textOf({ children: tree.children }), source);
	}
});

/* ---------------------------------------------------------------------------
 * 4. The cases the change must NOT touch.
 * ---------------------------------------------------------------------------
 */

test("inline code, fenced code and escapes keep their dollars untouched", () => {
	const inline = guarded("run `echo $HOME` then pay $5.99");
	assert.equal(nodesOf(inline, "inlineMath").length, 0);
	const codes = nodesOf(inline, "inlineCode");
	assert.equal(codes.length, 1);
	assert.equal(codes[0].value, "echo $HOME");
	assert.ok(textOf({ children: inline.children }).includes("then pay $5.99"));

	const fenced = guarded('```sh\ncost=$5\necho "$HOME"\n```\nand then $9.99.');
	assert.equal(nodesOf(fenced, "inlineMath").length, 0);
	const blocks = nodesOf(fenced, "code");
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].value, 'cost=$5\necho "$HOME"');
	assert.ok(textOf({ children: fenced.children }).includes("and then $9.99."));

	const escaped = guarded("it is \\$5 and also \\$6 today");
	assert.equal(nodesOf(escaped, "inlineMath").length, 0);
	assert.equal(
		textOf({ children: escaped.children }),
		"it is $5 and also $6 today",
	);
});

test("the citation-shaped pair stays literal - it did NOT before this change", () => {
	// Measured on the base tree: `remark-math` renders this as
	// `inlineMath("LOP_SECRET_ABC; and pay ")` + `text("5.")`. The guards fix
	// it for the same reason they fix a price pair (the closer's left is a
	// space), which is why it is pinned here and framed in the `-before` set.
	const source = "available as $LOP_SECRET_ABC; and pay $5.";
	const tree = guarded(source);
	assert.equal(nodesOf(tree, "inlineMath").length, 0);
	assert.equal(textOf({ children: tree.children }), source);
});

/* ---------------------------------------------------------------------------
 * 5. The rendered HTML: the `$` is VISIBLE and KaTeX is not involved.
 * ---------------------------------------------------------------------------
 */

test("a cost line renders with its dollar signs and its bold, and no KaTeX", async () => {
	const html = await renderWith(
		remarkGuardedMath,
		"- Exact: an **11-call review = $0.0146 * ($291k input, 264k cached, 4k output)** - rates ($0.30/M fresh-in).",
	);
	assert.ok(
		html.includes(
			"<strong>11-call review = $0.0146 * ($291k input, 264k cached, 4k output)</strong>",
		),
		html,
	);
	assert.ok(html.includes("($0.30/M fresh-in)"), html);
	assert.ok(!html.includes("katex"), html);
});

test("a genuine formula still renders through KaTeX", async () => {
	const html = await renderWith(remarkGuardedMath, "Where $x^2$ holds.");
	assert.ok(html.includes("katex"), html);
});

/* ---------------------------------------------------------------------------
 * 6. The wiring, in the renderer source.
 * ---------------------------------------------------------------------------
 */

test("the four math pipelines carry the guarded plugin, and the GFM-only ones do not", () => {
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
		"GFM_AND_MATH",
		"GFM_MATH_LINKIFY",
		"GFM_MATH_AND_CITATIONS",
		"GFM_MATH_LINKIFY_AND_CITATIONS",
	]) {
		assert.match(
			arrayBody(name),
			GUARDED_PLUGIN,
			`${name} must carry the guarded math plugin`,
		);
	}
	for (const name of [
		"GFM_ONLY",
		"GFM_LINKIFY",
		"GFM_AND_CITATIONS",
		"GFM_LINKIFY_AND_CITATIONS",
	]) {
		assert.doesNotMatch(
			arrayBody(name),
			GUARDED_PLUGIN,
			`${name} is not a math pipeline and must not carry it`,
		);
	}
});

test("nothing under src/ imports remark-math any more", () => {
	// `remark-math` stays in devDependencies for ONE reason: the negative
	// control in scripts/credential-capture.test.mjs drives it to reproduce the
	// citation defect on the base pipeline. Under `src/` it must be gone - and
	// what is looked for is the QUOTED SPECIFIER (an import or dynamic import),
	// not the name in prose: half the pipeline's comments cite `remark-math`
	// to explain what this change replaces.
	const offenders = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (!SCRIPT_EXTENSION.test(entry.name)) continue;
			if (REMARK_MATH_SPECIFIER.test(readFileSync(path, "utf8"))) {
				offenders.push(path);
			}
		}
	};
	walk("src");
	assert.deepEqual(offenders, []);
});

test("the plugin registers exactly the guarded text tokenizer over upstream's flow", () => {
	const frozen = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkGuardedMath)
		.freeze();
	const extension = frozen.data().micromarkExtensions.at(-1);
	assert.ok(extension, "the plugin must register a micromark extension");
	assert.ok(
		extension.flow[36],
		"the `$$` flow construct must come from upstream",
	);
	assert.equal(extension.text[36].name, "mathText");
});

// The plugin the wiring scan looks for is the real export, so a rename in the
// module cannot sail past it by matching nothing anywhere.
assert.equal(typeof remarkGuardedMath, "function");
