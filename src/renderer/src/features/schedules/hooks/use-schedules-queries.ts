import {
	type CRUDResponse,
	type ScheduleCreateRequest,
	type ScheduleListResponse,
	type ScheduleResponse,
	type ScheduleUpdateRequest,
	SchedulesApi,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config/api-config"; // Corrected import path for useApiConfig
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const SCHEDULE_QUERY_KEY = "schedules";
const AGENT_SCHEDULE_QUERY_KEY = "agentSchedules";

/**
 * Hook to fetch all schedules.
 * @param page - Page number for pagination.
 * @param perPage - Number of items per page.
 */
export const useListAllSchedules = (page = 1, perPage = 10) => {
	const { baseUrl } = apiConfig;
	return useQuery<CRUDResponse<ScheduleListResponse>, Error>({
		queryKey: [SCHEDULE_QUERY_KEY, "all", page, perPage],
		queryFn: () => SchedulesApi.listAllSchedules(baseUrl, page, perPage),
		enabled: !!baseUrl,
	});
};

/**
 * Hook to fetch schedules for a specific agent.
 * @param agentId - The ID of the agent.
 * @param page - Page number for pagination.
 * @param perPage - Number of items per page.
 */
export const useListSchedulesForAgent = (
	agentId: string,
	page = 1,
	perPage = 10,
) => {
	const { baseUrl } = apiConfig;
	return useQuery<CRUDResponse<ScheduleListResponse>, Error>({
		queryKey: [AGENT_SCHEDULE_QUERY_KEY, agentId, page, perPage],
		queryFn: () =>
			SchedulesApi.listSchedulesForAgent(baseUrl, agentId, page, perPage),
		enabled: !!baseUrl && !!agentId,
	});
};

/**
 * Hook to fetch a single schedule by its ID.
 * @param scheduleId - The ID of the schedule.
 */
export const useGetScheduleById = (scheduleId: string | null) => {
	const { baseUrl } = apiConfig;
	return useQuery<CRUDResponse<ScheduleResponse>, Error>({
		queryKey: [SCHEDULE_QUERY_KEY, scheduleId],
		queryFn: () => {
			if (!scheduleId) {
				// This should ideally not be reached if 'enabled' is working correctly
				return Promise.reject(new Error("scheduleId is required"));
			}
			return SchedulesApi.getScheduleById(baseUrl, scheduleId);
		},
		enabled: !!baseUrl && !!scheduleId,
	});
};

/**
 * Hook to create a new schedule for an agent.
 */
export const useCreateScheduleForAgent = () => {
	const queryClient = useQueryClient();
	const { baseUrl } = apiConfig;

	return useMutation<
		CRUDResponse<ScheduleResponse>,
		Error,
		{ agentId: string; scheduleData: ScheduleCreateRequest }
	>({
		mutationFn: ({ agentId, scheduleData }) =>
			SchedulesApi.createScheduleForAgent(baseUrl, agentId, scheduleData),
		onSuccess: (_, variables) => {
			// Invalidate queries for all schedules and specific agent schedules
			queryClient.invalidateQueries({ queryKey: [SCHEDULE_QUERY_KEY, "all"] });
			queryClient.invalidateQueries({
				queryKey: [AGENT_SCHEDULE_QUERY_KEY, variables.agentId],
			});
		},
	});
};

/**
 * Hook to edit an existing schedule.
 */
export const useEditSchedule = () => {
	const queryClient = useQueryClient();
	const { baseUrl } = apiConfig;

	return useMutation<
		CRUDResponse<ScheduleResponse>,
		Error,
		{ scheduleId: string; scheduleData: ScheduleUpdateRequest }
	>({
		mutationFn: ({ scheduleId, scheduleData }) =>
			SchedulesApi.editSchedule(baseUrl, scheduleId, scheduleData),
		onSuccess: (data) => {
			const agentId = data.result?.agent_id;
			// Invalidate queries for all schedules and the specific schedule
			queryClient.invalidateQueries({ queryKey: [SCHEDULE_QUERY_KEY, "all"] });
			queryClient.invalidateQueries({
				queryKey: [SCHEDULE_QUERY_KEY, data.result?.id],
			});
			if (agentId) {
				queryClient.invalidateQueries({
					queryKey: [AGENT_SCHEDULE_QUERY_KEY, agentId],
				});
			}
		},
	});
};

/**
 * Hook to remove a schedule by its ID.
 */
export const useRemoveSchedule = () => {
	const queryClient = useQueryClient();
	const { baseUrl } = apiConfig;

	return useMutation<
		CRUDResponse,
		Error,
		{ scheduleId: string; agentId?: string } // agentId is optional, used for cache invalidation
	>({
		mutationFn: ({ scheduleId }) =>
			SchedulesApi.removeSchedule(baseUrl, scheduleId),
		onSuccess: (_, variables) => {
			// Invalidate queries for all schedules and the specific schedule
			queryClient.invalidateQueries({ queryKey: [SCHEDULE_QUERY_KEY, "all"] });
			queryClient.invalidateQueries({
				queryKey: [SCHEDULE_QUERY_KEY, variables.scheduleId],
			});
			if (variables.agentId) {
				queryClient.invalidateQueries({
					queryKey: [AGENT_SCHEDULE_QUERY_KEY, variables.agentId],
				});
			}
		},
	});
};
