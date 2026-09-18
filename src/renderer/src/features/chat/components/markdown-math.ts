/**
 * Whether a document is worth the math pipeline, as a pure decision the citation
 * transform can veto.
 *
 * WHY THIS IS NOT IN `markdown-renderer.tsx` ANY MORE (code review round 1,
 * R1-1). `containsLatex` lived beside the pipeline it gates, which was fine while
 * the only thing that could go wrong was a wasted KaTeX chunk. It is not fine
 * once the answer can DESTROY a citation: the citation transform runs as a remark
 * plugin, and `remark-math` registers a micromark SYNTAX extension, so the split
 * it performs happens at PARSE time - before any plugin in the list gets a tree.
 * The two features cannot both be argued about inside a React hook that no test
 * can drive, so the decision moved here, where it is a function of a string and
 * `scripts/credential-capture.test.mjs` can exhaust it.
 *
 * THE DEFECT IT FIXES, which shipped and was caught in review rather than by any
 * frame: `INLINE_MATH_REGEX` is `\$…\$`, and every citation the app writes carries
 * exactly ONE `$` (`... available to bash and eval as $LOP_SECRET_…; ...`). One
 * citation alone never matches; TWO of them on one line always do, so
 * `containsLatex` answered `true`, remark-math was enabled, micromark paired the
 * two citations' `$`s into a single `inlineMath` node, and both citation texts
 * were cut into fragments before `remarkCredentialCitations` ever ran. The
 * operator's own sentence - the words between the two `$`s, which are the app's
 * citation - was then typeset as a formula, and neither reference was chipped:
 * the exact defect this change exists to remove, reproduced by the shape its own
 * unit test calls supported. The reviewer's repro, on the shipped tree:
 *
 *   containsLatex(src) = true
 *   math OFF: {"link":2,"inlineMath":0}
 *   math ON : {"link":0,"inlineMath":1}
 *
 * THE RULE, and it is deliberately blunt: when the document contains a citation,
 * math is enabled only if the document offers the parser nothing ELSE to pair
 * that citation's `$` with. Formally - a citation is present, `maskCitations`
 * leaves no `$` behind, and the document holds fewer than two pairable `$`s in
 * total. Two pairable `$`s are enough for micromark to make a pair out of them,
 * and a citation is the half of that pair whose failure is silent (the chip
 * simply does not appear, and the words the app wrote are rendered as math), so
 * anything ambiguous resolves in the citation's favour:
 *
 *   - two citations on one line - the reported shape - vetoes math;
 *   - one citation plus a `$VAR` mention or any other `$…$` on the page vetoes
 *     math;
 *   - one citation alone does not (one `$` cannot pair with itself), which is
 *     every state the shipped frames photograph;
 *   - a document with no citation at all is untouched: `containsRenderableMath`
 *     is then exactly the old `containsLatex`, so agent output, reasoning and
 *     every non-opt-in render keep the pipeline they had.
 *
 * WHAT IT COSTS, said plainly: a message that cites a credential AND contains a
 * formula renders the formula as its own literal `$…$` source. That is the
 * trade the contract asks for - the citation is the app's own receipt and the
 * operator cannot recover it from anywhere else, while a formula they wrote is
 * still on screen, in their words, untypeset - and it is the same shape as the
 * fenced and in-code negatives this feature already ships, where the citation is
 * left byte-identical rather than transformed.
 *
 * WHY THE RULE IS DOCUMENT-WIDE rather than per paragraph, which would be more
 * permissive: micromark pairs `$`s across a whole document's inline content, and
 * a rule that tries to prove a pair is impossible would have to re-implement the
 * tokenizer it is trying to predict. A wrong guess here is a citation that
 * vanishes; a conservative one is a formula shown as source. The features are
 * both still available - just not in the same document.
 */

import { citationSegments } from "./credential-capture";

export const INLINE_MATH_REGEX = /\$(?!\d)(.+?)\$/;
export const DISPLAY_MATH_REGEX = /\$\$([\s\S]+?)\$\$/;
export const MATH_ENVIRONMENT_REGEX = /\\begin\{([^}]+)\}([\s\S]+?)\\end\{\1\}/;
export const MATH_COMMAND_REGEX = /\\[a-zA-Z]+(\{[^}]*\})?/;

/** Every `$` the parser would consider a candidate opener: not one before a digit. */
const PAIRABLE_DOLLAR = /\$(?!\d)/g;

/**
 * Whether the content is worth paying for the math pipeline at all.
 *
 * Cheap rejections first: bare `$` is far more often a price than an inline
 * formula, so a lone dollar sign only counts when it is not followed by a
 * digit, and a backslash command only counts alongside one of the four
 * constructs that are unambiguously mathematical.
 */
export const containsLatex = (content: string): boolean => {
	if (INLINE_MATH_REGEX.test(content)) return true;
	if (DISPLAY_MATH_REGEX.test(content)) return true;
	if (MATH_ENVIRONMENT_REGEX.test(content)) return true;
	return (
		MATH_COMMAND_REGEX.test(content) &&
		(content.includes("\\frac") ||
			content.includes("\\sum") ||
			content.includes("\\int") ||
			content.includes("\\sqrt"))
	);
};

/** How many `$`s the parser could open a pair with. */
const pairableDollars = (content: string): number =>
	content.match(PAIRABLE_DOLLAR)?.length ?? 0;

/**
 * The content with every citation run replaced by an inert run of `x`s.
 *
 * Same length as the run it replaces, so an offset into the masked string is an
 * offset into the original - and `x` rather than a space, so masking cannot
 * create or destroy a `$` adjacency or a backslash command that the original did
 * not have. `null` when there is no citation to mask, which is also how the
 * caller learns that there is nothing to protect.
 */
export const maskCitations = (content: string): string | null => {
	const segments = citationSegments(content);
	// One TEXT segment means the node held no citation at all.
	if (segments.length === 1 && segments[0].kind === "text") return null;
	let masked = "";
	let maskedAny = false;
	for (const segment of segments) {
		if (segment.kind === "text") {
			masked += segment.text;
			continue;
		}
		maskedAny = true;
		masked += "x".repeat(segment.text.length);
	}
	return maskedAny ? masked : null;
};

/**
 * Whether the math pipeline should be enabled for `content`.
 *
 * The one the renderer calls. See this file's header for the rule and for what
 * it costs; the short version is that a citation present in a document that holds
 * any other pairable `$` wins, and the formula is shown as source.
 */
export const containsRenderableMath = (content: string): boolean => {
	if (!containsLatex(content)) return false;
	const masked = maskCitations(content);
	// No citation: the old rule, unchanged, so every render that never opted in
	// behaves exactly as it did before this module existed.
	if (masked === null) return true;
	if (containsLatex(masked)) return false;
	// One citation carries one `$`; two of them, or one plus any other, is a pair.
	return pairableDollars(content) < 2;
};
