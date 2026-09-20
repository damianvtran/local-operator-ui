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
import { SEPARATOR, pyTrim, pyTrimStart } from "./slash-token";

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

/*
 * THE SEPARATOR, THE STRIP AND THE LEADING-STRIP ALL COME FROM `slash-token`
 * (QA round 3, Q3-1). This file read `\s` — JavaScript's class, not the one the
 * TUI's `ch.isspace()` is — and the gap it left was user-visible: a draft whose
 * separator is one of Python's five extra characters (`/mcp logout<U+0085>srv`,
 * or the leading form) RUNS as a command while the highlighter painted no tint
 * for it. A command that executes with no colour affordance is not the refusal
 * class — nothing is refused and nothing goes to the wrong host — but it is the
 * same mistake one consumer over, so its count is measured and pinned rather
 * than argued about.
 */

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
 * Exported because the MIRROR needs it too, as the ORIGIN of what it paints:
 * the runs are computed within this line, and the painted layer then renders the
 * draft from this line's start to the end of the draft — the whole tail, not
 * this line alone, because the tokens it tints live in a `<textarea>` whose own
 * glyphs are transparent whenever a run exists, so a payload that stopped at
 * this line would blank every line the user typed after it
 * (`composer-highlight.tsx` carries that measurement).
 */
