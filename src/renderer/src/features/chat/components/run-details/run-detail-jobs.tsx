/**
 * The Jobs section of the run panel (`docs/composer-activity-chips.md` § 4, and
 * `docs/run-sidebar.md`'s section list).
 *
 * The session's third live list, and the one the pane did not have: a backgrounded
 * shell (`tools/builtin.py:2186`) and a background `eval` (`tools/eval.py:937`)
 * are both registered as `type: "bash"` (`harness/jobs.py:216`), and the roster
 * deliberately excludes those rows — it is a filter on `task`
 * (`run-detail-model.ts`'s partition), and round 1's roster painted a child's own
 * `sleep 150` as a peer subagent above the child it belonged to. The composer's
 * jobs chip counts them and points here, so "here" has to be a section that can
 * draw them: a count with no list behind it is the defect this file exists to
 * avoid.
 *
 * **Quiet, non-interactive rows, and that is a fact rather than a preference.** A
 * tool row carries no `session_id` (`childOpenable` is false for every one of
 * them), so there is no conversation to open a reader on and nothing here to
 * press: no hover ground, no pointer cursor, no button role — the roster's own
 * DEGRADED row, which is the shape it takes against a backend that cannot open a
 * child either. A lit row that opens nothing is worse than a quiet one.
 *
 * **One line per row.** The roster gives a child a second line because a
 * delegation's activity is the single most useful live datum in that list; a tool
 * row's is the command it is running, which its label already is, and the
 * section's job is a status list beside the plan and the roster rather than a
 * third reading pane. What a row states is therefore: label, state mark, state in
 * words (the mark is `aria-hidden`), and the numbers run — the elapsed clock being
 * the one figure that MOVES here, which is why the pane's clock re-measures this
 * list too (`run-details-clock.ts`).
 *
 * **Open rows only.** `openJobs` is what gates the panel section
 * (`run-details-panel.tsx`), and it is the same rule the composer's chip uses, so
 * the section draws exactly the rows its own count claims. `frontend.jobs` is
 * swept minutes after a row settles; a settled row here would be a row that the
 * label still calls `running`, under a tally that says otherwise.
 *
 * **The video row family, and its cancel.** The partition admits the video
 * lane's detached jobs (`type: "video"`, contract §1.7 G1) beside the shell's
 * — they are the same kind of thing: a runtime job with no child conversation
 * to open — and the ONE interactive control this section has rides those rows:
 * `Cancel` on any open video row, wired to the pane body's confirmation
 * (`use-job-cancel.ts`) and from there to the runtime's own job-cancel rail.
 * The other families deliberately get no control: a running shell job is left
 * alone by design (backgrounding exists so a build survives,
 * `desktop_sessions.py`'s own note), and a task row's stop is a different
 * mechanism with its own instrument — drawing one here would be inventing a
 * second stop. The control is VISIBLE AT REST at the 24px hit floor, the
 * wake line's and monitors' own rule: the pane is a management surface, so
 * the affordance is present rather than hidden until hover.
 */

import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { Ref } from "react";
import { type JobCancelSection, jobRowCanCancel } from "./job-controls-model";
import {
	type RunDetails,
	type SubagentRow,
	isOpenRow,
	subagentTally,
	tallyBudget,
	tallyFitsInline,
} from "./run-detail-model";
import { SubagentRowBody } from "./run-detail-row-parts";

/**
 * One tool row, and the video family's one control.
 *
 * `data-run-panel-row` is the roster's own hook, and it is the same hook here on
 * purpose: both sections are lists of rows from one ledger, and a capture rig or
 * a QA pass that can address one can address the other. The row itself comes from
 * `run-detail-row-parts.tsx` with no second line, so this list and the roster
 * cannot come to have two row heights. The control is a SIBLING of the body
 * rather than crowded into it: the body's grammar is every list's (§ the shared
 * row contract), and a control one list has is that list's own.
 */
