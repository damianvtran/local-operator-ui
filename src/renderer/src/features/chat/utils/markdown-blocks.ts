/**
 * Incremental block splitter for streaming markdown.
 *
 * ## Why this exists
 *
 * The streaming protocol sends the whole `AgentExecutionRecord` on every frame,
 * not a delta, so the naive way to show a stream is to hand the accumulated
 * string to react-markdown each time it grows. That is O(n^2) over a message:
 * measured on this app's renderer a single full-document parse costs 1.19ms at
 * 398 chars, 11.19ms at 6.4k and 33.68ms at 25.5k, so a 12KB answer arriving at
 * 20 chars/chunk spends over six seconds of main-thread time re-parsing text
 * that has not changed since the first frame.
 *
 * The fix is to parse each markdown block exactly once. This module finds the
 * boundary between the part of the document that can no longer change — the
 * closed blocks — and the block still being written. Closed blocks are handed
 * to the markdown renderer and memoised by content, so they are parsed on the
 * frame they close and never again. The open block is rendered as plain text
 * until it closes.
 *
 * Cost per frame is therefore proportional to the newly arrived text plus, on
 * the frames where a block closes, that one block. It does not grow with the
 * length of the document.
 *
 * ## Why a hand-written scanner rather than remark
 *
 * remark can tell us where the blocks are, but only by parsing the whole
 * document, which is the cost we are trying to avoid. This scanner keeps its
 * position between calls and only reads the lines that arrived since the last
 * one, which is what makes the per-frame cost bounded by the tail.
 *
 * ## What "closed" means, and why we wait for the next line
 *
 * A blank line is not enough to close a block. `- a\n\n- b` is one loose list
 * in CommonMark, and splitting it would render two lists — visibly wrong for
 * ordered lists, which would restart at 1. So a blank run only *arms* a break;
 * the block closes when the next non-blank line arrives and proves it does not
 * continue the open block. That lookahead costs nothing here because the text
 * is arriving anyway.
 *
 * ## Known limitation, and why it is acceptable
 *
 * Link reference definitions (`[label]: https://…`) placed after the paragraph
 * that uses them will not resolve while that paragraph is still a separate
 * block. Agent output does not use them in practice, and the moment the stream
 * completes the message is re-rendered in one piece by the ordinary renderer,
 * so any split artefact is transient by construction.
 */

