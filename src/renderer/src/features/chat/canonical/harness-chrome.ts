/**
 * Legacy harness-chrome recognition for user rows that carry no marker.
 *
 * THE MARKER IS PRIMARY; THIS IS THE FALLBACK BESIDE IT. A user row minted by
 * the harness is normally recognised structurally —
 * `provider_payload.harness_injected`, read in `transcript-reducer.ts` — but
 * rows written before that stamp existed carry nothing to read, and an owner
 * on an older build still sends them. The operator's stored transcript
 * (reported 2026-09-29) held ten goal-continuation rows with no marker, and
 * they painted as the user's own words. Core's contract names both halves
 * (`docs/DESKTOP_API.md`, "Harness-injected rows"): *"An owner on an older
 * build still sends these rows, which is why the marker (and the recogniser)
 * remain the contract."*
 *
 * WHAT THIS FILE IS, THEN: the desktop's copy of core's own recogniser legs
 * for the two goal families — `local_operator/harness/rows.py::is_harness_chrome`
 * adds these to its decision beside the exact-match list, and this mirrors
 * them, string for string:
 *
 * - `local_operator/session/goal_judge.py` — the goal judge's continuation,
 *   `GOAL_CONTINUATION_HEAD + goal + GOAL_CONTINUATION_TAIL`, recognised there
 *   by `is_goal_continuation_instruction`.
 * - `local_operator/session/goal_loop.py` — the loop's working turn
 *   (`LOOP_GOAL_PROMPT`) recognised by `is_loop_goal_instruction`, plus the
 *   loop's fixed self-continuation (`LOOP_PROMPT`), matched by equality.
 *
 * The renderer cannot import Python, so the strings are restated here, and the
 * tests (`scripts/transcript-reducer.test.mjs`, "Harness chrome on a user row")
 * spell the producers' texts out beside them: a drift on either side fails a
 * test rather than a frame.
 *
 * SEMANTICS ARE CORE'S, EXACTLY: strip, then fixed-head AND fixed-tail for the
 * interpolated families — never a substring search over the goal — and
 * equality for the fixed prompt. A message that merely OPENS with a head, or
 * quotes a template inside a sentence of its own, is the user's own words and
 * must paint; that inherent limit is `is_goal_continuation_instruction`'s own
 * and is shared here rather than re-decided.
 */

/** `goal_judge.GOAL_CONTINUATION_HEAD` — the judge continuation's fixed head. */
const GOAL_CONTINUATION_HEAD = "Continue working toward this goal:\n\n";

/** `goal_judge.GOAL_CONTINUATION_TAIL` — its fixed tail. */
const GOAL_CONTINUATION_TAIL =
	"\n\nMake concrete progress with the tools available, then state plainly " +
	"what advanced and what remains. If the goal is fully met, say so and stop.";

/** `goal_loop.LOOP_GOAL_PROMPT` — the loop's working turn: head + `{goal}` + tail. */
const LOOP_GOAL_PROMPT =
	"Work toward this goal:\n\n{goal}\n\n" +
	"Make concrete progress with the tools available, then briefly state what " +
	"advanced and what remains. If the goal is already fully met, say so plainly.";

/**
 * The fixed edges of `LOOP_GOAL_PROMPT`, DERIVED from the template rather than
 * restated — core's own discipline there (`LOOP_GOAL_HEAD, LOOP_GOAL_TAIL =
 * LOOP_GOAL_PROMPT.split("{goal}", 1)`), so an edit to the wording above
 * cannot leave the recogniser matching the old edges.
 */
const [LOOP_GOAL_HEAD = "", LOOP_GOAL_TAIL = ""] =
	LOOP_GOAL_PROMPT.split("{goal}");

/** `goal_loop.LOOP_PROMPT` — the loop's fixed self-continuation, matched by equality. */
const LOOP_PROMPT =
	"Continue working toward the standing goal. Make concrete progress with " +
	"the tools available, then briefly state what advanced and what remains. " +
	"If the goal is already fully met, say so plainly and stop.";

/**
 * Whether this text is one of the goal/loop chrome families, for a row with no
 * marker to read.
 *
 * Call it only where the marker read said no — both arms in
 * `transcript-reducer.ts` do — so the structural stamp stays primary and this
 * covers exactly the rows younger than it. `stripped` is compared once and
 * used for every test, mirroring core's single `stripped` before it dispatches
 * to the families: the hosts do not agree on what they hand in, so the strip
 * belongs to the decision rather than to a caller.
 */
export function isHarnessChromeText(text: string): boolean {
	const stripped = text.trim();
	return (
		stripped === LOOP_PROMPT ||
		(stripped.startsWith(GOAL_CONTINUATION_HEAD) &&
			stripped.endsWith(GOAL_CONTINUATION_TAIL)) ||
		(stripped.startsWith(LOOP_GOAL_HEAD.trim()) &&
			stripped.endsWith(LOOP_GOAL_TAIL.trim()))
	);
}
