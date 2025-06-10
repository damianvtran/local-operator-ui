import { Popover, Box, Grid, TextField, Button, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { useState } from "react";

const PopoverContent = styled(Box)(({ theme }) => ({
	padding: theme.spacing(1.5),
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(2),
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius,
	boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
	minWidth: 220,
}));

const GridCell = styled(Box, {
	shouldForwardProp: (prop) => prop !== "highlighted",
})<{ highlighted: boolean }>(({ theme, highlighted }) => ({
	width: 20,
	height: 20,
	borderRadius: 3,
	cursor: "pointer",
	backgroundColor: highlighted
		? theme.palette.primary.main
		: theme.palette.background.default,
	"&:hover": {
		backgroundColor: highlighted
			? theme.palette.primary.dark
			: theme.palette.action.hover,
	},
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: theme.shape.borderRadius,
		"& input": {
			padding: "8px 12px",
		},
	},
}));

const StyledButton = styled(Button)(({ theme }) => ({
	boxShadow: "none",
	textTransform: "none",
	fontWeight: 500,
	borderRadius: theme.shape.borderRadius,
	padding: "6px 12px",
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
	const [customRows, setCustomRows] = useState(3);
	const [customCols, setCustomCols] = useState(3);
	const maxRows = 8;
	const maxCols = 8;

	const rows = Array.from({ length: maxRows }, (_, i) => ({ id: `row-${i}` }));
	const cols = Array.from({ length: maxCols }, (_, i) => ({ id: `col-${i}` }));

	const handleGridSelect = (selectedRows: number, selectedCols: number) => {
		onInsert(selectedRows, selectedCols);
		onClose();
	};

	const handleCustomInsert = () => {
		onInsert(customRows, customCols);
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
			PaperProps={{
				sx: {
					backgroundColor: "transparent",
					boxShadow: "none",
					border: "none",
					marginTop: "8px",
				},
			}}
		>
			<PopoverContent>
				<Box>
					<Typography variant="body2" sx={{ mb: 1, color: "text.secondary" }}>
						{hoveredCell.rows > 0 && hoveredCell.cols > 0
							? `${hoveredCell.rows} x ${hoveredCell.cols} table`
							: "Insert table"}
					</Typography>
					<Grid
						container
						spacing={0.5}
						sx={{ width: maxCols * 24 }}
						onMouseLeave={() => setHoveredCell({ rows: 0, cols: 0 })}
					>
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
				</Box>
				<Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
					<StyledTextField
						type="number"
						value={customRows}
						onChange={(e) => setCustomRows(Math.max(1, Number(e.target.value)))}
						inputProps={{ min: 1, "aria-label": "Rows" }}
						size="small"
						placeholder="Rows"
					/>
					<Typography variant="body2" sx={{ color: "text.secondary" }}>
						x
					</Typography>
					<StyledTextField
						type="number"
						value={customCols}
						onChange={(e) => setCustomCols(Math.max(1, Number(e.target.value)))}
						inputProps={{ min: 1, "aria-label": "Columns" }}
						size="small"
						placeholder="Columns"
					/>
				</Box>
				<StyledButton onClick={handleCustomInsert} variant="contained" fullWidth>
					Insert
				</StyledButton>
			</PopoverContent>
		</Popover>
	);
};
