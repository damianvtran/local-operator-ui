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
 * Which row the action model is answering for.
 *
 * `answer` is the turn-closing assistant row the row was built for; `user` is
 * the reader's own turn, which offers Copy and nothing else (speaking the
 * reader's own message back is not an affordance the operator asked for, and
 * the speech engine synthesises agent-side text).
 */
export type ActionRowRole = "answer" | "user";

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
 * A USER TURN OFFERS COPY ALONE: the operator asked for a copy affordance on
 * their own messages, and Speak on a user row would read the reader's own words
 * back at them - the message surfaces speak what the AGENT said. The user arm
 * ignores `agentId` entirely rather than inferring a Speak from it, so a later
 * caller that threads an id through the user row cannot quietly re-enable a
 * control this ruling removes.
 *
 * The SECOND half of speech's gate - whether a speech credential is configured -
 * is deliberately NOT in this list. It is read by the control itself
 * (`useSpeakControl`, the one hook every speech surface renders through, whose
 * disabled sentence comes from the one copy table in `@shared/lib/speech-gate`)
 * and paints as a disabled button whose tooltip gives the reason. Collapsing the
 * two here would take the only route by which the sign-in sentence reaches the
 * reader.
 *
 * QUOTE IS DELIBERATELY ABSENT. Its trigger is the selection, `canonical-
 * transcript.tsx` enforces one subject per row, and a Quote button here would
 * be a second way to raise the one control - so the cap at two is not a
 * shortage of ideas but the scope ruling (memo (d)).
 */
export function answerActionsFor({
	role = "answer",
	agentId,
}: {
	role?: ActionRowRole;
	agentId?: string;
}): AnswerActionId[] {
	if (role === "user") return ["copy"];
	return agentId ? ["copy", "speak"] : ["copy"];
}

/**
 * The toolbar's accessible name. It names what the buttons act on, the way the
 * link toolbar's label does, because the buttons are icons.
 */
export const ANSWER_ACTIONS_LABEL = "Answer actions";

/** The user row's own label: the buttons act on the reader's message. */
export const USER_ACTIONS_LABEL = "Your message actions";

/**
 * The reveal treatment every action row wears at rest: invisible to the eye and
 * inert to the pointer, until the row it belongs to is hovered or holds focus -
 * with the touch exception, where a hover can never arrive and the row must
 * simply stay visible.
 *
 * NOT `inert`, AND THAT IS DELIBERATE (design round 1, D4 - the first comment
 * said "inert", the DOM is not). The row stays in the accessibility tree and in
 * the tab order at rest: `group-focus-within` reveals it the moment one of its
 * buttons takes focus, and that tab stop IS the keyboard reader's path to the
 * row. `inert` or `visibility: hidden` would delete the path along with the
 * flicker. What the rest state actually is: pointer-inert only.
 *
 * OPACITY ONLY, and that is the load-bearing half: the row keeps its place in
 * the layout in both states, so revealing it moves nothing. `pointer-events`
 * flips with it because an invisible button that still takes clicks is a
 * hidden control quietly acting on the reader; on touch the same exception
 * applies to both.
 *
 * `pinned` is the state half (loading, playing, copied): the reader's own
 * press must not fade out from under them, so the row graduates to plain
 * `opacity-100` and stops depending on the pointer. That plain value is also
 * NOT pointer-inert - unlike the rest set - and that is right here: the pinned
 * control is the Stop button and must stay clickable with the pointer parked
 * away (the sibling `composer-status-row.tsx` keeps its busy control
 * `pointer-events-none` because nothing there is clickable).
 */
export const ACTION_ROW_REVEAL_CLASSES =
	"pointer-events-none opacity-0 transition-opacity duration-fast ease-out-quart group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100";

/** The reveal classes for an action row, pinned open while its state owes the
 * reader a visible control. See {@link ACTION_ROW_REVEAL_CLASSES}. */
export function actionRowVisibility(pinned: boolean): string {
	return pinned ? "opacity-100" : ACTION_ROW_REVEAL_CLASSES;
}

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
