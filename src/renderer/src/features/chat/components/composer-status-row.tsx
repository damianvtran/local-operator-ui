/**
 * The composer's status row: the session's standing goal, and the size of the
 * run's plan, and the session's armed wake schedules (`docs/composer-status-tabs.md`,
 * `docs/composer-wakes.md`).
 *
 * One line, immediately above the composer box and OUTSIDE it. The placement is
 * the send-error alert's own recorded argument rather than a new one
 * (`message-input.tsx`'s docblock at the alert): the composer box is one control
 * with one focus ring (`COMPOSER_BOX`), and folding non-interactive prose and
 * two more controls into it would put them inside the frame that ring draws.
 * Out here the box's own measured geometry does not move at all — the box only
 * shifts up by this row's height, which is the property the frames assert.
 *
 * The three COUNT chips join them, and they are the same species as the plan
 * chip rather than a third thing:
 *
 * - the SUBAGENTS chip counts the roster — the children this session has
 *   delegated to and not yet finished with — and the JOBS chip counts the tool
 *   rows (`bash`) the roster deliberately leaves out. Both are buttons on the
 *   plan chip's own control box, both REVEAL their section of the pane, and both
 *   are gated on there being something to count (`docs/composer-activity-chips.md`,
 *   which is the design record and where the rejected alternatives live).
 * - the WAKE chip counts the session's ARMED wake schedules and opens the pane at
 *   its Wakes section (`docs/composer-wakes.md`). It is the one thing on this row
 *   about the FUTURE rather than about work in flight or persisted state: a wake
 *   fires with no keystroke, and without this the only place a session's autonomy
 *   was visible was the delivery row after it had already happened.
 * - the subagents and jobs chips lead with a STATE MARK instead of the `Info`
 *   glyph, and that is the row's one piece of motion: `SubagentStateIcon` spins a
 *   running row and nothing else, so a chip moves exactly while the work it names
 *   is moving. The wake chip leads with `AlarmClock`, which is a mark and not a
 *   state. `Info` stays the plan chip's mark so one glyph in this row still means
 *   one thing.
 * - the count gate is the POINT rather than an optimisation: unlike the plan's
 *   `0 to-dos open`, these answers are not about persisted state —
 *   `frontend.jobs` is swept minutes after a row settles, so a lingering
 *   `0 subagents running` would describe rows that are about to vanish, and it
 *   would put a chip above every composer on every session that never delegated.
 *   The wake chip's gate is the same rule for its own reason: `frontend.wakes` is
 *   empty on every session that has never armed a wake, which is nearly all of
 *   them, so `0 wakes armed` would be a line of chrome above nearly every composer
 *   in the app.
 *
 * Two controls, one species, and neither is a tab:
 *
 * - the GOAL is the app's one disclosure idiom (`@shared/components/ui/disclosure`),
 *   collapsing to `Goal: <a CSS-truncated snippet>` and expanding in place to
 *   the goal in full. Its expansion is this component's own state, never
 *   persisted and never restored: `branding.md`'s disclosure rule is "closed by
 *   default", and restoring an open body on launch is the vertical cost the
 *   whole row exists to avoid. It resets per conversation by being KEYED on the
 *   conversation at its one call site (`message-input.tsx`) — the composer is
 *   not remounted on a session switch, so a goal expanded in one conversation
 *   would otherwise arrive expanded in the next.
 * - the PLAN is a plain button that REVEALS rather than toggles: it opens the
 *   run pane at its To-dos section and leaves focus where it is. It carries no
 *   `aria-pressed` and no pressed ground, because a control that closed the pane
 *   when pressed while looking for the plan is the "one control, two meanings"
 *   defect this codebase's review history keeps catching. It carries the header
 *   trigger's own `Info` mark for the same reason the trigger carries it: one
 *   glyph should mean "this opens the run pane" on both surfaces, and the count
 *   alone was plain muted text a reader had no way to tell from prose (design
 *   review round 1, D1 — the choice and the rejected alternatives are argued at
 *   the mark's own site below).
 *
 * Both are gated on a VALUE, never on a session: a session with no goal, a fresh
 * draft, and a legacy non-canonical chat all take the same branch and render
 * NOTHING — not an empty 24px box above every composer in the app. And nothing
 * here counts anything: the plan's number is `RunDetails.openTodos`, and the two
 * activity numbers are `openChildren`/`openJobs`, all off the one derivation
 * `chat-page.tsx` already makes for the pane and the header trigger, spelled by
 * the model's own clauses.
 *
 * A SIXTH chip and two DISMISS controls (this change, `docs/composer-status-tabs.md`
 * § 12-13):
 *
 * - the LOOP chip states the session's loop — the one wire field whose value can be
 *   `running` — and it is gated on a state that is not `idle`. It is the row's one
 *   chip that is not a control (a readout in the readings' INERT box), because the
 *   only thing this row can do with a loop is stop or clear it.
 * - each of the goal and the loop carries a trailing DISMISS control: an `X` and a
 *   word (`Clear goal`, `Stop loop`, `Clear loop`), holding its box at rest and
 *   revealed on hover and on keyboard focus, which is the repo's existing
 *   hover-revealed-dismiss pattern (`canvas-tabs.tsx`, `directory-indicator.tsx`)
 *   rather than a new one. Both sit at the trailing edge of the WORDS they act on,
 *   inside the trigger's own line (the disclosure's `trailing` slot), never at the
 *   flex item's edge — § 12.3 records the measurement that ruled the other
 *   arrangement out.
 *
 * The two controls are the row's only actions that take a value AWAY, and the
 * commands they send are `pickers/session-commands.ts`'s own spellings — `goal
 * clear` and `loop stop`, the forms every released backend already honours. A
 * refusal, and the goal's one press that cannot be taken back, are the two
 * outcomes that need a voice; both go to the app's toast channel.
 *
 * The SETTLED loop's `Clear loop` sends NOTHING, and that is a decision rather than
 * an omission: no released backend has a spelling that clears a settled loop's
 * state (only the companion's `loop --clear` would, and a backend that does not
 * know that flag STARTS a loop toward the literal `--clear` — measured; see
 * `docs/composer-status-tabs.md` § 12.4). So the row acknowledges the settled state
 * itself and leaves the wire untouched (§ 13.4).
 */

import { Tooltip } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { AlarmClock, Info, Repeat, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DesktopLoopState } from "../../../../../shared/desktop-control-contract";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { CAPPED_BLOCK, CHAT_MEASURE } from "../chat-measure";
import {
	GOAL_CLEAR_ARGS,
	LOOP_STOP_ARGS,
	loopIsRunning,
} from "../pickers/session-commands";
import { useSessionCommand } from "../pickers/use-picker-backend";
import {
	READING_BUTTON as CHIP_CONTROL,
	READING_LABEL as CHIP_READOUT,
} from "../session-status/session-status-strip";
import {
	type ActivityTally,
	LABEL_SEAM,
	type RunDetails,
	activityTally,
	busiestClause,
	childClause,
	jobClause,
	todoClause,
	wakeClause,
} from "./run-details";
import { SubagentStateIcon } from "./run-details/run-detail-row-parts";

/**
 * The goal's visible label: the picker's own field label
 * (`destination-pickers.tsx`'s `Goal:`), not its title (`Session goal`) and not
 * its prose heading (`The standing goal`). A 24px chip carries a label; the
 * disambiguating word is what the accessible name is for.
 */
const GOAL_LABEL = "Goal:";

/** How the goal is NAMED, where there is room for the word a chip cannot carry. */
const GOAL_NAME = "the session goal";

/** The plan chip's action, leading its tooltip and its accessible name. */
const PLAN_ACTION = "Open the plan in run details";

/**
 * The subagents chip's action, and the jobs chip's.
 *
 * The plural is the SECTION's own heading in the pane (`Subagents`, `Jobs`), so
 * the chip names the destination in the same word the destination is labelled
 * with — `Open the plan in run details`' rule, one section over. `Open` rather
 * than `Show` for the same reason as the plan chip's.
 */
const SUBAGENT_ACTION = "Open the subagents in run details";
const JOB_ACTION = "Open the jobs in run details";

/**
 * The wake chip's action, on the same rule as the three above it.
 *
 * The plural is the SECTION's own heading in the pane (`Wakes`), so the chip names
 * the destination in the word the destination is labelled with. `Open` rather than
 * `Show` for the plan chip's own reason: this moves the reader to a region rather
 * than disclosing something in place.
 */
const WAKE_ACTION = "Open the wakes in run details";

/**
 * The LOOP chip's visible label, on the goal chip's own rule: the row's chips that
 * state a fact lead with the fact's name and a colon, and the disambiguating word
 * (`the session's loop`) is what the accessible names below carry.
 */
const LOOP_LABEL = "Loop:";

/**
 * The four words the row's two DISMISS controls print, and the one thing on this
 * row that takes a value away rather than showing one.
 *
 * They are the controls' own visible text and the head of their accessible names,
 * so the word a person reads and the word a screen reader announces are the same
 * word — the `Clear goal` label is short enough for a 24px row and is what the
 * operator asked for; `Clear the session goal` is the disambiguating phrase the
 * goal chip's own name already spends, and the dismiss spends its name on the
 * VALUE instead (see `goalClearLabel`).
 *
 * `Stop` and `Clear` are the two verbs the loop's own states earn (a moving loop is
 * STOPPED, a settled one is CLEARED) and the picker's own word for the running case
 * (`Cancel loop` there, on a 320px dialog's primary-size button — a chip is not
 * that control and does not borrow its wording).
 */
