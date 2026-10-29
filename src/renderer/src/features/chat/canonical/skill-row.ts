/**
 * A persisted `$skill` payload, read back as the row a reader should see.
 *
 * TWO SHAPES ON THE WIRE, and this file reads both:
 *
 *   - the LEGACY shape, where the sent message is the header sentence, the
 *     `<skill>` tag, the whole SKILL.md body and the request last
 *     (`skill-invocation.ts`'s `renderSkillInvocation`, porting the old
 *     `invoke.py:render_invocation`). `skillRowOf` recovers the typed line from
 *     the tag's `invocation` attribute and parses the rest;
 *   - the TAIL-BLOCK shape, where the user's text sits VERBATIM in front of an
 *     `<operator-skills>` block (2026-10-28's inline multi-skill grammar).
 *     `displayTextOf` strips the block; there is no single `skill` to parse,
 *     because one message may carry several bodies.
 *
 * WHY THIS EXISTS. `$name` expansion is a CLIENT duty and the payload it sends
 * is what gets PERSISTED. The TUI and the phone hide it through
 * `local_operator/harness/rows.py:user_row_text`. The desktop once painted the
 * entire payload — a wall of skill body standing in for one typed line, and the
 * defect the harness repo's `docs/design/history-fold-convergence.md` row D8
 * records as belonging to a user bubble ("also poisons any phone-side session
 * titling"). The mirror of `user_row_text` lives here now, for both shapes.
 *
 * WHAT IT ANSWERS. `skillRowOf` is the ONE derivation every reader of the LEGACY
 * shape goes through: the reducer stamps it on the record, so the row, the
 * reducer's equality gate and the tests cannot disagree about what the payload
 * says. A record that carries `skill` is recognised here and nowhere else,
 * rather than by a wire field: the payload is self-describing and every host
 * already sends it, so a recogniser that reads the payload also reads the rows
 * every OLDER session already holds — a wire field would only ever describe
 * messages sent after it shipped.
 *
 * WHAT IS KEPT AND WHAT IS READ. `text` is the typed line with any staged quote
 * markup still in front of it, verbatim: that is the string the composer
 * re-expands on a re-send (`buildSendPayload` prepends the same markup, and it
 * is what plain payloads are compared against), and `parseReplies` strips the
 * markup back off for display, so one string serves both. Everything else is
 * read off the payload rather than reconstructed: the skill's name and the
 * typed line come out of the tag's own attributes, the request is what follows
 * the closing tag, the body is the block between them with its YAML front
 * matter stripped, and the purpose is that front matter's `description:`.
 *
 * THE LEGACY FORMAT'S OWN LIMIT, stated rather than papered over: the `<skill>`
 * block is not escapable, so the body ends at the FIRST `</skill>` after the
 * tag. A skill body containing that literal closes early — the same limit
 * `utils/reply-utils.ts` documents for a quoted body containing `</reply-to>`,
 * and the mitigation is the same one: the close is found by scanning, not by
 * matching a second, guessable tag.
 */

import type { Reply } from "@shared/store/conversation-input-store";
import {
	SKILL_TAG_RE,
	stripSkillBlock,
	unescapeSkillAttribute,
} from "../components/skill-invocation";
import { pyTrim, pyTrimStart } from "../components/slash-token";
import { parseReplies, splitReplyPrefix } from "../utils/reply-utils";

/**
 * The shape of one invocation, as the row that paints it needs it.
 *
 * `name` is the DISCOVERY name the payload resolved to (the tag records it, so
 * `$ResearCH` still reads `research` here) and `token` is that name as the
 * composer's own token — the two agree by construction, and both are recorded
 * because a row that echoes a token and a row that names a skill are different
 * claims even when they render the same today.
 */
export type SkillRow = {
	name: string;
	token: string;
	/** The buffer with the token removed; `""` for a bare `$name`. */
	request: string;
	/** The front matter's single-line `description:`, or `null`. */
	purpose: string | null;
	/** The skill body, its YAML front matter stripped. */
	body: string;
};

export type SkillInvocationRow = {
	/** The typed line, with any leading quote markup kept verbatim. */
	text: string;
	skill: SkillRow;
};

/**
 * The seal a payload carries, or `undefined` for anything else.
 *
 * The reducer's spelling of {@link skillRowOf}: a record wants the parsed fields
 * and not the recomposed line, and an ABSENT key rather than a `null` one, which
 * is what `shallowEqual`'s key-count comparison reads as "this row is not an
 * invocation" (`transcript-reducer.ts`'s `skill` field note).
 */
