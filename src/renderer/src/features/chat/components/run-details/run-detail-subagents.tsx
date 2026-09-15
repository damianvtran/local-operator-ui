/**
 * The Subagents section of the run panel (`docs/run-sidebar.md` § 4).
 *
 * One row per child. The row is TWO lines, and that is the one place the port
 * departs from the TUI's single-line grammar: the TUI has a full dock band and a
 * fixed-cell terminal to lay a row out in, a 420px pane does not, and the
 * activity string is the single most useful live datum in the list. So it gets
 * its own line rather than being the first thing shed.
 *
 * Three things changed with the pane, and all three are § 4's:
 *
 * 1. **The row is a control.** Clicking it opens that child's reader; `Enter`/
 *    `Space` on a focused row does the same, because the TUI's row is
 *    `can_focus` with `Binding("enter", ...)` and a mouse-only affordance would
 *    make one of the two a guess (`subagent_panel.py:1341-1343`).
 * 2. **The row HAS a hover ground** — `bg-elevated`, the role `branding.md` names
 *    for a hovered row. The old rule ("no row has a hover ground, because nothing
 *    here is clickable") was right and is inverted by this change; the to-do rows
 *    keep none, so the two lists no longer have to agree.
 * 3. **`+N more` is a real disclosure control**, not an inert line: a child behind
 *    the cap would otherwise be unreachable, and a roster where six rows are
 *    reachable and the seventh silently is not is the defect, not the fix.
 *
 * Every rule that decides WHAT is on a row lives in `run-detail-model.ts`; this
 * file decides only how it is painted.
 */

import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { Ref } from "react";
import {
	type RunDetails,
	type SubagentRow,
	childOpenable,
	panelSlice,
	subagentTally,
	tallyBudget,
} from "./run-detail-model";
import { SubagentRowBody } from "./run-detail-row-parts";

/**
 * The row's second line (`§4.1`), which is one of two different kinds of text.
 * *
 * Both variants take `ink-muted`, where the activity line used to take
 * `ink-dim`: at 12px on the panel ground `dim` measures ≈4.7:1 — the tightest
 * text on the surface — and it is the ink the TUI deliberately moved AWAY from
 * for this same field (`subagent_panel.py:1069-1071`).
 *
 * `errorLine` is MACHINE VOICE: `font-mono`, matching every other exception the
 * app prints, kept VERBATIM — a fabricated translation of an exception is a
 * claim nobody can check — and wrapped to at most two lines so the identifier
 * survives.
 */
const DetailLine = ({ row }: { row: SubagentRow }) => {
	if (row.errorLine) {
		return (
			<span
				className={cn(
					"line-clamp-2 font-mono text-ink-muted text-mono-sm leading-4",
				)}
				title={row.errorLine}
			>
				{row.errorLine}
			</span>
		);
	}
	if (row.activity) {
		return (
			<span
				className={cn("truncate text-ink-muted text-meta leading-4")}
				title={row.activity}
			>
				{row.activity}
			</span>
		);
	}
	return null;
};

const SubagentRowView = ({
	row,
	interactive,
	onOpen,
}: {
	row: SubagentRow;
	/**
	 * Whether the SECTION's children can be opened at all.
	 *
	 * FALSE against a backend that does not advertise `subagent_transcript`
	 * (`§ 10.2`): the roster still renders — it is `frontend.jobs`, which predates
	 * this change — and the row renders without an open affordance: no hover
	 * ground, no pointer cursor, no button role. A lit row that opens nothing is
	 * worse than a quiet one, and the panel's chrome says why in one line.
	 *
	 * The capability is not the whole question: `childOpenable(row)` is the ROW's
	 * own half, because a job the wire gives no `session_id` has no conversation
	 * to address and a control that opens a reader on nothing is the same lie one
	 * level down.
	 */
	interactive: boolean;
	onOpen: (id: string) => void;
}) => {
	/*
	 * The row's content, shared verbatim by both branches so the interactive and
	 * the degraded row cannot drift: the difference between them is the control
	 * wrapper, not what a child's row says — and the same component is the Jobs
	 * section's row, so the three lists that draw a row draw ONE row
	 * (`run-detail-row-parts.tsx`).
	 */
	const body = <SubagentRowBody row={row} detail={<DetailLine row={row} />} />;

	/*
	 * `py-1.5` with the two pinned line-heights below is what makes the row
	 * heights exact (`§5`): 12 + 20 = 32px single-line, 12 + 20 + 16 = 48px with a
	 * second line, 12 + 20 + 32 = 64px on a wrapped failure.
	 *
	 * `py-1.5` is 6px, off `§5`'s 4px ramp, and that is deliberate rather than
	 * drift: the 32/48/64 ladder above needs 6px of vertical padding to land on
	 * whole pixels (4px would give 28/44/60, and 8px would give 36/52/68 — two
	 * heights the record does not have). Recorded in `docs/run-sidebar.md` §8 as a
	 * named exception so the next reader does not "fix" the ramp by breaking the
	 * row height.
	 */
	if (!interactive || !childOpenable(row)) {
		return (
			<li
				data-run-panel-row={row.id}
				className={cn("flex items-start gap-2 px-3 py-1.5")}
			>
				{body}
			</li>
		);
	}
	return (
		<li data-run-panel-row={row.id} className={cn("flex flex-col")}>
			{/*
			 * A full-width BUTTON inside the `li`, not a clickable `li`: the row is
			 * a control that must be a tab stop with an accessible name and the
			 * app's `outline` focus ring, and hand-rolling that on a list item is
			 * how a control ends up unreachable by keyboard. The button carries no
			 * `aria-label`: its own text content is the name, which is the row's
			 * label, state word and numbers — exactly what `§8` asks the accessible
			 * name to be.
			 */}
			<button
				type="button"
				onClick={() => onOpen(row.id)}
				className={cn(
					"flex items-start gap-2 px-3 py-1.5 text-left",
					"cursor-pointer transition-colors duration-fast hover:bg-elevated",
				)}
			>
				{body}
			</button>
		</li>
	);
};

