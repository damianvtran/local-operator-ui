/**
 * Models Hook
 * 
 * This hook provides access to model providers and models data from the API.
 * It handles fetching, caching, and automatic refreshing of the data.
 */

import { useEffect } from "react";
import { useModelsStore } from "@renderer/store/models-store";
import { apiConfig } from "@renderer/config";

/**
 * Hook for accessing model providers and models
 * 
 * @param options - Hook options
 * @param options.autoFetch - Whether to automatically fetch data on mount (default: true)
 * @returns Object containing models data and utility functions
 */
export const useModels = ({ autoFetch = true } = {}) => {
	const baseUrl = apiConfig.baseUrl;

	const {
		providers,
		models,
		isLoading,
		error,
		lastFetched,
		isInitialized,
		fetchModels,
		getModelsForProvider,
	} = useModelsStore();

	// Fetch models on mount and set up refresh interval
	useEffect(() => {
		if (autoFetch) {
			// Initial fetch
			fetchModels(baseUrl);

			// Set up refresh interval
			const intervalId = setInterval(() => {
				fetchModels(baseUrl);
			}, 15 * 60 * 1000); // 15 minutes

			return () => clearInterval(intervalId);
		}
    
		return undefined;
	}, [autoFetch, baseUrl, fetchModels]);

	/**
	 * Force a refresh of the models data
	 */
	const refreshModels = async () => {
		await fetchModels(baseUrl, true);
	};

	/**
	 * Get a model by its ID
	 * 
	 * @param modelId - ID of the model to retrieve
	 * @returns The model details or undefined if not found
	 */
	const getModelById = (modelId: string) => {
		return models.find((model) => model.id === modelId);
	};

	/**
	 * Convert API model details to the format used in the hosting-model-manifest
	 * 
	 * @param model - Model details from the API
	 * @returns Converted model in the hosting-model-manifest format
	 */
	const convertToManifestModel = (model: typeof models[0]) => {
		return {
			id: model.id,
			name: model.name || model.id,
			description: model.info.description,
			contextWindow: model.info.context_window || undefined,
			maxOutputTokens: model.info.max_tokens || undefined,
			supportsImages: model.info.supports_images || undefined,
			inputPrice: model.info.input_price,
			outputPrice: model.info.output_price,
		};
	};

	return {
		providers,
		models,
		isLoading,
		error,
		lastFetched,
		isInitialized,
		getModelsForProvider,
		getModelById,
		refreshModels,
		convertToManifestModel,
	};
};
