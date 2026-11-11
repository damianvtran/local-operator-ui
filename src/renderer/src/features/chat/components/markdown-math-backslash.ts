/**
 * LATEX'S OWN DELIMITERS: `\(...\)` INLINE AND `\[...\]` DISPLAY
 * (operator report, 2026-11-10: "support latex inline in the text, as well as
 * latex equation blocks that are highlighted and centered").
 *
 * Models write TeX with LaTeX's delimiters as often as with dollars, and
 * CommonMark reads `\(` and `\[` as CHARACTER ESCAPES - so before this module
 * `\(E = mc^2\)` rendered as the literal `(E = mc^2)` and a display block lost
 * its brackets and ran into the prose as source.
 *
 * WHY A MICROMARK SYNTAX EXTENSION AND NOT A REGEX PRE-PASS. A pre-pass over the
 * source string cannot know what is code: it would rewrite `\(` inside inline
 * code, fenced code and indented code (all of which must stay byte-identical),
 * and it would need its own escaping rules to hand the result back to the
 * parser. A syntax extension runs INSIDE the tokenizer, so code spans and code
 * blocks never reach it - they are tokenized by their own constructs first -
 * and it produces the same `inlineMath` / `math` mdast nodes `$`/`$$` do, so
 * `rehype-katex` and every downstream consumer need no change. Constructs a
 * syntax extension registers for a character code are tried BEFORE the
 * built-in ones for that code (micromark's `combineExtensions` splices
 * extension constructs ahead of the defaults), which is what lets `\(` beat
 * `characterEscape`. When an attempt fails (no closer, empty content) the
 * tokenizer rewinds and `characterEscape` runs as before, so an escaped paren
 * in ordinary prose still renders as a literal paren.
 *
 * THE TWO CONSTRUCTS:
 *
 *   - TEXT (`\(...\)` and `\[...\]` inside a paragraph). Same token shape as
 *     upstream's `mathText` - sequence, data, space, lineEnding - so upstream's
 *     resolver and `mathFromMarkdown`'s data handlers apply unchanged. `\(`
 *     produces an ordinary `inlineMath`; `\[` produces an `inlineMath` whose
 *     hast class is `math-display`, which `rehype-katex` typesets in display
 *     mode (a centred `.katex-display` block inside the paragraph).
 *   - FLOW (`\[` starting a line, `\]` ending one). Emits upstream's `mathFlow`
 *     token names, so `mathFromMarkdown` builds the same `math` node `$$`
 *     does. A flow construct is what keeps a multi-line equation whole: inside
 *     a paragraph, a line such as `- b & c` or `=` would otherwise start a
 *     list or a setext heading and split the equation.
 *
 * THE GUARDS, each because of a measured or likely prose shape:
 *
 *   - NO CLOSER, NO MATH. Both constructs fail at end of input or end of the
 *     container. A streaming message with an unclosed `\[` therefore shows
 *     literal text until the closer arrives, exactly like an unclosed `$`,
 *     instead of a display block that swallows the rest of the message (the
 *     `$$` fence's run-to-end behaviour, which is upstream's and is kept).
 *   - A BLANK LINE ENDS A DISPLAY ATTEMPT. LaTeX itself rejects a paragraph
 *     break inside display math, and without this a stray `\[` would scan
 *     across the whole message for a `\]`.
 *   - `\[...\]` MUST LOOK LIKE MATH. Escaped brackets are common in prose -
 *     `\[1\]` reference markers, `\[sic\]`, `\[citation needed\]` - so the
 *     display delimiters require a signal in the content: a backslash command,
 *     or one of `^ _ { } = + < > |`. `\(...\)` is not asked: escaped
 *     parentheses carry no meaning in Markdown, so a paired `\(...\)` is
 *     LaTeX's inline delimiter and nothing else.
 *   - A backslash inside the content consumes the character after it, so
 *     `\\` (TeX's line break) followed by `)` or `]` is never mistaken for a
 *     closer - the same pairing TeX itself applies.
 *
 * Types are spelled structurally for the reason `markdown-math-guarded.ts`
 * states (the micromark type packages are not this repository's own
 * dependencies).
 */

type Code = number | null;
type State = (code: Code) => State | undefined;
type Token = { type: string };
type Effects = {
	enter: (type: string) => Token;
	consume: (code: Code) => void;
	exit: (type: string) => Token;
	check: (construct: Construct, ok: State, nok: State) => State;
	attempt: (construct: Construct, ok: State, nok: State) => State;
};
type TokenizeContext = {
	events: Array<
		[string, Token, { sliceSerialize: (token: Token, eol?: boolean) => string }]
	>;
	parser: { lazy: Record<number, boolean> };
	now: () => { line: number };
};
type Tokenizer = (
	this: TokenizeContext,
	effects: Effects,
	ok: State,
	nok: State,
) => State;
type Construct = {
	tokenize: Tokenizer;
	partial?: boolean;
	concrete?: boolean;
	name?: string;
	// biome-ignore lint/suspicious/noExplicitAny: micromark's resolver protocol.
	resolve?: (events: any[]) => any[];
};

