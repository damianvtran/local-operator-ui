import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@shared/components/ui/table";
import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A table over the `ui/table` primitive, and the sort affordance on its header.
 *
 * **What this primitive does not decide, and why that has not moved.** It does
 * not decide anything about ORDER — not the comparator, not the tie-break, not
 * the direction a column starts in. It renders the rows it is given, in the
 * order it is given them, and a sortable header hands back the INTENT
 * (`sort.onSort`) while displaying the `aria-sort` value it is TOLD. Each of
 * those used to be a reason to refuse sorting here at all: a second place the
 * row order is decided, where the panels already decide it (ranked by the
 * selected metric, newest-first) as pure functions their models own. Extending
 * the primitive to display an order the caller decided keeps that rule intact —
 * `analytics-session-state.ts` still owns every comparison, and it is the
 * module with the `node --test` suite.
 *
 * **The one thing it still does not do is bound the rows itself.** This
 * docstring used to say the design cap was "12 rows plus a `+N more` line",
 * which stopped being true when every session became reachable through the
 * pager: a header that states an invariant the file no longer holds is worse
 * than no header. The by-session table now renders ONE PAGE of at most
 * `SESSION_PAGE_SIZE` rows and puts the rest behind `TablePager`, and the
 * caller's model produces that page. `MoreRowsLine` is gone with the line it
 * drew — a `+N more not shown` line beside a pager is two statements about the
 * same withholding, and it was the thing the paging replaced.
 *
 * It is a real `<table>` rather than a grid of `<div>`s: the rows are tabular
 * data, and a screen reader's table navigation is the affordance that makes a
 * ledger readable without sight.
 *
 * MUST NOT own its own scrolling box. The panel host's body scrolls; a nested
 * scroller inside it is two scrollbars for one gesture.
 */

export type Column<T> = {
	key: string;
	header: string;
	/** Cell renderer. The caller formats; numeric cells use `font-mono tabular-nums`. */
	cell: (row: T) => ReactNode;
	/** Right-aligns and applies `tabular-nums`. */
	numeric?: boolean;
	/** A leading cell that must survive a narrow frame (a label, a share bar). */
	priority?: "high" | "low";
	/**
	 * Whether this column takes a header button and reports sort intent.
	 *
	 * Off by default, and the tables that leave it off say something by doing
	 * so: the By provider table's rows are the providers that answered, in a
	 * fixed order, and there is no question a reader would sort them to answer.
	 */
	sortable?: boolean;
	className?: string;
};

/**
 * The sort this table is displaying, and the way back.
 *
 * `key: null` means "sortable, but no column is sorted" — the state a table
 * reaches when the order follows something itself (this panel's metric), which
 * is what makes `aria-sort="none"` on every header an honest statement rather
 * than a missing one.
 */
export type DataTableSort = {
	key: string | null;
	direction: "asc" | "desc";
	onSort: (key: string) => void;
};

export type DataTableProps<T> = {
	columns: Column<T>[];
	rows: T[];
	rowKey: (row: T) => string;
	/** The table's accessible name; also becomes the region's label when wrapped. */
	label: string;
	/** Rendered in place of the table body when `rows` is empty. */
	empty?: ReactNode;
	/** A leading cell rendered before the first column (a proportion bar). */
	leading?: (row: T) => ReactNode;
	/** Absent for a table nobody sorts; then a `sortable` column renders as text. */
	sort?: DataTableSort;
};

export function DataTable<T>({
	columns,
	rows,
	rowKey,
	label,
	empty,
	leading,
	sort,
}: DataTableProps<T>) {
	if (rows.length === 0 && empty) return <>{empty}</>;
	return (
		<Table aria-label={label}>
			<TableHeader>
				<TableRow>
					{leading ? <TableHead className={cn("w-24")} /> : null}
					{columns.map((column) => (
						/*
						 * `aria-sort` goes on the HEADER CELL, which is the element a
						 * screen reader reads for this purpose, and the control inside it
						 * is a real `<button>`: a `<th>` with an `onClick` is not keyboard
						 * reachable at all, and a sort that only a pointer can reach is
						 * half an affordance.
						 *
						 * `aria-sort="none"` on a sortable-but-unsorted column is the
						 * spec's own value for exactly this state ("sortable, not
						 * currently sorted") and is why a reader can tell a column that is
						 * not sorted from one that cannot be. A column that is not
						 * sortable carries no attribute at all.
						 */
						<TableHead
							key={column.key}
							scope="col"
							aria-sort={
								column.sortable && sort
									? sort.key === column.key
										? sort.direction === "desc"
											? "descending"
											: "ascending"
										: "none"
									: undefined
							}
							className={cn(column.numeric && "text-right", column.className)}
						>
							{column.sortable && sort ? (
								<SortHeaderButton
									header={column.header}
									numeric={column.numeric}
									active={sort.key === column.key}
									direction={sort.direction}
									onClick={() => sort.onSort(column.key)}
								/>
							) : (
								column.header
							)}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={rowKey(row)}>
						{leading ? <TableCell>{leading(row)}</TableCell> : null}
						{columns.map((column) => (
							<TableCell
								key={column.key}
								className={cn(
									column.numeric &&
										"text-right font-mono text-mono-sm tabular-nums",
									column.className,
								)}
							>
								{column.cell(row)}
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

/**
 * The header's control: the column's name, a direction glyph, and the intent.
 *
 * A plain `<button type="button">` rather than `Button variant="ghost"`, and
 * this is a contrast decision rather than a shortcut. `ghost` brings
 * `hover:bg-accent-wash`, and this control sits on the header row's `bg-sunken`
 * ground — a fill the contrast contract does not measure there (its `CONTROLS`
 * list has no `accent-wash`-on-`sunken` row, and a green gate is not evidence
 * about a component nobody listed). Its hover is therefore an INK step
 * (`text-ink-dim` → `text-ink`), which is the same move `ghost`'s own ink makes
 * and is asserted on `sunken` already, so no new contract row is needed.
 * Nothing lifts, scales or translates: hover is a colour step.
 *
 * The active column is stated three ways, none of them colour alone: the glyph's
 * SHAPE (a single chevron in the active direction, a neutral double chevron
 * otherwise), the `aria-sort` on the cell above, and an ink step to `text-ink`.
 * The glyph itself is `aria-hidden` because `aria-sort` already says what it
 * draws — a reader hearing "Cost, sort descending, descending" has been told
 * twice.
 */
const SortHeaderButton = ({
	header,
	numeric,
	active,
	direction,
	onClick,
}: {
	header: string;
	numeric?: boolean;
	active: boolean;
	direction: "asc" | "desc";
	onClick: () => void;
}) => {
	const Glyph = active
		? direction === "desc"
			? ChevronDown
			: ChevronUp
		: ChevronsUpDown;
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1 rounded-xs transition-colors duration-fast ease-out-quart",
				// Full width for a numeric column so the hit target and the right
				// edge agree: a header whose numbers are right-aligned under a
				// left-aligned control reads as two columns.
				numeric && "w-full justify-end",
				active ? "text-ink" : "text-ink-dim hover:text-ink",
			)}
		>
			{header}
			<Glyph className={cn("size-3.5 shrink-0")} aria-hidden="true" />
		</button>
	);
};
