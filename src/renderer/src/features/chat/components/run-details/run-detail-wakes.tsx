/**
 * The Wakes section of the run panel: the session's armed wake schedules.
 *
 * The pane's fifth section, and the one that answers a question nothing in this
 * app could answer before: **a session can be armed, and a wake fires with no
 * keystroke**. The conversation shows a wake ARRIVING as a receipt row
 * (`receipt-row-model.ts`'s `wakeReceiptHeadline`), which is a fact about the
 * past; what was missing is the standing list of what will fire and when. The
 * TUI has had it since the band landed (`local_operator/tui/widgets/wake_panel.py`,
 * whose docblock states the same problem for the terminal), and this is that
 * surface's desktop counterpart: the composer's wake chip counts the same
 * schedules and points here (`docs/composer-activity-chips.md` § 4 is the Jobs
 * section's identical argument — a count with no list behind it is the defect).
 *
 * **One row per SCHEDULE, not per occurrence**, which is the band's own rule: a
 * wake that fires hourly for a week is one schedule (`w1`) with one next-due
 * instant, so it gets one row naming when it next fires and what it will say.
 * Re-listing a recurrence per trigger would fill the pane with the same wake.
 *
 * **Soonest first.** The one question this list answers is "what fires next", so
 * the order is the due instant's, which the model decides
 * (`run-detail-model.ts`'s `deriveWakes`) and not this file's.
 *
 * **Absence is not a state.** Zero wakes renders NO section — no empty heading,
 * no placeholder — and the composer's chip is gated on the same list, so the two
 * surfaces are absent together. That is the panel's own rule for every section
 * and it is load-bearing twice over here: `frontend.wakes` is empty on every
 * session that has never armed one, which is nearly all of them.
 *
 * **Quiet, non-interactive rows**, and that is a fact rather than a preference: a
 * schedule is read here and cancelled by the agent (`wake({op:"cancel"})`), so
 * there is nothing in this pane to press. No hover ground, no pointer cursor, no
 * button role — the Jobs section's own DEGRADED row, which is what the TUI's
 * band is too: a readout.
 *
 * **Nothing here ticks.** The whole section takes the UNTIMED model, like the
 * plan and unlike the roster and the jobs list: a wake carries an absolute local
 * instant and a cadence, neither of which is a function of when it is read. There
 * is deliberately no "in 42m" relative form — a relative label would have to be
 * repainted to stay true, and `run-details-clock.ts` exists to keep exactly that
 * kind of repaint off surfaces that do not need it.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { AlarmClock } from "lucide-react";
import type { Ref } from "react";
import {
	type RunDetails,
	type WakeRow,
	visibleWakes,
	wakeClause,
} from "./run-detail-model";

/**
 * One armed schedule: when it next fires, how often, and what it will say.
 *
 * The mark column is the pane's grid — `pl-3`, a 16px box, an 8px gap, the same
 * one the plan's items and the roster's rows put their own marks in — so the
 * three lists' text starts on one column. The glyph is the same `AlarmClock` the
 * composer's chip leads with, so one glyph reads as "wake" on both surfaces.
 *
 * It is a MARK and not a STATE, which is why it is one ink on every row: every
 * row here is armed by definition, so there is no state for a second ink to
 * distinguish (the roster's `SubagentStateIcon` exists because a child's nine
 * states are nine different facts). `aria-hidden`, because the section's heading
 * and the row's own cadence already say what it would.
 *
 * `data-run-panel-row` is the roster's own hook and the Jobs row carries it too,
 * on purpose: all three are lists of rows from one pane, so a capture rig or a QA
 * pass that can address a child's row can address a schedule's.
 *
 * The hook carries the row's `id` verbatim, so two schedules sharing an id would
 * render two elements with one hook value (QA round 1's Q2). That is not reachable
 * from the shipping paths — the scheduler mints the ids and the wire is the map the
 * backend keys schedules by — and it is deliberately not defended against here: the
 * reader's trust boundary is the payload, and a duplicate id is a backend defect
 * that a de-duplicating hook would HIDE from the rig that exists to notice it.
 */
const WakeRowView = ({ row }: { row: WakeRow }) => (
	<li data-run-panel-row={row.id} className={cn("flex gap-2 px-3 py-0.5")}>
		<span className={cn("pt-0.5")}>
			<span
				aria-hidden={true}
				className={cn(
					"flex size-4 shrink-0 items-center justify-center text-ink-dim",
				)}
			>
				<AlarmClock className={cn("size-4")} />
			</span>
		</span>
		<div className={cn("flex min-w-0 flex-1 flex-col")}>
			<div className={cn("flex items-baseline gap-1.5")}>
				{/*
				 * The due label first, which is the TUI band's own order
				 * (`wake_panel.py`: `due_label · every — message`) and the order of the
				 * question a reader arrives with.
				 *
				 * `min-w-0 truncate` here and `shrink-0` on the cadence is the row's
				 * recorded yield order one line down: the label is the longer string and
				 * the one that can clip, so it is the one that gives, and the cadence —
				 * a bounded figure — is never cut mid-word. The label's whole text has a
				 * second home in the `title`, which is the app's rule for a value that
				 * can be clipped (`session-status-strip.tsx` states it for the model
				 * name); it is clipped only at the pane's 320px floor, where a full
				 * `Sep 15 2026 9:26 AM EDT · every 1h30m` no longer fits beside the
				 * mark column.
				 */}
				{row.dueLabel && (
					<span
						className={cn("min-w-0 truncate text-ink-muted text-meta")}
						title={row.dueLabel}
					>
						{row.dueLabel}
					</span>
				)}
				<span className={cn("shrink-0 text-ink-dim text-meta")}>
					{row.dueLabel ? `· ${row.cadence}` : row.cadence}
				</span>
			</div>
			{/*
			 * The prompt, on the row's second line, which is the TUI's own layout for
			 * a wake's message (`— {message}` after the schedule's facts).
			 *
			 * `line-clamp-2` with an `sr-only` twin and a `title`, rather than the
			 * single clipped line this could have been: the message is the one
			 * unbounded, authored string on the row, and the pane's convention for
			 * those is exactly this pair (`run-detail-todos.tsx`'s blocked reason, the
			 * roster's activity line). The row grows with it — 16px per line — and a
			 * message longer than two lines still exists in full for assistive tech and
			 * on hover, so a mouse is not the only way to read what a wake will say.
			 *
			 * `ink-muted` rather than the row's `ink-dim`: this is the part that says
			 * WHAT the wake is for, and it is the part a reader is deciding about.
			 */}
			{row.message && (
				<>
					<span
						aria-hidden={true}
						className={cn("line-clamp-2 text-ink-muted text-meta leading-4")}
						title={row.message}
					>
						{row.message}
					</span>
					<span className={cn("sr-only")}>{row.message}</span>
				</>
			)}
		</div>
	</li>
);

