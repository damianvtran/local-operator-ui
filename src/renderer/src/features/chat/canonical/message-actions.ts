/**
 * The answer's action row: which actions it offers, and the constants the row
 * renders them with.
 *
 * A module of its own for `quote-model.ts`'s reason - "which rows offer which
 * control" is a rule with a right answer, and a frame can only show the row it
 * DOES paint, never its absence on the twenty record kinds that must not have
 * one. `scripts/message-actions.test.mjs` asserts the rule directly instead.
 *
 * IT ALSO ANSWERS WHICH ROWS CAN BE FORKED FROM (`forkEntryId`), because that
 * is the same kind of question: "this message is a point a fork can be cut
 * at" is a fact about the RECORD, and the frame that shows a Fork button does
 * not show the tool row that must not have one.
 */

import type { TranscriptRecord } from "./transcript-reducer";

export type AnswerActionId = "copy" | "speak" | "fork";

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
 * be a second way to raise the one control.
 *
 * FORK IS CONDITIONAL ON A FACT ABOUT THE ROW, not on the turn's role: a fork
 * is cut through a named transcript entry, and only the two kinds this row is
 * ever mounted for carry one in `record.id` (see `forkEntryId`). It is the
 * caller's answer rather than something derived here for `linkToolbarModel`'s
 * reason - whether a row is a cut point is a fact about the SURFACE, and the
 * transcript is the only layer that knows which record it mounted for.
 *
 * FORK TAKES THE ROW'S FREE END, and that is the rule rather than "it keeps
 * the left edge". The row's own order is the anchor rule applied once more -
 * the actions before it are the cheapest, fixed presses (Copy, and Speak where
 * an agent resolves) - but the two arms are anchored differently, so "last"
 * lands on two different edges: the answer's line is left-anchored
 * (`canonical-transcript.tsx`'s foot line runs from the prose rail), where Fork
 * extends the row rightward and moves nothing; the user column is
 * `items-end`, where the row is right-anchored and an appended control takes
 * the anchored edge and shifts Copy and Speak left by one pitch. Both mount
 * sites put Fork at the row's free end and neither moves the answer's own
 * text.
 *
 * THE CAP THIS ROW ASKS TO EXCEED, named where it is written: the row's two-
 * action shape is pinned by its own test (`scripts/message-actions.test.mjs`,
 * "the row is capped at two actions"), whose stated grounds are the line's
 * width and the slot #694 was reserving. #694's overflow home has since shipped
 * as the sidebar row context menu (Archive / Pin / Fork), and the only cap
 * carrying an explicit number is that menu's - "two at most, pushing it three"
 * (#694 / #739) - so three inline controls on this row is the number the
 * repository actually states, not a raised one. The three is also the surface
 * budget's ceiling: a fourth goes behind an overflow rather than into the row.
 *
 * WHAT IT DOES NOT COVER, declared rather than implied: the row is mounted only
 * under `isQuotable` (both mount sites in `canonical-transcript.tsx`), so a
 * message with no words at all - an image-only user turn, an answer whose whole
 * body is reply markup - offers no Fork even though it is a committed journal
 * entry and a legal cut point. That is the cost of riding the copy row, and it
 * is recorded here so the next reader meets it as a decision rather than as a
 * gap.
 */
export function answerActionsFor({
	role = "answer",
	agentId,
	forkable = false,
}: {
	role?: ActionRowRole;
	agentId?: string;
	/**
	 * Whether this row's message is a point a fork can be cut at - the answer
	 * `forkEntryId` gives the transcript for the record it is drawing.
	 */
	forkable?: boolean;
}): AnswerActionId[] {
	/*
	 * Spread rather than a trailing conditional so the two arms read identically
	 * and a fourth conditional cannot be added to one of them alone.
	 */
	const fork: AnswerActionId[] = forkable ? ["fork"] : [];
	if (role === "user") return ["copy", ...fork];
	return agentId ? ["copy", "speak", ...fork] : ["copy", ...fork];
}

/**
 * The transcript entry a Fork on this row would branch from, or `null` when
 * this row has none to name.
 *
 * THE ROW'S ID IS THE JOURNAL ENTRY ID on exactly the two kinds the action row
 * is ever mounted for, which is what makes the control possible at all:
 * `transcript-reducer.ts` takes a user row's id from the entry envelope
 * (`durableRecord`, `kind: "user"`) and an assistant row's the same way, while
 * a tool row's is `tool:<tool_call_id>`. A tool-row id sent as a cut point is
 * refused by the core (`has_entry` answers no for it), so the rule is stated
 * here rather than left to the mount site to get right.
 *
 * A STREAMING ANSWER IS NOT A CUT POINT. Its id is the live row's, and the
 * core's entry is only the durable row's: the settled twin carries the same id
 * but the commit is what puts it in the journal. This is `isQuotable`'s
 * settledness rule read for a second reason, and it is repeated rather than
 * inherited because the gate that mounts the row can change without this rule
 * being re-read.
 *
 * DELIBERATELY NOT GATED on `local`/`provisional`. A user row that is still the
 * optimistic echo carries the ADMISSION REQUEST ID, and the owner's durable row
 * coalesces onto that same id (`use-canonical-session.ts` appends the echo with
 * `entry.id`) - so the id is a real cut point the moment the message commits,
 * and until then the picker's own refusal sentence is the honest answer rather
 * than a control that flickers in a moment later.
 */
export function forkEntryId(record: TranscriptRecord): string | null {
	if (record.kind !== "user" && record.kind !== "assistant") return null;
	if (record.kind === "assistant" && record.streaming) return null;
	return record.id || null;
}

/**
 * How much of the chosen message the fork flow repeats back to the reader.
 *
 * WHY THE FLOW HAS TO SAY WHICH MESSAGE AT ALL: the control is a hover-revealed
 * row and the picker is a modal over the transcript, so by the time the reader
 * can check the cut point the row it names is covered. "The message you chose"
 * is therefore a phrase with no referent on screen - the irreversible-ish step
 * has to be checkable BEFORE it is taken, and only an excerpt of the row's own
 * words does that.
 *
 * A plain clamp rather than a middle-elide: the opening words are what
 * identifies a message to its author, which is the same reasoning
 * `missingNote` states for keeping a path's basename. Whitespace is collapsed
 * so a message that opens with a fenced block or a wrapped line does not spend
 * the budget on newlines.
 */
export const FORK_EXCERPT_MAX_CHARS = 96;

export function forkExcerpt(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= FORK_EXCERPT_MAX_CHARS) return flat;
	return `${flat.slice(0, FORK_EXCERPT_MAX_CHARS - 1).trimEnd()}\u2026`;
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
