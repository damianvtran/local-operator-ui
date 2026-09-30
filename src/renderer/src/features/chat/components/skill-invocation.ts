/**
 * `$skill` manual invocation for the desktop composer — the submit-side half.
 *
 * `local_operator/skills/invoke.py` owns the `$name` contract, and expansion is
 * a CLIENT duty: there is no server-side expansion, so a composer that does not
 * expand sends prose with a sigil in it. This module is the desktop's
 * client-side parity with that contract, and every piece of it is a
 * character-for-character port because the rendered payload is what gets
 * PERSISTED and what the model reads on every later turn — a difference of one
 * escape character is a difference in the conversation's record.
 *
 * Ported, with the harness's line ranges as the reference:
 *
 *   - `parse_invocation` (`invoke.py:128-170`): the recognition rule. A token is
 *     an invocation only when it is the FIRST token of the text being submitted
 *     and what follows the `$` matches a DISCOVERED SKILL NAME. `$100 for the
 *     redesign` matches no skill and is plain prose; so is a stray `$` alone.
 *     That is what keeps this from needing an escape rule: the vocabulary
 *     decides, so nothing that is not a skill name is ever captured. Matching
 *     is case-insensitive (`$Research` resolves `research`), and hidden skills
 *     are NOT filtered — naming one explicitly is exactly the "never
 *     auto-select, let me fire it" case `hide` describes.
 *   - `render_invocation` (`invoke.py:173-207`): the payload — header,
 *     attribute-carrying opening tag, body, closing tag, and the request last.
 *     A bare `$name` with no request is NOT given a fake one: the body is the
 *     instruction in that case. The opening tag carries the typed line in an
 *     `invocation` attribute because the payload is what a resumed session
 *     replays; without it the persisted message becomes the whole SKILL.md body
 *     as the user's row.
 *   - `_escape_attr` (`invoke.py:210-224`): the two characters that could end
 *     the attribute or the tag, plus a literal `&#10;` for a newline so a
 *     multi-line draft cannot break the single-line tag. ORDER IS THE RULE, and
 *     `&` goes first or `"` would escape into `&amp;quot;`.
 *
 * WHAT IS DELIBERATELY NOT PORTED, so its absence is not read as an oversight:
 * `_unescape_attr`/`typed_line_of` (`invoke.py:227-252`) exist for the TUI's
 * transcript REPLAY — a resumed session repaints the typed line instead of the
 * payload. The desktop has no display/sent split on `sessions.message`: the
 * sent text is the row. Until that wire grows one, the replay half has no
 * caller here, and dead code is not parity (recorded in the PR's notes).
 *
 * Pure and I/O-free: the caller supplies the body it read from `skills.list`.
 */

import { pyTrim, pyTrimStart } from "./slash-token";

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

/**
 * A leading `$name` token. `name` uses the skill-name character set: letters,
 * digits, hyphen, underscore and dot, because real skill names contain all of
 * them. The consequence is that `.` and `-` do NOT end the token —
 * `$research.` parses the name `research.`, misses the vocabulary and is sent
 * as prose, which is the safe direction but not a sentence that invokes;
 * `$research,` DOES work, since `,` is outside the class. Anchored at the
 * start: what is SUBMITTED is a prefix, because the composer reassembles an
 * inline `$` to the front before Enter (`skill-completion.ts`).
 */
const INVOCATION_RE = /^\$([A-Za-z0-9][A-Za-z0-9._-]*)/;

/**
 * Resolve a leading `$name` against the discovered vocabulary.
 *
 * Returns `null` — meaning "this is ordinary prose, send it unchanged" — when
 * the text does not start with `$`, when the token is not a known skill name,
 * or when the name is followed immediately by a word character the pattern
 * would have to swallow (`$research_extra` parses the name `research_extra`,
 * which is not the skill, and does not silently fall back to `research`).
 *
 * `names` is the discovery ORDER — the earlier root wins collisions within one
 * host and the order is what the case-insensitive pass preserves, so `$ResearCH`
 * resolves the same skill the discovery name denotes rather than a second guess.
 */
export function parseSkillInvocation(
	text: string,
	names: readonly string[],
): SkillInvocation | null {
	const stripped = pyTrimStart(text);
	const match = INVOCATION_RE.exec(stripped);
	if (!match) return null;
	const name = match[1];
	let resolved: string | undefined = names.includes(name) ? name : undefined;
	if (resolved === undefined) {
		// Case-insensitive second pass, as an explicit scan rather than a
		// lower-cased index so the ORIGINAL discovery name is what gets resolved
		// and echoed — the skill is `research` even when the user typed
		// `$Research`.
		const lowered = name.toLowerCase();
		resolved = names.find((candidate) => candidate.toLowerCase() === lowered);
	}
	if (resolved === undefined) return null;
	const request = pyTrim(stripped.slice(match[0].length));
	return {
		name: resolved,
		request,
		token: match[0],
		typed: pyTrim(stripped),
	};
}

/**
 * Escape a typed line for an XML-ish attribute, reversibly (`_escape_attr`).
 *
 * Deliberately minimal and paired with the harness's own unescape: only the
 * two characters that could end the attribute or the tag. A newline becomes a
 * literal `&#10;` so a multi-line draft cannot break the single-line tag the
 * replay scanner matches. `replaceAll` rather than `replace`: Python's
 * `str.replace` is replace-ALL, and a single-replacement JS spelling would
 * leave every later occurrence raw.
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
 * Build the message text that carries an invoked skill to the model.
 *
 * The body is delivered inside a tagged block with an imperative, mirroring
 * `render_block`'s voice: a bare paste of SKILL.md reads to the model as
 * reference material it may consult, and the whole point of a manual
 * invocation is that the user has already decided. The header text is
 * byte-for-byte `invoke.py:193-197` — it is prose the model reads, not a label.
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
