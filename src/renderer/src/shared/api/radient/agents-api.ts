/**
 * Radient Agents API
 *
 * API client for agent-related endpoints
 */

import type {
	Agent,
	PaginatedAgentList,
	CreateAgentRequest,
	UpdateAgentRequest,
	AgentComment,
	CreateAgentCommentRequest,
	UpdateAgentCommentRequest,
	CountResponse,
	RadientApiResponse,
	APIResponse,
	AgentLike,
	AgentFavourite,
  PaginatedResponse,
} from "./types";

/**
 * Joins base URL and path ensuring exactly one slash between them.
 *
 * @param baseUrl - The base URL
 * @param path - The endpoint path
 * @returns The joined URL
 */
function joinUrl(baseUrl: string, path: string): string {
	const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
	return normalizedBaseUrl + normalizedPath;
}

/**
 * List agents (paginated).
 *
 * @param baseUrl - The base URL of the Radient API
 * @param page - Page number (default 1)
 * @param perPage - Records per page (default 20, max 100)
 * @returns Paginated list of agents
 */
export async function listAgents(
	baseUrl: string,
	page = 1,
	perPage = 20,
): Promise<RadientApiResponse<PaginatedAgentList>> {
	const url = joinUrl(
		baseUrl,
		`/v1/agents?page=${encodeURIComponent(page)}&per_page=${encodeURIComponent(perPage)}`,
	);

	const response = await fetch(url, {
		method: "GET",
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Get agent details by ID.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @returns Agent details
 */
export async function getAgent(
	baseUrl: string,
	agentId: string,
): Promise<RadientApiResponse<Agent>> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}`);

	const response = await fetch(url, {
		method: "GET",
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Create a new agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param accessToken - The access token (JWT or API key)
 * @param data - Agent creation data
 * @returns The created agent
 */
export async function createAgent(
	baseUrl: string,
	accessToken: string,
	data: CreateAgentRequest,
): Promise<RadientApiResponse<Agent>> {
	const url = joinUrl(baseUrl, "/v1/agents");

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Update an agent by ID.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT or API key)
 * @param data - Partial agent update data
 * @returns The updated agent
 */
export async function updateAgent(
	baseUrl: string,
	agentId: string,
	accessToken: string,
	data: UpdateAgentRequest,
): Promise<RadientApiResponse<Agent>> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}`);

	const response = await fetch(url, {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Delete an agent by ID.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT or API key)
 * @returns Success response
 */
export async function deleteAgent(
	baseUrl: string,
	agentId: string,
	accessToken: string,
): Promise<APIResponse> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}`);

	const response = await fetch(url, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});

	if (!response.ok && response.status !== 204) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.status === 204
		? { msg: "Deleted", result: undefined }
		: response.json();
}

/**
 * Like an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT)
 * @returns Success response
 */
export async function likeAgent(
	baseUrl: string,
	agentId: string,
	accessToken: string,
): Promise<APIResponse> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/like`);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});

	if (!response.ok && response.status !== 201 && response.status !== 200) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Unlike an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT)
 * @returns Success response
 */
export async function unlikeAgent(
	baseUrl: string,
	agentId: string,
	accessToken: string,
): Promise<APIResponse> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/like`);

	const response = await fetch(url, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});

	if (!response.ok && response.status !== 204) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.status === 204
		? { msg: "Unliked", result: undefined }
		: response.json();
}

/**
 * Get like count for an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @returns Like count
 */
export async function getAgentLikeCount(
	baseUrl: string,
	agentId: string,
): Promise<RadientApiResponse<CountResponse>> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/like/count`);

	const response = await fetch(url, {
		method: "GET",
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Favourite an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT)
 * @returns Success response
 */
export async function favouriteAgent(
	baseUrl: string,
	agentId: string,
	accessToken: string,
): Promise<APIResponse> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/favourite`);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});

	if (!response.ok && response.status !== 201 && response.status !== 200) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Unfavourite an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT)
 * @returns Success response
 */
export async function unfavouriteAgent(
	baseUrl: string,
	agentId: string,
	accessToken: string,
): Promise<APIResponse> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/favourite`);

	const response = await fetch(url, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});

	if (!response.ok && response.status !== 204) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.status === 204
		? { msg: "Unfavourited", result: undefined }
		: response.json();
}

/**
 * Get favourite count for an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @returns Favourite count
 */
