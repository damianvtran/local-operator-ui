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
 * WHY PER BLOCK AND NOT ONE `dir="auto"` ON THE ROOT. One attribute on the
 * body would let the FIRST strong character of the whole reply decide every
 * paragraph: an Urdu reply that quotes an English line, or an English reply
 * with an Urdu paragraph, would lay the second language out backwards. Each
 * paragraph, heading, list, list item, blockquote, table and cell gets its own
 * `dir="auto"`, so each one resolves from its own first strong character (the
 * HTML "auto" algorithm skips descendants carrying their own `dir`, so inline
 * `<code dir="ltr">` at the start of a paragraph does not decide it).
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
 * CODE STAYS LTR. A fenced block's `<pre>` is pinned `dir="ltr"` (its inner
 * `<code>` already is, see `MARKDOWN_COMPONENTS.code`), so source code never
 * right-aligns or reorders under ur whatever its first character is.
 *
 * NO EXISTING `dir` IS OVERRIDDEN: an author's `dir` on raw HTML (or a future
 * component) wins.
 *
 * STREAMING. This is a pure function of the hast tree, so the streaming
 * renderer's closed blocks, the open tail and the settled full parse all get
 * byte-identical attributes for the same source - the parity
 * `scripts/streaming-markdown-parity.test.mjs` pins - and it adds attributes
 * only, never nodes, so no keyed block changes shape or remounts.
 */
const AUTO_DIRECTION_BLOCKS = new Set([
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

const visit = (node: Root | RootContent): void => {
	if (node.type === "element") {
		const element: Element = node;
		if (element.properties.dir === undefined) {
			if (AUTO_DIRECTION_BLOCKS.has(element.tagName))
				element.properties.dir = "auto";
			else if (element.tagName === "pre") element.properties.dir = "ltr";
		}
	}
	if ("children" in node) for (const child of node.children) visit(child);
};

/** The rehype plugin: `[rehypeBlockDirection]` in a react-markdown pipeline. */
export const rehypeBlockDirection = () => (tree: Root) => {
	visit(tree);
};
