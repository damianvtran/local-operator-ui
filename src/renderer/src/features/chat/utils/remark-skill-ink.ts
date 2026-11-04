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

/**
 * A character reference as the source spells it; what it DECODES to is not known
 * here. Sticky, so a test at an offset reads that offset and never scans ahead
 * (a slice per `&` is linear in the node, and a node may be tens of thousands of
 * characters long).
 */
const ENTITY_AT =
	/&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y;

/**
 * How many UTF-16 units one character reference may decode to. Every numeric
 * reference is 1 or 2, and so is every HTML5 named one (`&fjlig;` is `fj`,
 * `&Afr;` is an astral pair); 4 leaves room without making the search wide.
 */
const MAX_ENTITY_UNITS = 4;

/**
 * The work one TEXT NODE may cost, in steps: one per live reading advanced past a
 * value character, plus one per source character skipped at a line edge. The
 * honest walk keeps a handful of readings alive, so the budget is linear in the
 * node's VALUE - `STEPS_PER_VALUE_UNIT * value.length + STEP_FLOOR`.
 *
 * It is a per-NODE bound on the value-unit work, not a bound on the document, and
 * the line-edge skips are charged to it. A node whose SOURCE is much
 * longer than its value can therefore run out on input that looks ordinary: a
 * long run of blanks after a line ending (measured before a one-character value:
 * 4,187 blanks still ink, 4,188 do not) and a deep blockquote of short lines
 * (`"> ".repeat(8) + "a\n"` repeated: 2,087 lines still ink, 2,088 do not) both
 * exhaust it.
 *
 * Over budget is fail-closed for that node - no ink, never wrong ink - and the
 * walk carries on: the next node inks normally. The known shapes that reach it
 * are the two above, and a long run of two-unit character references before the
 * token, where every reference forks the readings so the work grows faster than
 * the run while the budget grows only with the value (measured: 82 references
 * still ink in a bare run, 165 with ~2 KB of ordinary prose after them - not "a
 * few hundred"). A document of very many small text nodes beside many mentions
 * also costs more than linear, since `splitText` scans the mention list per node;
 * nothing here bounds a whole document.
 */
const STEPS_PER_VALUE_UNIT = 8;
const STEP_FLOOR = 4096;

const isBlank = (char: string | undefined): boolean =>
	char === " " || char === "\t";

const isLineEnding = (char: string | undefined): boolean =>
	char === "\n" || char === "\r";

/** Source length of the character reference at `at` inside `[.., end)`, or 0. */
const entityLengthAt = (source: string, at: number, end: number): number => {
	ENTITY_AT.lastIndex = at;
	return ENTITY_AT.test(source) && ENTITY_AT.lastIndex <= end
		? ENTITY_AT.lastIndex - at
		: 0;
};

/**
 * The ways one value character can be read from the source at `from`, pushed as
 * triples `(value units consumed, next source cursor, source offset of the
 * character)`. Line handling comes first; a character reference, and a `>` that
 * opens a continuation line, are the only places a character has more than one
 * reading. Returns the blanks and markers it skipped, so the caller can charge
 * them to the node's budget.
 */