export function skillOf(text: string): SkillRow | undefined {
	return skillRowOf(text)?.skill;
}

/** A line that is indented, i.e. a YAML continuation of the line above it. */
const INDENTED = /^\s/;

/**
 * A YAML block scalar's indicator, with its optional chomping/indent modifier:
 * `>`, `>-`, `>+`, `|`, `|-`, `|2-` and the other spellings YAML allows.
 *
 * BOTH ORDERS of the modifier, and an optional comment after it (agent review
 * round 2, MINOR-1; QA round 2, Q5): YAML reads `|2-` and `|-2` alike, and
 * `>- # a note` is an indicator carrying a comment. The first spelling of this
 * pattern allowed the chomp before the digit only, so `|2-` fell through to the
 * plain branch and painted the indicator into the caption.
 */
const BLOCK_INDICATOR = /^[>|](?:[-+]\d?|\d[-+]?)?(?:\s+#.*)?$/;

/**
 * The LINE `render_invocation` writes in front of every payload
 * (`invoke.py:193`), with the resolved skill name captured: the sentence opens
 * `The user invoked the \`<name>\` skill directly.` and the rest of the line is
 * the writer's own prose, so the tail is read as "to the end of the line" rather
 * than spelled out here -- a wording change in the harness must not stop the
 * desktop reading payloads the harness wrote.
 *
 * `_INVOCATION_TAG_RE` alone would be parity with the harness and WRONG here:
 * see `skillRowOf` for what requiring this sentence buys.
 */
const PAYLOAD_HEADER_RE =
	/^The user invoked the `([^`\n]+)` skill directly\.[^\n]*\n/;

/**
 * The front matter block's end within `body`, or `null` when there is none.
 *
 * The same arithmetic `skillBodyHasContent` uses on the same shape: a leading
 * `---`, then the run of lines up to the next line that opens with `---`. An
 * UNTERMINATED block is not front matter here either — the resolver returns
 * SKILL.md verbatim, so a body that opens with `---` and never closes it is
 * prose that happens to start with three dashes, and swallowing the rest of the
 * file as "front matter" is the one way this read could hide a real body.
 */
function frontMatterEnd(body: string): number | null {
	const text = pyTrimStart(body);
	if (!text.startsWith("---")) return null;
	const rest = text.slice(3);
	const end = rest.indexOf("\n---");
	if (end === -1) return null;
	// Past the closing line's own `---`: the offset is relative to the trimmed
	// view, so the leading whitespace it dropped is added back.
	return body.length - text.length + 3 + end + 4;
}

/**
 * A DOUBLE-quoted YAML scalar's body, unescaped for the escapes a caption
 * plausibly carries: `\"` and `\\`. The rest of YAML's escape set (`\n`, `	`,
 * `\uXXXX`) is left as written rather than half-interpreted here -- a description
 * that needs one of those needs a YAML parser, and this reader's contract is a
 * line scan (see `purposeOf`).
 */
