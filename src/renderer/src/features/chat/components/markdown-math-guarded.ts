/**
 * THE MATH PIPELINE'S SINGLE-DOLLAR RULES, WITH PANDOC'S ADJACENCY GUARDS
 * (operator report, 2026-09-27).
 *
 * WHAT THIS REPLACES, AND WHY. The renderer used to wire `remark-math`, whose
 * single-dollar inline syntax has NO adjacency rules: once math is on for a
 * message, the `$` of `$0.30/M` and the `$` of a later price pair up into one
 * `inlineMath` node and KaTeX typesets everything between them - so a cost
 * report's bold breaks and its amounts render as italic LaTeX fragments
 * (`Costs are $0.30/M fresh-in and $0.006/M cached-in.` measured:
 * `inlineMath("0.30/M fresh-in and ")` + a stray `text("0.006/M cached-in.")`).
 * The operator's screenshot is a cost report in exactly that state. Measured
 * before the fix, through the renderer's own pipeline, on four documents the
 * evidence set photographs (`docs/evidence/chat-math-currency-before/`):
 *
 *   - a cost-report bullet renders `**11-call review = ` + KaTeX `0.0146 * (`
 *     + plain `291k input, ...` - the bold markers end up inside and outside
 *     the formula;
 *   - pandoc's classic `$20,000 and $30,000` renders as
 *     `inlineMath("20,000 and ")` + `text("30,000 in total; ...")`;
 *   - `pay $5 now, where $x^2$ holds` renders `inlineMath("5 now, where ")`
 *     + literal text `x^2$ holds` - the price steals the formula's opener;
 *   - `$a$-$b$`-style genuine spans are unaffected (they are already clean).
 *
 * THE RULE, and it is micromark's own extension point that has to carry it.
 * `markdown-math.ts` documents why this cannot be a remark plugin: the split
 * happens at PARSE time, before any plugin in the list sees a tree, so the fix
 * must be a syntax extension. This module registers the same extension
 * `remark-math` does - upstream's flow (`$$` display) untouched, upstream's
 * `mathFromMarkdown` transform untouched - except for the single-dollar TEXT
 * tokenizer, which is vendored with pandoc's documented guards:
 *
 *   (a) an opener's next character must exist and be neither whitespace (space,
 *       tab, EOL) nor an ASCII digit. `$ 50` cannot open a span, and neither
 *       can `$5` - which is also what stops a price from stealing a later
 *       genuine span's closer (`pay $5 now, where $x^2$ holds`).
 *   (b) a closer's immediate left neighbour must not be whitespace.
 *   (c) a closer's immediate right neighbour (the character after the closing
 *       run) must not be an ASCII digit.
 *
 * All three apply to `sizeOpen === 1` only: `$$` display and multi-dollar
 * inline behaviour are upstream's, byte for byte. When a candidate close fails
 * (b) or (c) the attempt FAILS: the opening `$` stays literal text and
 * scanning resumes AFTER it, so a rejected closer cannot leave the span open
 * for a later `$` to close across prose. Measured on the alternative (demote
 * the run to data and keep scanning), `cost $a$5 and $b$ now` became one
 * `inlineMath("a$5 and $b")` - a span across prose that KaTeX paints as a red
 * ParseError where upstream rendered two clean spans (agent review round 1,
 * R1-1; QA's live rows are its space-left and tab-left spellings). Guard (a)
 * alone keeps `$0.30/M fresh-in, $0.006/M cached-in` literal (both `$`s are
 * digit-led and refused at the opener); this rule is what keeps the same text
 * clean when an opener survives and a later closer is rejected. The OTHER
 * demote path - a close run whose SIZE does not match the opener's, upstream's
 * own recovery for a size mismatch - is untouched. Rationale for each arm is
 * on the guard itself below.
 *
 * THE DIGIT ARM AGREES WITH THIS REPOSITORY'S OWN HEURISTIC. `markdown-math.ts`
 * gates the pipeline with "a lone dollar sign only counts when it is not
 * followed by a digit", so the parser refuses the same digit-led shape the
 * gate already reads as a price - the two rules agree on WHAT A PRICE LOOKS
 * LIKE. The agreement is at the shape level, not the document level: the gate
 * decides per DOCUMENT whether to pay for KaTeX at all (any one renderable
 * span keeps the pipeline on, whatever the other dollars look like), while
 * the parser decides per SPAN. The gate's behaviour is unchanged.
 *
 * PROVENANCE AND REFRESH. `guardedMathText` below is
 * `micromark-extension-math@3.1.0`'s `lib/math-text.js` (MIT, © Titus Wormer
 * et al), vendored with the three guards and two changes of spelling:
 * `devlop` assertions are dropped (they are development-only, and importing
 * `devlop` would add a dependency for a no-op), and the micromark helper types
 * are spelled structurally for the reason `remark-soft-breaks.ts` states -
 * `micromark-util-types` is a transitive dependency of the markdown stack and
 * not this repository's own, so an import from application source would
 * resolve only by accident under pnpm's isolated layout. The algorithm, the
 * token names, the EOF semantics (`null`) and the resolver are upstream's.
 * TO REFRESH: diff this file's `guardedMathText` against
 * `node_modules/micromark-extension-math/lib/math-text.js` after any bump of
 * the package, and re-apply the guards where the comment markers `GUARD (a)`,
 * `(b)`, `(c)` sit. The two runtime imports below (`math`, `mathFromMarkdown`)
 * come from the packages themselves and track them automatically.
 *
 * THE TRADE-OFFS, stated so a reviewer does not have to derive them:
 *
 *   - spaced single-dollar math no longer renders: `$ x + y = z $` stays
 *     literal. Pandoc's own rule refuses both ends of it, and a text that
 *     writes both spaces is far more often two prices than a formula.
 *   - digit-led single-dollar math no longer renders: `$2^n - 1$` stays
 *     literal. The gate above refuses a DOCUMENT whose only dollar signals
 *     are digit-led, but a mixed document keeps the pipeline on - `the
 *     identity $2^n - 1$ is odd and $$E = mc^2$$` rendered both spans under
 *     `remark-math` and now renders the display span alone - so a digit-led
 *     single-dollar span in a mixed document is a REAL change, not a
 *     consistency fix. If such a formula is needed, write it as display math
 *     (`$$2^n - 1$$`) or start the single-dollar span with a non-digit
 *     (`$\left(2^n - 1\right)$`).
 *   - a closer followed by a digit fails the attempt (`a $x$5` is literal,
 *     while a later `$b$` in the same text still typesets), because `$5`
 *     there is a price and a span boundary drawn across it would be a guess.
 *
 * Everything else - `$$` display, multi-dollar inline, fenced and indented
 * code, `\$` escapes, citations' own dollar sign - keeps the behaviour it had
 * under `remark-math`; `scripts/currency-math.test.mjs` pins all of it, and
 * includes an equality check that this plugin and `remark-math` produce
 * IDENTICAL trees for a corpus of genuine math.
 */

import { mathFromMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import type { Options } from "micromark-extension-math";
import type { Processor } from "unified";

/*
 * The shapes this file reads from micromark's tokenizer protocol, spelled
 * structurally (see PROVENANCE above). They are the same protocol upstream's
 * `math-text.js` reads through `micromark-util-types`; only the type names
 * differ, and the runtime contract is pinned by the harness through the real
 * pipeline rather than by structural identity.
 */
type Code = number | null;
type State = (code: Code) => State | undefined;
type Token = { type: string };
type Event = [enter: string, token: Token & { end: unknown }, context: unknown];
type Effects = {
	enter: (type: string) => Token;
	consume: (code: Code) => void;
	exit: (type: string) => void;
};
type TokenizeContext = {
	events: Array<[string, { type: string }]>;
	/** The code point immediately before the one being tokenized. */
	previous: Code;
};
type Tokenizer = (
	this: TokenizeContext,
	effects: Effects,
	ok: State,
	nok: State,
) => State;
type Resolver = (events: Event[]) => Event[];
type Previous = (this: TokenizeContext, code: Code) => boolean;
/** The construct `micromark-extension-math` registers under the `$` code. */
type MathTextConstruct = {
	tokenize: Tokenizer;
	resolve: Resolver;
	previous: Previous;
	name: string;
};

/** `$` — micromark-util-symbol's `codes.dollarSign`. */
const DOLLAR_SIGN = 36;
/** micromark's `markdownLineEnding`: CR, LF, CRLF — the codes below -2. */
const isLineEnding = (code: Code): boolean => code !== null && code < -2;
/**
 * Whether a code is whitespace for the guards: EOF, an ASCII space, or any
 * negative micromark code (tab, virtual space, the three line endings).
 *
 * Wider than `isLineEnding` on purpose: guards (a) and (b) refuse a TAB as
 * well (`a $\tx$ b` and `a $x\t$ b` both stay literal), which upstream's own
 * `between`/`data` states do not treat specially - a tab is data inside a
 * span there, and that behaviour is kept below.
 */
const isGuardWhitespace = (code: Code): boolean =>
	code === null || code === 32 || code < 0;
/** ASCII 0-9. */
const isDigit = (code: Code): boolean =>
	code !== null && code >= 48 && code <= 57;

/**
 * The single-dollar text tokenizer, upstream's `mathText` with the guards.
 *
 * `options.singleDollarTextMath === false` keeps its upstream meaning (only
 * `$$` opens text math), in which case the guards are unreachable - every
 * single-dollar attempt is refused by the option first.
 */
const guardedMathText = (
	options?: Options | null | undefined,
): MathTextConstruct => {
	const single = options?.singleDollarTextMath ?? true;

	return {
		tokenize: tokenizeMathText,
		resolve: resolveMathText,
		previous,
		name: "mathText",
	};

	/**
	 * The tokenizer. Upstream's state machine, with three additions, each
	 * marked `GUARD` at the point it fires.
	 */
	function tokenizeMathText(
		this: TokenizeContext,
		effects: Effects,
		ok: State,
		nok: State,
	): State {
		const self = this;
		let sizeOpen = 0;
		/**
		 * The code immediately left of the closing run being scanned. Set when
		 * a `$` opens a candidate closing sequence, because by the time the run
		 * is judged the tokenizer is past the character that decides guard (b).
		 */
		let closeGuardPrev: Code = null;
		let size: number;
		let token: Token;

		return start;

		/** Start of math (text). `$a$`, or the first `$` of `$$a$$`. */
		function start(code: Code): State | undefined {
			effects.enter("mathText");
			effects.enter("mathTextSequence");
			return sequenceOpen(code);
		}

		/** In opening sequence. */
		function sequenceOpen(code: Code): State | undefined {
			if (code === DOLLAR_SIGN) {
				effects.consume(code);
				sizeOpen++;
				return sequenceOpen;
			}

			// Not enough markers in the sequence (upstream, unchanged): with
			// `singleDollarTextMath: false` a lone `$` cannot open.
			if (sizeOpen < 2 && !single) {
				return nok(code);
			}

			/*
			 * GUARD (a) - AN OPENER MUST TOUCH SOMETHING A FORMULA CAN START
			 * WITH. Measured cases: `$ 50` (space), `$5` (digit) and
			 * `pay $5 now, where $x^2$ holds` - without this arm the `$` of
			 * `$5` opens a span that runs to the formula's opening `$`, and
			 * the prose between them is typeset as the formula `5 now, where`.
			 * The digit half is `markdown-math.ts`'s own gate rule ("a lone
			 * dollar sign only counts when it is not followed by a digit"),
			 * applied at parse time.
			 */
			if (sizeOpen === 1 && (isGuardWhitespace(code) || isDigit(code))) {
				return nok(code);
			}

			effects.exit("mathTextSequence");
			return between(code);
		}

		/** Between something and something else. */
		function between(code: Code): State | undefined {
			if (code === null) {
				return nok(code);
			}

			if (code === DOLLAR_SIGN) {
				token = effects.enter("mathTextSequence");
				size = 0;
				closeGuardPrev = self.previous;
				return sequenceClose(code);
			}

			// Tabs don't work, and virtual spaces don't make sense (upstream).
			if (code === 32) {
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

			// Data.
			effects.enter("mathTextData");
			return data(code);
		}

		/** In data. */
		function data(code: Code): State | undefined {
			if (
				code === null ||
				code === 32 ||
				code === DOLLAR_SIGN ||
				isLineEnding(code)
			) {
				effects.exit("mathTextData");
				return between(code);
			}

			effects.consume(code);
			return data;
		}

		/** In closing sequence. */
		function sequenceClose(code: Code): State | undefined {
			// More.
			if (code === DOLLAR_SIGN) {
				effects.consume(code);
				size++;
				return sequenceClose;
			}

			// Done!
			if (size === sizeOpen) {
				/*
				 * GUARDS (b) AND (c) - A SINGLE-DOLLAR CLOSER MUST NOT SIT
				 * AGAINST WHITESPACE ON ITS LEFT NOR A DIGIT ON ITS RIGHT.
				 * Measured cases: `$20,000 and $30,000` (pandoc's own example -
				 * the second `$` sits after a space, so without (b) the pair
				 * typesets `20,000 and`); `a $x $ b` (space before the closer);
				 * `price $x$5 more` (digit after it).
				 *
				 * A REJECTED CANDIDATE FAILS THE ATTEMPT. Demoting the run to
				 * data and scanning on - what this did until R1-1 - leaves the
				 * span OPEN, and the next eligible `$` then closes a span whose
				 * value contains the rejected run: `cost $a$5 and $b$ now`
				 * became one `inlineMath("a$5 and $b")`, which KaTeX paints as
				 * a red ParseError where upstream rendered two clean spans.
				 * `nok` makes the opening `$` literal and resumes scanning
				 * AFTER it, so `a $x $ stays literal, and $w^2$ renders` keeps
				 * its prose and still typesets `w^2` (QA's live row 10; rows 11
				 * and 13 are the digit-right and tab-left spellings). Nothing
				 * spans prose. ONE RED-BOX CLASS REMAINS AND IS UPSTREAM'S OWN:
				 * a closer whose immediate left is an escape-consumed `$` can end
				 * a span on `<space>\`, which is invalid LaTeX - the minimal
				 * `$a \$b` paints the same red box, with the same span value,
				 * under `remark-math` and under the pre-fix module, so the
				 * acceptance is upstream's own scan and is kept for parity
				 * (round 2, R2-2; the class is pinned in
				 * `scripts/currency-math.test.mjs`).
				 */
				if (
					sizeOpen === 1 &&
					(isGuardWhitespace(closeGuardPrev) || isDigit(code))
				) {
					return nok(code);
				}

				effects.exit("mathTextSequence");
				effects.exit("mathText");
				return ok(code);
			}

			// More or less accents: mark as data.
			token.type = "mathTextData";
			return data(code);
		}
	}
};

/**
 * Upstream's resolver, unchanged: it merges adjacent data and marks the
 * padding spaces of a span whose ends are both spaces. (With the guards above
 * a single-dollar span can no longer start or end on a space, so for those the
 * padding branch is unreachable; it stays because `$$`-opened and multi-dollar
 * spans still reach it, and they must resolve exactly as they did.)
 */
function resolveMathText(events: Event[]): Event[] {
	let tailExitIndex = events.length - 4;
	let headEnterIndex = 3;
	let index: number;
	let enter: number | undefined;

	// If we start and end with an EOL or a space.
	if (
		(events[headEnterIndex][1].type === "lineEnding" ||
			events[headEnterIndex][1].type === "space") &&
		(events[tailExitIndex][1].type === "lineEnding" ||
			events[tailExitIndex][1].type === "space")
	) {
		index = headEnterIndex;

		// And we have data.
		while (++index < tailExitIndex) {
			if (events[index][1].type === "mathTextData") {
				// Then we have padding.
				events[tailExitIndex][1].type = "mathTextPadding";
				events[headEnterIndex][1].type = "mathTextPadding";
				headEnterIndex += 2;
				tailExitIndex -= 2;
				break;
			}
		}
	}

	// Merge adjacent spaces and data.
	index = headEnterIndex - 1;
	tailExitIndex++;
	while (++index <= tailExitIndex) {
		if (enter === undefined) {
			if (index !== tailExitIndex && events[index][1].type !== "lineEnding") {
				enter = index;
			}
		} else if (
			index === tailExitIndex ||
			events[index][1].type === "lineEnding"
		) {
			events[enter][1].type = "mathTextData";
			if (index !== enter + 2) {
				events[enter][1].end = events[index - 1][1].end;
				events.splice(enter + 2, index - enter - 2);
				tailExitIndex -= index - enter - 2;
				index = enter + 2;
			}
			enter = undefined;
		}
	}
	return events;
}

/**
 * Upstream's `previous` guard, unchanged: a `$` that an escape consumed
 * (`\$`) never starts a construct.
 */
function previous(this: TokenizeContext, code: Code): boolean {
	// If there is a previous code, there will always be a tail.
	return (
		code !== DOLLAR_SIGN ||
		this.events[this.events.length - 1][1].type === "characterEscape"
	);
}

/**
 * Upstream's `$$` display flow map, built once and registered by the plugin
 * below. Exported so the harness can assert the registration by IDENTITY: the
 * pushed extension's `flow` IS this object, and its `[DOLLAR_SIGN]` entry IS
 * the package's own display construct (a module-level constant inside
 * `micromark-extension-math`, so every `math()` call shares it). The flow map
 * never reads `options`, and every `math()` call builds a fresh map whose
 * `[DOLLAR_SIGN]` entry is that module-level constant
 * (`math().flow !== math().flow`, but `math().flow[36] === math().flow[36]`),
 * so one shared instance is behaviour-preserving (agent review round 1, R1-3;
 * wording corrected per round 2, R2-4).
 */
export const upstreamMathFlow = math().flow;

/**
 * The default guarded single-dollar construct - options-free, i.e. single
 * dollar math ON - shared between the plugin's default path and the harness's
 * identity assertions. Sharing one instance is safe because the construct
 * holds no per-parse state: every `tokenize` call builds its own locals.
 */
export const defaultGuardedMathText = guardedMathText();

/**
 * The remark plugin the renderer wires in place of `remark-math`: upstream's
 * flow map for `$$`, upstream's `mathFromMarkdown` transform, and the guarded
 * single-dollar tokenizer above. `toMarkdown` is deliberately not registered -
 * this repository renders markdown and never serialises it.
 */
export default function remarkGuardedMath(
	this: Processor,
	options?: Options | null | undefined,
): undefined {
	const data = this.data() as {
		micromarkExtensions?: unknown[];
		fromMarkdownExtensions?: unknown[];
	};
	data.micromarkExtensions ??= [];
	data.fromMarkdownExtensions ??= [];
	const micromarkExtensions = data.micromarkExtensions;
	const fromMarkdownExtensions = data.fromMarkdownExtensions;

	/*
	 * `flow` is upstream's `$$` display map; only the `text` entry is replaced,
	 * with the guarded construct. `singleDollarTextMath === false` keeps its
	 * upstream meaning (only `$$` opens text math), so an explicit option
	 * builds its own construct while the default shares the module-level one.
	 */
	const text =
		options?.singleDollarTextMath === undefined
			? defaultGuardedMathText
			: guardedMathText(options);
	micromarkExtensions.push({
		flow: upstreamMathFlow,
		text: { [DOLLAR_SIGN]: text },
	});
	fromMarkdownExtensions.push(mathFromMarkdown());
}
