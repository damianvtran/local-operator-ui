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
 * a wall of skill body standing in for one typed line, and the defect
 * `docs/design/history-fold-convergence.md` row D8 records as belonging to a
 * user bubble ("also poisons any phone-side session titling").
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
 * WHY A LINE READ AND NOT A YAML PARSE. The payload's body is the raw file, and
 * the value the row wants is a caption for a 24px header line: a description
 * that runs to several lines or several sentences is not shortened here, it is
 * declined, and the row falls back to the name alone. That is the honest
 * outcome — the alternative is a header that is either half a sentence or a
 * paragraph — and it is also the cheap one, on a function that runs for every
 * user row of every session.
 *
 * A QUOTED VALUE LOSES ITS QUOTES, because they are YAML's punctuation rather
 * than the sentence: `description: "Ship the thing"` means the sentence, and the
 * reader should not be shown the escape. A quote that is never closed on that
 * line is a multi-line scalar, so it takes the same null as the block forms.
 */
function purposeOf(frontMatter: string): string | null {
	const lines = frontMatter.split("\n");
	for (const [index, line] of lines.entries()) {
		if (!line.startsWith("description:")) continue;
		const value = line.slice("description:".length).trim();
		if (value === "" || value.startsWith(">") || value.startsWith("|"))
			return null;
		// An indented line under it is a continuation whatever the value looks
		// like, so the block forms that do not open with `>`/`|` are caught here.
		const next = lines[index + 1];
		if (next !== undefined && next.trim() !== "" && INDENTED.test(next))
			return null;
		if (value.startsWith('"') || value.startsWith("'")) {
			const quote = value[0];
			return value.length > 1 && value.endsWith(quote)
				? value.slice(1, -1)
				: null;
		}
		return value;
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