function unquoteDouble(value: string): string {
	return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * The body of a QUOTED scalar at the start of `value`, or `null`.
 *
 * The closing quote is FOUND rather than tested for at the end, because YAML
 * allows a comment after it: `description: "abc" # note` is the value `abc`
 * (agent review round 2, MINOR-4), and an `endsWith` check declined it back to
 * the skill's name. Everything after the closing quote must therefore be
 * whitespace or a ` #…` comment; anything else (`"a" b`) is a scalar this line
 * scan does not understand, and `null` sends the caller to the name. A `#`
 * INSIDE the quotes stays content, which is why this finds the quote rather
 * than splitting on the comment first.
 */
function quotedScalar(value: string, quote: string): string | null {
	const body: string[] = [];
	for (let at = 1; at < value.length; at += 1) {
		const char = value[at];
		if (quote === '"' && char === "\\" && at + 1 < value.length) {
			body.push(char, value[at + 1]);
			at += 1;
			continue;
		}
		if (char !== quote) {
			body.push(char);
			continue;
		}
		// A single-quoted scalar escapes its quote by DOUBLING it.
		if (quote === "'" && value[at + 1] === "'") {
			body.push(char, char);
			at += 1;
			continue;
		}
		const rest = value.slice(at + 1).trim();
		if (rest !== "" && !rest.startsWith("#")) return null;
		const text = body.join("");
		const scalar =
			quote === "'" ? text.replace(/''/g, "'") : unquoteDouble(text);
		return scalar === "" ? null : scalar;
	}
	return null;
}

/**
 * The front matter's `description:` as ONE line, or `null`.
 *
 * WHY IT FOLDS RATHER THAN DECLINES. A skill's description is prose an author
 * wrapped for a 100-column file, and the shape that wrapping takes in the
 * wild is a block scalar -- `description: >-` (folded) or `|` (literal) -- so
 * "multi-line means no purpose" would fall back to the name alone for the
 * common case, which is exactly the case this caption exists for. The three
 * shapes YAML allows here are therefore all READ, and all flattened to one
 * line: the inline value, the indented continuation lines under it, and the
 * block indicators (`>`, `|-`, `>+`, … and their bare forms). Pieces are joined
 * with single spaces, which is YAML's own folding for `>`/plain scalars, and is
 * the right flattening for `|` too -- a caption is one line, and the reader who
 * wants the author's line breaks has the body one press away.
 *
 * `null` is left for a `description` that is absent, carries no content, or is
 * unparseable (a quoted scalar whose closing quote never arrives), because the
 * row's fallback is the skill's name and a name is better than half a sentence.
 *
 * CHEAP ON PURPOSE: this runs for every user row of every session, so it is a
 * line scan and a join, not a YAML parse. A quoted value loses its quotes when
 * they close on the folded result -- YAML's punctuation, not the sentence.
 */
function purposeOf(frontMatter: string): string | null {
	const lines = frontMatter.split("\n");
	for (const [index, line] of lines.entries()) {
		if (!line.startsWith("description:")) continue;
		const inline = line.slice("description:".length).trim();
		// A block indicator is punctuation for the body BELOW it; anything else
		// inline is the first piece of the value.
		const isBlockIndicator = inline !== "" && BLOCK_INDICATOR.test(inline);
		const pieces: string[] = [];
		if (inline !== "" && !isBlockIndicator) pieces.push(inline);
		/*
		 * The continuation, to the first line that is not indented. A blank line
		 * inside the block is a paragraph break in YAML, and skipping it is what
		 * makes `>-` and `|` produce one line here; an indented line after it
		 * still belongs to the value.
		 */
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			const next = lines[cursor];
			if (next.trim() === "") continue;
			if (!INDENTED.test(next)) break;
			pieces.push(next.trim());
		}
		if (pieces.length === 0) return null;
		const folded = pieces.join(" ");
		if (isBlockIndicator) return folded.trim() === "" ? null : folded.trim();
		if (folded.startsWith('"')) return quotedScalar(folded, '"');
		if (folded.startsWith("'")) return quotedScalar(folded, "'");
		/*
		 * A PLAIN scalar's inline comment starts at whitespace + `#` (`description:
		 * ship it # not this`). A `#` is CONTENT inside a block scalar or a quoted
		 * value, which is why this branch -- and not the whole function -- strips
		 * one.
		 */
		const comment = folded.indexOf(" #");
		const plain = (comment === -1 ? folded : folded.slice(0, comment)).trim();
		return plain === "" ? null : plain;
	}
	return null;
}

/**
 * Read one persisted message as a `$skill` invocation, or `null` for anything
 * that is not one of these payloads.
 *
 * `null` is the answer for every ordinary message, so a caller falls through to
 * painting the text verbatim. The gate is the payload's OWN SHAPE and not merely
 * its tag: the header sentence the writer always emits (`invoke.py:193`), then
 * the tag directly after it, then the tag's name equal to the header's. Anything
 * else -- prose that quotes a whole tag, a `<reply-to>` run quoting a message
 * that discusses the wire format, a tag with no close -- is an ordinary message.
 *
 * WHY STRICTER THAN THE HARNESS. `typed_line_of` searches for the tag anywhere,
 * and that is right for its caller, which only ever reads strings the writer
 * produced. This function's caller is every user row of every session, and three
 * rows in this machine's own store are agent briefings that describe this format
 * and therefore carry a whole tag: sealing one would paint `$name` and a slice
 * of the tail while hiding the briefing itself (QA round 1, Q1 -- 18-20k
 * characters per row, unreachable behind the disclosure rather than merely
 * misplaced). The harness half is deferred on #2526.
 */
