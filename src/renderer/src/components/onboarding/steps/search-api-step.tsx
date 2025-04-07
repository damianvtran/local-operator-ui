/**
 * Search API Step Component
 *
 * Fourth step in the onboarding process that allows the user to optionally add a search API key
 * with an exciting and engaging interface.
 */

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
	InputLabel,
	Link,
	MenuItem,
	Select,
	type SelectChangeEvent,
	TextField,
	Typography,
	alpha,
} from "@mui/material";
import { CREDENTIAL_MANIFEST } from "@renderer/components/settings/credential-manifest";
import { useCredentials } from "@renderer/hooks/use-credentials";
import { useUpdateCredential } from "@renderer/hooks/use-update-credential";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import {
	EmojiContainer,
	FormContainer,
	SectionContainer,
	SectionDescription,
} from "../onboarding-styled";

const RECOMMENDED_CREDENTIAL = "TAVILY_API_KEY";

/**
 * Search API step in the onboarding process
 */
export const SearchApiStep: FC = () => {
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
			<SectionDescription>
				<EmojiContainer>🌐</EmojiContainer> Supercharge your AI agents with the
				ability to search the web for real-time information! This optional
				feature gives your AI assistants access to the latest data from across
				the internet.
			</SectionDescription>

			<FormContainer>
				<Box
					sx={{
						p: 2,
						mb: 3,
						borderRadius: 2,
						background: (theme) =>
							`linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.info.main, 0.1)} 100%)`,
						border: (theme) =>
							`1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
						display: "flex",
						alignItems: "center",
					}}
				>
					<FontAwesomeIcon
						icon={faGlobe}
						style={{
							fontSize: "1.5rem",
							marginRight: "12px",
							color: "#3f51b5",
						}}
					/>
					<Typography variant="body2">
						<Box component="span" sx={{ fontWeight: 600 }}>
							Web-enabled AI is more powerful!
						</Box>{" "}
						Your agents can find current information, research topics, and
						provide up-to-date answers.
					</Typography>
				</Box>

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
					<InputLabel id="search-api-select-label">
						<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
							<EmojiContainer>🔎</EmojiContainer> Search API Provider
						</Box>
					</InputLabel>
					<Select
						labelId="search-api-select-label"
						id="search-api-select"
						value={selectedCredential}
						onChange={handleCredentialChange}
						label="🔎 Search API Provider"
					>
						{searchApiCredentials.map((cred) => (
							<MenuItem key={cred.key} value={cred.key}>
								{cred.key === RECOMMENDED_CREDENTIAL
									? `${cred.name} (Recommended)`
									: cred.name}
							</MenuItem>
						))}
					</Select>
					<FormHelperText>
						<Box sx={{ display: "flex", alignItems: "center" }}>
							<FontAwesomeIcon
								icon={faSearch}
								style={{
									marginRight: "6px",
									fontSize: "0.8rem",
									color: "#666",
								}}
							/>
							Choose your preferred search provider
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
							<EmojiContainer>💡</EmojiContainer>{" "}
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
							<EmojiContainer>🎉</EmojiContainer> Search API credential saved
							successfully! Your AI can now explore the web!
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
						error || "Enter your API key for the selected provider (optional)"
					}
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
						mt: 3,
						p: 2,
						borderRadius: 2,
						background: (theme) => alpha(theme.palette.info.light, 0.1),
						border: (theme) =>
							`1px dashed ${alpha(theme.palette.info.main, 0.3)}`,
						display: "flex",
						alignItems: "center",
					}}
				>
					<EmojiContainer style={{ fontSize: "1.2rem", marginRight: "8px" }}>
						💫
					</EmojiContainer>
					<Typography
						variant="body2"
						sx={{ fontStyle: "italic", color: "text.secondary" }}
					>
						This step is completely optional! You can skip it now and add search
						capabilities later in Settings if you prefer.
					</Typography>
				</Box>
			</FormContainer>
		</SectionContainer>
	);
};
