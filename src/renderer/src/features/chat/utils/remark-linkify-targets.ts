/**
 * The remark plugin that turns a path the agent WROTE into a link the reader can
 * press.
 *
 * ## Why a plugin, and not one of the two obvious alternatives
 *
 * The motivating case is dead text: an assistant turn renders
 * `File: ~/workspace/opoint-renewal-2026-09-17/opoint_adverse_media_query_failures_2026-09-17.xlsx
 * (37 KB, 8 sheets)` and nothing in it can be opened. Three routes were on the
 * table and two were refused:
 *
 * - **A string pre-pass** that rewrites `path` into `[path](path)` before
 *   parsing. This is the recorded dead end: `markdown-renderer.tsx` used to
 *   carry `convertUrlsToMarkdownLinks`, which "did nothing, ever" — a text
 *   rewrite cannot tell a path inside a fenced block, inside an existing link's
 *   label, or inside a code span from one in prose, and it corrupts the
 *   document it is supposed to decorate.
 * - **A DOM walk** after render, wrapping text nodes in anchors. It creates
 *   elements React does not own, so the next reconciling render of that
 *   subtree throws or silently reverts the wrap, and it cannot see the source
 *   at all.
 * - **This plugin**, which sees the STRUCTURE. `code`, `link`, `linkReference`,
 *   `definition` and image alt are nodes with types, so "never touch those" is
 *   a guard in the walker rather than a regex that hopes.
 *
 * ## What it admits, and what it deliberately does not
 *
 * The grammar is `link-grammar.ts` — the SAME token grammar the Files panel
 * uses, called with `LINK_POLICY`. The two surfaces differ in exactly TWO
 * admissions, both named on `TargetPolicy` and both measured: the known-extension
 * filter (dropped here, because a link is a rendering of what was written rather
 * than a claim that a file exists) and the fragment guard (kept here, because a
 * bare token that stopped inside a longer name renders an anchor whose claim is
 * wrong). Relative tokens (`notes.md`, `src/foo.ts`) are admitted by NEITHER:
 * with no cwd, admitting one means guessing a root.
 *
 * Two node kinds are rewritten and no others:
 *
 * 1. **`text` nodes**, spliced into `text`/`link` atoms. A `text` node is the
 *    only place a target can hide without already being markup, and markdown's
 *    own links and GFM autolinks are therefore untouched by construction: their
 *    label is a `link` node's child, which this walker never descends into.
 * 2. **`inlineCode` nodes whose ENTIRE value is one admitted target** — yes for
 *    `` `~/x/report.xlsx` ``, no for `` `rm -rf /tmp/x` `` and no for
 *    `` `--out=/tmp/x` ``. A half-span is not linkified because the anchor would
 *    cover the command the reader wrote, and the span that IS linkified keeps
 *    its monospace child, so the machine-voice face (§ 4) survives the wrap.
 *    Fenced and indented code is never touched: `code` holds its text in
 *    `value`, not in children, so there is nothing for the walker to reach.
 *
 * ## The plugin takes no options, and that is a performance decision
 *
 * react-markdown memoises its pipeline against the props it is given, and
 * `MARKDOWN_COMPONENTS`'s own comment records what a per-render literal cost:
 * a new object every render made the memo miss every time and re-parsed the
 * whole document per frame. An options object here would be the same bug one
 * level down, so the plugin is optionless and the module-scope array is built
 * once (see `GFM_LINKIFY` in `markdown-renderer.tsx`); all policy lives
 * downstream, in the component that renders the anchor.
 *
 * ## What the anchor carries
 *
 * `url` is the PATH, never a `file://` URL. The mdast keeps a destination
 * verbatim, so for a DETECTED target this plugin's `url` is already the decoded
 * path - assembled from the scanner's own `target`, not from the token's
 * spelling. What happens AFTER this plugin is react-markdown's business:
 * `remark-rehype`'s `normalizeUri` percent-encodes the destination on its way
 * into hast, and `link-actions.ts`'s classifier is the layer that decodes it back
 * (see that module's header). This plugin knows nothing about that step, which is
 * why it does not try to pre-encode its way around it.
 *
 * A HAND-WRITTEN `[report](file:///tmp/a.pdf)` never reaches this walker at all -
 * it is a `link` node, which the walker refuses to descend into - and it is the
 * renderer's own `urlTransform` that keeps its `file:` scheme alive
 * (`markdown-renderer.tsx`).
 *
 * Pure: no React, no DOM. Asserted by `scripts/link-targets.test.mjs`.
 */

import {
	LINK_POLICY,
	type TargetSpan,
	targetsIn,
} from "@features/chat/utils/link-grammar";

/**
 * The shape this walker needs from mdast, declared here rather than imported.
 *
 * `@types/mdast` and `unified` are transitive dependencies of react-markdown
 * rather than declared ones, and this repository's `node_modules` is pnpm's
 * isolated layout — so an import of them from application source would resolve
 * only by accident. What the walker needs is four fields, and saying so is
 * clearer than borrowing a union of forty node types to read them.
 */
