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
 * The grammar is `link-grammar.ts` - the SAME token grammar the Files panel
 * uses, called with `LINK_POLICY_EVIDENCED` below. The two surfaces differ in
 * exactly THREE admissions, all named on `TargetPolicy` and all measured: the
 * known-extension filter (dropped here, because a link is a rendering of what
 * was written rather than a claim that a file exists), the fragment guard (kept
 * here, because a bare token that stopped inside a longer name renders an anchor
 * whose claim is wrong), and the EVIDENCE gate (dropped here because the
 * linkifier can ask the disk, which is what the extension filter stands in for
 * on the panel's side). That third one is this file's job to supply: the
 * renderer has one "does it exist" knowledge - the probe cache the link toolbar
 * already fills - and `LINK_POLICY_EVIDENCED` injects it, so `/new` in a
 * sentence about starting a conversation stays plain text instead of rendering
 * an anchor that answers `No file at /new`. Relative tokens (`notes.md`,
 * `src/foo.ts`) are admitted by NEITHER: with no cwd, admitting one means
 * guessing a root.
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
 * WHAT IS MEASURED (react-markdown 10.1.0, in jsdom, for this change): the
 * pipeline re-runs on every render - `Markdown(options)` calls `createProcessor`
 * and `runSync` each time - so the bound on re-parsing is this repo's own
 * `memo()` on the components that hold `<ReactMarkdown>`, not any identity this
 * module hands over. What an options object would cost TODAY is therefore one
 * object per render, not a cache miss, and this paragraph is written that way
 * rather than repeating the memo argument the plugin and the hoisted arrays were
 * first built on.
 *
 * The plugin stays optionless anyway, for two reasons that survive the
 * measurement: an option that CHANGED what is linkified would have to be part of
 * the pipeline's identity, which is the coupling this shape avoids; and the
 * module-scope array (`GFM_LINKIFY`) is the shape a future react-markdown
 * restoring an internal memo would read. All policy lives downstream - in the
 * component that renders the anchor, and in `LINK_POLICY_EVIDENCED` below.
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

import { evidenceFor } from "@features/chat/utils/link-actions";
import {
	LINK_POLICY,
	type TargetPolicy,
	type TargetSpan,
	allowsProsePathAfter,
	targetsIn,
} from "@features/chat/utils/link-grammar";

/**
 * The policy this walker actually runs, which is the linkifier's plus the disk.
 *
 * ONE module-scope constant, because building it per call would hand the grammar
 * a fresh object per node - cheap in itself, but the shape that makes "the
 * policy is one decision a reviewer can see" true is a constant rather than an
 * expression buried in two call sites.
 *
 * `evidenceFor` reads the probe cache the link toolbar fills, so a spelling the
 * reader already hovered is answered from memory and a spelling nobody has asked
 * about answers `unknown`, which the grammar's gate REFUSES. Plain text until
 * the disk says otherwise is the direction this module trades in throughout (a
 * missing link, never an anchor whose claim is wrong); the probe that fills the
 * cache for the transcript's own rows is issued by `useLinkEvidence` in
 * `markdown-renderer.tsx`, inside the component that owns the parse.
 *
 * The import direction is deliberate and one-way: a grammar that imported this
 * module would stop being importable by a bare `node --test`, which is the whole
 * reason the oracle is injected rather than called.
 *
 * THE SECOND GATE, and why it is not part of this policy: an ambiguous target the
 * pre-scan could not have named is refused before the oracle is consulted at all
 * (`allowsProsePathAfter`, applied by `atomsFor` to the source character before a
 * node's first character). The disk is the only authority on whether an
 * extensionless token exists, but the ASK is the renderer's - `useLinkEvidence`
 * asks about `ambiguousTargetsIn`'s suspects and nothing else - so a spelling
 * outside that set has no answer of its own to inherit and must not be linked.
 * Round 1's review R1-4 measured what it inherited instead: the anchor's presence
 * depended on whether another row had primed the cache.
 */
const LINK_POLICY_EVIDENCED: TargetPolicy = {
	...LINK_POLICY,
	evidence: evidenceFor,
};

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
	/**
	 * The node's own offsets in the source, read for ONE question.
	 *
	 * A node value starts where markdown decided it starts, and markdown CONSUMES
	 * the characters it stood between: `_/Users/x/workspace_` reaches this walker as
	 * a single text node whose value begins at index 0 with `/Users/x/workspace`.
	 * The scanner's predecessor rule cannot run on that value, because index 0 has
	 * no preceding character inside it - so the walker reads the SOURCE instead
	 * (`predecessorOf`). Only `start.offset` is used; nothing here is rendered, and
	 * a tree without positions simply keeps the pre-existing behaviour.
	 */
	position?: { start?: { offset?: number } };
};

/**
 * The one field of the parsed file this walker needs: the markdown it parsed.
 *
 * Declared structurally rather than imported, for the reason `MdastNode` is -
 * see below. `react-markdown` hands its transformer a `VFile` whose `value` is
 * the source (`createFile`), which is what makes the predecessor question
 * answerable at all.
 */
type ParsedFile = { value?: unknown };

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
 * The source character a node's first character follows, when it can be known.
 *
 * `undefined` covers the two cases the rule must not act on: a node at offset 0
 * follows nothing at all (the same case `targetsIn` treats as a legal start), and
 * a tree carrying no positions - one built by hand rather than parsed - has no
 * source to read. Both take `allowsProsePathAfter(undefined)` = true, which is
 * this walker's behaviour before the rule existed. The production pipeline always
 * has both, so the tolerant branch is for callers who never had the rule.
 */
