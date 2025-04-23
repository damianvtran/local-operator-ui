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
	InputAdornment,
	Link,
	MenuItem,
	Select,
	type SelectChangeEvent,
	TextField,
	Typography,
	alpha,
	useTheme,
} from "@mui/material";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useModels } from "@shared/hooks/use-models";
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import {
	EmojiContainer,
	FieldLabel,
	FormContainer,
	LabelIcon,
	SectionContainer,
	SectionDescription,
	menuPropsSx,
} from "../onboarding-styled";

/**
 * Model credential step in the onboarding process
 */
export const ModelCredentialStep: FC = () => {
	const theme = useTheme(); // Get theme context
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

	const inputSx = {
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
			"& .MuiSelect-select": {
				display: "flex",
				alignItems: "center",
				gap: theme.spacing(1),
			},
			"& .MuiInputAdornment-root": {
				color: theme.palette.text.secondary,
				marginRight: theme.spacing(0.5),
			},
		},
		"& .MuiFormHelperText-root": {
			fontSize: "0.75rem",
			mt: 0.5,
			ml: 0.5,
		},
	};

	// Style for the info box
	const infoBoxSx = {
		mt: 1.5,
		p: 1.5,
		borderRadius: theme.shape.borderRadius * 0.75,
		border: `1px solid ${theme.palette.divider}`,
		backgroundColor: alpha(theme.palette.background.default, 0.5),
	};

	// Style for the success alert
	const successAlertSx = {
		mb: 2,
		borderRadius: theme.shape.borderRadius * 0.75,
		border: `1px solid ${theme.palette.success.main}`,
		backgroundColor: alpha(theme.palette.success.main, 0.1),
		color: theme.palette.success.dark,
		"& .MuiAlert-icon": {
			color: theme.palette.success.main,
		},
	};

	// Style for the final security note box
	const securityNoteSx = {
		mt: 2,
		p: 1.5,
		borderRadius: theme.shape.borderRadius * 0.75,
		backgroundColor: alpha(theme.palette.info.main, 0.08),
		border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
		display: "flex",
		alignItems: "center",
		gap: theme.spacing(1),
	};

	return (
		<SectionContainer>
			<SectionDescription>
				<EmojiContainer>✨</EmojiContainer> Add an API key for at least one
				model provider to enable AI features. Your keys are stored securely on
				your device.
			</SectionDescription>

			<FormContainer>
				{/* Provider Selection */}
				<Box>
					{" "}
					<FieldLabel>
						<LabelIcon>🤖</LabelIcon>
						Model Provider
					</FieldLabel>
					<FormControl fullWidth variant="outlined" sx={inputSx}>
						<Select
							id="credential-select"
							value={selectedCredential}
							onChange={handleCredentialChange}
							MenuProps={menuPropsSx(theme)}
						>
							{modelProviderCredentials.map((cred) => (
								<MenuItem key={cred.key} value={cred.key}>
									{cred.name}
								</MenuItem>
							))}
						</Select>
						<FormHelperText
							sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
						>
							<FontAwesomeIcon icon={faShieldAlt} size="xs" />
							Select your preferred AI model provider
						</FormHelperText>
					</FormControl>
				</Box>

				{/* Provider Info Box */}
				{selectedCredentialInfo && (
					<Box sx={infoBoxSx}>
						<Typography variant="body2" sx={{ mb: 1 }}>
							{selectedCredentialInfo.description}
						</Typography>
						<Link
							href={selectedCredentialInfo.url}
							target="_blank"
							rel="noopener noreferrer"
							variant="body2"
							sx={{
								display: "inline-flex",
								alignItems: "center",
								gap: 0.5,
								fontWeight: 500,
								color: "primary.main",
								"&:hover": {
									textDecoration: "underline",
									color: "primary.dark",
								},
							}}
						>
							<EmojiContainer sx={{ mb: 0 }}>🔗</EmojiContainer> Get{" "}
							{selectedCredentialInfo.name} API Key{" "}
							<FontAwesomeIcon icon={faExternalLinkAlt} size="xs" />
						</Link>
					</Box>
				)}

				{/* Success Alert */}
				{saveSuccess && (
					<Alert
						severity="success"
						icon={<FontAwesomeIcon icon={faCheck} />}
						sx={successAlertSx}
					>
						<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
							<EmojiContainer sx={{ mb: 0 }}>🎉</EmojiContainer> Credential
							saved successfully!
						</Box>
					</Alert>
				)}

				{/* API Key Input */}
				<Box>
					{" "}
					{/* Wrap Label and Input */}
					<FieldLabel>
						<LabelIcon>
							<FontAwesomeIcon icon={faKey} size="sm" />
						</LabelIcon>
						API Key
					</FieldLabel>
					<TextField
						// Remove label prop
						variant="outlined"
						fullWidth
						value={credentialValue}
						onChange={handleCredentialValueChange}
						error={!!error}
						helperText={error || "Enter the API key for the selected provider"}
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
							endAdornment: isSaving ? (
								<InputAdornment position="end">
									<CircularProgress size={20} />
								</InputAdornment>
							) : null,
						}}
						disabled={isSaving}
						sx={inputSx}
					/>
				</Box>

				{/* Security Note */}
				<Box sx={securityNoteSx}>
					<EmojiContainer sx={{ mb: 0 }}>🔒</EmojiContainer>
					<Typography variant="body2" color="text.secondary">
						Your API keys are stored securely on your device and never shared.
					</Typography>
				</Box>
			</FormContainer>
		</SectionContainer>
	);
};
