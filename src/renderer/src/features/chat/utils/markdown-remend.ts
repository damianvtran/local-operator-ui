/**
 * Optimistic closing of the markdown block that is still being written.
 *
 * ## Why this exists
 *
 * `StreamingMarkdown` parses every CLOSED block once and used to paint the
 * still-open block as literal text. The cost of that trade was a visible flash:
 * `` `InfoList` `` read as backticks for the second or two before its paragraph
 * closed, then jumped to a code span (operator report, four-frame sequence).
 * Parsing the open block as markdown removes the flash, but a half-written
 * block is not valid markdown - an unterminated `` ` `` swallows the rest of the
 * line, an open `**` turns the whole paragraph bold the moment its second
 * marker is missing, an open fence is a code block with no end. The remedy the
 * rest of the ecosystem settled on (Vercel's `remend`, ChatGPT's own renderer)
 * is to parse a COPY of the tail with the missing closers appended, so the
 * parse sees a well-formed block and the reader sees the formatting the writer
 * has already committed to.
 *
 * ## Contract
 *
 * - Pure, synchronous, allocation-light: it runs once per streamed frame on the
 *   tail only (a block, never the document), and returns the SAME string when
 *   there is nothing to close - which is every complete block, so a closed
 *   block's optimistic form is byte-identical to its final source and handing
 *   over to the settled renderer moves nothing.
 * - It only ever APPENDS closers or strips a DANGLING opener at the very end
 *   (`**` with no content behind it yet). It never edits earlier text, so the
 *   painted prefix cannot change under the reader when a later delta arrives:
 *   the "already-painted text must not reflow" property the plain tail kept.
 * - Code is opaque: nothing inside a code span or fence is read as emphasis.
 * - Deliberately NOT handled, because guessing wrong is worse than waiting:
 *   `[label](` links (the label paints as text until `)` arrives, then becomes a
 *   link - the browser would not know the target anyway), `$` math (a lone `$`
 *   is usually currency), raw HTML, and tables (a table is a paragraph of pipes
 *   until its delimiter row arrives, which is also what the full parse says).
 *
 * The emphasis rules are CommonMark's flanking rules in miniature - enough to
 * tell `*italic*` from a `*` bullet or a `2 * 3` product, and intra-word `_`
 * (`snake_case_name`) from an underscore emphasis - not a second parser. Where
 * they disagree with the real parse, the settled render wins within one frame of
 * the block closing, and `scripts/markdown-remend.test.mjs` pins the cases that
 * matter.
 */

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;

/** A delimiter run is one emphasis-ish marker: `*`, `**`, `_`, `__` or `~~`. */
type Opener = { marker: string; at: number };

const WHITESPACE = /\s/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const CARRIAGE_RETURN_END = /\r$/;
const TRAILING_SPACE = /[ \t]+$/;
const TRAILING_BLANK = /\s*$/;
const TRAILING_WHITESPACE = /\s+$/;
const BLANK_LINE_RUN = /\n[ \t]*\n/g;
const TABLE_ROW = /^[ ]{0,3}\|/;
const BACKTICK = /`/g;

const isWhitespace = (char: string | undefined): boolean =>
	char === undefined || char === "" || WHITESPACE.test(char);
const isWordChar = (char: string | undefined): boolean =>
	char !== undefined && WORD_CHAR.test(char);
const isPunctuation = (char: string | undefined): boolean =>
	char !== undefined && PUNCTUATION.test(char);

/**
 * The fence the text ends inside, or null.
 *
 * Reported separately from the closers because the renderer paints an open fence
 * directly (no markdown parse per frame for what can be kilobytes of code) and
 * must know its info string and body.
 */
export type OpenFence = {
	/** Everything before the fence's opening line, a paragraph the parse still owns. */
	before: string;
	/** The opening marker as written (``` or ~~~, any length). */
	marker: string;
	/** The info string (`ts`, `mermaid`, ...), trimmed; empty when none. */
	info: string;
	/** The code written so far, without the opening line. */
	body: string;
};

