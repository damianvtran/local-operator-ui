import { Popover, Box, Grid } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { useState } from "react";

const GridCell = styled(Box, {
	shouldForwardProp: (prop) => prop !== "highlighted",
})<{ highlighted: boolean }>(({ theme, highlighted }) => ({
	width: 24,
	height: 24,
	border: `1px solid ${theme.palette.divider}`,
	backgroundColor: highlighted
		? theme.palette.primary.main
		: theme.palette.background.paper,
	"&:hover": {
		border: `1px solid ${theme.palette.primary.main}`,
	},
}));

type InsertTablePopoverProps = {
	anchorEl: HTMLElement | null;
	onClose: () => void;
	onInsert: (rows: number, cols: number) => void;
};

export const InsertTablePopover: FC<InsertTablePopoverProps> = ({
	anchorEl,
	onClose,
	onInsert,
}) => {
	const [hoveredCell, setHoveredCell] = useState({ rows: 0, cols: 0 });
	const maxRows = 6;
	const maxCols = 6;

	const rows = Array.from({ length: maxRows }, (_, i) => ({ id: `row-${i}` }));
	const cols = Array.from({ length: maxCols }, (_, i) => ({ id: `col-${i}` }));

	const handleGridSelect = (rows: number, cols: number) => {
		onInsert(rows, cols);
		onClose();
	};

	return (
		<Popover
			open={Boolean(anchorEl)}
			anchorEl={anchorEl}
			onClose={onClose}
			anchorOrigin={{
				vertical: "bottom",
				horizontal: "left",
			}}
		>
			<Box sx={{ p: 2 }}>
				<Grid container spacing={0.5} sx={{ width: maxCols * 28 }}>
					{rows.map((row, rowIndex) =>
						cols.map((col, colIndex) => (
							<Grid item key={`${row.id}-${col.id}`}>
								<GridCell
									highlighted={
										rowIndex < hoveredCell.rows && colIndex < hoveredCell.cols
									}
									onMouseEnter={() =>
										setHoveredCell({
											rows: rowIndex + 1,
											cols: colIndex + 1,
										})
									}
									onClick={() =>
										handleGridSelect(rowIndex + 1, colIndex + 1)
									}
								/>
							</Grid>
						)),
					)}
				</Grid>
				<Box sx={{ textAlign: "center", mt: 1 }}>
					{hoveredCell.rows > 0 &&
						`${hoveredCell.rows}x${hoveredCell.cols}`}
				</Box>
			</Box>
		</Popover>
	);
};
