/**
 * Models Hook
 *
 * This hook provides access to model providers and models data from the API.
 * It handles fetching, caching, and automatic refreshing of the data.
 */

import { apiConfig } from "@renderer/config";
import { useModelsStore } from "@renderer/store/models-store";
import { useEffect } from "react";

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
			const intervalId = setInterval(
				() => {
					fetchModels(baseUrl);
				},
				15 * 60 * 1000,
			); // 15 minutes

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
	};
};
