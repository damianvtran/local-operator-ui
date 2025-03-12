/**
 * Model Credential Step Component
 *
 * Third step in the onboarding process that allows the user to add their first model provider credential.
 */

import { faCheck, faExternalLinkAlt } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	CircularProgress,
	FormControl,
	FormHelperText,
	InputLabel,
	Link,
	MenuItem,
	Select,
	type SelectChangeEvent,
	TextField,
	Typography,
} from "@mui/material";
import { CREDENTIAL_MANIFEST } from "@renderer/components/settings/credential-manifest";
import { useCredentials } from "@renderer/hooks/use-credentials";
import { useModels } from "@renderer/hooks/use-models";
import { useUpdateCredential } from "@renderer/hooks/use-update-credential";
import type { FC } from "react";
import { useEffect, useState, useRef } from "react";
import {
	FormContainer,
	SectionContainer,
	SectionDescription,
	SectionTitle,
} from "../onboarding-styled";

/**
 * Model credential step in the onboarding process
 */
export const ModelCredentialStep: FC = () => {
	// Get the list of model provider credentials
	const modelProviderCredentials = CREDENTIAL_MANIFEST.filter(
		(cred) => cred.key !== "SERP_API_KEY" && cred.key !== "TAVILY_API_KEY",
	);

	// State for the selected credential and its value
	const [selectedCredential, setSelectedCredential] = useState(
		modelProviderCredentials[0]?.key || "",
	);
	const [credentialValue, setCredentialValue] = useState("");
	const [error, setError] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [saveSuccess, setSaveSuccess] = useState(false);

	// Get existing credentials and update mutation
	const { data: credentialsData } = useCredentials();
	const updateCredentialMutation = useUpdateCredential();
	const { refreshModels } = useModels();

	// Set the credential value if it already exists
	useEffect(() => {
		// Only show the "already set" error if we haven't just saved successfully
		if (credentialsData?.keys.includes(selectedCredential) && !saveSuccess) {
			setError("This credential is already set");
		} else {
			setError("");
		}
	}, [selectedCredential, credentialsData, saveSuccess]);

	// Handle credential selection change
	const handleCredentialChange = (event: SelectChangeEvent) => {
		setSelectedCredential(event.target.value);
		setCredentialValue("");
		setError("");
		setSaveSuccess(false);
	};

	// Handle credential value change
	const handleCredentialValueChange = (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		setCredentialValue(event.target.value);
		if (!event.target.value.trim()) {
			setError("API key is required");
		} else {
			setError("");
		}
		setSaveSuccess(false);
	};

	// Reference to store the timeout ID for clearing
	const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Save the credential when the input field loses focus (blur event)
	const handleSaveCredential = async () => {
		if (
			selectedCredential &&
			credentialValue.trim() &&
			!credentialsData?.keys.includes(selectedCredential) &&
			!isSaving
		) {
			try {
				setIsSaving(true);
				setSaveSuccess(false);
				await updateCredentialMutation.mutateAsync({
					key: selectedCredential,
					value: credentialValue.trim(),
				});
				setSaveSuccess(true);

				// Refresh models when a credential is successfully saved
				refreshModels();

				// Clear any existing timeout
				if (successTimeoutRef.current) {
					clearTimeout(successTimeoutRef.current);
				}

				// Set a timeout to hide the success message after 3 seconds
				successTimeoutRef.current = setTimeout(() => {
					setSaveSuccess(false);
				}, 3000);
			} catch (err) {
				console.error("Failed to save credential:", err);
				setSaveSuccess(false);
			} finally {
				setIsSaving(false);
			}
		}
	};

	// Clean up the timeout when the component unmounts
	useEffect(() => {
		return () => {
			if (successTimeoutRef.current) {
				clearTimeout(successTimeoutRef.current);
			}
		};
	}, []);

	// Get the selected credential info
	const selectedCredentialInfo = CREDENTIAL_MANIFEST.find(
		(cred) => cred.key === selectedCredential,
	);

	return (
		<SectionContainer>
			<SectionTitle>Add Model Provider Credential</SectionTitle>
			<SectionDescription>
				To use AI models, you need to add at least one model provider API key.
				This key will be stored locally and used to access the models.
			</SectionDescription>

			<FormContainer>
				<FormControl fullWidth variant="outlined">
					<InputLabel id="credential-select-label">Model Provider</InputLabel>
					<Select
						labelId="credential-select-label"
						id="credential-select"
						value={selectedCredential}
						onChange={handleCredentialChange}
						label="Model Provider"
					>
						{modelProviderCredentials.map((cred) => (
							<MenuItem key={cred.key} value={cred.key}>
								{cred.name}
							</MenuItem>
						))}
					</Select>
					<FormHelperText>
						Select a model provider to add your API key
					</FormHelperText>
				</FormControl>

				{selectedCredentialInfo && (
					<Box sx={{ mt: 2 }}>
						<Typography variant="body2" sx={{ mb: 1 }}>
							{selectedCredentialInfo.description}
						</Typography>
						<Link
							href={selectedCredentialInfo.url}
							target="_blank"
							rel="noopener noreferrer"
							sx={{ display: "inline-flex", alignItems: "center", mb: 2 }}
						>
							Get {selectedCredentialInfo.name}{" "}
							<FontAwesomeIcon
								icon={faExternalLinkAlt}
								style={{ marginLeft: "4px", fontSize: "0.8rem" }}
							/>
						</Link>
					</Box>
				)}

				{saveSuccess && (
					<Alert
						severity="success"
						icon={<FontAwesomeIcon icon={faCheck} />}
						sx={{ mb: 2 }}
					>
						Credential saved successfully
					</Alert>
				)}

				<TextField
					label="API Key"
					variant="outlined"
					fullWidth
					value={credentialValue}
					onChange={handleCredentialValueChange}
					error={!!error}
					helperText={error || "Enter your API key for the selected provider"}
					placeholder="Enter API key"
					required
					type="password"
					onBlur={handleSaveCredential}
					onKeyDown={(e) => {
						if (
							e.key === "Enter" &&
							selectedCredential &&
							credentialValue.trim() &&
							!error &&
							!isSaving
						) {
							handleSaveCredential();
						}
					}}
					InputProps={{
						endAdornment: isSaving ? <CircularProgress size={20} /> : null,
					}}
					disabled={isSaving}
				/>
			</FormContainer>
		</SectionContainer>
	);
};
