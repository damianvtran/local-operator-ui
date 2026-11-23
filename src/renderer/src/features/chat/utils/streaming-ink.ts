import type { Element, Root, Text } from "hast";

export type InkBatch = {
	/** Source offset, relative to this Markdown block. */
	start: number;
	/** After a rewrite, only these committed source intervals can keep a span. */
	retained?: ReadonlyMap<number, number>;
	/** Clock starts at commit, not when React starts rendering. */
	paintedAt?: number;
	/** Keep the committed boundary without fading on recovery or correction. */
	static?: true;
};

// The shared --duration-fast motion token (styles/index.css). CSS still owns
// playback and Reduce Motion; this horizon only compacts old DOM on a later
// append, never schedules a render at the end of an animation.
export const INK_DURATION_MS = 120;

const WORD_GAP = /[ \t\n\r]/;
const GRAPHEME_TAIL = /[\p{M}\p{Grapheme_Extend}\p{Emoji_Modifier}\u200d]/u;
// Han/kana and their sentence separators can take a boundary without a space.
// Include the Common-script kana long-vowel marks explicitly, without widening
// the rule to unrelated Common characters. Both neighbors must still qualify.
const UNSPACED_PROSE =
	/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ーｰ、。！？]$/u;

function afterUnspacedProse(source: string, index: number) {
	const last = source.charCodeAt(index - 1);
	const start = last >= 0xdc00 && last <= 0xdfff ? index - 2 : index - 1;
	return UNSPACED_PROSE.test(source.slice(start, index));
}

/**
 * One entrance per committed batch, not per character/word. If a delta
 * continues a word, it extends its existing text node and can start ink at
 * the next word. Don't insert a span boundary that splits a shaped word or
 * grapheme (including a combining mark attached to a space).
 */
export function nextInkStart(source: string, from: number): number | null {
	let gap: number | null = null;
	for (let i = from; i < source.length; i++) {
		if (WORD_GAP.test(source[i])) {
			if (gap === null && !(source[i] === "\n" && source[i - 1] === "\r"))
				gap = i;
			continue;
		}
		const next = String.fromCodePoint(source.codePointAt(i) ?? 0);
		if (
			!GRAPHEME_TAIL.test(next) &&
			(gap !== null ||
				i === 0 ||
				WORD_GAP.test(source[i - 1]) ||
				(UNSPACED_PROSE.test(next) && afterUnspacedProse(source, i)))
		) {
			// Include newly exposed separating whitespace in the new span, so
			// React doesn't write even one character into the old selected node.
			return gap ?? i;
		}
		gap = null;
	}
	return null;
}

/** Keep boundaries in proven unchanged source, never a clock on a rewrite. */
export function retainInkPrefix(
	before: string,
	after: string,
	batches: readonly InkBatch[],
	committedPieces: (batch: InkBatch) => Iterable<readonly [number, number]>,
): readonly InkBatch[] {
	if (batches.length === 0) return batches;
	let prefix = 0;
	const length = Math.min(before.length, after.length);
	while (
		prefix < length &&
		before.charCodeAt(prefix) === after.charCodeAt(prefix)
	)
		prefix++;
	const retained: InkBatch[] = [];
	for (const batch of batches) {
		if (batch.start >= prefix) break;
		const pieces = new Map<number, number>();
		for (const [start, end] of committedPieces(batch)) {
			if (end <= prefix) pieces.set(start, end);
		}
		if (pieces.size > 0)
			retained.push({ ...batch, retained: pieces, static: true });
	}
	return retained;
}

type InkPiece = { text: string; start: number; batch?: InkBatch };
// Private to this renderer. Never serialize parser bookkeeping into the DOM.
export const STREAM_INK = Symbol("streamInk");
export type InkText = Element & { [STREAM_INK]: InkPiece[] };

const PROSE = /^(?:p|h[1-6]|li|em|strong|del|blockquote|td|th)$/;
const LITERAL = /^(?:a|pre|code|math|svg|button)$/;

function leafPieces(node: Text, source: string, batches: readonly InkBatch[]) {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	// Entity decoding, soft breaks and other transforms don't necessarily map
	// source offsets to visible UTF-16 offsets. Render them as-is rather than
	// guessing or mistaking Markdown syntax for newly visible text.
	if (
		start === undefined ||
		end === undefined ||
		end - start !== node.value.length ||
		!source.startsWith(node.value, start) ||
		node.value.trim() === ""
	) {
		return null;
	}
	const pieces: InkPiece[] = [];
	let cursor = start;
	// Skip older batches before this leaf (large list/table tails have many
	// leaves). Keep the immediate predecessor if it overlaps this text.
	let lower = 0;
	let upper = batches.length;
	while (lower < upper) {
		const mid = (lower + upper) >>> 1;
		if (batches[mid].start <= start) lower = mid + 1;
		else upper = mid;
	}
	let active = batches[lower - 1];
	const pushPiece = (end: number) => {
		// Do not cut a leaf at the correction boundary (it may split a word or
		// grapheme) or let a retired batch acquire differently parsed text later.
		const batch =
			active?.retained && active.retained.get(cursor) !== end
				? undefined
				: active;
		const text = source.slice(cursor, end);
		const previous = pieces[pieces.length - 1];
		// A rejected mapping must not leave adjacent text nodes: dropping that
		// batch on a later append would merge the nodes and collapse a selection.
		if (!batch && previous && !previous.batch) previous.text += text;
		else pieces.push({ text, start: cursor, batch });
		cursor = end;
	};
	for (let i = lower; i < batches.length; i++) {
		const batch = batches[i];
		if (batch.start >= end) break;
		if (batch.start > cursor) pushPiece(batch.start);
		active = batch;
	}
	pushPiece(end);
	return pieces;
}

/**
 * A render-only annotation, after the regular Markdown pipeline. The span
 * node is consumed by the React component map; only actual incoming pieces
 * get an inline DOM element. Keep the unanimated prefix as a stable text node
 * even when React adds its first animated sibling, so selecting it still works.
 */
export function markStreamingInk(
	tree: Root,
	source: string,
	batches: readonly InkBatch[],
) {
	const walk = (parent: Root | Element, prose: boolean) => {
		for (let i = 0; i < parent.children.length; i++) {
			const node = parent.children[i];
			if (node.type === "element" && !LITERAL.test(node.tagName)) {
				walk(node, PROSE.test(node.tagName));
			} else if (node.type === "text" && prose) {
				const pieces = leafPieces(node, source, batches);
				if (!pieces) continue;
				const leaf: InkText = {
					type: "element",
					tagName: "span",
					properties: {},
					children: [],
					[STREAM_INK]: pieces,
				};
				parent.children[i] = leaf;
			}
		}
	};
	walk(tree, false);
}
