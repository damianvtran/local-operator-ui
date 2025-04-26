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
	IconButton,
	TextField,
	Typography,
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
	marginBottom: 16, // Reduced margin
});

const FieldLabel = styled(Typography)(({ theme }) => ({
	marginBottom: 6, // Reduced margin
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.secondary,
	fontWeight: 500, // Slightly less bold
	fontSize: "0.875rem", // Small text size
}));

const LabelIcon = styled(Box)({
	marginRight: 8, // Reduced margin
	opacity: 0.9,
	display: "flex",
	alignItems: "center",
});

// Mimic shadcn Input style
const StyledTextField = styled(TextField)<{ multiline?: boolean }>(
	({ theme, multiline }) => ({
		"& .MuiOutlinedInput-root": {
			borderRadius: 6, // Slightly less rounded
			backgroundColor: theme.palette.background.paper, // Use paper background
			border: `1px solid ${theme.palette.divider}`, // Use divider color for border
			padding: 0, // Remove root padding
			minHeight: multiline ? "auto" : "36px", // Target height
			height: multiline ? "auto" : "36px", // Explicit height
			alignItems: multiline ? "flex-start" : "center",
			transition: "border-color 0.2s ease, box-shadow 0.2s ease",
			"&:hover": {
				borderColor: theme.palette.text.secondary, // Darker border on hover
				backgroundColor: theme.palette.background.paper, // Keep background consistent
			},
			"&.Mui-focused": {
				backgroundColor: theme.palette.background.paper, // Keep background consistent
				borderColor: theme.palette.primary.main, // Primary border color on focus
				boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`, // Subtle focus ring like shadcn
			},
			// Remove default outline
			"& .MuiOutlinedInput-notchedOutline": {
				border: "none",
			},
		},
		"& .MuiInputBase-input": {
			padding: multiline ? "8px 12px" : "4px 12px", // Target inner padding (vertical 4px)
			fontSize: "0.875rem", // Small text size
			lineHeight: 1.5, // Adjusted line height
			fontFamily: "inherit",
			height: multiline ? "auto" : "calc(36px - 8px)", // Adjust height based on padding
			// Ensure text doesn't overflow container
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: multiline ? "pre-wrap" : "nowrap",
			wordBreak: "break-word", // Keep break-word for multiline
			alignSelf: multiline ? "flex-start" : "center", // Center single line text vertically
		},
		// Style placeholder
		"& .MuiInputBase-input::placeholder": {
			color: theme.palette.text.disabled,
			opacity: 1, // Ensure placeholder is visible
		},
	}),
);

// Container for buttons inside the input field
const ActionButtonsContainer = styled(Box)({
	position: "absolute",
	top: "50%", // Center vertically
	transform: "translateY(-50%)", // Adjust vertical centering
	right: 6, // Position from right
	display: "flex",
	alignItems: "center", // Align items vertically
	gap: 4,
	zIndex: 10,
});

// Base styles for icon buttons mimicking shadcn ghost/icon button
const ActionIconButton = styled(IconButton)(({ theme }) => ({
	padding: 4, // Smaller padding
	borderRadius: 4, // Slightly rounded corners
	height: 24, // Smaller height
	width: 24, // Smaller width
	color: theme.palette.text.secondary, // Default color
	"&:hover": {
		backgroundColor: theme.palette.action.hover, // Subtle hover background
		color: theme.palette.text.primary,
	},
}));

// Specific styles for Save button
const SaveButton = styled(ActionIconButton)(({ theme }) => ({
	color: theme.palette.success.main, // Green color for save
	"&:hover": {
		backgroundColor: `${theme.palette.success.main}1A`, // Lighter green background on hover
		color: theme.palette.success.dark,
	},
}));

// Specific styles for Cancel button
const CancelButton = styled(ActionIconButton)(({ theme }) => ({
	color: theme.palette.error.main, // Red color for cancel/close
	"&:hover": {
		backgroundColor: `${theme.palette.error.main}1A`, // Lighter red background on hover
		color: theme.palette.error.dark,
	},
}));

// Mimic shadcn secondary/destructive button for Clear
const ClearButton = styled(Button)(({ theme }) => ({
	backgroundColor: theme.palette.action.selected, // Use a subtle background
	color: theme.palette.error.main, // Destructive text color
	minWidth: "auto",
	height: 24, // Match icon button height
	padding: "0 8px", // Horizontal padding
	fontSize: "0.75rem", // Smaller text
	borderRadius: 4,
	textTransform: "none", // No uppercase
	boxShadow: "none",
	border: `1px solid ${theme.palette.action.disabledBackground}`, // Subtle border
	marginLeft: 4, // Add some space from icons
	marginRight: 16,
	"&:hover": {
		backgroundColor: theme.palette.action.hover, // Consistent hover
		borderColor: theme.palette.error.light,
		boxShadow: "none",
	},
	// Adjust icon size and margin
	"& .MuiButton-startIcon": {
		marginRight: 4,
		marginLeft: -2,
		"& > *:nth-of-type(1)": {
			// Target the FontAwesomeIcon
			fontSize: "0.8rem",
		},
	},
}));

/**
 * DisplayContainer is a styled native button for accessibility.
 * Interactive children (edit/clear) are rendered outside the button to avoid nested button issues.
 */
const DisplayContainer = styled("button", {
	shouldForwardProp: (prop) => prop !== "multiline",
})<{ multiline?: boolean }>(({ theme, multiline }) => ({
	padding: multiline ? "8px 12px" : "4px 12px",
	borderRadius: 6,
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	position: "relative",
	minHeight: multiline ? "auto" : "36px",
	height: multiline ? "auto" : "36px",
	display: "flex",
	alignItems: multiline ? "flex-start" : "center",
	transition: "border-color 0.2s ease, background-color 0.2s ease",
	cursor: "pointer",
	boxSizing: "border-box",
	width: "100%",
	textAlign: "left",
	textTransform: "none",
	justifyContent: "flex-start",
	color: theme.palette.text.primary,
	fontWeight: "normal",
	fontFamily: "inherit",
	outline: "none",
	"&:hover, &:focus": {
		borderColor: theme.palette.text.secondary,
		backgroundColor: theme.palette.action.hover,
	},
	"&:focus-visible": {
		outline: `2px solid ${theme.palette.primary.main}`,
	},
}));

// Adjust display text style
const DisplayText = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "multiline",
})<{ multiline?: boolean }>(({ multiline }) => ({
	fontSize: "0.875rem", // Match input text size
	lineHeight: 1.5, // Match input line height
	fontFamily: "inherit", // Use standard font
	whiteSpace: multiline ? "pre-wrap" : "nowrap",
	wordBreak: "break-word",
	paddingRight: 30, // Space for the edit button
	overflow: "hidden", // Prevent overflow
	textOverflow: "ellipsis", // Add ellipsis if text is too long
	flexGrow: 1, // Allow text to take available space
	alignSelf: multiline ? "flex-start" : "center", // Center single line text vertically
}));

// Adjust placeholder style
const PlaceholderText = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.disabled,
	fontStyle: "normal", // Remove italic
	fontSize: "0.875rem", // Match input text size
	lineHeight: 1.5, // Match input line height
	paddingRight: 30, // Space for the edit button
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	flexGrow: 1,
}));

// Mimic shadcn icon button for Edit button
const EditButton = styled(IconButton)(({ theme }) => ({
	position: "absolute",
	top: "50%", // Center vertically
	transform: "translateY(-50%)", // Adjust vertical centering
	right: 6, // Position from right
	color: theme.palette.text.secondary, // Use secondary text color
	opacity: 0, // Hidden by default
	transition: "opacity 0.2s ease, background-color 0.2s ease, color 0.2s ease",
	padding: 4, // Match other icon buttons
	borderRadius: 4, // Match other icon buttons
	height: 24, // Match other icon buttons
	width: 24, // Match other icon buttons
	marginLeft: 4,
	"&:hover": {
		backgroundColor: theme.palette.action.hover, // Subtle hover background
		color: theme.palette.text.primary,
	},
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
	isSaving: externalIsSaving = false, // Rename prop to avoid conflict
}) => {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(value);
	const [displayValue, setDisplayValue] = useState(value); // Separate display value
	const [originalValue, setOriginalValue] = useState(value); // Value when edit started
	const [internalIsSaving, setInternalIsSaving] = useState(false); // Internal saving state
	const [isClearing, setIsClearing] = useState(false); // Clearing state
	const inputRef = useRef<HTMLInputElement>(null);
	const actionButtonsRef = useRef<HTMLDivElement>(null); // Ref for action buttons container

	const isSaving = externalIsSaving || internalIsSaving; // Combine saving states

	// Update internal states when the external value prop changes
	useEffect(() => {
		// Only update if not currently editing to avoid disrupting user input
		if (!isEditing) {
			setEditValue(value);
			setDisplayValue(value);
			setOriginalValue(value);
		} else {
			// If editing, update the original value baseline in case the prop changed externally
			// but keep the user's current editValue
			setOriginalValue(value);
		}
	}, [value, isEditing]);

	// Focus the input and select text when entering edit mode
	useEffect(() => {
		if (isEditing) {
			// Timeout needed to ensure the input is rendered and focusable
			const timer = setTimeout(() => {
				if (inputRef.current) {
					inputRef.current.focus();
					// Select all text for easy replacement
					inputRef.current.select();
				}
			}, 0);
			return () => clearTimeout(timer);
		}
		return undefined;
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
		setEditValue(originalValue); // Revert edit value
		setIsEditing(false); // Exit editing mode
	};

	/**
	 * Saves the current edit value.
	 */
	const handleSave = async () => {
		if (isSaving || editValue === originalValue) return; // Prevent saving if already saving or no changes

		setInternalIsSaving(true); // Set internal saving state
		try {
			await onSave(editValue);
			// On successful save, update the baseline values and exit edit mode
			setOriginalValue(editValue);
			setDisplayValue(editValue); // Update display value immediately
			setIsEditing(false);
		} catch (error) {
			console.error("Failed to save editable field:", error);
			// Optionally: Add user feedback about the failure (e.g., toast notification)
			// Revert edit value to the last known good state (originalValue)
			setEditValue(originalValue);
			// Do not exit edit mode on failure, allow user to retry or cancel
		} finally {
			setInternalIsSaving(false); // Reset internal saving state
		}
	};

	/**
	 * Handles blur event on the text field.
	 * Prevents auto-cancel if focus is moving to one of the action buttons.
	 *
	 * @param e - The blur event.
	 */
	const handleBlur = (
		e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		// Use setTimeout to allow click events on buttons to register before blur cancels edit mode
		setTimeout(() => {
			// Check if the new focused element is one of the action buttons or the clear button
			const relatedTarget = e.relatedTarget as Node | null;
			const isFocusWithinActionButtons =
				actionButtonsRef.current?.contains(relatedTarget) ?? false;

			// If focus moved outside the input and its action buttons, and there are no changes, cancel editing.
			// If there *are* changes, keep editing mode active. User must explicitly save or cancel.
			if (!isFocusWithinActionButtons && editValue === originalValue) {
				setIsEditing(false);
			}
		}, 0);
	};

	/**
	 * Handles key press events in the text field.
	 * Saves the value when Enter is pressed if there are changes.
	 *
	 * @param e - The keyboard event.
	 */
	const handleKeyDown = (
		e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>,
	) => {
		if (e.key === "Escape") {
			handleCancel();
		} else if (e.key === "Enter") {
			// Save on Enter for single line, Ctrl/Cmd+Enter for multiline
			if (!multiline || (multiline && (e.ctrlKey || e.metaKey))) {
				e.preventDefault(); // Prevent newline in multiline
				if (editValue !== originalValue) {
					handleSave();
				} else {
					// If no changes, Enter should just exit edit mode
					setIsEditing(false);
				}
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
		e.preventDefault(); // Prevent triggering edit mode if clicking clear on display view
		e.stopPropagation(); // Stop propagation

		if (isSaving || isClearing) return; // Prevent action if already busy

		setIsClearing(true);
		setInternalIsSaving(true); // Use internal saving state for visual feedback

		// Optimistically update UI
		setEditValue("");
		setDisplayValue("");

		onSave("")
			.then(() => {
				// Confirm state on success
				setOriginalValue("");
				setIsEditing(false); // Exit edit mode after successful clear
			})
			.catch((error) => {
				console.error("Failed to clear field:", error);
				// Revert optimistic updates on failure
				setEditValue(originalValue);
				setDisplayValue(originalValue);
				// Optionally provide user feedback
			})
			.finally(() => {
				setIsClearing(false);
				setInternalIsSaving(false);
			});
	};

	/**
	 * Handles keydown events on the display container (button) to activate edit mode.
	 * @param e - The keyboard event.
	 */
	const handleDisplayContainerKeyDown = (
		e: KeyboardEvent<HTMLButtonElement>,
	) => {
		// Activate edit mode on Enter/Space
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handleEdit();
		}
	};

	const hasChanged = editValue !== originalValue;
	// Show clear button if not saving, and the *original* value isn't empty.
	// This prevents showing clear immediately after clearing until a save happens.
	const showClearButton = !isSaving && originalValue !== "";

	return (
		<FieldContainer>
			<FieldLabel>
				{icon && <LabelIcon>{icon}</LabelIcon>}
				{label}
			</FieldLabel>

			{isEditing ? (
				<Box sx={{ position: "relative" }}>
					<StyledTextField
						fullWidth
						variant="outlined" // Keep variant for structure, style overrides hide default look
						value={editValue}
						onChange={handleChange}
						onBlur={handleBlur}
						onKeyDown={handleKeyDown} // Use onKeyDown for Escape/Enter
						multiline={multiline}
						rows={multiline ? rows : undefined}
						placeholder={placeholder}
						inputRef={inputRef}
						// size="small" // Size is controlled by styled component height/padding
						autoComplete="off" // Disable browser autocomplete
					/>
					<ActionButtonsContainer ref={actionButtonsRef}>
						{isSaving ? (
							// Simple text indicator instead of CircularProgress
							<Typography
								variant="caption"
								sx={{ color: "text.secondary", px: 1 }}
							>
								{isClearing ? "Clearing..." : "Saving..."}
							</Typography>
						) : (
							<>
								{hasChanged && (
									<SaveButton
										size="small" // MUI size prop might affect internal padding, rely on styled-component
										onClick={handleSave}
										title="Save changes (Enter)"
									>
										{/* Use smaller icon */}
										<FontAwesomeIcon icon={faCheck} size="sm" />
									</SaveButton>
								)}
								<CancelButton
									size="small"
									onClick={handleCancel}
									title="Cancel (Escape)"
								>
									<FontAwesomeIcon icon={faTimes} size="sm" />
								</CancelButton>
								{/* Conditionally render Clear button only when editing and no changes */}
								{showClearButton && !hasChanged && (
									<ClearButton
										size="small"
										onClick={clearField}
										title="Clear field"
										startIcon={<FontAwesomeIcon icon={faEraser} />} // Default size might be better
									>
										Clear
									</ClearButton>
								)}
							</>
						)}
					</ActionButtonsContainer>
				</Box>
			) : (
				<Box sx={{ position: "relative", width: "100%" }}>
					<DisplayContainer
						type="button"
						onClick={handleEdit}
						multiline={multiline}
						aria-label={`Current value: ${displayValue || placeholder}. Click to edit.`}
						onKeyDown={handleDisplayContainerKeyDown}
					>
						{displayValue ? (
							<DisplayText multiline={multiline}>{displayValue}</DisplayText>
						) : (
							<PlaceholderText>{placeholder}</PlaceholderText>
						)}
					</DisplayContainer>
					{/* Absolutely position edit/clear buttons visually inside, but outside the button in DOM */}
					<EditButton
						className="edit-button"
						size="small"
						sx={{
							position: "absolute",
							top: "50%",
							right: 6,
							transform: "translateY(-50%)",
							opacity: 0,
							transition: "opacity 0.2s ease",
							pointerEvents: "auto",
							"&:hover, &:focus, button:focus + &": { opacity: 1 },
						}}
						onClick={handleEdit}
						title="Edit"
						aria-label={`Edit ${label}`}
						tabIndex={-1}
					>
						<FontAwesomeIcon icon={faPen} size="xs" />
					</EditButton>
					{showClearButton && (
						<ClearButton
							className="edit-button"
							sx={{
								position: "absolute",
								top: "50%",
								right: 36,
								transform: "translateY(-50%)",
								opacity: 0,
								transition: "opacity 0.2s ease",
								pointerEvents: "auto",
								"&:hover, &:focus, button:focus + &": { opacity: 1 },
							}}
							size="small"
							onClick={clearField}
							title="Clear field"
							aria-label={`Clear ${label}`}
							startIcon={<FontAwesomeIcon icon={faEraser} />}
							tabIndex={-1}
						>
							Clear
						</ClearButton>
					)}
				</Box>
			)}
		</FieldContainer>
	);
};
