/**
 * Local Operator API - Agents Endpoints
 */
import {
	DesktopControlError,
	desktopControlResponse,
	desktopMedia,
	mediaError,
} from "./desktop-api";
import {
	type PublicationDetails,
	publicationErrorFromBody,
	publicationProse,
} from "./publication-errors";
import type {
	AgentCreate,
	AgentDetails,
	AgentExecutionHistoryResult,
	AgentListResult,
	AgentUpdate,
	CRUDResponse,
} from "./types";

/**
 * A partial override of a version-1 instruction-set document.
 *
 * The fields are the document's CONTENT fields, so this type is the renderer's
 * half of the contract in `src/shared/desktop-contract.ts`: the op's schema
 * narrows it further (name rules, caps), and the local backend refuses any key
 * outside the set with `422 invalid_instruction_set` naming it. `document_type`
 * and `document_version` are client-owned and deliberately absent — an override
 * of either is refused, so there is no shape here in which one could travel.
 */
export type PublicationDocumentOverride = {
	name?: string;
	description?: string;
	instructions?: string;
	kind?: "role" | "specialist";
	when_to_use?: string;
	tools?: string[];
	effort?: string;
	delegate?: boolean;
	version?: string;
	categories?: string[];
	tags?: string[];
};

/**
 * What the hub returned for an accepted publication.
 *
 * `agent_id` is the HUB listing's id, which is the only handle a republish can
 * be addressed with: the local registry keeps no link to the listing a row was
 * published as, so whatever remembers that link has to be this app.
 */
export type PublishedListing = {
	agent_id: string;
	name: string;
	version?: string;
	document_version?: number;
};

/**
 * The hub's answer to "is this name publishable?" (contract §2.1).
 *
 * `available: false` is a SUCCESSFUL answer, not an error: the question was
 * asked and answered, with `code` saying why (`name_taken`,
 * `name_reserved_builtin`). The hub answers this route as an error only when the
 * name itself breaks the name rules.
 */
export type NameAvailability = {
	name: string;
	name_key?: string;
	available: boolean;
	code?: string;
	details?: PublicationDetails;
};

/**
 * The error a failed control response should become.
 *
 * The ladder, in order, and every arm is a state this app supports:
 *
 * 1. a refusal carrying a KNOWN code becomes a typed `PublicationError` the
 *    caller can switch on;
 * 2. a refusal with a prose `detail` keeps that prose — an older backend answers
 *    every one of these failures with one string, and a hub whose code this
 *    renderer does not recognise is a hub newer than this app;
 * 3. a 404 with no code at all is an op this backend does not have. FastAPI's own
 *    body for that is the literal string "Not Found", which tells a user nothing
 *    they can act on, so the caller may supply the sentence that names the
 *    remedy. `undefined` leaves the status-tagged generic.
 *
 * @param response - The failed response
 * @param unknownOp - The sentence for a backend that has no such operation
 */
async function controlRefusal(
	response: Response,
	unknownOp?: string,
): Promise<Error> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	const structured = publicationErrorFromBody(response.status, body);
	if (structured) return structured;
	const prose = publicationProse(body);
	if (
		unknownOp &&
		response.status === 404 &&
		(!prose || prose === "Not Found")
	) {
		return new DesktopControlError(response.status, unknownOp);
	}
	return new DesktopControlError(
		response.status,
		prose ?? `The request failed (HTTP ${response.status}).`,
	);
}

