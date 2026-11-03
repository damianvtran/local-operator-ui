/**
 * The remark plugin that paints a `$skill` the reader's own turn invoked.
 *
 * ## What it is for
 *
 * A user turn that fired a skill reads back as plain prose: `use $research then
 * $code-review` shows the sigil and the name in the bubble's body colour, so
 * nothing says which words are the skill (operator ask, 2026-11-03). The
 * composer already paints the same token (`slash-highlight.ts`,
 * `RUN_INK.skill`) and the sealed row paints it too (`text-token-command
 * slash-run-bold`); this is the transcript's half of the same decision, so what
 * the composer showed survives the send.
 *
 * ## Which tokens ink: the ones the message ATTACHED, and no others
 *
 * `names` is the skills the turn's `<operator-skills>` block carries
 * (`skillBlockNames`), read from the RECORD because the row paints the text with
 * that block stripped. No names, no work: an ordinary turn - and every agent row,
 * which never passes names - is returned untouched. A prose `$name` in a turn
 * that attached nothing stays plain, on purpose: the vocabulary is what decides
 * whether a token FIRED, and this plugin has no vocabulary of its own.
 *
 * The grammar is `skillMentionSpans` run on the SOURCE the parser read
 * (`file.value`), not on text nodes. That is what makes the boundary rule right
 * without a special case: `\$research` reaches the walker as a text node holding
 * `$research` with the backslash already consumed, so a scan over node values
 * would ink it; the scan over the source sees the `\` before the `$` and refuses
 * it, exactly as the composer's ink and the submit path do. Each mention is then
 * mapped onto the text node whose source range holds it.
 *
 * ## Where it must sit
 *
 * FIRST in the user-turn pipelines, before `remarkLinkifyTargets`,
 * `remarkCredentialCitations` and `remarkSoftBreaks`. The mapping reads each
 * node's `position` offsets into `file.value`, and those three plugins emit text
 * nodes with no `position` at all (see `predecessorOf` in
 * `remark-linkify-targets.ts`); run after them, a node has nothing to map by.
 * The pieces this plugin emits DO carry offsets, so the plugins behind it still
 * read their predecessor character from the source. One consequence is visible:
 * a token glued to a path (`$research/tmp/a.txt`) now reaches the linkifier as
 * two nodes, so `/tmp/a.txt` is its own node and gets linked. That is arguably
 * right - `$research/...` already fires the skill on submit - and it is the only
 * change in what the plugins behind this one see.
 *
 * ## What it never touches
 *
 * `code`, `inlineCode`, `inlineMath`, `math`, `html`, and the labels of links,
 * references and images: a `$research` in a fence or a code span is something
 * the reader quoted, not something they invoked. Money (`$5`, `$1,200.50`), a
 * shell variable (`$PATH`), a lone `$` and a glued `costs$5` are not tokens
 * because the grammar says so, not because of a list here.
 *
 * ## DOM shape, and why nothing is inserted
 *
 * One `span.lo-skill-token` whose only child is a text node holding the typed
 * characters. A `value` on the node without `children` renders an EMPTY span
 * (measured), so the text rides as a child. No pseudo-element, no `content:`, no
 * `text-transform`: selecting and copying the bubble yields the typed line, and
 * the app's own Copy and Quote read the record rather than the DOM
 * (`canonical/transcript-copy.ts`).
 *
 * RENDER-ONLY: this walks the pipeline's working copy of the tree. Nothing here
 * can reach a stored message or the text the model was given.
 */

import {
	skillBlockSpans,
	skillMentionSpans,
} from "../components/skill-invocation";

/**
 * The node shape this walker reads, spelled structurally for the reason
 * `remark-linkify-targets.ts` states: `@types/mdast` is a dependency of
 * `react-markdown`, not of this repository.
 */
type MdastNode = {
	type: string;
	value?: string;
	children?: MdastNode[];
	data?: { hName?: string; hProperties?: Record<string, unknown> };
	position?: { start?: { offset?: number }; end?: { offset?: number } };
};

type ParsedFile = { value?: unknown };

/** The class the stylesheet keys the ink on (`markdown.css`). */
export const SKILL_TOKEN_CLASS = "lo-skill-token";

