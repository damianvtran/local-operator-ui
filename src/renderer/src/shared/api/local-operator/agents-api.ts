/**
 * Local Operator API - Agents Endpoints
 */
import {
	desktopControlResponse,
	desktopMedia,
	mediaError,
} from "./desktop-api";
import type {
	AgentCreate,
	AgentDetails,
	AgentExecutionHistoryResult,
	AgentListResult,
	AgentUpdate,
	CRUDResponse,
	ExecutionVariable,
	ExecutionVariablesResponse,
} from "./types";

/**
 * Agents API client for the Local Operator API
 */
export const AgentsApi = {
	/**
	 * List agents
	 * Retrieve a paginated list of agents with their details.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param page - Page number (default: 1)
	 * @param perPage - Number of agents per page (default: 10)
	 * @param name - Optional name query to search agents by name
	 * @param sort - Optional field to sort by (e.g., 'name', 'created_date', 'last_message_datetime')
	 * @param direction - Optional sort direction ('asc' or 'desc')
	 * @returns Promise resolving to the agents list response
	 */
	async listAgents(
		_baseUrl: string,
		page = 1,
		perPage = 10,
		name?: string,
		sort?: string,
		direction?: string,
	): Promise<CRUDResponse<AgentListResult>> {
		// Agent inventory carries names and working-directory paths, so it is gated
		// in managed mode alongside the control plane and reached by operation.
		const response = await desktopControlResponse({
			op: "legacy.agents.list",
			page,
			perPage,
			...(name ? { name } : {}),
			...(sort ? { sort } : {}),
			...(direction === "asc" || direction === "desc" ? { direction } : {}),
		});

		if (!response.ok) {
			throw new Error(
				`List agents request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<AgentListResult>>;
	},

	/**
	 * Create a new agent
	 * Create a new agent with the provided details.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agent - The agent details to create
	 * @returns Promise resolving to the created agent response
	 */
	async createAgent(
		_baseUrl: string,
		agent: AgentCreate,
	): Promise<CRUDResponse<AgentDetails>> {
		// Creating an agent is gated in managed mode; as a bare fetch this 401'd,
		// which broke the "New agent" button in exactly the configuration this
		// release creates.
		const response = await desktopControlResponse({
			op: "legacy.agent.create",
			agent,
		});

		if (!response.ok) {
			throw new Error(
				`Create agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<AgentDetails>>;
	},

	/**
	 * Retrieve an agent
	 * Retrieve details for an agent by its ID.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to retrieve
	 * @returns Promise resolving to the agent details response
	 */
	async getAgent(
		_baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<AgentDetails>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.get",
			agentId,
		});

		if (!response.ok) {
			throw new Error(
				`Get agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<AgentDetails>>;
	},

	/**
	 * Update an agent
	 * Update an existing agent with new details. Only provided fields will be updated.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to update
	 * @param update - The agent details to update
	 * @returns Promise resolving to the updated agent response
	 */
	async updateAgent(
		_baseUrl: string,
		agentId: string,
		update: AgentUpdate,
	): Promise<CRUDResponse<AgentDetails>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.update",
			agentId,
			update,
		});

		if (!response.ok) {
			throw new Error(
				`Update agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<AgentDetails>>;
	},

	/**
	 * Delete an agent
	 * Delete an existing agent by its ID.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to delete
	 * @returns Promise resolving to the deletion response
	 */
	async deleteAgent(_baseUrl: string, agentId: string): Promise<CRUDResponse> {
		const response = await desktopControlResponse({
			op: "legacy.agent.delete",
			agentId,
		});

		if (!response.ok) {
			throw new Error(
				`Delete agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},

	/**
	 * Get agent execution history
	 * Retrieve the execution history for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to get execution history for
	 * @param page - Page number (default: 1)
	 * @param perPage - Number of executions per page (default: 10)
	 * @returns Promise resolving to the agent execution history
	 * @throws Error if the request fails
	 */
	async getAgentExecutionHistory(
		_baseUrl: string,
		agentId: string,
		page = 1,
		perPage = 10,
	): Promise<CRUDResponse<AgentExecutionHistoryResult>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.history",
			agentId,
			page,
			perPage,
		});

		if (!response.ok) {
			throw new Error(
				`Get agent execution history request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<
			CRUDResponse<AgentExecutionHistoryResult>
		>;
	},

	/**
	 * Clear agent conversation
	 * Clear the conversation history for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to clear conversation for
	 * @returns Promise resolving to the clear conversation response
	 * @throws Error if the request fails
	 */
	async clearAgentConversation(
		_baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse> {
		const response = await desktopControlResponse({
			op: "legacy.agent.conversation.clear",
			agentId,
		});

		if (!response.ok) {
			throw new Error(
				`Clear agent conversation request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},

	/**
	 * Get agent system prompt
	 * Retrieve the system prompt for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to get system prompt for
	 * @returns Promise resolving to the agent system prompt response
	 * @throws Error if the request fails
	 */
	async getAgentSystemPrompt(
		_baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<{ system_prompt: string }>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.systemPrompt.get",
			agentId,
		});

		if (!response.ok) {
			throw new Error(
				`Get agent system prompt request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<{ system_prompt: string }>>;
	},

	/**
	 * Update agent system prompt
	 * Update the system prompt for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to update system prompt for
	 * @param systemPrompt - The new system prompt text
	 * @returns Promise resolving to the update response
	 * @throws Error if the request fails
	 */
	async updateAgentSystemPrompt(
		_baseUrl: string,
		agentId: string,
		systemPrompt: string,
	): Promise<CRUDResponse> {
		const response = await desktopControlResponse({
			op: "legacy.agent.systemPrompt.update",
			agentId,
			systemPrompt,
		});

		if (!response.ok) {
			throw new Error(
				`Update agent system prompt request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},

	/**
	 * Import an agent from a ZIP file
	 * Import an agent from a ZIP file containing agent state files with an agent.yml file.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param file - The ZIP file containing agent state files
	 * @returns Promise resolving to the imported agent response
	 * @throws Error if the request fails
	 */
	async importAgent(
		_baseUrl: string,
		file: File,
	): Promise<CRUDResponse<AgentDetails>> {
		// ZIP bytes go through the authenticated media relay; the managed
		// backend rejects an unauthenticated multipart post on this route.
		const bytes = new Uint8Array(await file.arrayBuffer());
		const result = await desktopMedia(
			{ op: "agent.import", fileName: file.name || "agent.zip" },
			bytes,
		);
		if (result.kind !== "json") throw mediaError(result);
		return result.body as CRUDResponse<AgentDetails>;
	},

	/**
	 * Export an agent as a ZIP file
	 * Export an agent's state files as a ZIP file.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to export
	 * @returns Promise resolving to a Blob containing the ZIP file
	 * @throws Error if the request fails
	 */
	async exportAgent(_baseUrl: string, agentId: string): Promise<Blob> {
		// The ZIP travels the media relay, not the JSON transport: the desktop
		// response envelope has nowhere to put binary. Gated like the rest of the
		// agent family, so a bare fetch 401s in managed mode.
		const result = await desktopMedia({ op: "agent.export", agentId }, null);
		if (result.kind !== "bytes") throw mediaError(result);
		return new Blob([result.data as BlobPart], { type: result.mimeType });
	},

	/**
	 * Upload (push) an agent to Radient marketplace
	 * Upload (push) the agent with the given ID to the Radient agents marketplace.
	 * Requires RADIENT_API_KEY.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to upload
	 * @returns Promise resolving to the upload response
	 * @throws Error if the request fails
	 */
	async uploadAgentToRadient(
		_baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<{ agent_id: string }>> {
		// Marketplace upload is a gated legacy control; a bare fetch 401s in the
		// managed posture this app creates.
		const response = await desktopControlResponse({
			op: "legacy.agent.upload",
			agentId,
		});

		if (!response.ok) {
			// Attempt to parse error details if available
			let errorDetail = `Upload agent to Radient request failed: ${response.status} ${response.statusText}`;
			try {
				const errorBody = await response.json();
				if (errorBody?.detail) {
					errorDetail = `Upload agent to Radient failed: ${errorBody.detail}`;
				}
			} catch (_) {
				// Ignore if parsing fails, use the original error message
			}
			throw new Error(errorDetail);
		}

		return response.json() as Promise<CRUDResponse<{ agent_id: string }>>;
	},

	/**
	 * Download (pull) an agent from Radient marketplace
	 * Download (pull) an agent from the Radient agents marketplace by agent ID.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to download from Radient
	 * @returns Promise resolving to the downloaded agent details response
	 * @throws Error if the request fails
	 */
	async downloadAgentFromRadient(
		_baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<AgentDetails>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.download",
			agentId,
		});

		if (!response.ok) {
			// Attempt to parse error details if available
			let errorDetail = `Download agent from Radient request failed: ${response.status} ${response.statusText}`;
			try {
				const errorBody = await response.json();
				if (errorBody?.detail) {
					errorDetail = `Download agent from Radient failed: ${errorBody.detail}`;
				}
			} catch (_) {
				// Ignore if parsing fails, use the original error message
			}
			throw new Error(errorDetail);
		}

		return response.json() as Promise<CRUDResponse<AgentDetails>>;
	},

	/**
	 * List agent execution variables
	 * Retrieve all execution variables for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent
	 * @returns Promise resolving to the execution variables list response
	 */
	async listAgentExecutionVariables(
		_baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<ExecutionVariablesResponse>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.variables.list",
			agentId,
		});

		if (!response.ok) {
			throw new Error(
				`List agent execution variables request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ExecutionVariablesResponse>>;
	},

	/**
	 * Create an agent execution variable
	 * Create a new execution variable for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent
	 * @param variableData - The execution variable data to create
	 * @returns Promise resolving to the created execution variable response
	 */
	async createAgentExecutionVariable(
		_baseUrl: string,
		agentId: string,
		variableData: ExecutionVariable,
	): Promise<CRUDResponse<ExecutionVariable>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.variables.create",
			agentId,
			variable: variableData,
		});

		if (!response.ok) {
			throw new Error(
				`Create agent execution variable request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ExecutionVariable>>;
	},

	/**
	 * Get an agent execution variable
	 * Retrieve a specific execution variable for an agent by its key.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent
	 * @param variableKey - Key of the execution variable
	 * @returns Promise resolving to the execution variable response
	 */
	async getAgentExecutionVariable(
		_baseUrl: string,
		agentId: string,
		variableKey: string,
	): Promise<CRUDResponse<ExecutionVariable>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.variables.get",
			agentId,
			key: variableKey,
		});

		if (!response.ok) {
			throw new Error(
				`Get agent execution variable request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ExecutionVariable>>;
	},

	/**
	 * Update an agent execution variable
	 * Update an existing execution variable for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent
	 * @param variableKey - Key of the execution variable to update
	 * @param variableData - The execution variable data to update
	 * @returns Promise resolving to the updated execution variable response
	 */
	async updateAgentExecutionVariable(
		_baseUrl: string,
		agentId: string,
		variableKey: string,
		variableData: ExecutionVariable,
	): Promise<CRUDResponse<ExecutionVariable>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.variables.update",
			agentId,
			key: variableKey,
			variable: variableData,
		});

		if (!response.ok) {
			throw new Error(
				`Update agent execution variable request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ExecutionVariable>>;
	},

	/**
	 * Delete an agent execution variable
	 * Delete an execution variable for a specific agent by its key.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent
	 * @param variableKey - Key of the execution variable to delete
	 * @returns Promise resolving to the deletion response
	 */
	async deleteAgentExecutionVariable(
		_baseUrl: string,
		agentId: string,
		variableKey: string,
	): Promise<CRUDResponse> {
		const response = await desktopControlResponse({
			op: "legacy.agent.variables.delete",
			agentId,
			key: variableKey,
		});

		if (!response.ok) {
			throw new Error(
				`Delete agent execution variable request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},
};