const JobRow = ({
	row,
	cancel,
}: {
	row: SubagentRow;
	cancel: JobCancelSection;
}) => {
	useI18nLocale();
	return (
		<li
			data-run-panel-row={row.id}
			className={cn("flex items-start gap-2 px-3 py-1.5")}
		>
			<SubagentRowBody row={row} />
			{jobRowCanCancel(row) && (
				<Button
					variant="ghost"
					size="sm"
					data-job-cancel={row.id}
					/* The accessible name names the act and the row, the wakes' rule. */
					aria-label={`Cancel ${row.label}`}
					/* The danger wash on hover is the wake line's own cancel ink; nothing
				   lifts, and the focus ring is the shared Button's own. `h-6` (24px)
				   is the HIT floor rather than the row's own rhythm. */
					className={cn(
						"h-6 shrink-0 px-1.5 hover:bg-danger-wash hover:text-danger",
					)}
					onClick={(event) => {
						/*
						 * The rect rides the request, captured HERE at the press: the card
						 * is anchored to a frozen box rather than to this button, because
						 * the row can unmount under the canonical re-read
						 * (`use-job-cancel.ts`).
						 */
						const rect = event.currentTarget.getBoundingClientRect();
						cancel.request(row, {
							left: rect.left,
							top: rect.top,
							bottom: rect.bottom,
							right: rect.right,
						});
					}}
				>
					{t("ui.common.actions.cancel")}
				</Button>
			)}
		</li>
	);
};

export const RunDetailJobs = ({
	details,
	paneWidth,
	sectionRef,
	cancel,
}: {
	details: RunDetails;
	/** The pane's own width, which is what the tally's budget is measured against. */
	paneWidth: number;
	/**
	 * The section's own element, for a caller that has to bring it into view.
	 *
	 * Held by the PANE rather than by this section, for the reason
	 * `run-detail-todos.tsx` states at its own ref: the request comes from outside
	 * the pane entirely (the composer's jobs chip) and the pane is what consumes
	 * it. Nothing here reads the ref; the section is simply where the node exists.
	 */
	sectionRef?: Ref<HTMLElement>;
	/**
	 * The pane body's cancel interaction (`use-job-cancel.ts`), threaded down as
	 * the wakes' and monitors' own sections take theirs: the confirmation and
	 * the write live ABOVE this section's mount gate (the list churns under the
	 * canonical re-read a cancel fires), and the section stays presentational —
	 * it renders rows from `details` and asks `request` on a press.
	 */
	cancel: JobCancelSection;
}) => {
	/*
	 * The slice is taken with the MODEL's predicate rather than a local
	 * `status !== "done"`, so this section and `openJobs` — the number the chip
	 * prints and the panel's own gate — cannot come to different answers about
	 * which rows are still running.
	 */
	const rows = details.jobs.filter(isOpenRow);
	useI18nLocale();
	return (
		<section ref={sectionRef} className={cn("flex flex-col pb-1.5")}>
			{/*
			 * Label left, tally right, on one line: the subagents and to-dos
			 * sections' own arrangement (`§4.1`). Right-aligning it is what gives the
			 * tally the width its shedding rule is about.
			 */}
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				<span className={cn("shrink-0 text-meta text-ink-muted")}>
					{t("ui.chat.run_details.jobs")}
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
					)}
				>
					{/*
					 * The roster's own tally function, over this list: it is generic over
					 * `SubagentRow[]` and its eviction ladder is the state vocabulary both
					 * lists share (`activityMark`'s ladder, one over). Reusing it is also
					 * what keeps the two sections' tallies in the same voice — `1 running`
					 * above a row whose mark says the same thing.
					 */}
					{tallyFitsInline(paneWidth)
						? subagentTally(rows, tallyBudget(paneWidth))
						: null}
				</span>
			</div>
			<ul className={cn("flex flex-col")}>
				{rows.map((row) => (
					<JobRow key={row.id} row={row} cancel={cancel} />
				))}
			</ul>
		</section>
	);
};
