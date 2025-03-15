/**
 * Models API Client
 *
 * This module provides functions for interacting with the Local Operator API's model endpoints.
 * It includes methods for listing model providers and retrieving available models.
 */

import type { CRUDResponse } from "./types";

/**
 * Type definition for a model provider
 */
export type Provider = {
	/** Unique identifier for the provider */
	id: string;
	/** Display name for the provider */
	name: string;
	/** Description of the provider */
	description: string;
	/** URL to the provider's platform */
	url: string;
	/** List of required credential keys */
	requiredCredentials: string[];
};

/**
 * Response for listing model providers
 */
export type ProviderListResponse = {
	/** List of available model providers */
	providers: Provider[];
};

/**
 * Model information including pricing and capabilities
 */
export type ModelInfo = {
	/** Unique identifier for the model */
	id: string;
	/** Display name of the model */
	name: string;
	/** Price per million tokens for input/prompt */
	input_price?: number;
	/** Price per million tokens for output/completion */
	output_price?: number;
	/** Maximum number of tokens the model can generate */
	max_tokens?: number | null;
	/** Maximum context window size in tokens */
	context_window?: number | null;
	/** Whether the model supports processing images */
	supports_images?: boolean | null;
	/** Whether the model supports prompt caching */
	supports_prompt_cache: boolean;
	/** Price per million tokens for cache writes (if supported) */
	cache_writes_price?: number | null;
	/** Price per million tokens for cache reads (if supported) */
	cache_reads_price?: number | null;
	/** Description of the model's capabilities */
	description?: string;
	/**
	 * Whether the model is recommended for general use.  This
	 * is determined by community usage and feedback.
	 */
	recommended: boolean;
};

/**
 * Model details including ID, provider, and capabilities
 */
export type ModelDetails = {
	/** Unique identifier for the model */
	id: string;
	/** Display name of the model (optional) */
	name?: string;
	/** Provider of the model (e.g., 'openai', 'anthropic') */
	provider: string;
	/** Detailed information about the model */
	info: ModelInfo;
};

/**
 * Response for listing models
 */
export type ModelListResponse = {
	/** List of available models */
	models: ModelDetails[];
};

export type ModelSortKey = "id" | "name" | "provider" | "recommended";
export type ModelSortDirection = "ascending" | "descending";

/**
 * List all available model providers
 *
 * @param baseUrl - Base URL of the Local Operator API
 * @returns Promise resolving to a list of model providers
 */
export const listProviders = async (
	baseUrl: string,
): Promise<CRUDResponse<ProviderListResponse>> => {
	const response = await fetch(`${baseUrl}/v1/models/providers`);

	if (!response.ok) {
		throw new Error(`Failed to list providers: ${response.statusText}`);
	}

	return response.json();
};

/**
 * List all available models, optionally filtered by provider
 *
 * @param baseUrl - Base URL of the Local Operator API
 * @param provider - Optional provider to filter models by
 * @returns Promise resolving to a list of models
 */
export const listModels = async (
	baseUrl: string,
	provider?: string,
	sort?: ModelSortKey,
	direction?: ModelSortDirection,
): Promise<CRUDResponse<ModelListResponse>> => {
	const url = new URL(`${baseUrl}/v1/models`);

	if (provider) {
		url.searchParams.append("provider", provider);
	}

	if (sort) {
		url.searchParams.append("sort", sort);
	}

	if (direction) {
		url.searchParams.append("direction", direction);
	}

	const response = await fetch(url.toString());

	if (!response.ok) {
		throw new Error(`Failed to list models: ${response.statusText}`);
	}

	return response.json();
};

/**
 * Models API functions
 */
export const ModelsApi = {
	listProviders,
	listModels,
};
