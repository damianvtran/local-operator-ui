import type { Element, Root, Text } from "hast";

export type InkBatch = {
	/** Source offset, relative to this Markdown block. */
	start: number;
	/** Clock starts at commit, not when React starts rendering. */
	paintedAt?: number;
	/** Keep the committed boundary, but never fade text appended during recovery. */
	static?: true;
};

// The shared --duration-fast motion token (styles/index.css). CSS still owns
// playback and Reduce Motion; this horizon only compacts old DOM on a later
// append, never schedules a render at the end of an animation.
export const INK_DURATION_MS = 120;

const WORD_GAP = /[ \t\n\r]/;
const GRAPHEME_TAIL = /[\p{M}\p{Grapheme_Extend}\p{Emoji_Modifier}\u200d]/u;
// Han/kana and their sentence separators can take a boundary without a space.
// Require this on BOTH sides so this never introduces an in-word span for a
// joining or ligature-forming script, or splits an emoji/ZWJ sequence.
const UNSPACED_PROSE =
	/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。！？]$/u;

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

type InkPiece = { text: string; batch?: InkBatch };
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
	for (let i = lower; i < batches.length; i++) {
		const batch = batches[i];
		if (batch.start >= end) break;
		if (batch.start > cursor) {
			pieces.push({ text: source.slice(cursor, batch.start), batch: active });
			cursor = batch.start;
		}
		active = batch;
	}
	pieces.push({ text: source.slice(cursor, end), batch: active });
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
