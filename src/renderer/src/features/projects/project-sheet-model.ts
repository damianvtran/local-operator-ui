/**
 * The create/edit sheet's pure model: everything the sheet computes that is
 * not a React concern, so the lane can falsify it without a DOM.
 *
 * THREE THINGS LIVE HERE, and each is a decision the sheet must not re-invent
 * inline:
 *
 * 1. THE KEY DERIVATION. The backend's create body requires a `name` — the
 *    project's key, the identity everything is addressed by — while the sheet
 *    is TITLE-first (the display title is what an author writes). So the sheet
 *    derives a key from the title while the author has not touched the key,
 *    and stops once they have. This function is the derivation's only
 *    definition; the field, the tests and the frame all read it from here.
 *
 * 2. THE DESCRIPTION TEMPLATE. Create pre-seeds the description with the light
 *    section skeleton the operator asked for (Summary / Goals / Notes); it is
 *    ordinary editable text, not a separate editor mode, so deleting it is
 *    just deleting text. The constant is exported so the lane can pin its
 *    shape and the dialog cannot quietly drift from it.
 *
 * 3. THE PASTE CONVERSION. `markdownFromClipboardHtml` turns the rich
 *    clipboard payload (`text/html`) into markdown for the description editor.
 *    A textarea only ever receives `text/plain`, so without this a paste from
 *    any rendered source (a docs page, a transcript, Linear) loses every
 *    heading, list and block — the one clipboard shape the editor would
 *    otherwise mangle. The grammar is DELIBERATELY BOUNDED (block elements
 *    listed below; everything else is dropped to its text, tables included)
 *    because this is a 240-character description field, not a document
 *    converter: a converter that guessed at more would be a second, unaudited
 *    markdown implementation. Anything outside the grammar degrades to plain
 *    text, which is exactly what a plain paste would have produced.
 */

/** The create sheet's description seed: light sections the author edits away. */
export const PROJECT_DESCRIPTION_TEMPLATE =
	"## Summary\n\n## Goals\n\n## Notes";
/*
 * The derivation's regexes live at module scope: they are literals of this
 * file's single purpose, hoisted so a keystroke in the title never rebuilds
 * them, and so the lint rule that refuses in-scope literals has one place to
 * read them (`biome.json`'s `useTopLevelRegex`).
 */
/*
 * Type-only, so the Node lane's bundle stays a pure function library: these
 * erase at build time. `pasteMarkdownIntoDescription`, at the foot of this
 * file, is the sheet's and the detail editor's shared DOM adapter.
 */
import type { ClipboardEvent, RefObject } from "react";

/*
 * `\p{Mn}` (non-spacing marks) rather than a literal `\u0300-\u036f` range:
 * the property escape names what is stripped (the marks `NFKD` splits off an
 * accented letter) and keeps combining characters out of a character class,
 * which is the shape the Unicode-aware regex rules refuse.
 */
const COMBINING_MARKS = /\p{Mn}/gu;
const NOT_KEY_CHAR = /[^a-z0-9._-]+/g;
const SEPARATOR_RUN = /[._-]{2,}/g;
/*
 * The key must START and END on a letter or digit (`PROJECT_NAME_PATTERN`'s
 * first-character rule, applied to both ends because a title's punctuation is
 * not the key's).
 */
const LEADING_NON_KEY = /^[^a-z0-9]+/;
const TRAILING_NON_KEY = /[^a-z0-9]+$/;

/**
 * A project key derived from a title, or `""` when the title has no usable
 * characters.
 *
 * The shape is `PROJECT_NAME_PATTERN`'s (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`,
 * restated here as the derivation's contract rather than imported: the pattern
 * is the wire's, this is the slug's): lowercase, separators collapsed to `-`,
 * accents folded to their base letters (`Café` -> `cafe`), leading and
 * trailing non-alphanumerics trimmed so the first character is always a letter
 * or digit, and clamped to 64 characters — the wire's ceiling — with the trim
 * re-applied because the clamp can cut a trailing separator. A title with no
 * a-z0-9 characters (e.g. only CJK, or only punctuation) derives `""`: the
 * sheet then shows an empty key the author must fill, which the field's own
 * rule explains, rather than inventing a key nobody asked for.
 */
export function projectKeyFromTitle(title: string): string {
	const slug = title
		.normalize("NFKD")
		.replace(COMBINING_MARKS, "")
		.toLowerCase()
		.replace(NOT_KEY_CHAR, "-")
		.replace(SEPARATOR_RUN, "-")
		.replace(LEADING_NON_KEY, "")
		.replace(TRAILING_NON_KEY, "");
	return slug.slice(0, 64).replace(TRAILING_NON_KEY, "");
}

/* The entities a clipboard payload actually carries: named forms, then refs. */
const HEX_ENTITY = /&#x([0-9a-f]+);/gi;
const DECIMAL_ENTITY = /&#(\d+);/g;
const NBSP_ENTITY = /&nbsp;/g;
const LT_ENTITY = /&lt;/g;
const GT_ENTITY = /&gt;/g;
const QUOT_ENTITY = /&quot;/g;
const APOS_ENTITY = /&#39;|&apos;/g;
const AMP_ENTITY = /&amp;/g;