const BACKSLASH = 92;
const LEFT_PAREN = 40;
const RIGHT_PAREN = 41;
const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const SPACE = 32;

/** micromark's line endings: CR (-5), LF (-4), CRLF (-3). */
const isLineEnding = (code: Code): boolean => code !== null && code < -2;
/** A space, a tab (-2) or a tab's virtual spaces (-1). */
const isSpace = (code: Code): boolean =>
	code === SPACE || code === -2 || code === -1;

/**
 * The single characters that make `\[...\]` content read as math rather than a
 * bracketed note (see THE GUARDS): `^ _ { } = + < > |`. A backslash command is
 * the other signal and is detected where the backslash is consumed.
 */
const isDisplaySignal = (code: Code): boolean =>
	code === 94 ||
	code === 95 ||
	code === 123 ||
	code === 125 ||
	code === 61 ||
	code === 43 ||
	code === 60 ||
	code === 62 ||
	code === 124;

/**
 * The token type the `\[...\]` TEXT form is renamed to once its bracket is
 * read. Its own name so `backslashMathFromMarkdown` can build an `inlineMath`
 * node with the display class; the `\(` form keeps upstream's `mathText` name
 * and upstream's handler.
 */
const DISPLAY_TEXT = "mathTextDisplay";

/**
 * Upstream's `resolveMathText` (micromark-extension-math@3.1.0): merge adjacent
 * space and data tokens, and mark the padding of content that both starts and
 * ends with a space (`\( x \)` -> value `x`, the same as `$ x $` under
 * upstream). One vendored copy, shared with the guarded `$` tokenizer.
 */
import { resolveMathText } from "./markdown-math-resolve";

/* ---------------------------------------------------------------------------
 * TEXT: `\(...\)` and `\[...\]` inside a paragraph.
 * ---------------------------------------------------------------------------
 */

function tokenizeBackslashMathText(
	this: TokenizeContext,
	effects: Effects,
	ok: State,
	nok: State,
): State {
	let closeCode = RIGHT_PAREN;
	let display = false;
	let outer: Token;
	let sawContent = false;
	let sawSignal = false;

	/** `\` + this construct's closing character, as a lookahead. */
	const closer: Construct = { tokenize: tokenizeCloser, partial: true };

	return start;

	function start(code: Code): State | undefined {
		if (code !== BACKSLASH) return nok(code);
		outer = effects.enter("mathText");
		effects.enter("mathTextSequence");
		effects.consume(code);
		return open;
	}

	function open(code: Code): State | undefined {
		if (code === LEFT_BRACKET) {
			closeCode = RIGHT_BRACKET;
			display = true;
			// Renamed in place, as upstream's own tokenizer renames a
			// mismatched closing run to data: the events reference this object.
			outer.type = DISPLAY_TEXT;
		} else if (code !== LEFT_PAREN) {
			return nok(code);
		}
		effects.consume(code);
		effects.exit("mathTextSequence");
		return between;
	}

	function between(code: Code): State | undefined {
		if (code === null) return nok(code);
		if (code === BACKSLASH) {
			return effects.check(closer, close, dataStart)(code);
		}
		if (code === SPACE) {
			effects.enter("space");
			effects.consume(code);
			effects.exit("space");
			return between;
		}
		if (isLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return between;
		}
		return dataStart(code);
	}

	function dataStart(code: Code): State | undefined {
		effects.enter("mathTextData");
		return code === BACKSLASH ? backslash(code) : data(code);
	}

	function data(code: Code): State | undefined {
		if (code === null || code === SPACE || isLineEnding(code)) {
			effects.exit("mathTextData");
			return between(code);
		}
		if (code === BACKSLASH) {
			return effects.check(closer, exitDataThenClose, backslash)(code);
		}
		sawContent = true;
		if (isDisplaySignal(code)) sawSignal = true;
		effects.consume(code);
		return data;
	}

	/** A backslash takes the next visible character with it (`\\`, `\)` in `\\)`). */
	function backslash(code: Code): State | undefined {
		sawContent = true;
		effects.consume(code);
		return afterBackslash;
	}

	function afterBackslash(code: Code): State | undefined {
		if (code === null || isLineEnding(code) || isSpace(code)) {
			return data(code);
		}
		sawSignal = true;
		effects.consume(code);
		return data;
	}

	function exitDataThenClose(code: Code): State | undefined {
		effects.exit("mathTextData");
		return close(code);
	}

	function close(code: Code): State | undefined {
		if (!sawContent || (display && !sawSignal)) return nok(code);
		effects.enter("mathTextSequence");
		effects.consume(code);
		return closeEnd;
	}

	function closeEnd(code: Code): State | undefined {
		effects.consume(code);
		effects.exit("mathTextSequence");
		effects.exit(outer.type);
		return ok;
	}

	function tokenizeCloser(
		this: TokenizeContext,
		lookahead: Effects,
		yes: State,
		no: State,
	): State {
		return (code) => {
			lookahead.enter("mathTextSequence");
			lookahead.consume(code);
			return (next) => {
				if (next !== closeCode) return no(next);
				lookahead.consume(next);
				lookahead.exit("mathTextSequence");
				return yes;
			};
		};
	}
}

