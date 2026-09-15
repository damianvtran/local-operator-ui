/**
 * Caret-aware slash tokenizer for the composer.
 *
 * A name-for-name port of `local_operator/tui/widgets/command_picker.py:205-560`
 * (`_is_boundary`, `_line_of_cursor`, `_boundary_slashes`, `_active_slash`,
 * `_claiming_command`, `slash_context`, `slash_token_span`,
 * `slash_argument_context`, `slash_argument`), so the two hosts can be diffed by
 * name. Pure and I/O-free: no React, no network, no DOM.
 *
 * WHY this replaces the old detector. `slash-commands.tsx` matched
 * `/^\/([A-Za-z]*)(?=\s|$)/` against the WHOLE buffer with `^` anchored, so a
 * command was only ever visible at byte 0: `fix this /team` opened nothing, and
 * once a word was completed there was no argument phase at all. Both renderer
 * requirements ("a command typed mid-draft is a command" and "the argument list
 * narrows as you type") are properties of this tokenizer, which is why the port
 * is the whole of the first two requirements.
 *
 * The rules that must survive the port, and where each comes from:
 *
 *   - A `/` opens a token only at a boundary: line start, or right after
 *     whitespace. That is the ONE rule that makes running this on every
 *     keystroke of ordinary prose safe, because `src/foo` and `and/or` are
 *     punctuation inside a word rather than a command (`_is_boundary`).
 *   - Normally the active token is the LAST boundary `/` at or before the caret,
 *     so a caret in `a /foo /ba|` edits `/ba` (`_active_slash`).
 *   - Once a recognised command word is space-terminated it CLAIMS the rest of
 *     its line, so a later `/` inside its argument is plain text and a second
 *     `/team` typed inside a request is not a command (`_claiming_command`).
 *   - The argument runs from the word-terminating space to the END OF THE LINE,
 *     never the end of the buffer, which is what lets a command sit on its own
 *     line above a multi-line draft (`slash_argument_context`).
 *   - The caret must be past the terminating space for the argument phase; on
 *     the word itself it is the command phase, so the two lists are mutually
 *     exclusive (`caretPhase`).
 *   - A trailing `\r` from a CRLF paste is stripped once, here, so every
 *     consumer agrees on the word (`_line_of_cursor`, review round 1 minor-1:
 *     `.partition(" ")` does not treat `\r` as a separator, so the word came
 *     back as `"team\r"` and matched nothing).
 *   - `""` is a valid open argument (the whole catalogue) and is distinct from
 *     `null` (`slash_argument`).
 */

/** The pure parser's default vocabulary: an empty set disables claiming. */
const EMPTY: ReadonlySet<string> = new Set<string>();

/** A boundary `/` is the line start or the cell right after whitespace. */
const WHITESPACE = /\s/;

function isBoundary(line: string, index: number): boolean {
	return index === 0 || WHITESPACE.test(line[index - 1]);
}

/** Indices of every boundary `/` on `line`. */
export function boundarySlashes(line: string): number[] {
	const found: number[] = [];
	for (let index = 0; index < line.length; index++) {
		if (line[index] === "/" && isBoundary(line, index)) found.push(index);
	}
	return found;
}

export type LineCursor = { line: string; lineStart: number; column: number };

/**
 * The line the caret sits on, as (line, whole-buffer offset of its start,
 * column).
 *
 * `cursor === null` means "the end of the buffer", which is where a user typing
 * at the end of their draft is; anything out of range is CLAMPED rather than
 * thrown on, because a stale caret (a resync racing a delete) must not be able
 * to index out of range. A trailing `\r` is stripped so every consumer agrees
 * on the word under a CRLF paste.
 */
export function lineOfCursor(text: string, cursor: number | null): LineCursor {
	let at = cursor === null || cursor > text.length ? text.length : cursor;
	if (at < 0) at = 0;
	const lineStart = text.lastIndexOf("\n", at - 1) + 1;
	const newline = text.indexOf("\n", at);
	const lineEnd = newline === -1 ? text.length : newline;
	let line = text.slice(lineStart, lineEnd);
	if (line.endsWith("\r")) line = line.slice(0, -1);
	return { line, lineStart, column: at - lineStart };
}

