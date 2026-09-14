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
 *   defect this codebase's review history keeps catching.
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
import { useState } from "react";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { CHAT_MEASURE } from "../chat-measure";
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

	if (!showGoal && !showPlan) return null;

	const goalLabel = goalDisclosureLabel(goal, goalOpen);
	const planLabel = runDetails ? planChipLabel(runDetails.openTodos) : "";

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
						"w-fit max-w-full -ml-1.5 text-ink-muted hover:bg-accent-wash hover:text-ink focus-visible:outline-offset-1!",
					)}
					triggerLabel={goalLabel}
					triggerTooltip={goalLabel}
					onOpenChange={setGoalOpen}
					summary={
						<span className={cn("flex min-w-0 items-center gap-1")}>
							{/*
							 * At the column floor the label takes itself out of the pixels
							 * and stays in the accessibility tree — `sr-only`, never
							 * `hidden` — which is what lets the chip shrink to its chevron
							 * so the count is never squeezed. The working-directory chip's
							 * own device, for its reason.
							 */}
							<span className={cn("@max-[240px]/chatcol:sr-only")}>
								{GOAL_LABEL}
							</span>
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
							"max-h-32 overflow-y-auto font-sans text-body-sm text-ink-muted leading-5 whitespace-pre-wrap break-words",
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
						className={CHIP_CONTROL}
					>
						{todoClause(runDetails.openTodos)}
					</button>
				</Tooltip>
			)}
		</div>
	);
};
