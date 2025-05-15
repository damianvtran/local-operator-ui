/**
 * Local Operator API Client
 * Generated from OpenAPI specification v0.3.7
 */

import { AgentsApi as AgentsApiImpl } from "./agents-api";
import { ChatApi as ChatApiImpl } from "./chat-api";
import { ConfigApi as ConfigApiImpl } from "./config-api";
import { CredentialsApi as CredentialsApiImpl } from "./credentials-api";
import { HealthApi as HealthApiImpl } from "./health-api";
import { JobsApi as JobsApiImpl } from "./jobs-api";
import { ModelsApi as ModelsApiImpl } from "./models-api";
import { SchedulesApi as SchedulesApiImpl } from "./schedules-api"; // Added
import { StaticApi as StaticApiImpl } from "./static-api";

// Export all API clients
export { HealthApi } from "./health-api";
export { ChatApi } from "./chat-api";
export { AgentsApi } from "./agents-api";
export { JobsApi } from "./jobs-api";
export { ConfigApi } from "./config-api";
export { CredentialsApi } from "./credentials-api";
export { ModelsApi } from "./models-api";
export { SchedulesApi } from "./schedules-api"; // Added
export { StaticApi } from "./static-api";
export { WebSocketApi } from "./websocket-api";

// Export all types
export type {
	ConfigMetadata,
	ConfigValues,
	ConfigResponse,
	ConfigUpdate,
	ConversationRole,
	JobStatus,
	ConversationRecord,
	ChatOptions,
	ChatRequest,
	AgentChatRequest,
	ChatStats,
	ChatResponse,
	HealthCheckResult,
	HealthCheckResponse,
	AgentCreate,
	AgentUpdate,
	AgentGetConversationResult,
	CRUDResponse,
	ValidationError,
	HTTPValidationError,
	AgentListResult,
	AgentDetails,
	JobDetails,
	JobListResult,
	JobCleanupResult,
	ActionType,
	ExecutionType,
	AgentExecutionRecord,
	AgentExecutionHistoryResult,
	CredentialListResult,
	CredentialUpdate,
	SystemPromptResponse,
	SystemPromptUpdate,
	// Schedule types
	ScheduleUnit,
	ScheduleCreateRequest,
	ScheduleResponse,
	ScheduleListResponse,
	ScheduleUpdateRequest,
} from "./types";

/**
 * Type for a function that takes a base URL as its first parameter
 * T represents the original function type without the baseUrl parameter
 */
type WithBaseUrl<T extends (...args: unknown[]) => unknown> = (
	baseUrl: string,
	...args: Parameters<T>
) => ReturnType<T>;

/**
 * Type for an API client with methods that take a base URL as their first parameter
 */
type ApiWithBaseUrl<T> = {
	[K in keyof T]: T[K] extends (...args: unknown[]) => unknown
		? WithBaseUrl<T[K]>
		: T[K];
};

/**
 * Type for a bound API client where the base URL is already provided
 */
type BoundApi<T> = {
	[K in keyof T]: T[K] extends (baseUrl: string, ...args: infer P) => infer R
		? (...args: P) => R
		: T[K];
};

/**
 * LocalOperatorClient - Main client for the Local Operator API
 * Provides a unified interface to all API endpoints with proper typing
 */
export class LocalOperatorClient {
	private baseUrl: string;

	/**
	 * Create a new Local Operator API client
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 */
	constructor(baseUrl: string) {
		// Ensure the base URL doesn't end with a slash
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	}

	/**
	 * Get the Health API client with methods bound to the base URL
	 */
	get health(): BoundApi<ApiWithBaseUrl<typeof HealthApiImpl>> {
		return this.bindBaseUrlToApi(HealthApiImpl);
	}

	/**
	 * Get the Chat API client with methods bound to the base URL
	 */
	get chat(): BoundApi<ApiWithBaseUrl<typeof ChatApiImpl>> {
		return this.bindBaseUrlToApi(ChatApiImpl);
	}

	/**
	 * Get the Agents API client with methods bound to the base URL
	 */
	get agents(): BoundApi<ApiWithBaseUrl<typeof AgentsApiImpl>> {
		return this.bindBaseUrlToApi(AgentsApiImpl);
	}

	/**
	 * Get the Jobs API client with methods bound to the base URL
	 */
	get jobs(): BoundApi<ApiWithBaseUrl<typeof JobsApiImpl>> {
		return this.bindBaseUrlToApi(JobsApiImpl);
	}

	/**
	 * Get the Config API client with methods bound to the base URL
	 */
	get config(): BoundApi<ApiWithBaseUrl<typeof ConfigApiImpl>> {
		return this.bindBaseUrlToApi(ConfigApiImpl);
	}

	/**
	 * Get the Credentials API client with methods bound to the base URL
	 */
	get credentials(): BoundApi<ApiWithBaseUrl<typeof CredentialsApiImpl>> {
		return this.bindBaseUrlToApi(CredentialsApiImpl);
	}

	/**
	 * Get the Models API client with methods bound to the base URL
	 */
	get models(): BoundApi<ApiWithBaseUrl<typeof ModelsApiImpl>> {
		return this.bindBaseUrlToApi(ModelsApiImpl);
	}

	/**
	 * Get the Static API client with methods bound to the base URL
	 */
	get static(): BoundApi<ApiWithBaseUrl<typeof StaticApiImpl>> {
		return this.bindBaseUrlToApi(StaticApiImpl);
	}

	/**
	 * Get the Schedules API client with methods bound to the base URL
	 */
	get schedules(): BoundApi<ApiWithBaseUrl<typeof SchedulesApiImpl>> {
		return this.bindBaseUrlToApi(SchedulesApiImpl);
	}

	/**
	 * Bind the base URL to all methods of an API client
	 *
	 * @param api - The API client to bind the base URL to
	 * @returns A new API client with all methods bound to the base URL
	 */
	private bindBaseUrlToApi<T extends object>(
		api: T,
	): BoundApi<ApiWithBaseUrl<T>> {
		const boundApi = {} as BoundApi<ApiWithBaseUrl<T>>;

		for (const key of Object.keys(api)) {
			const typedKey = key as keyof T;
			const method = api[typedKey];

			if (typeof method === "function") {
				// Create a new function that calls the original with the base URL
				boundApi[typedKey] = ((...args: unknown[]) =>
					(method as (...params: unknown[]) => unknown)(
						this.baseUrl,
						...args,
					)) as BoundApi<ApiWithBaseUrl<T>>[keyof T];
			} else {
				// Copy non-function properties as-is
				boundApi[typedKey] = method as BoundApi<ApiWithBaseUrl<T>>[keyof T];
			}
		}

		return boundApi;
	}
}

/**
 * Create a new Local Operator API client
 *
 * @param baseUrl - The base URL of the Local Operator API
 * @returns A new Local Operator API client instance
 */
export const createLocalOperatorClient = (
	baseUrl: string,
): LocalOperatorClient => {
	return new LocalOperatorClient(baseUrl);
};
