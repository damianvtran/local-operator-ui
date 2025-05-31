/**
 * Local Operator API - Agents Endpoints
 */
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
		baseUrl: string,
		page = 1,
		perPage = 10,
		name?: string,
		sort?: string,
		direction?: string,
	): Promise<CRUDResponse<AgentListResult>> {
		const url = new URL(`${baseUrl}/v1/agents`);
		url.searchParams.append("page", page.toString());
		url.searchParams.append("per_page", perPage.toString());

		// Add name parameter if provided
		if (name) {
			url.searchParams.append("name", name);
		}

		// Add sort and direction parameters if provided
		if (sort) {
			url.searchParams.append("sort", sort);
		}
		if (direction) {
			url.searchParams.append("direction", direction);
		}

		const response = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
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
		baseUrl: string,
		agent: AgentCreate,
	): Promise<CRUDResponse<AgentDetails>> {
		const response = await fetch(`${baseUrl}/v1/agents`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(agent),
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
		baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<AgentDetails>> {
		const response = await fetch(`${baseUrl}/v1/agents/${agentId}`, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
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
		baseUrl: string,
		agentId: string,
		update: AgentUpdate,
	): Promise<CRUDResponse<AgentDetails>> {
		const response = await fetch(`${baseUrl}/v1/agents/${agentId}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(update),
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
	async deleteAgent(baseUrl: string, agentId: string): Promise<CRUDResponse> {
		const response = await fetch(`${baseUrl}/v1/agents/${agentId}`, {
			method: "DELETE",
			headers: {
				Accept: "application/json",
			},
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
		baseUrl: string,
		agentId: string,
		page = 1,
		perPage = 10,
	): Promise<CRUDResponse<AgentExecutionHistoryResult>> {
		const url = new URL(`${baseUrl}/v1/agents/${agentId}/history`);
		url.searchParams.append("page", page.toString());
		url.searchParams.append("per_page", perPage.toString());

		const response = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
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
		baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/conversation`,
			{
				method: "DELETE",
				headers: {
					Accept: "application/json",
				},
			},
		);

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
		baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<{ system_prompt: string }>> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/system-prompt`,
			{
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			},
		);

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
		baseUrl: string,
		agentId: string,
		systemPrompt: string,
	): Promise<CRUDResponse> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/system-prompt`,
			{
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({ system_prompt: systemPrompt }),
			},
		);

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
		baseUrl: string,
		file: File,
	): Promise<CRUDResponse<AgentDetails>> {
		const formData = new FormData();
		formData.append("file", file);

		const response = await fetch(`${baseUrl}/v1/agents/import`, {
			method: "POST",
			body: formData,
		});

		if (!response.ok) {
			throw new Error(
				`Import agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<AgentDetails>>;
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
	async exportAgent(baseUrl: string, agentId: string): Promise<Blob> {
		const response = await fetch(`${baseUrl}/v1/agents/${agentId}/export`, {
			method: "GET",
		});

		if (!response.ok) {
			throw new Error(
				`Export agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.blob();
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
		baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<{ agent_id: string }>> {
		const response = await fetch(`${baseUrl}/v1/agents/${agentId}/upload`, {
			method: "POST",
			headers: {
				Accept: "application/json",
			},
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
		baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<AgentDetails>> {
		const response = await fetch(`${baseUrl}/v1/agents/${agentId}/download`, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
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
		baseUrl: string,
		agentId: string,
	): Promise<CRUDResponse<ExecutionVariablesResponse>> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/execution-variables`,
			{
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			},
		);

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
		baseUrl: string,
		agentId: string,
		variableData: ExecutionVariable,
	): Promise<CRUDResponse<ExecutionVariable>> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/execution-variables`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(variableData),
			},
		);

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
		baseUrl: string,
		agentId: string,
		variableKey: string,
	): Promise<CRUDResponse<ExecutionVariable>> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/execution-variables/${variableKey}`,
			{
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			},
		);

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
		baseUrl: string,
		agentId: string,
		variableKey: string,
		variableData: ExecutionVariable,
	): Promise<CRUDResponse<ExecutionVariable>> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/execution-variables/${variableKey}`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(variableData),
			},
		);

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
		baseUrl: string,
		agentId: string,
		variableKey: string,
	): Promise<CRUDResponse> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/execution-variables/${variableKey}`,
			{
				method: "DELETE",
				headers: {
					Accept: "application/json",
				},
			},
		);

		if (!response.ok) {
			throw new Error(
				`Delete agent execution variable request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},
};
