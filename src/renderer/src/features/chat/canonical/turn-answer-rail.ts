/**
 * The turn-answer rail: the optional vertical mark on a turn's elected answer
 * (issue #665), and the pure rules that decide whether it is painted.
 *
 * WHY AN OPT-IN. The rail shipped always-on in #708 as a 2px `ink-dim` rule
 * with 6px of padding, and the operator's report was that it "looks ugly" and
 * "cramped". The answer is already identified without it (it is the row the
 * turn's foot line and action row hang off, and everything condensed sits in a
 * bar above), so the mark is now a preference: the backend registry key
 * `display.turn_answer_rail` (bool, default false), rendered generically by the
 * Backend settings page. Off is the default everywhere, including every backend
 * that has not declared the key yet.
 *
 * This module holds no React and no query, so the shipped rules can be bundled
 * and asserted by `scripts/turn-answer-rail.test.mjs` without a DOM.
 */

/** The registry key, spelled once for this surface. */
export const TURN_ANSWER_RAIL_KEY = "display.turn_answer_rail";

/**
 * FAIL-CLOSED read of the key from a `settings.list` payload. Only an explicit
 * boolean `true` turns the rail on: `value` is `unknown` on the wire, so a
 * string "true", `1`, an absent key (an older backend), a missing payload (an
 * unanswered or failed query, or a plane that does not advertise `settings`) all
 * resolve to off. The same rule `useCrossSessionHidden` applies to its key.
 */
export function turnAnswerRailEnabled(
	settings: ReadonlyArray<{ key: string; value?: unknown }> | null | undefined,
): boolean {
	return (
		settings?.find((entry) => entry.key === TURN_ANSWER_RAIL_KEY)?.value ===
		true
	);
}

/**
 * The classes the answer row wears.
 *
 * - An unmarked row is `w-full`, as it always was.
 * - The elected answer with the rail OFF is ALSO `w-full`: the same box as any
 *   other prose row, so toggling the setting never moves the text.
 * - The elected answer with the rail ON hangs a 1px `hairline` rule in the
 *   gutter. `-ml-[13px]` (the rule's 1px plus `pl-3`'s 12px) nets to zero, so
 *   the prose box is where it is with the rail off: no second left edge and no
 *   second measure. Auto width is load-bearing here: a block with a negative
 *   left margin and auto width grows LEFT by the margin and keeps its right
 *   edge, whereas `w-full` pins the width and the same margin would slide the
 *   box left and leave the prose short on the right (measured against #708:
 *   802px of an 810px row). The 12px gap is what #708's 6px lacked.
 *
 * `hairline` is the decorative-rule role (docs/branding.md section 2): the mark
 * carries no information the layout does not already carry, so it owes being
 * seen (the PERCEPTIBLE row in `scripts/contrast-contract.mjs`), not a 3:1
 * floor.
 */
export function turnAnswerMarkClass(
	closesTurn: boolean,
	railOn: boolean,
): string {
	if (closesTurn && railOn) return "-ml-[13px] border-hairline border-l pl-3";
	return "w-full";
}
