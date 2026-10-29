/**
 * `$skill` manual invocation for the desktop composer — the trigger and the
 * tail block.
 *
 * `local_operator/skills/invoke.py` owns the `$name` contract, and expansion is
 * a CLIENT duty: there is no server-side expansion, so a composer that does not
 * expand sends prose with a sigil in it. This module is the desktop's
 * client-side parity with that contract, and the rendered payload is what gets
 * PERSISTED and what the model reads on every later turn — a difference of one
 * character is a difference in the conversation's record.
 *
 * The grammar lives in `local_operator/sigils.py`, and this file ports it by
 * name so the two hosts can be diffed:
 *
 *   - `skill_name_spans` / `skill_mentions`: where a `$name` token starts and
 *     whether it FIRES. The submit path and the composer's ink both call
 *     `skillMentions`, so the token the user saw painted and the token Enter
 *     expands are one decision rather than two that agree today. A boundary
 *     `$` anywhere in the message is a candidate; the vocabulary decides.
 *   - `render_skill_block`: the payload tail. The user's text goes out
 *     VERBATIM and one body per fired name rides a `<operator-skills>` block,
 *     joined to the text by one blank line.
 *   - `defuse_skill_block`: a SKILL.md that quotes a marker must not close the
 *     block early, so each marker-shaped sequence gets a zero-width space
 *     after its `<`. Nothing else about the body is escaped — the model must
 *     read it verbatim.
 *
 * THE LEGACY SHAPE STAYS READABLE FOREVER. Transcripts written before the tail
 * block carry `<skill name="…" invocation="…">` with the request last; the
 * wire grammar above is frozen once persisted, and `typedLineOf` /
 * `skillBodyHasContent` / `renderSkillInvocation` keep that read (and the
 * fixture that writes it) working. New sends never build it.
 *
 * ACCEPTED CONSEQUENCE: a `$` is boundary-read anywhere in the message now, so
 * a PASTED document that quotes `$name` mid-text fires that skill when sent.
 * The TUI has the same trigger and relies on collapsed paste chips to keep the
 * text visible; the desktop's paste path has no such chip, so the ink is where
 * the user sees it before Enter and the attached body is the accepted cost.
 * Nothing else is at risk: `$100`, `$PATH` and a glued `costs$5` are prose by
 * the grammar, and a typo paints inert rather than firing.
 *
 * Pure and I/O-free: the caller supplies each body it read from `skills.list`.
 */

import { hasLowercaseEvidence } from "./skill-rank";
import {
	SEPARATOR,
	SEPARATOR_CLASS,
	isBoundary,
	pyTrim,
	pyTrimStart,
} from "./slash-token";

export type SkillInvocation = {
	/** The DISCOVERY name the token resolved to (`research` for `$Research`). */
	name: string;
	/** The buffer with the token removed and stripped; may legitimately be "". */
	request: string;
	/** The raw token as typed (`"$Research"`), for echoing what the user wrote. */
	token: string;
	/** The whole line the user typed, stripped. */
	typed: string;
};

/** One resolved `$name` in a message (`sigils.SkillMention`). */
export type SkillMention = {
	/** Whole-text offset of the `$`. */
	start: number;
	/** One past the last character of the token that FIRES. Trailing
	 * punctuation that made a longer name unresolvable is outside it — it stays
	 * the user's prose. */
	end: number;
	/** The token as typed, `$` included. */
	text: string;
	/** The discovered name, which is what dedupes `$Research` against `$research`. */
	name: string;
	/** Whitespace-only before the token, i.e. the legacy anchored position. */
	leading: boolean;
};

/** One raw `$name` run, resolved or not (`sigils.skill_name_spans`). */
export type SkillNameSpan = {
	start: number;
	end: number;
	name: string;
};