export function skillRowOf(text: string): SkillInvocationRow | null {
	/*
	 * The whitespace between the last quoted block and the payload, and the
	 * payload itself. The gap is kept (it is `buildSendPayload`'s own join, so
	 * `text` below is the string that composer would assemble), and the header
	 * match runs on the trimmed view because the writer's own join puts a newline
	 * between a quoted run and the payload.
	 */
	const { prefix, rest } = splitReplyPrefix(text);
	const gap = rest.slice(0, rest.length - pyTrimStart(rest).length);
	const payload = pyTrimStart(rest);
	const header = PAYLOAD_HEADER_RE.exec(payload);
	if (header === null) return null;
	const tag = SKILL_TAG_RE.exec(payload.slice(header[0].length));
	if (tag === null || tag.index !== 0 || tag[1] !== header[1]) return null;
	// A tag with no close is not a payload this read can describe: `text` would
	// have to invent the body. The harness writes both tags or neither.
	const bodyStart = header[0].length + tag[0].length;
	const close = payload.indexOf("</skill>", bodyStart);
	if (close === -1) return null;

	const rawBody = payload.slice(bodyStart, close);
	const end = frontMatterEnd(rawBody);
	const purpose = end === null ? null : purposeOf(rawBody.slice(0, end));
	const name = tag[1];
	const typed = unescapeSkillAttribute(tag[2]);

	return {
		text: prefix + gap + typed,
		skill: {
			name,
			token: `$${name}`,
			request: pyTrim(payload.slice(close + "</skill>".length)),
			purpose,
			body: end === null ? pyTrim(rawBody) : pyTrim(rawBody.slice(end)),
		},
	};
}

/**
 * What a user row PAINTS, from the payload the host stored
 * (`harness.rows.user_row_text`, skill half).
 *
 * TWO SHAPES, ONE ANSWER. A LEGACY payload is read through `skillRowOf`, which
 * recovers the typed line from the tag's `invocation` attribute. A NEW payload
 * carries the typed text verbatim in front of an `<operator-skills>` block, so
 * the block alone is removed — no recovery, which is what makes the live row
 * and the replayed row agree by construction.
 *
 * Ordinary messages are returned untouched, not trimmed: only a text that
 * actually carries a complete block is normalised, so a message with leading or
 * trailing whitespace paints exactly as it always did.
 */
export function displayTextOf(text: string): string {
	const row = skillRowOf(text);
	if (row !== null) return row.text;
	const stripped = stripSkillBlock(text);
	return stripped === text ? text : pyTrim(stripped);
}

/**
 * What a `$skill` row hands back to the composer's Edit: the typed line for the
 * box, and the quoted run for the composer's own chip path.
 *
 * TWO PIECES, NOT ONE STRING (UX round 1, U1). The box has to get the line the
 * reader typed: a quote is staged in the composer as a CHIP, so a box holding
 * `prefix + line` reads as prose with the markup showing, and sending from it
 * carried `<reply-to>…</reply-to>` literally -- the skill was silently not
 * applied and the model never received the instructions. `parseReplies` is the
 * row's own splitter (it paints the same quote through `ReplyPreview`), so the
 * chips the box gets are the ones the reader saw on the row, and
 * `buildSendPayload` re-joins exactly what came back.
 *
 * BOTH PAYLOAD SHAPES ARE HANDLED, for the same reason the row paints both: a
 * new payload's Edit must not put the `<operator-skills>` block in the box —
 * the block is transport, and re-sending it would carry the old bodies into the
 * next message as prose.
 *
 * `null` for anything that is not an invocation: an ordinary message is
 * untouched, and its own quoted run keeps the behaviour it had before this row
 * existed (the same raw markup, which is a pre-existing shape of that path).
 */
export function editDraftOf(
	text: string,
): { replies: Reply[]; text: string } | null {
	const row = skillRowOf(text);
	if (row === null) {
		const stripped = stripSkillBlock(text);
		if (stripped === text) return null;
		const { prefix } = splitReplyPrefix(text);
		return {
			replies: parseReplies(text).replies,
			text: stripped.slice(prefix.length).trimStart(),
		};
	}
	/*
	 * `row.text` is `prefix + gap + line`, so the box's half is the tail. Slicing
	 * the ORIGINAL prefix rather than rebuilding the line from the parsed fields
	 * is what keeps the reader's own spelling of the token (`$ResearCH`), which the
	 * resolved `skill.token` no longer carries.
	 */
	const { prefix } = splitReplyPrefix(text);
	return {
		replies: parseReplies(text).replies,
		text: row.text.slice(prefix.length).trimStart(),
	};
}

/**
 * The text a `$skill` row's Edit puts in the composer: the typed line alone.
 *
 * One derivation rather than the expression at the call site, so the retry gate
 * beside the call compares against the same string it hands back (agent review
 * round 1, MINOR-4) and the quote that goes with it is `editDraftOf`'s answer.
 */
export function editTextOf(text: string): string {
	return editDraftOf(text)?.text ?? text;
}
