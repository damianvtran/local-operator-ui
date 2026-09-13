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
import {
	type RunDetails,
	type SubagentRow,
	childStateLabel,
	panelSlice,
	subagentTally,
} from "./run-detail-model";
import { NumberRun, SubagentStateIcon } from "./run-detail-row-parts";

/**
 * Characters the trailing tally may occupy.
 *
 * The panel's default width is a constant (`§7`: 420px) so its budget is one too
 * — the measurement this would otherwise need is `420 - 24px padding - the
 * label's own width`. The RULE lives in the model
 * (`subagentTally(rows, maxChars)`), because "which fact survives pressure" is
 * arithmetic and belongs where it can be asserted; only the width is a fact
 * about this component.
 */
const TALLY_BUDGET = 48;

/**
 * The row's second line (`§4.1`), which is one of two different kinds of text.
 *
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
	 * Whether this child can be opened at all.
	 *
	 * FALSE against a backend that does not advertise `subagent_transcript`
	 * (`§ 9.5`): the roster still renders — it is `frontend.jobs`, which predates
	 * this change — and the row renders without an open affordance: no hover
	 * ground, no pointer cursor, no button role. A lit row that opens nothing is
	 * worse than a quiet one, and the panel's chrome says why in one line.
	 */
	interactive: boolean;
	onOpen: (id: string) => void;
}) => {
	/*
	 * The row's content, shared verbatim by both branches so the interactive and
	 * the degraded row cannot drift: the difference between them is the control
	 * wrapper, not what a child's row says.
	 */
	const body = (
		<>
			<span className={cn("pt-0.5")}>
				<SubagentStateIcon status={row.status} />
			</span>
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				<div className={cn("flex items-baseline gap-2")}>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-body-sm text-ink leading-5",
						)}
						title={row.label}
					>
						{row.label}
					</span>
					{/*
					 * The state in words, for a reader who cannot see the mark.
					 *
					 * The glyph is `aria-hidden` — it is decoration to assistive tech —
					 * so without this the row announced a label and a row of numbers and
					 * never whether the child was still going or had failed, which is
					 * the one fact the row exists to carry (`§6.4`).
					 */}
					<span className={cn("sr-only")}>{childStateLabel(row)}</span>
					<NumberRun row={row} />
				</div>
				<DetailLine row={row} />
			</div>
		</>
	);

	/*
	 * `py-1.5` with the two pinned line-heights below is what makes the row
	 * heights exact (`§5`): 12 + 20 = 32px single-line, 12 + 20 + 16 = 48px with a
	 * second line, 12 + 20 + 32 = 64px on a wrapped failure.
	 */
	if (!interactive) {
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
}: {
	details: RunDetails;
	/** Whether the disclosure has been opened, hoisted to the pane (§ 4). */
	expanded: boolean;
	onToggleExpanded: () => void;
	onOpenChild: (id: string) => void;
	interactive: boolean;
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
		<section className={cn("flex flex-col pb-1.5")}>
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
					{subagentTally(details.subagents, TALLY_BUDGET)}
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