/**
 * The opening tag of a rendered payload, as `_INVOCATION_TAG_RE`
 * (`invoke.py:105`) matches it: the tag, with the typed line in its
 * `invocation` attribute.
 *
 * SEARCHED, not anchored, exactly as the harness searches it. Anchoring it here
 * would read fewer payloads than the harness does — a payload the composer sent
 * behind a staged `<reply-to>` prefix begins with the quote, not the header —
 * and a payload one side recognises and the other does not is a row that
 * disagrees with the message it describes.
 *
 * The harness's own pattern captures the attribute alone, because the typed
 * line is all it reads; the NAME is captured here too, because a row that shows
 * `$name` has to say which skill fired, and the tag is where the payload states
 * it. Both attributes are recorded rather than re-derived, for the reason
 * `render_invocation` kept the typed line in the payload at all: the payload IS
 * the record, and a second store can disagree with it.
 *
 * AND IT IS ONLY THE PATTERN. A match here says a tag exists, not that the
 * message is a payload: prose can carry a whole tag (`skill-row.ts`'s reader is
 * therefore stricter, and requires the writer's own header line in front of it —
 * QA round 1, Q1). This constant stays the harness's pattern so the two sides
 * cannot drift on what a tag LOOKS like.
 */
export const SKILL_TAG_RE = /<skill name="([^"]*)" invocation="([^"]*)">/;

/* ------------------------------------------------------------------ */
/* The grammar: where a token is, and whether it fires                 */
/* ------------------------------------------------------------------ */

/** A resolvable name's first character (`sigils._SKILL_NAME_HEAD`). */
const NAME_START = /[A-Za-z0-9]/;
/** A resolvable name's continuation characters (`sigils._SKILL_NAME_TAIL`). */
const NAME_TAIL = /[A-Za-z0-9._-]/;
/** A trailing character the resolver may trim back off a candidate. */
const TRIMMABLE = /[._-]/;

/**
 * First index past the name-class run starting at `start`; `start` when the
 * character there cannot open a name.
 *
 * Shared by {@link skillNameSpans} and {@link skillMentions} so the extent the
 * ink covers and the extent the submit expands cannot drift.
 */
function skillNameEnd(text: string, start: number): number {
	if (start >= text.length || !NAME_START.test(text[start])) return start;
	let end = start + 1;
	while (end < text.length && NAME_TAIL.test(text[end])) end++;
	return end;
}

/**
 * EVERY boundary `$name` run in `text`, resolved or not
 * (`sigils.skill_name_spans`).
 *
 * The unresolved counterpart of {@link skillMentions}, and the extent the
 * composer's inert ink is painted from: `$research,` spans `research` (the
 * comma is outside the class) while `$research.` spans `research.` — the dot is
 * INSIDE the class, so it joins the run and the resolver then has to trim it.
 */
export function skillNameSpans(text: string): SkillNameSpan[] {
	const spans: SkillNameSpan[] = [];
	let index = 0;
	while (index < text.length) {
		if (text[index] !== "$" || !isBoundary(text, index)) {
			index += 1;
			continue;
		}
		const end = skillNameEnd(text, index + 1);
		if (end > index + 1) {
			spans.push({ start: index, end, name: text.slice(index + 1, end) });
		}
		// `max` so a bare `$` (no usable name) still advances.
		index += Math.max(end - index, 1);
	}
	return spans;
}

/**
 * `(end, discovered name)` for the run, trimming trailing punctuation
 * (`sigils._resolve_mention`).
 *
 * The full run is tried first, then the name with trailing `.`/`-`/`_` removed
 * one character at a time. That is what makes `$research.` fire on `research`
 * while a skill genuinely named with a dot still wins on the full run.
 *
 * CASE is the injection guard. An exact match always fires. A case-insensitive
 * match fires only where there is positive evidence the user is naming a skill
 * rather than an environment variable: at the LEADING position that is the
 * sigil itself (legacy behaviour, preserved), and inline it is a lowercase
 * letter in the token — so `$PATH`/`$DEBUG` cannot fire a `path`/`debug` skill
 * mid-sentence.
 */
function resolveMention(
	text: string,
	start: number,
	end: number,
	exact: ReadonlySet<string>,
	byLower: ReadonlyMap<string, string>,
	leading: boolean,
): { end: number; name: string } | null {
	let cursor = end;
	for (;;) {
		const candidate = text.slice(start + 1, cursor);
		if (exact.has(candidate)) return { end: cursor, name: candidate };
		if (leading || hasLowercaseEvidence(candidate)) {
			const lowered = byLower.get(candidate.toLowerCase());
			if (lowered !== undefined) return { end: cursor, name: lowered };
		}
		if (cursor > start + 2 && TRIMMABLE.test(text[cursor - 1])) {
			cursor -= 1;
			continue;
		}
		return null;
	}
}

/**
 * Every `$name` in `text` that resolves to a discovered skill
 * (`sigils.skill_mentions`).
 *
 * THE trigger rule. The submit path and the composer's ink both answer "does
 * this token fire" from here.
 *
 * - **Boundary**: `a$b`, `costs$5` and `user@host` are not tokens; neither is a
 *   name in backticks, quotes or parentheses, because all of those put a
 *   non-space character before the `$`.
 * - **Whole text, not line by line**: a token after a newline is a token like
 *   any other, and only the buffer's first token is *leading*
 *   (`text[:start].strip()` is empty).
 * - **Dedupe by resolved name**, first-seen order: `$research … $Research`
 *   attaches one body, not two.
 * - The vocabulary decides: `$100`, `$5/unit` and an unknown name are prose.
 *
 * `skipSpans` are regions that are already spoken for — a skill body in a block
 * that arrived with the message. A token inside one is ignored BEFORE the
 * dedupe, not after: a body quoting `$research` must not suppress a real
 * `$research` later in the same message, and deduping first would let it.
 *
 * The leading rule is fixed: a leading token is resolved case-insensitively
 * (the behaviour every pre-inline `$skill` line had), an inline one needs a
 * lowercase letter. There is deliberately no switch — the ink and the submit
 * path must answer with one rule.
 */
export function skillMentions(
	text: string,
	names: readonly string[],
	opts: { skipSpans?: readonly (readonly [number, number])[] } = {},
): SkillMention[] {
	const exact = new Set(names);
	const byLower = new Map<string, string>();
	for (const name of names) {
		if (!byLower.has(name.toLowerCase())) byLower.set(name.toLowerCase(), name);
	}
	const skipSpans = opts.skipSpans ?? [];
	const mentions: SkillMention[] = [];
	const seen = new Set<string>();
	for (const span of skillNameSpans(text)) {
		if (
			skipSpans.some(
				([begin, finish]) => begin <= span.start && span.start < finish,
			)
		)
			continue;
		const leading = pyTrimStart(text.slice(0, span.start)) === "";
		const resolved = resolveMention(
			text,
			span.start,
			span.end,
			exact,
			byLower,
			leading,
		);
		if (resolved === null || seen.has(resolved.name)) continue;
		seen.add(resolved.name);
		mentions.push({
			start: span.start,
			end: resolved.end,
			text: text.slice(span.start, resolved.end),
			name: resolved.name,
			leading,
		});
	}
	return mentions;
}

/* ------------------------------------------------------------------ */
/* The tail block                                                      */
/* ------------------------------------------------------------------ */

/**
 * A block only counts when the marker, the preamble line and the closer are all
 * present. The preamble is what tells an APPENDED block from a marker the
 * operator quoted: a pasted or forwarded block is the same bytes (accepted
 * cost, recorded at `harness/rows.py`), but a sentence that merely names the
 * tag has no preamble and is never hidden.
 */
export const SKILL_BLOCK_OPEN = "<operator-skills>";
export const SKILL_BLOCK_CLOSE = "</operator-skills>";
export const SKILL_BLOCK_JOIN = "\n\n";
export const SKILL_BLOCK_PREAMBLE =
	"The user invoked the following skills directly. Follow them for this " +
	"request. Their reference files, if any, are listed at the end of each body " +
	"and are read with `skill://<name>/<path>`.";

const ZERO_WIDTH_SPACE = "\u200b";
const DEFUSED_SKILL_OPEN = SKILL_BLOCK_OPEN.replace(
	"<",
	`<${ZERO_WIDTH_SPACE}`,
);
const DEFUSED_SKILL_CLOSE = SKILL_BLOCK_CLOSE.replace(
	"<",
	`<${ZERO_WIDTH_SPACE}`,
);
const DEFUSED_ELEMENT_HEAD = `<${ZERO_WIDTH_SPACE}skill name=`;
const SKILL_ELEMENT_HEAD_RE = /^<skill name="([^"]*)">/;