const GOAL_CLEAR_TEXT = "Clear goal";
const LOOP_STOP_TEXT = "Stop loop";
const LOOP_CLEAR_TEXT = "Clear loop";

/**
 * The two owner commands the dismiss controls run.
 *
 * Spelled here as literals rather than built from the control's own word: the
 * command surface is the backend's API and a label is copy, so a copy change must
 * not be able to move the command it runs. The VALUE each command takes is the
 * shared one (`pickers/session-commands.ts`), because the pickers send these same
 * two operations and one app may not spell one operation two ways.
 */
const GOAL_COMMAND = "goal";
const LOOP_COMMAND = "loop";

/**
 * The sentences a FAILED press speaks, in the control's own words rather than in
 * slash-command vocabulary the person never typed.
 *
 * The user pressed `Clear goal`; they did not type `/goal`, and a toast reading
 * `/goal did not run: …` names a surface they were never at (UX round 1, U2). The
 * prefix is therefore the control's own verb and object, and the reason after the
 * colon is still the owner's own sentence (`use-picker-backend.ts`), so the row
 * paraphrases nothing it is reporting.
 */
const GOAL_CLEAR_FAILURE = "Could not clear the goal";
const LOOP_STOP_FAILURE = "Could not stop the loop";
const LOOP_CLEAR_FAILURE = "Could not clear the loop";
const GOAL_UNDO_FAILURE = "Could not restore the goal";

/**
 * The confirmation a cleared goal speaks, and the one press that takes it back.
 *
 * Clearing the goal is IRREVERSIBLE from this row (UX round 1, U1): the dismissed
 * text is the user's own prose, no other surface carries it once the wire is empty,
 * and the operator asked for a subtle hover affordance rather than for a press that
 * loses work. The chips hold the answer in the channel they already speak — the
 * app's toast channel — with an `Undo` that restores the cleared text through the
 * same command channel, `goal <text>` being a spelling every released backend
 * honours.
 */
const GOAL_CLEARED_TEXT = "Goal cleared";
const GOAL_UNDO_TEXT = "Undo";

/**
 * The clamp on a dismiss's tooltip, which repeats the value it is about to throw
 * away (design review round 1, D7).
 *
 * `line-clamp-4` rather than a shorter string, deliberately: the control's
 * accessible NAME still carries the whole value (`goalClearLabel`), so a screen
 * reader is told what the press will lose at every width, and what is clamped is
 * only the panel a pointer sees — the 14-line panel over the composer that the
 * review measured at the app's floor, wider than the column it is drawn in.
 */
const TOOLTIP_CLAMP = "line-clamp-4";

/**
 * A dismiss's DISABLED state: the ink steps down, and the hover ground goes with
 * it.
 *
 * `branding.md` § 6 for the first half — a disabled control STEPS COLOUR to
 * `ink-disabled` rather than fading, because a faded control still meets its
 * contrast floor and therefore does not read as disabled. The second half is the
 * other direction of the same rule: a control that cannot be pressed must not
 * paint the ground it paints when it can, or the hover is a lie about a control
 * that is not listening. `disabled:hover:` is spelled out rather than left to the
 * shared `hover:bg-accent-wash` in `CHIP_CONTROL`, because that class is a single
 * utility on one element and would otherwise still apply while disabled.
 */
const DISMISS_DISABLED = cn(
	"disabled:text-ink-disabled disabled:cursor-default",
	"disabled:hover:bg-transparent disabled:hover:text-ink-disabled",
);

/**
 * One settled loop's IDENTITY — what a settled dismiss acknowledged, and how the
 * NEXT loop is told apart from it (§ 13.4).
 *
 * The whole visible state and not just the status: two consecutive `achieved`
 * loops of the same length are two different things to the person who ran them,
 * and a memory keyed on the status alone would hide the second one's chip as if
 * they had already dismissed it.
 */
const loopSignature = (loop: DesktopLoopState): string =>
	[loop.status, loop.completed, loop.iterations ?? "", loop.goal ?? ""].join(
		"|",
	);

/**
 * The reveal, which is the repo's own device for a control that appears on hover
 * and is not allowed to exist only for pointer users.
 *
 * Three properties, each of them a decision:
 *
 * - `pointer-events-none ... opacity-0` rather than `hidden`, so the control
 *   keeps its BOX. A dismiss that appeared by taking up space would move the
 *   chip's snippet under the pointer on every hover, and the row's rule is that
 *   hover is a colour step and nothing else (`branding.md` § 5). `canvas-tabs.tsx`
 *   and `directory-indicator.tsx` make the same call for their own trailing
 *   controls; this is that pattern, not a new one.
 * - `group-focus-within`, not `group-hover` alone, or the control would exist only
 *   for pointer users — the affordance is keyboard-reachable, and taking focus on
 *   the chip is what reveals it. **Not optional**: a hover-only control is
 *   unusable by keyboard (WCAG 2.1.1).
 * - NO transition. The two existing hover-revealed dismisses reveal instantly and
 *   the row's chips transition colour only, so a fade here would be a new motion
 *   on the row (`branding.md` § 5 caps durations but nothing is animating here to
 *   cap).
 */
const DISMISS_REVEAL = cn(
	"pointer-events-none opacity-0",
	"group-hover:pointer-events-auto group-hover:opacity-100",
	"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
);

/**
 * The piece of COPY that yields at and below the row's stacked band, whatever it is
 * attached to.
 *
 * One constant for the two places that use it, because they are one rule: the
 * dismiss's word (`Clear goal`) and the loop chip's progress (`2 of 5 turns`) are
 * both the part of their control that a 156px column cannot carry, and both keep a
 * second home at every width — the dismiss's word is in its accessible name, and the
 * progress is in the loop dismiss's (`loopActionLabel`). What does NOT yield is the
 * half that identifies the control at all: the `X`, and the wire's status word.
 *
 * Measured, and this is the number that made it a rule rather than a preference: with
 * the full clause at the 172px floor the row measured `overflowX 44px` — a chip that
 * cannot wrap is a chip that paints past its column, which every frame in
 * `docs/evidence/chat-composer-status-row/` asserts is 0.
 */
const NARROW_HIDDEN = "@max-[240px]/chatcol:hidden";

/**
 * The dismiss's visible word, DROPPED at and below the row's stacked band.
 *
 * The word is part of the affordance and is carried in the accessible name at
 * every width, but the box it occupies is real: at the 172px column floor the row
 * is stacked (`COLUMN_GOAL`), the goal item takes the row's whole 156px content
 * box, and `Clear goal` beside the chip's own ~75px of fixed ink leaves the
 * snippet no room at all. The X is the affordance's irreducible part and the word
 * is what yields — the row's own yield order (an unbounded value yields, a bounded
 * count never does) applied one step further out, and measured in the frames
 * (`docs/evidence/chat-composer-status-row/column-floor/`).
 */
const DISMISS_WORD = NARROW_HIDDEN;

/**
 * The row's first-chip rule, owned by the ROW.
 *
 * Whichever chip renders first cancels its own 6px padding, so the thing that
 * lands on the row's content edge is the chip's INK rather than its box — the
 * device § 2.2 records for the goal chip, which is where the alert's own first
 * character sits. It used to live on the goal chip alone, and the two states the
 * row can be in therefore disagreed about where the row starts: with the goal
 * showing, its chevron box sat at x=34 (box edge, padding cancelled) while the
 * plan chip alone put its TEXT at x=47 (box at the content edge, `READING_BUTTON`'s
 * padding intact) — a 6px difference invisible at rest and obvious the moment a
 * hover ground paints the box edge (design review round 1, D5). The rule is the
 * row's because the row is what has a first slot; a chip cannot know whether it
 * is first.
 *
 * The rule is now ORDINAL rather than a single boolean, and it had to become so:
 * with four possible chips there are four states of "which one is first", every
 * chip's gate is independent of every other's, and a rule written as "the goal is
 * showing or not" would put two chips' ink in the same 6px column the moment a
 * session with no goal had both an activity chip and a plan (`composer-activity-chips.md`
 * § 3). The row asks each chip whether IT is the first rendered one; a chip does
 * not ask about the others.
 */
const FIRST_CHIP = "-ml-1.5";

/**
 * At and below this much column, the row stacks.
 *
 * `CHAT_CHIP_ICON_ONLY_PX`'s number, reused rather than a second threshold for
 * the same moment: it is where the composer's chrome stops sharing one line, and
 * reusing it keeps the two rules in step.
 *
 * The switch is for the EXPANDED body, not the collapsed row. Stacked, the goal
 * item takes the row's own width, so the body measures the row less its 20px
 * indent (~184px at the 220px column floor) instead of the row less a ~134px
 * count chip — which is below the 160px floor the design sets. It costs 26px of
 * collapsed height, paid only in the width band where the readings cluster
 * already folds onto two lines of its own.
 *
 * `flex-none` is load-bearing and not decoration: the item is `flex-1`, and in a
 * COLUMN container `flex-basis: 0%` applies to the HEIGHT, where a growable item
 * in an auto-height row can collapse the very content this switch exists to make
 * readable. `w-full` replaces the main-axis share the item loses, and the
 * count chip stays content-sized because the row aligns its items to the start.
 */
