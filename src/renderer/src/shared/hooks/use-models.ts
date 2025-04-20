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
import { useModelsStore } from "@shared/store/models-store";
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
	// Bypass internet check for model queries as they only need local server connectivity
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

	// Track if this is the first render
	const isFirstRenderRef = useRef(true);
	// Track if we've already fetched models
	const hasInitialFetchRef = useRef(false);
	// Track the timeout for initial fetch
	const initialFetchTimeoutRef = useRef<number | null>(null);

	// Fetch models on mount and set up refresh interval
	useEffect(() => {
		// Clear any existing interval
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}

		// Clear any existing timeout
		if (initialFetchTimeoutRef.current) {
			clearTimeout(initialFetchTimeoutRef.current);
			initialFetchTimeoutRef.current = null;
		}

		if (autoFetch && shouldEnableQuery({ bypassInternetCheck: true })) {
			// For the first render, use a timeout to delay the initial fetch
			// This helps prevent multiple fetches during app initialization
			if (isFirstRenderRef.current) {
				isFirstRenderRef.current = false;

				initialFetchTimeoutRef.current = window.setTimeout(() => {
					if (
						!hasInitialFetchRef.current &&
						shouldEnableQuery({ bypassInternetCheck: true })
					) {
						fetchModels(baseUrl);
						hasInitialFetchRef.current = true;
					}
					initialFetchTimeoutRef.current = null;
				}, 1000); // 1 second delay for initial fetch
			}
			// For subsequent renders, only fetch if we haven't already
			else if (!hasInitialFetchRef.current) {
				fetchModels(baseUrl);
				hasInitialFetchRef.current = true;
			}

			// Set up refresh interval (only one interval regardless of renders)
			intervalRef.current = window.setInterval(
				() => {
					// Only fetch if server is online (bypass internet check)
					if (shouldEnableQuery({ bypassInternetCheck: true })) {
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
				if (initialFetchTimeoutRef.current) {
					clearTimeout(initialFetchTimeoutRef.current);
					initialFetchTimeoutRef.current = null;
				}
			};
		}

		return () => {
			if (initialFetchTimeoutRef.current) {
				clearTimeout(initialFetchTimeoutRef.current);
				initialFetchTimeoutRef.current = null;
			}
		};
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
		// Only refresh if server is online (bypass internet check)
		if (shouldEnableQuery({ bypassInternetCheck: true })) {
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