/** The publication arm of `controlRefusal`, with this app's sentence for an old backend. */
const publicationFailure = (response: Response) =>
	controlRefusal(
		response,
		"This backend cannot publish instruction sets yet. Update the backend and try again.",
	);

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
			// Carries the status, not just a message with the number in it: the
			// chat page has to tell "this agent no longer exists" (404, a normal
			// event after a delete or a config-dir switch) from "the backend did
			// not answer", and only the first should clear the persisted
			// selection. Matching "404" inside the text is how `useAgent` does
			// it, and that is the fragile pattern this avoids repeating.
			throw new DesktopControlError(
				response.status,
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
	 * Publish an agent's instruction set to the Radient Agent Hub
	 *
	 * The DOCUMENT travels, not a zip of the agent directory: the local backend
	 * builds a version-1 instruction-set document from the agent row (the
	 * instruction body lives in its `system_prompt.md`) and applies only the
	 * overrides given here. Nothing else about the row can reach the wire — no
	 * conversation, no execution history, no memory, no plan, no working
	 * directory, no model — because the document has no field for any of them.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the local agent to publish
	 * @param document - The content fields the caller is overriding, if any
	 * @returns Promise resolving to the hub's publication result
	 * @throws PublicationError when the hub or the proxy refused with a code, and
	 * `DesktopControlError` when it refused without one (see `publicationFailure`)
	 */
	async publishAgentInstructionSet(
		_baseUrl: string,
		agentId: string,
		document?: PublicationDocumentOverride,
	): Promise<CRUDResponse<PublishedListing>> {
		const response = await desktopControlResponse({
			op: "agent.publish",
			agentId,
			document,
		});

		if (!response.ok) throw await publicationFailure(response);

		return response.json() as Promise<CRUDResponse<PublishedListing>>;
	},

	/**
	 * Update an already-published listing with the agent's current instruction set
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the local agent whose instruction set is being published
	 * @param hubAgentId - ID of the HUB listing to update (not a local agent id)
	 * @param document - The content fields the caller is overriding, if any
	 * @returns Promise resolving to the hub's publication result
	 * @throws PublicationError on a refusal, `DesktopControlError` without a code
	 */
	async republishAgentInstructionSet(
		_baseUrl: string,
		agentId: string,
		hubAgentId: string,
		document?: PublicationDocumentOverride,
	): Promise<CRUDResponse<PublishedListing>> {
		const response = await desktopControlResponse({
			op: "agent.republish",
			agentId,
			hubAgentId,
			document,
		});

		if (!response.ok) throw await publicationFailure(response);

		return response.json() as Promise<CRUDResponse<PublishedListing>>;
	},

	/**
	 * Ask the hub whether an agent name can be published
	 *
	 * Public and advisory, and deliberately without a credential: a check that
	 * needed a signed-in account would be unavailable in exactly the state where
	 * the user is deciding whether to sign in. It is also not authoritative — a
	 * name reported available can be taken before the publication lands — so
	 * callers must treat a failure here as "no answer" rather than as a refusal.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param name - The name as the user typed it
	 * @returns Promise resolving to the hub's availability answer
	 * @throws PublicationError on a refusal, `DesktopControlError` without a code
	 */
	async getAgentNameAvailability(
		_baseUrl: string,
		name: string,
	): Promise<CRUDResponse<NameAvailability>> {
		const response = await desktopControlResponse({
			op: "agent.nameAvailability",
			name,
		});

		if (!response.ok) throw await publicationFailure(response);

		return response.json() as Promise<CRUDResponse<NameAvailability>>;
	},

	/**
	 * Upload (push) an agent to Radient marketplace
	 *
	 * The LEGACY path: it zips the agent directory and posts the archive, and an
	 * agent published that way carries no instruction-set document. It is kept
	 * because it is how a row published before the standard is still updated, and
	 * the app's own publish action no longer calls it — `publishAgentInstructionSet`
	 * does. Every failure here is one prose string (the D-2 defect), which is why
	 * nothing user-facing should still reach for it.
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
		// Marketplace upload is a gated legacy control and NOTHING IN THIS TREE
		// CALLS IT: the publish dialog moved onto the instruction-set ops, and the
		// hook and the row-menu handler that used this are deleted. It is kept for
		// the `legacy.agent.upload` contract op alone, so a build predating the
		// standard still has its way in; a bare fetch 401s in the managed posture
		// this app creates.
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

		// The refusal keeps whatever structure the backend sent, rather than being
		// flattened into one prefixed string: a pull can fail because the agent is
		// gone from the hub, because the hub is unreachable, or because this
		// machine could not write the row, and those need different sentences. The
		// old arm here read `detail` as a STRING and interpolated it, so a
		// structured refusal would have reached the user as "[object Object]"
		// (contract D-2's shape, on the pull side).
		if (!response.ok) throw await controlRefusal(response);

		return response.json() as Promise<CRUDResponse<AgentDetails>>;
	},
};