/** The five named entities a clipboard payload actually carries, plus refs. */
const decodeEntities = (text: string): string =>
	text
		.replace(HEX_ENTITY, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(DECIMAL_ENTITY, (_, decimal: string) =>
			String.fromCodePoint(Number.parseInt(decimal, 10)),
		)
		.replace(NBSP_ENTITY, " ")
		.replace(LT_ENTITY, "<")
		.replace(GT_ENTITY, ">")
		.replace(QUOT_ENTITY, '"')
		.replace(APOS_ENTITY, "'")
		.replace(AMP_ENTITY, "&");

const TAG_OR_TEXT = /<[^>]*>|[^<]+/g;
const CLOSING_TAG = /^<\//;
const TAG_NAME = /^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/;
const WHITESPACE_RUN = /\s+/g;
const LANGUAGE_CLASS = /class="[^"]*language-([\w+-]+)/;
const HREF_ATTR = /href="([^"]*)"/;
const SRC_ATTR = /src="([^"]*)"/;
const ALT_ATTR = /alt="([^"]*)"/;
const LINE_TRAILING_SPACE = /[ \t]+\n/g;
const BLANK_RUN = /\n{3,}/g;

/**
 * Clipboard HTML as markdown, for the description editor's paste path.
 *
 * The grammar, in full — anything else drops to its text:
 *   h1..h6 -> `# `..`###### `        p, div -> a blank line after
 *   ul/li -> `- `                    ol/li -> `1. `, `2. `, ... (running)
 *   strong/b -> `**`, em/i -> `*`, del/s -> `~~`, code -> backticks
 *   pre -> a fenced block (``` with the code element's language- class)
 *   a -> `[text](href)`              img -> `![alt](src)`
 *   br -> a line break               blockquote -> `> ` per line
 *
 * Two behaviours are deliberate rather than incidental: text inside `pre` is
 * emitted verbatim (no inline conversion — the author pasted code, not
 * markdown-to-be), and the output is normalized at the end (runs of blank
 * lines collapse to one, since every block above ends one and most sources
 * also carry their own whitespace between tags).
 */
