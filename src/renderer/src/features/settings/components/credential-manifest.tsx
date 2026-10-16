import { t } from "@shared/i18n";
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
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_your_radient_pass_radient_pass_provides_you_unified_a",
			);
		},
		url: "https://radienthq.com",
		type: CredentialType.Hosting,
	},
	{
		key: "OPENAI_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_openai_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_accessing_openai_models_like_gpt_4o_o3_mini_and_gpt_4",
			);
		},
		url: "https://platform.openai.com/api-keys",
		type: CredentialType.Hosting,
	},
	{
		key: "OPENROUTER_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_openrouter_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_openrouter_which_provides_access_to_various_ai_models",
			);
		},
		url: "https://openrouter.ai/keys",
		type: CredentialType.Hosting,
	},
	{
		key: "DEEPSEEK_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_deepseek_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_deepseek_ai_models_specialized_in_code_generation_and",
			);
		},
		url: "https://platform.deepseek.com/",
		type: CredentialType.Hosting,
	},
	{
		key: "MISTRAL_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_mistral_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_mistral_ai_models_known_for_efficient_and_powerful_la",
			);
		},
		url: "https://console.mistral.ai/api-keys/",
		type: CredentialType.Hosting,
	},
	{
		key: "KIMI_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_kimi_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_kimi_ai_providing_advanced_language_models_with_stron",
			);
		},
		url: "https://kimi.moonshot.cn/",
		type: CredentialType.Hosting,
	},
	{
		key: "ALIBABA_CLOUD_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_alibaba_cloud_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_alibaba_cloud_ai_models_offering_a_range_of_language_",
			);
		},
		url: "https://www.alibabacloud.com/product/ai",
		type: CredentialType.Hosting,
	},
	{
		key: "GOOGLE_AI_STUDIO_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_google_ai_studio_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_google_ai_studio_providing_access_to_gemini_and_other",
			);
		},
		url: "https://aistudio.google.com/",
		type: CredentialType.Hosting,
	},
	{
		key: "GOOGLE_ACCESS_TOKEN",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_google_access_token",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.oauth_2_0_access_token_for_google_apis_used_by_local_operator_for",
			);
		},
		url: "https://console.cloud.google.com/apis/credentials",
		internal: true,
		type: CredentialType.Oauth,
	},
	{
		key: "GOOGLE_TOKEN_EXPIRY_TIMESTAMP",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_google_token_expiry_timestamp",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.timestamp_in_milliseconds_since_epoch_indicating_when_the_current",
			);
		},
		url: "",
		internal: true,
		type: CredentialType.Oauth,
	},
	{
		key: "GOOGLE_REFRESH_TOKEN",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_google_refresh_token",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.oauth_2_0_refresh_token_for_google_apis_used_to_obtain_new_access",
			);
		},
		url: "https://console.cloud.google.com/apis/credentials",
		internal: true,
		type: CredentialType.Oauth,
	},
	{
		key: "ANTHROPIC_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_anthropic_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_anthropic_s_claude_models_known_for_agentic_code_gene",
			);
		},
		url: "https://console.anthropic.com/settings/keys",
		type: CredentialType.Hosting,
	},
	{
		key: "SERP_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_serp_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_search_engine_results_page_api_allowing_access_to_sea",
			);
		},
		url: "https://serpapi.com/dashboard",
		type: CredentialType.Search,
	},
	{
		key: "TAVILY_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_tavily_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_tavily_a_search_api_designed_specifically_for_ai_appl",
			);
		},
		url: "https://tavily.com/#api",
		type: CredentialType.Search,
	},
	{
		key: "BRAVE_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_brave_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_brave_search_an_independent_web_index_with_its_own_cr",
			);
		},
		url: "https://api-dashboard.search.brave.com/app/keys",
		type: CredentialType.Search,
	},
	{
		key: "EXA_API_KEY",
		get name() {
			return t("ui.settings.integrations.credential_manifest.name_exa_api_key");
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_exa_a_search_api_built_for_ai_applications_agents_can",
			);
		},
		url: "https://dashboard.exa.ai/api-keys",
		type: CredentialType.Search,
	},
	{
		key: "PARALLEL_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_parallel_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_parallel_a_web_search_api_for_ai_agents_agents_can_al",
			);
		},
		url: "https://platform.parallel.ai/",
		type: CredentialType.Search,
	},
	{
		key: "PERPLEXITY_API_KEY",
		get name() {
			return t(
				"ui.settings.integrations.credential_manifest.name_perplexity_api_key",
			);
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_perplexity_s_sonar_search_perplexity_is_best_effort_a",
			);
		},
		url: "https://console.perplexity.ai/",
		type: CredentialType.Search,
	},
	{
		key: "FAL_API_KEY",
		get name() {
			return t("ui.settings.integrations.credential_manifest.name_fal_api_key");
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_fal_used_by_agents_for_generating_interpreting_and_un",
			);
		},
		url: "https://docs.fal.ai/quick-start",
		type: CredentialType.Hosting,
	},
	{
		key: "XAI_API_KEY",
		get name() {
			return t("ui.settings.integrations.credential_manifest.name_xai_api_key");
		},
		get description() {
			return t(
				"ui.settings.integrations.credential_manifest.api_key_for_xai_providing_access_to_grok_and_other_advanced_xai_m",
			);
		},
		url: "https://docs.x.ai/docs/overview",
		type: CredentialType.Hosting,
	},
];
