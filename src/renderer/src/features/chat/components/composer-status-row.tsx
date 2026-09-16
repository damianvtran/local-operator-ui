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
 * here counts anything: the plan's number is `RunDetails.openTodos`, off the one
 * derivation `chat-page.tsx` already makes for the pane and the header trigger,
 * spelled by the model's own `todoClause`.
 */

import { Tooltip } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { CAPPED_BLOCK, CHAT_MEASURE } from "../chat-measure";
import { READING_BUTTON as CHIP_CONTROL } from "../session-status/session-status-strip";
import { LABEL_SEAM, type RunDetails, todoClause } from "./run-details";

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
};

export const ComposerStatusRow = ({
	frontend,
	runDetails,
	isSmallView = false,
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

	if (!showGoal && !showPlan) return null;

	const goalLabel = goalDisclosureLabel(goal, goalOpen);
	const planLabel = runDetails ? planChipLabel(runDetails) : "";

	return (
		<div
			data-composer-status-row=""
			className={cn(
				CHAT_MEASURE,
				"flex items-start gap-x-2 gap-y-0.5",
				/*
				 * The horizontal inset and the container-keyed track are the alert's
				 * own, for the alert's reason: two lines that sit above the same box
				 * share its outer edge, or one of them reads as unrelated chrome. The
				 * bottom padding is this row's gap to whatever follows, in the same
				 * step, because the form itself is a bare `w-full` and owns no gap.
				 */
				isSmallView ? "px-2 pb-1" : "px-4 pb-2",
				"@max-[240px]/chatcol:flex-col",
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
					className={cn("min-w-0 flex-1", COLUMN_GOAL)}
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
						className={cn(CHIP_CONTROL, showGoal ? undefined : FIRST_CHIP)}
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
		</div>
	);
};