const BLANK_LINE = /^[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const INDENTED_CODE = /^(?: {4}|\t)/;
/** Two spaces is enough to hang content under a list item, so it keeps the list open. */
const LIST_CONTINUATION = /^(?: {2,}|\t)/;

/**
 * Only the distinctions that change whether a blank line ends the block. Every
 * other construct — paragraph, heading, table, quote, fenced code — closes at a
 * blank line, so they share one kind.
 */
type OpenBlockKind = "none" | "list" | "indented-code" | "other";

type OpenFence = {
	/** Backtick or tilde. A tilde fence is not closed by backticks. */
	char: string;
	/** A closing fence must be at least as long as the opening one. */
	length: number;
};

export type BlockScanner = {
	/** The text consumed so far. The next scan must extend this exactly. */
	source: string;
	/** First byte not yet scanned. Always the start of a line. */
	cursor: number;
	/** Where the still-open block begins. This is the tail boundary. */
	blockStart: number;
	/** Start of the pending blank run, or -1 when the last line had content. */
	blankRunStart: number;
	kind: OpenBlockKind;
	fence: OpenFence | null;
	/** Closed blocks in document order. Append-only between resets. */
	blocks: string[];
	/**
	 * Bumped whenever `blocks` gains an entry, so a consumer can memoise on a
	 * number instead of diffing an array it is not allowed to copy.
	 */
	revision: number;
};

export const createBlockScanner = (): BlockScanner => ({
	source: "",
	cursor: 0,
	blockStart: 0,
	blankRunStart: -1,
	kind: "none",
	fence: null,
	blocks: [],
	revision: 0,
});

const resetScanner = (scanner: BlockScanner): void => {
	scanner.source = "";
	scanner.cursor = 0;
	scanner.blockStart = 0;
	scanner.blankRunStart = -1;
	scanner.kind = "none";
	scanner.fence = null;
	scanner.blocks = [];
	scanner.revision += 1;
};

const classify = (line: string): OpenBlockKind => {
	if (INDENTED_CODE.test(line)) return "indented-code";
	if (LIST_ITEM.test(line)) return "list";
	return "other";
};

const continuesOpenBlock = (kind: OpenBlockKind, line: string): boolean => {
	if (kind === "list") {
		return LIST_ITEM.test(line) || LIST_CONTINUATION.test(line);
	}
	if (kind === "indented-code") {
		return INDENTED_CODE.test(line);
	}
	return false;
};

const closesFence = (line: string, fence: OpenFence): boolean => {
	let index = 0;
	// Up to three leading spaces are allowed before a closing fence.
	while (index < 3 && line.charCodeAt(index) === 32) index += 1;
	let run = 0;
	while (line[index + run] === fence.char) run += 1;
	if (run < fence.length) return false;
	// Nothing but whitespace may follow, otherwise it is an opening fence with
	// an info string, or ordinary text.
	return BLANK_LINE.test(line.slice(index + run));
};

/**
 * Feed the scanner the full accumulated document.
 *
 * `source` must be the previous `source` plus appended text. If it is not — the
 * backend rewrote the message, or the component was reused for a different
 * message — the scanner resets and rescans, which is correct but O(n). The
 * prefix check is a `String.prototype.startsWith` on text we already hold, so
 * it is a memcmp: ~2us at 25KB, three orders of magnitude below one parse.
 */
export const scanMarkdownBlocks = (
	scanner: BlockScanner,
	source: string,
): void => {
	if (
		source.length < scanner.source.length ||
		!source.startsWith(scanner.source)
	) {
		resetScanner(scanner);
	}
	scanner.source = source;

	let index = scanner.cursor;
	while (true) {
		const newline = source.indexOf("\n", index);
		// A line without its terminator may still grow, so it stays in the tail
		// and is rescanned next time. That is the only work this loop repeats.
		if (newline === -1) break;

		const line = source.slice(index, newline);

		if (scanner.fence) {
			if (closesFence(line, scanner.fence)) scanner.fence = null;
			index = newline + 1;
			continue;
		}

		if (BLANK_LINE.test(line)) {
			if (scanner.blankRunStart < 0) scanner.blankRunStart = index;
			index = newline + 1;
			continue;
		}

		if (scanner.blankRunStart >= 0) {
			if (scanner.kind === "none" || !continuesOpenBlock(scanner.kind, line)) {
				const block = source.slice(scanner.blockStart, scanner.blankRunStart);
				// A leading blank run produces an empty block; drop it rather than
				// emit a component that renders nothing.
				if (block.trim().length > 0) {
					scanner.blocks.push(block);
					scanner.revision += 1;
				}
				scanner.blockStart = index;
				scanner.kind = classify(line);
			}
			scanner.blankRunStart = -1;
		} else if (scanner.kind === "none") {
			scanner.kind = classify(line);
		}

		// A fence marker inside an indented code block is literal text, not a
		// fence; treating it as one would swallow every blank line to the end of
		// the message.
		if (scanner.kind !== "indented-code") {
			const opener = FENCE_OPEN.exec(line);
			if (opener) {
				scanner.fence = { char: opener[1][0], length: opener[1].length };
			}
		}

		index = newline + 1;
	}

	scanner.cursor = index;
};

/**
 * Length of `text` ignoring trailing whitespace.
 *
 * The tail is rendered `pre-wrap`, so trailing newlines from a blank run that
 * has not yet closed its block would paint as empty lines and then collapse a
 * frame later. Clipping them keeps the text from jumping.
 */
export const trimmedEndLength = (text: string): number => {
	let end = text.length;
	while (end > 0) {
		const code = text.charCodeAt(end - 1);
		if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break;
		end -= 1;
	}
	return end;
};
