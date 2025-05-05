/**
 * CategoriesInputChips Component
 *
 * Dropdown input for categories as deletable chips.
 * - Only allows selection from allowed categories
 * - Deletable chips
 * - Theme-aware, shadcn/MUI style, consistent with EditableField and TagsInputChips
 */

import { useState } from "react";
import type { FC } from "react";
import { Box, Chip, IconButton, Typography, styled, useTheme, Autocomplete, TextField } from "@mui/material";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ALLOWED_AGENT_CATEGORIES } from "@shared/api/local-operator/types";

type CategoriesInputChipsProps = {
	/** Current categories */
	value: string[];
	/** Label for the field */
	label: string;
	/** Callback when categories change */
	onChange: (categories: string[]) => void;
	/** Placeholder for the input */
	placeholder?: string;
	/** Disabled state */
	disabled?: boolean;
	/** Optional icon */
	icon?: React.ReactNode;
};

const FieldContainer = styled(Box)({
	marginBottom: 16,
});

const FieldLabel = styled("label")(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginBottom: 6,
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: "0.875rem",
	fontFamily: theme.typography.fontFamily,
	lineHeight: theme.typography.body2.lineHeight,
}));

const LabelIcon = styled(Box)({
	marginRight: 8,
	opacity: 0.9,
	display: "flex",
	alignItems: "center",
});

const ChipsContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexWrap: "wrap",
	gap: theme.spacing(1),
	padding: theme.spacing(1),
	background: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: 6,
	minHeight: 44,
	alignItems: "center",
}));

const StyledChip = styled(Chip)(({ theme }) => ({
	fontSize: "0.8125rem",
	borderRadius: 4,
	background: theme.palette.mode === "dark"
		? theme.palette.action.selected
		: theme.palette.action.hover,
	color: theme.palette.text.primary,
	"& .MuiChip-deleteIcon": {
		color: theme.palette.text.secondary,
		"&:hover": {
			color: theme.palette.error.main,
		},
	},
}));

export const CategoriesInputChips: FC<CategoriesInputChipsProps> = ({
	value,
	label,
	onChange,
	placeholder = "Add category...",
	disabled = false,
	icon,
}) => {
	const theme = useTheme();
	const [inputValue, setInputValue] = useState("");

	const availableOptions = ALLOWED_AGENT_CATEGORIES.filter(
		(opt) => !value.includes(opt),
	);

	const handleDelete = (cat: string) => {
		onChange(value.filter((c) => c !== cat));
	};

	return (
		<FieldContainer>
			<FieldLabel>
				{icon && <LabelIcon>{icon}</LabelIcon>}
				{label}
			</FieldLabel>
			<ChipsContainer>
				{value.map((cat) => (
					<StyledChip
						key={cat}
						label={cat}
						onDelete={disabled ? undefined : () => handleDelete(cat)}
						disabled={disabled}
						deleteIcon={
							<IconButton
								size="small"
								aria-label={`Remove category ${cat}`}
								tabIndex={-1}
								disabled={disabled}
								sx={{
									padding: 0.5,
									color: theme.palette.text.secondary,
									"&:hover": { color: theme.palette.error.main },
								}}
							>
								<FontAwesomeIcon icon={faTimes} size="xs" />
							</IconButton>
						}
						sx={{ marginRight: 0.5 }}
					/>
				))}
				<Autocomplete
					disabled={disabled}
					options={availableOptions}
					value={null}
					inputValue={inputValue}
					onInputChange={(_, newInput) => setInputValue(newInput)}
					onChange={(_, newValue) => {
						if (newValue && !value.includes(newValue)) {
							onChange([...value, newValue]);
						}
						setInputValue("");
					}}
					renderInput={(params) => (
						<TextField
							{...params}
							variant="standard"
							placeholder={placeholder}
							InputProps={{
								...params.InputProps,
								disableUnderline: true,
								style: {
									fontSize: "0.875rem",
									background: "transparent",
									color: theme.palette.text.primary,
									padding: 0,
									minWidth: 80,
								},
							}}
							inputProps={{
								...params.inputProps,
								style: { fontSize: "0.875rem" },
								"aria-label": label,
							}}
						/>
					)}
					sx={{
						minWidth: 80,
						flex: 1,
						"& .MuiInputBase-root": { padding: 0 },
					}}
					clearOnBlur
					handleHomeEndKeys
					autoHighlight
					autoSelect
					freeSolo={false}
				/>
			</ChipsContainer>
			{value.length === 0 && (
				<Typography
					variant="caption"
					sx={{ color: theme.palette.text.disabled, marginLeft: 1, marginTop: 0.5 }}
				>
					No categories selected
				</Typography>
			)}
		</FieldContainer>
	);
};
