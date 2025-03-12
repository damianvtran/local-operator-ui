/**
 * Default Model Step Component
 *
 * Fifth step in the onboarding process that allows the user to select a default model.
 */

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
} from "@mui/material";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useConfig } from "@renderer/hooks/use-config";
import { useCredentials } from "@renderer/hooks/use-credentials";
import { useModels } from "@renderer/hooks/use-models";
import { useUpdateConfig } from "@renderer/hooks/use-update-config";
import type { FC } from "react";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
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
				Select a default model and provider that will be used for all agents.
				You can change this setting for individual agents later.
			</SectionDescription>

			<FormContainer>
				{isLoading ? (
					<Typography>Loading available models...</Typography>
				) : (
					<>
						<FormControl fullWidth variant="outlined">
							<InputLabel id="provider-select-label">Model Provider</InputLabel>
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
								Select a model provider from those you have credentials for
							</FormHelperText>
						</FormControl>

						{selectedProvider && (
							<FormControl fullWidth variant="outlined">
								<InputLabel id="model-select-label">Model</InputLabel>
								<Select
									labelId="model-select-label"
									id="model-select"
									value={selectedModel}
									onChange={handleModelChange}
									label="Model"
								>
									{availableModels.map((model) => (
										<MenuItem key={model.id} value={model.id}>
											{model.name}
										</MenuItem>
									))}
								</Select>
								<FormHelperText>
									Select a model from the chosen provider
								</FormHelperText>
							</FormControl>
						)}

						{saveSuccess && (
							<Alert
								severity="success"
								icon={<FontAwesomeIcon icon={faCheck} />}
								sx={{ mt: 2, mb: 2 }}
							>
								Default model configuration saved successfully
							</Alert>
						)}

						{selectedProvider && selectedModel && (
							<Box sx={{ mt: 2 }}>
								<Typography variant="body2">
									You've selected{" "}
									<strong>
										{
											availableModels.find(
												(model) => model.id === selectedModel,
											)?.name
										}
									</strong>{" "}
									from{" "}
									<strong>
										{
											availableProviders.find(
												(provider) => provider.id === selectedProvider,
											)?.name
										}
									</strong>{" "}
									as your default model.
								</Typography>
							</Box>
						)}
					</>
				)}
			</FormContainer>
		</SectionContainer>
	);
};
