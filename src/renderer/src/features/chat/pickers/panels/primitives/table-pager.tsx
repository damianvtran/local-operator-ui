import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { formatCount } from "../formatters";

/**
 * The row of paging controls under a table.
 *
 * A SIBLING of `DataTable` rather than a prop on it. The primitive's contract
 * is "a table", and a pager is a control row that happens to sit under one;
 * folding it in would make `DataTable` mean "a table and its footer", and every
 * caller that wants only the first half would be paying for the second. It is
 * also why this file owns no table: the order the rows are in, and which rows
 * are on this page, are decided by the caller's model — this renders the page
 * it is handed and reports the page it wants.
 *
 * What it does NOT do, and each of these is a decision rather than an omission:
 *
 * - **It computes no counts.** `from`, `to`, `total` and `pageCount` are passed
 *   in, from the one model function that narrowed and sliced the set. A pager
 *   that counted its own rows would be a second place a total is derived, and
 *   the three surfaces that state this table's counts (its range line, the
 *   section's match line and the live announcement) would start disagreeing
 *   the first time one of them was edited.
 * - **All four buttons are ALWAYS rendered and disabled at the ends.** They are
 *   not conditionally mounted, and that is a focus rule rather than tidiness:
 *   pressing `Next` on the last page would unmount the control under the
 *   caret, and the browser drops focus to `<body>` when the focused element
 *   leaves the DOM — it does not hand it to a sibling. A keyboard reader would
 *   lose their place in the panel every time they reached an end. Disabled at
 *   the ends is a COLOUR change (`Button`'s own variants, `ink-disabled`), never
 *   an opacity fade, which would take the control's ground with it.
 * - **It adds no motion.** A page turn is a re-render, not a transition.
 */

export type TablePagerProps = {
	/** 0-based page index, already clamped by the caller's model. */
	page: number;
	/** Pages in the narrowed set; at least 1. */
	pageCount: number;
	/** 1-based index of the first row on this page; 0 when the set is empty. */
	from: number;
	/** 1-based index of the last row on this page; 0 when the set is empty. */
	to: number;
	/** Rows in the narrowed set. */
	total: number;
	/**
	 * The counted thing, SINGULAR — `"session"`. This is the only place the
	 * noun lives: the range line pluralises it from `total`, so a caller cannot
	 * pass a plural and get `1 sessions`.
	 */
	label: string;
	onPage: (page: number) => void;
};

export const TablePager = ({
	page,
	pageCount,
	from,
	to,
	total,
	label,
	onPage,
}: TablePagerProps) => {
	const atStart = page <= 0;
	const atEnd = page >= pageCount - 1;
	/*
	 * `text-meta` for the range and the indicator, `tabular-nums` for the
	 * indicator's `n / m` so the pair does not shift width as the page count
	 * changes, and `text-ink-dim` for both: this row is a qualifier under the
	 * table, not a claim competing with it.
	 */
	return (
		<div
			className={cn("flex flex-wrap items-center justify-between gap-3 pt-2")}
		>
			{/*
			 * Grouped the way every other count in these panels is
			 * (`formatCount`, one spelling per quantity): a pager reading
			 * `4550` beside cells reading `1,240` is the second opinion this
			 * file's own formatter module exists to prevent.
			 */}
			<p className={cn("text-ink-dim text-meta")}>
				{formatCount(from)}–{formatCount(to)} of {formatCount(total)}{" "}
				{total === 1 ? label : `${label}s`}
			</p>
			<div className={cn("flex items-center gap-2")}>
				<Button
					variant="secondary"
					size="sm"
					disabled={atStart}
					onClick={() => onPage(0)}
				>
					First
				</Button>
				<Button
					variant="secondary"
					size="sm"
					disabled={atStart}
					onClick={() => onPage(page - 1)}
				>
					Prev
				</Button>
				<p className={cn("text-ink-dim text-meta tabular-nums")}>
					{page + 1} / {pageCount}
				</p>
				<Button
					variant="secondary"
					size="sm"
					disabled={atEnd}
					onClick={() => onPage(page + 1)}
				>
					Next
				</Button>
				<Button
					variant="secondary"
					size="sm"
					disabled={atEnd}
					onClick={() => onPage(pageCount - 1)}
				>
					Last
				</Button>
			</div>
		</div>
	);
};