const successors = (
	value: string,
	source: string,
	end: number,
	index: number,
	from: number,
	out: number[],
): number => {
	out.length = 0;
	let cursor = from;
	const char = value[index];
	if (isLineEnding(char)) {
		// The parser drops blanks that trail a line.
		while (cursor < end && isBlank(source[cursor])) cursor += 1;
	} else if (isLineEnding(value[index - 1])) {
		/*
		 * A continuation line's leading blanks are consumed too, and inside a
		 * blockquote its `> ` markers. When the value itself holds a `>` here, the
		 * source's `>` may be a marker or that character (`> \> b`), so stopping at
		 * each one is also a reading; the proof that follows picks the survivor.
		 */
		while (
			cursor < end &&
			(isBlank(source[cursor]) || source[cursor] === ">")
		) {
			if (char === ">" && source[cursor] === ">")
				out.push(1, cursor + 1, cursor);
			cursor += 1;
		}
	}
	const skipped = cursor - from;
	if (cursor >= end) return skipped;
	if (source[cursor] === "&") {
		const length = entityLengthAt(source, cursor, end);
		if (length > 0) {
			for (
				let units = 1;
				units <= MAX_ENTITY_UNITS && index + units <= value.length;
				units++
			) {
				out.push(units, cursor + length, cursor);
			}
		}
	}
	if (
		source[cursor] === "\\" &&
		cursor + 1 < end &&
		source[cursor + 1] === char &&
		ASCII_PUNCTUATION.test(char)
	) {
		out.push(1, cursor + 2, cursor + 1);
	} else if (source[cursor] === char) {
		out.push(1, cursor + 1, cursor);
	}
	return skipped;
};

/**
 * For each source position, the most a reading starting there could still
 * "absorb": source characters the walk consumes without yielding a value unit.
 * Only a backslash escape, a character reference, and blanks or `>` markers at a
 * line edge can; ordinary text absorbs nothing. A reading that is behind (or
 * ahead) by more than this cannot finish, which is what ends the wrong readings
 * of a long plain tail early instead of walking them to the end.
 */
const absorbCapacity = (
	source: string,
	start: number,
	end: number,
): Int32Array => {
	const capacity = new Int32Array(end - start + 1);
	for (let at = start; at < end; ) {
		const char = source[at];
		if (isBlank(char) || char === ">") {
			let stop = at;
			while (stop < end && (isBlank(source[stop]) || source[stop] === ">")) {
				stop += 1;
			}
			const leading = at > start && isLineEnding(source[at - 1]);
			const trailing = stop === end || isLineEnding(source[stop]);
			for (let run = at; run < stop; run++) {
				if (leading || (trailing && isBlank(source[run]))) {
					capacity[run - start] = 1;
				}
			}
			at = stop;
			continue;
		}
		if (char === "\\") capacity[at - start] = 1;
		else if (char === "&") {
			// A reference absorbs everything past the one unit it must yield.
			capacity[at - start] = Math.max(entityLengthAt(source, at, end) - 1, 0);
		}
		at += 1;
	}
	for (let at = end - start - 1; at >= 0; at--)
		capacity[at] += capacity[at + 1];
	return capacity;
};

