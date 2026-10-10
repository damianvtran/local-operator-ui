import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import {
	type CodeRequestRow,
	type LaneLine,
	type LaneSegmentTone,
	laneLines,
} from "../code-review-model";

/**
 * The segmented round progress, one line per lane present (§2 of the build
 * spec): `Code · QA · Design · UX`, one segment per ROUND, chronological.
 *
 * WHY THE SEGMENTS ARE `aria-hidden`. The clause beside them IS the state
 * ("the clause text is the state, so a screen reader reads `Round 2 ·
 * remediation posted · stale — …` after the lane name" - §10), so a segment
 * that also announced itself would state one fact twice, in two registers. The
 * strip is a second CHANNEL for the same fact, not a second fact.
 *
 * WHY A ROLE PER TONE rather than a colour: `laneSegmentTone` maps the state to
 * one of four roles and this file maps the role to classes, which is the split
 * `scripts/contrast-contract.mjs` asserts over (the `code review round mark`
 * rows). The `outline` tone is a BORDER with no fill - "outline only" in the
 * spec's table - so it survives a theme whose washes sit close to the ground.
 *
 * The strip never wraps (§9): it is a fixed count of 6px marks, and the clause
 * beside it is what yields when the pane narrows. At the 320px floor it WRAPS
 * to a second, clamped line rather than truncating: the one-line truncation cut
 * `· awaiting re-review` first, and that tail is the only channel for "a
 * re-review is owed" (design round 2, D10). `line-clamp-2` bounds the growth;
 * the full sentence stays in the `title`.
 */

const TONE_CLASS: Record<LaneSegmentTone, string> = {
	warning: "bg-warning",
	muted: "bg-ink-muted",
	success: "bg-success",
	outline: "border border-control",
};

export type CodeReviewRoundsProps = {
	row: CodeRequestRow;
};

/** One lane row: name, segment strip, clause. */
const LaneRow: FC<{ line: LaneLine }> = ({ line }) => (
	<div className={cn("flex items-center gap-x-2 text-meta")}>
		<span className={cn("min-w-10 shrink-0 truncate text-ink-dim")}>
			{line.name}
		</span>
		<span className={cn("flex items-center gap-0.5 pt-0.5")} aria-hidden={true}>
			{line.segments.map((segment) => (
				<span
					key={segment.key}
					data-code-review-round=""
					data-round-tone={segment.tone}
					className={cn("h-1.5 w-4 rounded-xs", TONE_CLASS[segment.tone])}
				/>
			))}
		</span>
		<span
			className={cn("min-w-0 line-clamp-2 text-ink-muted")}
			title={line.title}
		>
			{line.clause}
		</span>
	</div>
);

export const CodeReviewRounds: FC<CodeReviewRoundsProps> = ({ row }) => {
	const lines = laneLines(row);
	if (lines.length === 0) return null;
	return (
		/*
		 * The lanes are a definition list of sorts, but the header-less list is
		 * what the row's accessible name already carries (lane, then clause), so
		 * this stays a plain group: `aria-label` on a group with no landmark role
		 * would be noise, and the rows are in DOM order.
		 */
		<div className={cn("flex flex-col gap-0.5")} data-code-review-rounds="">
			{lines.map((line) => (
				<LaneRow key={line.key} line={line} />
			))}
		</div>
	);
};