/**
 * Index within `line` of the boundary `/` whose recognised command word is
 * space-terminated and therefore owns the rest of the line, else `null`.
 * Earliest wins; an empty vocabulary disables claiming entirely.
 */
export function claimingCommand(
	line: string,
	commands: ReadonlySet<string>,
): number | null {
	if (commands.size === 0) return null;
	for (const index of boundarySlashes(line)) {
		const rest = line.slice(index + 1);
		const space = rest.indexOf(" ");
		if (space === -1) continue;
		if (commands.has(rest.slice(0, space).toLowerCase())) return index;
	}
	return null;
}

/**
 * Index within `line` of the boundary `/` the caret is editing, or `null`.
 *
 * `commands` is the recognised vocabulary (lower-cased primaries AND aliases);
 * passing it makes a slash inside an already-engaged command's argument plain
 * text. Empty set disables claiming, which is the pure parser's behaviour.
 */
export function activeSlash(
	line: string,
	column: number,
	commands: ReadonlySet<string>,
): number | null {
	const claim = claimingCommand(line, commands);
	let candidate: number | null = null;
	for (const index of boundarySlashes(line)) {
		if (index === claim) {
			// The claiming command's argument runs to the end of the line, so a
			// caret past this slash is INSIDE this command and every later slash
			// is argument text. A caret before it is outside the claim, and
			// nothing earlier can claim, so the running candidate stands.
			return column > index ? index : candidate;
		}
		if (index <= column) candidate = index;
	}
	return candidate;
}

/**
 * Command-WORD phase: the word being typed, and the `[start, end)` span of the
 * `/` plus the word. `end` is the first cell past the word.
 *
 * `null` when the caret is not inside a boundary-slash token whose word is
 * still open — including the instant a space terminates the word, at which
 * point the ARGUMENT phase owns the caret (`slashArgument`). `cursor` defaults
 * to the end of the buffer, the common "typing at the end" case.
 */
export function slashContext(
	text: string,
	cursor: number | null = null,
	commands: ReadonlySet<string> = EMPTY,
): { start: number; query: string; end: number } | null {
	const { line, lineStart, column } = lineOfCursor(text, cursor);
	const slash = activeSlash(line, column, commands);
	if (slash === null) return null;
	let wordEnd = slash + 1;
	while (wordEnd < line.length && !WHITESPACE.test(line[wordEnd])) wordEnd++;
	// A space between the slash and the caret means the word is already
	// terminated and the caret is out in argument (or message) territory.
	if (column > wordEnd) return null;
	return {
		start: lineStart + slash,
		query: line.slice(slash + 1, wordEnd),
		end: lineStart + wordEnd,
	};
}

/**
 * Whole slash TOKEN at the caret: `[start, end)` where `start` is the `/` and
 * `end` is the END OF ITS LINE (word + inline argument). This is the span a RUN
 * splices out. `null` when the caret is not on one.
 */
export function slashTokenSpan(
	text: string,
	cursor: number | null = null,
	commands: ReadonlySet<string> = EMPTY,
): { start: number; end: number } | null {
	const { line, lineStart, column } = lineOfCursor(text, cursor);
	const slash = activeSlash(line, column, commands);
	if (slash === null) return null;
	return { start: lineStart + slash, end: lineStart + line.length };
}

/**
 * ARGUMENT phase for one of `commands`: the argument text and its spans.
 *
 * `tokenStart` indexes the `/`, so a run can splice the whole `/cmd arg` out of
 * an inline draft. `null` when the caret is not in the argument phase of one of
 * `commands`; `value` is `""` when the word is complete and nothing is typed,
 * which is the whole-catalogue state and is distinct from `null`.
 *
 * `known` is the FULL recognised vocabulary (a superset of `commands`), used
 * only for the nested-slash rule; it defaults to `commands`. Ported from
 * `slash_argument_context`.
 */
