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
	FormControl,
	FormHelperText,
	InputLabel,
	MenuItem,
	Select,
	type SelectChangeEvent,
	Typography,
	alpha,
} from "@mui/material";
import { useConfig } from "@renderer/hooks/use-config";
import { useCredentials } from "@renderer/hooks/use-credentials";
import { useModels } from "@renderer/hooks/use-models";
import { useUpdateConfig } from "@renderer/hooks/use-update-config";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	EmojiContainer,
	FormContainer,
	SectionContainer,
	SectionDescription,
	SectionTitle,
} from "../onboarding-styled";

/**
 * Default model step in the onboarding process
 */
export const DefaultModelStep: FC = () => {
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

	return (
		<SectionContainer>
			<SectionTitle>Choose Your Default Model</SectionTitle>
			<SectionDescription>
				<EmojiContainer>✨</EmojiContainer> Select your preferred AI model and
				provider that will power all your agents. Don't worry, you can always
				customize this for individual agents later!
			</SectionDescription>

			<Box
				sx={{
					p: 2,
					mb: 3,
					borderRadius: 2,
					background: (theme) =>
						`linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
					border: (theme) =>
						`1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
					display: "flex",
					alignItems: "center",
				}}
			>
				<FontAwesomeIcon
					icon={faBrain}
					style={{
						fontSize: "1.5rem",
						marginRight: "12px",
						color: "#7e57c2",
					}}
				/>
				<Typography variant="body2">
					<Box component="span" sx={{ fontWeight: 600 }}>
						Choose wisely!
					</Box>{" "}
					Different models have different capabilities, strengths, and
					specialties. Pick the one that best suits your needs.
				</Typography>
			</Box>

			<FormContainer>
				{isLoading ? (
					<Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
						<Typography sx={{ display: "flex", alignItems: "center" }}>
							<EmojiContainer
								style={{
									marginRight: "8px",
									animation: "pulse 1.5s infinite ease-in-out",
								}}
							>
								⏳
							</EmojiContainer>
							Loading available AI models...
						</Typography>
					</Box>
				) : (
					<>
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
							<InputLabel id="provider-select-label">
								<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
									<FontAwesomeIcon
										icon={faRobot}
										style={{ fontSize: "0.9rem" }}
									/>
									Model Provider
								</Box>
							</InputLabel>
							<Select
								labelId="provider-select-label"
								id="provider-select"
								value={selectedProvider}
								onChange={handleProviderChange}
								label="Model Provider"
							>
								{availableProviders.map((provider) => (
									<MenuItem key={provider.id} value={provider.id}>
										{provider.name}
									</MenuItem>
								))}
							</Select>
							<FormHelperText>
								Choose your AI provider from the ones you've added credentials
								for
							</FormHelperText>
						</FormControl>

						{selectedProvider && (
							<FormControl
								fullWidth
								variant="outlined"
								sx={{
									mt: 2,
									"& .MuiOutlinedInput-root": {
										"&.Mui-focused fieldset": {
											borderColor: "primary.main",
											borderWidth: 2,
										},
									},
									animation: "fadeIn 0.5s ease-out",
								}}
							>
								<InputLabel id="model-select-label">
									<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
										<FontAwesomeIcon
											icon={faWandMagicSparkles}
											style={{ fontSize: "0.9rem" }}
										/>
										AI Model
									</Box>
								</InputLabel>
								<Select
									labelId="model-select-label"
									id="model-select"
									value={selectedModel}
									onChange={handleModelChange}
									label="AI Model"
								>
									{availableModels.map((model) => (
										<MenuItem key={model.id} value={model.id}>
											{model.name}
										</MenuItem>
									))}
								</Select>
								<FormHelperText>
									Select the specific AI model you want to use
								</FormHelperText>
							</FormControl>
						)}

						{saveSuccess && (
							<Alert
								severity="success"
								icon={<FontAwesomeIcon icon={faCheck} />}
								sx={{
									mt: 3,
									mb: 2,
									animation: "fadeIn 0.5s ease-out",
									border: (theme) =>
										`1px solid ${alpha(theme.palette.success.main, 0.5)}`,
								}}
							>
								<Box sx={{ display: "flex", alignItems: "center" }}>
									<EmojiContainer>🎉</EmojiContainer> Default model
									configuration saved successfully! Your AI is ready to go!
								</Box>
							</Alert>
						)}

						{selectedProvider && selectedModel && (
							<Box
								sx={{
									mt: 3,
									p: 2.5,
									borderRadius: 2,
									background: (theme) =>
										alpha(theme.palette.success.light, 0.1),
									border: (theme) =>
										`1px solid ${alpha(theme.palette.success.main, 0.2)}`,
									animation: "fadeIn 0.5s ease-out",
								}}
							>
								<Box sx={{ display: "flex", alignItems: "flex-start" }}>
									<EmojiContainer
										style={{
											marginRight: "8px",
											fontSize: "1.2rem",
											flexShrink: 0,
										}}
									>
										🚀
									</EmojiContainer>
									<Typography
										variant="body2"
										sx={{
											fontWeight: 500,
											whiteSpace: "normal",
										}}
									>
										Great choice! You've selected{" "}
										<Box
											component="span"
											sx={{
												fontWeight: 700,
												color: "primary.main",
												display: "inline",
											}}
										>
											{
												availableModels.find(
													(model) => model.id === selectedModel,
												)?.name
											}
										</Box>{" "}
										from{" "}
										<Box
											component="span"
											sx={{
												fontWeight: 700,
												color: "primary.main",
												display: "inline",
											}}
										>
											{
												availableProviders.find(
													(provider) => provider.id === selectedProvider,
												)?.name
											}
										</Box>{" "}
										as your default AI model.
									</Typography>
								</Box>
							</Box>
						)}
					</>
				)}
			</FormContainer>
		</SectionContainer>
	);
};