type MdastNode = {
	type: string;
	value?: string;
	/** Set on the `link` atoms this plugin builds; never read from the input. */
	url?: string;
	children?: MdastNode[];
};

/**
 * Node kinds whose children are NEVER rewritten, and why each one is here.
 *
 * This list is the structural half of the plugin's argument: an existing
 * markdown link's label (`link`, `linkReference`), a link's definition
 * (`definition`), an image's alt text (`image`, `imageReference`), and raw
 * markup (`html`) are all things a text rewrite would have walked straight
 * into. `code` is listed for the belt to the braces its `value` already is:
 * it has no children to visit, and naming it here means a future mdast that
 * gave code blocks children would not quietly start linkifying them.
 *
 * The math nodes are here for the same reason `code` is — `remark-math` hands
 * `inlineMath`/`math` values that are LaTeX, where a `/` is a fraction bar
 * rather than a path separator, and `\frac{1}{2}` must never become a link.
 */
const NO_DESCENT = new Set([
	"code",
	"link",
	"linkReference",
	"definition",
	"image",
	"imageReference",
	"html",
	"inlineMath",
	"math",
]);

/** One `link` atom, with the written token as its text child. */
const linkAtom = (url: string, text: string): MdastNode => ({
	type: "link",
	url,
	children: [{ type: "text", value: text }],
});

/** One `link` atom whose child is the original `inlineCode` node. */
const codeLinkAtom = (url: string, code: MdastNode): MdastNode => ({
	type: "link",
	url,
	children: [code],
});

/**
 * One text node's value, as a run of text and link atoms.
 *
 * The slices come straight from the scanner's offsets, so the atoms spell the
 * node's own value exactly — no re-escaping, no re-quoting, and a markdown
 * emphasis marker that happened to abut a path (`\`**\`/tmp/a.pdf\`**\``) stays
 * in the text atom on the correct side of the link.
 */
function atomsFor(value: string): MdastNode[] {
	const targets = targetsIn(value, LINK_POLICY);
	if (targets.length === 0) return [];
	const atoms: MdastNode[] = [];
	let cursor = 0;
	for (const target of targets) {
		if (target.start > cursor) {
			atoms.push({ type: "text", value: value.slice(cursor, target.start) });
		}
		atoms.push(linkAtom(target.href, value.slice(target.start, target.end)));
		cursor = target.end;
	}
	if (cursor < value.length) {
		atoms.push({ type: "text", value: value.slice(cursor) });
	}
	return atoms;
}

/**
 * The one target an inline-code span holds, when the span is nothing else.
 *
 * `start === 0 && end === value.length` is the whole test: an inline-code span
 * is admitted only when the entire span IS the target, which is what keeps
 * `` `--out=/tmp/x` `` and `` `rm -rf /tmp/x` `` literal. A span holding two
 * targets (`` `/a.pdf /b.pdf` ``) is refused for the same reason — the
 * alternative is an anchor per token inside one code span, i.e. a linkified
 * command line, which is exactly the reading the whole-span rule prevents.
 */
function wholeSpanTarget(value: string): TargetSpan | null {
	const targets = targetsIn(value, LINK_POLICY);
	const [only] = targets;
	if (!only || targets.length > 1) return null;
	return only.start === 0 && only.end === value.length ? only : null;
}

/**
 * Rewrite every child list in the tree, once.
 *
 * Depth-first and in place: the walker recurses through `children` for every
 * node that is not on `NO_DESCENT`, rewriting `text` and whole-span
 * `inlineCode` children as it goes. The rewrite SPLICES rather than replaces,
 * so a `text` node holding two targets becomes five siblings — and WHAT COUNTS
 * AS HAVING CHANGED IS A FLAG RATHER THAN A LENGTH, because an atom count is
 * wrong in the one case that made the inline-code half of this plugin silently
 * inert: a linkified `inlineCode` is ONE node replacing ONE node, so a length
 * comparison reads "unchanged" and the rewrite is thrown away.
 */
function walk(node: MdastNode): void {
	const children = node.children;
	if (!children) return;
	const rewritten: MdastNode[] = [];
	let changed = false;
	for (const child of children) {
		if (child.type === "text" && typeof child.value === "string") {
			const atoms = atomsFor(child.value);
			if (atoms.length > 0) {
				rewritten.push(...atoms);
				changed = true;
				continue;
			}
		}
		if (child.type === "inlineCode" && typeof child.value === "string") {
			const target = wholeSpanTarget(child.value);
			if (target) {
				/*
				 * The span keeps its `inlineCode` child: `markdown.css` sets a
				 * linked inline-code span back to the anchor's own colour so the
				 * monospace face does not fight the accent, and dropping the
				 * node here would take the machine-voice face away from a path
				 * the reader was shown in it.
				 */
				rewritten.push(codeLinkAtom(target.href, child));
				changed = true;
				continue;
			}
		}
		if (!NO_DESCENT.has(child.type)) walk(child);
		rewritten.push(child);
	}
	if (changed) node.children = rewritten;
}

/**
 * The plugin. Optionless by design; see this file's header.
 */
export const remarkLinkifyTargets = () => (tree: MdastNode) => {
	walk(tree);
};
