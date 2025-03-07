/**
 * Models Integration Utility
 * 
 * This module provides utilities for integrating models from the Local Operator API
 * with the existing hosting-model-manifest system.
 */

import { useModels } from "@renderer/hooks/use-models";
import { 
	HOSTING_PROVIDERS, 
	type HostingProvider, 
	type Model 
} from "./hosting-model-manifest";

/**
 * Hook that provides enhanced hosting providers with models from the API
 * 
 * This hook merges models from the Local Operator API with the static models
 * defined in the hosting-model-manifest.
 * 
 * @returns Enhanced hosting providers and utility functions
 */
export const useEnhancedHostingProviders = () => {
	const { 
		providers: apiProviders, 
		isLoading, 
		error,
		getModelsForProvider,
		convertToManifestModel
	} = useModels();

	/**
	 * Get enhanced hosting providers with models from both the static manifest
	 * and the API
	 * 
	 * @returns Array of enhanced hosting providers
	 */
	const getEnhancedHostingProviders = (): HostingProvider[] => {
		// Start with the static hosting providers
		const enhancedProviders = [...HOSTING_PROVIDERS];

		// If API data is not loaded yet, return the static providers
		if (isLoading || error || !apiProviders.length) {
			return enhancedProviders;
		}

		// Add any new providers from the API that don't exist in the static list
		for (const apiProvider of apiProviders) {
			const existingProviderIndex = enhancedProviders.findIndex(
				(provider) => provider.id === apiProvider.id
			);

			if (existingProviderIndex === -1) {
				// This is a new provider from the API, add it
				enhancedProviders.push({
					id: apiProvider.id,
					name: apiProvider.name,
					description: apiProvider.description,
					url: apiProvider.url,
					requiredCredentials: apiProvider.requiredCredentials,
					supportedModels: [],
				});
			}
		}

		// Enhance each provider with models from the API
		return enhancedProviders.map((provider) => {
			// Get API models for this provider
			const providerApiModels = getModelsForProvider(provider.id);
			
			if (!providerApiModels.length) {
				// No API models for this provider, return as is
				return provider;
			}

			// Convert API models to manifest format
			const apiManifestModels = providerApiModels.map(convertToManifestModel);

			// Create a map of existing model IDs for quick lookup
			const existingModelIds = new Set(
				provider.supportedModels.map((model) => model.id)
			);

			// Filter out API models that already exist in the static list
			const newApiModels = apiManifestModels.filter(
				(model) => !existingModelIds.has(model.id)
			);

			// Return enhanced provider with merged models
			return {
				...provider,
				supportedModels: [...provider.supportedModels, ...newApiModels],
			};
		});
	};

	/**
	 * Get all available models from both the static manifest and the API
	 * 
	 * @returns Array of all models
	 */
	const getAllModels = (): Model[] => {
		const enhancedProviders = getEnhancedHostingProviders();
		return enhancedProviders.flatMap((provider) => provider.supportedModels);
	};

	/**
	 * Get a model by its ID from either the static manifest or the API
	 * 
	 * @param modelId - ID of the model to retrieve
	 * @returns The model or undefined if not found
	 */
	const getModelById = (modelId: string): Model | undefined => {
		const allModels = getAllModels();
		return allModels.find((model) => model.id === modelId);
	};

	return {
		enhancedProviders: getEnhancedHostingProviders(),
		isLoading,
		error,
		getAllModels,
		getModelById,
	};
};
