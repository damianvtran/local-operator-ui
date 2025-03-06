/**
 * Editable Field Component
 *
 * A component that allows for inline editing of text fields with explicit save
 */

import {
	faCheck,
	faEraser,
	faPen,
	faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	CircularProgress,
	IconButton,
	TextField,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { ChangeEvent, FC, FocusEvent, KeyboardEvent } from "react";

type EditableFieldProps = {
	/**
	 * Current value of the field
	 */
	value: string;

	/**
	 * Label for the field
	 */
	label: string;

	/**
	 * Callback function when the value is saved
	 * @param value - The new value
	 */
	onSave: (value: string) => Promise<void>;

	/**
	 * Whether the field is multiline
	 */
	multiline?: boolean;

	/**
	 * Number of rows for multiline fields
	 */
	rows?: number;

	/**
	 * Placeholder text when field is empty
	 */
	placeholder?: string;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: React.ReactNode;

	/**
	 * Whether the field is currently being saved
	 */
	isSaving?: boolean;
};

const FieldContainer = styled(Box)({
	marginBottom: 24,
});

const FieldLabel = styled(Typography)(({ theme }) => ({
	marginBottom: 8,
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.secondary,
	fontWeight: 600,
}));

const LabelIcon = styled(Box)({
	marginRight: 12,
	opacity: 0.8,
});

const StyledTextField = styled(TextField)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: 8,
		backgroundColor: alpha(theme.palette.background.default, 0.7),
	},
}));

const ActionButtonsContainer = styled(Box)({
	position: "absolute",
	top: 8,
	right: 8,
	display: "flex",
	gap: 4,
	zIndex: 10,
});

const ActionIconButton = styled(IconButton)({
	padding: 4,
});

const SaveButton = styled(ActionIconButton)(({ theme }) => ({
	color: theme.palette.success.main,
}));

const CancelButton = styled(ActionIconButton)(({ theme }) => ({
	color: theme.palette.error.main,
}));

const ClearButton = styled(Button)(({ theme }) => ({
	backgroundColor: theme.palette.warning.main,
	color: "white",
	minWidth: "auto",
	padding: "2px 8px",
	"&:hover": {
		backgroundColor: theme.palette.warning.dark,
	},
	zIndex: 20,
}));

const DisplayContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "multiline",
})<{ multiline?: boolean }>(({ theme, multiline }) => ({
	padding: 16,
	borderRadius: 8,
	backgroundColor: alpha(theme.palette.background.default, 0.7),
	position: "relative",
	minHeight: multiline ? "100px" : "40px",
	display: "flex",
	alignItems: multiline ? "flex-start" : "center",
	transition: "all 0.2s ease",
	cursor: "pointer",
	"&:hover": {
		backgroundColor: alpha(theme.palette.background.default, 0.9),
		"& .edit-button": {
			opacity: 1,
		},
	},
}));

const DisplayText = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "multiline",
})<{ multiline?: boolean }>(({ multiline }) => ({
	whiteSpace: multiline ? "pre-wrap" : "normal",
	fontFamily: multiline ? '"Roboto Mono", monospace' : "inherit",
	fontSize: "0.875rem",
	lineHeight: 1.6,
	wordBreak: "break-word",
	paddingRight: 32,
}));

const PlaceholderText = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.disabled,
	fontStyle: "italic",
}));

const EditButton = styled(IconButton)(({ theme }) => ({
	position: "absolute",
	top: 8,
	right: 8,
	color: theme.palette.primary.main,
	opacity: 0,
	transition: "opacity 0.2s ease",
	padding: 4,
}));

/**
 * Editable Field Component
 *
 * A component that allows for inline editing of text fields with explicit save.
 *
 * @param props - EditableFieldProps
 */
