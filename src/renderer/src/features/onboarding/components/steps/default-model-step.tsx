/**
 * Default Model Step Component
 *
 * Fifth step in the onboarding process: which model agents use unless an agent
 * says otherwise. The choice saves itself, and the line under the fields is the
 * receipt.
 */

import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { useConfig } from "@shared/hooks/use-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useModels } from "@shared/hooks/use-models";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PROVIDER_SELECT_ID = "onboarding-default-provider";
const PROVIDER_HELP_ID = "onboarding-default-provider-help";
const MODEL_SELECT_ID = "onboarding-default-model";
const MODEL_HELP_ID = "onboarding-default-model-help";

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
	const successTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

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

					// Replace any pending hide, so the message lives 3s from this save
					clearTimeout(successTimeoutRef.current);

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
		return () => clearTimeout(successTimeoutRef.current);
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

	const selectedModelName = availableModels.find(
		(model) => model.id === selectedModel,
	)?.name;
	const selectedProviderName = availableProviders.find(
		(provider) => provider.id === selectedProvider,
	)?.name;

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body text-ink-muted">
				Pick the model your agents use by default. Models differ in speed, cost
				and capability, and every agent can override this later.
			</p>

			{isLoading ? (
				<div className="flex items-center justify-center gap-3 py-8">
					<Spinner size="sm" />
					<p className="text-body-sm text-ink-muted">Loading your models</p>
				</div>
			) : (
				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-2">
						<Label htmlFor={PROVIDER_SELECT_ID}>Model provider</Label>
						<Select
							value={selectedProvider}
							onValueChange={(value) => {
								setSelectedProvider(value);
								setSelectedModel(""); // Reset model when provider changes
								setSaveSuccess(false);
							}}
						>
							<SelectTrigger
								id={PROVIDER_SELECT_ID}
								selectSize="lg"
								aria-describedby={PROVIDER_HELP_ID}
							>
								<SelectValue placeholder="Select a provider" />
							</SelectTrigger>
							<SelectContent>
								{availableProviders.map((provider) => (
									<SelectItem key={provider.id} value={provider.id}>
										{provider.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p id={PROVIDER_HELP_ID} className="text-ink-dim text-meta">
							Providers you have added credentials for
						</p>
					</div>

					{selectedProvider && (
						<div className="flex flex-col gap-2">
							<Label htmlFor={MODEL_SELECT_ID}>Model</Label>
							<Select
								value={selectedModel}
								onValueChange={(value) => {
									setSelectedModel(value);
									setSaveSuccess(false);

									// Only save when the user explicitly picks a model
									if (selectedProvider && value) {
										saveModelConfig(selectedProvider, value);
									}
								}}
								disabled={availableModels.length === 0}
							>
								<SelectTrigger
									id={MODEL_SELECT_ID}
									selectSize="lg"
									aria-describedby={MODEL_HELP_ID}
								>
									<SelectValue
										placeholder={
											availableModels.length === 0
												? "No models available for this provider"
												: "Select a model"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									{availableModels.map((model) => (
										<SelectItem key={model.id} value={model.id}>
											{model.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p id={MODEL_HELP_ID} className="text-ink-dim text-meta">
								{selectedModelName && selectedProviderName && !isSaving
									? `Agents will use ${selectedModelName} from ${selectedProviderName}`
									: "The model your agents start with"}
							</p>
						</div>
					)}

					{saveSuccess && <Alert variant="success">Default model saved</Alert>}
				</div>
			)}
		</div>
	);
};