function predecessorOf(
	node: MdastNode,
	source: string | undefined,
): string | undefined {
	const offset = node.position?.start?.offset;
	if (source === undefined || typeof offset !== "number") return undefined;
	return source[offset - 1];
}

/**
 * One text node's value, as a run of text and link atoms.
 *
 * The slices come straight from the scanner's offsets, so the atoms spell the
 * node's own value exactly - no re-escaping, no re-quoting, and a markdown
 * emphasis marker that happened to abut a path (`\`**\`/tmp/a.pdf\`**\``) stays
 * in the text atom on the correct side of the link.
 *
 * `rest` IS THE NEXT SIBLING'S FIRST WORD, and scanning `value + rest` is what
 * stops a token that the MARKDOWN SPLIT from being linked as if it were whole:
 * `write to /tmp/<name>.json` is one string to the scanner and correctly refused
 * as a placeholder, but mdast hands the walker `text("write to /tmp/")`,
 * `html("<name>")`, `text(".json")` - three nodes - and a per-node scan sees a
 * complete token `/tmp/` and links it. The guard that exists for exactly this
 * (`isFragment`, in the grammar) cannot see past a node boundary.
 *
 * WHAT THE `rest` SCAN IS FOR, and what it costs. Only targets that END INSIDE
 * this node survive the filter below (`end <= value.length`): a token that the
 * concatenation completes or extends - `/Users/x/rep` plus `` `ort.md` `` -
 * belongs to the next node as much as to this one, so it is refused rather than
 * half-linked. The trade is narrow on purpose: a token followed by WHITESPACE
 * before the boundary (the ordinary `See /tmp <b>bold</b>` shape, whose text node
 * ends in the space) is untouched, and so is one followed by a node with no text
 * of its own (`**bold**`, an image), because `continuation` answers "" for those.
 * What it refuses, and states here because it is a real false negative: a token
 * glued to an inline HTML or code node that closes before any whitespace
 * (`See /tmp<b>bold</b>`) stops linking - the same trade `isPlaceholderTail`
 * documents on the grammar's side.
 */
function atomsFor(
	value: string,
	rest = "",
	predecessor: string | undefined = undefined,
): MdastNode[] {
	const targets = targetsIn(value + rest, LINK_POLICY_EVIDENCED).filter(
		(target) =>
			target.end <= value.length &&
			/*
			 * THE PREDECESSOR TEST AT INDEX 0, which is the one position a node value
			 * cannot answer for itself: `targetsIn` applies the rule to the character
			 * before a token in the string it is handed, so a value that BEGINS with a
			 * token has no predecessor for it to read, while the raw document the
			 * pre-scan reads has the character markdown consumed. Round 1's review R1-4
			 * measured the consequence: `ambiguousTargetsIn` on `_/Users/x/workspace_`
			 * returns `[]`, so nothing asks the disk, and the anchor appeared only when
			 * another row had already asked about that spelling - a link whose existence
			 * depended on unrelated cache state. `allowsProsePathAfter` reads the SOURCE's
			 * own character, so such a token is refused here in every case.
			 */
			(target.start !== 0 || allowsProsePathAfter(predecessor)),
	);
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
 *
 * NO PREDECESSOR TEST HERE, which is not an exemption but a consequence: the raw
 * scanner meets this target at the code span's opening backtick, and a backtick is
 * in `ALLOWED_PREFIX`, so the asker can always name what this returns and the
 * test `atomsFor` applies at index 0 can never fail for it.
 */
function wholeSpanTarget(value: string): TargetSpan | null {
	const targets = targetsIn(value, LINK_POLICY_EVIDENCED);
	const [only] = targets;
	if (!only || targets.length > 1) return null;
	return only.start === 0 && only.end === value.length ? only : null;
}

/** Where a following node's contribution to a token stops. */
const CONTINUATION_BREAK = /\s/;

/**
 * The first word of the next sibling's text, or "" when there is none.
 * Only the FIRST whitespace-delimited run: the walker wants to know what the
 * scanner would have seen as one token continuing past this node's end, and a
 * following node's whole text (`ort.md and here is more prose`) would put
 * unrelated words inside the scan window. A sibling with no `value` of its own -
 * `strong`, `emphasis`, an image - answers "" rather than recursing into its
 * children, because the character immediately after this node is that sibling's
 * MARKER (`*`, `_`, `![`), not its rendered text, and a scanner run over the
 * marker would decide the fragment question from a `*`.
 */
const continuation = (
	children: readonly MdastNode[],
	index: number,
): string => {
	const next = children[index + 1];
	if (!next || typeof next.value !== "string") return "";
	return next.value.split(CONTINUATION_BREAK, 1)[0] ?? "";
};

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
function walk(node: MdastNode, source: string | undefined): void {
	const children = node.children;
	if (!children) return;
	const rewritten: MdastNode[] = [];
	let changed = false;
	for (const [index, child] of children.entries()) {
		if (child.type === "text" && typeof child.value === "string") {
			const atoms = atomsFor(
				child.value,
				continuation(children, index),
				predecessorOf(child, source),
			);
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
		if (!NO_DESCENT.has(child.type)) walk(child, source);
		rewritten.push(child);
	}
	if (changed) node.children = rewritten;
}

/**
 * The plugin. Optionless by design; see this file's header.
 */
export const remarkLinkifyTargets =
	() => (tree: MdastNode, file?: ParsedFile) => {
		/*
		 * The source travels with the tree rather than being read off it, because the
		 * predecessor test needs a character the node value no longer holds (see
		 * `predecessorOf`). `react-markdown` passes the parsed `VFile`, whose `value`
		 * is what was parsed; a caller that passes nothing gets the tolerant branch.
		 */
		walk(tree, typeof file?.value === "string" ? file.value : undefined);
	};
