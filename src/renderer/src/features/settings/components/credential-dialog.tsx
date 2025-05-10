import { CREDENTIAL_MANIFEST } from "@features/settings/components/credential-manifest";
import { faKey } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	CircularProgress,
	FormControl,
	Link,
	MenuItem,
	OutlinedInput,
	Select,
	TextField,
	Typography,
	alpha,
	styled,
	useTheme,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { CredentialUpdate } from "@shared/api/local-operator/types";
import { BaseDialog } from "@shared/components/common/base-dialog";
import { useEffect, useState } from "react";
import type { FC } from "react";

/**
 * Styled OutlinedInput for Select to achieve shadcn/modern look
 */
const StyledOutlinedInput = styled(OutlinedInput)(({ theme }) => ({
	borderRadius: theme.shape.borderRadius * 0.75,
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	minHeight: "40px",
	height: "40px",
	fontSize: "0.875rem",
	paddingRight: 0,
	"& .MuiOutlinedInput-notchedOutline": {
		border: "none",
	},
	"& .MuiSelect-select": {
		display: "flex",
		alignItems: "center",
		gap: theme.spacing(1),
		fontSize: "0.875rem",
		padding: theme.spacing(1, 1.5),
		height: "calc(40px - 16px)",
		boxSizing: "border-box",
	},
	"& .MuiInputBase-input": {
		padding: theme.spacing(1, 1.5),
		fontSize: "0.875rem",
		height: "calc(40px - 16px)",
		boxSizing: "border-box",
	},
	"& .MuiInputBase-input::placeholder": {
		color: theme.palette.text.disabled,
		opacity: 1,
	},
	"&:hover": {
		borderColor: theme.palette.text.secondary,
	},
	"&.Mui-focused": {
		borderColor: theme.palette.primary.main,
		boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
	},
}));

/**
 * Shadcn-inspired menu props for Select dropdown
 */
const menuPropsSx = (theme: Theme) => ({
	PaperProps: {
		sx: {
			borderRadius: theme.shape.borderRadius * 0.75,
			boxShadow: theme.shadows[2],
			mt: 0.5,
			"& .MuiMenuItem-root": {
				fontSize: "0.875rem",
				minHeight: "40px",
				px: 2,
			},
		},
	},
});

/**
 * TextField input styles for custom key and credential value fields
 */
const textFieldInputSx = (theme: Theme) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: theme.shape.borderRadius * 0.75,
		backgroundColor: theme.palette.background.paper,
		border: `1px solid ${theme.palette.divider}`,
		minHeight: "40px",
		height: "40px",
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
		padding: theme.spacing(1, 1.5),
		fontSize: "0.875rem",
		height: "calc(40px - 16px)",
		boxSizing: "border-box",
	},
	"& .MuiInputBase-input::placeholder": {
		color: theme.palette.text.disabled,
		opacity: 1,
	},
	"& .MuiFormHelperText-root": {
		fontSize: "0.75rem",
		mt: 0.5,
		ml: 0.5,
	},
});

/**
 * Description box styling
 */
const DescriptionBoxSx = (theme: Theme) => ({
	marginTop: theme.spacing(1),
	marginBottom: theme.spacing(2),
	padding: theme.spacing(1.5),
	backgroundColor: alpha(theme.palette.background.default, 0.5),
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 0.75,
});

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

	// Styled label and icon (matches EditableField/GeneralSettings)
	const FieldLabel = styled("div")(({ theme }) => ({
		fontFamily: theme.typography.fontFamily,
		fontSize: "0.875rem",
		fontWeight: 500,
		color: theme.palette.text.secondary,
		marginBottom: 6,
		display: "flex",
		alignItems: "center",
	}));

	const LabelIcon = styled(Box)({
		marginRight: 8,
		opacity: 0.9,
		display: "flex",
		alignItems: "center",
	});

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
		>
			<Box sx={{ pt: 2 }}>
				{/* Key Selection/Display */}
				{isEditMode ? (
					<Box mb={2.5}>
						<Typography
							variant="overline"
							color="text.secondary"
							sx={{ fontSize: "0.75rem", letterSpacing: 1, fontWeight: 500 }}
						>
							Credential Key
						</Typography>
						<Typography fontWeight={500} sx={{ fontSize: "0.95rem" }}>
							{initialKey}
						</Typography>
					</Box>
				) : (
					<>
						<FormControl fullWidth sx={{ mb: 2.5 }}>
							<FieldLabel>
								<LabelIcon>
									<FontAwesomeIcon icon={faKey} size="sm" />
								</LabelIcon>
								Credential Type
							</FieldLabel>
							<Select
								value={useCustomKey ? "_custom_" : key}
								onChange={(e) => {
									const selectedValue = e.target.value as string;
									if (selectedValue === "_custom_") {
										setUseCustomKey(true);
										setKey("");
									} else {
										setUseCustomKey(false);
										setKey(selectedValue);
										setCustomKey("");
									}
								}}
								displayEmpty={!key && !useCustomKey}
								MenuProps={menuPropsSx(theme)}
								input={
									<StyledOutlinedInput notched={false} label={undefined} />
								}
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
							</Select>
						</FormControl>

						{useCustomKey && (
							<TextField
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
								autoFocus
								sx={textFieldInputSx(theme)}
							/>
						)}

						{selectedCredentialManifest && !useCustomKey && (
							<Box sx={DescriptionBoxSx(theme)}>
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
							</Box>
						)}
					</>
				)}

				{/* Credential Value Label and Input */}
				<FieldLabel>
					<LabelIcon>
						<FontAwesomeIcon icon={faKey} size="sm" />
					</LabelIcon>
					Credential Value
				</FieldLabel>
				<TextField
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
					autoFocus={isEditMode}
					placeholder="Enter the credential value or API key."
					helperText={
						isEditMode
							? `Enter the new value for ${initialKey}`
							: "Enter the credential value or API key."
					}
					sx={textFieldInputSx(theme)}
					InputLabelProps={{ shrink: false }}
				/>
			</Box>
		</BaseDialog>
	);
};