const COLUMN_GOAL =
	"@max-[240px]/chatcol:w-full @max-[240px]/chatcol:flex-none";

/**
 * The goal disclosure's tooltip and accessible name, for one state.
 *
 * ONE derived string for both, so the two cannot drift — the pattern
 * `runDetailTriggerLabel` sets. The action leads and the value follows, joined by
 * the model's own `LABEL_SEAM`: `Expand the session goal — <the goal, in full>`.
 *
 * The value is in HERE as well as in the body, and neither is redundant. The
 * collapsed snippet truncates, and the app's rule is that an unbounded value may
 * truncate only where its full text has a second home (`session-status-strip.tsx`
 * states it for the model name, the one other item on this composer whose length
 * is unbounded); the tooltip is that home before the click, and the body is the
 * home after it.
 */
export const goalDisclosureLabel = (goal: string, expanded: boolean): string =>
	`${expanded ? "Collapse" : "Expand"} ${GOAL_NAME}${LABEL_SEAM}${goal}`;

/**
 * The plan chip's tooltip and accessible name.
 *
 * The count is `todoClause`'s spelling, from the same function the header
 * trigger's tooltip uses, so the two surfaces a user reads in one glance cannot
 * state the number two ways.
 *
 * It takes the COUNTS rather than the numeral for the reason that function's own
 * docblock records: the settled copy is not a function of the open count alone,
 * and a chip reading `All to-dos resolved` while its accessible name announced
 * `0 to-dos open` is exactly the drift this pattern exists to make
 * unrepresentable — the label cannot be built from a number this component was
 * never told whether anything was dropped beside.
 */
export const planChipLabel = (
	details: Pick<RunDetails, "openTodos" | "droppedTodos">,
): string => `${PLAN_ACTION}${LABEL_SEAM}${todoClause(details)}`;

/**
 * The two activity chips' tooltip and accessible name, one derived string each
 * for the reason `planChipLabel` gives: the spoken name and the tooltip cannot
 * drift when they are one function's output.
 *
 * The count and the state come from the model's own clause — `childClause` and
 * `jobClause` over the same `ActivityTally` the chip's mark is drawn from, and
 * the same two functions the header trigger's tooltip prints — so the trigger
 * above this row and the chips in it cannot state one number two ways, and
 * neither can state a state the glyph denies (design round 1, D1).
 */
export const subagentChipLabel = (tally: ActivityTally): string =>
	`${SUBAGENT_ACTION}${LABEL_SEAM}${childClause(tally)}${busiestClause(tally)}`;

export const jobChipLabel = (tally: ActivityTally): string =>
	`${JOB_ACTION}${LABEL_SEAM}${jobClause(tally)}${busiestClause(tally)}`;

/**
 * Whether the row owes the composer its focus back.
 *
 * UX round 1's U1 is the hazard and agent review round 2's m2 is the case the
 * first fix could not see. The predicate is about the node that HAD focus, never
 * about how many chips the row draws: a count compares the shape of the row, so a
 * same-count swap — the polled `frontend.jobs` settling a running row while a
 * child starts, 1 -> 1 — unmounts the focused control and drops focus to `<body>`
 * with nothing changed for a count to notice. A detached node says it directly.
 *
 * `rowHoldsFocus` is the second half and it is what keeps this from being
 * unconditional: when the row still holds focus the user is on another control in
 * it, and moving them to the composer would be the same defect pointing the other
 * way. Both inputs are facts the effect reads from the DOM, which is why they are
 * the parameters: the truth table is testable without a renderer, and
 * `composer-tabs.test.mjs` drives the real component through jsdom for the halves
 * a predicate cannot prove.
 */
export const shouldRestoreComposerFocus = (
	previouslyFocused: { isConnected: boolean } | null,
	rowHoldsFocus: boolean,
): boolean =>
	previouslyFocused !== null &&
	!previouslyFocused.isConnected &&
	!rowHoldsFocus;

/**
 * The wake chip's tooltip and accessible name: ONE derived string, for
 * `planChipLabel`'s reason.
 *
 * The count is `wakeClause`'s spelling and the same function the Wakes section's
 * trailing tally prints, so the chip and the section it opens cannot state one
 * number two ways — including the singular, which is the one a hand-written plural
 * gets wrong.
 */
export const wakeChipLabel = (armed: number): string =>
	`${WAKE_ACTION}${LABEL_SEAM}${wakeClause(armed)}`;

/**
 * The goal dismiss's tooltip and accessible name: ONE derived string for both, on
 * the rule the four chips above it are named under.
 *
 * The action leads and the value follows, joined by the model's own `LABEL_SEAM` —
 * and here the action is the control's own printed word, `Clear goal`, so the name
 * CONTAINS the visible label rather than paraphrasing it (WCAG 2.5.3, which the
 * chips satisfy by stating the value their own visible text also carries).
 *
 * The value is the goal IN FULL, and that is this string's whole job: the chip's
 * snippet truncates, so the one press that throws the value away must say what it
 * throws away before it is pressed. It repeats the disclosure's tooltip on purpose
 * — the two controls sit on one line and are read together, and a second, shorter
 * home for one value is how two controls come to describe one goal differently.
 */
export const goalClearLabel = (goal: string): string =>
	`${GOAL_CLEAR_TEXT}${LABEL_SEAM}${goal}`;

/**
 * Whether the wire's loop is MOVING, which is the whole of the loop's affordance
 * rule (see `loopAffordance`).
 *
 * The two words are the wire's own (`DesktopLoopState.status`) and the picker's
 * `running` predicate verbatim (`destination-pickers.tsx`'s `LoopPicker`), so the
 * row and the dialog cannot disagree about whether a loop can be stopped. Anything
 * that is not one of the two is read as SETTLED, and the boundary is stated rather
 * than assumed: a status this build cannot read (`interrupted`, `failed` and the
 * rest of the wire's set are all real settled states) is not claimed to be moving,
 * and clearing a settled loop is the command that is safe on a state the row does
 * not recognise — the alternative, offering `Stop` on an unreadable status, offers
 * a control whose claim the row cannot check.
 */
/**
 * Whether the wire's loop is MOVING, imported from the module the pickers read it
 * from too — ONE truth table for the row and the `/loop` dialog (§ 13.4), and the
 * reason it is not defined here: a picker importing it out of a component module
 * would make the dialog depend on the row it sits above.
 */
export { loopIsRunning };

/**
 * The loop chip's clause: the wire's own status word, plus the progress the wire
 * actually carries.
 *
 * The status WORD is printed as the wire spells it (`running`, `judging`,
 * `achieved`, `failed`), which is the one vocabulary the app already has for a
 * loop: the picker's own status row prints the same token, and a second, prettier
 * word here would be a second vocabulary for one fact — the defect
 * `wakeClause`'s docblock refuses one surface over.
 *
 * The progress is appended only where the wire has a TARGET to measure against
 * (`iterations`, set by a count loop and absent on a goal loop), where the number
 * is a fraction of something; a goal loop's turn count is a count of turns and is
 * stated as one. And it is appended only while the loop is TURNING: `judging`
 * prints its own word with no figure, because the judge is deciding the turn that
 * just ended and `completed` has already moved — a count beside that word is a
 * number the reader cannot date.
 *
 * The two halves are exported SEPARATELY as well as together, and that is the
 * narrowest column's doing rather than a tidiness pass: the chip renders them as two
 * nodes so the progress can yield at the stacked band while the status word stays
 * (`NARROW_HIDDEN`). One string could not shed half of itself — tried, and the row
 * measured `overflowX 44px` at the 172px floor.
 */
export const loopClause = (loop: DesktopLoopState): string =>
	`${loopStatusWord(loop)}${loopProgress(loop)}`;

/**
 * The clause's FIRST half: the wire's own status word, which never yields.
 *
 * Split out from the progress because the two have different widths and the
 * narrowest column can only carry one of them (`NARROW_HIDDEN`): a chip that simply
 * printed one long string could not shed half of it, and would paint past the
 * column instead (measured: `overflowX 44px` at the 172px floor).
 */
export const loopStatusWord = (loop: DesktopLoopState): string => loop.status;

/**
 * The clause's SECOND half: the progress, or the empty string where the wire has
 * none to state.
 *
 * `, ` rather than `LABEL_SEAM`'s em dash, which is the row's own clause grammar
 * (`busiestClause` joins its state the same way) — the status and its progress are
 * one clause about one thing, not an action and its value.
 */
export const loopProgress = (loop: DesktopLoopState): string => {
	if (loop.status !== "running") return "";
	if (loop.iterations) {
		return `, ${loop.completed} of ${loop.iterations} turns`;
	}
	return `, ${loop.completed} ${loop.completed === 1 ? "turn" : "turns"}`;
};

