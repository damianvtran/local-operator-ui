/**
 * Default Model Step Component
 *
 * Fifth step in the onboarding process that allows the user to select a default model.
 */

import {
	Box,
	FormControl,
	FormHelperText,
	InputLabel,
	MenuItem,
	Select,
	type SelectChangeEvent,
	Typography,
} from "@mui/material";
import { useConfig } from "@renderer/hooks/use-config";
import { useCredentials } from "@renderer/hooks/use-credentials";
import { useModels } from "@renderer/hooks/use-models";
import { useUpdateConfig } from "@renderer/hooks/use-update-config";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";
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
	const { providers, models, isLoading: isLoadingModels } = useModels();
	const { data: credentialsData, isLoading: isLoadingCredentials } =
		useCredentials();
	const { data: configData, isLoading: isLoadingConfig } = useConfig();
	const updateConfigMutation = useUpdateConfig();

	// State for selected provider and model
	const [selectedProvider, setSelectedProvider] = useState("");
	const [selectedModel, setSelectedModel] = useState("");

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

	// Initialize selected provider and model from config or first available
	useEffect(() => {
		if (isLoadingModels || isLoadingCredentials || isLoadingConfig) return;

		// Set provider from config or first available
		if (configData?.values.hosting && !selectedProvider) {
			setSelectedProvider(configData.values.hosting);
		} else if (availableProviders.length > 0 && !selectedProvider) {
			setSelectedProvider(availableProviders[0].id);
		}

		// Set model from config or first available for the selected provider
		if (configData?.values.model_name && !selectedModel) {
			setSelectedModel(configData.values.model_name);
		} else if (availableModels.length > 0 && !selectedModel) {
			setSelectedModel(availableModels[0].id);
		}
	}, [
		configData,
		availableProviders,
		availableModels,
		selectedProvider,
		selectedModel,
		isLoadingModels,
		isLoadingCredentials,
		isLoadingConfig,
	]);

	// Handle provider selection change
	const handleProviderChange = (event: SelectChangeEvent) => {
		const newProvider = event.target.value;
		setSelectedProvider(newProvider);
		setSelectedModel(""); // Reset model when provider changes
	};

	// Handle model selection change
	const handleModelChange = (event: SelectChangeEvent) => {
		setSelectedModel(event.target.value);
	};

	// Update config when provider or model changes
	useEffect(() => {
		const updateDefaultModel = async () => {
			if (selectedProvider && selectedModel) {
				try {
					await updateConfigMutation.mutateAsync({
						hosting: selectedProvider,
						model_name: selectedModel,
					});
				} catch (err) {
					console.error("Failed to update default model:", err);
				}
			}
		};

		updateDefaultModel();
	}, [selectedProvider, selectedModel, updateConfigMutation]);

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
