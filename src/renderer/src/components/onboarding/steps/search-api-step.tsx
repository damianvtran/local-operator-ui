/**
 * Search API Step Component
 *
 * Fourth step in the onboarding process that allows the user to optionally add a search API key.
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
 * Search API step in the onboarding process
 */
export const SearchApiStep: FC = () => {
	// Get the list of search API credentials
	const searchApiCredentials = CREDENTIAL_MANIFEST.filter(
		(cred) => cred.key === "SERP_API_KEY" || cred.key === "TAVILY_API_KEY",
	);

	// State for the selected credential and its value
	const [selectedCredential, setSelectedCredential] = useState(
		searchApiCredentials[0]?.key || "",
	);
	const [credentialValue, setCredentialValue] = useState("");
	const [error, setError] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [saveSuccess, setSaveSuccess] = useState(false);

	// Reference to store the timeout ID for clearing
	const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Get existing credentials and update mutation
	const { data: credentialsData } = useCredentials();
	const updateCredentialMutation = useUpdateCredential();

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
		if (event.target.value.trim()) {
			setError("");
		}
		setSaveSuccess(false);
	};

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
			<SectionTitle>Enable Web Search (Optional)</SectionTitle>
			<SectionDescription>
				Adding a search API key allows your agents to search the web for
				information. This step is optional, and you can always add it later.
			</SectionDescription>

			<FormContainer>
				<FormControl fullWidth variant="outlined">
					<InputLabel id="search-api-select-label">
						Search API Provider
					</InputLabel>
					<Select
						labelId="search-api-select-label"
						id="search-api-select"
						value={selectedCredential}
						onChange={handleCredentialChange}
						label="Search API Provider"
					>
						{searchApiCredentials.map((cred) => (
							<MenuItem key={cred.key} value={cred.key}>
								{cred.name}
							</MenuItem>
						))}
					</Select>
					<FormHelperText>
						Select a search API provider to add your API key
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
						Search API credential saved successfully
					</Alert>
				)}

				<TextField
					label="API Key"
					variant="outlined"
					fullWidth
					value={credentialValue}
					onChange={handleCredentialValueChange}
					error={!!error}
					helperText={
						error || "Enter your API key for the selected provider (optional)"
					}
					placeholder="Enter API key"
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

				<Typography variant="body2" sx={{ mt: 2, fontStyle: "italic" }}>
					You can skip this step if you don't want to enable web search
					capabilities.
				</Typography>
			</FormContainer>
		</SectionContainer>
	);
};
