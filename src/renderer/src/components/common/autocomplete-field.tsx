/**
 * Autocomplete Field Component
 *
 * A reusable component that provides text input with autocomplete dropdown functionality.
 * Users can select from suggestions or enter their own custom value.
 */

import { faCheck, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Autocomplete,
	Box,
	CircularProgress,
	IconButton,
	TextField,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";

/**
 * Option type for autocomplete suggestions
 */
export type AutocompleteOption = {
	/** Unique identifier for the option */
	id: string;
	/** Display label for the option */
	label: string;
	/** Optional description for the option */
	description?: string;
	/** Optional group for categorizing options */
	group?: string;
	/** Optional disabled state */
	disabled?: boolean;
};

type AutocompleteFieldProps = {
	/**
	 * Current value of the field
	 */
	value: string;

	/**
	 * Label for the field
	 */
	label: string;

	/**
	 * Available options for autocomplete
	 */
	options: AutocompleteOption[];

	/**
	 * Callback function when the value is saved
	 * @param value - The new value
	 */
	onSave: (value: string) => Promise<void>;

	/**
	 * Placeholder text when field is empty
	 */
	placeholder?: string;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: ReactNode;

	/**
	 * Whether the field is currently being saved
	 */
	isSaving?: boolean;

	/**
	 * Optional helper text to display below the field
	 */
	helperText?: string;

	/**
	 * Optional function to group options in the dropdown
	 */
	groupBy?: (option: AutocompleteOption) => string;

	/**
	 * Optional function to filter options based on input
	 * If not provided, default filtering will be used
	 */
	filterOptions?: (
		options: AutocompleteOption[],
		inputValue: string,
	) => AutocompleteOption[];

	/**
	 * Whether to allow free text input that's not in the options
	 * Default: true
	 */
	allowFreeText?: boolean;
};

const FieldContainer = styled(Box)({
	marginBottom: 24,
	position: "relative",
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

const StyledAutocomplete = styled(Autocomplete)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: 8,
		backgroundColor: alpha(theme.palette.background.default, 0.7),
	},
	"& .MuiAutocomplete-endAdornment": {
		right: 80, // Further increased space for action buttons
	},
}));

const ActionButtonsContainer = styled(Box)({
	position: "absolute",
	top: 8,
	right: 8,
	display: "flex",
	gap: 8, // Increased gap between buttons
	zIndex: 10,
});

const ActionIconButton = styled(IconButton)({
	padding: 4,
	width: 24, // Fixed width for consistent spacing
	height: 24, // Fixed height for consistent spacing
});

const SaveButton = styled(ActionIconButton)(({ theme }) => ({
	color: theme.palette.success.main,
}));

const CancelButton = styled(ActionIconButton)(({ theme }) => ({
	color: theme.palette.error.main,
}));

const OptionContainer = styled(Box)({
	display: "flex",
	flexDirection: "column",
	width: "100%",
});

const OptionLabel = styled(Typography)({
	fontWeight: 500,
});

const OptionDescription = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
}));

/**
 * Autocomplete Field Component
 *
 * A component that provides text input with autocomplete dropdown functionality.
 * Users can select from suggestions or enter their own custom value.
 */
