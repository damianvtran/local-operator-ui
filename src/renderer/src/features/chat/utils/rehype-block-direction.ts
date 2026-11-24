import type { Element, Root, RootContent } from "hast";

/**
 * Per-BLOCK text direction for rendered markdown (i18n census N2).
 *
 * THE FAULT. A transcript body inherited the document's direction, so under an
 * RTL interface language (ur) an ENGLISH reply was laid out right-to-left and
 * its trailing punctuation jumped to the wrong end: "Hello from the mock
 * provider!" painted as "!Hello from the mock provider". The text is the
 * agent's (or the operator's), not the interface's, and its script need not
 * match the interface language - the same reasoning as `userTextDir`
 * (`shared/i18n/user-text-dir.ts`), applied to flowing prose.
 *
 * WHY PER BLOCK AND NOT ONE DIRECTION FOR THE ROOT. One direction for the body
 * would let the FIRST strong character of the whole reply decide every
 * paragraph: an Urdu reply that quotes an English line, or an English reply
 * with an Urdu paragraph, would lay the second language out backwards. Each
 * paragraph, heading, list, list item, blockquote, table and cell resolves
 * its own direction from its own first strong character.
 *
 * WHY AN EXPLICIT `rtl`/`ltr` AND NOT `dir="auto"` (design review round 1,
 * D1). The HTML "auto" algorithm SKIPS descendants that carry their own `dir`.
 * With `dir="auto"` on a container AND on each of its items, cells and quoted
 * paragraphs, a `ul`/`table`/`blockquote` saw no strong character at all and
 * fell back to ltr: an Urdu reply's table had its columns reversed, its quote
 * rule sat on the left and its bullets hung outside the column. So the
 * direction is computed HERE, with the same first-strong rule the browser
 * would use, over the element's whole text content (its children included),
 * and written as a concrete value. Still a pure function of the hast tree.
 *
 * A BLOCK WITH NO STRONG CHARACTER GETS NO `dir` - a "42" or `npm install`
 * list item, a number cell. It then INHERITS its container's direction; an
 * explicit (or "auto") value would default it to ltr and put one item's
 * bullet on the other side of an Urdu list.
 *
 * WHAT DOES NOT COUNT TOWARDS A BLOCK'S DIRECTION: code (`pre`, `code`), KaTeX
 * output (`.katex`, `.katex-display`) and anything that already carried a
 * `dir` before this plugin ran. Code and math are notation, not prose: a
 * paragraph that opens with `ls` or $x^2$ is still an Urdu paragraph if its
 * words are Urdu (QA round 1, Q-1).
 *
 * ALIGNMENT FOLLOWS THE BLOCK'S RESOLVED DIRECTION, deliberately: these
 * elements keep the default `text-align: start` (and `markdown.css` uses
 * logical `padding-inline-start` / `border-inline-start` / `text-align: start`
 * for lists, quotes and cells), so an English paragraph inside an Urdu
 * interface is left-aligned and ragged-right like any English text, and an
 * Urdu paragraph is right-aligned. `USER_TEXT_ALIGN`'s locale-edge rule is for
 * a single-line LABEL sitting beside an icon it names; a multi-line body
 * aligned to the locale's edge would leave English prose ragged on its
 * starting side, which is harder to read than a block that sits on its own
 * start edge.
 *
 * CODE AND MATH STAY LTR. A fenced block's `<pre>` is pinned `dir="ltr"` (its
 * inner `<code>` already is, see `MARKDOWN_COMPONENTS.code`; a fence still
 * streaming is painted by `OpenFenceBody`, which pins both itself), so source
 * code never right-aligns or reorders under ur whatever its first character
 * is. KaTeX's `.katex` / `.katex-display` span is pinned `dir="ltr"` too; an
 * element with a `dir` attribute is `unicode-bidi: isolate` in the UA sheet
 * (and `markdown.css` says so explicitly), so an inline formula is one LTR
 * island inside an RTL sentence.
 *
 * NO EXISTING `dir` IS OVERRIDDEN: an author's `dir` on raw HTML (or a future
 * component) wins.
 *
 * STREAMING. This is a pure function of the hast tree, so the streaming
 * renderer's closed blocks, the open tail and the settled full parse all get
 * byte-identical attributes for the same source - the parity
 * `scripts/streaming-markdown-parity.test.mjs` pins - and it adds attributes
 * only, never nodes, so no keyed block changes shape or remounts. A paragraph
 * still streaming that has no letter yet (`**`, `1.`) carries no `dir` and
 * gains one when its first letter arrives: an attribute change, not a remount.
 */
