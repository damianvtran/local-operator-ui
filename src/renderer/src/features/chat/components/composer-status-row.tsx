/**
 * The composer's status row: the session's standing goal, and the size of the
 * run's plan (`docs/composer-status-tabs.md`, which is the design record this
 * implements).
 *
 * One line, immediately above the composer box and OUTSIDE it. The placement is
 * the send-error alert's own recorded argument rather than a new one
 * (`message-input.tsx`'s docblock at the alert): the composer box is one control
 * with one focus ring (`COMPOSER_BOX`), and folding non-interactive prose and
 * two more controls into it would put them inside the frame that ring draws.
 * Out here the box's own measured geometry does not move at all — the box only
 * shifts up by this row's height, which is the property the frames assert.
 *
 * The two ACTIVITY chips join them, and they are the same species as the plan
 * chip rather than a third thing:
 *
 * - the SUBAGENTS chip counts the roster — the children this session has
 *   delegated to and not yet finished with — and the JOBS chip counts the tool
 *   rows (`bash`) the roster deliberately leaves out. Both are buttons on the
 *   plan chip's own control box, both REVEAL their section of the pane, and both
 *   are gated on there being something to count (`docs/composer-activity-chips.md`,
 *   which is the design record and where the rejected alternatives live).
 * - they lead with a STATE MARK instead of the `Info` glyph, and that is the row's
 *   one piece of motion: `SubagentStateIcon` spins a running row and nothing else,
 *   so a chip moves exactly while the work it names is moving. `Info` stays the
 *   plan chip's mark so one glyph in this row still means one thing.
 * - the count gate is the POINT rather than an optimisation: unlike the plan's
 *   `0 to-dos open`, these two answers are not about persisted state —
 *   `frontend.jobs` is swept minutes after a row settles, so a lingering
 *   `0 subagents running` would describe rows that are about to vanish, and it
 *   would put a chip above every composer on every session that never delegated.
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
 */

import { Tooltip } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { CAPPED_BLOCK, CHAT_MEASURE } from "../chat-measure";
import { READING_BUTTON as CHIP_CONTROL } from "../session-status/session-status-strip";
import {
	type ActivityTally,
	LABEL_SEAM,
	type RunDetails,
	activityTally,
	childClause,
	jobClause,
	todoClause,
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
 */
export const planChipLabel = (openTodos: number): string =>
	`${PLAN_ACTION}${LABEL_SEAM}${todoClause(openTodos)}`;

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
	`${SUBAGENT_ACTION}${LABEL_SEAM}${childClause(tally)}`;

export const jobChipLabel = (tally: ActivityTally): string =>
	`${JOB_ACTION}${LABEL_SEAM}${jobClause(tally)}`;

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
	 * A FINISHED plan still shows: `0 to-dos open` is the honest reading of a
	 * complete plan, and it keeps the row's height from changing when the last
	 * item closes.
	 *
	 * The gate is the ITEM count and not the phase count, and the difference is a
	 * real state rather than a hypothetical. `RunDetails.todos` is the PHASE list,
	 * and the model decodes a phase record with no items to a phase with no items —
	 * so `todos.length > 0` calls a plan that arrived as one empty named phase a
	 * plan, and the chip would print `0 to-dos open` for a session that has no
	 * to-dos at all, which reads as a finished plan. `totalTodos` is the item count
	 * over the whole wire list: it is zero only when there is genuinely nothing to
	 * be in the middle of.
	 */
	const showPlan = Boolean(runDetails && runDetails.totalTodos > 0);

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

	if (!showGoal && !showPlan && !children && !jobs) return null;

	const goalLabel = goalDisclosureLabel(goal, goalOpen);
	const planLabel = runDetails ? planChipLabel(runDetails.openTodos) : "";
	const subagentLabel = children ? subagentChipLabel(children) : "";
	const jobLabel = jobs ? jobChipLabel(jobs) : "";
	/*
	 * Whichever chip renders first cancels its own padding, and the count chips are
	 * ONE GROUP now (see the group's own note below): the group is the row's first
	 * item exactly when there is no goal, and inside it the leading chip is the
	 * plan's when a plan renders and the subagents' otherwise.
	 */
	const groupIsFirst = !showGoal;
	const subagentsFirst = !showGoal && !showPlan;
	/*
	 * ...and the jobs chip is first only when NEITHER of the two ahead of it
	 * rendered, which is a different question from "the subagents chip is not the
	 * first": with no goal and no plan, a session holding only tool jobs puts the
	 * jobs chip on the row's content edge and its siblings nowhere.
	 */
	const jobsFirst = subagentsFirst && !children;

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
				<Disclosure
					/*
					 * A FLOOR on the goal's item, which used to be `min-w-0`, and it is
					 * design review round 1's D2 measured rather than preferred: with the
					 * counts as one group below the goal, flex resolves line breaking on
					 * each item's hypothetical size, so this floor is what makes the row
					 * wrap the WHOLE count group under the goal instead of letting the two
					 * share a squeezed line. At the 240px band the goal then reads
					 * `Goal: Reconcile t…` on its own line where the torn arrangement cut it
					 * to `Goal: Rec…` and pushed the plan chip to the opposite margin — the
					 * wider column was the worse arrangement. 140px is the width at which
					 * the chip still says something: chevron, `Goal:` and this floor's
					 * padding measure ~75px of fixed ink, leaving ~65px of snippet.
					 */
					className={cn("min-w-[140px] flex-1", COLUMN_GOAL)}
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
						"w-fit max-w-full text-ink-muted hover:bg-accent-wash hover:text-ink focus-visible:outline-offset-1!",
						// The row's first-chip rule, applied by the row to whichever chip renders
						// first; see FIRST_CHIP. The goal renders first whenever it is present.
						FIRST_CHIP,
					)}
					triggerLabel={goalLabel}
					triggerTooltip={goalLabel}
					onOpenChange={setGoalOpen}
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
			{(showPlan || children || jobs) && (
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
								{todoClause(runDetails.openTodos)}
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
					 * control with two meanings. Two species of chip now share this row and the
					 * grammar is one glyph one meaning: `Info` means "this opens the run pane"
					 * and only the plan chip wears it, because the activity chips wear a STATE
					 * MARK instead (below).
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
								 * the state reaches a screen reader through the clause's `running`.
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
