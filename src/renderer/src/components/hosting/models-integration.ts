/**
 * Models Integration Utility
 * 
 * This module provides utilities for accessing models from the Local Operator API
 * through the hosting-model-manifest system.
 * 
 * Note: Since the hosting-model-manifest now directly uses data from the API,
 * this module now serves as a wrapper to provide a consistent interface.
 */

import { useModels } from "@renderer/hooks/use-models";
import { 
	getHostingProviders,
	type Model,
	getModelById as getModelByIdFromManifest
} from "./hosting-model-manifest";

/**
 * Hook that provides hosting providers with models from the API
 * 
 * @returns Hosting providers and utility functions
 */
export const useEnhancedHostingProviders = () => {
	const { 
		isLoading, 
		error,
		isInitialized
	} = useModels();

	/**
	 * Get all available models
	 * 
	 * @returns Array of all models
	 */
	const getAllModels = (): Model[] => {
		const providers = getHostingProviders();
		return providers.flatMap((provider) => provider.supportedModels);
	};

	/**
	 * Get a model by its ID
	 * 
	 * @param modelId - ID of the model to retrieve
	 * @returns The model or undefined if not found
	 */
	const getModelById = (modelId: string): Model | undefined => {
		return getModelByIdFromManifest(modelId);
	};

	return {
		enhancedProviders: getHostingProviders(),
		isLoading,
		error,
		isInitialized,
		getAllModels,
		getModelById,
	};
};
