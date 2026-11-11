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
 *   (a) an opener's next character must exist and not be whitespace (space,
 *       tab, EOL): `$ 50` cannot open a span. (Until 2026-11-10 an ASCII digit
 *       was refused here too; see (d), which replaced that arm.)
 *   (b) a closer's immediate left neighbour must not be whitespace.
 *   (c) a closer's immediate right neighbour (the character after the closing
 *       run) must not be an ASCII digit.
 *   (d) MONEY VERSUS MATH (operator report, 2026-11-10: "differentiate between
 *       dollar values ... and latex components"). A span whose opener is
 *       followed by a digit is accepted only if its content carries a TeX
 *       signal: a backslash followed by a visible character (`\mu`, `\,`,
 *       `\{`), `^`, `_`, `{` or `}`. A price never carries one - `$5/$6`,
 *       `$5)$` and the like slip past (b) and (c) but fail here - while the
 *       quantities the operator's screenshot showed as raw source all do:
 *       `$10^3\text{–}10^5\times$`, `$10\text{ }\mu\text{m}^3$`,
 *       `$20\text{ cm/s}$`, `$8\text{ }\mu\text{m}$`, and `$2^n - 1$`. The
 *       common price shapes never reach (d) at all: `$20,000 and $30,000`,
 *       `$5 to $10` and `costs $5 and $10` fail (b) (space before the
 *       closer), `$3–$4` and `$5M/$1.2B` fail (c) (digit after it), `$5.00`
 *       and `$1,000` find no closer, `\$5` is an escape. A price ahead of a
 *       formula still cannot steal it (`pay $5 now, where $x^2$ holds`): the
 *       `$5` attempt fails at its closer and scanning resumes after it.
 *
 * All four apply to `sizeOpen === 1` only: `$$` display and multi-dollar
 * inline behaviour are upstream's, byte for byte. When a candidate close fails
 * (b), (c) or (d) the attempt FAILS: the opening `$` stays literal text and
 * scanning resumes AFTER it, so a rejected closer cannot leave the span open
 * for a later `$` to close across prose. Measured on the alternative (demote
 * the run to data and keep scanning), `cost $a$5 and $b$ now` became one
 * `inlineMath("a$5 and $b")` - a span across prose that KaTeX paints as a red
 * ParseError where upstream rendered two clean spans (agent review round 1,
 * R1-1; QA's live rows are its space-left and tab-left spellings). The same
 * rule keeps `$0.30/M fresh-in, $0.006/M cached-in` literal: the first `$`
 * opens, its candidate closer sits after a space, the attempt fails, and the
 * second `$` finds no closer at all. The OTHER
 * demote path - a close run whose SIZE does not match the opener's, upstream's
 * own recovery for a size mismatch - is untouched. Rationale for each arm is
 * on the guard itself below.
 *
 * GUARD (d) AGREES WITH THE PIPELINE GATE. `markdown-math.ts`'s
 * `hasDigitLedMath` asks the same question of the raw string (digit-led span,
 * non-space before the closer, no digit after it, a TeX signal inside), so a
 * document whose ONLY math is digit-led turns the pipeline on and a document
 * of only prices does not. The agreement is at the shape level, not the
 * document level: the gate decides per DOCUMENT whether to pay for KaTeX at
 * all, the parser decides per SPAN.
 *
 * LATEX'S OWN DELIMITERS - `\(...\)`, `\[...\]` - are a second extension the
 * plugin below registers, documented in `markdown-math-backslash.ts`; the
 * resolver both share is vendored once in `markdown-math-resolve.ts`.
 *
 * PROVENANCE AND REFRESH. `guardedMathText` below is
 * `micromark-extension-math@3.1.0`'s `lib/math-text.js` (MIT, © Titus Wormer
 * et al), vendored with the four guards and two changes of spelling:
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
 * `(b)`, `(c)`, `(d)` sit (the resolver lives in `markdown-math-resolve.ts`;
 * refresh it from the same file).
 * `markdown-math-backslash.ts`'s flow construct follows upstream's
 * `lib/math-flow.js`; re-read it there too. The two runtime imports below (`math`, `mathFromMarkdown`)
 * come from the packages themselves and track them automatically.
 *
 * THE TRADE-OFFS, stated so a reviewer does not have to derive them:
 *
 *   - spaced single-dollar math no longer renders: `$ x + y = z $` stays
 *     literal. Pandoc's own rule refuses both ends of it, and a text that
 *     writes both spaces is far more often two prices than a formula.
 *   - digit-led single-dollar math renders only with a TeX signal (guard
 *     (d)): `$2^n - 1$` and `$10\text{ }\mu\text{m}$` render, while a
 *     signal-free digit-led span such as `$3 + 4$` stays literal - it is
 *     indistinguishable from a price pair by content alone. Such a formula
 *     renders as `\(3 + 4\)` or `$$3 + 4$$`, because neither delimiter is
 *     ever a price.
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
import {
	backslashMathFromMarkdown,
	backslashMathSyntax,
} from "./markdown-math-backslash";
import { resolveMathText } from "./markdown-math-resolve";

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
/** `\` - micromark-util-symbol's `codes.backslash`. */
const BACKSLASH = 92;
/**
 * The single characters that mark a digit-led span as TeX rather than a price:
 * `^` (94), `_` (95), `{` (123), `}` (125). The fifth signal, a backslash
 * followed by a visible character, needs one character of memory and is
 * tracked in the tokenizer's `data` state.
 *
 * Why these and nothing else: each is meaningless in a currency amount and
 * nearly universal in typeset quantities (exponents, subscripts, `\text{}`
 * groups, units like `\mu`). Operators such as `\times` are commands, so they
 * are covered by the backslash arm; a bare `*`, `/`, `-` or `=` is not a
 * signal because prose around prices uses all of them (`$5/$6`, `$5-$10`).
 */
const isTexSignal = (code: Code): boolean =>
	code === 94 || code === 95 || code === 123 || code === 125;

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
		/** The opener was `$` + ASCII digit: GUARD (d) applies at the closer. */
		let digitLed = false;
		/** The span's content so far carries a TeX signal (see `isTexSignal`). */
		let sawSignal = false;
		/** The previous data code was an unpaired backslash. */
		let afterBackslash = false;
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
			 * WITH. Measured case: `$ 50` (space) - a span may not open on
			 * whitespace.
			 *
			 * A DIGIT NO LONGER REFUSES THE OPENER OUTRIGHT (operator report,
			 * 2026-11-10: `$10^3\text{–}10^5\times$`, `$20\text{ cm/s}$` and
			 * `$8\text{ }\mu\text{m}$` all rendered as raw source). A digit-led
			 * opener is recorded instead, and the decision moves to the
			 * CLOSER (GUARD (d) below), where the span's content is known: a
			 * price never carries a TeX signal, a quantity written in TeX
			 * almost always does. `pay $5 now, where $x^2$ holds` still keeps
			 * its formula - the `$5` attempt reaches a closer whose left is a
			 * space, (b) fails it, and scanning resumes after the price's `$`.
			 */
			if (sizeOpen === 1 && isGuardWhitespace(code)) {
				return nok(code);
			}
			digitLed = sizeOpen === 1 && isDigit(code);

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
				// A backslash before a space, EOL or `$` is not a command.
				afterBackslash = false;
				effects.exit("mathTextData");
				return between(code);
			}

			if (afterBackslash) {
				// `\` + any visible character: `\mu`, `\,`, `\{`, `\\`.
				sawSignal = true;
				afterBackslash = false;
			} else if (code === BACKSLASH) {
				afterBackslash = true;
			} else if (isTexSignal(code)) {
				sawSignal = true;
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

				/*
				 * GUARD (d) - A DIGIT-LED SPAN MUST PROVE IT IS TEX (operator
				 * report, 2026-11-10: "differentiate between dollar values ...
				 * and latex components"). The content must carry a backslash
				 * command, `^`, `_`, `{` or `}` - see `isTexSignal`. Prices
				 * never do: `$5/$6`, `$5)$` and every other shape that slips past
				 * (b) and (c) has content like `5/` or `5)`, while
				 * `$10\text{ }\mu\text{m}^3$` and `$2^n - 1$` both carry one.
				 * Without a signal the attempt FAILS exactly as (b)/(c) do, so
				 * the price's `$` stays literal and nothing spans prose.
				 * Letter-led spans are not asked: `$x$` has no signal and must
				 * still render, as it always has.
				 */
				if (sizeOpen === 1 && digitLed && !sawSignal) {
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
	/*
	 * LaTeX's own delimiters, `\(...\)` and `\[...\]` (2026-11-10), as a SECOND
	 * extension rather than extra keys on the first, so the `$` extension stays
	 * the identity-checked object the harness pins. Keyed on `\`, they are tried
	 * before `characterEscape`; see `markdown-math-backslash.ts`.
	 */
	micromarkExtensions.push(backslashMathSyntax);
	fromMarkdownExtensions.push(mathFromMarkdown());
	fromMarkdownExtensions.push(backslashMathFromMarkdown);
}
