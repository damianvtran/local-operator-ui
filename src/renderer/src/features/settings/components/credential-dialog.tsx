import { CREDENTIAL_MANIFEST } from "@features/settings/components/credential-manifest";
import {
	Box,
	Button, // Import Button
	CircularProgress,
	FormControl,
	InputLabel,
	Link, // Import Link
	MenuItem,
	Select,
	TextField,
	Typography,
	styled, // Import styled
	useTheme, // Import useTheme
} from "@mui/material";
import type { CredentialUpdate } from "@shared/api/local-operator/types";
import { BaseDialog } from "@shared/components/common/base-dialog"; // Assuming BaseDialog handles basic dialog structure
import { useEffect, useState } from "react";
import type { FC } from "react";

// Shadcn-inspired styles for form elements
const StyledFormControl = styled(FormControl)(({ theme }) => ({
	marginBottom: theme.spacing(2.5), // Consistent spacing
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
	marginBottom: theme.spacing(2.5), // Consistent spacing
	"& .MuiInputBase-root": {
		borderRadius: theme.shape.borderRadius * 0.75,
		backgroundColor: theme.palette.background.paper,
	},
	"& .MuiOutlinedInput-root": {
		"& .MuiOutlinedInput-notchedOutline": {
			borderColor: theme.palette.divider,
		},
		"&:hover .MuiOutlinedInput-notchedOutline": {
			borderColor: theme.palette.text.secondary,
		},
		"&.Mui-focused .MuiOutlinedInput-notchedOutline": {
			borderColor: theme.palette.primary.main,
			borderWidth: "1px",
		},
	},
	"& .MuiInputLabel-root": {
		fontSize: "0.875rem",
		"&.Mui-focused": {
			color: theme.palette.primary.main,
		},
	},
}));

const StyledSelect = styled(Select)(({ theme }) => ({
	borderRadius: theme.shape.borderRadius * 0.75,
	backgroundColor: theme.palette.background.paper,
	"& .MuiOutlinedInput-notchedOutline": {
		borderColor: theme.palette.divider,
	},
	"&:hover .MuiOutlinedInput-notchedOutline": {
		borderColor: theme.palette.text.secondary,
	},
	"&.Mui-focused .MuiOutlinedInput-notchedOutline": {
		borderColor: theme.palette.primary.main,
	},
}));

const DescriptionBox = styled(Box)(({ theme }) => ({
	marginTop: theme.spacing(1),
	marginBottom: theme.spacing(2),
	padding: theme.spacing(1.5),
	backgroundColor: theme.palette.action.hover,
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 0.75,
}));

/**
 * Dialog for adding or editing a credential
 */
export type CredentialDialogProps = {
	open: boolean;
	onClose: () => void;
	onSave: (update: CredentialUpdate) => void;
	initialKey?: string; // Key being edited, or pre-selected key for adding
	existingKeys: string[];
	isSaving: boolean;
	isEditMode: boolean; // Differentiates between Add and Edit modes
};

/**
 * Dialog component for adding or editing credentials with shadcn-inspired styling.
 */