/** Node kinds whose children (or value) are never rewritten; see the header. */
const NO_DESCENT = new Set([
	"code",
	"inlineCode",
	"inlineMath",
	"math",
	"html",
	"link",
	"linkReference",
	"definition",
	"image",
	"imageReference",
]);

/** A character a backslash may escape in CommonMark (ASCII punctuation). */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/** A character reference as the source spells it; what it DECODES to is not known here. */
const ENTITY =
	/^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/;

/**
 * How many UTF-16 units one character reference may decode to. Every numeric
 * reference is 1 or 2, and so is every HTML5 named one (`&fjlig;` is `fj`,
 * `&Afr;` is an astral pair); 4 leaves room without making the search wide.
 */
const MAX_ENTITY_UNITS = 4;

/** Branch visits one node may spend on entity ambiguity before it gives up. */
const ENTITY_BUDGET = 4096;

const isBlank = (char: string | undefined): boolean =>
	char === " " || char === "\t";

/**
 * The source offset of each character of a text node's value, or `null` when the
 * two cannot be aligned with certainty.
 *
 * A value is the source with markdown's own consumption applied. The cases this
 * undoes, each of which the parser performs and a naive offset arithmetic does
 * not:
 *
 * - `\$` is one character in the value and two in the source;
 * - blanks before a line ending are dropped (`first \nsecond`), and so are the
 *   blanks, and in a blockquote the `>` markers, that open a continuation line;
 * - a character reference (`&amp;`, `&#35;`) is several source characters and one
 *   or two value characters.
 *
 * The first two are deterministic. The third is not: nothing in this module
 * knows the named-reference table, so the decoded width of `&name;` is searched
 * (1 to {@link MAX_ENTITY_UNITS} units) and the alignment is accepted ONLY when
 * exactly one reading consumes the node's whole source range. Two readings, an
 * exhausted budget, or none is `null`: the node gets NO ink rather than ink on
 * the wrong characters.
 */
const alignValue = (
	value: string,
	source: string,
	start: number,
	end: number,
): number[] | null => {
	if (end - start === value.length && source.startsWith(value, start)) {
		return Array.from({ length: value.length }, (_, index) => start + index);
	}
	const offsets: number[] = [];
	let solution: number[] | null = null;
	let solutions = 0;
	let budget = ENTITY_BUDGET;
	let exhausted = false;

	// Deterministic from `(index, cursor)` until a character reference forks it, so
	// recursion depth is the number of references and never the node's length.
	const run = (from: number, resume: number): void => {
		let cursor = resume;
		for (let index = from; index < value.length; index++) {
			const char = value[index];
			const previous = value[index - 1];
			if (char === "\n" || char === "\r") {
				// The parser drops blanks that trail a line.
				while (isBlank(source[cursor])) cursor += 1;
			} else if (previous === "\n" || previous === "\r") {
				/*
				 * A continuation line's leading blanks are consumed too, and inside a
				 * blockquote its `> ` markers. A `>` the value itself holds at the
				 * line start is never skipped, so a literal one cannot be eaten.
				 */
				while (
					isBlank(source[cursor]) ||
					(source[cursor] === ">" && char !== ">")
				) {
					cursor += 1;
				}
			}
			if (source[cursor] === "&") {
				const reference = ENTITY.exec(source.slice(cursor, end));
				if (reference) {
					for (let units = 1; units <= MAX_ENTITY_UNITS; units++) {
						if (budget-- <= 0) exhausted = true;
						if (solutions > 1 || exhausted) return;
						if (index + units > value.length) break;
						const kept = offsets.length;
						for (let unit = 0; unit < units; unit++) offsets.push(cursor);
						run(index + units, cursor + reference[0].length);
						offsets.length = kept;
					}
				}
			}
			if (
				source[cursor] === "\\" &&
				source[cursor + 1] === char &&
				ASCII_PUNCTUATION.test(char)
			) {
				offsets.push(cursor + 1);
				cursor += 2;
			} else if (source[cursor] === char) {
				offsets.push(cursor);
				cursor += 1;
			} else {
				return;
			}
		}
		// Whatever source is left in the node must be blanks the parser trimmed.
		for (let rest = cursor; rest < end; rest++) {
			if (!isBlank(source[rest])) return;
		}
		if (cursor > end) return;
		solutions += 1;
		solution = offsets.slice();
	};
	run(0, start);
	return solutions === 1 && !exhausted ? solution : null;
};

