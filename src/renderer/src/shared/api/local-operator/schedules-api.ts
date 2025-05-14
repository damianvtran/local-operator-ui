/**
 * Local Operator API - Schedules Endpoints
 */
import type {
	CRUDResponse,
	ScheduleCreateRequest,
	ScheduleListResponse,
	ScheduleResponse,
	ScheduleUpdateRequest,
} from "./types";

/**
 * Schedules API client for the Local Operator API
 */
export const SchedulesApi = {
	/**
	 * List all schedules
	 * Retrieve a paginated list of all schedules across all agents.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param page - Page number (default: 1)
	 * @param perPage - Number of schedules per page (default: 10)
	 * @returns Promise resolving to the schedules list response
	 */
	async listAllSchedules(
		baseUrl: string,
		page = 1,
		perPage = 10,
	): Promise<CRUDResponse<ScheduleListResponse>> {
		const url = new URL(`${baseUrl}/v1/schedules`);
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
				`List all schedules request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ScheduleListResponse>>;
	},

	/**
	 * Create a new schedule for an agent
	 * Create a new schedule for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to create the schedule for
	 * @param scheduleData - The schedule details to create
	 * @returns Promise resolving to the created schedule response
	 */
	async createScheduleForAgent(
		baseUrl: string,
		agentId: string,
		scheduleData: ScheduleCreateRequest,
	): Promise<CRUDResponse<ScheduleResponse>> {
		const response = await fetch(
			`${baseUrl}/v1/agents/${agentId}/schedules`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(scheduleData),
			},
		);

		if (!response.ok) {
			throw new Error(
				`Create schedule for agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ScheduleResponse>>;
	},

	/**
	 * List schedules for a specific agent
	 * Retrieve a paginated list of schedules for a specific agent.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - ID of the agent to list schedules for
	 * @param page - Page number (default: 1)
	 * @param perPage - Number of schedules per page (default: 10)
	 * @returns Promise resolving to the schedules list response
	 */
	async listSchedulesForAgent(
		baseUrl: string,
		agentId: string,
		page = 1,
		perPage = 10,
	): Promise<CRUDResponse<ScheduleListResponse>> {
		const url = new URL(`${baseUrl}/v1/agents/${agentId}/schedules`);
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
				`List schedules for agent request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ScheduleListResponse>>;
	},

	/**
	 * Get a single schedule by ID
	 * Retrieve a single schedule by its ID.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param scheduleId - ID of the schedule to retrieve
	 * @returns Promise resolving to the schedule details response
	 */
	async getScheduleById(
		baseUrl: string,
		scheduleId: string,
	): Promise<CRUDResponse<ScheduleResponse>> {
		const response = await fetch(`${baseUrl}/v1/schedules/${scheduleId}`, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Get schedule by ID request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ScheduleResponse>>;
	},

	/**
	 * Edit an existing schedule
	 * Edit an existing schedule by its ID.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param scheduleId - ID of the schedule to update
	 * @param scheduleData - The schedule details to update
	 * @returns Promise resolving to the updated schedule response
	 */
	async editSchedule(
		baseUrl: string,
		scheduleId: string,
		scheduleData: ScheduleUpdateRequest,
	): Promise<CRUDResponse<ScheduleResponse>> {
		const response = await fetch(`${baseUrl}/v1/schedules/${scheduleId}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(scheduleData),
		});

		if (!response.ok) {
			throw new Error(
				`Edit schedule request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<ScheduleResponse>>;
	},

	/**
	 * Remove a schedule by ID
	 * Remove a schedule by its ID.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param scheduleId - ID of the schedule to delete
	 * @returns Promise resolving to the deletion response
	 */
	async removeSchedule(
		baseUrl: string,
		scheduleId: string,
	): Promise<CRUDResponse> {
		const response = await fetch(`${baseUrl}/v1/schedules/${scheduleId}`, {
			method: "DELETE",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Remove schedule request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},
};
