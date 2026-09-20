/**
 * Caret-aware `@` tokenizer for the composer.
 *
 * A name-for-name port of `local_operator/sigils.py` on the harness branch that
 * adds `@` references (`damianvtran/local-operator#1220`, reviewed head
 * `af70c1b0d`): `is_boundary`, `_line_of_cursor`, `_active_at`, `_token_end`,
 * `at_token`, `split_token`, plus the scan `local_operator/references.py`'s
 * `_reference_tokens` performs over a finished draft. Pure and I/O-free: no
 * React, no network, no DOM.
 *
 * WHY a port rather than a second parser. The harness resolves the span and
 * this file decorates it, and the TWO surfaces must agree exactly: the patch in
 * `references.py` says it plainly for its own pair — "a boundary rule that holds
 * in the composer but not at submit time is a token the user saw highlighted and
 * the agent never received". A chip drawn on a span the resolver does not expand
 * is the same defect with a nicer picture, and it is the failure the design
 * direction's rule ("chip ⇔ the token resolves") exists to make impossible. So
 * the span arithmetic is copied, not re-derived, and every function below names
 * its Python counterpart so the two can be diffed by name.
 *
 * The rules that must survive the port, and where each comes from:
 *
 *   - An `@` opens a token only at a WORD BOUNDARY: buffer/line start, or right
 *     after whitespace (`is_boundary`). That is the ONE rule that makes running
 *     this on every keystroke of ordinary prose safe: `user@host.com`,
 *     `glab mr create --assignee @me` and `@pytest.mark` either have no boundary
 *     `@` or name a path that does not exist.
 *   - The token the caret is IN is edited (`_active_at`: the last boundary `@`
 *     at or before the caret), so `@a @sr|` offers `sr`.
 *   - An UNQUOTED token terminates on WHITESPACE ONLY — never on `/` and never
 *     on `.` or `,`, which is the whole difference from the `$`/`/` rules: a
 *     path IS slashes, and `look at @a.py, then fix` is one token `@a.py,` that
 *     names nothing, so nothing is expanded. That is why the picker must write
 *     the token the user is expected to have typed, comma and all.
 *   - The QUOTED form (`@"my file.txt"`) runs to the closing quote and yields the
 *     content between the quotes, which is the only way to reference a name with
 *     a space; an unterminated quote falls back to the whitespace rule so a
 *     half-typed `@"` parses instead of swallowing the line.
 *   - A token never spans a newline, so the line slice the caret parser reads and
 *     the slice the whole-draft scan reads are the same string.
 *   - Word-phase only: the caret must be INSIDE the token. Moving out into the
 *     request closes the list, which is what makes the trailing space the
 *     picker's own close gesture.
 *   - A token inside an already-emitted `<operator-references>` block is NOT a
 *     candidate, and neither is one a block's `typed=` attribute already names —
 *     `_block_spans`/`_already_expanded`, ported below.
 */

import { SEPARATOR } from "./slash-token";

/*
 * A boundary `@` is the line start or the cell right after a SEPARATOR — the class
 * `./slash-token` spells out, for the same reason it is there: the TUI's tokeniser
 * asks it in Python's class, so a boundary the TUI has (U+0085, U+001C-U+001F) has
 * to be one here too, and U+FEFF has to be not one (round 4, F4-1's inventory).
 */

/** The `@` token the caret sits in: `[start, end)` plus the path typed. */
export type AtToken = { start: number; query: string; end: number };

/** One candidate reference in a whole buffer, as the resolver would find it. */
export type AtSpan = {
	/** Index of the `@`. */
	start: number;
	/** First cell past the token. */
	end: number;
	/** The token as typed, `@` included — the block's own `typed=` value. */
	typed: string;
	/** The path the token names: `query` unquoted, `@` and quotes removed. */
	path: string;
};

/**
 * Whether `line[index]` (a sigil) begins a fresh token.
 *
 * The `@` counterpart of the same function in `slash-token.ts`, kept separate
 * because the two grammars differ in everything else and a shared boundary
 * helper would invite a shared token-end rule, which is the one thing that must
 * NOT be shared: `/` ends at whitespace and `@` does not stop at `/`.
 */
export function isBoundary(line: string, index: number): boolean {
	return index === 0 || SEPARATOR.test(line[index - 1]);
}

