/**
 * The row parts the roster and the child reader share.
 *
 * Extracted rather than duplicated, and that is the whole reason this file
 * exists: the reader's facts row is the ROSTER ROW'S GRAMMAR re-used as a page
 * header (`docs/run-sidebar.md` § 5.2), so the state mark's table and the numbers
 * run have to be ONE table. Two copies of a nine-state glyph map is two places
 * for a state to lose its mark, which is the class of defect the roster's own
 * comment block spends a paragraph on.
 *
 * Every rule that decides WHAT is on the row lives in `run-detail-model.ts`;
 * this file decides only how it is painted.
 */

import { cn } from "@shared/lib/utils";
import {
	Check,
	CircleDashed,
	CircleHelp,
	CirclePause,
	CircleSlash,
	Clock,
	LoaderCircle,
	type LucideIcon,
	RotateCcw,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	type ChildStatus,
	type SubagentRow,
	childStateLabel,
} from "./run-detail-model";

/**
 * One mark per state, ported by meaning rather than by codepoint, exactly as
 * `trace/tool-glyphs.ts` ports the TUI's nerd-font table. `status_glyph` has a
 * mark for the pause circle and no branch at all for `gone` or an unrecognised
 * word — both fall through to its completed check — and all three have their
 * own mark here.
 *
 * Two properties are load-bearing and both are `§6.4`'s: **motion is a bonus,
 * never the contract** — running and interrupted are different SHAPES, so the
 * list survives `prefers-reduced-motion` and survives being looked at by someone
 * who cannot separate the two inks — and **failure is the only colour the
 * section spends**, which is the dock band's own ink law.
 */
export const CHILD_ICON: Record<ChildStatus, LucideIcon> = {
	running: LoaderCircle,
	queued: Clock,
	paused: CirclePause,
	interrupted: RotateCcw,
	done: Check,
	cancelled: CircleSlash,
	gone: CircleDashed,
	unknown: CircleHelp,
	failed: X,
};

export const CHILD_INK: Record<ChildStatus, string> = {
	// `subagent_panel.py:371-391`. The running spinner stays neutral: the accent
	// green is a scarce budget and a child at work has not done anything yet.
	running: "text-ink-muted",
	queued: "text-ink-dim",
	// Muted like `interrupted`, and for the same reason: the child is not gone
	// and did not fail — it is parked where the user left it, which is a state
	// they may come back to (`subagent_panel.py` returns `muted` for both).
	paused: "text-ink-muted",
	// A run cut off by the process ending is not a failure — nothing went wrong —
	// so it takes the muted ink and the rotate mark that says it may be resumable.
	interrupted: "text-ink-muted",
	done: "text-ink-dim",
	cancelled: "text-ink-dim",
	// Settled and quiet, and NOT `done`: both of these are states whose outcome
	// is unknown, so they take the quietest ink without claiming a green check
	// (`foldStatus`).
	gone: "text-ink-dim",
	unknown: "text-ink-dim",
	failed: "text-danger",
};

export const SubagentStateIcon = ({ status }: { status: ChildStatus }) => {
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
 * The row's second line (`docs/run-sidebar.md` §4.1), which is one of two
 * different kinds of text.
 *
 * It lives beside `SubagentRowBody` rather than in the roster that first drew
 * it, and that is the same argument this file's own header makes: the body takes
 * the second line as a PROP, so the body and the only component that renders
 * that prop's value are one decision — a list that picked up the body without it
 * would draw a child twice with two different amounts of its story. The roster
 * and the reader's own subagents section draw it; the Jobs section deliberately
 * draws no second line at all (`docs/composer-activity-chips.md` § 4).
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
export const DetailLine = ({ row }: { row: SubagentRow }) => {
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

/**
 * One row's CONTENT, shared by every list that draws a row: the state mark, the
 * label, the state in words and the numbers run.
 *
 * Extracted for the reason this file exists at all. It was
 * `run-detail-subagents.tsx`'s private `body` while the roster was the only list
 * of rows; the Jobs section draws the same row over a different list
 * (`run-detail-jobs.tsx`), and two copies of this markup would be two places for
 * the row's own height contract to drift (`run-detail-subagents.tsx`: `py-1.5`
 * with the two pinned line-heights is what makes 32/48/64px land on whole
 * pixels). That failure is silent — both copies still look like a row.
 *
 * The second line is a PROP rather than a decision taken here, because the two
 * lists answer it differently and neither answer is this component's to make: the
 * roster always gives a child a second line (its activity while it works, its
 * failure when it does not), and the Jobs section deliberately gives a tool row
 * none — its rows are a status list, one line each
 * (`docs/composer-activity-chips.md` § 4).
 *
 * The state in WORDS is not optional and is not a caller's choice: the mark is
 * `aria-hidden`, so without it a row announces a label and a row of numbers and
 * never whether the work is still going or has failed, which is the one fact the
 * row exists to carry (`§6.4`).
 */
export const SubagentRowBody = ({
	row,
	detail = null,
	trailing = null,
}: {
	row: SubagentRow;
	/** The row's second line, or nothing (see above). */
	detail?: ReactNode;
	/**
	 * A last segment on the row's FIRST line, after the numbers run.
	 *
	 * A prop for the same reason `detail` is: it is a fact the calling list has
	 * and the row's own grammar has no slot for. The reader's subagents section is
	 * its one caller and passes the count of the row's OWN children — the count is
	 * what says there is a level below the row — which the roster has no room for
	 * and no reason to want: a member's own children are the pane's `N children`
	 * control's subject, one level up.
	 */
	trailing?: ReactNode;
}) => (
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
				<span className={cn("sr-only")}>{childStateLabel(row)}</span>
				<NumberRun row={row} />
				{trailing}
			</div>
			{detail}
		</div>
	</>
);

/**
 * The numbers run: role, elapsed, context, cost (`§4.1`) — and, for the reader's
 * facts row only, the child's model (`§5.2`).
 *
 * Each figure is omitted when unknown rather than zeroed — see the model — and
 * the segment disappears with it, which is why the seam is rendered BETWEEN
 * segments rather than after each one. Elapsed takes `tabular-nums` so a column
 * of them aligns without a fixed-width slot.
 *
 * `includeModel` is a PROP rather than always-on because the roster row is
 * explicitly unchanged by this change: the model segment belongs to the reader's
 * page header (the one place a reader is trying to understand a delegation) and
 * nowhere else, and a caller that could not say which one it wanted would put it
 * on both.
 */
export const NumberRun = ({
	row,
	includeModel = false,
}: {
	row: SubagentRow;
	includeModel?: boolean;
}) => {
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
	if (includeModel && row.modelLabel) {
		figures.push({ key: "model", text: row.modelLabel });
	}
	if (figures.length === 0) return null;
	return (
		<span
			className={cn(
				"flex min-w-0 shrink-0 items-baseline gap-1 text-meta text-ink-muted",
			)}
		>
			{figures.map((figure, index) => (
				<span key={figure.key} className={cn("flex items-baseline gap-1")}>
					{index > 0 && <span className={cn("text-ink-dim")}>·</span>}
					<span
						className={cn(
							figure.tabular && "tabular-nums",
							// The model is a machine string on a row that otherwise holds
							// figures, so it must not claim a column: it truncates.
							figure.key === "model" && "max-w-32 truncate",
						)}
						title={figure.key === "model" ? figure.text : undefined}
					>
						{figure.text}
					</span>
				</span>
			))}
		</span>
	);
};