/** Registered under `\` in the text map, ahead of `characterEscape`. */
export const backslashMathText: Construct = {
	name: "mathTextBackslash",
	tokenize: tokenizeBackslashMathText,
	resolve: resolveMathText,
};

/* ---------------------------------------------------------------------------
 * FLOW: a `\[` line through a line ending in `\]`.
 * ---------------------------------------------------------------------------
 */

/**
 * The next line belongs to this container (not a lazy continuation), as in
 * upstream's `math-flow.js`: a lazy line ends the attempt.
 */
const nonLazyContinuation: Construct = {
	partial: true,
	tokenize(effects, ok, nok) {
		return (code) => {
			if (code === null) return ok(code);
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return (next) =>
				this.parser.lazy[this.now().line] ? nok(next) : ok(next);
		};
	},
};

/** `\]`, optional spaces, then the end of the line or of the input. */
const closingTail: Construct = {
	partial: true,
	tokenize(effects, ok, nok) {
		return (code) => {
			effects.enter("mathFlowFenceSequence");
			effects.consume(code);
			return (next) => {
				if (next !== RIGHT_BRACKET) return nok(next);
				effects.consume(next);
				effects.exit("mathFlowFenceSequence");
				return trailing;
			};
		};
		function trailing(code: Code): State | undefined {
			if (isSpace(code)) {
				effects.enter("whitespace");
				return spaces(code);
			}
			return code === null || isLineEnding(code) ? ok(code) : nok(code);
		}
		function spaces(code: Code): State | undefined {
			if (isSpace(code)) {
				effects.consume(code);
				return spaces;
			}
			effects.exit("whitespace");
			return code === null || isLineEnding(code) ? ok(code) : nok(code);
		}
	},
};