/**
 * The loop's affordance, as the pair the control needs: the WORD it prints and the
 * ARGUMENT its command is run with.
 *
 * One function for both halves rather than two predicates, because the word and the
 * command are one decision — a second derivation could print `Stop loop` and clear
 * the loop, which is the class of defect a single source exists to remove. The
 * mapping is the requirement read back: a loop that is MOVING is stopped, and a
 * loop that has settled is cleared.
 *
 * `args: null` on the settled half is the one place this row sends NOTHING, and it
 * is the answer to a pair of findings rather than a shorthand: the settled step has
 * no spelling a released backend honours (`loop clear` starts a loop toward the
 * literal `clear`; `loop --clear` starts one toward `--clear` — both measured, see
 * § 12.4 and § 13.4), so the settled dismiss is the ROW's own acknowledgement and
 * the chip that settles keeps its state in the picker and the doc where it belongs.
 */
export const loopAffordance = (
	loop: DesktopLoopState,
): { text: string; args: string | null; failure: string } =>
	loopIsRunning(loop.status)
		? { text: LOOP_STOP_TEXT, args: LOOP_STOP_ARGS, failure: LOOP_STOP_FAILURE }
		: { text: LOOP_CLEAR_TEXT, args: null, failure: LOOP_CLEAR_FAILURE };

/**
 * The loop dismiss's tooltip and accessible name: one derived string, on
 * `goalClearLabel`'s rule, over the clause the chip itself prints.
 *
 * The value repeats the chip's own clause on purpose, for the goal's reason one
 * control over: the two are read together, and the name has to say WHICH loop is
 * about to stop without the reader having to look up at the chip.
 */
export const loopActionLabel = (loop: DesktopLoopState): string =>
	`${loopAffordance(loop).text}${LABEL_SEAM}${loopClause(loop)}`;

export type ComposerStatusRowProps = {
	/**
	 * The canonical snapshot the readings strip also reads.
	 *
	 * The goal comes off it and off nothing else: the renderer never writes
	 * `frontend.goal` (the backend's `/goal` command does, and `clear` removes
	 * it), so this component is a projection of the wire rather than of any local
	 * opinion about what the goal is.
	 */
	frontend: CanonicalFrontendState | null | undefined;
	/**
	 * The run's derived model, or `null` where the session has none.
	 *
	 * Threaded in rather than derived here, deliberately: a second
	 * `deriveRunDetails` call would be a second tally that could disagree with the
	 * pane's and the trigger's. Absence is also the whole gate for the plan chip —
	 * a legacy chat has no model, so it grows no row, exactly as it grows no
	 * header trigger.
	 */
	runDetails: RunDetails | null | undefined;
	/** The composer's small-view step; see `MessageInputProps`. */
	isSmallView?: boolean;
	/**
	 * Puts focus back in the composer when a control of this row unmounts under it.
	 *
	 * A PROPERTY of the parent rather than a query from here, because the composer's
	 * textarea is the parent's own ref (`message-input.tsx`) and reaching for it by
	 * selector from a row that is itself rendered by that component would be a
	 * second way to name one element. Optional so a story that renders the row on
	 * its own is not forced to invent a focus target.
	 *
	 * See the effect that calls it for why this row needs it at all.
	 */
	onFocusComposer?: () => void;
};

