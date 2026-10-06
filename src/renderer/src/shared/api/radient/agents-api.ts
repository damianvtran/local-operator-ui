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
	AgentReactionResult,
	AgentViewerStatus,
	CountResponse,
	CreateAgentCommentRequest,
	CreateAgentRequest,
	HubTeamResult,
	HubTeamsResult,
	MembershipsResult,
	PaginatedAgentList,
	PaginatedResponse,
	PaginatedTeamList,
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
): Promise<RadientApiResponse<AgentReactionResult>> {
	return radientProxyEnvelope<AgentReactionResult>({
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
): Promise<RadientApiResponse<AgentReactionResult>> {
	return radientProxyEnvelope<AgentReactionResult>({
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

/**
 * The viewer's like and favourite state for a whole page of agents, in one call.
 *
 * The hub reads this instead of one `getAgentLike` plus one `getAgentFavourite`
 * per card, which is what made a twelve-card page cost twenty-four requests
 * before it painted. Ids travel as a comma-joined `agent_ids` query value; the
 * backend bounds how many it will accept and answers 404 when it is a version
 * that predates the op, which the caller is expected to survive (see
 * `use-agent-statuses-query`).
 *
 * `agent_ids` is sent in the caller's order and the result is keyed by id, so a
 * caller never has to pair a positional list with its input.
 */
export async function getAgentStatuses(
	agentIds: readonly string[],
): Promise<
	RadientApiResponse<{ statuses: Record<string, AgentViewerStatus> }>
> {
	return radientProxyEnvelope<{
		statuses: Record<string, AgentViewerStatus>;
	}>({
		operation: "agents.statuses",
		query: { agent_ids: agentIds.join(",") },
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

/* ------------------------------------------------------------- organizations */

/**
 * The caller's own organization memberships (design §4.1).
 *
 * This is the ONLY source of the org selector's list: rows are the account's
 * own memberships with their plan summary, so a surface can tell an org it may
 * use from one whose membership is pending or disabled, without a second call
 * per org. `tenant_id` is the org's identity everywhere below — the org
 * workspace's list, its teams, and the publish target.
 */
export async function listMemberships(): Promise<
	RadientApiResponse<MembershipsResult>
> {
	return radientProxyEnvelope<MembershipsResult>({
		operation: "memberships.list",
	});
}

/**
 * The agents published into one organization's private workspace (§4.4).
 *
 * `org_agents.list` rather than `agents.list` with a filter: the org route is
 * the one that scopes by the caller's MEMBERSHIP, and `visibility=org` is
 * pinned server-side by the proxy's request shaper rather than sent from here —
 * the operation's own name fixes the namespace, so a query spelling of it would
 * only be a second place the target could be wrong.
 *
 * The filters are the public list's, minus `tenant_id`: the organization
 * travels in the path.
 */
export async function listOrgAgents(
	tenantId: string,
	page = 1,
	perPage = 20,
	params?: {
		categories?: string;
		tags?: string;
		account_id?: string;
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
		operation: "org_agents.list",
		tenantId,
		query,
	});
}

/**
 * The teams published into one organization's private workspace (§4.5).
 *
 * The list form omits each team's `instructions` (the brief is detail-only),
 * so this is what a hub page's roster line renders from; the pull names one
 * team by id through {@link getOrgTeam}.
 */
export async function listOrgTeams(
	tenantId: string,
): Promise<RadientApiResponse<HubTeamsResult>> {
	return radientProxyEnvelope<HubTeamsResult>({
		operation: "org_teams.list",
		tenantId,
	});
}

/**
 * One published team document by id (§4.5), including its brief.
 *
 * The org-AGNOSTIC read: the id names the document, exactly as the CLI's
 * `teams pull` addresses it, so the desktop's pull does not need — and must not
 * invent — a `tenant_id` for a document it is only reading.
 */
export async function getOrgTeam(
	teamId: string,
): Promise<RadientApiResponse<HubTeamResult>> {
	return radientProxyEnvelope<HubTeamResult>({
		operation: "org_team.get",
		teamId,
	});
}

/* ------------------------------------------------------- the public hub */

/**
 * The PUBLIC team catalogue (`GET /v1/teams`), read DIRECTLY from the hub.
 *
 * ## Why this pair does not ride the proxy
 *
 * Every read above goes through `POST /v1/desktop/radient` because that route is
 * what keeps a Radient bearer out of the renderer: the backend resolves the
 * stored credential per call. THIS read carries no credential at all — the
 * public catalogue is anonymous by design, and the hub answers it exactly the
 * same whether or not the caller holds one (the backend's own
 * `RadientClient.list_public_teams` documents the same route as "No credential
 * is required"; the CLI's `teams search` is what it was written for). The proxy
 * exists to protect a secret, and there is no secret on this path.
 *
 * The closed proxy vocabulary has no public-team read, so the alternative was a
 * cross-repository contract change (the `RadientOperation` union, the
 * `radient.request` schema in `shared/desktop-contract.ts`, and
 * `desktop_radient.py`'s Literal and `endpoint()` map, which is a three-way
 * contract) plus the release that carries it — against which this surface would
 * be dark until every backend in the field had updated. A read that needs no
 * credential is the one hub call that can be issued without that.
 *
 * ## What it owes the caller
 *
 * The same `{msg, result}` envelope the proxy returns, so a caller reads
 * `.result` identically; the `origin` is a PARAMETER rather than an import of
 * `apiConfig` because this module is bundled by node tests, and `@shared/config`
 * builds the app's environment at module scope and throws in a bare node import
 * (measured: "Failed to load configuration").
 *
 * A NON-2xx is thrown as {@link PublicHubError} carrying the status, so the
 * retry policy and the surface's prose can tell "the hub refused" from "the hub
 * was unreachable".
 */
export class PublicHubError extends Error {
	/** The HTTP status, or null when the request never got an answer. */
	readonly status: number | null;

	/**
	 * The transport's own failure, when there was one: for LOGS, never for copy.
	 *
	 * A separate field rather than an interpolated message because the two have
	 * different audiences (QA round 2, Q2): `The public hub could not be reached.`
	 * is what a reader needs, and `Failed to fetch` is what an operator needs. The
	 * log this field exists for is emitted where the failure is caught, below
	 * (reviewer round 3, R3-4: the field had no reader at all, and a field nobody
	 * reads is a docstring claiming a behaviour the module does not have).
	 */
	readonly reason: unknown;

	constructor(message: string, status: number | null, reason?: unknown) {
		super(message);
		this.name = "PublicHubError";
		this.status = status;
		this.reason = reason;
	}
}

/** Trailing slashes on a configured origin: the route path supplies its own. */
const TRAILING_SLASHES = /\/+$/;

/** Join the hub origin with the route this module reads. */
const publicTeamsUrl = (origin: string, teamId?: string): string => {
	const base = origin.replace(TRAILING_SLASHES, "");
	return teamId
		? `${base}/v1/teams/${encodeURIComponent(teamId)}`
		: `${base}/v1/teams`;
};

/**
 * One anonymous GET of the public hub, as its `{msg, result}` envelope.
 *
 * `redirect: "error"` is provenance rather than secrecy: following a 3xx would
 * render another origin's rows as "the public hub". The peer client in
 * `local_operator/clients/radient.py` pins the same two things for the same
 * reason (review round 1, S-1 there).
 */
const readPublicHub = async <T>(
	url: string,
): Promise<RadientApiResponse<T>> => {
	let response: Response;
	try {
		response = await fetch(url, {
			method: "GET",
			headers: { Accept: "application/json" },
			redirect: "error",
		});
	} catch (error) {
		/*
		 * A PLAIN SENTENCE, with the browser's own text kept on the error as its
		 * CAUSE (QA round 2, Q2). Interpolating it put the browser's terser
		 * `Failed to fetch` — or a TLS/socket string — in front of a reader who can
		 * act on none of it. The cause is there for a log, never for the panel —
		 * and this is that log (reviewer round 3, R3-4), so the raw text has a
		 * reader instead of only a claim. `console.error` is the idiom the sibling
		 * mutating calls in this tree already use.
		 */
		console.error("The public hub could not be reached:", error);
		throw new PublicHubError(
			"The public hub could not be reached.",
			null,
			error,
		);
	}
	if (!response.ok) {
		throw new PublicHubError(
			`The public hub answered ${response.status}.`,
			response.status,
		);
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new PublicHubError(
			"The public hub answered with a body that is not JSON.",
			response.status,
		);
	}
	if (
		!body ||
		typeof body !== "object" ||
		!("result" in (body as Record<string, unknown>))
	) {
		throw new PublicHubError(
			"The public hub answered with a body this app cannot read.",
			response.status,
		);
	}
	return body as RadientApiResponse<T>;
};

/**
 * List the public hub's teams (anonymous, paginated).
 *
 * The listing ignores every filter the agent list honours — `name`,
 * `description`, `search` and `sort` all return the same page; only `page` and
 * `per_page` change the answer (measured against the live hub, 2026-10-05).
 * Search is therefore done over the rows this app has already fetched, in
 * `usePublicTeamsQuery`'s caller; there is no server-side search to send.
 */
export async function listPublicTeams(
	origin: string,
	page = 1,
	perPage = 12,
): Promise<RadientApiResponse<PaginatedTeamList>> {
	const url = `${publicTeamsUrl(origin)}?page=${page}&per_page=${perPage}`;
	return readPublicHub<PaginatedTeamList>(url);
}

/**
 * One public team document by id (anonymous), including its brief.
 *
 * The same route the org pair's `org_team.get` names — the id addresses the
 * document and the brief is detail-only, so this is what the library's detail
 * view reads after a LIST row (which omits `instructions`) has been chosen.
 */
export async function getPublicTeam(
	origin: string,
	teamId: string,
): Promise<RadientApiResponse<HubTeamResult>> {
	return readPublicHub<HubTeamResult>(publicTeamsUrl(origin, teamId));
}