/** The line the caret sits on, as `(line, whole-buffer offset of its start, column)`. */
function lineOfCursor(
	text: string,
	cursor: number | null,
): { line: string; lineStart: number; column: number } {
	let at = cursor === null || cursor > text.length ? text.length : cursor;
	if (at < 0) at = 0;
	const lineStart = text.lastIndexOf("\n", at - 1) + 1;
	const newline = text.indexOf("\n", at);
	const lineEnd = newline === -1 ? text.length : newline;
	return {
		line: text.slice(lineStart, lineEnd),
		lineStart,
		column: at - lineStart,
	};
}

/**
 * `(end, query)` for the `@` token opening at `line[at]`.
 *
 * `end` indexes the first cell past the token, so a completion can rebuild just
 * that span. Grammar only: it answers "where does this token stop" and consults
 * nothing about the filesystem.
 */
export function tokenEnd(
	line: string,
	at: number,
): { end: number; query: string } {
	if (at + 1 < line.length && line[at + 1] === '"') {
		const close = line.indexOf('"', at + 2);
		if (close !== -1)
			return { end: close + 1, query: line.slice(at + 2, close) };
	}
	let end = at + 1;
	while (end < line.length && !SEPARATOR.test(line[end])) end++;
	return { end, query: line.slice(at + 1, end) };
}

/** Index within `line` of the boundary `@` the caret is editing, or `null`. */
export function activeAt(line: string, column: number): number | null {
	let candidate: number | null = null;
	for (let index = 0; index < line.length; index++) {
		if (line[index] === "@" && isBoundary(line, index) && index <= column)
			candidate = index;
	}
	return candidate;
}

/**
 * The `@` token the caret sits in, or `null`.
 *
 * A bare `@` returns `query: ""` and opens the list on the cwd rather than being
 * special-cased closed — `@` is how you ask "what is here" — and there is no
 * command-argument arbitration to do, unlike `$`, because `@` has no claiming
 * word and owns nothing after it.
 */
export function atToken(
	text: string,
	cursor: number | null = null,
): AtToken | null {
	const { line, lineStart, column } = lineOfCursor(text, cursor);
	const at = activeAt(line, column);
	if (at === null) return null;
	const { end, query } = tokenEnd(line, at);
	// The caret must be INSIDE the token: past its end the user has moved on to
	// the request, and the word-terminating space is what closes the list.
	if (column > end) return null;
	return { start: lineStart + at, query, end: lineStart + end };
}

/**
 * Split a token's `query` into `(dirPart, nameQuery)` at the LAST `/`.
 *
 * How a shell completes a path, and the reason deepening is lazy by
 * construction: one directory is scanned per segment typed, never the tree.
 *
 *     ""             -> ["",            ""]
 *     "sr"           -> ["",            "sr"]
 *     "src/"         -> ["src/",        ""]
 *     "src/ap"       -> ["src/",        "ap"]
 *     "../sibling/x" -> ["../sibling/", "x"]
 */
export function splitToken(query: string): [string, string] {
	const cut = query.lastIndexOf("/");
	if (cut === -1) return ["", query];
	return [query.slice(0, cut + 1), query.slice(cut + 1)];
}

/**
 * The marker pair an expansion pass wraps its output in.
 *
 * `references.py`'s `REFERENCE_BLOCK_OPEN`/`REFERENCE_BLOCK_CLOSE`, copied
 * verbatim: the two strings are the contract between the harness's writer and
 * both of its readers, and a composer that spelled them differently would fail to
 * recognise a block it had just written.
 */
export const REFERENCE_BLOCK_OPEN = "<operator-references>";
export const REFERENCE_BLOCK_CLOSE = "</operator-references>";

/** The attribute one expanded element names its source token in. */
const TYPED_ATTRIBUTE = 'typed="';

/**
 * Half-open `[start, end)` spans of every already-emitted block.
 *
 * `references._block_spans`, ported. An UNCLOSED marker runs to the end of the
 * text, which is the harness's own fail-closed reading: the token that might be
 * inside a block is treated as inside one.
 */
export function referenceBlockSpans(text: string): [number, number][] {
	const spans: [number, number][] = [];
	let cursor = 0;
	for (;;) {
		const start = text.indexOf(REFERENCE_BLOCK_OPEN, cursor);
		if (start === -1) return spans;
		const close = text.indexOf(REFERENCE_BLOCK_CLOSE, start);
		const end =
			close === -1 ? text.length : close + REFERENCE_BLOCK_CLOSE.length;
		spans.push([start, end]);
		cursor = end;
	}
}

