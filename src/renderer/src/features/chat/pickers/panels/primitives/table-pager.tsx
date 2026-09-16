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
 * - **All four controls are ALWAYS rendered, and an end is `aria-disabled`
 *   rather than `disabled`.** Always rendering stops the control UNMOUNTING
 *   under the caret, which is only half of the focus problem: the native
 *   attribute also BLURS the control it is set on, and a browser with nowhere
 *   to put the caret does not hand it to a sibling — it drops it to `<body>`.
 *   So an end is never conditionally mounted AND never carries the real
 *   attribute. It is a control that exists, takes the pointer and takes focus,
 *   and reports itself as unavailable; the click and the key that activates it
 *   reach the handler and are ignored there. Pressing `Next` on the last page,
 *   and `First` or `Last` from either end, are the cases both halves exist for,
 *   which is why the section's focus assertion walks to an END rather than only
 *   to page two.
 *
 *   The inert treatment steps the same way a native disabled control's would, by
 *   COLOUR (`ink-disabled` over a hairline edge) and never by opacity, which
 *   would take the control's ground with it. The variant is chosen so that the
 *   step also goes the right DIRECTION: an enabled `outline` control is a
 *   `border-control` box in `ink` — the authoring 3:1 structural edge, over an
 *   ink floored at 4.5:1 — and its end state is a hairline box in
 *   `ink-disabled`, so the two live controls are the prominent ones and the two
 *   withheld ones recede. `secondary` was the wrong way round for this row
 *   (design round 1, D1): its disabled fill is `bg-sunken`, the same fill as its
 *   own `:active`, and `sunken` is a larger step from the row's ground than
 *   `surface` is on every palette, so the dead chips were the loudest objects on
 *   the row.
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
	/**
	 * One control. A plain function rather than a component, and a function
	 * rather than four copies of the same five props: the four differ only by
	 * label, by which end they guard and by the page they ask for, and a second
	 * spelling of the inert treatment on one row is the defect.
	 */
	const control = (name: string, blocked: boolean, target: number) => (
		<Button
			variant="outline"
			size="sm"
			/*
			 * `aria-disabled`, NEVER `disabled` — see the head comment. The
			 * LOOK is carried by the class below rather than by the variant's
			 * own `disabled:` rules, because those are keyed off the attribute
			 * that blurs the control, which is the thing being avoided.
			 */
			aria-disabled={blocked || undefined}
			className={cn(
				/*
				 * The inert treatment, and every clause is load bearing. The two
				 * colour roles are the native disabled step (`border-hairline`
				 * over the variant's `border-control`, `text-ink-disabled` over
				 * `text-ink`), so the withheld control still reads as withheld.
				 *
				 * The `hover:`/`active:` resets are the part a native disabled
				 * control gets for free and `aria-disabled` does not: the variant's
				 * own `hover:bg-accent-wash` and `active:` fill still MATCH on this
				 * element, because nothing in CSS knows it is inert — a dead
				 * control that lights up under the pointer advertises an
				 * interaction it does not have (`directory-indicator.tsx` writes
				 * the same rule down for its read-only chip), and a pressed fill
				 * would paint while the ignored click is being made. Handled here
				 * rather than in the variant, which cannot know.
				 */
				blocked &&
					"border-hairline text-ink-disabled cursor-not-allowed hover:bg-transparent active:border-hairline active:bg-transparent",
			)}
			onClick={() => {
				if (blocked) return;
				onPage(target);
			}}
		>
			{name}
		</Button>
	);
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
				{control("First", atStart, 0)}
				{control("Prev", atStart, page - 1)}
				<p className={cn("text-ink-dim text-meta tabular-nums")}>
					{page + 1} / {pageCount}
				</p>
				{control("Next", atEnd, page + 1)}
				{control("Last", atEnd, pageCount - 1)}
			</div>
		</div>
	);
};
