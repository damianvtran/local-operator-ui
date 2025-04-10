import { CREDENTIAL_MANIFEST } from "@features/settings/credential-manifest";
import {
	Box,
	CircularProgress,
	FormControl,
	InputLabel,
	MenuItem,
	Select,
	TextField,
	Typography,
} from "@mui/material";
import type { CredentialUpdate } from "@renderer/api/local-operator/types";
import {
	BaseDialog,
	FormContainer,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { useEffect, useState } from "react";
import type { FC } from "react";

/**
 * Dialog for adding or editing a credential
 */
type CredentialDialogProps = {
	open: boolean;
	onClose: () => void;
	onSave: (update: CredentialUpdate) => void;
	initialKey?: string;
	existingKeys: string[];
	isSaving: boolean;
};

/**
 * Dialog component for adding or editing credentials
 * Handles both predefined credentials from the manifest and custom credentials
 */
export const CredentialDialog: FC<CredentialDialogProps> = ({
	open,
	onClose,
	onSave,
	initialKey = "",
	existingKeys,
	isSaving,
}) => {
	const [key, setKey] = useState(initialKey);
	const [value, setValue] = useState("");
	const [customKey, setCustomKey] = useState("");
	const [useCustomKey, setUseCustomKey] = useState(false);

	// Reset state when dialog opens
	useEffect(() => {
		if (open) {
			setKey(initialKey);
			// Always initialize with empty value for better UX
			setValue("");

			// Check if the credential is in the manifest
			const isInManifest = CREDENTIAL_MANIFEST.some(
				(cred) => cred.key === initialKey,
			);

			// If updating a credential that's not in the manifest, set customKey to initialKey
			if (!isInManifest && initialKey) {
				setCustomKey(initialKey);
			} else {
				setCustomKey("");
			}

			setUseCustomKey(!isInManifest && initialKey !== "");
		}
	}, [open, initialKey]);

	const handleSave = () => {
		const finalKey = useCustomKey ? customKey : key;
		if (!finalKey) {
			console.error("No key provided for credential");
			return;
		}

		onSave({
			key: finalKey,
			value,
		});
	};

	const isExistingKey = (k: string) =>
		existingKeys.includes(k) && k !== initialKey;
	// For updates (initialKey exists), we only need to validate the value
	// For new credentials, we need to validate both key and value
	const isValidKey = initialKey
		? true
		: useCustomKey
			? customKey.trim() !== "" && !isExistingKey(customKey)
			: key !== "" && !isExistingKey(key);

	const selectedCredential = CREDENTIAL_MANIFEST.find(
		(cred) => cred.key === key,
	);

	const dialogTitle = initialKey ? "Update Credential" : "Add New Credential";

	const dialogActions = (
		<>
			<SecondaryButton onClick={onClose} variant="outlined">
				Cancel
			</SecondaryButton>
			<PrimaryButton
				onClick={() => {
					if (isValidKey && value.trim() && !isSaving) {
						handleSave();
					}
				}}
				disabled={!isValidKey || !value.trim() || isSaving}
			>
				{isSaving ? <CircularProgress size={24} /> : "Save"}
			</PrimaryButton>
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
			<FormContainer>
				{!initialKey && (
					<>
						<FormControl fullWidth>
							<InputLabel id="credential-key-label">Credential Type</InputLabel>
							<Select
								labelId="credential-key-label"
								value={useCustomKey ? "_custom_" : key}
								label="Credential Type"
								onChange={(e) => {
									const value = e.target.value;
									if (value === "_custom_") {
										setUseCustomKey(true);
									} else {
										setUseCustomKey(false);
										setKey(value);
									}
								}}
							>
								{CREDENTIAL_MANIFEST.map((cred) => (
									<MenuItem
										key={cred.key}
										value={cred.key}
										disabled={isExistingKey(cred.key)}
									>
										{cred.name} {isExistingKey(cred.key) && "(already exists)"}
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
							/>
						)}

						{selectedCredential && (
							<Box mt={1} mb={1}>
								<Typography variant="body2" color="text.secondary">
									{selectedCredential.description}
								</Typography>
								{selectedCredential.url && (
									<Typography variant="body2" mt={1}>
										<a
											href={selectedCredential.url}
											target="_blank"
											rel="noopener noreferrer"
										>
											Get your {selectedCredential.name}
										</a>
									</Typography>
								)}
							</Box>
						)}
					</>
				)}

				<TextField
					label="Credential Value"
					fullWidth
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && isValidKey && value.trim() && !isSaving) {
							handleSave();
						}
					}}
					required
				/>
			</FormContainer>
		</BaseDialog>
	);
};
