/**
 * Which spans of a draft are SYNTAX rather than prose, for the composer's
 * syntax highlight.
 *
 * A name-for-name port of `Editor._compute_slash_runs`
 * (`local_operator/tui/widgets/editor.py:4232-4359`), so the two hosts paint the
 * same tokens for the same reasons and can be diffed by name. Pure: no React,
 * no DOM, no I/O — the same shape as `slash-token.ts`, `slash-rank.ts` and
 * `slash-contract.ts`, which is what makes every row of the rule table
 * executable in `scripts/slash-highlight.test.mjs` on the code the app ships.
 *
 * WHY it exists at all, in the TUI's own words: the point is "legibility of
 * intent — the user sees which tokens are the recognized command and its
 * argument NAME (structure that will NOT be sent as message text) versus the
 * free-text tail that will". The composer is the one place where a `/word` is
 * ambiguous between a command about to run and the first word of a message, and
 * the operator asked for the TUI's answer on the desktop.
 *
 * THE RULE, in the order the TUI states it:
 *
 *   1. The command word is the leading `/`-token of the FIRST CONTENT LINE:
 *      blank lines before it are skipped, and the line's own leading
 *      indentation is not painted (`editor.py:4273-4286`).
 *   2. A word in the registry's vocabulary (`commandNames`, lower-cased
 *      primaries and aliases) is the `command` run. An unrecognised word is the
 *      `unknown` run, SUPPRESSED while the command list is still choosing —
 *      "a prefix under an open command list is in progress, not wrong"
 *      (`editor.py:4308-4322`).
 *   3. A newline after that line kills every run, because the buffer is then a
 *      message body and a stray command tint would contradict "this is prose" —
 *      EXCEPT for the NAME+message commands, which are DEFINED as
 *      `/<cmd> <name> <free-text message>` with a message expected to span
 *      lines, and which still dispatch across the newline
 *      (`editor.py:4303-4304`).
 *   4. For those commands only, the first whitespace token after the command
 *      word is the `name` run when it is an exact hit in the roster snapshot the
 *      caller already holds (`editor.py:4324-4358`). A half-typed name stays
 *      prose rather than flickering, and `/team chart` is the reserved
 *      two-level form whose first token is never a roster name
 *      (`editor.py:4352-4356`).
 *   5. The free-text tail — the instruction set — is NEVER painted. That is the
 *      half of the contrast the highlight exists for.
 *
 * WHAT IS DELIBERATELY ABSENT, stated rather than silently omitted: the TUI's
 * armed-`/credential` token (`editor.py:4256-4266`) has no counterpart here. The
 * desktop refuses `/credential` with arguments (`desktop_sessions.py:657-659`)
 * and presents it as a masked form, so there is no armed state for this builder
 * to paint. If that changes, it belongs here rather than in the render layer.
 *
 * Offsets are into `draft` itself (not line-relative, as the TUI's are), because
 * the mirror in `composer-highlight.tsx` slices the same string it hands the
 * textarea — one coordinate space, so a span cannot be painted one character off
 * by an indent somebody re-counted.
 */

/** One painted span of the draft. `kind` names a ROLE, never a colour. */
export type SlashHighlightRun = {
	start: number;
	end: number;
	/**
	 * `command`: a recognised command word. `name`: a recognised roster name
	 * after a NAME+message command. `unknown`: a leading slash word that names
	 * nothing, which is inert text that WILL be sent.
	 */
	kind: "command" | "name" | "unknown";
};

export type SlashHighlightArgs = {
	draft: string;
	/**
	 * Lower-cased primaries AND aliases, from the registry metadata — the same
	 * set the planner and the tokenizer take, so "recognised" cannot mean one
	 * thing to the highlight and another to Enter.
	 */
	commandNames: ReadonlySet<string>;
	/** Lower-cased words whose NAME is picked from a roster list. */
	nameListCommands: ReadonlySet<string>;
	/** Lower-cased team/agent names ALREADY IN HAND — never fetched here. */
	nameChoices: ReadonlySet<string>;
	/**
	 * Whether the command list is up and choosing. The `unknown` run is
	 * suppressed while it is: a word under an open list is a prefix in progress.
	 */
	picking: boolean;
};

/** Any whitespace, matching the TUI's `ch.isspace()` for the token split. */
const WHITESPACE = /\s/;

