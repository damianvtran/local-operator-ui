export enum CredentialType {
	Hosting = "hosting",
	Search = "search",
	Oauth = "oauth",
}

/**
 * Credential manifest defining available credentials with descriptions
 */
export const CREDENTIAL_MANIFEST = [
	{
		key: "RADIENT_API_KEY",
		name: "Radient Pass",
		description:
			"API key for your Radient Pass.  Radient Pass provides you unified access to models, tools, agents, automatic optimization, and many more features with a single key.  Get one by signing in above with Gmail or Microsoft.",
		url: "https://radienthq.com",
		type: CredentialType.Hosting,
	},
	{
		key: "OPENAI_API_KEY",
		name: "OpenAI API Key",
		description:
			"API key for accessing OpenAI models like GPT-4o, o3-mini, and GPT-4.5.",
		url: "https://platform.openai.com/api-keys",
		type: CredentialType.Hosting,
	},
	{
		key: "OPENROUTER_API_KEY",
		name: "OpenRouter API Key",
		description:
			"API key for OpenRouter, which provides access to various AI models from different providers.  Getting an openrouter key allows you to simultaneously access many models from different providers.",
		url: "https://openrouter.ai/keys",
		type: CredentialType.Hosting,
	},
	{
		key: "DEEPSEEK_API_KEY",
		name: "DeepSeek API Key",
		description:
			"API key for DeepSeek AI models, specialized in code generation and understanding.",
		url: "https://platform.deepseek.com/",
		type: CredentialType.Hosting,
	},
	{
		key: "MISTRAL_API_KEY",
		name: "Mistral API Key",
		description:
			"API key for Mistral AI models, known for efficient and powerful language processing.",
		url: "https://console.mistral.ai/api-keys/",
		type: CredentialType.Hosting,
	},
	{
		key: "KIMI_API_KEY",
		name: "Kimi API Key",
		description:
			"API key for Kimi AI, providing advanced language models with strong reasoning capabilities.",
		url: "https://kimi.moonshot.cn/",
		type: CredentialType.Hosting,
	},
	{
		key: "ALIBABA_CLOUD_API_KEY",
		name: "Alibaba Cloud API Key",
		description:
			"API key for Alibaba Cloud AI models, offering a range of language and vision capabilities such as Qwen.",
		url: "https://www.alibabacloud.com/product/ai",
		type: CredentialType.Hosting,
	},
	{
		key: "GOOGLE_AI_STUDIO_API_KEY",
		name: "Google AI Studio API Key",
		description:
			"API key for Google AI Studio, providing access to Gemini and other Google AI models.",
		url: "https://aistudio.google.com/",
		type: CredentialType.Hosting,
	},
	{
		key: "GOOGLE_ACCESS_TOKEN",
		name: "Google Access Token",
		description:
			"OAuth 2.0 access token for Google APIs. Used by Local Operator for authenticated requests to Google services such as Gmail, Calendar, and Drive. This token is short-lived and automatically refreshed.",
		url: "https://console.cloud.google.com/apis/credentials",
		internal: true,
		type: CredentialType.Oauth,
	},
	{
		key: "GOOGLE_TOKEN_EXPIRY_TIMESTAMP",
		name: "Google Token Expiry Timestamp",
		description:
			"Timestamp (in milliseconds since epoch) indicating when the current Google access token will expire. Used internally to manage token refresh.",
		url: "",
		internal: true,
		type: CredentialType.Oauth,
	},
	{
		key: "GOOGLE_REFRESH_TOKEN",
		name: "Google Refresh Token",
		description:
			"OAuth 2.0 refresh token for Google APIs. Used to obtain new access tokens when the current one expires. This is managed securely and automatically.",
		url: "https://console.cloud.google.com/apis/credentials",
		internal: true,
		type: CredentialType.Oauth,
	},
	{
		key: "ANTHROPIC_API_KEY",
		name: "Anthropic API Key",
		description:
			"API key for Anthropic's Claude models, known for agentic code generation capabilities.",
		url: "https://console.anthropic.com/settings/keys",
		type: CredentialType.Hosting,
	},
	{
		key: "SERP_API_KEY",
		name: "SERP API Key",
		description:
			"API key for Search Engine Results Page API, allowing access to search engine data.  Allows your agents to search the web for information.",
		url: "https://serpapi.com/dashboard",
		type: CredentialType.Search,
	},
	{
		key: "TAVILY_API_KEY",
		name: "Tavily API Key",
		description:
			"API key for Tavily, a search API designed specifically for AI applications.  Allows your agents to search the web for information.",
		url: "https://tavily.com/#api",
		type: CredentialType.Search,
	},
	{
		key: "FAL_API_KEY",
		name: "FAL API Key",
		description:
			"API key for FAL, used by agents for generating, interpreting, and understanding images.",
		url: "https://docs.fal.ai/quick-start",
		type: CredentialType.Hosting,
	},
	{
		key: "XAI_API_KEY",
		name: "xAI API Key",
		description:
			"API key for xAI, providing access to Grok and other advanced xAI models for language and reasoning tasks.",
		url: "https://docs.x.ai/docs/overview",
		type: CredentialType.Hosting,
	},
];

/**
 * Find credential info from the manifest
 *
 * @param key - The credential key to look up.
 * @returns The credential info object if found, otherwise a default object.
 */
export const getCredentialInfo = (key: string) => {
	return (
		CREDENTIAL_MANIFEST.find((cred) => cred.key === key) || {
			key,
			name: key,
			description: "Custom credential",
			url: "",
		}
	);
};