export function markdownFromClipboardHtml(html: string): string {
	type Frame = {
		tag: string;
		href?: string;
		inline?: boolean;
		ordered?: boolean;
		index?: number;
	};
	const stack: Frame[] = [];
	/*
	 * POP THE FRAME A CLOSER OWNS, not the top of the stack. The first cut
	 * popped blindly, which is balanced only while every child closes before
	 * its parent: after `</pre>` it popped the `<code>` frame instead, so the
	 * pre frame stayed and everything after a fence kept pre semantics — no
	 * whitespace collapse, no backticks, no quote prefixes — and an inline
	 * mark inside a blockquote left the `>` prefix leaking past the quote.
	 * The rule is the one review round 1 named: a closer removes ITS OWN
	 * frame, wherever it sits, and leaves any malformed overlap above it
	 * alone, so that child's own closer still finds it.
	 */
	const popFrame = (...tags: string[]): Frame | undefined => {
		for (let i = stack.length - 1; i >= 0; i--) {
			if (tags.includes(stack[i].tag)) {
				const [frame] = stack.splice(i, 1);
				return frame;
			}
		}
		return undefined;
	};
	const parts: string[] = [];
	const inPre = () => stack.some((frame) => frame.tag === "pre");
	const quoteDepth = () =>
		stack.filter((frame) => frame.tag === "blockquote").length;
	/*
	 * Blockquotes are a line prefix, so they need to know where a line starts;
	 * `atLineStart` is the one piece of positional state the token walk keeps.
	 */
	let atLineStart = true;
	const emit = (text: string) => {
		if (!text) return;
		if (quoteDepth() > 0 && atLineStart && !inPre()) {
			parts.push("> ".repeat(quoteDepth()));
		}
		parts.push(text);
		atLineStart = text.endsWith("\n");
	};
	const tokens = html.match(TAG_OR_TEXT) ?? [];
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token.startsWith("<")) {
			emit(
				inPre()
					? decodeEntities(token)
					: decodeEntities(token).replace(WHITESPACE_RUN, " "),
			);
			continue;
		}
		const close = CLOSING_TAG.test(token);
		const name = (token.match(TAG_NAME)?.[1] ?? "").toLowerCase();
		if (close) {
			switch (name) {
				case "p":
				case "div":
					emit("\n\n");
					break;
				case "h1":
				case "h2":
				case "h3":
				case "h4":
				case "h5":
				case "h6":
					popFrame(name);
					emit("\n\n");
					break;
				case "li": {
					popFrame("li");
					emit("\n");
					/* Numbering advances as items CLOSE, so the next item's
					 * prefix knows its position. */
					const list = [...stack]
						.reverse()
						.find((f) => f.tag === "ul" || f.tag === "ol");
					if (list?.ordered) list.index = (list.index ?? 1) + 1;
					break;
				}
				case "ul":
				case "ol":
					popFrame(name);
					emit("\n");
					break;
				case "strong":
				case "b":
					if (popFrame("strong", "b")) emit("**");
					break;
				case "em":
				case "i":
					if (popFrame("em", "i")) emit("*");
					break;
				case "del":
				case "s":
					if (popFrame("del", "s")) emit("~~");
					break;
				case "code": {
					const frame = popFrame("code");
					if (frame?.inline) emit("`");
					break;
				}
				case "pre":
					if (popFrame("pre")) emit("\n```\n\n");
					break;
				case "a": {
					const frame = popFrame("a");
					if (frame?.href) emit(`](${frame.href})`);
					break;
				}
				case "blockquote":
					if (popFrame("blockquote")) emit("\n");
					break;
				default:
					break;
			}
			continue;
		}
		switch (name) {
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6": {
				const level = Number(name[1]);
				stack.push({ tag: name });
				emit(`${"#".repeat(level)} `);
				break;
			}
			case "ul":
			case "ol":
				stack.push({ tag: name, ordered: name === "ol", index: 1 });
				break;
			case "li": {
				const list = [...stack]
					.reverse()
					.find((f) => f.tag === "ul" || f.tag === "ol");
				stack.push({ tag: "li" });
				if (list?.ordered) emit(`${list.index ?? 1}. `);
				else emit("- ");
				break;
			}
			case "strong":
			case "b":
				stack.push({ tag: name });
				emit("**");
				break;
			case "em":
			case "i":
				stack.push({ tag: name });
				emit("*");
				break;
			case "del":
			case "s":
				stack.push({ tag: name });
				emit("~~");
				break;
			case "code": {
				/*
				 * `inline` is captured at OPEN: whether this code element is a
				 * fence's body (no backticks) is a property of where it opened,
				 * and the closer runs after whatever it contained.
				 */
				const inline = stack[stack.length - 1]?.tag !== "pre";
				stack.push({ tag: "code", inline });
				if (inline) emit("`");
				break;
			}
			case "pre": {
				/*
				 * The language rides the code element INSIDE this fence, so the
				 * next token is where it can be read — searching the whole payload
				 * would borrow a later block's language for an earlier, untagged
				 * fence.
				 */
				const language =
					token.match(LANGUAGE_CLASS)?.[1] ??
					tokens[index + 1]?.match(LANGUAGE_CLASS)?.[1] ??
					"";
				stack.push({ tag: "pre" });
				emit(`\n\`\`\`${language}\n`);
				break;
			}
			case "a": {
				/*
				 * A bare anchor (no href, or an empty one) is only a jump target in
				 * some other document: it gets a frame so its closer pairs, but no
				 * `[` — an opening mark with no close is how the stray bracket got
				 * into a paste.
				 */
				const href = token.match(HREF_ATTR)?.[1] ?? "";
				stack.push({ tag: "a", href });
				if (href) emit("[");
				break;
			}
			case "img": {
				const src = token.match(SRC_ATTR)?.[1] ?? "";
				const alt = token.match(ALT_ATTR)?.[1] ?? "";
				if (src) emit(`![${alt}](${src})`);
				break;
			}
			case "br":
				emit("\n");
				break;
			case "blockquote":
				stack.push({ tag: "blockquote" });
				break;
			default:
				break;
		}
	}
	return parts
		.join("")
		.replace(LINE_TRAILING_SPACE, "\n")
		.replace(BLANK_RUN, "\n\n")
		.trim();
}

/**
 * The description editors' one paste door: rich clipboard HTML becomes
 * markdown (`markdownFromClipboardHtml`), is spliced at the selection, and the
 * caret lands after the pasted run.
 *
 * WHY IT IS HERE RATHER THAN IN EITHER EDITOR: the create sheet's description
 * field and the detail's inline description editor are two mounts of the same
 * behaviour, and the second copy would be the drift this lane forbids. A
 * plain-text paste is deliberately NOT intercepted - markdown pasted as text
 * is already markdown, and eating it to round-trip would only risk changing
 * it. The `requestAnimationFrame` is what makes the caret land at all: React
 * applies the controlled value AFTER this handler returns, and a selection set
 * before that would be clamped against the OLD value (a measured defect in the
 * sheet's first cut).
 */
export function pasteMarkdownIntoDescription(
	event: ClipboardEvent<HTMLTextAreaElement>,
	fieldRef: RefObject<HTMLTextAreaElement | null>,
	apply: (next: string) => void,
): void {
	const html = event.clipboardData?.getData("text/html");
	if (!html) return;
	const markdown = markdownFromClipboardHtml(html);
	if (!markdown) return;
	event.preventDefault();
	const element = event.currentTarget;
	const start = element.selectionStart ?? element.value.length;
	const end = element.selectionEnd ?? start;
	apply(element.value.slice(0, start) + markdown + element.value.slice(end));
	requestAnimationFrame(() => {
		const field = fieldRef.current;
		if (!field) return;
		const caret = start + markdown.length;
		field.setSelectionRange(caret, caret);
	});
}