export function openFenceOf(source: string): OpenFence | null {
	let fence: { char: string; length: number } | null = null;
	let offset = 0;
	let start = -1;
	let marker = "";
	let info = "";
	while (offset <= source.length) {
		const next = source.indexOf("\n", offset);
		const end = next === -1 ? source.length : next;
		const line = source.slice(offset, end).replace(CARRIAGE_RETURN_END, "");
		if (fence === null) {
			const open = FENCE_OPEN.exec(line);
			// A backtick fence's info string may not contain a backtick: that is an
			// inline code span that happens to start the line.
			if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
				fence = { char: open[1][0], length: open[1].length };
				start = offset;
				marker = open[1];
				info = open[2].trim();
			}
		} else {
			let index = 0;
			while (index < 3 && line.charCodeAt(index) === 32) index += 1;
			let run = 0;
			while (line[index + run] === fence.char) run += 1;
			if (run >= fence.length && line.slice(index + run).trim() === "") {
				fence = null;
				start = -1;
			}
		}
		if (next === -1) break;
		offset = next + 1;
	}
	if (fence === null || start < 0) return null;
	const bodyStart = source.indexOf("\n", start);
	return {
		before: source.slice(0, start),
		marker,
		info,
		body: bodyStart === -1 ? "" : source.slice(bodyStart + 1),
	};
}

/**
 * `source` with whatever the writer has left open closed, for parsing only.
 *
 * An open fence is closed with its own marker on a fresh line. Past that, the
 * text is read once left to right: backtick runs open and close code spans
 * (opaque), and the emphasis delimiters outside them are matched with a stack.
 * Whatever is still open at the end is appended in reverse order - unless it was
 * opened at the very end with no content yet, in which case it is dropped, so
 * `foo **` paints `foo` rather than `foo ` + a literal `**`.
 */
export function closeOpenMarkdown(source: string): string {
	const fence = openFenceOf(source);
	if (fence !== null) {
		// The paragraph before a fence is the unit that closes; the blank line
		// between them is layout and stays between the closers and the fence.
		const gap = TRAILING_BLANK.exec(fence.before)?.[0] ?? "";
		const head =
			closeLastUnit(
				withoutDanglingTail(
					fence.before.slice(0, fence.before.length - gap.length),
				),
			) + gap;
		const tail = source.slice(fence.before.length);
		return head + tail + (tail.endsWith("\n") ? "" : "\n") + fence.marker;
	}
	return closeLastUnit(withoutDanglingTail(source));
}

const BLOCK_LINE_START = /^[ ]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]|^[ ]{0,3}>/;

/**
 * Close only the LAST inline unit: the final paragraph, or the final list item /
 * quote line within it. Emphasis never crosses a blank line or a list item in
 * CommonMark, so an opener in an earlier, already-complete unit is literal text
 * in the real parse and must stay literal here - closing it at the end of the
 * text would bold the wrong span. A table row is not an inline unit this module
 * guesses at (its cells close at the pipes), so it is left exactly as written.
 */
function closeLastUnit(text: string): string {
	let start = 0;
	const blank = new RegExp(BLANK_LINE_RUN.source, "g");
	for (let m = blank.exec(text); m !== null; m = blank.exec(text))
		start = m.index + m[0].length;
	let offset = start;
	for (const line of text.slice(start).split("\n")) {
		if (BLOCK_LINE_START.test(line)) start = offset;
		offset += line.length + 1;
	}
	if (TABLE_ROW.test(text.slice(start))) return text;
	return text.slice(0, start) + closeInline(text.slice(start));
}

/**
 * A line that is only a block marker (`#`, `-`, `>`, `1.`, a setext `=`) is the
 * writer mid-token: the full parse turns it into an EMPTY heading/list
 * item/quote - or, after a paragraph line, retypes that line as a setext
 * heading - and the next character retypes it again. Paint the block as if the
 * marker were not there yet. Only the LAST, unterminated line is ever touched.
 */
const BARE_MARKER_LINE =
	/(^|\n)[ ]{0,3}(?:#{1,6}|[-+*=]|>+|\d{1,9}[.)])[ \t]*$/;

/**
 * An unfinished link or image at the very end: `[label](http://exa`, `[label](`,
 * `[label`, `![alt](src`. The target is unknown until `)` arrives, so the label
 * paints as plain text (and an image paints nothing) rather than the raw
 * `](...)` syntax; the link appears the instant it is complete.
 */
const DANGLING_IMAGE = /!\[[^\]\n]*(?:\]\([^)\n]*)?$/;
const DANGLING_LINK = /\[([^\]\n]*)(?:\]\([^)\n]*)?$/;

