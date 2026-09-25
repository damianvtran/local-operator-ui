/*
 * THE READER'S OWN SINGLE NEWLINES, KEPT (operator report, 2026-09-25).
 *
 * WHAT THE OPERATOR SAW. A message sent with `Prod:` / `Email: …` /
 * `Password: …` each on its own line reads back in the transcript as ONE line —
 * `Prod: Email: … Password: …` — while the same text sits intact in the
 * session record. The composer showed the operator their own lines; the sent
 * card must not silently re-flow them.
 *
 * THE MECHANISM THIS PLUGIN CLOSES. Inside a paragraph, markdown parses a
 * single newline as a SOFT break: it is not a node, it is a line ending inside
 * a `text` node's value. On the way to the DOM that ending survives as a
 * literal newline in the text node (`mdast-util-to-hast`'s text handler
 * passes it through), and HTML then collapses it to a space — nothing in
 * `markdown.css` sets `white-space: pre-wrap` on prose, only on `code`/`pre`.
 * A HARD break — two trailing spaces, or a trailing backslash — is a different
 * thing: the parser makes it an mdast `break` node, and THAT renders `<br>`,
 * a line the browser keeps. So the fix is to say what the operator meant:
 * every soft break in the tree becomes a `break` node, and the reader's own
 * lines survive the render.
 *
 * WHY HAND-ROLLED. `remark-breaks` is the ecosystem's plugin for exactly this
 * transform, and it is not a dependency of this repository — adding one is a
 * decision this file is not entitled to make. Its whole body reduces to
 * replacing each line ending with a `break` node (`mdast-util-newline-to-break`
 * — the regex is `/\r?\n|\r/g`, and this walker splits on the same three
 * spellings so a pasted body that reached the tree with a CR is normalised
 * rather than left with a stray `\r` beside the break). The walk below is that
 * transform written in this tree's own plugin shape — the one
 * `remark-linkify-targets.ts` and `credential-citation-remark.ts` share:
 * descend `children`, rewrite `text` nodes, hand every other node back
 * untouched. Nothing re-parses or re-serialises the markdown, and a node it
 * does not have to touch is not rebuilt.
 *
 * WHOSE NEWLINES, AND WHY THAT IS A SCOPE DECISION. This transform is wired to
 * the four citation-bearing remark pipelines in `markdown-renderer.tsx`, which
 * are the renderer's user-turn pipelines: `credentialCitations` is turned on by
 * exactly the two callers that render the reader's OWN turn
 * (`canonical-transcript.tsx`, `message-item/message-content.tsx`) and every
 * agent-facing render leaves it off. An agent's answer is a markdown DOCUMENT
 * and keeps CommonMark's soft-break collapse — changing what every model reply
 * looks like is not this report and not this change. Measured across the three
 * shapes on 2026-09-25 (user-with-citations, user-without-citations,
 * agent-side): all three collapsed; exactly the first two are the reader's own
 * words, and `scripts/soft-breaks.test.mjs` pins the transform and that scope.
 *
 * RENDER-ONLY, like the transform beside it. The tree this walks is the
 * markdown pipeline's working copy on the way to the DOM. Nothing here can
 * reach a stored message, a draft, a payload or the session credential store —
 * the text the model was given and the text the transcript holds are the same
 * bytes before and after.
 *
 * ONE INVARIANT, and it is the one the mechanical test pins: the number of
 * line endings is preserved. Each one becomes exactly one `break` node, and a
 * value with an empty part between two endings still emits BOTH breaks
 * (`"a\r\n\r\nb"` stays two lines apart rather than collapsing to one).
 */

/**
 * The node shape this walker reads, spelled structurally.
 *
 * Declared rather than imported for the reason `remark-linkify-targets.ts`
 * states: `@types/mdast` and `unified` are dependencies of `react-markdown`
 * and not of this repository, so an import from application source would
 * resolve only by accident under pnpm's isolated layout. Three fields are all
 * this transform ever reads.
 */
type MdastNode = {
	type: string;
	value?: string;
	children?: MdastNode[];
};

/**
 * The line-ending spellings a value can carry. `remark-breaks`' own regex,
 * hoisted to module scope because this tree's lint refuses a per-call literal —
 * and the walker may run over every text node of every message, so it is the
 * call-frequency case the rule exists for.
 */
const LINE_ENDING = /\r?\n|\r/;

/** Whether a value carries any line ending at all; the walk's cheap gate. */
const HAS_LINE_ENDING = /[\r\n]/;

/**
 * One `text` node's value, split at its line endings.
 *
 * The break belongs BETWEEN the parts: the first part has none before it, and
 * every later part brings one even when the part itself is empty, which is what
 * makes the count invariant hold. Empty parts are not emitted as empty text
 * nodes — they render nothing, and `remark-breaks` drops them too.
 */
const softBreakNodes = (value: string): MdastNode[] => {
	const parts = value.split(LINE_ENDING);
	const nodes: MdastNode[] = [];
	for (const [index, part] of parts.entries()) {
		if (index > 0) nodes.push({ type: "break" });
		if (part !== "") nodes.push({ type: "text", value: part });
	}
	return nodes;
};

/**
 * The plugin. Optionless by design, like its two siblings: everything that
 * varies between callers is a property of the pipeline the caller assembles,
 * not of the walk.
 */
export const remarkSoftBreaks =
	() =>
	(tree: MdastNode): void => {
		const walk = (node: MdastNode): void => {
			if (!node.children) return;
			let replaced = false;
			const next: MdastNode[] = [];
			for (const child of node.children) {
				if (
					child.type === "text" &&
					typeof child.value === "string" &&
					HAS_LINE_ENDING.test(child.value)
				) {
					next.push(...softBreakNodes(child.value));
					replaced = true;
					continue;
				}
				walk(child);
				next.push(child);
			}
			// A subtree with no soft break is handed back as the SAME nodes, so a
			// message that has nothing to keep is walked once and touched nowhere.
			if (replaced) node.children = next;
		};
		walk(tree);
	};