export const RunDetailSubagents = ({
	details,
	expanded,
	onToggleExpanded,
	onOpenChild,
	interactive,
	paneWidth,
	sectionRef,
}: {
	details: RunDetails;
	/** Whether the disclosure has been opened, hoisted to the pane (§ 4). */
	expanded: boolean;
	onToggleExpanded: () => void;
	onOpenChild: (id: string) => void;
	interactive: boolean;
	/**
	 * The section's own element, for a caller that has to bring it into view.
	 *
	 * Held by the PANE rather than by this section, for the reason
	 * `run-detail-todos.tsx` states at its own ref: the request comes from outside
	 * the pane entirely (the composer's subagents chip) and the pane is what
	 * consumes it. Nothing here reads the ref; the section is simply where the
	 * node exists.
	 */
	sectionRef?: Ref<HTMLElement>;
	/**
	 * The pane's own width, which is what the tally's budget is measured against.
	 *
	 * Past the pane rather than read from the preference store HERE, for the
	 * reason the panel's whole geometry is (`chat-content.tsx`): the width the
	 * pane is actually drawn at is the caller's (`minWidth` + `width` on the pane
	 * wrapper), and a component that read the store itself could disagree with
	 * the pane it sits in at the window floor.
	 */
	paneWidth: number;
}) => {
	/*
	 * The rows come from the model's `panelSlice`, never from a local narrowing:
	 * the acknowledgement predicates count failures out of the SAME call, so a
	 * filter or cap applied here would leave the `danger` dot answering a slice
	 * this section does not render. The pairing is pinned by source text in
	 * `scripts/run-detail-model.test.mjs` from both ends.
	 *
	 * The cap is the only thing the disclosure changes: the priority rule, the
	 * failure reservation and the tie-break are untouched, and the expanded list
	 * is rendered in the same order (`§ 4`, item 3).
	 */
	const { rows, hidden } = panelSlice(
		details.subagents,
		expanded ? details.subagents.length : undefined,
	);
	return (
		<section ref={sectionRef} className={cn("flex flex-col pb-1.5")}>
			{/*
			 * Label left, tally right, on one line: "the section label with a quiet
			 * trailing tally" (`§4.1`). Right-aligning it is what gives the tally the
			 * width its shedding rule is about, and it keeps two panels' tallies in
			 * the same column when a run has both sections.
			 */}
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				<span className={cn("shrink-0 text-meta text-ink-muted")}>
					Subagents
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
					)}
				>
					{subagentTally(details.subagents, tallyBudget(paneWidth))}
				</span>
			</div>
			<ul className={cn("flex flex-col")}>
				{rows.map((row) => (
					<SubagentRowView
						key={row.id}
						row={row}
						interactive={interactive}
						onOpen={onOpenChild}
					/>
				))}
			</ul>
			{/*
			 * The disclosure, and it is a CONTROL now. It states how many children
			 * it holds — the old inert line's whole job — and it is the only way to
			 * reach them, which is what makes it a button rather than a footnote.
			 * `w-full` and left-aligned: it is a row of the list it extends, and a
			 * centred chip would read as a footer of the section instead.
			 *
			 * "Show 3 more" is the phrasing every OTHER expander in this pane uses
			 * for the same job (`N more lines` in the reader's brief). The plan's
			 * shed count is phrased `N hidden` instead, because it is a statement
			 * rather than a control — see `run-detail-todos.tsx`.
			 */}
			{hidden > 0 && (
				<Button
					variant="ghost"
					size="sm"
					className={cn("mx-3 mt-1 justify-start text-ink-dim")}
					onClick={onToggleExpanded}
					data-run-panel-disclosure={expanded ? "expanded" : "collapsed"}
				>
					{`Show ${hidden} more`}
				</Button>
			)}
		</section>
	);
};
