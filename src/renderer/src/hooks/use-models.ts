/**
 * Models Hook
 *
 * This hook provides access to model providers and models data from the API.
 * It handles fetching, caching, and automatic refreshing of the data.
 *
 * This hook is gated by connectivity checks to ensure the server is online
 * and the user has internet connectivity if required by the hosting provider.
 */

import { apiConfig } from "@renderer/config";
import { useModelsStore } from "@renderer/store/models-store";
import { useEffect, useRef } from "react";
import { useConnectivityGate } from "./use-connectivity-gate";

/**
 * Hook for accessing model providers and models
 *
 * @param options - Hook options
 * @param options.autoFetch - Whether to automatically fetch data on mount (default: true)
 * @returns Object containing models data and utility functions
 */
export const useModels = ({ autoFetch = true } = {}) => {
	const baseUrl = apiConfig.baseUrl;
	const intervalRef = useRef<number | null>(null);

	// Use the connectivity gate to check if we should fetch models
	const { shouldEnableQuery, getConnectivityError, hasConnectivityIssue } =
		useConnectivityGate();

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
		// Clear any existing interval
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}

		if (autoFetch && shouldEnableQuery()) {
			// Initial fetch
			fetchModels(baseUrl);

			// Set up refresh interval
			intervalRef.current = window.setInterval(
				() => {
					// Only fetch if connectivity is available
					if (shouldEnableQuery()) {
						fetchModels(baseUrl);
					}
				},
				15 * 60 * 1000,
			); // 15 minutes

			return () => {
				if (intervalRef.current) {
					clearInterval(intervalRef.current);
					intervalRef.current = null;
				}
			};
		}

		return undefined;
	}, [autoFetch, baseUrl, fetchModels, shouldEnableQuery]);

	// When connectivity is restored, fetch models
	useEffect(() => {
		if (!hasConnectivityIssue && autoFetch && isInitialized) {
			fetchModels(baseUrl);
		}
	}, [hasConnectivityIssue, autoFetch, isInitialized, baseUrl, fetchModels]);

	/**
	 * Force a refresh of the models data
	 */
	const refreshModels = async () => {
		// Only refresh if connectivity is available
		if (shouldEnableQuery()) {
			await fetchModels(baseUrl, true);
		} else {
			// If connectivity is not available, throw an error
			const error = getConnectivityError();
			if (error) {
				throw error;
			}
		}
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