export function slashArgumentContext(
	text: string,
	commands: readonly string[],
	cursor: number | null = null,
	known: ReadonlySet<string> = EMPTY,
): { value: string; start: number; end: number; tokenStart: number } | null {
	const { line, lineStart, column } = lineOfCursor(text, cursor);
	const vocabulary =
		known.size > 0 ? known : new Set(commands.map((c) => c.toLowerCase()));
	const slash = activeSlash(line, column, vocabulary);
	if (slash === null) return null;
	const rest = line.slice(slash + 1);
	// `.partition(" ")`: a literal space, NOT the whitespace class. `\r` and
	// `\t` therefore do not terminate the word here, which is exactly why
	// `lineOfCursor` strips the CR above.
	const space = rest.indexOf(" ");
	if (space === -1) return null;
	const word = rest.slice(0, space);
	if (!commands.some((command) => command.toLowerCase() === word.toLowerCase()))
		return null;
	const spaceColumn = slash + 1 + word.length;
	// The caret must be PAST the terminating space; while it is still on the
	// word that is command-word phase, which `slashContext` owns.
	if (column <= spaceColumn) return null;
	return {
		value: rest.slice(space + 1),
		start: lineStart + spaceColumn + 1,
		end: lineStart + line.length,
		tokenStart: lineStart + slash,
	};
}

/**
 * Argument text only, or `null`.
 *
 * `""` when the word is complete and nothing has been typed after it. A thin
 * projection of `slashArgumentContext` for the callers that only rank against
 * the argument and never rewrite the span.
 */
export function slashArgument(
	text: string,
	commands: readonly string[],
	cursor: number | null = null,
	known: ReadonlySet<string> = EMPTY,
): string | null {
	return slashArgumentContext(text, commands, cursor, known)?.value ?? null;
}

/**
 * The caret's phase, so the two lists are mutually exclusive.
 *
 * "argument" wins over "command" because the two are disjoint by construction
 * (the argument phase requires the caret past the word-terminating space, where
 * `slashContext` has already declined), and the order is asserted here rather
 * than left to the caller.
 */
export function caretPhase(
	text: string,
	cursor: number | null,
	commandNames: ReadonlySet<string>,
	argumentCommands: readonly string[],
): "argument" | "command" | null {
	if (
		slashArgumentContext(text, argumentCommands, cursor, commandNames) !== null
	)
		return "argument";
	if (slashContext(text, cursor, commandNames) !== null) return "command";
	return null;
}

/**
 * Replace `[start, end)` with `replacement`, remove ONE adjoining separator
 * where the replacement would double it up, and return the new text plus the
 * caret offset.
 *
 * Ported from `Editor._splice_command` (`editor.py:7179-7203`), with the two
 * directions it is used in stated separately because they are NOT symmetric:
 *
 *   - REMOVING (an empty replacement, the splice): one adjoining separator goes
 *     with the token, the PRECEDING one preferred — that is the one the inline
 *     gesture adds, a space before an appended command or a newline above a
 *     message. The following one is taken only when the token opened the buffer.
 *   - COMPLETING (a replacement that carries its own trailing space): the
 *     FOLLOWING separator is absorbed only when the token opened the buffer,
 *     where it would otherwise double the replacement's own space. A preceding
 *     separator is always KEPT, because it is what sets the command apart from
 *     the prose in front of it.
 *
 * Worked, because this rule is the one most likely to be got wrong:
 *
 *   - `fix this /tea` span `[9, 13)`: the space at index 8 is kept, so the edit
 *     is `[9, 13) -> "/team "`, giving `fix this /team ` — exactly one space,
 *     and the prose byte-identical.
 *   - `/tea fix this` span `[0, 4)`: `start === 0`, so the separator at index 4
 *     is taken too, giving `/team fix this` rather than `/team  fix this`.
 *   - `/tea\nship it` span `[0, 4)`: the newline is taken with the token, so the
 *     command's own line collapses away instead of leaving a blank one.
 *   - `fix this /team ops` span `[9, 18)`, removed: the space at index 8 goes
 *     with the token, leaving `fix this` rather than `fix this `.
 */
export function replaceSpan(
	value: string,
	start: number,
	end: number,
	replacement: string,
): { text: string; caret: number } {
	let from = start;
	let to = end;
	const separator = (index: number) =>
		index >= 0 && index < value.length && " \t\n".includes(value[index]);
	if (replacement === "") {
		if (from > 0 && separator(from - 1)) from -= 1;
		else if (separator(to)) to += 1;
	} else if (from === 0 && separator(to)) {
		to += 1;
	}
	return {
		text: `${value.slice(0, from)}${replacement}${value.slice(to)}`,
		caret: from + replacement.length,
	};
}
