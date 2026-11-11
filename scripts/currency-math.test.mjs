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
 *     a (b)/(c)-rejected closer fails its attempt instead of leaving a span
 *     open across prose (agent review R1-1; QA's rows 10/11/13), and the two
 *     accepted deviations (spaced `$ x $`, digit-led `$2^n$`) are pinned AS
 *     deviations rather than left to drift.
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
			export {
				default as remarkGuardedMath,
				upstreamMathFlow,
				defaultGuardedMathText,
			} from "./src/renderer/src/features/chat/components/markdown-math-guarded";
			export { backslashMathSyntax } from "./src/renderer/src/features/chat/components/markdown-math-backslash";
			export {
				containsRenderableMath,
				hasDigitLedMath,
			} from "./src/renderer/src/features/chat/components/markdown-math";
			export { math } from "micromark-extension-math";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	remarkGuardedMath,
	upstreamMathFlow,
	defaultGuardedMathText,
	backslashMathSyntax,
	containsRenderableMath,
	hasDigitLedMath,
	math,
} = await import(
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

/** The renderer's KaTeX options object and its wiring, as the scan reads them. */
const KATEX_OPTIONS_SOURCE = /const KATEX_OPTIONS = \{([\s\S]*?)\} as const;/;
const KATEX_WIRED = /\[rehypeKatex, KATEX_OPTIONS\]/;

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
			// `throwOnError: false` renders a KaTeX parse error as a
			// `katex-error` span instead of throwing, so a test can assert on the
			// user-visible symptom BY NAME (the red box) rather than by a stack.
			.use(rehypeKatex, { throwOnError: false })
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

/*
 * MONEY VERSUS MATH (operator report, 2026-11-10: "We should be able to
 * differentiate between dollar values like the mention of finances, dollar
 * amounts, etc and latex components"). Guard (d) replaced the blunt
 * digit-led refusal: a digit-led span opens, and is accepted at its closer
 * only when its content carries a TeX signal. Two tables, each asserted
 * through the parser AND the pipeline gate, because they must agree - a
 * document whose only math is digit-led has to switch the pipeline on, and a
 * document of only prices must not.
 */
const MONEY_CORPUS = [
	"It cost $20,000 and $30,000 in total.",
	"from $5 to $10",
	"the fee is $5.00",
	"a $1,000 deposit",
	"$5M seed, $1.2B valuation, $5k bonus",
	"$5M/$1.2B",
	"costs $5 and $10 a month",
	"priced at us$5",
	"it is \\$5 today",
	"between $3–$4 per unit",
	"split $5/$6 evenly",
	"a $5-$10 range",
];

test("the money corpus stays literal and does not switch the pipeline on", () => {
	for (const source of MONEY_CORPUS) {
		const tree = guarded(source);
		assert.equal(nodesOf(tree, "inlineMath").length, 0, source);
		assert.equal(nodesOf(tree, "math").length, 0, source);
		assert.ok(textOf({ children: tree.children }).includes("$"), source);
		assert.equal(containsRenderableMath(source), false, source);
	}
});

const SCREENSHOT_PARAGRAPH =
	"At the scale of tens of centimeters—$10^3\\text{–}10^5\\times$ larger than the robot—flow is inertial, but shrink a battery into $10\\text{ }\\mu\\text{m}^3$ to fight arterial blood flows exceeding $20\\text{ cm/s}$ and $Re \\ll 1$ takes over. The remarkable $200 \\times 300 \\times 50\\text{ }\\mu\\text{m}$ autonomous silicon robots are still wider than a capillary ($8\\text{ }\\mu\\text{m}$), and thermal noise $k_BT$ dominates.";

/** [source, inlineMath values in order] - digit-led spans with a TeX signal. */
const MATH_CORPUS = [
	["$10^3\\text{–}10^5\\times$ larger", ["10^3\\text{–}10^5\\times"]],
	["into $10\\text{ }\\mu\\text{m}^3$ to", ["10\\text{ }\\mu\\text{m}^3"]],
	["exceeding $20\\text{ cm/s}$.", ["20\\text{ cm/s}"]],
	[
		"remarkable $200 \\times 300 \\times 50\\text{ }\\mu\\text{m}$ robots",
		["200 \\times 300 \\times 50\\text{ }\\mu\\text{m}"],
	],
	["a capillary ($8\\text{ }\\mu\\text{m}$)", ["8\\text{ }\\mu\\text{m}"]],
	["the identity $2^n - 1$ is odd", ["2^n - 1"]],
	// Not `$1\\,$gap`: a closer glued to a letter is GUARD (e)'s refusal.
	["thin $1\\,$ gap", ["1\\,"]],
	["index $3_{i}$ here", ["3_{i}"]],
	[
		SCREENSHOT_PARAGRAPH,
		[
			"10^3\\text{–}10^5\\times",
			"10\\text{ }\\mu\\text{m}^3",
			"20\\text{ cm/s}",
			"Re \\ll 1",
			"200 \\times 300 \\times 50\\text{ }\\mu\\text{m}",
			"8\\text{ }\\mu\\text{m}",
			"k_BT",
		],
	],
];

test("digit-led spans with a TeX signal render, and switch the pipeline on alone", () => {
	for (const [source, values] of MATH_CORPUS) {
		const maths = nodesOf(guarded(source), "inlineMath").map((n) => n.value);
		assert.deepEqual(maths, values, source);
		assert.equal(containsRenderableMath(source), true, source);
	}
	// The gate's own digit-led arm, isolated from every other arm: no
	// letter-led span, no `$$`, no backslash delimiter in these.
	assert.equal(hasDigitLedMath("into $10\\text{ }\\mu\\text{m}^3$ to"), true);
	assert.equal(hasDigitLedMath("costs $5 and $2^n$"), true);
	for (const source of MONEY_CORPUS) {
		assert.equal(hasDigitLedMath(source), false, source);
	}
});

test("a digit-led span WITHOUT a signal fails its attempt, like (b)/(c)", () => {
	// `$3 + 4$` is indistinguishable from a price pair by content: literal, and
	// a later genuine span in the same text still parses on its own.
	const source = "so $3 + 4$ and then $x^2$ holds";
	const maths = nodesOf(guarded(source), "inlineMath");
	assert.deepEqual(
		maths.map((n) => n.value),
		["x^2"],
	);
	assert.ok(textOf({ children: guarded(source).children }).includes("$3 + 4$"));
});

test("the screenshot paragraph renders seven formulas and no KaTeX error", async () => {
	const html = await renderWith(remarkGuardedMath, SCREENSHOT_PARAGRAPH);
	assert.equal(html.split('class="katex"').length - 1, 7, html);
	assert.ok(!html.includes("katex-error"), html);
	assert.ok(!html.includes("$"), "no dollar sign may survive as text");
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
 * 4b. A rejected closer FAILS the attempt - no span may cross prose.
 * ---------------------------------------------------------------------------
 */

test("a (b)/(c)-rejected closer fails the attempt, so no span crosses prose", async () => {
	/*
	 * The class agent review round 1 (R1-1) and QA round 1 (Q-1) measured: an
	 * opener passes guard (a), a later closer candidate is rejected by (b) or
	 * (c), and further `$`s exist. Demote-and-continue left the span OPEN, so
	 * the NEXT eligible `$` closed one span whose value contained the rejected
	 * run - `inlineMath("a$5 and $b")`, which KaTeX paints as a red ParseError
	 * where upstream rendered clean spans. The fix fails the attempt: the
	 * opening `$` stays literal and a later `$...$` parses as its own span.
	 */
	const cases = [
		// The reviewer's two shapes:
		["cost $a$5 and $b$ now", "cost $a$5 and ", "b", " now"],
		["cost $x to $y and $z$", "cost $x to $y and ", "z", ""],
		// QA round 1's live rows 10, 11 and 13, verbatim:
		[
			"Closer space: a $x $ stays literal, and $w^2$ renders.",
			"Closer space: a $x $ stays literal, and ",
			"w^2",
			" renders.",
		],
		[
			"Closer digit: a $x$5 stays literal, and $q^2$ renders.",
			"Closer digit: a $x$5 stays literal, and ",
			"q^2",
			" renders.",
		],
		[
			"Tab closer: a $c^2\t$ span is refused, and $u^2$ renders.",
			"Tab closer: a $c^2\t$ span is refused, and ",
			"u^2",
			" renders.",
		],
	];
	for (const [source, before, value, after] of cases) {
		const tree = guarded(source);
		const maths = nodesOf(tree, "inlineMath");
		assert.equal(maths.length, 1, source);
		assert.equal(maths[0].value, value, source);
		assert.ok(
			!maths[0].value.includes("$"),
			`no span may contain a rejected run: ${source}`,
		);
		const children = tree.children[0].children;
		assert.deepEqual(
			children.map((node) => node.type),
			after ? ["text", "inlineMath", "text"] : ["text", "inlineMath"],
			source,
		);
		assert.equal(children[0].value, before, source);
		if (after) assert.equal(children[2].value, after, source);
		// And the user-visible symptom: no KaTeX error box in the HTML.
		const html = await renderWith(remarkGuardedMath, source);
		assert.ok(!html.includes("katex-error"), html);
	}
});

test("the rejected-closer class stays clean across its spellings", async () => {
	// The class as a systematic deck rather than only the reported rows: each
	// fragment is an opener that passes guard (a) followed by a closer
	// candidate that fails (b)/(c); a later clean `$b$` must still parse.
	const fragments = ["$a $", "$a\t$", "$a$5"];
	const deck = [
		...fragments.map((fragment) => `x ${fragment} y $b$ z`),
		`x ${fragments[0]} y ${fragments[1]} z $b$`,
		`x ${fragments[2]} y ${fragments[0]} z $b$`,
	];
	for (const source of deck) {
		const maths = nodesOf(guarded(source), "inlineMath");
		assert.equal(maths.length, 1, source);
		assert.equal(maths[0].value, "b", source);
		const html = await renderWith(remarkGuardedMath, source);
		assert.ok(!html.includes("katex-error"), `${source}\n${html}`);
	}
});

test("the `\\$`-closer red box is upstream's, pinned as a boundary (round 2, R2-2)", async () => {
	/*
	 * The one red-box class the guards do NOT close, pinned as a boundary
	 * rather than fixed: the guards accept a closer whose immediate left
	 * neighbour is an escape-consumed `$`, so a span can end on `<space>\`,
	 * which is invalid LaTeX. The minimal `$a \$b` renders the same
	 * `inlineMath("a \\")` and the same red box under `remark-math` and under
	 * the pre-fix module, so the acceptance is upstream's own scan - not this
	 * file's - and it stays for parity. The fix only REVEALS it in shapes where
	 * the old demote-and-continue hid it behind a longer `%`-masked span
	 * (round 2's fuzz, 7/30,000 strings: `%` plus a `\$` plus a rejected
	 * closer, e.g. `$u % $a \$b`). A future change that treats an
	 * escape-consumed `$` as not a closer should update THIS test, not break it
	 * silently.
	 */
	const core = "$a \\$b";
	assert.deepEqual(bare(guarded(core)), bare(reference(core)), core);
	const coreHtml = await renderWith(remarkGuardedMath, core);
	assert.ok(coreHtml.includes("katex-error"), coreHtml);

	const revealed = "$u % $a \\$b";
	const maths = nodesOf(guarded(revealed), "inlineMath");
	assert.equal(maths.length, 1, revealed);
	assert.equal(maths[0].value, "a \\", revealed);
	const revealedHtml = await renderWith(remarkGuardedMath, revealed);
	assert.ok(revealedHtml.includes("katex-error"), revealedHtml);
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
 * 5b. LaTeX's own delimiters and ```math (2026-11-10).
 * ---------------------------------------------------------------------------
 */

/** The renderer's KaTeX options, mirrored; the wiring test pins the source. */
const KATEX_OPTIONS = {
	throwOnError: false,
	strict: "ignore",
	trust: false,
	errorColor: "var(--lo-danger)",
};
const renderLikeApp = async (source) =>
	String(
		await unified()
			.use(remarkParse)
			.use(remarkGfm)
			.use(remarkGuardedMath)
			.use(remarkRehype)
			.use(rehypeKatex, KATEX_OPTIONS)
			.use(rehypeStringify)
			.process(source),
	);

test("\\(...\\) renders inline math; a lone escaped paren stays a literal paren", () => {
	for (const [source, value] of [
		["see \\(E = mc^2\\) here", "E = mc^2"],
		["padded \\( x \\) value", "x"],
		["tex break \\(a \\\\) b\\) kept", "a \\\\) b"],
		["no signal needed \\(x\\)", "x"],
	]) {
		const maths = nodesOf(guarded(source), "inlineMath");
		assert.deepEqual(
			maths.map((n) => n.value),
			[value],
			source,
		);
	}
	for (const [source, text] of [
		["an escaped \\( paren alone", "an escaped ( paren alone"],
		["empty \\(\\) pair", "empty () pair"],
		["closer first \\) then \\(", "closer first ) then ("],
	]) {
		const tree = guarded(source);
		assert.equal(nodesOf(tree, "inlineMath").length, 0, source);
		assert.equal(textOf({ children: tree.children }), text, source);
	}
});

test("\\[...\\] on its own lines is a display `math` node, inside containers too", () => {
	for (const [source, value] of [
		["Intro\n\\[\nE = mc^2\n\\]\nafter", "E = mc^2"],
		["\\[ x^2 + y^2 \\]", "x^2 + y^2 "],
		[
			"\\[\n\\begin{aligned} a &= b \\\\\n- b & c\n\\end{aligned}\n\\]",
			"\\begin{aligned} a &= b \\\\\n- b & c\n\\end{aligned}",
		],
		["> \\[\n> x^2\n> \\]", "x^2"],
		["- item\n\n  \\[\n  x^2\n  \\]", "x^2"],
	]) {
		const tree = guarded(source);
		assert.deepEqual(
			nodesOf(tree, "math").map((n) => n.value),
			[value],
			source,
		);
		// The `- b & c` line would start a list inside a paragraph.
		assert.equal(nodesOf(tree, "list").length, source.startsWith("- ") ? 1 : 0);
	}
});

test("\\[...\\] mid-paragraph is a display-mode inlineMath; prose brackets stay literal", async () => {
	const tree = guarded("so \\[ a^2 + b^2 = c^2 \\] holds");
	const maths = nodesOf(tree, "inlineMath");
	assert.equal(maths.length, 1);
	assert.equal(maths[0].value, "a^2 + b^2 = c^2");
	assert.deepEqual(maths[0].data.hProperties.className, [
		"language-math",
		"math-display",
	]);
	const html = await renderLikeApp("so \\[ a^2 + b^2 = c^2 \\] holds");
	assert.ok(html.includes('class="katex-display"'), html);
	// Reference markers, editorial brackets and a blank line never typeset.
	for (const [source, text] of [
		["see \\[1\\] and \\[sic\\]", "see [1] and [sic]"],
		["\\[1\\]", "[1]"],
		["\\[citation needed\\] here", "[citation needed] here"],
	]) {
		const t = guarded(source);
		assert.equal(
			nodesOf(t, "inlineMath").length + nodesOf(t, "math").length,
			0,
			source,
		);
		assert.equal(textOf({ children: t.children }), text, source);
	}
	const blank = guarded("\\[\nx^2\n\n\\]");
	assert.equal(
		nodesOf(blank, "math").length + nodesOf(blank, "inlineMath").length,
		0,
	);
});

/** No math node of either kind in the tree, and this exact visible text. */
const assertLiteral = (source, text) => {
	const tree = guarded(source);
	assert.equal(
		nodesOf(tree, "inlineMath").length + nodesOf(tree, "math").length,
		0,
		source,
	);
	if (text !== undefined) {
		assert.equal(textOf({ children: tree.children }), text, source);
	}
};

test("escaped brackets in citation lines, notes and usage lines stay literal (R1-1, R1-2, Q-3)", () => {
	// Agent review round 1, R1-1: the FLOW form read a line that starts with
	// `\[` and ends with `\]` as one equation, because a mid-line `\]` was
	// content and the `]` of an escape counted as a TeX signal.
	for (const [source, text] of [
		["\\[1\\] Smith et al. 2020, \\[2\\]", "[1] Smith et al. 2020, [2]"],
		["\\[sic\\] and \\[1\\]", "[sic] and [1]"],
		[
			"\\[sic\\] is a marker\nmore text \\[1\\]",
			"[sic] is a marker\nmore text [1]",
		],
		// R1-2: escaped punctuation inside `\[...\]` is Markdown, not TeX.
		["before \\[see \\*note\\*\\] after", "before [see *note*] after"],
		["\\[citation\\_needed\\]", "[citation_needed]"],
		// Q-3: `=` and `|` alone no longer qualify a display span.
		[
			"usage: tool \\[--name=VALUE\\] \\[-v|-q\\]",
			"usage: tool [--name=VALUE] [-v|-q]",
		],
		["\\[a + b = c\\]", "[a + b = c]"],
	]) {
		assertLiteral(source, text);
	}
	// R1-1's fourth repro: the reference paragraph is not split by a
	// display block either.
	const refs = guarded(
		"Ref \\[1\\]: see \\[2\\]\n\\[3\\] Jones 2021 \\[web\\]",
	);
	assert.equal(nodesOf(refs, "math").length, 0);
	assert.equal(nodesOf(refs, "paragraph").length, 1);
	// The signals that remain still qualify: a command, a script, a group.
	for (const [source, value] of [
		["\\[\\alpha\\]", "\\alpha"],
		["\\[x^2\\]", "x^2"],
		["\\[\\{1, 2\\}\\]", "\\{1, 2\\}"],
	]) {
		assert.deepEqual(
			nodesOf(guarded(source), "math").map((n) => n.value),
			[value],
			source,
		);
	}
	assert.deepEqual(
		nodesOf(guarded("so \\[a_i\\] holds"), "inlineMath").map((n) => n.value),
		["a_i"],
	);
});

test("a digit-led price never pairs with a later $NAME or crosses prose (Q-1)", () => {
	// QA round 1, Q-1: each typeset the prose between a price and a later
	// shell variable, because an identifier's `_` is a TeX signal.
	for (const source of [
		"Charge $5 per run, then set RUN_COST=$COST in the env.",
		"Costs $5 per `run_id`, cmd=$FOO",
		"$10 per month (see SKU_1)$ wait",
		"Earned $5 on 2024_q1; total=$X",
	]) {
		const tree = guarded(source);
		assert.equal(nodesOf(tree, "inlineMath").length, 0, source);
		assert.equal(containsRenderableMath(source), false, source);
		assert.equal(hasDigitLedMath(source), false, source);
	}
	// The code span survives as code.
	assert.deepEqual(
		nodesOf(guarded("Costs $5 per `run_id`, cmd=$FOO"), "inlineCode").map(
			(n) => n.value,
		),
		["run_id"],
	);
	// Words inside `\text{}` are not prose; a letter-led span is not asked.
	for (const [source, value] of [
		["rate $5\\text{ per month}^2$ here", "5\\text{ per month}^2"],
		["the $2^n - 1$ case", "2^n - 1"],
		["so $x_i$Y", "x_i"],
	]) {
		assert.deepEqual(
			nodesOf(guarded(source), "inlineMath").map((n) => n.value),
			[value],
			source,
		);
		assert.equal(containsRenderableMath(source), true, source);
	}
	// The cost, pinned: a unit glued to a digit-led closer stays literal.
	assertLiteral("thin $1\\,$gap", "thin $1,$gap");
	// The gate and the parser agree on the prose rule's edges.
	for (const [source, parses] of [
		["$5 ab cd x^2$", false],
		["$5 ab, cd x^2$", false],
		["$5 ab x^2$", true],
		["$5 a b^2$", true],
		["$5 \\mu m^2$", true],
		["$5 {ab cd}^2$", true],
	]) {
		assert.equal(
			nodesOf(guarded(source), "inlineMath").length === 1,
			parses,
			source,
		);
		assert.equal(hasDigitLedMath(source), parses, source);
	}
});

test("unclosed \\( and \\[ openers parse in linear time (Q-2)", () => {
	// QA round 1, Q-2 measured 17-49 s for 40 kB of these; each opener used to
	// rescan to the end of its paragraph.
	//
	// Why a ratio to plain remark instead of a wall-clock limit: the old
	// `< 1000 ms` bound failed 2 of 10 runs at load average 30+ (PR #1859 CI
	// flake triage), and single 40 kB parses reached 1786 ms there. A 10 kB vs
	// 40 kB size ratio does not work either: remark-parse + gfm WITHOUT any
	// math plugin already grows ~9x as these inputs double from 24 to 48 kB
	// (23.7 -> 211.9 ms, best of 5, load 30), so the baseline itself looks
	// super-linear. What the Q-2 fix owns is the plugin's cost ON TOP of that
	// baseline, and load slows both parses alike. Measured with this exact
	// check (best of three per side), 10 serial runs x 3 inputs, load 31-36,
	// PR #1859 triage: ratio n=30 median 1.09, max 4.48 (a 91 ms plain
	// outlier); guarded median 415.5 ms, max 1059.4 ms. Negative control,
	// text memo disabled: 101287 ms vs 614 ms plain, ratio 164.9 (QA round 1
	// saw 17-49 s). So `< 8` sits ~1.8x over the worst observed ratio and
	// ~20x under the regression; the 5000 ms ceiling is a backstop ~4.7x over
	// the worst observed parse and ~3x under the quadratic 17 s.
	const plain = (source) =>
		unified().use(remarkParse).use(remarkGfm).parse(source);
	const bestOf = (parse, source) => {
		let best = Number.POSITIVE_INFINITY;
		let tree;
		for (let i = 0; i < 3; i++) {
			const started = performance.now();
			tree = parse(source);
			best = Math.min(best, performance.now() - started);
		}
		return { best, tree };
	};
	for (const unit of ["\\( x ", "\\[ x ", "\\[\nx\n"]) {
		const source = unit.repeat(8000);
		const baseline = bestOf(plain, source).best;
		const { best: elapsed, tree } = bestOf(guarded, source);
		const ratio = elapsed / Math.max(baseline, 1);
		const label = `${JSON.stringify(unit)} x8000: guarded ${elapsed.toFixed(1)} ms, plain ${baseline.toFixed(1)} ms, ratio ${ratio.toFixed(2)}`;
		if (process.env.Q2_TIMING_LOG) console.log(label);
		assert.ok(ratio < 8, `math plugin cost is super-linear: ${label}`);
		assert.ok(elapsed < 5000, `too slow: ${label}`);
		assert.equal(
			nodesOf(tree, "inlineMath").length + nodesOf(tree, "math").length,
			0,
		);
	}
	// The no-closer memo stays inside the paragraph / kind it measured.
	for (const [source, inline, display] of [
		["a \\( b\n\nthen \\(x^2\\)", ["x^2"], []],
		["a \\( b then \\[x^2\\] ok", ["x^2"], []],
		["\\[\na^2\n\n\\[\nx^2\n\\]", [], ["x^2"]],
		["> \\[\n> a^2\n\n\\[\nx^2\n\\]", [], ["x^2"]],
	]) {
		const tree = guarded(source);
		assert.deepEqual(
			nodesOf(tree, "inlineMath").map((n) => n.value),
			inline,
			source,
		);
		assert.deepEqual(
			nodesOf(tree, "math").map((n) => n.value),
			display,
			source,
		);
	}
});

test("backslash delimiters never reach into inline, fenced or indented code", () => {
	for (const [source, type, value] of [
		["code `\\(x\\)` here", "inlineCode", "\\(x\\)"],
		["```tex\n\\[\nx^2\n\\]\n```", "code", "\\[\nx^2\n\\]"],
		["    \\(x\\) indented", "code", "\\(x\\) indented"],
	]) {
		const tree = guarded(source);
		assert.equal(
			nodesOf(tree, "inlineMath").length + nodesOf(tree, "math").length,
			0,
			source,
		);
		assert.equal(nodesOf(tree, type)[0].value, value, source);
	}
});

test("a streaming-truncated message keeps unclosed delimiters literal", () => {
	for (const source of [
		"Partial answer: $x^2 + ",
		"Partial answer:\n\n\\[\nE = mc",
		"Partial \\(E = mc",
	]) {
		const tree = guarded(source);
		assert.equal(
			nodesOf(tree, "inlineMath").length + nodesOf(tree, "math").length,
			0,
			source,
		);
	}
});

test("every display spelling renders one .katex-display, and the gate sees each", async () => {
	for (const source of [
		"$$\nE = mc^2\n$$",
		"\\[\nE = mc^2\n\\]",
		"```math\nE = mc^2\n```",
		"so \\[ E = mc^2 \\] holds",
	]) {
		assert.equal(containsRenderableMath(source), true, source);
		const html = await renderLikeApp(source);
		assert.equal(html.split('class="katex-display"').length - 1, 1, html);
		assert.ok(!html.includes("<pre"), html);
	}
	assert.equal(containsRenderableMath("see \\(x^2\\)"), true);
});

test("invalid TeX renders KaTeX's error span in the theme's danger role", async () => {
	const html = await renderLikeApp("bad \\(\\frac{1}{\\)");
	assert.ok(html.includes("katex-error"), html);
	assert.ok(html.includes("var(--lo-danger)"), html);
	assert.ok(!html.includes("#cc0000"), html);
	// `trust: false`: `\href` does not mint a link.
	const href = await renderLikeApp("link \\(\\href{https://example.com}{x}\\)");
	assert.ok(!href.includes('href="https://example.com"'), href);
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

test("the renderer passes the KaTeX options this file mirrors", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/components/markdown-renderer.tsx",
		"utf8",
	);
	const match = KATEX_OPTIONS_SOURCE.exec(source);
	assert.ok(match, "markdown-renderer.tsx no longer defines KATEX_OPTIONS");
	for (const [key, value] of Object.entries(KATEX_OPTIONS)) {
		assert.ok(match[1].includes(`${key}: ${JSON.stringify(value)},`), key);
	}
	assert.match(source, KATEX_WIRED);
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
	// The count is a DELTA: `remark-gfm` pushes one micromark extension of its
	// own, so "exactly one" is this plugin's addition, not the array's length.
	const base = unified().use(remarkParse).use(remarkGfm).freeze();
	const frozen = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkGuardedMath)
		.freeze();
	const extensions = frozen.data().micromarkExtensions;
	// Two since 2026-11-10: the `$` extension, then LaTeX's backslash
	// delimiters as their own object so the `$` one keeps its identity.
	assert.equal(
		extensions.length,
		base.data().micromarkExtensions.length + 2,
		"the plugin pushes exactly two micromark extensions",
	);
	assert.equal(extensions.at(-1), backslashMathSyntax);
	const extension = extensions.at(-2);
	/*
	 * Identity, not shape (agent review round 1, R1-3): the registered flow IS
	 * the module's exported upstream map, whose `$` entry IS the package's own
	 * display construct (`micromark-extension-math` holds it as a module-level
	 * constant, so a fresh `math()` call hands back the same object); the
	 * registered text tokenizer IS the module's exported default guarded
	 * construct, and is NOT upstream's own text construct.
	 */
	assert.equal(extension.flow, upstreamMathFlow);
	assert.equal(extension.flow[36], math().flow[36]);
	assert.equal(extension.text[36], defaultGuardedMathText);
	assert.notEqual(extension.text[36], math().text[36]);
	assert.equal(extension.text[36].name, "mathText");
});

// The plugin the wiring scan looks for is the real export, so a rename in the
// module cannot sail past it by matching nothing anywhere.
assert.equal(typeof remarkGuardedMath, "function");
