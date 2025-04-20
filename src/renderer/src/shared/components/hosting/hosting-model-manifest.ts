/**
 * Hosting and Model Manifest
 *
 * This file defines the available hosting providers and the models they support.
 * It also maps which credentials are required for each hosting provider.
 *
 * The data is now dynamically fetched from the models API instead of being hard-coded.
 */

import type {
	ModelDetails,
	Provider,
} from "@shared/api/local-operator/models-api";
import { useModelsStore } from "@shared/store/models-store";

/**
 * Type definition for a model
 */
export type Model = {
	/** Unique identifier for the model */
	id: string;
	/** Display name of the model */
	name: string;
	/** Optional description of the model's capabilities */
	description?: string;
	/** Optional context window size in tokens */
	contextWindow?: number;
	/** Optional maximum output tokens */
	maxOutputTokens?: number;
	/** Optional flag indicating if the model supports images */
	supportsImages?: boolean;
	/** Optional input price per million tokens */
	inputPrice?: number;
	/** Optional output price per million tokens */
	outputPrice?: number;
	/**
	 * Flag indicating if the model is recommended for general use.
	 * This is determined by community usage and feedback.
	 */
	recommended: boolean;
};

/**
 * Type definition for a hosting provider
 */
export type HostingProvider = {
	/** Unique identifier for the hosting provider */
	id: string;
	/** Display name of the hosting provider */
	name: string;
	/** Description of the hosting provider */
	description: string;
	/** URL to the hosting provider's website */
	url: string;
	/** List of credential keys required for this hosting provider */
	requiredCredentials: string[];
	/** List of models supported by this hosting provider */
	supportedModels: Model[];
};

/**
 * Convert API model details to the format used in the hosting-model-manifest
 *
 * @param model - Model details from the API
 * @returns Converted model in the hosting-model-manifest format
 */
const convertToManifestModel = (model: ModelDetails): Model => {
	return {
		id: model.id,
		name: model.name || model.info.name || model.id,
		description: model.info.description,
		contextWindow: model.info.context_window || undefined,
		maxOutputTokens: model.info.max_tokens || undefined,
		supportsImages: model.info.supports_images || undefined,
		inputPrice: model.info.input_price,
		outputPrice: model.info.output_price,
		recommended: model.info.recommended || false,
	};
};

/**
 * Convert API provider to the format used in the hosting-model-manifest
 *
 * @param provider - Provider from the API
 * @param models - Models for this provider
 * @returns Converted provider in the hosting-model-manifest format
 */
const convertToManifestProvider = (
	provider: Provider,
	models: ModelDetails[],
): HostingProvider => {
	return {
		id: provider.id,
		name: provider.name,
		description: provider.description,
		url: provider.url,
		requiredCredentials: provider.requiredCredentials,
		supportedModels: models.map(convertToManifestModel),
	};
};

// Cache for hosting providers to prevent excessive re-renders
let cachedProviders: HostingProvider[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get hosting providers from the models store
 *
 * @returns Array of hosting providers
 */
export const getHostingProviders = (): HostingProvider[] => {
	const now = Date.now();

	// Return cached providers if they exist and are not expired
	if (cachedProviders && now - lastCacheTime < CACHE_TTL) {
		return cachedProviders;
	}

	const store = useModelsStore.getState();
	const { providers, models, isInitialized } = store;

	// If the store is not initialized yet, return an empty array
	if (!isInitialized || providers.length === 0) {
		return [];
	}

	// Convert API providers to manifest format
	const result = providers.map((provider) => {
		const providerModels = models.filter(
			(model) => model.provider === provider.id,
		);
		return convertToManifestProvider(provider, providerModels);
	});

	// Update cache
	cachedProviders = result;
	lastCacheTime = now;

	return result;
};

/**
 * For backward compatibility, export HOSTING_PROVIDERS as a getter function
 * that returns the current providers from the store
 */
export const HOSTING_PROVIDERS = (): HostingProvider[] => getHostingProviders();

/**
 * Helper function to get a hosting provider by ID
 */
export const getHostingProviderById = (
	id: string,
): HostingProvider | undefined => {
	const providers = getHostingProviders();
	return providers.find((provider) => provider.id === id);
};

/**
 * Helper function to get models for a specific hosting provider
 */
export const getModelsForHostingProvider = (hostingId: string): Model[] => {
	const provider = getHostingProviderById(hostingId);
	return provider?.supportedModels || [];
};

/**
 * Helper function to get available hosting providers based on user credentials
 */
export const getAvailableHostingProviders = (
	userCredentials: string[],
): HostingProvider[] => {
	const providers = getHostingProviders();
	return providers.filter((provider) =>
		provider.requiredCredentials.every((cred) =>
			userCredentials.includes(cred),
		),
	);
};

/**
 * Helper function to get a model by its ID
 */
export const getModelById = (modelId: string): Model | undefined => {
	const providers = getHostingProviders();
	for (const provider of providers) {
		const model = provider.supportedModels.find(
			(model) => model.id === modelId,
		);
		if (model) return model;
	}
	return undefined;
};