/**
 * Neutralize block markers appearing in a skill BODY (`sigils.defuse_skill_block`).
 *
 * A SKILL.md whose text quotes a marker would close the block early for
 * {@link skillBlockSpans}, and the operator's prose after it would be stripped
 * from the transcript row as if it were payload. A zero-width space inside each
 * marker is invisible to a reader and stops the literal sequence the scanner
 * matches. Nothing else about the body is escaped — the model must read it
 * verbatim.
 */
export function defuseSkillBlock(body: string): string {
	return body
		.replace(/<\/operator-skills>/g, DEFUSED_SKILL_CLOSE)
		.replace(/<operator-skills>/g, DEFUSED_SKILL_OPEN)
		.replace(/<skill name="/g, DEFUSED_ELEMENT_HEAD);
}

/**
 * The tail block for `(name, body)` pairs, in the caller's order
 * (`invoke.render_skill_block`).
 *
 * One preamble for the whole block rather than one per skill: the model needs
 * the imperative once, and per-skill headers would repeat it for every body a
 * message carries.
 */
export function renderSkillBlock(
	entries: readonly { name: string; body: string }[],
): string {
	const elements = entries.map(
		({ name, body }) =>
			`<skill name="${name}">\n${defuseSkillBlock(body)}\n</skill>`,
	);
	return (
		SKILL_BLOCK_OPEN +
		SKILL_BLOCK_JOIN +
		SKILL_BLOCK_PREAMBLE +
		SKILL_BLOCK_JOIN +
		elements.join(SKILL_BLOCK_JOIN) +
		SKILL_BLOCK_JOIN +
		SKILL_BLOCK_CLOSE
	);
}

/**
 * Half-open `[start, end)` spans of every COMPLETE skill block
 * (`sigils.skill_block_spans`).
 *
 * The exact counterpart of `at-token.ts`'s `referenceBlockSpans`, and the same
 * three parts are load-bearing: the open marker, the block's own preamble line
 * (which separates an appended block from a quoted marker) and the closer. An
 * unclosed opener reports nothing — but does not stop the scan, or it would
 * pair with the NEXT block's closer and swallow the operator's prose between
 * them. Rescanning from the next opener keeps that later block's own span.
 */
export function skillBlockSpans(text: string): [number, number][] {
	const spans: [number, number][] = [];
	const opener = SKILL_BLOCK_OPEN + SKILL_BLOCK_JOIN + SKILL_BLOCK_PREAMBLE;
	let cursor = 0;
	for (;;) {
		const start = text.indexOf(opener, cursor);
		if (start === -1) return spans;
		const close = text.indexOf(SKILL_BLOCK_CLOSE, start + opener.length);
		const nested = text.indexOf(
			SKILL_BLOCK_OPEN,
			start + SKILL_BLOCK_OPEN.length,
		);
		if (close === -1 || (nested !== -1 && nested < close)) {
			cursor = start + SKILL_BLOCK_OPEN.length;
			continue;
		}
		const end = close + SKILL_BLOCK_CLOSE.length;
		spans.push([start, end]);
		cursor = end;
	}
}

/**
 * The `<skill name=…>` heads inside every complete block, in order
 * (`sigils.skill_block_names`).
 *
 * Read from the TOP-LEVEL element heads only: once an element is open, its body
 * is skipped until the matching `</skill>`. A body quoting a head is the skill
 * documenting this feature, not a second attachment, and the test for that is
 * structural rather than a docstring promise.
 */
function skillBlockNames(text: string): string[] {
	const names: string[] = [];
	for (const [start, end] of skillBlockSpans(text)) {
		let depth = 0;
		for (const line of text.slice(start, end).split("\n")) {
			if (depth > 0) {
				if (line.startsWith("</skill>")) depth -= 1;
				continue;
			}
			const head = SKILL_ELEMENT_HEAD_RE.exec(line);
			if (head !== null) {
				names.push(head[1]);
				depth = 1;
			}
		}
	}
	return names;
}

/**
 * Every skill a message fires, bodies not yet read — the desktop's
 * `plan_attachments`, mentions only.
 *
 * Two rules beyond {@link skillMentions}, both about a message that already
 * carries a block:
 *
 * - a mention INSIDE an already-rendered block is ignored, so a second pass
 *   over a persisted payload does not attach the body a second time;
 * - a name already present in a block is not attached again, which is the
 *   idempotence rule `plan_attachments` applies through `skill_block_names`.
 */
export function planSkillMentions(
	text: string,
	names: readonly string[],
): SkillMention[] {
	const blocked = skillBlockSpans(text);
	// The spans are handed to the matcher so a token INSIDE a body never enters
	// its dedupe set: a pasted block quoting `$research` must not shadow a real
	// `$research` later in the message.
	const mentions = skillMentions(text, names, { skipSpans: blocked });
	if (mentions.length === 0) return [];
	const already = new Set(skillBlockNames(text));
	return mentions.filter((mention) => !already.has(mention.name));
}

/** One separator at either END of a string — Python's `str.rstrip()`. */
const TRAILING_SEPARATORS = new RegExp(`[${SEPARATOR_CLASS}]+$`);

/**
 * `text` without its complete skill blocks (`harness.rows._strip_spans`, skill
 * half).
 *
 * The resolver appends a block as `JOIN + block`, so the separator BEFORE one
 * belongs to the block rather than to the operator's prose: each surviving
 * segment is right-stripped, or the row paints a blank line where the block
 * stood. A separator goes back where two surviving segments would otherwise
 * fuse — one space, and only when the next segment starts on a non-space
 * character, which is how the ordinary shapes stay byte-identical.
 *
 * Untouched when the text carries no complete block, so every ordinary message
 * is returned as the same string object's value.
 */
export function stripSkillBlock(text: string): string {
	const spans = skillBlockSpans(text);
	if (spans.length === 0) return text;
	const kept: string[] = [];
	let cursor = 0;
	for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
		if (end <= cursor) continue;
		const begin = Math.max(start, cursor);
		kept.push(text.slice(cursor, begin).replace(TRAILING_SEPARATORS, ""));
		cursor = end;
	}
	kept.push(text.slice(cursor).replace(TRAILING_SEPARATORS, ""));
	let joined = "";
	for (const segment of kept) {
		if (!segment) continue;
		if (joined && !SEPARATOR.test(segment[0])) joined += " ";
		joined += segment;
	}
	return joined;
}

