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
	 * @returns Promise resolving to the agents list response
	 */
	async listAgents(
		baseUrl: string,
		page = 1,
		perPage = 10,
		name?: string,
	): Promise<CRUDResponse<AgentListResult>> {
		const url = new URL(`${baseUrl}/v1/agents`);
		url.searchParams.append("page", page.toString());
		url.searchParams.append("per_page", perPage.toString());

		// Add name parameter if provided
		if (name) {
			url.searchParams.append("name", name);
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
};