export async function getAgentFavouriteCount(
	baseUrl: string,
	agentId: string,
): Promise<RadientApiResponse<CountResponse>> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/favourite/count`);

	const response = await fetch(url, {
		method: "GET",
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Get download count for an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @returns Download count
 */
export async function getAgentDownloadCount(
	baseUrl: string,
	agentId: string,
): Promise<RadientApiResponse<CountResponse>> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/download/count`);

	const response = await fetch(url, {
		method: "GET",
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Create a comment on an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT)
 * @param data - Comment creation data
 * @returns The created comment
 */
export async function createAgentComment(
	baseUrl: string,
	agentId: string,
	accessToken: string,
	data: CreateAgentCommentRequest,
): Promise<RadientApiResponse<AgentComment>> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/comments`);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
		credentials: "same-origin",
	});

	if (!response.ok && response.status !== 201) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * List comments on an agent with pagination.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT)
 * @param page - The page number (optional, defaults to 1)
 * @param perPage - The number of comments per page (optional, defaults to 20)
 * @returns Paginated list of comments
 * @throws Error if the API request fails
 */
export async function listAgentComments(
	baseUrl: string,
	agentId: string,
	accessToken: string,
	page = 1,
	perPage = 20,
): Promise<RadientApiResponse<PaginatedResponse<AgentComment>>> {
	const url = new URL(
		joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/comments`),
	);

	url.searchParams.set("page", String(page));
	url.searchParams.set("per_page", String(perPage));

	let response: Response;
	try {
		response = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
			credentials: "same-origin",
		});
	} catch (err) {
		throw new Error(`Network error: ${(err as Error).message}`);
	}

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Update a comment on an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param commentId - The comment ID
 * @param accessToken - The access token (JWT)
 * @param data - Comment update data
 * @returns The updated comment
 */
export async function updateAgentComment(
	baseUrl: string,
	agentId: string,
	commentId: string,
	accessToken: string,
	data: UpdateAgentCommentRequest,
): Promise<RadientApiResponse<AgentComment>> {
	const url = joinUrl(
		baseUrl,
		`/v1/agents/${encodeURIComponent(agentId)}/comments/${encodeURIComponent(commentId)}`,
	);

	const response = await fetch(url, {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
		credentials: "same-origin",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.json();
}

/**
 * Delete a comment on an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param commentId - The comment ID
 * @param accessToken - The access token (JWT)
 * @returns Success response
 */
export async function deleteAgentComment(
	baseUrl: string,
	agentId: string,
	commentId: string,
	accessToken: string,
): Promise<APIResponse> {
	const url = joinUrl(
		baseUrl,
		`/v1/agents/${encodeURIComponent(agentId)}/comments/${encodeURIComponent(commentId)}`,
	);

	const response = await fetch(url, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});

	if (!response.ok && response.status !== 204) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	return response.status === 204
		? { msg: "Deleted", result: undefined }
		: response.json();
}

/**
 * Get like details for the current user on an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT)
 * @returns Like details or empty object if not liked
 */
export async function getAgentLike(
	baseUrl: string,
	agentId: string,
	accessToken: string,
): Promise<RadientApiResponse<AgentLike | Record<string, never>>> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/like`);
	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});

	// Handle 404 specifically as "not liked"
	if (!response.ok) {
		if (response.status === 404) {
			// Return the structure expected by useAgentLikeQuery for a non-existent like
			return { msg: "Like not found", result: {} };
		}
		// Throw for other errors
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}

	// If response is OK (2xx), parse and return the JSON
	return response.json();
}

/**
 * Get favourite details for the current user on an agent.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param agentId - The agent ID
 * @param accessToken - The access token (JWT)
 * @returns Favourite details or empty object if not favourited
 */
export async function getAgentFavourite(
	baseUrl: string,
	agentId: string,
	accessToken: string,
): Promise<RadientApiResponse<AgentFavourite | Record<string, never>>> {
	const url = joinUrl(baseUrl, `/v1/agents/${encodeURIComponent(agentId)}/favourite`);
	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}
	return response.json();
}

/**
 * List agents liked/favourited by account.
 *
 * @param baseUrl - The base URL of the Radient API
 * @param accountId - The account ID
 * @param accessToken - The access token (JWT)
 * @param options - Filter options: liked, favourited, page, perPage
 * @returns Paginated list of agents
 */
export async function listAccountAgents(
	baseUrl: string,
	accountId: string,
	accessToken: string,
	options?: {
		liked?: boolean;
		favourited?: boolean;
		page?: number;
		perPage?: number;
	},
): Promise<RadientApiResponse<PaginatedAgentList>> {
	const params = new URLSearchParams();
	if (options?.liked !== undefined) params.append("liked", String(options.liked));
	if (options?.favourited !== undefined) params.append("favourited", String(options.favourited));
	if (options?.page !== undefined) params.append("page", String(options.page));
	if (options?.perPage !== undefined) params.append("per_page", String(options.perPage));
	const url = joinUrl(
		baseUrl,
		`/v1/accounts/${encodeURIComponent(accountId)}/agents${params.toString() ? `?${params.toString()}` : ""}`,
	);
	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
		credentials: "same-origin",
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `HTTP ${response.status}`);
	}
	return response.json();
}