/* ------------------------------------------------------------------ */
/* The legacy payload: written by the fixtures, read forever           */
/* ------------------------------------------------------------------ */

/**
 * Whether a resolved SKILL.md carries anything beyond its frontmatter.
 *
 * A port of `tui/app.py:_skill_body_has_content` (`:1099-1120`), and it exists
 * for the same measured reason: the resolver returns the file VERBATIM, so a
 * stub whose YAML block is the entire file comes back as a non-empty string
 * with zero instruction in it. A plain truthiness check called that a
 * successful load and would send a `<skill>` block containing only `name:` and
 * `description:` — a silent no-op dressed as an invocation.
 *
 * An UNTERMINATED YAML block is malformed rather than empty, so it falls
 * through and counts as content: the user should see the skill fire and read
 * the odd result, not be told their skill is empty when it is broken.
 */
export function skillBodyHasContent(body: string | null | undefined): boolean {
	if (!body || pyTrim(body) === "") return false;
	let text = pyTrimStart(body);
	if (text.startsWith("---")) {
		const rest = text.slice(3);
		const end = rest.indexOf("\n---");
		if (end !== -1) text = rest.slice(end + 4);
	}
	return pyTrim(text) !== "";
}

/**
 * Escape a typed line for an XML-ish attribute, reversibly (`_escape_attr`).
 *
 * Deliberately minimal and paired with the harness's own unescape: only the
 * two characters that could end the attribute or the tag. A newline becomes a
 * literal `&#10;` so a multi-line draft cannot break the single-line tag the
 * replay scanner matches. A GLOBAL regex rather than a plain `replace`:
 * Python's `str.replace` is replace-ALL, and a single-replacement JS spelling
 * would leave every later occurrence raw.
 *
 * @internal Legacy writer plumbing. The app sends `renderSkillBlock`; this and
 * `renderSkillInvocation` exist so the legacy READ half is pinned against the
 * writer that produced it (`skill-row.test.mjs`, `skill-seal-fixture.mjs`).
 * New code must not build the legacy shape.
 */
