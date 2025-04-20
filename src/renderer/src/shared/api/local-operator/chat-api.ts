/**
 * Local Operator API - Chat Endpoints
 */
import type {
	AgentChatRequest,
	CRUDResponse,
	ChatRequest,
	ChatResponse,
	JobDetails,
} from "./types";

/**
 * Chat API client for the Local Operator API
 */
export const ChatApi = {
	/**
	 * Process chat request
	 * Accepts a prompt and optional context/configuration, returns the model response and conversation history.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param request - The chat request
	 * @returns Promise resolving to the chat response
	 */
	async processChat(
		baseUrl: string,
		request: ChatRequest,
	): Promise<CRUDResponse<ChatResponse>> {
		const response = await fetch(`${baseUrl}/v1/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			throw new Error(
				`Chat request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ChatResponse>>;
	},

	/**
	 * Process chat request using a specific agent
	 * Accepts a prompt and optional context/configuration, retrieves the specified agent from the registry,
	 * applies it to the operator and executor, and returns the model response and conversation history.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to use for the chat
	 * @param request - The chat request
	 * @returns Promise resolving to the chat response
	 */
	async chatWithAgent(
		baseUrl: string,
		agentId: string,
		request: ChatRequest,
	): Promise<CRUDResponse<ChatResponse>> {
		const response = await fetch(`${baseUrl}/v1/chat/agents/${agentId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			throw new Error(
				`Chat with agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ChatResponse>>;
	},

	/**
	 * Process chat request asynchronously
	 * Accepts a prompt and optional context/configuration, starts an asynchronous job to process the request
	 * and returns job details.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param request - The chat request
	 * @returns Promise resolving to the job details
	 * @throws Error if the request fails
	 */
	async processChatAsync(
		baseUrl: string,
		request: ChatRequest,
	): Promise<CRUDResponse<JobDetails>> {
		try {
			const response = await fetch(`${baseUrl}/v1/chat/async`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(request),
			});

			if (!response.ok) {
				throw new Error(
					`Async chat request failed: ${response.status} ${response.statusText}`,
				);
			}

			return (await response.json()) as CRUDResponse<JobDetails>;
		} catch (error) {
			console.error("Error in processChatAsync:", error);
			throw error;
		}
	},

	/**
	 * Process agent chat request asynchronously.
	 * Accepts a prompt and optional context/configuration, retrieves the specified agent from the registry,
	 * starts an asynchronous job to process the request and returns job details.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to use for the chat
	 * @param request - The agent chat request
	 * @returns Promise resolving to the job details
	 * @throws Error if the request fails
	 */
	async processAgentChatAsync(
		baseUrl: string,
		agentId: string,
		request: AgentChatRequest,
	): Promise<CRUDResponse<JobDetails>> {
		try {
			const response = await fetch(
				`${baseUrl}/v1/chat/agents/${agentId}/async`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify(request),
				},
			);

			if (!response.ok) {
				throw new Error(
					`Async agent chat request failed: ${response.status} ${response.statusText}`,
				);
			}

			return (await response.json()) as CRUDResponse<JobDetails>;
		} catch (error) {
			console.error("Error in processAgentChatAsync:", error);
			throw error;
		}
	},
};