/**
 * The source offset of each character of a text node's value, `-1` where the
 * complete readings disagree about it, or `null` when no reading can be proved
 * or the node costs more than its budget.
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
 * knows the named-reference table, so a reference may be read as 1 to
 * {@link MAX_ENTITY_UNITS} value units. All the readings advance TOGETHER, one
 * value character at a time, as a set of live source cursors per value index
 * (readings that reach the same cursor are the same reading). That is
 * O(value length x live readings) for the forward pass, where re-walking the tail
 * once per fork was not, and {@link STEPS_PER_VALUE_UNIT} bounds it in steps sized
 * by the VALUE. Crossing the budget returns `null` for THIS node - no ink, never
 * wrong ink - and the rest of the tree still walks; see the constant for the
 * shapes that reach it.
 *
 * A backward pass keeps only the readings that consume the node's whole range.
 *
 * What the caller may rely on: a returned offset is `>= 0` only where EVERY
 * complete reading puts that value character at that source offset. Where they
 * differ it is `-1`, and the caller inks nothing that depends on it.
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
	const length = value.length;
	let budget = STEPS_PER_VALUE_UNIT * length + STEP_FLOOR;
	const capacity = absorbCapacity(source, start, end);
	// A reading that has `ahead` source characters more than value characters left
	// can finish only if the rest of the node can absorb that many; one that has
	// fewer cannot finish at all. This ends the wrong readings of a long plain tail
	// at the first character instead of walking them to the end.
	const viable = (index: number, cursor: number): boolean => {
		const ahead = end - cursor - (length - index);
		return ahead >= 0 && ahead <= capacity[cursor - start];
	};

	// layers[i]: the source cursors at which value index i can be reached.
	const layers: (Set<number> | undefined)[] = new Array(length + 1);
	layers[0] = new Set([start]);
	const moves: number[] = [];
	for (let index = 0; index < length; index++) {
		const here = layers[index];
		if (here === undefined) continue;
		for (const cursor of here) {
			budget -= 1 + successors(value, source, end, index, cursor, moves);
			if (budget < 0) return null;
			for (let at = 0; at < moves.length; at += 3) {
				const to = index + moves[at];
				const next = moves[at + 1];
				if (!viable(to, next)) continue;
				let layer = layers[to];
				if (layer === undefined) {
					layer = new Set();
					layers[to] = layer;
				}
				layer.add(next);
			}
		}
	}
	// Backward: keep the readings that finish, and gather what they say per index.
	// Whatever source is left after the last value character must be blanks the
	// parser trimmed.
	let tail = end;
	while (tail > start && isBlank(source[tail - 1])) tail -= 1;
	const finals = new Set<number>();
	for (const cursor of layers[length] ?? []) {
		if (cursor >= tail) finals.add(cursor);
	}
	if (finals.size === 0) return null;
	layers[length] = finals;
	const offsets: number[] = new Array(length).fill(-2);
	for (let index = length - 1; index >= 0; index--) {
		const survivors = new Set<number>();
		for (const cursor of layers[index] ?? []) {
			successors(value, source, end, index, cursor, moves);
			for (let at = 0; at < moves.length; at += 3) {
				const to = index + moves[at];
				if (!layers[to]?.has(moves[at + 1])) continue;
				survivors.add(cursor);
				for (let unit = index; unit < to; unit++) {
					offsets[unit] =
						offsets[unit] === -2 || offsets[unit] === moves[at + 2]
							? moves[at + 2]
							: -1;
				}
			}
		}
		layers[index] = survivors;
	}
	return layers[0]?.size ? offsets : null;
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

	// A negative offset is a character the readings disagree about: its source
	// position is unknown, so a piece that ends on one carries no position (the
	// plugins behind this one then read no predecessor, as for any positionless
	// node) rather than a wrong one.
	const spanOf = (
		from: number,
		to: number,
	): [number | undefined, number | undefined] => {
		const first = offsets[from];
		const last = offsets[to - 1];
		return first >= 0 && last >= 0 ? [first, last + 1] : [undefined, undefined];
	};
	const pieces: MdastNode[] = [];
	let cursor = 0;
	let placed = false;
	for (const mention of inside) {
		// From `cursor`: mentions arrive in order, and a scan from 0 per mention is
		// quadratic in a node that holds thousands of them.
		const first = offsets.indexOf(mention.start, cursor);
		const last = first + (mention.end - mention.start);
		/*
		 * The last proof before any ink: every character of the token sits, in EVERY
		 * complete reading, at the source offset of the same character of the
		 * mention, and the value holds the same characters the source does there. An
		 * alignment that slipped would fail here and ink nothing, never the wrong
		 * characters.
		 */
		let proved = first >= 0 && first >= cursor && last <= offsets.length;
		for (let index = first; proved && index < last; index++) {
			proved = offsets[index] === mention.start + (index - first);
		}
		if (
			!proved ||
			value.slice(first, last) !== source.slice(mention.start, mention.end)
		) {
			continue;
		}
		if (first > cursor) {
			pieces.push(
				textNode(value.slice(cursor, first), ...spanOf(cursor, first)),
			);
		}
		pieces.push({
			type: "skillToken",
			children: [
				textNode(value.slice(first, last), mention.start, mention.end),
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
		pieces.push(textNode(value.slice(cursor), ...spanOf(cursor, value.length)));
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
