/**
 * Models Store
 * 
 * This module provides a store for managing model providers and models data.
 * It handles fetching, caching, and persisting the data to localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { ModelDetails, Provider } from "@renderer/api/local-operator/models-api";

/**
 * Time interval for auto-refreshing models data (15 minutes)
 */
const REFRESH_INTERVAL = 15 * 60 * 1000;

/**
 * Models store state
 */
type ModelsState = {
	/** List of available model providers */
	providers: Provider[];
	/** List of available models */
	models: ModelDetails[];
	/** Whether the data is currently being loaded */
	isLoading: boolean;
	/** Error message if loading failed */
	error: string | null;
	/** Timestamp of the last successful data fetch */
	lastFetched: number | null;
	/** Whether the data has been initialized */
	isInitialized: boolean;
	/** Fetch model providers and models from the API */
	fetchModels: (baseUrl: string, force?: boolean) => Promise<void>;
	/** Get models for a specific provider */
	getModelsForProvider: (provider: string) => ModelDetails[];
	/** Reset the store to its initial state */
	reset: () => void;
};

/**
 * Create the models store with persistence
 */
export const useModelsStore = create<ModelsState>()(
	persist(
		(set, get) => ({
			providers: [],
			models: [],
			isLoading: false,
			error: null,
			lastFetched: null,
			isInitialized: false,

			/**
			 * Fetch model providers and models from the API
			 * 
			 * @param baseUrl - Base URL of the Local Operator API
			 * @param force - Whether to force a refresh even if the data is recent
			 */
			fetchModels: async (baseUrl: string, force = false) => {
				const { lastFetched, isInitialized } = get();
				const now = Date.now();

				// Skip if data is recent and not forced
				if (
					!force &&
					isInitialized &&
					lastFetched &&
					now - lastFetched < REFRESH_INTERVAL
				) {
					return;
				}

				set({ isLoading: true, error: null });

				try {
					const client = createLocalOperatorClient(baseUrl);

					// Fetch providers
					const providersResponse = await client.models.listProviders();
					const providers = providersResponse.result?.providers || [];

					// Fetch all models
					const modelsResponse = await client.models.listModels();
					const models = modelsResponse.result?.models || [];

					set({
						providers,
						models,
						isLoading: false,
						lastFetched: now,
						isInitialized: true,
					});
				} catch (error) {
					console.error("Failed to fetch models:", error);
					set({
						isLoading: false,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			},

			/**
			 * Get models for a specific provider
			 * 
			 * @param provider - Provider ID to filter by
			 * @returns Array of models for the specified provider
			 */
			getModelsForProvider: (provider: string) => {
				return get().models.filter((model) => model.provider === provider);
			},

			/**
			 * Reset the store to its initial state
			 */
			reset: () => {
				set({
					providers: [],
					models: [],
					isLoading: false,
					error: null,
					lastFetched: null,
					isInitialized: false,
				});
			},
		}),
		{
			name: "local-operator-models",
			partialize: (state) => ({
				providers: state.providers,
				models: state.models,
				lastFetched: state.lastFetched,
				isInitialized: state.isInitialized,
			}),
		},
	),
);