export function escapeSkillAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\n/g, "&#10;");
}

/**
 * Inverse of {@link escapeSkillAttribute}, and `_unescape_attr` character for
 * character.
 *
 * ORDER IS THE RULE HERE TOO, and it is the other order: `&amp;` goes LAST, or
 * an escaped `&` would be undone into a bare `&` that the following passes then
 * read as the start of another entity (`&amp;lt;` would become `<`). The
 * harness states the same constraint on its own function, and it is the one
 * property a port of this could silently get wrong.
 */
export function unescapeSkillAttribute(value: string): string {
	return value
		.replace(/&#10;/g, "\n")
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

/**
 * Build the message text that carries an invoked skill to the model — the
 * LEGACY shape.
 *
 * The user's text goes out as the header sentence, the attribute-carrying tag,
 * the body and the closing tag, with the request last. This is what every
 * transcript written before the tail block holds, and what `skill-row.ts` still
 * reads; no new send builds it (`renderSkillBlock` is the writer now), but the
 * shape is kept here so the read half and the scene fixture are pinned against
 * the writer that produced them rather than against a literal only.
 *
 * @internal See {@link escapeSkillAttribute}: fixture and test plumbing only.
 */
export function renderSkillInvocation(
	invocation: SkillInvocation,
	body: string,
): string {
	const header = `The user invoked the \`${invocation.name}\` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with \`skill://<name>/<path>\`.`;
	const typed = escapeSkillAttribute(invocation.typed);
	const parts = [
		header,
		`<skill name="${invocation.name}" invocation="${typed}">`,
		body,
		"</skill>",
	];
	if (invocation.request) parts.push(invocation.request);
	return parts.join("\n");
}

/**
 * The `$name` line a legacy payload was built from, or `null`
 * (`typed_line_of`).
 *
 * The read side of the `invocation` attribute, and the whole reason it exists:
 * the payload is what gets PERSISTED, so a resumed session replays this string
 * as the user's row. STRICTLY the harness's read — it searches the tag anywhere,
 * because its caller only ever reads strings the writer produced — while
 * `skill-row.ts`'s `skillRowOf` additionally requires the header line, which is
 * what tells a payload apart from prose quoting one.
 *
 * `null` for any text that is not one of these payloads, which is every ordinary
 * message, so a caller falls through to painting it verbatim.
 */
export function typedLineOf(text: string): string | null {
	const match = SKILL_TAG_RE.exec(text);
	return match ? unescapeSkillAttribute(match[2]) : null;
}
