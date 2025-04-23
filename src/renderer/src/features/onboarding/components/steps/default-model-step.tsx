/**
 * Default Model Step Component
 *
 * Fifth step in the onboarding process that allows the user to select a default model
 * with an exciting and engaging interface.
 */

import {
	faBrain,
	faCheck,
	faRobot,
	faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	CircularProgress, // Import CircularProgress for loading
	FormControl,
	FormHelperText,
	MenuItem,
	Select,
	type SelectChangeEvent,
	Typography,
	alpha,
	useTheme, // Import useTheme
} from "@mui/material";
import { useConfig } from "@shared/hooks/use-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useModels } from "@shared/hooks/use-models";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	EmojiContainer,
	FieldLabel, // Import FieldLabel
	FormContainer,
	LabelIcon, // Import LabelIcon
	SectionContainer,
	SectionDescription,
	SectionTitle,
} from "../onboarding-styled";

/**
 * Default model step in the onboarding process
 */
export const DefaultModelStep: FC = () => {
	const theme = useTheme(); // Get theme context
	// Get models, credentials, and config
	const {
		providers,
		models,
		isLoading: isLoadingModels,
		refreshModels,
	} = useModels({ autoFetch: false });
	const { data: credentialsData, isLoading: isLoadingCredentials } =
		useCredentials();
	const { isLoading: isLoadingConfig } = useConfig();
	const updateConfigMutation = useUpdateConfig();

	// State for selected provider and model
	const [selectedProvider, setSelectedProvider] = useState("");
	const [selectedModel, setSelectedModel] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [saveSuccess, setSaveSuccess] = useState(false);

	// Reference to store the timeout ID for clearing
	const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Reference to track if models have been refreshed
	const hasRefreshedModelsRef = useRef(false);

	// Get available providers based on credentials
	const availableProviders = useMemo(() => {
		if (!providers || !credentialsData) return [];

		// Filter providers that have credentials set
		return providers.filter((provider) => {
			// Check if the provider has a corresponding credential
			const providerKey = `${provider.id.toUpperCase()}_API_KEY`;
			return credentialsData.keys.includes(providerKey);
		});
	}, [providers, credentialsData]);

	// Get available models for the selected provider
	const availableModels = useMemo(() => {
		if (!models || !selectedProvider) return [];
		return models.filter((model) => model.provider === selectedProvider);
	}, [models, selectedProvider]);

	// Handle provider selection change
	const handleProviderChange = (event: SelectChangeEvent) => {
		const newProvider = event.target.value;
		setSelectedProvider(newProvider);
		setSelectedModel(""); // Reset model when provider changes
		setSaveSuccess(false);
	};

	// Handle model selection change
	const handleModelChange = (event: SelectChangeEvent) => {
		const newModel = event.target.value;
		setSelectedModel(newModel);
		setSaveSuccess(false);

		// Only save when the user explicitly selects a model (and provider is already selected)
		if (selectedProvider && newModel) {
			saveModelConfig(selectedProvider, newModel);
		}
	};

	// Save the model configuration when selections are complete
	const saveModelConfig = useCallback(
		async (provider: string, model: string) => {
			if (provider && model && !isSaving) {
				try {
					setIsSaving(true);
					setSaveSuccess(false);
					await updateConfigMutation.mutateAsync({
						hosting: provider,
						model_name: model,
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
					console.error("Failed to update default model:", err);
					setSaveSuccess(false);
				} finally {
					setIsSaving(false);
				}
			}
		},
		[isSaving, updateConfigMutation],
	);

	// Clean up the timeout when the component unmounts
	useEffect(() => {
		return () => {
			if (successTimeoutRef.current) {
				clearTimeout(successTimeoutRef.current);
			}
		};
	}, []);

	// Refresh models when credentials change - only once when credentials are loaded
	useEffect(() => {
		if (
			credentialsData &&
			!isLoadingCredentials &&
			!hasRefreshedModelsRef.current
		) {
			// Force refresh of models data when credentials are loaded
			refreshModels();
			hasRefreshedModelsRef.current = true;
		}
	}, [credentialsData, isLoadingCredentials, refreshModels]);

	// Initialize provider when credentials and providers are available
	useEffect(() => {
		// Skip if already loading or no data available
		if (
			isLoadingModels ||
			isLoadingCredentials ||
			isLoadingConfig ||
			!credentialsData ||
			!providers ||
			availableProviders.length === 0
		)
			return;

		// Skip if provider is already selected
		if (selectedProvider) return;

		// Find the provider that matches the most recently added credential
		let provider = availableProviders[0].id; // Default to first available

		// Try to find a provider that matches a credential
		for (const p of availableProviders) {
			const providerKey = `${p.id.toUpperCase()}_API_KEY`;
			if (credentialsData.keys.includes(providerKey)) {
				provider = p.id;
				break;
			}
		}

		// Set the provider
		setSelectedProvider(provider);
	}, [
		availableProviders,
		providers,
		isLoadingModels,
		isLoadingCredentials,
		isLoadingConfig,
		credentialsData,
		selectedProvider,
	]);

	// Set default model when available models change
	useEffect(() => {
		if (availableModels.length > 0 && !selectedModel) {
			setSelectedModel(availableModels[0].id);

			// If we have both provider and model, save the config
			if (selectedProvider && availableModels[0].id) {
				saveModelConfig(selectedProvider, availableModels[0].id);
			}
		}
	}, [availableModels, selectedModel, selectedProvider, saveModelConfig]);

	// Loading state
	const isLoading = isLoadingModels || isLoadingCredentials || isLoadingConfig;

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
				// Covers TextField input
				padding: theme.spacing(1, 1.5),
				fontSize: "0.875rem",
				height: "calc(40px - 16px)",
				boxSizing: "border-box",
			},
			"& .MuiSelect-select": {
				// Specific styles for Select input
				paddingTop: theme.spacing(1),
				paddingBottom: theme.spacing(1),
				paddingLeft: theme.spacing(1.5),
				display: "flex",
				alignItems: "center",
				gap: theme.spacing(1),
				height: "calc(40px - 16px) !important", // Ensure height matches
				minHeight: "calc(40px - 16px) !important",
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
		// Remove MUI label specific styles from inputSx
		// "& .MuiInputLabel-root": { ... },
		// "& .MuiInputLabel-outlined.MuiInputLabel-shrink": { ... },
	};

	// Style for info boxes
	const infoBoxSx = {
		p: 1.5,
		borderRadius: theme.shape.borderRadius * 0.75,
		border: `1px solid ${theme.palette.divider}`,
		backgroundColor: alpha(theme.palette.background.default, 0.5),
		display: "flex",
		alignItems: "center",
		gap: 1.5,
	};

	// Style for the success alert
	const successAlertSx = {
		mt: 2, // Adjusted margin
		mb: 1, // Adjusted margin
		borderRadius: theme.shape.borderRadius * 0.75,
		border: `1px solid ${theme.palette.success.main}`,
		backgroundColor: alpha(theme.palette.success.main, 0.1),
		color: theme.palette.success.dark,
		"& .MuiAlert-icon": {
			color: theme.palette.success.main,
		},
	};

	// Style for the final confirmation box
	const confirmationBoxSx = {
		mt: 2, // Adjusted margin
		p: 1.5, // Adjusted padding
		borderRadius: theme.shape.borderRadius * 0.75,
		backgroundColor: alpha(theme.palette.success.main, 0.08),
		border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
		display: "flex",
		alignItems: "flex-start", // Align items start for potentially wrapping text
		gap: theme.spacing(1),
	};

	return (
		<SectionContainer>
			{/* Use SectionTitle from onboarding-styled */}
			<SectionTitle>
				<EmojiContainer sx={{ mb: 0 }}>✨</EmojiContainer> Choose Your Default
				Model
			</SectionTitle>
			<SectionDescription>
				Select the default AI model and provider for your agents. You can
				customize this per agent later.
			</SectionDescription>

			{/* "Choose wisely" Info Box */}
			<Box sx={{ ...infoBoxSx, mb: 2 }}>
				<FontAwesomeIcon
					icon={faBrain}
					size="lg"
					color={theme.palette.primary.main}
				/>
				<Typography variant="body2">
					<Typography component="span" fontWeight="medium">
						Choose wisely!
					</Typography>{" "}
					Different models have different capabilities and costs. Pick one that
					suits your general needs.
				</Typography>
			</Box>

			<FormContainer>
				{isLoading ? (
					// Simple loading indicator
					<Box
						sx={{
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							p: 3,
							gap: 1,
						}}
					>
						<CircularProgress size={20} />
						<Typography variant="body2" color="text.secondary">
							Loading available models...
						</Typography>
					</Box>
				) : (
					<>
						{/* Provider Selection */}
						<Box>
							{" "}
							{/* Wrap Label and Input */}
							<FieldLabel>
								<LabelIcon>
									<FontAwesomeIcon icon={faRobot} size="sm" />
								</LabelIcon>
								Model Provider
							</FieldLabel>
							<FormControl fullWidth variant="outlined" sx={inputSx}>
								{/* Remove InputLabel */}
								<Select
									// Remove labelId and label props
									id="provider-select"
									value={selectedProvider}
									onChange={handleProviderChange}
									// Remove startAdornment
								>
									{availableProviders.map((provider) => (
										<MenuItem key={provider.id} value={provider.id}>
											{provider.name}
										</MenuItem>
									))}
								</Select>
								<FormHelperText>
									Providers you've added credentials for
								</FormHelperText>
							</FormControl>
						</Box>

						{/* Model Selection */}
						{selectedProvider && (
							<Box sx={{ mt: 1.5 }}>
								{" "}
								{/* Wrap Label and Input */}
								<FieldLabel>
									<LabelIcon>
										<FontAwesomeIcon icon={faWandMagicSparkles} size="sm" />
									</LabelIcon>
									AI Model
								</FieldLabel>
								<FormControl fullWidth variant="outlined" sx={inputSx}>
									{/* Remove InputLabel */}
									<Select
										// Remove labelId and label props
										id="model-select"
										value={selectedModel}
										onChange={handleModelChange}
										// Remove startAdornment
										disabled={availableModels.length === 0} // Disable if no models
									>
										{availableModels.length === 0 && (
											<MenuItem disabled value="">
												No models found for this provider
											</MenuItem>
										)}
										{availableModels.map((model) => (
											<MenuItem key={model.id} value={model.id}>
												{model.name}
											</MenuItem>
										))}
									</Select>
									<FormHelperText>Select the specific AI model</FormHelperText>
								</FormControl>
							</Box>
						)}

						{/* Save Success Alert */}
						{saveSuccess && (
							<Alert
								severity="success"
								icon={<FontAwesomeIcon icon={faCheck} />}
								sx={successAlertSx}
							>
								<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
									<EmojiContainer sx={{ mb: 0 }}>🎉</EmojiContainer> Default
									model saved!
								</Box>
							</Alert>
						)}

						{/* Confirmation Box */}
						{selectedProvider && selectedModel && !isSaving && (
							<Box sx={confirmationBoxSx}>
								<EmojiContainer sx={{ mb: 0, mt: 0.2 }}>🚀</EmojiContainer>
								<Typography variant="body2" color="text.secondary">
									Default set to{" "}
									<Typography
										component="span"
										fontWeight="medium"
										color="text.primary"
									>
										{
											availableModels.find(
												(model) => model.id === selectedModel,
											)?.name
										}
									</Typography>{" "}
									from{" "}
									<Typography
										component="span"
										fontWeight="medium"
										color="text.primary"
									>
										{
											availableProviders.find(
												(provider) => provider.id === selectedProvider,
											)?.name
										}
									</Typography>
									.
								</Typography>
							</Box>
						)}
					</>
				)}
			</FormContainer>
		</SectionContainer>
	);
};
