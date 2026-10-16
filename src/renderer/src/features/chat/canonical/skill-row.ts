/**
 * A persisted `$skill` payload, read back as the row a reader should see.
 *
 * WHY THIS EXISTS. `$name` expansion is a CLIENT duty and the payload it sends
 * is what gets PERSISTED, so the user's own message on the wire is the header
 * sentence, the `<skill>` tag, the whole SKILL.md body and the request last
 * (`skill-invocation.ts`, porting `invoke.py:render_invocation`). The TUI and
 * the phone hide that: they paint the typed line recovered from the payload's
 * `invocation` attribute (`local_operator/harness/rows.py:typed_line_of`). The
 * desktop never ported the read half, so its bubble paints the entire payload —
 * a wall of skill body standing in for one typed line, and the defect the
 * harness repo's `docs/design/history-fold-convergence.md` row D8 records as
 * belonging to a user bubble ("also poisons any phone-side session titling").
 *
 * WHAT IT ANSWERS. `skillRowOf` is the ONE derivation every reader of such a
 * row goes through: the reducer stamps it on the record, so the row, the
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
 * THE FORMAT'S OWN LIMIT, stated rather than papered over: the `<skill>` block
 * is not escapable, so the body ends at the FIRST `</skill>` after the tag. A
 * skill body containing that literal closes early — the same limit
 * `utils/reply-utils.ts` documents for a quoted body containing `</reply-to>`,
 * and the mitigation is the same one: the close is found by scanning, not by
 * matching a second, guessable tag.
 */

import {
	SKILL_TAG_RE,
	unescapeSkillAttribute,
} from "../components/skill-invocation";
import { pyTrim, pyTrimStart } from "../components/slash-token";
import { splitReplyPrefix } from "../utils/reply-utils";

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
 */
const BLOCK_INDICATOR = /^[>|][-+]?\d*$/;

/** A scalar that opens with a quote, i.e. one YAML's escaping applies to. */
const QUOTED = /^["']/;

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
		let folded = pieces.join(" ");
		if (QUOTED.test(folded)) {
			const quote = folded[0];
			if (folded.length < 2 || !folded.endsWith(quote)) return null;
			folded = folded.slice(1, -1);
		}
		return folded === "" ? null : folded;
	}
	return null;
}

/**
 * Read one persisted message as a `$skill` invocation, or `null` for anything
 * that is not one of these payloads.
 *
 * `null` is the answer for every ordinary message, so a caller falls through to
 * painting the text verbatim. That is the whole gate: the recogniser is the
 * payload's own tag, matched the way the harness matches it, so a message that
 * merely QUOTES the tag in prose is not one of these unless it carries the whole
 * tag — see `SKILL_TAG_RE` for why that match is a search rather than an anchor.
 */
export function skillRowOf(text: string): SkillInvocationRow | null {
	const tag = SKILL_TAG_RE.exec(text);
	if (tag === null) return null;
	// A tag with no close is not a payload this read can describe: `text` would
	// have to invent the body. The harness writes both tags or neither.
	const bodyStart = tag.index + tag[0].length;
	const close = text.indexOf("</skill>", bodyStart);
	if (close === -1) return null;

	const rawBody = text.slice(bodyStart, close);
	const end = frontMatterEnd(rawBody);
	const purpose = end === null ? null : purposeOf(rawBody.slice(0, end));
	const name = tag[1];
	const typed = unescapeSkillAttribute(tag[2]);
	/*
	 * The quote markup a staged reply put in front of the payload, and the
	 * whitespace that follows the last block — `buildSendPayload`'s own join.
	 * Both are kept, so `text` is the string that composer would assemble for
	 * this line rather than a re-spelling of it.
	 */
	const { prefix, rest } = splitReplyPrefix(text);
	const gap = rest.slice(0, rest.length - pyTrimStart(rest).length);

	return {
		text: prefix + gap + typed,
		skill: {
			name,
			token: `$${name}`,
			request: pyTrim(text.slice(close + "</skill>".length)),
			purpose,
			body: end === null ? pyTrim(rawBody) : pyTrim(rawBody.slice(end)),
		},
	};
}
