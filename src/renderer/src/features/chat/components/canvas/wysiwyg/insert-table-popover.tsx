import {
	Button,
	Input,
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC, KeyboardEvent } from "react";
import { useId, useMemo, useState } from "react";

const MAX_ROWS = 8;
const MAX_COLS = 8;

type InsertTablePopoverProps = {
	anchorEl: HTMLElement | null;
	onClose: () => void;
	onInsert: (rows: number, cols: number) => void;
};

/**
 * Size picker for a new table: sweep the grid, or type an exact size.
 *
 * The caller still hands us an `HTMLElement` to hang off, so the element is fed
 * to the popover as a virtual anchor rather than a `PopoverTrigger` — the
 * trigger lives in the editor toolbar and owns the open state.
 *
 * ## Why the grid is one tab stop and not 64 buttons
 *
 * The grid used to be `div`s with `onMouseEnter`, so it was pointer-only. The
 * obvious fix — make every cell a button — is worse than it looks: it puts 64
 * tab stops between the toolbar and the size fields, and Radix focuses the
 * first of them on open, so the popover would open already claiming a 1 x 1
 * table. Instead the container itself is focusable and the arrow keys move the
 * extent, which is one tab stop and matches how the pointer sweep reads. The
 * cells are presentational; the extent is announced from the live heading.
 */
export const InsertTablePopover: FC<InsertTablePopoverProps> = ({
	anchorEl,
	onClose,
	onInsert,
}) => {
	const extentLabelId = useId();
	const [extent, setExtent] = useState({ rows: 0, cols: 0 });
	const [customRows, setCustomRows] = useState(3);
	const [customCols, setCustomCols] = useState(3);

	// A ref-shaped wrapper is what Radix's virtual anchor takes; memoising on
	// the element keeps the popper from re-measuring on every render.
	const anchorRef = useMemo(() => ({ current: anchorEl }), [anchorEl]);

	const rows = Array.from({ length: MAX_ROWS }, (_, i) => ({ id: `row-${i}` }));
	const cols = Array.from({ length: MAX_COLS }, (_, i) => ({ id: `col-${i}` }));

	const handleGridSelect = (selectedRows: number, selectedCols: number) => {
		onInsert(selectedRows, selectedCols);
		onClose();
	};

	const handleCustomInsert = () => {
		onInsert(customRows, customCols);
		onClose();
	};

	const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		/*
		 * Every arrow step is a functional update. An unswept grid sits at 0 x 0 so
		 * the heading can stay neutral, so the first arrow key has to land on a
		 * real cell rather than growing from nothing — and reading `extent` from
		 * the render closure instead would drop steps whenever two keys land in
		 * one batch.
		 */
		const move = (
			step: (rows: number, cols: number) => { rows: number; cols: number },
		) => {
			setExtent((prev) => step(Math.max(1, prev.rows), Math.max(1, prev.cols)));
		};

		switch (event.key) {
			case "ArrowRight":
				move((rows, cols) => ({ rows, cols: Math.min(MAX_COLS, cols + 1) }));
				break;
			case "ArrowLeft":
				move((rows, cols) => ({ rows, cols: Math.max(1, cols - 1) }));
				break;
			case "ArrowDown":
				move((rows, cols) => ({ rows: Math.min(MAX_ROWS, rows + 1), cols }));
				break;
			case "ArrowUp":
				move((rows, cols) => ({ rows: Math.max(1, rows - 1), cols }));
				break;
			case "Enter":
			case " ":
				// Insert what the user can see, which is the last rendered extent.
				handleGridSelect(Math.max(1, extent.rows), Math.max(1, extent.cols));
				break;
			default:
				return;
		}
		event.preventDefault();
	};

	return (
		<Popover
			open={Boolean(anchorEl)}
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
		>
			<PopoverAnchor virtualRef={anchorRef} />
			<PopoverContent
				side="bottom"
				align="start"
				sideOffset={8}
				className={cn("flex w-auto min-w-60 flex-col gap-4")}
			>
				<div>
					<p
						id={extentLabelId}
						aria-live="polite"
						className={cn("mb-1.5 font-medium text-ink-muted text-body-sm")}
					>
						{extent.rows > 0 && extent.cols > 0
							? `${extent.rows} × ${extent.cols} table`
							: "Insert table"}
					</p>
					<div
						// biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls; this groups painted cells, and the accessible control is the container itself.
						role="group"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: deliberate — the container is the control, so the grid is one tab stop with the arrow keys and Enter handled on it.
						tabIndex={0}
						aria-labelledby={extentLabelId}
						className={cn("grid w-fit grid-cols-8 gap-1 rounded-xs")}
						onKeyDown={handleGridKeyDown}
						onMouseLeave={() => setExtent({ rows: 0, cols: 0 })}
						onBlur={() => setExtent({ rows: 0, cols: 0 })}
					>
						{rows.map((row, rowIndex) =>
							cols.map((col, colIndex) => {
								const withinExtent =
									rowIndex < extent.rows && colIndex < extent.cols;
								return (
									// Presentational: the container above is the control, and a
									// screen reader reads the extent from its live label rather
									// than from 64 identical cells.
									// biome-ignore lint/a11y/useKeyWithClickEvents: arrow keys and Enter are handled on the grid container, not on the cell.
									<div
										key={`${row.id}-${col.id}`}
										aria-hidden="true"
										className={cn(
											"size-5 cursor-pointer rounded-xs",
											"transition-colors duration-fast ease-out-quart",
											withinExtent ? "bg-accent" : "bg-sunken",
										)}
										onMouseEnter={() =>
											setExtent({ rows: rowIndex + 1, cols: colIndex + 1 })
										}
										onClick={() => handleGridSelect(rowIndex + 1, colIndex + 1)}
									/>
								);
							}),
						)}
					</div>
				</div>

				<div>
					<p className={cn("mb-1.5 font-medium text-ink-muted text-body-sm")}>
						Custom size
					</p>
					<div className={cn("flex items-center gap-2")}>
						<Input
							type="number"
							min={1}
							aria-label="Rows"
							placeholder="Rows"
							value={customRows}
							onChange={(e) =>
								setCustomRows(Math.max(1, Number(e.target.value)))
							}
							className={cn("w-20")}
						/>
						<span className={cn("text-ink-muted text-body-sm")}>×</span>
						<Input
							type="number"
							min={1}
							aria-label="Columns"
							placeholder="Columns"
							value={customCols}
							onChange={(e) =>
								setCustomCols(Math.max(1, Number(e.target.value)))
							}
							className={cn("w-20")}
						/>
					</div>
				</div>

				<Button variant="primary" onClick={handleCustomInsert}>
					Insert table
				</Button>
			</PopoverContent>
		</Popover>
	);
};