const textNode = (
	value: string,
	from: number | undefined,
	to: number | undefined,
): MdastNode => {
	const node: MdastNode = { type: "text", value };
	if (from !== undefined && to !== undefined) {
		node.position = { start: { offset: from }, end: { offset: to } };
	}
	return node;
};

/**
 * One text node, split around the mentions that fall wholly inside it; `null`
 * when it holds none (the caller keeps the original node object).
 */
const splitText = (
	node: MdastNode,
	source: string,
	mentions: readonly { start: number; end: number }[],
): MdastNode[] | null => {
	const value = node.value;
	const start = node.position?.start?.offset;
	const end = node.position?.end?.offset;
	if (typeof value !== "string" || start === undefined || end === undefined) {
		return null;
	}
	const inside = mentions.filter(
		(mention) => mention.start >= start && mention.end <= end,
	);
	if (inside.length === 0) return null;
	const offsets = alignValue(value, source, start, end);
	if (offsets === null) return null;

	const pieces: MdastNode[] = [];
	let cursor = 0;
	let placed = false;
	for (const mention of inside) {
		const first = offsets.indexOf(mention.start);
		// One past the mention's last character: its `$` through its final name
		// character, mapped back to value indices.
		let last = first;
		while (last < offsets.length && offsets[last] < mention.end) last += 1;
		/*
		 * The last proof before any ink: the value characters the offsets name are
		 * the SAME characters the source holds at the mention. An alignment that
		 * slipped would fail here and ink nothing, never the wrong characters.
		 */
		if (
			first < 0 ||
			first < cursor ||
			last - first !== mention.end - mention.start ||
			value.slice(first, last) !== source.slice(mention.start, mention.end)
		) {
			continue;
		}
		if (first > cursor) {
			pieces.push(
				textNode(
					value.slice(cursor, first),
					offsets[cursor],
					offsets[first - 1] + 1,
				),
			);
		}
		pieces.push({
			type: "skillToken",
			children: [
				textNode(
					value.slice(first, last),
					offsets[first],
					offsets[last - 1] + 1,
				),
			],
			data: {
				hName: "span",
				hProperties: { className: [SKILL_TOKEN_CLASS] },
			},
		});
		cursor = last;
		placed = true;
	}
	if (!placed) return null;
	if (cursor < value.length) {
		pieces.push(
			textNode(
				value.slice(cursor),
				offsets[cursor],
				offsets[offsets.length - 1] + 1,
			),
		);
	}
	return pieces;
};

const walk = (
	node: MdastNode,
	source: string,
	mentions: readonly { start: number; end: number }[],
): void => {
	if (!node.children || NO_DESCENT.has(node.type)) return;
	let replaced = false;
	const next: MdastNode[] = [];
	for (const child of node.children) {
		if (child.type === "text") {
			const pieces = splitText(child, source, mentions);
			if (pieces !== null) {
				next.push(...pieces);
				replaced = true;
				continue;
			}
		} else {
			walk(child, source, mentions);
		}
		next.push(child);
	}
	// A subtree with no mention is handed back as the SAME nodes.
	if (replaced) node.children = next;
};

/**
 * The plugin, wired `[remarkSkillInk, { names }]`.
 *
 * Empty or absent `names` is a no-op that never reads the source: the transform
 * returns before any scan, so an ordinary turn pays nothing.
 */
export const remarkSkillInk =
	(options?: { names?: readonly string[] }) =>
	(tree: MdastNode, file?: ParsedFile): void => {
		const names = options?.names ?? [];
		if (names.length === 0 || typeof file?.value !== "string") return;
		const source = file.value;
		// A body inside an `<operator-skills>` block is the skill documenting itself,
		// never a token the reader typed (the same skip `planSkillMentions` applies).
		const mentions = skillMentionSpans(source, names, {
			skipSpans: skillBlockSpans(source),
		});
		if (mentions.length === 0) return;
		walk(tree, source, mentions);
	};
