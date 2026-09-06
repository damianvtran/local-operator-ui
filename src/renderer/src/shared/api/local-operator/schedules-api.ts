/**
 * Local Operator API - Schedules Endpoints
 *
 * Every call here goes through the authenticated desktop contract rather than a
 * bare `fetch`. The whole `/v1/schedules` family is gated in managed mode: a
 * schedule's prompt is executed later by the user's own agent, so the routes
 * that write one sit behind the desktop bearer and a same-origin check.
 */
import { desktopControlResponse } from "./desktop-api";
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
		_baseUrl: string,
		page = 1,
		perPage = 10,
	): Promise<CRUDResponse<ScheduleListResponse>> {
		const response = await desktopControlResponse({
			op: "legacy.schedules.list",
			page,
			perPage,
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
		_baseUrl: string,
		agentId: string,
		scheduleData: ScheduleCreateRequest,
	): Promise<CRUDResponse<ScheduleResponse>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.schedule.create",
			agentId,
			schedule: scheduleData,
		});

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
		_baseUrl: string,
		agentId: string,
		page = 1,
		perPage = 10,
	): Promise<CRUDResponse<ScheduleListResponse>> {
		const response = await desktopControlResponse({
			op: "legacy.agent.schedules.list",
			agentId,
			page,
			perPage,
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
		_baseUrl: string,
		scheduleId: string,
	): Promise<CRUDResponse<ScheduleResponse>> {
		const response = await desktopControlResponse({
			op: "legacy.schedule.get",
			scheduleId,
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
		_baseUrl: string,
		scheduleId: string,
		scheduleData: ScheduleUpdateRequest,
	): Promise<CRUDResponse<ScheduleResponse>> {
		const response = await desktopControlResponse({
			op: "legacy.schedule.edit",
			scheduleId,
			schedule: scheduleData,
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
		_baseUrl: string,
		scheduleId: string,
	): Promise<CRUDResponse> {
		const response = await desktopControlResponse({
			op: "legacy.schedule.remove",
			scheduleId,
		});

		if (!response.ok) {
			throw new Error(
				`Remove schedule request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},
};
