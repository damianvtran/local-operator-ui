/**
 * The Subagents section of the run-details panel (`docs/run-details.md` § 4.1).
 *
 * One row per child. The row is TWO lines, and that is the one place the port
 * departs from the TUI's single-line grammar: the TUI has a full dock band and a
 * fixed-cell terminal to lay a row out in, a 384px popover does not, and the
 * activity string is the single most useful live datum in the list. So it gets
 * its own line rather than being the first thing shed.
 *
 * Every rule that decides WHAT is on a row lives in `run-detail-model.ts`; this
 * file decides only how it is painted.
 */

import { cn } from "@shared/lib/utils";
import {
	Check,
	CirclePause,
	CircleSlash,
	Clock,
	LoaderCircle,
	type LucideIcon,
	RotateCcw,
	X,
} from "lucide-react";
import {
	type ChildStatus,
	type RunDetails,
	type SubagentRow,
	childStateLabel,
	subagentTally,
	visibleSubagents,
} from "./run-detail-model";

/**
 * One mark per state, ported by meaning rather than by codepoint, exactly as
 * `trace/tool-glyphs.ts` ports the TUI's nerd-font table.
 *
 * Two properties are load-bearing and both are `§6.4`'s: **motion is a bonus,
 * never the contract** — running and paused are different SHAPES, so the list
 * survives `prefers-reduced-motion` and survives being looked at by someone who
 * cannot separate the two inks — and **failure is the only colour the section
 * spends**, which is the dock band's own ink law.
 */
const CHILD_ICON: Record<ChildStatus, LucideIcon> = {
	running: LoaderCircle,
	queued: Clock,
	paused: CirclePause,
	interrupted: RotateCcw,
	done: Check,
	cancelled: CircleSlash,
	failed: X,
};

const CHILD_INK: Record<ChildStatus, string> = {
	// `subagent_panel.py:371-391`. The running spinner stays neutral: the accent
	// green is a scarce budget and a child at work has not done anything yet.
	running: "text-ink-muted",
	queued: "text-ink-dim",
	paused: "text-ink-muted",
	// A run cut off by the process ending is not a failure — nothing went wrong —
	// so it takes the muted ink and the rotate mark that says it may be resumable.
	interrupted: "text-ink-muted",
	done: "text-ink-dim",
	cancelled: "text-ink-dim",
	failed: "text-danger",
};

/**
 * Characters the trailing tally may occupy.
 *
 * The panel's width is a constant (`§5`: 384px) so its budget is one too — the
 * measurement this would otherwise need is `384 - 24px padding - the label's own
 * width`, which is what the number below is. The RULE lives in the model
 * (`subagentTally(rows, maxChars)`), because "which fact survives pressure" is
 * arithmetic and belongs where it can be asserted; only the width is a fact
 * about this component.
 */
const TALLY_BUDGET = 44;

const SubagentStateIcon = ({ status }: { status: ChildStatus }) => {
	const Icon = CHILD_ICON[status];
	return (
		<span
			aria-hidden={true}
			className={cn(
				"flex size-4 shrink-0 items-center justify-center",
				CHILD_INK[status],
			)}
		>
			<Icon
				className={cn(
					"size-4",
					// Reduced motion: the glyph holds its frame. Shape already
					// distinguishes it, which is why motion is a bonus and not the
					// contract.
					status === "running" && "motion-safe:animate-spin",
				)}
			/>
		</span>
	);
};

/**
 * The numbers run: role, elapsed, context, cost (`§4.1`).
 *
 * Each figure is omitted when unknown rather than zeroed — see the model — and
 * the segment disappears with it, which is why the seam is rendered BETWEEN
 * segments rather than after each one. Elapsed takes `tabular-nums` so a column
 * of them aligns without a fixed-width slot.
 */
const NumbersRun = ({ row }: { row: SubagentRow }) => {
	const figures: Array<{ key: string; text: string; tabular?: boolean }> = [];
	if (row.role) figures.push({ key: "role", text: row.role });
	if (row.elapsedLabel) {
		figures.push({ key: "elapsed", text: row.elapsedLabel, tabular: true });
	}
	if (row.contextLabel) {
		figures.push({ key: "context", text: row.contextLabel, tabular: true });
	}
	if (row.costLabel) {
		figures.push({ key: "cost", text: row.costLabel, tabular: true });
	}
	if (figures.length === 0) return null;
	return (
		<span
			className={cn(
				"flex shrink-0 items-baseline gap-1 text-meta text-ink-muted",
			)}
		>
			{figures.map((figure, index) => (
				<span key={figure.key} className={cn("flex items-baseline gap-1")}>
					{index > 0 && <span className={cn("text-ink-dim")}>·</span>}
					<span className={cn(figure.tabular && "tabular-nums")}>
						{figure.text}
					</span>
				</span>
			))}
		</span>
	);
};

const SubagentRowView = ({ row }: { row: SubagentRow }) => {
	// Line 2 is the live datum while the child works and the outcome's first line
	// once it has failed; a settled child has neither, matching the TUI's blanked
	// activity (`:653-660`) and keeping the settled tail of the list quiet.
	const detail = row.activity ?? row.errorLine;
	return (
		<li
			className={cn(
				// A colour step and nothing else: nothing lifts, scales or translates
				// on hover (`branding.md` § 5). The ground is full-bleed so the rows
				// read as one list rather than as text floating in the panel.
				"flex gap-2 px-3 py-1.5 hover:bg-accent-wash",
			)}
		>
			<span className={cn("pt-0.5")}>
				<SubagentStateIcon status={row.status} />
			</span>
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				<div className={cn("flex items-baseline gap-2")}>
					<span
						className={cn("min-w-0 flex-1 truncate text-body-sm text-ink")}
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
					<span className={cn("sr-only")}>{childStateLabel(row.status)}</span>
					<NumbersRun row={row} />
				</div>
				{detail && (
					<span
						className={cn("truncate text-meta text-ink-dim")}
						title={detail}
					>
						{detail}
					</span>
				)}
			</div>
		</li>
	);
};

export const RunDetailSubagents = ({ details }: { details: RunDetails }) => {
	const { rows, hidden } = visibleSubagents(details.subagents);
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
					<SubagentRowView key={row.id} row={row} />
				))}
				{/* Disclosed, never silently dropped (`§2.1`): the count is the only
				 * thing that says the list is a slice. */}
				{hidden > 0 && (
					<li className={cn("px-3 pt-1 text-meta text-ink-dim")}>
						{`+${hidden} more`}
					</li>
				)}
			</ul>
		</section>
	);
};
