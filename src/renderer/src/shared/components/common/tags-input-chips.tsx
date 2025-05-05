/**
 * TagsInputChips Component
 *
 * Free-form input for tags as deletable chips.
 * - ENTER to add tag (normalized to lowercase)
 * - Deletable chips
 * - Theme-aware, shadcn/MUI style, consistent with EditableField
 */

import { useRef, useState } from "react";
import type { FC, KeyboardEvent, ChangeEvent } from "react";
import { Box, Chip, IconButton, InputBase, Typography, styled, useTheme } from "@mui/material";
import { faPlus, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

type TagsInputChipsProps = {
	/** Current tags */
	value: string[];
	/** Label for the field */
	label: string;
	/** Callback when tags change */
	onChange: (tags: string[]) => void;
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

const StyledInput = styled(InputBase)(({ theme }) => ({
	minWidth: 80,
	flex: 1,
	fontSize: "0.875rem",
	padding: theme.spacing(0.5, 1),
	background: "transparent",
	color: theme.palette.text.primary,
	"& input": {
		padding: 0,
	},
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

export const TagsInputChips: FC<TagsInputChipsProps> = ({
	value,
	label,
	onChange,
	placeholder = "Add tag...",
	disabled = false,
	icon,
}) => {
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const theme = useTheme();

	const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
		setInput(e.target.value);
	};

	const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && input.trim()) {
			e.preventDefault();
			const newTag = input.trim().toLowerCase();
			if (newTag && !value.includes(newTag)) {
				onChange([...value, newTag]);
			}
			setInput("");
		} else if (e.key === "Backspace" && !input && value.length > 0) {
			// Remove last tag if input is empty and backspace is pressed
			onChange(value.slice(0, -1));
		}
	};

	const handleDelete = (tag: string) => {
		onChange(value.filter((t) => t !== tag));
	};

	return (
		<FieldContainer>
			<FieldLabel>
				{icon && <LabelIcon>{icon}</LabelIcon>}
				{label}
			</FieldLabel>
			<ChipsContainer>
				{value.map((tag) => (
					<StyledChip
						key={tag}
						label={tag}
						onDelete={disabled ? undefined : () => handleDelete(tag)}
						disabled={disabled}
						deleteIcon={
							<IconButton
								size="small"
								aria-label={`Remove tag ${tag}`}
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
				<StyledInput
					inputRef={inputRef}
					value={input}
					onChange={handleInputChange}
					onKeyDown={handleInputKeyDown}
					placeholder={placeholder}
					disabled={disabled}
					inputProps={{
						"aria-label": label,
						style: { fontSize: "0.875rem" },
					}}
					sx={{ minWidth: 80, flex: 1 }}
				/>
				{input.trim() && (
					<IconButton
						size="small"
						aria-label="Add tag"
						onClick={() => {
							const newTag = input.trim().toLowerCase();
							if (newTag && !value.includes(newTag)) {
								onChange([...value, newTag]);
							}
							setInput("");
							inputRef.current?.focus();
						}}
						disabled={disabled}
						sx={{
							marginLeft: 0.5,
							color: theme.palette.primary.main,
							"&:hover": { color: theme.palette.primary.dark },
						}}
					>
						<FontAwesomeIcon icon={faPlus} size="xs" />
					</IconButton>
				)}
			</ChipsContainer>
			{value.length === 0 && !input && (
				<Typography
					variant="caption"
					sx={{ color: theme.palette.text.disabled, marginLeft: 1, marginTop: 0.5 }}
				>
					No tags added
				</Typography>
			)}
		</FieldContainer>
	);
};
