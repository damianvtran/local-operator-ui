import { t } from "../../../../../i18n/messages";
/**
 * Local Operator API - Chat Endpoints
 */
import { desktopControlResponse } from "./desktop-api";
import type {
	AgentChatRequest,
	AgentEditFileRequest,
	AgentEditFileResponse,
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
				t("ui.common.errors.chat_request", {
					status: response.status,
					statusText: response.statusText,
				}),
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
				t("ui.common.errors.chat_agent", {
					status: response.status,
					statusText: response.statusText,
				}),
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
					t("ui.common.errors.chat_async", {
						status: response.status,
						statusText: response.statusText,
					}),
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
					t("ui.common.errors.chat_agent_async", {
						status: response.status,
						statusText: response.statusText,
					}),
				);
			}

			return (await response.json()) as CRUDResponse<JobDetails>;
		} catch (error) {
			console.error("Error in processAgentChatAsync:", error);
			throw error;
		}
	},

	/**
	 * Edit a file using a specific agent with an edit prompt.
	 * The endpoint loads the specified file, applies the agent's conversation history,
	 * and uses the agent to generate edit diffs based on the provided edit prompt.
	 *
	 * Sent through the desktop transport (`legacy.agent.editFile`) rather than a
	 * renderer `fetch`, like the app's other control calls: main attaches the
	 * desktop credential and owns the request's byte budget and deadline (see
	 * `INLINE_EDIT_BYTE_BUDGET` / `INLINE_EDIT_DEADLINE_MS` in
	 * `desktop-contract.ts`). `baseUrl` is kept for the client's uniform
	 * signature; main already knows the backend it pairs with.
	 *
	 * Failure contract is unchanged for the caller: a non-2xx answer (including
	 * main's own 413/504/503 refusals) throws the same `chat_edit_file` error,
	 * and an IPC/transport failure rejects with `desktopRequest`'s error - both
	 * reach the inline-edit popover's catch, which shows its one failure toast.
	 *
	 * @param _baseUrl - Unused; see above
	 * @param agentId - ID of the agent to use for editing
	 * @param request - The edit request containing file path and edit prompt
	 * @returns A response containing the generated edit diffs
	 * @throws Error if the request fails
	 */
	async editFileWithAgent(
		_baseUrl: string,
		agentId: string,
		request: AgentEditFileRequest,
	): Promise<CRUDResponse<AgentEditFileResponse>> {
		try {
			const response = await desktopControlResponse({
				op: "legacy.agent.editFile",
				agentId,
				request,
			});

			if (!response.ok) {
				throw new Error(
					t("ui.common.errors.chat_edit_file", {
						status: response.status,
						statusText: response.statusText,
					}),
				);
			}

			return (await response.json()) as CRUDResponse<AgentEditFileResponse>;
		} catch (error) {
			console.error("Error in editFileWithAgent:", error);
			throw error;
		}
	},
};
