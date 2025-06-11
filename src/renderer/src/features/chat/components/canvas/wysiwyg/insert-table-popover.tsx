import { Popover, Box, Grid, TextField, Button, Typography, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import type { FC } from "react";
import { useState } from "react";

const PopoverContent = styled(Box)(({ theme }) => ({
	padding: theme.spacing(2),
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(2),
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 0.75,
	boxShadow: theme.shadows[2],
	minWidth: 240,
}));

const GridCell = styled(Box, {
	shouldForwardProp: (prop) => prop !== "highlighted",
})<{ highlighted: boolean }>(({ theme, highlighted }) => ({
	width: 20,
	height: 20,
	borderRadius: 3,
	cursor: "pointer",
	border: `1px solid ${theme.palette.divider}`,
	backgroundColor: highlighted
		? theme.palette.primary.main
		: theme.palette.background.default,
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: highlighted
			? theme.palette.primary.dark
			: theme.palette.action.hover,
		borderColor: highlighted
			? theme.palette.primary.dark
			: theme.palette.text.secondary,
	},
}));

/**
 * TextField input styles matching create-file-dialog.tsx
 */
const textFieldInputSx = (theme: Theme) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: theme.shape.borderRadius * 0.75,
		backgroundColor: theme.palette.background.paper,
		border: `1px solid ${theme.palette.divider}`,
		minHeight: "36px",
		height: "36px",
		transition: "border-color 0.2s ease, box-shadow 0.2s ease",
		"&:hover": {
			borderColor: theme.palette.text.secondary,
		},
		"&.Mui-focused": {
			borderColor: theme.palette.primary.main,
			boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
		},
		"& .MuiOutlinedInput-notchedOutline": {
			border: "none",
		},
	},
	"& .MuiInputBase-input": {
		padding: theme.spacing(0.75, 1.25),
		fontSize: "0.875rem",
		height: "calc(36px - 12px)",
		boxSizing: "border-box",
	},
	"& .MuiInputBase-input::placeholder": {
		color: theme.palette.text.disabled,
		opacity: 1,
	},
});

const StyledButton = styled(Button)(({ theme }) => ({
	boxShadow: "none",
	textTransform: "none",
	fontSize: "0.875rem",
	fontWeight: 500,
	borderRadius: theme.shape.borderRadius * 0.75,
	padding: theme.spacing(0.75, 1.5),
	minHeight: "36px",
	"&:hover": {
		boxShadow: "none",
		opacity: 0.9,
	},
}));

const FieldLabel = styled("div")(({ theme }) => ({
	fontFamily: theme.typography.fontFamily,
	fontSize: "0.875rem",
	fontWeight: 500,
	color: theme.palette.text.secondary,
	marginBottom: 6,
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
	const theme = useTheme();
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
					<Typography 
						variant="body2" 
						sx={{ 
							mb: 1.5, 
							color: "text.secondary",
							fontSize: "0.875rem",
							fontWeight: 500,
						}}
					>
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
				
				<Box>
					<FieldLabel>Custom size</FieldLabel>
					<Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
						<TextField
							type="number"
							value={customRows}
							onChange={(e) => setCustomRows(Math.max(1, Number(e.target.value)))}
							inputProps={{ min: 1, "aria-label": "Rows" }}
							placeholder="Rows"
							sx={textFieldInputSx(theme)}
						/>
						<Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.875rem" }}>
							×
						</Typography>
						<TextField
							type="number"
							value={customCols}
							onChange={(e) => setCustomCols(Math.max(1, Number(e.target.value)))}
							inputProps={{ min: 1, "aria-label": "Columns" }}
							placeholder="Columns"
							sx={textFieldInputSx(theme)}
						/>
					</Box>
				</Box>
				
				<StyledButton onClick={handleCustomInsert} variant="contained" fullWidth>
					Insert Table
				</StyledButton>
			</PopoverContent>
		</Popover>
	);
};
