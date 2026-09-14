import { cn } from "@shared/lib/utils";
import {
	type HTMLAttributes,
	type TdHTMLAttributes,
	type ThHTMLAttributes,
	forwardRef,
} from "react";

/**
 * Table — the shadcn table primitive, with one deliberate departure.
 *
 * ## Why there is no scroll wrapper
 *
 * Upstream shadcn wraps the `<table>` in `<div class="relative w-full
 * overflow-x-auto">`. That wrapper is removed here, because a table inside the
 * picker panels is not the outermost scrolling thing on its screen: the panel
 * host owns the body's scroll box (`picker-host.tsx`, the same box whose
 * overflow draws the fold rule and the fade). Nested scroll containers mean a
 * table that scrolls sideways inside a body that scrolls vertically, which is
 * two scrollbars for one gesture and a right-aligned number column that can
 * slide out of its own alignment. A caller that genuinely needs a local scroll
 * box composes one around `Table`; the primitive does not decide that.
 *
 * ## Rules
 *
 * - `border-hairline` only. No cell here is a control, so the 3:1
 *   `border-control` floor does not apply and promoting a row rule to it would
 *   claim a boundary the design does not draw.
 * - No background beyond the header row. Cards carry grounds; a table is a
 *   grid of text on whatever ground its section sits on.
 * - Every className goes through `cn`: without it our custom scales do not
 *   register with `tailwind-merge` and a type step beside an ink role silently
 *   drops one of the two.
 */

export const Table = forwardRef<
	HTMLTableElement,
	HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
	<table
		ref={ref}
		className={cn("w-full caption-bottom border-collapse", className)}
		{...props}
	/>
));
Table.displayName = "Table";

export const TableHeader = forwardRef<
	HTMLTableSectionElement,
	HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
	<thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<
	HTMLTableSectionElement,
	HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
	<tbody
		ref={ref}
		className={cn("[&_tr:last-child]:border-0", className)}
		{...props}
	/>
));
TableBody.displayName = "TableBody";

export const TableFooter = forwardRef<
	HTMLTableSectionElement,
	HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
	<tfoot
		ref={ref}
		className={cn("border-t font-medium [&>tr]:last:border-b-0", className)}
		{...props}
	/>
));
TableFooter.displayName = "TableFooter";

export const TableRow = forwardRef<
	HTMLTableRowElement,
	HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
	<tr
		ref={ref}
		className={cn("border-hairline border-b", className)}
		{...props}
	/>
));
TableRow.displayName = "TableRow";

export const TableHead = forwardRef<
	HTMLTableCellElement,
	ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
	<th
		ref={ref}
		className={cn(
			"bg-sunken px-2 py-1.5 text-left align-middle font-normal text-ink-dim text-meta",
			className,
		)}
		{...props}
	/>
));
TableHead.displayName = "TableHead";

export const TableCell = forwardRef<
	HTMLTableCellElement,
	TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
	<td
		ref={ref}
		className={cn("px-2 py-1.5 align-middle text-body-sm", className)}
		{...props}
	/>
));
TableCell.displayName = "TableCell";

export const TableCaption = forwardRef<
	HTMLTableCaptionElement,
	HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
	<caption
		ref={ref}
		className={cn("mt-2 text-ink-dim text-meta", className)}
		{...props}
	/>
));
TableCaption.displayName = "TableCaption";
