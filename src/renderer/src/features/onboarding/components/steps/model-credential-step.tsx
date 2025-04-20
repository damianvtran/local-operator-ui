/**
 * Model Credential Step Component
 *
 * Third step in the onboarding process that allows the user to add their first model provider credential
 * with an exciting and engaging interface.
 */

import { CREDENTIAL_MANIFEST } from "@features/settings/components/credential-manifest";
import {
	faCheck,
	faExternalLinkAlt,
	faKey,
	faShieldAlt,
} from "@fortawesome/free-solid-svg-icons";
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
	alpha,
} from "@mui/material";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useModels } from "@shared/hooks/use-models";
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import {
	EmojiContainer,
	FormContainer,
	SectionContainer,
	SectionDescription,
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
			<SectionDescription>
				<EmojiContainer>✨</EmojiContainer> To unlock the power of AI models,
				you need to add at least one model provider API key. Your key will be
				securely stored on your device and used to access amazing AI
				capabilities!
			</SectionDescription>

			<FormContainer>
				<FormControl
					fullWidth
					variant="outlined"
					sx={{
						"& .MuiOutlinedInput-root": {
							"&.Mui-focused fieldset": {
								borderColor: "primary.main",
								borderWidth: 2,
							},
						},
					}}
				>
					<InputLabel id="credential-select-label">
						<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
							<EmojiContainer>🤖</EmojiContainer> Model Provider
						</Box>
					</InputLabel>
					<Select
						labelId="credential-select-label"
						id="credential-select"
						value={selectedCredential}
						onChange={handleCredentialChange}
						label="🤖 Model Provider"
					>
						{modelProviderCredentials.map((cred) => (
							<MenuItem key={cred.key} value={cred.key}>
								{cred.name}
							</MenuItem>
						))}
					</Select>
					<FormHelperText>
						<Box
							component="span"
							sx={{ display: "flex", alignItems: "center" }}
						>
							<FontAwesomeIcon
								icon={faShieldAlt}
								style={{
									marginRight: "6px",
									fontSize: "0.8rem",
									color: "#666",
								}}
							/>
							Select your preferred AI model provider
						</Box>
					</FormHelperText>
				</FormControl>

				{selectedCredentialInfo && (
					<Box
						sx={{
							mt: 2,
							p: 2,
							borderRadius: 2,
							border: (theme) =>
								`1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
							background: (theme) => alpha(theme.palette.background.paper, 0.5),
						}}
					>
						<Typography
							variant="body2"
							sx={{ mb: 1, display: "flex", alignItems: "center" }}
						>
							{selectedCredentialInfo.description}
						</Typography>
						<Link
							href={selectedCredentialInfo.url}
							target="_blank"
							rel="noopener noreferrer"
							sx={{
								display: "inline-flex",
								alignItems: "center",
								mb: 1,
								color: "primary.main",
								fontWeight: 500,
								"&:hover": {
									textDecoration: "none",
									color: "primary.dark",
								},
							}}
						>
							<EmojiContainer>🔗</EmojiContainer> Get{" "}
							{selectedCredentialInfo.name}{" "}
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
						sx={{
							mb: 2,
							animation: "fadeIn 0.5s ease-out",
							border: (theme) =>
								`1px solid ${alpha(theme.palette.success.main, 0.5)}`,
						}}
					>
						<Box sx={{ display: "flex", alignItems: "center" }}>
							<EmojiContainer>🎉</EmojiContainer> Credential saved successfully!
							You're one step closer to AI magic!
						</Box>
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
						error || "Enter your API key to connect with powerful AI models"
					}
					placeholder="Enter your API key here"
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
						startAdornment: (
							<FontAwesomeIcon
								icon={faKey}
								style={{ marginRight: "10px", color: "#666" }}
							/>
						),
						endAdornment: isSaving ? <CircularProgress size={20} /> : null,
					}}
					disabled={isSaving}
					sx={{
						"& .MuiOutlinedInput-root": {
							"&.Mui-focused fieldset": {
								borderColor: "primary.main",
								borderWidth: 2,
							},
						},
					}}
				/>

				<Box
					sx={{
						mt: 2,
						display: "flex",
						alignItems: "center",
						p: 1.5,
						borderRadius: 1,
						background: (theme) => alpha(theme.palette.info.main, 0.05),
					}}
				>
					<EmojiContainer>🔒</EmojiContainer>
					<Typography
						variant="body2"
						sx={{ color: "text.secondary", fontStyle: "italic" }}
					>
						Your API keys are stored securely on your device and are never
						shared with anyone.
					</Typography>
				</Box>
			</FormContainer>
		</SectionContainer>
	);
};
