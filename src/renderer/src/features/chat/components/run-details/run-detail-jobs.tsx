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
 */

import { cn } from "@shared/lib/utils";
import type { Ref } from "react";
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
 * One tool row.
 *
 * `data-run-panel-row` is the roster's own hook, and it is the same hook here on
 * purpose: both sections are lists of rows from one ledger, and a capture rig or
 * a QA pass that can address one can address the other. The row itself comes from
 * `run-detail-row-parts.tsx` with no second line, so this list and the roster
 * cannot come to have two row heights.
 */
const JobRow = ({ row }: { row: SubagentRow }) => (
	<li
		data-run-panel-row={row.id}
		className={cn("flex items-start gap-2 px-3 py-1.5")}
	>
		<SubagentRowBody row={row} />
	</li>
);

export const RunDetailJobs = ({
	details,
	paneWidth,
	sectionRef,
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
}) => {
	/*
	 * The slice is taken with the MODEL's predicate rather than a local
	 * `status !== "done"`, so this section and `openJobs` — the number the chip
	 * prints and the panel's own gate — cannot come to different answers about
	 * which rows are still running.
	 */
	const rows = details.jobs.filter(isOpenRow);
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
				<span className={cn("shrink-0 text-meta text-ink-muted")}>Jobs</span>
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
					<JobRow key={row.id} row={row} />
				))}
			</ul>
		</section>
	);
};