function tokenizeBracketFlow(
	this: TokenizeContext,
	effects: Effects,
	ok: State,
	nok: State,
): State {
	const tail = this.events[this.events.length - 1];
	// Upstream's rule for an indented fence: content lines lose up to the
	// opener's own indent, so an indented block keeps its relative layout.
	const initialSize =
		tail && tail[1].type === "linePrefix"
			? tail[2].sliceSerialize(tail[1], true).length
			: 0;
	let sawSignal = false;
	let lineHasContent = false;
	let prefixLeft = 0;

	return start;

	function start(code: Code): State | undefined {
		if (code !== BACKSLASH) return nok(code);
		effects.enter("mathFlow");
		effects.enter("mathFlowFence");
		effects.enter("mathFlowFenceSequence");
		effects.consume(code);
		return openBracket;
	}

	function openBracket(code: Code): State | undefined {
		if (code !== LEFT_BRACKET) return nok(code);
		effects.consume(code);
		effects.exit("mathFlowFenceSequence");
		return openAfter;
	}

	function openAfter(code: Code): State | undefined {
		if (isSpace(code)) {
			effects.enter("whitespace");
			return openSpaces(code);
		}
		return openDone(code);
	}

	function openSpaces(code: Code): State | undefined {
		if (isSpace(code)) {
			effects.consume(code);
			return openSpaces;
		}
		effects.exit("whitespace");
		return openDone(code);
	}

	function openDone(code: Code): State | undefined {
		// An opener alone at the end of the input is unclosed.
		if (code === null) return nok(code);
		effects.exit("mathFlowFence");
		// The opener line counts as content-bearing: `\[` alone is the
		// ordinary shape and must not trip the blank-line rule.
		lineHasContent = true;
		return beforeChunk(code);
	}

	function lineEnd(code: Code): State | undefined {
		if (!lineHasContent) return nok(code);
		return effects.attempt(nonLazyContinuation, lineStart, nok)(code);
	}

	function lineStart(code: Code): State | undefined {
		lineHasContent = false;
		prefixLeft = initialSize;
		if (prefixLeft > 0 && isSpace(code)) {
			effects.enter("linePrefix");
			return prefix(code);
		}
		return beforeChunk(code);
	}

	function prefix(code: Code): State | undefined {
		if (prefixLeft > 0 && isSpace(code)) {
			prefixLeft--;
			effects.consume(code);
			return prefix;
		}
		effects.exit("linePrefix");
		return beforeChunk(code);
	}

	function beforeChunk(code: Code): State | undefined {
		if (code === null) return nok(code);
		if (isLineEnding(code)) return lineEnd(code);
		if (code === BACKSLASH) {
			return effects.check(closingTail, closeFence, chunkStart)(code);
		}
		return chunkStart(code);
	}

	function chunkStart(code: Code): State | undefined {
		effects.enter("mathFlowValue");
		return code === BACKSLASH ? backslash(code) : chunk(code);
	}

	function chunk(code: Code): State | undefined {
		if (code === null || isLineEnding(code)) {
			effects.exit("mathFlowValue");
			return beforeChunk(code);
		}
		if (code === BACKSLASH) {
			return effects.check(closingTail, exitValueThenClose, backslash)(code);
		}
		if (!isSpace(code)) lineHasContent = true;
		if (isDisplaySignal(code)) sawSignal = true;
		effects.consume(code);
		return chunk;
	}

	function backslash(code: Code): State | undefined {
		lineHasContent = true;
		effects.consume(code);
		return afterBackslash;
	}

	function afterBackslash(code: Code): State | undefined {
		if (code === null || isLineEnding(code) || isSpace(code)) {
			return chunk(code);
		}
		sawSignal = true;
		effects.consume(code);
		return chunk;
	}

	function exitValueThenClose(code: Code): State | undefined {
		effects.exit("mathFlowValue");
		return closeFence(code);
	}

	function closeFence(code: Code): State | undefined {
		// `\[1\]` on its own line is a reference marker, not an equation.
		if (!sawSignal) return nok(code);
		effects.enter("mathFlowFence");
		effects.enter("mathFlowFenceSequence");
		effects.consume(code);
		return closeBracket;
	}

	function closeBracket(code: Code): State | undefined {
		effects.consume(code);
		effects.exit("mathFlowFenceSequence");
		return closeAfter;
	}

	function closeAfter(code: Code): State | undefined {
		if (isSpace(code)) {
			effects.enter("whitespace");
			return closeSpaces(code);
		}
		return closeDone(code);
	}

	function closeSpaces(code: Code): State | undefined {
		if (isSpace(code)) {
			effects.consume(code);
			return closeSpaces;
		}
		effects.exit("whitespace");
		return closeDone(code);
	}

	function closeDone(code: Code): State | undefined {
		// Guaranteed EOL/EOF by `closingTail`.
		effects.exit("mathFlowFence");
		effects.exit("mathFlow");
		return ok(code);
	}
}

/**
 * Registered under `\` in the flow map. `concrete` as upstream's `$$` fence:
 * a lazy line cannot continue it.
 */
export const bracketMathFlow: Construct = {
	name: "mathFlowBracket",
	tokenize: tokenizeBracketFlow,
	concrete: true,
};

/** The micromark extension the remark plugin registers next to the `$` one. */
export const backslashMathSyntax = {
	flow: { [BACKSLASH]: [bracketMathFlow] },
	text: { [BACKSLASH]: [backslashMathText] },
};

/* ---------------------------------------------------------------------------
 * mdast: the `\[...\]` text form as a display-mode `inlineMath`.
 * ---------------------------------------------------------------------------
 */

type InlineMathNode = {
	type: "inlineMath";
	value: string;
	data: {
		hName: string;
		hProperties: { className: string[] };
		hChildren: Array<{ type: "text"; value: string }>;
	};
};
type CompileContext = {
	enter: (node: InlineMathNode, token: Token) => void;
	exit: (token: Token) => void;
	buffer: () => void;
	resume: () => string;
	stack: unknown[];
};

/**
 * `mathFromMarkdown`'s `mathText` handlers with one difference: the hast class
 * is `math-display`, which `rehype-katex` reads as display mode. The node stays
 * `inlineMath` because it sits inside a paragraph; a block-level `math` there
 * would become a `<pre>` inside a `<p>`.
 */
export const backslashMathFromMarkdown = {
	enter: {
		[DISPLAY_TEXT](this: CompileContext, token: Token) {
			this.enter(
				{
					type: "inlineMath",
					value: "",
					data: {
						hName: "code",
						hProperties: { className: ["language-math", "math-display"] },
						hChildren: [],
					},
				},
				token,
			);
			this.buffer();
		},
	},
	exit: {
		[DISPLAY_TEXT](this: CompileContext, token: Token) {
			const value = this.resume();
			const node = this.stack[this.stack.length - 1] as InlineMathNode;
			this.exit(token);
			node.value = value;
			node.data.hChildren.push({ type: "text", value });
		},
	},
};