export const ComposerStatusRow = ({
	frontend,
	runDetails,
	isSmallView = false,
	onFocusComposer,
}: ComposerStatusRowProps) => {
	const revealPlan = useUiPreferencesStore(
		(state) => state.revealRunPanelSection,
	);
	/*
	 * ONE command channel for the row's two DISMISS controls, and it is the pickers'
	 * own hook rather than a second way to reach a session command
	 * (`use-picker-backend.ts`): the receipt it returns is the backend's own, its
	 * error text is the owner's own sentence, and the request id is minted per press.
	 *
	 * Addressed by the SESSION the row is drawn for — `frontend.session_id`, the same
	 * snapshot the goal itself comes off — because the row is rendered by the
	 * composer and holds no id of its own. A row with no snapshot at all addresses
	 * the empty id, which the backend refuses in its own words rather than the row
	 * inventing a reason.
	 */
	const command = useSessionCommand(frontend?.session_id ?? "");
	/*
	 * A MIRROR of the disclosure's state, for copy alone.
	 *
	 * The primitive owns the open state and reports it (`onOpenChange`); this copy
	 * exists because the accessible name and the tooltip state the VERB, which
	 * only the state can spell. It is never written from here, so it cannot be a
	 * second source of truth for anything that renders.
	 */
	const [goalOpen, setGoalOpen] = useState(false);

	/*
	 * `trim()` gates the chip, and then the SAME trimmed value is what is
	 * displayed, named and expanded — one value, so a chip that renders can never
	 * be a chip whose name is empty. The wire's default is the empty string, so
	 * "no goal" is not a special case for any session: it is one branch for a
	 * fresh draft, a cleared goal and a legacy pane alike.
	 */
	const goal = frontend?.goal?.trim() ?? "";
	const showGoal = goal.length > 0;
	/*
	 * A FINISHED plan still shows, in the model's settled spelling
	 * (`All to-dos resolved`, or `All to-dos closed` where anything was dropped):
	 * the row's height must not change when the last item closes, and a plan that
	 * ended is a fact worth keeping on screen. See `todoClause` for why the two
	 * settled states are two words rather than one.
	 *
	 * The gate is the ITEM count and not the phase count, and the difference is a
	 * real state rather than a hypothetical. `RunDetails.todos` is the PHASE list,
	 * and the model decodes a phase record with no items to a phase with no items —
	 * so `todos.length > 0` calls a plan that arrived as one empty named phase a
	 * plan, and the chip would state a FINISHED plan over a plan that has no items at
	 * all (`All to-dos resolved`, `todoClause`'s settled clause, since this follow-up;
	 * `0 to-dos open` when this gate was first argued, which read as a finished plan
	 * too). `totalTodos` is the item count over the whole wire list: it is zero only
	 * when there is genuinely nothing to be in the middle of.
	 */
	const showPlan = Boolean(runDetails && runDetails.totalTodos > 0);

	/*
	 * The wake chip's gate: at least one ARMED schedule, off the model's own list.
	 *
	 * The list itself is the gate, exactly as `showPlan` is the item count and not a
	 * second tally: a count derived here would be a second opinion about a list the
	 * pane is also reading, and `wakeClause` would then have two callers that could
	 * disagree about it. `docs/composer-wakes.md` states why this gate is a COUNT gate
	 * rather than the plan's "0 still renders" rule — `frontend.wakes` is empty on
	 * every session that has never armed a wake, so a zero would be chrome above
	 * nearly every composer in the app.
	 *
	 * The other half of the gate is `runDetails` being non-null, which it is not for a
	 * legacy non-canonical chat: such a session has no pane model at all, so the chip
	 * would point at a destination that cannot open. That is the plan chip's own gate
	 * one clause up (`Boolean(runDetails && …)`) and it is why the state is read
	 * through the model rather than off `frontend.wakes` directly.
	 */
	const wakes = runDetails?.wakes ?? [];
	const showWakes = wakes.length > 0;
	/*
	 * The LOOP chip's gate: a state that is not `idle`, off the one wire field that
	 * carries it (`frontend.loop`, `DesktopLoopState`).
	 *
	 * `idle` and ABSENT are the same fact on this row and take the same branch: the
	 * wire omits `loop` on a session that has never started one, and a session whose
	 * loop finished and was cleared reports `idle`. Neither is a state worth a line
	 * above the composer, and a chip rendered for either would be `Loop: idle` over
	 * nearly every session in the app — the count gate's argument one chip over
	 * (`docs/composer-activity-chips.md` § 5).
	 *
	 * The gate is the STATUS and not the goal the loop carries, which is the other
	 * field that could have gated it: a loop can be running with no goal of its own
	 * (a count loop works the session's STANDING goal, which the goal chip already
	 * states), and gating on that field would hide the one chip that can stop it.
	 */
	const loop = frontend?.loop ?? null;
	/*
	 * THE SETTLED LOOP'S DISMISS SENDS NOTHING, and this is the state that makes that
	 * concrete (agent review round 1, MAJOR 1).
	 *
	 * A STOPPED loop's state does not go away: the wire publishes `cancelled` and
	 * KEEPS the loop (`local_operator/session/goal_loop.py` publishes the status from
	 * its `CancelledError` arm and never clears `state`), so after a real stop the chip
	 * is still there reading `Loop: cancelled` and the row is asking for a second
	 * press. What that second press can SEND is the problem: there is no released
	 * spelling that clears a settled loop. `loop clear` on a released backend starts a
	 * loop toward the literal `clear`, and `loop --clear` starts one toward `--clear`
	 * — measured against the installed harness, not inferred (see § 12.4) — while the
	 * app can attach to a backend it does not own and there is no capability signal for
	 * a slash ARGUMENT. A UI may only send what every installed backend already
	 * understands.
	 *
	 * So the settled dismiss is the ROW's acknowledgement of its own chip: it hides
	 * that loop's settled chip, and the settlement itself stays where it has a home —
	 * the `/loop` picker's status panel and the design record. The memory is keyed on
	 * the settled state's own signature, so a NEW loop (running or judging: the
	 * signature changes the moment a loop moves) is never hidden by it, and it is
	 * dropped as soon as the wire reports no settled loop, so a later loop that settles
	 * into the same shape shows its own chip. The cost is stated rather than implied:
	 * a re-attach re-renders the wire's settled chip, and a second acknowledgment is
	 * needed (`docs/composer-status-tabs.md` § 13.4).
	 */
	const settledLoopSignature =
		loop !== null && !loopIsRunning(loop.status) ? loopSignature(loop) : null;
	const [acknowledgedLoop, setAcknowledgedLoop] = useState<string | null>(null);
	useEffect(() => {
		if (settledLoopSignature === null) setAcknowledgedLoop(null);
	}, [settledLoopSignature]);
	const showLoop =
		loop !== null &&
		loop.status !== "idle" &&
		!(
			settledLoopSignature !== null && settledLoopSignature === acknowledgedLoop
		);

	/*
	 * The mirror FOLLOWS the control it describes, and this is what keeps that true
	 * across a hide.
	 *
	 * The chip renders only while there is a goal (`showGoal && <Disclosure>`), so a
	 * goal that is cleared and then set again — `/goal`, then `clear`, then a new
	 * goal, a backend-driven change with no remount of the composer — destroys the
	 * primitive's state and mounts a FRESH CLOSED disclosure. The mirror is this
	 * component's state and would survive it, so the trigger would announce
	 * "Collapse the session goal — <the new goal>" over a closed chip with no body:
	 * copy that contradicts the control it names (agent review round 1, M1, from the
	 * state machine — a session with a plan keeps this component mounted).
	 *
	 * Keying the `Disclosure` on `goal`, the reviewer's other suggestion, fixes the
	 * same sequence by remounting on every goal REVISION, which would snap an open
	 * body shut whenever the backend updates the text mid-run; reading it is what the
	 * expansion is for, so the reset belongs on the hide and not on the edit.
	 *
	 * Declared here rather than beside the `useState` above because `showGoal` is
	 * derived below it: an effect that reads it from there throws on the temporal
	 * dead zone rather than returning early.
	 */
	useEffect(() => {
		if (!showGoal) setGoalOpen(false);
	}, [showGoal]);

	/*
	 * The two activity readings, as ONE value each: how many rows are open and the
	 * state the chip's mark shows, derived together in the model
	 * (`activityTally`). The gate, the glyph and the sentence are all off this one
	 * object, so "the chip renders", "the number is positive" and "the word in the
	 * sentence is the state of the mark" cannot come apart — the defect design
	 * round 1 (D1) and UX's U4 both found, from the pixels and from the copy.
	 */
	const children = runDetails ? activityTally(runDetails.subagents) : null;
	const jobs = runDetails ? activityTally(runDetails.jobs) : null;

	/*
	 * The last activity row settling unmounts its chip, and if that chip held focus
	 * the browser drops focus to `<body>` rather than restoring it anywhere (UX
	 * round 1, U1 — observed live: `active=BUTTON/jobs` then `active=BODY/None`).
	 * The user tabbed to a control, the work finished, and the next `Tab` starts
	 * from the top of the document instead of from the composer they were writing
	 * in.
	 *
	 * The trigger above this row already carries this idiom for its own close (the
	 * button the press landed on unmounts with the pane), and this is the same
	 * hazard with the same remedy: a CONDITIONAL refocus, never an unconditional
	 * one.
	 *
	 * WHAT IS REMEMBERED IS THE NODE, not how many chips the row draws (agent
	 * review round 2, m2). The first version counted chips across commits and
	 * refocused on a SHRINK, which cannot see the swap this wire makes ordinary:
	 * `frontend.jobs` is polled, so a running job settling while a child starts —
	 * or a `bash` row registering — moves the row 1 -> 1, the focused chip
	 * unmounts, and the browser drops focus with the count unchanged. The fact the
	 * browser does give us is that the node it was on is DETACHED while the row
	 * holds NO focus; if the row still holds focus the user is on another control
	 * in it and nothing should move. The previous commit's answer has to be
	 * remembered because by the time this effect runs focus is already on
	 * `<body>` — and the remembered node is dropped the moment the row stops
	 * holding focus, so a settle in a session whose user is typing in the
	 * transcript cannot yank focus into the composer.
	 */
	const rowRef = useRef<HTMLDivElement | null>(null);
	const previouslyFocused = useRef<HTMLElement | null>(null);
	useEffect(() => {
		const active = document.activeElement;
		const focusedInRow =
			active instanceof HTMLElement && rowRef.current?.contains(active) === true
				? active
				: null;
		if (
			shouldRestoreComposerFocus(
				previouslyFocused.current,
				focusedInRow !== null,
			)
		)
			onFocusComposer?.();
		previouslyFocused.current = focusedInRow;
	});

	if (!showGoal && !showLoop && !showPlan && !showWakes && !children && !jobs)
		return null;

	const goalLabel = goalDisclosureLabel(goal, goalOpen);
	const planLabel = runDetails ? planChipLabel(runDetails) : "";
	const wakeLabel = showWakes ? wakeChipLabel(wakes.length) : "";
	const subagentLabel = children ? subagentChipLabel(children) : "";
	const jobLabel = jobs ? jobChipLabel(jobs) : "";
	/*
	 * The two dismiss controls' own derivations, gated on the chip they belong to:
	 * a name is never built for a control that is not rendered, so the goal's
	 * accessible name cannot state a goal the chip does not show.
	 *
	 * `loopAction` is the WORD and the FLAG together (`loopAffordance`), read once
	 * and used twice — the button's label and the command it runs — so the two
	 * cannot disagree about which verb is being offered.
	 */
	const goalClear = showGoal ? goalClearLabel(goal) : "";
	const loopAction = showLoop && loop ? loopAffordance(loop) : null;
	const loopLabel = showLoop && loop ? loopActionLabel(loop) : "";
	/*
	 * Whichever chip renders first cancels its own padding, and the count chips are
	 * ONE GROUP now (see the group's own note below): the group is the row's first
	 * item exactly when neither of the two items AHEAD of it rendered, and inside it
	 * the leading chip is the plan's when a plan renders and the wake chip's
	 * otherwise.
	 *
	 * The wake chip sits AFTER the plan and BEFORE the two activity chips, because
	 * that is where it belongs in what the row means: the goal, the plan and the
	 * wakes are the session's STANDING facts — what it is set up to do — and the
	 * subagents and jobs are what is moving right now. It is also the TUI dock's own
	 * order, where the wake band renders directly above the plan band
	 * (`wake_panel.WakePanel`). The alternative, appending the newest chip at the end
	 * of the row, was rejected because it would read `2 subagents running 3 wakes
	 * armed` — live work first, a schedule last — which is the reverse of how the two
	 * groups relate.
	 *
	 * The LOOP chip sits between the goal and the plan, and it is the one placement
	 * this change adds (`docs/composer-status-tabs.md` § 12 and § 13). The row's rule is
	 * standing facts before live work; the loop is the session's MODE — the one item on
	 * this row, beside the goal, that a command SETS and this row CLEARS — and it is
	 * paired with the goal rather than with the counts for the reason the pair exists:
	 * a count loop consumes the standing goal, and a goal loop carries one of its own.
	 * The two rejected placements are recorded there rather than argued here: APPENDED
	 * after the activity chips reads live work before the thing driving it, which is the
	 * wake chip's refused alternative over again, and placed after the wakes puts the
	 * one field whose value can be `running` behind two counts that describe a plan.
	 */
	const loopFirst = !showGoal;
	const groupIsFirst = !showGoal && !showLoop;
	const wakesFirst = groupIsFirst && !showPlan;
	const subagentsFirst = wakesFirst && !showWakes;
	/*
	 * ...and the jobs chip is first only when NEITHER of the three ahead of it
	 * rendered, which is a different question from "the subagents chip is not the
	 * first": with no goal, no plan and no wakes, a session holding only tool jobs
	 * puts the jobs chip on the row's content edge and its siblings nowhere.
	 */
	const jobsFirst = subagentsFirst && !children;

	/**
	 * Put a cleared goal back, on the toast's own `Undo` press.
	 *
	 * The text and not the chip's current value, and the same command channel: `goal
	 * <text>` is `GOAL_COMMAND`'s set form, which every released backend honours. Its
	 * OWN failure speaks too — an undo that silently failed would be worse than no
	 * undo at all, because the person has been told the text is recoverable.
	 */
	const restoreGoal = async (text: string) => {
		const result = await command.run(GOAL_COMMAND, text, GOAL_UNDO_FAILURE);
		if (result.result.tone === "error") showErrorToast(result.result.text);
	};

	/**
	 * The loop dismiss, whose two halves do different things on purpose (§ 13.4).
	 *
	 * A MOVING loop sends `loop stop`. A SETTLED one sends NOTHING and acknowledges
	 * the chip instead: there is no released spelling that clears a settled loop, and
	 * the two the companion adds would START a loop on every backend that does not
	 * know them. `loopAffordance` owns which half is which, so this cannot disagree
	 * with the word the button prints.
	 */
	const dismissLoop = (action: { args: string | null; failure: string }) => {
		if (action.args === null) {
			setAcknowledgedLoop(settledLoopSignature);
			return;
		}
		void runDismiss(LOOP_COMMAND, action.args, action.failure);
	};

	/**
	 * Run one DISMISS and report what the press needs to say.
	 *
	 * The wire is the success path: the goal clears and the chip goes, or the loop
	 * settles and the chip's own word changes. A live region for that is refused on this
	 * row (§ 7), and a success toast would be the row talking over the agent's own
	 * output.
	 *
	 * A FAILURE has no wire to speak for it, so it goes to the app's toast channel —
	 * the same one the composer's own dictation and attachment failures use — rather
	 * than nowhere. The reason in it is the hook's own `result.text`, which is the
	 * owner's wording when it gave one and the transport's message when the call never
	 * arrived: one source, so the toast cannot paraphrase the backend it is reporting.
	 * The PREFIX is the control's own words (`Could not clear the goal`), because the
	 * person pressed a button and never typed a slash command (UX round 1, U2).
	 *
	 * ONE success does speak: clearing the goal is irreversible from this row, and the
	 * dismissed text is the user's own prose (UX round 1, U1). It is answered in the
	 * channel the refusal already uses, with the one press that takes it back — the
	 * cleared text is re-sent as `goal <text>`, a spelling every released backend
	 * honours, and it is captured before the wire moves so the undo cannot restore a
	 * goal that a later goal revision replaced.
	 */
	const runDismiss = async (name: string, args: string, failure: string) => {
		const result = await command.run(name, args, failure);
		if (result.result.tone === "error") {
			showErrorToast(result.result.text);
			return;
		}
		if (name !== GOAL_COMMAND) return;
		const cleared = goal;
		showInfoToast(GOAL_CLEARED_TEXT, {
			action: {
				label: GOAL_UNDO_TEXT,
				onClick: () => void restoreGoal(cleared),
			},
		});
	};

	return (
		<div
			ref={rowRef}
			data-composer-status-row=""
			className={cn(
				CHAT_MEASURE,
				"flex flex-wrap items-start gap-x-2 gap-y-0.5",
				/*
				 * The horizontal inset and the container-keyed track are the alert's
				 * own, for the alert's reason: two lines that sit above the same box
				 * share its outer edge, or one of them reads as unrelated chrome. The
				 * bottom padding is this row's gap to whatever follows, in the same
				 * step, because the form itself is a bare `w-full` and owns no gap.
				 */
				isSmallView ? "px-2 pb-1" : "px-4 pb-2",
				/*
				 * WRAP, which the row did not need while it held two chips and does now
				 * that it can hold four.
				 *
				 * `docs/composer-status-tabs.md` § 5.4 budgets ~168px of a 204px content
				 * box for ONE count chip, so three or four of them cannot share a line at
				 * any column the app renders (900, the 240px switch, the 172px floor) —
				 * and the chips are `shrink-0` on the record's own rule that a bounded
				 * count is never cut mid-figure. Without this the row simply painted past
				 * the column; the frames pin `overflowX === 0` at every captured width,
				 * and this rule is what makes that a property rather than a hope.
				 *
				 * The overflow moves to the GOAL, which is the flexible item and can
				 * shrink to its own label (`min-w-0`), and any chip that no longer fits
				 * takes the next line. Same yield order the row already records — an
				 * unbounded value yields, a bounded count never does — with one more line
				 * to yield into.
				 */
				"@max-[240px]/chatcol:flex-col @max-[240px]/chatcol:flex-nowrap",
			)}
		>
			{/*
			 * The goal FIRST in the DOM, and the plan second, so the painted order
			 * and the tab order agree in both arrangements: in the column the goal
			 * is the line above the count, and a keyboard user reaches it first
			 * rather than stepping down to the count and back up.
			 */}
			{showGoal && (
				/*
				 * The goal chip AND its dismiss, as one flex ITEM — the item the expanded body's
				 * width comes from (`min-w-[140px] flex-1`). The control that clears the goal
				 * rides the trigger's own LINE inside the disclosure (`trailing`), and the item
				 * is what keeps the pair ONE item on the row: the wrap regime counts items, so a
				 * second item here could take a line of its own away from the chip it belongs
				 * to.
				 *
				 * The item is NOT the reveal's group, and that is design review round 1's D1 and
				 * UX's U5 read together: the pair is what a hover or a focus reveals, so the
				 * scope is the trigger's line (the primitive applies `group` to it when it
				 * renders a `trailing` control). Keyed to this item instead, the control appeared
				 * while the pointer was on empty row up to 532px away from the words it acts on.
				 *
				 * `COLUMN_GOAL` stays here with the item it is about (see its own constant): the
				 * body's measure at the column floor is a property of the item, not of the
				 * disclosure inside it.
				 *
				 * `min-w-[140px]` is a FLOOR on the item and it is design review round 1's D2
				 * measured rather than preferred: with the counts as one group below the goal,
				 * flex resolves line breaking on each item's hypothetical size, so this floor
				 * is what makes the row wrap the WHOLE count group under the goal instead of
				 * letting the two share a squeezed line. At the 240px band the goal then reads
				 * `Goal: Reconcile t…` on its own line where the torn arrangement cut it to
				 * `Goal: Rec…` and pushed the plan chip to the opposite margin — the wider
				 * column was the worse arrangement. 140px is the width at which the chip still
				 * says something: chevron, `Goal:` and the padding measure ~75px of fixed ink,
				 * leaving ~65px of snippet.
				 *
				 * The dismiss now shares this floor, and the two facts are settled together
				 * rather than one at a time: the word `Clear goal` is DROPPED at and below the
				 * stacked band (`DISMISS_WORD`), which is where the item is `w-full` and the
				 * floor does not bind, so at the one width the floor is stated for, what sits
				 * beside the chip is the X and nothing wider. Above that band the item is
				 * `flex-1` with the row's whole content box to grow into, and the frames print
				 * the item's width against the snippet's `clientWidth`/`scrollWidth` at every
				 * captured width (`docs/evidence/composer-status-clear/`).
				 */
				<div
					data-status-goal=""
					className={cn("flex min-w-[140px] flex-1 items-center", COLUMN_GOAL)}
				>
					<Disclosure
						/*
						 * The disclosure takes the item's width less the dismiss, and `min-w-0` is
						 * what lets the snippet yield first inside it; the trigger keeps its
						 * `w-fit` so the hover ground stays chip-sized while the ITEM stretches
						 * (the body's own requirement, § 4.4).
						 */
						className={cn("min-w-0 flex-1")}
						/*
						 * The row box is the chip, in the readings' own 24px height, radius and
						 * padding.
						 *
						 * `h-6 py-0` rather than the primitive's default, and the override is
						 * MEASURED rather than preferred: `min-h-6` is a floor, not a height, so
						 * with the primitive's `py-0.5` and a 12px label at its own line height
						 * the box came out at 25.7px beside the plan chip's 24px — two chips of
						 * one species 1.7px apart on one line. 24 + this row's 8px bottom padding
						 * is also the 32px the design record's § 2.3 states.
						 */
						rowClassName={cn("h-6 rounded-sm px-1.5 py-0")}
						/*
						 * `w-fit` is what keeps the hover ground CHIP-SIZED while the flex ITEM
						 * takes the free space the expanded body needs; `-ml-1.5` cancels the
						 * chip's own padding so its text lands on the row's content edge, where
						 * the alert's first character already sits.
						 *
						 * `max-w-full` is NOT decoration, and it is not in the record because the
						 * record did not know `w-fit` alone does not clamp. Measured in the
						 * frames: Blink resolves `width: fit-content` on this button to its
						 * content's max-content width — 2026px inside an 868px item — so the chip
						 * painted over the plan count and past the column at every width, and the
						 * snippet's `truncate` never ran because there was nothing to truncate
						 * against. Clamped, the chip is 768px and the snippet truncates
						 * (clientWidth 698 against scrollWidth 1956), while a goal that FITS is
						 * unchanged at 257px — still chip-sized. The plan chip is `shrink-0` and
						 * this is the other half of the same rule: a bounded count is never cut,
						 * so the unbounded value yields.
						 *
						 * The ink override is taken deliberately: the primitive's `text-ink-dim`
						 * is the role this composer uses for an inert readout, and in this row
						 * both controls have to be one species or the goal reads as the inert one.
						 */
						triggerClassName={cn(
							/*
							 * `min-w-0` is what lets this chip SHRINK to leave the dismiss its box, and it
							 * is required by the pair sharing a line (design review round 1's D1): a flex
							 * item's automatic minimum size is its content-based minimum CLAMPED BY
							 * `max-width`, and `max-w-full` on a chip whose content is 2026px of text
							 * therefore resolves that minimum to the whole line — measured: the chip sat
							 * at 748px of a 748px line with the ✕ overflowing it by 83px, and the row
							 * registered `overflowX 75px` at the 240px band. The old structure hid this
							 * by accident: the chip lived inside a disclosure box that was already the
							 * item's width less the dismiss, so its `100%` was the right number. Zero
							 * here is the disclosure's own `min-w-0` moved to the element that now needs
							 * it, and the snippet's `truncate` is what makes the result a shorter
							 * snippet rather than an overflow.
							 */
							"w-fit max-w-full min-w-0 text-ink-muted hover:bg-accent-wash hover:text-ink focus-visible:outline-offset-1!",
							// The row's first-chip rule, applied by the row to whichever chip renders
							// first; see FIRST_CHIP. The goal renders first whenever it is present.
							FIRST_CHIP,
						)}
						triggerLabel={goalLabel}
						triggerTooltip={goalLabel}
						onOpenChange={setGoalOpen}
						/*
						 * THE DISMISS, on the trigger's own LINE and inside the primitive's root
						 * (`trailing`) — design review round 1's D1 and UX's U4, which measured the
						 * same control at 132px, 414px and 532px from the words it acts on when it sat
						 * at the flex ITEM's trailing edge, with a different chip as its nearest
						 * neighbour in two of the three states.
						 *
						 * WHY THE SLOT AND NOT A SIBLING OF THE DISCLOSURE. `display: contents` on the
						 * existing root is the cheaper mechanism and it was TRIED against the served
						 * story before this slot was written: with the body as a wrapping sibling the
						 * item must be `flex-wrap` for the body to take its own line, and a wrapping
						 * flex line breaks on the chip's HYPOTHETICAL size — `max-w-full`, i.e. the
						 * whole item — so the ✕ wraps to the next line beside the body at every
						 * width where the chip is clamped (measured: the 300-character goal). A
						 * non-wrapping line keeps the ✕ beside the chip but then cannot put the body
						 * on its own line at all. The row's own geometry needs both, so the pair is
						 * wrapped in the one container that is the trigger's line (§ 12.3).
						 *
						 * That container is also the REVEAL's scope (the primitive puts `group` on
						 * it), which is the second half of the same finding: the trigger becomes the
						 * chip plus its control instead of an 868px item, so the ✕ no longer appears
						 * while the pointer is on empty row (UX round 1, U5) and cannot be read as
						 * row-level chrome.
						 */
						trailing={
							<Tooltip
								content={goalClear}
								side="top"
								className={cn(TOOLTIP_CLAMP)}
							>
								<button
									type="button"
									data-status-goal-dismiss=""
									aria-label={goalClear}
									disabled={command.busy}
									onClick={() =>
										void runDismiss(
											GOAL_COMMAND,
											GOAL_CLEAR_ARGS,
											GOAL_CLEAR_FAILURE,
										)
									}
									className={cn(CHIP_CONTROL, DISMISS_REVEAL, DISMISS_DISABLED)}
								>
									<X aria-hidden={true} className={cn("size-3.5 shrink-0")} />
									<span className={cn(DISMISS_WORD)}>{GOAL_CLEAR_TEXT}</span>
								</button>
							</Tooltip>
						}
						summary={
							<span className={cn("flex min-w-0 items-center gap-1")}>
								{/*
								 * The label is VISIBLE in every arrangement, and this is a change the frames
								 * argued for rather than against the record.
								 *
								 * It used to go `sr-only` at the column floor, on the record's § 4.2
								 * reasoning that hiding it "is what lets the goal chip shrink to its
								 * chevron so the count is never squeezed". That reasoning does not hold in
								 * the arrangement the same rule is paired with: at the floor the row is a
								 * COLUMN, so the count has a line to itself with the whole width available
								 * — measured, a 92px chip in a 156px content box — and cannot be squeezed by
								 * a word on the line above it. What the hidden label did cost was the row's
								 * only identifying word: line one read `> Reconcile the March I…` with
								 * nothing saying what it was, one line above the user's composer (design
								 * review round 1, D4).
								 *
								 * `shrink-0` is the other half of the statement, and it is what makes the
								 * yield order hold in the band where both chips share a line: the label is
								 * ~37px and never deforms, the snippet is `min-w-0 truncate` and yields
								 * first, and the count is `shrink-0` so it is never cut mid-figure.
								 */}
								<span className={cn("shrink-0")}>{GOAL_LABEL}</span>
								{/*
								 * CSS truncation, never a computed cell count: the browser
								 * measures the real advance at the real font, size, zoom and
								 * theme, where a count is a guess the TUI could only make
								 * because a terminal cell is a fixed box. The full value's
								 * second home is the tooltip and the body (see the label
								 * derivation above).
								 */}
								<span className={cn("min-w-0 truncate")}>{goal}</span>
							</span>
						}
					>
						{/*
						 * The body: the child reader's brief block, whose roles are this app's
						 * treatment for an authored instruction. `pre-wrap` because the goal may
						 * be a list and its break characters are the author's; `max-h-32` with its
						 * own scroller because a growable block on this composer caps itself, and
						 * the cap is what keeps the row's own growth bounded at 168px so no
						 * ancestor has to clip on behalf of its children.
						 *
						 * The tab stop exists ONLY while this is mounted, i.e. only while the goal
						 * is expanded, so it never adds a stop to the ordinary composer. It is
						 * here because the region has no focusable content of its own (the pane's
						 * scroller has none either, and carries no stop for exactly that reason) —
						 * and a keyboard user cannot scroll a mouse-only scroller.
						 */}
						<div
							// biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls; this groups one authored paragraph, and the name is what makes the region announce itself rather than a landmark per goal.
							role="group"
							aria-label="Session goal"
							// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region with no focusable content of its own must carry its own tab stop, or a keyboard user cannot reach the goal past the cap (WCAG 2.1.1). The stop exists only while this body is mounted.
							tabIndex={0}
							data-status-goal-body=""
							className={cn(
								"font-sans text-body-sm text-ink-muted whitespace-pre-wrap break-words",
								CAPPED_BLOCK,
							)}
						>
							{goal}
						</div>
					</Disclosure>
				</div>
			)}

			{/*
			 * THE LOOP CHIP, and the second dismiss control.
			 *
			 * It is the row's one chip that is NOT a control, and that is a decision rather
			 * than an omission (§ 13): the loop's standing state is a readout, the row's only
			 * control here is the one that stops or clears it, and the alternative — a chip
			 * that opens something — has no destination this row can name. The chip takes the
			 * readings' INERT box (`CHIP_READOUT`, the same box as the readings' own
			 * not-a-control form), which is what makes the difference legible without colour:
			 * a hover ground and a pointer mean a press does something, and this chip has
			 * neither.
			 *
			 * The mark is `Repeat`, which is the one glyph on this row whose meaning is fixed
			 * elsewhere and fixed to this fact: the app uses `RotateCw` for retry and reload
			 * (browser tab strips, the settings reconnect, the error boundary) and `Info` for
			 * "this opens the run pane", so this is the row's one loop mark and no other chip
			 * can come to mean it as well. It does NOT move: the row's one piece of motion is
			 * the roster's state mark on the activity chips, and a spin invented here would
			 * be a second motion vocabulary for the same question (an activity chip's mark
			 * says a row is moving; this chip's CLAUSE says a loop is running).
			 *
			 * `shrink-0` on the item, on the row's own yield rule: the clause is a bounded
			 * fact read off one wire field, so it is never cut — the goal's snippet is the
			 * item that yields, and the row wraps rather than squeezing either.
			 */}
			{showLoop && loop && loopAction && (
				<div
					data-status-loop-item=""
					className={cn("group flex shrink-0 items-center")}
				>
					<span
						data-status-loop=""
						className={cn(CHIP_READOUT, loopFirst ? FIRST_CHIP : undefined)}
					>
						<Repeat aria-hidden={true} className={cn("size-3.5 shrink-0")} />
						{/*
						 * The clause is ONE text flow, and the progress yields from INSIDE it at the
						 * stacked band (`NARROW_HIDDEN`) — leaving `Loop: running` where a 156px column
						 * cannot carry the rest. The progress stays a node of its own because the band
						 * rule needs something it can `display: none`; it is an INLINE node rather than a
						 * second flex item, because the readout's box carries the readings' `gap-1.5` and
						 * that gap was landing inside the sentence — the app printed `Loop: running , 1 of
						 * 25 turns`, and the DOM text was clean, which is why no unit test could see it
						 * (QA round 1, Q2). One derivation split in two, not two copies: `loopClause` is
						 * these two halves in order, and it is what the dismiss's accessible name prints
						 * at EVERY width — so the figure a narrow row drops from the paint is still one
						 * hover or one screen reader away.
						 */}
						<span>
							{`${LOOP_LABEL} ${loopStatusWord(loop)}`}
							<span className={cn(NARROW_HIDDEN)}>{loopProgress(loop)}</span>
						</span>
					</span>
					<Tooltip content={loopLabel} side="top" className={cn(TOOLTIP_CLAMP)}>
						<button
							type="button"
							data-status-loop-dismiss=""
							aria-label={loopLabel}
							disabled={command.busy}
							onClick={() => dismissLoop(loopAction)}
							className={cn(CHIP_CONTROL, DISMISS_REVEAL, DISMISS_DISABLED)}
						>
							<X aria-hidden={true} className={cn("size-3.5 shrink-0")} />
							<span className={cn(DISMISS_WORD)}>{loopAction.text}</span>
						</button>
					</Tooltip>
				</div>
			)}

			{/*
			 * THE COUNT CHIPS ARE ONE GROUP, and that is design review round 1's D2.
			 *
			 * With the three chips as siblings of the goal, the row's wrap regime tore
			 * them apart: on the line the goal shared with one chip, the goal's `flex-1`
			 * box stretched to the whole line and pushed that chip to the RIGHT edge,
			 * while its two siblings started a left-aligned column underneath — a
			 * 35px gap that is a stretched box and not the row's 8px `gap-x-2`, and the
			 * 172px floor read BETTER than the 240px band it sits above.
			 *
			 * Grouping them makes the counts one item: the row wraps the goals' line and
			 * the counts' line, and inside the group the chips wrap left-aligned among
			 * themselves. `min-w-0` (and deliberately NOT `shrink-0`) is what lets the
			 * group shrink to a narrow column and wrap internally instead of overflowing
			 * it — and the group's flex-basis being its content is what makes the ROW
			 * wrap it below the goal when the column cannot hold both.
			 */}
			{(showPlan || showWakes || children || jobs) && (
				<div
					className={cn(
						"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5",
					)}
				>
					{showPlan && runDetails && (
						<Tooltip content={planLabel} side="top">
							{/*
							 * A real button, in the readings' own control box, and NOT a toggle: see
							 * this file's header. `shrink-0` comes from that box and is not incidental
							 * — a count cut mid-figure is a broken claim, so what yields when the row
							 * is tight is the goal's snippet and then its label, both of which have a
							 * second home. The count has none.
							 */}
							<button
								type="button"
								data-status-plan=""
								aria-label={planLabel}
								onClick={() => revealPlan("todos")}
								className={cn(
									CHIP_CONTROL,
									groupIsFirst ? FIRST_CHIP : undefined,
								)}
							>
								{/*
								 * The run pane's own mark, shared with the header trigger so ONE glyph
								 * means "this opens the run pane" on both surfaces.
								 *
								 * Why a mark at all: without one the count was plain muted text in the
								 * same ink as the goal's snippet, with the pointer cursor and the tooltip
								 * as its whole affordance — neither of which exists in a still, and
								 * neither of which a reader consults before pressing. At the floor it was
								 * worse than neutral: the stacked row put `3 to-dos open` on the line under
								 * a truncated goal sentence, in the goal's ink, where it read as the
								 * sentence's wrapped remainder rather than as a second control, and
								 * `0 to-dos open` read as a completion statement (design review round 1,
								 * D1). The mark LEADS the count so the stacked line opens with a glyph
								 * rather than with a digit.
								 *
								 * `size-3.5` is the disclosure chevron's own size, so the two chips in this
								 * row carry same-size marks and stay one species.
								 *
								 * The alternatives, and why each was rejected:
								 *
								 * - the goal chip's CHEVRON, the designer's first option: it is the app's
								 *   mark for "expands in place", and these two chips sit on one line. Two
								 *   chevrons would say both controls do the same thing, which is the
								 *   opposite of the distinction D1 asks for — this one navigates to a
								 *   region rather than revealing its own.
								 * - `PanelRight` / `PanelRightClose`: the pane's own chrome control, and
								 *   `docs/composer-status-tabs.md` § 6.1 already refuses an open/close pair
								 *   that differs by one small arrow with both on screen at once.
								 * - `ArrowUpRight` / `ExternalLink`: they mean leaving this surface, and
								 *   the pane is a sibling region of the same window.
								 * - `ListChecks`: the ledger's glyph for the todo TOOL
								 *   (`trace/tool-glyphs.ts`) — the same collision § 6.1 refuses.
								 * - no mark (the incumbent): the state D1 is about.
								 *
								 * The accessible name already states the action in words, so the mark is
								 * `aria-hidden` — a decorative repetition, not a second label.
								 */}
								<Info aria-hidden={true} className={cn("size-3.5 shrink-0")} />
								{todoClause(runDetails)}
							</button>
						</Tooltip>
					)}

					{/*
					 * The WAKE chip: the session's armed schedules, between the plan and the two
					 * activity chips — the row's standing facts first, then the work in flight
					 * (see `wakesFirst` above).
					 *
					 * The same control box, the same reveal, the same absence of `aria-pressed`:
					 * a mode toggle here would close the pane a reader had just opened, which is
					 * the defect the plan chip's own record names.
					 *
					 * `AlarmClock` is a MARK and not a state, which is why it does not spin: this
					 * row's one piece of motion is `SubagentStateIcon`'s, and it exists because a
					 * child's state changes. A wake's does not — the list is armed until it is
					 * not — so a moving mark here would claim activity the wire is not reporting.
					 * The alternatives, and why each was rejected:
					 *
					 * - `Clock`: `SubagentStateIcon` already draws it for a capacity-QUEUED child
					 *   on the chip beside this one, so one glyph would mean two states on one row.
					 * - `CalendarClock`: the schedules surface's glyph for a recurring job
					 *   (`features/schedules`), and a wake is not a schedule JOB — the two are
					 *   different objects with different cancels.
					 * - `Bell` / `BellRing`: the notification stack's, and a wake is not a
					 *   notification — it is a trigger, which is exactly the distinction the
					 *   operator's report turns on.
					 * - `Info`: the plan chip's, and one glyph in this row means one thing.
					 * - no mark (what the `Info` alternative above was rejected for on the plan
					 *   chip): the count alone is plain muted text a reader has no way to tell from prose,
					 *   and `docs/composer-status-tabs.md` § 6.1's D1 is the finding that put a mark on
					 *   every count chip in this row.
					 *
					 * The Wakes SECTION rows wear this same glyph as their mark, so it means "wake"
					 * on both surfaces rather than "press me" on one and "a wake row" on the other.
					 */}
					{showWakes && (
						<Tooltip content={wakeLabel} side="top">
							<button
								type="button"
								data-status-wakes=""
								aria-label={wakeLabel}
								onClick={() => revealPlan("wakes")}
								className={cn(
									CHIP_CONTROL,
									wakesFirst ? FIRST_CHIP : undefined,
								)}
							>
								<AlarmClock
									aria-hidden={true}
									className={cn("size-3.5 shrink-0")}
								/>
								{wakeClause(wakes.length)}
							</button>
						</Tooltip>
					)}

					{/*
					 * The two ACTIVITY chips, in the operator's order: subagents, then jobs.
					 *
					 * They are the plan chip's own control (`CHIP_CONTROL`, imported rather than
					 * restated), they REVEAL their section of the pane exactly as it does, and
					 * they carry no `aria-pressed` and no pressed ground for its reason: a chip
					 * that closed the pane when pressed while looking for the work would be one
					 * control with two meanings. Three species of chip now share this row and the
					 * grammar is one glyph one meaning: `Info` means "this opens the run pane" and
					 * only the plan chip wears it, the wake chip wears the wake's own mark, and the
					 * activity chips wear a STATE MARK (below).
					 *
					 * The counts are the model's, spelled by its own clauses, and nothing here
					 * tallies anything.
					 */}
					{children && (
						<Tooltip content={subagentLabel} side="top">
							<button
								type="button"
								data-status-subagents=""
								aria-label={subagentLabel}
								onClick={() => revealPlan("subagents")}
								className={cn(
									CHIP_CONTROL,
									subagentsFirst ? FIRST_CHIP : undefined,
								)}
							>
								{/*
								 * The mark leads, and it is the roster's own `SubagentStateIcon` rather
								 * than a second glyph for the same nine states: that component already
								 * carries the whole contract — `motion-safe:animate-spin` for `running`
								 * and nothing else, `text-ink-muted` and never the accent ("the accent
								 * green is a scarce budget and a child at work has not done anything
								 * yet"), and shape as the contract with motion as the bonus, so it
								 * survives reduced motion and looks right to a reader who cannot
								 * separate two inks.
								 *
								 * That spin IS this row's animation-while-active, and it is not an entry
								 * animation: it is the same live state the pane's roster draws, one
								 * surface over. Nothing new is authored for it — no keyframe, no token,
								 * no `animate-pulse-visible` (that role is the skeleton's and its own
								 * docblock says so). The mark is `aria-hidden` inside the component, so
								 * the state reaches a screen reader through WORDS: the clause's own state
								 * word when every open row shares it, and `busiestClause` on the
								 * accessible name when the set is mixed and the clause says `open`.
								 */}
								<SubagentStateIcon status={children.mark} />
								{childClause(children)}
							</button>
						</Tooltip>
					)}

					{jobs && (
						<Tooltip content={jobLabel} side="top">
							<button
								type="button"
								data-status-jobs=""
								aria-label={jobLabel}
								onClick={() => revealPlan("jobs")}
								className={cn(CHIP_CONTROL, jobsFirst ? FIRST_CHIP : undefined)}
							>
								{/*
								 * The same mark over a different list, and the same reason: a tool job
								 * is the one other thing in this session that can be at work while the
								 * user reads, and a `bash` row is not a subagent — the roster excludes it
								 * deliberately (`run-detail-model.ts`'s partition), so these two chips
								 * exist as two because the two lists do. A single combined "activity"
								 * chip is refused: it would be a button inside a button, and it would
								 * open a section that cannot show its own rows.
								 */}
								<SubagentStateIcon status={jobs.mark} />
								{jobClause(jobs)}
							</button>
						</Tooltip>
					)}
				</div>
			)}
		</div>
	);
};
