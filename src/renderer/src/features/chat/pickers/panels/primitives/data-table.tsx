import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@shared/components/ui/table";
import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";

/**
 * A bounded table over the `ui/table` primitive.
 *
 * "Bounded" is the whole design: every table on these panels is bounded by its
 * payload — the largest is 50 recent requests, and the design cap is 12 rows
 * plus a `+N more` line — so this primitive deliberately does NOT sort,
 * paginate, filter or virtualise. Each of those would be a second place the
 * row order is decided, and the panels already decide it (sorted by the
 * selected metric, newest-first, and so on) as pure functions their models
 * own.
 *
 * It is a real `<table>` rather than a grid of `<div>`s: the rows are tabular
 * data, and a screen reader's table navigation is the affordance that makes a
 * twelve-row ledger readable without sight.
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
	className?: string;
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
};

export function DataTable<T>({
	columns,
	rows,
	rowKey,
	label,
	empty,
	leading,
}: DataTableProps<T>) {
	if (rows.length === 0 && empty) return <>{empty}</>;
	return (
		<Table aria-label={label}>
			<TableHeader>
				<TableRow>
					{leading ? <TableHead className={cn("w-24")} /> : null}
					{columns.map((column) => (
						<TableHead
							key={column.key}
							scope="col"
							className={cn(column.numeric && "text-right", column.className)}
						>
							{column.header}
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
 * The `+N more` line a bounded table ends with.
 *
 * Every table here shows a prefix of a larger answer (the top 12 sessions, the
 * 12 most recent requests). Saying how many were withheld is the difference
 * between a table that is a summary and a table that is mistaken for the whole
 * answer.
 */
export const MoreRowsLine = ({ count }: { count: number }) => (
	<p className={cn("pt-1 text-ink-dim text-meta")}>+{count} more not shown</p>
);