function withoutDanglingTail(text: string): string {
	let out = text;
	// Not inside a code span: a lone backtick run anywhere before decides that,
	// and a `[` in code is not a link. `closeInline` owns code spans, so only
	// strip when the unterminated line holds an even number of backticks.
	const lineStart = out.lastIndexOf("\n") + 1;
	const line = out.slice(lineStart);
	const ticks = line.match(BACKTICK)?.length ?? 0;
	if (ticks % 2 === 0) {
		const image = DANGLING_IMAGE.exec(line);
		if (image) {
			out = out.slice(0, lineStart + image.index);
		} else {
			const link = DANGLING_LINK.exec(line);
			if (link) out = out.slice(0, lineStart + link.index) + link[1];
		}
	}
	return out.replace(BARE_MARKER_LINE, "$1");
}

function closeInline(text: string): string {
	if (text === "") return text;
	const openers: Opener[] = [];
	let code: { length: number; at: number } | null = null;
	let strip = text.length;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === "\\" && code === null) {
			i += 1;
			continue;
		}
		if (char === "`") {
			let run = 1;
			while (text[i + run] === "`") run += 1;
			if (code === null) code = { length: run, at: i };
			else if (code.length === run) code = null;
			i += run - 1;
			continue;
		}
		if (code !== null) continue;
		if (char !== "*" && char !== "_" && char !== "~") continue;
		let run = 1;
		while (text[i + run] === char) run += 1;
		// `~` is strikethrough only as a pair; a lone tilde is text.
		if (char === "~" && run < 2) {
			i += run - 1;
			continue;
		}
		const before = text[i - 1];
		const after = text[i + run];
		const leftFlanking =
			!isWhitespace(after) &&
			(!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
		const rightFlanking =
			!isWhitespace(before) &&
			(!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
		const intraWord = char === "_" && isWordChar(before) && isWordChar(after);
		const canOpen = leftFlanking && !intraWord;
		const canClose = rightFlanking && !intraWord;
		// A run is consumed two-at-a-time as strong, then one as emphasis, which
		// is what CommonMark's `***x***` reduces to.
		let remaining = run;
		let position = i;
		const take = (marker: string) => {
			if (canClose) {
				const matched = openers.map((o) => o.marker).lastIndexOf(marker);
				if (matched !== -1) {
					openers.length = matched;
					remaining -= marker.length;
					position += marker.length;
					return true;
				}
			}
			if (canOpen) {
				openers.push({ marker, at: position });
				remaining -= marker.length;
				position += marker.length;
				return true;
			}
			return false;
		};
		const pair = char === "~" ? "~~" : char.repeat(2);
		while (remaining >= 2 && take(pair)) {
			/* consumed */
		}
		while (remaining >= 1 && char !== "~" && take(char)) {
			/* consumed */
		}
		// A delimiter run at the very end that neither opened nor closed anything
		// is the writer mid-marker (`foo **`): paint without it.
		if (remaining > 0 && i + run === text.length)
			strip = Math.min(strip, position);
		i += run - 1;
	}
	let result = text;
	// An unterminated code span closes with its own run, but not when it is
	// the final thing written and still empty (`foo ` + backtick).
	const closers: string[] = [];
	if (code !== null) {
		const written = text.slice(code.at + code.length);
		if (written.trim() === "") {
			strip = Math.min(strip, code.at);
		} else {
			// Anything opened inside the code span never was an opener.
			while (openers.length > 0 && openers[openers.length - 1].at > code.at)
				openers.pop();
			closers.push("`".repeat(code.length));
		}
	}
	for (let k = openers.length - 1; k >= 0; k--) {
		const opener = openers[k];
		const written = text.slice(opener.at + opener.marker.length);
		if (written.trim() === "" && (code === null || opener.at < code.at)) {
			strip = Math.min(strip, opener.at);
		} else if (code === null || opener.at < code.at) {
			closers.unshift(opener.marker);
		}
	}
	if (strip < text.length) {
		result = text.slice(0, strip).replace(TRAILING_SPACE, "");
		// Closers belong to openers that survive the strip.
		return result + closers.filter((closer) => closer !== "").join("");
	}
	// Closing must see content directly before the marker: `foo **bar ` +
	// `**` would not close (the marker is not right-flanking after a space).
	const trailing = TRAILING_WHITESPACE.exec(result)?.[0] ?? "";
	if (closers.length > 0 && trailing !== "") {
		// Whitespace (a paragraph break before a fence) moves AFTER the closers.
		return (
			result.slice(0, result.length - trailing.length) +
			closers.join("") +
			trailing
		);
	}
	return result + closers.join("");
}