/** The reserved first argument of `/team`: `chart` is a subcommand, not a name. */
const RESERVED_TEAM_ARGUMENT = "chart";

/** The span of the first content line, in ABSOLUTE draft offsets. */
export type FirstContentLine = {
	/** Offset of the line's first non-whitespace character. */
	start: number;
	/** Offset of that line's end (its `\n`, or the end of the draft). */
	end: number;
};

/**
 * The first line of the draft that has content, or `null` for a draft that is
 * all whitespace.
 *
 * Exported because the MIRROR needs it too: the painted layer renders exactly
 * this line's characters (plus the newlines before it, so its y offset matches
 * the textarea's). Deriving it twice is how the two layers would come to
 * disagree about which line is being painted.
 */
export function firstContentLine(draft: string): FirstContentLine | null {
	let lineStart = 0;
	while (lineStart <= draft.length) {
		const newline = draft.indexOf("\n", lineStart);
		const lineEnd = newline === -1 ? draft.length : newline;
		const line = draft.slice(lineStart, lineEnd);
		if (line.trim() !== "") {
			return {
				start: lineStart + (line.length - line.trimStart().length),
				end: lineEnd,
			};
		}
		if (newline === -1) return null;
		lineStart = newline + 1;
	}
	return null;
}

export function slashHighlightRuns({
	draft,
	commandNames,
	nameListCommands,
	nameChoices,
	picking,
}: SlashHighlightArgs): SlashHighlightRun[] {
	const line = firstContentLine(draft);
	if (line === null) return [];
	// The line's own leading indentation is structurally part of the token's
	// position but never painted (`editor.py:4278-4282`).
	const text = draft.slice(line.start, line.end);
	if (!text.startsWith("/")) return [];

	/*
	 * The command token runs from the slash through the first whitespace, and the
	 * TUI's loop starts at index 1 (`i > 0`), so a slash followed immediately by a
	 * space yields the EMPTY word — which is `unknown`, not a command, and is
	 * suppressed while the list is open. Kept because it is what keeps `/ x` from
	 * matching anything.
	 */
	let wordEnd = text.length;
	for (let index = 1; index < text.length; index++) {
		if (WHITESPACE.test(text[index])) {
			wordEnd = index;
			break;
		}
	}
	const word = text.slice(1, wordEnd).toLowerCase();
	const commandStart = line.start;
	const commandEnd = line.start + wordEnd;

	/*
	 * Single-content-line discipline, identical to `slash-token.ts`'s
	 * `slash_context`: once a newline follows the command line the draft is a
	 * message body. The NAME+message commands are the exception the TUI states at
	 * length (`editor.py:4303-4304`), because their message is expected to span
	 * lines and the command on the first line still dispatches across them.
	 */
	const multiline = draft.length > line.end;
	if (multiline && !nameListCommands.has(word)) return [];

	const runs: SlashHighlightRun[] = [];
	if (commandNames.has(word)) {
		runs.push({ start: commandStart, end: commandEnd, kind: "command" });
	} else if (!picking) {
		runs.push({ start: commandStart, end: commandEnd, kind: "unknown" });
	}

	if (!nameListCommands.has(word)) return runs;

	/*
	 * The NAME token: the first literal-space-delimited token of the argument,
	 * read from the command line rather than through `slash_argument` — that
	 * helper is caret-anchored, so it would stop painting the name the moment the
	 * caret moved into the message (`editor.py:4330-4340`).
	 *
	 * The separator is a literal space and the offset is `commandEnd + 1`, which
	 * is the TUI's own arithmetic (`editor.py:4351-4356`). A tab between the word
	 * and the name therefore paints nothing rather than painting one cell off —
	 * the same behaviour the TUI has, and the reason the branch is stated here
	 * instead of being "fixed" into a divergence.
	 */
	const space = text.indexOf(" ");
	if (space === -1) return runs;
	const argument = text.slice(space + 1);
	const lead = argument.length - argument.trimStart().length;
	const name = argument.slice(lead).split(" ")[0];
	if (!name) return runs;
	const reserved =
		(word === "team" || word === "teams") &&
		name.toLowerCase() === RESERVED_TEAM_ARGUMENT;
	if (reserved || !nameChoices.has(name.toLowerCase())) return runs;
	const nameStart = commandEnd + 1 + lead;
	runs.push({ start: nameStart, end: nameStart + name.length, kind: "name" });
	return runs;
}