export const EditableField: FC<EditableFieldProps> = ({
	value,
	label,
	onSave,
	multiline = false,
	rows = 4,
	placeholder = "Enter value...",
	icon,
	isSaving = false,
}) => {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(value);
	const [displayValue, setDisplayValue] = useState(value);
	const [originalValue, setOriginalValue] = useState(value);
	const [isClearing, setIsClearing] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const actionButtonsRef = useRef<HTMLDivElement>(null);

	// Update the edit value when the value prop changes
	useEffect(() => {
		setEditValue(value);
		setDisplayValue(value);
		setOriginalValue(value);
	}, [value]);

	// Focus the input when entering edit mode
	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isEditing]);

	/**
	 * Handles entering edit mode.
	 */
	const handleEdit = () => {
		setIsEditing(true);
	};

	/**
	 * Handles changes in the text field.
	 *
	 * @param e - The change event.
	 */
	const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
		setEditValue(e.target.value);
	};

	/**
	 * Cancels editing and reverts to the original value.
	 */
	const handleCancel = () => {
		setEditValue(originalValue);
		setIsEditing(false);
	};

	/**
	 * Saves the current edit value.
	 */
	const handleSave = async () => {
		try {
			await onSave(editValue);
			// Update the display value immediately after successful save
			setDisplayValue(editValue);
			setOriginalValue(editValue);
			setIsEditing(false);
		} catch (error) {
			// If save fails, revert to original value
			setEditValue(originalValue);
		}
	};

	/**
	 * Handles blur event on the text field.
	 * Prevents auto-cancel if focus is moving to one of the action buttons.
	 *
	 * @param e - The blur event.
	 */
	const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
		if (
			actionButtonsRef.current &&
			e.relatedTarget &&
			actionButtonsRef.current.contains(e.relatedTarget as Node)
		) {
			return;
		}
		if (editValue === originalValue) {
			setIsEditing(false);
		}
	};

	/**
	 * Handles key press events in the text field.
	 * Saves the value when Enter is pressed if there are changes.
	 *
	 * @param e - The keyboard event.
	 */
	const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && !multiline) {
			e.preventDefault();
			if (editValue !== originalValue) {
				handleSave();
			}
		} else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && multiline) {
			e.preventDefault();
			if (editValue !== originalValue) {
				handleSave();
			}
		}
	};

	/**
	 * Clears the field by forcing its value to empty and calling onSave.
	 * This function bypasses change detection and clears regardless of current value.
	 *
	 * @param e - The mouse event.
	 */
	const clearField = (e: React.MouseEvent) => {
		// Prevent any event bubbling
		e.preventDefault();
		e.stopPropagation();

		console.log("Clear button clicked");
		setIsClearing(true);

		// Force the field to be empty first
		setEditValue("");

		// Direct API call to clear the field - using a timeout to ensure UI updates first
		setTimeout(() => {
			onSave("")
				.then(() => {
					console.log("Field cleared successfully");
					// Update all state variables
					setDisplayValue("");
					setOriginalValue("");
					setIsEditing(false);
				})
				.catch((error) => {
					console.error("Failed to clear field:", error);
				})
				.finally(() => {
					setIsClearing(false);
				});
		}, 0);
	};

	const hasChanged = editValue !== originalValue;

	return (
		<FieldContainer>
			<FieldLabel variant="subtitle2">
				{icon && <LabelIcon>{icon}</LabelIcon>}
				{label}
			</FieldLabel>

			{isEditing ? (
				<Box sx={{ position: "relative" }}>
					<StyledTextField
						fullWidth
						variant="outlined"
						value={editValue}
						onChange={handleChange}
						onBlur={handleBlur}
						onKeyPress={handleKeyPress}
						multiline={multiline}
						rows={multiline ? rows : undefined}
						placeholder={placeholder}
						inputRef={inputRef}
						size="small"
					/>
					<ActionButtonsContainer ref={actionButtonsRef}>
						{isSaving || isClearing ? (
							<CircularProgress size={20} />
						) : (
							<>
								{hasChanged ? (
									<>
										<SaveButton
											size="small"
											onClick={handleSave}
											title="Save changes"
										>
											<FontAwesomeIcon icon={faCheck} size="xs" />
										</SaveButton>
										<CancelButton
											size="small"
											onClick={handleCancel}
											title="Cancel"
										>
											<FontAwesomeIcon icon={faTimes} size="xs" />
										</CancelButton>
									</>
								) : (
									<CancelButton
										size="small"
										onClick={handleCancel}
										title="Cancel"
									>
										<FontAwesomeIcon icon={faTimes} size="xs" />
									</CancelButton>
								)}

								<ClearButton
									variant="contained"
									size="small"
									onClick={clearField}
									title="Clear field"
									startIcon={<FontAwesomeIcon icon={faEraser} size="xs" />}
								>
									Clear
								</ClearButton>
							</>
						)}
					</ActionButtonsContainer>
				</Box>
			) : (
				<DisplayContainer onClick={handleEdit} multiline={multiline}>
					{displayValue ? (
						<DisplayText
							variant="body2"
							sx={{ whiteSpace: multiline ? "pre-wrap" : "normal" }}
						>
							{displayValue}
						</DisplayText>
					) : (
						<PlaceholderText variant="body2">{placeholder}</PlaceholderText>
					)}

					<EditButton
						className="edit-button"
						size="small"
						onClick={handleEdit}
						title="Edit"
					>
						<FontAwesomeIcon icon={faPen} size="xs" />
					</EditButton>
				</DisplayContainer>
			)}
		</FieldContainer>
	);
};