const DIRECTION_BLOCKS = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"blockquote",
	"table",
	"th",
	"td",
	"dt",
	"dd",
]);

/*
 * The strong-character classes of the Unicode bidi algorithm, as the browser's
 * "auto" rule reads them: a LETTER is strong, right-to-left when it sits in the
 * Hebrew/Arabic/Syriac/Thaana/NKo blocks, their presentation forms or the RTL
 * supplementary blocks (the same ranges as `RTL_CHAR` in `src/i18n/bidi.ts`,
 * restated because that module pulls in the locale store), left-to-right
 * otherwise. Digits (Arabic-Indic ones included), punctuation, marks and
 * spaces are weak or neutral and never decide. RLM/LRM are strong too.
 */
const RTL_BLOCK =
	/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
const LETTER = /\p{L}/u;

type Direction = "ltr" | "rtl";

const strongDirection = (text: string): Direction | undefined => {
	for (const char of text) {
		if (char === "\u200F") return "rtl";
		if (char === "\u200E") return "ltr";
		if (LETTER.test(char)) return RTL_BLOCK.test(char) ? "rtl" : "ltr";
	}
	return undefined;
};

const classNames = (element: Element): readonly unknown[] => {
	const value = element.properties.className;
	return Array.isArray(value) ? value : [];
};

const isMath = (element: Element): boolean =>
	classNames(element).some(
		(name) => name === "katex" || name === "katex-display",
	);

/**
 * Notation and author-directed subtrees: they neither decide an enclosing
 * block's direction nor (for code/math) take one from it. Read BEFORE this
 * plugin writes any `dir` below the element (the walk is pre-order), so a `dir`
 * seen here is one the author or an earlier plugin set.
 */
const isOpaque = (element: Element): boolean =>
	element.tagName === "pre" ||
	element.tagName === "code" ||
	isMath(element) ||
	element.properties.dir !== undefined;

/** First strong direction in document order, skipping opaque subtrees. */
const firstStrong = (node: Root | RootContent): Direction | undefined => {
	if (node.type === "text") return strongDirection(node.value);
	if (node.type === "element" && isOpaque(node)) return undefined;
	if ("children" in node)
		for (const child of node.children) {
			const found = firstStrong(child);
			if (found) return found;
		}
	return undefined;
};

const visit = (node: Root | RootContent): void => {
	if (node.type === "element") {
		const element: Element = node;
		if (element.properties.dir === undefined) {
			if (DIRECTION_BLOCKS.has(element.tagName)) {
				// Pre-order: the children have no plugin-written `dir` yet, so
				// the container reads every item's text (the D1 fault).
				let direction: Direction | undefined;
				for (const child of element.children) {
					direction = firstStrong(child);
					if (direction) break;
				}
				if (direction) element.properties.dir = direction;
			} else if (element.tagName === "pre" || isMath(element)) {
				element.properties.dir = "ltr";
				// Nothing inside code or a formula is prose to resolve.
				return;
			}
		}
	}
	if ("children" in node) for (const child of node.children) visit(child);
};

/** The rehype plugin: `[rehypeBlockDirection]` in a react-markdown pipeline. */
export const rehypeBlockDirection = () => (tree: Root) => {
	visit(tree);
};