export const RunDetailWakes = ({
	details,
	sectionRef,
}: {
	details: RunDetails;
	/**
	 * The section's own element, for a caller that has to bring it into view.
	 *
	 * Held by the PANE rather than by this section, for the reason
	 * `run-detail-todos.tsx` states at its own ref: the request that needs it comes
	 * from outside the pane entirely (the composer's wake chip) and the pane is what
	 * consumes it. Nothing here reads the ref; the section is simply where the node
	 * exists.
	 */
	sectionRef?: Ref<HTMLElement>;
}) => {
	const { rows, hidden } = visibleWakes(details.wakes);
	return (
		<section ref={sectionRef} className={cn("flex flex-col pb-1.5")}>
			{/*
			 * Label left, tally right, on one line: the four sections' own arrangement
			 * (`§4.1`). The tally is `wakeClause` — the SAME string the composer's chip
			 * carries — so the count above the composer and the count in the pane it
			 * opens cannot come to spell one number two ways, which is the rule the plan
			 * chip's `todoClause` sets and the defect (`1 wake armeds`) a second
			 * pluralisation would produce.
			 */}
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				<span className={cn("shrink-0 text-meta text-ink-muted")}>Wakes</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
					)}
				>
					{wakeClause(details.wakes.length)}
				</span>
			</div>
			<ul className={cn("flex flex-col")}>
				{rows.map((row) => (
					<WakeRowView key={row.id} row={row} />
				))}
				{/*
				 * The overflow marker, and it is a STATEMENT rather than a control, for
				 * the plan's reason (`run-detail-todos.tsx`): nothing in this pane can
				 * put a shed wake back — the list is what the scheduler holds — so the
				 * count carries no affordance and must not wear the roster's
				 * `Show N more`, which IS a control. The shared `Disclosure` primitive's
				 * `disabled` branch is that row: it keeps the gutter and the row height
				 * of every other disclosure while dressing this one as what it is.
				 *
				 * `pl-9` puts the LI at the row's own text column — the same 12px + 16px + 8px
				 * the plan's shed count uses — and the marker's TEXT then lands 20px inside
				 * that column, because the shared `Disclosure` primitive indents its summary
				 * by its own `ml-5`. Measured in `wakes-many`: the marker's ink starts at
				 * x=918 where the rows' labels start at x=897. That is not a defect to fix on
				 * screen: the plan's shed row is the same component with the same classes, so
				 * the pane is internally consistent and the 20px is what keeps the marker from
				 * reading as another row of the list. (Agent review round 1's D6 is right that
				 * the earlier version of this comment claimed the column was shared exactly;
				 * the arithmetic above is the correction.)
				 *
				 * The wording is the row's own voice (`N hidden` is the plan's, `Show N
				 * more` is the roster's): "more wakes" names the thing counted, because a
				 * bare `2 more` under a section whose rows are schedules could be read as
				 * two more occurrences of the row above it.
				 */}
				{hidden > 0 && (
					<li className={cn("pr-3")}>
						<Disclosure
							disabled={true}
							summary={`${hidden} more wakes`}
							className={cn("pl-9 text-meta")}
						/>
					</li>
				)}
			</ul>
			{/*
			 * WHO CAN ACT ON THIS LIST, said once, in the list's own voice (UX round 1's
			 * U3). The rows are a readout and deliberately not controls — the cancel is
			 * the AGENT's (`wake({op:"cancel"})`), and before this section existed a wake
			 * was invisible, so this is the first surface where a reader forms the intent
			 * to stop one. Leaving the flow to end in silence is the same defect as a
			 * count with nothing behind it; the fix is copy rather than a control the
			 * surface should not have.
			 *
			 * It sits under the rows rather than in the heading row so the heading keeps
			 * the four sections' shared label-left/tally-right shape, and it renders only
			 * when there is a list to act on — an empty section would be explaining a
			 * control over nothing.
			 */}
			{details.wakes.length > 0 && (
				<p className={cn("px-3 pt-1 text-meta text-ink-dim")}>
					To stop a wake, ask the agent to cancel it.
				</p>
			)}
		</section>
	);
};
