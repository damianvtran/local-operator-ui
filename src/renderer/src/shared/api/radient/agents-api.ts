/**
 * Radient Agents API
 *
 * Agent catalogue, likes, favourites and comments, all routed through the
 * backend's closed Radient proxy. The renderer never sends a Radient bearer:
 * the backend resolves the stored credential per call, and operations that
 * mutate carry a stable request id so a retry after HTTP loss cannot create
 * a second like, comment or deletion. Deletions additionally require the
 * `confirmed` flag the proxy enforces.
 *
 * Return shapes are the upstream `{msg, result}` envelopes the hooks already
 * consume; only the transport moved.
 */

import { radientProxyEnvelope } from "./proxy";
import type {
	APIResponse,
	Agent,
	AgentComment,
	AgentFavourite,
	AgentLike,
	CountResponse,
	CreateAgentCommentRequest,
	CreateAgentRequest,
	PaginatedAgentList,
	PaginatedResponse,
	RadientApiResponse,
	UpdateAgentCommentRequest,
	UpdateAgentRequest,
} from "./types";

function requestId(): string {
	return crypto.randomUUID();
}

/**
 * List agents (paginated, with optional filters).
 */
export async function listAgents(
	page = 1,
	perPage = 20,
	params?: {
		categories?: string;
		tags?: string;
		account_id?: string;
		tenant_id?: string;
		name?: string;
		description?: string;
		sort?: string;
		order?: string;
	},
): Promise<RadientApiResponse<PaginatedAgentList>> {
	const query: Record<string, string | number> = { page, per_page: perPage };
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value) query[key] = value;
		}
	}
	return radientProxyEnvelope<PaginatedAgentList>({
		operation: "agents.list",
		query,
	});
}

export async function getAgent(
	agentId: string,
): Promise<RadientApiResponse<Agent>> {
	return radientProxyEnvelope<Agent>({ operation: "agents.get", agentId });
}

export async function createAgent(
	data: CreateAgentRequest,
): Promise<RadientApiResponse<Agent>> {
	return radientProxyEnvelope<Agent>({
		operation: "agents.create",
		payload: data as unknown as Record<string, unknown>,
		requestId: requestId(),
	});
}

export async function updateAgent(
	agentId: string,
	data: UpdateAgentRequest,
): Promise<RadientApiResponse<Agent>> {
	return radientProxyEnvelope<Agent>({
		operation: "agents.update",
		agentId,
		payload: data as unknown as Record<string, unknown>,
		requestId: requestId(),
	});
}

export async function deleteAgent(
	agentId: string,
): Promise<RadientApiResponse<APIResponse>> {
	return radientProxyEnvelope<APIResponse>({
		operation: "agents.delete",
		agentId,
		requestId: requestId(),
		confirmed: true,
	});
}

export async function likeAgent(
	agentId: string,
): Promise<RadientApiResponse<APIResponse>> {
	return radientProxyEnvelope<APIResponse>({
		operation: "agents.like",
		agentId,
		requestId: requestId(),
	});
}

export async function unlikeAgent(
	agentId: string,
): Promise<RadientApiResponse<APIResponse>> {
	return radientProxyEnvelope<APIResponse>({
		operation: "agents.unlike",
		agentId,
		requestId: requestId(),
		confirmed: true,
	});
}

export async function getAgentLikeCount(
	agentId: string,
): Promise<RadientApiResponse<CountResponse>> {
	return radientProxyEnvelope<CountResponse>({
		operation: "agents.like_count",
		agentId,
	});
}

export async function favouriteAgent(
	agentId: string,
): Promise<RadientApiResponse<APIResponse>> {
	return radientProxyEnvelope<APIResponse>({
		operation: "agents.favourite",
		agentId,
		requestId: requestId(),
	});
}

export async function unfavouriteAgent(
	agentId: string,
): Promise<RadientApiResponse<APIResponse>> {
	return radientProxyEnvelope<APIResponse>({
		operation: "agents.unfavourite",
		agentId,
		requestId: requestId(),
		confirmed: true,
	});
}

export async function getAgentFavouriteCount(
	agentId: string,
): Promise<RadientApiResponse<CountResponse>> {
	return radientProxyEnvelope<CountResponse>({
		operation: "agents.favourite_count",
		agentId,
	});
}

export async function getAgentDownloadCount(
	agentId: string,
): Promise<RadientApiResponse<CountResponse>> {
	return radientProxyEnvelope<CountResponse>({
		operation: "agents.download_count",
		agentId,
	});
}

export async function createAgentComment(
	agentId: string,
	data: CreateAgentCommentRequest,
): Promise<RadientApiResponse<AgentComment>> {
	return radientProxyEnvelope<AgentComment>({
		operation: "comments.create",
		agentId,
		payload: data as unknown as Record<string, unknown>,
		requestId: requestId(),
	});
}

export async function listAgentComments(
	agentId: string,
	page = 1,
	perPage = 20,
): Promise<RadientApiResponse<PaginatedResponse<AgentComment>>> {
	return radientProxyEnvelope<PaginatedResponse<AgentComment>>({
		operation: "comments.list",
		agentId,
		query: { page, per_page: perPage },
	});
}

export async function updateAgentComment(
	agentId: string,
	commentId: string,
	data: UpdateAgentCommentRequest,
): Promise<RadientApiResponse<AgentComment>> {
	return radientProxyEnvelope<AgentComment>({
		operation: "comments.update",
		agentId,
		commentId,
		payload: data as unknown as Record<string, unknown>,
		requestId: requestId(),
	});
}

export async function deleteAgentComment(
	agentId: string,
	commentId: string,
): Promise<RadientApiResponse<APIResponse>> {
	return radientProxyEnvelope<APIResponse>({
		operation: "comments.delete",
		agentId,
		commentId,
		requestId: requestId(),
		confirmed: true,
	});
}

export async function getAgentLike(
	agentId: string,
): Promise<RadientApiResponse<AgentLike | Record<string, never>>> {
	return radientProxyEnvelope<AgentLike | Record<string, never>>({
		operation: "agents.liked",
		agentId,
	});
}

export async function getAgentFavourite(
	agentId: string,
): Promise<RadientApiResponse<AgentFavourite | Record<string, never>>> {
	return radientProxyEnvelope<AgentFavourite | Record<string, never>>({
		operation: "agents.favourited",
		agentId,
	});
}

export async function listAccountAgents(
	accountId: string,
	options?: {
		liked?: boolean;
		favourited?: boolean;
		page?: number;
		perPage?: number;
	},
): Promise<RadientApiResponse<PaginatedAgentList>> {
	const query: Record<string, string | number> = {};
	if (options?.page !== undefined) query.page = options.page;
	if (options?.perPage !== undefined) query.per_page = options.perPage;
	// `liked`/`favourited` are not in the proxy's account.agents allow-list;
	// the proxy rejects unknown query fields rather than silently dropping
	// them, so they are not forwarded here.
	return radientProxyEnvelope<PaginatedAgentList>({
		operation: "account.agents",
		accountId,
		query,
	});
}
