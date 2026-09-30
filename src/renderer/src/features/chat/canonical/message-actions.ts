/**
 * The answer's action row: which actions it offers, and the constants the row
 * renders them with.
 *
 * A module of its own for `quote-model.ts`'s reason - "which rows offer which
 * control" is a rule with a right answer, and a frame can only show the row it
 * DOES paint, never its absence on the twenty record kinds that must not have
 * one. `scripts/message-actions.test.mjs` asserts the rule directly instead.
 */

export type AnswerActionId = "copy" | "speak";

/**
 * The row's actions, in order, and the cap that keeps it a row.
 *
 * COPY IS UNCONDITIONAL, because the row exists for it (issue #695: the
 * reporter went looking under the answer, found nothing, and fell back to a
 * slash command the desktop UI does not ship). Everything else on the row is
 * conditional, and copy is first so the anchor cannot be displaced by a later
 * action.
 *
 * SPEAK IS CONDITIONAL ON A RUNTIME FACT, and on only one: whether an agent id
 * resolves for this answer. The id is what the speech engine synthesises
 * against, so without it a Speak button could not do anything at all and the row
 * does not offer it - an affordance whose every press is a no-op is the defect
 * `quote-model.ts` already names for an empty body.
 *
 * The SECOND half of speech's gate - whether a speech credential is configured -
 * is deliberately NOT in this list. It is read by the button itself
 * (`useRadientCredentialProbe`, the same probe and the same two sentences
 * `text-selection-controls.tsx` uses) and paints as a disabled button whose
 * tooltip gives the reason. Collapsing the two here would take the only route
 * by which "sign in to Radient to enable text to speech" reaches the reader.
 *
 * QUOTE IS DELIBERATELY ABSENT. Its trigger is the selection, `canonical-
 * transcript.tsx` enforces one subject per row, and a Quote button here would
 * be a second way to raise the one control - so the cap at two is not a
 * shortage of ideas but the scope ruling (memo (d)).
 */
export function answerActionsFor({
	agentId,
}: {
	agentId?: string;
}): AnswerActionId[] {
	return agentId ? ["copy", "speak"] : ["copy"];
}

/**
 * The toolbar's accessible name. It names what the buttons act on, the way the
 * link toolbar's label does, because the buttons are icons.
 */
export const ANSWER_ACTIONS_LABEL = "Answer actions";

/**
 * How long the Copy button wears its `Copied` answer.
 *
 * The existing toolbars reset on the SUBJECT changing (`link-toolkit.tsx`), and
 * that rule cannot carry over: this button's subject is the answer under it,
 * which never changes while the row is mounted. Without its own timer the tick
 * would persist for the rest of the session and the row would claim a copy
 * that happened minutes ago. 2000 ms is the value three other copy controls in
 * this tree already use (`provider-detail.tsx`, `canvas-variables-viewer.tsx`,
 * the legacy `message-controls.tsx`); it is named here rather than typed at the
 * call site so the test pins the number the product uses.
 */
export const COPY_FEEDBACK_MS = 2000;
