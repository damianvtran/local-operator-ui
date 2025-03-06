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
	/** Optional flag indicating if the model supports images */
	supportsImages?: boolean;
	/** Optional input price per million tokens */
	inputPrice?: number;
	/** Optional output price per million tokens */
	outputPrice?: number;
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
				id: "gpt-4o",
				name: "GPT-4o",
				description:
					"OpenAI's most capable multimodal model for text and vision tasks",
				contextWindow: 128000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "gpt-4o-mini",
				name: "GPT-4o Mini",
				description:
					"Smaller, faster, and more cost-effective version of GPT-4o",
				contextWindow: 128000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "gpt-4-turbo",
				name: "GPT-4 Turbo",
				description: "Optimized version of GPT-4 with improved performance",
				contextWindow: 128000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "gpt-3.5-turbo",
				name: "GPT-3.5 Turbo",
				description: "Fast and cost-effective model for most text tasks",
				contextWindow: 16385,
				maxOutputTokens: 4096,
				supportsImages: true,
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
				id: "anthropic/claude-3-opus",
				name: "Claude 3 Opus",
				description: "Anthropic's most powerful model for complex reasoning and creative tasks.",
				contextWindow: 200000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "anthropic/claude-3-sonnet",
				name: "Claude 3 Sonnet",
				description: "Balanced model offering strong performance with good efficiency.",
				contextWindow: 200000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "anthropic/claude-3-haiku",
				name: "Claude 3 Haiku",
				description: "Fast and efficient model optimized for simpler tasks.",
				contextWindow: 200000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "anthropic/claude-3-5-sonnet",
				name: "Claude 3.5 Sonnet",
				description: "Anthropic's improved model with enhanced reasoning and instruction following.",
				contextWindow: 200000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "anthropic/claude-3.7-sonnet",
				name: "Claude 3.7 Sonnet",
				description: "Anthropic's latest model with advanced multimodal capabilities.",
				contextWindow: 128000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "meta/llama-3-70b-instruct",
				name: "Llama 3 70B Instruct",
				description: "Meta's largest open-weight model optimized for instruction following.",
				contextWindow: 8192,
				maxOutputTokens: 4096,
			},
			{
				id: "meta/llama-3-8b-instruct",
				name: "Llama 3 8B Instruct",
				description: "Compact and efficient version of Llama 3 for faster inference.",
				contextWindow: 8192,
				maxOutputTokens: 4096,
			},
			{
				id: "google/gemini-2.0-flash-001",
				name: "Gemini 2.0 Flash",
				description: "Google's advanced multimodal model with strong text and code capabilities.",
				contextWindow: 1048576,
				maxOutputTokens: 8192,
				supportsImages: true,
			},
			{
				id: "openai/gpt-4o-mini",
				name: "GPT-4o Mini",
				description: "Smaller and more cost-effective version of GPT-4o with similar capabilities.",
				contextWindow: 128000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "openai/gpt-4o",
				name: "GPT-4o",
				description: "OpenAI's powerful multimodal model with fast inference and vision capabilities.",
				contextWindow: 128000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "openai/o3-mini",
				name: "o3 Mini",
				description: "OpenAI's compact multimodal model balancing performance and efficiency.",
				contextWindow: 128000,
				maxOutputTokens: 4096,
				supportsImages: true,
			},
			{
				id: "openai/o3-mini-high",
				name: "o3 Mini High",
				description: "Higher-quality variant of o3-mini with improved reasoning capabilities.",
				contextWindow: 128000,
				maxOutputTokens: 4096,
				supportsImages: true,
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
				id: "claude-3-5-sonnet-20241022",
				name: "Claude 3.5 Sonnet",
				description: "Anthropic's latest balanced model with excellent performance",
				contextWindow: 200000,
				maxOutputTokens: 8192,
				supportsImages: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
			},
			{
				id: "claude-3-5-haiku-20241022",
				name: "Claude 3.5 Haiku",
				description: "Fast and efficient model for simpler tasks",
				contextWindow: 200000,
				maxOutputTokens: 8192,
				supportsImages: false,
				inputPrice: 0.8,
				outputPrice: 4.0,
			},
			{
				id: "claude-3-opus-20240229",
				name: "Claude 3 Opus",
				description: "Anthropic's most powerful model for complex tasks",
				contextWindow: 200000,
				maxOutputTokens: 4096,
				supportsImages: true,
				inputPrice: 15.0,
				outputPrice: 75.0,
			},
			{
				id: "claude-3-haiku-20240307",
				name: "Claude 3 Haiku",
				description: "Fast and efficient model for simpler tasks",
				contextWindow: 200000,
				maxOutputTokens: 4096,
				supportsImages: true,
				inputPrice: 0.25,
				outputPrice: 1.25,
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
				id: "gemini-2.0-flash-001",
				name: "Gemini 2.0 Flash",
				description: "Google's latest multimodal model with excellent performance",
				contextWindow: 1048576,
				maxOutputTokens: 8192,
				supportsImages: true,
			},
			{
				id: "gemini-2.0-flash-lite-preview-02-05",
				name: "Gemini 2.0 Flash Lite",
				description: "Lighter version of Gemini 2.0 Flash",
				contextWindow: 1048576,
				maxOutputTokens: 8192,
				supportsImages: true,
			},
			{
				id: "gemini-2.0-pro-exp-02-05",
				name: "Gemini 2.0 Pro",
				description: "Google's most powerful Gemini model",
				contextWindow: 2097152,
				maxOutputTokens: 8192,
				supportsImages: true,
			},
			{
				id: "gemini-1.5-flash-002",
				name: "Gemini 1.5 Flash",
				description: "Fast and efficient multimodal model",
				contextWindow: 1048576,
				maxOutputTokens: 8192,
				supportsImages: true,
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
				id: "mistral-large-2411",
				name: "Mistral Large",
				description: "Mistral's most powerful model",
				contextWindow: 131000,
				maxOutputTokens: 131000,
				supportsImages: false,
				inputPrice: 2.0,
				outputPrice: 6.0,
			},
			{
				id: "pixtral-large-2411",
				name: "Pixtral Large",
				description: "Mistral's multimodal model with image capabilities",
				contextWindow: 131000,
				maxOutputTokens: 131000,
				supportsImages: true,
				inputPrice: 2.0,
				outputPrice: 6.0,
			},
			{
				id: "mistral-small-2501",
				name: "Mistral Small",
				description: "Fast and efficient model for simpler tasks",
				contextWindow: 32000,
				maxOutputTokens: 32000,
				supportsImages: false,
				inputPrice: 0.1,
				outputPrice: 0.3,
			},
			{
				id: "codestral-2501",
				name: "Codestral",
				description: "Specialized for code generation and understanding",
				contextWindow: 256000,
				maxOutputTokens: 256000,
				supportsImages: false,
				inputPrice: 0.3,
				outputPrice: 0.9,
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
				id: "deepseek-chat",
				name: "DeepSeek Chat",
				description: "General purpose chat model",
				contextWindow: 64000,
				maxOutputTokens: 8000,
				supportsImages: false,
				outputPrice: 0.28,
			},
			{
				id: "deepseek-reasoner",
				name: "DeepSeek Reasoner",
				description: "Specialized for complex reasoning tasks",
				contextWindow: 64000,
				maxOutputTokens: 8000,
				supportsImages: false,
				outputPrice: 2.19,
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
				id: "moonshot-v1-8k",
				name: "Moonshot v1 (8K)",
				description: "General purpose language model with 8K context",
				contextWindow: 8192,
				maxOutputTokens: 8192,
				supportsImages: false,
				inputPrice: 1.68,
				outputPrice: 1.68,
			},
			{
				id: "moonshot-v1-32k",
				name: "Moonshot v1 (32K)",
				description: "General purpose language model with 32K context",
				contextWindow: 32768,
				maxOutputTokens: 8192,
				supportsImages: false,
				inputPrice: 3.36,
				outputPrice: 3.36,
			},
			{
				id: "moonshot-v1-128k",
				name: "Moonshot v1 (128K)",
				description: "General purpose language model with 128K context",
				contextWindow: 131072,
				maxOutputTokens: 8192,
				supportsImages: false,
				inputPrice: 8.4,
				outputPrice: 8.4,
			},
			{
				id: "moonshot-v1-8k-vision-preview",
				name: "Moonshot v1 Vision (8K)",
				description: "Multimodal model with 8K context",
				contextWindow: 8192,
				maxOutputTokens: 8192,
				supportsImages: true,
				inputPrice: 1.68,
				outputPrice: 1.68,
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
				id: "qwen-max-latest",
				name: "Qwen Max",
				description: "Alibaba's most powerful Qwen model",
				contextWindow: 32768,
				maxOutputTokens: 30720,
				supportsImages: false,
				inputPrice: 2.4,
				outputPrice: 9.6,
			},
			{
				id: "qwen-plus-latest",
				name: "Qwen Plus",
				description: "Balanced performance Qwen model",
				contextWindow: 131072,
				maxOutputTokens: 129024,
				supportsImages: false,
				inputPrice: 0.8,
				outputPrice: 2.0,
			},
			{
				id: "qwen-turbo-latest",
				name: "Qwen Turbo",
				description: "Fast and efficient Qwen model",
				contextWindow: 1000000,
				maxOutputTokens: 1000000,
				supportsImages: false,
				inputPrice: 0.8,
				outputPrice: 2.0,
			},
			{
				id: "qwen-vl-max-latest",
				name: "Qwen VL Max",
				description: "Multimodal Qwen model with vision capabilities",
				contextWindow: 131072,
				maxOutputTokens: 129024,
				supportsImages: true,
				inputPrice: 3.0,
				outputPrice: 9.0,
			},
			{
				id: "qwen2.5-coder-32b-instruct",
				name: "Qwen 2.5 Coder (32B)",
				description: "Specialized for code generation and understanding",
				contextWindow: 131072,
				maxOutputTokens: 8192,
				supportsImages: false,
				inputPrice: 0.002,
				outputPrice: 0.006,
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
