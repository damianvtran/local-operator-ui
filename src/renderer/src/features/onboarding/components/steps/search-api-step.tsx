/**
 * Search API Step Component
 *
 * Fourth step in the onboarding process that allows the user to optionally add a search API key
 * with an exciting and engaging interface.
 */

import { CREDENTIAL_MANIFEST } from "@features/settings/components/credential-manifest";
import {
	faCheck,
	faExternalLinkAlt,
	faGlobe,
	faKey,
	faSearch,
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

const RECOMMENDED_CREDENTIAL = "TAVILY_API_KEY";

/**
 * Search API step in the onboarding process
 */
export const SearchApiStep: FC = () => {
	const theme = useTheme(); // Get theme context
	// Get the list of search API credentials and sort Tavily first
	const searchApiCredentials = CREDENTIAL_MANIFEST.filter(
		(cred) => cred.key === "TAVILY_API_KEY" || cred.key === "SERP_API_KEY",
	).sort((a, b) => {
		if (a.key === RECOMMENDED_CREDENTIAL) return -1;
		if (b.key === RECOMMENDED_CREDENTIAL) return 1;
		return 0;
	});

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

	// Define shadcn-like input styles using sx prop
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

	// Style for info boxes
	const infoBoxSx = {
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

	// Style for the final optional note box
	const optionalNoteSx = {
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
				<EmojiContainer>🌐</EmojiContainer> Supercharge your AI agents with web
				search for real-time information. This optional step gives your AI
				access to the latest data online.
			</SectionDescription>

			<FormContainer>
				{/* Web-enabled AI Info Box */}
				<Box
					sx={{
						...infoBoxSx,
						mb: 2,
						display: "flex",
						alignItems: "center",
						gap: 1.5,
					}}
				>
					<FontAwesomeIcon
						icon={faGlobe}
						size="lg" // Use FontAwesome size prop
						color={theme.palette.primary.main} // Use theme color
					/>
					<Typography variant="body2">
						<Typography component="span" fontWeight="medium">
							Web-enabled AI is more powerful!
						</Typography>{" "}
						Agents can find current info, research topics, and provide
						up-to-date answers.
					</Typography>
				</Box>

				{/* Provider Selection */}
				<Box>
					{" "}
					<FieldLabel>
						<LabelIcon>🔎</LabelIcon>
						Search API Provider
					</FieldLabel>
					<FormControl fullWidth variant="outlined" sx={inputSx}>
						<Select
							id="search-api-select"
							value={selectedCredential}
							onChange={handleCredentialChange}
							MenuProps={menuPropsSx(theme)}
						>
							{searchApiCredentials.map((cred) => (
								<MenuItem key={cred.key} value={cred.key}>
									{cred.key === RECOMMENDED_CREDENTIAL
										? `${cred.name} (Recommended)`
										: cred.name}
								</MenuItem>
							))}
						</Select>
						<FormHelperText
							sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
						>
							<FontAwesomeIcon icon={faSearch} size="xs" />
							Choose your preferred search provider (Tavily recommended)
						</FormHelperText>
					</FormControl>
				</Box>

				{/* Provider Info Box */}
				{selectedCredentialInfo && (
					<Box sx={{ ...infoBoxSx, mt: 1.5 }}>
						<Typography
							variant="body2"
							sx={{ mb: 1, display: "flex", alignItems: "center", gap: 0.5 }}
						>
							<EmojiContainer sx={{ mb: 0 }}>💡</EmojiContainer>{" "}
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
							{selectedCredentialInfo.name}{" "}
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
							<EmojiContainer sx={{ mb: 0 }}>🎉</EmojiContainer> Search API
							credential saved!
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
						API Key (Optional)
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

				{/* Optional Step Note */}
				<Box sx={optionalNoteSx}>
					<EmojiContainer sx={{ mb: 0 }}>💫</EmojiContainer>
					<Typography variant="body2" color="text.secondary">
						This step is optional! You can skip it and add search capabilities
						later in Settings.
					</Typography>
				</Box>
			</FormContainer>
		</SectionContainer>
	);
};
