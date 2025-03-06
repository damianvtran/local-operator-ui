/**
 * Credential manifest defining available credentials with descriptions
 */
export const CREDENTIAL_MANIFEST = [
  {
    key: 'OPENAI_API_KEY',
    name: 'OpenAI API Key',
    description: 'API key for accessing OpenAI models like GPT-4, GPT-3.5-Turbo, and DALL-E.',
    url: 'https://platform.openai.com/api-keys'
  },
  {
    key: 'OPENROUTER_API_KEY',
    name: 'OpenRouter API Key',
    description: 'API key for OpenRouter, which provides access to various AI models from different providers.',
    url: 'https://openrouter.ai/keys'
  },
  {
    key: 'DEEPSEEK_API_KEY',
    name: 'DeepSeek API Key',
    description: 'API key for DeepSeek AI models, specialized in code generation and understanding.',
    url: 'https://platform.deepseek.com/'
  },
  {
    key: 'MISTRAL_API_KEY',
    name: 'Mistral API Key',
    description: 'API key for Mistral AI models, known for efficient and powerful language processing.',
    url: 'https://console.mistral.ai/api-keys/'
  },
  {
    key: 'KIMI_API_KEY',
    name: 'Kimi API Key',
    description: 'API key for Kimi AI, providing advanced language models with strong reasoning capabilities.',
    url: 'https://kimi.moonshot.cn/'
  },
  {
    key: 'ALIBABA_API_KEY',
    name: 'Alibaba API Key',
    description: 'API key for Alibaba Cloud AI models, offering a range of language and vision capabilities.',
    url: 'https://www.alibabacloud.com/product/ai'
  },
  {
    key: 'GOOGLE_AI_API_KEY',
    name: 'Google AI Studio API Key',
    description: 'API key for Google AI Studio, providing access to Gemini and other Google AI models.',
    url: 'https://aistudio.google.com/'
  },
  {
    key: 'SERP_API_KEY',
    name: 'SERP API Key',
    description: 'API key for Search Engine Results Page API, allowing access to search engine data.  Allows your agents to search the web for information.',
    url: 'https://serpapi.com/dashboard'
  },
  {
    key: 'TAVILY_API_KEY',
    name: 'Tavily API Key',
    description: 'API key for Tavily, a search API designed specifically for AI applications.  Allows your agents to search the web for information.',
    url: 'https://tavily.com/#api'
  }
];

/**
 * Find credential info from the manifest
 */
export const getCredentialInfo = (key: string) => {
  return CREDENTIAL_MANIFEST.find(cred => cred.key === key) || {
    key,
    name: key,
    description: 'Custom credential',
    url: ''
  };
};