/**
 * Inverse of `references._attribute`, and it must run in THIS order.
 *
 * `&amp;` last, or a literal `&amp;lt;` would come back as `<` — a character the
 * user never typed, invented by the decoder, which is also what would break the
 * round trip the exclusion below depends on.
 */
function unattribute(value: string): string {
	return value
		.replace(/&#10;/g, "\n")
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

/**
 * Tokens a previous pass over `text` already resolved.
 *
 * `references._already_expanded`, and it is the half a span skip alone cannot
 * do: the user's typed token deliberately SURVIVES in the prose BESIDE the block
 * (the transcript wants the sentence, and the model reads it), so it sits outside
 * every span and a plain scan would find it — and paint a chip on a reference the
 * harness will not expand again, because it is already expanded.
 */
export function alreadyExpandedTokens(
	text: string,
	spans: readonly [number, number][],
): Set<string> {
	const typed = new Set<string>();
	for (const [start, end] of spans) {
		const region = text.slice(start, end);
		let cursor = 0;
		for (;;) {
			const found = region.indexOf(TYPED_ATTRIBUTE, cursor);
			if (found === -1) break;
			const valueStart = found + TYPED_ATTRIBUTE.length;
			const close = region.indexOf('"', valueStart);
			if (close === -1) break;
			typed.add(unattribute(region.slice(valueStart, close)));
			cursor = close + 1;
		}
	}
	return typed;
}

/** Whether a buffer offset falls inside one of `spans`. */
export function insideBlock(
	index: number,
	spans: readonly [number, number][],
): boolean {
	return spans.some(([start, end]) => start <= index && index < end);
}

/**
 * Every candidate reference in a finished buffer, left to right.
 *
 * The composer's half of `references._reference_tokens`, and it exists so the
 * chip layer is derived from the SAME spans the resolver will expand rather than
 * from a second reading of the text. Two rules come with it:
 *
 *   - A token with a BARE query is not a candidate. `@` alone means "what is
 *     here" to the picker and nothing at all to the resolver, so it never chips.
 *   - The scan skips a token's whole span (`index += max(end, 1)`), so a second
 *     `@` inside one token is not a second candidate: `@a@b` is ONE unresolvable
 *     span, not two chips. Clicking between two would-be chips cannot split
 *     them, because there is only ever one decoration per maximal span.
 *
 * The harness's `_block_spans`/`_already_expanded` skip IS ported, and the
 * paragraph that used to sit here said the opposite (“Deliberately absent: a
 * block marker cannot be present in the composer's own draft”) while claiming a
 * pasted block “would expand on submit by the resolver's own marker rules”.
 * That claim is false, and it is the wrong claim to leave for the next reader:
 * `_reference_tokens` SKIPS every candidate inside a block span and counts it, so
 * a token in a pasted block is sent as prose with a notice, and a chip over it
 * asserts an expansion that will not happen — the same defect the design's rule
 * (“chip ⇔ the token resolves”, and review round 1's U2) exists to make
 * impossible. It needs a pasted marker, e.g. copying a previous turn back into
 * the composer, which is a real gesture and not a contrived one.
 *
 * The scan skips such a token entirely rather than decorating it differently: the
 * chip layer has exactly two grounds and both of them mean “this resolves”.
 */
export function atTokenSpans(text: string): AtSpan[] {
	const spans: AtSpan[] = [];
	const blocks = referenceBlockSpans(text);
	const resolved = alreadyExpandedTokens(text, blocks);
	let index = 0;
	while (index < text.length) {
		if (text[index] !== "@" || !isBoundary(text, index)) {
			index += 1;
			continue;
		}
		// The token never spans a newline, so the line slice here is the same
		// string the caret parser above reads.
		const newline = text.indexOf("\n", index);
		const lineEnd = newline === -1 ? text.length : newline;
		const { end, query } = tokenEnd(text.slice(index, lineEnd), 0);
		const typed = text.slice(index, index + end);
		if (query && !resolved.has(typed) && !insideBlock(index, blocks))
			spans.push({ start: index, end: index + end, typed, path: query });
		index += Math.max(end, 1);
	}
	return spans;
}

/**
 * One segment of the draft, against the token spans the chip layer draws.
 *
 * The mirror renders this rather than the raw string, because the fills have to
 * be measured from the tokens' OWN layout — a character count is an estimate, and
 * an estimate that drifts puts a rectangle beside the run it is under.
 */
export type AtSegment = { text: string; span: AtSpan | null };

/**
 * Split `text` into plain runs and token spans, in order.
 *
 * The spans come from `atTokenSpans`, so the segments and the decoration derive
 * from ONE reading of the text: a segment's `span` is the very span that will be
 * probed, and the key it is measured under is `atSpanKey`.
 */
export function atSegments(
	text: string,
	spans: readonly AtSpan[],
): AtSegment[] {
	const out: AtSegment[] = [];
	let at = 0;
	for (const span of spans) {
		if (span.start < at) continue;
		if (span.start > at)
			out.push({ text: text.slice(at, span.start), span: null });
		out.push({ text: text.slice(span.start, span.end), span });
		at = span.end;
	}
	if (at < text.length) out.push({ text: text.slice(at), span: null });
	return out;
}

/**
 * The token the picker has open, or `null` — `atToken`, minus the tokens the
 * harness will not expand.
 *
 * Two exclusions, both from the resolver's own rules rather than from taste: a
 * token inside a pasted `<operator-references>` block is skipped by
 * `_reference_tokens`, and one a block's `typed=` attribute already names is
 * skipped by `_already_expanded`. The picker is not the chip layer, but it writes
 * the token the chip layer draws, so a list offered over either would be leading
 * the user to the same false claim one step earlier.
 */
export function atPickerToken(
	text: string,
	cursor: number | null = null,
): AtToken | null {
	const token = atToken(text, cursor);
	if (!token) return null;
	const blocks = referenceBlockSpans(text);
	if (insideBlock(token.start, blocks)) return null;
	// The whole span as it will be written, which is what the attributes carry:
	// the picker replaces `[start, end)`, so `typed` is that slice.
	if (
		alreadyExpandedTokens(text, blocks).has(text.slice(token.start, token.end))
	)
		return null;
	return token;
}

/**
 * The reference a pick writes, given the token it replaces and the row chosen.
 *
 * The harness's `_file_span_replacement` semantics with ONE deliberate
 * divergence, stated here because the two must be comparable by name:
 *
 *   - The directory part of the typed token SURVIVES. A row read under `@src/`
 *     names `app.py`, not `src/app.py`, and replacing the whole span with the
 *     row's bare name would drop the directory and produce a path that does not
 *     exist — which the resolver then refuses with a "no such path" notice.
 *   - A path containing a SPACE is emitted in its QUOTED form, around the whole
 *     path so it round-trips as one token, because a bare space ends the token
 *     and leaves the rest of the name as prose.
 *   - DIVERGENCE: a FILE carries a trailing space and a DIRECTORY does not. The
 *     harness's own picker writes neither (its `_file_span_replacement` says why:
 *     "a path segment may continue ... and a space would terminate the token and
 *     close the list the user is still navigating"). In a terminal that is the
 *     whole story; in this composer an accepted FILE row that left the list open
 *     would hold a list over the sentence the user is now writing, so the file
 *     closes and the directory stays open to drill — the same asymmetry the slash
 *     popup already uses (`slash-completion.ts:33-41`). The trailing space is
 *     OUTSIDE the token, so the block the harness builds from `@src/app.py `
 *     carries exactly the `typed="@src/app.py"` it would carry without it: the
 *     insertion is harness-equivalent, not a second expansion rule.
 *
 * WHY THE TRAILING `/` ALONE DOES NOT KEEP A SPACED DIRECTORY OPEN, because the
 * sentence above used to claim it did (review round 1, M5). The spaced form is
 * QUOTED and CLOSED — `@"my dir/"` — and `tokenEnd` ends the token at the closing
 * quote, so the next character typed lands outside it and the directory resolves
 * while the rest of the name is sent as prose. The caller closes that gap by
 * placing the CARET BEFORE THE CLOSING QUOTE after a directory pick
 * (`message-input.tsx`'s `handleAtPick`), which is the same shape as the
 * unspaced token's: the caret sits inside the token, the picker stays open and
 * drills, and the next segment is typed into the span it belongs to.
 */
export function atReference(row: { path: string; directory: boolean }): string {
	// A directory keeps its trailing `/`: it is what makes the token stay open so
	// the picker drills in, and it is exactly what the harness's `split_token`
	// reads as "list that directory with an empty name query".
	const target = row.directory ? `${row.path}/` : row.path;
	const quoted = target.includes(" ") ? `"${target}"` : target;
	return row.directory ? `@${quoted}` : `@${quoted} `;
}