export const AutocompleteField = ({
	value,
	label,
	options,
	onSave,
	placeholder = "Enter value...",
	icon,
	isSaving = false,
	helperText,
	groupBy,
	allowFreeText = true,
}: AutocompleteFieldProps) => {
	const [inputValue, setInputValue] = useState(value);
	const [editValue, setEditValue] = useState(value);
	const [originalValue, setOriginalValue] = useState(value);
	const [isEditing, setIsEditing] = useState(false);

	// Update the edit value when the value or options prop changes
	useEffect(() => {
		setEditValue(value);
		setInputValue(value);
		setOriginalValue(value);
	}, [value, options.length]);

	/**
	 * Handles changes in the autocomplete selection
	 */
	const handleChange = async (
		_event: SyntheticEvent<Element, Event>,
		newValue: unknown,
	) => {
		let newEditValue = "";
		
		// Determine the new value based on the type
		if (typeof newValue === "string") {
			newEditValue = newValue;
			// String values are considered free text input
			setIsEditing(true);
		} else if (newValue && typeof newValue === "object" && "id" in newValue) {
			newEditValue = (newValue as AutocompleteOption).id;
			// If selected from dropdown, save immediately
			try {
				await onSave(newEditValue);
				setOriginalValue(newEditValue);
				setIsEditing(false);
			} catch (error) {
				console.error("Error saving value:", error);
				setIsEditing(true);
			}
		} else {
			newEditValue = "";
			setIsEditing(true);
		}
		
		setEditValue(newEditValue);
	};

	/**
	 * Handles changes in the input field
	 */
	const handleInputChange = (_event: SyntheticEvent, newInputValue: string) => {
		setInputValue(newInputValue);
		setIsEditing(true);
	};

	/**
	 * Cancels editing and reverts to the original value
	 */
	const handleCancel = () => {
		setEditValue(originalValue);
		setInputValue(originalValue);
		setIsEditing(false);
	};

	/**
	 * Saves the current edit value
	 */
	const handleSave = async () => {
		try {
			await onSave(editValue);
			setOriginalValue(editValue);
			setIsEditing(false);
		} catch (error) {
			// If save fails, revert to original value
			setEditValue(originalValue);
			setInputValue(originalValue);
		}
	};

	const hasChanged = editValue !== originalValue;

	/**
	 * Custom option rendering to show description if available
	 */
	const renderOption = (
		props: React.HTMLAttributes<HTMLLIElement>,
		option: AutocompleteOption,
	) => (
		<li {...props}>
			<OptionContainer>
				<OptionLabel>{option.label}</OptionLabel>
				{option.description && (
					<OptionDescription>{option.description}</OptionDescription>
				)}
			</OptionContainer>
		</li>
	);

	return (
		<FieldContainer>
			<FieldLabel variant="subtitle2">
				{icon && <LabelIcon>{icon}</LabelIcon>}
				{label}
			</FieldLabel>

			<Box sx={{ position: "relative" }}>
				<StyledAutocomplete
					value={editValue}
					inputValue={inputValue}
					onChange={handleChange}
					onInputChange={handleInputChange}
					options={options.map((option) => option.id)}
					// Force re-render when options change
					key={`autocomplete-${options.length}-${editValue}`}
					getOptionLabel={(optionId: unknown): string => {
						if (typeof optionId === "string") {
							const option = options.find((opt) => opt.id === optionId);
							return option ? option.label : optionId;
						}
						return String(optionId);
					}}
					renderOption={(props, optionId: unknown) => {
						if (typeof optionId === "string") {
							const option = options.find((opt) => opt.id === optionId);
							return option ? renderOption(props, option) : null;
						}
						return null;
					}}
					groupBy={
						groupBy
							? (optionId: unknown): string => {
									if (typeof optionId === "string") {
										const option = options.find((opt) => opt.id === optionId);
										return option && groupBy ? groupBy(option) : "";
									}
									return "";
								}
							: undefined
					}
					freeSolo={allowFreeText}
					renderInput={(params) => (
						<TextField
							{...params}
							placeholder={placeholder}
							variant="outlined"
							size="small"
							helperText={helperText}
							FormHelperTextProps={{
								sx: {
									fontSize: '0.7rem',
									mt: 0.5,
									opacity: 0.8,
									fontStyle: 'italic',
								},
							}}
							fullWidth
						/>
					)}
				/>

				<ActionButtonsContainer>
					{isSaving ? (
						<CircularProgress size={20} />
					) : (
						<>
							{/* Only show save/cancel buttons when editing and the value has changed */}
							{hasChanged && isEditing && (
								<>
									<SaveButton
										size="small"
										onClick={handleSave}
										title="Save changes"
										sx={{ marginRight: 1 }} // Add extra margin between buttons
									>
										<FontAwesomeIcon icon={faCheck} size="xs" />
									</SaveButton>
									<CancelButton
										size="small"
										onClick={handleCancel}
										title="Cancel"
										sx={{ marginRight: 1 }} // Add extra margin between buttons
									>
										<FontAwesomeIcon icon={faTimes} size="xs" />
									</CancelButton>
								</>
							)}
						</>
					)}
				</ActionButtonsContainer>
			</Box>
		</FieldContainer>
	);
};