export function firstContentLine(draft: string): FirstContentLine | null {
	let lineStart = 0;
	while (lineStart <= draft.length) {
		const newline = draft.indexOf("\n", lineStart);
		const lineEnd = newline === -1 ? draft.length : newline;
		const line = draft.slice(lineStart, lineEnd);
		if (pyTrim(line) !== "") {
			return {
				start: lineStart + (line.length - pyTrimStart(line).length),
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
		if (SEPARATOR.test(text[index])) {
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
	/*
	 * The SPLIT is a literal space, which is the TUI's own partition — but the
	 * STRIP before the name is `pyTrimStart`, because the reference's `lstrip()` is
	 * Python's class (round 3's inventory: this was `trimStart()`, the last
	 * JavaScript-class strip outside the deliberate literal-space splits). A
	 * separator Python strips and JavaScript does not therefore moved the name's
	 * start by one cell, painting the name over a character that is not in it.
	 */
	const lead = argument.length - pyTrimStart(argument).length;
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

/**
 * The runs the composer will ACT on, given what Enter does with the draft.
 *
 * The run rule is the TUI's and is deliberately blind to the plan: it paints a word
 * that opens the line whether or not this host runs it. Two states make that a
 * claim the outcome contradicts, and both were measured on the branch that
 * installed the narrowing —
 *
 *  - a draft the planner SENDS as a message (`/compact hello`, and the operator's
 *    own single-line first line) wore the command tint while Enter posted it to the
 *    model (design D6 / UX U4 / QA Q4): `sendsAsWritten` drops every run, which
 *    also makes two line counts of the same prose agree, since the multi-line rule
 *    above already paints nothing;
 *  - an `unknown` word is documented as "inert text that WILL be sent", which is
 *    true only where the word is the whole line: a line of the form `/teem fix this`
 *    is neither sent nor run — the dispatcher answers "unknown command" and keeps
 *    the draft — so that run is narrowed to the bare case.
 *
 * Pure, and exported, because a gate on a React render is a gate nothing can pin:
 * the two predicates are asserted in `scripts/slash-highlight.test.mjs` rather than
 * left to a frame's pixels (review round 2 MINOR-1).
 */
export function runsMatchingPlan(
	runs: readonly SlashHighlightRun[],
	draft: string,
	input: { sendsAsWritten: boolean },
): SlashHighlightRun[] {
	if (input.sendsAsWritten) return [];
	return runs.filter(
		(run) =>
			run.kind !== "unknown" ||
			pyTrim(draft.slice(run.start, run.end)) === pyTrim(draft),
	);
}

/**
 * The ink each run takes, as ROLES rather than colours (`docs/branding.md`):
 * the theme decides what they are, and the twelve palettes each clear their own
 * contrast floor on the composer's `surface` ground.
 *
 *   - `command` → `text-token-command` + the painted weight step (`slash-run-bold`).
 *     The role is the desktop's counterpart of the TUI's `$lo-signal` (a dedicated
 *     cool role, NOT the accent), added after the design round measured that no
 *     shipped text role separates from both `ink` and `accent` in all twelve
 *     palettes. The weight step mirrors the TUI's `text-style: bold`, and in
 *     obsidian it is the whole channel (the pinned monochrome case in
 *     `palette-contract.ts`, where `tokenCommand` IS `ink`).
 *
 *     IT IS `-webkit-text-stroke`, NOT `font-weight`, and that is a correctness
 *     constraint rather than a style choice. The mirror is the layer that paints
 *     every glyph while the textarea's own text is transparent, so the mirror's
 *     line breaking MUST be the textarea's; a real weight change moves the
 *     advances and the two layers then wrap at different characters, which the
 *     composer's own `overflow: hidden` turns into a clipped tail — measured on
 *     this branch before the change: `/agent coder ` + 65 characters is 780.67px
 *     at weight 400 (one row, inside the field's 782px) and 782.77px with the
 *     command run at 600, so the mirror wrapped and swallowed **65 typed
 *     characters** (QA round 1 Q1; the causal proof was injecting
 *     `[data-slash-run]{font-weight:400}`, which collapsed the mirror back to the
 *     textarea's height). A stroke paints outside the glyph outline and changes no
 *     advance, so the weight step survives and the layout does not move — which is
 *     what the design round asked for in as many words ("keep the weight step … by
 *     whatever means does not move the line box").
 *
 *     STROKE WIDTH, from the design round's own measurement rather than from
 *     taste: it measured the command run's `t` stem at 4 device px against prose's
 *     3 at dsf 2, i.e. +1 device px = +0.5 CSS px, and a stroke of width W grows a
 *     stem by exactly W (W/2 on each side). `slash-run-bold` therefore declares
 *     0.5px — the same width on every raster, which is the point the round-3 D8
 *     measurement settles: half a device pixel of growth per side is the quiet
 *     step at 2x, and a floor that made it a whole device pixel at 1x doubled the
 *     run's stem instead and closed its counters. The geometry probe reports the
 *     computed stroke beside the run's weight so a palette or font change
 *     re-measures instead of assuming.
 *   - `name` → `text-success`. Mirroring the TUI's `$lo-string`, which borrows its
 *     green for exactly this job; the resolved argument must not collapse into
 *     the command word.
 *   - `unknown` → `text-ink-dim`. The UI's quietest legal ink: an inert word is a
 *     typo in progress, not an alarm, and `ink-dim` sits on the 4.5:1 floor.
 *
 * `text-accent` is deliberately not used for any of them — it is reserved for
 * "a turn is live" (the TUI states the same reservation), and a recognised command
 * word is structure, not activity.
 *
 * Lives here rather than in the component for the same reason the gate above does:
 * the DISABLED step is a behaviour a test has to be able to execute. The mirror's
 * container already steps to `text-ink-disabled`, but a descendant span wins, so a
 * field that cannot accept input painted an enabled-strength command word
 * (design round 1 D2 — measured ΔE00 0.8-1.5 against the enabled frame, i.e. no
 * step at all). Branding's rule is "disabled changes colour, never opacity".
 */
export const RUN_INK: Record<SlashHighlightRun["kind"], string> = {
	command: "text-token-command slash-run-bold",
	name: "text-success",
	unknown: "text-ink-dim",
};

/** The class a run takes in the state it is drawn in. */
export function runInkClass(
	kind: SlashHighlightRun["kind"],
	disabled: boolean,
): string {
	return disabled ? "text-ink-disabled" : RUN_INK[kind];
}