export const CredentialDialog: FC<CredentialDialogProps> = ({
	open,
	onClose,
	onSave,
	initialKey = "",
	existingKeys,
	isSaving,
	isEditMode, // Use the new prop
}) => {
	const theme = useTheme(); // Get theme for button styling
	const [key, setKey] = useState(initialKey); // For Select dropdown
	const [value, setValue] = useState(""); // Credential value (password)
	const [customKey, setCustomKey] = useState(""); // For custom key input
	const [useCustomKey, setUseCustomKey] = useState(false); // Toggle for custom key field

	// Reset state when dialog opens or initialKey/isEditMode changes
	useEffect(() => {
		if (open) {
			const isManifestKey = CREDENTIAL_MANIFEST.some(
				(cred) => cred.key === initialKey,
			);
			const shouldInitCustom = !isEditMode && initialKey && !isManifestKey;

			setKey(isManifestKey ? initialKey : ""); // Set Select value only if it's in manifest
			setValue(""); // Always clear value on open
			setCustomKey(shouldInitCustom ? initialKey : ""); // Set custom key if adding non-manifest key
			setUseCustomKey(shouldInitCustom || (isEditMode && !isManifestKey)); // Use custom field if editing non-manifest or adding custom
		}
	}, [open, initialKey, isEditMode]);

	const handleSave = () => {
		// Determine the final key based on whether it's edit mode or add mode (custom/select)
		let finalKey = "";
		if (isEditMode) {
			finalKey = initialKey; // Key cannot be changed in edit mode
		} else {
			finalKey = useCustomKey ? customKey.trim() : key;
		}

		if (!finalKey) {
			console.error("No key provided for credential");
			return; // Should ideally show validation message
		}
		if (!value.trim()) {
			console.error("No value provided for credential");
			return; // Should ideally show validation message
		}

		onSave({ key: finalKey, value });
	};

	// Check if a key (from select or custom input) already exists (excluding the one being edited)
	const isExistingKey = (k: string) =>
		existingKeys.includes(k) && k !== initialKey;

	// Validation logic
	const isKeyValid = isEditMode
		? true // Key is fixed in edit mode
		: useCustomKey
			? customKey.trim() !== "" && !isExistingKey(customKey) // Custom key must be non-empty and not exist
			: key !== "" && !isExistingKey(key); // Selected key must be non-empty and not exist

	const isValueValid = value.trim() !== "";
	const canSave = isKeyValid && isValueValid && !isSaving;

	// Find details for the selected manifest credential (if any)
	const selectedCredentialManifest = CREDENTIAL_MANIFEST.find(
		(cred) => cred.key === key,
	);

	const dialogTitle = isEditMode ? "Update Credential" : "Add New Credential";

	// Shadcn-inspired Dialog Actions
	const dialogActions = (
		<>
			<Button
				onClick={onClose}
				variant="outlined" // Secondary action
				size="small"
				sx={{
					borderColor: theme.palette.divider,
					color: theme.palette.text.secondary,
					textTransform: "none",
					fontSize: "0.8125rem",
					padding: theme.spacing(0.75, 2),
					borderRadius: theme.shape.borderRadius * 0.75,
					"&:hover": {
						backgroundColor: theme.palette.action.hover,
						borderColor: theme.palette.divider,
					},
				}}
			>
				Cancel
			</Button>
			<Button
				onClick={handleSave}
				variant="contained" // Primary action
				color="primary"
				size="small"
				disabled={!canSave}
				startIcon={
					isSaving ? <CircularProgress size={16} color="inherit" /> : null
				}
				sx={{
					textTransform: "none",
					fontSize: "0.8125rem",
					padding: theme.spacing(0.75, 2),
					borderRadius: theme.shape.borderRadius * 0.75,
					boxShadow: "none",
					"&:hover": {
						boxShadow: "none",
						opacity: 0.9,
					},
				}}
			>
				{isSaving ? "Saving..." : "Save"}
			</Button>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
			// Apply some padding via contentSx if BaseDialog supports it, or wrap content
			// contentSx={{ pt: 2 }} // BaseDialog doesn't support contentSx, wrap content instead
		>
			{/* Wrap content in a Box for padding */}
			<Box sx={{ pt: 2 }}>
				{/* Key Selection/Display */}
				{isEditMode ? (
					// Display the key being edited (non-editable)
					<Box mb={2.5}>
						<Typography variant="overline" color="text.secondary">
							Credential Key
						</Typography>
						<Typography fontWeight={500}>{initialKey}</Typography>
					</Box>
				) : (
					// Show selection for adding new credentials
					<>
						<StyledFormControl fullWidth>
							<InputLabel id="credential-key-label">Credential Type</InputLabel>
							<StyledSelect
								labelId="credential-key-label"
								value={useCustomKey ? "_custom_" : key}
								label="Credential Type"
								onChange={(e) => {
									// Cast value to string
									const selectedValue = e.target.value as string;
									if (selectedValue === "_custom_") {
										setUseCustomKey(true);
										setKey(""); // Clear selected manifest key
									} else {
										setUseCustomKey(false);
										setKey(selectedValue);
										setCustomKey(""); // Clear custom key
									}
								}}
								displayEmpty={!key && !useCustomKey} // Show label correctly when empty
							>
								<MenuItem value="" disabled>
									<em>Select a credential type...</em>
								</MenuItem>
								{CREDENTIAL_MANIFEST.map((cred) => (
									<MenuItem
										key={cred.key}
										value={cred.key}
										disabled={isExistingKey(cred.key)}
									>
										{cred.name} {isExistingKey(cred.key) && "(Configured)"}
									</MenuItem>
								))}
								<MenuItem value="_custom_">Custom Credential</MenuItem>
							</StyledSelect>
						</StyledFormControl>

						{useCustomKey && (
							<StyledTextField
								label="Custom Credential Key"
								fullWidth
								value={customKey}
								onChange={(e) => setCustomKey(e.target.value)}
								error={isExistingKey(customKey)}
								helperText={
									isExistingKey(customKey)
										? "This credential already exists"
										: ""
								}
								required
								autoFocus // Focus custom key field when shown
							/>
						)}

						{/* Show description and link if a manifest item is selected */}
						{selectedCredentialManifest && !useCustomKey && (
							<DescriptionBox>
								<Typography variant="body2" color="text.secondary" gutterBottom>
									{selectedCredentialManifest.description}
								</Typography>
								{selectedCredentialManifest.url && (
									<Link
										href={selectedCredentialManifest.url}
										target="_blank"
										rel="noopener noreferrer"
										variant="body2"
										sx={{ display: "inline-flex", alignItems: "center" }}
									>
										Get your {selectedCredentialManifest.name} key
									</Link>
								)}
							</DescriptionBox>
						)}
					</>
				)}

				{/* Value Input (Password) */}
				<StyledTextField
					label="Credential Value"
					fullWidth
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && canSave) {
							handleSave();
						}
					}}
					required
					autoFocus={isEditMode} // Focus value field when editing
					helperText={
						isEditMode
							? `Enter the new value for ${initialKey}`
							: "Enter the credential value or API key."
					}
				/>
			</Box>{" "}
			{/* Close padding Box */}
		</BaseDialog>
	);
};
