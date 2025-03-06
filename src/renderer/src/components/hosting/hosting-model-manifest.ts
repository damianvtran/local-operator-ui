/**
 * Hosting and Model Manifest
 *
 * This file defines the available hosting providers and the models they support.
 * It also maps which credentials are required for each hosting provider.
 */

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
 * List of hosting providers with their supported models
 */
export const HOSTING_PROVIDERS: HostingProvider[] = [
	{
		id: "openai",
		name: "OpenAI",
		description:
			"OpenAI's API provides access to GPT-4o, o3-mini, and other models",
		url: "https://platform.openai.com/",
		requiredCredentials: ["OPENAI_API_KEY"],
		supportedModels: [
			{
				id: "openai/gpt-4o",
				name: "GPT-4o",
				description:
					"OpenAI's most capable multimodal model for text and vision tasks",
				contextWindow: 128000,
				maxOutputTokens: 4096,
			},
			{
				id: "openai/gpt-4o-mini",
				name: "GPT-4o Mini",
				description:
					"Smaller, faster, and more cost-effective version of GPT-4o",
				contextWindow: 128000,
				maxOutputTokens: 4096,
			},
			{
				id: "openai/gpt-4-turbo",
				name: "GPT-4 Turbo",
				description: "Optimized version of GPT-4 with improved performance",
				contextWindow: 128000,
				maxOutputTokens: 4096,
			},
			{
				id: "openai/gpt-3.5-turbo",
				name: "GPT-3.5 Turbo",
				description: "Fast and cost-effective model for most text tasks",
				contextWindow: 16385,
				maxOutputTokens: 4096,
			},
		],
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description:
			"Access to various AI models from different providers through a single API",
		url: "https://openrouter.ai/",
		requiredCredentials: ["OPENROUTER_API_KEY"],
		supportedModels: [
			{
				id: "openrouter/anthropic/claude-3-opus",
				name: "Claude 3 Opus",
				description: "Anthropic's most powerful model for complex tasks",
				contextWindow: 200000,
				maxOutputTokens: 4096,
			},
			{
				id: "openrouter/anthropic/claude-3-sonnet",
				name: "Claude 3 Sonnet",
				description: "Balanced model for most tasks with good performance",
				contextWindow: 200000,
				maxOutputTokens: 4096,
			},
			{
				id: "openrouter/anthropic/claude-3-haiku",
				name: "Claude 3 Haiku",
				description: "Fast and efficient model for simpler tasks",
				contextWindow: 200000,
				maxOutputTokens: 4096,
			},
			{
				id: "openrouter/meta/llama-3-70b-instruct",
				name: "Llama 3 70B Instruct",
				description: "Meta's largest instruction-tuned model",
				contextWindow: 8192,
				maxOutputTokens: 4096,
			},
			{
				id: "openrouter/meta/llama-3-8b-instruct",
				name: "Llama 3 8B Instruct",
				description: "Smaller, faster version of Llama 3",
				contextWindow: 8192,
				maxOutputTokens: 4096,
			},
			{
				id: "openrouter/google/gemini-pro",
				name: "Gemini Pro",
				description: "Google's advanced model for text and code",
				contextWindow: 32768,
				maxOutputTokens: 8192,
			},
		],
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Direct access to Anthropic's Claude models",
		url: "https://console.anthropic.com/",
		requiredCredentials: ["ANTHROPIC_API_KEY"],
		supportedModels: [
			{
				id: "anthropic/claude-3-opus",
				name: "Claude 3 Opus",
				description: "Anthropic's most powerful model for complex tasks",
				contextWindow: 200000,
				maxOutputTokens: 4096,
			},
			{
				id: "anthropic/claude-3-sonnet",
				name: "Claude 3 Sonnet",
				description: "Balanced model for most tasks with good performance",
				contextWindow: 200000,
				maxOutputTokens: 4096,
			},
			{
				id: "anthropic/claude-3-haiku",
				name: "Claude 3 Haiku",
				description: "Fast and efficient model for simpler tasks",
				contextWindow: 200000,
				maxOutputTokens: 4096,
			},
		],
	},
	{
		id: "google",
		name: "Google AI",
		description: "Access to Google's Gemini models",
		url: "https://aistudio.google.com/",
		requiredCredentials: ["GOOGLE_AI_STUDIO_API_KEY"],
		supportedModels: [
			{
				id: "google/gemini-1.5-pro",
				name: "Gemini 1.5 Pro",
				description: "Google's most capable multimodal model",
				contextWindow: 1000000,
				maxOutputTokens: 8192,
			},
			{
				id: "google/gemini-1.5-flash",
				name: "Gemini 1.5 Flash",
				description: "Faster, more efficient version of Gemini 1.5",
				contextWindow: 1000000,
				maxOutputTokens: 8192,
			},
			{
				id: "google/gemini-1.0-pro",
				name: "Gemini 1.0 Pro",
				description: "Previous generation of Google's Gemini model",
				contextWindow: 32768,
				maxOutputTokens: 8192,
			},
		],
	},
	{
		id: "mistral",
		name: "Mistral AI",
		description: "Access to Mistral's efficient and powerful language models",
		url: "https://console.mistral.ai/",
		requiredCredentials: ["MISTRAL_API_KEY"],
		supportedModels: [
			{
				id: "mistral/mistral-large",
				name: "Mistral Large",
				description: "Mistral's most powerful model",
				contextWindow: 32768,
				maxOutputTokens: 4096,
			},
			{
				id: "mistral/mistral-medium",
				name: "Mistral Medium",
				description: "Balanced performance and efficiency",
				contextWindow: 32768,
				maxOutputTokens: 4096,
			},
			{
				id: "mistral/mistral-small",
				name: "Mistral Small",
				description: "Fast and efficient model for simpler tasks",
				contextWindow: 32768,
				maxOutputTokens: 4096,
			},
		],
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "Specialized in code generation and understanding",
		url: "https://platform.deepseek.com/",
		requiredCredentials: ["DEEPSEEK_API_KEY"],
		supportedModels: [
			{
				id: "deepseek/deepseek-coder",
				name: "DeepSeek Coder",
				description: "Specialized for code generation and understanding",
				contextWindow: 32768,
				maxOutputTokens: 4096,
			},
			{
				id: "deepseek/deepseek-chat",
				name: "DeepSeek Chat",
				description: "General purpose chat model",
				contextWindow: 32768,
				maxOutputTokens: 4096,
			},
		],
	},
	{
		id: "kimi",
		name: "Kimi AI",
		description: "Advanced language models with strong reasoning capabilities",
		url: "https://kimi.moonshot.cn/",
		requiredCredentials: ["KIMI_API_KEY"],
		supportedModels: [
			{
				id: "kimi/kimi-v1",
				name: "Kimi v1",
				description:
					"General purpose language model with reasoning capabilities",
				contextWindow: 32768,
				maxOutputTokens: 4096,
			},
		],
	},
	{
		id: "alibaba",
		name: "Alibaba Cloud",
		description: "Access to Alibaba Cloud AI models like Qwen",
		url: "https://www.alibabacloud.com/product/ai",
		requiredCredentials: ["ALIBABA_CLOUD_API_KEY"],
		supportedModels: [
			{
				id: "alibaba/qwen-max",
				name: "Qwen Max",
				description: "Alibaba's most powerful Qwen model",
				contextWindow: 32768,
				maxOutputTokens: 4096,
			},
			{
				id: "alibaba/qwen-plus",
				name: "Qwen Plus",
				description: "Balanced performance Qwen model",
				contextWindow: 32768,
				maxOutputTokens: 4096,
			},
		],
	},
];

/**
 * Helper function to get a hosting provider by ID
 */
export const getHostingProviderById = (
	id: string,
): HostingProvider | undefined => {
	return HOSTING_PROVIDERS.find((provider) => provider.id === id);
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
	return HOSTING_PROVIDERS.filter((provider) =>
		provider.requiredCredentials.every((cred) =>
			userCredentials.includes(cred),
		),
	);
};

/**
 * Helper function to get a model by its ID
 */
export const getModelById = (modelId: string): Model | undefined => {
	for (const provider of HOSTING_PROVIDERS) {
		const model = provider.supportedModels.find(
			(model) => model.id === modelId,
		);
		if (model) return model;
	}
	return undefined;
};
